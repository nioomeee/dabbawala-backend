/**
 * VerifiableFactoryReplica tests — official Verifiable Factory semantics
 * (github.com/ensdomains/verifiable-factory, fetched 2026-11-05; ref: R-ENS-4):
 * CREATE2 address prediction (outerSalt = keccak(deployer, salt)), on-chain
 * provenance via verifyContract (appended-salt reconstruction), collision
 * guard on replayed salts, and one-shot initialize.
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { ownedResolverSalt, resolverInitIface, setupEnsHarness } from "./helpers";

describe("VerifiableFactoryReplica (R-ENS-4)", () => {
  it("deploys each robot proxy at the predicted CREATE2 address and verifies it", async () => {
    const h = await loadFixture(setupEnsHarness);
    const deployer = await h.operator.getAddress();
    for (const robotId of ["ramu", "sakhu", "janu"] as const) {
      // The user salt embeds the robot owner; the deployProxy caller is the operator.
      const salt = BigInt(ownedResolverSalt(await h.robotSigners[robotId].getAddress()));
      const proxyAddress = await h.resolvers[robotId].getAddress();
      const predicted = await h.factory.predictProxyAddress(deployer, salt);
      expect(ethers.getAddress(predicted)).to.equal(proxyAddress);
      const verifiedImplementation = await h.factory.verifyContract(proxyAddress);
      expect(ethers.getAddress(verifiedImplementation)).to.equal(h.resolverImplAddress);
    }
  });

  it("the derived salt depends on the deployer: same user salt, different proxies", async () => {
    const h = await loadFixture(setupEnsHarness);
    const salt = BigInt(ownedResolverSalt(await h.robotSigners.sakhu.getAddress()));
    // The fixture deployed via the operator, so the operator's prediction matches.
    const asOperator = await h.factory.predictProxyAddress(await h.operator.getAddress(), salt);
    expect(ethers.getAddress(asOperator)).to.equal(await h.resolvers.sakhu.getAddress());
    // A different deployer derives a different outerSalt → different proxy.
    const asSakhu = await h.factory.predictProxyAddress(await h.robotSigners.sakhu.getAddress(), salt);
    expect(ethers.getAddress(asSakhu)).to.not.equal(ethers.getAddress(asOperator));
  });

  it("verifyContract reverts VerificationFailed for a non-clone contract", async () => {
    const h = await loadFixture(setupEnsHarness);
    await expect(
      h.factory.verifyContract(h.resolverImplAddress),
    ).to.be.revertedWithCustomError(h.factory, "VerificationFailed");
  });

  it("replaying the same (deployer, salt) fails the CREATE2 (official bare revert)", async () => {
    const h = await loadFixture(setupEnsHarness);
    const salt = BigInt(ownedResolverSalt(await h.robotSigners.ramu.getAddress()));
    const initData = resolverInitIface.encodeFunctionData("initialize", [[], []]);
    await expect(
      h.factory.connect(h.operator).deployProxy(h.resolverImplAddress, salt, initData),
    ).to.be.reverted;
  });

  it("the proxy rejects a second initialize (one-shot)", async () => {
    const h = await loadFixture(setupEnsHarness);
    const artifact = await ethers.getContractFactory("PermissionedResolver", h.operator);
    const attached = artifact.attach(await h.resolvers.ramu.getAddress()) as unknown as {
      initialize(...args: unknown[]): Promise<ethers.ContractTransactionResponse>;
    };
    await expect(attached.initialize([], [])).to.be.revertedWithCustomError(
      attached as unknown as ethers.BaseContract,
      "AlreadyInitialized",
    );
  });
});
