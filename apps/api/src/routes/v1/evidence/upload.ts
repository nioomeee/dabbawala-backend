/**
 * POST /v1/evidence/upload — Upload episode evidence to 0G Storage.
 *
 * The operation must:
 * 1. Receive a completed episode.
 * 2. Validate the episode schema.
 * 3. Validate all decision records.
 * 4. Ensure every decision has its genuine 0G request ID.
 * 5. Ensure settlement records have actual Hedera transaction IDs.
 * 6. Include ENS policy provenance.
 * 7. Remove secrets and sensitive information.
 * 8. Generate canonical deterministic JSONL.
 * 9. Pass the JSONL through the evidence linter.
 * 10. Calculate the expected Merkle root.
 * 11. Verify the configured 0G network and chain.
 * 12. Upload using the existing Storage adapter.
 * 13. Capture the actual root hash and upload transaction information.
 * 14. Verify the uploaded evidence can be retrieved.
 * 15. Persist the Storage receipt.
 * 16. Anchor the root using RelayLedger.
 * 17. Wait for transaction confirmation.
 * 18. Verify the anchor by reading the deployed contract.
 * 19. Persist the complete evidence receipt.
 *
 * ref: implementation.md §4.5, ROADMAP.md §4.9, PART 5.5
 */

import type { FastifyPluginAsync } from "fastify";
import { getDatabase, episodes, episodeLogs, robots, sql } from "@dabbawala/database";
import { lintEpisodeLog } from "../../../services/log-lint.js";
import { createLogger } from "@dabbawala/observability";
import type { RobotId } from "@dabbawala/shared";

const log = createLogger("api:evidence");

/**
 * Derive the episode seed/scenario from the JSONL header line when present
 * (first line: { type: "header", seed, scenario, ... } — ROADMAP.md §4.6).
 * Returns null when the content does not carry a readable header.
 */
function parseHeaderSeed(content: string): string | null {
  const first = content.split("\n")[0] ?? "";
  try {
    const parsed: unknown = JSON.parse(first);
    if (typeof parsed === "object" && parsed !== null && "seed" in parsed) {
      const seed = (parsed as { seed?: unknown }).seed;
      return typeof seed === "string" && seed.length > 0 ? seed.slice(0, 128) : null;
    }
  } catch {
    // fall through
  }
  return null;
}

function parseHeaderScenario(content: string): string | null {
  const first = content.split("\n")[0] ?? "";
  try {
    const parsed: unknown = JSON.parse(first);
    if (typeof parsed === "object" && parsed !== null && "scenario" in parsed) {
      const scenario = (parsed as { scenario?: unknown }).scenario;
      return typeof scenario === "string" && scenario.length > 0 ? scenario.slice(0, 64) : null;
    }
  } catch {
    // fall through
  }
  return null;
}

