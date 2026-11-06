/**
 * ZeroGFleetBrain - IFleetBrain over the 0G Compute Router.
 *
 * Contract (packages/application/src/ports/fleet-brain.port.ts):
 *   - verify_tee: true on every call                         (R-0G-1)
 *   - requestId = ZG-Res-Key header (body `id` as fallback)  (R-0G-1)
 *   - retry at most once on transient failure                (§4.3.4)
 *   - Halt on any failure; never a cached/local decision     (§4.3.4)
 *
 * This class only ever returns a PROPOSAL or a Halt. It does not approve
 * anything. The caller MUST pass `action` to the deterministic policy engine
 * (`validateAction` from @dabbawala/policy-engine) with a fresh PolicySnapshot
 * before it can affect robot movement or spend.
 *
 * Statelessness: no decision, response, or request id is cached between calls.
 * Every decide() issues a fresh Router request. Resume-after-halt policy
 * (a fresh successful call + fresh policy read) belongs to the caller's state
 * machine; this class simply never short-circuits.
 */

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ZERO_G_MAX_RETRIES,
  type Action,
  type DecideResult,
  type Halt,
  type StateSummary,
} from "@dabbawala/shared";
import type { IFleetBrain } from "@dabbawala/application";
import type { ComputeSettings } from "./config.js";
import { classifyHttpStatus, haltReasonFor, httpDetail, isRetryable } from "./failures.js";
import { buildPrompt } from "./prompt.js";
import { parseProposal } from "./proposal.js";
import {
  NOOP_LOGGER,
  SYSTEM_CLOCK,
  type AdapterLogger,
  type AttemptRecord,
  type Clock,
  type FailureKind,
  type ProvenanceRecord,
  type ProvenanceSink,
  type RecordMode,
  type RouterTransport,
  type ZeroGDecision,
} from "./types.js";

const EnvelopeSchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    choices: z
      .array(
        z
          .object({
            finish_reason: z.string().nullable().optional(),
            message: z.object({ content: z.string().nullable().optional() }).passthrough(),
          })
          .passthrough(),
      )
      .length(1),
    x_0g_trace: z
      .object({
        request_id: z.string().optional(),
        provider: z.string().optional(),
        billing: z
          .object({ total_cost: z.union([z.string(), z.number()]).optional() })
          .passthrough()
          .optional(),
        tee_verified: z.boolean().nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const ErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        type: z.string().optional(),
        code: z.string().optional(),
      })
      .passthrough()
      .optional(),
    request_id: z.string().optional(),
  })
  .passthrough();

const SAFE_ID = /^[\x21-\x7E]{1,256}$/;

function safeId(value: string | null | undefined): string | null {
  return value !== null && value !== undefined && SAFE_ID.test(value) ? value : null;
}

function safeCode(value: string | undefined): string | null {
  if (value === undefined) return null;
  const cleaned = value.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64);
  return cleaned === "" ? null : cleaned;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

type AttemptOutcome =
  | {
      readonly ok: true;
      readonly action: Action;
      readonly requestId: string;
      readonly contentSha256: string;
    }
  | {
      readonly ok: false;
      readonly kind: FailureKind;
      readonly detail: string;
      readonly requestId: string | null;
      readonly retryAfterMs: number | null;
      readonly contentSha256: string | null;
    };

export interface FleetBrainStats {
  readonly successCount: number;
  readonly haltCount: number;
  readonly lastSuccessAtMs: number | null;
  readonly lastHaltAtMs: number | null;
  readonly lastHaltFailure: FailureKind | null;
  /** True once at least one LIVE call returned a TEE-verified proposal. */
  readonly liveVerified: boolean;
}

export interface FleetBrainOptions {
  /** null => adapter is BLOCKED: no network call is ever made. */
  readonly transport: RouterTransport | null;
  /** Env var names responsible for BLOCKED (for the halt detail). */
  readonly blockedBy?: readonly string[];
  /** Model id requested from the Router. Required when transport != null. */
  readonly modelId: string;
  readonly settings: ComputeSettings;
  readonly provenance?: ProvenanceSink;
  readonly logger?: AdapterLogger;
  readonly clock?: Clock;
}

export class ZeroGFleetBrain implements IFleetBrain {
  readonly #transport: RouterTransport | null;
  readonly #blockedBy: readonly string[];
  readonly #modelId: string;
  readonly #s: ComputeSettings;
  readonly #sink: ProvenanceSink | undefined;
  readonly #log: AdapterLogger;
  readonly #clock: Clock;

