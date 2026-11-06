/**
 * Local ENSv2 deployment — Dabbawala robot passports (Hardhat stage).
 *
 * Run against a persistent local node:
 *   pnpm --filter @dabbawala/contracts hardhat:node   (terminal 1)
 *   pnpm --filter @dabbawala/contracts ens:deploy:local
 *
 * Flow (ref: R-ENS-4 Verifiable Factory, R-ENS-2 Permissioned Resolver,
 * docs.ens.domains/ensv2/*; VERIFIED 2026-11-05; local replica contracts:
 * contracts/src/factory, contracts/src/resolver):
 *   1. deploy PermissionedResolver implementation;
 *   2. deploy VerifiableFactoryReplica;
 *   3. for each robot: factory.deployProxy(impl, initData, salt) with
 *      salt = keccak256(utf8("OwnedResolver"), owner, uint256(0)) — the
 *      official salt scheme from the Verifiable Factory docs — where initData
 *      = initializer.initialize([operator: ALL_ROLES on ROOT], [initial
 *      records: zones / budget / status], ran with role checks skipped);
 *   4. operator grantSetterRoles(setText(key=status), safety-officer) on
 *      every resolver (ROLES/AGENTS invariants: officers get no
 *      ROLE_LINK/ROLE_UPGRADE);
 *   5. operator grantSetterRoles(setText(key=last-episode), <robot signer>)
 *      on that robot's own resolver only;
 *   6. persist contracts/deployments/local.json for the API read adapter
 *      (env: LOCAL_ENS_DEPLOYMENT_FILE, packages/config).
 */
import fs from "node:fs";
import path from "node:path";
import { network, ethers } from "hardhat";

import {
  ENS_ALL_ROLES,
  ENS_RECORD_KEYS,
  ROBOT_BUDGET_MICRO_HBAR,
  ROBOT_ENS_NAMES,
  ROBOT_IDS,
  ROBOT_ZONES,
  type RobotId,
} from "@dabbawala/shared";

const ROBOT_SIGNER_INDEX: Record<RobotId, number> = { ramu: 2, sakhu: 3, janu: 4 };

/** DNS wire-format calldata value for a dot-separated ENS name (viem packetToBytes equivalent). */
function dnsEncode(name: string): string {
  const parts = name.split(".").filter((p) => p.length > 0);
  let hex = "0x";
  for (const part of parts) {
    const len = part.length;
    if (len > 63) throw new Error(`DNS label too long: ${part}`);
    hex += len.toString(16).padStart(2, "0");
    hex += Buffer.from(part, "utf8").toString("hex");
  }
  return `${hex}00`;
}

const RESOLVER_ABI = [
  "function initialize((address,uint256)[] grants, bytes[] calls)",
  "function setText(bytes name, string key, string value)",
  "function grantSetterRoles(bytes setter, address account) returns (bool)",
];

const FACTORY_ABI = [
  "function deployProxy(address implementation, uint256 salt, bytes initData) returns (address proxyAddress)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
];

const DEPLOYMENT_DIR = path.resolve(__dirname, "..", "deployments");
const DEPLOYMENT_FILE = process.env["LOCAL_ENS_DEPLOYMENT_FILE"] ?? path.join(DEPLOYMENT_DIR, "local.json");

