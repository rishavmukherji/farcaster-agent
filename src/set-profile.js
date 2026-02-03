const { Wallet, JsonRpcProvider, randomBytes } = require('ethers');
const {
  makeUserDataAdd,
  makeUserNameProofClaim,
  EthersEip712Signer,
  NobleEd25519Signer,
  UserDataType,
  FarcasterNetwork,
  Message
} = require('@farcaster/hub-nodejs');
const https = require('https');
const { RPC, NEYNAR, USDC_BASE, EIP712, EIP712_TYPES } = require('./config');
const { updateCredentials } = require('./credentials');

/**
 * Create x402 payment header for Neynar API
 */
async function createX402Header(wallet) {
  const nonce = '0x' + Buffer.from(randomBytes(32)).toString('hex');
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const signature = await wallet.signTypedData(
    EIP712.USDC_BASE,
    EIP712_TYPES.TRANSFER_WITH_AUTHORIZATION,
    {
      from: wallet.address,
      to: NEYNAR.PAY_TO,
      value: NEYNAR.PAYMENT_AMOUNT,
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
        to: NEYNAR.PAY_TO,
        value: NEYNAR.PAYMENT_AMOUNT.toString(),
        validAfter: '0',
        validBefore: validBefore.toString(),
        nonce
      }
    }
  })).toString('base64');
}

/**
 * Submit a message to the hub with x402 payment
 */
