/**
 * Dabbawala Protocol API — Server factory
 *
 * Fastify application with health, readiness, and OpenAPI scaffolding.
 * Unimplemented integrations return explicit NOT_CONFIGURED status.
 * ref: user request §12, §15.3
 */

import Fastify from "fastify";
import { createLogger } from "@dabbawala/observability";
import { healthRoutes } from "./routes/v1/health.js";

const log = createLogger("api");

export function buildApp() {
  const app = Fastify({
    loggerInstance: createLogger("fastify"),
    disableRequestLogging: false,
  });

  // ── Plugins ──────────────────────────────────────────────────────────────

  // Error handling: @fastify/sensible adds httpErrors, reply.notFound(), etc.
  void app.register(import("@fastify/sensible"));

  // CORS (locked down; adjust origins per environment)
  void app.register(import("@fastify/cors"), {
    origin: process.env["NODE_ENV"] === "development" ? true : false,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });

  // OpenAPI scaffolding
  void app.register(import("@fastify/swagger"), {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Dabbawala Protocol API",
        description: "Bounded-authority operating layer for simulated delivery robots. THIS IS A SIMULATION.",
        version: "0.1.0",
      },
      tags: [
        { name: "health", description: "Health and readiness checks" },
        { name: "robots", description: "Robot status and control" },
        { name: "approvals", description: "Restricted-zone approval flow" },
        { name: "episodes", description: "Episode log and replay" },
      ],
    },
  });

  void app.register(import("@fastify/swagger-ui"), {
    routePrefix: "/docs",
  });

  // ── Routes ────────────────────────────────────────────────────────────────

  void app.register(healthRoutes, { prefix: "/v1" });

  // ── Error handler ─────────────────────────────────────────────────────────

  app.setErrorHandler((error, _request, reply) => {
    log.error({ err: error }, "Unhandled error");
    const statusCode = error.statusCode ?? 500;
    void reply.status(statusCode).send({
      error: error.name ?? "InternalServerError",
      message: error.message,
      statusCode,
    });
  });

  return app;
}

