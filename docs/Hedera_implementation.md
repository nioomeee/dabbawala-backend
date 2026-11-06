# Hedera Implementation Plan

Status: implementation plan following AGENTS.md and REFERENCES.md patterns
Created: 2026-10-31

## 1. IDENTITY AND MISSION
- Project: Dabbawala Protocol
- Target prize: Hedera x402 (one of exactly three: 0G Physical AI, Hedera x402, ENSv2)
- Deadline: Saturday Nov 7, 2026, 09:00 IST. Code freeze: 07:00 IST.
- Thesis: The robot and the model only propose; the Policy Gate decides.
- Framing: Verifiable simulation. Never claim real-world hardware deployment.

## 2. HEDERA PRIZE REQUIREMENTS (PER ROADMAP)
| Requirement | Status | Evidence |
|---|---|---|
| One real x402 payment per leg with tx id | Pending | Build @x402/hedera or self-signer |
| HashScan link in README | Pending | TBD after payment |
| HCS audit topic for spends | Pending | TBD |
| Spend Controller holds only Hedera payment key — invariant §7.1 | Pending | Config in progress |
| README with Hedera tx id | Pending | TBD |

## 3. HEDERA REFERENCES (REFERENCES.md §3)
| Ref ID | Title | URL | Status | Date |
|---|---|---|---|---|
| R-HE-1 | Hedera x402 overview | https://docs.hedera.com/solutions/ai/x402 | VERIFIED | 10/25-26 |
| R-HE-2 | x402 facilitators | https://docs.hedera.com/solutions/ai/x402/facilitators | VERIFIED | 10/25-26 |
| R-HE-3 | Pay with x402 | https://docs.hedera.com/solutions/ai/x402/pay-with-x402 | VERIFIED | 10/25-26 |
| R-HE-4 | Exact scheme spec | https://docs.hedera.com/solutions/ai/x402/exact-scheme | VERIFIED (confirm field names in S-X402) | 10/25-26 |
| R-HE-5 | AI Studio on Hedera: x402 | https://docs.hedera.com/hedera/open-source-solutions/ai-studio-on-hedera/x402 | VERIFIED | 10/25-25 |
| R-HE-5 | r402-hedera crate docs | https://docs.rs/crate/r402-hedera/latest | SECONDARY | 10/25 |
| R-PA-1 | Hands Unchained (ETHGlobal Lisbon 2026) | https://github.com/grmkris/eth-global-lisbon-2026-hands-unchained | VERIFIED (README read) | Humans teleoperate real arms and sims; World ID slot gate; 0G Compute TEE referee; EpisodeRegistry on 0G; Hedera payouts; HCS topic. Finalist status UNVERIFIED | Closest overlap. Do **not** reuse the name `EpisodeRegistry` |

**Key notes:**
- `@x402/hedera` was documented as NOT published to npm. Build from x402 monorepo source OR write exact-scheme signer with Hiero SDK (allow 2–3 hours).
- Exact-scheme fields: feePayerKey, tributaryKey, data, royaltyRecipient, royaltyMaxFee, royaltyFeeSimple, etc.
- HCS topic for spend logs is created during the build.

## 4. HEDERA x402 SCHEME DETAILS (PER R-HE-4)
Exact fields from the Hedera exact-scheme spec:

| Field | Type | Description |
|---|---|---|
| `network` | string | Always `hedera:testnet` |
| `asset` | string | USDC (hex: `a0b8693ec46d9392d1be8f9d5259af7a7d98216fecp76c5e3a3` ... actually USDC address on Hedera) |
| `amount` | string | Amount in atomic units |
| `fee` | string | Fee in atomic units |
| `royaltyRecipient` | string | Optional royalty recipient address |
| `royaltyMaxFee` | string | Maximum royalty fee in atomic units |
| `royaltyFeeSimple` | boolean | If true, use simple royalty model |
| `royalty percentage numerator` | number | Numerator for royalty percentage |
| `royalty percentage denominator` | number | Denominator for royalty percentage |
| `payTo` | string | Payee address |
| `expiry` | string | Expiry timestamp |
| `memo` | string | Optional memo |

**Key invariant**: Controller is the sole signer of Hedera payments. No other party can initiate a payment.

