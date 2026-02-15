/**
 * Rate Limiter for FarCaster Agent
 * Prevents account bans by adding delays between actions
 */

const RATE_LIMITS = {
  CAST: 3000,      // 3 seconds between casts
  FOLLOW: 5000,     // 5 seconds between follows  
  LIKE: 2000,       // 2 seconds between likes
  REPLY: 3000       // 3 seconds between replies
};

const lastAction = {
  cast: 0,
  follow: 0,
  like: 0,
  reply: 0
};

function rateLimit(actionType) {
  const limit = RATE_LIMITS[actionType.toUpperCase()] || 3000;
  const now = Date.now();
  const timeSinceLastAction = now - lastAction[actionType.toLowerCase()];
  
  if (timeSinceLastAction < limit) {
    const waitTime = limit - timeSinceLastAction;
    console.log(`Rate limiting ${actionType}: waiting ${waitTime}ms`);
    return new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastAction[actionType.toLowerCase()] = now;
  return Promise.resolve();
}

function validateFid(fid) {
  const num = parseInt(fid);
  if (isNaN(num) || num <= 0 || num > 2**32) {
    throw new Error('Invalid FID format: must be a positive 32-bit integer');
  }
  return num;
}

function validateAddress(address) {
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error('Invalid Ethereum address format');
  }
  return address;
}

module.exports = {
  rateLimit,
  RATE_LIMITS,
  validateFid,
  validateAddress
};
