/*************************************************************************************************************************************
 * Dabbawala Protocol — Shared Types
 *
 * These types are the frozen interface agreed in ROADMAP.md §4.5.
 * They must not be changed without human approval.
 * Every boundary in the system validates against these schemas (zod).
 * ref: ROADMAP.md §4.5, §4.6, §4.3
 *************************************************************************************************************************************/

// ── Robot identity ────────────────────────────────────────────────────────────
export type RobotId = "ramu" | "sakhu" | "janu";

export const ROBOT_IDS: readonly RobotId[] = ["ramu", "sakhu", "janu"] as const;

/** ENS display names. ref: implementation.md §2 */
export const ROBOT_ENS_NAMES: Readonly<Record<RobotId, string>> = {
  ramu: "ramu.dabbawala.eth",
  sakhu: "sakhu.dabbawala.eth",
  janu: "janu.dabbawala.eth",
} as const;

/** Zones each robot may enter. ref: implementation.md §2 */
export const ROBOT_ZONES: Readonly<Record<RobotId, readonly string[]>> = {
  ramu: ["mahim", "dadar", "churchgate"],
  sakhu: ["mahim", "dadar"],
  janu: ["docks-r2"],
} as const;

/**
 * Sim budget in microHbar per robot.
 * OQ-1 HYPOTHESIS: interim display unit; Spend Controller keeps USDC-atomic.
 * Conversion is centralised here per implementation.md §4.3.
 * ref: implementation.md §4.3
 */
export const ROBOT_BUDGET_MICRO_HBAR: Readonly<Record<RobotId, number>> = {
  ramu: 5000,
  sakhu: 5000,
  janu: 5000,
} as const;

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
export const ACTION_TYPES: readonly ActionType[] = ["continue", "reroute", "handoff", "ask_human"] as const;

// ── Policy snapshot ───────────────────────────────────────────────────────────

/**
 * Block-stamped policy snapshot read from ENS. The policy engine must validate every action against a fresh snapshot.
 * Cache TTL: 10-15 s. ref: ROADMAP.md §4.9, invariant §4.3.3
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

// ── Ens record writes ──────────────────────────────────────────────────────────

/** A single record write submitted to a resolver. ref: ENSv2_implementation.md §5 */
export type EnsRecordWrite = {
  readonly name: string;
  readonly key: string;
  readonly value: string;
  readonly coinType?: number;
};

/** A text record read back from a resolver. */
export type EnsTextRecord = {
  readonly key: string;
  readonly value: string;
};

/** An address record read back from a resolver (coinType 60 = ETH). */
export type EnsAddressRecord = {
  readonly coinType: number;
  readonly address: string;
};

/** The complete record bundle served by a resolver for one name. */
export type EnsRecordBundle = {
  readonly name?: string;
  readonly text?: readonly EnsTextRecord[];
  readonly addresses?: readonly EnsAddressRecord[];
  readonly contenthash?: string;
  readonly data?: readonly { readonly key: string; readonly value: string }[];
};

// ── ENS policy snapshot ──────────────────────────────────────────────────────

/**
 * The full set of records read from one robot's resolver in a single
 * block-stamped pass. Every consumer of ENS data goes through this shape.
 * ref: ENSv2_implementation.md §4, ROADMAP.md §4.5
 */
export type EnforcedPolicy = {
  readonly robotId: RobotId;
  readonly ensName: string;
  readonly resolver: string;
  readonly zones: readonly string[];
  readonly budgetAtomic: string;
  readonly status: "active" | "paused";
  readonly lastEpisode: string | null;
  readonly hederaAccount: string | null;
  readonly eacVersionId?: number;
  readonly block: bigint;
  readonly valuesHash: string;
  readonly readAtMs: number;
  readonly source: "sim" | "live";
};

// ── Halt reason codes ─────────────────────────────────────────────────────────

/**
 * Halt reason codes. ref: ROADMAP.md §4.4 (PROPOSED; freeze in H0)
 * When a robot halts it must record exactly one of these.
 * Note: ZG_TIMEOUT, ZG_TRANSPORT, ZG_MALFORMED removed per Phase B cleanup.
 */
export type HaltReason =
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

/** All valid halt reasons, as a readonly const array. */
export const HALT_REASONS: readonly HaltReason[] = [
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
];

// ── ENS read failure ─────────────────────────────────────────────────────────

/**
 * Structured failure for an ENS read. Never throw raw strings; callers map
 * this to a 503 ENS_UNREADABLE. ref: ENSv2_implementation.md §5, AGENTS.md §8
 */
export type PolicyReadError = {
  readonly code: "ENS_UNREADABLE" | "ENS_RPC_ERROR" | "ENS_MALFORMED";
  readonly detail: string;
  readonly retryable: boolean;
};

// ── Zone approver allowlist ──────────────────────────────────────────────────

/** One entry in the per-zone approver allowlist. ref: ENSv2_implementation.md §5 */
export type ZoneApproverEntry = {
  readonly approver: string;
  readonly zones: readonly string[];
  readonly label?: string;
};

/** The full per-zone approver allowlist. ref: ROADMAP.md §4.3.8 */
export type ZoneAllowlist = ReadonlyArray<ZoneApproverEntry>;

// ── Core interface signatures ─────────────────────────────────────────────────

/**
 * State summary passed to the Fleet Brain's decide() call.
 * This is a bounded, sanitised view of the robot state - never raw key material.
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

/** Episode log entry types. ref: ROADMAP.md §4.6 */
export type EpisodeEventType =
  | "decision"
  | "payment"
  | "policy_read"
  | "gate"
  | "halt"
  | "resume"
  | "anchor";

/** A single episode log entry (one JSONL line). */
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
  readonly action?: unknown;
  readonly reason?: string;
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

