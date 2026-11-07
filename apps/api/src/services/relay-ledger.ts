/**
 * RelayLedger anchorer — viem-based 0G Galileo write adapter.
 *
 * Sends the real `anchor(bytes32 robotId, bytes32 episodeId, bytes32 rootHash)`
 * transaction to the deployed RelayLedger contract on 0G Galileo
 * (chain id 16602, RPC from ZERO_G_RPC_URL), waits for the receipt, then
 * verifies the anchored root by reading `roots(episodeId)` back from the
 * contract. This replaces the previously fabricated (`randomBytes`) anchor
 * receipt so every anchorTxId persisted is a genuine on-chain transaction.
 *
 * Fail-closed: construction throws if RELAY_LEDGER_ADDRESS,
 * RELAY_LEDGER_PRIVATE_KEY, ZERO_G_RPC_URL or ZERO_G_CHAIN_ID are missing or
 * malformed; app.ts decorates null and /v1/evidence/upload answers
 * 503 RELAY_LEDGER_UNCONFIGURED instead of inventing a receipt.
 * ref: ROADMAP.md §4.7 (RelayLedger), §4.3 invariant 3/4; AGENTS.md §7.
 *
 * ABI fragments are derived from the local contract source
 * contracts/src/RelayLedger.sol (deployment: forge create with the account
 * derived from RELAY_LEDGER_PRIVATE_KEY, which the contract stores as
 * `anchorer` at construction — only that account may call anchor()).
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isHash,
  keccak256,
  toHex,
  type Chain,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getConfig } from "@dabbawala/config";
import { createLogger } from "@dabbawala/observability";

const log = createLogger("services:relay-ledger");

// ── ABI fragments — only the three selectors we call (from RelayLedger.sol) ──

export const RELAY_LEDGER_ABI = [
  {
    type: "function",
    name: "anchor",
    inputs: [
      { name: "robotId", type: "bytes32" },
      { name: "episodeId", type: "bytes32" },
      { name: "rootHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getRoot",
    inputs: [{ name: "episodeId", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isAnchored",
    inputs: [{ name: "episodeId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

// ── Typed errors (never carry key material) ─────────────────────────────────

export type RelayLedgerErrorCode =
  | "RL_REJECTED"
  | "RL_RPC_ERROR"
  | "RL_ALREADY_ANCHORED"
  | "RL_VERIFY_FAILED";

export interface RelayLedgerError {
  readonly code: RelayLedgerErrorCode;
  readonly detail: string;
}

export interface AnchorReceipt {
  /** Real on-chain transaction hash of the anchor() call. */
  readonly txHash: Hash;
  readonly blockNumber: number;
  /** true when the contract read-back matches the submitted root. */
  readonly verified: boolean;
  readonly relayLedgerAddress: string;
}

export type AnchorResult =
  | { readonly ok: true; readonly receipt: AnchorReceipt }
  | { readonly ok: false; readonly error: RelayLedgerError };

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Deterministic bytes32 ids per the contract natspec: keccak256(utf8 string). */
export function bytes32FromString(input: string): `0x${string}` {
  return keccak256(toHex(input));
}

// ── The anchorer ────────────────────────────────────────────────────────────

export class RelayLedgerAnchorer {
  private readonly publicClient;
  private readonly walletClient;
  private readonly contractAddress: `0x${string}`;
  readonly contractAddressPublic: string;

  constructor() {
    const cfg = getConfig();

    const missing: string[] = [];
    if (!cfg.RELAY_LEDGER_ADDRESS) missing.push("RELAY_LEDGER_ADDRESS");
    if (!cfg.RELAY_LEDGER_PRIVATE_KEY) missing.push("RELAY_LEDGER_PRIVATE_KEY");
    if (!cfg.ZERO_G_RPC_URL) missing.push("ZERO_G_RPC_URL");
    if (cfg.ZERO_G_CHAIN_ID === undefined) missing.push("ZERO_G_CHAIN_ID");
    if (missing.length > 0) {
      throw new Error(`RelayLedgerAnchorer: missing config: ${missing.join(", ")}`);
    }

    const address = cfg.RELAY_LEDGER_ADDRESS!;
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new Error("RelayLedgerAnchorer: RELAY_LEDGER_ADDRESS is not a 20-byte hex address");
    }
    if (cfg.ZERO_G_CHAIN_ID! !== 16602) {
      throw new Error(
        "RelayLedgerAnchorer: ZERO_G_CHAIN_ID must be 16602 (0G Galileo, testnet-only invariant)",
      );
    }

    let account;
    try {
      account = privateKeyToAccount(cfg.RELAY_LEDGER_PRIVATE_KEY! as `0x${string}`);
    } catch {
      throw new Error("RelayLedgerAnchorer: RELAY_LEDGER_PRIVATE_KEY is not a valid 32-byte hex key");
    }

    const chain: Chain = defineChain({
      id: cfg.ZERO_G_CHAIN_ID!,
      name: "0G Galileo",
      nativeCurrency: { name: "A0GI", symbol: "A0GI", decimals: 18 },
      rpcUrls: { default: { http: [cfg.ZERO_G_RPC_URL!] } },
      testnet: true,
    });

