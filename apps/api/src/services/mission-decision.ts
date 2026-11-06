/**
 * Mission Decision Checkpoint & Receipt Service.
 *
 * Enforces the core architectural invariant:
 * 0G Private Computer (proposes) -> Policy Gate (decides) -> Simulator (executes if approved)
 *
 * Terminal outcome labels:
 *   - APPLIED
 *   - DENIED
 *   - SAFE_STOP
 *
 * ref: user prompt §3, §4, §5, §6
 */

import { validateAction } from "@dabbawala/policy-engine";
import { type Action, type RobotId } from "@dabbawala/shared";
import { createLogger } from "@dabbawala/observability";
import { getZeroG } from "./zerog.js";
import {
  getSimMission,
  buildStateSummary,
  buildPolicySnapshot,
  applySimulatorAction,
  applySimulatorHalt,
  type ActiveMission,
} from "./simulator.js";

const log = createLogger("service:decision");

export interface MissionDecisionReceipt {
  readonly missionId: string;
  readonly episodeId: string;
  readonly checkpointId: string;
  readonly requestId: string | null;
  readonly recordId: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly latencyMs: number;
  readonly responseContentSha256: string | null;
  readonly proposedAction: Action | null;
  readonly policyVerdict: "APPROVED" | "DENIED" | "BLOCKED";
  readonly policyReason: string | null;
  readonly simulatorEventId: string | null;
  readonly resultingState: {
    readonly currentCell: string;
    readonly checkpointIndex: number;
    readonly status: string;
  };
  readonly finalOutcome: "APPLIED" | "DENIED" | "SAFE_STOP";
  readonly timestamp: number;
}

const decisionReceipts: MissionDecisionReceipt[] = [];

export function getDecisionReceipts(missionId?: string): readonly MissionDecisionReceipt[] {
  if (missionId) {
    return decisionReceipts.filter((r) => r.missionId === missionId);
  }
  return [...decisionReceipts];
}

export type ChallengeCondition =
  | "none"
  | "0g_unavailable"
  | "stale_telemetry"
  | "policy_denied"
  | "policy_paused";

export interface DecisionCheckpointOptions {
  scenarioId: string;
  robotId?: RobotId;
  challenge?: ChallengeCondition;
  injectedProposal?: Action;
}

/**
 * Execute a decision checkpoint:
 * 1. Build StateSummary from backend mission state.
 * 2. Get proposal from 0G Fleet Brain (or handle Halt).
 * 3. Validate proposal through the authoritative Policy Gate.
 * 4. Only if approved, apply action in simulator.
 * 5. If denied, do not modify simulator state.
 * 6. Record and return Mission Decision Receipt.
 */
