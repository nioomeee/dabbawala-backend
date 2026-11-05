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
  z.object({ type: z.literal("continue") }),
  z.object({ type: z.literal("reroute"), routeId: z.string().min(1) }),
  z.object({ type: z.literal("handoff") }),
  z.object({ type: z.literal("ask_human"), zoneId: z.string().min(1) }),
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

export const EpisodeEventTypeSchema = z.enum([
  "decision",
  "payment",
  "policy_read",
  "gate",
  "halt",
  "resume",
  "anchor",
]);

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

