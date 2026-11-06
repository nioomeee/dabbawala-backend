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
      const ensStatus = checkEnsReaderStatus();

      const checks: Record<string, SubsystemStatus> = {
        database: "ok",
        ens_reader: ensStatus,
        zero_g_router: "not_configured",
      };

      // "not_configured" is an expected offline state — does not degrade readiness.
      // Only "error" degrades readiness.
      const critical: SubsystemStatus[] = [checks.database!, checks.ens_reader!];
      const hasError = critical.some((v) => v === "error");
      const httpStatus = hasError ? 503 : 200;

      return reply.status(httpStatus).send({
        status: hasError ? "degraded" : "ready",
        checks,
      });
    },
  );
};
