// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IProtocolFees} from "@uniswap/v4-core/src/interfaces/IProtocolFees.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {UnicaMarketTypes} from "../../../src/unica-v4/UnicaMarketTypes.sol";
import {UnicaMarketHook} from "../../../src/unica-v4/UnicaMarketHook.sol";
import {UnicaMarketExecutor} from "../../../src/unica-v4/UnicaMarketExecutor.sol";
import {IUnicaMarketHook} from "../../../src/unica-v4/interfaces/IUnicaMarketHook.sol";
import {IUnicaMarketExecutor} from "../../../src/unica-v4/interfaces/IUnicaMarketExecutor.sol";
import {UnicaV4TestBase} from "../util/UnicaV4TestBase.sol";

/// @title Settlement rows — what a UNICA v4 payment is, and every way it is refused
/// @notice TEST-MATRIX rows X1 to X19, H5, H5b, H7 to H10, H12a to H12c, EV5 and EV9.
///         Every negative row here reproduces the attack's precondition and stands beside a control
///         that settles, and every one of them asserts the exact custom error with its arguments —
///         through the PoolManager's `WrappedError` envelope where the refusal is the hook's.
contract SettlementTest is UnicaV4TestBase {
    /// @dev The frozen shapes (EVENT-SCHEMA §6). Written out as strings rather than imported so a
    ///      change to the event declaration is caught by a mismatch here instead of being carried
    ///      along by a shared constant.
    bytes32 internal constant ORDER_CREATED_TOPIC =
        keccak256("OrderCreated(bytes32,address,address,address,uint128,uint128,uint64)");
    bytes32 internal constant SETTLED_TOPIC =
        keccak256("Settled(bytes32,address,address,address,address,uint256,uint256)");
    bytes32 internal constant RECEIPT_TOPIC = keccak256(
        "SettlementReceipt(bytes32,address,address,bytes32,address,address,uint128,uint128,uint24,uint24,uint24,uint24,uint256,uint8,uint64,bool)"
    );
    bytes32 internal constant SWAP_TOPIC =
        keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");

    MarketSpec internal spec;
    Market internal market;

    function setUp() public {
        setUpBase();
        spec = defaultSpec();
        market = deployMarket(spec);
    }

    // ---- X1: the control everything else is measured against --------------------------------------

    function test_X1_settlesAndTheThreeRecordsAgree() public {
        uint128 amountIn = 1e18;
        uint256 expectedOut = quote(market, amountIn);
        assertGt(expectedOut, 0, "the pool quoted nothing");

        bytes32 orderId = createOrder(market, amountIn, uint128(expectedOut), "x1");
        fundPayer(market, payer, amountIn);

        uint256 merchantBefore = market.payout.balanceOf(merchant);

        vm.recordLogs();
        vm.prank(payer);
        market.executor.pay(orderId);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 delivered = market.payout.balanceOf(merchant) - merchantBefore;
        assertGe(delivered, expectedOut, "merchant received less than minOut");

        // Exactly one receipt and exactly one Settled, in this transaction, from this market.
        assertEq(countLogs(logs, address(market.hook), RECEIPT_TOPIC), 1, "not exactly one receipt");
        assertEq(countLogs(logs, address(market.executor), SETTLED_TOPIC), 1, "not exactly one Settled");
        assertEq(market.hook.receiptCount(), 1, "receiptCount did not move by one");

        // EV5: Settled is the LAST of the two, because it is the success signal.
        int256 receiptAt = indexOfLog(logs, address(market.hook), RECEIPT_TOPIC);
        int256 settledAt = indexOfLog(logs, address(market.executor), SETTLED_TOPIC);
        assertGt(settledAt, receiptAt, "Settled did not come after the receipt");
        assertEq(uint256(settledAt), logs.length - 1, "Settled was not the last log of the payment");

        // The two records agree with each other and with the balance change.
        (uint128 receiptIn, uint128 receiptOut) = _receiptAmounts(logs, address(market.hook));
        (uint256 settledIn, uint256 settledDelivered) = _settledAmounts(logs, address(market.executor));
        assertEq(receiptIn, amountIn, "receipt amountIn");
        assertEq(uint256(receiptOut), delivered, "receipt amountOut vs the balance change");
        assertEq(settledIn, amountIn, "Settled amountIn");
        assertEq(settledDelivered, delivered, "Settled amountDelivered vs the balance change");

        // Nothing is left behind on the executor, in either token.
        assertEq(market.asset.balanceOf(address(market.executor)), 0, "executor kept input");
        assertEq(market.payout.balanceOf(address(market.executor)), 0, "executor kept payout");

        assertEq(uint8(market.executor.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Settled));
    }

    /// @notice X1, the other ordering: the same claims with the asset as currency1.
    function test_X1b_settlesInTheMirroredOrdering() public {
        MarketSpec memory mirrored = mirroredSpec();
        Market memory m = deployMarket(mirrored);

        uint128 amountIn = 1e6; // one whole 6-decimal asset
        uint256 expectedOut = quote(m, amountIn);
        bytes32 orderId = createOrder(m, amountIn, uint128(expectedOut), "x1b");
        fundPayer(m, payer, amountIn);

        uint256 before = m.payout.balanceOf(merchant);
        vm.prank(payer);
        m.executor.pay(orderId);

        assertEq(m.payout.balanceOf(merchant) - before, expectedOut, "mirrored delivery");
        assertEq(m.asset.balanceOf(address(m.executor)), 0, "executor kept input");
        assertEq(m.payout.balanceOf(address(m.executor)), 0, "executor kept payout");
    }

    // ---- X2: the payer binding ----------------------------------------------------------------------

    function test_X2_wrongPayerRefused_andTheBoundPayerSettles() public {
        uint128 amountIn = 1e18;
        bytes32 orderId = createOrder(market, amountIn, 1, "x2");

        // The precondition that makes this a real attack: the wrong payer is funded AND approved, so
        // nothing but the binding stops it.
        fundPayer(market, stranger, amountIn * 10);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.WrongPayer.selector, orderId, payer, stranger));
        market.executor.pay(orderId);

        // Control: the bound payer settles the very same order.
        fundPayer(market, payer, amountIn);
        vm.prank(payer);
        market.executor.pay(orderId);
        assertEq(uint8(market.executor.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Settled));
    }

    // ---- X3: the merchant binding ---------------------------------------------------------------------

    function test_X3_reservedAndZeroRecipientsRefused() public {
        address[7] memory reserved = [
            address(market.executor),
            address(market.hook),
            address(manager),
            address(market.asset),
            address(market.payout),
            address(registry),
            registry.FACTORY()
        ];
        for (uint256 i; i < reserved.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.ReservedRecipient.selector, reserved[i]));
            market.executor.createOrder(reserved[i], payer, 1e18, 1, uint64(block.timestamp + 1), bytes32(i));
        }

        vm.expectRevert(UnicaMarketExecutor.ZeroRecipient.selector);
        market.executor.createOrder(address(0), payer, 1e18, 1, uint64(block.timestamp + 1), "zero");

        // Control: the named recipient receives, and neither the payer nor the caller does.
        uint128 amountIn = 1e18;
        bytes32 orderId = createOrder(market, amountIn, 1, "x3");
        fundPayer(market, payer, amountIn);
        uint256 payerPayoutBefore = market.payout.balanceOf(payer);
        uint256 callerPayoutBefore = market.payout.balanceOf(address(this));
        uint256 merchantBefore = market.payout.balanceOf(merchant);

        vm.prank(payer);
        market.executor.pay(orderId);

        assertGt(market.payout.balanceOf(merchant), merchantBefore, "merchant was not paid");
        assertEq(market.payout.balanceOf(payer), payerPayoutBefore, "payer received payout");
        assertEq(market.payout.balanceOf(address(this)), callerPayoutBefore, "creator received payout");
    }

    // ---- X4: replay ------------------------------------------------------------------------------------

    function test_X4_replayRefusedThreeWays() public {
        uint128 amountIn = 1e18;
        bytes32 orderId = createOrder(market, amountIn, 1, "x4");

        // Same creator, same salt: the id is already taken.
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.OrderExists.selector, orderId));
        market.executor.createOrder(merchant, payer, amountIn, 1, uint64(block.timestamp + 1 hours), "x4");

        fundPayer(market, payer, amountIn * 2);
        vm.prank(payer);
        market.executor.pay(orderId);

        // A second payment of a settled order.
        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(
                UnicaMarketExecutor.OrderNotOpen.selector, orderId, uint8(UnicaMarketTypes.OrderStatus.Settled)
            )
        );
        market.executor.pay(orderId);

        // An id that was never created here.
        bytes32 unknown = keccak256("never created");
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.UnknownOrder.selector, unknown));
        market.executor.pay(unknown);

        // Control: a different creator with the same salt gets a distinct id.
        registry.setOrderCreator(stranger, true);
        vm.prank(stranger);
        bytes32 other = market.executor.createOrder(merchant, payer, amountIn, 1, uint64(block.timestamp + 1), "x4");
        assertTrue(other != orderId, "the same salt from a different creator collided");
    }

    // ---- X5: the minOut boundary --------------------------------------------------------------------

    function test_X5_minOutBoundaryPassesAndOneMoreRefuses() public {
        uint128 amountIn = 1e18;
        uint256 produced = quote(market, amountIn);

        // One raw unit above what the pool will give: the hook's own floor, not the executor's.
        bytes32 tooHigh = createOrder(market, amountIn, uint128(produced + 1), "x5-high");
        fundPayer(market, payer, amountIn * 2);
        vm.prank(payer);
        expectWrappedHookRevert(
            address(market.hook),
            abi.encodeWithSelector(
                UnicaMarketHook.OutputBelowMinimum.selector, tooHigh, uint128(produced + 1), uint128(produced)
            )
        );
        market.executor.pay(tooHigh);

        // Control: exactly what the pool gives passes.
        bytes32 exact = createOrder(market, amountIn, uint128(produced), "x5-exact");
        uint256 before = market.payout.balanceOf(merchant);
        vm.prank(payer);
        market.executor.pay(exact);
        assertEq(market.payout.balanceOf(merchant) - before, produced, "boundary minOut did not settle exactly");
    }

    // ---- X6: the lifecycle gate ---------------------------------------------------------------------

    function test_X6_pausedAndRetiredRefuse_andRetiredNeverComesBack() public {
        uint128 amountIn = 1e18;
        bytes32 openBeforePause = createOrder(market, amountIn, 1, "x6");
        fundPayer(market, payer, amountIn * 2);

        registry.pause(market.marketId);
        uint8 paused = uint8(UnicaMarketTypes.MarketStatus.PAUSED);

        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.MarketNotActive.selector, market.marketId, paused));
        market.executor.createOrder(merchant, payer, amountIn, 1, uint64(block.timestamp + 1), "x6b");

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.MarketNotActive.selector, market.marketId, paused));
        market.executor.pay(openBeforePause);

        // Control: unpause, and the order created before the pause is payable again.
        registry.unpause(market.marketId);
        vm.prank(payer);
        market.executor.pay(openBeforePause);
        assertEq(uint8(market.executor.orders(openBeforePause).status), uint8(UnicaMarketTypes.OrderStatus.Settled));

        // RETIRED, and it is terminal: the registry refuses every way back.
        bytes32 afterRetire = createOrder(market, amountIn, 1, "x6c");
        registry.retire(market.marketId);
        uint8 retired = uint8(UnicaMarketTypes.MarketStatus.RETIRED);

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.MarketNotActive.selector, market.marketId, retired));
        market.executor.pay(afterRetire);

        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketRegistryErrors.WrongMarketStatus.selector, market.marketId, retired)
        );
        registry.activate(market.marketId);
        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketRegistryErrors.WrongMarketStatus.selector, market.marketId, retired)
        );
        registry.unpause(market.marketId);
        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketRegistryErrors.WrongMarketStatus.selector, market.marketId, retired)
        );
        registry.pause(market.marketId);
    }

    // ---- X7: the creator allowlist -------------------------------------------------------------------

    function test_X7_strangerCannotCreate_andARevokedCreatorsOrdersStayPayable() public {
        // The precondition: the stranger holds the asset and a maximal approval on an ACTIVE market.
        fundPayer(market, stranger, 10e18);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.NotOrderCreator.selector, stranger));
        market.executor.createOrder(stranger, stranger, 10e18, 1, uint64(block.timestamp + 1), "x7");

        // Control: an allowlisted creator's order settles, and revoking that creator afterwards stops
        // new orders without trapping the one that exists. The creator here is NOT the admin, because
        // the admin is implicitly a creator and revoking it would prove nothing.
        address creator = makeAddr("invited creator");
        registry.setOrderCreator(creator, true);

        uint128 amountIn = 1e18;
        vm.prank(creator);
        bytes32 orderId =
            market.executor.createOrder(merchant, payer, amountIn, 1, uint64(block.timestamp + 1 hours), "x7-ok");

        registry.setOrderCreator(creator, false);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.NotOrderCreator.selector, creator));
        market.executor.createOrder(merchant, payer, amountIn, 1, uint64(block.timestamp + 1 hours), "x7-after");

        fundPayer(market, payer, amountIn);
        vm.prank(payer);
        market.executor.pay(orderId);
        assertEq(uint8(market.executor.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Settled));
    }

    // ---- X8: what the input token is allowed to do ------------------------------------------------------

    function test_X8_feeOnTransferInputRefused_andTheSameOrderSettlesWithTheFeeOff() public {
        uint128 amountIn = 1e18;
        bytes32 orderId = createOrder(market, amountIn, 1, "x8");
        fundPayer(market, payer, amountIn * 2);

        // The token keeps 1% of every transferFrom while reporting success.
        HostileToken hostile = new HostileToken("h", "H", 18);
        vm.etch(address(market.asset), address(hostile).code);
        HostileToken(address(market.asset)).setFeeBps(100);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketExecutor.InputNotExact.selector, amountIn, uint256(amountIn - 1e16))
        );
        market.executor.pay(orderId);

        // Control: the same order, the same everything, with the fee switched off.
        HostileToken(address(market.asset)).setFeeBps(0);
        vm.prank(payer);
        market.executor.pay(orderId);
        assertEq(uint8(market.executor.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Settled));
    }

    function test_X8b_aTokenThatReportsFailureIsRefusedByName() public {
        uint128 amountIn = 1e18;
        bytes32 orderId = createOrder(market, amountIn, 1, "x8b");
        fundPayer(market, payer, amountIn * 2);

        HostileToken hostile = new HostileToken("h", "H", 18);
        vm.etch(address(market.asset), address(hostile).code);
        HostileToken(address(market.asset)).setReturnFalse(true);

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.TransferFailed.selector, address(market.asset)));
        market.executor.pay(orderId);

        HostileToken(address(market.asset)).setReturnFalse(false);
        vm.prank(payer);
        market.executor.pay(orderId);
        assertEq(uint8(market.executor.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Settled));
    }

    // ---- X10, X11: deadlines and allowances ---------------------------------------------------------------

    function test_X10_expiredOrderRefused_andAFreshOneSettles() public {
        uint128 amountIn = 1e18;
        bytes32 orderId = market.executor.createOrder(merchant, payer, amountIn, 1, uint64(block.timestamp + 10), "x10");
        fundPayer(market, payer, amountIn * 2);

        vm.warp(block.timestamp + 11);
        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketExecutor.OrderExpired.selector, orderId, uint64(block.timestamp - 1))
        );
        market.executor.pay(orderId);

        bytes32 fresh = createOrder(market, amountIn, 1, "x10-fresh");
        vm.prank(payer);
        market.executor.pay(fresh);
        assertEq(uint8(market.executor.orders(fresh).status), uint8(UnicaMarketTypes.OrderStatus.Settled));
    }

    function test_X11_deadlineInPastAndAllowanceTooLow() public {
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.DeadlineInPast.selector, uint64(block.timestamp)));
        market.executor.createOrder(merchant, payer, 1e18, 1, uint64(block.timestamp), "x11");

        uint128 amountIn = 1e18;
        bytes32 orderId = createOrder(market, amountIn, 1, "x11b");
        market.asset.mint(payer, amountIn);
        vm.prank(payer);
        market.asset.approve(address(market.executor), amountIn - 1);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(
                UnicaMarketExecutor.AllowanceTooLow.selector, payer, uint256(amountIn - 1), uint256(amountIn)
            )
        );
        market.executor.pay(orderId);

        // Control: one more unit of allowance and the same order settles.
        vm.prank(payer);
        market.asset.approve(address(market.executor), amountIn);
        vm.prank(payer);
        market.executor.pay(orderId);
        assertEq(uint8(market.executor.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Settled));
    }

    // ---- X13: the argument bounds ------------------------------------------------------------------------

    function test_X13_zerosAndTheAmountCeiling() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        uint128 ceiling = uint128(uint128(type(int128).max));

        vm.expectRevert(UnicaMarketExecutor.ZeroPayer.selector);
        market.executor.createOrder(merchant, address(0), 1e18, 1, deadline, "a");

        vm.expectRevert(UnicaMarketExecutor.ZeroAmount.selector);
        market.executor.createOrder(merchant, payer, 0, 1, deadline, "b");

        vm.expectRevert(UnicaMarketExecutor.ZeroMinOut.selector);
        market.executor.createOrder(merchant, payer, 1e18, 0, deadline, "c");

        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.AmountTooLarge.selector, uint256(ceiling) + 1));
        market.executor.createOrder(merchant, payer, ceiling + 1, 1, deadline, "d");

        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.AmountTooLarge.selector, uint256(ceiling) + 1));
        market.executor.createOrder(merchant, payer, 1e18, ceiling + 1, deadline, "e");

        // Control: the ceiling itself passes validation, and a non-zero payer is accepted.
        bytes32 ok = market.executor.createOrder(merchant, payer, ceiling, 1, deadline, "f");
        assertEq(market.executor.orders(ok).amountIn, ceiling, "the ceiling was refused");
    }

    // ---- X15: no receipt, no settlement ---------------------------------------------------------------------

    /// @dev The matrix's own X15 is a hook MUTANT that skips the receipt, which belongs to the
    ///      mutation suite rather than here. What this row proves is the executor's side of the same
    ///      claim: if the hook's counter does not move, `pay` refuses by name and nothing settles. The
    ///      counter is mocked for exactly one call, which is the cheapest faithful stand-in for a hook
    ///      that ran without receipting.
    function test_X15_aPaymentWithoutANewReceiptIsRefused() public {
        uint128 amountIn = 1e18;
        bytes32 orderId = createOrder(market, amountIn, 1, "x15");
        fundPayer(market, payer, amountIn * 2);

        vm.mockCall(
            address(market.hook), abi.encodeWithSelector(IUnicaMarketHook.receiptCount.selector), abi.encode(uint256(0))
        );
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.NoReceipt.selector, orderId));
        market.executor.pay(orderId);
        vm.clearMockedCalls();

        // Control: with the real counter, the same order settles.
        vm.prank(payer);
        market.executor.pay(orderId);
        assertEq(market.hook.receiptCount(), 1, "the control did not receipt");
    }

    // ---- X19: a drained seed --------------------------------------------------------------------------------

    function test_X19_aDrainedSeedRefusesAndChangesNoBalance() public {
        uint128 amountIn = 1e18;
        uint256 produced = quote(market, amountIn);
        bytes32 orderId = createOrder(market, amountIn, uint128(produced), "x19");
        fundPayer(market, payer, amountIn);

        drainSeed(market, spec, seedLiquidityOf(market, spec));

        uint256 payerBefore = market.asset.balanceOf(payer);
        uint256 merchantBefore = market.payout.balanceOf(merchant);

        vm.prank(payer);
        vm.expectRevert(); // a named refusal from the hook, decoded below
        market.executor.pay(orderId);

        assertEq(market.asset.balanceOf(payer), payerBefore, "the payer's input moved");
        assertEq(market.payout.balanceOf(merchant), merchantBefore, "the merchant's balance moved");
        assertEq(uint8(market.executor.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Open));

        // The refusal is named, not bare: with no depth at all the pool consumes nothing.
        vm.prank(payer);
        expectWrappedHookRevert(
            address(market.hook),
            abi.encodeWithSelector(UnicaMarketHook.PartialFill.selector, orderId, amountIn, uint128(0))
        );
        market.executor.pay(orderId);
    }

    // ---- H5, H5b: only the executor swaps -------------------------------------------------------------------

    function test_H5_directSwapThroughARouterIsRefused() public {
        market.asset.mint(address(this), 10e18);
        market.asset.approve(address(swapRouter), type(uint256).max);
        market.payout.approve(address(swapRouter), type(uint256).max);

        expectWrappedBeforeSwapRevert(
            address(market.hook),
            abi.encodeWithSelector(UnicaMarketHook.NotSettlementExecutor.selector, address(swapRouter))
        );
        swapRouter.swap(
            market.key,
            SwapParams({
                zeroForOne: market.assetIsCurrency0,
                amountSpecified: -1e18,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        // Control: the same amount through the executor settles.
        bytes32 orderId = createOrder(market, 1e18, 1, "h5");
        fundPayer(market, payer, 1e18);
        vm.prank(payer);
        market.executor.pay(orderId);
        assertEq(market.hook.receiptCount(), 1);
    }

    function test_H5b_aRawUnlockIsRefused() public {
        RawSwapper raw = new RawSwapper(manager);
        expectWrappedBeforeSwapRevert(
            address(market.hook), abi.encodeWithSelector(UnicaMarketHook.NotSettlementExecutor.selector, address(raw))
        );
        raw.swap(market.key, market.assetIsCurrency0, 1e18);
    }

    // ---- H7 to H9: the hook's own before-swap rules ----------------------------------------------------------

    /// @dev These need a caller at the EXECUTOR address that will swap on demand, because the real
    ///      executor never presents malformed hook data or mismatched parameters. The harness is
    ///      etched over the executor in this test's own state, so no other row sees it. Its storage
    ///      is written after the etch, so it never reads a slot the executor wrote.
    function test_H7_H8_H9_theHookRefusesEveryMalformedSwap() public {
        ExecutorHarness template = new ExecutorHarness();
        address executorAddr = address(market.executor);
        vm.etch(executorAddr, address(template).code);
        ExecutorHarness harness = ExecutorHarness(executorAddr);
        harness.configure(manager, market.key);

        market.asset.mint(executorAddr, 100e18);

        UnicaMarketTypes.Order memory order = UnicaMarketTypes.Order({
            recipient: merchant,
            creator: address(this),
            payer: payer,
            amountIn: 1e18,
            minOut: 1,
            deadline: uint64(block.timestamp + 1 hours),
            status: UnicaMarketTypes.OrderStatus.Paying
        });
        harness.setOrder(order);

        bytes32 orderId = keccak256("harness order");

        // H7: hook data that is not exactly one order id.
        expectWrappedBeforeSwapRevert(
            address(market.hook), abi.encodeWithSelector(UnicaMarketHook.MalformedHookData.selector, uint256(31))
        );
        harness.swapRaw(market.assetIsCurrency0, -int256(uint256(order.amountIn)), hex"00", 31);

        // H8: the wrong direction, then the wrong amount.
        expectWrappedBeforeSwapRevert(
            address(market.hook), abi.encodeWithSelector(UnicaMarketHook.ParamsDoNotMatchOrder.selector, orderId)
        );
        harness.swap(!market.assetIsCurrency0, -int256(uint256(order.amountIn)), orderId);

        expectWrappedBeforeSwapRevert(
            address(market.hook), abi.encodeWithSelector(UnicaMarketHook.ParamsDoNotMatchOrder.selector, orderId)
        );
        harness.swap(market.assetIsCurrency0, -int256(uint256(order.amountIn)) - 1, orderId);

        // H9a: an order that is Open rather than in flight.
        order.status = UnicaMarketTypes.OrderStatus.Open;
        harness.setOrder(order);
        expectWrappedBeforeSwapRevert(
            address(market.hook),
            abi.encodeWithSelector(
                UnicaMarketHook.OrderNotInFlight.selector, orderId, uint8(UnicaMarketTypes.OrderStatus.Open)
            )
        );
        harness.swap(market.assetIsCurrency0, -int256(uint256(order.amountIn)), orderId);

        // H9b: past its deadline.
        order.status = UnicaMarketTypes.OrderStatus.Paying;
        order.deadline = uint64(block.timestamp - 1);
        harness.setOrder(order);
        expectWrappedBeforeSwapRevert(
            address(market.hook), abi.encodeWithSelector(UnicaMarketHook.OrderExpired.selector, orderId, order.deadline)
        );
        harness.swap(market.assetIsCurrency0, -int256(uint256(order.amountIn)), orderId);

        // H9c: two swaps of one in-flight order inside a single transaction.
        order.deadline = uint64(block.timestamp + 1 hours);
        harness.setOrder(order);
        expectWrappedBeforeSwapRevert(
            address(market.hook), abi.encodeWithSelector(UnicaMarketHook.OrderAlreadySwapped.selector, orderId)
        );
        harness.swapTwice(market.assetIsCurrency0, -int256(uint256(order.amountIn)), orderId);

        // Control: one swap of a Paying order with matching parameters is admitted and receipts once.
        harness.swap(market.assetIsCurrency0, -int256(uint256(order.amountIn)), orderId);
        assertEq(market.hook.receiptCount(), 1, "the control swap did not receipt");
    }

    // ---- H10: a partial fill is never a settlement --------------------------------------------------------------

    function test_H10_anOrderLargerThanTheDepthIsARefusal() public {
        MarketSpec memory thin = defaultSpec();
        thin.tickSpacing = SPACING_10;
        thin.seedSteps = 20;
        thin.seedAssetWhole = 1;
        thin.seedPayoutWhole = 1;
        Market memory m = deployMarket(thin);

        uint128 huge = 1e30;
        bytes32 orderId = createOrder(m, huge, 1, "h10");
        fundPayer(m, payer, huge);

        vm.prank(payer);
        vm.expectRevert(); // decoded on the retry below
        m.executor.pay(orderId);

        // The refusal is `PartialFill` from the hook, with the amount the pool actually consumed.
        uint256 snap = vm.snapshotState();
        vm.prank(payer);
        try m.executor.pay(orderId) {
            revert("the oversized order settled");
        } catch (bytes memory err) {
            (bytes4 inner, bytes memory reason) = _unwrapHookError(err);
            assertEq(inner, UnicaMarketHook.PartialFill.selector, "not PartialFill");
            (bytes32 id, uint128 expected, uint128 consumed) = abi.decode(reason, (bytes32, uint128, uint128));
            assertEq(id, orderId);
            assertEq(expected, huge);
            assertLt(consumed, huge, "the pool consumed the whole order");
        }
        vm.revertToState(snap);

        // Control: an order inside the seed settles.
        uint128 small = 1e14;
        bytes32 ok = createOrder(m, small, 1, "h10-ok");
        fundPayer(m, payer, small);
        vm.prank(payer);
        m.executor.pay(ok);
        assertEq(m.hook.receiptCount(), 1);
    }

    // ---- H12a to H12c, EV5: the four fee fields -------------------------------------------------------------------

    function test_H12a_receiptFeeTupleWithNoProtocolFee() public {
        (uint24 lp, uint24 proto, uint24 swapFee, uint24 swapEventFee) = _settleAndReadFees(market, 1e18);
        assertEq(lp, 3000, "lpFeePips");
        assertEq(proto, 0, "protocolFeePips");
        assertEq(swapFee, 3000, "swapFeePips");
        assertEq(swapFee, swapEventFee, "swapFeePips != the same transaction's Swap.fee");
    }

    function test_H12b_assetIsCurrency0_takesTheLowTwelveBits() public {
        IProtocolFees(address(manager)).setProtocolFeeController(address(this));
        IProtocolFees(address(manager)).setProtocolFee(market.key, uint24(500 | (uint24(1000) << 12)));

        uint256 accruedBefore = IProtocolFees(address(manager)).protocolFeesAccrued(market.key.currency0);
        (uint24 lp, uint24 proto, uint24 swapFee, uint24 swapEventFee) = _settleAndReadFees(market, 1e18);

        assertEq(lp, 3000, "lpFeePips");
        assertEq(proto, 500, "protocolFeePips");
        assertEq(swapFee, 3499, "swapFeePips");
        assertEq(swapFee, swapEventFee, "swapFeePips != Swap.fee");
        assertGt(
            IProtocolFees(address(manager)).protocolFeesAccrued(market.key.currency0),
            accruedBefore,
            "no protocol fee was actually charged on the input"
        );
    }

    function test_H12c_assetIsCurrency1_takesTheHighTwelveBits() public {
        Market memory m = deployMarket(mirroredSpec());
        IProtocolFees(address(manager)).setProtocolFeeController(address(this));
        IProtocolFees(address(manager)).setProtocolFee(m.key, uint24(500 | (uint24(1000) << 12)));

        // The asset is currency1, so the input currency is currency1.
        uint256 accruedBefore = IProtocolFees(address(manager)).protocolFeesAccrued(m.key.currency1);
        (uint24 lp, uint24 proto, uint24 swapFee, uint24 swapEventFee) = _settleAndReadFees(m, 1e6);

        assertEq(lp, 3000, "lpFeePips");
        assertEq(proto, 1000, "protocolFeePips");
        assertEq(swapFee, 3997, "swapFeePips");
        assertEq(swapFee, swapEventFee, "swapFeePips != Swap.fee");
        assertGt(
            IProtocolFees(address(manager)).protocolFeesAccrued(m.key.currency1),
            accruedBefore,
            "no protocol fee was actually charged on the input"
        );
    }

    // ---- EV9: the frozen topics ----------------------------------------------------------------------------------

    function test_EV9_topicsMatchTheFrozenShapes() public view {
        assertEq(IUnicaMarketExecutor.OrderCreated.selector, ORDER_CREATED_TOPIC, "OrderCreated topic0 drifted");
        assertEq(IUnicaMarketExecutor.Settled.selector, SETTLED_TOPIC, "Settled topic0 drifted");
        assertEq(IUnicaMarketHook.SettlementReceipt.selector, RECEIPT_TOPIC, "SettlementReceipt topic0 drifted");
        // The hook writes its receipt with `log4`, so the constant it uses has to be the declaration's.
        assertEq(
            market.hook.SETTLEMENT_RECEIPT_TOPIC(),
            IUnicaMarketHook.SettlementReceipt.selector,
            "the hook's log4 topic is not the declared event"
        );
        assertTrue(RECEIPT_TOPIC != SETTLED_TOPIC && RECEIPT_TOPIC != ORDER_CREATED_TOPIC);
    }

    // ---- EV5: a refusal leaves no trace --------------------------------------------------------------------------

    function test_EV5_aRefusedPaymentLeavesNoReceiptAndNoLog() public {
        uint128 amountIn = 1e18;
        uint256 produced = quote(market, amountIn);
        bytes32 orderId = createOrder(market, amountIn, uint128(produced + 1), "ev5");
        fundPayer(market, payer, amountIn);

        vm.recordLogs();
        vm.prank(payer);
        try market.executor.pay(orderId) {
            revert("the refused payment settled");
        } catch {}
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(countLogs(logs, address(market.hook), RECEIPT_TOPIC), 0, "a receipt survived a refusal");
        assertEq(countLogs(logs, address(market.executor), SETTLED_TOPIC), 0, "a Settled survived a refusal");
        assertEq(market.hook.receiptCount(), 0, "receiptCount moved on a refusal");
    }

    // ---- helpers ---------------------------------------------------------------------------------------------------

    function _settleAndReadFees(Market memory m, uint128 amountIn)
        private
        returns (uint24 lpFee, uint24 protocolFee, uint24 swapFee, uint24 swapEventFee)
    {
        bytes32 orderId = createOrder(m, amountIn, 1, keccak256(abi.encode("fees", amountIn)));
        fundPayer(m, payer, amountIn);

        vm.recordLogs();
        vm.prank(payer);
        m.executor.pay(orderId);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        int256 at = indexOfLog(logs, address(m.hook), RECEIPT_TOPIC);
        require(at >= 0, "no receipt");
        (,,,,, uint24 hookFee, uint24 lp, uint24 proto, uint24 swap) = abi.decode(
            logs[uint256(at)].data, (bytes32, address, address, uint128, uint128, uint24, uint24, uint24, uint24)
        );
        assertEq(hookFee, 0, "the hook reported a fee of its own");
        (lpFee, protocolFee, swapFee) = (lp, proto, swap);

        int256 swapAt = indexOfLog(logs, address(manager), SWAP_TOPIC);
        require(swapAt >= 0, "no Swap event");
        (,,,,, swapEventFee) = abi.decode(logs[uint256(swapAt)].data, (int128, int128, uint160, uint128, int24, uint24));
    }

    function _receiptAmounts(Vm.Log[] memory logs, address hook)
        private
        pure
        returns (uint128 amountIn, uint128 amountOut)
    {
        int256 at = indexOfLog(logs, hook, RECEIPT_TOPIC);
        require(at >= 0, "no receipt");
        (,,, amountIn, amountOut) = abi.decode(logs[uint256(at)].data, (bytes32, address, address, uint128, uint128));
    }

    function _settledAmounts(Vm.Log[] memory logs, address executor)
        private
        pure
        returns (uint256 amountIn, uint256 delivered)
    {
        int256 at = indexOfLog(logs, executor, SETTLED_TOPIC);
        require(at >= 0, "no Settled");
        (,, amountIn, delivered) = abi.decode(logs[uint256(at)].data, (address, address, uint256, uint256));
    }

    /// @dev Pulls the hook's own selector and arguments out of the PoolManager's `WrappedError`.
    function _unwrapHookError(bytes memory err) internal pure returns (bytes4 innerSelector, bytes memory reason) {
        bytes memory payload = new bytes(err.length - 4);
        for (uint256 i; i < payload.length; ++i) {
            payload[i] = err[i + 4];
        }
        (, bytes4 selector, bytes memory inner,) = abi.decode(payload, (address, bytes4, bytes, bytes));
        selector; // the callback the PoolManager was in; the row that cares asserts it separately
        innerSelector = bytes4(inner);
        reason = new bytes(inner.length - 4);
        for (uint256 i; i < reason.length; ++i) {
            reason[i] = inner[i + 4];
        }
    }
}

/// @dev The registry's errors, redeclared for `expectRevert` so this file does not import a contract
///      another builder is still editing.
interface UnicaMarketRegistryErrors {
    error WrongMarketStatus(bytes32 marketId, uint8 actual);
}

/// @dev A token that can keep part of a transfer, or report failure, while looking like an ERC-20.
///      It extends the same mock the fixtures use, so its storage layout is that mock's and it can be
///      etched over one in place.
contract HostileToken is MockERC20 {
    uint256 public feeBps;
    bool public returnFalse;

    constructor(string memory n, string memory s, uint8 d) MockERC20(n, s, d) {}

    function setFeeBps(uint256 bps) external {
        feeBps = bps;
    }

    function setReturnFalse(bool yes) external {
        returnFalse = yes;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (returnFalse) return false;
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        uint256 fee = (amount * feeBps) / 10_000;
        unchecked {
            balanceOf[to] += amount - fee;
            balanceOf[address(0xdead)] += fee;
        }
        return true;
    }
}

/// @dev Takes the PoolManager lock itself and swaps: the H5b shape, a swapper that is not a router.
contract RawSwapper is IUnlockCallback {
    IPoolManager private immutable MANAGER;
    PoolKey private _key;
    bool private _zeroForOne;
    uint256 private _amount;

    constructor(IPoolManager manager_) {
        MANAGER = manager_;
    }

    function swap(PoolKey memory key, bool zeroForOne, uint256 amount) external {
        _key = key;
        _zeroForOne = zeroForOne;
        _amount = amount;
        MANAGER.unlock("");
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        MANAGER.swap(
            _key,
            SwapParams({
                zeroForOne: _zeroForOne,
                amountSpecified: -int256(_amount),
                sqrtPriceLimitX96: _zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        return "";
    }
}

/// @dev A swapper that can be etched at a market's EXECUTOR address and driven to present any hook
///      data and any swap parameters, so the hook's own before-swap rules can each be reached. It
///      answers `orders(bytes32)` from a settable record, which is all the hook reads from an
///      executor. Storage is written only after the etch, so it never reads a real executor's slots.
contract ExecutorHarness is IUnlockCallback {
    UnicaMarketTypes.Order private _order; // slots 0..4
    IPoolManager private _manager; // slot 5
    PoolKey private _key; // slots 6..10
    bool private _zeroForOne;
    int256 private _amountSpecified;
    bytes private _hookData;
    bool private _twice;

    function configure(IPoolManager manager_, PoolKey memory key) external {
        _manager = manager_;
        _key = key;
    }

    function setOrder(UnicaMarketTypes.Order memory order) external {
        _order = order;
    }

    function orders(bytes32) external view returns (UnicaMarketTypes.Order memory) {
        return _order;
    }

    function swap(bool zeroForOne, int256 amountSpecified, bytes32 orderId) external {
        _run(zeroForOne, amountSpecified, abi.encode(orderId), false);
    }

    function swapTwice(bool zeroForOne, int256 amountSpecified, bytes32 orderId) external {
        _run(zeroForOne, amountSpecified, abi.encode(orderId), true);
    }

    /// @dev Hook data of an arbitrary LENGTH, which is the one thing `abi.encode(bytes32)` cannot make.
    function swapRaw(bool zeroForOne, int256 amountSpecified, bytes memory, uint256 length) external {
        bytes memory data = new bytes(length);
        _run(zeroForOne, amountSpecified, data, false);
    }

    function _run(bool zeroForOne, int256 amountSpecified, bytes memory hookData, bool twice) private {
        _zeroForOne = zeroForOne;
        _amountSpecified = amountSpecified;
        _hookData = hookData;
        _twice = twice;
        _manager.unlock("");
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        _swapOnce();
        if (_twice) _swapOnce();
        _settle();
        return "";
    }

    function _swapOnce() private {
        _manager.swap(
            _key,
            SwapParams({
                zeroForOne: _zeroForOne,
                amountSpecified: _amountSpecified,
                sqrtPriceLimitX96: _zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            _hookData
        );
    }

    /// @dev Closes whatever the swap opened, so the control path can complete rather than dying on an
    ///      unpaid delta and looking like a hook refusal.
    function _settle() private {
        Currency input = _zeroForOne ? _key.currency0 : _key.currency1;
        Currency output = _zeroForOne ? _key.currency1 : _key.currency0;
        int256 owed = TransientStateLibrary.currencyDelta(_manager, address(this), input);
        if (owed < 0) {
            _manager.sync(input);
            MockERC20(Currency.unwrap(input)).transfer(address(_manager), uint256(-owed));
            _manager.settle();
        }
        int256 credit = TransientStateLibrary.currencyDelta(_manager, address(this), output);
        if (credit > 0) _manager.take(output, address(this), uint256(credit));
    }
}
