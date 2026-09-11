// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {StockSettlement46630Harness} from "./util/StockSettlement46630Harness.sol";

/// @title The 46630 deploy script, offline: the refusals that need no chain, and the arithmetic
/// @notice No fork, no RPC, no key. This suite runs in `make gate`. The fork suite in
///         test/fork/StockSettlement46630Fork.t.sol drives the same stages against real chain state.
///
///         THE ORDERING IS NOT KNOWN IN ADVANCE, which is why every arithmetic row runs twice. Whether
///         TSLA is currency0 or currency1 depends on the payout token's address, which depends on the
///         deployer's nonce at the moment it is deployed. The rehearsal's token happened to sort
///         above TSLA; a live deploy might not. Both branches must be right before anything is sent.
contract StockSettlement46630LocalTest is Test {
    StockSettlement46630Harness internal h;
    address internal constant TSLA = 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E;
    /// @dev Two payout addresses, one on each side of TSLA, so both orderings are exercised.
    address internal constant PAYOUT_ABOVE = 0xfb93352698150e720Bf0A321DEf3aC98D90B9874; // TSLA is currency0
    address internal constant PAYOUT_BELOW = 0x1111111111111111111111111111111111111111; // TSLA is currency1
    address internal constant HOOK = 0xAe1975f223824b5851564277656ebAC21667E0c0;

    function setUp() public {
        h = new StockSettlement46630Harness();
    }

    // ── refusal: the wrong chain ─────────────────────────────────────────────────────────────

    /// @dev This test chain is 31337 and carries none of 46630's contracts, so the chain rows fail
    ///      and the stage stops before `vm.startBroadcast` is ever reached.
    function test_L1_the_wrong_chain_is_refused_before_anything_is_broadcast() public {
        address deployer = makeAddr("deployer");
        vm.deal(deployer, 1 ether);
        assertTrue(block.chainid != 46630, "control: this suite must not run on 46630");
        vm.expectRevert(bytes(h.stopped()));
        h.tokenAs(deployer);
        assertEq(vm.getNonce(deployer), 0, "the refused stage must not have sent anything");
    }

    // ── the arithmetic the live pool depends on ──────────────────────────────────────────────

    function test_L2_the_stated_rate_round_trips_through_sqrtPrice_both_orderings() public view {
        _roundTrip(PAYOUT_ABOVE);
        _roundTrip(PAYOUT_BELOW);
    }

    function _roundTrip(address payout) internal view {
        uint256 rate = 395;
        uint160 s = h.sqrtPriceFor(payout, rate);
        uint256 out = h.spotOut(payout, s, 1e18); // one whole TSLA at the pool's own price
        uint256 expected = rate * 1e6; // in raw uTUSD
        // within 0.01%: the only loss is the integer square root
        assertApproxEqRel(out, expected, 1e14, "one TSLA does not buy the stated rate at the pool's price");
    }

    function test_L3_the_seeded_range_sits_on_the_sale_side_and_excludes_spot_both_orderings() public view {
        _side(PAYOUT_ABOVE, true);
        _side(PAYOUT_BELOW, false);
    }

    function _side(address payout, bool tslaIsZero) internal view {
        uint160 s = h.sqrtPriceFor(payout, 395);
        int24 spot = TickMath.getTickAtSqrtPrice(s);
        (int24 lower, int24 upper,,) = h.position(payout, s, 10_000);
        assertEq(lower % 60, 0, "lower bound off the tick spacing");
        assertEq(upper % 60, 0, "upper bound off the tick spacing");
        assertEq(upper - lower, 6960, "range width");
        if (tslaIsZero) {
            // Selling TSLA lowers the price, so the position must lie at or below spot: all token1.
            assertLe(upper, spot, "the range reaches above spot, so the mint would ask for TSLA");
        } else {
            // Selling TSLA raises the price, so the position must lie strictly above spot: all token0.
            assertGt(lower, spot, "the range reaches below spot, so the mint would ask for TSLA");
        }
    }

    /// @dev The PositionManager recomputes the amount owed from the liquidity and rounds UP. It must
    ///      never come to more than the seed the stage mints and approves, on either path, or the
    ///      live mint reverts on MaximumAmountExceeded over one raw unit.
    function test_L4_the_position_never_asks_for_more_than_the_seed_both_orderings() public view {
        _fits(PAYOUT_ABOVE, true);
        _fits(PAYOUT_BELOW, false);
    }

    function _fits(address payout, bool tslaIsZero) internal view {
        uint256[4] memory seeds = [uint256(100), 10_000, 1_234_567, 10_000_000];
        for (uint256 i = 0; i < seeds.length; i++) {
            uint160 s = h.sqrtPriceFor(payout, 395);
            (int24 lower, int24 upper, uint128 liquidity, uint256 seedRaw) = h.position(payout, s, seeds[i]);
            uint160 a = TickMath.getSqrtPriceAtTick(lower);
            uint160 b = TickMath.getSqrtPriceAtTick(upper);
            uint256 owed = tslaIsZero
                ? SqrtPriceMath.getAmount1Delta(a, b, liquidity, true)
                : SqrtPriceMath.getAmount0Delta(a, b, liquidity, true);
            assertLe(owed, seedRaw, "the mint would owe more than the seed");
            assertGt(owed, (seedRaw * 99) / 100, "the position uses implausibly little of the seed");
        }
    }

    function test_L5_the_pool_key_orders_its_currencies_and_names_the_hook() public view {
        _ordered(PAYOUT_ABOVE);
        _ordered(PAYOUT_BELOW);
    }

    function _ordered(address payout) internal view {
        (address c0, address c1) = _currencies(payout);
        assertLt(uint160(c0), uint160(c1), "currencies are not sorted");
        assertTrue((c0 == TSLA && c1 == payout) || (c0 == payout && c1 == TSLA), "not the TSLA/payout pair");
    }

    function _currencies(address payout) internal view returns (address, address) {
        // PoolKey's currencies are wrapped addresses; unwrap through abi to avoid importing Currency.
        bytes memory k = abi.encode(h.key(payout, HOOK));
        (address c0, address c1,,, address hooks) = abi.decode(k, (address, address, uint24, int24, address));
        assertEq(hooks, HOOK, "the key does not name the hook");
        return (c0, c1);
    }

    /// @dev The helper's own floor. The pool stage never reaches it with a zero rate — its rate row
    ///      gates first — but the helper must refuse by name if anything ever does.
    function test_L6_an_unrepresentable_rate_is_refused_by_name() public {
        vm.expectRevert(bytes("rate outside the representable range"));
        h.sqrtPriceFor(PAYOUT_ABOVE, 0);
    }
}