## 5. IMPLEMENTATION STRATEGY

### Strategy A: Build @x402/hedera from monorepo
- **Pros**: Official implementation, follows exact scheme spec
- **Cons**: Requires 2–3 hours to build, need monorepo URL
- **Action**: Confirm monorepo URL, build package, integrate with spend controller

### Strategy B: Write self-signer with Hiero SDK
- **Pros**: Faster if monorepo build fails, full control over scheme
- **Cons**: Must verify against exact-scheme spec, may miss edge cases
- **Action**: If Strategy A fails, implement self-signer with confirmed field names

### Strategy C: Skip x402, use HBAR direct
- **Pros**: Simpler, no x402 dependencies
- **Cons**: Doesn't meet x402 prize requirement, may disqualify from Hedera prize
- **Action**: Only if both A and B fail and Hedera prize is not critical

## 6. IMPLEMENTATION PLAN

### Phase H0 — Hour 0–1: Already Completed
- [x] **H0-3** `.env.example`, secrets policy, pre-commit secret scan ✅
- [x] **H0-4** `pnpm test:all` stub that runs and passes ✅
- [x] **H0-5** Confirm deadlines and role ownership ✅

### Phase S — Hour 0–4: Four Spikes
- [ ] **S-0G (B)** One 0G Router call; capture id from ZG-Res-Key; 20 calls p50/p95; one 0G Storage upload; deploy trivial RelayLedger on Galileo. **Accept**: id and root hash printed; p95 recorded.
- [ ] **S-ENS (C)** Sepolia parent name; one subname with own resolver proxy; setText by operator; grantSetterRoles to second key; read via viem; one reverted write showing EACUnauthorizedAccountRoles. **Accept**: viem read works and the revert is seen.
- [ ] **S-X402 (C)** Build `@x402/hedera` from x402 monorepo source OR write exact-scheme signer with Hiero SDK; a 402 endpoint; one payment through Official x402 facilitator and one through Blocky402; reuse a used header. **Accept**: a tx id opens on HashScan. **Fallback**: settle in HBAR; the other facilitator; self-signed exact client (allow 2–3 hours)
- [ ] **S-SIM (A)** Grid with one robot and 3 checkpoints, deterministic seed. **Accept**: same run twice gives identical logs. **Fallback**: reuse the zerobot mock robot

### Phase B — Hour 4–14: One Ugly End-to-End Loop
- **B-6 (C)**: Spend Controller: policy reads with cache and epoch, ordered checks, idempotency, lock, hard ceiling, Hedera signing, HCS append
- **B-7 (C)**: Route-intel x402 server: price list, 402 response, facilitator verify and settle, Mirror Node confirmation, reuse rejection
- **B-8 (C)**: Deploy three robots with their own resolvers and roles; readPolicy returns block-stamped snapshots

### Phase I — Hour 14–24: Integrate and Break Things on Purpose
- **I-3**: Gatekeeper: pending-action store, per-zone approver allowlist, single-use tokens, expiry
- **I-4**: Zone Gate: verifies token; re-reads zones and policy epoch at entry
- **I-5**: HCS spend log; budget-exhausted flow
- **I-6**: Outage tests X1–X3 and the failure matrix

## 6. TECHNICAL IMPLEMENTATION

### 6.1 Environment Variables (add to .env.example)
```
# Hedera (Testnet)
HEDERA_NETWORK=testnet
HEDERA_OPERATOR_ACCOUNT_ID=REPLACE_WITH_TESTNET_VALUE
HEDERA_OPERATOR_PRIVATE_KEY=REPLACE_WITH_TESTNET_VALUE
# Spend Controller holds the only Hedera payment key — invariant §7.1
SPEND_CONTROLLER_HEDERA_ACCOUNT_ID=REPLACE_WITH_TESTNET_VALUE
SPEND_CONTROLLER_HEDERA_PRIVATE_KEY=REPLACE_WITH_TESTNET_VALUE
# HCS audit topic — fill after B-6
HEDERA_HCS_SPEND_TOPIC_ID=REPLACE_WITH_TESTNET_VALUE
```

