# Dabbawala Protocol — Demo Runbook

## For Judges: Reproducible Interaction Steps

### Prerequisites

- Browser (Chrome/Firefox/Edge latest)
- Network access to:
  - `https://dabbawala-frontend-alpha.vercel.app`
  - `https://dabbawala-backend-service.onrender.com` (or deployed backend URL)
  - Sepolia RPC (public node)
  - 0G Router API (when configured)
  - Hedera testnet (for x402 demo)
- Access to this runbook document

### Opening the Console

1. Open `https://dabbawala-frontend-alpha.vercel.app` in the browser
2. Wait for the page to load — three robot lanes (Ramu, Sakhu, Janu) should appear on the Mumbai map
3. The Inspector drawer should be collapsible on the right side
4. The Console Header should show scenario selector and og toggle

### Selecting a Scenario

5. Click the "Scenario" drawer (left side or bottom depending on layout)
6. Select scenario **TC-01: Clean Delivery (Happy Path)**
7. The lead robot should be set to **Ramu** (or as configured for the scenario)
8. The checkpoint icons on the map should update to show: CP1 (ENS), CP2 (Dadar x402), CP4 (Colaba Gate 4)

### Running the Mission

9. Press the "Play" button in the control shell
10. The robots begin moving along their lanes
11. At each checkpoint, the backend submits the mission state to 0G Fleet Brain:
    - The AI proposes an action
    - The Policy Engine validates it
    - The approved action animates the robot
12. Checkpoint progression:
    - **CP1 (Mahim ENS Gate)**: Ramu reads ENS policy → zones, budget, status displayed in inspector
    - **CP2 (Dadar x402 Relay)**: Route intel purchase via x402 payment flow
      - HTTP 402 challenge from merchant
      - Client auto-handles 402 → facilitator → Hedera settlement
      - Route intel returned only after CONFIRMED payment
      - Robot continues with new route
    - **CP4 (Colaba Gate 4 Delivery)**: Mission completes

### Inspecting Evidence

13. Open the **Inspector Drawer** panel
14. Navigate between tabs:
    - **ENS**: Shows Ramu's ENS name, owner, resolver, zones, budget, status, policy hash, block number
    - **0G Compute**: Shows model, request ID, TEE verification status, proposal, deterministic verdict
    - **Hedera**: Shows x402 merchant, payment amount, facilitator, settlement status, HashScan link
    - **HCS**: Shows topic ID, message sequence, transaction reference
    - **0G Storage**: Shows file reference, root hash, retrieval status
    - **RelayLedger**: Shows contract address, episode root, anchoring transaction, independent verification status

### Demonstrating Safe-Stop

14. During mission run, the judge can:
    - Block the 0G Router (judge-side devtool: `process.env.ZERO_G_ROUTER_BASE_URL = ""`)
    - Press the checkpoint decision button
    - Observe: robot safe-stops with `haltReason = "ACTION_NOT_ALLOWED"`, verdict = "SAFE-STOP"
    - Check inspector: 0G Compute shows `status: BLOCKED`, `proven: false`
    - Restore the env variable and press "Reset" → fresh play required (no resume from halted state)

### Demonstrating Human Gate

15. Select scenario TC-12 (Human Gate Approved Zone R-2) or TC-13 (Human Gate Denied)
16. At the gate checkpoint, the modal opens requesting zone entry
17. For TC-12: the judge (as approved approver) signs the request → token minted → robot passes
18. For TC-13: the judge DENIES → no token → robot safe-turns
19. The token is consumed atomically before movement proceeds (verify in episode logs)

### Replaying from Evidence

20. Mission completes → episode finalised
21. Evidence uploaded to 0G Storage → root anchored on RelayLedger (Galileo, chain 16602)
22. Judge downloads the episode log via `GET /v1/episodes/TC-01/log`
23. Judge recomputes the Merkle root from the JSONL content
24. Judge reads the on-chain RelayLedger root
25. Both roots match → independent verification succeeds
26. The mission can be replayed from stored evidence (no new 0G calls needed)

### Video Recording Instructions

**For submission videos**:

- **General video** (≈2 min 50 sec): Capture the full demo flow from scenario selection to mission completion, evidence upload, and verification
- **0G Physical AI video** (under 3 min): Focus on the 0G decision loop, request IDs, TEE verification, safe-stop test, and replay
- **Hedera x402 video** (5 min or less): Focus on the x402 payment flow: 402 challenge → facilitator → Hedera settlement → HashScan link → route intel return
- **ENS video** (as needed): Focus on ENS passport resolution, policy change demonstration (paused→halt, budget→refusal)

**Recording guidelines**:
- Narration spoken by a real team member (not AI voiceover)
- Show actual product functionality (no simulated screens passed off as live)
- Avoid AI-generated voiceover
- Avoid music-only text explanations
- Not sped up to fit the time
- Show real explorer links (HashScan, transaction views)
- Distinguish simulation from live evidence (mark explicitly when in sim mode)
- Final live judging presentation must fit seven-minute structure:
  - Four minutes of demonstration
  - Three minutes of Q&A

### Quick Keys

- **Play/Pause**: Spacebar or button in control shell
- **Scenario select**: Open drawer, click scenario card
- **Reset**: Ctrl+R or reset button
- **Inspector toggle**: Inspector drawer button
- **0G outage** (judge-side): Block `ZERO_G_ROUTER_BASE_URL` env var

