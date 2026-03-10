---
name: farcaster-agent
description: Bootstrap the Farcaster agent runtime from this repository, then create or manage a Farcaster account, set a profile, and post casts with the bundled Node.js scripts.
metadata: {"openclaw":{"always":true,"emoji":"🟣","homepage":"https://github.com/pierce403/farcaster-agent","requires":{"bins":["bash","git","node","npm"],"env":["PRIVATE_KEY","SIGNER_PRIVATE_KEY","FID","FARCASTER_CREDENTIALS_PATH"]}}}
---

# Farcaster Agent

This skill uses the Node.js code from the repository at `https://github.com/pierce403/farcaster-agent`.

Before running any runtime command, bootstrap the repo into `{baseDir}/runtime/farcaster-agent`:

```bash
bash {baseDir}/scripts/install-runtime.sh {baseDir}
```

Do not assume `../src` exists relative to the skill; always use the runtime path below after bootstrapping.

## When to Use This Skill

Use this skill when you need to:
- create a Farcaster account from a funded wallet
- add a signer key for casting
- post casts from an existing Farcaster account
- set a username, display name, bio, or profile picture

## Runtime Layout

After bootstrapping:
- runtime repo: `{baseDir}/runtime/farcaster-agent`
- commands below assume: `cd {baseDir}/runtime/farcaster-agent`

## Security Rules

- Use a dedicated low-value wallet. Do not reuse a treasury or long-lived identity wallet.
- Treat `PRIVATE_KEY` and `SIGNER_PRIVATE_KEY` as secrets. Pass them inline for a single command instead of exporting them in a shell profile.
- Default to `--no-save`. Credential persistence writes plaintext JSON with restrictive file permissions, but it is still not encrypted.
- Only opt into persistence if the operator explicitly wants local storage and provides a safe path, for example `FARCASTER_CREDENTIALS_PATH=/secure/location/farcaster-credentials.json`.

## Prerequisites

- `node`, `npm`, and `git`
- approximately `$1` of ETH or USDC on Ethereum, Optimism, Base, Arbitrum, or Polygon

## Create a New Farcaster Account

### 1. Generate a wallet

Run this from the runtime repo after bootstrapping:

```bash
cd {baseDir}/runtime/farcaster-agent
node -e "const { Wallet } = require('ethers'); const w = Wallet.createRandom(); console.log('Address:', w.address); console.log('Private Key:', w.privateKey);"
```

Ask the human to fund that address with about `$1` of ETH or USDC on one supported chain.

### 2. Run setup without writing credentials to disk

```bash
cd {baseDir}/runtime/farcaster-agent
PRIVATE_KEY=0x... node src/auto-setup.js "Your first cast text" --no-save
```

This flow:
1. checks balances across supported chains
2. bridges or swaps as needed
3. registers the FID
4. adds a signer key
5. waits for hub synchronization
6. posts the first cast

Capture the printed `FID` and signer key securely if you choose not to save them locally.

### 3. Optional: persist credentials intentionally

Only do this if the operator explicitly accepts plaintext local storage.

```bash
cd {baseDir}/runtime/farcaster-agent
PRIVATE_KEY=0x... FARCASTER_CREDENTIALS_PATH=/secure/location/farcaster-credentials.json node src/auto-setup.js "Your first cast text"
```

The runtime writes JSON with `0600` permissions, but the file is still plaintext. A stolen file is enough to control the wallet and Farcaster account.

## Post Casts With Existing Credentials

If you already have a custody key, signer key, and FID:

```bash
cd {baseDir}/runtime/farcaster-agent
PRIVATE_KEY=0x... SIGNER_PRIVATE_KEY=... FID=123 node src/post-cast.js "Your cast content"
```

## Set Username and Profile

```bash
cd {baseDir}/runtime/farcaster-agent
PRIVATE_KEY=0x... SIGNER_PRIVATE_KEY=... FID=123 npm run profile myusername "Display Name" "My bio" "https://example.com/pfp.png"
```

Username rules:
- lowercase letters, numbers, and hyphens only
- cannot start with a hyphen
- 1-16 characters
- only one fname per account

## Inspect Stored Credentials

Only relevant if the operator chose plaintext persistence.

```bash
cd {baseDir}/runtime/farcaster-agent

node src/credentials.js list
node src/credentials.js get
node src/credentials.js path
```

Set `FARCASTER_CREDENTIALS_PATH` for these commands too if the credentials file is stored somewhere non-default.

## Manual Recovery Flow

If `auto-setup` fails partway through, run the steps separately:

```bash
cd {baseDir}/runtime/farcaster-agent

PRIVATE_KEY=0x... node src/register-fid.js
PRIVATE_KEY=0x... node src/add-signer.js
PRIVATE_KEY=0x... node src/swap-to-usdc.js
PRIVATE_KEY=0x... SIGNER_PRIVATE_KEY=... FID=123 node src/post-cast.js "Hello!"
PRIVATE_KEY=0x... SIGNER_PRIVATE_KEY=... FID=123 npm run profile username "Name" "Bio" "https://example.com/pfp.png"
```

## Common Errors

### "invalid hash"

The runtime depends on `@farcaster/hub-nodejs` `0.15.9+`. Re-run the install step if the local dependency graph is stale.

### "unknown fid"

The hub has not indexed the new FID or signer yet. Wait 30-60 seconds and retry.

### "fname is not registered for fid"

The fname registry update has not propagated yet. Wait briefly and retry the profile command.

## Additional References

After installation, use these repo files only when needed:
- `{baseDir}/runtime/farcaster-agent/AGENT_GUIDE.md` for protocol details and deeper implementation notes
- `{baseDir}/runtime/farcaster-agent/agent-service/` for the optional webhook and cron-based autonomous agent service
