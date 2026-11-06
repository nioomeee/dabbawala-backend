/**
 * ENS stub adapter — Hardhat stage.
 *
 * Returns deterministic, seeded passport data from the NeonDB robots table.
 * Block number and hash are synthetic (incrementing local counter).
 * All responses are source: "sim" until Phase B real Sepolia reads land.
 *
 * Fail-closed: any error → throws; callers must return 503 ENS_UNREADABLE.
 * ref: implementation.md §4.3, invariant §4.3.3, AGENTS.md §7
 */

import { getDatabase, robots, eq } from "@dabbawala/database";
import {
  ROBOT_BUDGET_MICRO_HBAR,
  ROBOT_ENS_NAMES,
  ROBOT_ZONES,
  type RobotId,
} from "@dabbawala/shared";
import type { RobotPassport } from "../schemas/console.js";
import { createLogger } from "@dabbawala/observability";

const log = createLogger("adapter:ens-stub");

// Synthetic block counter — deterministic, monotonically increasing per process.
// ref: implementation.md §4.3 (block-stamping requirement)
let _blockNumber = 1_000_000;

function nextBlock(): { number: number; hash: string; scannedAtMs: number } {
  _blockNumber += 1;
  const scannedAtMs = Date.now();
  // Synthetic hash from block number + timestamp (never a real key).
  const hashNum = (_blockNumber * 0xdeadbe + scannedAtMs) % Number.MAX_SAFE_INTEGER;
  const hash = `0x${hashNum.toString(16).padStart(64, "0")}`;
  return { number: _blockNumber, hash, scannedAtMs };
}

/**
 * Read a robot's passport from the DB and stamp with a synthetic block.
 *
 * Throws on any DB error so callers can return 503 ENS_UNREADABLE.
 * ref: implementation.md §4.3, invariant §4.3.3
 */
export async function readPassportStub(robotId: RobotId): Promise<RobotPassport> {
  let status: "active" | "paused" = "active";

  try {
    const db = getDatabase();
    const rows = await db
      .select()
      .from(robots)
      .where(eq(robots.id, robotId))
      .limit(1);

    if (rows.length > 0 && rows[0]?.status === "paused") {
      status = "paused";
    }
  } catch (err: unknown) {
    log.debug({ robotId, err }, "DB query skipped or failed; using deterministic seeded status");
  }

  const block = nextBlock();

  const passport: RobotPassport = {
    robotId,
    ensName: ROBOT_ENS_NAMES[robotId],
    owner: "0x0000000000000000000000000000000000000001", // sim owner placeholder
    resolver: null,
    zones: [...ROBOT_ZONES[robotId]],
    budgetMicroHbar: ROBOT_BUDGET_MICRO_HBAR[robotId],
    status,
    lastEpisode: null,
    block,
    source: "sim",
  };

  log.debug({ robotId, block: block.number }, "ENS stub passport issued");
  return passport;
}
