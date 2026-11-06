/**
 * EAC + record-bundle scenes E1-E5 (ROADMAP §6, ENSv2_implementation.md §5):
 *   E1  operator record writes and public reads via resolve()
 *   E2  robot writes are scoped to last-episode on its OWN resolver
 *   E3  cross-resolver writes from a robot key revert
 *   E4  safety officer may set status only (never zones/budget, no admin bits)
 *   E5  role management edges: grantRoles disabled, admin required for
 *       granting, scoped revocation works, ROOT_RESOURCE revoke forbidden
 * ref: R-ENS-2 (Permissioned Resolver), R-ENS-3 (Enhanced Access Control).
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import {
  ENS_RECORD_KEYS,
  ROBOT_BUDGET_MICRO_HBAR,
  ROBOT_ZONES,
  ROOT_RESOURCE,
  ensRoleAdmin,
} from "@dabbawala/shared";

import {
  dnsEncode,
  nodeFor,
  readText,
  resolverInitIface,
  setupEnsHarness,
} from "./helpers";

const ROLE_SET_TEXT = 1n << 4n;

/** The EAC resource a text key maps to: keccak256 of the key bytes. */
function keyResource(key: string): bigint {
  return BigInt(ethers.keccak256(ethers.toUtf8Bytes(key)));
}

describe("E1 — operator record writes and public reads", () => {
  it("seeds zones / budget / status at initialization and reads them back via resolve()", async () => {
    const h = await loadFixture(setupEnsHarness);
    expect(await readText(h.resolvers.ramu, h.names.ramu, ENS_RECORD_KEYS.ZONES)).to.equal(
      JSON.stringify(ROBOT_ZONES.ramu),
    );
    expect(await readText(h.resolvers.sakhu, h.names.sakhu, ENS_RECORD_KEYS.BUDGET)).to.equal(
      String(ROBOT_BUDGET_MICRO_HBAR.sakhu),
    );
    expect(await readText(h.resolvers.janu, h.names.janu, ENS_RECORD_KEYS.STATUS)).to.equal("active");
  });

  it("reads are public: an account with no write roles still resolves", async () => {
    const h = await loadFixture(setupEnsHarness);
    const strangerResolver = h.resolvers.ramu.connect(h.robotSigners.janu);
    expect(await readText(strangerResolver, h.names.ramu, ENS_RECORD_KEYS.STATUS)).to.equal("active");
  });

  it("operator updates one robot's budget; other robots are untouched", async () => {
    const h = await loadFixture(setupEnsHarness);
    const ramuResolver = h.resolvers.ramu.connect(h.operator);
    await (await ramuResolver.setText(dnsEncode(h.names.ramu), ENS_RECORD_KEYS.BUDGET, "6000")).wait();
    expect(await readText(ramuResolver, h.names.ramu, ENS_RECORD_KEYS.BUDGET)).to.equal("6000");
    expect(await readText(h.resolvers.sakhu, h.names.sakhu, ENS_RECORD_KEYS.BUDGET)).to.equal(
      String(ROBOT_BUDGET_MICRO_HBAR.sakhu),
    );
  });

  it("a write through an unlinked name mints a record bundle and auto-links it", async () => {
    const h = await loadFixture(setupEnsHarness);
    const ramuResolver = h.resolvers.ramu.connect(h.operator);
    const before = await ramuResolver.getRecordCount();
    await (await ramuResolver.setText(dnsEncode("x.dabbawala.eth"), ENS_RECORD_KEYS.STATUS, "active")).wait();
    expect(await ramuResolver.getRecordCount()).to.equal(before + 1n);
    expect(await readText(ramuResolver, "x.dabbawala.eth", ENS_RECORD_KEYS.STATUS)).to.equal("active");
  });

  it("seeded names are linked under their EIP-137 namehash nodes", async () => {
    const h = await loadFixture(setupEnsHarness);
    const ramuResolver = h.resolvers.ramu.connect(h.robotSigners.janu);
    expect(await ramuResolver.getRecordId(nodeFor(h.names.ramu))).to.not.equal(0n);
    expect(await ramuResolver.getRecordId(nodeFor("missing.dabbawala.eth"))).to.equal(0n);
  });

  it("an unregistered name serves the default root bundle (empty)", async () => {
    const h = await loadFixture(setupEnsHarness);
    expect(await readText(h.resolvers.ramu, "nobody.dabbawala.eth", ENS_RECORD_KEYS.STATUS)).to.equal("");
  });
});

