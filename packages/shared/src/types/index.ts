/**
 * Dabbawala Protocol — Shared Types
 *
 * These types are the frozen interface agreed in ROADMAP.md §4.5.
 * They must not be changed without human approval.
 * Every boundary in the system validates against these schemas (zod).
 *
 * ref: ROADMAP.md §4.5, §4.6, §4.4
 */

// ── Robot identity ────────────────────────────────────────────────────────────

/** The three robots in the Mumbai demo. ref: ROADMAP.md §4.5 */
export type RobotId = "andheri-01" | "bandra-02" | "colaba-03";

export const ROBOT_IDS: readonly RobotId[] = [
  "andheri-01",
  "bandra-02",
  "colaba-03",
] as const;

// ── Closed action set ─────────────────────────────────────────────────────────

/**
 * The complete, closed set of actions the Fleet Brain may propose.
 * Any action not in this set is treated as a halt. ref: ROADMAP.md §4.5, invariant §4.3.2
 */
export type Action =
  | { readonly type: "continue" }
  | { readonly type: "reroute"; readonly routeId: string }
  | { readonly type: "handoff" }
  | { readonly type: "ask_human"; readonly zoneId: string };

export type ActionType = Action["type"];

export const ACTION_TYPES: readonly ActionType[] = [
  "continue",
  "reroute",
  "handoff",
  "ask_human",
] as const;

// ── Policy snapshot ───────────────────────────────────────────────────────────

/**
 * Block-stamped policy snapshot read from ENS.
 * The policy engine must validate every action against a fresh snapshot.
 * Cache TTL: 10–15 s. ref: ROADMAP.md §4.9, invariant §4.3.3
 */
export type PolicySnapshot = {
  readonly robotId: RobotId;
  readonly zones: readonly string[];
  /** Integer string; USDC has 6 decimals. ref: REFERENCES.md §3 F12 */
  readonly budgetAtomic: string;
  readonly status: "active" | "paused";
  /** ENS read block number. ref: ROADMAP.md §4.3.12 */
  readonly block: bigint;
  /** Hash of the values read; used for epoch comparison. */
  readonly valuesHash: string;
  readonly readAtMs: number;
};

// ── Halt reason codes ─────────────────────────────────────────────────────────

/**
 * Halt reason codes. ref: ROADMAP.md §4.4 (PROPOSED; freeze in H0)
 * When a robot halts it must record exactly one of these.
 */
export type HaltReason =
  | "ZG_TIMEOUT"
  | "ZG_TRANSPORT"
  | "ZG_MALFORMED"
  | "ACTION_NOT_ALLOWED"
  | "ENS_UNREADABLE"
  | "POLICY_PAUSED"
  | "BUDGET_EXHAUSTED"
  | "PAYEE_NOT_ALLOWED"
  | "OVER_CAP"
  | "FACILITATOR_DOWN"
  | "GATE_DENIED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_REPLAYED"
  | "ZONE_REMOVED";

export const HALT_REASONS: readonly HaltReason[] = [
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
] as const;

export type Halt = {
  readonly halted: true;
  readonly reason: HaltReason;
  readonly detail?: string;
};

// ── Core interface signatures ─────────────────────────────────────────────────

/**
 * State summary passed to the Fleet Brain's decide() call.
 * This is a bounded, sanitised view of the robot state — never raw key material.
 * ref: ROADMAP.md §4.5, invariant §4.3.6
 */
export type StateSummary = {
  readonly robotId: RobotId;
  readonly currentCell: string;
  readonly heading: string;
  readonly checkpointIndex: number;
  readonly totalCheckpoints: number;
  readonly availableRoutes: readonly string[];
  readonly restrictedZones: readonly string[];
  readonly remainingBudgetAtomic: string;
  readonly scenarioHints: readonly string[];
  readonly seed: string;
};

/**
 * Result of the Fleet Brain's decide() call.
 * ref: ROADMAP.md §4.5 interface B
 */
export type DecideResult =
  | { readonly action: Action; readonly requestId: string }
  | Halt;

/**
 * Result of buying route intel via x402.
 * ref: ROADMAP.md §4.5 interface C
 */
export type BuyIntelResult =
  | { readonly intel: unknown; readonly txId: string }
  | { readonly refused: true; readonly ruleId: string };

/**
 * Result of applying a validated action to the robot.
 * ref: ROADMAP.md §4.5 interface A
 */
export type ApplyResult =
  | { readonly applied: true; readonly newCell: string }
  | { readonly applied: false; readonly reason: string };

// ── Episode log schema ────────────────────────────────────────────────────────

/**
 * Episode log entry types. ref: ROADMAP.md §4.6
 */
export type EpisodeEventType =
  | "decision"
  | "payment"
  | "policy_read"
  | "gate"
  | "halt"
  | "resume"
  | "anchor";

/**
 * A single episode log entry (one JSON object per JSONL line).
 * The verifier re-hashes the whole file and compares with the RelayLedger root.
 * ref: ROADMAP.md §4.6, §4.7
 */
export type EpisodeLogEntry = {
  readonly seq: number;
  readonly tsMs: number;
  readonly robotId: RobotId;
  readonly type: EpisodeEventType;
  readonly policyBlock?: bigint;
  readonly policyHash?: string;
  readonly requestId?: string;
  readonly txId?: string;
  readonly hcsSeq?: number;
  readonly action?: Action;
  readonly reason?: HaltReason;
  readonly detail?: string;
};

/** Header line of an episode log file. */
export type EpisodeLogHeader = {
  readonly type: "header";
  readonly schemaVersion: "1.0";
  readonly seed: string;
  readonly scenario: string;
  readonly robotId: RobotId;
  readonly startedAtMs: number;
};

/** Footer line of an episode log file — carries the Merkle root. */
export type EpisodeLogFooter = {
  readonly type: "footer";
  readonly seq: number;
  readonly rootHash: string;
  readonly episodeId: string;
  readonly anchoredOnChain: boolean;
  readonly relayLedgerAddress?: string;
};

/** Episode storage state. ref: ROADMAP.md §B-3 */
export type EpisodeState = "local" | "stored" | "anchored" | "verified" | "unanchored";

// ── Typed result objects ──────────────────────────────────────────────────────

/**
 * Standard typed Result type used throughout the system.
 * Never throw unhandled strings or generic errors. ref: AGENTS.md §8
 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** USDC decimals on Hedera testnet. ref: REFERENCES.md F12, R-HE-2 */
export const USDC_DECIMALS = 6 as const;

/** Approval token TTL in milliseconds. ref: ROADMAP.md §4.3.7, §4.11 */
export const APPROVAL_TOKEN_TTL_MS = 60_000 as const;

/** Pending action expiry in milliseconds. ref: ROADMAP.md §4.11 */
export const PENDING_ACTION_EXPIRY_MS = 120_000 as const;

/** Policy stale threshold in milliseconds. ref: ROADMAP.md §4.3.12 */
export const POLICY_STALE_AFTER_MS = 15_000 as const;

/** Maximum policy cache TTL in milliseconds. ref: ROADMAP.md §4.9 */
export const POLICY_CACHE_MAX_TTL_MS = 15_000 as const;

/** Maximum 0G retry count before halt. ref: ROADMAP.md §4.3.4 */
export const ZERO_G_MAX_RETRIES = 1 as const;

/** Episode log schema version. ref: ROADMAP.md §4.6 */
export const EPISODE_LOG_SCHEMA_VERSION = "1.0" as const;

