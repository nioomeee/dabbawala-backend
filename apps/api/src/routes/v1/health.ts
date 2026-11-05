/**
 * Health and readiness routes
 * ref: user request §12 (API scaffolding)
 */

import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  // Liveness probe — server is up
  app.get(
    "/health",
    {
      schema: {
        tags: ["health"],
        summary: "Liveness probe",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              uptime: { type: "number" },
              timestamp: { type: "string" },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      return reply.send({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    },
  );

  // Readiness probe — checks if all required services are connected
  app.get(
    "/ready",
    {
      schema: {
        tags: ["health"],
        summary: "Readiness probe — checks database and required integrations",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              checks: { type: "object" },
            },
          },
          503: {
            type: "object",
            properties: {
              status: { type: "string" },
              checks: { type: "object" },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const checks: Record<string, "ok" | "not_configured" | "error"> = {
        // Database check placeholder — will be wired when DB is initialized
        database: "not_configured",
        // ENS reader — not configured until testnet credentials are set
        ens_reader: "not_configured",
        // 0G Router — not configured until API key is set
        zero_g_router: "not_configured",
      };

      const allOk = Object.values(checks).every((v) => v === "ok");
      const status = allOk ? "ready" : "degraded";
      const httpStatus = allOk ? 200 : 503;

      return reply.status(httpStatus).send({ status, checks });
    },
  );
};

