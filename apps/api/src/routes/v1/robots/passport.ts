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
import { ROBOT_ENS_NAMES, ROBOT_IDS, type RobotId } from "@dabbawala/shared";
import { readPassportStub } from "../../../adapters/ens-stub.js";
import { ViemEnsReader, isViemEnsReaderConfigured } from "../../../adapters/viem-ens-reader.js";
import { getConfig } from "@dabbawala/config";

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
      },
    },
    async (req, reply) => {
      const { id } = req.params;

      if (!ROBOT_IDS.includes(id as RobotId)) {
        return reply.status(400).send({ error: "UNKNOWN_ROBOT_ID" });
      }

      const robotId = id as RobotId;
      const liveReader = isViemEnsReaderConfigured() ? new ViemEnsReader() : null;

      if (liveReader) {
        try {
          const snapshot = await liveReader.readPolicy(robotId);
          let resolverAddress: string | null = null;
          try {
            const config = getConfig();
            const key = `ENS_ROBOT_${robotId.toUpperCase()}_RESOLVER` as keyof typeof config;
            resolverAddress = (config[key] as string) || null;
          } catch {
            // ignore
          }

          return reply.send({
            robotId,
            ensName: ROBOT_ENS_NAMES[robotId],
            owner: "0xd91EAC71dd09c731de841f4E520Bf189b288A3A3",
            resolver: resolverAddress,
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