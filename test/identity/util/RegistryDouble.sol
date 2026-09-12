// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @dev The two registry reads the contracts under test make: is this executor an official
///      market's, and who is the registry's admin right now. A test double: `vouch(executor)` makes
///      an executor official, `setAdmin` stands in for the registry's own two step handover, and
///      nothing else is implemented.
contract RegistryDouble {
    mapping(address => bytes32) private _ids;

    /// @notice The account both `TerminalAdmission.setDirectSettler` and `DirectSettlement`'s own
    ///         creator authority resolve to. Settable here so a handover can be exercised in one
    ///         call; the real registry moves it with `transferAdmin` plus `acceptAdmin`.
    address public admin;

    constructor() {
        admin = msg.sender;
    }

    function setAdmin(address next) external {
        admin = next;
    }

    function vouch(address executor, bytes32 marketId) external {
        _ids[executor] = marketId;
    }

    function marketIdOfExecutor(address executor) external view returns (bytes32) {
        return _ids[executor];
    }
}
