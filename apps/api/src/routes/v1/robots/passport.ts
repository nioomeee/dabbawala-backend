/**
 * GET /v1/robots/:id/passport → RobotPassport
 *
 * Env-switching policy:
 *   - When SEPOLIA_RPC_URL and all three ENS_ROBOT_*_RESOLVER vars are set →
 *     reads live ENSv2 text records from Sepolia via ViemEnsReader (source: "live").
 *   - Otherwise → falls back to readPassportStub() from NeonDB (source: "sim").
 * Fail-closed in both paths: any adapter error → 503 ENS_UNREADABLE, no body.
 * ref: ENSv2_implementation.md §4.3, invariant §4.3.3, AGENTS.md §7
 */

import type { FastifyPluginAsync } from "fastify";
import type { RobotId } from "@dabbawala/shared";
import { readPassportStub } from "../../../adapters/ens-stub.js";
import { ViemEnsReader, isViemEnsReaderConfigured } from "../../../adapters/viem-ens-reader.js";

export const passportRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    "/robots/:id/passport",
    {
      schema: {
        tags: ["robots"],
        summary: "Get robot passport — live ENS on Sepolia or sim stub",
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

      if (!["ramu", "sakhu", "janu"].includes(id)) {
        return reply.status(400).send({ error: "UNKNOWN_ROBOT_ID" });
      }

      const robotId = id as RobotId;
      const liveReader = isViemEnsReaderConfigured() ? new ViemEnsReader() : null;

      if (liveReader) {
        try {
          const snapshot = await liveReader.readPolicy(robotId);
          return reply.send({
            robotId,
            ensName: "ramu.dabbawala.eth",
            owner: "0x0000000000000000000000000000000000000001",
            resolver: null,
            zones: snapshot.zones,
            budgetMicroHbar: Number(snapshot.budgetAtomic),
            status: snapshot.status,
            lastEpisode: null,
            block: {
              number: Number(snapshot.block),
              hash: snapshot.valuesHash,
              scannedAtMs: snapshot.readAtMs,
            },
            source: "live",
          });
        } catch (err: unknown) {
          return reply.status(503).send({ error: "ENS_UNREADABLE", stale: false });
        }
      }

      // Sim path: NeonDB stub
      try {
        const passport = await readPassportStub(robotId);
        return reply.send(passport);
      } catch (err: unknown) {
        return reply.status(503).send({ error: "ENS_UNREADABLE", stale: false });
      }
    },
  );
};