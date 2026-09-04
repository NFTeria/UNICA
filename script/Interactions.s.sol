// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {UnicaScriptBase} from "./LiveFire.s.sol";

/// @title InitPool, stage 2: initialise the native-ETH / USDC pool with the hook at 2,500 USDC per ETH
contract InitPool is UnicaScriptBase {
    function run() external {
        init();
    }
}

/// @title SeedLiquidity, stage 3: full-range liquidity from what the deployer holds, above a floor
contract SeedLiquidity is UnicaScriptBase {
    function run() external {
        seed();
    }
}

/// @title Settle, stage 4: create an order and pay it through the router, the only path the hook admits
contract Settle is UnicaScriptBase {
    function run() external {
        swap();
    }
}
