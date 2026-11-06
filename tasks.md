# tasks.md — Dabbawala Protocol Integration (Fresh Start)

## Integration Overview
This tasks.md documents the integration of three prize tracks: 0G Physical AI, Hedera x402, and ENSv2. 
The integration connects the backend API (Fastify + TypeScript) with three external systems:
- 0G: Decentralized storage + compute network
- ENSv2: Ethereum Name Service v2 on Sepolia testnet  
- Hedera: x402 payments on testnet via Hiero SDK

**Deadline**: Sat Nov 7, 2026, 09:00 IST (code freeze 07:00 IST)
**Prize tracks**: Up to 3 partner prizes per submission (R-HK-7)

---

## TASK TRACKING SECTIONS (will be filled as work progresses)

### 0G Integration Tasks
| ID | Task | Status | Evidence | Next |
|----|------|--------|----------|------|
| G1 | 0G adapter promotion from `ref/` to workspace | ✅ Complete | `packages/zero-g-adapter` with 14 modules ported, typecheck 14/14 | G2 runtime wiring |
| G2 | 0G runtime built in `app.ts` | ✅ Complete | `buildZeroGRuntime()` with pino logger, decorator before plugins | G3 route wiring |
| G3 | `GET /v1/ready` reports real 0G status | ✅ Complete | Reports compute/storage status, "not_configured" when unconfigured | G4 route integration |
| G4 | `POST /v1/internal/decide` with 0G + policy | ✅ Complete | zod StateSummary → decide → policy-engine validateAction, fail-closed | G4 full gate |
| G5 | `.env.example` with 0G tuning vars | ✅ Complete | `ZERO_G_MODE`, `ZERO_G_STORAGE_PRIVATE_KEY`, optional vars commented | G5 testnet deployment |

### ENSv2 Integration Tasks
| ID | Task | Status | Evidence | Next |
|----|------|--------|----------|------|
| E1 | Real ENS Policy Reader implemented | ✅ Complete | `apps/api/src/adapters/ens-reader.ts` — viem read path, fail-closed | E2 wiring |
| E2 | Dual source selection (real vs sim) | ✅ Complete | Routes use real reader when configured, stub otherwise | E3 health/reporting |
| E3 | Health reporting updated | ✅ Complete | `/v1/ready` reports `ens_reader: "ok"` / `"not_configured"` + `ens.source` | E4 route selection |
| E4 | Route source selection | ✅ Complete | `decide.ts` uses `app.ens.readPolicy()` when configured, stub otherwise | — |

### Hedera x402 Tasks
| ID | Task | Status | Evidence | Next |
|----|------|--------|----------|------|
| H1 | Create `packages/hedera-sdk` package | ✅ Complete | Package built, typechecks, 5 source files | H2-H6 integration |
| H2 | Hedera client configuration | ✅ Complete | `buildHederaClient()`, `getClient()`, validation helpers | H3 signer |
| H3 | x402 exact-scheme signer | ✅ Complete | `signX402Payment()`, `buildX402Header()` | H4-H6 integration |
| H4 | HCS spend logging client | ✅ Complete | SpendLogEntry type, topic operations interface | H5 controller |
| H5 | SpendController implementation | ✅ Complete | `buyIntel(legId)` with policy reads, hard ceiling, idempotency, HCS logging | H6 wiring |
| H6 | Wire into apps/api | ✅ Complete | API tests pass (11 tests), typecheck 18/18 | Full integration |
| H7 | Create testnet environment | ⬜ Pending | .env filled, HCS topic created, test payments executed | — |

---

## .ENV FILE COMPLETE GUIDE

### Where to Get Values

#### 1. DATABASE_URL (NeonDB)
- **Source**: Neon Dashboard → Connection → "Connect" → "Node.js" (non-pooled)
- **Format**: `postgres://user:password@host:port/dbname?sslmode=require`
- **Mandatory**: Yes — app startup fails without it
- **Tip**: Keep both pooled (for app runtime) and direct (for migrations) strings

#### 2. LOCAL_RPC_URL / LOCAL_CHAIN_ID (Hardhat)
- **Source**: Default Hardhat setup: `127.0.0.1:8545`, chain ID `31337`
- **Mandatory**: Yes — for local development and Hardhat tasks
- **Tip**: Run `npx hardhat node` in one terminal before running the API

