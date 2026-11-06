 
import type { StateSummary } from "@dabbawala/shared";
import type { ComputeSettings } from "../config.js";
import { FetchRouterTransport, type FetchLike } from "../router-transport.js";
import { ZeroGFleetBrain } from "../fleet-brain.js";
import { InMemoryProvenanceLog } from "../provenance.js";
import type { Clock, RouterTransport } from "../types.js";

/** Synthetic key shaped like a Router key; never a real credential. */
export const FAKE_API_KEY = "sk-TESTONLY0123456789abcdefghijkl";
export const FAKE_PK = "0x" + "ab".repeat(32);
export const BASE_URL = "https://router.test.invalid/v1";
export const MODEL = "test-model-1";

export function makeState(over: Partial<StateSummary> = {}): StateSummary {
  return {
    robotId: "ramu",
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

export const SETTINGS: ComputeSettings = {
  baseUrl: BASE_URL,
  modelId: MODEL,
  requestTimeoutMs: 200,
  retryDelayMs: 0,
  maxRetryAfterMs: 2_000,
  maxOutputTokens: 256,
  maxPromptChars: 8_000,
  maxResponseBytes: 65_536,
  maxConcurrent: 4,
  jsonMode: false,
  disableThinking: false,
};

export interface ChatOpts {
  content?: string | null;
  finishReason?: string;
  tee?: boolean | null | "absent";
  bodyId?: string | null;
  zgResKey?: string | null;
  provider?: string;
  model?: string;
  reasoning?: string;
  extraChoices?: number;
}

/** Build a realistic Router chat-completion Response (per docs.0g.ai shapes). */
export function chatResponse(o: ChatOpts = {}): Response {
  const content = o.content === undefined ? '{"type":"continue"}' : o.content;
  const trace: Record<string, unknown> = {
    request_id: "0852f405-6c56-40c2-a800-e6fd70785065",
    provider: o.provider ?? "0xd9966e13a6026Fcca4b13E7ff95c94DE268C471C",
    billing: { input_cost: "19000000000000", output_cost: "1916800000000000", total_cost: "1935800000000000" },
  };
  if (o.tee !== "absent") trace.tee_verified = o.tee === undefined ? true : o.tee;
  const message: Record<string, unknown> = { role: "assistant", content };
  if (o.reasoning !== undefined) {
    message.reasoning_content = o.reasoning;
    message.provider_specific_fields = { reasoning_content: o.reasoning };
  }
  const choice = { index: 0, finish_reason: o.finishReason ?? "stop", message };
  const body: Record<string, unknown> = {
    object: "chat.completion",
    created: 1_790_000_000,
    model: o.model ?? MODEL,
    choices: [choice, ...Array.from({ length: o.extraChoices ?? 0 }, () => choice)],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    x_0g_trace: trace,
  };
  if (o.bodyId !== null) body.id = o.bodyId ?? "chatcmpl-body-id-1";
  const headers = new Headers({ "Content-Type": "application/json" });
  if (o.zgResKey !== null) headers.set("ZG-Res-Key", o.zgResKey ?? "zg-res-key-abc123");
  return new Response(JSON.stringify(body), { status: 200, headers });
}

export function errorResponse(
  status: number,
  code = "x_err",
  type = "server_error",
  headers: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ error: { message: "SECRET-ISH TEXT SHOULD NEVER SURFACE", type, code }, request_id: "req_abc123" }),
    { status, headers: { "Content-Type": "application/json", ...headers } },
  );
}

export interface Call { url: string; init: RequestInit; body: Record<string, unknown> }

/** Scripted fetch: each entry is a Response, an Error, or "hang" (until abort). */
export function scriptedFetch(steps: readonly (Response | Error | "hang" | (() => Response))[]): {
  fetchImpl: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body as string) as Record<string, unknown> });
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step === undefined) return Promise.reject(new Error("no scripted step"));
    if (step === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }
    if (step instanceof Error) return Promise.reject(step);
    return Promise.resolve(typeof step === "function" ? step() : step.clone());
  };
  return { fetchImpl, calls };
}

export const fastClock: Clock = {
  nowMs: () => Date.now(),
  monotonicMs: () => performance.now(),
  sleep: () => Promise.resolve(),
};

export function makeBrain(
  fetchImpl: FetchLike,
  over: Partial<ComputeSettings> = {},
  extra: { sleepSpy?: number[] } = {},
): { brain: ZeroGFleetBrain; log: InMemoryProvenanceLog; transport: RouterTransport } {
  const log = new InMemoryProvenanceLog();
  const clock: Clock = {
    ...fastClock,
    sleep: (ms) => {
      extra.sleepSpy?.push(ms);
      return Promise.resolve();
    },
  };
  const transport = new FetchRouterTransport({ baseUrl: BASE_URL, apiKey: FAKE_API_KEY, fetchImpl, clock });
  const brain = new ZeroGFleetBrain({
    transport,
    modelId: MODEL,
    settings: { ...SETTINGS, ...over },
    provenance: log,
    clock,
  });
  return { brain, log, transport };
}
