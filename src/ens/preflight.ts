/**
 * ENSv2 Pre-flight Checks
 *
 * Ref: ROADMAP §4.9, R-ENS-2, R-ENS-4
 * Validates that the agent can safely register subnames on Sepolia.
 * Fails loudly (throws) if any check fails.
 */

import { viemClient } from "./config";
import {
  ADDRESSES,
  PARENT_NAME_HASH,
  type PreflightChecks,
  type SubnameConfig,
  ROLE_REGISTRAR,
  ROLE_RENEW,
  ROLE_SET_RESOLVER,
  DEFAULT_EXPIRY,
} from "./config";
import { computeNamehash } from "viem";

// ── Core Pre-flight Logic ──────────────────────────────────────────────────

export async function runPreflight(
  labels: SubnameConfig[],
): Promise<PreflightChecks> {
  const checks: PreflightChecks = {
    subregistryImplementationMatch: false,
    agentHasRegistrarRole: false,
    parentSubregistryPointing: false,
    allLabelsAvailable: false,
  };

  // 1. Subregistry implementation match
  checks.subregistryImplementationMatch = await verifySubregistryImplementation(
    viemClient,
  );

  // 2. Agent has ROLE_REGISTRAR on subregistry ROOT_RESOURCE
  checks.agentHasRegistrarRole = await agentHasRegistrarRole(viemClient);

  // 3. Parent ENS registry's subregistry pointer matches
  checks.parentSubregistryPointing = await parentSubregistryPointing(viemClient);

  // 4. All target labels are AVAILABLE (0) on the parent
  checks.allLabelsAvailable = await allLabelsAvailable(viemClient, labels.map((l) => l.label));

  return checks;
}

/** Throws if any preflight check fails. */
export function assertPreflight(
  checks: PreflightChecks,
  labels: SubnameConfig[],
): asserts checks is PreflightChecks & { failed: string } {
  const failures: string[] = [];

  if (!checks.subregistryImplementationMatch) {
    failures.push("Subregistry implementation does not match UserRegistry");
  }
  if (!checks.agentHasRegistrarRole) {
    failures.push("Agent does not have ROLE_REGISTRAR on subregistry ROOT_RESOURCE");
  }
  if (!checks.parentSubregistryPointing) {
    failures.push("Parent ENS registry subregistry pointer is incorrect");
  }
  if (!checks.allLabelsAvailable) {
    failures.push("One or more labels are not AVAILABLE (already registered or reserved)");
  }

  if (failures.length > 0) {
    throw new Error(`Pre-flight checks failed: ${failures.join(", ")}`);
  }
}

/** Hash a label for on-chain lookups. */
function namehash(label: string): `0x${string}` {
  return computeNamehash(label);
}