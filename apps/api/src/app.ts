/**
 * Dabbawala Protocol API - Server factory
 *
 * Fastify application with health, readiness, and OpenAPI scaffolding.
 * Routes wired per implementation.md §4 (API-1..API-5, GK-1).
 * ref: implementation.md §4, AGENTS.md §8
 */

import Fastify from "fastify";
import { createLogger } from "@dabbawala/observability";
import { initDatabase } from "@dabbawala/database";
import { loadConfig } from "@dabbawala/config";
import { healthRoutes } from "./routes/v1/health.js";
import { scenarioRoutes } from "./routes/v1/console/scenarios.js";
import { passportRoutes } from "./routes/v1/robots/passport.js";
import { gateRoutes } from "./routes/v1/gate/decide.js";
import { episodeRoutes } from "./routes/v1/episodes/log.js";

const log = createLogger("api");

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function buildApp() {
  const config = loadConfig();

  // Initialise NeonDB connection. ref: implementation.md §5 DB-1
  initDatabase(config.DATABASE_URL);

  const app = Fastify({
    // Pass the pino logger instance; Fastify accepts any pino Logger.
    // Using `as never` to sidestep the narrow generic mismatch between
    // pino.Logger and FastifyBaseLogger without abandoning our typed logger.
    // ref: AGENTS.md §8 (structured logging)
    loggerInstance: createLogger("fastify") as never,
    disableRequestLogging: false,
  });

  // ── Plugins ───────────────────────────────────────────────────────────────

  void app.register(import("@fastify/sensible"));

  void app.register(import("@fastify/cors"), {
    origin: config.NODE_ENV === "development" ? true : false,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });

  void app.register(import("@fastify/swagger"), {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Dabbawala Protocol API",
        description:
          "Bounded-authority operating layer for simulated delivery robots. THIS IS A SIMULATION.",
        version: "0.1.0",
      },
      tags: [
        { name: "health",    description: "Health and readiness checks" },
        { name: "console",   description: "Scenario test cases" },
        { name: "robots",    description: "Robot passport (stub ENS, Hardhat stage)" },
        { name: "approvals", description: "Restricted-zone approval flow" },
        { name: "episodes",  description: "Episode log and replay" },
      ],
    },
  });

  void app.register(import("@fastify/swagger-ui"), {
    routePrefix: "/docs",
  });

  // ── Routes (all under /v1) ────────────────────────────────────────────────

  void app.register(healthRoutes,   { prefix: "/v1" });
  void app.register(scenarioRoutes, { prefix: "/v1" }); // API-1, API-2
  void app.register(passportRoutes, { prefix: "/v1" }); // API-3
  void app.register(gateRoutes,     { prefix: "/v1" }); // API-4
  void app.register(episodeRoutes,  { prefix: "/v1" }); // API-5

  // ── Error handler ─────────────────────────────────────────────────────────

  app.setErrorHandler((error, _request, reply) => {
    log.error({ err: error }, "Unhandled error");
    const errObj = error as { statusCode?: number; name?: string; message?: string };
    const statusCode = typeof errObj.statusCode === "number" ? errObj.statusCode : 500;
    void reply.status(statusCode).send({
      error: errObj.name ?? "InternalServerError",
      message: errObj.message ?? "An internal error occurred",
      statusCode,
    });
  });

  return app;
}
