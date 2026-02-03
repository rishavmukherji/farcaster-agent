const { Wallet, JsonRpcProvider, Contract, formatEther, formatUnits } = require('ethers');
const { RPC, USDC_BASE, ABIS } = require('./config');

// Uniswap V3 SwapRouter on Base
const UNISWAP_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';
const WETH = '0x4200000000000000000000000000000000000006';

const ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)'
];

/**
 * Swap ETH to USDC on Base using Uniswap V3
 *
 * This is needed to get USDC for x402 payments to Neynar
 *
 * @param {string} privateKey - Wallet private key
 * @param {bigint} amountIn - Amount of ETH to swap (in wei)
 * @returns {Promise<{usdcReceived: string, txHash: string}>}
 */
async function swapEthToUsdc(privateKey, amountIn = null) {
  const provider = new JsonRpcProvider(RPC.BASE);
  const wallet = new Wallet(privateKey, provider);

  console.log('Wallet:', wallet.address);

  const ethBalance = await provider.getBalance(wallet.address);
  console.log('ETH balance:', formatEther(ethBalance));

  const usdc = new Contract(USDC_BASE, ABIS.ERC20, provider);
  const usdcBalance = await usdc.balanceOf(wallet.address);
  console.log('USDC balance:', formatUnits(usdcBalance, 6));

  // Default to swapping 1/3 of balance
  if (!amountIn) {
    amountIn = ethBalance / 3n;
  }

  if (amountIn > ethBalance) {
    throw new Error('Insufficient ETH balance');
  }

  console.log('\nSwapping', formatEther(amountIn), 'ETH for USDC...');

  const router = new Contract(UNISWAP_ROUTER, ROUTER_ABI, wallet);

  // Try 0.05% fee tier first (common for ETH/stablecoin)
  // Fall back to 0.3% if that fails
  const feeTiers = [500, 3000];

  for (const fee of feeTiers) {
    try {
      const tx = await router.exactInputSingle(
        {
          tokenIn: WETH,
          tokenOut: USDC_BASE,
          fee,
          recipient: wallet.address,
          amountIn,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n
        },
        {
          value: amountIn,
          gasLimit: 300000n
        }
      );

      console.log('Transaction:', tx.hash);
      await tx.wait();

      const newUsdcBalance = await usdc.balanceOf(wallet.address);
      const usdcReceived = newUsdcBalance - usdcBalance;

      console.log('SUCCESS! Received:', formatUnits(usdcReceived, 6), 'USDC');

      return {
        usdcReceived: formatUnits(usdcReceived, 6),
        txHash: tx.hash
      };
    } catch (e) {
      console.log(`Fee tier ${fee / 10000}% failed:`, e.message);
      if (fee === feeTiers[feeTiers.length - 1]) {
        throw new Error('All swap attempts failed');
      }
    }
  }
}

// CLI usage
if (require.main === module) {
  const privateKey = process.env.PRIVATE_KEY || process.argv[2];

  if (!privateKey) {
    console.log('Usage: PRIVATE_KEY=0x... node swap-to-usdc.js');
    process.exit(1);
  }

  swapEthToUsdc(privateKey)
    .then(({ usdcReceived, txHash }) => {
      console.log('\n=== Swap Complete ===');
      console.log('USDC received:', usdcReceived);
      console.log('TX:', txHash);
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = { swapEthToUsdc };
