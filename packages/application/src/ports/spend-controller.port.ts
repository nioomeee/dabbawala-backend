/**
 * Application port: Spend Controller
 *
 * The Spend Controller is the ONLY holder of the Hedera payment key.
 * ref: ROADMAP.md §4.3 invariant 1, §4.9, §B-6
 */

import type { BuyIntelResult } from "@dabbawala/shared";

export interface ISpendController {
  /**
   * Attempt to buy route intel for a leg via x402.
   * The implementation MUST:
   *   - Read fresh policy before signing. ref: ROADMAP.md §4.9
   *   - Enforce the hard ceiling regardless of ENS budget. ref: §4.3 invariant 9
   *   - Enforce idempotency key uniqueness under a lock. ref: §4.9
   *   - Never sign if any policy check fails. ref: §4.9
   *   - Log spend to HCS. ref: §B-6
   * ref: ROADMAP.md §4.5 interface C
   */
  buyIntel(legId: string): Promise<BuyIntelResult>;
}

