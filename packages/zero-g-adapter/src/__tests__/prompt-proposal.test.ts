 
import { describe, expect, it } from "vitest";
import { buildPrompt, sanitiseFreeText } from "../prompt.js";
import { parseProposal } from "../proposal.js";
import { makeState } from "./helpers.js";

describe("parseProposal", () => {
  const s = makeState();
  it("accepts each closed-set action", () => {
    expect(parseProposal('{"type":"continue"}', s)).toEqual({ ok: true, value: { type: "continue" } });
    expect(parseProposal('{"type":"handoff"}', s).ok).toBe(true);
    expect(parseProposal('{"type":"reroute","routeId":"route-a"}', s).ok).toBe(true);
    expect(parseProposal('{"type":"ask_human","zoneId":"dadar"}', s).ok).toBe(true);
  });
  it("rejects prototype-pollution style keys", () => {
    const r = parseProposal('{"type":"continue","__proto__":{"polluted":true}}', s);
    expect(r.ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("rejects a number / string / null top level", () => {
    for (const c of ["7", '"continue"', "null", "true"]) {
      expect(parseProposal(c, s).ok).toBe(false);
    }
  });
});

describe("buildPrompt", () => {
  it("is deterministic and carries the closed action set", () => {
    const a = buildPrompt(makeState(), 8000);
    const b = buildPrompt(makeState(), 8000);
    expect(a).toEqual(b);
    if (!a.ok) throw new Error("x");
    expect(a.value.messages[0]?.content).toContain('"type":"ask_human"');
  });
  it("caps hints at 8 and 240 chars", () => {
    const hints = Array.from({ length: 20 }, () => "x".repeat(1000));
    const p = buildPrompt(makeState({ scenarioHints: hints }), 100_000);
    if (!p.ok) throw new Error("x");
    expect(p.value.state.scenarioHints).toHaveLength(8);
    expect(p.value.state.scenarioHints[0]).toHaveLength(240);
  });
  it("sanitiseFreeText strips bidi/control/zero-width", () => {
    expect(sanitiseFreeText("a\u200Bb\u202Ec\u0007d")).toBe("a b c d");
  });
  it("rejects data-marker identifiers", () => {
    expect(buildPrompt(makeState({ currentCell: "END_STATE_DATA" }), 8000).ok).toBe(false);
  });
});
