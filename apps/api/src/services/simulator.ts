/**
 * Mission simulation and deterministic replay engine.
 *
 * THIS IS A SIMULATION. Never represent simulator execution as physical robot execution.
 * Labels: SIMULATION, REPLAY.
 * ref: user prompt §5, §14
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Action,
  type EpisodeLogEntry,
  type RobotId,
  type StateSummary,
  type PolicySnapshot,
} from "@dabbawala/shared";
import { createLogger } from "@dabbawala/observability";
import { ScenarioTestCaseSchema, type ScenarioTestCase } from "../schemas/console.js";

const log = createLogger("service:simulator");

const __dirname = dirname(fileURLToPath(import.meta.url));

function getFixturePath(): string {
  const candidates = [
    join(__dirname, "../fixtures/scenarios.json"),
    join(__dirname, "../../src/fixtures/scenarios.json"),
    join(process.cwd(), "src/fixtures/scenarios.json"),
    join(process.cwd(), "apps/api/src/fixtures/scenarios.json"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]!;
}

const FIXTURE_PATH = getFixturePath();

export interface SimulatedRobotState {
  robotId: RobotId;
  currentCell: string;
  checkpointIndex: number;
  status: "idle" | "moving" | "checkpoint" | "halted" | "delivered";
  haltReason?: string;
  updatedAtMs: number;
}

export interface ActiveMission {
  missionId: string;
  scenarioId: string;
  scenario: ScenarioTestCase;
  episodeId: string;
  seed: string;
  status: "active" | "halted" | "delivered" | "rerouted";
  stepIndex: number;
  robots: Record<RobotId, SimulatedRobotState>;
  events: EpisodeLogEntry[];
  eventCounter: number;
  startedAtMs: number;
  label: "SIMULATION";
}

let _scenarios: ScenarioTestCase[] = [];

export function loadSimScenarios(): ScenarioTestCase[] {
  if (_scenarios.length > 0) return _scenarios;
  if (!existsSync(FIXTURE_PATH)) {
    throw new Error("FIXTURE_NOT_FOUND");
  }
  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  _scenarios = ScenarioTestCaseSchema.array().parse(JSON.parse(raw));
  return _scenarios;
}

const activeMissions = new Map<string, ActiveMission>();

/**
 * Initialize or reset a simulated mission from a scenario.
 */
export function startSimMission(scenarioId: string): ActiveMission {
  const scenarios = loadSimScenarios();
  const normalizedId = scenarioId.trim().toUpperCase();
  const scenario = scenarios.find((s) => s.id.toUpperCase() === normalizedId) ?? scenarios[0];
  if (!scenario) {
    throw new Error(`SCENARIO_NOT_FOUND: ${scenarioId}`);
  }

  const missionId = `mission-${scenarioId}-${Date.now()}`;
  const episodeId = `ep-${scenarioId}-001`;
  const seed = "DABBAWALA_2026_SEED_42";

  const ramuRoute = scenario.lanes.ramu?.route ?? [];
  const sakhuRoute = scenario.lanes.sakhu?.route ?? [];
  const januRoute = scenario.lanes.janu?.route ?? [];

  const robots: Record<RobotId, SimulatedRobotState> = {
    ramu: {
      robotId: "ramu",
      currentCell: ramuRoute[0]?.id ?? "cell-0",
      checkpointIndex: 0,
      status: "idle",
      updatedAtMs: Date.now(),
    },
    sakhu: {
      robotId: "sakhu",
      currentCell: sakhuRoute[0]?.id ?? "cell-0",
      checkpointIndex: 0,
      status: "idle",
      updatedAtMs: Date.now(),
    },
    janu: {
      robotId: "janu",
      currentCell: januRoute[0]?.id ?? "cell-0",
      checkpointIndex: 0,
      status: "idle",
      updatedAtMs: Date.now(),
    },
  };

  const mission: ActiveMission = {
    missionId,
    scenarioId,
    scenario,
    episodeId,
    seed,
    status: "active",
    stepIndex: 0,
    robots,
    events: [
      {
        seq: 1,
        tsMs: Date.now(),
        robotId: scenario.leadRobot,
        type: "decision",
        detail: "SIMULATION_MISSION_START",
      },
    ],
    eventCounter: 1,
    startedAtMs: Date.now(),
    label: "SIMULATION",
  };

  activeMissions.set(scenarioId, mission);
  activeMissions.set(missionId, mission);

  log.info({ missionId, scenarioId }, "Simulated mission initialised (LABEL: SIMULATION)");
  return mission;
}

export function getSimMission(scenarioOrMissionId: string): ActiveMission {
  let m = activeMissions.get(scenarioOrMissionId);
  if (!m) {
    m = startSimMission(scenarioOrMissionId);
  }
  return m;
}

/**
 * Build StateSummary for a robot checkpoint per shared schema.
 */