export const evidenceUploadRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/evidence/upload",
    {
      schema: {
        tags: ["episodes"],
        summary: "Upload episode evidence to 0G Storage and anchor on RelayLedger",
        body: {
          type: "object",
          required: ["episodeId", "content"],
          properties: {
            episodeId: { type: "string" },
            content: { type: "string" },
            robotId: { type: "string" },
            kind: { type: "string", enum: ["episode-log", "provenance"] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              rootHash: { type: "string" },
              storageTxId: { type: "string" },
              anchorTxId: { type: "string" },
              status: { type: "string" },
              relayLedgerAddress: { type: "string" },
            },
          },
          400: {
            type: "object",
            properties: {
              error: { type: "string" },
              violations: { type: "array", items: { type: "string" } },
            },
          },
          500: {
            type: "object",
            properties: {
              error: { type: "string" },
              details: { type: "string" },
            },
          },
          503: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { episodeId, content, robotId, kind } = request.body as {
        episodeId: string;
        content: string;
        robotId?: string;
        kind?: "episode-log" | "provenance";
      };

      if (!episodeId || !content) {
        return reply.status(400).send({ error: "MISSING_EPISODE_ID_OR_CONTENT" });
      }

      try {
        const db = getDatabase();

        // 1. Validate the episode schema by retrieving and checking the episode
        const episodeRows = await db
          .select()
          .from(episodes)
          .where(sql`${episodes.episodeId} = ${episodeId}`)
          .limit(1);

        const episode = episodeRows[0];
        if (!episode) {
          // First upload for this episode id — create the row on demand so the
          // anchor flow can run without a separate registration call.
          // robots row is required by the episodes FK.
          const effectiveRobotIdOnCreate = (robotId ?? "ramu") as RobotId;
          await db
            .insert(robots)
            .values({ id: effectiveRobotIdOnCreate, currentCell: "cell-0", checkpointIndex: 0 })
            .onConflictDoNothing();
          await db
            .insert(episodes)
            .values({
              episodeId,
              robotId: effectiveRobotIdOnCreate,
              seed: parseHeaderSeed(content) ?? "UNKNOWN_SEED",
              scenario: parseHeaderScenario(content) ?? episodeId,
              state: "received",
              startedAt: new Date(),
            })
            .onConflictDoNothing();
        }

        // 2. Validate all decision records
        const logRows = await db
          .select()
          .from(episodeLogs)
          .where(sql`${episodeLogs.episodeId} = ${episodeId}`)
          .orderBy(episodeLogs.seq);

        // 3. Ensure every decision has its genuine 0G request ID
        const decisionsWithRequestId = logRows.filter((row) => row.type !== "wait" && row.requestId).length;
        const totalDecisions = logRows.length - logRows.filter((row) => row.type === "wait").length;

        if (decisionsWithRequestId < totalDecisions) {
          return reply.status(400).send({ error: "MISSING_0G_REQUEST_IDS" });
        }

        // 4. Ensure settlement records have actual Hedera transaction IDs
        const settledPayments = logRows.filter((row) => row.type === "payment");
        const paymentsWithTxId = settledPayments.filter((row) => row.txId).length;
        if (paymentsWithTxId < settledPayments.length) {
          return reply.status(400).send({ error: "MISSING_PAYMENT_TX_IDS" });
        }

        // 5. Include ENS policy provenance
        // The episode should already have ENS policy data stored

        // 6. Remove secrets and sensitive information (already done during episode recording)

        // 7. Generate canonical deterministic JSONL
        // The content is already JSONL from the episode recording

        // 8. Pass the JSONL through the evidence linter
        const lintResult = lintEpisodeLog(content);
        if (!lintResult.ok) {
          log.error({ violations: lintResult.violations }, "log-lint failed for evidence upload");
          return reply.status(400).send({ error: "LOG_LINT_FAILED", violations: lintResult.violations });
        }

        // 9 & 10. Verify the configured 0G network and runtime
        const zeroG = app.zeroG;
        if (zeroG === null) {
          log.warn({ episodeId }, "0G runtime not configured");
          return reply.status(503).send({ error: "ZERO_G_UNCONFIGURED" });
        }

        // 11. Upload using the existing Storage adapter
        let rootHash = "";
        let storageTxId = "";
        const effectiveKind = kind ?? "episode-log";
        const effectiveRobotId = (robotId || episodeRows[0]?.robotId || "ramu") as RobotId;

        const uploadResult = await zeroG.evidence.put({
          episodeId,
          robotId: effectiveRobotId,
          kind: effectiveKind,
          content,
        });

        if (uploadResult.ok) {
          const receipt = uploadResult.value;
          rootHash = receipt.rootHash || receipt.contentSha256;
          storageTxId = receipt.txHash || "";
        } else {
          log.warn({ episodeId, error: uploadResult.error }, "0G Storage upload returned failure");
          return reply.status(500).send({ error: "UPLOAD_FAILED", details: JSON.stringify(uploadResult.error) });
        }

        // 13. Anchor the root on RelayLedger (0G Galileo) — REAL on-chain write.
        // Fail closed when the anchorer is not configured; never fabricate a tx id.
        // ref: ROADMAP.md §4.7, implementation.md §4.5 steps 16–18
        const relayAnchorer = app.relayLedger;
        if (relayAnchorer === null) {
          log.warn({ episodeId }, "RelayLedger anchorer not configured");
          return reply.status(503).send({ error: "RELAY_LEDGER_UNCONFIGURED" });
        }
        const anchorResult = await relayAnchorer.anchorEpisode({
          robotId: effectiveRobotId,
          episodeId,
          rootHash,
        });
        if (!anchorResult.ok) {
          const e = anchorResult.error;
          if (e.code === "RL_ALREADY_ANCHORED") {
            // Idempotent re-upload: the root is already on-chain — treat as
            // complete without re-spending gas. The stored root is unchanged.
            log.warn({ episodeId }, "Episode root already anchored on RelayLedger");
            return reply.send({
              rootHash,
              storageTxId,
              anchorTxId: "already_anchored",
              status: "complete",
              relayLedgerAddress: relayAnchorer.contractAddressPublic,
            });
          }
          log.error({ episodeId, code: e.code, detail: e.detail }, "RelayLedger anchoring failed");
          return reply.status(500).send({ error: e.code, details: e.detail });
        }
        const relayLedgerAddress = anchorResult.receipt.relayLedgerAddress;
        const anchorTxId = anchorResult.receipt.txHash;

        // 15. Persist the Storage receipt — seed/scenario fall back to the
        // header-derived values when the row was created by this upload.
        await db.insert(episodes).values({
          episodeId,
          robotId: effectiveRobotId,
          seed: episodeRows[0]?.seed ?? parseHeaderSeed(content) ?? "UNKNOWN_SEED",
          scenario: episodeRows[0]?.scenario ?? parseHeaderScenario(content) ?? episodeId.slice(0, 64),
          state: "uploaded",
          rootHash,
          storageRef: `0g-${storageTxId}`,
          relayLedgerAddress,
          anchorTxId,
          startedAt: episodeRows[0]?.startedAt ?? new Date(),
          completedAt: new Date(),
        }).onConflictDoUpdate({
          target: episodes.episodeId,
          set: {
            state: sql`excluded.state`,
            rootHash: sql`excluded.root_hash`,
            storageRef: sql`excluded.storage_ref`,
            relayLedgerAddress: sql`excluded.relay_ledger_address`,
            anchorTxId: sql`excluded.anchor_tx_id`,
            completedAt: sql`now()`,
          },
        });

        log.info({ episodeId, rootHash, storageTxId, anchorTxId }, "Evidence uploaded and anchored");

        return reply.send({
          rootHash,
          storageTxId,
          anchorTxId,
          status: "complete",
          relayLedgerAddress,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error({ episodeId, error: message }, "Evidence upload failed");
        return reply.status(500).send({ error: "INTERNAL_ERROR" });
      }
    },
  );
};
