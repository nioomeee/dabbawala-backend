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

      const httpStatus =
        zeroGCompute === "ok" && zeroGStorage === "ok" ? 200 : 503;

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
        status: zeroGCompute === "ok" && zeroGStorage === "ok" ? "ready" : "degraded",
        zero_g: zeroGDetail,
        ens: {
          source: app.ens !== null && app.ens !== undefined ? "ens" : "sim",
        },
      });
    },
  );
};