async function main(): Promise<void> {
  const signers = await ethers.getSigners();
  if (signers.length < 5) {
    throw new Error(`Expected at least 5 Hardhat signers, got ${signers.length}`);
  }
  const [operator, safetyOfficer, ramu, sakhu, janu] = signers;
  const robotSigners: Record<RobotId, typeof operator> = { ramu, sakhu, janu };

  const { chainId } = await ethers.provider.getNetwork();
  console.log(`Network chainId=${chainId}`);
  console.log(`Operator=${operator.address}`);
  console.log(`SafetyOfficer=${safetyOfficer.address}`);

  // 1. Resolver implementation (deployed at the deployment address; only the
  //    per-robot proxies store state).
  const resolverImplFactory = await ethers.getContractFactory("PermissionedResolver", operator);
  const resolverImpl = await resolverImplFactory.deploy();
  await resolverImpl.waitForDeployment();
  const implAddress = await resolverImpl.getAddress();
  console.log(`PermissionedResolver impl=${implAddress}`);

  // 2. Verifiable Factory replica.
  const factoryFactory = await ethers.getContractFactory("VerifiableFactoryReplica", operator);
  const factory = await factoryFactory.deploy();
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`VerifiableFactoryReplica=${factoryAddress}`);

  const factoryIface = new ethers.Interface(FACTORY_ABI);
  const resolverIface = new ethers.Interface(RESOLVER_ABI);

  const robots: Record<string, { name: string; resolver: string; owner: string; records: Record<string, string> }> = {};

  for (const robotId of ROBOT_IDS) {
    const name = ROBOT_ENS_NAMES[robotId];
    const zones = ROBOT_ZONES[robotId];
    const budget = String(ROBOT_BUDGET_MICRO_HBAR[robotId]);

    // 3a. Initial records written inside the factory initialize transaction
    //     (role checks are skipped there, exactly as documented).
    const records: Record<string, string> = {
      [ENS_RECORD_KEYS.ZONES]: JSON.stringify(zones),
      [ENS_RECORD_KEYS.BUDGET]: budget,
      [ENS_RECORD_KEYS.STATUS]: "active",
    };
    const nameArg = dnsEncode(name);
    const initialCalls: string[] = Object.entries(records).map(([key, value]) =>
      resolverIface.encodeFunctionData("setText", [nameArg, key, value]),
    );

    // 3b. initData = resolver.initialize([operator: ALL_ROLES], initialCalls)
    const grants: Array<[string, bigint]> = [[operator.address, ENS_ALL_ROLES]];
    const initData = resolverIface.encodeFunctionData("initialize", [grants, initialCalls]);

    // Official salt scheme (docs, Verifiable Factory example):
    // keccak256(abi.encode(bytes("OwnedResolver"), owner, uint256(0))); the
    // factory takes the salt as uint256.
    const saltBytes32 = ethers.solidityPackedKeccak256(
      ["bytes", "address", "uint256"],
      [ethers.toUtf8Bytes("OwnedResolver"), robotSigners[robotId].address, 0],
    );
    const salt = BigInt(saltBytes32);

    const deployData = factoryIface.encodeFunctionData("deployProxy", [implAddress, salt, initData]);
    const tx = await operator.sendTransaction({ to: factoryAddress, data: deployData });
    const receipt = await tx.wait();
    if (!receipt) throw new Error(`deployProxy tx for ${robotId} produced no receipt`);
    const proxyAddress = addressFromProxyDeployed(receipt, factoryIface);

    console.log(`${name} resolver=${proxyAddress} (owner=${robotSigners[robotId].address})`);

    const resolver = resolverImplFactory.attach(proxyAddress) as unknown as {
      grantSetterRoles: (setter: string, account: string) => Promise<unknown>;
    };

    // 4. Safety officer: at most setText(status) — per-robot EAC, not upgrade/link.
    const statusSetter = resolverIface.encodeFunctionData("setText", [nameArg, ENS_RECORD_KEYS.STATUS, ""]);
    await (await resolver.grantSetterRoles(statusSetter, safetyOfficer.address)).wait();

    // 5. Own robot key: setText(last-episode) on its own resolver only.
    const episodeSetter = resolverIface.encodeFunctionData("setText", [nameArg, ENS_RECORD_KEYS.LAST_EPISODE, ""]);
    await (await resolver.grantSetterRoles(episodeSetter, robotSigners[robotId].address)).wait();

    robots[robotId] = { name, resolver: proxyAddress, owner: robotSigners[robotId].address, records };
  }

  const deployment = {
    network: network.name === "localhost" ? "hardhat-local" : network.name,
    chainId: Number(chainId),
    deployedAt: new Date().toISOString(),
    statement:
      "LOCAL THROWAWAY deployment for the Hardhat harness (chain id 31337). Not a Sepolia deployment. Contracts are the local ENSv2 replica, not the protocol-owned Sepolia contracts.",
    factory: { address: factoryAddress, implementation: implAddress },
    roles: { operator: operator.address, safetyOfficer: safetyOfficer.address },
    robots,
  };

  fs.mkdirSync(path.dirname(DEPLOYMENT_FILE), { recursive: true });
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(deployment, null, 2));
  console.log(`Deployment written: ${DEPLOYMENT_FILE}`);
}

/** Pull the proxy address from the ProxyDeployed event in a receipt. */
function addressFromProxyDeployed(
  receipt: { logs: Array<{ address: string; topics: string[]; data: string }> },
  iface: ethers.Interface,
): string {
  const eventTopic = ethers.id("ProxyDeployed(address,address,uint256,address)");
  for (const log of receipt.logs) {
    if (log.topics[0] === eventTopic) {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === "ProxyDeployed") {
        return parsed.args["proxyAddress"] as string;
      }
    }
  }
  throw new Error("ProxyDeployed event not found in receipt");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
