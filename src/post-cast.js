const { Wallet, JsonRpcProvider } = require('ethers');
const {
  makeCastAdd,
  NobleEd25519Signer,
  FarcasterNetwork,
  Message
} = require('@farcaster/hub-nodejs');
const { RPC } = require('./config');
const { submitMessage, getCast } = require('./x402');

/**
 * Post a cast to Farcaster
 *
 * Prerequisites:
 * - FID registered and synced to Neynar hub
 * - Signer key added and synced to Neynar hub
 * - USDC on Base for x402 payments (0.001 USDC per API call)
 *
 * @param {Object} options
 * @param {string} options.privateKey - Custody wallet private key (for x402 payment signing)
 * @param {string} options.signerPrivateKey - Ed25519 signer private key (hex, no 0x)
 * @param {number} options.fid - Farcaster ID
 * @param {string} options.text - Cast text content
 * @returns {Promise<{hash: string, verified: boolean}>}
 */
async function postCast({ privateKey, signerPrivateKey, fid, text }) {
  // Create wallet for x402 payments (Base)
  const baseProvider = new JsonRpcProvider(RPC.BASE);
  const wallet = new Wallet(privateKey, baseProvider);

  console.log('Posting as FID:', fid);
  console.log('Text:', text);

  // Create signer
  const signerBytes = Buffer.from(signerPrivateKey, 'hex');
  const signer = new NobleEd25519Signer(signerBytes);

  // Create cast message
  const castResult = await makeCastAdd(
    {
      text,
      embeds: [],
      embedsDeprecated: [],
      mentions: [],
      mentionsPositions: []
    },
    {
      fid,
      network: FarcasterNetwork.MAINNET
    },
    signer
  );

  if (castResult.isErr()) {
    throw new Error(`Failed to create cast: ${castResult.error}`);
  }

  const cast = castResult.value;
  const hash = '0x' + Buffer.from(cast.hash).toString('hex');
  const messageBytes = Buffer.from(Message.encode(cast).finish());

  console.log('\nCast hash:', hash);
  console.log('Message size:', messageBytes.length, 'bytes');

  // Submit to Neynar hub with x402 payment
  console.log('Submitting to Neynar hub...');
  const submitResult = await submitMessage(wallet, messageBytes);

  if (submitResult.status !== 200) {
    throw new Error(`Submit failed: ${JSON.stringify(submitResult.data)}`);
  }

  console.log('Submitted successfully');

  // Wait a moment for propagation
  await new Promise(r => setTimeout(r, 2000));

  // Verify the cast is live
  console.log('Verifying cast...');
  const verifyResult = await getCast(wallet, hash);

  const verified = verifyResult.status === 200;

  if (verified) {
    console.log('\nCast verified on network!');
  } else {
    console.log('\nCast submitted but not yet verified. It may take a moment to propagate.');
  }

  return { hash, verified };
}

// CLI usage
if (require.main === module) {
  const privateKey = process.env.PRIVATE_KEY;
  const signerPrivateKey = process.env.SIGNER_PRIVATE_KEY;
  const fid = parseInt(process.env.FID);
  const text = process.argv[2] || 'gm from farcaster-agent!';

  if (!privateKey || !signerPrivateKey || !fid) {
    console.log('Usage: PRIVATE_KEY=0x... SIGNER_PRIVATE_KEY=... FID=123 node post-cast.js "Your cast text"');
    console.log('\nEnvironment variables:');
    console.log('  PRIVATE_KEY       - Custody wallet private key (with 0x prefix)');
    console.log('  SIGNER_PRIVATE_KEY - Ed25519 signer private key (hex, no 0x prefix)');
    console.log('  FID               - Your Farcaster ID number');
    process.exit(1);
  }

  postCast({ privateKey, signerPrivateKey, fid, text })
    .then(({ hash, verified }) => {
      console.log('\n=== Cast Posted ===');
      console.log('Hash:', hash);
      console.log('Verified:', verified);
      console.log('URL: https://farcaster.xyz/~/conversations/' + hash);
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = { postCast };
