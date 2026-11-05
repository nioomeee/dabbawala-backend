/**
 * Domain: Policy value object
 *
 * Encapsulates policy rules applied before any action or payment.
 * ref: ROADMAP.md §4.9, §4.3 invariant 3
 */

import type { PolicySnapshot } from "@dabbawala/shared";
import { POLICY_CACHE_MAX_TTL_MS } from "@dabbawala/shared";

/** Returns true if this policy snapshot is still within its cache window. */
export function isPolicyFresh(policy: PolicySnapshot, nowMs: number): boolean {
  return nowMs - policy.readAtMs <= POLICY_CACHE_MAX_TTL_MS;
}

/** Returns true if the robot is permitted to enter the given zone. */
export function isZoneAllowed(policy: PolicySnapshot, zoneId: string): boolean {
  return policy.zones.includes(zoneId);
}

/** Returns true if the robot is in active status. */
export function isPolicyActive(policy: PolicySnapshot): boolean {
  return policy.status === "active";
}

/**
 * Returns true if the amount (as atomic integer) is within the budget.
 * Both values are non-negative integer strings.
 * ref: ROADMAP.md §4.9
 */
export function isBudgetSufficient(
  policy: PolicySnapshot,
  amountAtomic: string,
): boolean {
  return BigInt(policy.budgetAtomic) >= BigInt(amountAtomic);
}