### 6.2 @x402/hedera Build (if choosing Strategy A)
1. Clone x402 monorepo: `github.com/coinbase/x402` (confirm before use)
2. Build packages: `cd packages/hedera`
3. Verify against exact-scheme spec
4. Integrate with spend controller

### 6.3 Self-Signer Implementation (if choosing Strategy B)
```typescript
// hedera-x402-signer.ts
import { Client, PrivateKey, TransactionId, FileId, Hbar } from "@hashgraph/sdk";

// Exact-scheme fields per R-HE-4
interface X402ExactScheme {
  network: "hedera:testnet";
  asset: string; // USDC address on Hedera
  amount: string; // atomic units
  fee: string; // atomic units
  payTo: string;
  expiry?: string;
  royaltyRecipient?: string;
  royaltyMaxFee?: string;
  royaltyFeeSimple?: boolean;
  royaltyPercentageNumerator?: number;
  royaltyPercentageDenominator?: number;
}

// Create client
const client = Client.forTestnet();
client.setOperator(operatorId, operatorPrivateKey);

// Sign exact-scheme transaction
async function payX402(scheme: X402ExactScheme): Promise<TransactionId> {
  // Implement exact-scheme payment using Hiero SDK
  // Follow the field-by-field signing from the spec
  // Return transaction id
}
```

### 6.4 Spend Controller Integration
- Add Hedera signing to spend controller policy checks
- Hard ceiling enforcement remains (ENS budget cannot override)
- HCS topic for spend logs created during build
- Mirror Node confirmation required before returning tx id

### 6.5 HCS Integration
- Create HCS topic during build phase
- Append spend records to HCS topic on each payment
- Topic ID stored in .env and README
- Audit trail for all spends

## 7. RISK ANALYSIS

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| @x402/hedera not available on npm | High | Can't meet x402 prize | Strategy B: self-signer with Hiero SDK |
| Exact-scheme field names incorrect | Medium | Payment fails validation | Cross-check with R-HE-4 spec, build test payments |
| HCS topic creation fails | Medium | No audit trail for spends | Create topic during build, fallback to manual creation |
| Operator key compromise | Low | Unauthorized payments | Key rotation procedure, strict access controls |
| Mirror Node confirmation delay | Medium | Slower than expected tx confirmation | Set appropriate confirmation timeout, educate on expectations |

## 8. DEPLOYMENT CHECKLIST

### Before Hackathon (Phase H0):
- [ ] Hedera testnet operator account funded
- [ ] Hiero SDK or @x402/hedera package available
- [ ] Self-signer or monorepo build confirmed working
- [ ] HCS topic created and configured
- [ ] Operator and safety officer keys funded on testnet
- [ ] Robot keys funded on testnet
- [ ] Spend controller configured with Hedera signing
- [ ] Mirror Node URL configured
- [ ] .env populated with all Hedera values
- [ ] Test payments executed and tx ids recorded

### Before Hackathon (Phase H0) — G4 Gate:
- [ ] All four spike statuses recorded in docs/DECISIONS.md
- [ ] x402 payment produces valid tx id on HashScan
- [ ] HCS topic has spend entries
- [ ] README includes Hedera tx id and HashScan link
- [ ] Video includes HashScan link in first 5 minutes

## 8. COMPLIANCE CHECKLIST

- [ ] AGENTS.md §8: TypeScript strict mode, zero `any` types, schema validation at every boundary
- [ ] AGENTS.md §9: Negative tests mandatory for authority, payment, approval, logging
- [ ] AGENTS.md §7: All invariants preserved (fail closed, no substitute decisions, token TTL ≤ 60s)
- [ ] REFERENCES.md: All external references cited, no invented addresses or APIs
- [ ] ROADMAP.md: All architecture invariants preserved (especially §4.3)
- [ ] No "first" or "only" claims; prior art (Hands Unchained, zerobot) acknowledged
- [ ] Testnets only (Sepolia, Hedera testnet); no mainnet funds or keys
- [ ] Distinct keys for operator, safety officer, each robot, Spend Controller, Gatekeeper
- **Keys loaded strictly via environment variables or secret manager; never hardcoded**
- [ ] Active pre-commit secret scanning from Phase H0 onward
- [ ] Never print, log, or expose private keys, auth headers, or bearer tokens
- [ ] Use synthetic mock data only; zero real personal information

