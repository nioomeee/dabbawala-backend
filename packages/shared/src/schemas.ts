<<<<<<< HEAD
import { z } from "zod";
import {
  HALT_REASONS,
  ROBOT_IDS,
  type Action,
  type HaltReason,
  type RobotId,
  type PolicySnapshot,
  type StateSummary,
  type EpisodeLogEntry,
  type EnforcedPolicy,
  type EnsRecordWrite,
  type EnsTextRecord,
  type EnsAddressRecord,
  type EnsRecordBundle,
  type ZoneApproverEntry,
  type ZoneAllowlist,
  type PolicyReadError,
} from "./types/index.js";

export const RobotIdSchema = z.enum(ROBOT_IDS as [RobotId, ...RobotId[]]);

export const ActionSchema = z.discriminatedUnion("type", [
=======
/**
 * Dabbawala Protocol — Zod schemas for runtime validation
 *
 * Every external boundary must validate through these schemas.
 * ref: AGENTS.md §8, ROADMAP.md §4.5
 */

import { z } from "zod";
import {
  ACTION_TYPES,
  HALT_REASONS,
  ROBOT_IDS,
  type Action,
  type EpisodeLogEntry,
  type HaltReason,
  type PolicySnapshot,
  type RobotId,
  type StateSummary,
} from "./types/index.js";

// ── Robot identity ────────────────────────────────────────────────────────────

export const RobotIdSchema = z.enum(ROBOT_IDS as [RobotId, ...RobotId[]]);

// ── Closed action set ─────────────────────────────────────────────────────────

export const ActionSchema: z.ZodType<Action> = z.discriminatedUnion("type", [
>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf
  z.object({ type: z.literal("continue") }),
  z.object({ type: z.literal("reroute"), routeId: z.string().min(1) }),
  z.object({ type: z.literal("handoff") }),
  z.object({ type: z.literal("ask_human"), zoneId: z.string().min(1) }),
<<<<<<< HEAD
]) as z.ZodType<Action>;

export const HaltReasonSchema = z.enum(HALT_REASONS as [HaltReason, ...HaltReason[]]);

export const PolicySnapshotSchema = z.object({
  robotId: RobotIdSchema,
  zones: z.array(z.string()),
  budgetAtomic: z.string(),
  status: z.enum(["active", "paused"]),
  block: z.bigint(),
  valuesHash: z.string(),
  readAtMs: z.number(),
}) as z.ZodType<PolicySnapshot>;

export const StateSummarySchema = z.object({
  robotId: RobotIdSchema,
  currentCell: z.string(),
  heading: z.string(),
  checkpointIndex: z.number(),
  totalCheckpoints: z.number(),
  availableRoutes: z.array(z.string()),
  restrictedZones: z.array(z.string()),
  remainingBudgetAtomic: z.string(),
  scenarioHints: z.array(z.string()),
  seed: z.string(),
}) as z.ZodType<StateSummary>;
=======
]);

// ── Halt ──────────────────────────────────────────────────────────────────────

export const HaltReasonSchema = z.enum(HALT_REASONS as [HaltReason, ...HaltReason[]]);

export const HaltSchema = z.object({
  halted: z.literal(true),
  reason: HaltReasonSchema,
  detail: z.string().optional(),
});

// ── Policy snapshot ───────────────────────────────────────────────────────────

export const PolicySnapshotSchema: z.ZodType<PolicySnapshot> = z.object({
  robotId: RobotIdSchema,
  zones: z.array(z.string()).readonly(),
  budgetAtomic: z.string().regex(/^\d+$/, "Must be a non-negative integer string"),
  status: z.enum(["active", "paused"]),
  block: z.bigint().nonnegative(),
  valuesHash: z.string().min(1),
  readAtMs: z.number().int().positive(),
});

// ── State summary ─────────────────────────────────────────────────────────────

export const StateSummarySchema: z.ZodType<StateSummary> = z.object({
  robotId: RobotIdSchema,
  currentCell: z.string().min(1),
  heading: z.string().min(1),
  checkpointIndex: z.number().int().nonnegative(),
  totalCheckpoints: z.number().int().positive(),
  availableRoutes: z.array(z.string()).readonly(),
  restrictedZones: z.array(z.string()).readonly(),
  remainingBudgetAtomic: z.string().regex(/^\d+$/),
  scenarioHints: z.array(z.string()).readonly(),
  seed: z.string().min(1),
});

// ── Episode log ───────────────────────────────────────────────────────────────
>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf

export const EpisodeEventTypeSchema = z.enum([
  "decision",
  "payment",
  "policy_read",
  "gate",
  "halt",
  "resume",
  "anchor",
]);

