# Farcaster Agent

Autonomous Farcaster account creation and casting without human intervention.

This toolkit allows an AI agent (or script) to:
1. Create a new Farcaster account (register an FID)
2. Add a signer key for posting
3. Post casts to the network

All operations are fully programmatic - no Warpcast app or manual steps required.

## Prerequisites

- Node.js 18+
- ETH on Optimism (~$5 for registration + gas)
- ETH on Base (~$0.50 for swapping to USDC)
- The USDC is used for x402 micropayments to Neynar's hub API

## Installation

```bash
npm install
```

## Quick Start

### 1. Generate a Wallet

```javascript
const { Wallet } = require('ethers');
const wallet = Wallet.createRandom();
console.log('Address:', wallet.address);
console.log('Private Key:', wallet.privateKey);
console.log('Mnemonic:', wallet.mnemonic.phrase);
```

### 2. Fund the Wallet

- Send ~0.005 ETH to the address on **Optimism** (for FID registration)
- Send ~0.001 ETH to the same address on **Base** (for USDC swap)

### 3. Register FID

```bash
PRIVATE_KEY=0x... node src/register-fid.js
```

### 4. Add Signer Key

```bash
PRIVATE_KEY=0x... node src/add-signer.js
```

Save the signer private key that's output - you need it to post casts.

### 5. Swap ETH to USDC (for x402 payments)

```bash
PRIVATE_KEY=0x... node src/swap-to-usdc.js
```

### 6. Post a Cast

```bash
PRIVATE_KEY=0x... SIGNER_PRIVATE_KEY=... FID=123 node src/post-cast.js "Hello Farcaster!"
```

## Detailed Walkthrough

### Step 1: FID Registration (Optimism)

Farcaster IDs are registered on Optimism via the `IdGateway` contract.

```
IdGateway: 0x00000000Fc25870C6eD6b6c7E41Fb078b7656f69
```

The registration costs ~0.00008 ETH (storage fee) plus gas.

**Key function:** `register(address recovery)` - registers a new FID with the caller as owner.

### Step 2: Adding a Signer Key (Optimism)

This is the tricky part. Farcaster requires a "Signed Key Request" to add signer keys - it's an anti-spam measure.

**The key insight:** You can use your own FID as the "app" that signs the key request. Since you control the custody address, you can self-sign.

The process:
1. Generate an Ed25519 keypair (the signer key)
2. Create an EIP-712 `SignedKeyRequest` message
3. Sign it with your custody wallet
4. Use the `SignedKeyRequestValidator` contract to encode the metadata
5. Call `KeyGateway.add()` with the encoded metadata

**Critical:** You MUST use the validator contract's `encodeMetadata()` function. Manual ABI encoding doesn't work because the struct encoding includes a dynamic offset pointer.

```
KeyGateway: 0x00000000fC56947c7E7183f8Ca4B62398CaAdf0B
SignedKeyRequestValidator: 0x00000000FC700472606ED4fA22623Acf62c60553
```

### Step 3: Posting Casts (via Neynar Hub)

Casts are submitted to Farcaster hubs as protobuf-encoded messages.

**Problem:** Most public hubs (like hub.pinata.cloud) lag behind on syncing on-chain events. They may not recognize your new FID for hours or days.

**Solution:** Use Neynar's hub (`hub-api.neynar.com`) which requires x402 micropayments but is well-synced.

### Step 4: x402 Payments

Neynar uses the x402 payment protocol. Each API call costs 0.001 USDC on Base.

The payment uses EIP-3009 (`transferWithAuthorization`) - a gasless signature-based USDC transfer:

1. Sign an EIP-712 message authorizing Neynar to pull USDC
2. Base64-encode the payment payload
3. Include it in the `X-PAYMENT` header

**Payment payload structure:**
```json
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "base",
  "payload": {
    "signature": "0x...",
    "authorization": {
      "from": "0x...",
      "to": "0xA6a8736f18f383f1cc2d938576933E5eA7Df01A1",
      "value": "1000",
      "validAfter": "0",
      "validBefore": "...",
      "nonce": "0x..."
    }
  }
}
```

