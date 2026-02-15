/**
 * Bridge utilities for ETH cross-chain transfers
 * Supports: Ethereum → Optimism, Optimism → Base via Across Protocol
 */

const { Contract } = require('ethers');

const CHAINS = {
  ethereum: { chainId: 1, rpc: 'https://1rpc.io/eth' },
  optimism: { chainId: 10, rpc: 'https://1rpc.io/op' },
  base: { chainId: 8453, rpc: 'https://1rpc.io/base' }
};

// Bridge contract addresses
const BRIDGES = {
  // Optimism L1 Standard Bridge
  optimismL1Bridge: '0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1',
  // Base L1 Standard Bridge  
  baseL1Bridge: '0x3154Cf16ccdb4C6d922629664174b904d80F2C35',
  // Across Protocol (fast bridging)
  across: {
    optimism: '0x6f26Bf09B1C792e3228e5467807a900A503c0281',
    base: '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64'
  }
};

/**
 * Bridge ETH from Ethereum to Optimism using Optimism Bridge
 * @param {object} wallet - ethers Wallet instance
 * @param {bigint} amount - amount in wei
 */
async function bridgeEthToOptimism(wallet, amount) {
  const bridge = new Contract(
    BRIDGES.optimismL1Bridge,
    ['function bridgeETH(uint32 _minGasLimit, bytes calldata _extraData) payable'],
    wallet
  );
  
  const tx = await bridge.bridgeETH(200000, '0x', { value: amount });
  return tx.wait();
}

/**
 * Bridge ETH from Ethereum to Base using Base L1 Bridge
 * @param {object} wallet - ethers Wallet instance
 * @param {bigint} amount - amount in wei
 */
async function bridgeEthToBase(wallet, amount) {
  const bridge = new Contract(
    BRIDGES.baseL1Bridge,
    ['function bridgeETH(uint32 _minGasLimit, bytes calldata _extraData) payable'],
    wallet
  );
  
  const tx = await bridge.bridgeETH(200000, '0x', { value: amount });
  return tx.wait();
}

/**
 * Bridge ETH from Optimism to Base using Across Protocol
 * @param {object} wallet - ethers Wallet instance
 * @param {bigint} amount - amount in wei
 * @param {number} slippageBps - slippage in basis points (default 50 = 0.5%)
 */
async function bridgeOptimismToBase(wallet, amount, slippageBps = 50) {
  const across = new Contract(
    BRIDGES.across.base,
    ['function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes calldata message) payable'],
    wallet
  );
  
  const destChainId = CHAINS.base.chainId;
  const now = Math.floor(Date.now() / 1000);
  const outputAmount = amount * BigInt(10000 - slippageBps) / 10000n;
  
  const tx = await across.depositV3(
    wallet.address,
    wallet.address,
    '0x0000000000000000000000000000000000000000', // ETH
    '0x0000000000000000000000000000000000000000', // ETH
    amount,
    outputAmount,
    destChainId,
    wallet.address,
    now,
    now + 3600,
    0,
    '0x',
    { value: amount, gasLimit: 200000n }
  );
  
  return tx.wait();
}

module.exports = {
  CHAINS,
  BRIDGES,
  bridgeEthToOptimism,
  bridgeEthToBase,
  bridgeOptimismToBase
};
