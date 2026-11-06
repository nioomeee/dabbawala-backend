/**
 * Health and readiness routes.
 *
 * /health  — lightweight liveness probe; always 200.
 * /ready   — dependency readiness; honest per-subsystem status. NO network I/O
 *            and NO billable 0G inference.
 * /v1/diagnostics/zero-g/probe — explicit 0G diagnostic. Performs at most one
 *            billable inference per cache window (default 60 s) and returns the
 *            real request id, provider, model and TEE verdict. This is the only
 *            place that spends inference credits on demand.
 *
 * Readiness semantics are intentionally staged:
 *   CONFIGURED  env is valid and a transport exists (compute.status LIVE)
 *   REACHABLE   a recent explicit probe completed a Router round-trip
 *   VERIFIED    that probe returned a TEE-verified proposal
 * `proven` remains true only after a real TEE-verified decision in this
 * process. A readiness poll never claims more than it has observed.
 *
 * ref: ROADMAP.md §4.3 invariants 3/4, docs/ETHGLOBAL/DEPLOYMENTS.md
 */

import type { FastifyPluginAsync } from "fastify";
import type { StateSummary } from "@dabbawala/shared";
import { createLogger } from "@dabbawala/observability";

const log = createLogger("api:health");

const PROBE_CACHE_MS = 60_000;

const PROBE_STATE: StateSummary = {
  robotId: "ramu",
  currentCell: "depot",
  heading: "north",
  checkpointIndex: 0,
  totalCheckpoints: 1,
  availableRoutes: ["probe-route"],
  restrictedZones: [],
  // Non-zero: the probe must reach 0G, not stop at a local budget check.
  remainingBudgetAtomic: "1",
  scenarioHints: ["readiness probe"],
  seed: "DABBAWALA_READINESS_PROBE",
};

interface ProbeEvidence {
  readonly ok: boolean;
  readonly probedAtMs: number;
  readonly latencyMs: number;
  readonly mode: string;
  readonly model: string | null;
  readonly requestId: string | null;
  readonly routerRequestId: string | null;
  readonly provider: string | null;
  readonly teeVerified: boolean | null;
  readonly httpStatus: number | null;
  readonly errorCode: string | null;
  readonly detail: string | null;
  readonly reason: string | null;
}

let lastProbe: ProbeEvidence | null = null;
let probeInFlight: Promise<ProbeEvidence> | null = null;

interface ProbeProvenance {
  readonly mode: string;
  readonly attempts: ReadonlyArray<{
    readonly modelRequested: string;
    readonly modelReturned: string | null;
    readonly routerRequestId: string | null;
    readonly provider: string | null;
    readonly teeVerified: boolean | null;
    readonly httpStatus: number | null;
  }>;
  readonly final:
    | { readonly outcome: "PROPOSAL"; readonly requestId: string }
    | {
        readonly outcome: "HALT";
        readonly reason: string;
        readonly failure?: string;
        readonly failureCode?: string;
        readonly requestId: string | null;
      };
}

// Narrow structural type so this module does not depend on the adapter's
// concrete class; the Fastify decorator is typed in fastify-augmentation.ts.
type FastifyInstanceZeroG = {
  brain: {
    decideWithProvenance: (state: StateSummary) => Promise<{
      result: unknown;
      provenance: ProbeProvenance;
    }>;
  };
};

function fromProvenance(
  result: unknown,
  provenance: ProbeProvenance,
  startedAtMs: number,
): ProbeEvidence {
  const attempt = provenance.attempts[provenance.attempts.length - 1];
  const final = provenance.final;
  const ok = final.outcome === "PROPOSAL";
  const haltDetail =
    !ok && typeof result === "object" && result !== null && "detail" in result
      ? String((result as { detail?: unknown }).detail ?? "")
      : null;
  return {
    ok,
    probedAtMs: Date.now(),
    latencyMs: Math.max(0, Date.now() - startedAtMs),
    mode: provenance.mode,
    model: attempt?.modelReturned ?? attempt?.modelRequested ?? null,
    requestId: final.requestId,
    routerRequestId: attempt?.routerRequestId ?? null,
    provider: attempt?.provider ?? null,
    teeVerified: attempt?.teeVerified ?? null,
    httpStatus: attempt?.httpStatus ?? null,
    errorCode: final.outcome === "HALT" ? (final.failureCode ?? null) : null,
    detail: haltDetail === "" ? null : haltDetail,
    reason: final.outcome === "HALT" ? final.reason : null,
  };
}

