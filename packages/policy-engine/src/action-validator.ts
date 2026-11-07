/**
 * Policy Engine — Action Validator
 *
 * Validates a 0G model proposal (Action) against the closed action set
 * and the current policy snapshot before it can affect robot movement.
 *
 * The model output is UNTRUSTED. ref: ROADMAP.md §4.3 invariant 2, §4.5
 * Policy unknown means no new authority. ref: ROADMAP.md §4.3 invariant 3
 */

import {
  isPolicyActive,
  isPolicyFresh,
  isZoneAllowed,
} from "@dabbawala/domain";
import {
  ACTION_TYPES,
  ActionSchema,
  type Action,
  type ActionType,
  type Halt,
  type PolicySnapshot,
} from "@dabbawala/shared";

export type ValidationResult =
  | { readonly valid: true; readonly action: Action }
  | { readonly valid: false; readonly halt: Halt };

/**
 * Validates an action proposal against the current policy.
 * Ordered checks; any failure returns a Halt.
 */
export function validateAction(
  rawProposal: unknown,
  policy: PolicySnapshot,
  nowMs: number,
): ValidationResult {
  // 1. Policy must be fresh. ref: ROADMAP.md §4.9
  if (!isPolicyFresh(policy, nowMs)) {
    return {
      valid: false,
      halt: { halted: true, reason: "ENS_UNREADABLE", detail: "Policy snapshot is stale" },
    };
  }

  // 2. Policy must be active. ref: ROADMAP.md §4.9
  if (!isPolicyActive(policy)) {
    return {
      valid: false,
      halt: { halted: true, reason: "POLICY_PAUSED", detail: `Robot ${policy.robotId} is paused` },
    };
  }

  // 3. Parse and validate the action schema against the closed set.
  const parseResult = ActionSchema.safeParse(rawProposal);
  if (!parseResult.success) {
    return {
      valid: false,
      halt: {
        halted: true,
        reason: "ACTION_NOT_ALLOWED",
        detail: `Action failed schema validation: ${parseResult.error.message}`,
      },
    };
  }

  const action = parseResult.data;

  // 4. Verify the action type is in the closed set.
  if (!(ACTION_TYPES as readonly string[]).includes(action.type as ActionType)) {
    return {
      valid: false,
      halt: {
        halted: true,
        reason: "ACTION_NOT_ALLOWED",
        detail: `Action type '${action.type}' is not in the closed action set`,
      },
    };
  }

  // 5. Zone-entry actions must be permitted by policy.
  if (action.type === "ask_human" && !isZoneAllowed(policy, action.zoneId)) {
    return {
      valid: false,
      halt: {
        halted: true,
        reason: "GATE_DENIED",
        detail: `Zone '${action.zoneId}' is not in the allowed zone list`,
      },
    };
  }

  if (action.type === "reroute" && action.routeId === "") {
    return {
      valid: false,
      halt: {
        halted: true,
        reason: "ACTION_NOT_ALLOWED",
        detail: "reroute action must include a non-empty routeId",
      },
    };
  }

  return { valid: true, action };
}

