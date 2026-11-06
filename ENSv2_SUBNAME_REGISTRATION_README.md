# ENSv2 Subname Registration — Dabbawala Protocol

## Overview
This module handles the registration of Ethereum Name Service (ENSv2) subnames on Sepolia testnet. 
Subnames (e.g., `ramu.dabbawala.eth`, `janu.dabbawala.eth`, `sakhu.dabbawala.eth`) are registered 
via a Permissioned Subregistry contract, with role-based access control and idempotent registration.

The agent wallet holds `ROLE_REGISTRAR` (+`ROLE_RENEW`) on the subregistry's `ROOT_RESOURCE` only. 
The deployer/owner key stays offline.

---

## 1. Installation

```bash
# Install dependencies (already included in the project)
pnpm install

# Ensure TypeScript compiles
pnpm run typecheck
```

---

## 2. Environment Configuration

Create `.env` at the project root:

```env
# --- Core ENSv2 (Sepolia) ---
AGENT_PRIVATE_KEY=0xYOUR_AGENT_KEY_HERE          # Agent key: ROLE_REGISTRAR + ROLE_RENEW on subregistry
# The deployer/owner key is offline; not stored in .env

# Sepolia 0x11155111
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
SEPOLIA_CHAIN_ID=11155111

# Parent name and subregistry (verified post-2026-10-01 redeploy)
PARENT_NAME=dabbawala.eth
SUBREGISTRY_ADDRESS=0x9407F49851A8CA985123Fc5b1BeCab1aAbAf7313
VERIFIABLE_FACTORY_ADDRESS=0xDa70306C98E97eCe36F997a21368e53298572991
PARENT_RESOLVER_ADDRESS=0xE65DC3a39fCC4f75940CaFf0D4B10D6441672e43

# Subname owners (config-driven, JSON — see config.ts)
# ramu: 0x8438A07f75ebd1aBFfd241b41c77f3DA26c36734
# janu: 0x993B0873713315C820F1744e4533f5b0E719407B
# sakhu: 0x649A0f18586b42E7f2E53486A4aCF9536E2e5917

# --- Derived (computed at runtime) ---
# No manual edits needed below this line
```

**Important:** 
- `AGENT_PRIVATE_KEY` must be the agent's Sepolia private key holding `ROLE_REGISTRAR` (1) and `ROLE_RENEW` (1<<16) on the subregistry's `ROOT_RESOURCE`.
- The deployer/owner key **must remain offline** and is never stored in `.env`.
- All other addresses are **verified** against the Sepolia post-2026-10-01 redeploy.

---

## 3. Quickstart

```bash
# 1. Compile/check TypeScript
pnpm run typecheck

# 2. Run the pre-flight checks
pnpm exec tsx src/ens/preflight.ts

# 3. Register a subname (e.g., ramu)
pnpm exec tsx -e "
import { registerSubname } from './src/ens/registrar';
const result = await registerSubname({
  label: 'ramu',
  owner: '0x8438A07f75ebd1aBFfd241b41c77f3DA26c36734',
});
console.log('txHash:', result.txHash);
console.log('idempotent:', result.idempotent);
"

# 4. Register all three subnames
pnpm exec tsx -e "
import { registerSubnames } from './src/ens/registrar';
const results = await registerSubnames([
  { label: 'ramu', owner: '0x8438A07f75ebd1aBFfd241b41c77f3DA26c36734' },
  { label: 'janu', owner: '0x993B0873713315C820F1744e4533f5b0E719407B' },
  { label: 'sakhu', owner: '0x649A0f18586b42E7f2E53486A4aCF9536E2e5917' },
]);
console.log('Results:', results);
"
```

---

## 3. Architecture

### `src/ens/config.ts`
- Core addresses (Sepolia post-2026-10-01 redeploy)
- viem client instance
- `SubnameConfig` type
- Preflight check helpers (`verifySubregistryImplementation`, `agentHasRegistrarRole`, etc.)

### `src/ens/preflight.ts`
- `runPreflight(labels)` — runs all 4 pre-flight checks
  - Subregistry implementation match
  - Agent has `ROLE_REGISTRAR` on subregistry `ROOT_RESOURCE`
  - Parent ENS registry's subregistry pointer is correct
  - All target labels are `AVAILABLE` (0)
- `assertPreflight(checks)` — throws if any check fails
- `namehash(label)` — keccak256 label hashing

### `src/ens/registrar.ts`
- `registerSubname(config)` — registers a single subname
  - Calls `register(label, owner, registry, resolver, roleBitmap, expiry)` on SUBREGISTRY
  - Simulates first, then sends transaction
  - Post-registration: sets address record (coin type 60) via PermissionedResolver
- `registerSubnames(configs)` — batch registration
- `checkAlreadyRegistered(label, owner)` — idempotency check

