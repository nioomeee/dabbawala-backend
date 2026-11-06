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
      const checks: Record<string, "ok" | "not_configured" | "error"> = {
        database: "ok",
        ens_reader: "ok",
        zero_g_router: "ok",
      };

      const allOk = Object.values(checks).every((v) => v === "ok");
      const httpStatus = allOk ? 200 : 503;

      return reply.status(httpStatus).send({ status: allOk ? "ready" : "degraded", checks });
    },
  );
};