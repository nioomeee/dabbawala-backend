/**
 * Application port: Gatekeeper
 *
 * Manages restricted-zone approval flow.
 * ref: ROADMAP.md §4.11, §4.3 invariant 7, §4.3 invariant 8
 */

import type { ApprovalToken } from "@dabbawala/domain";
import type { RobotId, Result } from "@dabbawala/shared";

export type PendingAction = {
  readonly actionId: string;
  readonly robotId: RobotId;
  readonly zoneId: string;
  readonly routeHash: string;
  readonly requestId: string;
  readonly nonce: string;
  readonly createdAtMs: number;
  /** ~120 s expiry. ref: ROADMAP.md §4.11 */
  readonly expiresAtMs: number;
};

export type GatekeeperDenyReason =
  | "NOT_AUTHORISED"
  | "EXPIRED"
  | "REPLAYED"
  | "ZONE_REMOVED"
  | "POLICY_PAUSED";

export interface IGatekeeper {
  /** Store a pending action and return its id. */
  storePending(
    robotId: RobotId,
    zoneId: string,
    routeHash: string,
    requestId: string,
  ): Promise<PendingAction>;

  /**
   * Approve a pending action.
   * The approver must be on the zone's allowlist.
   * Mints a single-use token. ref: ROADMAP.md §4.3 invariant 7
   */
  approve(
    actionId: string,
    approverId: string,
  ): Promise<Result<ApprovalToken, GatekeeperDenyReason>>;

  /** Deny a pending action. */
  deny(actionId: string, approverId: string): Promise<Result<true, GatekeeperDenyReason>>;

  /**
   * Verify and consume a token at the zone gate.
   * Must re-read zones and policy epoch at entry.
   * ref: ROADMAP.md §4.11, §I-4
   */
  verifyAndConsume(
    token: ApprovalToken,
    robotId: RobotId,
    zoneId: string,
  ): Promise<Result<true, GatekeeperDenyReason>>;
}

