/**
 * Application port: Fleet Brain
 *
 * The Fleet Brain adapter must implement this interface.
 * The model output is UNTRUSTED. ref: ROADMAP.md §4.3 invariant 2, §4.5
 */

import type { DecideResult, StateSummary } from "@dabbawala/shared";

export interface IFleetBrain {
  /**
   * Submit a state summary to the 0G model and receive an action proposal or halt.
   * The implementation MUST:
   *   - Set verify_tee: true on the 0G call. ref: R-0G-1
   *   - Capture the ZG-Res-Key header as requestId. ref: R-0G-1
   *   - Retry at most once on timeout/transport failure. ref: ROADMAP.md §4.3.4
   *   - Return Halt on any failure, never a cached or local decision. ref: ROADMAP.md §4.3.4
   */
  decide(state: StateSummary): Promise<DecideResult>;
}

