# Dabbawala Protocol

### The accountability layer for autonomous missions.

**Dabbawala Protocol** is a mission-governance layer for autonomous agents. It enables AI-driven systems to operate within defined permissions, enforceable policies and verifiable execution boundaries.

AI agents can propose actions, but they should not have unrestricted authority to execute them. Dabbawala introduces a Policy Gate between AI decision-making and mission execution, ensuring that proposed actions are evaluated against operational constraints before execution.

Our goal is simple: **make autonomous actions accountable.**

---

## Overview

Dabbawala connects AI inference, policy enforcement, mission execution and evidence into a unified workflow.

```text
     Autonomous Agent
            │
            ▼
      AI Inference
       (0G Private Computer)
            │
            ▼
      Action Proposal
            │
            ▼
        Policy Gate
       ┌────┴────┐
       │         │
    APPROVED   DENIED
       │         │
       ▼         ▼
    Execution   Rejection
       │         │
       └────┬────┘
            ▼
      Mission Evidence
            │
            ▼
      Storage & Replay
```

### Core Components

- **Mission Orchestrator:** Coordinates mission lifecycle, state and decision checkpoints.
- **Policy Gate:** Evaluates AI-generated proposals against mission permissions and operational constraints.
- **AI Inference:** Uses 0G Private Computer to generate contextual action proposals.
- **Simulation & Replay:** Enables deterministic mission testing, failure scenarios and event reconstruction.
- **Evidence Layer:** Connects inference requests, policy decisions and execution outcomes.
- **On-chain Anchoring:** Uses RelayLedger to provide verifiable references to mission evidence.

## Ecosystem Integrations

Dabbawala is being developed with the following ecosystem technologies:

| Ecosystem | Integration | Purpose |
|---|---|---|
| **0G** | Private Computer | Contextual AI inference at mission decision checkpoints |
| **0G** | Storage | Mission evidence storage and retrieval |
| **Hedera** | x402 | Exploring agent-to-service payments and transaction-based interactions |
| **ENS** | ENSv2 | Exploring human-readable identities for autonomous agents and mission participants |

Additional integrations are evaluated based on their contribution to the core mission lifecycle.

## Design Principles

- **Bounded Authority:** AI proposals never grant themselves execution permission.
- **Policy-First Execution:** Actions must pass mission-level authorisation before execution.
- **Fail-Safe Behaviour:** Invalid decisions or unavailable dependencies must not silently bypass policy enforcement.
- **Verifiable Evidence:** Mission decisions and outcomes are recorded for inspection and replay.
- **Modular Architecture:** Inference, policy, execution and evidence remain independently extensible.

## Technology

`TypeScript` · `Node.js` · `pnpm` · `0G` · `Solidity` · `Foundry` · `Circom` · `SnarkJS`

## Project Status

Dabbawala Protocol is under active development as part of **ETHGlobal Mumbai 2026**.

The current development focuses on the mission decision lifecycle, 0G integration, policy enforcement, deterministic simulation and verifiable mission evidence.

Some ecosystem integrations and protocol capabilities remain under development. Their implementation and deployment status will be documented as they become available.

## Vision

As autonomous agents move from digital environments into the physical world, controlling what they are allowed to do becomes as important as what they are capable of doing.

Dabbawala aims to provide the infrastructure that connects AI decisions to authorised actions and accountable outcomes.

**No autonomous action without authority. No mission outcome without evidence.**

---

**Built for ETHGlobal Mumbai 2026.**
