/**
 * 0G Storage & Provenance Evidence API routes.
 *
 * POST /v1/evidence/upload        → Uploads JSONL episode log or provenance to 0G Storage
 * POST /v1/evidence/verify        → Verifies stored object with Merkle proof against content hash
 * GET  /v1/evidence/:id/status    → Status of episode evidence and storage receipts
 * GET  /v1/evidence/provenance    → JSONL provenance export
 *
 * ref: user prompt §6, §7, §8
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { provenanceToJsonl } from "@dabbawala/zero-g-adapter";
import { ROBOT_IDS, type RobotId } from "@dabbawala/shared";
import { getZeroG } from "../../../services/zerog.js";
import { getSimMission } from "../../../services/simulator.js";

const UploadBodySchema = z.object({
  episodeId: z.string().min(1),
  robotId: z.enum(ROBOT_IDS as [string, ...string[]]).default("ramu"),
  kind: z.enum(["episode-log", "provenance"]).default("episode-log"),
  content: z.string().optional(),
});

const VerifyBodySchema = z.object({
  rootHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Must be a 0x-prefixed 64-hex root hash"),
  expectedSha256: z.string().min(64),
});

const storedReceipts = new Map<string, any>();

export const evidenceRoutes: FastifyPluginAsync = async (app) => {
  // POST /v1/evidence/upload
  app.post(
    "/evidence/upload",
    {
      schema: {
        tags: ["evidence"],
        summary: "Upload episode log or provenance JSONL to 0G Storage",
        body: { type: "object" },
      },
    },
    async (req, reply) => {
      const parsed = UploadBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_UPLOAD_BODY", issues: parsed.error.issues });
      }

      const { episodeId, robotId, kind } = parsed.data;
      const zeroG = getZeroG();

      if (!zeroG) {
        return reply.status(503).send({
          error: "0G_STORAGE_NOT_CONFIGURED",
          mode: "BLOCKED",
          receipt: null,
        });
      }

      let content = parsed.data.content;
      if (!content || content.trim() === "") {
        // Auto-generate proper JSONL from mission events or provenance
        if (kind === "provenance") {
          content = provenanceToJsonl(zeroG.provenance.list());
          if (content.trim() === "") {
            content = JSON.stringify({
              schema: "dabbawala.0g-provenance/v1",
              recordId: "rec-init",
              mode: zeroG.readiness().compute.status,
              robotId,
              seed: "DABBAWALA_2026_SEED_42",
              checkpointIndex: 0,
              startedAtMs: Date.now(),
              finishedAtMs: Date.now(),
              endpoint: zeroG.readiness().compute.endpoint ?? "https://router-api.0g.ai/v1",
              requestSha256: null,
              responseContentSha256: null,
              attempts: [],
              final: { outcome: "HALT", reason: "ZG_TRANSPORT", failure: "BLOCKED", requestId: null },
            }) + "\n";
          }
        } else {
          // Build episode log JSONL
          const mission = getSimMission(episodeId.replace("ep-", "").replace("-001", ""));
          const lines = [
            JSON.stringify({
              type: "header",
              schemaVersion: "1.0",
              seed: mission.seed,
              scenario: mission.scenarioId,
              robotId,
              startedAtMs: mission.startedAtMs,
            }),
            ...mission.events.map((ev) => JSON.stringify(ev)),
          ];
          content = lines.join("\n") + "\n";
        }
      }

      // Execute storage upload through AI-03 EvidenceStore
      const uploadResult = await zeroG.evidence.put({
        episodeId,
        robotId: robotId as RobotId,
        kind,
        content,
      });

      if (!uploadResult.ok) {
        const failure = uploadResult.error;
        return reply.status(422).send({
          error: failure.kind,
          detail: failure.detail,
          expectedRootHash: failure.expectedRootHash,
          mayHaveLanded: failure.mayHaveLanded,
          lintFindings: failure.lintFindings ?? [],
        });
      }

      const receipt = uploadResult.value;
      storedReceipts.set(episodeId, receipt);

      return reply.send({
        receipt,
        verified: receipt.mode === "LIVE" && receipt.rootHash !== null,
        mode: receipt.mode, // Distinguish LIVE, MOCK, BLOCKED honestly
      });
    },
  );

  // POST /v1/evidence/verify
  app.post(
    "/evidence/verify",
    {
      schema: {
        tags: ["evidence"],
        summary: "Verify 0G Storage object download against expected content hash",
        body: { type: "object" },
      },
    },
    async (req, reply) => {
      const parsed = VerifyBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_VERIFY_BODY", issues: parsed.error.issues });
      }

      const { rootHash, expectedSha256 } = parsed.data;
      const zeroG = getZeroG();

      if (!zeroG) {
        return reply.status(503).send({ error: "0G_STORAGE_NOT_CONFIGURED" });
      }

      const result = await zeroG.evidence.verifyStored(rootHash, expectedSha256);
      if (!result.ok) {
        return reply.status(400).send({
          verified: false,
          error: result.error.kind,
          detail: result.error.detail,
        });
      }

      return reply.send({ verified: true, rootHash });
    },
  );

  // GET /v1/evidence/:id/status
  app.get<{ Params: { id: string } }>(
    "/evidence/:id/status",
    {
      schema: {
        tags: ["evidence"],
        summary: "Get 0G Storage receipt and anchor status for an episode",
      },
    },
    async (req, reply) => {
      const receipt = storedReceipts.get(req.params.id) ?? null;
      const zeroG = getZeroG();
      const storageStatus = zeroG?.readiness().storage.status ?? "BLOCKED";

      return reply.send({
        episodeId: req.params.id,
        stored: receipt !== null,
        receipt,
        storageStatus,
      });
    },
  );

  // GET /v1/evidence/provenance
  app.get(
    "/evidence/provenance",
    {
      schema: {
        tags: ["evidence"],
        summary: "Export accumulated inference provenance as JSONL",
      },
    },
    async (_req, reply) => {
      const zeroG = getZeroG();
      if (!zeroG) {
        return reply.send("");
      }
      const records = zeroG.provenance.list();
      const jsonl = provenanceToJsonl(records);
      void reply.header("content-type", "application/x-ndjson");
      return reply.send(jsonl);
    },
  );
};