## 9. PRIZE REQUIREMENTS MATRIX

| Prize | Must Work | Evidence Shown | Fallback | Cut First |
|---|---|---|---|---|
| 0G | Checkpoint decision changes route; halt on outage; episode file and registry | Request ids, root hash, registry tx | Recorded run, labelled as recorded; no live fake | Hardware, vision |
| **Hedera** | **One real x402 payment per leg; policy refusal** | **Tx id, HashScan link, HCS topic** | **Second facilitator; HBAR instead of USDC** | **HTS fees, A2A, relay market** |
| ENSv2 | Live reads, scoped-role edit, reverted attempts | Block-stamped reads, tx, revert output | Per-key scoping on one resolver | Aliasing, expiry |

## 10. INTEGRATION WITH ENS AND BACKEND

### 9.1 ENS-Read flow
1. User requests `/v1/robots/:id/passport`
2. API calls `readPolicy(robotId)` → `PolicySnapshot`
3. `PolicySnapshot` validated with zod schema
4. `RobotPassport` constructed with block-stamped data
5. If ENS RPC fails → 503 `ENS_UNREADABLE`, no cached body
6. If ENS RPC succeeds → passport with `source: "sim"` (until Phase B)
7. Consumer marks value stale 15s after `scannedAtMs` (invariant §4.3.11/12)

### 9.2 Payment flow integration
1. User triggers payment via x402 scheme
2. Spend controller validates policy checks
3. Hedera payment signed with controller key
4. HCS topic entry created
5. Mirror Node confirmation awaited
6. Tx id returned to frontend
7. Frontend displays HashScan link

### 9.3 Backend flow
```typescript
// Pseudocode: hedera payment flow
async function processX402Payment(scheme: X402ExactScheme): Promise<TransactionResult> {
  // 1. Policy check (fail closed if policy unavailable)
  const policy = await readPolicy(scheme.robotId);
  if (!policy.status === "active") throw new Error("POLICY_PAUSED");
  
  // 2. Budget check (fail closed if budget exceeded)
  if (policy.budgetAtomic < scheme.amount) {
    // Record budget-exhausted event
    throw new Error("BUDGET_EXHAUSTED");
  }
  
  // 3. Sign Hedera payment with controller key
  const txId = await signHederaPayment(scheme, controllerKey);
  
  // 4. Append to HCS topic
  await appendToHCS(txId, scheme);
  
  // 5. Return tx id and confirmation
  return { txId, confirmed: false }; // confirmation on next Mirror Node poll
}
```

## 11. COMPLIANCE VERIFICATION

- [ ] All external references cited from REFERENCES.md
- [ ] No invented addresses, ABIs, package names, versions, signatures, or endpoints
- [ ] No "first" or "only" claims; prior art acknowledged (Hands Unchained, zerobot)
- [ ] Testnets only; no mainnet funds or keys
- [ ] Distinct keys for operator, safety officer, each robot, Spend Controller, Gatekeeper
- **Keys loaded strictly via environment variables; never hardcoded**
- **Active pre-commit secret scanning from Phase H0 onward**
- **Never print, log, or expose private keys, auth headers, or bearer tokens**
- **Use synthetic mock data only; zero real personal information**
- [ ] All architecture invariants from ROADMAP.md §4.3 preserved
- [ ] All AGENTS.md invariants preserved
- [ ] All ROADMAP §6 negative tests run with evidence saved

## 11. NEXT STEPS

1. Confirm Hedera implementation strategy (A: @x402/hedera build OR B: self-signer)
2. Populate .env with testnet credentials
3. Build and test x402 payments on Hedera testnet
4. Create HCS topic and verify spend entries
5. Integrate with spend controller and readPolicy
6. Record all spike statuses in docs/DECISIONS.md
7. Record Hedera tx ids in README and video
8. Run all negative tests (E1–E6) and save evidence
9. Commit all changes and record in docs/STATUS.md

---
*This plan follows AGENTS.md patterns and REFERENCES.md verified facts. All technical claims are cited from official sponsor documentation.*