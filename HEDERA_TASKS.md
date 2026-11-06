# HEDERA_TASKS.md — Hedera x402 Integration

## Overview
Implement Hedera x402 payments for the Dabbawala Protocol's route-intel payment flow. This integrates with the Spend Controller and HCS audit logging.

**Prize**: Hedera x402 (one of exactly three: 0G Physical AI, Hedera x402, ENSv2)
**Deadline**: Sat Nov 7, 2026, 09:00 IST (code freeze 07:00 IST)
**Implementation Strategy**: Strategy B (self-signer with Hiero SDK)

---

## Execution Order (AGENTS.md §6)

- [ ] **H1** Create `packages/hedera-sdk` package
  - Package.json with `@hashgraph/sdk` dependency (exact version to pin)
  - `tsconfig.json` for ESM
  - Exports for client config, x402 signing, HCS logging

- [ ] **H2** Build Hedera client configuration
  - Load env vars: `HEDERA_NETWORK`, `HEDERA_OPERATOR_ACCOUNT_ID`, `HEDERA_OPERATOR_PRIVATE_KEY`
  - Type-safe config schema in `packages/config` (already has fields)
  - Validate account IDs format, key format

- [ ] **H3** Implement x402 exact-scheme signer
  - Interface matching R-HE-4 spec
  - Build transaction with exact-scheme fields
  - Sign with operator account (or spend controller key)
  - Return transaction ID

- [ ] **H4** Implement HCS spend topic client
  - Create topic if not exists (or use pre-provisioned)
  - Append spend records with legId, robot, amount, txId
  - Mirror Node confirmation polling

- [ ] **H5** Implement `SpendController` (concrete ISpendController)
  - `buyIntel(legId)` implementation
  - Policy read integration via `IPolicyReader`
  - Hard ceiling enforcement
  - Idempotency lock
  - HCS logging
  - Fail-closed on any error

- [ ] **H6** Wire into `apps/api`
  - Replace mock spend controller with real one
  - Endpoint for x402 payments
  - Tests for payment flow

- [ ] **H7** Create testnet environment
  - `.env.example` filled with testnet values
  - HCS topic creation
  - Test payments executed

- [ ] **H8** Add to BUILD gate in tasks.md, run full test suite

---

## Evidence Log

| Task | Command | Result | Date |
|---|---|---|---|
| | | | |

---

## Notes / Risks

- `@x402/hedera` not on npm (F10); Strategy B is to self-signer with Hiero SDK
- Hedera testnet USDC: `0.0.6001`, 6 decimals (F12)
- Official x402 facilitators need no API key (F11)
- Buyer signs; facilitator fee payer submits (F13)
- Never invent Hedera addresses, field names, or header names (traps §11)

---

## Next: H1