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
import { createLogger } from "@dabbawala/observability";

const log = createLogger("api:passport");

const VALID_ROBOT_IDS = new Set<string>(["ramu", "sakhu", "janu"]);

// Singleton live reader — created once at startup if config is present.
let _liveReader: ViemEnsReader | null = null;
let _liveReaderChecked = false;

function getLiveReader(): ViemEnsReader | null {
  if (!_liveReaderChecked) {
    _liveReaderChecked = true;
    if (isViemEnsReaderConfigured()) {
      try {
        _liveReader = new ViemEnsReader();
        log.info("ENS mode: LIVE (ViemEnsReader on Sepolia)");
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : String(err);
        log.warn({ detail }, "ViemEnsReader construction failed — falling back to sim");
        _liveReader = null;
      }
    } else {
      log.info("ENS mode: SIM (SEPOLIA_RPC_URL or resolver addresses not configured)");
    }
  }
  return _liveReader;
}

/** Build a RobotPassport from a live PolicySnapshot. */
function passportFromLive(
  robotId: RobotId,
  resolverAddress: string,
  snapshot: {
    zones: readonly string[];
    budgetAtomic: string;
    status: "active" | "paused";
    block: bigint;
    valuesHash: string;
    readAtMs: number;
  },
  lastEpisode: string | null,
): RobotPassport {
  return {
    robotId,
    ensName: "ramu.dabbawala.eth", // placeholder - will be set per robot
    owner: "0x0000000000000000000000000000000000000001", // sim owner placeholder
    resolver: resolverAddress,
    zones: [...snapshot.zones],
    // budgetAtomic is the ENS-stored string; budgetMicroHbar is the advisory display unit.
    // Live reads use the ENS budget directly (treating it as microHbar for now — advisory only).
    budgetMicroHbar: Number(snapshot.budgetAtomic),
    status: snapshot.status,
    lastEpisode,
    block: {
      number: Number(snapshot.block),
      hash: snapshot.valuesHash, // values hash as the block fingerprint for live reads
      scannedAtMs: snapshot.readAtMs,
    },
    source: "live",
  };
}

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

      if (!VALID_ROBOT_IDS.has(id)) {
        return reply.status(400).send({ error: "UNKNOWN_ROBOT_ID" });
      }

      const robotId = id as RobotId;
      const liveReader = getLiveReader();

      if (liveReader) {
        // ── Live path: Sepolia ENS reads ────────────────────────────────────
        try {
          const snapshot = await liveReader.readPolicy(robotId);
          const cfg = (await import("@dabbawala/config")).getConfig();
          const resolverKey = `ENS_ROBOT_${robotId.toUpperCase()}_RESOLVER` as keyof typeof cfg;
          const resolverAddress = (cfg[resolverKey] as string | undefined) ?? null;

          const passport = passportFromLive(
            robotId,
            resolverAddress ?? "0x0000000000000000000000000000000000000000",
            snapshot,
            null, // lastEpisode not separately read in live path yet
          );
          return reply.send(passport);
        } catch (err: unknown) {
          log.error({ robotId, err }, "Live ENS read failed — failing closed");
          return reply.status(503).send({ error: "ENS_UNREADABLE", stale: false });
        }
      }

      // ── Sim path: NeonDB stub ────────────────────────────────────────────
      try {
        const passport = await readPassportStub(robotId);
        return reply.send(passport);
      } catch (err: unknown) {
        log.error({ robotId, err }, "ENS stub failure — failing closed");
        return reply.status(503).send({ error: "ENS_UNREADABLE", stale: false });
      }
    },
  );
};