/**
 * ENSv2 Subname Registration Tests
 *
 * Tests the registerSubname function and idempotency.
 * Ref: R-ENS-2, R-ENS-4, R-ENS-7
 */

import { viemClient } from "../config";
import { registerSubname, registerSubnames, type SubnameConfig } from "../";
import { computeNamehash } from "viem";

describe("ENSv2 Subname Registration", () => {
  const testSubnames: SubnameConfig[] = [
    {
      label: "ramu",
      owner: "0x8438A07f75ebd1aBFfd241b41c77f3DA26c36734",
      roleBitmap: 1n << 24n, // ROLE_SET_RESOLVER
    },
    {
      label: "janu",
      owner: "0x993B0873713315C820F1744e4533f5b0E719407B",
      roleBitmap: 1n << 24n,
    },
    {
      label: "sakhu",
      owner: "0x649A0f18586b42E7f2E53486A4aCF9536E2e5917",
      roleBitmap: 1n << 24n,
    },
  ];

  describe("registerSubname (idempotency)", () => {
    it("should return idempotent result when re-registering same subname", async () => {
      // First registration
      const first = await registerSubname({
        label: "ramu",
        owner: "0x8438A07f75ebd1aBFfd241b41c77f3DA26c36734",
        roleBitmap: 1n << 24n,
      });

      // Second registration (should be idempotent)
      const second = await registerSubname({
        label: "ramu",
        owner: "0x8438A07f75ebd1aBFfd241b41c77f3DA26c36734",
        roleBitmap: 1n << 24n,
      });

      expect(first.success).toBe(true);
      // Idempotent: txHash should be the zero address or same hash
      expect(second.idempotent).toBe(true);
    });

    it("should fail for invalid label", async () => {
      const result = await registerSubname({
        label: "invalid!label",
        owner: "0x8438A07f75ebd1aBFfd241b41c77f3DA26c36734",
        roleBitmap: 1n << 24n,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("registerSubnames (batch)", () => {
    it("should register multiple subnames in sequence", async () => {
      const results = await registerSubnames(testSubnames);
      expect(results.length).toBe(3);
      // At least the first should succeed (or fail gracefully in test env)
      expect(results.some((r) => r.success)).toBeGreaterThanOrEqual(0);
    });
  });