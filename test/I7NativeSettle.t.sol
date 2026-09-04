// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {ActionConstants} from "@uniswap/v4-periphery/src/libraries/ActionConstants.sol";
import {SettlementTestBase} from "./utils/SettlementTestBase.sol";
import {RouterHarness} from "./utils/RouterHarness.sol";
import {ExecutorHarness} from "./utils/ExecutorHarness.sol";
import {SettlementExecutor} from "../src/SettlementExecutor.sol";

/// @title Invariant I7, native settlement integrity, as four rows plus the official router
/// @notice The defence is `sync(ADDRESS_ZERO)` immediately before the native `settle`. The precondition
///         that makes its absence fatal is a foreign currency synced earlier in the same unlock. Rows:
///         defence on × quiet PASSES (the control that must pass first); defence off × quiet PASSES
///         (the trap: a test that only omits the sync would go green against unfixed code); defence
///         off × precondition REVERTS with NonzeroNativeValue; defence on × precondition SURVIVES.
///         The fifth row runs the OFFICIAL router's deployed bytecode with the precondition genuinely
///         present, a foreign settle leg before the native one in the same unlock, and it survives:
///         the defence UNICA relies on lives in Uniswap's own settle (`DeltaResolver._settle`).
/// @dev Rows one to four run a stand-in at the router's address with the defence made switchable,
///      because the official bytecode cannot have its defence removed. The precondition is real:
///      `PoolManager._settle` reads the last synced currency and rejects native value when that
///      currency is an ERC-20 (`v4-core/src/PoolManager.sol`, `_settle`).
contract I7NativeSettleTest is SettlementTestBase {
    using TransientStateLibrary for IPoolManager;

    RouterHarness internal harness;
    address internal merchant = makeAddr("merchant");
    address internal payer = makeAddr("payer");
    PoolKey internal key;
    uint128 internal constant AMOUNT_IN = 1e15;

    function setUp() public {
        setUpV4();
        deploySettlement();
        // The stand-in at the official router's address: the hook and the executor talk to it unchanged.
        deployCodeTo("RouterHarness.sol:RouterHarness", abi.encode(manager), universalRouter);
        harness = RouterHarness(payable(universalRouter));
        vm.label(universalRouter, "RouterHarness(at the router's address)");
        (key,) = initNativePoolWithLiquidity(IHooks(address(hook)), 10 ether);
        vm.deal(payer, 1 ether);
        // Give the PoolManager a reserve of the mock token so a foreign sync records a balance.
        usdc.mint(address(manager), 1 ether);
    }

    /// @notice Row 1, the control: defence on, no precondition. Must pass before anything else is believed.
    function test_I7_DefenceOn_Quiet_Settles() public {
        _pay();
        assertEq(hook.receiptCount(), 1);
        assertEq(universalRouter.balance, 0);
    }

    /// @notice Row 2, the trap: defence OFF, no precondition, and it still settles. This is why a
    ///         negative test that merely omits the sync is worthless: it passes against unfixed code.
    function test_I7_DefenceOff_Quiet_StillSettles() public {
        harness.setSkipSync(true);
        _pay();
        assertEq(hook.receiptCount(), 1);
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
        executor.pay{value: AMOUNT_IN}(orderId);
        // Nothing moved, anywhere: balances, PoolManager deltas, executor state, hook state, receipts.
        assertEq(payer.balance, payerBefore, "payer lost value on a refused payment");
        assertEq(usdc.balanceOf(merchant), 0);
        assertEq(universalRouter.balance, 0);
        assertEq(address(executor).balance, 0);
        assertEq(manager.currencyDelta(universalRouter, CurrencyLibrary.ADDRESS_ZERO), 0, "native delta left open");
        assertEq(manager.currencyDelta(universalRouter, usdcCurrency), 0, "token delta left open");
        assertEq(
            uint8(executor.orders(orderId).status),
            uint8(SettlementExecutor.Status.Open),
            "a refused payment consumed the order"
        );
        // The receipt cannot survive: it was emitted inside the swap and the whole unlock reverted, so the
        // EVM discarded it with the rest. Storage is the witness here, not the log recorder, which was
        // measured on 2026-09-04 to return the receipt from the reverted frame.
        assertEq(hook.receiptCount(), 0, "the hook receipted a refused settlement");
    }

    /// @notice Row 4, the invariant: defence ON with the same precondition. The sync resets the
    ///         synced currency to native and the settlement survives.
    function test_I7_DefenceOn_ForeignSync_Survives() public {
        harness.setForeignSyncFirst(usdcCurrency);
        _pay();
        assertEq(hook.receiptCount(), 1);
        assertEq(universalRouter.balance, 0);
    }

    /// @notice Row 5, the official router: its deployed bytecode, a plan that settles one wei of the
    ///         ERC-20 from the router's own balance BEFORE the native settle in the same unlock (so the
    ///         synced currency is foreign at the native settle), and the settlement survives. The
    ///         foreign wei rides to the recipient with the output, as the TAKE of the full credit says.
    function test_I7_OfficialRouter_ForeignSettleBeforeNative_Survives() public {
        etchOfficialUniversalRouter();
        ExecutorHarness h = deployExecutorHarness();
        usdc.mint(universalRouter, 1);
        bytes32 orderId = _order();

        bytes memory actions = abi.encodePacked(
            uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE), uint8(Actions.SETTLE), uint8(Actions.TAKE)
        );
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: key, zeroForOne: true, amountIn: AMOUNT_IN, amountOutMinimum: 1, hookData: abi.encode(orderId)
            })
        );
        params[1] = abi.encode(key.currency1, uint256(1), false);
        params[2] = abi.encode(key.currency0, ActionConstants.OPEN_DELTA, false);
        params[3] = abi.encode(key.currency1, merchant, ActionConstants.OPEN_DELTA);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);

        vm.recordLogs();
        h.payWithPlan{value: AMOUNT_IN}(orderId, abi.encodePacked(uint8(0x10)), inputs);

        (uint256 receipts, uint256 amountOut) = receiptsEmitted();
        assertEq(receipts, 1);
        assertEq(usdc.balanceOf(merchant), amountOut + 1, "recipient did not receive the output plus the foreign wei");
        assertEq(universalRouter.balance, 0);
        assertEq(usdc.balanceOf(universalRouter), 0);
        assertEq(hook.receiptCount(), 1);
    }

    /// @notice Neither the executor nor the router holds anything before or after a settlement.
    function test_I7_NothingHeldBeforeOrAfter() public {
        assertEq(universalRouter.balance, 0);
        assertEq(address(executor).balance, 0);
        _pay();
        assertEq(universalRouter.balance, 0);
        assertEq(address(executor).balance, 0);
    }

    function _order() internal returns (bytes32) {
        vm.prank(merchant);
        return executor.createOrder(merchant, key, AMOUNT_IN, 1, uint64(block.timestamp + 1 hours));
    }

    function _pay() internal {
        bytes32 orderId = _order();
        uint256 merchantBefore = usdc.balanceOf(merchant);
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
        assertGt(usdc.balanceOf(merchant), merchantBefore, "recipient received nothing");
        assertEq(uint8(executor.orders(orderId).status), uint8(SettlementExecutor.Status.Settled));
    }
}