## Common Errors & Solutions

### Error: "unknown fid"

**Cause:** The hub hasn't synced your on-chain FID registration yet.

**Solution:** Use Neynar's hub which is better synced. Public hubs like Pinata can be millions of FIDs behind.

### Error: Transaction reverts when adding signer

**Cause:** The SignedKeyRequest metadata is incorrectly encoded.

**Solution:** Use the `SignedKeyRequestValidator.encodeMetadata()` contract function instead of manual ABI encoding. The struct requires a dynamic offset pointer that manual encoding misses.

**Wrong:**
```javascript
const metadata = abiCoder.encode(
  ['uint256', 'address', 'bytes', 'uint256'],
  [fid, wallet.address, signature, deadline]
);
```

**Right:**
```javascript
const validator = new Contract(VALIDATOR_ADDRESS, VALIDATOR_ABI, provider);
const metadata = await validator.encodeMetadata([fid, wallet.address, signature, deadline]);
```

### Error: "Failed to verify payment" (x402)

**Cause:** Wrong x402 header format.

**Solution:** The payload must include:
- `x402Version: 1` (number, not string)
- `payload.authorization` object (not `payload.txHash`)
- All values as strings in the authorization object

### Error: Cast submitted but not found

**Cause:** Hub returned 200 but cast didn't propagate.

**Solution:** Verify the cast after submission using the GET endpoint. If it fails, the hub may have silently rejected it. Check that your FID and signer are properly synced first.

### Error: "data is missing" on Neynar API

**Cause:** Wrong endpoint or content type.

**Solution:**
- Use `hub-api.neynar.com/v1/submitMessage` for raw protobuf
- Use `Content-Type: application/octet-stream`
- Send the raw message bytes, not JSON

## Architecture Notes

### Farcaster Protocol Contracts (Optimism)

| Contract | Address | Purpose |
|----------|---------|---------|
| IdGateway | 0x00000000Fc25870C6eD6b6c7E41Fb078b7656f69 | Register new FIDs |
| IdRegistry | 0x00000000Fc6c5F01Fc30151999387Bb99A9f489b | Query FID ownership |
| KeyGateway | 0x00000000fC56947c7E7183f8Ca4B62398CaAdf0B | Add signer keys |
| KeyRegistry | 0x00000000Fc1237824fb747aBDE0FF18990E59b7e | Query signer keys |
| SignedKeyRequestValidator | 0x00000000FC700472606ED4fA22623Acf62c60553 | Validate/encode key requests |

### Message Flow

```
1. Register FID (Optimism) → IdGateway.register()
2. Add Signer (Optimism) → KeyGateway.add()
3. Wait for hub sync (can take minutes)
4. Create cast → @farcaster/hub-nodejs
5. Submit to hub → Neynar API with x402 payment
```

### Key Types

- **Custody Key:** Ethereum wallet that owns the FID (secp256k1)
- **Signer Key:** Ed25519 key for signing casts (separate from custody)

## Cost Breakdown

| Operation | Network | Cost |
|-----------|---------|------|
| FID Registration | Optimism | ~$0.20 |
| Add Signer | Optimism | ~$0.05 gas |
| ETH→USDC Swap | Base | ~$0.10 gas |
| Each API call | Base (x402) | $0.001 USDC |

Total to get started: ~$0.50-1.00

## Programmatic Usage

```javascript
const { registerFid, addSigner, postCast, swapEthToUsdc } = require('./src');

async function main() {
  const privateKey = '0x...';

  // 1. Register FID
  const { fid } = await registerFid(privateKey);

  // 2. Add signer
  const { signerPrivateKey } = await addSigner(privateKey);

  // 3. Get USDC for x402 (on Base)
  await swapEthToUsdc(privateKey);

  // 4. Post cast
  const { hash } = await postCast({
    privateKey,
    signerPrivateKey,
    fid: Number(fid),
    text: 'Hello from my autonomous agent!'
  });

  console.log('Cast:', hash);
}
```

## License

MIT
