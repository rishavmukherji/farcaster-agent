const { Wallet, JsonRpcProvider } = require('ethers');
const {
  makeCastRemove,
  NobleEd25519Signer,
  FarcasterNetwork,
  Message
} = require('@farcaster/hub-nodejs');
const { RPC } = require('./config');
const { submitMessage } = require('./x402');

/**
 * Delete a cast from Farcaster
 *
 * @param {Object} options
 * @param {string} options.privateKey - Custody wallet private key (for x402 payment signing)
 * @param {string} options.signerPrivateKey - Ed25519 signer private key (hex, no 0x)
 * @param {number} options.fid - Farcaster ID
 * @param {string} options.targetHash - Hash of the cast to delete (with or without 0x prefix)
 * @returns {Promise<{hash: string}>}
 */
async function deleteCast({ privateKey, signerPrivateKey, fid, targetHash }) {
  const baseProvider = new JsonRpcProvider(RPC.BASE);
  const wallet = new Wallet(privateKey, baseProvider);

  console.log('Deleting cast:', targetHash, 'as FID:', fid);

  const signerBytes = Buffer.from(signerPrivateKey, 'hex');
  const signer = new NobleEd25519Signer(signerBytes);

  const hashHex = targetHash.startsWith('0x') ? targetHash.slice(2) : targetHash;
  const hashBytes = Buffer.from(hashHex, 'hex');

  const removeResult = await makeCastRemove(
    { targetHash: hashBytes },
    { fid, network: FarcasterNetwork.MAINNET },
    signer
  );

  if (removeResult.isErr()) {
    throw new Error(`Failed to create cast remove: ${removeResult.error}`);
  }

  const remove = removeResult.value;
  const hash = '0x' + Buffer.from(remove.hash).toString('hex');
  const messageBytes = Buffer.from(Message.encode(remove).finish());

  console.log('Remove hash:', hash);
  console.log('Message size:', messageBytes.length, 'bytes');

  console.log('Submitting to Neynar hub...');
  const submitResult = await submitMessage(wallet, messageBytes);

  if (submitResult.status !== 200) {
    throw new Error(`Submit failed: ${JSON.stringify(submitResult.data)}`);
  }

  console.log('Cast deleted successfully');
  return { hash };
}

if (require.main === module) {
  const privateKey = process.env.PRIVATE_KEY;
  const signerPrivateKey = process.env.SIGNER_PRIVATE_KEY;
  const fid = parseInt(process.env.FID);
  const targetHash = process.argv[2];

  if (!privateKey || !signerPrivateKey || !fid || !targetHash) {
    console.log('Usage: PRIVATE_KEY=0x... SIGNER_PRIVATE_KEY=... FID=123 node delete-cast.js <cast-hash>');
    process.exit(1);
  }

  deleteCast({ privateKey, signerPrivateKey, fid, targetHash })
    .then(({ hash }) => {
      console.log('\n=== Cast Deleted ===');
      console.log('Remove hash:', hash);
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = { deleteCast };
