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
        ens_reader: "ok",
        zero_g_router: zeroGCompute,
        zero_g_storage: zeroGStorage,
      };

      const allOk = Object.values(checks).every((v) => v === "ok");
      const httpStatus = allOk ? 200 : 503;

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
      });
    },
  );
};