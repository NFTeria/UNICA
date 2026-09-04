// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

/// @title FeeOnTakeERC20, a payout token that burns a share of every transfer OUT of the PoolManager
/// @notice Test-only. Models the fee-on-transfer hazard of spec C4 at the one place it bites a
///         settlement: the `take` that pays the recipient. Transfers into the PoolManager are whole,
///         so a pool can be seeded through the ordinary test router; transfers from it lose `feeBps`.
contract FeeOnTakeERC20 is MockERC20 {
    address public immutable POOL_MANAGER;
    uint256 public immutable FEE_BPS;

    constructor(address poolManager, uint256 feeBps) MockERC20("Fee on take", "FOT", 18) {
        POOL_MANAGER = poolManager;
        FEE_BPS = feeBps;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (msg.sender == POOL_MANAGER) {
            uint256 fee = amount * FEE_BPS / 10_000;
            _burn(msg.sender, fee);
            return super.transfer(to, amount - fee);
        }
        return super.transfer(to, amount);
    }
}
