 
import { describe, expect, it } from "vitest";
import { loadZeroGConfig, redactSecrets } from "../config.js";
import { FAKE_API_KEY, FAKE_PK } from "./helpers.js";

const LIVE_COMPUTE = {
  ZERO_G_ROUTER_BASE_URL: "https://router.test.invalid/v1/",
  ZERO_G_ROUTER_API_KEY: FAKE_API_KEY,
  ZERO_G_MODEL_ID: "test-model-1",
};
const LIVE_STORAGE = {
  ZERO_G_INDEXER_URL: "https://indexer.test.invalid",
  ZERO_G_RPC_URL: "https://rpc.test.invalid",
  ZERO_G_CHAIN_ID: "16602",
  ZERO_G_STORAGE_PRIVATE_KEY: FAKE_PK,
};

describe("loadZeroGConfig", () => {
  it("empty env => BLOCKED listing variable NAMES only", () => {
    const r = loadZeroGConfig({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.computeStatus).toEqual({
      mode: "BLOCKED",
      blockedBy: ["ZERO_G_ROUTER_BASE_URL", "ZERO_G_ROUTER_API_KEY", "ZERO_G_MODEL_ID"],
    });
    expect(r.value.storageStatus.mode).toBe("BLOCKED");
    expect(r.value.storageStatus.blockedBy).toContain("ZERO_G_STORAGE_PRIVATE_KEY");
  });

  it("treats REPLACE_WITH_* placeholders (repo .env.example) as unset", () => {
    const r = loadZeroGConfig({
      ZERO_G_ROUTER_BASE_URL: "https://router-api.0g.ai/v1",
      ZERO_G_ROUTER_API_KEY: "REPLACE_WITH_TESTNET_VALUE",
      ZERO_G_MODEL_ID: "REPLACE_WITH_TESTNET_VALUE",
    });
    expect(r.ok && r.value.computeStatus.blockedBy).toEqual(["ZERO_G_ROUTER_API_KEY", "ZERO_G_MODEL_ID"]);
  });

  it("complete env => LIVE, trailing slash trimmed", () => {
    const r = loadZeroGConfig({ ...LIVE_COMPUTE, ...LIVE_STORAGE });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.computeStatus.mode).toBe("LIVE");
    expect(r.value.storageStatus.mode).toBe("LIVE");
    expect(r.value.compute.baseUrl).toBe("https://router.test.invalid/v1");
  });

  it("rejects a management key (mk-) for inference without echoing it", () => {
    const r = loadZeroGConfig({ ...LIVE_COMPUTE, ZERO_G_ROUTER_API_KEY: "mk-SECRETSECRETSECRET1234" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error[0]?.variable).toBe("ZERO_G_ROUTER_API_KEY");
    expect(JSON.stringify(r.error)).not.toContain("SECRETSECRET");
  });

  it("rejects malformed key / url / numbers / booleans", () => {
    const r = loadZeroGConfig({
      ZERO_G_ROUTER_API_KEY: "not-a-key",
      ZERO_G_ROUTER_BASE_URL: "http://example.com/v1",
      ZERO_G_REQUEST_TIMEOUT_MS: "5",
      ZERO_G_JSON_MODE: "maybe",
      ZERO_G_STORAGE_PRIVATE_KEY: "0x1234",
      ZERO_G_RPC_URL: "https://user:pw@rpc.test.invalid",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const vars = r.error.map((i) => i.variable).sort();
    expect(vars).toEqual(
      [
        "ZERO_G_JSON_MODE",
        "ZERO_G_REQUEST_TIMEOUT_MS",
        "ZERO_G_ROUTER_API_KEY",
        "ZERO_G_ROUTER_BASE_URL",
        "ZERO_G_RPC_URL",
        "ZERO_G_STORAGE_PRIVATE_KEY",
      ].sort(),
    );
  });

  it("allows http only for loopback outside production", () => {
    expect(loadZeroGConfig({ ZERO_G_ROUTER_BASE_URL: "http://127.0.0.1:9999/v1" }).ok).toBe(true);
    expect(
      loadZeroGConfig({ NODE_ENV: "production", ZERO_G_ROUTER_BASE_URL: "http://127.0.0.1:9999/v1" }).ok,
    ).toBe(false);
  });

  it("mock mode is explicit and forbidden in production", () => {
    const m = loadZeroGConfig({ ZERO_G_MODE: "mock" });
    expect(m.ok && m.value.computeStatus.mode).toBe("MOCK");
    expect(m.ok && m.value.storageStatus.mode).toBe("MOCK");
    expect(loadZeroGConfig({ ZERO_G_MODE: "mock", NODE_ENV: "production" }).ok).toBe(false);
  });

  it("storage is BLOCKED unless chain id is Galileo 16602 (testnet-only guard)", () => {
    const r = loadZeroGConfig({ ...LIVE_STORAGE, ZERO_G_CHAIN_ID: "16661" });
    expect(r.ok && r.value.storageStatus.mode).toBe("BLOCKED");
    expect(r.ok && r.value.storageStatus.blockedBy).toEqual(["ZERO_G_CHAIN_ID(must be 16602)"]);
  });

  it("redactSecrets removes configured secrets", () => {
    const r = loadZeroGConfig({ ...LIVE_COMPUTE, ...LIVE_STORAGE });
    if (!r.ok) throw new Error("config");
    const out = redactSecrets(`a ${FAKE_API_KEY} b ${FAKE_PK}`, r.value.secrets);
    expect(out).toBe("a [REDACTED] b [REDACTED]");
  });
});
