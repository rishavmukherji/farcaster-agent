const { registerFid } = require('./register-fid');
const { addSigner } = require('./add-signer');
const { postCast } = require('./post-cast');
const { swapEthToUsdc } = require('./swap-to-usdc');
const { checkFidSync, checkSignerSync, getCast } = require('./x402');
const config = require('./config');

module.exports = {
  // Core functions
  registerFid,
  addSigner,
  postCast,
  swapEthToUsdc,

  // Utilities
  checkFidSync,
  checkSignerSync,
  getCast,

  // Config
  config
};