describe("E2 — robot authority is last-episode on its own resolver only", () => {
  it("robot cannot set status / zones / budget on its own resolver", async () => {
    const h = await loadFixture(setupEnsHarness);
    const ramuKey = h.resolvers.ramu.connect(h.robotSigners.ramu);
    const nameWire = dnsEncode(h.names.ramu);
    await expect(
      ramuKey.setText(nameWire, ENS_RECORD_KEYS.STATUS, "paused"),
    ).to.be.revertedWithCustomError(ramuKey, "EACUnauthorizedAccountRoles");
    await expect(
      ramuKey.setText(nameWire, ENS_RECORD_KEYS.ZONES, '["andheri"]'),
    ).to.be.revertedWithCustomError(ramuKey, "EACUnauthorizedAccountRoles");
    await expect(
      ramuKey.setText(nameWire, ENS_RECORD_KEYS.BUDGET, "999999"),
    ).to.be.revertedWithCustomError(ramuKey, "EACUnauthorizedAccountRoles");
  });

  it("robot CAN write last-episode on its own resolver and the value is visible", async () => {
    const h = await loadFixture(setupEnsHarness);
    const ramuKey = h.resolvers.ramu.connect(h.robotSigners.ramu);
    await (await ramuKey.setText(dnsEncode(h.names.ramu), ENS_RECORD_KEYS.LAST_EPISODE, "EP-042")).wait();
    expect(await readText(ramuKey, h.names.ramu, ENS_RECORD_KEYS.LAST_EPISODE)).to.equal("EP-042");
  });
});

describe("E3 — a robot key never crosses resolver boundaries", () => {
  it("ramu's last-episode write reverts on sakhu's resolver", async () => {
    const h = await loadFixture(setupEnsHarness);
    const sakhuResolver = h.resolvers.sakhu.connect(h.robotSigners.ramu);
    await expect(
      sakhuResolver.setText(dnsEncode(h.names.sakhu), ENS_RECORD_KEYS.LAST_EPISODE, "spoof"),
    ).to.be.revertedWithCustomError(sakhuResolver, "EACUnauthorizedAccountRoles");
  });

  it("sakhu's last-episode record stays empty after the reverted write", async () => {
    const h = await loadFixture(setupEnsHarness);
    expect(await readText(h.resolvers.sakhu, h.names.sakhu, ENS_RECORD_KEYS.LAST_EPISODE)).to.equal("");
  });
});

describe("E4 — safety officer may set status only", () => {
  it("officer sets status on each robot resolver per the deployment grants", async () => {
    const h = await loadFixture(setupEnsHarness);
    for (const robotId of ["ramu", "sakhu", "janu"] as const) {
      const resolver = h.resolvers[robotId].connect(h.safetyOfficer);
      await (await resolver.setText(dnsEncode(h.names[robotId]), ENS_RECORD_KEYS.STATUS, "paused")).wait();
      expect(await readText(resolver, h.names[robotId], ENS_RECORD_KEYS.STATUS)).to.equal("paused");
    }
  });

  it("officer cannot set zones or budget", async () => {
    const h = await loadFixture(setupEnsHarness);
    const resolver = h.resolvers.ramu.connect(h.safetyOfficer);
    const nameWire = dnsEncode(h.names.ramu);
    await expect(
      resolver.setText(nameWire, ENS_RECORD_KEYS.ZONES, '["colaba"]'),
    ).to.be.revertedWithCustomError(resolver, "EACUnauthorizedAccountRoles");
    await expect(
      resolver.setText(nameWire, ENS_RECORD_KEYS.BUDGET, "999999"),
    ).to.be.revertedWithCustomError(resolver, "EACUnauthorizedAccountRoles");
  });

  it("officer holds no admin bits and only the status key resource role", async () => {
    const h = await loadFixture(setupEnsHarness);
    const officer = await h.safetyOfficer.getAddress();
    const resolver = h.resolvers.ramu;
    expect(await resolver.hasRoles(keyResource(ENS_RECORD_KEYS.STATUS), ROLE_SET_TEXT, officer)).to.equal(true);
    expect(await resolver.hasRoles(keyResource(ENS_RECORD_KEYS.ZONES), ROLE_SET_TEXT, officer)).to.equal(false);
    expect(await resolver.hasRootRoles(ensRoleAdmin(ROLE_SET_TEXT), officer)).to.equal(false);
    // roleCount returns a nybble-per-role bitmap: ROLE_SET_TEXT lives in
    // nybble 1, so one holder reads as 0x10. Read back that nybble.
    const countBitmap = await resolver.roleCount(keyResource(ENS_RECORD_KEYS.STATUS));
    expect((countBitmap >> 4n) & 0xFn).to.equal(1n);
  });
});

