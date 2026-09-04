// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {UnicaScriptBase} from "./LiveFire.s.sol";
import {UnicaHook} from "../src/UnicaHook.sol";

/// @title DeployUnica, stage 1: the router at its derived address, then the hook at its mined salt
/// @notice `make deploy` (local fork) or `make deploy ARGS="--network sepolia"` (keystore signing).
contract DeployUnica is UnicaScriptBase {
    function run() external returns (UnicaHook hook) {
        hook = deploy();
    }
}
