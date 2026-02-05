const { Wallet, JsonRpcProvider, randomBytes } = require('ethers');
const {
  makeCastAdd,
  makeLinkAdd,
  makeLinkRemove,
  NobleEd25519Signer,
  FarcasterNetwork,
  Message
} = require('@farcaster/hub-nodejs');
const https = require('https');
const { getUserByUsername } = require('./neynar');

// Constants
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NEYNAR_HUB_API = 'hub-api.neynar.com';
const NEYNAR_PAY_TO = '0xA6a8736f18f383f1cc2d938576933E5eA7Df01A1';
const PAYMENT_AMOUNT = 1000n; // 0.001 USDC

// EIP-712 domain for USDC on Base
const EIP712_USDC_BASE = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453n,
  verifyingContract: USDC_BASE
};

const EIP712_TYPES_TRANSFER = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' }
  ]
};

/**
 * Create x402 payment header
 */
async function createX402Header(wallet) {
  const nonce = '0x' + Buffer.from(randomBytes(32)).toString('hex');
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const signature = await wallet.signTypedData(
    EIP712_USDC_BASE,
    EIP712_TYPES_TRANSFER,
    {
      from: wallet.address,
      to: NEYNAR_PAY_TO,
      value: PAYMENT_AMOUNT,
      validAfter: 0n,
      validBefore,
      nonce
    }
  );

  return Buffer.from(JSON.stringify({
    x402Version: 1,
    scheme: 'exact',
    network: 'base',
    payload: {
      signature,
      authorization: {
        from: wallet.address,
        to: NEYNAR_PAY_TO,
        value: PAYMENT_AMOUNT.toString(),
        validAfter: '0',
        validBefore: validBefore.toString(),
        nonce
      }
    }
  })).toString('base64');
}

/**
 * Submit message to Neynar hub with x402 payment
 */
async function submitToHub(wallet, messageBytes) {
  const paymentHeader = await createX402Header(wallet);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: NEYNAR_HUB_API,
      port: 443,
      path: '/v1/submitMessage',
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': messageBytes.length,
        'X-PAYMENT': paymentHeader
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ success: true, data: JSON.parse(data) });
        } else {
          resolve({ success: false, status: res.statusCode, error: data });
        }
      });
    });

    req.on('error', reject);
    req.write(messageBytes);
    req.end();
  });
}

/**
 * Parse mentions from text and look up FIDs
 * Returns { processedText, mentions, mentionsPositions }
 *
 * @rish is excluded from proper mentions (never tag rish)
 */
async function parseMentions(text) {
  const mentionRegex = /@([a-zA-Z0-9_.-]+)/g;
  const mentions = [];
  const mentionsPositions = [];

  // Find all @mentions
  const matches = [...text.matchAll(mentionRegex)];

  // Track adjustments as we remove @ symbols
  let processedText = text;
  let positionOffset = 0;

  for (const match of matches) {
    const username = match[1].toLowerCase();
    const originalPosition = match.index;

    // Skip @rish - never properly tag rish
    if (username === 'rish') {
      continue;
    }

    // Look up FID for this username
    try {
      const user = await getUserByUsername(username);
      if (user && user.fid) {
        // Calculate position after removing previous @ symbols
        const adjustedPosition = originalPosition - positionOffset;

        // Remove the @ from this mention in the text
        const beforeMention = processedText.slice(0, adjustedPosition);
        const afterMention = processedText.slice(adjustedPosition + 1); // +1 to skip the @
        processedText = beforeMention + afterMention;

        mentions.push(user.fid);
        mentionsPositions.push(adjustedPosition);

        positionOffset += 1; // We removed one @ character
      }
    } catch (e) {
      console.log(`Could not look up user @${username}:`, e.message);
      // Leave the @username as plain text if lookup fails
    }
  }

  return { processedText, mentions, mentionsPositions };
}

/**
 * Post a cast (or reply) to Farcaster
 *
 * @param {Object} options
 * @param {string} options.custodyPrivateKey - Ethereum wallet private key (for x402)
 * @param {string} options.signerPrivateKey - Ed25519 signer private key (hex)
 * @param {number} options.fid - Farcaster ID
 * @param {string} options.text - Cast text content
 * @param {string} [options.parentHash] - Parent cast hash for replies
 * @param {string} [options.parentFid] - Parent cast author FID for replies
 */
