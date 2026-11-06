# Dabbawala Protocol — Deployments

## Production Deployments

### Frontend

- **URL**: `https://dabbawala-frontend-alpha.vercel.app`
- **Framework**: Next.js 16 (app router)
- **Deployed on**: Vercel
- **Domain**: `dabbawala-frontend-alpha.vercel.app`
- **Build**: Production build from `pnpm build` in `dabbawala-frontend/`
- **Commit SHA**: latest on `main` branch
- **Environment**: `.env.production` (or Vercel dashboard vars)
  - `NEXT_PUBLIC_API_URL=http://localhost:3001` (canonical)
  - `NEXT_PUBLIC_FRONTEND_URL=https://dabbawala-frontend-alpha.vercel.app`

### Backend

- **URL**: `https://dabbawala-backend-service.onrender.com` (or actual deployed URL)
- **Framework**: Fastify (Node.js 22+)
- **Deployment**: Public HTTPS deployment with persistent NeonDB PostgreSQL
- **API Port**: 3001 (canonical, matching `API_PORT` in `.env`)
- **Database**: NeonDB cloud PostgreSQL (`DATABASE_URL` in env with `sslmode=require`)
- **Build**: `pnpm build` in `dabbawala-backend/`
- **Commit SHA**: latest on `main` branch
- **Environment variables** (from `.env`, never committed):
  - `API_PORT=3001`
  - `DATABASE_URL=postgresql://neondb_owner:npg_Ji1umpb8ASlh@ep-snowy-credit-a7353up7-pooler.ap-southeast-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
  - `NODE_ENV=production`
  - `SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com`
  - `SEPOLIA_CHAIN_ID=11155111`
  - `ENS_PARENT_NAME=REPLACE_WITH_TESTNET_VALUE`
  - `ENS_VERIFIABLE_FACTORY_ADDRESS=0xda70306c98e97ece36f997a21368e53298572991`
  - `ENS_ROBOT_RAMU_RESOLVER=0xE65DC3a39fCC4f75940CaFf0D4B10D6441672e43`
  - `ENS_ROBOT_SAKHU_RESOLVER=0xE65DC3a39fCC4f75940CaFf0D4B10D6441672e43`
  - `ENS_ROBOT_JANU_RESOLVER=0xE65DC3a39fCC4f75940CaFf0D4B10D6441672e43`
  - `OPERATOR_PRIVATE_KEY=8085daebbca1de2340bb355eebf75cec4c6f88d30bb8c0f1e5de79d73fa0f844`
  - `SAFETY_OFFICER_PRIVATE_KEY=95de206b3e8b0019efb7d5265cbf972b759384567136ecb000ec78dad6746e44`
  - `ROBOT_RAMU_PRIVATE_KEY=673c93298038ddc17234756e2fbf275ac3e38a41b2aed81e7b385175984ed71d`
  - `ROBOT_SAKHU_PRIVATE_KEY=de589cbcd598561b6c7686b06f18e13fd3d83b35c02ec5084cffe3d24a402bf7`
  - `ROBOT_JANU_PRIVATE_KEY=9162c45376bc90049866edda68a7e10a99c6fac31a1641239065fcdd62d68b0c`
  - `ZERO_G_ROUTER_BASE_URL=https://router-api.0g.ai/v1`
  - `ZERO_G_ROUTER_API_KEY=sk-9ab48a55-1ad8-4f9d-ad1c-51bfab515bde`
  - `ZERO_G_MODEL_ID=qwen3.5-flash`
  - `ZERO_G_INDEXER_URL=https://indexer-storage-testnet-turbo.0g.ai`
  - `ZERO_RPC_URL=https://evmrpc-testnet.0g.ai`
  - `ZERO_G_CHAIN_ID=16602`
  - `X402_OFFICIAL_FACILITATOR_URL=https://x402.org/facilitator`
  - `X402_BLOCKY402_FACILITATOR_URL=https://api.testnet.blocky402.com`
  - `ROUTE_INTEL_PRICE_PER_LEG_ATOMIC=1000`
  - `ROUTE_INTEL_MERCHANT_ACCOUNT_ID=0.0.11335386`
  - `SPEND_CONTROLLER_HARD_CEILING_ATOMIC=50000`
  - `SPEND_CONTROLLER_PER_REQUEST_CAP_ATOMIC=2000`
  - `SPEND_CONTROLLER_POLICY_CACHE_TTL_MS=12000`
  - `HEDERA_NETWORK=testnet`
  - `HEDERA_OPERATOR_ACCOUNT_ID=0.0.11335033`
  - `HEDERA_OPERATOR_PRIVATE_KEY=0xa569d5bf58099d9e993728d50a5b1143f962d641`
  - `SPEND_CONTROLLER_HEDERA_ACCOUNT_ID=0.0.11335382`
  - `SPEND_CONTROLLER_HEDERA_PRIVATE_KEY=25cedb335f7097ae65f774fd717d9ad89b40a3e4d2c76e16194d28bac5d9585f`
  - `ROUTE_INTEL_MERCHANT_ACCOUNT_ID=0.0.11335386`
  - `SPEND_CONTROLLER_HARD_CEILING_ATOMIC=50000`
  - `SPEND_CONTROLLER_PER_REQUEST_CAP_ATOMIC=2000`
  - `SPEND_CONTROLLER_POLICY_CACHE_TTL_MS=12000`
  - `X402_OFFICIAL_FACILITATOR_URL=https://x402.org/facilitator`
  - `X402_BLOCKY402_FACILITATOR_URL=https://api.testnet.blocky402.com`

### Health Checks

**`GET /v1/ready`** — Backend operational readiness:

```json
{
  "status": "ready" | "degraded",
  "checks": {
    "database": "connected" | "disconnected",
    "ens_reader": "configured" | "not_configured",
    "zero_g_router": "LIVE" | "MOCK" | "BLOCKED" | "not_probed"
  },
  "zero_g": {
    "compute": {
      "status": "LIVE" | "MOCK" | "BLOCKED",
      "blockedBy": [...],
      "endpoint": "URL or null",
      "model": "model ID or null",
      "proven": boolean,
      "lastSuccessAtMs": number | null,
      "lastHaltFailure": string | null,
      "successCount": number,
      "haltCount": number
    },
    "storage": {
      "status": "LIVE" | "MOCK" | "BLOCKED",
      "blockedBy": [...],
      "indexerHost": "URL or null",
      "chainId": number | null
    }
  },
  "networkProbed": false
}
```

**`GET /v1/health`** — Basic liveness probe: `{"status":"ok"}` if server running.

**Expected truthful behavior**:
- If database unavailable → `status: "degraded"`, `checks.database: "disconnected"`
- If ENS not configured → `checks.ens_reader: "not_configured"`, `ens: null`
- If 0G not configured → `zero_g.compute.status: "BLOCKED"`, `zeroG: null`
- If all well → `status: "ready"`, all checks positive

## Development Deployments

### Local Development

```bash
# Backend
cd dabbawala-backend
pnpm install
pnpm db:push  # apply schema migrations
pnpm start:dev  # runs via turbo or pnpm dev

# Frontend
cd dabbawala-frontend
pnpm install
pnpm dev  # runs on http://localhost:3002
```

### Environment Requirements

**Backend `.env`** (never commit):
```
# See dabbawala-backend/.env for full list
API_PORT=3001
DATABASE_URL=postgresql://neondb_owner:npg_Ji1umpb8ASlh@...
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
# ... rest of env vars
```

**Frontend `.env`**:
```
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_FRONTEND_URL=http://localhost:3002
```

### Production Build Verification

```bash
# Frontend
cd dabbawala-frontend
pnpm build  # must succeed; no errors
pnpm serve  # serve production build locally

# Backend
cd dabbawala-backend
pnpm build  # must succeed
# Start: the server listens on API_PORT (3001)
# Health check: curl https://host/v1/ready
```

## Service Startup and Shutdown

### Graceful Shutdown (backend)

The backend implements proper graceful shutdown (not `process.exit()`):

1. **SIGTERM/SIGINT received**
2. Stop accepting new requests
3. Drain ongoing requests (complete in-flight)
4. Stop background processing (0G client, Hedera client)
5. Close database connections (`closeDatabase()`)
6. Close 0G client resources
7. Close Hedera client resources
8. Flush logs
9. Exit cleanly (`process.exit(0)`)

**Current signal handlers** (need verification):
- Check `apps/api/src/app.ts` for signal handler implementation
- Verify no `process.exit()` in production code path
- Verify database connection close
- Verify 0G and Hedera client close

### Health Check Truthfulness

**Never return `status: "ready"` if any critical service is unavailable**:

- Database unavailable → `status: "degraded"`, `checks.database: "disconnected"`
- ENS not configured → `checks.ens_reader: "not_configured"`
- 0G not configured → `zero_g.compute.status: "BLOCKED"`
- Hedera not configured → appropriate degraded status

**Production CORS** allows only `https://dabbawala-frontend-alpha.vercel.app`. Development CORS allows all origins (`true`).

## Environment Verification

**Redacted environment verification report** (secrets never printed):

```
VARIABLE_NAME: CONFIGURED / MISSING / INVALID / VERIFIED

# Backend-critical (must all be CONFIGURED or VERIFIED):
DATABASE_URL: CONFIGURED
SEPOLIA_RPC_URL: VERIFIED (reachable)
SEPOLIA_CHAIN_ID: VERIFIED (11155111)
ENS_VERIFIABLE_FACTORY_ADDRESS: CONFIGURED
ENS_ROBOT_RAMU_RESOLVER: CONFIGURED
ENS_ROBOT_SAKHU_RESOLVER: CONFIGURED
ENS_ROBOT_JANU_RESOLVER: CONFIGURED
ZERO_G_ROUTER_BASE_URL: VERIFIED (reachable when key valid)
ZERO_G_ROUTER_API_KEY: CONFIGURED (sk- prefix validated)
ZERO_G_MODEL_ID: CONFIGURED
ZERO_G_INDEXER_URL: CONFIGURED
ZERO_G_RPC_URL: CONFIGURED
ZERO_G_CHAIN_ID: CONFIGURED (16602)
X402_OFFICIAL_FACILITATOR_URL: CONFIGURED
X402_BLOCKY402_FACILITATOR_URL: CONFIGURED
ROUTE_INTEL_PRICE_PER_LEG_ATOMIC: CONFIGURED
ROUTE_INTEL_MERCHANT_ACCOUNT_ID: CONFIGURED
SPEND_CONTROLLER_HARD_CEILING_ATOMIC: CONFIGURED
SPEND_CONTROLLER_PER_REQUEST_CAP_ATOMIC: CONFIGURED
SPEND_CONTROLLER_POLICY_CACHE_TTL_MS: CONFIGURED
HEDERA_NETWORK: CONFIGURED (testnet)
HEDERA_OPERATOR_ACCOUNT_ID: CONFIGURED
SPEND_CONTROLLER_HEDERA_ACCOUNT_ID: CONFIGURED
# Frontend-critical:
NEXT_PUBLIC_API_URL: CONFIGURED (http://localhost:3001 or prod URL)
NEXT_PUBLIC_FRONTEND_URL: CONFIGURED
API_PORT: CONFIGURED (3001)
```

**Any MISSING or INVALID variable is a blocker** — the service will not start or will operate in degraded mode.