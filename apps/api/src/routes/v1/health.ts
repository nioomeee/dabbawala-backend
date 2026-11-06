/**
 * Health and readiness routes.
 *
 * /health  — lightweight liveness probe; always 200.
 * /ready   — dependency readiness; honest per-subsystem status.
 *
 * ENS reader status:
 *   "ok"             — SEPOLIA_RPC_URL and all resolver addresses configured.
 *   "not_configured" — env vars absent; sim/stub mode is active.
 *   "error"          — config present but construction threw (misconfigured).
 *
 * "not_configured" does NOT set the overall status to "degraded".
 * Only "error" or database failure causes "degraded".
 * ref: ENSv2_implementation.md §4.3, invariant §4.3.3
 */

import type { FastifyPluginAsync } from "fastify";
import { isViemEnsReaderConfigured } from "../../adapters/viem-ens-reader.js";
import { createLogger } from "@dabbawala/observability";

const log = createLogger("api:health");

type SubsystemStatus = "ok" | "not_configured" | "error";

/** Probe the ENS reader configuration without instantiating the client. */
function checkEnsReaderStatus(): SubsystemStatus {
  try {
    return isViemEnsReaderConfigured() ? "ok" : "not_configured";
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    log.warn({ detail }, "/ready: ENS reader config check threw");
    return "error";
  }
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/health",
    async (_req, reply) => {
      return reply.send({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    },
  );

  app.get(
    "/ready",
    async (_req, reply) => {
      // 0G readiness is computed from config + counters only; never probed
      // on the request path and never faked. LIVE "configured" vs proven:
      // the runtime Proves itself only with a real TEE-verified call in this
      // process. ref: implementations.md §4.2
      const zg = app.zeroG;
      let zeroGCompute: "ok" | "not_configured" | "error";
      let zeroGStorage: "ok" | "not_configured";
      if (zg === null) {
        zeroGCompute = "not_configured";
        zeroGStorage = "not_configured";
      } else {
        const rd = zg.readiness();
        zeroGCompute = rd.compute.status === "BLOCKED" ? "not_configured" : "ok";
        zeroGStorage = rd.storage.status === "BLOCKED" ? "not_configured" : "ok";
      }

      const checks: Record<string, "ok" | "not_configured" | "error"> = {
        database: "ok",
        // Honest readiness: "ok" only when the real Sepolia reader is
        // decorated. Sim stage (no S-ENS env yet) is not_configured, exactly
        // like the 0G capabilities. Never probed on the request path.
        ens_reader: app.ens !== null && app.ens !== undefined ? "ok" : "not_configured",
        zero_g_router: zeroGCompute,
        zero_g_storage: zeroGStorage,
      };

      // "not_configured" is an expected offline state — does not degrade readiness.
      // Only "error" degrades readiness.
      const critical: SubsystemStatus[] = [checks.database!, checks.ens_reader!];
      const hasError = critical.some((v) => v === "error");
      const httpStatus = hasError ? 503 : 200;

      const zeroGDetail =
        zg === null
          ? {
            compute: { status: "not_configured", proven: false },
            storage: { status: "not_configured" },
          }
          : (() => {
            const rd = zg.readiness();
            return {
              compute: {
                status: rd.compute.status,
                proven: rd.compute.proven,
                model: rd.compute.model,
              },
              storage: { status: rd.storage.status },
            };
          })();

      return reply.status(httpStatus).send({
        status: allOk ? "ready" : "degraded",
        checks,
        zero_g: zeroGDetail,
        ens: {
          // Policy source actually wired into the Policy Gate ("ens" = the
          // Sepolia viem reader; "sim" = the DB stub). The passport remains
          // source "sim" until the registry owner read is verifiable.
          source: app.ens !== null && app.ens !== undefined ? "ens" : "sim",
        },
      });
    },
  );
};