  #inFlight = 0;
  #successCount = 0;
  #haltCount = 0;
  #lastSuccessAtMs: number | null = null;
  #lastHaltAtMs: number | null = null;
  #lastHaltFailure: FailureKind | null = null;
  #liveVerified = false;

  constructor(opts: FleetBrainOptions) {
    this.#transport = opts.transport;
    this.#blockedBy = opts.blockedBy ?? [];
    this.#modelId = opts.modelId;
    this.#s = opts.settings;
    this.#sink = opts.provenance;
    this.#log = opts.logger ?? NOOP_LOGGER;
    this.#clock = opts.clock ?? SYSTEM_CLOCK;
  }

  get stats(): FleetBrainStats {
    return {
      successCount: this.#successCount,
      haltCount: this.#haltCount,
      lastSuccessAtMs: this.#lastSuccessAtMs,
      lastHaltAtMs: this.#lastHaltAtMs,
      lastHaltFailure: this.#lastHaltFailure,
      liveVerified: this.#liveVerified,
    };
  }

  /** IFleetBrain.decide: proposal or Halt. Never throws. */
  async decide(state: StateSummary): Promise<DecideResult> {
    const { result } = await this.decideWithProvenance(state);
    return result;
  }

  /** Same as decide() but also returns the provenance record. Never throws. */
  async decideWithProvenance(state: StateSummary): Promise<ZeroGDecision> {
    const startedAtMs = this.#clock.nowMs();
    const mode: RecordMode = this.#transport?.mode ?? "LIVE";
    const endpoint = this.#transport?.endpoint ?? "(unconfigured)";
    // `state` crosses a trust boundary at runtime despite its static type;
    // read it defensively so a hostile/garbage value cannot make decide() throw.
    const probe = (typeof state === "object" ? state : null) as Partial<StateSummary> | null;
    const base = {
      schema: "dabbawala.0g-provenance/v1" as const,
      recordId: randomUUID(),
      mode,
      robotId: typeof probe?.robotId === "string" ? probe.robotId.slice(0, 32) : "(invalid)",
      seed: typeof probe?.seed === "string" ? probe.seed.slice(0, 128) : "",
      checkpointIndex: typeof probe?.checkpointIndex === "number" && Number.isInteger(probe.checkpointIndex) ? probe.checkpointIndex : -1,
      startedAtMs,
      endpoint,
    };

    // 1. No network if blocked.
    if (this.#transport === null) {
      const detail = `ADAPTER_BLOCKED:${this.#blockedBy.join(",")}`;
      return this.#finishHalt(base, [], "BLOCKED", detail, null, null, null);
    }

    const transport = this.#transport;

    // 2. Local concurrency limit (request limit; protects spend and the Router).
    if (this.#inFlight >= this.#s.maxConcurrent) {
      return this.#finishHalt(base, [], "CONCURRENCY", "LOCAL_CONCURRENCY_LIMIT", null, null, null);
    }

    // 3. Validate + sanitise the state, build the prompt.
    const prompt = buildPrompt(state, this.#s.maxPromptChars);
    if (!prompt.ok) {
      return this.#finishHalt(base, [], "INVALID_STATE", prompt.error.detail, null, null, null);
    }

    const body = JSON.stringify({
      model: this.#modelId,
      messages: prompt.value.messages,
      temperature: 0,
      max_tokens: this.#s.maxOutputTokens,
      n: 1,
      stream: false,
      verify_tee: true,
      ...(this.#s.jsonMode ? { response_format: { type: "json_object" } } : {}),
      ...(this.#s.disableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    });
    const requestSha256 = sha256Hex(body);

    this.#inFlight += 1;
    try {
      const attempts: AttemptRecord[] = [];
      const maxAttempts = 1 + ZERO_G_MAX_RETRIES;
      let last: Extract<AttemptOutcome, { ok: false }> | null = null;

      for (let n = 1; n <= maxAttempts; n += 1) {
        const { record, outcome } = await this.#attempt(transport, n as 1 | 2, body, prompt.value.state);
        attempts.push(record);

        if (outcome.ok) {
          return this.#finishProposal(
            base,
            attempts,
            requestSha256,
            outcome.contentSha256,
            outcome.action,
            outcome.requestId,
          );
        }
        last = outcome;

        if (n >= maxAttempts || !isRetryable(outcome.kind)) break;

        // 429: honour Retry-After, but never wait beyond the configured cap.
        let delay = this.#s.retryDelayMs;
        if (outcome.retryAfterMs !== null) {
          if (outcome.retryAfterMs > this.#s.maxRetryAfterMs) break;
          delay = Math.max(delay, outcome.retryAfterMs);
        }
        await this.#clock.sleep(delay);
      }

      // Unreachable null-check keeps the type honest.
      const fail = last ?? {
        ok: false as const,
        kind: "BAD_ENVELOPE" as const,
        detail: "NO_ATTEMPT_RESULT",
        requestId: null,
        retryAfterMs: null,
        contentSha256: null,
      };
      return this.#finishHalt(
        base,
        attempts,
        fail.kind,
        fail.detail,
        fail.requestId,
        requestSha256,
        fail.contentSha256,
      );
    } finally {
      this.#inFlight -= 1;
    }
  }

  // ── one Router attempt ───────────────────────────────────────────────────

  async #attempt(
    transport: RouterTransport,
    attempt: 1 | 2,
    body: string,
    state: StateSummary,
  ): Promise<{ record: AttemptRecord; outcome: AttemptOutcome }> {
    const startedAtMs = this.#clock.nowMs();

    const blank = {
      attempt,
      startedAtMs,
      modelRequested: this.#modelId,
      modelReturned: null,
      zgResKey: null,
      routerRequestId: null,
      provider: null,
      teeVerified: null,
      errorType: null,
      errorCode: null,
      totalCostNeuron: null,
      retryAfterMs: null,
    } as const;

    const sent = await transport.send({
      body,
      timeoutMs: this.#s.requestTimeoutMs,
      maxResponseBytes: this.#s.maxResponseBytes,
    });

    if (!sent.ok) {
      const f = sent.failure;
      return {
        record: { ...blank, latencyMs: f.latencyMs, httpStatus: null, outcome: f.kind },
        outcome: {
          ok: false,
          kind: f.kind,
          detail: f.detail,
          requestId: null,
          retryAfterMs: null,
          contentSha256: null,
        },
      };
    }

    const r = sent.response;
    const zgResKey = safeId(r.zgResKey);
    const withHttp = { ...blank, latencyMs: r.latencyMs, httpStatus: r.status, zgResKey };

    let json: unknown;
    try {
      json = JSON.parse(r.bodyText);
    } catch {
      json = undefined;
    }

    // Non-2xx: classify by status, extract Router error type/code/request_id.
    if (r.status < 200 || r.status >= 300) {
      const kind = classifyHttpStatus(r.status);
      const parsedErr = ErrorEnvelopeSchema.safeParse(json);
      const errType = parsedErr.success ? safeCode(parsedErr.data.error?.type) : null;
      const errCode = parsedErr.success ? safeCode(parsedErr.data.error?.code) : null;
      const routerRid = parsedErr.success ? safeId(parsedErr.data.request_id) : null;
      return {
        record: {
          ...withHttp,
          outcome: kind,
          errorType: errType,
          errorCode: errCode,
          routerRequestId: routerRid,
          retryAfterMs: r.retryAfterMs,
        },
        outcome: {
          ok: false,
          kind,
          detail: httpDetail(r.status),
          requestId: zgResKey ?? routerRid,
          retryAfterMs: r.retryAfterMs,
          contentSha256: null,
        },
      };
    }

    const fail = (
      kind: FailureKind,
      detail: string,
      extra: Partial<AttemptRecord> = {},
      requestId: string | null = zgResKey,
      contentSha256: string | null = null,
    ): { record: AttemptRecord; outcome: AttemptOutcome } => ({
      record: { ...withHttp, ...extra, outcome: kind },
      outcome: { ok: false, kind, detail, requestId, retryAfterMs: null, contentSha256 },
    });

    if (json === undefined) return fail("NOT_JSON", "RESPONSE_NOT_JSON");

    const env = EnvelopeSchema.safeParse(json);
    if (!env.success) return fail("BAD_ENVELOPE", "RESPONSE_NOT_CHAT_COMPLETION");

    const trace = env.data.x_0g_trace;
    const routerRequestId = safeId(trace?.request_id);
    const provider = safeId(trace?.provider);
    const teeVerified = trace?.tee_verified ?? null;
    const totalCost = trace?.billing?.total_cost;
    const extra: Partial<AttemptRecord> = {
      modelReturned: safeId(env.data.model),
      routerRequestId,
      provider,
      teeVerified,
      totalCostNeuron: totalCost === undefined ? null : String(totalCost).slice(0, 64),
    };

    // Request id binds the decision to evidence and approval tokens (§4.3.7).
    const requestId = zgResKey ?? safeId(env.data.id);
    if (requestId === null) return fail("NO_REQUEST_ID", "NO_ZG_RES_KEY_OR_ID", extra, null);
    const withId: Partial<AttemptRecord> = { ...extra, zgResKey: requestId };

    // TEE verification is mandatory for LIVE calls. tee_verified must be
    // exactly true; false means "signature present but did not verify",
    // null/absent means the verdict was not delivered. Both fail closed.
    if (transport.mode === "LIVE" && teeVerified !== true) {
      return fail(
        "TEE_UNVERIFIED",
        teeVerified === false ? "TEE_SIGNATURE_INVALID" : "TEE_VERDICT_MISSING",
        withId,
        requestId,
      );
    }

    const choice = env.data.choices[0];
    if (choice === undefined) return fail("BAD_ENVELOPE", "NO_CHOICE", withId, requestId);

    if (choice.finish_reason === "length") {
      return fail("TRUNCATED", "FINISH_REASON_LENGTH", withId, requestId);
    }

    // Only `content` is considered. `reasoning_content` is ignored entirely.
    const content = choice.message.content;
    const contentSha256 =
      typeof content === "string" && content.length > 0 ? sha256Hex(content) : null;

    const proposal = parseProposal(content, state);
    if (!proposal.ok) {
      return fail(proposal.error.kind, proposal.error.detail, withId, requestId, contentSha256);
    }

    return {
      record: { ...withHttp, ...withId, outcome: "OK" },
      outcome: {
        ok: true,
        action: proposal.value,
        requestId,
        contentSha256: contentSha256 ?? "",
      },
    };
  }

  // ── finishing ────────────────────────────────────────────────────────────

  #finishProposal(
    base: Pick<
      ProvenanceRecord,
      | "schema"
      | "recordId"
      | "mode"
      | "robotId"
      | "seed"
      | "checkpointIndex"
      | "startedAtMs"
      | "endpoint"
    >,
    attempts: readonly AttemptRecord[],
    requestSha256: string,
    contentSha256: string,
    action: Action,
    requestId: string,
  ): ZeroGDecision {
    const finishedAtMs = this.#clock.nowMs();
    const provenance: ProvenanceRecord = {
      ...base,
      finishedAtMs,
      requestSha256,
      responseContentSha256: contentSha256,
      attempts,
      final: { outcome: "PROPOSAL", requestId, action },
    };
    this.#successCount += 1;
    this.#lastSuccessAtMs = finishedAtMs;
    if (base.mode === "LIVE") this.#liveVerified = true;
    this.#emit(provenance);
    return { result: { action, requestId }, provenance };
  }

  #finishHalt(
    base: Pick<
      ProvenanceRecord,
      | "schema"
      | "recordId"
      | "mode"
      | "robotId"
      | "seed"
      | "checkpointIndex"
      | "startedAtMs"
      | "endpoint"
    >,
    attempts: readonly AttemptRecord[],
    failure: FailureKind,
    detail: string,
    requestId: string | null,
    requestSha256: string | null,
    contentSha256: string | null,
  ): ZeroGDecision {
    const finishedAtMs = this.#clock.nowMs();
    const reason = haltReasonFor(failure);
    const halt: Halt = { halted: true, reason, detail };
    const provenance: ProvenanceRecord = {
      ...base,
      finishedAtMs,
      requestSha256,
      responseContentSha256: contentSha256,
      attempts,
      final: { outcome: "HALT", reason, failure, requestId },
    };
    this.#haltCount += 1;
    this.#lastHaltAtMs = finishedAtMs;
    this.#lastHaltFailure = failure;
    this.#emit(provenance);
    return { result: halt, provenance };
  }

  #emit(provenance: ProvenanceRecord): void {
    const last = provenance.attempts[provenance.attempts.length - 1];
    this.#log.info(
      {
        recordId: provenance.recordId,
        mode: provenance.mode,
        robotId: provenance.robotId,
        outcome: provenance.final.outcome,
        requestId: provenance.final.requestId,
        failure: provenance.final.outcome === "HALT" ? provenance.final.failure : undefined,
        attempts: provenance.attempts.length,
        latencyMs: last?.latencyMs,
        httpStatus: last?.httpStatus,
        provider: last?.provider,
        teeVerified: last?.teeVerified,
      },
      "0g decision",
    );
    if (this.#sink === undefined) return;
    try {
      this.#sink.record(provenance);
    } catch (e: unknown) {
      // A failing sink must never turn a decision into an exception.
      this.#log.error({ err: e instanceof Error ? e.name : "UnknownError" }, "provenance sink failed");
    }
  }
}
