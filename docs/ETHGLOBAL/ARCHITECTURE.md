# Dabbawala Protocol — Architecture

## System Diagram

```text
+---------------------+         +---------------------+         +---------------------+
|                     |         |                     |         |                     |
|   FRONTEND (Vercel) |         |    BACKEND (Fastify) |         |   DATABASE (Neon)   |
|                     |         |                     |         |                     |
|  - Console UI       |         |  - API Routes       |         |  - robots table     |
|  - Mission replay  |         |  - 0G Adapter       |         |  - episodes table   |
|  - Proof receipts  |         |  - Policy Engine    |         |  - episode_logs tbl |
|  - Inspector panel |         |  - Spend Controller |         |  - approval_tokens  |
|  - Fleet display   |         |  - Gate Keeper      |         |  - spend_records    |
|                     |         |  - Error handler    |         |                     |
+---------------------+         +---------------------+         +---------------------+
           \                               |                        |
            \                              |                        |
             \----------------------------+------------------------+
                                                   |
                                                   v
                                              +---------------+
                                              | 0G PRIVATE    |
                                              | COMPUTER      |
                                              | (Router)      |
                                              |               |
                                              | - decision()  |
                                              | - decideWithProvenance() |
                                              | - TEE verify  |
                                              | - request ID  |
                                              +---------------+
                                                   |
                                                   v
                                              +---------------+
                                              | HEDERA X402   |
                                              | MERCHANT      |
                                              |               |
                                              | - GET /route-intel/:legId |
                                              | - HTTP 402 challenge |
                                              | - x402 client   |
                                              | - facilitator   |
                                              | - settlement    |
                                              | - HCS audit     |
                                              +---------------+
                                                   |
                                                   v
                                              +---------------+
                                              | RELAY LEDGER  |
                                              | (0G Galileo)  |
                                              | - anchor root |
                                              | - verify root |
                                              +---------------+
```

## Data and Authority Flow

### Mission Lifecycle (Canonical)

1. **Mission Creation** — Frontend creates a mission; backend stores scenario, robot ID, seed.

2. **Backend loads robot ENS identity** — `GET /v1/robots/{id}/passport` reads actual ENSv2 records from Sepolia (or stub in sim mode). Returns:
   - ENS name, owner, resolver address
   - Permitted zones, budget (atomic string), status (active/paused)
   - Block number, valuesHash (policy content hash)
   - Source: "live" or "sim"

3. **Backend constructs trusted mission state** — StateSummarySchema-validated payload includes:
   - Mission ID, episode ID, robot ID, current cell, heading
   - Checkpoint index, total checkpoints, permitted routes
   - Restricted zones, remaining budget (from ENS), ENS policy block/hash
   - Scenario context, deterministic seed, previous approved actions
   - Current payment state, gate state
   - **Never** treats browser-supplied spending limits or permissions as authoritative

4. **0G Private Computer receives decision request** — `rt.brain.decideWithProvenance(state)`:
   - Constructs OpenAI-compatible request with `verify_tee: true`
   - Sends to Router API at `router-api.0g.ai/v1`
   - Returns provenance with: request ID, model response hash, TEE verification status
   - **Missing request ID → rejection**
   - **TEE verification false → safe-stop**

5. **Policy Engine validates the action** — `validateAction(action, policy, nowMs)`:
   - Policy must be fresh (not stale after expiry)
   - Policy must be active (not paused)
   - Action must be in closed set: continue, reroute, handoff, ask_human
   - Reroute: route ID exists, authorised, destination valid, no restricted zone crossing
   - Handoff: sender identity, receiver identity, position, permission, manifest integrity
   - Ask human: zone, robot, approver, nonce validated
   - **Policy freshness**: cached record must never silently become authoritative after expiry
   - **ENS policy rejection**: robot safe-stops if ENS unreadable

6. **If authorised, the simulation executes that action** — Frontend advances robot based on approved action:
   - `continue` → proceeds to next checkpoint
   - `reroute` → SVG path and robot position change based on approved route ID
   - `handoff` → sender and receiving robot enter real handoff state
   - `ask_human` → human gate modal opens; movement stops until token consumed
   - **Invalid action → reject and safe-stop**
   - **0G failure → safe-stop**
   - **TEE verification failure → safe-stop**
   - **ENS policy rejection → safe-stop**

7. **If paid information required, agent performs x402 payment** — Flow:
   - `GET /route-intel/:legId` → HTTP 402 Payment Required with x402 requirements
   - Agent (x402 client) automatically recognises challenge
   - Payment preparation → Facilitator submission → Hedera settlement
   - **Merchant only returns content after settlement verification**
   - Payment state: CREATED → CHALLENGED → SUBMITTED → CONFIRMED → FAILED/UNKNOWN
   - **Only CONFIRMED settles the paid action**

8. **If restricted zone requires approval, human-gate mechanism** — Flow:
   - Backend validates approver identity (no static bearer credentials in browser)
   - Backend mintscryptographically unbound token (TTL <= 60s)
   - Token bound to: robot ID, zone ID, mission ID, gate request ID, nonce, decision
   - Frontend displays: robot, zone, approver, request ID, expiry countdown, status
   - `POST /v1/gate/consume` → atomic database consumption
   - **Replay → 409 GATE_REPLAYED**
   - **Expired token → 403 APPROVAL_EXPIRED**

