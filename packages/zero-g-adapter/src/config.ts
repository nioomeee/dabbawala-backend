/**
 * 0G adapter configuration.
 *
 * Reads environment variables, validates them, and resolves an explicit
 * operating mode per capability:
 *   LIVE    - all credentials present and well-formed; real 0G calls are made.
 *   MOCK    - ZERO_G_MODE=mock (never allowed when NODE_ENV=production).
 *   BLOCKED - live mode requested but required values are missing/invalid;
 *             the adapter performs NO network calls and fails closed.
 *
 * Malformed values (bad URL, out-of-range number) are a hard config error.
 * Missing credentials are NOT an error: they yield BLOCKED so the process can
 * boot and /ready can report the truth.
 *
 * Secrets are read only from the environment, are never echoed in issues, and
 * are carried in a non-enumerable-by-convention `secrets` block that callers
 * must not log.
 *
 * ref: REFERENCES.md R-0G-1 (Router), R-0G-2 (Storage SDK), AGENTS.md §8, §11
 * Sources: docs.0g.ai Router/Authentication (sk- keys), Router/Verifiable
 * Execution, Storage/SDK, Testnet overview (Galileo chain id 16602).
 */

import { z } from "zod";
import { err, ok, type Result } from "@dabbawala/shared";

/** 0G Galileo testnet chain id. ref: docs.0g.ai/developer-hub/testnet/testnet-overview */
export const GALILEO_CHAIN_ID = 16602 as const;

export type AdapterMode = "LIVE" | "MOCK" | "BLOCKED";

export interface CapabilityStatus {
  readonly mode: AdapterMode;
  /** Names of env vars (never values) that cause BLOCKED. Empty otherwise. */
  readonly blockedBy: readonly string[];
}

export interface ComputeSettings {
  readonly baseUrl: string | undefined;
  readonly modelId: string | undefined;
  readonly requestTimeoutMs: number;
  readonly retryDelayMs: number;
  readonly maxRetryAfterMs: number;
  readonly maxOutputTokens: number;
  readonly maxPromptChars: number;
  readonly maxResponseBytes: number;
  readonly maxConcurrent: number;
  readonly jsonMode: boolean;
  readonly disableThinking: boolean;
}

export interface StorageSettings {
  readonly indexerUrl: string | undefined;
  readonly rpcUrl: string | undefined;
  readonly chainId: number | undefined;
  readonly timeoutMs: number;
  readonly maxEvidenceBytes: number;
}

export interface ZeroGSecrets {
  readonly routerApiKey: string | undefined;
  readonly storagePrivateKey: string | undefined;
}

export interface ZeroGConfig {
  readonly requestedMode: "live" | "mock";
  readonly nodeEnv: "development" | "test" | "production";
  readonly compute: ComputeSettings;
  readonly storage: StorageSettings;
  readonly computeStatus: CapabilityStatus;
  readonly storageStatus: CapabilityStatus;
  readonly secrets: ZeroGSecrets;
}

export interface ConfigIssue {
  /** Env var name. */
  readonly variable: string;
  /** Human-readable problem. Never contains the offending value. */
  readonly problem: string;
}

const PLACEHOLDER_PREFIX = "REPLACE_WITH_";

/** Treat empty strings and the repo's REPLACE_WITH_* placeholders as unset. */
function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.startsWith(PLACEHOLDER_PREFIX)) return undefined;
  return trimmed;
}

const boolish = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(["true", "false", "1", "0"]))
  .transform((v) => v === "true" || v === "1");

interface Collector { issues: ConfigIssue[] }

function intVar(
  env: NodeJS.ProcessEnv,
  name: string,
  def: number,
  min: number,
  max: number,
  c: Collector,
): number {
  const raw = clean(env[name]);
  if (raw === undefined) return def;
  if (!/^\d+$/.test(raw)) {
    c.issues.push({ variable: name, problem: "must be a non-negative integer" });
    return def;
  }
  const n = Number(raw);
  if (n < min || n > max) {
    c.issues.push({ variable: name, problem: `must be between ${String(min)} and ${String(max)}` });
    return def;
  }
  return n;
}