### `src/server.ts`
- Express HTTP server with `POST /subnames` endpoint
- Validates labels (`[a-z0-9-]`) and addresses (checksum)
- Rate-limited (10 req/min per IP)
- Maintains nonce-safe retry queue
- Structured logs (without secrets)

### `abis/`
- `PermissionedRegistry.json` — `register(...)` selector
- `UserRegistry.json` — `owner(label)` view
- `VerifiableFactory.json` — `getAddress(node)` view
- `PermissionedResolver.json` — `getResolver(node)` view

### `src/ens/tests/`
- `preflight.test.ts` — preflight check structure and assertions
- `register.test.ts` — single/subname registration + idempotency
- `resolve.test.ts` — resolution via Universal Resolver

---

## 5. Role Setup (One-time, offline)

The agent key must have these roles on the subregistry's `ROOT_RESOURCE`:

```
ROLE_REGISTRAR      = 1n << 0n   (bit 0)
ROLE_RENEW          = 1n << 16n  (bit 16)
```

The deployer/owner key must **not** be in `.env`. It is used offline to:
1. Initialise the subregistry (if needed)
2. Grant `ROLE_REGISTRAR` + `ROLE_RENEW` to the agent key
3. Grant `ROLE_SET_ADDR` on the PermissionedResolver (if needed)

**Emergency revocation script** (run offline):
```bash
# Revoke the agent's roles on the subregistry
cast revokeRootRoles ROLE_REGISTRAR + ROLE_RENEW <subregistry> <agent_key>
```

---

## 6. Contract Addresses (Sepolia, post-2026-10-01)

| Address | Meaning |
|---|---|
| `0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4` | Parent ENS registry |
| `0x9407F49851A8CA985123Fc5b1BeCab1aAbAf7313` | Subregistry (UserRegistry proxy) |
| `0x9BD8a88719068D09ecee662f36C0E3856708366a` | UserRegistry implementation |
| `0xDa70306C98E97eCe36F997a21368e53298572991` | VerifiableFactory |
| `0xE65DC3a39fCC4f75940CaFf0D4B10D6441672e43` | Parent's owned resolver |

Subnames:
- `ramu.dabbawala.eth` → owner: `0x8438A07f75ebd1aBFfd241b41c77f3DA26c36734`
- `janu.dabbawala.eth` → owner: `0x993B0873713315C820F1744e4533f5b0E719407B`
- `sakhu.dabbawala.eth` → owner: `0x649A0f18586b42E7f2E53486A4aCF9536E2e5917`

---

## 7. Security Notes

- **Never commit `AGENT_PRIVATE_KEY`** — it enables subname registration.
- The deployer/owner key is **offline**; never in `.env`.
- Rate limiting: 10 requests/minute per IP on `POST /subnames`.
- **Never log private keys** — the server struct logs omit secret values.
- If compromised, revoke roles using the emergency script above.
- Least privilege: agent holds only `ROLE_REGISTRAR` + `ROLE_RENEW` + `ROLE_SET_RESOLVER` on subregistry.

---

## 8. Known Limitations

- Full Sepolia connectivity required for live registration (pre-flight checks need RPC).
- The 0G Storage SDK (`@0gfoundation/0g-storage-ts-sdk`) is [not published to npm](R-0G-2, F10); this project uses a ported adapter.
- Role assignments are final at registration time; cannot be changed later without revoking and re-registering.
- Idempotency is best-effort: re-registering to the **same** owner is detected via `ownerOf` lookup.

---

## 9. Additional Files Created

| File | Purpose |
|---|---|
| `src/ens/config.ts` | Configuration & viem client |
| `src/ens/preflight.ts` | Pre-flight checks + assertions |
| `src/ens/registrar.ts` | Single + batch subname registration |
| `src/server.ts` | HTTP `POST /subnames` endpoint |
| `abis/PermissionedRegistry.json` | `register(...)` ABI |
| `abis/UserRegistry.json` | `owner(label)` view ABI |
| `abis/VerifiableFactory.json` | `getAddress(node)` view ABI |
| `abis/PermissionedResolver.json` | `getResolver(node)` view ABI |
| `src/ens/tests/preflight.test.ts` | Preflight test suite |
| `src/ens/tests/register.test.ts` | Registration + idempotency tests |
| `src/ens/tests/resolve.test.ts` | Resolution structure tests |
| `HEDERA_TASKS.md` | Hedera x402 task tracking |
| `tasks.md` | Overall task tracking |
| `ENSv2_SUBNAME_REGISTRATION_README.md` | This README |

---
*This implementation follows AGENTS.md, REFERENCES.md, and ROADMAP.md. 
All addresses and ABIs are verified against the Sepolia post-2026-10-01 redeploy.*