/**
 * POST /v1/mission/decide — Public mission decision endpoint.
 *
 * This endpoint exposes the Fleet Brain decision functionality through the
 * proper authentication and authorization layer.
 *
 * The frontend calls this at checkpoints to get the authoritative decision.
 * The model's output is UNTRUSTED; only a `valid` policy verdict may affect
 * mission progression.
 *
 * Authentication: Bearer token from approver allowlist.
 * Authorization: Robot must be active in policy, action must be permitted.
 *
 * Fail-closed: any unreadable policy source → 503 ENS_UNREADABLE.
 *              0G not configured → 503 ZERO_G_UNCONFIGURED.
 *
 * ref: ROADMAP.md §4.5 interface B, AGENTS.md §7
 */

import type { FastifyPluginAsync } from "fastify";
import { StateSummarySchema } from "@dabbawala/shared";
import { validateAction } from "@dabbawala/policy-engine";
import { readPolicySnapshotStub } from "../../../adapters/ens-stub.js";
import { createLogger } from "@dabbawala/observability";

const log = createLogger("api:mission-decide");

export const missionDecideRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/mission/decide",
    {
      schema: {
        tags: ["mission"],
        summary: "Get authoritative mission decision at checkpoint",
        body: { type: "object" },
        response: {
          200: {
            type: "object",
            properties: {
              source: { type: "string" },
              action: { type: "object" },
              requestId: { type: "string" },
              halted: { type: "boolean" },
              reason: { type: "string" },
              detail: { type: "string" },
              policyApproved: { type: "boolean" },
              policyHalt: { type: "object", nullable: true },
              policyBlock: { type: "string" },
              policyHash: { type: "string" },
              provenance: { type: "object" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
          503: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const bodyResult = StateSummarySchema.safeParse(req.body);
      if (!bodyResult.success) {
        log.warn({ issues: bodyResult.error.issues }, "mission decide — invalid state");
        return reply.status(400).send({ error: "INVALID_REQUEST_BODY" });
      }
      const state = bodyResult.data;

      // 1. Fresh policy read, fail closed on any error
      const ensReader = app.ens ?? null;
      let policy;
      try {
        policy = ensReader === null ? await readPolicySnapshotStub(state.robotId) : await ensReader.readPolicy(state.robotId);
      } catch (err: unknown) {
        log.error({ err, robotId: state.robotId }, "mission decide — policy source unreadable");
        return reply.status(503).send({ error: "ENS_UNREADABLE" });
      }

      // 2. Check 0G runtime configuration
      const rt = app.zeroG;
      if (rt === null) {
        log.warn({ robotId: state.robotId }, "mission decide — 0G runtime not configured");
        return reply.status(503).send({ error: "ZERO_G_UNCONFIGURED" });
      }

      // 3. Get decision from Fleet Brain with provenance
      try {
        const { result, provenance } = await rt.brain.decideWithProvenance(state);
        const source: "sim" | "live" = provenance.mode === "MOCK" ? "sim" : "live";

        if ("halted" in result) {
          log.warn(
            { robotId: state.robotId, reason: result.reason, detail: result.detail },
            "mission decide — halted",
          );
          return reply.send({
            source,
            halted: true,
            reason: result.reason,
            detail: result.detail,
            policyBlock: policy.block.toString(),
            policyHash: policy.valuesHash,
            provenance,
          });
        }

        // 4. Policy engine validation
        const verdict = validateAction(result.action, policy, Date.now());
        if (!verdict.valid) {
          log.warn(
            { robotId: state.robotId, requestId: result.requestId, reason: verdict.halt.reason },
            "mission decide — policy engine denied",
          );
          return reply.send({
            source,
            action: result.action,
            requestId: result.requestId,
            policyApproved: false,
            policyHalt: verdict.halt,
            policyBlock: policy.block.toString(),
            policyHash: policy.valuesHash,
            provenance,
          });
        }

        log.info(
          { robotId: state.robotId, requestId: result.requestId, actionType: result.action.type },
          "mission decide — approved",
        );

        return reply.send({
          source,
          action: result.action,
          requestId: result.requestId,
          policyApproved: true,
          policyHalt: null,
          policyBlock: policy.block.toString(),
          policyHash: policy.valuesHash,
          provenance,
        });
      } catch (err: unknown) {
        log.error({ err }, "mission decide — unexpected error");
        return reply.status(500).send({ error: "INTERNAL_ERROR" });
      }
    },
  );
};