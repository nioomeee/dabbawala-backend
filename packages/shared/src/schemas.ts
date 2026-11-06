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
  z.object({ type: z.literal("continue") }),
  z.object({ type: z.literal("reroute"), routeId: z.string().min(1) }),
  z.object({ type: z.literal("handoff") }),
  z.object({ type: z.literal("ask_human"), zoneId: z.string().min(1) }),
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

export const EpisodeEventTypeSchema = z.enum([
  "decision",
  "payment",
  "policy_read",
  "gate",
  "halt",
  "resume",
  "anchor",
]);

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