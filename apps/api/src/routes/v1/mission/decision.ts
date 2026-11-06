/**
 * Mission orchestration and decision checkpoint API routes.
 *
 * GET  /v1/mission/:id/state      → Active mission & robot telemetry
 * POST /v1/mission/select         → Start/select a scenario
 * POST /v1/mission/decide         → Trigger decision checkpoint (0G -> Policy Gate -> Simulator)
 * GET  /v1/mission/receipts       → Inspectable mission decision receipts
 * POST /v1/mission/challenge      → Trigger challenge scenarios
 *
 * ref: user prompt §3, §4, §5, §6, §8
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ROBOT_IDS } from "@dabbawala/shared";
import {
  executeDecisionCheckpoint,
  getDecisionReceipts,
  type ChallengeCondition,
} from "../../../services/mission-decision.js";
import { getSimMission, startSimMission } from "../../../services/simulator.js";

const DecideBodySchema = z.object({
  scenarioId: z.string().default("TC-01"),
  robotId: z.enum(ROBOT_IDS as [string, ...string[]]).optional(),
  challenge: z.enum(["none", "0g_unavailable", "stale_telemetry", "policy_denied", "policy_paused"]).default("none"),
});

const SelectBodySchema = z.object({
  scenarioId: z.string().default("TC-01"),
});

export const missionRoutes: FastifyPluginAsync = async (app) => {
  // GET /v1/mission/:id/state
  app.get<{ Params: { id: string } }>(
    "/mission/:id/state",
    {
      schema: {
        tags: ["mission"],
        summary: "Get current mission state and robot simulation telemetry",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      try {
        const mission = getSimMission(req.params.id);
        return reply.send({
          missionId: mission.missionId,
          scenarioId: mission.scenarioId,
          episodeId: mission.episodeId,
          seed: mission.seed,
          status: mission.status,
          stepIndex: mission.stepIndex,
          robots: mission.robots,
          label: mission.label,
        });
      } catch (err: unknown) {
        return reply.status(404).send({ error: "MISSION_NOT_FOUND" });
      }
    },
  );

  // POST /v1/mission/select
  app.post(
    "/mission/select",
    {
      schema: {
        tags: ["mission"],
        summary: "Select or reset a scenario mission",
        body: { type: "object" },
      },
    },
    async (req, reply) => {
      const parsed = SelectBodySchema.safeParse(req.body ?? {});
      const scenarioId = parsed.success ? parsed.data.scenarioId : "TC-01";
      try {
        const mission = startSimMission(scenarioId);
        return reply.send({
          missionId: mission.missionId,
          scenarioId: mission.scenarioId,
          episodeId: mission.episodeId,
          status: mission.status,
          robots: mission.robots,
          label: mission.label,
        });
      } catch (err: unknown) {
        return reply.status(400).send({ error: "SCENARIO_INIT_FAILED" });
      }
    },
  );

  // POST /v1/mission/decide
  app.post(
    "/mission/decide",
    {
      schema: {
        tags: ["mission"],
        summary: "Execute 0G model inference checkpoint -> Policy Gate -> Simulator",
        body: { type: "object" },
      },
    },
    async (req, reply) => {
      const parsed = DecideBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_BODY", details: parsed.error.issues });
      }

      const { scenarioId, robotId, challenge } = parsed.data;

      try {
        const result = await executeDecisionCheckpoint({
          scenarioId,
          robotId: robotId as any,
          challenge: challenge as ChallengeCondition,
        });

        return reply.send({
          receipt: result.receipt,
          mission: {
            missionId: result.mission.missionId,
            scenarioId: result.mission.scenarioId,
            status: result.mission.status,
            robots: result.mission.robots,
          },
          simulation: true,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "DECISION_CHECKPOINT_FAILED";
        return reply.status(500).send({ error: message });
      }
    },
  );

  // GET /v1/mission/receipts
  app.get<{ Querystring: { missionId?: string } }>(
    "/mission/receipts",
    {
      schema: {
        tags: ["mission"],
        summary: "List inspectable Mission Decision Receipts",
      },
    },
    async (req, reply) => {
      const receipts = getDecisionReceipts(req.query.missionId);
      return reply.send(receipts);
    },
  );
};
