/**
 * Real ENSv2 policy reader — the viem RPC read path.
 *
 * Reads the Dabbawala text records (zones / budget / status / last-episode /
 * hedera-account) from each robot's Permissioned Resolver through the
 * universal `resolve(bytes name, bytes data)` profile, validates every record
 * with zod at the boundary (AGENTS.md §8), stamps the result with the source
 * block number + hash, and fails closed: ANY transport, shape or schema error
 * throws `ENS_UNREADABLE: ...` so callers return 503 and grant no authority
 * (invariant §4.3.3).
 *
 * Scope (deliberate): this reader implements the application-layer port
 * `IPolicyReader` (readPolicy → PolicySnapshot) only. The passport's `owner`
 * field lives in the ENS Permissioned Registry (R-ENS-4) whose deployment
 * addresses are not yet available (REFERENCES.md §8 PASTE_HERE); until the
 * S-ENS spike goes live, `GET /v1/robots/:id/passport` keeps the sim stub.
 * No address, ABI or field shape is invented here: the ABI mirrors our local
 * replica contract (contracts/src/resolver/PermissionedResolver.sol) which was
 * verified against the ENSv2 docs (R-ENS-2, R-ENS-7, F7, F8, F9).
 *
 * ref: ROADMAP §4.7 (readPolicy port), §4.3 invariants 3/5; ENSv2_implementation.md
 * §Read Policy Schema (frozen D4); AGENTS.md §8; applications/ports/policy-reader
 */

import { z } from "zod";
import { createHash } from "node:crypto";
import {
  createPublicClient,
  decodeAbiParameters,
  encodeFunctionData,
  http,
  isAddress,
  zeroHash,
} from "viem";
import { packetToBytes } from "viem/ens";
import { sepolia } from "viem/chains";
import { toHex } from "viem";
import type { Config } from "@dabbawala/config";
import {
  ENS_RECORD_KEYS,
  PolicySnapshotSchema,
  PolicyReadError,
  ROBOT_ENS_NAMES,
  ROBOT_IDS,
  type PolicySnapshot,
  type RobotId,
} from "@dabbawala/shared";
import type { IPolicyReader } from "@dabbawala/application";
import { createLogger } from "@dabbawala/observability";

const log = createLogger("adapter:ens-reader");

// ── ABI (mirrors contracts/src/resolver/PermissionedResolver.sol, VERIFIED) ──

const RESOLVE_ABI = [
  {
    type: "function",
    name: "resolve",
    stateMutability: "view",
    inputs: [
      { type: "bytes", name: "name" },
      { type: "bytes", name: "data" },
    ],
    outputs: [{ type: "bytes", name: "result" }],
  },
] as const;

/** The `text(bytes32 node, string key)` selector the resolver executes via
 * resolve(); the node argument is a placeholder because the resolver derives
 * the record from the DNS `name` argument (mirrors contracts helpers
 * textProfile, VERIFIED against the replica contract). */
const TEXT_PROFILE_ABI = [
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { type: "bytes32", name: "node" },
      { type: "string", name: "key" },
    ],
    outputs: [{ type: "string", name: "value" }],
  },
] as const;

// ── DNS wire format + text profile (viem equivalents of contracts helpers) ──

/** DNS wire format for a dot-separated ENS name (viem packetToBytes). */
export function dnsEncodeName(name: string): `0x${string}` {
  return toHex(packetToBytes(name));
}

/** resolve() profile calldata for the text(bytes32,string) selector. */
export function textRecordProfile(key: string): `0x${string}` {
  return encodeFunctionData({
    abi: TEXT_PROFILE_ABI,
    functionName: "text",
    args: [zeroHash, key],
  });
}

// ── Narrow client port (the only chain surface the reader depends on) ───────

/** Minimal contract-reading surface. Keeping this narrow lets unit tests
 * inject a fake client with zero mocking of viem internals. All failure
 * modes are thrown by the concrete transport — the reader never catches
 * transport errors; it converts them to ENS_UNREADABLE at its own edge. */
export interface EnsPolicyClient {
  /** Universal-resolver read: returns the raw abi-encoded payload. */
  readResolver(
    resolver: `0x${string}`,
    nameWire: `0x${string}`,
    profile: `0x${string}`,
  ): Promise<`0x${string}`>;
  /** Current block number of the policy source chain. */
  getBlockNumber(): Promise<bigint>;
  /** Block header for a fetched number (hash needed for provenance). */
  getBlockHeader(blockNumber: bigint): Promise<{ number: bigint; hash: `0x${string}` }>;
}

/**
 * Build a viem HTTP client bound to Sepolia. Only Sepolia is supported: the
 * chain object must match the configured chain id, otherwise this factory
 * fails (config error, not a runtime read error).
 */
