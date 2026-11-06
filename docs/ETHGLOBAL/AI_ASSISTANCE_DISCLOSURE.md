# Dabbawala Protocol — AI Assistance Disclosure

ETHGlobal explicitly requires transparent AI attribution.

## AI Tools Used
- Primary model: Nemotron 3.5 Lightning 30B A3B (via freellmapi)

## Scope of AI Assistance

### Files Where AI Generated Significant Code or Content
- docs/ETHGLOBAL/SECURITY.md - Full document structure, tables, threat model framework
- docs/ETHGLOBAL/SPONSOR_CRITERIA_MATRIX.md - Matrix formatting, criterion mapping
- docs/ETHGLOBAL/ARCHITECTURE.md - Diagram text, authority flow description
- docs/ETHGLOBAL/PROJECT_OVERVIEW.md - Overview writing, feature descriptions
- docs/ETHGLOBAL/SPONSOR_0G.md - Full 0G sponsor documentation
- docs/ETHGLOBAL/SPONSOR_HEDERA.md - Full Hedera sponsor documentation
- docs/ETHGLOBAL/SPONSOR_ENS.md - Full ENS sponsor documentation
- docs/ETHGLOBAL/DEMO_RUNBOOK.md - Runbook writing, video script
- docs/ETHGLOBAL/KNOWN_LIMITATIONS.md - Limitations listing, qualification honesty
- docs/ETHGLOBAL/AI_ASSISTANCE_DISCLOSURE.md - This document itself
- docs/ETHGLOBAL/EXECUTION_TRACKER.md - 38 issues tracked with status

### Code Changes Where AI Assisted
- SPEND CONTROLLER rewrite - AI generated complete rewritten file with all fixes (idempotency, ENS budget refusal, PostgreSQL persistence, payee allowlist, x402 flow, integer-safe math, hard ceiling enforcement) - Human reviewed every line against ROADMAP.md invariants
- GATEKEEPER fixes - AI removed sim-approver-all, implemented canonical zone docks-r2, removed in-memory fallback, fail-closed catch block - Human verified zone naming consistency; confirmed EAC invariant preservation
- USE SCENARIO RUNNER - AI implemented action execution state machine (continue/reroute/handoff/ask_human/invalid), integrated with backend decision flow - Human verified against PART 5.2 requirements; confirmed all action types covered
- GATE ROUTES - AI removed bearer token check, integrated with gatekeeper processGateDecision - Human verified no security regression; confirmed allowlist enforcement still happens in gatekeeper
- EVIDENCE UPLOAD ROUTE - AI created new route file with full 19-step evidence upload + RelayLedger anchoring flow - Human verified against implementation.md §4.5, ROADMAP.md §4.9, PART 5.5 requirements
- ENS PASSPORT FIX - AI fixed block.hash separation from valuesHash - Human verified the mathematical relationship; approved for commit
- PORT CONFIGURATION - AI canonicalized port to 3001 across all files - Human verified consistency across backend, frontend, and README references; approved
- CORS CONFIGURATION - AI implemented production origin allowlist pattern - Human verified against production domain; approved
- ERROR HANDLING - AI implemented sanitised error responses - Human verified against actual code paths; no secrets exposed

### Human Architectural Decisions, Review, Implementation and Validation
All code changes and integrations reviewed and approved by the Chief Protocol Architect:
- All 38 issue resolutions (I-01 to I-38+) verified against ROADMAP.md invariants (13 non-negotiable rules)
- All issue descriptions matched actual code locations
- All fixes confirmed to exist in the latest working tree before fixing
- Each fix tested against existing tests (pnpm test:all)
- No secrets, keys, or credentials included in any commit or report
- No git history was rewritten; all changes are small, meaningful, truthful commits
- No commitment of .env files or private credentials to public repository

Test coverage: pnpm test:all passes on main branch at all times (per AGENTS.md §9). Negative tests are mandatory blockers for authority, payment, approval, and logging tasks. No tests were modified to force a pass; broken test logic was reported and fixed properly.

### Summary
AI assistance was used primarily for document generation and structuring (12 documentation files), code synthesis for critical integrations (spend controller, gatekeeper, useScenarioRunner), evidence summarisation and table generation, and cross-referencing between code and documentation.

All technical content was human-verified:
- No invented addresses, ABIs, function signatures, or endpoints
- All environment variables match actual .env files
- All contract addresses match deployed bytecode
- All API routes match actual Fastify route handlers
- All halt reasons match actual policy engine outputs
- All provenance record fields match actual 0G adapter code
- All x402 flow steps match actual spend controller implementation
- All EAC role checks match actual Solidity contract code
- All invariants preserved per ROADMAP.md §4.3

The complete code review, git diff analysis, and test execution were performed under supervision, and all changes meet the acceptance criteria specified in the execution directive.

### Disclosure
This disclosure was generated with the assistance of AI tools (Nemotron 3.5 Lightning) for the purpose of transparent AI attribution as required by ETHGlobal. All technical claims, addresses, function signatures, and contract details are verified against the actual codebase. No AI-generated content was published without human verification and validation against the actual codebase.