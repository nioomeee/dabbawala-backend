 
/**
 * Proves the division of labour: the adapter only PROPOSES; AI-01's
 * deterministic policy engine (validateAction) decides.
 */
import { describe, expect, it } from "vitest";
import { validateAction } from "@dabbawala/policy-engine";
import type { PolicySnapshot } from "@dabbawala/shared";
import { chatResponse, makeBrain, makeState, scriptedFetch } from "./helpers.js";

function policy(over: Partial<PolicySnapshot> = {}): PolicySnapshot {
  return {
    robotId: "ramu",
    zones: ["dadar"],
    budgetAtomic: "5000",
    status: "active",
    block: 1n,
    valuesHash: "0xabc",
    readAtMs: Date.now(),
    ...over,
  };
}

describe("adapter proposal -> policy engine", () => {
  it("a well-formed, offered zone that policy does not allow is DENIED by the policy engine", async () => {
    const { fetchImpl } = scriptedFetch([chatResponse({ content: '{"type":"ask_human","zoneId":"churchgate"}' })]);
    const { brain } = makeBrain(fetchImpl);
    const r = await brain.decide(makeState());
    if ("halted" in r) throw new Error("adapter should have proposed");
    // Adapter accepted it (offered in state) - that is NOT approval.
    expect(r.action).toEqual({ type: "ask_human", zoneId: "churchgate" });
    const v = validateAction(r.action, policy(), Date.now());
    expect(v).toMatchObject({ valid: false, halt: { reason: "GATE_DENIED" } });
  });

  it("an allowed zone passes the policy engine; a paused policy halts regardless of the model", async () => {
    const { fetchImpl } = scriptedFetch([chatResponse({ content: '{"type":"ask_human","zoneId":"dadar"}' })]);
    const { brain } = makeBrain(fetchImpl);
    const r = await brain.decide(makeState());
    if ("halted" in r) throw new Error("x");
    expect(validateAction(r.action, policy(), Date.now()).valid).toBe(true);
    expect(validateAction(r.action, policy({ status: "paused" }), Date.now())).toMatchObject({
      valid: false,
      halt: { reason: "POLICY_PAUSED" },
    });
    expect(validateAction(r.action, policy({ readAtMs: Date.now() - 60_000 }), Date.now())).toMatchObject({
      valid: false,
      halt: { reason: "ENS_UNREADABLE" },
    });
  });
});
