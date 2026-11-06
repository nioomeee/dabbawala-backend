// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CloneProxyBytecode} from "./CloneProxyBytecode.sol";
import {UUPSProxyLogic} from "./UUPSProxyLogic.sol";
import {IUUPSProxy} from "./IUUPSProxy.sol";
import {IVerifiableFactory} from "./IVerifiableFactory.sol";

/**
 * @title VerifiableFactoryReplica
 * @notice Local-Hardhat replica of the official ENS Verifiable Factory
 *         (github.com/ensdomains/verifiable-factory, src/VerifiableFactory.sol,
 *         fetched 2026-11-05). Differences from the official contract: the
 *         OpenZeppelin `Create2.computeAddress` helper is inlined
 *         (keccak(0xff ++ factory ++ salt ++ keccak(creationCode))) and the
 *         bare `revert(0, 0)` on CREATE2 failure is replaced with the typed
 *         ProxyDeployFailed error. Behavior and ABI are otherwise identical
 *         to the official factory, so the Dabbawala deployment scripts run
 *         the same call sequence against the protocol-owned Sepolia factory
 *         (ref: R-ENS-5) and this replica interchangeably.
 * ref: R-ENS-4, docs.ens.domains/ensv2/verifiable-factory.
 */
contract VerifiableFactoryReplica is IVerifiableFactory {
    /// @notice CREATE2 derived an address that already holds code.
    error ProxyDeployFailed();

    address public immutable proxyLogic;

    constructor() {
        proxyLogic = address(new UUPSProxyLogic());
    }

    /**
     * @dev Deploys a new verifiable proxy clone at a deterministic address.
     *
     * The deployed proxy is an EIP-1167-style clone that delegates proxy
     * mechanics to the factory's `proxyLogic` contract. The clone runtime also
     * appends the derived salt so the factory can later verify the proxy's
     * CREATE2 address.
     *
     * The CREATE2 salt is `keccak256(abi.encode(msg.sender, salt))`, so two
     * callers can reuse the same user salt without colliding.
     */
    function deployProxy(address implementation, uint256 salt, bytes memory data) external returns (address proxy) {
        bytes32 outerSalt = keccak256(abi.encode(msg.sender, salt));
        bytes memory executableBytecode = _proxyCreationCode(outerSalt);

        assembly ("memory-safe") {
            proxy := create2(0, add(executableBytecode, 0x20), mload(executableBytecode), outerSalt)
            if iszero(proxy) {
                revert(0, 0)
            }
        }

        IUUPSProxy(proxy).initialize(implementation, data);

        emit ProxyDeployed(msg.sender, proxy, salt, implementation);
    }

    /**
     * @dev Predicts the proxy address for a deployer and user salt, whether
     *      or not it is deployed. The address is independent of the
     *      implementation and initialization data.
     */
    function predictProxyAddress(address deployer, uint256 salt) external view returns (address proxy) {
        return _computeProxyAddress(keccak256(abi.encode(deployer, salt)));
    }

    /**
     * @dev Verifies a proxy contract and returns its current implementation.
     *      Retrieves the salt appended to the proxy's runtime code and
     *      reconstructs the address to prove provenance by this factory.
     */
    function verifyContract(address proxy) public view returns (address implementation) {
        if (!_isContract(proxy)) revert VerificationFailed(proxy);

        try IUUPSProxy(proxy).getVerifiableProxyData() returns (bytes32 salt, address actualImplementation) {
            if (_computeProxyAddress(salt) == proxy) return actualImplementation;
        } catch {}
        revert VerificationFailed(proxy);
    }

    function _computeProxyAddress(bytes32 salt) private view returns (address) {
        bytes32 codeHash = keccak256(_proxyCreationCode(salt));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, codeHash)))));
    }

    function _proxyCreationCode(bytes32 salt) private view returns (bytes memory) {
        return CloneProxyBytecode.creationCode(proxyLogic, salt);
    }

    function _isContract(address account) internal view returns (bool) {
        uint256 size;
        assembly ("memory-safe") {
            size := extcodesize(account)
        }
        return size > 0;
    }
}
