/**
 * Fastify instance decoration for the 0G runtime.
 *
 * `zeroG` is null when the adapter config is malformed at boot: the process
 * still serves non-0G routes, but /ready reports not_configured and internal
 * decide fails closed (never invents a decision).
 * ref: implementations.md §3, §4.2, ROADMAP §4.3 invariant 4
 */

import type { ZeroGRuntime } from "@dabbawala/zero-g-adapter";

declare module "fastify" {
  interface FastifyInstance {
    readonly zeroG: ZeroGRuntime | null;
  }
}
