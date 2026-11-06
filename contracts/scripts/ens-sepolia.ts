/**
 * Sepolia ENSv2 Deployment — Dabbawala robot passports (Ethereum Sepolia).
 *
 * Deploys per-robot Permissioned Resolver proxies using the official ENSv2
 * VerifiableFactory on Sepolia (chain 11155111).
 *
 * Official Sepolia addresses (docs.ens.domains):
 *   - VerifiableFactory: 0x77510ba162dfea3d8989e3f0928a691b345730d2
 *   - PermissionedResolverImpl: 0x565b0f456a04ac9b48758190e90030623cff57c5
 *
 * Usage:
 *   pnpm --filter @dabbawala/contracts ens:deploy:sepolia
 *
 * Requires environment variables:
 *   - SEPOLIA_RPC_URL
 *   - OPERATOR_PRIVATE_KEY
 * Optional (will fall back to operator address for testing if omitted):
 *   - SAFETY_OFFICER_PRIVATE_KEY or SAFETY_OFFICER_ADDRESS
 *   - ROBOT_RAMU_PRIVATE_KEY / ROBOT_RAMU_ADDRESS
 *   - ROBOT_SAKHU_PRIVATE_KEY / ROBOT_SAKHU_ADDRESS
 *   - ROBOT_JANU_PRIVATE_KEY / ROBOT_JANU_ADDRESS
 */

import fs from "node:fs";
import path from "node:path";
import { ethers, network } from "hardhat";

import {
  ENS_ALL_ROLES,
  ENS_RECORD_KEYS,
  ROBOT_BUDGET_MICRO_HBAR,
  ROBOT_ENS_NAMES,
  ROBOT_IDS,
  ROBOT_ZONES,
  type RobotId,
} from "@dabbawala/shared";

// Official ENSv2 Sepolia contract addresses
const DEFAULT_FACTORY_ADDRESS = "0x77510ba162dfea3d8989e3f0928a691b345730d2";
const DEFAULT_IMPL_ADDRESS = "0x565b0f456a04ac9b48758190e90030623cff57c5";

/** DNS wire-format calldata value for a dot-separated ENS name. */
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
const DEPLOYMENT_FILE = process.env["SEPOLIA_ENS_DEPLOYMENT_FILE"] ?? path.join(DEPLOYMENT_DIR, "sepolia.json");

function getAddressForRole(envKey: string, fallbackSignerAddress: string): string {
  const explicitAddr = process.env[`${envKey}_ADDRESS`];
  if (explicitAddr && ethers.isAddress(explicitAddr)) {
    return explicitAddr;
  }
  const privKey = process.env[`${envKey}_PRIVATE_KEY`];
  if (privKey && privKey.startsWith("0x")) {
    try {
      return new ethers.Wallet(privKey).address;
    } catch {
      // ignore
    }
  }
  return fallbackSignerAddress;
}

