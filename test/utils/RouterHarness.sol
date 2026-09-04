// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {UnicaSettlementRouter} from "../../src/UnicaSettlementRouter.sol";

/// @title RouterHarness, the router with invariant I7's defence made switchable
/// @notice Test-only. Two switches: drop the `sync` before the native `settle` (the defence off),
///         and sync a foreign ERC-20 earlier in the same unlock (the precondition present). Both are
///         needed to show the defect: without the precondition, an untouched synced slot still takes
///         the native branch and the defenceless router settles cleanly, which is exactly why a test
///         that merely omits the sync proves nothing.
contract RouterHarness is UnicaSettlementRouter {
    bool public skipSync;
    Currency public foreignCurrencyToSyncFirst;

    function setSkipSync(bool v) external {
        skipSync = v;
    }

    function setForeignSyncFirst(Currency c) external {
        foreignCurrencyToSyncFirst = c;
    }

    function _settleNativeInput(uint256 amount) internal override {
        if (!foreignCurrencyToSyncFirst.isAddressZero()) {
            // The precondition: an earlier leg of the same unlock left an ERC-20 synced.
            POOL_MANAGER.sync(foreignCurrencyToSyncFirst);
        }
        if (!skipSync) {
            POOL_MANAGER.sync(CurrencyLibrary.ADDRESS_ZERO);
        }
        POOL_MANAGER.settle{value: amount}();
    }
}
