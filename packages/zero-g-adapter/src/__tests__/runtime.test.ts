 
import { describe, expect, it } from "vitest";
import { createZeroGRuntime } from "../runtime.js";
import { BASE_URL, FAKE_API_KEY, FAKE_PK, MODEL, chatResponse, makeState, scriptedFetch } from "./helpers.js";

const LIVE = {
  ZERO_G_ROUTER_BASE_URL: BASE_URL, ZERO_G_ROUTER_API_KEY: FAKE_API_KEY, ZERO_G_MODEL_ID: MODEL,
  ZERO_G_INDEXER_URL: "https://i.invalid", ZERO_G_RPC_URL: "https://r.invalid", ZERO_G_CHAIN_ID: "16602", ZERO_G_STORAGE_PRIVATE_KEY: FAKE_PK,
};

describe("createZeroGRuntime", () => {
  it("missing credentials: boots BLOCKED, readiness says so, decide halts, no network", async () => {
    const { fetchImpl, calls } = scriptedFetch([chatResponse()]);
    const rt = createZeroGRuntime({}, { fetchImpl });
    if (!rt.ok) throw new Error("should boot");
    const rd = rt.value.readiness();
    expect(rd.compute.status).toBe("BLOCKED");
    expect(rd.storage.status).toBe("BLOCKED");
    expect(rd.compute.proven).toBe(false);
    expect(rd.networkProbed).toBe(false);
    expect(await rt.value.brain.decide(makeState())).toMatchObject({ halted: true, reason: "ACTION_NOT_ALLOWED" });
    expect(calls).toHaveLength(0);
    expect(await rt.value.evidence.put({ episodeId: "e", robotId: "ramu", kind: "episode-log", content: "{}\n" })).toMatchObject({ ok: false, error: { kind: "BLOCKED" } });
  });

  it("LIVE is 'configured' until a verified call proves it", async () => {
    const { fetchImpl } = scriptedFetch([chatResponse({ zgResKey: "z1" })]);
    const rt = createZeroGRuntime(LIVE, { fetchImpl });
    if (!rt.ok) throw new Error("x");
    expect(rt.value.readiness().compute).toMatchObject({ status: "LIVE", proven: false, model: MODEL });
    await rt.value.brain.decide(makeState());
    expect(rt.value.readiness().compute).toMatchObject({ status: "LIVE", proven: true, successCount: 1 });
    expect(rt.value.provenance.list()).toHaveLength(1);
    expect(JSON.stringify(rt.value.readiness())).not.toContain(FAKE_API_KEY);
  });

  it("MOCK never reports proven", async () => {
    const rt = createZeroGRuntime({ ZERO_G_MODE: "mock" });
    if (!rt.ok) throw new Error("x");
    await rt.value.brain.decide(makeState());
    expect(rt.value.readiness().compute).toMatchObject({ status: "MOCK", proven: false });
  });

  it("malformed config refuses to build", () => {
    const rt = createZeroGRuntime({ ZERO_G_MODE: "mock", NODE_ENV: "production" });
    expect(rt.ok).toBe(false);
  });
});
