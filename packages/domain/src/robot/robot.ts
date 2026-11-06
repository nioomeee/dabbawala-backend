/**
 * Domain: Robot aggregate root
 *
 * The robot domain object encapsulates identity, state machine, and halting.
 * It holds NO payment keys. ref: ROADMAP.md §4.3 invariant 1, AGENTS.md §7.1
 */

import type { RobotId, HaltReason } from "@dabbawala/shared";

export type RobotStatus = "idle" | "running" | "halted" | "delivered";

export type RobotState = {
  readonly id: RobotId;
  readonly status: RobotStatus;
  readonly currentCell: string;
  readonly checkpointIndex: number;
  readonly haltReason?: HaltReason;
  readonly haltDetail?: string;
  readonly lastPolicyBlock?: bigint;
  readonly lastPolicyHash?: string;
  readonly updatedAtMs: number;
};

/** Create initial robot state. */
export function createRobot(id: RobotId, startCell: string): RobotState {
  return {
    id,
    status: "idle",
    currentCell: startCell,
    checkpointIndex: 0,
    updatedAtMs: Date.now(),
  };
}

/** Transition robot to running. */
export function startRobot(robot: RobotState): RobotState {
  if (robot.status !== "idle") {
    throw new Error(`Robot ${robot.id} cannot start from status ${robot.status}`);
  }
  return { ...robot, status: "running", updatedAtMs: Date.now() };
}

/** Halt the robot with a reason code. ref: ROADMAP.md §4.4, invariant §4.3.4 */
export function haltRobot(
  robot: RobotState,
  reason: HaltReason,
  detail?: string,
): RobotState {
  return {
    ...robot,
    status: "halted",
    haltReason: reason,
<<<<<<< HEAD
    haltDetail: detail as HaltReason | undefined, // exactOptionalPropertyTypes requires explicit union
=======
    haltDetail: detail,
>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf
    updatedAtMs: Date.now(),
  };
}

/**
 * Resume a halted robot ONLY after a fresh 0G success and a fresh policy read.
 * ref: ROADMAP.md §4.3 invariant 5
 */
export function resumeRobot(
  robot: RobotState,
  newPolicyBlock: bigint,
  newPolicyHash: string,
): RobotState {
  if (robot.status !== "halted") {
    throw new Error(`Robot ${robot.id} is not halted; cannot resume`);
  }
<<<<<<< HEAD
  const { haltReason, haltDetail } = robot;
  return {
    ...robot,
    status: "running",
    haltReason: haltReason,
    haltDetail: haltDetail,
=======
  return {
    ...robot,
    status: "running",
    haltReason: undefined,
    haltDetail: undefined,
>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf
    lastPolicyBlock: newPolicyBlock,
    lastPolicyHash: newPolicyHash,
    updatedAtMs: Date.now(),
  };
}

/** Advance the robot to the next checkpoint. */
export function advanceCheckpoint(robot: RobotState, newCell: string): RobotState {
  return {
    ...robot,
    currentCell: newCell,
    checkpointIndex: robot.checkpointIndex + 1,
    updatedAtMs: Date.now(),
  };
}

/** Mark the robot as delivered. */
export function deliverRobot(robot: RobotState): RobotState {
  return { ...robot, status: "delivered", updatedAtMs: Date.now() };
}