async function submitToHub(wallet, messageBytes) {
  const header = await createX402Header(wallet);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: NEYNAR.HUB_API,
      port: 443,
      path: '/v1/submitMessage',
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': messageBytes.length,
        'X-PAYMENT': header
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
 * Set user profile data (display name, bio, pfp, etc.)
 *
 * @param {Object} options
 * @param {string} options.privateKey - Custody wallet private key (for x402)
 * @param {string} options.signerPrivateKey - Ed25519 signer private key
 * @param {number} options.fid - Farcaster ID
 * @param {string} [options.displayName] - Display name
 * @param {string} [options.bio] - Bio text
 * @param {string} [options.pfpUrl] - Profile picture URL
 * @param {string} [options.url] - Website URL
 */
async function setProfileData({ privateKey, signerPrivateKey, fid, displayName, bio, pfpUrl, url }) {
  const provider = new JsonRpcProvider(RPC.BASE);
  const wallet = new Wallet(privateKey, provider);
  const signer = new NobleEd25519Signer(Buffer.from(signerPrivateKey, 'hex'));

  const results = {};

  const updates = [
    { type: UserDataType.DISPLAY, value: displayName, name: 'displayName' },
    { type: UserDataType.BIO, value: bio, name: 'bio' },
    { type: UserDataType.PFP, value: pfpUrl, name: 'pfp' },
    { type: UserDataType.URL, value: url, name: 'url' }
  ].filter(u => u.value);

  for (const update of updates) {
    console.log(`Setting ${update.name}...`);

    const msgResult = await makeUserDataAdd(
      { type: update.type, value: update.value },
      { fid, network: FarcasterNetwork.MAINNET },
      signer
    );

    if (msgResult.isErr()) {
      console.log(`  Error creating message: ${msgResult.error}`);
      results[update.name] = { success: false, error: msgResult.error };
      continue;
    }

    const bytes = Buffer.from(Message.encode(msgResult.value).finish());
    const result = await submitToHub(wallet, bytes);

    if (result.success) {
      console.log(`  Success!`);
      results[update.name] = { success: true };
    } else {
      console.log(`  Failed: ${result.error}`);
      results[update.name] = { success: false, error: result.error };
    }
  }

  return results;
}

/**
 * Register an fname (Farcaster username)
 *
 * This is a two-step process:
 * 1. Register the fname with the Farcaster Name Registry
 * 2. Set the username in the hub via UserDataAdd message
 *
 * @param {Object} options
 * @param {string} options.privateKey - Custody wallet private key
 * @param {string} options.signerPrivateKey - Ed25519 signer private key
 * @param {number} options.fid - Farcaster ID
 * @param {string} options.fname - Username to register (lowercase, alphanumeric, max 16 chars)
 */
async function registerFname({ privateKey, signerPrivateKey, fid, fname }) {
  // Validate fname format
  if (!/^[a-z0-9][a-z0-9-]{0,15}$/.test(fname)) {
    throw new Error('Invalid fname format. Must be lowercase alphanumeric, 1-16 chars, can contain hyphens but not start with one.');
  }

  const provider = new JsonRpcProvider(RPC.BASE);
  const wallet = new Wallet(privateKey, provider);

  console.log('Registering fname:', fname);
  console.log('For FID:', fid);
  console.log('Owner:', wallet.address);

  // Step 1: Create EIP-712 signature for fname registration
  const eip712Signer = new EthersEip712Signer(wallet);
  const timestamp = Math.floor(Date.now() / 1000);

  const claim = makeUserNameProofClaim({
    name: fname,
    owner: wallet.address,
    timestamp: timestamp
  });

  const signatureResult = await eip712Signer.signUserNameProofClaim(claim);

  if (signatureResult.isErr()) {
    throw new Error(`Failed to sign claim: ${signatureResult.error}`);
  }

  const signature = '0x' + Buffer.from(signatureResult.value).toString('hex');

  // Step 2: Register with fname server
  console.log('\nRegistering with fname server...');

  const body = JSON.stringify({
    name: fname,
    from: 0,  // 0 = new registration
    to: fid,
    fid: fid,
    owner: wallet.address,
    timestamp: timestamp,
    signature: signature
  });

  const fnameResult = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'fnames.farcaster.xyz',
      port: 443,
      path: '/transfers',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (fnameResult.status !== 200) {
    throw new Error(`Fname registration failed: ${JSON.stringify(fnameResult.data)}`);
  }

  console.log('Fname registered with server!');
  console.log('Transfer ID:', fnameResult.data.transfer?.id);

  // Step 3: Wait for hub to sync the fname
  console.log('\nWaiting 30 seconds for hub to sync...');
  await new Promise(r => setTimeout(r, 30000));

  // Step 4: Set username in hub
  console.log('Setting username in hub...');

  const signer = new NobleEd25519Signer(Buffer.from(signerPrivateKey, 'hex'));

  const usernameResult = await makeUserDataAdd(
    { type: UserDataType.USERNAME, value: fname },
    { fid, network: FarcasterNetwork.MAINNET },
    signer
  );

  if (usernameResult.isErr()) {
    throw new Error(`Failed to create username message: ${usernameResult.error}`);
  }

  const bytes = Buffer.from(Message.encode(usernameResult.value).finish());
  const hubResult = await submitToHub(wallet, bytes);

  if (!hubResult.success) {
    // If it fails, the hub might need more time to sync
    console.log('Hub rejected, waiting another 30 seconds...');
    await new Promise(r => setTimeout(r, 30000));

    const retryResult = await submitToHub(wallet, bytes);
    if (!retryResult.success) {
      throw new Error(`Failed to set username in hub: ${retryResult.error}`);
    }
  }

  console.log('\nSUCCESS! Username @' + fname + ' is now active.');

  // Update stored credentials with fname
  try {
    updateCredentials(fid, { fname });
    console.log('Credentials updated with fname.');
  } catch (e) {
    // Credentials file may not exist if not using auto-setup
  }

  return {
    fname,
    fid,
    transferId: fnameResult.data.transfer?.id
  };
}

/**
 * Set up a complete profile with fname, display name, bio, and pfp
 */
async function setupFullProfile({ privateKey, signerPrivateKey, fid, fname, displayName, bio, pfpUrl }) {
  console.log('=== Setting up full profile ===\n');

  // Set profile data first (these don't require fname)
  if (displayName || bio || pfpUrl) {
    console.log('Step 1: Setting profile data...\n');
    await setProfileData({
      privateKey,
      signerPrivateKey,
      fid,
      displayName,
      bio,
      pfpUrl
    });
    console.log('');
  }

  // Register fname
  if (fname) {
    console.log('Step 2: Registering fname...\n');
    await registerFname({
      privateKey,
      signerPrivateKey,
      fid,
      fname
    });
  }

  console.log('\n=== Profile setup complete! ===');
  console.log('View at: https://farcaster.xyz/' + (fname || '~/profiles/' + fid));
}

// CLI usage
if (require.main === module) {
  const privateKey = process.env.PRIVATE_KEY;
  const signerPrivateKey = process.env.SIGNER_PRIVATE_KEY;
  const fid = parseInt(process.env.FID);
  const fname = process.argv[2];
  const displayName = process.argv[3];
  const bio = process.argv[4];
  const pfpUrl = process.argv[5];

  if (!privateKey || !signerPrivateKey || !fid) {
    console.log('Usage: PRIVATE_KEY=0x... SIGNER_PRIVATE_KEY=... FID=123 node set-profile.js [fname] [displayName] [bio] [pfpUrl]');
    console.log('\nExamples:');
    console.log('  # Set fname only:');
    console.log('  node set-profile.js myusername');
    console.log('');
    console.log('  # Set full profile:');
    console.log('  node set-profile.js myusername "My Name" "My bio" "https://example.com/pfp.png"');
    console.log('');
    console.log('  # Set profile without fname:');
    console.log('  node set-profile.js "" "My Name" "My bio" "https://example.com/pfp.png"');
    process.exit(1);
  }

  setupFullProfile({
    privateKey,
    signerPrivateKey,
    fid,
    fname: fname || undefined,
    displayName: displayName || undefined,
    bio: bio || undefined,
    pfpUrl: pfpUrl || undefined
  })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = {
  setProfileData,
  registerFname,
  setupFullProfile
};