describe("E5 — role management edges", () => {
  it("generic grantRoles() is permanently disabled (EACCannotGrantRoles)", async () => {
    const h = await loadFixture(setupEnsHarness);
    const resolver = h.resolvers.ramu.connect(h.operator);
    await expect(
      resolver.grantRoles(keyResource(ENS_RECORD_KEYS.STATUS), ROLE_SET_TEXT, await h.safetyOfficer.getAddress()),
    ).to.be.revertedWithCustomError(resolver, "EACCannotGrantRoles");
  });

  it("a role holder without the admin counterpart cannot grantSetterRoles", async () => {
    const h = await loadFixture(setupEnsHarness);
    const statusSetter = resolverInitIface.encodeFunctionData("setText", [
      dnsEncode(h.names.ramu),
      ENS_RECORD_KEYS.STATUS,
      "",
    ]);
    const officer = h.resolvers.ramu.connect(h.safetyOfficer);
    const robot = h.resolvers.ramu.connect(h.robotSigners.ramu);
    const anotherRobot = await h.robotSigners.janu.getAddress();
    await expect(
      officer.grantSetterRoles(statusSetter, anotherRobot),
    ).to.be.revertedWithCustomError(officer, "EACUnauthorizedAccountRoles");
    await expect(
      robot.grantSetterRoles(statusSetter, anotherRobot),
    ).to.be.revertedWithCustomError(robot, "EACUnauthorizedAccountRoles");
  });

  it("revokeRoles may not target ROOT_RESOURCE (RootResourceForbidden)", async () => {
    const h = await loadFixture(setupEnsHarness);
    const resolver = h.resolvers.ramu.connect(h.operator);
    await expect(
      resolver.revokeRoles(ROOT_RESOURCE, ROLE_SET_TEXT, await h.operator.getAddress()),
    ).to.be.revertedWithCustomError(resolver, "RootResourceForbidden");
  });

  it("operator grants a scoped role then revokes it; the write right disappears", async () => {
    const h = await loadFixture(setupEnsHarness);
    const zonesSetter = resolverInitIface.encodeFunctionData("setText", [
      dnsEncode(h.names.ramu),
      ENS_RECORD_KEYS.ZONES,
      "",
    ]);
    const tempAcct = await h.safetyOfficer.getAddress();
    const resolver = h.resolvers.ramu;

    // Grant (operator holds every admin bit at ROOT_RESOURCE).
    await (await resolver.connect(h.operator).grantSetterRoles(zonesSetter, tempAcct)).wait();
    expect(
      await resolver.connect(h.safetyOfficer).hasRoles(keyResource(ENS_RECORD_KEYS.ZONES), ROLE_SET_TEXT, tempAcct),
    ).to.equal(true);

    // Revoke, then verify the write path has no authorised writes anymore.
    await (await resolver.connect(h.operator).revokeRoles(keyResource(ENS_RECORD_KEYS.ZONES), ROLE_SET_TEXT, tempAcct)).wait();
    expect(
      await resolver.connect(h.safetyOfficer).hasRoles(keyResource(ENS_RECORD_KEYS.ZONES), ROLE_SET_TEXT, tempAcct),
    ).to.equal(false);
    await expect(
      resolver
        .connect(h.safetyOfficer)
        .setText(dnsEncode(h.names.ramu), ENS_RECORD_KEYS.ZONES, '["andheri"]'),
    ).to.be.revertedWithCustomError(resolver.connect(h.safetyOfficer), "EACUnauthorizedAccountRoles");
    expect(await readText(resolver, h.names.ramu, ENS_RECORD_KEYS.ZONES)).to.equal(
      JSON.stringify(ROBOT_ZONES.ramu),
    );
  });

  it("decodeSetter returns the scoped argument, resource and role", async () => {
    const h = await loadFixture(setupEnsHarness);
    const setter = resolverInitIface.encodeFunctionData("setText", [
      dnsEncode(h.names.ramu),
      ENS_RECORD_KEYS.STATUS,
      "ignored-value",
    ]);
    const [argument, resource, role] = await h.resolvers.ramu.decodeSetter(setter);
    expect(ethers.toUtf8String(argument)).to.equal(ENS_RECORD_KEYS.STATUS);
    expect(resource).to.equal(keyResource(ENS_RECORD_KEYS.STATUS));
    expect(role).to.equal(ROLE_SET_TEXT);
  });

  it("operator (master key) writes to a fresh key resource without any scoped grant", async () => {
    const h = await loadFixture(setupEnsHarness);
    const resolver = h.resolvers.ramu.connect(h.operator);
    await (await resolver.setText(dnsEncode(h.names.ramu), ENS_RECORD_KEYS.AGENT_CONTEXT, '{"v":1}')).wait();
    expect(await readText(resolver, h.names.ramu, ENS_RECORD_KEYS.AGENT_CONTEXT)).to.equal('{"v":1}');
  });
});
