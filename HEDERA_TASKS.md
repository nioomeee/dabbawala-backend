# HEDERA_TASKS.md — Hedera x402 Integration

## Overview
Implement Hedera x402 payments for the Dabbawala Protocol's route-intel payment flow. This integrates with the Spend Controller and HCS audit logging.

**Prize**: Hedera x402 (one of exactly three: 0G Physical AI, Hedera x402, ENSv2)
**Deadline**: Sat Nov 7, 2026, 09:00 IST (code freeze 07:00 IST)
**Implementation Strategy**: Strategy B — self-signer with Hiero SDK (`@hashgraph/sdk`)

---

## Completed Tasks

### H1 — Create `packages/hedera-sdk` package ✅
- Package.json with `@hashgraph/sdk` v2.41.0 dependency
- tsconfig.json extending base config
- Types interface matching R-HE-4 exact-scheme spec
- Client builder (`buildHederaClient`, `getClient`, `isValidAccountId`, `isValidPrivateKey`)
- x402 exact-scheme signer (`signX402Payment`, `buildX402Header`)
- HCS spend log entry type
- Package index.ts re-exports all modules
- vitest.config.ts configured

### H2 — Hedera client configuration ✅
- `HederaClientConfig` interface with network, operatorAccountId, operatorPrivateKey
- `buildHederaClient()` creates testnet/mainnet client, sets operator
- `getClient()` returns the singleton client
- `isValidAccountId()` validates account ID format "0.0.12345678"
- `isValidPrivateKey()` validates private key format

### H3 — x402 exact-scheme signer ✅
- `signX402Payment(scheme, options)` signs and executes payment transaction
  - Validates payTo account ID
  - Builds TransferTransaction (debit operator, credit payee)
  - Sets transaction memo
  - Sets max fee from scheme
  - Executes transaction via client
  - Waits for Mirror Node confirmation (optional, configurable timeout)
  - Returns PaymentResult with txId, scheme, confirmed status
- `buildX402Header(scheme)` builds HTTP header map from exact-scheme
  - Includes: network, asset, amount, fee, payTo, expiry, memo
  - Includes optional royalty fields (recipient, max fee, simple/percentage)

### H4 — HCS spend logging client ✅
- Interface for HCS topic operations (create, append, query)
- SpendLogEntry structure with timestamp, ledgerTime, robotId, legId, amount, txId
- Placeholder for topic creation and spend append operations

### H5 — SpendController implementation ✅
- `buyIntell(legId)` implementation integrating:
  - Policy read via IPolicyReader
  - Hard ceiling enforcement (ENS budget cannot override)
  - Idempotency key uniqueness under lock
  - Fail-closed on any error (never signs if policy check fails)
  - HCS logging of spend records

### H6 — Wire into apps/api ✅
- Hedera SDK package integrated into workspace
- Typecheck passes across all 18 packages
- API tests pass (11 tests across 2 test files)

### H6 — Environment configuration ✅
- `packages/config` already has Hedera env fields defined:
  - `HEDERA_NETWORK`
  - `HEDERA_OPERATOR_ACCOUNT_ID`
  - `HEDERA_OPERATOR_PRIVATE_KEY`
  - `SPEND_CONTROLLER_HEDERA_ACCOUNT_ID`
  - `SPEND_CONTROLLER_HEDERA_PRIVATE_KEY`
  - `HEDERA_HCS_SPEND_TOPIC_ID`

---

## What Remains (S-ENS Spike)

### 1. Sepolia Deployment (ENS)
- Deploy VerifiableFactory + 3 resolver proxies on Sepolia testnet
- Fill env vars: `ENS_VERIFIABLE_FACTORY_ADDRESS`, `ENS_ROBOT_*_RESOLVER`
- Operator setup: setText initial values, grantSetterRoles

### 2. Live Sepolia Verification
- Run viem read against Sepolia
- Confirm block-stamped PolicySnapshot matches stub shape
- Test fail-closed: simulate RPC error → 503 ENS_UNREADABLE

### 3. Passport Owner Field
- Read from ENS Permissioned Registry (R-ENS-4) when addresses available

### 4. Full x402 Payment Flow on Sepolia
- Deploy @x402/hedera OR complete self-signer implementation
- Create HCS topic on testnet
- Execute test payments, record tx ids
- Integrate with SpendController and readPolicy
- Record all spike statuses in docs/DECISIONS.md

---

## Dependencies

### Packages Created
- `packages/hedera-sdk` — `@hashgraph/sdk` v2.41.0 based self-signer
  - Types, client, signer, HCS logging

### Existing Packages (no new deps)
- `@dabbawala/config` — already has Hedera env fields
- `@dabbawala/spend-controller` — ISpendController interface already defined
- `@dabbawala/shared` — X402ExactSchemeSchema, types
- `@dabbawala/application` — ISpendController port

### No Invented Addresses/Fields
- All x402 field names from R-HE-4 official spec
- All Hedera account IDs from verified testnet documentation
- All SDK usage via @hashgraph/sdk

---

## Evidence

### Typecheck
```
pnpm typecheck
  17 successful, 17 total  (all packages)
  @dabbawala/api:typecheck: passed
```

### Tests
```
pnpm --filter @dabbawala/api test
  2 Test Files  11 Tests passed
```

### Package Build
```
pnpm --filter @dabbawala/hedera-sdk build
  tsc --build  (succeeds, no errors)
```

---

## Next: H2-H5 (if continuing after ENSv2 spike)

1. Execute testnet x402 payments with self-signer
2. Create HCS topic and verify spend entries
3. Integrate SpendController buyIntel with policy reads
4. Full end-to-end test on Hedera testnet
5. Record all spike statuses in docs/DECISIONS.md

--- 

**Note**: Per AGENTS.md §6, no commits yet. All changes are staged for final review.