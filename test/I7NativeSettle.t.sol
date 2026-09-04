// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {Vm} from "forge-std/Vm.sol";
import {UnicaTestBase} from "./utils/UnicaTestBase.sol";
import {RouterHarness} from "./utils/RouterHarness.sol";
import {UnicaHook} from "../src/UnicaHook.sol";

/// @title Invariant I7, native settlement integrity, as four rows
/// @notice The defence is `sync(ADDRESS_ZERO)` immediately before the native `settle`. The precondition
///         that makes its absence fatal is a foreign currency synced earlier in the same unlock. Rows:
///         defence on × quiet PASSES (the control that must pass first); defence off × quiet PASSES
///         (the trap: a test that only omits the sync would go green against unfixed code); defence
///         off × precondition REVERTS with NonzeroNativeValue; defence on × precondition SURVIVES.
/// @dev The harness is placed at the router's derived address, so the hook admits it. The precondition
///      is real: `PoolManager._settle` reads the last synced currency and rejects native value when
///      that currency is an ERC-20 (`v4-core/src/PoolManager.sol`, `_settle`).
contract I7NativeSettleTest is UnicaTestBase {
    using TransientStateLibrary for IPoolManager;

    RouterHarness internal harness;
    address internal merchant = makeAddr("merchant");
    address internal payer = makeAddr("payer");
    PoolKey internal key;
    uint128 internal constant AMOUNT_IN = 1e15;

    function setUp() public {
        setUpV4();
        deployCodeTo("UnicaHook.sol:UnicaHook", "", HOOK_ADDR);
        hook = UnicaHook(HOOK_ADDR);
        // The harness at the address the hook trusts, so its swaps are admitted.
        deployCodeTo("RouterHarness.sol:RouterHarness", "", hook.SETTLER());
        harness = RouterHarness(hook.SETTLER());
        (key,) = initNativePoolWithLiquidity(IHooks(address(hook)), 10 ether);
        vm.deal(payer, 1 ether);
        // Give the PoolManager a reserve of the mock token so a foreign sync records a balance.
        usdc.mint(address(manager), 1 ether);
    }

    /// @notice Row 1, the control: defence on, no precondition. Must pass before anything else is believed.
    function test_I7_DefenceOn_Quiet_Settles() public {
        _pay();
        assertEq(hook.afterSwapCount(), 1);
        assertEq(address(harness).balance, 0);
    }

    /// @notice Row 2, the trap: defence OFF, no precondition, and it still settles. This is why a
    ///         negative test that merely omits the sync is worthless: it passes against unfixed code.
    function test_I7_DefenceOff_Quiet_StillSettles() public {
        harness.setSkipSync(true);
        _pay();
        assertEq(hook.afterSwapCount(), 1);
    }

    /// @notice Row 3, the defect: defence OFF with a foreign currency synced earlier in the same
    ///         unlock. The PoolManager refuses the native value; the payment fails and nothing moves.
    function test_I7_DefenceOff_ForeignSync_Reverts() public {
        harness.setSkipSync(true);
        harness.setForeignSyncFirst(usdcCurrency);
        bytes32 orderId = _order();
        uint256 payerBefore = payer.balance;
        vm.recordLogs();
        vm.expectRevert(IPoolManager.NonzeroNativeValue.selector);
        vm.prank(payer);
        harness.pay{value: AMOUNT_IN}(orderId);
        // Nothing moved, anywhere: balances, PoolManager deltas, router state, hook state, receipts.
        assertEq(payer.balance, payerBefore, "payer lost value on a refused payment");
        assertEq(usdc.balanceOf(merchant), 0);
        assertEq(address(harness).balance, 0);
        assertEq(manager.currencyDelta(address(harness), CurrencyLibrary.ADDRESS_ZERO), 0, "native delta left open");
        assertEq(manager.currencyDelta(address(harness), usdcCurrency), 0, "token delta left open");
        assertFalse(harness.orders(orderId).settled, "a refused payment consumed the order");
        assertEq(hook.afterSwapCount(), 0, "the hook observed a refused settlement");
        assertEq(_settledEvents(), 0, "a receipt was emitted for a refused settlement");
    }

    /// @notice Row 4, the invariant: defence ON with the same precondition. The sync resets the
    ///         synced currency to native and the settlement survives.
    function test_I7_DefenceOn_ForeignSync_Survives() public {
        harness.setForeignSyncFirst(usdcCurrency);
        _pay();
        assertEq(hook.afterSwapCount(), 1);
        assertEq(address(harness).balance, 0);
    }

    /// @notice Router balance is zero before and after a settlement, in every row that settles.
    function test_I7_RouterHoldsNothingBeforeOrAfter() public {
        assertEq(address(harness).balance, 0);
        _pay();
        assertEq(address(harness).balance, 0);
    }

    function _settledEvents() internal returns (uint256 n) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("Settled(bytes32,address,address,uint256,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(harness) && logs[i].topics[0] == topic) n++;
        }
    }

    function _order() internal returns (bytes32) {
        vm.prank(merchant);
        return harness.createOrder(merchant, key, AMOUNT_IN, 1, uint64(block.timestamp + 1 hours));
    }

    function _pay() internal {
        bytes32 orderId = _order();
        uint256 merchantBefore = usdc.balanceOf(merchant);
        vm.prank(payer);
        harness.pay{value: AMOUNT_IN}(orderId);
        assertGt(usdc.balanceOf(merchant), merchantBefore, "recipient received nothing");
        assertTrue(harness.orders(orderId).settled);
    }
}
