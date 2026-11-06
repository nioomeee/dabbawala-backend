/**
 * Negative + positive tests for POST /v1/internal/decide (B-2).
 *
 * The 0G adapter and the ENS stub are decoupled at their ports: the runtime is
 * injected as a fake decoration and the database is mocked, so these tests
 * exercise only the wiring and its fail-closed rules:
 *   - 400 invalid state (zod boundary)
 *   - 503 when the 0G runtime is not configured (no substitute decision)
 *   - 503 ENS_UNREADABLE when the policy source is unreadable
 *   - 200 halted passthrough (a Halt is a normal safe outcome)
 *   - 200 proposal: policy engine is the sole approver (approve + deny paths)
 * ref: implementations.md §3, ROADMAP §4.3 invariants 2/3/4, §6 G-tests
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { ZeroGRuntime } from "@dabbawala/zero-g-adapter";
import type { DecideResult, StateSummary } from "@dabbawala/shared";
import "../../../fastify-augmentation.js";
import { internalDecideRoutes } from "./decide.js";

// ── Database mock (@dabbawala/database) ──────────────────────────────────────

type Row = { id: string; status: string };
const DB_ROWS: { value: Row[] } = { value: [{ id: "sakhu", status: "idle" }] };

vi.mock("@dabbawala/database", () => {
  const fakeEq = <T>(a: T, b: T): { a: T; b: T } => ({ a, b });
  return {
    getDatabase: () => ({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => DB_ROWS.value,
          }),
        }),
      }),
    }),
    robots: {} as Record<string, string>,
    eq: fakeEq,
    initDatabase: () => undefined,
  };
});

// ── Fake 0G runtime decoration ───────────────────────────────────────────────

interface Scripted { result: DecideResult; mode: "LIVE" | "MOCK" }
const scripted: { value: Scripted | null } = { value: null };

const fakeRuntime = {
  brain: {
    decideWithProvenance: async (state: unknown): Promise<Scripted & { provenance: unknown }> => {
      if (scripted.value === null) throw new Error("script not set");
      // Provenance is only read for .mode by the route; keep it minimal.
      const recordId = `rec-${JSON.stringify((state as StateSummary).robotId)}`;
      return { ...scripted.value, provenance: { mode: scripted.value.mode, recordId } };
    },
  },
  readiness: (): { compute: { status: "LIVE"; proven: boolean } } => ({
    compute: { status: "LIVE", proven: false },
  }),
  close: async (): Promise<void> => undefined,
} as unknown as ZeroGRuntime;

function makeState(over: Partial<StateSummary> = {}): StateSummary {
  return {
    robotId: "sakhu",
    currentCell: "mahim-3",
    heading: "north",
    checkpointIndex: 2,
    totalCheckpoints: 6,
    availableRoutes: ["route-a", "route-b"],
    restrictedZones: ["churchgate", "dadar"],
    remainingBudgetAtomic: "5000",
    scenarioHints: ["road closed near dadar"],
    seed: "DABBAWALA_2026_SEED_42",
    ...over,
  };
}

async function buildTestApp(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({ logger: false });
  app.decorate("zeroG", fakeRuntime);
  await app.register(internalDecideRoutes, { prefix: "/v1" });
  await app.ready();
  return app;
}

describe("POST /v1/internal/decide", () => {
  beforeEach(() => {
    DB_ROWS.value = [{ id: "sakhu", status: "idle" }];
    scripted.value = null;
  });

  it("400 INVALID_REQUEST_BODY for a state outside the zod schema", async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/decide",
      payload: { state: { robotId: "not-a-robot" } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "INVALID_REQUEST_BODY" });
  });

  it("503 ZERO_G_UNCONFIGURED when the runtime decoration is null (no substitute decision)", async () => {
    const app = Fastify({ logger: false });
    app.decorate("zeroG", null);
    await app.register(internalDecideRoutes, { prefix: "/v1" });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/decide",
      payload: makeState() as unknown as Record<string, unknown>,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "ZERO_G_UNCONFIGURED" });
  });

  it("503 ENS_UNREADABLE when the robots row is missing (fail closed)", async () => {
    DB_ROWS.value = [];
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/decide",
      payload: makeState() as unknown as Record<string, unknown>,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "ENS_UNREADABLE" });
  });

  it("200 halted passthrough carries reason and policy stamp", async () => {
    scripted.value = {
      result: { halted: true, reason: "ZG_TIMEOUT", detail: "ATTEMPT_DEADLINE_EXCEEDED" },
      mode: "MOCK",
    };
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/decide",
      payload: makeState() as unknown as Record<string, unknown>,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      halted: true,
      reason: "ZG_TIMEOUT",
      detail: "ATTEMPT_DEADLINE_EXCEEDED",
      source: "sim",
    });
    expect(String(body.policyBlock ?? "")).toMatch(/^\d+$/);
    expect(String(body.policyHash ?? "")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a policy-allowed zone ask is approved by the policy engine only", async () => {
    scripted.value = {
      result: { action: { type: "ask_human", zoneId: "dadar" }, requestId: "zg-key-1" },
      mode: "MOCK",
    };
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/decide",
      payload: makeState() as unknown as Record<string, unknown>,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      source: "sim",
      action: { type: "ask_human", zoneId: "dadar" },
      requestId: "zg-key-1",
      policyApproved: true,
      policyHalt: null,
    });
  });

  it("a zone outside the robot's allowed zones is DENIED by the policy engine (GATE_DENIED)", async () => {
    scripted.value = {
      result: { action: { type: "ask_human", zoneId: "churchgate" }, requestId: "zg-key-2" },
      mode: "LIVE",
    };
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/decide",
      payload: makeState() as unknown as Record<string, unknown>,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      source: "live",
      action: { type: "ask_human", zoneId: "churchgate" },
      policyApproved: false,
      policyHalt: { halted: true, reason: "GATE_DENIED" },
      requestId: "zg-key-2",
    });
  });
});
