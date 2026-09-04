// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SettlementScriptBase} from "./LiveFire.s.sol";
import {V4SettlementHook} from "../src/V4SettlementHook.sol";

/// @title DeploySettlement, stage 1: the router at its derived address, then the hook at its mined salt
/// @notice `make deploy` (local fork) or `make deploy ARGS="--network sepolia"` (keystore signing).
contract DeploySettlement is SettlementScriptBase {
    function run() external returns (V4SettlementHook hook) {
        hook = deploy();
    }
}
