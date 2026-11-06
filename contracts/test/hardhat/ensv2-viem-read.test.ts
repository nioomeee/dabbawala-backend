/**
 * ENS read-path verification over viem (the API's production stack).
 *
 * The contracts tests so far read through ethers. This file drives the SAME
 * wire path the apps/api ENS policy reader will use on Sepolia — viem
 * `readContract` on resolve(bytes name, bytes data) with the
 * text(bytes32 node, string key) profile, decoded from abi.encode(string) —
 * against resolver proxies deployed through the Verifiable Factory harness.
 *
 * Proves (E1 read half + E4/E6 policy flip, ROADMAP §6):
 *   1. viem reads the seeded zones/budget/status of every robot;
 *   2. the assembled PolicySnapshot validates against the frozen shared schema
 *      with the source block number stamped;
 *   3. a safety-officer status flip (paused) is visible to a fresh viem read;
 *   4. a robot's last-episode write is visible to a fresh viem read.
 *
 * The HTTP transport itself (createViemPolicyClient http()) runs live only
 * when Sepolia credentials exist (S-ENS); this bridge runs the identical
 * JSON-RPC surface in-process.
 * ref: helpers.ts (same harness), ens-reader.ts, R-ENS-2, R-ENS-7
 */

import { expect } from "chai";
import { network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { createPublicClient, createTransport, decodeAbiParameters, encodeFunctionData } from "viem";
import { packetToBytes } from "viem/ens";
import { toHex } from "viem";
import type { Hex } from "viem";
import { hardhat as hardhatChain } from "viem/chains";

import {
  ENS_RECORD_KEYS,
  PolicySnapshotSchema,
  ROBOT_BUDGET_MICRO_HBAR,
  ROBOT_IDS,
  ROBOT_ZONES,
  type PolicySnapshot,
  type RobotId,
} from "@dabbawala/shared";

import { createHash } from "node:crypto";
import { dnsEncode, setupEnsHarness } from "./helpers";

// ── viem client bridged to the in-process Hardhat provider ──────────────────

/** Transport that serves viem JSON-RPC requests through the Hardhat provider. */
function hardhatBridgeTransport() {
  return createTransport({
    key: "hardhat-bridge",
    name: "Hardhat in-process bridge",
    type: "http",
    request: ({ method, params }) => network.provider.send(method, params ?? []).then(toHexIfBigint),
  });
}

/** Hardhat returns quantities as numbers on some methods; viem expects the
 * wire form to be whatever JSON gave it. Only normalise bigints. */
function toHexIfBigint(value: unknown): unknown {
  if (typeof value === "bigint") return toHex(value);
  return value;
}

const client = createPublicClient({ chain: hardhatChain, transport: hardhatBridgeTransport() });

// ── the read path the API reader uses (mirror of ens-reader.ts readText) ────

const RESOLVE_ABI = [
  {
    type: "function",
    name: "resolve",
    stateMutability: "view",
    inputs: [
      { type: "bytes", name: "name" },
      { type: "bytes", name: "data" },
    ],
    outputs: [{ type: "bytes", name: "result" }],
  },
] as const;

const TEXT_PROFILE_ABI = [
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { type: "bytes32", name: "node" },
      { type: "string", name: "key" },
    ],
    outputs: [{ type: "string", name: "value" }],
  },
] as const;

function textRecordProfile(key: string): `0x${string}` {
  return encodeFunctionData({ abi: TEXT_PROFILE_ABI, functionName: "text", args: ["0x" + "00".repeat(32), key] });
}

/** One text record through viem readContract + abi-decode of the payload. */
async function readTextViem(resolver: string, name: string, key: string): Promise<string> {
  const raw = (await client.readContract({
    address: resolver as Hex,
    abi: RESOLVE_ABI,
    functionName: "resolve",
    args: [toHex(packetToBytes(name)), textRecordProfile(key)],
  })) as Hex;
  return decodeAbiParameters([{ type: "string" }], raw)[0];
}

// ── tests ───────────────────────────────────────────────────────────────────

describe("ENS read path over viem (the API production stack)", () => {
  it("reads the seeded zones / budget / status of every robot via resolve()", async () => {
    const h = await loadFixture(setupEnsHarness);
    for (const robotId of ROBOT_IDS) {
      const name = h.names[robotId];
      const resolver = await h.resolvers[robotId].getAddress();
      expect(await readTextViem(resolver, name, ENS_RECORD_KEYS.ZONES)).to.equal(
        JSON.stringify(ROBOT_ZONES[robotId]),
      );
      expect(await readTextViem(resolver, name, ENS_RECORD_KEYS.BUDGET)).to.equal(
        String(ROBOT_BUDGET_MICRO_HBAR[robotId]),
      );
      expect(await readTextViem(resolver, name, ENS_RECORD_KEYS.STATUS)).to.equal("active");
    }
  });

  it("assembles a PolicySnapshot the frozen shared schema accepts", async () => {
    const h = await loadFixture(setupEnsHarness);
    const robotId: RobotId = "ramu";
    const name = h.names[robotId];
    const resolver = await h.resolvers[robotId].getAddress();

    const blockNumber = await client.getBlockNumber();
    const zones = JSON.parse(await readTextViem(resolver, name, ENS_RECORD_KEYS.ZONES)) as string[];
    const budgetAtomic = await readTextViem(resolver, name, ENS_RECORD_KEYS.BUDGET);
    const status = await readTextViem(resolver, name, ENS_RECORD_KEYS.STATUS);

    const draft: PolicySnapshot = {
      robotId,
      zones,
      budgetAtomic,
      status: status === "paused" ? "paused" : "active",
      block: blockNumber,
      valuesHash: createHash("sha256")
        .update(JSON.stringify({ robotId, zones, budgetAtomic, status }), "utf8")
        .digest("hex"),
      readAtMs: Date.now(),
    };

    expect(PolicySnapshotSchema.safeParse(draft).success).toBe(true);
  });

  it("a safety-officer pause flip is visible to a fresh viem read (E4/E6 policy flip)", async () => {
    const h = await loadFixture(setupEnsHarness);
    const name = h.names.ramu;
    const resolver = h.resolvers.ramu;

    // Exactly the grant the deployment script makes: officer sets status only.
    const officerResolver = resolver.connect(h.safetyOfficer);
    await (await officerResolver.setText(dnsEncode(name), ENS_RECORD_KEYS.STATUS, "paused")).wait();

    const flip = await readTextViem(await resolver.getAddress(), name, ENS_RECORD_KEYS.STATUS);
    expect(flip).to.equal("paused");

    // Other robots unaffected (E4 second half).
    expect(
      await readTextViem(await h.resolvers.sakhu.getAddress(), h.names.sakhu, ENS_RECORD_KEYS.STATUS),
    ).to.equal("active");
  });

  it("a robot's last-episode write is visible to a fresh viem read", async () => {
    const h = await loadFixture(setupEnsHarness);
    const name = h.names.ramu;
    const resolver = h.resolvers.ramu;

    const before = await readTextViem(await resolver.getAddress(), name, ENS_RECORD_KEYS.LAST_EPISODE);
    expect(before).to.equal("");

    await (
      await resolver
        .connect(h.robotSigners.ramu)
        .setText(dnsEncode(name), ENS_RECORD_KEYS.LAST_EPISODE, "ep-17-cellar")
    ).wait();

    expect(
      await readTextViem(await resolver.getAddress(), name, ENS_RECORD_KEYS.LAST_EPISODE),
    ).to.equal("ep-17-cellar");
  });
});
