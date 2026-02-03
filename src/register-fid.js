const { Wallet, JsonRpcProvider, Contract, formatEther } = require('ethers');
const { CONTRACTS, RPC, ABIS } = require('./config');

/**
 * Register a new Farcaster ID (FID)
 *
 * Prerequisites:
 * - Wallet with ETH on Optimism (0.002-0.005 ETH for registration + gas)
 *
 * @param {string} privateKey - Wallet private key (with 0x prefix)
 * @returns {Promise<{fid: bigint, txHash: string}>}
 */
async function registerFid(privateKey) {
  const provider = new JsonRpcProvider(RPC.OPTIMISM);
  const wallet = new Wallet(privateKey, provider);

  console.log('Wallet address:', wallet.address);

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  console.log('Balance:', formatEther(balance), 'ETH');

  // Check if already registered
  const idRegistry = new Contract(CONTRACTS.ID_REGISTRY, ABIS.ID_REGISTRY, provider);
  const existingFid = await idRegistry.idOf(wallet.address);

  if (existingFid > 0n) {
    console.log('Already registered with FID:', existingFid.toString());
    return { fid: existingFid, txHash: null };
  }

  // Get registration price
  const idGateway = new Contract(CONTRACTS.ID_GATEWAY, ABIS.ID_GATEWAY, wallet);
  const price = await idGateway.price();
  console.log('Registration price:', formatEther(price), 'ETH');

  if (balance < price) {
    throw new Error(`Insufficient balance. Need ${formatEther(price)} ETH, have ${formatEther(balance)} ETH`);
  }

  // Register
  console.log('Registering FID...');
  const tx = await idGateway.register(
    wallet.address, // recovery address = self
    {
      value: price + 50000000000000n, // Add buffer for safety
      gasLimit: 400000n
    }
  );

  console.log('Transaction:', tx.hash);
  console.log('Waiting for confirmation...');

  await tx.wait();

  // Get the new FID
  const fid = await idRegistry.idOf(wallet.address);
  console.log('SUCCESS! Registered FID:', fid.toString());

  return { fid, txHash: tx.hash };
}

// CLI usage
if (require.main === module) {
  const privateKey = process.env.PRIVATE_KEY || process.argv[2];

  if (!privateKey) {
    console.log('Usage: PRIVATE_KEY=0x... node register-fid.js');
    console.log('   or: node register-fid.js 0x...');
    process.exit(1);
  }

  registerFid(privateKey)
    .then(({ fid, txHash }) => {
      console.log('\n=== Registration Complete ===');
      console.log('FID:', fid.toString());
      if (txHash) console.log('TX:', txHash);
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = { registerFid };
