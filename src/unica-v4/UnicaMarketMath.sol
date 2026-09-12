// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title UnicaMarketMath, the opening price and the designed seed range
/// @notice Written from `docs/unica-v4/SPEC-CONTRACTS.md` §7 ("Opening price", "Seed proof and seed
///         cap"). Three pure functions, one implementation each, so the factory that checks a seed
///         and the script that mints one cannot disagree about where the range is.
///
///         THE ONE INVARIANT THE OPENING PRICE MUST HOLD: payout per whole asset at the opening
///         tick never EXCEEDS `rateE18`, and sits within one grid step of it. "Never exceeds" is the
///         safe direction — a market that opens a hair cheap costs the seed nothing, a market that
///         opens a hair rich hands the first taker the difference — so every rounding below is
///         chosen to fall on that side, including the two truncations inside `_sqrtPriceX96Floor`.
library UnicaMarketMath {
    /// @notice `rateE18` zero, above 1e36, or landing outside the grid's usable ticks.
    error RateOutOfRange(uint256 rateE18);
    /// @notice A spacing at or below zero can index no grid.
    error TickSpacingInvalid(int24 tickSpacing);
    /// @notice An oracle band so tight that no whole grid step fits inside it with one step reserved
    ///         for rounding. Not in SC §7's catalogue: SC §7 names `W = 120 at 200 bps and spacing
    ///         60` and says nothing about a band narrower than two steps. Failing loudly beats
    ///         returning a zero-width range that a caller would then mint nothing into.
    error SeedWidthTooNarrow(int24 tickSpacing, uint16 maxDeviationBps);

    /// @notice The ceiling on a demonstration rate (SC §7). Whole payout per whole asset x 1e18.
    uint256 internal constant MAX_RATE_E18 = 1e36;
    /// @notice The frozen demonstration range, in ticks, before it is rounded up to whole steps.
    int24 internal constant DEMONSTRATION_WIDTH_TICKS = 6960;

    /// @notice The opening price of a market, snapped onto its own tick grid.
    /// @param rateE18 whole payout per whole asset, scaled by 1e18.
    /// @param assetDecimals the asset token's own `decimals()`, read on-chain by the factory.
    /// @param payoutDecimals the payout token's own `decimals()`.
    /// @param assetIsCurrency0 derived by the factory as `asset < payout`.
    /// @param tickSpacing the pool's spacing; the returned tick is always a multiple of it.
    /// @return sqrtPriceX96 the price to initialise the pool at, exactly `getSqrtPriceAtTick(tick)`.
    /// @return tick the opening tick, on the grid, with payout per whole asset <= `rateE18`.
    function openingPrice(
        uint256 rateE18,
        uint8 assetDecimals,
        uint8 payoutDecimals,
        bool assetIsCurrency0,
        int24 tickSpacing
    ) internal pure returns (uint160 sqrtPriceX96, int24 tick) {
        if (tickSpacing <= 0) revert TickSpacingInvalid(tickSpacing);
        if (rateE18 == 0 || rateE18 > MAX_RATE_E18) revert RateOutOfRange(rateE18);

        // The pool's own price is currency1 base units per currency0 base unit. Both orderings are
        // written out rather than inverted afterwards, because the inversion is where a decimals
        // pair silently cancels itself out.
        uint256 numerator;
        uint256 denominator;
        if (assetIsCurrency0) {
            numerator = rateE18 * (10 ** payoutDecimals);
            denominator = 1e18 * (10 ** assetDecimals);
        } else {
            numerator = 1e18 * (10 ** assetDecimals);
            denominator = rateE18 * (10 ** payoutDecimals);
        }

        uint256 target = _sqrtPriceX96Floor(numerator, denominator);
        if (target < TickMath.MIN_SQRT_PRICE || target >= TickMath.MAX_SQRT_PRICE) revert RateOutOfRange(rateE18);

        int24 raw = TickMath.getTickAtSqrtPrice(uint160(target));
        if (assetIsCurrency0) {
            // Payout per asset RISES with the tick here, so the grid tick at or below the target is
            // the closest one that does not exceed the rate.
            tick = _floorToSpacing(raw, tickSpacing);
        } else {
            // Payout per asset FALLS with the tick here, so the closest one that does not exceed the
            // rate is the grid tick at or above the target. `getTickAtSqrtPrice` floors, so a target
            // that is not exactly on a tick needs one step up first; a target that IS exactly on a
            // tick — the perfect-tick case — is kept, and `_ceilToSpacing` then leaves it alone when
            // it is already on the grid.
            if (TickMath.getSqrtPriceAtTick(raw) < uint160(target)) raw += 1;
            tick = _ceilToSpacing(raw, tickSpacing);
        }

        if (tick < TickMath.minUsableTick(tickSpacing) || tick > TickMath.maxUsableTick(tickSpacing)) {
            revert RateOutOfRange(rateE18);
        }
        sqrtPriceX96 = TickMath.getSqrtPriceAtTick(tick);
    }

    /// @notice The designed seed width in ticks, always a positive multiple of `tickSpacing`.
    /// @param oracleEnabled the market's `policy.enabled`; false is a demonstration market.
    /// @param maxDeviationBps the market's band, read only when `oracleEnabled`.
    /// @return W SC §7: demonstration markets take the frozen `ceil(6960 / spacing) * spacing`;
    ///         oracle markets take the largest multiple of spacing with
    ///         `1.0001^(W + tickSpacing) <= 1 + maxDeviationBps / 1e4`, one step held back for
    ///         rounding, so the whole seed trades inside the band.
    function seedWidth(int24 tickSpacing, bool oracleEnabled, uint16 maxDeviationBps) internal pure returns (int24 W) {
        if (tickSpacing <= 0) revert TickSpacingInvalid(tickSpacing);

        if (!oracleEnabled) {
            int24 steps = DEMONSTRATION_WIDTH_TICKS / tickSpacing;
            if (steps * tickSpacing != DEMONSTRATION_WIDTH_TICKS) steps += 1;
            return steps * tickSpacing;
        }

        if (maxDeviationBps == 0) revert SeedWidthTooNarrow(tickSpacing, maxDeviationBps);
        // The band's upper edge as a price ratio, then as a tick. `getTickAtSqrtPrice` floors, and
        // `_sqrtPriceX96Floor` floors, so the tick found is never above the true edge: a rounding
        // error can only make the band narrower than allowed, never wider.
        uint256 edge = _sqrtPriceX96Floor(1e4 + uint256(maxDeviationBps), 1e4);
        if (edge >= TickMath.MAX_SQRT_PRICE) revert SeedWidthTooNarrow(tickSpacing, maxDeviationBps);
        int24 widest = TickMath.getTickAtSqrtPrice(uint160(edge)) - tickSpacing;
        if (widest < tickSpacing) revert SeedWidthTooNarrow(tickSpacing, maxDeviationBps);
        W = (widest / tickSpacing) * tickSpacing;
    }

    /// @notice The designed seed range: `W` ticks on the PAYOUT side of the opening tick.
    /// @dev A v4 position below the current tick holds currency1 and one above it holds currency0,
    ///      so the payout side flips with the ordering. Asset is currency0 => payout is currency1 =>
    ///      the range sits below. Asset is currency1 => payout is currency0 => it sits above.
    function seedRange(int24 initTick, int24 W, bool assetIsCurrency0)
        internal
        pure
        returns (int24 lower, int24 upper)
    {
        if (assetIsCurrency0) {
            lower = initTick - W;
            upper = initTick;
        } else {
            lower = initTick;
            upper = initTick + W;
        }
    }

    // ---- internals ----------------------------------------------------------------------------

    /// @dev `floor(sqrt(numerator / denominator) * 2**96)`. Two branches, because the single
    ///      expression that would serve both either overflows on a large ratio or truncates a small
    ///      one to nothing: with `rateE18 <= 1e36` and decimals <= 18 the ratio spans 1e-36 to 1e36,
    ///      which is 2**-120 to 2**120, and `p * 2**192` overflows above p = 2**64 while `p * 2**96`
    ///      floors to zero below p = 2**-96. Both branches truncate downwards, which is what keeps
    ///      the opening payout at or under the rate.
    function _sqrtPriceX96Floor(uint256 numerator, uint256 denominator) private pure returns (uint256) {
        if (numerator >= denominator) {
            // p >= 1: carry 96 bits, take the root, and restore the other 48 bits of the Q96 scale.
            return Math.sqrt(FullMath.mulDiv(numerator, 1 << 96, denominator)) << 48;
        }
        // p < 1: p * 2**192 is under 2**192 and the root is the Q96 value directly, at full width.
        return Math.sqrt(FullMath.mulDiv(numerator, 1 << 192, denominator));
    }

    /// @dev Toward negative infinity, not toward zero: Solidity truncates, so a negative tick that
    ///      is not already on the grid has to be pushed one step down by hand.
    function _floorToSpacing(int24 tick, int24 tickSpacing) private pure returns (int24) {
        int24 steps = tick / tickSpacing;
        if (tick < 0 && steps * tickSpacing != tick) steps -= 1;
        return steps * tickSpacing;
    }

    /// @dev Toward positive infinity, the mirror of the above.
    function _ceilToSpacing(int24 tick, int24 tickSpacing) private pure returns (int24) {
        int24 steps = tick / tickSpacing;
        if (tick > 0 && steps * tickSpacing != tick) steps += 1;
        return steps * tickSpacing;
    }
}
