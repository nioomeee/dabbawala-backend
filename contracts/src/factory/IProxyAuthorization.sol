// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * Verbatim interface of the official ENS upgrade authorization hook
 * (github.com/ensdomains/verifiable-factory, src/IProxyAuthorization.sol,
 * fetched 2026-11-05). ref: R-ENS-4.
 */
interface IProxyAuthorization {
    function canUpgradeFrom(address previousImplementation) external view returns (bool);
}