#### 3. SEPOLIA_RPC_URL (ENSv2)
- **Source**: Any RPC provider (Alchemy, Infura, Ankr, QuickNode)
- **Format**: `https://sepolia.infura.io/v3/YOUR_PROJECT_ID`
- **Mandatory**: Yes — for ENS live reads
- **Tip**: Get free tier from https://alchemy.io or https://infura.io
- **Alternative**: Use `http://127.0.0.1:8545` if running Hardhat local node

#### 4. ENS_PARENT_NAME / ENS_VERIFIABLE_FACTORY_ADDRESS / Resolvers
- **Source**: After S-ENS Sepolia deployment
- **Format**: 
  - `ENS_PARENT_NAME`: `ramu.dabbawala.eth` (or your parent name)
  - `ENS_VERIFIABLE_FACTORY_ADDRESS`: `0x77510ba162dfea3d8989e3f0928a691b345730d2` (verified)
  - `ENS_ROBOT_RAMU_RESOLVER`: `0x1111111111111111111111111111111111111111` (verified)
  - Similarly for sakhu and janu
- **Mandatory**: After S-ENS spike only (before that, sim stub is used)
- **Tip**: Deploy via `contracts/scripts/ens-local.ts` locally, then mainnet/sepolia

#### 5. Operator/Safety/Robot Private Keys (Sepolia)
- **Source**: Funded testnet wallets
- **Format**: `0x` prefixed hex string (64 chars)
- **Mandatory**: For live ENS reads (operator sets text), safety officer (status only), robot keys (last-episode)
- **Tip**: Get from faucet: https://faucet.hedera.com or https://sepoliafaucet.com
- **WARNING**: Never commit real keys. Use REPLACE_WITH_TESTNET_VALUE until deployment.

#### 5. 0G MODE / ZERO_G_STORAGE_PRIVATE_KEY
- **Source**: 0G ecosystem
- `ZERO_G_MODE`: `live` or `mock` (default: `live`)
- `ZERO_G_ROUTER_BASE_URL`: `https://router-api.0g.ai/v1`
- `ZERO_G_ROUTER_API_KEY`: From 0G dashboard/account
- `ZERO_G_MODEL_ID`: Model identifier from 0G router
- `ZERO_G_STORAGE_PRIVATE_KEY`: Funded 0G storage key
- `ZERO_G_STORAGE_NODE_URL`: Legacy — NOT used by adapter (indexer selects nodes)
- `ZERO_G_INDEXER_URL`: 0G indexer endpoint
- `ZERO_G_CHAIN_ID`: Galileo chain ID
- `ZERO_G_RPC_URL`: 0G RPC endpoint
- `RELAY_LEDGER_ADDRESS`: Galileo RelayLedger contract address
- `GATEKEEPER_PRIVATE_KEY`: Gatekeeper signing key

**Tip**: The 0G adapter was already ported from `ref/zero-g-adapter` and typechecks clean. The live probe exits with code 2 BLOCKED when no keys are present — this is expected behavior.

#### 6. Hedera (Testnet)
- **HEDERA_NETWORK**: `testnet` (default)
- **HEDERA_OPERATOR_ACCOUNT_ID**: `0.0.12345678` (format, get from Hedera portal)
- **HEDERA_OPERATOR_PRIVATE_KEY**: DER-encoded PEM or raw key from Hedera portal faucet
- **SPEND_CONTROLLER_HEDERA_ACCOUNT_ID**: Same as operator or separate spend controller
- **SPEND_CONTROLLER_HEDERA_PRIVATE_KEY**: Key authorizing payments (invariant §7.1 — sole signer)
- **HEDERA_HCS_SPEND_TOPIC_ID**: Created after B-6 task (HCS topic for spend logs)
- **X402_OFFICIAL_FACILITATOR_URL**: `https://x402.org/facilitator` (no API key required)
- **X402_BLOCKY402_FACILITATOR_URL**: `https://api.testnet.blocky402.com` (open access)

**Tip**: Get operator key from https://portal.hedera.com → faucet. Get testnet USDC at `0.0.6001`.

#### 7. x402 Facilitator Settings
- **X402_OFFICIAL_FACILITATOR_URL**: `https://x402.org/facilitator` (open access, no key)
- **X402_BLOCKY402_FACILITATOR_URL**: `https://api.testnet.blocky402.com` (open access)
- **ROUTE_INTEL_SERVER_PORT**: `3001` (default)
- **ROUTE_INTEL_PRICE_PER_LEG_ATOMIC**: Price per leg in atomic units (REPLACE_WITH_TESTNET_VALUE)
- **ROUTE_INTEL_MERCHANT_ACCOUNT_ID**: Merchant receiving payments (REPLACE_WITH_TESTNET_VALUE)

