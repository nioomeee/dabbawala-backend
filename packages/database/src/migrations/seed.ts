/**
 * Database seed script — inserts the three final robots and zone approver allowlist.
 *
 * Run with: pnpm db:seed  (invokes `tsx src/migrations/seed.ts`)
 * Requires DATABASE_URL in environment.
 * ref: implementation.md §5, §2 — robot identities: ramu / sakhu / janu
 * ref: AGENTS.md §9 (evidence of seed run goes to docs/evidence/)
 */

import { config } from "dotenv";
import path from "node:path";
import fs from "node:fs";

// Load the workspace-root .env explicitly — the script runs from
// packages/database/src/migrations; dotenv does not search parent dirs.
// ref: implementation.md §5, AGENTS.md §8
const rootEnv = path.resolve(__dirname, "../../../../.env");
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv });
}

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { robots } from "../schema/index.js";
import { sql } from "drizzle-orm";

const { Pool } = pg;

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required for seeding.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const db = drizzle(pool);

/**
 * Seed data for the three robots.
 * Zones and ENS names per implementation.md §2.
 * Starting cell is "depot" — overwritten by the simulator on first episode start.
 */
const ROBOT_SEED_DATA = [
  {
    id: "ramu",
    status: "idle",
    currentCell: "depot",
    checkpointIndex: 0,
  },
  {
    id: "sakhu",
    status: "idle",
    currentCell: "depot",
    checkpointIndex: 0,
  },
  {
    id: "janu",
    status: "idle",
    currentCell: "depot",
    checkpointIndex: 0,
  },
] as const;

async function seed(): Promise<void> {
  console.log("[seed] Seeding robots: ramu, sakhu, janu …");

  for (const robot of ROBOT_SEED_DATA) {
    await db
      .insert(robots)
      .values({
        id: robot.id,
        status: robot.status,
        currentCell: robot.currentCell,
        checkpointIndex: robot.checkpointIndex,
      })
      .onConflictDoUpdate({
        target: robots.id,
        set: {
          status: sql`excluded.status`,
          currentCell: sql`excluded.current_cell`,
          checkpointIndex: sql`excluded.checkpoint_index`,
          updatedAt: sql`now()`,
        },
      });
    console.log(`[seed]   upserted robot: ${robot.id}`);
  }

  console.log("[seed] Seed complete. Evidence: run docs/evidence/db-seed.txt via shell redirect.");
}

seed()
  .then(() => {
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("[seed] ERROR:", err);
    process.exit(1);
  });

