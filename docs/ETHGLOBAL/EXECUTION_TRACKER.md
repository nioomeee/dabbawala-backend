Dabbawala Protocol — Execution Tracker (partial, key issues documented)

Issue: I-02 - Port mismatch - FIXED - Canonical port 3001 established across all files
Issue: I-03 - Production CORS - FIXED - Allows only https://dabbawala-frontend-alpha.vercel.app
Issue: I-05 - sim-approver-all token - FIXED - Removed from frontend
Issue: I-06 - Zone naming inconsistency (R-2 vs docks-r2) - FIXED - canonical docks-r2 established
Issue: I-12 - Hard-coded robot identity - FIXED - robotId parameter added to buyIntel
Issue: I-13 - Mock ENS policy - FIXED - ENS policy read from database
Issue: I-14 - ENS budget warning only - FIXED - Now refuses payment (BUDGET_EXHAUSTED)
Issue: I-15 - Idempotency key - FIXED - Deterministic key + PostgreSQL unique constraint
Issue: I-16 - Spend records in memory - FIXED - PostgreSQL persistence
Issue: I-17 - Concurrent payment race - FIXED - Atomic DB reservation + locking
Issue: I-18 - Direct HBAR transfer as x402 - FIXED - Facilitator-backed x402 flow
Issue: I-19 - Merchant 402 flow absent - FIXED - GET /route-intel/:legId implemented
Issue: I-20 - 0G evidence adapter - FIXED - Evidence upload route + verification
Issue: I-21 - Evidence upload endpoint - FIXED - POST /v1/evidence/upload created
Issue: I-22 - Runner doesn't execute approved action - FIXED - Action state machine in useScenarioRunner
Issue: I-23 - Mission payload placeholder state - FIXED - Trusted mission data from backend
Issue: I-24 - Hard-coded proof receipts - FIXED - Dynamic from backend results
Issue: I-25 - Live ENS owner placeholder - FIXED - Actual ENS names resolved on Sepolia
Issue: I-26 - Policy hash vs block hash - FIXED - Separated in viem-ens-reader
Issue: I-27 - ENS budget unit conversion - FIXED - Exact integer string throughout
Issue: I-28 - Passport calls not bootstrapped - FIXED - Loaded on startup
Issue: I-29 - Reroute validation incomplete - FIXED - Route permissions enforced
Issue: I-30 - Legacy ENS code defects - FIXED - Quarantined, not imported
Issue: I-31 - Raw backend errors - FIXED - Sanitised error responses
Issue: I-32 - No CI workflow - FIXED - GitHub Actions implemented
Issue: I-33 - README inconsistencies - FIXED - Reconciled with implementation
Issue: I-34 - Insufficient readiness - FIXED - CONFIGURED/REACHABLE/LIVE/VEREFIED states
Issue: I-35 - HCS spend logging simulated - FIXED - Actual HCS publish with sequence

Status: 38 issues identified and resolved. All sponsor criterion matrices marked PASS.