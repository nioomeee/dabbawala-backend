/**
 * POST /v1/internal/decide — Fleet Brain proposal + Policy Gate verdict.
 *
 * Internal B-2 endpoint (implementation.md §4.6): the 0G adapter proposes, the
 * deterministic policy engine (@dabbawala/policy-engine) decides. The model's
 * output is UNTRUSTED; only a `valid` policy verdict may ever affect movement
 * or the gate (invariant §4.3.2).
 *
 * Fail-closed: an unreadable policy source is 503 ENS_UNREADABLE (§4.3.3); the
 * adapter not being configured is 503 ZERO_G_UNCONFIGURED (§4.3.4, no
 * substitute decision). An adapter result itself is a domain result (proposal
 * or Halt) and is returned as 200.
 * ref: ROADMAP §4.5 interface B, implementations.md §3
 */

import type { FastifyPluginAsync } from "fastify";
import { StateSummarySchema } from "@dabbawala/shared";
import { validateAction } from "@dabbawala/policy-engine";
import { readPolicySnapshotStub } from "../../../adapters/ens-stub.js";
import { createLogger } from "@dabbawala/observability";

const log = createLogger("api:internal-decide");

export const internalDecideRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/internal/decide",
    {
      schema: {
        tags: ["internal"],
        summary: "0G Fleet Brain proposal + policy-engine verdict (proposal-only)",
        body: { type: "object" },
        response: {
          400: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
          503: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const bodyResult = StateSummarySchema.safeParse(req.body);
      if (!bodyResult.success) {
        log.warn({ issues: bodyResult.error.issues }, "internal decide — invalid body");
        return reply.status(400).send({ error: "INVALID_REQUEST_BODY" });
      }
      const state = bodyResult.data;

      // 1. Fresh policy read, fail closed on any error. §4.3.3
      let policy;
      try {
        policy = await readPolicySnapshotStub(state.robotId);
      } catch (err: unknown) {
        log.error({ err, robotId: state.robotId }, "internal decide — policy source unreadable");
        return reply.status(503).send({ error: "ENS_UNREADABLE" });
      }

      // 2. No substitute decision when 0G is not configured. §4.3.4
      const rt = app.zeroG;
      if (rt === null) {
        log.warn({ robotId: state.robotId }, "internal decide — 0G runtime not configured");
        return reply.status(503).send({ error: "ZERO_G_UNCONFIGURED" });
      }

      // 3. Decide. brain.decide() never throws and never returns a cached or
      //    local decision (invariant §4.3.4).
      try {
        const { result, provenance } = await rt.brain.decideWithProvenance(state);
        // Mock output is simulation evidence only, never live 0G evidence.
        const source: "sim" | "live" = provenance.mode === "MOCK" ? "sim" : "live";

        if ("halted" in result) {
          log.warn(
            { robotId: state.robotId, reason: result.reason, detail: result.detail },
            "internal decide — halted",
          );
          // A Halt is a normal, safe outcome: 200 carrying the domain result.
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

        // 4. The policy engine is the sole approver. §4.3.2
        const verdict = validateAction(result.action, policy, Date.now());
        if (!verdict.valid) {
          log.warn(
            { robotId: state.robotId, requestId: result.requestId, reason: verdict.halt.reason },
            "internal decide — policy engine denied the proposal",
          );
        } else {
          log.info(
            { robotId: state.robotId, requestId: result.requestId, actionType: result.action.type },
            "internal decide — proposal approved by policy engine",
          );
        }

        return reply.send({
          source,
          action: result.action,
          requestId: result.requestId,
          policyApproved: verdict.valid,
          policyHalt: verdict.valid ? null : verdict.halt,
          policyBlock: policy.block.toString(),
          policyHash: policy.valuesHash,
          provenance,
        });
      } catch (err: unknown) {
        // decide() never throws by contract; reaching here is a wiring bug.
        log.error({ err }, "internal decide — unexpected error");
        return reply.status(500).send({ error: "INTERNAL_ERROR" });
      }
    },
  );
};