/** Footer line of an episode log file - carries the Merkle root. */
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
export type Result<T, E = Error> = {
  readonly ok: true;
  readonly value: T;
} | {
  readonly ok: false;
  readonly error: E;
};

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** USDC decimals on Hedera testnet. ref: REFERENCES.md F12 */
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

// ── ENS record keys ──────────────────────────────────────────────────────────

/**
 * The text-record keys the Dabbawala Protocol reads and writes on a robot's
 * Permissioned Resolver. ref: ENSv2_implementation.md §4, R-ENS-8
 * (ENSIP-26 is a DRAFT — agent-context / agent-endpoint[web] are provisional).
 */
export const ENS_RECORD_KEYS = {
  ZONES: "zones",
  BUDGET: "budget",
  STATUS: "status",
  LAST_EPISODE: "last-episode",
  HEDERA_ACCOUNT: "hedera-account",
  AGENT_CONTEXT: "agent-context",
  AGENT_ENDPOINT: "agent-endpoint[web]",
} as const;

export type EnsRecordKey = (typeof ENS_RECORD_KEYS)[keyof typeof ENS_RECORD_KEYS];

// ── Permissioned Resolver ──────────────────────────────────────────────────────

/**
 * The ENSv2 Enhanced Access Control role bitmap constants.
 * ref: R-ENS-2, R-ENS-3 (docs.ens.domains/ensv2/permissioned-resolver,
 * /ensv2/enhanced-access-control). VERIFIED against the official pages on
 * 2026-11-05: each role occupies one 4-bit nybble (1 << 4N) and every role has
 * an admin counterpart at (role << 128) on the same resource.
 */
export const ENS_ROLES = {
  ROLE_SET_ADDRESS: 1n << 0n,
  ROLE_SET_TEXT: 1n << 4n,
  ROLE_SET_CONTENTHASH: 1n << 8n,
  ROLE_SET_ABI: 1n << 12n,
  ROLE_SET_NAME: 1n << 20n,
  ROLE_SET_DATA: 1n << 24n,
  ROLE_LINK: 1n << 28n,
  ROLE_CAN_NAME: 1n << 120n,
  ROLE_UPGRADE: 1n << 124n,
} as const;

export type EnsRole = (typeof ENS_ROLES)[keyof typeof ENS_ROLES];

/**
 * ROOT_RESOURCE (0x0) is the contract-wide EAC resource: a role granted there
 * applies on every argument-scoped resource. ref: R-ENS-3, VERIFIED 2026-11-05.
 */
export const ROOT_RESOURCE = 0n as const;

/** Admin role of an ENSv2 EAC role: same 4-bit position, shifted +128. */
export function ensRoleAdmin(role: bigint): bigint {
  return role << 128n;
}

/** Bitmap of every role plus its admin counterpart (admin = role << 128). */
export const ENS_ALL_ROLES =
  0x111111111111111111111111111111111111111111111111111111111111111n;

/** Metadata about a Permissioned Resolver proxy. ref: R-ENS-2 */
export type PermissionedResolverInfo = {
  readonly implementation: string;
  readonly owner: string;
  readonly isEmancipated?: boolean;
  readonly grants?: readonly { readonly account: string; readonly roleBitmap: bigint }[];
};

// ── Zone approver allowlist ──────────────────────────────────────────────────

// (defined above as ZoneApproverEntry and ZoneAllowlist)

// ── ENS read failure ─────────────────────────────────────────────────────────

// (defined above as PolicyReadError)

// ── Gate decision receipt (re-exported for convenience) ───────────────────────

/**
 * GateDecisionReceipt is the single-use token bound to (robot, zone, nonce, 0G request id),
 * TTL <= 60s. ref: ROADMAP.md §4.3.7, §4.11
 * Declared in schemas.ts; kept here as a note that the
 * single-use token is bound to (robot, zone, nonce, 0G request id), TTL <= 60s.
 * ref: ROADMAP.md §4.3.7, §4.11
 */
export type GateDecisionReceipt = {
  readonly robotId: RobotId;
  readonly zoneId: string;
  readonly nonce: string;
  readonly requestId: string;
  readonly expiresAtMs: number;
};

// ── 0G Runtime types ─────────────────────────────────────────────────────────

/**
 * Failure kinds classified by the zero-g-adapter.
 * ref: zero-g-adapter/src/failures.ts
 */
export type FailureKind =
  | "TIMEOUT"
  | "NETWORK"
  | "HTTP_RETRYABLE"
  | "HTTP_FATAL"
  | "BLOCKED"
  | "CONCURRENCY"
  | "INVALID_STATE"
  | "BODY_TOO_LARGE"
  | "NOT_JSON"
  | "BAD_ENVELOPE"
  | "NO_REQUEST_ID"
  | "TEE_UNVERIFIED"
  | "TRUNCATED"
  | "EMPTY_CONTENT"
  | "BAD_PROPOSAL_JSON"
  | "BAD_PROPOSAL_SCHEMA"
  | "ACTION_NOT_IN_SET"
  | "ACTION_UNGROUNDED";

/**
 * Result of a halt, returned when the robot cannot continue.
 * ref: ROADMAP.md §4.3.4
 */
export type Halt = {
  readonly halted: true;
  readonly reason: HaltReason;
  readonly detail: string;
};

// ── 0G Gateway config ─────────────────────────────────────────────────────────

/**
 * Configuration for the 0G Gateway connection.
 * At least one of nodeUrl or privateKey must be provided.
 * ref: zero-g-adapter/src/runtime.ts
 */
export type GatewayConfig = {
  readonly nodeUrl?: string;
  readonly privateKey?: string;
  readonly mode?: "live" | "mock" | "blocked";
};