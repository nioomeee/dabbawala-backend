/**
 * Live transport for the 0G Compute Router.
 *
 * Endpoint : POST {ZERO_G_ROUTER_BASE_URL}/chat/completions
 * Auth     : Authorization: Bearer sk-...   (Router API key; mk- keys are rejected)
 * Headers  : Content-Type: application/json
 * Response : ZG-Res-Key header (chatID), JSON body incl. x_0g_trace.
 *
 * ref: docs.0g.ai Router/Chat Completions, Router/Authentication,
 *      Router/Verifiable Execution (R-0G-1).
 *
 * Security properties:
 *   - The API key lives only in this closure; it is never returned or logged.
 *   - redirect:"error" so the Authorization header can never follow a redirect.
 *   - A single AbortController deadline covers connect, headers AND body read.
 *   - Body is read incrementally and aborted past maxResponseBytes.
 */

import type {
  RouterRawResponse,
  RouterTransport,
  RouterTransportResult,
} from "./types.js";
import { SYSTEM_CLOCK, type Clock } from "./types.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface FetchTransportOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetchImpl?: FetchLike;
  readonly clock?: Clock;
}

export function parseRetryAfterMs(header: string | null, nowMs: number): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Math.min(Number(trimmed), 86_400) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - nowMs);
}

const SAFE_HEADER_VALUE = /^[\x21-\x7E]{1,256}$/;

async function readBodyCapped(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ text: string } | { tooLarge: true }> {
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    return { tooLarge: true };
  }
  if (response.body === null) return { text: "" };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  // Do not rely on the fetch implementation to error a stalled stream on
  // abort: race every read against the deadline signal explicitly.
  const aborted = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(new Error("aborted"));
    signal.addEventListener("abort", () => { reject(new Error("aborted")); }, { once: true });
  });
  aborted.catch(() => undefined);

  for (;;) {
    let chunk: { done: boolean; value?: Uint8Array };
    try {
      chunk = await Promise.race([reader.read(), aborted]);
    } catch (e: unknown) {
      await reader.cancel().catch(() => undefined);
      throw e;
    }
    const { done, value } = chunk;
    if (done || value === undefined) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(merged) };
}

export class FetchRouterTransport implements RouterTransport {
  readonly mode = "LIVE" as const;
  readonly endpoint: string;
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #clock: Clock;

  constructor(opts: FetchTransportOptions) {
    this.endpoint = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    this.#apiKey = opts.apiKey;
    this.#fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.#clock = opts.clock ?? SYSTEM_CLOCK;
  }

  async send(args: {
    readonly body: string;
    readonly timeoutMs: number;
    readonly maxResponseBytes: number;
  }): Promise<RouterTransportResult> {
    const started = this.#clock.monotonicMs();
    const controller = new AbortController();
    const flags = { timedOut: false };
    const timer = setTimeout(() => {
      flags.timedOut = true;
      controller.abort();
    }, args.timeoutMs);

    const elapsed = (): number => Math.max(0, Math.round(this.#clock.monotonicMs() - started));

    try {
      const response = await this.#fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${this.#apiKey}`,
        },
        body: args.body,
        redirect: "error",
        signal: controller.signal,
      });

      const body = await readBodyCapped(response, args.maxResponseBytes, controller.signal);
      if ("tooLarge" in body) {
        return {
          ok: false,
          failure: { kind: "BODY_TOO_LARGE", detail: "RESPONSE_EXCEEDS_LIMIT", latencyMs: elapsed() },
        };
      }

      const zgRaw = response.headers.get("ZG-Res-Key");
      const raw: RouterRawResponse = {
        status: response.status,
        zgResKey: zgRaw !== null && SAFE_HEADER_VALUE.test(zgRaw) ? zgRaw : null,
        retryAfterMs: parseRetryAfterMs(response.headers.get("Retry-After"), Date.now()),
        bodyText: body.text,
        latencyMs: elapsed(),
      };
      return { ok: true, response: raw };
    } catch (e: unknown) {
      if (flags.timedOut) {
        return { ok: false, failure: { kind: "TIMEOUT", detail: "ATTEMPT_DEADLINE_EXCEEDED", latencyMs: elapsed() } };
      }
      // Deliberately do not forward e.message: it may reflect request details.
      const name = e instanceof Error ? e.name : "UnknownError";
      return {
        ok: false,
        failure: { kind: "NETWORK", detail: `FETCH_FAILED:${name.slice(0, 40)}`, latencyMs: elapsed() },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
