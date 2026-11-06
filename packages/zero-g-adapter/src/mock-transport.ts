/**
 * MOCK router transport. LOCAL TESTS / OFFLINE DEV ONLY.
 *
 * Everything it produces is unmistakably synthetic:
 *   - mode is "MOCK" (propagated into every provenance record),
 *   - request ids are prefixed "MOCK-" and cannot collide with a real
 *     ZG-Res-Key,
 *   - no tee_verified, no provider address, no billing is invented.
 *
 * It never touches the network. Selecting it in production is a config error
 * (see config.ts). Its output must never be presented as a real 0G decision.
 */

import type { RouterTransport, RouterTransportResult } from "./types.js";

export type MockScript = (call: {
  readonly index: number;
  readonly body: string;
}) => RouterTransportResult;

export class MockRouterTransport implements RouterTransport {
  readonly mode = "MOCK" as const;
  readonly endpoint = "mock://0g-router/v1/chat/completions";
  #calls = 0;
  readonly #script: MockScript | undefined;

  constructor(script?: MockScript) {
    this.#script = script;
  }

  get callCount(): number {
    return this.#calls;
  }

  send(args: {
    readonly body: string;
    readonly timeoutMs: number;
    readonly maxResponseBytes: number;
  }): Promise<RouterTransportResult> {
    const index = this.#calls++;
    if (this.#script !== undefined) {
      return Promise.resolve(this.#script({ index, body: args.body }));
    }
    const payload = {
      id: `MOCK-${String(index + 1).padStart(6, "0")}`,
      object: "chat.completion",
      model: "mock-model",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: '{"type":"continue"}' },
        },
      ],
    };
    return Promise.resolve({
      ok: true,
      response: {
        status: 200,
        zgResKey: `MOCK-${String(index + 1).padStart(6, "0")}`,
        retryAfterMs: null,
        bodyText: JSON.stringify(payload),
        latencyMs: 0,
      },
    });
  }
}