export function createViemPolicyClient(input: {
  rpcUrl: string;
  chainId: number;
}): { ok: true; client: EnsPolicyClient } | { ok: false; error: string } {
  if (input.chainId !== sepolia.id) {
    return {
      ok: false,
      error: `ENS chain id ${input.chainId} is not supported — expected Sepolia (${sepolia.id})`,
    };
  }
  const client = createPublicClient({ chain: sepolia, transport: http(input.rpcUrl) });
  return {
    ok: true,
    client: {
      async readResolver(resolver, nameWire, profile) {
        return client.readContract({
          address: resolver,
          abi: RESOLVE_ABI,
          functionName: "resolve",
          args: [nameWire, profile],
        });
      },
      async getBlockNumber() {
        return client.getBlockNumber();
      },
      async getBlockHeader(blockNumber) {
        const block = await client.getBlock({ blockNumber });
        return { number: block.number, hash: block.hash };
      },
    },
  };
}

// ── Record schemas (zod at the boundary, AGENTS.md §8) ──────────────────────
// All text records come as strings from ENS. Zones is stored as JSON-encoded
// array; budget as numeric string; status as enum.

const ZONES_RECORD_SCHEMA = z.array(z.string());
const BUDGET_RECORD_SCHEMA = z.string().regex(/^\d+$/, "budget must be a non-negative integer string");
const STATUS_RECORD_SCHEMA = z.enum(["active", "paused"]);

// ── Reader ──────────────────────────────────────────────────────────────────

/** Result type the factory returns ({ ok } pattern, AGENTS.md §8). */
export type EnsPolicyReaderResult =
  | { ok: true; reader: EnsPolicyReader }
  | { ok: false; error: string };

/** Error class implementing PolicyReadError with readonly properties. Callers
 * map code ENS_UNREADABLE to 503. The error message itself starts with the
 * code so existing catch-and-log patterns keep working. */
class PolicyReadErrorImpl extends Error implements PolicyReadError {
  readonly code = "ENS_UNREADABLE" as const;
  readonly detail: string;
  readonly retryable: boolean;

  constructor(detail: string, retryable = false) {
    super(`ENS_UNREADABLE: ${detail}`);
    this.detail = detail;
    this.retryable = retryable;
    this.name = "PolicyReadError";
  }
}

function policyReadError(detail: string, retryable = false): Error & PolicyReadError {
  return new PolicyReadErrorImpl(detail, retryable) as Error & PolicyReadError;
}

export class EnsPolicyReader implements IPolicyReader {
  private readonly client: EnsPolicyClient;
  private readonly resolvers: Record<RobotId, `0x${string}`>;

  constructor(client: EnsPolicyClient, resolvers: Record<RobotId, string>) {
    this.client = client;
    this.resolvers = Object.fromEntries(
      ROBOT_IDS.map((robotId) => [robotId, resolvers[robotId] as `0x${string}`]),
    ) as Record<RobotId, `0x${string}`>;
  }

