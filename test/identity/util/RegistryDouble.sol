// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @dev The one registry read TerminalAdmission makes: is this executor an official market's.
///      A test double: `vouch(executor)` makes it official, nothing else is implemented.
contract RegistryDouble {
    mapping(address => bytes32) private _ids;

    function vouch(address executor, bytes32 marketId) external {
        _ids[executor] = marketId;
    }

    function marketIdOfExecutor(address executor) external view returns (bytes32) {
        return _ids[executor];
    }
}