<<<<<<< HEAD
export const EpisodeLogEntrySchema = z.object({
  seq: z.number(),
  tsMs: z.number(),
  robotId: RobotIdSchema,
  type: EpisodeEventTypeSchema,
  policyBlock: z.bigint().optional(),
  policyHash: z.string().optional(),
  requestId: z.string().optional(),
  txId: z.string().optional(),
  hcsSeq: z.number().optional(),
  action: z.unknown().optional(),
  reason: z.string().optional(),
  detail: z.string().optional(),
}) as z.ZodType<EpisodeLogEntry>;

// ── ENS record writes ────────────────────────────────────────────────────────

export const EnsRecordWriteSchema = z.object({
  name: z.string(),
  key: z.string(),
  value: z.string(),
  coinType: z.number().optional(),
}) as z.ZodType<EnsRecordWrite>;

export const EnsTextRecordSchema = z.object({
  key: z.string(),
  value: z.string(),
}) as z.ZodType<EnsTextRecord>;

export const EnsAddressRecordSchema = z.object({
  coinType: z.number(),
  address: z.string(),
}) as z.ZodType<EnsAddressRecord>;

export const EnsRecordBundleSchema = z.object({
  name: z.string().optional(),
  text: z.array(EnsTextRecordSchema).optional(),
  addresses: z.array(EnsAddressRecordSchema).optional(),
  contenthash: z.string().optional(),
  data: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .optional(),
}) as z.ZodType<EnsRecordBundle>;

// ── EnforcedPolicy (block-stamped ENS policy snapshot) ────────────────────────

export const EnforcedPolicySchema = z.object({
  robotId: RobotIdSchema,
  ensName: z.string(),
  resolver: z.string(),
  zones: z.array(z.string()),
  budgetAtomic: z.string().regex(/^\d+$/, "Must be a non-negative integer string"),
  status: z.enum(["active", "paused"]),
  lastEpisode: z.string().nullable(),
  hederaAccount: z.string().nullable(),
  eacVersionId: z.number().optional(),
  block: z.bigint().nonnegative(),
  valuesHash: z.string(),
  /** Non-negative (not strictly positive) so the documented fail-closed
   * snapshot with readAtMs: 0 / block: 0n validates. ref: ENSv2 plan Phase 2 */
  readAtMs: z.number().int().nonnegative(),
  source: z.enum(["sim", "live"]),
}) as z.ZodType<EnforcedPolicy>;

// ── Zone approver allowlist ──────────────────────────────────────────────────

export const ZoneApproverEntrySchema = z.object({
  approver: z.string(),
  zones: z.array(z.string()),
  label: z.string().optional(),
}) as z.ZodType<ZoneApproverEntry>;

export const ZoneAllowlistSchema = z.array(ZoneApproverEntrySchema) as z.ZodType<ZoneAllowlist>;

// ── ENS read failure ─────────────────────────────────────────────────────────

export const PolicyReadErrorSchema = z.object({
  code: z.enum(["ENS_UNREADABLE", "ENS_RPC_ERROR", "ENS_MALFORMED"]),
  detail: z.string(),
  retryable: z.boolean(),
}) as z.ZodType<PolicyReadError>;
=======
export const EpisodeLogEntrySchema: z.ZodType<EpisodeLogEntry> = z.object({
  seq: z.number().int().nonnegative(),
  tsMs: z.number().int().positive(),
  robotId: RobotIdSchema,
  type: EpisodeEventTypeSchema,
  policyBlock: z.bigint().nonnegative().optional(),
  policyHash: z.string().optional(),
  requestId: z.string().optional(),
  txId: z.string().optional(),
  hcsSeq: z.number().int().nonnegative().optional(),
  action: ActionSchema.optional(),
  reason: HaltReasonSchema.optional(),
  detail: z.string().optional(),
});

// ── Decide result ─────────────────────────────────────────────────────────────

export const DecideResultSchema = z.union([
  z.object({
    action: ActionSchema,
    requestId: z.string().min(1),
  }),
  HaltSchema,
]);

// ── Buy intel result ──────────────────────────────────────────────────────────

export const BuyIntelResultSchema = z.union([
  z.object({
    intel: z.unknown(),
    txId: z.string().min(1),
  }),
  z.object({
    refused: z.literal(true),
    ruleId: z.string().min(1),
  }),
]);

// ── Apply result ──────────────────────────────────────────────────────────────

export const ApplyResultSchema = z.union([
  z.object({ applied: z.literal(true), newCell: z.string().min(1) }),
  z.object({ applied: z.literal(false), reason: z.string().min(1) }),
]);

>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf
