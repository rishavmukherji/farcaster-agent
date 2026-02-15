const fs = require('fs');
const path = require('path');
const os = require('os');

// Default credential storage locations
const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
const CREDENTIALS_FILENAME = 'farcaster-credentials.json';

/**
 * Get the credentials file path
 * Priority: 1) OpenClaw dir if exists, 2) Local ./credentials.json
 */
function getCredentialsPath() {
  // If running in OpenClaw environment, use ~/.openclaw/
  if (fs.existsSync(OPENCLAW_DIR)) {
    return path.join(OPENCLAW_DIR, CREDENTIALS_FILENAME);
  }
  // Otherwise use local directory
  return path.join(process.cwd(), 'credentials.json');
}

/**
 * Save Farcaster credentials to persistent storage
 *
 * @param {Object} credentials
 * @param {string} credentials.fid - Farcaster ID
 * @param {string} credentials.custodyAddress - Ethereum wallet address
 * @param {string} credentials.custodyPrivateKey - Ethereum wallet private key
 * @param {string} credentials.signerPublicKey - Ed25519 signer public key (hex)
 * @param {string} credentials.signerPrivateKey - Ed25519 signer private key (hex)
 * @param {string} [credentials.fname] - Username if registered
 * @param {Object} [options]
 * @param {string} [options.path] - Custom path to save credentials
 */
function saveCredentials(credentials, options = {}) {
  const filePath = options.path || getCredentialsPath();
  const dir = path.dirname(filePath);

  // Create directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Load existing credentials if any (to support multiple accounts)
  let existing = {};
  if (fs.existsSync(filePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      // File exists but invalid JSON, start fresh
    }
  }

  // Store by FID for easy lookup
  const fid = credentials.fid.toString();
  existing[fid] = {
    fid,
    custodyAddress: credentials.custodyAddress,
    custodyPrivateKey: credentials.custodyPrivateKey,
    signerPublicKey: credentials.signerPublicKey,
    signerPrivateKey: credentials.signerPrivateKey,
    fname: credentials.fname || null,
    createdAt: credentials.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // Also track the "active" account (most recently created/used)
  existing._active = fid;

  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), { mode: 0o600 });

  console.log('Credentials saved to:', filePath);
  return filePath;
}

/**
 * Load Farcaster credentials from storage
 *
 * @param {Object} [options]
 * @param {string} [options.fid] - Specific FID to load (defaults to active account)
 * @param {string} [options.path] - Custom path to load credentials from
 * @returns {Object|null} Credentials object or null if not found
 */
function loadCredentials(options = {}) {
  const filePath = options.path || getCredentialsPath();

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // If specific FID requested
    if (options.fid) {
      return data[options.fid.toString()] || null;
    }

    // Return active account
    if (data._active && data[data._active]) {
      return data[data._active];
    }

    // No active set, return first account found
    const fids = Object.keys(data).filter(k => k !== '_active');
    if (fids.length > 0) {
      return data[fids[0]];
    }

    return null;
  } catch (e) {
    console.error('Error loading credentials:', e.message);
    return null;
  }
}

/**
 * List all stored Farcaster accounts
 *
 * @param {Object} [options]
 * @param {string} [options.path] - Custom path to load credentials from
 * @returns {Array} Array of account summaries
 */
function listCredentials(options = {}) {
  const filePath = options.path || getCredentialsPath();

  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const activeId = data._active;

    return Object.keys(data)
      .filter(k => k !== '_active')
      .map(fid => ({
        fid,
        fname: data[fid].fname,
        custodyAddress: data[fid].custodyAddress,
        isActive: fid === activeId,
        createdAt: data[fid].createdAt
      }));
  } catch (e) {
    return [];
  }
}

/**
 * Set the active Farcaster account
 *
 * @param {string} fid - FID to set as active
 * @param {Object} [options]
 * @param {string} [options.path] - Custom path
 */
function setActiveAccount(fid, options = {}) {
  const filePath = options.path || getCredentialsPath();

  if (!fs.existsSync(filePath)) {
    throw new Error('No credentials file found');
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (!data[fid.toString()]) {
    throw new Error(`No credentials found for FID ${fid}`);
  }

  data._active = fid.toString();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/**
 * Update credentials (e.g., add fname after registration)
 *
 * @param {string} fid - FID to update
 * @param {Object} updates - Fields to update
 * @param {Object} [options]
 * @param {string} [options.path] - Custom path
 */
function updateCredentials(fid, updates, options = {}) {
  const filePath = options.path || getCredentialsPath();

  if (!fs.existsSync(filePath)) {
    throw new Error('No credentials file found');
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const fidStr = fid.toString();

  if (!data[fidStr]) {
    throw new Error(`No credentials found for FID ${fid}`);
  }

  data[fidStr] = {
    ...data[fidStr],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
}

// CLI usage
if (require.main === module) {
  const command = process.argv[2];

  if (command === 'list') {
    const accounts = listCredentials();
    if (accounts.length === 0) {
      console.log('No credentials stored.');
    } else {
      console.log('Stored Farcaster accounts:');
      accounts.forEach(a => {
        const active = a.isActive ? ' (active)' : '';
        const fname = a.fname ? `@${a.fname}` : '(no fname)';
        console.log(`  FID ${a.fid} ${fname}${active}`);
        console.log(`    Address: ${a.custodyAddress}`);
      });
    }
  } else if (command === 'get') {
    const fid = process.argv[3];
    const creds = loadCredentials({ fid });
    if (creds) {
      console.log(JSON.stringify(creds, null, 2));
    } else {
      console.log('No credentials found');
    }
  } else if (command === 'path') {
    console.log(getCredentialsPath());
  } else {
    console.log('Usage:');
    console.log('  node credentials.js list          - List all stored accounts');
    console.log('  node credentials.js get [fid]     - Get credentials for FID (or active)');
    console.log('  node credentials.js path          - Show credentials file path');
  }
}

module.exports = {
  saveCredentials,
  loadCredentials,
  listCredentials,
  setActiveAccount,
  updateCredentials,
  getCredentialsPath
};
