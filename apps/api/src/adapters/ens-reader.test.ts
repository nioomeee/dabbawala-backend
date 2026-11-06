/**
 * Unit tests for the ENS reader factory functions (configuration edge cases).
 *
 * The full read path is verified by the viem integration test in
 * contracts/test/hardhat/ensv2-viem-read.test.ts which uses real ABI encoding.
 */

import { describe, expect, it } from "vitest";

import { createViemPolicyClient, createEnsPolicyReader } from "./ens-reader.js";

describe("createViemPolicyClient", () => {
  it("accepts the Sepolia chain id", () => {
    const result = createViemPolicyClient({ rpcUrl: "https://sepolia.example", chainId: 11155111 });
    expect(result.ok).toBe(true);
  });

  it("refuses a non-Sepolia chain id as a config error", () => {
    const result = createViemPolicyClient({ rpcUrl: "http://127.0.0.1:8545", chainId: 31337 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not supported");
  });
});

describe("createEnsPolicyReader", () => {
  it("returns ok:false (not an error) without the S-ENS env", () => {
    const config = {
      NODE_ENV: "test",
      DATABASE_URL: "postgres://user:pass@localhost:5432/test",
      SEPOLIA_CHAIN_ID: 11155111,
    } as any;
    const result = createEnsPolicyReader(config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not set");
  });

  it("returns ok:false when a resolver env value is not a valid address", () => {
    const config = {
      NODE_ENV: "test",
      DATABASE_URL: "postgres://user:pass@localhost:5432/test",
      SEPOLIA_RPC_URL: "https://sepolia.example",
      SEPOLIA_CHAIN_ID: 11155111,
      ENS_ROBOT_RAMU_RESOLVER: "not-an-address",
      ENS_ROBOT_SAKHU_RESOLVER: "0x2222222222222222222222222222222222222222",
      ENS_ROBOT_JANU_RESOLVER: "0x3333333333333333333333333333333333333333",
    } as any;
    const result = createEnsPolicyReader(config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("valid address");
  });

  it("builds the reader with all three resolver addresses set", () => {
    const config = {
      NODE_ENV: "test",
      DATABASE_URL: "postgres://user:pass@localhost:5432/test",
      SEPOLIA_RPC_URL: "https://sepolia.example",
      SEPOLIA_CHAIN_ID: 11155111,
      ENS_ROBOT_RAMU_RESOLVER: "0x1111111111111111111111111111111111111111",
      ENS_ROBOT_SAKHU_RESOLVER: "0x2222222222222222222222222222222222222222",
      ENS_ROBOT_JANU_RESOLVER: "0x3333333333333333333333333333333333333333",
    } as any;
    const result = createEnsPolicyReader(config);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reader).toBeDefined();
  });
});