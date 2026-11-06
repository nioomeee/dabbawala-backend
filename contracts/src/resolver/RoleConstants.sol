// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title RoleConstants
 * @notice ENSv2 Enhanced Access Control (EAC) role bitmap constants for the
 *         Permissioned Resolver, mirroring the values documented by ENS.
 *
 * ref: R-ENS-2 (docs.ens.domains/ensv2/permissioned-resolver),
 *      R-ENS-3 (docs.ens.domains/ensv2/enhanced-access-control).
 * VERIFIED against the official pages on 2026-11-05:
 *   - each role occupies one 4-bit nybble (regular role N = 1 << 4N);
 *   - every role has an admin counterpart at (role << 128) on the same resource;
 *   - ROOT_RESOURCE == 0; a role granted there covers every resource.
 *
 * These constants back the LOCAL Hardhat test-harness replica of the ENSv2
 * Permissioned Resolver. On Sepolia the protocol-deployed implementation
 * (PermissionedResolverImpl, deployments table) is used instead; this file
 * never overrides protocol-deployed addresses.
 */
library RoleConstants {
    /// @notice Contract-wide EAC resource (0x0). A role granted here covers
    ///         every argument-scoped resource. ref: R-ENS-3.
    uint256 internal constant ROOT_RESOURCE = 0;

    /// @notice Nybble index of ROLE_SET_ADDRESS (bits 0-3).
    uint256 internal constant ROLE_SET_ADDRESS = 1 << 0;
    /// @notice Nybble index of ROLE_SET_TEXT (bits 4-7).
    uint256 internal constant ROLE_SET_TEXT = 1 << 4;
    /// @notice Nybble index of ROLE_SET_CONTENTHASH (bits 8-11).
    uint256 internal constant ROLE_SET_CONTENTHASH = 1 << 8;
    /// @notice Nybble index of ROLE_SET_ABI (bits 12-15).
    uint256 internal constant ROLE_SET_ABI = 1 << 12;
    /// @notice Nybble index of ROLE_SET_INTERFACE (bits 16-19).
    uint256 internal constant ROLE_SET_INTERFACE = 1 << 16;
    /// @notice Nybble index of ROLE_SET_NAME (bits 20-23).
    uint256 internal constant ROLE_SET_NAME = 1 << 20;
    /// @notice Nybble index of ROLE_SET_DATA (bits 24-27).
    uint256 internal constant ROLE_SET_DATA = 1 << 24;
    /// @notice Nybble index of ROLE_LINK (bits 28-31). Root resource only.
    uint256 internal constant ROLE_LINK = 1 << 28;
    /// @notice Nybble index of ROLE_CAN_NAME (nybble 30 position 120).
    uint256 internal constant ROLE_CAN_NAME = 1 << 120;
    /// @notice Nybble index of ROLE_UPGRADE (nybble 31 position 124).
    uint256 internal constant ROLE_UPGRADE = 1 << 124;

    /// @notice Mask over every regular-role nybble (positions 0-127).
    uint256 internal constant REGULAR_ROLE_MASK =
        0x1111111111111111111111111111111111111111111111111111111111111111;

    /**
     * @notice The admin mask required to grant/revoke a role bitmap: the admin
     *         counterpart (<<128) of every regular role plus any admin bits
     *         already present. ref: R-ENS-3 ("The caller must hold the admin
     *         role for every role being granted or revoked").
     */
    function requiredAdminMask(uint256 roleBitmap) internal pure returns (uint256) {
        uint256 regular = roleBitmap & REGULAR_ROLE_MASK;
        unchecked {
            return (regular << 128) | (roleBitmap & ~REGULAR_ROLE_MASK);
        }
    }
}
