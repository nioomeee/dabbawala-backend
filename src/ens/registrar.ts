/**
 * ENSv2 Subname Registrar
 *
 * Ref: R-ENS-2, R-ENS-4, R-ENS-7
 * Registers subnames (ramu, janu, sakhu) on the Sepolia subregistry.
 * Idempotent: re-running will not double-register.
 * Calls register() on SUBREGISTRY per the exact-scheme spec.
 */

import { viemClient } from "./config";
import {
  ADDRESSES,
  type SubnameConfig,
  type PreflightChecks,
  DEFAULT_ROLE_BITMAP,
  DEFAULT_EXPIRY,
  ROLE_REGISTRAR,
  ROLE_RENEW,
  ROLE_SET_RESOLVER,
} from "./config";
import { computeNamehash, parseUnits } from "viem";
import { runPreflight, assertPreflight } from "./preflight";

// ── Registration ──────────────────────────────────────────────────────────────

/** Register a single subname on the Subregistry.
 *  Calls: register(label, owner, registry, resolver, roleBitmap, expiry)
 *  on the SUBREGISTRY contract.
 *
 *  - label: just the label (e.g. "ramu"), NOT the full name
 *  - owner: the subname's wallet address
 *  - registry: address(0) for no children, or a child subregistry address
 *  - resolver: the PermissionedResolver address for the subname
 *  - roleBitmap: bitmask of granted roles
 *  - expiry: seconds from epoch; capped at parent's expiry
 */
export async function registerSubname(
  config: SubnameConfig,
): Promise<{ success: boolean; txHash: `0x${string}`; failure?: string }} {
  // 1. Run preflight checks
  const checks = await runPreflight([config]);
  assertPreflight(checks, [config]);

  const label = config.label;
  const owner = config.owner;
  const resolverAddress = ADDRESSES.parentResolver; // parent's resolver
  const registry = ADDRESSES.subregistry; // the subregistry itself
  const roleBitmap = config.roleBitmap ?? DEFAULT_ROLE_BITMAP;
  const expiry = config.expiry ?? DEFAULT_EXPIRY;

  // 2. Compute the label hash (keccak256 of the label string)
  const labelHash = computeNamehash(label);

  // 3. Simulate the register call first (optional but recommended)
  // We use the Subregistry's register(...) selector.
  // The selector for register(address,address,address,bytes32,uint256) is 0x...
  // We'll use viem's simulateContract.

  const registerAbi = [
    {
      type: "function",
      name: "register",
      inputs: [
        { type: "bytes32", name: "label" },
        { type: "address", name: "owner" },
        { type: "address", name: "registry" },
        { type: "address", name: "resolver" },
        { type: "bytes32", name: "roleBitmap" },
        { type: "uint256", name: "expiry" },
      ],
      outputs: [],
      stateMutability: "nonpayable",
    },
  ];

  try {
    // Simulate first
    const sim = await viemClient!.simulateContract({
      address: ADDRESSES.subregistry,
      abi: registerAbi,
      functionName: "register",
      args: [
        labelHash,
        owner,
        registry,
        resolverAddress,
        roleBitmap,
        BigInt(expiry),
      ],
      account: AGENT_PRIVATE_KEY,
    });

    const txHash = await viemClient!.writeContract({
      address: ADDRESSES.subregistry,
      abi: registerAbi,
      functionName: "register",
      args: [
        labelHash,
        owner,
        registry,
        resolverAddress,
        roleBitmap,
        BigInt(expiry),
      ],
      account: AGENT_PRIVATE_KEY,
    });

    // 3. Post-registration: set the address record (coin type 60)
    // using the PermissionedResolver. The agent needs ROLE_SET_ADDR.
    // We'll call setAddr on the resolver for the subname's full path.
    await setAddrRecord(
      label,
      owner,
      resolverAddress,
      AGENT_PRIVATE_KEY,
    );

    return {
      success: true,
      txHash: txHash as `0x${string}`,
    };
  } catch (err: any) {
    const failure = err?.error?.message || err?.message || "Unknown registration error";
    // Check if it's an idempotency issue (already registered to same owner)
    if (failure.includes("already registered") || failure.includes("already exists")) {
      // Check if already registered to the same owner
      const already = await checkAlreadyRegistered(config);
      if (already) {
        return { success: true, txHash: "0x0000000000000000000000000000000000000000", idempotent: true };
      }
    }
    return { success: false, txHash: "", failure };
  }
}

/** Checks if a subname is already registered to the same owner. */
async function checkAlreadyRegistered(
  config: SubnameConfig,
): Promise<boolean> {
  const labelHash = computeNamehash(config.label);
  try {
    const owner = await viemClient!.readContract({
      address: ADDRESSES.subregistry,
      abi: [{ type: "function", name: "owner", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] }],
      functionName: "owner",
      args: [labelHash],
    });
    return owner.toLowerCase() === config.owner.toLowerCase();
  } catch {
    return false;
  }
}

/** Set the address record (coin type 60) for the subname. */
async function setAddrRecord(
  label: string,
  owner: `0x${string}`,
  resolverAddress: `0x${string}`,
  agentKey: string,
): Promise<void> {
  // Use the PermissionedResolver's setAddr or ensjs wallet action
  // We'll use viem's writeContract with the resolver
  const setAddrAbi = [
    {
      type: "function",
      name: "setAddr",
      inputs: [
        { type: "address", name: "addr" },
        { type: "bytes32", name: "tokenId" },
      ],
      stateMutability: "nonpayable",
    },
  ];

  // For the subname, we need to determine the tokenId (nodehash)
  const nodeHash = computeNamehash(label);
  await viemClient!.writeContract({
    address: resolverAddress,
    abi: setAddrAbi,
    functionName: "setAddr",
    args: [owner, nodeHash],
    account: AGENT_PRIVATE_KEY,
  });
}

// ── Batch Registration ───────────────────────────────────────────────────────

/** Register multiple subnames in sequence. */
export async function registerSubnames(
  configs: SubnameConfig[],
): Promise<Array<{ success: boolean; txHash: `0x${string}`; idempotent: boolean }>> {
  const results: Array<{ success: boolean; txHash: `0x${string}`; idempotent: boolean }} = [];
  for (const config of configs) {
    const result = await registerSubname(config);
    results.push({
      success: result.success,
      txHash: result.txHash,
      idempotent: result.idempotent ?? false,
    });
  }
  return results;
}