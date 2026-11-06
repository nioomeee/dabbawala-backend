/**
 * Live ENSv2 Policy Reader — viem-based Sepolia adapter.
 *
 * Implements IPolicyReader by calling resolve() on each robot's
 * PermissionedResolver proxy on Sepolia (chain 11155111).
 *
 * Uses viem v2 readContract with the ENSv2 resolve(bytes,bytes) profile
 * dispatch (ref: R-ENS-7, R-ENS-2).  DNS encoding via viem/ens packetToBytes.
 *
 * Fail-closed: any RPC, decoding or schema failure throws PolicyReadError;
 * the caller must return 503 ENS_UNREADABLE. Never return a default-open
 * snapshot. ref: ENSv2_implementation.md §4.3, invariant §4.3.3
 *
 * This adapter is instantiated only when SEPOLIA_RPC_URL and
 * ENS_ROBOT_*_RESOLVER are all configured.  Missing config → throw at
 * construction time so the API startup check catches it.
 */

import { createPublicClient, http, keccak256, toHex, encodeFunctionData, decodeFunctionResult } from "viem";
import { sepolia } from "viem/chains";
import { packetToBytes } from "viem/ens";

import {
  ENS_RECORD_KEYS,
  ROBOT_ENS_NAMES,
  ROBOT_IDS,
  type RobotId,
  type PolicySnapshot,
  type PolicyReadError,
} from "@dabbawala/shared";
import type { IPolicyReader } from "@dabbawala/application";
import { createLogger } from "@dabbawala/observability";
import { getConfig } from "@dabbawala/config";

const log = createLogger("adapter:viem-ens-reader");

// ── ABI fragments — only the two selectors we call ──────────────────────────

/**
 * resolve(bytes name, bytes data) → bytes
 * ref: R-ENS-7 (ENSv2 PermissionedResolver public read path)
 */
