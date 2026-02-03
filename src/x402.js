const { randomBytes } = require('ethers');
const https = require('https');
const { NEYNAR, USDC_BASE, EIP712, EIP712_TYPES } = require('./config');

/**
 * Create an x402 payment header using EIP-3009 (transferWithAuthorization)
 * This allows gasless USDC payments on Base
 */
async function createX402Header(wallet) {
  const nonce = '0x' + Buffer.from(randomBytes(32)).toString('hex');
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

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

  const payload = {
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
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Make an HTTP request with x402 payment
 */
async function x402Request(wallet, options, body = null) {
  const header = await createX402Header(wallet);

  return new Promise((resolve, reject) => {
    const reqOptions = {
      ...options,
      port: 443,
      headers: {
        ...options.headers,
        'X-PAYMENT': header
      }
    };

    const req = https.request(reqOptions, (res) => {
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

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Submit a message to Neynar hub with x402 payment
 */
async function submitMessage(wallet, messageBytes) {
  return x402Request(wallet, {
    hostname: NEYNAR.HUB_API,
    path: '/v1/submitMessage',
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': messageBytes.length
    }
  }, messageBytes);
}

/**
 * Get a cast by hash from Neynar API with x402 payment
 */
async function getCast(wallet, castHash) {
  return x402Request(wallet, {
    hostname: NEYNAR.API,
    path: `/v2/farcaster/cast?identifier=${castHash}&type=hash`,
    method: 'GET'
  });
}

/**
 * Check if FID is synced on Neynar hub
 */
async function checkFidSync(wallet, address) {
  return x402Request(wallet, {
    hostname: NEYNAR.HUB_API,
    path: `/v1/onChainIdRegistryEventByAddress?address=${address}`,
    method: 'GET'
  });
}

/**
 * Check signer sync status
 */
async function checkSignerSync(wallet, fid) {
  return x402Request(wallet, {
    hostname: NEYNAR.HUB_API,
    path: `/v1/onChainSignersByFid?fid=${fid}`,
    method: 'GET'
  });
}

module.exports = {
  createX402Header,
  x402Request,
  submitMessage,
  getCast,
  checkFidSync,
  checkSignerSync
};
