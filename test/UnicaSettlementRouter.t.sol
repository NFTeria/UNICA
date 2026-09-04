// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {UnicaTestBase} from "./utils/UnicaTestBase.sol";
import {UnicaSettlementRouter} from "../src/UnicaSettlementRouter.sol";

/// @title Tests for the settlement router: invariant I1's positive path and the order rules
/// @notice Every assertion is about SHAPE, never the implementation's arithmetic: who received, who
///         paid, that the router holds nothing, that the hook observed exactly one swap, and that
///         each refusal leaves the order settleable (invariant I6).
contract UnicaSettlementRouterTest is UnicaTestBase {
    address internal merchant = makeAddr("merchant");
    address internal payer = makeAddr("payer");
    PoolKey internal key;

    uint128 internal constant AMOUNT_IN = 1e15;

    function setUp() public {
        setUpV4();
        deployUnica();
        (key,) = initNativePoolWithLiquidity(IHooks(address(hook)), 10 ether);
        vm.deal(payer, 1 ether);
    }

    // ------------------------------------------------------------------ I1, the positive path

    /// @notice Invariant I1. The order's recipient, and nobody else, receives the output; the payer
    ///         pays exactly the order's amount; the router ends with nothing; the hook saw one swap.
    function test_SettlementDeliversToTheRegisteredRecipient() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        uint256 merchantBefore = usdc.balanceOf(merchant);
        uint256 payerBefore = payer.balance;
        assertEq(address(router).balance, 0);

        vm.recordLogs();
        vm.prank(payer);
        router.pay{value: AMOUNT_IN}(orderId);

        uint256 amountOut = _settledAmountOut();
        assertGt(amountOut, 0, "no output");
        assertEq(usdc.balanceOf(merchant) - merchantBefore, amountOut, "recipient did not receive the settled output");
        assertEq(usdc.balanceOf(payer), 0, "payer must not receive output");
        assertEq(usdc.balanceOf(address(router)), 0, "router must not keep output");
        assertEq(payerBefore - payer.balance, AMOUNT_IN, "payer paid something other than the order amount");
        assertEq(address(router).balance, 0, "router holds native value after settlement");
        assertEq(hook.afterSwapCount(), 1, "the hook did not observe exactly one swap");
        assertTrue(router.orders(orderId).settled);
    }

    /// @notice Every payment size the pool can fill is delivered once and observed once. The upper
    ///         bound is below the ETH the liquidity band holds (about 6e15 wei for 1e18 liquidity at
    ///         plus or minus 120 ticks); a larger order is a partial fill, tested separately below.
    function testFuzz_EveryPaymentIsDeliveredOnce(uint128 amountIn) public {
        amountIn = uint128(bound(amountIn, 1e9, 5e15));
        bytes32 orderId = _order(amountIn, 1);
        uint256 merchantBefore = usdc.balanceOf(merchant);
        vm.recordLogs();
        vm.prank(payer);
        router.pay{value: amountIn}(orderId);
        assertEq(usdc.balanceOf(merchant) - merchantBefore, _settledAmountOut());
        assertEq(address(router).balance, 0);
        assertEq(hook.afterSwapCount(), 1);
    }

    // ------------------------------------------------------------------ the order rules

    /// @notice Invariant I5: one order settles at most once.
    function test_RevertWhen_OrderPaidTwice() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        vm.prank(payer);
        router.pay{value: AMOUNT_IN}(orderId);
        vm.expectRevert(abi.encodeWithSelector(UnicaSettlementRouter.OrderAlreadySettled.selector, orderId));
        vm.prank(payer);
        router.pay{value: AMOUNT_IN}(orderId);
    }

    /// @notice Invariant I4: an order cannot be paid past its deadline.
    function test_RevertWhen_OrderExpired() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        uint64 deadline = router.orders(orderId).deadline;
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(UnicaSettlementRouter.OrderExpired.selector, orderId, deadline));
        vm.prank(payer);
        router.pay{value: AMOUNT_IN}(orderId);
    }

    /// @notice The payer must send exactly the order's amount; more or less is refused.
    function test_RevertWhen_ValueDiffersFromTheOrder() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        vm.expectRevert(abi.encodeWithSelector(UnicaSettlementRouter.WrongValue.selector, AMOUNT_IN, AMOUNT_IN - 1));
        vm.prank(payer);
        router.pay{value: AMOUNT_IN - 1}(orderId);
        vm.expectRevert(abi.encodeWithSelector(UnicaSettlementRouter.WrongValue.selector, AMOUNT_IN, AMOUNT_IN + 1));
        vm.prank(payer);
        router.pay{value: AMOUNT_IN + 1}(orderId);
    }

    /// @notice Invariant I3 at the router (the hook verifies from its own storage read from day 3),
    ///         and invariant I6 with it: output below the minimum reverts the whole payment, the
    ///         payer keeps the ETH, the recipient receives nothing, and the order stays payable.
    function test_RevertWhen_OutputBelowMinimum_NothingMoves() public {
        bytes32 orderId = _order(AMOUNT_IN, type(uint128).max);
        uint256 payerBefore = payer.balance;
        vm.expectRevert();
        vm.prank(payer);
        router.pay{value: AMOUNT_IN}(orderId);
        assertEq(payer.balance, payerBefore, "payer lost value on a refused payment");
        assertEq(usdc.balanceOf(merchant), 0, "recipient received output from a refused payment");
        assertFalse(router.orders(orderId).settled, "a refused payment consumed the order");
        assertEq(hook.afterSwapCount(), 0);
    }

    /// @notice Spec addendum A13 and invariant I6: an order the pool cannot fill in full is refused,
    ///         never settled short. Found by the fuzzer on 2026-09-04 at 0.0428 ETH against a band
    ///         holding about 0.006 ETH: the pool consumed 6,035,841,794,200,769 wei and the router
    ///         reverted with PartialFill. Nothing moves and the order stays payable.
    function test_RevertWhen_PoolCannotFillTheOrder_NothingMoves() public {
        uint128 tooLarge = 42775716203246101;
        bytes32 orderId = _order(tooLarge, 1);
        uint256 payerBefore = payer.balance;
        vm.expectRevert(abi.encodeWithSelector(UnicaSettlementRouter.PartialFill.selector, tooLarge, 6035841794200769));
        vm.prank(payer);
        router.pay{value: tooLarge}(orderId);
        assertEq(payer.balance, payerBefore);
        assertEq(usdc.balanceOf(merchant), 0);
        assertFalse(router.orders(orderId).settled);
    }

    function test_RevertWhen_OrderUnknown() public {
        bytes32 bogus = keccak256("no such order");
        vm.expectRevert(abi.encodeWithSelector(UnicaSettlementRouter.UnknownOrder.selector, bogus));
        vm.prank(payer);
        router.pay{value: AMOUNT_IN}(bogus);
    }

    function test_RevertWhen_CreateOrderRejectsBadInputs() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        vm.expectRevert(UnicaSettlementRouter.ZeroRecipient.selector);
        router.createOrder(address(0), key, AMOUNT_IN, 1, deadline);
        vm.expectRevert(UnicaSettlementRouter.ZeroAmount.selector);
        router.createOrder(merchant, key, 0, 1, deadline);
        vm.expectRevert(abi.encodeWithSelector(UnicaSettlementRouter.DeadlineInPast.selector, uint64(block.timestamp)));
        router.createOrder(merchant, key, AMOUNT_IN, 1, uint64(block.timestamp));
        PoolKey memory erc20In = key;
        erc20In.currency0 = usdcCurrency;
        vm.expectRevert(UnicaSettlementRouter.NativeInputOnly.selector);
        router.createOrder(merchant, erc20In, AMOUNT_IN, 1, deadline);
    }

    /// @notice Threat T1 at the router: only the PoolManager may enter the unlock callback.
    function test_RevertWhen_UnlockCallbackCalledDirectly() public {
        vm.expectRevert(abi.encodeWithSelector(UnicaSettlementRouter.NotPoolManager.selector, address(this)));
        router.unlockCallback(abi.encode(bytes32(0)));
    }

    /// @notice The router has no receive function: value can only arrive through pay.
    function test_RevertWhen_NativeSentDirectly() public {
        (bool ok,) = address(router).call{value: 1}("");
        assertFalse(ok, "router accepted a bare transfer");
        assertEq(address(router).balance, 0);
    }

    /// @notice Order ids are bound to the chain and the router and never repeat.
    function test_OrderIdsAreChainBoundAndUnique() public {
        bytes32 a = _order(AMOUNT_IN, 1);
        bytes32 b = _order(AMOUNT_IN, 1);
        assertTrue(a != b);
        assertEq(a, keccak256(abi.encode(block.chainid, address(router), uint256(1))));
    }

    // ------------------------------------------------------------------ helpers

    function _order(uint128 amountIn, uint128 minOut) internal returns (bytes32) {
        vm.prank(merchant);
        return router.createOrder(merchant, key, amountIn, minOut, uint64(block.timestamp + 1 hours));
    }

    /// @dev The amountOut the router itself reported in its Settled event, read from the logs.
    function _settledAmountOut() internal returns (uint256 amountOut) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("Settled(bytes32,address,address,uint256,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(router) && logs[i].topics[0] == topic) {
                (, amountOut) = abi.decode(logs[i].data, (uint256, uint256));
                return amountOut;
            }
        }
        revert("no Settled event");
    }
}
