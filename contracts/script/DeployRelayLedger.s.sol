// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Script, console2 } from "forge-std/Script.sol";
import { RelayLedger } from "../src/RelayLedger.sol";

/**
 * @title DeployRelayLedger
 * @notice Deployment script for RelayLedger on 0G Galileo testnet.
 *
 * Usage:
 *   forge script script/DeployRelayLedger.s.sol --rpc-url $ZERO_G_RPC_URL \
 *     --broadcast --verify
 *
 * The anchorer address must be set via ANCHORER_ADDRESS env var.
 * Record the deployed address in README.md. ref: ROADMAP.md §B-4, §R-2
 *
 * TESTNETS ONLY. ref: AGENTS.md §11
 */
contract DeployRelayLedger is Script {
    function run() external returns (RelayLedger ledger) {
        address anchorer = vm.envAddress("ANCHORER_ADDRESS");
        require(anchorer != address(0), "DeployRelayLedger: ANCHORER_ADDRESS not set");

        vm.startBroadcast();
        ledger = new RelayLedger(anchorer);
        vm.stopBroadcast();

        console2.log("RelayLedger deployed at:", address(ledger));
        console2.log("Anchorer:", anchorer);
        console2.log("Record this address in README.md and REFERENCES.md §8.2");
    }
}

