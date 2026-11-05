/**
 * Application port: Policy Reader
 *
 * Reads policy from ENS (or local cache within TTL).
 * ref: ROADMAP.md §4.9, §4.3 invariant 3, §4.5
 */

import type { PolicySnapshot, RobotId } from "@dabbawala/shared";

export interface IPolicyReader {
  /**
   * Read the policy snapshot for a robot from ENS.
   * Must include block number and values hash.
   * Must fail closed: throw/return error if ENS is unreadable.
   * ref: ROADMAP.md §4.3 invariant 3, §4.9
   */
  readPolicy(robotId: RobotId): Promise<PolicySnapshot>;
}