function boolVar(env: NodeJS.ProcessEnv, name: string, def: boolean, c: Collector): boolean {
  const raw = clean(env[name]);
  if (raw === undefined) return def;
  const parsed = boolish.safeParse(raw);
  if (!parsed.success) {
    c.issues.push({ variable: name, problem: "must be one of true,false,1,0" });
    return def;
  }
  return parsed.data;
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/** Validates an http(s) URL with no embedded credentials/query/fragment. */
function urlVar(
  env: NodeJS.ProcessEnv,
  name: string,
  nodeEnv: string,
  c: Collector,
): string | undefined {
  const raw = clean(env[name]);
  if (raw === undefined) return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    c.issues.push({ variable: name, problem: "must be a valid absolute URL" });
    return undefined;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    c.issues.push({ variable: name, problem: "must use http(s)" });
    return undefined;
  }
  if (u.protocol === "http:" && !isLoopbackHost(u.hostname)) {
    c.issues.push({ variable: name, problem: "plain http is only allowed for loopback hosts" });
    return undefined;
  }
  if (u.protocol === "http:" && nodeEnv === "production") {
    c.issues.push({ variable: name, problem: "plain http is not allowed when NODE_ENV=production" });
    return undefined;
  }
  if (u.username !== "" || u.password !== "") {
    c.issues.push({ variable: name, problem: "must not embed credentials" });
    return undefined;
  }
  if (u.search !== "" || u.hash !== "") {
    c.issues.push({ variable: name, problem: "must not contain a query string or fragment" });
    return undefined;
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Parse and validate the 0G adapter configuration.
 * Returns issues for malformed values; missing credentials resolve to BLOCKED.
 */
export function loadZeroGConfig(
  env: NodeJS.ProcessEnv = process.env,
): Result<ZeroGConfig, readonly ConfigIssue[]> {
  const c: Collector = { issues: [] };

  const nodeEnvRaw = clean(env.NODE_ENV) ?? "development";
  const nodeEnvParsed = z.enum(["development", "test", "production"]).safeParse(nodeEnvRaw);
  const nodeEnv = nodeEnvParsed.success ? nodeEnvParsed.data : "development";
  if (!nodeEnvParsed.success) {
    c.issues.push({ variable: "NODE_ENV", problem: "must be development, test or production" });
  }

  const modeRaw = (clean(env.ZERO_G_MODE) ?? "live").toLowerCase();
  let requestedMode: "live" | "mock" = "live";
  if (modeRaw === "mock" || modeRaw === "live") {
    requestedMode = modeRaw;
  } else {
    c.issues.push({ variable: "ZERO_G_MODE", problem: "must be live or mock" });
  }
  if (requestedMode === "mock" && nodeEnv === "production") {
    c.issues.push({
      variable: "ZERO_G_MODE",
      problem: "mock mode is forbidden when NODE_ENV=production",
    });
  }

  // ── Compute ────────────────────────────────────────────────────────────
  const baseUrl = urlVar(env, "ZERO_G_ROUTER_BASE_URL", nodeEnv, c);
  const modelIdRaw = clean(env.ZERO_G_MODEL_ID);
  if (modelIdRaw !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(modelIdRaw)) {
    c.issues.push({ variable: "ZERO_G_MODEL_ID", problem: "contains characters not allowed in a model id" });
  }
  const modelId =
    modelIdRaw !== undefined && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(modelIdRaw)
      ? modelIdRaw
      : undefined;

  const routerKeyRaw = clean(env.ZERO_G_ROUTER_API_KEY);
  let routerApiKey: string | undefined;
  if (routerKeyRaw !== undefined) {
    if (routerKeyRaw.startsWith("mk-")) {
      c.issues.push({
        variable: "ZERO_G_ROUTER_API_KEY",
        problem: "is a management key (mk-); inference requires an API key (sk-)",
      });
    } else if (!/^sk-[A-Za-z0-9_-]{8,256}$/.test(routerKeyRaw)) {
      c.issues.push({
        variable: "ZERO_G_ROUTER_API_KEY",
        problem: "must be a Router API key starting with sk-",
      });
    } else {
      routerApiKey = routerKeyRaw;
    }
  }

  const compute: ComputeSettings = {
    baseUrl,
    modelId,
    requestTimeoutMs: intVar(env, "ZERO_G_REQUEST_TIMEOUT_MS", 20_000, 1_000, 120_000, c),
    retryDelayMs: intVar(env, "ZERO_G_RETRY_DELAY_MS", 250, 0, 10_000, c),
    maxRetryAfterMs: intVar(env, "ZERO_G_MAX_RETRY_AFTER_MS", 2_000, 0, 30_000, c),
    maxOutputTokens: intVar(env, "ZERO_G_MAX_OUTPUT_TOKENS", 2_048, 16, 32_768, c),
    maxPromptChars: intVar(env, "ZERO_G_MAX_PROMPT_CHARS", 8_000, 500, 100_000, c),
    maxResponseBytes: intVar(env, "ZERO_G_MAX_RESPONSE_BYTES", 65_536, 1_024, 1_048_576, c),
    maxConcurrent: intVar(env, "ZERO_G_MAX_CONCURRENT", 4, 1, 64, c),
    jsonMode: boolVar(env, "ZERO_G_JSON_MODE", false, c),
    disableThinking: boolVar(env, "ZERO_G_DISABLE_THINKING", false, c),
  };

  // ── Storage ────────────────────────────────────────────────────────────
  const indexerUrl = urlVar(env, "ZERO_G_INDEXER_URL", nodeEnv, c);
  const rpcUrl = urlVar(env, "ZERO_G_RPC_URL", nodeEnv, c);

  let chainId: number | undefined;
  const chainRaw = clean(env.ZERO_G_CHAIN_ID);
  if (chainRaw !== undefined) {
    if (!/^\d{1,10}$/.test(chainRaw)) {
      c.issues.push({ variable: "ZERO_G_CHAIN_ID", problem: "must be a positive integer" });
    } else {
      chainId = Number(chainRaw);
    }
  }

  const pkRaw = clean(env.ZERO_G_STORAGE_PRIVATE_KEY);
  let storagePrivateKey: string | undefined;
  if (pkRaw !== undefined) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(pkRaw)) {
      c.issues.push({
        variable: "ZERO_G_STORAGE_PRIVATE_KEY",
        problem: "must be a 0x-prefixed 32-byte hex key",
      });
    } else {
      storagePrivateKey = pkRaw;
    }
  }

  const storage: StorageSettings = {
    indexerUrl,
    rpcUrl,
    chainId,
    timeoutMs: intVar(env, "ZERO_G_STORAGE_TIMEOUT_MS", 120_000, 5_000, 600_000, c),
    maxEvidenceBytes: intVar(env, "ZERO_G_MAX_EVIDENCE_BYTES", 1_048_576, 1_024, 16_777_216, c),
  };

  if (c.issues.length > 0) return err(c.issues);

  // ── Mode resolution ────────────────────────────────────────────────────
  let computeStatus: CapabilityStatus;
  let storageStatus: CapabilityStatus;

  if (requestedMode === "mock") {
    computeStatus = { mode: "MOCK", blockedBy: [] };
    storageStatus = { mode: "MOCK", blockedBy: [] };
  } else {
    const computeMissing: string[] = [];
    if (baseUrl === undefined) computeMissing.push("ZERO_G_ROUTER_BASE_URL");
    if (routerApiKey === undefined) computeMissing.push("ZERO_G_ROUTER_API_KEY");
    if (modelId === undefined) computeMissing.push("ZERO_G_MODEL_ID");
    computeStatus = {
      mode: computeMissing.length === 0 ? "LIVE" : "BLOCKED",
      blockedBy: computeMissing,
    };

    const storageMissing: string[] = [];
    if (indexerUrl === undefined) storageMissing.push("ZERO_G_INDEXER_URL");
    if (rpcUrl === undefined) storageMissing.push("ZERO_G_RPC_URL");
    if (storagePrivateKey === undefined) storageMissing.push("ZERO_G_STORAGE_PRIVATE_KEY");
    if (chainId === undefined) storageMissing.push("ZERO_G_CHAIN_ID");
    // Testnet-only invariant (AGENTS.md §11): only Galileo is accepted.
    if (chainId !== undefined && chainId !== GALILEO_CHAIN_ID) {
      storageMissing.push(`ZERO_G_CHAIN_ID(must be ${String(GALILEO_CHAIN_ID)})`);
    }
    storageStatus = {
      mode: storageMissing.length === 0 ? "LIVE" : "BLOCKED",
      blockedBy: storageMissing,
    };
  }

  return ok({
    requestedMode,
    nodeEnv,
    compute,
    storage,
    computeStatus,
    storageStatus,
    secrets: { routerApiKey, storagePrivateKey },
  });
}

/** Replace any occurrence of a configured secret in a string. */
export function redactSecrets(text: string, secrets: ZeroGSecrets): string {
  let out = text;
  for (const s of [secrets.routerApiKey, secrets.storagePrivateKey]) {
    if (s !== undefined && s.length >= 8) out = out.split(s).join("[REDACTED]");
  }
  return out;
}
