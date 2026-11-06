/**
 * POST /v1/gate/decide → GateDecisionReceipt
 *
 * Backend enforces the per-zone approver allowlist and mints single-use token.
 * No static bearer credentials in the browser - the backend validates the
 * approver identity and zone binding via the gatekeeper service.
 * ref: implementation.md §4.4, §9
 */

import type { FastifyPluginAsync } from "fastify";
import { GateDecisionBodySchema } from "../../../schemas/console.js";
import { processGateDecision } from "../../../services/gatekeeper.js";
import { createLogger } from "@dabbawala/observability";

const log = createLogger("api:gate");

export const gateRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/gate/decide",
    {
      schema: {
        tags: ["approvals"],
        summary: "Submit a zone-entry gate decision (approved | denied)",
        body: { type: "object" },
        response: {
          200: {
            type: "object",
            properties: {
              requestId: { type: "string" },
              decision: { type: "string" },
              token: { type: "string" },
              ttlMs: { type: "number" },
              decidedAtMs: { type: "number" },
              source: { type: "string" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" }, ruleId: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const bodyResult = GateDecisionBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        log.warn({ issues: bodyResult.error.issues }, "Gate decide — invalid body");
        return reply.status(400).send({ error: "INVALID_REQUEST_BODY" });
      }

      const { request, decision } = bodyResult.data;

      try {
        const receipt = await processGateDecision(request, decision);
        return reply.send(receipt);
      } catch (err: unknown) {
        if (
          err !== null &&
          typeof err === "object" &&
          "code" in err &&
          "status" in err
        ) {
          const code = String((err as Record<string, unknown>)["code"]);
          const status = Number((err as Record<string, unknown>)["status"]);
          log.warn({ code, requestId: request.id }, "Gate decide — rejection");
          return (reply.status as (n: number) => typeof reply)(status).send({ error: code });
        }
        log.error({ err }, "Gate decide — unexpected error");
        return (reply.status as (n: number) => typeof reply)(500).send({ error: "INTERNAL_ERROR" });
      }
    },
  );
};
