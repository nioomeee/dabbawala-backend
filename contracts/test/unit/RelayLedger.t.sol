// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test, console2 } from "forge-std/Test.sol";
import { RelayLedger } from "../src/RelayLedger.sol";

/**
 * @title RelayLedgerTest
 * @notice Unit tests for RelayLedger.
 *
 * Covers test C1 (anchor and read back) and mandatory negative paths.
 * ref: ROADMAP.md §6 test C1
 */
contract RelayLedgerTest is Test {
    RelayLedger public ledger;

    address public anchorer = makeAddr("anchorer");
    address public unauthorized = makeAddr("unauthorized");

    bytes32 public robotId = keccak256("andheri-01");
    bytes32 public episodeId = keccak256("episode-test-001");
    bytes32 public rootHash = keccak256("root-hash-of-jsonl-file");

    function setUp() public {
        ledger = new RelayLedger(anchorer);
    }

    // ── Positive tests ────────────────────────────────────────────────────────

    /// @notice Test C1: Anchor a root and read it back. ref: ROADMAP.md §6 C1
    function test_AnchorAndReadBack() public {
        vm.prank(anchorer);
        ledger.anchor(robotId, episodeId, rootHash);

        assertEq(ledger.getRoot(episodeId), rootHash, "Root hash mismatch after anchor");
        assertTrue(ledger.isAnchored(episodeId), "Episode should be anchored");

        console2.log("C1 PASS: anchor and getRoot returned matching root hash");
    }

    function test_EventEmittedOnAnchor() public {
        vm.expectEmit(true, true, true, true);
        emit RelayLedger.EpisodeAnchored(robotId, episodeId, rootHash, block.timestamp);

        vm.prank(anchorer);
        ledger.anchor(robotId, episodeId, rootHash);
    }

    function test_UnanchoredEpisodeReturnsZero() public view {
        bytes32 unknownEpisode = keccak256("unknown-episode");
        assertEq(ledger.getRoot(unknownEpisode), bytes32(0));
        assertFalse(ledger.isAnchored(unknownEpisode));
    }

    function test_AnchorerIsImmutable() public view {
        assertEq(ledger.anchorer(), anchorer);
    }

    // ── Negative tests ────────────────────────────────────────────────────────

    /// @notice (N) Unauthorized caller cannot anchor.
    function test_RevertWhen_UnauthorizedCaller() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(RelayLedger.Unauthorized.selector, unauthorized));
        ledger.anchor(robotId, episodeId, rootHash);
    }

    /// @notice (N) Cannot anchor the same episodeId twice.
    function test_RevertWhen_DoubleAnchor() public {
        vm.prank(anchorer);
        ledger.anchor(robotId, episodeId, rootHash);

        vm.prank(anchorer);
        vm.expectRevert(abi.encodeWithSelector(RelayLedger.AlreadyAnchored.selector, episodeId));
        ledger.anchor(robotId, episodeId, rootHash);
    }

    /// @notice (N) Zero rootHash is rejected.
    function test_RevertWhen_ZeroRootHash() public {
        vm.prank(anchorer);
        vm.expectRevert(RelayLedger.ZeroRootHash.selector);
        ledger.anchor(robotId, episodeId, bytes32(0));
    }

    // ── Fuzz tests ────────────────────────────────────────────────────────────

    /// @notice Fuzz: any non-zero rootHash anchors correctly.
    function testFuzz_AnchorArbitraryRootHash(
        bytes32 fuzzRobotId,
        bytes32 fuzzEpisodeId,
        bytes32 fuzzRootHash
    ) public {
        vm.assume(fuzzRootHash != bytes32(0));
        vm.assume(fuzzEpisodeId != bytes32(0));

        vm.prank(anchorer);
        ledger.anchor(fuzzRobotId, fuzzEpisodeId, fuzzRootHash);

        assertEq(ledger.getRoot(fuzzEpisodeId), fuzzRootHash);
    }

    /// @notice Fuzz: unauthorized callers always revert.
    function testFuzz_UnauthorizedAlwaysReverts(address caller) public {
        vm.assume(caller != anchorer);

        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(RelayLedger.Unauthorized.selector, caller));
        ledger.anchor(robotId, episodeId, rootHash);
    }
}

