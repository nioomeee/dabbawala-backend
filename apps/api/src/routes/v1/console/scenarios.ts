/**
 * GET /v1/console/scenarios          → ScenarioTestCase[]
 * GET /v1/console/scenarios/:id      → ScenarioTestCase | null
 *
 * Scenarios are backend-owned after API-1; the frontend fixture is kept for
 * offline demo only. ref: implementation.md §4.1, §4.2, AGENTS.md §8
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyPluginAsync } from "fastify";
import { ScenarioTestCaseSchema, type ScenarioTestCase } from "../../../schemas/console.js";
import { createLogger } from "@dabbawala/observability";

const log = createLogger("api:scenarios");

const __dirname = dirname(fileURLToPath(import.meta.url));
// From src/routes/v1/console/ → up 4 levels to src/ → fixtures/
const FIXTURE_PATH = join(__dirname, "../../../../fixtures/scenarios.json");

let _cache: ScenarioTestCase[] | undefined;

async function loadScenarios(): Promise<ScenarioTestCase[]> {
  if (_cache !== undefined) return _cache;

  if (!existsSync(FIXTURE_PATH)) {
    log.error({ path: FIXTURE_PATH }, "scenarios.json fixture not found");
    throw new Error("SCENARIOS_NOT_SEEDED");
  }

  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const parsed: unknown = JSON.parse(raw);

  const result = ScenarioTestCaseSchema.array().safeParse(parsed);
  if (!result.success) {
    log.error({ issues: result.error.issues }, "scenarios.json failed schema validation");
    throw new Error("SCENARIOS_SCHEMA_INVALID");
  }

  if (result.data.length === 0) {
    throw new Error("SCENARIOS_NOT_SEEDED");
  }

  _cache = result.data;
  log.info({ count: _cache.length }, "Scenarios loaded from fixture");
  return _cache;
}

export const scenarioRoutes: FastifyPluginAsync = async (app) => {
  // GET /v1/console/scenarios → ScenarioTestCase[]
  app.get(
    "/console/scenarios",
    {
      schema: {
        tags: ["console"],
        summary: "List all scenario test cases",
        response: {
          200: { type: "array", items: { type: "object" } },
          503: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (_req, reply) => {
      try {
        const scenarios = await loadScenarios();
        return reply.send(scenarios);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "SCENARIOS_NOT_SEEDED";
        log.error({ err }, "Failed to load scenarios");
        return reply.status(503).send({ error: message });
      }
    },
  );

  // GET /v1/console/scenarios/:id → ScenarioTestCase | null
  // Unknown id → 200 null (never 404). ref: implementation.md §4.2
  app.get<{ Params: { id: string } }>(
    "/console/scenarios/:id",
    {
      schema: {
        tags: ["console"],
        summary: "Get a single scenario by id; returns null if unknown",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      try {
        const scenarios = await loadScenarios();
        const found = scenarios.find((s) => s.id === req.params.id) ?? null;
        return reply.send(found);
      } catch {
        return reply.send(null);
      }
    },
  );
};