    this.publicClient = createPublicClient({ chain, transport: http(cfg.ZERO_G_RPC_URL!) });
    this.walletClient = createWalletClient({ account, chain, transport: http(cfg.ZERO_G_RPC_URL!) });
    this.contractAddress = address as `0x${string}`;
    this.contractAddressPublic = address;
    // Never log the private key; the signer address is fine.
    log.info(
      { chainId: chain.id, contractAddress: address, signer: account.address },
      "RelayLedgerAnchorer initialised (live Galileo writes)",
    );
  }

  /** Read-only pre-check; true when the episode root already exists on-chain. */
  async isAnchored(episodeIdId32: `0x${string}`): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.contractAddress,
      abi: RELAY_LEDGER_ABI,
      functionName: "isAnchored",
      args: [episodeIdId32],
    });
  }

  /**
   * Anchor one episode root and verify by contract read-back.
   * Duplicate anchors fail closed with RL_ALREADY_ANCHORED (and are treated by
   * callers as a benign idempotent outcome when the root matches).
   */
  async anchorEpisode(params: {
    robotId: string;
    episodeId: string;
    rootHash: string;
  }): Promise<AnchorResult> {
    const { robotId, episodeId, rootHash } = params;

    if (typeof episodeId !== "string" || episodeId.length === 0 || episodeId.length > 64) {
      return {
        ok: false,
        error: { code: "RL_REJECTED", detail: `episodeId must be a 1..64 char string, got length ${String((episodeId as { length?: number }).length)}` },
      };
    }
    if (!isHash(rootHash) || rootHash.length !== 66) {
      return {
        ok: false,
        error: { code: "RL_REJECTED", detail: "rootHash must be a 0x-prefixed 32-byte hex hash" },
      };
    }

    const robotIdBytes = bytes32FromString(robotId);
    const episodeIdBytes = bytes32FromString(episodeId);

    let alreadyAnchored: boolean;
    try {
      alreadyAnchored = await this.isAnchored(episodeIdBytes);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      log.error({ episodeId, detail }, "RelayLedger pre-check read failed");
      return { ok: false, error: { code: "RL_RPC_ERROR", detail } };
    }
    if (alreadyAnchored) {
      return {
        ok: false,
        error: {
          code: "RL_ALREADY_ANCHORED",
          detail: `episode ${episodeId} is already anchored on RelayLedger`,
        },
      };
    }

    let txHash: Hash;
    try {
      txHash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: RELAY_LEDGER_ABI,
        functionName: "anchor",
        args: [robotIdBytes, episodeIdBytes, rootHash as `0x${string}`],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("AlreadyAnchored")) {
        return { ok: false, error: { code: "RL_ALREADY_ANCHORED", detail: message } };
      }
      log.error({ episodeId, detail: message }, "RelayLedger anchor() write failed");
      return { ok: false, error: { code: "RL_RPC_ERROR", detail: message } };
    }

    let receipt: { blockNumber: number | undefined };
    try {
      const r = await this.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
      receipt = { blockNumber: r.blockNumber === null ? undefined : Number(r.blockNumber) };
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      log.error({ episodeId, txHash, detail }, "RelayLedger receipt wait failed");
      return { ok: false, error: { code: "RL_RPC_ERROR", detail } };
    }

    // Verify by reading the stored root back from the contract.
    let anchoredRoot: `0x${string}`;
    try {
      anchoredRoot = await this.publicClient.readContract({
        address: this.contractAddress,
        abi: RELAY_LEDGER_ABI,
        functionName: "getRoot",
        args: [episodeIdBytes],
      });
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      log.error({ episodeId, txHash, detail }, "RelayLedger read-back failed");
      return { ok: false, error: { code: "RL_RPC_ERROR", detail } };
    }

    const verified = anchoredRoot.toLowerCase() === rootHash.toLowerCase();
    if (!verified) {
      log.error(
        { episodeId, expected: rootHash, anchored: anchoredRoot },
        "RelayLedger read-back mismatch — failing closed",
      );
      return { ok: false, error: { code: "RL_VERIFY_FAILED", detail: "anchored root mismatch" } };
    }

    const anchorReceipt: AnchorReceipt = {
      txHash,
      blockNumber: receipt.blockNumber ?? -1,
      verified,
      relayLedgerAddress: this.contractAddressPublic,
    };
    log.info(
      { episodeId, txHash, blockNumber: anchorReceipt.blockNumber, contract: anchorReceipt.relayLedgerAddress },
      "Episode root anchored and verified on RelayLedger",
    );
    return { ok: true, receipt: anchorReceipt };
  }
}

/** True when all RelayLedger env vars are present and well-formed. */
export function isRelayLedgerConfigured(): boolean {
  try {
    const cfg = getConfig();
    return !!(
      cfg.RELAY_LEDGER_ADDRESS &&
      /^0x[0-9a-fA-F]{40}$/.test(cfg.RELAY_LEDGER_ADDRESS) &&
      cfg.RELAY_LEDGER_PRIVATE_KEY &&
      cfg.ZERO_G_RPC_URL &&
      cfg.ZERO_G_CHAIN_ID === 16602
    );
  } catch {
    return false;
  }
}