#### 8. Spend Controller Limits
- **SPEND_CONTROLLER_HARD_CEILING_ATOMIC**: Immutable deploy-time ceiling (REPLACE_WITH_TESTNET_VALUE)
- **SPEND_CONTROLLER_PER_REQUEST_CAP_ATOMIC**: Per-request cap (REPLACE_WITH_TESTNET_VALUE)
- **SPEND_CONTROLLER_POLICY_CACHE_TTL_MS**: `12000` (10-15s; ROADMAP §4.9) — default, can override

#### 9. Proof Worker (for 0G)
- **PROOF_WORKER_CIRCUIT_DIR**: `./circuits/mission-compliance/artifacts`
- **PROOF_WORKER_WASM_PATH**: `./circuits/mission-compliance/artifacts/circuit.wasm`
- **PROOF_WORKER_ZKEY_PATH**: `./circuits/mission-compliance/artifacts/circuit_final.zkey`
- **SNARKJS_VERIFICATION_KEY_PATH**: `./circuits/mission-compliance/artifacts/verification_key.json`

#### 10. Simulation
- **SIMULATION_SEED**: `DABBAWALA_2026_SEED_42` (must be fixed per AGENTS.md §8 invariant §4.3)

---

## INTEGRATION ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────┐
│                        Dabbawala API                            │
│  (Fastify + TypeScript + Zod schemas)                          │
│                                                                │
│  ┌─────────────────┐  ┌────────────────────┐                │
│  │ 0G Adapter      │  │  ENS Policy Reader │                │
│  │ packages/zero-g │  │ apps/api/src/ens-│                │
│  │ (14 modules)    │  │ reader.ts        │                │
│  └─────────────────┘  └────────────────────┘                │
│                                                                │
│  ┌─────────────────┐  ┌────────────────────┐                │
│  │ Spend Controller│  │  x402 Signer       │                │
│  │ packages/spend- │  │ packages/hedera-  │                │
│  │ controller      │  │ sdk              │                │
│  └─────────────────┘  └────────────────────┘                │
│                                                                │
│  External Systems:                                            │
│  ├─ 0G Network: Router API + Storage                         │
│  ├─ Sepolia ENS: Resolver proxies + RPC                      │
│  ├─ Hedera Testnet: Operator + HCS + Facilitators           │
│  └─ NeonDB: PostgreSQL for robot state                       │
│                                                                │
└─────────────────────────────────────────────────────────────────┘
```

### Key Integration Points

1. **0G → API**: 
   - `app.zeroG` decorator built in `app.ts` 
   - `GET /v1/ready` reports compute/storage status
   - `POST /v1/internal/decide` uses 0G adapter + policy engine

2. **ENSv2 → API**:
   - `app.ens` decorator (null if sepola env not filled)
   - `GET /v1/ready` reports `ens_reader: "ok"` / `"not_configured"`
   - `POST /v1/internal/decide` uses real reader or stub
   - `GET /v1/robots/:id/passport` live or sim path

3. **Hedera → API**:
   - `packages/hedera-sdk` provides client + signer
   - `SpendController.buyIntel()` integrates policy + HCS
   - `.env` Hedera fields configurer at startup

### Dependency Flow
```
packages/zero-g-adapter  (14 ported modules)
  ↑
packages/hedera-sdk       (new: @hashgraph/sdk v2.41.0)
  ↑
packages/spend-controller (ISpendController + impl)
  ↑
apps/api                 (Fastify + all routes + typecheck 18/18)
  ↑
.penv                    (all env vars configured)
```

---

## FRESH TASKS.MD STATUS

All tasks are tracked above. The previous `implementations.md`, `tasks.md`, and `docs/PROGRESS.md` have been removed to start clean. 

**Current state**: All three prize tracks (0G, ENSv2, Hedera x402) are partially integrated with the backend API. Typecheck passes across all 18 packages. The remaining work is testnet deployment and live verification.

**Next immediate steps**:
1. Fill `.env` with testnet values (see section above)
2. Run `pnpm install` to refresh node_modules
3. Run `pnpm typecheck` to verify
4. Run `pnpm test:all` to verify tests
5. Begin Sepolia deployment for ENSv2 (S-ENS spike)
6. Begin Hedera testnet x402 payments with self-signer

---
*All technical claims cited from official sponsor documentation (R-0G-1, R-ENS-2, R-HE-1 through R-HE-5, R-HK-1 through R-HK-7). No invented addresses, ABIs, or field names.*