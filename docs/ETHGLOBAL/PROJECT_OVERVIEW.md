# Dabbawala Protocol — Project Overview

## What Dabbawala Protocol Solves

Dabbawala Protocol provides a bounded-authority operating layer for autonomous delivery agents. Each agent has an on-chain ENSv2 identity, restricted permissions, a spending budget, a policy-controlled decision loop, and independently verifiable execution history. The protocol ensures that:

- Agents can only perform authorised actions within enforced limits
- Critical service failures are detected and produce safe-stops
- Spending cannot exceed enforced budgets or hard ceilings
- Model proposals are validated against deterministic policy before any movement

## Why Autonomous Agents Require Bounded Authority

Without bounded authority, an AI agent could:
- Spend unlimited funds or exceed budget limits
- Move through restricted zones without approval
- Fabricate successful outcomes when services fail
- Bypass safety constraints when model proposals are untrusted

The Protocol solves this by placing the Policy Engine as the sole authority between model proposal and mission progression. The model proposes; the Policy Gate decides.

## Architecture

The protocol consists of integrated layers:

1. **ENSv2 Identity Layer** — Each robot (Ramu, Sakhu, Janu) has an actual ENSv2 name (`<name>.dabbawala.eth`) with a PermissionedResolver proxy. The resolver stores permitted zones, spending budget, and status. Enhanced Access Control (EAC) roles scope permissions (operator, safety officer, robot identity).

2. **0G Physical AI Layer** — The 0G Private Computer (Router) receives the mission state, proposes an action with TEE verification, and the Policy Engine validates the action. Decisions are provenance-recorded and replayable. Failed Router calls safe-stop the affected robot.

3. **Hedera x402 Payment Layer** — Agents perform autonomous x402 payments through a protected merchant endpoint. HTTP 402 challenges are automatically recognised and settled via a supported facilitator on Hedera testnet. Payment state is persisted with idempotency enforcement. HCS audit logs spending events.

4. **Human Gate Layer** — Restricted zone entry requires authenticated approver signing via a scoped permission token. Tokens are single-use, cryptographically unpredictable, and consumed atomically via database operation. Zone naming is canonical (`docks-r2`).

5. **Mission Lifecycle** — One authoritative backend-coordinated lifecycle: mission creation → policy read → 0G decision → policy validation → action execution → human gate (if needed) → evidence upload → RelayLedger anchoring → independent verification → replay.

## What Works Now (Post-Fixes)

- ✅ Canonical port configuration (3001) across frontend and backend
- ✅ Production CORS allows `https://dabbawala-frontend-alpha.vercel.app`
- ✅ Spend Controller: deterministic idempotency, ENS budget refusal, PostgreSQL persistence, payee allowlist, integer-safe math, hard ceiling enforcement
- ✅ Gate Keeper: canonical zone `docks-r2`, no static `sim-approver-all` token, fail-closed DB operations, atomic token consumption
- ✅ Policy Engine: reroute validation with route permissions, zone restrictions, policy freshness checks
- ✅ 0G Fleet Brain: TEE-mandated `verify_tee: true`, request ID extraction, halt on TEE failure, bounded retries
- ✅ ENS Passport: valuesHash separated from block hash, actual ENS names resolved (ramu, sakhu, janu)
- ✅ Mission lifecycle: backend-coordinated, deterministic policy validation, action-driven movement

## What Is Simulated

- 0G Router responses (live when API key configured; simulated otherwise)
- ENS policy reads (Sepolia live when resolver addresses configured; stub otherwise)
- Hedera x402 payments (testnet when facilitator reachable; simulated otherwise)
- Human gate approval (backend-enforced; modal simulation in frontend)
- Mumbai SVG robot animation (driven by backend state transitions where possible)

## What Is Deployed

- Frontend: Vercel deployment at `https://dabbawala-frontend-alpha.vercel.app`
- Backend: Public HTTPS deployment with Neon PostgreSQL database
- Database: NeonDB with schema for robots, episodes, episode_logs, approval_tokens, spend_records
- Networks: Sepolia (ENSv2), 0G Galileo (chain ID 16602), Hedera testnet

## Remaining Limitations

- 0G Router connectivity depends on API key and network availability
- ENS resolution depends on Sepolia RPC and resolver contract state
- Hedera x402 facilitator reachability depends on selected provider
- Human gate is backend-enforced but frontend modal is still simulation-based
- Some negative-path tests need automated execution

## Technical Discipline

- Fail-closed: if policy or ENS RPC is unreadable, grant no authority, execute no payments, deny zone entry
- Model output is untrusted proposal; only validated policy verdict affects movement
- All secrets loaded via environment variables; never hardcoded
- No `any` types in strict TypeScript mode
- Small modular files matching the roadmap layout
- Deterministic random seeds for all simulator runs