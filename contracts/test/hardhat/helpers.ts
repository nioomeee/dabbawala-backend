/**
 * Test fixtures for the local ENSv2 replica harness.
 *
 * Mirrors contracts/scripts/ens-local.ts: the operator holds ALL_ROLES
 * (regular + admin) on ROOT_RESOURCE of every robot resolver through the
 * factory initialize(grants, calls); the safety officer receives
 * grantSetterRoles(setText(status)) on every resolver; each robot signer
 * receives grantSetterRoles(setText(last-episode)) on its own resolver only.
 * ref: ROADMAP.md §6 E1-E5, ENSv2_implementation.md §5, R-ENS-2, R-ENS-4,
 * R-ENS-5 (Verifiable Factory salt scheme).
 */
import { ethers } from "hardhat";
import { namehash, packetToBytes } from "viem/ens";

import {
  ENS_ALL_ROLES,
  ENS_RECORD_KEYS,
  ROBOT_BUDGET_MICRO_HBAR,
  ROBOT_ZONES,
  type RobotId,
} from "@dabbawala/shared";

// ── minimal typed surfaces (no typechain; zero any) ──────────────────────────

/** Methods exercised by the Dabbawala tests on a PermissionedResolver proxy. */
export interface Resolver {
  getAddress(): Promise<string>;
  connect(signer: ethers.Signer): Resolver;
  setText(name: string, key: string, value: string): Promise<ethers.ContractTransactionResponse>;
  grantSetterRoles(setter: string, account: string): Promise<ethers.ContractTransactionResponse>;
  grantRootRoles(roleBitmap: bigint, account: string): Promise<ethers.ContractTransactionResponse>;
  revokeRootRoles(roleBitmap: bigint, account: string): Promise<ethers.ContractTransactionResponse>;
  revokeRoles(resource: bigint, roleBitmap: bigint, account: string): Promise<ethers.ContractTransactionResponse>;
  grantRoles(resource: bigint, roleBitmap: bigint, account: string): Promise<ethers.ContractTransactionResponse>;
  roles(resource: bigint, account: string): Promise<bigint>;
  roleCount(resource: bigint): Promise<bigint>;
  hasRoles(resource: bigint, roleBitmap: bigint, account: string): Promise<boolean>;
  hasRootRoles(roleBitmap: bigint, account: string): Promise<boolean>;
  decodeSetter(setter: string): Promise<[string, bigint, bigint]>;
  getRecordId(node: string): Promise<bigint>;
  getRecordCount(): Promise<bigint>;
}

/** Resolver read path: resolve(name, data) returns raw bytes (abi-encoded). */
export interface ResolverReadOnly {
  resolve(name: string, data: string): Promise<string>;
}

export interface Factory {
  readonly address: string;
  connect(signer: ethers.Signer): Factory;
  deployProxy(
    implementation: string,
    salt: bigint,
    initData: string,
  ): Promise<ethers.ContractTransactionResponse>;
  predictProxyAddress(deployer: string, salt: bigint): Promise<string>;
  verifyContract(candidate: string): Promise<string>;
  interface: ethers.Interface;
}

export interface EnsHarness {
  operator: ethers.Signer;
  safetyOfficer: ethers.Signer;
  robotSigners: Record<RobotId, ethers.Signer>;
  resolverImplAddress: string;
  factory: Factory;
  resolvers: Record<RobotId, Resolver>;
  names: Record<RobotId, string>;
}

export const ROBOT_IDS_AS_LIST: RobotId[] = ["ramu", "sakhu", "janu"];

// ── ABI ──────────────────────────────────────────────────────────────────────

const RESOLVER_INIT_ABI_ONLY = [
  "function initialize((address,uint256)[] grants, bytes[] calls)",
  "function setText(bytes name, string key, string value)",
];

const FACTORY_ABI_ARRAY = [
  "function deployProxy(address implementation, uint256 salt, bytes initData) returns (address proxyAddress)",
  "function predictProxyAddress(address deployer, uint256 salt) view returns (address proxy)",
  "function verifyContract(address candidate) view returns (address implementation)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
];

export const resolverInitIface = new ethers.Interface(RESOLVER_INIT_ABI_ONLY);

// ── name helpers (via viem/ens, ref: R-ENS-8) ────────────────────────────────

/** DNS wire format (RFC 1035 packet bytes) for a dot-separated name. */
export function dnsEncode(name: string): string {
  return ethers.hexlify(packetToBytes(name));
}

/** ENS namehash (EIP-137) via viem/ens. */
export function nodeFor(name: string): string {
  return namehash(name);
}

/** resolve() profile calldata for the text(bytes32,string) selector. */
export function textProfile(key: string): string {
  const profile = new ethers.Interface(["function text(bytes32 node, string key)"]);
  return profile.encodeFunctionData("text", [ethers.ZeroHash, key]);
}

/** Decode the abi.encode(...) string payload returned by resolve(). */
export function decodeText(raw: string): string {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  return coder.decode(["string"], raw)[0] as string;
}