  /**
   * Block-stamped PolicySnapshot. Any transport / contract / schema failure
   * throws a structured PolicyReadError with code ENS_UNREADABLE (invariant
   * §4.3.3 — no cached body, no substitute decision, no default moves).
   */
  async readPolicy(robotId: RobotId): Promise<PolicySnapshot> {
    const name = ROBOT_ENS_NAMES[robotId];
    const resolver = this.resolvers[robotId];
    const nameWire = dnsEncodeName(name);

    try {
      // Read the stamp BEFORE the records: the records observed are then
      // guaranteed to reflect the chain at block >= the stamp block. The 15 s
      // staleness rule (invariant §4.3.11/12) is consumer-side, from readAtMs.
      const blockNumber = await this.client.getBlockNumber();
      const header = await this.client.getBlockHeader(blockNumber);

      const rawZones = await this.readText(resolver, nameWire, ENS_RECORD_KEYS.ZONES);
      const rawBudget = await this.readText(resolver, nameWire, ENS_RECORD_KEYS.BUDGET);
      const rawStatus = await this.readText(resolver, nameWire, ENS_RECORD_KEYS.STATUS);
      const rawLastEpisode = await this.readText(resolver, nameWire, ENS_RECORD_KEYS.LAST_EPISODE);
      const rawHederaAccount = await this.readText(resolver, nameWire, ENS_RECORD_KEYS.HEDERA_ACCOUNT);

      const zones = this.parseRecord(robotId, ENS_RECORD_KEYS.ZONES, JSON.parse(rawZones), ZONES_RECORD_SCHEMA);
      const budgetAtomic = this.parseRecord(robotId, ENS_RECORD_KEYS.BUDGET, rawBudget, BUDGET_RECORD_SCHEMA);
      const status = this.parseRecord(robotId, ENS_RECORD_KEYS.STATUS, rawStatus, STATUS_RECORD_SCHEMA);

      // last-episode / hedera-account are advisory (ROADMAP §4.4): empty or
      // missing records are absent values, never a fail-closed condition.
      const lastEpisode = rawLastEpisode.length > 0 ? rawLastEpisode : null;
      const hederaAccount = rawHederaAccount.length > 0 ? rawHederaAccount : null;

      // Canonical values hash — SAME layout as the stub adapter
      // { robotId, zones, budgetAtomic, status, lastEpisode, blockNumber,
      // blockHash } so consumers see one provenance identity whichever source
      // answered. Advisory records are part of the hash even when null so the
      // hash is stable across a safety-officer pause flip.
      const valuesSource = JSON.stringify({
        robotId,
        zones: [...zones],
        budgetAtomic,
        status,
        lastEpisode,
        hederaAccount,
        blockNumber: Number(header.number),
        blockHash: header.hash,
      });
      const valuesHash = createHash("sha256").update(valuesSource, "utf8").digest("hex");

      const draft: PolicySnapshot = {
        robotId,
        zones,
        budgetAtomic,
        status,
        block: header.number,
        valuesHash,
        readAtMs: Date.now(),
      };

      const parsed = PolicySnapshotSchema.safeParse(draft);
      if (!parsed.success) {
        log.error({ robotId, issues: parsed.error.issues.length }, "ENS policy snapshot failed schema validation");
        throw policyReadError(`${robotId} policy snapshot failed schema validation`);
      }

      log.debug(
        { robotId, block: header.number.toString(), status, budgetAtomic },
        "ENS policy snapshot read",
      );
      return parsed.data;
    } catch (err: unknown) {
      if (err instanceof Error && (err as Error & PolicyReadError).code === "ENS_UNREADABLE") throw err;
      const detail = err instanceof Error ? err.message : String(err);
      log.error({ robotId, detail }, "ENS policy read failed — failing closed");
      throw policyReadError(detail);
    }
  }

  /** One text record via resolve(). Returns "" for a missing record. */
  private async readText(
    resolver: `0x${string}`,
    nameWire: `0x${string}`,
    key: string,
  ): Promise<string> {
    const raw = await this.client.readResolver(resolver, nameWire, textRecordProfile(key));
    const decoded = decodeAbiParameters([{ type: "string" }], raw);
    return decoded[0] ?? "";
  }

  /** Boundary check on one record value. Never invents a fallback value. */
  private parseRecord<T>(
    robotId: RobotId,
    key: string,
    raw: string,
    schema: z.ZodType<T>,
  ): T {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const detail = `${key} record failed validation: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`;
      log.error({ robotId, key, detail }, "ENS record failed boundary validation");
      throw policyReadError(`${robotId} ${detail}`);
    }
    return parsed.data;
  }
}

// ── Wiring for the app layer ────────────────────────────────────────────────

/**
 * Build the reader from the typed config. Returns { ok: false } (NOT an
 * error) when the Sepolia ENS env is not filled in yet: the S-ENS spike owns
 * the deployment addresses (REFERENCES.md §8). The sim stub stays the
 * fail-safe source until then. Forge-verified addresses (isAddress) only.
 */
export function createEnsPolicyReader(config: Config): EnsPolicyReaderResult {
  if (
    config.SEPOLIA_RPC_URL === undefined ||
    config.ENS_ROBOT_RAMU_RESOLVER === undefined ||
    config.ENS_ROBOT_SAKHU_RESOLVER === undefined ||
    config.ENS_ROBOT_JANU_RESOLVER === undefined
  ) {
    return {
      ok: false,
      error:
        "SEPOLIA_RPC_URL / ENS_ROBOT_*_RESOLVER env vars not set — ENS policy source stays sim (stub)",
    };
  }

  const clientRes = createViemPolicyClient({
    rpcUrl: config.SEPOLIA_RPC_URL,
    chainId: config.SEPOLIA_CHAIN_ID,
  });
  if (!clientRes.ok) return clientRes;

  const resolvers = {
    ramu: config.ENS_ROBOT_RAMU_RESOLVER,
    sakhu: config.ENS_ROBOT_SAKHU_RESOLVER,
    janu: config.ENS_ROBOT_JANU_RESOLVER,
  } as const;

  for (const robotId of ROBOT_IDS) {
    const addr = resolvers[robotId];
    if (!isAddress(addr)) {
      return {
        ok: false,
        error: `ENS_ROBOT_${robotId.toUpperCase()}_RESOLVER is not a valid address`,
      };
    }
  }

  return { ok: true, reader: new EnsPolicyReader(clientRes.client, resolvers) };
}
