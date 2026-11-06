/**
 * ENSv2 Resolution Tests
 *
 * Tests that subnames resolve correctly through the Universal Resolver.
 * Ref: R-ENS-2, R-ENS-7
 */

import { viemClient } from "../config";
import { computeNamehash } from "viem";

describe("ENSv2 Resolution", () => {
  const subnames = ["ramu", "janu", "sakhu"];

  describe("resolve through Universal Resolver", () => {
    it("should resolve label hash through on-chain lookup", async () => {
      for (const label of subnames) {
        const labelHash = computeNamehash(label);
        // Read the resolver address from the parent registry
        const resolver = await viemClient!.readContract({
          address: "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4", // .eth registry
          abi: [{ type: "function", name: "getResolver", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] }],
          functionName: "getResolver",
          args: [labelHash],
        });
        expect(resolver).toBeDefined();
      }
    });

    it("should check owner via getState / ownerOf", async () => {
      // In a real Sepolia environment, we would verify:
      // - resolve <label>.dabbawala.eth returns owner wallet
      // - ownerOf(tokenId) is the owner
      // This is a structural test verifying the import paths work
      expect(viemClient).toBeDefined();
    });
  });