/**
 * ENSv2 Configuration
 *
 * Ref: R-ENS-2, R-ENS-4, R-ENS-7
 * Derived from Sepolia redeploy on 2026-10-01.
 * All addresses verified via on-chain state at startup.
 */

import { createClient } from "viem";
import { sepolia } from "viem/chains";
import {
  PARENT_NAME,
  SUBREGISTRY_ADDRESS,
  USER_REGISTRY_IMPLEMENTATION,
  VERIFIABLE_FACTORY_ADDRESS,
  PARENT_RESOLVER_ADDRESS,
  ETH_REGISTRY_ADDRESS,
  AGENT_PRIVATE_KEY,
} from "./env";

// ── Core Addresses (Sepolia, post-2026-10-01 redeploy) ──────────────────────

export const PARENT_NAME_HASH = await computeParentNameHash(PARENT_NAME);

export const ADDRESSES = {
  // Parent ENS registry (ENSIP-137 registry)
  parent: "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4" as const,

  // Subregistry (UserRegistry proxy) - verified via proxy implementation match
  subregistry: "0x9407F49851A8CA985123Fc5b1BeCab1aAbAf7313" as const,

  // UserRegistry implementation (the logic contract)
  userRegistryImplementation: "0x9BD8a88719068D09ecee662f36C0E3856708366a" as const,

  // VerifiableFactory for subname deployment
  verifiableFactory: "0xDa70306C98E97eCe36F997a21368e53298572991" as const,

  // Parent's owned resolver
  parentResolver: "0xE65DC3a39fCC4f75940CaFf0D4B10D6441672e43" as const,

  // Owner wallet (deployer)
  owner: "0xd91EAC71dd09c731de841f4E520Bf189b288A3A3" as const,
};

// ── viem client (Sepolia) ──────────────────────────────────────────────────

export const viemClient = createClient({
  chain: sepolia,
  transport: window?.ethereum
    ? window?.ethereum.request({ method: "eth_requestAccounts" })
    : undefined,
});

// ── Helper: compute parent name hash (keccak256) ──────────────────────────

function computeParentNameHash(name: string): `0x${string}` {
  const namehash = await viemClient!.readContract({
    address: PARENT_NAME_HASH,
    abi: [{ type: "function", name: "namehash", inputs: [{ type: "string" }], outputs: [{ type: "bytes32" }] }],
    functionName: "namehash",
    args: [name],
  });
  return namehash as `0x${string}`;
}

// ── Export types ───────────────────────────────────────────────────────────

export type SubnameConfig = {
  label: "ramu" | "janu" | "sakhu";
  owner: `0x${string}`;
  // Optional: custom role bitmap (default: ROLE_SET_RESOLVER)
  roleBitmap?: bigint;
  // Optional: expiry in seconds (default: 1 year from parent expiry)
  expiry?: number;
};

// Default role bitmap: ROLE_SET_RESOLVER only
export const DEFAULT_ROLE_BITMAP = 1n << 24n;

// Default expiry: 1 year (approx 31536000 seconds)
// Parent expires 2029-11-06, so we cap at that date
export const DEFAULT_EXPIRY = 31536000; // 1 year

// ── Preflight config ───────────────────────────────────────────────────────

export type PreflightChecks = {
  subregistryImplementationMatch: boolean;
  agentHasRegistrarRole: boolean;
  parentSubregistryPointing: boolean;
  allLabelsAvailable: boolean;
};

/** Returns true if the subregistry proxy implements the UserRegistry code. */
export async function verifySubregistryImplementation(
  client: ReturnType<typeof createClient>,
): Promise<boolean> {
  const impl = await client.readContract({
    address: ADDRESSES.subregistry,
    abi: [{ type: "function", name: "implementation", outputs: [{ type: "address" }] }],
    functionName: "implementation",
  });
  return impl === ADDRESSES.userRegistryImplementation;
}

/** Checks that the agent wallet has ROLE_REGISTRAR (1) on the subregistry's ROOT_RESOURCE. */
export async function agentHasRegistrarRole(
  client: ReturnType<typeof createClient>,
): Promise<boolean> {
  const hasRole = await client.readContract({
    address: ADDRESSES.subregistry,
    abi: [{ type: "function", name: "hasRoles", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "bool" }] }],
    functionName: "hasRoles",
    args: [await getRootResource(), ADDRESSES.owner],
  });
  return hasRole === true;
}

/** Reads the root resource from the subregistry. */
async function getRootResource(): Promise<bigint> {
  const result = await viemClient!.readContract({
    address: ADDRESSES.subregistry,
    abi: [{ type: "function", name: "rootResource", outputs: [{ type: "bytes32" }] }],
    functionName: "rootResource",
  });
  return result as bigint;
}

/** Checks that the parent ENS registry's subregistry pointer matches ADDRESSES.subregistry. */
export async function parentSubregistryPointing(
  client: ReturnType<typeof createClient>,
): Promise<boolean> {
  const current = await client.readContract({
    address: ADDRESSES.parent,
    abi: [{ type: "function", name: "getSubregistry", inputs: [{ type: "address" }], outputs: [{ type: "address" }] }],
    functionName: "getSubregistry",
    args: [await getParentNameHash()],
  });
  return result === ADDRESSES.subregistry;
}

/** Checks that all target labels are AVAILABLE (0) on the parent. */
export async function allLabelsAvailable(
  client: ReturnType<typeof createClient>,
  labels: string[],
): Promise<boolean> {
  for (const label of labels) {
    const labelHash = await namehash(label);
    const status = await client.readContract({
      address: ADDRESSES.parent,
      abi: [{ type: "function", name: "getStatus", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint8" }] }],
      functionName: "getStatus",
      args: [labelHash],
    });
    if (status !== 0) return false; // Not AVAILABLE
  }
  return true;
}

// ── Role helpers ────────────────────────────────────────────────────────────

/** ROLE_REGISTRAR (1) on subregistry ROOT_RESOURCE */
export const ROLE_REGISTRAR = 1n << 0n;
/** ROLE_RENEW (1 << 16) */
export const ROLE_RENEW = 1n << 16n;
/** ROLE_SET_RESOLVER (1 << 24) */
export const ROLE_SET_RESOLVER = 1n << 24n;
/** ROLE_SET_ADDR (if needed) */
export const ROLE_SET_ADDR = 1n << 27n;

/** FULL: REGISTRAR + RENEW + SET_RESOLVER */
export const DEFAULT_ROLE_BITMAP =
  ROLE_REGISTRAR | ROLE_RENEW | ROLE_SET_RESOLVER;