async function runProbe(zg: FastifyInstanceZeroG): Promise<ProbeEvidence> {
  const startedAtMs = Date.now();
  try {
    const { result, provenance } = await zg.brain.decideWithProvenance(PROBE_STATE);
    return fromProvenance(result, provenance, startedAtMs);
  } catch (err: unknown) {
    log.error({ err }, "0G probe threw");
    return {
      ok: false,
      probedAtMs: Date.now(),
      latencyMs: Math.max(0, Date.now() - startedAtMs),
      mode: "UNKNOWN",
      model: null,
      requestId: null,
      routerRequestId: null,
      provider: null,
      teeVerified: null,
      httpStatus: null,
      errorCode: "OG_PROBE_THREW",
      detail: null,
      reason: null,
    };
  }
}

async function probeZeroG(
  zg: FastifyInstanceZeroG,
  force: boolean,
): Promise<{ probe: ProbeEvidence; cached: boolean }> {
  if (!force && lastProbe !== null && Date.now() - lastProbe.probedAtMs < PROBE_CACHE_MS) {
    return { probe: lastProbe, cached: true };
  }
  if (probeInFlight !== null) {
    return { probe: await probeInFlight, cached: true };
  }
  probeInFlight = runProbe(zg);
  try {
    const probe = await probeInFlight;
    lastProbe = probe;
    return { probe, cached: false };
  } finally {
    probeInFlight = null;
  }
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_req, reply) => {
    return reply.send({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/ready", async (_req, reply) => {
    const zg = app.zeroG;

    if (zg === null) {
      return reply.status(200).send({
        status: "degraded",
        checks: {
          database: "not_probed",
          ens_reader: app.ens ? "configured" : "sim_stub",
          zero_g_router: "BLOCKED",
        },
        zero_g: {
          compute: {
            status: "BLOCKED",
            blockedBy: ["ZERO_G_CONFIG"],
            proven: false,
            reachable: false,
            verified: false,
            lastSuccessAtMs: null,
            lastHaltFailure: null,
            successCount: 0,
            haltCount: 0,
          },
          storage: { status: "BLOCKED" },
          probe: null,
          networkProbed: false,
        },
        ens: { source: app.ens ? "ens" : "sim" },
      });
    }

    const rd = zg.readiness();
    const computeStatus = rd.compute.status;
    const reachable = lastProbe?.ok === true;
    const verified = reachable && lastProbe?.teeVerified === true;
    const recentProbeFailed =
      lastProbe !== null && !lastProbe.ok && Date.now() - lastProbe.probedAtMs < PROBE_CACHE_MS;

    const isReady = computeStatus === "LIVE" && !recentProbeFailed;

    return reply.status(200).send({
      status: isReady ? "ready" : "degraded",
      checks: {
        database: "not_probed",
        ens_reader: app.ens ? "configured" : "sim_stub",
        zero_g_router: computeStatus,
      },
      zero_g: {
        compute: {
          status: computeStatus,
          blockedBy: rd.compute.blockedBy,
          endpoint: rd.compute.endpoint,
          model: rd.compute.model,
          proven: rd.compute.proven,
          reachable,
          verified,
          lastSuccessAtMs: rd.compute.lastSuccessAtMs,
          lastHaltFailure: rd.compute.lastHaltFailure,
          successCount: rd.compute.successCount,
          haltCount: rd.compute.haltCount,
        },
        storage: {
          status: rd.storage.status,
          indexerHost: rd.storage.indexerHost,
          chainId: rd.storage.chainId,
        },
        probe: lastProbe,
        networkProbed: false,
      },
      ens: { source: app.ens ? "ens" : "sim" },
    });
  });

  // Explicit diagnostic: the ONLY route that may spend a billable inference.
  // Cached for 60 s unless `force: true`; concurrent callers share one call.
  app.post<{ Body: { force?: boolean } }>(
    "/diagnostics/zero-g/probe",
    {
      schema: {
        tags: ["health"],
        summary: "Explicit cached 0G Router + TEE diagnostic",
        body: {
          type: "object",
          additionalProperties: false,
          properties: { force: { type: "boolean" } },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          503: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const zg = app.zeroG;
      if (zg === null) {
        return reply.status(503).send({ error: "ZERO_G_UNCONFIGURED" });
      }
      const force = req.body?.force === true;
      const { probe, cached } = await probeZeroG(zg as unknown as FastifyInstanceZeroG, force);
      return reply.send({ cached, probe });
    },
  );
};