const RESOLVE_ABI = [
  {
    type: "function",
    name: "resolve",
    inputs: [
      { name: "name", type: "bytes" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes" }],
    stateMutability: "view",
  },
] as const;

/**
 * text(bytes32 node, string key) — the profile selector used inside resolve().
 * We pass ZeroHash as node because the resolver derives it from the name arg.
 * ref: R-ENS-7 (profile dispatch, text selector)
 */
const TEXT_PROFILE_ABI = [
  {
    type: "function",
    name: "text",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** DNS wire-format encoding via viem/ens. ref: R-ENS-7, test helpers.ts */
function dnsEncodeBytes(name: string): `0x${string}` {
  return toHex(packetToBytes(name));
}

/**
 * Build the profile calldata for text(ZeroHash, key).
 * resolve() uses profile dispatch: the first 4 bytes of data determine
 * which record getter to invoke.  ref: R-ENS-7
 */
function textProfileData(key: string): `0x${string}` {
  return encodeFunctionData({
    abi: TEXT_PROFILE_ABI,
    functionName: "text",
    args: ["0x0000000000000000000000000000000000000000000000000000000000000000", key],
  });
}

/**
 * Decode the ABI-encoded string returned by resolve().
 * The resolver abi.encodes the return value of the inner getter.
 * ref: R-ENS-7, helpers.ts decodeText()
 */
function decodeResolveText(raw: `0x${string}`): string {
  const decoded = decodeFunctionResult({
    abi: TEXT_PROFILE_ABI,
    functionName: "text",
    data: raw,
  });
  return decoded as string;
}

/** Stable keccak256 of the concatenated text record values. ref: ROADMAP §4.3.12 */
function computeValuesHash(values: readonly string[]): string {
  const encoded = values.join("\0"); // null-separated concatenation
  return keccak256(toHex(new TextEncoder().encode(encoded)));
}

// ── Resolver address map ─────────────────────────────────────────────────────

type ResolverMap = Readonly<Record<RobotId, `0x${string}`>>;

function buildResolverMap(cfg: ReturnType<typeof getConfig>): ResolverMap {
  const missing: string[] = [];
  const ramuAddr = cfg.ENS_ROBOT_RAMU_RESOLVER;
  const sakhuAddr = cfg.ENS_ROBOT_SAKHU_RESOLVER;
  const januAddr = cfg.ENS_ROBOT_JANU_RESOLVER;

  if (!ramuAddr) missing.push("ENS_ROBOT_RAMU_RESOLVER");
  if (!sakhuAddr) missing.push("ENS_ROBOT_SAKHU_RESOLVER");
  if (!januAddr) missing.push("ENS_ROBOT_JANU_RESOLVER");

  if (missing.length > 0) {
    throw new Error(`ViemEnsReader: missing resolver config: ${missing.join(", ")}`);
  }

  return {
    ramu: ramuAddr as `0x${string}`,
    sakhu: sakhuAddr as `0x${string}`,
    janu: januAddr as `0x${string}`,
  };
}

// ── The reader ───────────────────────────────────────────────────────────────

/**
 * Reads live ENSv2 text records from each robot's PermissionedResolver proxy
 * on Ethereum Sepolia and validates the result against PolicySnapshot.
 *
 * Construction throws if any required env var is absent; callers must catch
 * and handle the "not_configured" case at startup.
 *
 * ref: ENSv2_implementation.md §3, ROADMAP §4.9, IPolicyReader
 */
export class ViemEnsReader implements IPolicyReader {
  private readonly client;
  private readonly resolvers: ResolverMap;

  constructor() {
    const cfg = getConfig();

    if (!cfg.SEPOLIA_RPC_URL) {
      throw new Error("ViemEnsReader: SEPOLIA_RPC_URL is not configured");
    }

    this.client = createPublicClient({
      chain: sepolia,
      transport: http(cfg.SEPOLIA_RPC_URL),
    });

    this.resolvers = buildResolverMap(cfg);
    log.info({ robots: ROBOT_IDS }, "ViemEnsReader initialised (live Sepolia reads)");
  }

  async readPolicy(robotId: RobotId): Promise<PolicySnapshot> {
    const resolverAddress = this.resolvers[robotId];
    const ensName = ROBOT_ENS_NAMES[robotId];
    const readAtMs = Date.now();

    log.debug({ robotId, resolverAddress, ensName }, "ENS read started");

    try {
      // Read the five policy-relevant text records in parallel.
      // If any single read throws we propagate as a PolicyReadError.
      const nameBytes = dnsEncodeBytes(ensName);

      const [zonesRaw, budgetRaw, statusRaw, lastEpisodeRaw] = await Promise.all([
        this._readText(resolverAddress, nameBytes, ENS_RECORD_KEYS.ZONES),
        this._readText(resolverAddress, nameBytes, ENS_RECORD_KEYS.BUDGET),
        this._readText(resolverAddress, nameBytes, ENS_RECORD_KEYS.STATUS),
        this._readText(resolverAddress, nameBytes, ENS_RECORD_KEYS.LAST_EPISODE).catch(() => ""),
      ]);

      // Validate / parse zones
      let zones: string[];
      try {
        const parsed: unknown = JSON.parse(zonesRaw || "[]");
        if (!Array.isArray(parsed) || !parsed.every((z) => typeof z === "string")) {
          throw new Error("zones is not string[]");
        }
        zones = parsed as string[];
      } catch (e) {
        throw this._readError(
          "ENS_MALFORMED",
          `zones record for ${robotId} is not a JSON string array: ${zonesRaw}`,
          false,
        );
      }

      // Validate budget
      if (!/^\d+$/.test(budgetRaw || "")) {
        throw this._readError(
          "ENS_MALFORMED",
          `budget record for ${robotId} is not a non-negative integer: ${budgetRaw}`,
          false,
        );
      }
      const budgetAtomic = budgetRaw!;

      // Validate status
      if (statusRaw !== "active" && statusRaw !== "paused") {
        throw this._readError(
          "ENS_MALFORMED",
          `status record for ${robotId} is neither "active" nor "paused": ${statusRaw}`,
          false,
        );
      }
      const status = statusRaw as "active" | "paused";

      // Block number from the public client
      const blockNumber = await this.client.getBlockNumber();

      const valuesHash = computeValuesHash([zonesRaw!, budgetRaw!, statusRaw!, lastEpisodeRaw]);

      const snapshot: PolicySnapshot = {
        robotId,
        zones,
        budgetAtomic,
        status,
        block: blockNumber,
        valuesHash,
        readAtMs,
      };

      log.info(
        { robotId, block: blockNumber.toString(), status, zones },
        "ENS live policy read succeeded",
      );
      return snapshot;
    } catch (e: unknown) {
      if (this._isPolicyReadError(e)) {
        log.error({ robotId, code: e.code, detail: e.detail }, "ENS policy read failed (typed)");
        throw e;
      }
      const detail = e instanceof Error ? e.message : String(e);
      log.error({ robotId, detail }, "ENS policy read failed (RPC error)");
      throw this._readError("ENS_RPC_ERROR", detail, true);
    }
  }

  private async _readText(
    resolverAddress: `0x${string}`,
    nameBytes: `0x${string}`,
    key: string,
  ): Promise<string> {
    const profileData = textProfileData(key);
    const raw = await this.client.readContract({
      address: resolverAddress,
      abi: RESOLVE_ABI,
      functionName: "resolve",
      args: [nameBytes, profileData],
    });
    return decodeResolveText(raw as `0x${string}`);
  }

  private _readError(
    code: PolicyReadError["code"],
    detail: string,
    retryable: boolean,
  ): PolicyReadError {
    return { code, detail, retryable };
  }

  private _isPolicyReadError(e: unknown): e is PolicyReadError {
    return (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "ENS_UNREADABLE" ||
      (e as { code: string }).code === "ENS_RPC_ERROR" ||
      (e as { code: string }).code === "ENS_MALFORMED"
    );
  }
}

/**
 * Returns true when all required ENSv2 env vars are present and the
 * ViemEnsReader can be safely instantiated.
 * ref: ENSv2_implementation.md §3
 */
export function isViemEnsReaderConfigured(): boolean {
  try {
    const cfg = getConfig();
    return !!(
      cfg.SEPOLIA_RPC_URL &&
      cfg.ENS_ROBOT_RAMU_RESOLVER &&
      cfg.ENS_ROBOT_SAKHU_RESOLVER &&
      cfg.ENS_ROBOT_JANU_RESOLVER
    );
  } catch {
    return false;
  }
}