## Troubleshooting During Demo

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "0G runtime not configured" | Missing ZERO_G env vars | Verify `.env` has `ZERO_G_ROUTER_BASE_URL`, `ZERO_G_ROUTER_API_KEY`, `ZERO_G_MODEL_ID` |
| "ENS_UNREADABLE" | Sepolia RPC or resolver misconfigured | Check `SEPOLIA_RPC_URL`, resolver addresses in `.env` |
| "Payment refused: BUDGET_EXHAUSTED" | ENS budget exceeded | Reduce spending or increase budget via operator transaction |
| "APPROVER_NOT_ALLOWLISTED" | Wrong zone or approver | Only `docks-r2` with `approved-approver` is allowed |
| "402 Payment Required" expected but not shown | Merchant endpoint not protected | Ensure unauthenticated `GET /route-intel/:legId` returns 402 |
| "Transaction not confirmed" | Hedera settlement pending | Wait for receipt; check HashScan link |
| Robot halts unexpectedly | Policy Engine rejection | Check inspector: policyHalt field shows reason |
| Episode log shows "sim" not "live" | 0G/ENS using stub mode | Verify env vars for live network configuration |

## Demo Timebox

**Seven-minute judging presentation structure**:

| Segment | Duration | Content |
|---------|----------|---------|
| **Demo (4 min)** | 2 min 30 sec | Scenario selection → mission start → checkpoint 1 (ENS) → checkpoint 2 (x402) → checkpoint 3 (gate/handoff) → mission completion → evidence upload → RelayLedger anchoring |
| | 1 min 30 sec | Outage simulation → safe-stop → restore → replay from evidence |
| **Q&A (3 min)** | 3 minutes | Judge questions about: ENS necessity, 0G decision, Policy Engine bypass, x402 settlement, spending limits, concurrent requests, episode integrity, service failures, real vs simulated |

**Technical answers prepare** (already drafted in AI_ASSISTANCE_DISCLOSURE.md and sponsor criterion matrices):

1. Why is ENS required rather than a database? → Decentralised identity with permissioned delegation; EAC roles; on-chain authority that cannot be overridden without operator consent; auditability via blockchain explorer
2. What is 0G actually deciding? → The 0G Private Computer (Router) receives the mission state and proposes an action using a TEE-verified LLM inference. The proposal is untrusted; the Policy Engine validates it against current ENS policy (zones, budget, status). Only a validated action affects robot movement.
3. Why can't an AI proposal bypass the Policy Engine? → Invariants: model output is untrusted; fail-closed if policy unreadable; every action validated against closed action set and policy snapshot; reroute must satisfy route ID, destination validity, zone permissions, and policy freshness; ask_human gated by authenticated approver
4. How does x402 settle without a human approving every payment? → The agent auto-recognises the HTTP 402 challenge; prepares payment (amount, payee, metadata); submits to facilitator; facilitator settles on Hedera testnet via TransferTransaction; receipt.status === "SUCCESS" → payment verified; only CONFIRMED status authorises the paid action; idempotency key prevents double-charge on retry
5. How are spending limits enforced under concurrent requests? → Per-request cap (1000 atomic), immutable hard ceiling (50000 atomic), and per-robot ENS budget (from resolver) — all enforced via atomic database reservations; two simultaneous requests cannot both spend against same remaining budget; the first to commit wins; the second respects the updated total
6. How is episode integrity verified? → JSONL evidence uploaded to 0G Storage; Merkle root computed deterministically; root anchored on RelayLedger (Galileo, chain 16602); verifier downloads file, recomputes root, reads on-chain root, compares both roots; structured result: `storageVerified`, `anchorVerified`, `integrityVerified`
7. What happens when an RPC or sponsor service fails? → Fail-closed: 503 ENS_UNREADABLE if ENS RPC down; 0G timeout → safe-stop with halt reason; no fallback model decision; database outage → fail closed (no in-memory Map for critical state); HCS event failure → non-blocking, async retry
8. What parts are real versus simulated? → Real: ENSv2 on Sepolia (actual resolver reads), 0G Router API calls (when key valid, TEE-verified), Hedera testnet x402 settlement (real tx IDs on HashScan), Spend Controller PostgreSQL persistence, Policy Engine validation logic. Simulated: 0G Mock mode when live key unavailable, ENS stub mode when Sepolia RPC unreachable, Human gate modal UI (backend enforces, frontend sim), SVG robot animation (driven by backend state where possible)
9. What would be required for real delivery robots? → Physical robot hardware integration; real-world GPS/ODOMETRY sensors; real-world budget management beyond testnet HBAR; real-world restricted zone geofencing; regulatory compliance; real-world HCS topic with actual organisations; multi-agent coordination with real fleet management; extended TEE guarantees for physical world operations

---

**Report any issues to the Chief Protocol Architect during the judging session.**

## Known Limitations (Concise for Judges)

- 0G Router requires valid API key; may fail closed if rate-limited or expired
- ENS resolution depends on Sepolia RPC availability
- Hedera x402 facilitator has two configured URLs (official + blocky402 fallback)
- Human gate modal is UX simulation; backend enforces allowlist and token consumption
- Some negative-path test matrices not fully automated (critical paths covered)
- SVG robot animation driven by backend state where possible, but some frame-by-frame animation remains
- Demo depends on three external networks (Sepolia, 0G Galileo, Hedera testnet) — all testnet-only, no real funds