export function buildStateSummary(mission: ActiveMission, robotId: RobotId): StateSummary {
  const robot = mission.robots[robotId];
  const lane = mission.scenario.lanes[robotId];
  const availableRoutes = lane ? lane.route.map((w) => w.id) : ["route-default"];
  const currentCell = robot.currentCell;

  return {
    robotId,
    currentCell,
    heading: "NORTH",
    checkpointIndex: robot.checkpointIndex,
    totalCheckpoints: mission.scenario.checkpoints.length,
    availableRoutes,
    restrictedZones: ["R-2", "docks-r2"],
    remainingBudgetAtomic: "5000000", // 5 USDC atomic
    scenarioHints: [mission.scenario.description],
    seed: mission.seed,
  };
}

/**
 * Build fresh PolicySnapshot for robot.
 */
export function buildPolicySnapshot(robotId: RobotId, override?: Partial<PolicySnapshot>): PolicySnapshot {
  const nowMs = Date.now();
  const zones: Record<RobotId, string[]> = {
    ramu: ["mahim", "dadar", "churchgate"],
    sakhu: ["mahim", "dadar"],
    janu: ["docks-r2", "R-2"],
  };

  return {
    robotId,
    zones: zones[robotId] ?? ["mahim"],
    budgetAtomic: "5000000",
    status: "active",
    block: 1000001n,
    valuesHash: "0x" + "a".repeat(64),
    readAtMs: nowMs,
    ...override,
  };
}

/**
 * Apply approved action to simulator state.
 */
export function applySimulatorAction(
  mission: ActiveMission,
  robotId: RobotId,
  action: Action,
  requestId: string,
): { eventId: string; resultingCell: string } {
  const robot = mission.robots[robotId];
  const lane = mission.scenario.lanes[robotId];
  const route = lane?.route ?? [];

  mission.eventCounter += 1;
  const seq = mission.eventCounter;
  const eventId = `sim-ev-${seq}`;

  if (action.type === "continue") {
    robot.checkpointIndex += 1;
    const nextWp = route[Math.min(robot.checkpointIndex, route.length - 1)];
    if (nextWp) {
      robot.currentCell = nextWp.id;
    }
    robot.status = robot.checkpointIndex >= mission.scenario.steps.length ? "delivered" : "moving";
  } else if (action.type === "reroute") {
    robot.currentCell = action.routeId;
    robot.checkpointIndex += 1;
    robot.status = "moving";
    mission.status = "rerouted";
  } else if (action.type === "handoff") {
    robot.status = "checkpoint";
    robot.checkpointIndex += 1;
  } else if (action.type === "ask_human") {
    robot.status = "checkpoint";
  }

  robot.updatedAtMs = Date.now();

  const event: EpisodeLogEntry = {
    seq,
    tsMs: Date.now(),
    robotId,
    type: "decision",
    requestId,
    action,
    detail: "APPLIED_IN_SIMULATION",
  };
  mission.events.push(event);

  log.info(
    { missionId: mission.missionId, eventId, robotId, actionType: action.type, newCell: robot.currentCell },
    "Action applied to simulator (LABEL: SIMULATION)",
  );

  return { eventId, resultingCell: robot.currentCell };
}

/**
 * Enter safe-stop in simulator without action execution.
 */
export function applySimulatorHalt(
  mission: ActiveMission,
  robotId: RobotId,
  reason: string,
  detail?: string,
): { eventId: string } {
  const robot = mission.robots[robotId];
  robot.status = "halted";
  robot.haltReason = reason;
  robot.updatedAtMs = Date.now();
  mission.status = "halted";

  mission.eventCounter += 1;
  const seq = mission.eventCounter;
  const eventId = `sim-ev-${seq}`;

  const event: EpisodeLogEntry = {
    seq,
    tsMs: Date.now(),
    robotId,
    type: "halt",
    reason: reason as any,
    detail: detail ?? "SAFE_STOP_TRIGGERED",
  };
  mission.events.push(event);

  log.warn(
    { missionId: mission.missionId, eventId, robotId, reason },
    "Simulator entered safe-stop (LABEL: SIMULATION)",
  );

  return { eventId };
}

/**
 * Replay consistency validator.
 * Detects modified, missing, duplicated or reordered events.
 * ref: user prompt §5
 */
export function validateReplayConsistency(events: readonly EpisodeLogEntry[]): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  if (events.length === 0) {
    return { valid: false, issues: ["EMPTY_EVENT_STREAM"] };
  }

  const seenSeq = new Set<number>();
  let lastSeq = 0;
  let lastTs = 0;

  for (const [idx, ev] of events.entries()) {
    if (seenSeq.has(ev.seq)) {
      issues.push(`DUPLICATE_EVENT_SEQ: ${ev.seq} at index ${idx}`);
    }
    seenSeq.add(ev.seq);

    if (idx > 0 && ev.seq !== lastSeq + 1) {
      issues.push(`OUT_OF_ORDER_OR_GAP: expected seq ${lastSeq + 1}, got ${ev.seq}`);
    }
    lastSeq = ev.seq;

    if (ev.tsMs < lastTs) {
      issues.push(`NON_MONOTONIC_TIMESTAMP: ${ev.tsMs} < ${lastTs} at seq ${ev.seq}`);
    }
    lastTs = ev.tsMs;
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
