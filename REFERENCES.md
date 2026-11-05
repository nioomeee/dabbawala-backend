# REFERENCES.md — Verified sources for the Dabbawala Protocol

> **Purpose:** the only place the agent may take external facts from. If a fact is not here, it is not allowed to be assumed.
> **Companions:** `ROADMAP.md` (what to build) · `AGENTS.md` (how to behave).
> **Owner:** the human pastes links into the `PASTE` zones. The agent may **add** entries after reading an official page, but must never delete or silently change an existing one.

---

## 0. Rules for using this file

1. **Look here first.** Before using any external API, SDK, package, contract, function name, endpoint, env var, address, chain id or fee, find its entry here. Cite the reference id (for example `R-ENS-2`) in a code comment or in `docs/PROGRESS.md`.
2. **Not listed means unknown.** Stop. Fetch the official page, read it, add an entry with the URL, the date and a short summary of what you relied on. Then continue. If you cannot find an official source, write it in `docs/OPEN_QUESTIONS.md` and ask the human.
3. **Never invent:** addresses, ABIs, package names, package versions, function signatures, role names, header names, endpoints, chain ids, token ids, faucet URLs, environment variable names, or API parameters.
4. **Verify packages exist** (`npm view <pkg> version`, or the repo's own manifest) before installing. Pin exact versions. Record them in section 9.
5. **Official page beats this file.** If a live official page contradicts an entry, follow the page, mark the entry `STALE` and log it in `docs/DECISIONS.md`.
6. **Secondary sources** (blogs, news, social posts) may explain context but can never justify a technical decision on their own.
7. Re-verify anything marked `HYPOTHESIS` or `UNKNOWN` in the matching spike, then update its status here.

**Evidence tags:** `VERIFIED` read on an official page or proven by a test you ran · `INTERPRETATION` a reading of official text · `HYPOTHESIS` needs a spike · `UNKNOWN` not found · `STALE` contradicted by a newer official page · `SECONDARY` not an official source.

Dates below: `10/25-26` means read during the Master Evaluation on Oct 25–26, 2026 (re-verify at spike time).

---

## 1. Hackathon rules and prizes

| ID | Title | URL | Used for | Status | Verified |
|---|---|---|---|---|---|
| R-HK-1 | ETHGlobal Mumbai prizes (overview) | https://ethglobal.com/events/mumbai/prizes | Prize list, amounts, eligibility | VERIFIED | 10/25-26 |
| R-HK-2 | 0G prize page | https://ethglobal.com/events/mumbai/prizes/0g | Physical AI requirements, "not wanted" list, submission items | VERIFIED | 10/25-26 |
| R-HK-3 | Hedera prize page | https://ethglobal.com/events/mumbai/prizes/hedera | x402 requirements, extra-points list | VERIFIED | 10/25-26 |
| R-HK-4 | ENS prize page | https://ethglobal.com/events/mumbai/prizes/ens | ENSv2 requirements | VERIFIED | 10/25-26 |
| R-HK-5 | World prize page | https://ethglobal.com/events/mumbai/prizes/world | Optional swap-rule track only | VERIFIED | 10/25-26 |
| R-HK-6 | Chainlink prize page | https://ethglobal.com/events/mumbai/prizes/chainlink | Context only (not a target) | VERIFIED | 10/25-26 |
| R-HK-7 | ETHGlobal Mumbai rules, deadline, video and AI guidelines | https://ethglobal.com/events/mumbai/info/details | Deadline, 3-prize cap, from-scratch rule, video rules, AI disclosure | VERIFIED | 10/25-26 |

**Read before H0:** R-HK-1, R-HK-2, R-HK-3, R-HK-4, R-HK-7.

### Key facts (from R-HK-*)
- A submission may select **up to 3 partner prizes**; several tracks of one partner count as one. *(R-HK-7)*
- Deadline **Saturday Nov 7, 2026, 09:00 IST**. Secondary sources saying Nov 8 are wrong. Hacking start time is **UNKNOWN** until the Hacker Dashboard shows it. *(R-HK-7)*
- Classic from-scratch track: prior project-specific code, designs or assets are not allowed; spec-driven planning artifacts must be included in the repo. *(R-HK-7)*
- Video: ETHGlobal rejects under 2:00 or over 4:00; 0G requires under 3:00; no speed-up, no phone recording, no AI voiceover, 720p minimum. *(R-HK-7, R-HK-2)*
- 0G Physical AI: requires a 0G call in the decision loop, an episode log on 0G Storage with a request id per decision, a replayable simulation, a safe-stop fallback, and contract deployment addresses. A fallback that fakes the decision disqualifies. Not wanted: a chatbot with a robot avatar, pre-recorded motion, 0G used only for logs. The $1K place is for real hardware, so a simulation can win first or second only. Paid at 0G's discretion. *(R-HK-2)*
- Hedera x402: an x402-protected endpoint settling on Hedera via a listed or self-run facilitator; an agent completing at least one paid request with no human approving; README with the **Hedera transaction id**; video of 5 minutes or less with a HashScan link. Extra points: spending controls, HCS audit log, agent identity, HTS settlement. *(R-HK-3)*
- ENSv2: built on ENSv2 on Ethereum mainnet or Sepolia; ENSv2 central; functional, not hard-coded; live demo link; open source. The page singles out Enhanced Access Control for field-scoped edits and rewards agents as namespaces. *(R-HK-4)*

---

## 2. 0G (Compute, Storage, Chain)

| ID | Title | URL | Used for | Status | Verified |
|---|---|---|---|---|---|
| R-0G-1 | 0G Router: verifiable execution | https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/features/verifiable-execution | `verify_tee`, `ZG-Res-Key` header, request id | VERIFIED | 10/25-26 |
| R-0G-2 | 0G Storage SDK | https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk | Upload, root hash | VERIFIED | 10/25-26 |
| R-0G-3 | zerobot (0G Foundation) | https://github.com/0gfoundation/zerobot | Mock robot, RobotRegistry pattern, Galileo targeting | VERIFIED | 10/25-26 |
| R-0G-4 | 0G docs home | https://docs.0g.ai | Navigation, chain and faucet pages | VERIFIED | 10/25-26 |
| R-0G-5 | 0G Compute models | https://pc.0g.ai/models | Choosing a model id | VERIFIED (page existed); contents change | 10/25 |

**Read before H0:** R-0G-1, R-0G-2, R-0G-3.

### Facts
- The 0G Router is an **OpenAI-compatible** API at `router-api.0g.ai/v1`. Setting `verify_tee: true` asks the Router to check the provider's TEE signature. The id used for verification comes from the **`ZG-Res-Key`** response header. Store it as the decision's request id. *(R-0G-1; VERIFIED 10/25-26, re-check header casing in S-0G)*
- Storage upload involves an on-chain transaction and a Merkle root from the TypeScript SDK. Latency is **HYPOTHESIS**. Write logs locally during the run and upload at the end, never inside the checkpoint loop. *(R-0G-2)*
- zerobot targets Unitree Go2 on 0G Galileo testnet and ships a mock robot. It has RobotRegistry and RobotCommandDispatcher contracts and an AIBroker using 0G Compute. *(R-0G-3)*
- Whether 0G Storage objects can be access-restricted is **UNKNOWN**. Treat every episode file as public and permanent.

---

## 3. Hedera x402

| ID | Title | URL | Used for | Status | Verified |
|---|---|---|---|---|---|
| R-HE-1 | Hedera x402 overview | https://docs.hedera.com/solutions/ai/x402 | Concepts, package status | VERIFIED | 10/25-26 |
| R-HE-2 | x402 facilitators | https://docs.hedera.com/solutions/ai/x402/facilitators | Facilitator list, testnet endpoints | VERIFIED | 10/25-26 |
| R-HE-3 | Pay with x402 | https://docs.hedera.com/solutions/ai/x402/pay-with-x402 | Client-side payment flow | VERIFIED | 10/25-26 |
| R-HE-4 | Exact scheme spec | https://docs.hedera.com/solutions/ai/x402/exact-scheme | Payment requirement fields, signing | VERIFIED (confirm field names in S-X402) | 10/25-26 |
| R-HE-5 | AI Studio on Hedera: x402 | https://docs.hedera.com/hedera/open-source-solutions/ai-studio-on-hedera/x402 | Alternate overview | VERIFIED | 10/25 |
| R-HE-6 | r402-hedera crate docs | https://docs.rs/crate/r402-hedera/latest | Cross-check of the exact scheme (fee payer model) | SECONDARY | 10/25 |

**Read before H0:** R-HE-1, R-HE-2, R-HE-3, R-HE-4.

### Facts
- Listed facilitators: **Official x402** at `x402.org/facilitator` (testnet) and **Blocky402** at `api.testnet.blocky402.com`. Both have open access with no API key. Ax402 is also listed. Configure two and fail over. *(R-HE-2)*
- In the exact scheme the **buyer signs** and a **facilitator fee payer submits** the transaction, so the robot needs no HBAR for fees. *(R-HE-1, R-HE-6)*
- Testnet USDC example asset is `0.0.6001` with **6 decimals**. If association or funding costs more than an hour, settle in HBAR, which the track also allows. *(R-HE-2; confirm in S-X402)*
- **`@x402/hedera` was documented as NOT published to npm.** Build it from the x402 monorepo source, or write the exact-scheme signer yourself with the Hiero SDK (allow 2–3 hours). This page may have changed, so check first. *(R-HE-1)*
- Exact payment-requirement field names, header names and signing bytes: read R-HE-4 and the monorepo source. **Do not write them from memory.**

---

## 4. ENSv2

| ID | Title | URL | Used for | Status | Verified |
|---|---|---|---|---|---|
| R-ENS-1 | ENSv2 overview | https://docs.ens.domains/ensv2/overview | Concepts, deployments | VERIFIED | 10/25 |
| R-ENS-2 | Permissioned Resolver | https://docs.ens.domains/ensv2/permissioned-resolver | Roles, scoping, per-resolver proxies | VERIFIED | 10/25-26 |
| R-ENS-3 | Enhanced Access Control | https://docs.ens.domains/ensv2/enhanced-access-control | Role model, per-record roles | VERIFIED | 10/25-26 |
| R-ENS-4 | Permissioned Registry | https://docs.ens.domains/ensv2/permissioned-registry | Registry roles | VERIFIED | 10/25 |
| R-ENS-5 | Registry hierarchy | https://docs.ens.domains/ensv2/registry-hierarchy | Parent and subname structure | VERIFIED | 10/25 |
| R-ENS-6 | Tutorial for app developers | https://docs.ens.domains/ensv2/tutorial-app-developers | Reading names from an app | VERIFIED | 10/25 |
| R-ENS-7 | Contract docs: Permissioned Resolver | https://docs.ens.domains/contracts/ensv2/permissioned-resolver | Function signatures and errors | VERIFIED | 10/25 |
| R-ENS-8 | ENSIP-26 (agent text records) | https://docs.ens.domains/ensip/26/ | `agent-context`, `agent-endpoint[web]` | VERIFIED (**draft**) | 10/25-26 |

**Read before H0:** R-ENS-1, R-ENS-2, R-ENS-3, R-ENS-7, R-ENS-8.

### Facts
- Each account gets its **own resolver proxy**. `grantRoles()` is **disabled** on it. Use `grantRootRoles` for resolver-wide roles and `grantSetterRoles(setter, account)` to scope a role to one text key. *(R-ENS-2)*
- **There is no per-name scoping.** A role on a resolver applies to every name that resolver serves. Give each robot its own resolver instance. *(R-ENS-2)*
- `setText` for a key you hold no role for reverts with `EACUnauthorizedAccountRoles`. *(R-ENS-2)*
- A `ROLE_LINK` holder can relink a name and a `ROLE_UPGRADE` holder can replace the implementation. **Never** give either to the safety officer or a robot. *(R-ENS-2)*
- ENSIP-26 is a draft. Treat its record keys as provisional. *(R-ENS-8)*
- Whether you can register a name and deploy resolver proxies on Sepolia within hours, and which viem version resolves them, is a **HYPOTHESIS** for S-ENS. Deployment addresses and factory addresses: paste in section 8; do not guess.

---

## 5. Human approval (optional, swap rule only)

| ID | Title | URL | Used for | Status | Verified |
|---|---|---|---|---|---|
| R-WO-1 | World ID docs | https://auth.world.org/docs | Auth setup (only if the swap rule triggers) | VERIFIED | 10/25 |
| R-WO-2 | World human-in-the-loop guide | https://auth.world.org/docs/guides/human-in-the-loop | Fresh auth, binding approvals to an action | VERIFIED | 10/25-26 |

### Facts
- World authenticates a **human**. It does **not** approve your business action. Your app must store the pending action, request fresh authentication (`max_age=0` or `prompt=login`), check that `(iss, sub)` matches the awaiting account, check `auth_time`, `acr` and `amr`, collect approval of the exact action itself, and publish once. *(R-WO-2)*
- Proofs are currently **mocked** with fake identities. Never claim real identity assurance. *(R-WO-2)*
- World is **not a prize target**. Default approver auth is an in-app allowlist per zone.

---

## 6. Prior art (cite honestly; never claim "first" or "only")

| ID | Project | URL | Status | What it is | Relevance |
|---|---|---|---|---|---|
| R-PA-1 | Hands Unchained (ETHGlobal Lisbon 2026) | https://github.com/grmkris/eth-global-lisbon-2026-hands-unchained | VERIFIED (README read) | Humans teleoperate real arms and sims; World ID slot gate; 0G Compute TEE referee; EpisodeRegistry on 0G; Hedera payouts; HCS topic. Finalist status UNVERIFIED | Closest overlap. Do **not** reuse the name `EpisodeRegistry` |
| R-PA-2 | zerobot | https://github.com/0gfoundation/zerobot | VERIFIED | See R-0G-3 | Reuse the mock robot if it saves hours; say why ENS is better than a registry |
| R-PA-3 | OpenMind + Circle robot dog | https://blockeden.xyz/de/blog/2026/05/02/openmind-circle-usdc-robot-payments-machine-economy/ | SECONDARY | Robot dog paid a charging station in USDC over x402 | Do not call robots paying over x402 new |
| R-PA-4 | RoboBazaar | https://lablab.ai/u/@swign_yzc689 | SECONDARY | Self-described: robots hire humans over x402 on Base in a Webots sim | Payment-only demos are common |
| R-PA-5 | Paybot (ETHGlobal Buenos Aires 2025) | https://www.techflowpost.com/en-US/article/29271 | SECONDARY | Listed as a winner: x402 controlling access to physical devices | Physical plus payment resonates |
| R-PA-6 | World AgentKit coverage | https://forklog.com/en/world-unveils-agentkit-for-identity-verification-in-the-agent-internet/ | SECONDARY | Proves a unique human stands behind an agent | Identity is not authority |

**Unverified names from the original brief (do not cite):** Trinity Guardian, Verifiable Blackbox. No primary source found.

---

## 7. Tooling (Antigravity and the build environment)

| ID | Title | URL | Status | Notes |
|---|---|---|---|---|
| R-TL-1 | Antigravity rules locations (CoinGecko docs) | https://docs.coingecko.com/docs/ai-agent-hub/antigravity | SECONDARY | `AGENTS.md` in the project root is read by Antigravity and other tools; `GEMINI.md` is Antigravity-only and takes precedence; `~/.gemini/AGENTS.md` is global |
| R-TL-2 | Antigravity rules guide | https://thepromptshelf.dev/blog/google-antigravity-agents-md-rules-guide-2026 | SECONDARY | Reports a **12,000-character cap per rules file** and a `.agents/rules/` folder. Verify in your Antigravity UI |

**Do not assume** Antigravity features beyond what the human confirms in their own UI.

---

## 8. PASTE ZONE — human fills these; the agent must never guess them

Fill each line. Leave `PASTE_HERE` if unknown. The agent must refuse to proceed on a task that needs a `PASTE_HERE` value until the human fills it or approves a spike to find it.

### 8.1 Networks and endpoints
| Item | Value | Source URL | Pasted by / date |
|---|---|---|---|
| Sepolia RPC URL (no keys in this file; name the env var only) | PASTE_HERE | | |
| 0G Galileo testnet: chain id | PASTE_HERE | | |
| 0G Galileo testnet: RPC URL | PASTE_HERE | | |
| 0G Galileo explorer URL | PASTE_HERE | | |
| 0G Galileo faucet URL | PASTE_HERE | | |
| 0G Storage indexer / node endpoints | PASTE_HERE | | |
| 0G Router: how to create an API key and credits | PASTE_HERE | | |
| 0G Router: chosen model id for decisions | PASTE_HERE | https://pc.0g.ai/models | |
| Hedera testnet Mirror Node base URL | PASTE_HERE | | |
| HashScan testnet base URL | PASTE_HERE | | |
| Hedera testnet faucet URL | PASTE_HERE | | |
| Hiero / Hedera JS SDK docs URL and exact package name | PASTE_HERE | | |

### 8.2 Code and contracts
| Item | Value | Source URL | Pasted by / date |
|---|---|---|---|
| x402 monorepo URL (build `@x402/hedera` from here) | PASTE_HERE (an unverified guess is `github.com/coinbase/x402`; confirm before use) | | |
| Exact-scheme Hedera client path inside the monorepo | PASTE_HERE | | |
| ENSv2 Sepolia deployments page / addresses (registry, factory) | PASTE_HERE | | |
| ENS Verifiable Factory address on Sepolia | PASTE_HERE | | |
| viem version that resolves ENSv2 names | PASTE_HERE | | |
| Permissioned Resolver ABI source | PASTE_HERE | | |
| Parent ENS name chosen and registered | PASTE_HERE | | |
| Hedera HCS topic id for spend logs | PASTE_HERE (created during the build) | | |
| RelayLedger address on 0G Galileo | PASTE_HERE (created during the build) | | |

### 8.3 Anything else the agent asks for
Add rows here when the agent writes a question in `docs/OPEN_QUESTIONS.md`.

---

## 9. Pinned versions (the agent fills this as it installs)

| Package or tool | Exact version | Verified exists (command + date) | Reason | Ref id |
|---|---|---|---|---|
| node | | | | |
| pnpm | | | | |
| foundry (forge) | | | | |
| viem | | | | |
| zod | | | | |
| @hiero-ledger/sdk or hedera sdk (confirm name from R-HE-*) | | | | |
| 0G SDKs (confirm names from R-0G-2) | | | | |

---

## 10. Facts register (claims from the Master Evaluation; re-verify at the listed moment)

| # | Claim | Status | Source | Re-verify |
|---|---|---|---|---|
| F1 | Up to 3 partner prizes per submission | VERIFIED | R-HK-7 | P-1 |
| F2 | Deadline Sat Nov 7, 2026, 09:00 IST | VERIFIED | R-HK-7 | Start of event |
| F3 | Event dates Nov 5–7 per official tweets; start time unknown | INTERPRETATION | R-HK-7 | P-1 |
| F4 | Video 2:00–4:00 (ETHGlobal), under 3:00 (0G), 720p+, real voice, no speed-up | VERIFIED | R-HK-7, R-HK-2 | R-5 |
| F5 | 0G fallback that fakes a decision disqualifies | VERIFIED | R-HK-2 | Always |
| F6 | Simulated builds can win 0G Physical AI first or second only | VERIFIED | R-HK-2 | Always |
| F7 | Permissioned Resolver has no per-name scoping | VERIFIED | R-ENS-2 | S-ENS |
| F8 | `grantRoles()` disabled; use `grantRootRoles` and `grantSetterRoles` | VERIFIED | R-ENS-2 | S-ENS |
| F9 | Unauthorized `setText` reverts with `EACUnauthorizedAccountRoles` | VERIFIED | R-ENS-2 | S-ENS |
| F10 | `@x402/hedera` not yet on npm | VERIFIED (may have changed) | R-HE-1 | S-X402 |
| F11 | Official x402 and Blocky402 testnet facilitators need no API key | VERIFIED | R-HE-2 | S-X402 |
| F12 | Testnet USDC `0.0.6001`, 6 decimals | VERIFIED | R-HE-2 | S-X402 |
| F13 | Buyer signs; facilitator fee payer submits | VERIFIED | R-HE-1, R-HE-6 | S-X402 |
| F14 | 0G Router is OpenAI-compatible; `verify_tee: true`; id from `ZG-Res-Key` | VERIFIED | R-0G-1 | S-0G |
| F15 | 0G Storage upload latency | UNKNOWN | R-0G-2 | S-0G |
| F16 | Whether 0G Storage can be access-restricted | UNKNOWN | R-0G-2 | S-0G |
| F17 | Whether the facilitator or the server rejects a reused payment header | HYPOTHESIS | R-HE-4 | S-X402 |
| F18 | ENSIP-26 is a draft | VERIFIED | R-ENS-8 | S-ENS |
| F19 | World proofs are mocked; World does not approve business actions | VERIFIED | R-WO-2 | Only if swap rule triggers |
| F20 | Antigravity reads project-root `AGENTS.md`; `GEMINI.md` takes precedence | SECONDARY | R-TL-1 | Human checks UI |
| F21 | Antigravity rules files capped at 12,000 characters | SECONDARY | R-TL-2 | Human checks UI |
| F22 | Hands Unchained overlaps the sponsor stack; finalist status unverified | VERIFIED (repo) / UNVERIFIED (finalist) | R-PA-1 | R-1 |

---

## 11. Known traps (do not fall into these)

- Treating an ENS text record as **enforcement**. It is data. The Spend Controller enforces.
- Putting any payment key in the robot or Fleet Brain process.
- Sharing one resolver across robots and expecting per-robot isolation.
- Writing x402 field names or Hedera header names from memory.
- Assuming `@x402/hedera` is on npm.
- Using `EpisodeRegistry` as the contract name.
- Caching a "last good decision" or adding a local model as a fallback for 0G.
- Treating the model's JSON as trusted, or letting route-intel text act as instructions.
- Writing "first", "only" or "novel" in the README.
- Uploading an episode log that contains a key, a personal id or a prompt with secrets.
- Citing Trinity Guardian or Verifiable Blackbox.
- Believing a secondary source over an official page.

---

## 12. Changelog
| Date | Who | Change |
|---|---|---|
| 2026-10-26 | Initial | Created from the Master Evaluation and the ETHGlobal prize pages |
