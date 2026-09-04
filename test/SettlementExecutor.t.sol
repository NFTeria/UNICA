// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {SettlementTestBase} from "./utils/SettlementTestBase.sol";
import {V4SettlementHook} from "../src/V4SettlementHook.sol";
import {SettlementExecutor} from "../src/SettlementExecutor.sol";

/// @title Tests for the executor: invariant I1's positive path through the official router, the
///        receipt (I2), and the order rules
/// @notice Every assertion is about SHAPE, never the implementation's arithmetic: who received, who
///         paid, that neither the executor nor the router holds anything, that the hook receipted
///         exactly one settlement, and that each refusal leaves the order payable (invariant I6).
contract SettlementExecutorTest is SettlementTestBase {
    using PoolIdLibrary for PoolKey;

    address internal merchant = makeAddr("merchant");
    address internal payer = makeAddr("payer");
    PoolKey internal key;

    uint128 internal constant AMOUNT_IN = 1e15;

    function setUp() public {
        setUpV4();
        deploySettlement();
        (key,) = initNativePoolWithLiquidity(IHooks(address(hook)), 10 ether);
        vm.deal(payer, 1 ether);
    }

    // ------------------------------------------------------------------ I1, the positive path

    /// @notice Invariant I1. Through Uniswap's own router, the order's recipient, and nobody else,
    ///         receives the output; the payer pays exactly the order's amount; the executor and the
    ///         router end with nothing; the hook receipted one settlement; the order is Settled.
    function test_SettlementDeliversToTheRegisteredRecipient() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        uint256 merchantBefore = usdc.balanceOf(merchant);
        uint256 payerBefore = payer.balance;
        assertEq(address(executor).balance, 0);

        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);

        (uint256 receipts, uint256 amountOut) = receiptsEmitted();
        assertEq(receipts, 1, "exactly one receipt");
        assertGt(amountOut, 0, "no output");
        assertEq(usdc.balanceOf(merchant) - merchantBefore, amountOut, "recipient did not receive the receipted output");
        assertEq(usdc.balanceOf(payer), 0, "payer must not receive output");
        assertEq(usdc.balanceOf(address(executor)), 0, "executor must not keep output");
        assertEq(usdc.balanceOf(universalRouter), 0, "router must not keep output");
        assertEq(payerBefore - payer.balance, AMOUNT_IN, "payer paid something other than the order amount");
        assertEq(address(executor).balance, 0, "executor holds native value after settlement");
        assertEq(universalRouter.balance, 0, "router holds native value after settlement");
        assertEq(hook.receiptCount(), 1, "the hook did not receipt exactly one settlement");
        SettlementExecutor.Order memory o = executor.orders(orderId);
        assertEq(uint8(o.status), uint8(SettlementExecutor.Status.Settled));
        assertEq(o.payer, payer, "the payer was not recorded");
    }

    /// @notice Invariant I2. One receipt, from the hook, inside the settling swap: the order id, the
    ///         pool, the recipient, the authenticated payer (resolved through the router's msgSender
    ///         and the order, never from hook data), the amounts, and a zero fee. Beside it, exactly
    ///         one OpenZeppelin-standard HookFee, so a generic indexer sees the settlement too.
    function test_ReceiptCarriesTheOrderAndTheStandardEvent() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 receipts;
        uint256 fees;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(hook)) continue;
            if (logs[i].topics[0] == RECEIPT_TOPIC) {
                receipts++;
                assertEq(logs[i].topics[1], orderId, "receipt names another order");
                assertEq(logs[i].topics[2], PoolId.unwrap(key.toId()), "receipt names another pool");
                assertEq(address(uint160(uint256(logs[i].topics[3]))), merchant, "receipt names another recipient");
                (address p, uint128 amountIn, uint128 amountOut, uint128 fee) =
                    abi.decode(logs[i].data, (address, uint128, uint128, uint128));
                assertEq(p, payer, "receipt names another payer");
                assertEq(amountIn, AMOUNT_IN);
                assertEq(amountOut, usdc.balanceOf(merchant), "receipted output differs from what arrived");
                assertEq(fee, 0, "this hook takes no fee");
            } else if (logs[i].topics[0] == HOOK_FEE_TOPIC) {
                fees++;
                assertEq(logs[i].topics[1], PoolId.unwrap(key.toId()));
                assertEq(address(uint160(uint256(logs[i].topics[2]))), payer);
                (uint128 fee0, uint128 fee1) = abi.decode(logs[i].data, (uint128, uint128));
                assertEq(fee0, 0);
                assertEq(fee1, 0);
            }
        }
        assertEq(receipts, 1, "exactly one SettlementReceipt");
        assertEq(fees, 1, "exactly one HookFee");
    }

    /// @notice Every payment size the pool can fill is delivered once and receipted once. The upper
    ///         bound is below the ETH the liquidity band holds (about 6e15 wei for 1e18 liquidity at
    ///         plus or minus 120 ticks); a larger order is a partial fill, tested separately below.
    function testFuzz_EveryPaymentIsDeliveredOnce(uint128 amountIn) public {
        amountIn = uint128(bound(amountIn, 1e9, 5e15));
        bytes32 orderId = _order(amountIn, 1);
        uint256 merchantBefore = usdc.balanceOf(merchant);
        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: amountIn}(orderId);
        (uint256 receipts, uint256 amountOut) = receiptsEmitted();
        assertEq(receipts, 1);
        assertEq(usdc.balanceOf(merchant) - merchantBefore, amountOut);
        assertEq(address(executor).balance, 0);
        assertEq(universalRouter.balance, 0);
        assertEq(hook.receiptCount(), 1);
    }

    // ------------------------------------------------------------------ the order rules

    /// @notice Invariant I5 at the executor: one order settles at most once.
    function test_RevertWhen_OrderPaidTwice() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
        vm.expectRevert(
            abi.encodeWithSelector(SettlementExecutor.OrderNotOpen.selector, orderId, SettlementExecutor.Status.Settled)
        );
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
    }

    /// @notice Invariant I4 at the executor: an order cannot be paid past its deadline.
    function test_RevertWhen_OrderExpired() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        uint64 deadline = executor.orders(orderId).deadline;
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(SettlementExecutor.OrderExpired.selector, orderId, deadline));
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
    }

    /// @notice The payer must send exactly the order's amount; more or less is refused.
    function test_RevertWhen_ValueDiffersFromTheOrder() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        vm.expectRevert(abi.encodeWithSelector(SettlementExecutor.WrongValue.selector, AMOUNT_IN, AMOUNT_IN - 1));
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN - 1}(orderId);
        vm.expectRevert(abi.encodeWithSelector(SettlementExecutor.WrongValue.selector, AMOUNT_IN, AMOUNT_IN + 1));
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN + 1}(orderId);
    }

    /// @notice Invariant I6 at the HOOK: output below the order's minimum is refused inside the swap,
    ///         with the hook's own error, and the whole payment unwinds: the payer keeps the ETH, the
    ///         recipient receives nothing, the order stays payable, no receipt exists. The exact
    ///         output is measured first on a snapshot so the revert bytes are asserted exactly.
    function test_RevertWhen_OutputBelowMinimum_NothingMoves() public {
        uint256 snapshot = vm.snapshotState();
        bytes32 probe = _order(AMOUNT_IN, 1);
        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(probe);
        (, uint256 actualOut) = receiptsEmitted();
        vm.revertToState(snapshot);

        uint128 minOut = uint128(actualOut) + 1;
        bytes32 orderId = _order(AMOUNT_IN, minOut);
        uint256 payerBefore = payer.balance;
        vm.recordLogs();
        vm.expectRevert(
            _wrapped(
                IHooks.afterSwap.selector,
                abi.encodeWithSelector(
                    V4SettlementHook.OutputBelowMinimum.selector, orderId, minOut, uint128(actualOut)
                )
            )
        );
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
        _assertNothingMoved(orderId, payerBefore);
    }

    /// @notice Spec addendum A13 and invariant I6, now enforced by the HOOK: an order the pool cannot
    ///         fill in full is refused, never settled short. Found by the fuzzer on 2026-09-04 at
    ///         0.0428 ETH against a band holding about 0.006 ETH: the pool consumed
    ///         6,035,841,794,200,769 wei. Nothing moves and the order stays payable.
    function test_RevertWhen_PoolCannotFillTheOrder_NothingMoves() public {
        uint128 tooLarge = 42775716203246101;
        bytes32 orderId = _order(tooLarge, 1);
        uint256 payerBefore = payer.balance;
        vm.recordLogs();
        vm.expectRevert(
            _wrapped(
                IHooks.afterSwap.selector,
                abi.encodeWithSelector(
                    V4SettlementHook.PartialFill.selector, orderId, tooLarge, uint128(6035841794200769)
                )
            )
        );
        vm.prank(payer);
        executor.pay{value: tooLarge}(orderId);
        _assertNothingMoved(orderId, payerBefore);
    }

    function test_RevertWhen_OrderUnknown() public {
        bytes32 bogus = keccak256("no such order");
        vm.expectRevert(abi.encodeWithSelector(SettlementExecutor.UnknownOrder.selector, bogus));
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(bogus);
    }

    function test_RevertWhen_CreateOrderRejectsBadInputs() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        vm.expectRevert(SettlementExecutor.ZeroRecipient.selector);
        executor.createOrder(address(0), key, AMOUNT_IN, 1, deadline);
        vm.expectRevert(SettlementExecutor.ZeroAmount.selector);
        executor.createOrder(merchant, key, 0, 1, deadline);
        vm.expectRevert(SettlementExecutor.ZeroMinOut.selector);
        executor.createOrder(merchant, key, AMOUNT_IN, 0, deadline);
        vm.expectRevert(abi.encodeWithSelector(SettlementExecutor.DeadlineInPast.selector, uint64(block.timestamp)));
        executor.createOrder(merchant, key, AMOUNT_IN, 1, uint64(block.timestamp));
        PoolKey memory erc20In = key;
        erc20In.currency0 = usdcCurrency;
        vm.expectRevert(SettlementExecutor.NativeInputOnly.selector);
        executor.createOrder(merchant, erc20In, AMOUNT_IN, 1, deadline);
    }

    /// @notice The executor has no door to the PoolManager at all: it never unlocks, so it has no
    ///         unlock callback to guard. The official router owns that surface.
    function test_ExecutorHasNoUnlockCallback() public {
        (bool ok,) = address(executor).call(abi.encodeWithSignature("unlockCallback(bytes)", ""));
        assertFalse(ok, "the executor answered an unlock callback");
    }

    /// @notice The executor has no receive function: value can only arrive through pay.
    function test_RevertWhen_NativeSentDirectly() public {
        (bool ok,) = address(executor).call{value: 1}("");
        assertFalse(ok, "executor accepted a bare transfer");
        assertEq(address(executor).balance, 0);
    }

    /// @notice Order ids are bound to the chain and the executor and never repeat.
    function test_OrderIdsAreChainBoundAndUnique() public {
        bytes32 a = _order(AMOUNT_IN, 1);
        bytes32 b = _order(AMOUNT_IN, 1);
        assertTrue(a != b);
        assertEq(a, keccak256(abi.encode(block.chainid, address(executor), uint256(1))));
    }

    // ------------------------------------------------------------------ helpers

    function _order(uint128 amountIn, uint128 minOut) internal returns (bytes32) {
        vm.prank(merchant);
        return executor.createOrder(merchant, key, amountIn, minOut, uint64(block.timestamp + 1 hours));
    }

    function _assertNothingMoved(bytes32 orderId, uint256 payerBefore) internal {
        assertEq(payer.balance, payerBefore, "payer lost value on a refused payment");
        assertEq(usdc.balanceOf(merchant), 0, "recipient received output from a refused payment");
        assertEq(address(executor).balance, 0);
        assertEq(universalRouter.balance, 0);
        assertEq(
            uint8(executor.orders(orderId).status),
            uint8(SettlementExecutor.Status.Open),
            "a refused payment consumed the order"
        );
        assertEq(hook.receiptCount(), 0, "the hook receipted a refused settlement");
        (uint256 receipts,) = receiptsEmitted();
        assertEq(receipts, 0, "a receipt was emitted for a refused settlement");
    }

    function _wrapped(bytes4 callback, bytes memory reason) internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            CustomRevert.WrappedError.selector,
            address(hook),
            callback,
            reason,
            abi.encodeWithSelector(Hooks.HookCallFailed.selector)
        );
    }
}
