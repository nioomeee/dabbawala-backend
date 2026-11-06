/**
 * Application port: Episode Log Writer
 *
 * Writes episode events to local JSONL, uploads to 0G Storage, anchors on RelayLedger.
 * ref: ROADMAP.md §4.6, §B-3, §4.3 invariant 10, 11
 */

import type { EpisodeLogEntry, EpisodeLogFooter, EpisodeLogHeader, RobotId } from "@dabbawala/shared";

export interface IEpisodeLogWriter {
  /** Open a new episode log for a robot run. */
  begin(header: EpisodeLogHeader): Promise<void>;

  /** Append a log entry. Entries must be written in sequence. */
  append(entry: EpisodeLogEntry): Promise<void>;

  /**
   * Finalize the episode: compute the root hash, write the footer,
   * upload to 0G Storage, and anchor on RelayLedger.
   * Never uploads episode logs containing secrets or personal data.
   * ref: ROADMAP.md §4.3 invariant 10, §B-3
   */
  finalize(robotId: RobotId): Promise<EpisodeLogFooter>;
}

