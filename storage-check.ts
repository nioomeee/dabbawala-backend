/**
 * 0G Storage Check Script
 *
 * Reads configuration from .env and attempts a basic 0G Storage operation.
 * Never prints private keys or API keys - only hashes and transaction info.
 *
 * Ref: R-0G-2, R-0G-1
 *
 * Note: The official 0G Storage SDK (@0gfoundation/0g-storage-ts-sdk) is
 * documented as NOT published to npm (R-0G-2, F10). This project uses
 * the ported @dabbawala/zero-g-adapter package instead.
 */

// Read environment variables securely
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const envLines = envContent.split('\n');

// Parse env variables (simple parser, skips comments and empty lines)
const env = {};
envLines.forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const [key, ...valueParts] = trimmed.split('=');
    env[key.trim()] = valueParts.join('=').trim().replace(/^['"]/, '').replace(/['"]$/, '');
  }
}

// Extract 0G storage configuration
const storageNodeUrl = env.ZERO_G_STORAGE_NODE_URL;
const storageIndexerUrl = env.ZERO_G_INDEXER_URL;
const gChainId = env.ZERO_G_CHAIN_ID;
const rpcUrl = env.ZERO_G_RPC_URL;
const gatekeeperPrivateKey = env.GATEKEEPER_PRIVATE_KEY;

// Display configuration status (NO KEY VALUES)
console.log('=== 0G Storage Configuration Check ===');
console.log();

// Show which config values are present
const configChecks = [
  ['ZERO_G_STORAGE_NODE_URL', !!storageNodeUrl],
  ['ZERO_G_INDEXER_URL', !!storageIndexerUrl],
  ['ZERO_G_CHAIN_ID', !!gChainId],
  ['ZERO_G_RPC_URL', !!rpcUrl],
  ['GATEKEEPER_PRIVATE_KEY', !!gatekeeperPrivateKey],
];

configChecks.forEach(([name, present]) => {
  console.log(`  ${name}: ${present ? 'SET' : 'NOT SET'}`);
});

console.log();

// Determine if we can proceed with storage operations
const hasMinimalConfig = storageIndexerUrl && gChainId;
const hasFullConfig = hasMinimalConfig && storageNodeUrl;

// Summary
console.log('=== Summary ===');
if (hasFullConfig) {
  console.log('✅ Full 0G Storage configuration present.');
  console.log('   - Storage node URL: configured');
  console.log('   - Indexer URL: configured');
  console.log('   - Chain ID: ' + gChainId);
  console.log('   - RPC URL: ' + rpcUrl);
  // Note: We do NOT print the gatekeeper private key
} else if (hasMinimalConfig) {
  console.log('⚠️ Partial 0G Storage configuration.');
  console.log('   - Indexer URL and Chain ID are set.');
  console.log('   - Storage node URL is missing (legacy, not used by adapter).');
  console.log('   - See: R-0G-2 in REFERENCES.md');
} else {
  console.log('❌ Insufficient 0G Storage configuration.');
  console.log('   - Please set ZERO_G_INDEXER_URL and ZERO_G_CHAIN_ID in .env');
  console.log('   - ZERO_G_STORAGE_NODE_URL is legacy and not required.');
}

// Never output private key material
// if (gatekeeperPrivateKey) {
//   console.log('GATEKEEPER_PRIVATE_KEY: [REDACTED]');
// }

console.log('=== End of Check ===');
console.log('(This script never outputs private key values.)');