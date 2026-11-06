/**
 * Failure classification: FailureKind -> frozen HaltReason, and retry policy.
 *
 * Policy (ROADMAP.md §4.3 invariant 4, ZERO_G_MAX_RETRIES = 1):
 *   - At most ONE retry per decide() call, only for transient failures.
 *   - Content failures (malformed/out-of-set/ungrounded) are NOT retried:
 *     re-sampling an untrusted model until it says something acceptable is
 *     prompt-shopping, not safety.
 *   - No local fallback decision of any kind.
 *
 * Router retry guidance (docs.0g.ai Router/Errors): 429 honour Retry-After;
 * 502 may help; 503 unlikely to resolve in seconds; never retry 400/401/402/403.
 */

import type { HaltReason } from "@dabbawala/shared";
import type { FailureKind } from "./types.js";

export function haltReasonFor(kind: FailureKind): HaltReason {
  switch (kind) {
    case "TIMEOUT":
      return "ZG_TIMEOUT";
    case "BLOCKED":
    case "CONCURRENCY":
    case "NETWORK":
    case "HTTP_RETRYABLE":
    case "HTTP_FATAL":
      return "ZG_TRANSPORT";
    case "INVALID_STATE":
    case "BODY_TOO_LARGE":
    case "NOT_JSON":
    case "BAD_ENVELOPE":
    case "NO_REQUEST_ID":
    case "TEE_UNVERIFIED":
    case "TRUNCATED":
    case "EMPTY_CONTENT":
    case "BAD_PROPOSAL_JSON":
    case "BAD_PROPOSAL_SCHEMA":
      return "ZG_MALFORMED";
    case "ACTION_NOT_IN_SET":
    case "ACTION_UNGROUNDED":
      return "ACTION_NOT_ALLOWED";
  }
}

/** Failure kinds for which one retry is permitted. */
export function isRetryable(kind: FailureKind): boolean {
  switch (kind) {
    case "TIMEOUT":
    case "NETWORK":
    case "HTTP_RETRYABLE":
    case "TEE_UNVERIFIED": // a different provider may serve the retry
      return true;
    case "BLOCKED":
    case "INVALID_STATE":
    case "CONCURRENCY":
    case "HTTP_FATAL":
    case "BODY_TOO_LARGE":
    case "NOT_JSON":
    case "BAD_ENVELOPE":
    case "NO_REQUEST_ID":
    case "TRUNCATED":
    case "EMPTY_CONTENT":
    case "BAD_PROPOSAL_JSON":
    case "BAD_PROPOSAL_SCHEMA":
    case "ACTION_NOT_IN_SET":
    case "ACTION_UNGROUNDED":
      return false;
  }
}

/** Classify a non-2xx HTTP status. */
export function classifyHttpStatus(status: number): "HTTP_RETRYABLE" | "HTTP_FATAL" {
  // 503 = no healthy providers: "unlikely to resolve in seconds" (Router/Errors).
  if (status === 429 || status === 500 || status === 502 || status === 504) {
    return "HTTP_RETRYABLE";
  }
  return "HTTP_FATAL";
}

/**
 * Stable operator-facing diagnosis code. This is separate from the frozen
 * HaltReason and from `detail`: HaltReason stays inside the domain enum, while
 * `OG_*` tells an operator exactly which 0G prerequisite failed.
 *
 * Never contains model text or credentials.
 */
export function operationalCode(kind: FailureKind, detail: string): string {
  switch (kind) {
    case "BLOCKED":
      return "OG_NOT_CONFIGURED";
    case "CONCURRENCY":
      return "OG_LOCAL_CONCURRENCY_LIMIT";
    case "INVALID_STATE":
      return "OG_STATE_INVALID";
    case "TIMEOUT":
      return "OG_TIMEOUT";
    case "NETWORK":
      return "OG_NETWORK";
    case "BODY_TOO_LARGE":
      return "OG_RESPONSE_TOO_LARGE";
    case "NOT_JSON":
      return "OG_RESPONSE_NOT_JSON";
    case "BAD_ENVELOPE":
      return "OG_RESPONSE_ENVELOPE_INVALID";
    case "NO_REQUEST_ID":
      return "OG_REQUEST_ID_MISSING";
    case "TEE_UNVERIFIED":
      return detail.includes("MISSING")
        ? "OG_TEE_VERDICT_MISSING"
        : "OG_TEE_SIGNATURE_INVALID";
    case "TRUNCATED":
      return "OG_OUTPUT_TRUNCATED";
    case "EMPTY_CONTENT":
      return "OG_EMPTY_CONTENT";
    case "BAD_PROPOSAL_JSON":
      return "OG_PROPOSAL_NOT_JSON";
    case "BAD_PROPOSAL_SCHEMA":
      return "OG_PROPOSAL_SCHEMA_INVALID";
    case "ACTION_NOT_IN_SET":
      return "OG_ACTION_NOT_IN_SET";
    case "ACTION_UNGROUNDED":
      return "OG_ACTION_UNGROUNDED";
    case "HTTP_RETRYABLE":
    case "HTTP_FATAL":
      switch (detail) {
        case "ROUTER_AUTH_FAILED":
          return "OG_AUTH_FAILED";
        case "ROUTER_FORBIDDEN":
          return "OG_FORBIDDEN";
        case "ROUTER_INSUFFICIENT_BALANCE":
          return "OG_INSUFFICIENT_BALANCE";
        case "ROUTER_NOT_FOUND":
          return "OG_MODEL_OR_ENDPOINT_NOT_FOUND";
        case "ROUTER_BAD_REQUEST":
          return "OG_BAD_REQUEST";
        case "ROUTER_RATE_LIMITED":
          return "OG_RATE_LIMITED";
        case "ROUTER_NO_PROVIDER":
          return "OG_NO_PROVIDER";
        case "ROUTER_PROVIDER_ERROR":
          return "OG_PROVIDER_ERROR";
        default:
          return "OG_HTTP_ERROR";
      }
  }
}

/** Short operator-facing code for an HTTP failure; contains no response text. */
export function httpDetail(status: number): string {
  switch (status) {
    case 400:
      return "ROUTER_BAD_REQUEST";
    case 401:
      return "ROUTER_AUTH_FAILED";
    case 402:
      return "ROUTER_INSUFFICIENT_BALANCE";
    case 403:
      return "ROUTER_FORBIDDEN";
    case 404:
      return "ROUTER_NOT_FOUND";
    case 429:
      return "ROUTER_RATE_LIMITED";
    case 502:
      return "ROUTER_PROVIDER_ERROR";
    case 503:
      return "ROUTER_NO_PROVIDER";
    default:
      return `ROUTER_HTTP_${String(status)}`;
  }
}