export async function executeDecisionCheckpoint(
  opts: DecisionCheckpointOptions,
): Promise<{ receipt: MissionDecisionReceipt; mission: ActiveMission }> {
  const mission = getSimMission(opts.scenarioId);
  const robotId = opts.robotId ?? mission.scenario.leadRobot;
  const robot = mission.robots[robotId];
  const checkpoint = mission.scenario.checkpoints[robot.checkpointIndex] ?? {
    id: `cp-${robot.checkpointIndex}`,
    name: "Checkpoint",
  };
  const challenge = opts.challenge ?? "none";

  log.info(
    { scenarioId: opts.scenarioId, robotId, checkpointId: checkpoint.id, challenge },
    "Decision checkpoint triggered",
  );

  // 1. Build trusted StateSummary
  const stateSummary = buildStateSummary(mission, robotId);

  // 2. Obtain AI proposal or Halt
  const zeroG = getZeroG();

  let actionProposal: Action | null = null;
  let requestId: string | null = null;
  let recordId: string | null = null;
  let provider: string | null = null;
  let model: string | null = null;
  let latencyMs = 0;
  let responseContentSha256: string | null = null;
  let isHalted = false;
  let haltReason = "ZG_TRANSPORT";
  let haltDetail = "";

  if (challenge === "0g_unavailable" || !zeroG) {
    isHalted = true;
    haltReason = "ZG_TRANSPORT";
    haltDetail = challenge === "0g_unavailable" ? "INJECTED_CHALLENGE_0G_DOWN" : "0G_NOT_CONFIGURED";
  } else {
    const decision = await zeroG.brain.decideWithProvenance(stateSummary);
    recordId = decision.provenance.recordId;
    const lastAttempt = decision.provenance.attempts[decision.provenance.attempts.length - 1];
    provider = lastAttempt?.provider ?? null;
    model = lastAttempt?.modelReturned ?? lastAttempt?.modelRequested ?? null;
    latencyMs = lastAttempt?.latencyMs ?? 0;
    responseContentSha256 = decision.provenance.responseContentSha256;

    if ("halted" in decision.result) {
      isHalted = true;
      haltReason = decision.result.reason;
      haltDetail = decision.result.detail ?? "";
    } else {
      actionProposal = opts.injectedProposal ?? decision.result.action;
      requestId = decision.result.requestId;
    }
  }

  // Handle HALT / 0G Unavailable explicitly -> SAFE_STOP
  if (isHalted || !actionProposal) {
    const { eventId } = applySimulatorHalt(mission, robotId, haltReason, haltDetail);
    const receipt: MissionDecisionReceipt = {
      missionId: mission.missionId,
      episodeId: mission.episodeId,
      checkpointId: checkpoint.id,
      requestId,
      recordId,
      provider,
      model,
      latencyMs,
      responseContentSha256,
      proposedAction: null,
      policyVerdict: "BLOCKED",
      policyReason: haltReason,
      simulatorEventId: eventId,
      resultingState: {
        currentCell: robot.currentCell,
        checkpointIndex: robot.checkpointIndex,
        status: robot.status,
      },
      finalOutcome: "SAFE_STOP",
      timestamp: Date.now(),
    };
    decisionReceipts.push(receipt);
    return { receipt, mission };
  }

  // 3. Policy Gate Validation
  const nowMs = Date.now();
  let policyReadTimestamp = nowMs;
  let policyStatus: "active" | "paused" = "active";

  if (challenge === "stale_telemetry") {
    // Backdate policy read by 30 seconds (greater than 15s stale threshold)
    policyReadTimestamp = nowMs - 30_000;
  }
  if (challenge === "policy_paused") {
    policyStatus = "paused";
  }

  const freshPolicy = buildPolicySnapshot(robotId, {
    readAtMs: policyReadTimestamp,
    status: policyStatus,
    ...(challenge === "policy_denied" ? { zones: [] } : {}),
  });

  const gateVerdict = validateAction(actionProposal, freshPolicy, nowMs);

  if (!gateVerdict.valid) {
    // DENIED: Policy Gate rejected the proposal
    // Architectural invariant: Simulator state remains UNCHANGED
    const rejectionReason = gateVerdict.halt.reason + (gateVerdict.halt.detail ? `: ${gateVerdict.halt.detail}` : "");
    log.warn(
      { robotId, actionType: actionProposal.type, rejectionReason },
      "Policy Gate DENIED action proposal — simulator state unchanged",
    );

    const receipt: MissionDecisionReceipt = {
      missionId: mission.missionId,
      episodeId: mission.episodeId,
      checkpointId: checkpoint.id,
      requestId,
      recordId,
      provider,
      model,
      latencyMs,
      responseContentSha256,
      proposedAction: actionProposal,
      policyVerdict: "DENIED",
      policyReason: rejectionReason,
      simulatorEventId: null, // No execution occurred
      resultingState: {
        currentCell: robot.currentCell,
        checkpointIndex: robot.checkpointIndex,
        status: robot.status,
      },
      finalOutcome: "DENIED",
      timestamp: Date.now(),
    };
    decisionReceipts.push(receipt);
    return { receipt, mission };
  }

  // 4. APPROVED: Action executed by the simulator
  const { eventId } = applySimulatorAction(mission, robotId, gateVerdict.action, requestId ?? "req-local");

  const receipt: MissionDecisionReceipt = {
    missionId: mission.missionId,
    episodeId: mission.episodeId,
    checkpointId: checkpoint.id,
    requestId,
    recordId,
    provider,
    model,
    latencyMs,
    responseContentSha256,
    proposedAction: gateVerdict.action,
    policyVerdict: "APPROVED",
    policyReason: null,
    simulatorEventId: eventId,
    resultingState: {
      currentCell: robot.currentCell,
      checkpointIndex: robot.checkpointIndex,
      status: robot.status,
    },
    finalOutcome: "APPLIED",
    timestamp: Date.now(),
  };

  decisionReceipts.push(receipt);
  return { receipt, mission };
}
