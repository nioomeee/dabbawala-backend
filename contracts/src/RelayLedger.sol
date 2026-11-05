// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title RelayLedger
 * @notice On-chain anchor for Dabbawala Protocol episode roots on 0G Galileo.
 *
 * One function: anchor(robotId, episodeId, rootHash).
 * The episode file carries the same root. Verifiers re-hash the downloaded file
 * and compare it to the anchored root. If they match, the log is unaltered.
 *
 * @dev Named RelayLedger, NOT EpisodeRegistry.
 *      ref: ROADMAP.md §4.7, AGENTS.md §7.13
 *
 * Deployment: 0G Galileo testnet.
 * Address: recorded in README.md after deployment (ref: ROADMAP.md §B-4, §R-2).
 */
contract RelayLedger {
    // ── Errors ────────────────────────────────────────────────────────────────

    /// @notice Caller is not the authorized episode anchorer.
    error Unauthorized(address caller);

    /// @notice An episode with this id has already been anchored.
    error AlreadyAnchored(bytes32 episodeId);

    /// @notice rootHash is zero — reject to prevent silent data loss.
    error ZeroRootHash();

    // ── Events ────────────────────────────────────────────────────────────────

    /**
     * @notice Emitted when an episode root is anchored.
     * @param robotId  Keccak256 of the robot identifier string.
     * @param episodeId  Unique episode identifier.
     * @param rootHash  Merkle root of the JSONL episode file.
     * @param anchoredAt  Block timestamp.
     */
    event EpisodeAnchored(
        bytes32 indexed robotId,
        bytes32 indexed episodeId,
        bytes32 indexed rootHash,
        uint256 anchoredAt
    );

    // ── Storage ───────────────────────────────────────────────────────────────

    /// @notice Address permitted to call anchor(). Set at construction.
    address public immutable anchorer;

    /// @notice episodeId => rootHash. Zero means not anchored.
    mapping(bytes32 => bytes32) public roots;

    // ── Constructor ───────────────────────────────────────────────────────────

    /**
     * @param _anchorer The address permitted to anchor episodes.
     *                  Should be the episode log writer service key, not a robot key.
     */
    constructor(address _anchorer) {
        require(_anchorer != address(0), "RelayLedger: zero anchorer");
        anchorer = _anchorer;
    }

    // ── Anchor ────────────────────────────────────────────────────────────────

    /**
     * @notice Anchor an episode root hash on-chain.
     *
     * Episode finalization is one-time. ref: user request §15.11
     *
     * @param robotId   keccak256 of the robot id string (e.g. "andheri-01").
     * @param episodeId keccak256 of the episode UUID.
     * @param rootHash  Merkle root of the JSONL episode file.
     */
    function anchor(bytes32 robotId, bytes32 episodeId, bytes32 rootHash) external {
        if (msg.sender != anchorer) revert Unauthorized(msg.sender);
        if (rootHash == bytes32(0)) revert ZeroRootHash();
        if (roots[episodeId] != bytes32(0)) revert AlreadyAnchored(episodeId);

        roots[episodeId] = rootHash;

        emit EpisodeAnchored(robotId, episodeId, rootHash, block.timestamp);
    }

    // ── View ──────────────────────────────────────────────────────────────────

    /**
     * @notice Return the anchored root for an episode, or zero if not anchored.
     */
    function getRoot(bytes32 episodeId) external view returns (bytes32) {
        return roots[episodeId];
    }

    /**
     * @notice Return true if the given episodeId has been anchored with
     *         a non-zero root.
     */
    function isAnchored(bytes32 episodeId) external view returns (bool) {
        return roots[episodeId] != bytes32(0);
    }
}

