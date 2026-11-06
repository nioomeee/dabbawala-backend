/**
 * GET /v1/robots/:id/passport → RobotPassport
 *
 * Hardhat stage: reads from DB via ENS stub adapter.
 * Fail-closed: any adapter error → 503 ENS_UNREADABLE, no cached body.
 * ref: implementation.md §4.3, invariant §4.3.3, AGENTS.md §7
 */

import type { FastifyPluginAsync } from "fastify";
import { ROBOT_IDS, type RobotId } from "@dabbawala/shared";
import { readPassportStub } from "../../../adapters/ens-stub.js";
import { createLogger } from "@dabbawala/observability";

const log = createLogger("api:passport");

const VALID_ROBOT_IDS = new Set<string>(ROBOT_IDS);

export const passportRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    "/robots/:id/passport",
    {
      schema: {
        tags: ["robots"],
        summary: "Get robot passport (stub ENS on Hardhat stage)",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { type: "object" },
          400: {
            type: "object",
            properties: { error: { type: "string" } },
          },
          503: {
            type: "object",
            properties: {
              error: { type: "string" },
              stale: { type: "boolean" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params;

      if (!VALID_ROBOT_IDS.has(id)) {
        return reply.status(400).send({ error: "UNKNOWN_ROBOT_ID" });
      }

      try {
        const passport = await readPassportStub(id as RobotId);
        return reply.send(passport);
      } catch (err: unknown) {
        log.error({ robotId: id, err }, "ENS stub failure — failing closed");
        return reply.status(503).send({ error: "ENS_UNREADABLE", stale: false });
      }
    },
  );
};
