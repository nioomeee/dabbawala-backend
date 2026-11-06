/**
 * Hedera Client - connects to Hedera via Hiero SDK.
 *
 * Ref: R-HE-5 (Hiero SDK docs), R-HE-6 (Mirror Node API)
 *
 * Note: Using @hashgraph/sdk version 2.x (Hiero SDK) with updated API.
 */

import { Client, PrivateKey, AccountId } from "@hashgraph/sdk";

export interface HederaClientConfig {
  network: "hedera:testnet" | "hedera:mainnet";
  operatorAccountId: string; // e.g., "0.0.12345678"
  operatorPrivateKey: string; // DER-encoded PEM or raw key
  mirrorNodeUrl?: string;
}

/**
 * Build a NEW Hedera SDK client from validated config.
 * Returns a fresh client instance each call (no global singleton).
 */
export function buildHederaClient(config: HederaClientConfig): Client {
  const client = config.network === "hedera:mainnet"
    ? Client.forMainnet()
    : Client.forTestnet();

  const operatorId = AccountId.fromString(config.operatorAccountId);
  const operatorKey = parseHederaPrivateKey(config.operatorPrivateKey);
  client.setOperator(operatorId, operatorKey);

  return client;
}

/** Validate a Hedera account ID format: "0.0.12345678" */
export function isValidAccountId(id: string): boolean {
  try {
    AccountId.fromString(id);
    return true;
  } catch {
    return false;
  }
}

/** Validate a Hedera private key format */
export function isValidPrivateKey(key: string): boolean {
  try {
    PrivateKey.fromString(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a Hedera private key. The key in .env is a raw 32-byte ECDSA hex key.
 * We must use fromStringECDSA for raw keys, not fromString (which expects DER).
 */
export function parseHederaPrivateKey(key: string): any {
  try {
    return PrivateKey.fromStringECDSA(key);
  } catch {
    // Fallback to fromString for DER/PEM formats
    return PrivateKey.fromString(key);
  }
}