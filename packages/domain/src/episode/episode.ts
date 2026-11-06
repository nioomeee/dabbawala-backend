/**
 * Domain: Episode aggregate
 *
 * Tracks the state of a robot's mission episode from start to verified anchor.
 * ref: ROADMAP.md §4.6, §B-3
 */

import type { EpisodeState, RobotId } from "@dabbawala/shared";

export type Episode = {
  readonly episodeId: string;
  readonly robotId: RobotId;
  readonly seed: string;
  readonly scenario: string;
  readonly startedAtMs: number;
  readonly state: EpisodeState;
  readonly rootHash?: string;
  readonly storageRef?: string;
  readonly relayLedgerAddress?: string;
  readonly anchorTxId?: string;
  readonly completedAtMs?: number;
};

/** Create a new episode. */
export function createEpisode(
  episodeId: string,
  robotId: RobotId,
  seed: string,
  scenario: string,
): Episode {
  return {
    episodeId,
    robotId,
    seed,
    scenario,
    startedAtMs: Date.now(),
    state: "local",
  };
}

/** Transition episode to stored (uploaded to 0G Storage). */
export function markStored(episode: Episode, storageRef: string): Episode {
  return { ...episode, state: "stored", storageRef };
}

/** Transition episode to anchored (root committed on RelayLedger). */
export function markAnchored(
  episode: Episode,
  rootHash: string,
  relayLedgerAddress: string,
  anchorTxId: string,
): Episode {
  return {
    ...episode,
    state: "anchored",
    rootHash,
    relayLedgerAddress,
    anchorTxId,
    completedAtMs: Date.now(),
  };
}

/** Transition episode to verified (re-hash confirmed against registry). */
export function markVerified(episode: Episode): Episode {
  return { ...episode, state: "verified" };
}

/** Mark episode as unanchored (storage or chain write failed). ref: ROADMAP.md §7 */
export function markUnanchored(episode: Episode): Episode {
  return { ...episode, state: "unanchored" };
}

