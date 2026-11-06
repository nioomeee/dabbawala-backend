/**
 * Dabbawala Protocol — Database schema (Drizzle ORM)
 *
 * PostgreSQL is the operational database, not the source of truth for blockchain state.
 * ref: user request §15.2
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  bigint,
  varchar,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ── Robots ───────────────────────────────────────────────────────────────────

export const robots = pgTable(
  "robots",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    status: varchar("status", { length: 16 }).notNull().default("idle"),
    currentCell: varchar("current_cell", { length: 64 }).notNull(),
    checkpointIndex: integer("checkpoint_index").notNull().default(0),
    haltReason: varchar("halt_reason", { length: 32 }),
    haltDetail: text("halt_detail"),
    lastPolicyBlock: bigint("last_policy_block", { mode: "bigint" }),
    lastPolicyHash: varchar("last_policy_hash", { length: 66 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("robots_status_idx").on(t.status)],
);

// ── Episodes ─────────────────────────────────────────────────────────────────

export const episodes = pgTable(
  "episodes",
  {
    episodeId: varchar("episode_id", { length: 64 }).primaryKey(),
    robotId: varchar("robot_id", { length: 32 })
      .notNull()
      .references(() => robots.id),
    seed: varchar("seed", { length: 128 }).notNull(),
    scenario: varchar("scenario", { length: 64 }).notNull(),
    state: varchar("state", { length: 16 }).notNull().default("local"),
    rootHash: varchar("root_hash", { length: 66 }),
    storageRef: text("storage_ref"),
    relayLedgerAddress: varchar("relay_ledger_address", { length: 42 }),
    anchorTxId: text("anchor_tx_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("episodes_robot_idx").on(t.robotId), index("episodes_state_idx").on(t.state)],
);

// ── Episode log entries ───────────────────────────────────────────────────────

export const episodeLogs = pgTable(
  "episode_logs",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    episodeId: varchar("episode_id", { length: 64 })
      .notNull()
      .references(() => episodes.episodeId),
    seq: integer("seq").notNull(),
    tsMs: bigint("ts_ms", { mode: "number" }).notNull(),
    robotId: varchar("robot_id", { length: 32 }).notNull(),
    type: varchar("type", { length: 16 }).notNull(),
    policyBlock: bigint("policy_block", { mode: "bigint" }),
    policyHash: varchar("policy_hash", { length: 66 }),
    requestId: text("request_id"),
    txId: text("tx_id"),
    hcsSeq: integer("hcs_seq"),
    action: jsonb("action"),
    reason: varchar("reason", { length: 32 }),
    detail: text("detail"),
  },
  (t) => [
    uniqueIndex("episode_logs_episode_seq_unique").on(t.episodeId, t.seq),
    index("episode_logs_episode_idx").on(t.episodeId),
    index("episode_logs_type_idx").on(t.type),
  ],
);

// ── Approval tokens ───────────────────────────────────────────────────────────

export const approvalTokens = pgTable(
  "approval_tokens",
  {
    tokenId: varchar("token_id", { length: 64 }).primaryKey(),
    robotId: varchar("robot_id", { length: 32 }).notNull(),
    zoneId: varchar("zone_id", { length: 64 }).notNull(),
    nonce: varchar("nonce", { length: 64 }).notNull(),
    requestId: text("request_id").notNull(),
    issuedAtMs: bigint("issued_at_ms", { mode: "number" }).notNull(),
    consumed: boolean("consumed").notNull().default(false),
    consumedAtMs: bigint("consumed_at_ms", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("approval_tokens_nonce_unique").on(t.nonce),
    index("approval_tokens_robot_zone_idx").on(t.robotId, t.zoneId),
  ],
);

// ── Pending actions (Gatekeeper) ──────────────────────────────────────────────

export const pendingActions = pgTable(
  "pending_actions",
  {
    actionId: varchar("action_id", { length: 64 }).primaryKey(),
    robotId: varchar("robot_id", { length: 32 }).notNull(),
    zoneId: varchar("zone_id", { length: 64 }).notNull(),
    routeHash: varchar("route_hash", { length: 66 }).notNull(),
    requestId: text("request_id").notNull(),
    nonce: varchar("nonce", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pending_actions_robot_idx").on(t.robotId),
    index("pending_actions_status_idx").on(t.status),
  ],
);

// ── Spend records (outbox pattern) ────────────────────────────────────────────

export const spendRecords = pgTable(
  "spend_records",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull().unique(),
    robotId: varchar("robot_id", { length: 32 }).notNull(),
    legId: varchar("leg_id", { length: 64 }).notNull(),
    amountAtomic: varchar("amount_atomic", { length: 32 }).notNull(),
    txId: text("tx_id"),
    hcsSeq: integer("hcs_seq"),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("spend_records_robot_idx").on(t.robotId),
    index("spend_records_status_idx").on(t.status),
  ],
);

