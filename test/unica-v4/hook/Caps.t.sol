// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {UnicaMarketTypes} from "../../../src/unica-v4/UnicaMarketTypes.sol";
import {UnicaMarketExecutor} from "../../../src/unica-v4/UnicaMarketExecutor.sol";
import {UnicaV4TestBase} from "../util/UnicaV4TestBase.sol";

/// @dev The registry's own errors, redeclared for `expectRevert` rather than imported, so this file
///      does not take a compile-time dependency on a contract another builder is still editing.
interface RegistryCapErrors {
    error CapsNotTighter(bytes32 marketId);
    error CapsInvalid(bytes32 marketId);
    error WrongMarketStatus(bytes32 marketId, uint8 actual);
}

/// @title Cap rows — every cap at its boundary, and the absence of a way back up
/// @notice TEST-MATRIX rows K1, K2, K3, K5, K6 and K7. Each boundary is tested at the value that
///         passes AND the one raw unit that does not, because a cap that only ever refuses obviously
///         wrong amounts has not been shown to be a cap at all.
contract CapsTest is UnicaV4TestBase {
    uint256 internal constant SECONDS_PER_DAY = 86400;

    MarketSpec internal spec;
    Market internal market;

    function setUp() public {
        setUpBase();
        spec = defaultSpec();
        market = deployMarket(spec);
    }

    // ---- K1: the per-transaction cap, checked at creation -----------------------------------------

    function test_K1_minOutOneAboveTheCapIsRefusedAtCreation() public {
        uint128 cap = 1_000_000;
        registry.tightenCaps(market.marketId, cap, cap * 10);

        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.OrderAboveCap.selector, cap + 1, cap));
        market.executor.createOrder(merchant, payer, 1e18, cap + 1, uint64(block.timestamp + 1 hours), "k1");

        // Control: exactly the cap is accepted.
        bytes32 ok = market.executor.createOrder(merchant, payer, 1e18, cap, uint64(block.timestamp + 1 hours), "k1b");
        assertEq(market.executor.orders(ok).minOut, cap, "the boundary minOut was refused");
    }

    // ---- K2: the per-transaction cap, checked again on the measured delivery -------------------------

    function test_K2_aDeliveryOneUnitAboveTheCapIsRefused() public {
        uint128 amountIn = 1e18;
        uint256 produced = quote(market, amountIn);
        assertGt(produced, 1, "the pool quoted nothing to bound");

        bytes32 orderId = createOrder(market, amountIn, 1, "k2");
        fundPayer(market, payer, amountIn);

        // The cap now sits one raw unit below what this order will deliver.
        registry.tightenCaps(market.marketId, uint128(produced - 1), uint128(produced - 1));

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketExecutor.PaymentAboveCap.selector, produced, uint128(produced - 1))
        );
        market.executor.pay(orderId);

        // Control: a cap exactly equal to the delivery lets the same order through.
        // (Caps only tighten, so the control is a second market at the exact cap.)
        Market memory m2 = deployMarket(spec);
        uint256 produced2 = quote(m2, amountIn);
        registry.tightenCaps(m2.marketId, uint128(produced2), uint128(produced2));
        bytes32 order2 = createOrder(m2, amountIn, 1, "k2-control");
        fundPayer(m2, payer, amountIn);
        uint256 before = m2.payout.balanceOf(merchant);
        vm.prank(payer);
        m2.executor.pay(order2);
        assertEq(m2.payout.balanceOf(merchant) - before, produced2, "a delivery equal to the cap was refused");
    }

    // ---- K3: the day boundary ---------------------------------------------------------------------------

    function test_K3_theDailyCapBindsUntilMidnightAndResetsAtIt() public {
        uint128 amountIn = 1e14;
        uint256 produced = quote(market, amountIn);

        // A daily cap that admits exactly one of these payments and not two.
        uint128 perDay = uint128(produced + produced / 2);
        registry.tightenCaps(market.marketId, uint128(produced), perDay);

        // One second before 00:00 UTC of the next day.
        uint256 day = block.timestamp / SECONDS_PER_DAY;
        vm.warp((day + 1) * SECONDS_PER_DAY - 1);

        fundPayer(market, payer, amountIn * 10);
        bytes32 first = createOrder(market, amountIn, 1, "k3-a");
        vm.prank(payer);
        market.executor.pay(first);
        assertEq(market.executor.payoutUsedOnDay(block.timestamp / SECONDS_PER_DAY), produced, "day usage");

        bytes32 second = createOrder(market, amountIn, 1, "k3-b");
        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(
                UnicaMarketExecutor.DailyCapExceeded.selector, block.timestamp / SECONDS_PER_DAY, produced * 2, perDay
            )
        );
        market.executor.pay(second);

        // 00:00 UTC: the new day starts at zero, without anyone writing to storage.
        vm.warp((day + 1) * SECONDS_PER_DAY);
        assertEq(
            market.executor.payoutUsedOnDay(block.timestamp / SECONDS_PER_DAY), 0, "the new day did not start at zero"
        );
        vm.prank(payer);
        market.executor.pay(second);
        assertEq(uint8(market.executor.orders(second).status), uint8(UnicaMarketTypes.OrderStatus.Settled));
    }

    // ---- K5: tightening under an open order fails closed and traps nothing --------------------------------

    function test_K5_tighteningBelowAnOpenOrdersDeliveryTrapsNothing() public {
        uint128 amountIn = 1e18;
        uint256 produced = quote(market, amountIn);

        bytes32 orderId = createOrder(market, amountIn, 1, "k5");
        fundPayer(market, payer, amountIn);

        uint256 payerBefore = market.asset.balanceOf(payer);
        uint256 merchantBefore = market.payout.balanceOf(merchant);
        uint256 day = block.timestamp / SECONDS_PER_DAY;

        registry.tightenCaps(market.marketId, uint128(produced - 1), uint128(produced - 1));

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketExecutor.PaymentAboveCap.selector, produced, uint128(produced - 1))
        );
        market.executor.pay(orderId);

        // Nothing moved, nothing was consumed, and the order is still there to be paid another way.
        assertEq(market.asset.balanceOf(payer), payerBefore, "the payer's input moved");
        assertEq(market.payout.balanceOf(merchant), merchantBefore, "the merchant's balance moved");
        assertEq(market.executor.payoutUsedOnDay(day), 0, "a refused payment consumed daily capacity");
        assertEq(uint8(market.executor.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Open));

        // Control: on a market whose cap was never tightened under it, the same order settles.
        Market memory m2 = deployMarket(spec);
        bytes32 control = createOrder(m2, amountIn, 1, "k5-control");
        fundPayer(m2, payer, amountIn);
        vm.prank(payer);
        m2.executor.pay(control);
        assertEq(uint8(m2.executor.orders(control).status), uint8(UnicaMarketTypes.OrderStatus.Settled));
    }

    // ---- K6: what the registry refuses -------------------------------------------------------------------

    function test_K6_loosening_inverted_andRetiredAreAllRefused() public {
        UnicaMarketTypes.Caps memory caps = registry.capsOf(market.marketId);

        // Loosening either component, and an unchanged pair.
        vm.expectRevert(abi.encodeWithSelector(RegistryCapErrors.CapsNotTighter.selector, market.marketId));
        registry.tightenCaps(market.marketId, caps.maxPerTxPayout + 1, caps.maxPerDayPayout);
        vm.expectRevert(abi.encodeWithSelector(RegistryCapErrors.CapsNotTighter.selector, market.marketId));
        registry.tightenCaps(market.marketId, caps.maxPerTxPayout, caps.maxPerDayPayout);

        // Per-transaction above per-day is not a cap pair at all.
        vm.expectRevert(abi.encodeWithSelector(RegistryCapErrors.CapsInvalid.selector, market.marketId));
        registry.tightenCaps(market.marketId, 1000, 999);

        // Control: a strictly lower pair is accepted and readable.
        registry.tightenCaps(market.marketId, 1000, 2000);
        UnicaMarketTypes.Caps memory after_ = registry.capsOf(market.marketId);
        assertEq(after_.maxPerTxPayout, 1000);
        assertEq(after_.maxPerDayPayout, 2000);

        // A retired market tightens nothing.
        registry.retire(market.marketId);
        vm.expectRevert(
            abi.encodeWithSelector(
                RegistryCapErrors.WrongMarketStatus.selector,
                market.marketId,
                uint8(UnicaMarketTypes.MarketStatus.RETIRED)
            )
        );
        registry.tightenCaps(market.marketId, 500, 1000);
    }

    // ---- K7: there is no way up ---------------------------------------------------------------------------

    function test_K7_noFunctionRaisesACap_andSettledHistoryIsUntouched() public {
        uint128 amountIn = 1e14;
        bytes32 orderId = createOrder(market, amountIn, 1, "k7");
        fundPayer(market, payer, amountIn);
        vm.prank(payer);
        market.executor.pay(orderId);

        uint256 day = block.timestamp / SECONDS_PER_DAY;
        uint256 usedAfterSettlement = market.executor.payoutUsedOnDay(day);
        assertGt(usedAfterSettlement, 0, "the settlement recorded no usage");

        UnicaMarketTypes.Caps memory caps = registry.capsOf(market.marketId);

        // Every component, one unit higher, one at a time and both together.
        vm.expectRevert(abi.encodeWithSelector(RegistryCapErrors.CapsNotTighter.selector, market.marketId));
        registry.tightenCaps(market.marketId, caps.maxPerTxPayout + 1, caps.maxPerDayPayout);
        vm.expectRevert(abi.encodeWithSelector(RegistryCapErrors.CapsNotTighter.selector, market.marketId));
        registry.tightenCaps(market.marketId, caps.maxPerTxPayout, caps.maxPerDayPayout + 1);
        vm.expectRevert(abi.encodeWithSelector(RegistryCapErrors.CapsNotTighter.selector, market.marketId));
        registry.tightenCaps(market.marketId, caps.maxPerTxPayout + 1, caps.maxPerDayPayout + 1);

        // The seed cap has no setter at all: the only cap function on the registry takes two
        // arguments, and neither of them is it. A later tighten leaves it exactly where it was.
        uint128 seedBefore = caps.maxSeedPayout;
        registry.tightenCaps(market.marketId, uint128(usedAfterSettlement), uint128(usedAfterSettlement));
        assertEq(registry.capsOf(market.marketId).maxSeedPayout, seedBefore, "the seed cap moved");

        // And the settled history is untouched by the tighten.
        assertEq(market.executor.payoutUsedOnDay(day), usedAfterSettlement, "a tighten rewrote the day's usage");
        assertEq(uint8(market.executor.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Settled));
    }
}