async function main(): Promise<void> {
  const [defaultSigner] = await ethers.getSigners();
  const operator = process.env.OPERATOR_PRIVATE_KEY
    ? new ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY, ethers.provider)
    : defaultSigner;

  if (!operator) {
    throw new Error("No operator signer available. Set OPERATOR_PRIVATE_KEY in .env");
  }

  const { chainId } = await ethers.provider.getNetwork();
  console.log(`Connecting to network: ${network.name} (chainId=${chainId})`);
  console.log(`Operator: ${await operator.getAddress()}`);

  const factoryAddress = process.env.ENS_VERIFIABLE_FACTORY_ADDRESS || DEFAULT_FACTORY_ADDRESS;
  const implAddress = process.env.ENS_PERMISSIONED_RESOLVER_IMPL || DEFAULT_IMPL_ADDRESS;

  console.log(`Using ENS VerifiableFactory: ${factoryAddress}`);
  console.log(`Using ENS PermissionedResolverImpl: ${implAddress}`);

  const operatorAddress = await operator.getAddress();
  const safetyOfficerAddress = getAddressForRole("SAFETY_OFFICER", operatorAddress);
  console.log(`Safety Officer: ${safetyOfficerAddress}`);

  const robotOwners: Record<RobotId, string> = {
    ramu: getAddressForRole("ROBOT_RAMU", operatorAddress),
    sakhu: getAddressForRole("ROBOT_SAKHU", operatorAddress),
    janu: getAddressForRole("ROBOT_JANU", operatorAddress),
  };

  const factoryIface = new ethers.Interface(FACTORY_ABI);
  const resolverIface = new ethers.Interface(RESOLVER_ABI);

  const deployedRobots: Record<string, { name: string; resolver: string; owner: string; records: Record<string, string> }> = {};

  for (const robotId of ROBOT_IDS) {
    const name = ROBOT_ENS_NAMES[robotId];
    const zones = ROBOT_ZONES[robotId];
    const budget = String(ROBOT_BUDGET_MICRO_HBAR[robotId]);
    const owner = robotOwners[robotId];

    console.log(`\nDeploying resolver for ${robotId} (${name})...`);

    // Initial records encoded in factory initialization
    const records: Record<string, string> = {
      [ENS_RECORD_KEYS.ZONES]: JSON.stringify(zones),
      [ENS_RECORD_KEYS.BUDGET]: budget,
      [ENS_RECORD_KEYS.STATUS]: "active",
    };
    const nameArg = dnsEncode(name);
    const initialCalls: string[] = Object.entries(records).map(([key, value]) =>
      resolverIface.encodeFunctionData("setText", [nameArg, key, value]),
    );

    const grants: Array<[string, bigint]> = [[operatorAddress, ENS_ALL_ROLES]];
    const initData = resolverIface.encodeFunctionData("initialize", [grants, initialCalls]);

    // Official salt scheme: keccak256(abi.encode(bytes("OwnedResolver"), owner, uint256(0)))
    const saltBytes32 = ethers.solidityPackedKeccak256(
      ["bytes", "address", "uint256"],
      [ethers.toUtf8Bytes("OwnedResolver"), owner, 0],
    );
    const salt = BigInt(saltBytes32);

    const deployData = factoryIface.encodeFunctionData("deployProxy", [implAddress, salt, initData]);
    const tx = await operator.sendTransaction({ to: factoryAddress, data: deployData });
    console.log(`Transaction sent: ${tx.hash}. Waiting for confirmation...`);
    const receipt = await tx.wait();
    if (!receipt) throw new Error(`deployProxy tx for ${robotId} produced no receipt`);

    const proxyAddress = addressFromProxyDeployed(receipt, factoryIface);
    console.log(`Deployed resolver proxy for ${name} at: ${proxyAddress}`);

    const resolver = new ethers.Contract(proxyAddress, RESOLVER_ABI, operator);

    // Grant status setter to Safety Officer
    console.log(`Granting status setter role to safety officer (${safetyOfficerAddress})...`);
    const statusSetter = resolverIface.encodeFunctionData("setText", [nameArg, ENS_RECORD_KEYS.STATUS, ""]);
    const txStatus = await resolver.grantSetterRoles(statusSetter, safetyOfficerAddress);
    await txStatus.wait();

    // Grant last-episode setter to Robot owner
    console.log(`Granting last-episode setter role to robot owner (${owner})...`);
    const episodeSetter = resolverIface.encodeFunctionData("setText", [nameArg, ENS_RECORD_KEYS.LAST_EPISODE, ""]);
    const txEpisode = await resolver.grantSetterRoles(episodeSetter, owner);
    await txEpisode.wait();

    deployedRobots[robotId] = {
      name,
      resolver: proxyAddress,
      owner,
      records,
    };
  }

  const deployment = {
    network: network.name,
    chainId: Number(chainId),
    deployedAt: new Date().toISOString(),
    statement: "Official ENSv2 Sepolia deployment for Dabbawala Protocol.",
    factory: { address: factoryAddress, implementation: implAddress },
    roles: { operator: operatorAddress, safetyOfficer: safetyOfficerAddress },
    robots: deployedRobots,
  };

  fs.mkdirSync(path.dirname(DEPLOYMENT_FILE), { recursive: true });
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(deployment, null, 2));
  console.log(`\nDeployment summary successfully written to: ${DEPLOYMENT_FILE}`);
}

function addressFromProxyDeployed(
  receipt: { logs: ReadonlyArray<{ topics: ReadonlyArray<string>; data: string }> },
  iface: ethers.Interface,
): string {
  const eventTopic = ethers.id("ProxyDeployed(address,address,uint256,address)");
  for (const log of receipt.logs) {
    if (log.topics[0] === eventTopic) {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed && parsed.name === "ProxyDeployed") {
        return parsed.args["proxyAddress"] as string;
      }
    }
  }
  throw new Error("ProxyDeployed event not found in receipt");
}

main().catch((err: unknown) => {
  console.error("Sepolia deployment failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
