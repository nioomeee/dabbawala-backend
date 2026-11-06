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

/** Global client instance */
let _client: Client | null = null;

/**
 * Build a Hedera SDK client from validated config.
 */
export function buildHederaClient(config: HederaClientConfig): Client {
  if (config.network === "hedera:mainnet") {
    _client = Client.forMainnet();
  } else {
    _client = Client.forTestnet();
  }

  const operatorId = AccountId.fromString(config.operatorAccountId);
  const operatorKey = PrivateKey.fromString(config.operatorPrivateKey);
  _client.setOperator(operatorId, operatorKey);

  return _client;
}

/** Get the current client or throw if not initialized */
export function getClient(): Client {
  if (!_client) {
    throw new Error("Hedera client not initialized. Call buildHederaClient first.");
  }
  return _client;
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