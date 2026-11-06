// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * Verbatim interface of the official ENS Verifiable Factory
 * (github.com/ensdomains/verifiable-factory, src/IVerifiableFactory.sol,
 * fetched 2026-11-05). ref: R-ENS-4, docs.ens.domains/ensv2/verifiable-factory.
 */
interface IVerifiableFactory {
    error VerificationFailed(address proxy);

    event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation);

    function deployProxy(address implementation, uint256 salt, bytes memory data) external returns (address);

    function predictProxyAddress(address deployer, uint256 salt) external view returns (address proxy);

    function verifyContract(address proxy) external view returns (address implementation);
}
