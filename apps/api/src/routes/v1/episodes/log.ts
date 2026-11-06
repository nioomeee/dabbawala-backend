/**
 * GET /v1/episodes/:scenarioId/log → EpisodeLog
 *
 * Hardhat stage: assembles from episode_logs rows (simulated: true).
 * log-lint gates all writes; if lint fails the log is not served.
 * Phase B: serve JSONL anchored on RelayLedger (0G Galileo) after B-3/B-5.
 *
 * ref: implementation.md §4.5, §3 LOG-1, AGENTS.md §7
 */

import type { FastifyPluginAsync } from "fastify";
import { getDatabase, episodes, episodeLogs, eq } from "@dabbawala/database";
import { lintEpisodeLog } from "../../../services/log-lint.js";
import type { EpisodeLog } from "../../../schemas/console.js";
import { createLogger } from "@dabbawala/observability";

const log = createLogger("api:episodes");

export const episodeRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { scenarioId: string } }>(
    "/episodes/:scenarioId/log",
    {
      schema: {
        tags: ["episodes"],
        summary: "Get the episode log for a completed scenario run",
        params: {
          type: "object",
          properties: { scenarioId: { type: "string" } },
          required: ["scenarioId"],
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { type: "object", properties: { error: { type: "string" } } },
          422: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const { scenarioId } = req.params;
      const db = getDatabase();

      const episodeRows = await db
        .select()
        .from(episodes)
        .where(eq(episodes.scenario, scenarioId))
        .limit(1);

      if (episodeRows.length === 0) {
        return reply.status(404).send({ error: "EPISODE_NOT_FOUND" });
      }

      const episode = episodeRows[0]!;

      const logRows = await db
        .select()
        .from(episodeLogs)
        .where(eq(episodeLogs.episodeId, episode.episodeId))
        .orderBy(episodeLogs.seq);

      const steps = logRows.map((row) => ({
        seq: row.seq,
        tsMs: row.tsMs,
        robotId: row.robotId,
        type: row.type,
        action: row.action ?? undefined,
        reason: row.reason ?? undefined,
        detail: row.detail ?? undefined,
      }));

      const haltEntry = logRows.find((r) => r.type === "halt");
      const verdict: EpisodeLog["verdict"] =
        episode.state === "local" && !haltEntry
          ? "IN_PROGRESS"
          : haltEntry
            ? "HALTED"
            : "DELIVERED";

      const exportObj: EpisodeLog = {
        schema: "dabbawala.console.replay/v1",
        scenario: episode.scenario,
        seed: episode.seed,
        exportedAtMs: Date.now(),
        simulated: true,
        robots: [episode.robotId],
        steps,
        verdict,
        haltReason: haltEntry?.reason ?? null,
      };

      const serialised = JSON.stringify(exportObj);
      const lintResult = lintEpisodeLog(serialised);
      if (!lintResult.ok) {
        log.error({
          episodeId: episode.episodeId,
          violations: lintResult.violations,
        }, "log-lint blocked episode export");
        return reply.status(422).send({ error: "LOG_LINT_FAILED" });
      }

      return reply.send(exportObj);
    },
  );
};
