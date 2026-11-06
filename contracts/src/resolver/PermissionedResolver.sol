// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RoleConstants} from "./RoleConstants.sol";

/**
 * @title PermissionedResolver (local test-harness replica)
 * @notice Clean-room implementation of the ENSv2 Permissioned Resolver write
 *         path and record-bundle semantics for the Dabbawala Hardhat harness.
 *
 * PURPOSE AND LIMITS — read before judging this contract:
 * - On Sepolia the Dabbawala deployment uses the protocol-owned
 *   VerifiableFactory and PermissionedResolverImpl from the official
 *   deployments table (docs.ens.domains/learn/deployments#sepolia-ensv2);
 *   this contract is never used as a Sepolia resolver.
 * - Offline (Hardhat chain id 31337) it reproduces the documented ENSv2
 *   behaviour so the role scenes (ROADMAP §6 E1-E5, ENSv2_implementation.md
 *   test matrix) can be executed without Sepolia credentials.
 * - Faithfully implemented (ref: R-ENS-2, R-ENS-3; VERIFIED 2026-11-05):
 *     - name-based setters taking DNS wire-format names;
 *     - the node is derived from the name argument; the first write through
 *       an unlinked name mints a record bundle for it (auto-link);
 *     - reads happen through `resolve(name, data)` profile dispatch only
 *       (no standalone record getters);
 *     - fallback record: a name without its own bundle serves the bundle
 *       linked to the root name (namehash 0x00);
 *     - EAC: resource per setter argument (keccak256 of the argument bits),
 *       master-key semantics via ROOT_RESOURCE, admin counterpart roles
 *       (role << 128), 15 holders per role per resource;
 *     - `grantRoles` disabled (reverts EACCannotGrantRoles); resolver-wide
 *       changes via grantRootRoles/revokeRootRoles; argument-scoped grants
 *       via grantSetterRoles(setter, account); scoped revocations via
 *       revokeRoles(resource, bitmap, account), root-scoped via
 *       revokeRootRoles(bitmap, account);
 *     - unauthorized writes revert with EACUnauthorizedAccountRoles;
 *     - `initialize(grants, calls)` grants each account its bitmap on
 *       ROOT_RESOURCE and runs `calls` as a multicall with role checks
 *       skipped (initial records written in the same transaction).
 * - Deliberate narrows (out of scope for the Dabbawala scenes): record
 *   linking (linkToNode/linkToRecord), ABI/interface/data/name setters and
 *   proxy upgrades. Those paths are not reachable here.
 * - Event naming/indexing is an INTERPRETATION of the docs table (the
 *   official page does not mark indexed parameters); consumers of protocol
 *   events index the Sepolia deployment, not this harness.
 */
