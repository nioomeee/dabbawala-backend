/**
 * Adapter-local types: failure taxonomy, provenance record, transport port.
 *
 * Nothing here changes @dabbawala/shared. `DecideResult` stays frozen; richer
 * data (provider, model, latency, status, TEE flag) travels in
 * `ProvenanceRecord`, delivered through a sink and `decideWithProvenance`.
 *
 * ref: ROADMAP.md §4.3 invariants 2, 4, 7; §4.4 halt codes.
 */

import type { Action, DecideResult, HaltReason } from "@dabbawala/shared";

/** Operating mode attached to every record. MOCK is never LIVE evidence. */
export type RecordMode = "LIVE" | "MOCK";

/**
 * Every way a single 0G attempt can fail. Mapped to the frozen halt-reason set
 * by `haltReasonFor`. Free-form model text is never copied into a failure.
 */
export type FailureKind =
  | "BLOCKED" //            adapter not configured (no network call made)
  | "INVALID_STATE" //      caller's StateSummary invalid/oversized (no call made)
  | "CONCURRENCY" //        local in-flight limit reached (no call made)
  | "NETWORK" //            DNS/TLS/connection/reset
  | "HTTP_RETRYABLE" //     429 / 500 / 502 / 504
  | "HTTP_FATAL" //         400 / 401 / 402 / 403 / 404 / 503 / other non-2xx
  | "BODY_TOO_LARGE" //     response exceeded maxResponseBytes
  | "NOT_JSON" //           2xx body is not JSON
  | "BAD_ENVELOPE" //       JSON but not a chat-completion envelope
  | "NO_REQUEST_ID" //      neither ZG-Res-Key nor body.id usable
  | "TEE_UNVERIFIED" //     verify_tee requested but tee_verified !== true
  | "TRUNCATED" //         finish_reason=length
  | "EMPTY_CONTENT" //     no assistant content
  | "BAD_PROPOSAL_JSON" // content is not a JSON object
  | "BAD_PROPOSAL_SCHEMA" // JSON object fails the strict action schema
  | "ACTION_NOT_IN_SET" // `type` is not one of the closed action types
  | "ACTION_UNGROUNDED"; // routeId/zoneId not offered in the state summary

export interface AttemptRecord {
  readonly attempt: 1 | 2;
  readonly startedAtMs: number;
  /** Monotonic wall time of the attempt, including body read. */
  readonly latencyMs: number;
  /** HTTP status, or null if no response (timeout/network). */
  readonly httpStatus: number | null;
  readonly outcome: "OK" | FailureKind;
  /** ZG-Res-Key header (chatID used for independent TEE verification). */
  readonly zgResKey: string | null;
  /** x_0g_trace.request_id: Router-side request id for support tickets. */
  readonly routerRequestId: string | null;
  /** x_0g_trace.provider: on-chain address of the serving provider. */
  readonly provider: string | null;
  readonly modelRequested: string;
  readonly modelReturned: string | null;
  /** Router's verdict. null = not reported/not requested (e.g. MOCK). */
  readonly teeVerified: boolean | null;
  /** Router error.type / error.code (sanitised, length-capped). */
  readonly errorType: string | null;
  readonly errorCode: string | null;
  /** x_0g_trace.billing.total_cost in neuron, as returned (string). */
  readonly totalCostNeuron: string | null;
  readonly retryAfterMs: number | null;
}

export type ProvenanceFinal =
  | {
      readonly outcome: "PROPOSAL";
      readonly requestId: string;
      readonly action: Action;
    }
  | {
      readonly outcome: "HALT";
      readonly reason: HaltReason;
      readonly failure: FailureKind;
      /** Stable `OG_*` operator diagnosis (never model text). */
      readonly failureCode?: string;
      /** Request id of the last attempt that returned one, for audit. */
      readonly requestId: string | null;
    };

export interface ProvenanceRecord {
  readonly schema: "dabbawala.0g-provenance/v1";
  /** Local uuid for this decide() call. Not a 0G identifier. */
  readonly recordId: string;
  readonly mode: RecordMode;
  readonly robotId: string;
  /** Simulation seed from the StateSummary. */
  readonly seed: string;
  readonly checkpointIndex: number;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  /** Full endpoint URL that was (or would have been) called. */
  readonly endpoint: string;
  /** sha256 hex of the exact JSON request body sent. Null if none was built. */
  readonly requestSha256: string | null;
  /** sha256 hex of the assistant content that was parsed. Null if none. */
  readonly responseContentSha256: string | null;
  readonly attempts: readonly AttemptRecord[];
  readonly final: ProvenanceFinal;
}

export interface ZeroGDecision {
  readonly result: DecideResult;
  readonly provenance: ProvenanceRecord;
}

export interface ProvenanceSink {
  record(entry: ProvenanceRecord): void;
}

/** Minimal logger port (pino-compatible). Callers must not pass secrets. */
export interface AdapterLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export const NOOP_LOGGER: AdapterLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface Clock {
  /** Wall-clock epoch ms. */
  nowMs(): number;
  /** Monotonic ms for latency measurement. */
  monotonicMs(): number;
  sleep(ms: number): Promise<void>;
}

export const SYSTEM_CLOCK: Clock = {
  nowMs: () => Date.now(),
  monotonicMs: () => performance.now(),
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

// ── Router transport port ────────────────────────────────────────────────────

export interface RouterRawResponse {
  readonly status: number;
  /** `ZG-Res-Key` response header, if present. */
  readonly zgResKey: string | null;
  /** Parsed Retry-After in ms, if present and parseable. */
  readonly retryAfterMs: number | null;
  readonly bodyText: string;
  readonly latencyMs: number;
}

export interface RouterTransportFailure {
  readonly kind: "NETWORK" | "BODY_TOO_LARGE";
  /** Short code only; never a raw error message containing secrets. */
  readonly detail: string;
  readonly latencyMs: number;
}

export type RouterTransportResult =
  | { readonly ok: true; readonly response: RouterRawResponse }
  | { readonly ok: false; readonly failure: RouterTransportFailure };

export interface RouterTransport {
  readonly mode: RecordMode;
  /** Full URL of the chat-completions endpoint. */
  readonly endpoint: string;
  send(args: {
    readonly body: string;
    readonly timeoutMs: number;
    readonly maxResponseBytes: number;
  }): Promise<RouterTransportResult>;
}