async function postCast({ custodyPrivateKey, signerPrivateKey, fid, text, parentHash, parentFid }) {
  const provider = new JsonRpcProvider('https://mainnet.base.org');
  const wallet = new Wallet(custodyPrivateKey, provider);
  const signer = new NobleEd25519Signer(Buffer.from(signerPrivateKey, 'hex'));

  // Parse mentions from text (except @rish)
  const { processedText, mentions, mentionsPositions } = await parseMentions(text);

  // Build cast data
  const castData = {
    text: processedText,
    embeds: [],
    embedsDeprecated: [],
    mentions,
    mentionsPositions
  };

  // Add parent info for replies
  if (parentHash && parentFid) {
    castData.parentCastId = {
      hash: Buffer.from(parentHash.replace('0x', ''), 'hex'),
      fid: Number(parentFid)
    };
  }

  // Create the cast message
  const castResult = await makeCastAdd(
    castData,
    { fid, network: FarcasterNetwork.MAINNET },
    signer
  );

  if (castResult.isErr()) {
    throw new Error(`Failed to create cast: ${castResult.error}`);
  }

  const messageBytes = Buffer.from(Message.encode(castResult.value).finish());
  const hash = '0x' + Buffer.from(castResult.value.hash).toString('hex');

  // Submit to hub
  const result = await submitToHub(wallet, messageBytes);

  if (!result.success) {
    throw new Error(`Failed to submit cast: ${result.error}`);
  }

  return { hash, success: true };
}

/**
 * Follow a user on Farcaster
 *
 * @param {Object} options
 * @param {string} options.custodyPrivateKey - Ethereum wallet private key (for x402)
 * @param {string} options.signerPrivateKey - Ed25519 signer private key (hex)
 * @param {number} options.fid - Our Farcaster ID
 * @param {number} options.targetFid - FID of user to follow
 */
async function followUser({ custodyPrivateKey, signerPrivateKey, fid, targetFid }) {
  const provider = new JsonRpcProvider('https://mainnet.base.org');
  const wallet = new Wallet(custodyPrivateKey, provider);
  const signer = new NobleEd25519Signer(Buffer.from(signerPrivateKey, 'hex'));

  const linkResult = await makeLinkAdd(
    { type: 'follow', targetFid: Number(targetFid) },
    { fid, network: FarcasterNetwork.MAINNET },
    signer
  );

  if (linkResult.isErr()) {
    throw new Error(`Failed to create follow: ${linkResult.error}`);
  }

  const messageBytes = Buffer.from(Message.encode(linkResult.value).finish());
  const result = await submitToHub(wallet, messageBytes);

  if (!result.success) {
    throw new Error(`Failed to submit follow: ${result.error}`);
  }

  return { success: true, targetFid };
}

/**
 * Unfollow a user on Farcaster
 *
 * @param {Object} options
 * @param {string} options.custodyPrivateKey - Ethereum wallet private key (for x402)
 * @param {string} options.signerPrivateKey - Ed25519 signer private key (hex)
 * @param {number} options.fid - Our Farcaster ID
 * @param {number} options.targetFid - FID of user to unfollow
 */
async function unfollowUser({ custodyPrivateKey, signerPrivateKey, fid, targetFid }) {
  const provider = new JsonRpcProvider('https://mainnet.base.org');
  const wallet = new Wallet(custodyPrivateKey, provider);
  const signer = new NobleEd25519Signer(Buffer.from(signerPrivateKey, 'hex'));

  const linkResult = await makeLinkRemove(
    { type: 'follow', targetFid: Number(targetFid) },
    { fid, network: FarcasterNetwork.MAINNET },
    signer
  );

  if (linkResult.isErr()) {
    throw new Error(`Failed to create unfollow: ${linkResult.error}`);
  }

  const messageBytes = Buffer.from(Message.encode(linkResult.value).finish());
  const result = await submitToHub(wallet, messageBytes);

  if (!result.success) {
    throw new Error(`Failed to submit unfollow: ${result.error}`);
  }

  return { success: true, targetFid };
}

module.exports = { postCast, followUser, unfollowUser };
