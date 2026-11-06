/**
 * @dabbawala/zero-g-adapter - public API
 *
 * 0G sponsor integration: IFleetBrain over the 0G Compute Router and an
 * episode-evidence uploader over 0G Storage. Proposal-only; approval is the
 * deterministic policy engine's job (@dabbawala/policy-engine).
 */

export * from "./config.js";
export * from "./types.js";
export * from "./failures.js";
export * from "./prompt.js";
export * from "./proposal.js";
export * from "./router-transport.js";
export * from "./mock-transport.js";
export * from "./fleet-brain.js";
export * from "./provenance.js";
export * from "./evidence-lint.js";
export * from "./storage-client.js";
export * from "./evidence-store.js";
export * from "./runtime.js";
