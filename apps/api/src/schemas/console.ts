/**
 * Zod schemas for the console API boundary.
 *
 * Mirrors dabbawala-frontend/src/app/console/data/types.ts and
 * services/consoleApi.ts (EpisodeLog) EXACTLY — shapes are frozen by
 * dabbawala-frontend/docs/CONSOLE_ENDPOINTS.md §1. No renaming, no extra
 * fields: the frontend validates responses with zod at the boundary when
 * the backend lands.
 * ref: implementation.md §4 D4, AGENTS.md §8
 */

import { z } from "zod";
import { ROBOT_IDS, type RobotId } from "@dabbawala/shared";

// ── RobotId ──────────────────────────────────────────────────────────────────

/** ramu | sakhu | janu. ref: implementation.md §2 (frontend names final). */
export const RobotIdSchema = z.enum(ROBOT_IDS as [RobotId, ...RobotId[]]);

// ── Action (closed set + halt, exactly as frontend data/types.ts) ───────────

const HaltReasonSchema = z.enum([
  "ZG_TIMEOUT",
  "ZG_TRANSPORT",
  "ZG_MALFORMED",
  "ACTION_NOT_ALLOWED",
  "ENS_UNREADABLE",
  "POLICY_PAUSED",
  "BUDGET_EXHAUSTED",
  "PAYEE_NOT_ALLOWED",
  "OVER_CAP",
  "FACILITATOR_DOWN",
  "GATE_DENIED",
  "APPROVAL_EXPIRED",
  "APPROVAL_REPLAYED",
  "ZONE_REMOVED",
])

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("continue") }),
  z.object({ type: z.literal("reroute"), routeId: z.string() }),
  z.object({ type: z.literal("handoff") }),
  z.object({ type: z.literal("ask_human"), zoneId: z.string() }),
  /** Frontend-only variant used by the console board; the backend Policy
   * Gate never PROPOSES halt — it is step data only. */
  z.object({ type: z.literal("halt"), reason: HaltReasonSchema }),
]);

export type Action = z.infer<typeof ActionSchema>;

// ── Checkpoints (frontend Checkpoint) ────────────────────────────────────────

export const CheckpointSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["ens_policy", "hedera_payment", "human_gate", "relay", "delivery"]),
  coordinates: z.object({ x: z.number(), y: z.number() }),
  status: z.enum(["pending", "passed", "halted"]),
});

// ── Robot lane (frontend RobotLane) ─────────────────────────────────────────

export const RouteWaypointSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  label: z.string().optional(),
});

export const RobotLaneSchema = z.object({
  robotId: RobotIdSchema,
  role: z.string(),
  route: z.array(RouteWaypointSchema),
  stepCallouts: z.array(z.string()),
});

// ── Proof receipt (frontend ProofReceipt) ────────────────────────────────────

export const ProofReceiptSchema = z.object({
  id: z.string(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  title: z.string(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  status: z.enum(["verified", "pending", "failed"]),
  hash: z.string().optional(),
});

// ── Gate request (frontend GateRequest — status REQUIRED) ───────────────────

export const GateRequestSchema = z.object({
  id: z.string().min(1),
  robotId: RobotIdSchema,
  zoneId: z.string(),
  nonce: z.string(),
  ttlMs: z.number().int().positive(),
  status: z.enum(["pending", "approved", "denied", "expired"]),
});

export type GateRequest = z.infer<typeof GateRequestSchema>;

// ── Scenario step + test case (frontend ScenarioStep / ScenarioTestCase) ────

export const ScenarioStepSchema = z.object({
  checkpointId: z.string(),
  action: ActionSchema,
  expectedProofs: z.array(ProofReceiptSchema),
  gateRequest: GateRequestSchema.optional(),
  /** When action is a halt, which robot the Policy Gate stops. Optional —
   * omitted = the lead robot. */
  haltTarget: RobotIdSchema.optional(),
});

export const ScenarioTestCaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  track: z.enum(["0G", "Hedera", "ENS", "Integration"]),
  leadRobot: RobotIdSchema,
  lanes: z.record(RobotIdSchema, RobotLaneSchema),
  checkpoints: z.array(CheckpointSchema),
  steps: z.array(ScenarioStepSchema),
  expectedOutcome: z.enum(["DELIVERED", "REROUTED", "HALTED", "REFUSED"]),
});

export type ScenarioTestCase = z.infer<typeof ScenarioTestCaseSchema>;

// ── Passport (frontend RobotPassport — exact shape, NO stale field; the
//    15 s staleness rule (invariant §4.3.11/12) is enforced consumer-side
//    from block.scannedAtMs) ─────────────────────────────────────────────────

export const RobotPassportSchema = z.object({
  robotId: RobotIdSchema,
  ensName: z.string(),
  owner: z.string(),
  resolver: z.string().nullable(),
  zones: z.array(z.string()),
  /** microHbar display unit. OQ-1 HYPOTHESIS: interim conversion from atomic. */
  budgetMicroHbar: z.number().int().nonnegative(),
  status: z.enum(["active", "paused"]),
  lastEpisode: z.string().nullable(),
  block: z.object({
    number: z.number().int().nonnegative(),
    hash: z.string(),
    scannedAtMs: z.number().int().positive(),
  }),
  source: z.enum(["sim", "live"]),
});

export type RobotPassport = z.infer<typeof RobotPassportSchema>;

// ── Gate decision ────────────────────────────────────────────────────────────

export const GateDecisionBodySchema = z.object({
  request: GateRequestSchema,
  decision: z.enum(["approved", "denied"]),
});

export const GateDecisionReceiptSchema = z.object({
  requestId: z.string(),
  decision: z.enum(["approved", "denied"]),
  /** Single-use token; null on denied or error. */
  token: z.string().nullable(),
  ttlMs: z.number().int().nonnegative(),
  decidedAtMs: z.number().int().positive(),
  source: z.enum(["sim", "live"]),
});

export type GateDecisionReceipt = z.infer<typeof GateDecisionReceiptSchema>;

// ── Episode log (frontend consoleApi.ts EpisodeLog — robots/steps are
//    unknown[], verdict and haltReason are string | null) ────────────────────

export const EpisodeLogSchema = z.object({
  schema: z.literal("dabbawala.console.replay/v1"),
  scenario: z.string(),
  seed: z.string(),
  exportedAtMs: z.number().int().nonnegative(),
  simulated: z.boolean(),
  robots: z.array(z.unknown()),
  steps: z.array(z.unknown()),
  verdict: z.string().nullable(),
  haltReason: z.string().nullable(),
});

export type EpisodeLog = z.infer<typeof EpisodeLogSchema>;
