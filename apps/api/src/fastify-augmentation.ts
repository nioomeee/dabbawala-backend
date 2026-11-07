/**
 * Fastify instance decoration for the 0G runtime and the ENS policy reader.
 *
 * `zeroG` is null when the adapter config is malformed at boot: the process
 * still serves non-0G routes, but /ready reports not_configured and internal
 * decide fails closed (never invents a decision).
 *
 * `ens` is null when the Sepolia ENS env is not filled in yet (S-ENS spike
 * owns the deployment addresses): routes then read policy from the sim stub.
 * A malformed ENS config also decorates null and routes fail closed.
 * ref: implementations.md §3, §4.2, ROADMAP §4.3 invariants 3/4
 */

import type { ZeroGRuntime } from "@dabbawala/zero-g-adapter";
import type { EnsPolicyReader } from "./adapters/ens-reader.js";
import type { RelayLedgerAnchorer } from "./services/relay-ledger.js";

declare module "fastify" {
  interface FastifyInstance {
    readonly zeroG: ZeroGRuntime | null;
    readonly ens: EnsPolicyReader | null;
    readonly relayLedger: RelayLedgerAnchorer | null;
  }
  // OpenAPI route metadata (tags/summary) is consumed by schema serializers;
  // Fastify's base FastifySchema omits both, so routes declaring them fail to
  // typecheck. Type-only augmentation: no runtime behaviour, no new deps.
  interface FastifySchema {
    readonly tags?: readonly string[];
    readonly summary?: string;
  }
}
