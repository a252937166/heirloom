// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {HeirloomVault} from "./HeirloomVault.sol";

/// @title HeirloomFactory — deploys one minimal-proxy vault per continuity plan.
contract HeirloomFactory {
    address public immutable implementation;

    address[] public vaults;
    mapping(bytes32 heartbeatReference => address vault) public vaultByReference;
    mapping(bytes32 ownerXrplHash => address[] vaults) private _vaultsByOwner;

    event VaultCreated(
        address indexed vault,
        uint256 indexed index,
        bytes32 ownerXrplHash,
        bytes32 beneficiaryXrplHash,
        bytes32 heartbeatReference,
        uint64 heartbeatPeriod,
        uint64 gracePeriod,
        uint64 challengePeriod
    );

    constructor(address _implementation) {
        implementation = _implementation;
    }

    function createVault(HeirloomVault.Config calldata c, uint256 crankRewardWei)
        external
        payable
        returns (address vault)
    {
        require(vaultByReference[c.heartbeatReference] == address(0), "reference used");
        vault = Clones.clone(implementation);
        HeirloomVault(payable(vault)).initialize{value: msg.value}(c, crankRewardWei);
        vaults.push(vault);
        vaultByReference[c.heartbeatReference] = vault;
        _vaultsByOwner[c.ownerXrplHash].push(vault);
        emit VaultCreated(
            vault,
            vaults.length - 1,
            c.ownerXrplHash,
            c.beneficiaryXrplHash,
            c.heartbeatReference,
            c.heartbeatPeriod,
            c.gracePeriod,
            c.challengePeriod
        );
    }

    function vaultCount() external view returns (uint256) {
        return vaults.length;
    }

    function vaultsOf(bytes32 ownerXrplHash) external view returns (address[] memory) {
        return _vaultsByOwner[ownerXrplHash];
    }
}