export function decodeBytes(raw: string): string {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  return coder.decode(["bytes"], raw)[0] as string;
}

export function decodeAddress(raw: string): string {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  return coder.decode(["address"], raw)[0] as string;
}

/** Read a text record for `name` through resolve(). */
export async function readText(resolver: ResolverReadOnly, name: string, key: string): Promise<string> {
  const raw = await resolver.resolve(dnsEncode(name), textProfile(key));
  return decodeText(raw);
}

export function ownedResolverSalt(owner: string): string {
  // Official Verifiable Factory salt scheme (docs example):
  // keccak256(abi.encode(bytes("OwnedResolver"), owner, uint256(0))). ref: R-ENS-4
  return ethers.solidityPackedKeccak256(
    ["bytes", "address", "uint256"],
    [ethers.toUtf8Bytes("OwnedResolver"), owner, 0],
  );
}

// ── fixture ──────────────────────────────────────────────────────────────────

function asResolver(base: ethers.BaseContract): Resolver {
  return base as unknown as Resolver;
}

function asFactory(base: ethers.BaseContract): Factory {
  return base as unknown as Factory;
}

/**
 * Deploy the full local harness:
 *   implementation + factory, then one resolver proxy per robot with
 *   operator as sole ALL_ROLES (regular + admin) holder on ROOT_RESOURCE,
 *   initial records zones/budget/status, officer + robot scoped grants.
 */
export async function setupEnsHarness(): Promise<EnsHarness> {
  const signers = await ethers.getSigners();
  const [operator, safetyOfficer, ramu, sakhu, janu] = signers;
  const robotSigners: Record<RobotId, ethers.Signer> = { ramu, sakhu, janu };

  const resolverCtor = await ethers.getContractFactory("PermissionedResolver", operator);
  const implBase = await (await resolverCtor.deploy()).waitForDeployment();
  const resolverImplAddress = await implBase.getAddress();

  const factoryBase = await (await ethers.getContractFactory("VerifiableFactoryReplica", operator).then((f) => f.deploy())).waitForDeployment();
  const factory = asFactory(factoryBase);

  const resolvers = {} as Record<RobotId, Resolver>;
  const names = {} as Record<RobotId, string>;

  for (const robotId of ROBOT_IDS_AS_LIST) {
    const name = `${robotId}.dabbawala.eth`;
    const nameWire = dnsEncode(name);
    const owner = robotSigners[robotId];

    // Initial records, written by factory-initialize with role checks skipped.
    const initialCalls: string[] = [
      resolverInitIface.encodeFunctionData("setText", [nameWire, ENS_RECORD_KEYS.ZONES, JSON.stringify(ROBOT_ZONES[robotId])]),
      resolverInitIface.encodeFunctionData("setText", [nameWire, ENS_RECORD_KEYS.BUDGET, String(ROBOT_BUDGET_MICRO_HBAR[robotId])]),
      resolverInitIface.encodeFunctionData("setText", [nameWire, ENS_RECORD_KEYS.STATUS, "active"]),
    ];
    const initData = resolverInitIface.encodeFunctionData("initialize", [
      [[await operator.getAddress(), ENS_ALL_ROLES]],
      initialCalls,
    ]);

    const salt = BigInt(ownedResolverSalt(await owner.getAddress()));
    const tx = await factory.connect(operator).deployProxy(resolverImplAddress, salt, initData);
    const receipt = await tx.wait();
    if (!receipt) throw new Error(`deployProxy for ${robotId} returned no receipt`);

    let proxyAddress: string | null = null;
    for (const log of receipt.logs) {
      const parsed = factory.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed && parsed.name === "ProxyDeployed") {
        const candidate = parsed.args["proxyAddress"];
        if (typeof candidate === "string") {
          proxyAddress = ethers.getAddress(candidate);
        }
        break;
      }
    }
    if (!proxyAddress) throw new Error(`ProxyDeployed event missing for ${robotId}`);

    const resolver = asResolver(resolverCtor.attach(proxyAddress));

    // Safety officer: exactly setText(status) — nothing else, no admin bits.
    const statusSetter = resolverInitIface.encodeFunctionData("setText", [nameWire, ENS_RECORD_KEYS.STATUS, ""]);
    await (await resolver.connect(operator).grantSetterRoles(statusSetter, await safetyOfficer.getAddress())).wait();

    // Robot key: exactly setText(last-episode) on its own resolver only.
    const episodeSetter = resolverInitIface.encodeFunctionData("setText", [nameWire, ENS_RECORD_KEYS.LAST_EPISODE, ""]);
    await (await resolver.connect(operator).grantSetterRoles(episodeSetter, await owner.getAddress())).wait();

    resolvers[robotId] = resolver;
    names[robotId] = name;
  }

  return {
    operator,
    safetyOfficer,
    robotSigners,
    resolverImplAddress,
    factory,
    resolvers,
    names,
  };
}
