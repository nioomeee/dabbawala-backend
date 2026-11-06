/**
 * Domain: Approval token value object
 *
 * Single-use, bound to robot, zone, nonce, and 0G request id.
 * TTL <= 60 s. ref: ROADMAP.md §4.3 invariant 7, §4.11
 */

import type { RobotId } from "@dabbawala/shared";
import { APPROVAL_TOKEN_TTL_MS } from "@dabbawala/shared";

export type ApprovalToken = {
  readonly tokenId: string;
  /** Robot this token is bound to. */
  readonly robotId: RobotId;
  /** Zone this token permits entry to. */
  readonly zoneId: string;
  /** Nonce prevents replay. */
  readonly nonce: string;
  /** 0G request id this approval is bound to. */
  readonly requestId: string;
  /** ISO timestamp of issuance. */
  readonly issuedAtMs: number;
  /** Whether the token has been consumed. */
  readonly consumed: boolean;
};

/** Create a fresh approval token. */
export function createApprovalToken(
  tokenId: string,
  robotId: RobotId,
  zoneId: string,
  nonce: string,
  requestId: string,
): ApprovalToken {
  return {
    tokenId,
    robotId,
    zoneId,
    nonce,
    requestId,
    issuedAtMs: Date.now(),
    consumed: false,
  };
}

/** Returns true if the token is still within its TTL. */
export function isTokenValid(token: ApprovalToken, nowMs: number): boolean {
  if (token.consumed) return false;
  return nowMs - token.issuedAtMs <= APPROVAL_TOKEN_TTL_MS;
}

/** Returns a consumed copy of the token (tokens are single-use). */
export function consumeToken(token: ApprovalToken): ApprovalToken {
  return { ...token, consumed: true };
}

