/**
 * Runtime assembly + startup validation + readiness.
 *
 *   const rt = createZeroGRuntime(process.env, { logger });
 *   if (!rt.ok) { // malformed config: refuse to start }
 *   rt.value.brain         // IFleetBrain
 *   rt.value.evidence      // EvidenceStore
 *   rt.value.provenance    // InMemoryProvenanceLog (also the brain's sink)
 *   rt.value.readiness()   // LIVE | MOCK | BLOCKED per capability
 *
 * Readiness semantics (never optimistic):
 *   LIVE     configured for real calls. `proven:false` until this process has
 *            actually completed a TEE-verified call (compute) or upload (storage).
 *   MOCK     explicit ZERO_G_MODE=mock (never in production).
 *   BLOCKED  required env vars missing; no network calls are made; decide()
 *            returns Halt{ZG_TRANSPORT}; put() returns BLOCKED.
 * readiness() performs NO network I/O: a LIVE status means "configured", and
 * `proven` / `lastSuccessAtMs` say whether it has actually worked.
 */

import { err, ok, type Result } from "@dabbawala/shared";
import { loadZeroGConfig, type AdapterMode, type ConfigIssue, type ZeroGConfig } from "./config.js";
import {
  BlockedEvidenceStore,
  MockEvidenceStore,
  ZeroGStorageEvidenceStore,
  type EvidenceStore,
  type ExtraLint,
} from "./evidence-store.js";
import { ZeroGFleetBrain, type FleetBrainStats } from "./fleet-brain.js";
import { MockRouterTransport } from "./mock-transport.js";
import { InMemoryProvenanceLog } from "./provenance.js";
import { FetchRouterTransport, type FetchLike } from "./router-transport.js";
import { SdkStorageClient, type StorageClientPort } from "./storage-client.js";
import { NOOP_LOGGER, SYSTEM_CLOCK, type AdapterLogger, type Clock, type RouterTransport } from "./types.js";

export interface ReadinessReport {
  readonly compute: {
    readonly status: AdapterMode;
    /** Env var NAMES only. */
    readonly blockedBy: readonly string[];
    readonly endpoint: string | null;
    readonly model: string | null;
    /** True once a LIVE TEE-verified proposal has been returned in this process. */
    readonly proven: boolean;
    readonly lastSuccessAtMs: number | null;
    readonly lastHaltFailure: string | null;
    readonly successCount: number;
    readonly haltCount: number;
  };
  readonly storage: {
    readonly status: AdapterMode;
    readonly blockedBy: readonly string[];
    readonly indexerHost: string | null;
    readonly chainId: number | null;
  };
  /** Always false: readiness is computed from config and counters only. */
  readonly networkProbed: false;
}

export interface ZeroGRuntime {
  readonly config: ZeroGConfig;
  readonly brain: ZeroGFleetBrain;
  readonly evidence: EvidenceStore;
  readonly provenance: InMemoryProvenanceLog;
  readiness(): ReadinessReport;
  stats(): FleetBrainStats;
  close(): Promise<void>;
}

export interface RuntimeOverrides {
  readonly logger?: AdapterLogger;
  readonly clock?: Clock;
  /** Replace the router transport (tests). Ignored when BLOCKED. */
  readonly routerTransport?: RouterTransport;
  /** Inject fetch for the live transport (contract tests). */
  readonly fetchImpl?: FetchLike;
  /** Replace the storage client (tests). */
  readonly storageClient?: StorageClientPort;
  /** Inject AI-01's log-lint; both it and the built-in lint must pass. */
  readonly extraLint?: ExtraLint;
}

export function createZeroGRuntime(
  env: NodeJS.ProcessEnv = process.env,
  overrides: RuntimeOverrides = {},
): Result<ZeroGRuntime, readonly ConfigIssue[]> {
  const loaded = loadZeroGConfig(env);
  if (!loaded.ok) return err(loaded.error);
  const config = loaded.value;

  const logger = overrides.logger ?? NOOP_LOGGER;
  const clock = overrides.clock ?? SYSTEM_CLOCK;
  const provenance = new InMemoryProvenanceLog();

  // ── Compute ──
  let transport: RouterTransport | null = null;
  const cs = config.computeStatus;
  if (cs.mode === "MOCK") {
    transport = overrides.routerTransport ?? new MockRouterTransport();
  } else if (cs.mode === "LIVE") {
    const baseUrl = config.compute.baseUrl;
    const apiKey = config.secrets.routerApiKey;
    if (baseUrl === undefined || apiKey === undefined) {
      // Unreachable by construction of computeStatus; kept to stay type-honest.
      return err([{ variable: "ZERO_G_ROUTER_BASE_URL", problem: "inconsistent LIVE resolution" }]);
    }
    transport =
      overrides.routerTransport ??
      new FetchRouterTransport({
        baseUrl,
        apiKey,
        clock,
        ...(overrides.fetchImpl !== undefined ? { fetchImpl: overrides.fetchImpl } : {}),
      });
  }

  const brain = new ZeroGFleetBrain({
    transport,
    blockedBy: cs.blockedBy,
    modelId: config.compute.modelId ?? (cs.mode === "MOCK" ? "mock-model" : ""),
    settings: config.compute,
    provenance,
    logger,
    clock,
  });

  // ── Storage ──
  let evidence: EvidenceStore;
  const ss = config.storageStatus;
  const lintOpt = overrides.extraLint !== undefined ? { extraLint: overrides.extraLint } : {};
  if (ss.mode === "MOCK") {
    evidence = new MockEvidenceStore({
      maxEvidenceBytes: config.storage.maxEvidenceBytes,
      clock,
      ...lintOpt,
    });
  } else if (ss.mode === "LIVE") {
    const { indexerUrl, rpcUrl } = config.storage;
    const privateKey = config.secrets.storagePrivateKey;
    if (indexerUrl === undefined || rpcUrl === undefined || privateKey === undefined) {
      return err([{ variable: "ZERO_G_INDEXER_URL", problem: "inconsistent LIVE resolution" }]);
    }
    const client =
      overrides.storageClient ?? new SdkStorageClient({ indexerUrl, rpcUrl, privateKey });
    evidence = new ZeroGStorageEvidenceStore({
      client,
      settings: config.storage,
      secrets: config.secrets,
      logger,
      clock,
      ...lintOpt,
    });
  } else {
    evidence = new BlockedEvidenceStore(ss.blockedBy);
  }

  const hostOf = (u: string | undefined): string | null => {
    if (u === undefined) return null;
    try {
      return new URL(u).host;
    } catch {
      return null;
    }
  };

  return ok({
    config,
    brain,
    evidence,
    provenance,
    readiness(): ReadinessReport {
      const st = brain.stats;
      return {
        compute: {
          status: cs.mode,
          blockedBy: cs.blockedBy,
          endpoint: transport?.endpoint ?? null,
          model: config.compute.modelId ?? null,
          proven: cs.mode === "LIVE" && st.liveVerified,
          lastSuccessAtMs: st.lastSuccessAtMs,
          lastHaltFailure: st.lastHaltFailure,
          successCount: st.successCount,
          haltCount: st.haltCount,
        },
        storage: {
          status: ss.mode,
          blockedBy: ss.blockedBy,
          indexerHost: hostOf(config.storage.indexerUrl),
          chainId: config.storage.chainId ?? null,
        },
        networkProbed: false,
      };
    },
    stats: () => brain.stats,
    close: () => evidence.close(),
  });
}
