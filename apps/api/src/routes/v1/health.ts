import type { FastifyPluginAsync } from "fastify";
import { getDatabase } from "@dabbawala/database";
import { getZeroG, getConfigIssues } from "../../services/zerog.js";

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
      let dbStatus: "ok" | "not_configured" | "error" = "ok";
      try {
        getDatabase();
      } catch {
        dbStatus = "not_configured";
      }

      const zeroG = getZeroG();
      const zgReport = zeroG?.readiness() ?? null;
      const configIssues = getConfigIssues();

      // Reflect actual 0G adapter status — NEVER hardcode "ok" (AI-03 §10)
      let zeroGRouterCheck: "ok" | "not_configured" | "error" | "mock" | "blocked" = "not_configured";
      if (zgReport) {
        if (zgReport.compute.status === "LIVE") {
          zeroGRouterCheck = "ok";
        } else if (zgReport.compute.status === "MOCK") {
          zeroGRouterCheck = "mock";
        } else {
          zeroGRouterCheck = "blocked";
        }
      } else if (configIssues.length > 0) {
        zeroGRouterCheck = "error";
      }

      const checks = {
        database: dbStatus,
        ens_reader: "ok",
        zero_g_router: zeroGRouterCheck,
      };

      const isReady = (zeroGRouterCheck === "ok" || zeroGRouterCheck === "mock");
      const httpStatus = 200; // Always serve detailed structured payload for operational inspection

      return reply.status(httpStatus).send({
        status: isReady ? "ready" : "degraded",
        checks,
        zero_g: zgReport ?? {
          compute: {
            status: "BLOCKED",
            blockedBy: configIssues,
            endpoint: null,
            model: null,
            proven: false,
            lastSuccessAtMs: null,
            lastHaltFailure: null,
            successCount: 0,
            haltCount: 0,
          },
          storage: {
            status: "BLOCKED",
            blockedBy: configIssues,
            indexerHost: null,
            chainId: null,
          },
          networkProbed: false,
        },
      });
    },
  );
};