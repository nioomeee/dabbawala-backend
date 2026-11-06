/**
 * POST /v1/gate/decide → GateDecisionReceipt
 *
 * Approver authentication: Bearer token checked against ZONE_APPROVERS allowlist.
 * Non-allowlisted caller → 403, no token. ref: implementation.md §4.4, invariant §4.3.8
 */

import type { FastifyPluginAsync } from "fastify";
import { GateDecisionBodySchema } from "../../../schemas/console.js";
import { isAllowlistedApprover, processGateDecision } from "../../../services/gatekeeper.js";
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
          200: { type: "object", additionalProperties: true },
          400: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const authHeader = (req.headers["authorization"] as string | undefined) ?? "";
      const bearerToken = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : "";

      const bodyResult = GateDecisionBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        log.warn({ issues: bodyResult.error.issues }, "Gate decide — invalid body");
        return reply.status(400).send({ error: "INVALID_REQUEST_BODY" });
      }

      const { request, decision } = bodyResult.data;

      if (!isAllowlistedApprover(bearerToken, request.zoneId)) {
        log.warn({ zoneId: request.zoneId }, "Gate decide — 403 not allowlisted");
        return reply.status(403).send({ error: "APPROVER_NOT_ALLOWLISTED" });
      }

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
          // Cast needed because reply.status() expects literal union from schema
          return (reply.status as (n: number) => typeof reply)(status).send({ error: code });
        }
        log.error({ err }, "Gate decide — unexpected error");
        return (reply.status as (n: number) => typeof reply)(500).send({ error: "INTERNAL_ERROR" });
      }
    },
  );
};
