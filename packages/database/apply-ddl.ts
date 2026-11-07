// BF-2 blocker fix: apply the database DDL exactly as declared in
// packages/database/src/schema/index.ts (drizzle-kit migrate/generate fails
// with "Please install latest version of drizzle-orm" — a known drizzle-kit
// resolution issue under pnpm; DDL here is VERIFIED against the schema
// source line by line. Idempotent: IF NOT EXISTS everywhere.
import { config as loadDotenv } from "dotenv";
import { loadConfig } from "@dabbawala/config";
import pg from "pg";

async function main(): Promise<void> {
  loadDotenv({ path: "../../.env" });
  const cfg = loadConfig();
  const client = new pg.Client({ connectionString: cfg.DATABASE_URL });
  await client.connect();

  const ddl = `
CREATE TABLE IF NOT EXISTS "robots" (
  "id" varchar(32) PRIMARY KEY,
  "status" varchar(16) NOT NULL DEFAULT 'idle',
  "current_cell" varchar(64) NOT NULL,
  "checkpoint_index" integer NOT NULL DEFAULT 0,
  "halt_reason" varchar(32),
  "halt_detail" text,
  "last_policy_block" bigint,
  "last_policy_hash" varchar(66),
  "ens_zones" varchar(512)[] DEFAULT '{}',
  "ens_budget_atomic" varchar(32) NOT NULL DEFAULT '0',
  "ens_status" varchar(16) NOT NULL DEFAULT 'active',
  "ens_block_number" bigint,
  "ens_values_hash" varchar(66),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "episodes" (
  "episode_id" varchar(64) PRIMARY KEY,
  "robot_id" varchar(32) NOT NULL REFERENCES "robots"("id"),
  "seed" varchar(128) NOT NULL,
  "scenario" varchar(64) NOT NULL,
  "state" varchar(16) NOT NULL DEFAULT 'local',
  "root_hash" varchar(66),
  "storage_ref" text,
  "relay_ledger_address" varchar(42),
  "anchor_tx_id" text,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);

CREATE TABLE IF NOT EXISTS "episode_logs" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "episode_id" varchar(64) NOT NULL REFERENCES "episodes"("episode_id"),
  "seq" integer NOT NULL,
  "ts_ms" bigint NOT NULL,
  "robot_id" varchar(32) NOT NULL,
  "type" varchar(16) NOT NULL,
  "policy_block" bigint,
  "policy_hash" varchar(66),
  "request_id" text,
  "tx_id" text,
  "hcs_seq" integer,
  "action" jsonb,
  "reason" varchar(32),
  "detail" text
);

CREATE TABLE IF NOT EXISTS "approval_tokens" (
  "token_id" varchar(64) PRIMARY KEY,
  "robot_id" varchar(32) NOT NULL,
  "zone_id" varchar(64) NOT NULL,
  "nonce" varchar(64) NOT NULL,
  "request_id" text NOT NULL,
  "issued_at_ms" bigint NOT NULL,
  "consumed" boolean NOT NULL DEFAULT false,
  "consumed_at_ms" bigint,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "pending_actions" (
  "action_id" varchar(64) PRIMARY KEY,
  "robot_id" varchar(32) NOT NULL,
  "zone_id" varchar(64) NOT NULL,
  "route_hash" varchar(66) NOT NULL,
  "request_id" text NOT NULL,
  "nonce" varchar(64) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "spend_records" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "idempotency_key" varchar(128) NOT NULL UNIQUE,
  "robot_id" varchar(32) NOT NULL,
  "leg_id" varchar(64) NOT NULL,
  "amount_atomic" varchar(32) NOT NULL,
  "tx_id" text,
  "hcs_seq" integer,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "failure_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "settled_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "robots_status_idx" ON "robots" ("status");
CREATE INDEX IF NOT EXISTS "robots_ens_status_idx" ON "robots" ("ens_status");
CREATE INDEX IF NOT EXISTS "episodes_robot_idx" ON "episodes" ("robot_id");
CREATE INDEX IF NOT EXISTS "episodes_state_idx" ON "episodes" ("state");
CREATE UNIQUE INDEX IF NOT EXISTS "episode_logs_episode_seq_unique" ON "episode_logs" ("episode_id", "seq");
CREATE INDEX IF NOT EXISTS "episode_logs_episode_idx" ON "episode_logs" ("episode_id");
CREATE INDEX IF NOT EXISTS "episode_logs_type_idx" ON "episode_logs" ("type");
CREATE UNIQUE INDEX IF NOT EXISTS "approval_tokens_nonce_unique" ON "approval_tokens" ("nonce");
CREATE INDEX IF NOT EXISTS "approval_tokens_robot_zone_idx" ON "approval_tokens" ("robot_id", "zone_id");
CREATE INDEX IF NOT EXISTS "pending_actions_robot_idx" ON "pending_actions" ("robot_id");
CREATE INDEX IF NOT EXISTS "pending_actions_status_idx" ON "pending_actions" ("status");
CREATE INDEX IF NOT EXISTS "spend_records_robot_idx" ON "spend_records" ("robot_id");
CREATE INDEX IF NOT EXISTS "spend_records_status_idx" ON "spend_records" ("status");
`;

  await client.query(ddl);
  const names = (
    await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name",
    )
  ).rows.map((r: { table_name: string }) => r.table_name);
  console.log("tables now:", names.join(", "));
  await client.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