9. **All decisions, transactions and approvals are persisted** — Episode logs in PostgreSQL:
   - Decisions (with 0G request ID, proposed action, policy verdict, approved action)
   - Payments (with idempotency key, merchant, amount, asset, facilitator, tx ID, settlement status)
   - Gate approvals (with token hash, nonce, robot, zone, consumed status)
   - HCS spending events (with message sequence, tamper-evident)

10. **Episode finalisation** — Episode status updated, JSONL evidence generated

11. **JSONL evidence uploaded to 0G Storage** —:
    - Validate episode schema
    - Validate all decision records
    - Ensure every decision has genuine 0G request ID
    - Ensure settlement records have actual Hedera transaction IDs
    - Include ENS policy provenance
    - Remove secrets and sensitive information
    - Generate canonical deterministic JSONL
    - Pass through evidence linter
    - Calculate expected Merkle root
    - Upload using 0G Storage adapter
    - Capture actual root hash and upload transaction information
    - Verify uploaded evidence can be retrieved
    - Persist Storage receipt

12. **Anchor root on Galileo using RelayLedger** —:
    - Deposit root hash to RelayLedger contract on 0G Galileo (chain ID 16602)
    - Wait for transaction confirmation
    - Verify anchor by reading deployed contract
    - Persist complete evidence receipt (storage root, anchored root, transaction hashes)

13. **Verifier retrieves evidence and independently validates** —:
    - Download stored file from 0G Storage
    - Validate schema
    - Recompute Merkle root from JSONL
    - Read corresponding on-chain RelayLedger root
    - Compare both roots → structured verification result
    - Return: `episodeId`, `storageRoot`, `computedRoot`, `anchoredRoot`, `storageVerified`, `anchorVerified`, `integrityVerified`, `verifiedAt`
    - **No optimistic success responses**

14. **Frontend displays completed mission and real evidence** —:
    - Inspector panel shows ENS, 0G Compute, Hedera, HCS, 0G Storage, RelayLedger data
    - All values show source and block number
    - Stale values marked after 15s

## Authority Flow Diagram

```text
Frontend (interface)                     Backend (authority)
       |                                          |
       |-- POST /v1/mission/decide (state)-------|
       |                                          | 1. Read ENS policy (Sepolia)
       |                                          |
       |-- GET /v1/robots/:id/passport          | 2. Validate policy fresh/active
       |                                          |
       |-- Submit gate decision                 | 3. Call 0G Fleet Brain
       |                                          |    - verify_tee: true
       |                                          |    - Get request ID
       |                                          |    - TEE verification
       |                                          |
       |                                          | 4. validateAction() → approved/rejected
       |                                          |
       |                                          | 5. Execute approved action
       |                                          |    - continue: advance checkpoint
       |                                          |    - reroute: change route
       |                                          |    - handoff: handoff state
       |                                          |    - ask_human: open gate
       |                                          |
       |                                          | 6. If paid: x402 payment flow
       |                                          |    - GET /route-intel/:legId → 402
       |                                          |    - Client → Facilitator → Hedera
       |                                          |    - CONFIRMED → proceed
       |                                          |
       |                                          | 7. If gate: token mint + consume
       |                                          |    - Atomic DB op
       |                                          |
       |                                          | 8. Persist episode
       |                                          |
       |                                          | 9. Upload evidence → RelayLedger
       |                                          |
       |-- Receive verified state------------------|
                                          |
Frontend animates based on backend state  (NOT authoritative for permissions/budgets)
```

## Sponsor Technology Integration

| Sponsor | Technology | Role in Protocol | Status |
|---------|-----------|------------------|--------|
| **0G** | 0G Private Computer (Router) | Verified decision execution, TEE-verified proposals, replayable evidence, safe-stop on failure | Live (when API key configured) |
| **Hedera** | x402 merchant + facilitator | Autonomous autonomous metered purchasing, HTTP 402 challenge, Hedera settlement, HCS audit | Implementing |
| **ENSv2** | ENS names + PermissionedResolver | Decentralised identity, restricted permissions, budget, policy-controlled authority | Working |

## Exact Data Flow (Mission Checkpoint)

```
Frontend                     Backend                      0G              Policy
  |                          |                           |               |
  |--- POST state ---------->|                          |               |
  |                          | 1. read ENS policy ------>|               |
  |                          | 2. brain.decideWithProvenance() -------->|
  |                          |    - request ID from ZG-Res-Key header
  |                          |    - TEE verification (mandatory for LIVE)
  |                          |    - return {action, requestId, provenance}
  |                          | 3. validateAction(action, policy) -->
  |                          |    - policy fresh? active? zone allowed?
  |                          |    - RETURN: {valid, halt}
  |                          | 4. if valid: execute action
  |                          |    - continue/reroute/handoff/ask_human
  |                          | 5. if ask_human: gate token mint
  |                          | 6. if paid: x402 → facilitator → Hedera settlement
  |                          | 7. persist episode + evidence
  |                          | 8. anchor root on RelayLedger
  |                          |
  |-- receive verified state                                |
  |                           validation only on backend
```

## Configuration Status

- **API Port**: 3001 (canonical, consistent across all files)
- **Production CORS**: `https://dabbawala-frontend-alpha.vercel.app` allowed
- **Database**: NeonDB with full schema (robots, episodes, episode_logs, approval_tokens, spend_records)
- **ENS Sepolia**: Configurable via env vars (SEPOLIA_RPC_URL, resolver addresses)
- **0G Galileo**: chainId=16602, router URL, API key, model ID
- **Hedera testnet**: Operator account, spend controller, merchant account, x402 facilitator URLs