contract PermissionedResolver {
    using RoleConstants for uint256;

    // ── Errors ────────────────────────────────────────────────────────────────

    /// @notice A record write or role grant was attempted without the role.
    ///         ref: R-ENS-2, REFERENCES.md F9 (VERIFIED).
    error EACUnauthorizedAccountRoles();

    /// @notice grantRoles() is disabled on the Permissioned Resolver.
    ///         ref: R-ENS-2 ("always reverts with EACCannotGrantRoles").
    error EACCannotGrantRoles();

    /// @notice The resolver proxy has already been initialized.
    error AlreadyInitialized();

    /// @notice decodeSetter/grantSetterRoles saw an unsupported setter selector.
    error UnsupportedResolverProfile();

    /// @notice The DNS wire-format name is malformed.
    error InvalidName();

    /// @notice An EVM coin type received an address that is neither empty nor
    ///         exactly 20 bytes. ref: R-ENS-7 (InvalidEVMAddress).
    error InvalidEVMAddress();

    /// @notice revokeRoles was directed at ROOT_RESOURCE; the explicit
    ///         revokeRootRoles entry point must be used (EAC guardrail,
    ///         ref: R-ENS-3). Local error naming: INTERPRETATION (the docs
    ///         table does not publish this revert name).
    error RootResourceForbidden();

    /// @notice More than 15 accounts attempted to hold one role on one
    ///         resource. ref: R-ENS-3 ("up to 15 holders of a role").
    error RoleLimitExceeded();

    // ── Events ────────────────────────────────────────────────────────────────

    event ResolverCreated();
    /// @notice A write through an unlinked name minted a record bundle.
    event Linked(uint256 indexed recordId, bytes32 indexed node);
    event TextUpdated(uint256 indexed recordId, bytes32 indexed keyHash, string key, string value);
    event AddressUpdated(uint256 indexed recordId, uint256 indexed coinType, bytes addressBytes);
    event ContenthashUpdated(uint256 indexed recordId, bytes contenthash);
    /// @notice Roles granted or revoked. ref: R-ENS-3 (EACRolesChanged).
    event EACRolesChanged(
        uint256 indexed resource,
        address indexed account,
        uint256 oldRoleBitmap,
        uint256 newRoleBitmap
    );
    /// @notice A fresh argument-scoped resource received its first role grant
    ///         through grantSetterRoles. ref: R-ENS-2 (ResourceArgument).
    event ResourceArgument(uint256 indexed resource, string arg);

    // ── EAC storage ───────────────────────────────────────────────────────────

    /// @notice resource => account => role bitmap. ref: R-ENS-3 layout.
    mapping(uint256 resource => mapping(address account => uint256 bitmap)) internal _roles;
    /// @notice resource => nybble-per-role holder count (each nybble <= 15).
    mapping(uint256 resource => uint256 counts) internal _roleCount;
    /// @notice False during initialize(grants, calls): initial records bypass
    ///         role checks, exactly as documented for Verifiable Factory
    ///         deployments. ref: R-ENS-2 (Initialization).
    bool internal _roleCheckEnabled = true;
    /// @notice Initialize ran at most once (guards double-factory writes).
    bool internal _initialized;

    // ── Record bundle storage ─────────────────────────────────────────────────

    mapping(bytes32 node => uint256 recordId) internal _recordIdOf;
    uint256 internal _recordCount;
    mapping(uint256 recordId => mapping(string key => string value)) internal _text;
    mapping(uint256 recordId => mapping(uint256 coinType => bytes value)) internal _addr;
    mapping(uint256 recordId => bytes value) internal _contenthash;

    /// @notice An EAC grant tuple (account, roleBitmap). ABI-encodes exactly
    ///         as the documented (address,uint256) component. ref: R-ENS-2.
    struct Grant {
        address account;
        uint256 roleBitmap;
    }

    // ── Initialization ────────────────────────────────────────────────────────

    /**
     * @notice Apply grants on ROOT_RESOURCE as passed; run `calls` as an
     *         unchecked multicall so initial records are written in the same
     *         transaction. ref: R-ENS-2 (Initialization).
     */
    function initialize(Grant[] calldata grants, bytes[] calldata calls) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;

        for (uint256 i = 0; i < grants.length; i++) {
            _grantUnchecked(RoleConstants.ROOT_RESOURCE, grants[i].account, grants[i].roleBitmap);
        }

        _roleCheckEnabled = false;
        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok, bytes memory ret) = address(this).delegatecall(calls[i]);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
        _roleCheckEnabled = true;

        emit ResolverCreated();
    }

    // ── Setters (name-based) ──────────────────────────────────────────────────

    /// @notice Set an address record (ENSIP-1 ETH coin type is 60).
    function setAddress(
        bytes calldata name,
        uint256 coinType,
        bytes calldata addressBytes
    ) external {
        _requireRole(_coinTypeResource(coinType), RoleConstants.ROLE_SET_ADDRESS);
        if (
            _isEVMCoinType(coinType) &&
            addressBytes.length != 0 &&
            addressBytes.length != 20
        ) revert InvalidEVMAddress();
        (uint256 recordId, ) = _ensureRecord(name);
        _addr[recordId][coinType] = addressBytes;
        emit AddressUpdated(recordId, coinType, addressBytes);
    }

    /// @notice Set a text record (ENSIP-5). The scoped argument is the key.
    function setText(bytes calldata name, string calldata key, string calldata value) external {
        _requireRole(_keyResource(key), RoleConstants.ROLE_SET_TEXT);
        (uint256 recordId, ) = _ensureRecord(name);
        _text[recordId][key] = value;
        emit TextUpdated(recordId, keccak256(bytes(key)), key, value);
    }

    /// @notice Set the content hash (ENSIP-7). Root-scoped role only.
    function setContenthash(bytes calldata name, bytes calldata contenthash) external {
        _requireRole(
            RoleConstants.ROOT_RESOURCE,
            RoleConstants.ROLE_SET_CONTENTHASH
        );
        (uint256 recordId, ) = _ensureRecord(name);
        _contenthash[recordId] = contenthash;
        emit ContenthashUpdated(recordId, contenthash);
    }

    // ── multicall ─────────────────────────────────────────────────────────────

    /// @notice Execute multiple writes; reverts with the first failing
    ///         call's error. ref: R-ENS-7 (multicall).
    function multicall(bytes[] calldata calls) external returns (bytes[] memory) {
        bytes[] memory results = new bytes[](calls.length);
        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok, bytes memory ret) = address(this).delegatecall(calls[i]);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
            results[i] = ret;
        }
        return results;
    }

    // ── EAC role management ───────────────────────────────────────────────────

    /// @notice Generic grantRoles is disabled on the Permissioned Resolver.
    ///         ref: R-ENS-2, REFERENCES.md F8.
    function grantRoles(uint256, uint256, address) external pure returns (bool) {
        revert EACCannotGrantRoles();
    }

    /// @notice Grant a role bitmap on ROOT_RESOURCE (contract-wide).
    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool) {
        _requireAdmin(RoleConstants.ROOT_RESOURCE, roleBitmap);
        return _grantUnchecked(RoleConstants.ROOT_RESOURCE, account, roleBitmap);
    }

    /// @notice Revoke a role bitmap on ROOT_RESOURCE (contract-wide).
    function revokeRootRoles(uint256 roleBitmap, address account) external returns (bool) {
        _requireAdmin(RoleConstants.ROOT_RESOURCE, roleBitmap);
        return _revokeUnchecked(RoleConstants.ROOT_RESOURCE, account, roleBitmap);
    }

    /// @notice Revoke a role bitmap on a specific argument-scoped resource.
    ///         Cannot target ROOT_RESOURCE (EAC guardrail; ref: R-ENS-3).
    function revokeRoles(uint256 resource, uint256 roleBitmap, address account)
        external
        returns (bool)
    {
        if (resource == RoleConstants.ROOT_RESOURCE) revert RootResourceForbidden();
        _requireAdmin(resource, roleBitmap);
        return _revokeUnchecked(resource, account, roleBitmap);
    }

    /**
     * @notice Grant the argument-scoped role encoded in a setter call.
     *         Only the selector and the scoped argument matter; the name and
     *         value parts are ignored. The caller must hold the corresponding
     *         ADMIN role at that resource (or at ROOT_RESOURCE, since a root
     *         grant is the master key). ref: R-ENS-2, R-ENS-3.
     */
    function grantSetterRoles(bytes calldata setter, address account) external returns (bool) {
        (uint256 role, uint256 resource) = _decodeSetter(setter);
        _requireAdmin(resource, role);
        bool changed = _grantUnchecked(resource, account, role);
        if (_roleCount[resource] == 0) {
            // Fresh resource: map the opaque resource id back to its argument.
            emit ResourceArgument(resource, _scopedArgumentLabel(setter));
        }
        return changed;
    }

    // ── EAC views ─────────────────────────────────────────────────────────────

    /// @notice Stored role bitmap for an account on a resource.
    function roles(uint256 resource, address account) external view returns (uint256) {
        return _roles[resource][account];
    }

    /// @notice Per-role holder count bitmap (one 4-bit nybble per role).
    function roleCount(uint256 resource) external view returns (uint256) {
        return _roleCount[resource];
    }

    /// @notice True when `account` holds every role in `roleBitmap` on
    ///         `resource` or on ROOT_RESOURCE. ref: R-ENS-3.
    function hasRoles(uint256 resource, uint256 roleBitmap, address account)
        external
        view
        returns (bool)
    {
        return _hasRoles(resource, roleBitmap, account);
    }

    /// @notice True when `account` holds every role in the bitmap on
    ///         ROOT_RESOURCE only (no master-key fallback).
    function hasRootRoles(uint256 roleBitmap, address account) external view returns (bool) {
        return (_roles[RoleConstants.ROOT_RESOURCE][account] & roleBitmap) == roleBitmap;
    }

    /**
     * @notice Decode setter calldata into (scoped argument, resource, role).
     *         `argument` is the raw scoped-argument bytes: the key for
     *         setText/setData, abi.encode(coinType) for setAddress, empty for
     *         the root-scoped contenthash setter. ref: R-ENS-2
     *         (decodeSetter); concrete typing INTERPRETATION.
     */
    function decodeSetter(bytes calldata setter)
        external
        pure
        returns (bytes memory argument, uint256 resource, uint256 role)
    {
        (bytes memory arg, uint256 res, uint256 rl) = _decodeSetterFull(setter);
        return (arg, res, rl);
    }

    // ── Resolution: the only read path ────────────────────────────────────────

    /**
     * @notice Resolve `name` by dispatching the profile calldata in `data`.
     *         The node inside the profile calldata is ignored; the node is
     *         derived from `name`. ref: R-ENS-2 (resolve).
     */
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory) {
        bytes4 selector;
        assembly ("memory-safe") {
            selector := calldataload(data.offset)
        }

        if (selector == bytes4(keccak256("addr(bytes32)"))) {
            return abi.encode(_ethAddr(name));
        }
        if (selector == bytes4(keccak256("addr(bytes32,uint256)"))) {
            // profile layout after the 4-byte selector:
            //   head slot 0: bytes32 node (ignored)
            //   head slot 1: uint256 coinType
            uint256 coinType;
            assembly ("memory-safe") {
                coinType := calldataload(add(data.offset, 0x24))
            }
            return abi.encode(_addrValue(name, coinType));
        }
        if (selector == bytes4(keccak256("contenthash(bytes32)"))) {
            return abi.encode(_contenthashValue(name));
        }
        if (selector == bytes4(keccak256("text(bytes32,string)"))) {
            // profile layout after the 4-byte selector:
            //   head slot 0: bytes32 node (ignored)
            //   head slot 1: string key (dynamic, offset counted from arg block)
            uint256 keyOffset;
            assembly ("memory-safe") {
                keyOffset := calldataload(add(data.offset, 0x24))
            }
            string memory key = _copyCalldataString(data, 0x04, keyOffset);
            return abi.encode(_textValue(name, key));
        }
        revert UnsupportedResolverProfile();
    }

    /// @notice Record bundle a node is linked to (0 = not linked).
    function getRecordId(bytes32 node) external view returns (uint256) {
        return _recordIdOf[node];
    }

    /// @notice Total record bundles created on this resolver.
    function getRecordCount() external view returns (uint256) {
        return _recordCount;
    }

    // ── internal: EAC checks ──────────────────────────────────────────────────

    function _requireRole(uint256 resource, uint256 role) internal view {
        if (_roleCheckEnabled && !_hasRoles(resource, role, msg.sender)) {
            revert EACUnauthorizedAccountRoles();
        }
    }

    function _requireAdmin(uint256 resource, uint256 roleBitmap) internal view {
        _requireRole(resource, roleBitmap.requiredAdminMask());
    }

    /// @notice Master-key rule: the role held on the resource OR on
    ///         ROOT_RESOURCE counts. ref: R-ENS-3.
    function _hasRoles(uint256 resource, uint256 roleBitmap, address account)
        internal
        view
        returns (bool)
    {
        uint256 shown = roleBitmap;
        if ((_roles[resource][account] & shown) == shown) return true;
        if (resource != RoleConstants.ROOT_RESOURCE) {
            if ((_roles[RoleConstants.ROOT_RESOURCE][account] & shown) == shown) return true;
        }
        return false;
    }

    // ── internal: role grant/revoke ───────────────────────────────────────────

    /// @notice Grant roles on a resource; the admin check already ran.
    function _grantUnchecked(uint256 resource, address account, uint256 roleBitmap)
        internal
        returns (bool)
    {
        uint256 oldBitmap = _roles[resource][account];
        uint256 newBitmap = oldBitmap | roleBitmap;
        if (newBitmap == oldBitmap) return false;
        _roles[resource][account] = newBitmap;
        _bumpHolderCount(resource, oldBitmap, newBitmap);
        emit EACRolesChanged(resource, account, oldBitmap, newBitmap);
        return true;
    }

    /// @notice Revoke roles on a resource; the admin check already ran.
    function _revokeUnchecked(uint256 resource, address account, uint256 roleBitmap)
        internal
        returns (bool)
    {
        uint256 oldBitmap = _roles[resource][account];
        uint256 newBitmap = oldBitmap & ~roleBitmap;
        if (newBitmap == oldBitmap) return false;
        _roles[resource][account] = newBitmap;
        _bumpHolderCount(resource, oldBitmap, newBitmap);
        emit EACRolesChanged(resource, account, oldBitmap, newBitmap);
        return true;
    }

    /// @notice Nybble-per-role holder counts (max 15 per role; ref: R-ENS-3).
    function _bumpHolderCount(uint256 resource, uint256 oldBitmap, uint256 newBitmap) internal {
        if (newBitmap == oldBitmap) return;
        uint256 counts = _roleCount[resource];
        for (uint256 i = 0; i < 32; i++) {
            uint256 shift = 4 * i;
            uint256 roleBit = 1 << shift;
            bool wasHeld = (oldBitmap & roleBit) != 0;
            bool isHeld = (newBitmap & roleBit) != 0;
            if (isHeld == wasHeld) continue;
            uint256 count;
            if (isHeld) {
                count = (counts >> shift) & 0xF;
                if (count == 15) revert RoleLimitExceeded();
                count += 1;
            } else {
                count = ((counts >> shift) & 0xF) - 1;
            }
            uint256 mask = 0xF << shift;
            counts = (counts & ~mask) | (count << shift);
        }
        _roleCount[resource] = counts;
    }

    // ── internal: record bundles ──────────────────────────────────────────────

    /// @notice Mint and auto-link a record bundle for an unlinked name.
    function _ensureRecord(bytes calldata name)
        internal
        returns (uint256 recordId, bytes32 node)
    {
        node = _namehashOfName(name);
        recordId = _recordIdOf[node];
        if (recordId == 0) {
            _recordCount += 1;
            recordId = _recordCount;
            _recordIdOf[node] = recordId;
            emit Linked(recordId, node);
        }
    }

    /// @notice The bundle serving a name: its own, else the root default
    ///         (namehash 0x00). ref: R-ENS-2 (The Default Record).
    function _bundleFor(bytes calldata name) internal view returns (uint256) {
        bytes32 node = _namehashOfName(name);
        uint256 recordId = _recordIdOf[node];
        if (recordId == 0) recordId = _recordIdOf[bytes32(0)];
        return recordId;
    }

    function _textValue(bytes calldata name, string memory key)
        internal
        view
        returns (string memory)
    {
        uint256 rid = _bundleFor(name);
        if (rid == 0) return "";
        return _text[rid][key];
    }

    function _addrValue(bytes calldata name, uint256 coinType)
        internal
        view
        returns (bytes memory)
    {
        uint256 rid = _bundleFor(name);
        if (rid == 0) return "";
        return _addr[rid][coinType];
    }

    /// @notice ENSIP-1 ETH coin-type read profile returns an address; an
    ///         unset or non-20-byte value resolves to the zero address.
    function _ethAddr(bytes calldata name) internal view returns (address) {
        uint256 rid = _bundleFor(name);
        if (rid == 0) return address(0);
        bytes memory value = _addr[rid][60];
        if (value.length != 20) return address(0);
        return address(bytes20(value));
    }

    function _contenthashValue(bytes calldata name) internal view returns (bytes memory) {
        uint256 rid = _bundleFor(name);
        if (rid == 0) return "";
        return _contenthash[rid];
    }

    // ── internal: DNS wire format ─────────────────────────────────────────────

    /// @notice Namehash of a DNS wire-format name, per EIP-137. The wire
    ///         format lists labels leftmost-first ("ramu" before "eth"), so
    ///         labels are gathered in a first pass and hashed root-first
    ///         (rightmost label first): node = keccak(node ++ labelhash).
    function _namehashOfName(bytes calldata dnsName) internal pure returns (bytes32 node) {
        if (dnsName.length == 0) revert InvalidName();
        if (uint8(dnsName[dnsName.length - 1]) != 0) revert InvalidName();

        // First pass: label boundaries (start of label content, label end).
        uint256[] memory starts = new uint256[](dnsName.length);
        uint256[] memory ends = new uint256[](dnsName.length);
        uint256 count;
        uint256 i = 0;
        while (i < dnsName.length - 1) {
            uint8 len = uint8(dnsName[i]);
            if (len == 0) revert InvalidName();
            uint256 labelEnd = i + 1 + len;
            if (labelEnd > dnsName.length - 1) revert InvalidName();
            starts[count] = i + 1;
            ends[count] = labelEnd;
            count += 1;
            i = labelEnd;
        }

        // Second pass: hash labels root-first (reverse wire order).
        for (uint256 j = count; j > 0; j--) {
            bytes32 labelHash = keccak256(dnsName[starts[j - 1]:ends[j - 1]]);
            node = keccak256(abi.encodePacked(node, labelHash));
        }
    }

    /// @notice EAC resource of a string argument: keccak256(bytes(key)).
    function _keyResource(string calldata key) internal pure returns (uint256) {
        return uint256(keccak256(bytes(key)));
    }

    /// @notice EAC resource of a uint256 argument: keccak256(abi.encode(v)).
    function _coinTypeResource(uint256 coinType) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(coinType)));
    }

    /// @notice ETH coin type (60) and the ENSIP-19 EVM default coin type
    ///         (`0x80000000 | 60`). ref: R-ENS-2 (Supported Record Types).
    function _isEVMCoinType(uint256 coinType) internal pure returns (bool) {
        return coinType == 60 ||
            coinType == (0x80000000 | uint256(uint32(0x3c)));
    }

    // ── internal: setter calldata decoding ────────────────────────────────────

    function _decodeSetter(bytes calldata setter)
        internal
        pure
        returns (uint256 role, uint256 resource)
    {
        (, uint256 res, uint256 rl) = _decodeSetterFull(setter);
        return (rl, res);
    }

    function _decodeSetterFull(bytes calldata setter)
        internal
        pure
        returns (bytes memory argument, uint256 resource, uint256 role)
    {
        bytes4 selector;
        assembly ("memory-safe") {
            selector := calldataload(setter.offset)
        }

        // Inner setter calldata: [selector(4B)][head words ...].
        // Slots referenced below assume each supported setter puts the scoped
        // argument in head slot 1 (offset counted from the args block start).
        if (selector == bytes4(keccak256("setText(bytes,string,string)"))) {
            string memory key = _copyCalldataString(setter, 0x04, _headOffset(setter, 0x04));
            argument = bytes(key);
            role = RoleConstants.ROLE_SET_TEXT;
            resource = uint256(keccak256(bytes(key)));
        } else if (selector == bytes4(keccak256("setAddress(bytes,uint256,bytes)"))) {
            // coinType is a static argument in head slot 1.
            uint256 coinType;
            assembly ("memory-safe") {
                coinType := calldataload(add(setter.offset, 0x24))
            }
            argument = abi.encodePacked(coinType);
            role = RoleConstants.ROLE_SET_ADDRESS;
            resource = _coinTypeResource(coinType);
        } else if (selector == bytes4(keccak256("setContenthash(bytes,bytes)"))) {
            // Root-scoped: no argument resource.
            argument = hex"";
            role = RoleConstants.ROLE_SET_CONTENTHASH;
            resource = RoleConstants.ROOT_RESOURCE;
        } else {
            revert UnsupportedResolverProfile();
        }
    }

    /// @notice Label of the scoped argument for the ResourceArgument event.
    function _scopedArgumentLabel(bytes calldata setter) internal pure returns (string memory) {
        (bytes memory argument, uint256 resource, uint256 role) = _decodeSetterFull(setter);
        if (resource == RoleConstants.ROOT_RESOURCE) return "root";
        if (role == RoleConstants.ROLE_SET_ADDRESS) {
            return _uintLabel(uint256(bytes32(argument)));
        }
        return string(argument);
    }

    function _uintLabel(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 t = value;
        uint256 digits;
        while (t != 0) {
            digits += 1;
            t /= 10;
        }
        bytes memory out = new bytes(digits);
        t = value;
        while (digits != 0) {
            out[--digits] = bytes1(uint8(48 + (t % 10)));
            t /= 10;
        }
        return string(out);
    }

    // ── internal: calldata reading helpers ────────────────────────────────────

    /// @notice ABI head offset value of a dynamic field. `argsStart` is the
    ///         start of the args block relative to the outer calldata region
    ///         (equals 4, past the 4-byte selector). Reads the head word of
    ///         head slot 1 (offset value relative to the args block start).
    function _headOffset(bytes calldata region, uint256 argsStart)
        internal
        pure
        returns (uint256 offset)
    {
        assembly ("memory-safe") {
            offset := calldataload(add(region.offset, add(argsStart, 0x20)))
        }
    }

    /// @notice Copy a length-prefixed ABI dynamic string field out of calldata
    ///         into memory. `argsStart` is the absolute start of the args
    ///         block; `fieldOffset` is the head-slot offset (relative to it).
    function _copyCalldataString(bytes calldata region, uint256 argsStart, uint256 fieldOffset)
        internal
        pure
        returns (string memory out)
    {
        assembly ("memory-safe") {
            let src := add(region.offset, add(argsStart, fieldOffset))
            let len := calldataload(src)
            let dst := mload(0x40)
            mstore(dst, len)
            let padded := and(add(len, 31), not(31))
            calldatacopy(add(dst, 0x20), add(src, 0x20), len)
            mstore(0x40, add(add(dst, 0x20), padded))
            out := dst
        }
    }
}
