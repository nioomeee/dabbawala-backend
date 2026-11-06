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
import { createZeroGRuntime } from "@dabbawala/zero-g-adapter";
import { createEnsPolicyReader } from "./adapters/ens-reader.js";
import "./fastify-augmentation.js";
import { healthRoutes } from "./routes/v1/health.js";
import { scenarioRoutes } from "./routes/v1/console/scenarios.js";
import { passportRoutes } from "./routes/v1/robots/passport.js";
import { gateRoutes } from "./routes/v1/gate/decide.js";
import { episodeRoutes } from "./routes/v1/episodes/log.js";
import { evidenceUploadRoutes } from "./routes/v1/evidence/upload.js";
import { internalDecideRoutes } from "./routes/v1/internal/decide.js";
import { internalSpendRoutes } from "./routes/v1/internal/spend.js";
import { missionDecideRoutes } from "./routes/v1/mission/decide.js";

const log = createLogger("api");

// Pino-compatible port for the adapter's structured logs. Secrets never reach
// this object (adapter redacts; keys live only inside the fetch closure).
const zeroGLogger = {
  info: (obj: Record<string, unknown>, msg: string): void => log.info(obj, msg),
  warn: (obj: Record<string, unknown>, msg: string): void => log.warn(obj, msg),
  error: (obj: Record<string, unknown>, msg: string): void => log.error(obj, msg),
};

/**
 * Build the 0G runtime once. Explicit LIVE / MOCK / BLOCKED per capability
 * (implementations.md §2; ref/zero-g-adapter README):
 *   - malformed config -> decorator is null; decide endpoints fail closed and
 *     /ready reports not_configured;
 *   - no extraLint is injected: the adapter's built-in key-aware evidence lint
 *     already supersedes the AI-01 regex lint and combining them would reject
 *     legitimate rootHash/txHash values (impl note in REFERENCE package README).
 */
function buildZeroGRuntime() {
  const rt = createZeroGRuntime(process.env, { logger: zeroGLogger });
  if (!rt.ok) {
    // Env var names and problems only; never the offending values.
    log.error({ issues: rt.error }, "0G adapter config invalid — 0G capabilities fail closed");
    return null;
  }
  const ready = rt.value.readiness();
  log.info(
    {
      compute: ready.compute.status,
      storage: ready.storage.status,
    },
    "0G runtime assembled",
  );
  return rt.value;
}

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

  // 0G runtime decoration (typed via fastify-augmentation.ts). Built after the
  // Fastify instance so the decorator exists before any route resolves.
  app.decorate("zeroG", buildZeroGRuntime());

  // ENS policy reader decoration. Not configured (sim stage) → null; routes
  // then read the stub. Not a failure: the S-ENS spike owns the addresses.
  const ensResult = createEnsPolicyReader(config);
  if (!ensResult.ok) {
    log.info({ reason: ensResult.error }, "ENS policy reader not configured — sim source in use");
    app.decorate("ens", null);
  } else {
    log.info(
      { chainId: config.SEPOLIA_CHAIN_ID },
      "ENS policy reader configured — policy reads from Sepolia",
    );
    app.decorate("ens", ensResult.reader);
  }

  void app.register(import("@fastify/sensible"));

  void app.register(import("@fastify/cors"), {
    origin: (origin: string | undefined, callback: (err: any, success?: boolean) => void) => {
      // Allow production frontend origin
      const allowedOrigins = [
        "https://dabbawala-frontend-alpha.vercel.app",
      ];
      // Allow all origins in development
      if (config.NODE_ENV === "development") {
        callback(null, true);
      } else if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false); // reject unknown origin
      }
    },
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
        { name: "internal",  description: "Internal endpoints (Fleet Brain + policy gate)" },
        { name: "mission",   description: "Mission decision and execution" },
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
  void app.register(evidenceUploadRoutes,  { prefix: "/v1" }); // API-5e (evidence upload)
  void app.register(internalDecideRoutes, { prefix: "/v1" }); // B-2 (0G + policy gate)
  void app.register(internalSpendRoutes, { prefix: "/v1" }); // B-6 (Spend Controller + x402)
  void app.register(missionDecideRoutes, { prefix: "/v1" }); // Mission decision (public API)

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
