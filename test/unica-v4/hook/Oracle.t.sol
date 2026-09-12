// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

import {UnicaMarketTypes} from "../../../src/unica-v4/UnicaMarketTypes.sol";
import {UnicaMarketHook} from "../../../src/unica-v4/UnicaMarketHook.sol";
import {UnicaMarketExecutor} from "../../../src/unica-v4/UnicaMarketExecutor.sol";
import {UnicaV4TestBase} from "../util/UnicaV4TestBase.sol";
import {MockOracleAdapter, StateWritingOracleAdapter} from "../fixtures/MockOracleAdapter.sol";

/// @title Oracle rows — every named refusal on the reference, and the band at its edges
/// @notice TEST-MATRIX rows O11 to O17, O19, O20 and O27, plus the "changed feedIdFor" row that S8's
///         repeated route check exists for. Each fault is introduced ALONE, with everything else
///         valid, and each stands beside the same order with that one fault removed.
contract OracleTest is UnicaV4TestBase {
    bytes32 internal constant RECEIPT_TOPIC = keccak256(
        "SettlementReceipt(bytes32,address,address,bytes32,address,address,uint128,uint128,uint24,uint24,uint24,uint24,uint256,uint8,uint64,bool)"
    );

    bytes32 internal constant FEED_ID = keccak256("MOCK/UNICA-TEST");
    uint48 internal constant MAX_AGE = 300;
    uint16 internal constant MAX_BPS = 200;
    /// @dev One whole payout per whole asset, at eight decimals: the same shape a push feed reports.
    uint256 internal constant PRICE_1_TO_1 = 1e8;
    uint8 internal constant PRICE_DECIMALS = 8;

    MarketSpec internal spec;
    Market internal market;
    MockOracleAdapter internal adapter;

    uint128 internal constant AMOUNT_IN = 1e18;

    function setUp() public {
        setUpBase();

        spec = defaultSpec();
        (address assetAddr, address payoutAddr) = peekTokens(spec.assetIsCurrency0);
        adapter =
            new MockOracleAdapter(assetAddr, payoutAddr, FEED_ID, PRICE_1_TO_1, PRICE_DECIMALS, block.timestamp - 60);
        spec.adapter = address(adapter);
        spec.feedId = FEED_ID;
        spec.maxAge = MAX_AGE;
        spec.maxDeviationBps = MAX_BPS;

        market = deployMarket(spec);
        assertEq(address(market.asset), assetAddr, "the adapter and the market disagree about the asset");
        assertEq(address(market.payout), payoutAddr, "the adapter and the market disagree about the payout");
    }

    // ---- the control this whole file leans on ------------------------------------------------------

    function test_O_control_aFreshReadingSettlesAndReachesTheReceipt() public {
        (uint256 price, uint8 decimals, uint64 updatedAt, bool demo) = _settleAndReadReference(AMOUNT_IN, "ctl");
        assertEq(price, PRICE_1_TO_1, "referencePrice");
        assertEq(decimals, PRICE_DECIMALS, "referenceDecimals");
        assertEq(uint256(updatedAt), block.timestamp - 60, "referenceUpdatedAt");
        assertFalse(demo, "an oracle market reported demonstrationOnly");
    }

    // ---- O11 to O15: one fault each ------------------------------------------------------------------

    function test_O11_priceZero() public {
        adapter.setPrice(0);
        _expectRefusal(abi.encodeWithSelector(UnicaMarketHook.OraclePriceZero.selector, market.marketId), "o11");
        adapter.setPrice(PRICE_1_TO_1);
        _settles("o11-control");
    }

    function test_O12_decimalsOneAboveTheBound() public {
        adapter.setReading(PRICE_1_TO_1, 19, block.timestamp - 60);
        _expectRefusal(
            abi.encodeWithSelector(UnicaMarketHook.OracleDecimalsUnsupported.selector, market.marketId, uint8(19)),
            "o12"
        );
        adapter.setReading(PRICE_1_TO_1, PRICE_DECIMALS, block.timestamp - 60);
        _settles("o12-control");
    }

    function test_O13_timestampInTheFuture() public {
        uint256 future = block.timestamp + 1;
        adapter.setUpdatedAt(future);
        _expectRefusal(
            abi.encodeWithSelector(UnicaMarketHook.OracleTimestampInFuture.selector, market.marketId, future), "o13"
        );
        adapter.setUpdatedAt(block.timestamp - 1);
        _settles("o13-control");
    }

    function test_O14_timestampEqualToTheBlock() public {
        adapter.setUpdatedAt(block.timestamp);
        _expectRefusal(
            abi.encodeWithSelector(
                UnicaMarketHook.OracleTimestampNotBeforeBlock.selector, market.marketId, block.timestamp
            ),
            "o14"
        );
        adapter.setUpdatedAt(block.timestamp - 1);
        _settles("o14-control");
    }

    function test_O15_ageAtTheBoundPassesAndOneSecondMoreDoesNot() public {
        adapter.setUpdatedAt(block.timestamp - (uint256(MAX_AGE) + 1));
        _expectRefusal(
            abi.encodeWithSelector(
                UnicaMarketHook.OracleStale.selector, market.marketId, uint256(MAX_AGE) + 1, MAX_AGE
            ),
            "o15"
        );
        // Control: exactly `maxAge` old is fresh enough.
        adapter.setUpdatedAt(block.timestamp - uint256(MAX_AGE));
        _settles("o15-control");
    }

    // ---- O16, O17: the band, at the raw unit ----------------------------------------------------------

    /// @dev The bounds are recomputed HERE from SO §4.2 with FullMath, independently of the hook, and
    ///      the row then finds the exact reference price at which the pool's own output sits on each
    ///      bound. Both bounds are inclusive; one raw unit beyond either is a named refusal.
    function test_O16_O17_theBandIsInclusiveAtBothEdges() public {
        (,, uint24 swapFee) = market.hook.feeRates();

        // THE LOW SIDE, refused: one raw unit above the floor the reference allows. The output is
        // read from the hook's OWN refusal rather than predicted, so the row is about the number the
        // hook actually saw.
        uint256 produced = _probeProducedAt(_minAllowed(PRICE_1_TO_1, swapFee) * 4, swapFee);
        uint256 oneTooHigh = _highestPriceWhoseFloorAdmits(produced, swapFee) + 1;
        adapter.setReading(oneTooHigh, PRICE_DECIMALS, block.timestamp - 60);
        uint256 floorNow = _minAllowed(oneTooHigh, swapFee);
        assertEq(floorNow, produced + 1, "one raw unit past the bound is not one raw unit past");
        _expectRefusal(
            abi.encodeWithSelector(
                UnicaMarketHook.ExecutionBelowOracleBand.selector, market.marketId, produced, floorNow
            ),
            "o16"
        );

        // THE LOW SIDE, accepted: exactly on the floor. `_settleOnBound` converges because a refusal
        // leaves the pool where it was, so the only thing that changes between attempts is the price.
        (uint256 delivered, uint256 bound) = _settleOnBound(swapFee, true, "o16-boundary");
        assertEq(delivered, bound, "the accepted settlement did not sit exactly on minAllowed");

        // THE HIGH SIDE, refused: one raw unit below the ceiling.
        produced = _probeProducedAt(1, swapFee);
        uint256 oneTooLow = _lowestPriceWhoseCeilingAdmits(produced, swapFee) - 1;
        adapter.setReading(oneTooLow, PRICE_DECIMALS, block.timestamp - 60);
        uint256 ceilingNow = _maxAllowed(oneTooLow, swapFee);
        assertLt(ceilingNow, produced, "the next price down did not move the ceiling below the output");
        _expectRefusal(
            abi.encodeWithSelector(
                UnicaMarketHook.ExecutionAboveOracleBand.selector, market.marketId, produced, ceilingNow
            ),
            "o17"
        );

        // THE HIGH SIDE, accepted: exactly on the ceiling.
        (delivered, bound) = _settleOnBound(swapFee, false, "o17-boundary");
        assertEq(delivered, bound, "the accepted settlement did not sit exactly on maxAllowed");
    }

    /// @dev Asks the hook what the pool produces, by setting a reference the output cannot satisfy and
    ///      reading the amount out of the refusal. A reverting probe changes nothing.
    function _probeProducedAt(uint256 price, uint24) private returns (uint256 produced) {
        adapter.setReading(price, PRICE_DECIMALS, block.timestamp - 60);
        bytes32 orderId = createOrder(market, AMOUNT_IN, 1, keccak256(abi.encode("probe", price, gasleft())));
        fundPayer(market, payer, AMOUNT_IN);
        vm.prank(payer);
        try market.executor.pay(orderId) {
            revert("the probe settled; it was meant to be outside the band");
        } catch (bytes memory err) {
            (, produced,) = _decodeBandError(err);
        }
    }

    /// @dev Walks the reference price to the value that puts THIS pool's output exactly on the named
    ///      bound, then settles there. Each failed attempt reverts, so the pool does not move and the
    ///      output the refusal reports is the one the next attempt will produce.
    function _settleOnBound(uint24 swapFee, bool low, bytes32 salt) private returns (uint256 delivered, uint256 bound) {
        uint256 produced =
            low ? _probeProducedAt(_minAllowed(PRICE_1_TO_1, swapFee) * 4, swapFee) : _probeProducedAt(1, swapFee);
        for (uint256 attempt; attempt < 4; ++attempt) {
            uint256 price = low
                ? _highestPriceWhoseFloorAdmits(produced, swapFee)
                : _lowestPriceWhoseCeilingAdmits(produced, swapFee);
            adapter.setReading(price, PRICE_DECIMALS, block.timestamp - 60);
            bound = low ? _minAllowed(price, swapFee) : _maxAllowed(price, swapFee);

            bytes32 orderId = createOrder(market, AMOUNT_IN, 1, keccak256(abi.encode(salt, attempt)));
            fundPayer(market, payer, AMOUNT_IN);
            uint256 before = market.payout.balanceOf(merchant);
            vm.prank(payer);
            try market.executor.pay(orderId) {
                return (market.payout.balanceOf(merchant) - before, bound);
            } catch (bytes memory err) {
                (, uint256 sawProduced,) = _decodeBandError(err);
                produced = sawProduced;
            }
        }
        revert("the boundary settlement never converged");
    }

    /// @dev Unwraps the PoolManager's envelope and reads the band error's three arguments.
    function _decodeBandError(bytes memory err)
        private
        pure
        returns (bytes4 innerSelector, uint256 produced, uint256 boundary)
    {
        bytes memory payload = new bytes(err.length - 4);
        for (uint256 i; i < payload.length; ++i) {
            payload[i] = err[i + 4];
        }
        (,, bytes memory inner,) = abi.decode(payload, (address, bytes4, bytes, bytes));
        innerSelector = bytes4(inner);
        require(
            innerSelector == UnicaMarketHook.ExecutionBelowOracleBand.selector
                || innerSelector == UnicaMarketHook.ExecutionAboveOracleBand.selector,
            "the refusal was not a band error"
        );
        bytes memory args = new bytes(inner.length - 4);
        for (uint256 i; i < args.length; ++i) {
            args[i] = inner[i + 4];
        }
        (, produced, boundary) = abi.decode(args, (bytes32, uint256, uint256));
    }

    // ---- the route check, repeated on every swap (S8) --------------------------------------------------

    function test_changedFeedIdIsCaughtOnTheNextSwap() public {
        bytes32 forged = keccak256("a different route");
        adapter.setFeedId(forged);
        _expectRefusal(
            abi.encodeWithSelector(UnicaMarketHook.OracleFeedMismatch.selector, market.marketId, FEED_ID, forged),
            "route"
        );

        // Control: put the route back and the same order settles.
        adapter.setFeedId(FEED_ID);
        _settles("route-control");
    }

    // ---- O19, O20: the condition view ---------------------------------------------------------------------

    function test_O19_conditionMapsEveryAdapterFailure_andPausedRetiredOverride() public {
        (UnicaMarketHook.OracleCondition condition, bytes4 reason,,,) = market.hook.oracleCondition();
        assertEq(uint8(condition), uint8(UnicaMarketHook.OracleCondition.OK), "a fresh reading is not OK");
        assertEq(reason, bytes4(0), "OK carried a reason");

        adapter.setMode(MockOracleAdapter.Mode.MarketClosedMode);
        (condition, reason,,,) = market.hook.oracleCondition();
        assertEq(uint8(condition), uint8(UnicaMarketHook.OracleCondition.MARKET_CLOSED), "MarketClosed did not map");
        assertEq(reason, MockOracleAdapter.MarketClosed.selector, "reason is not the caught selector");

        MockOracleAdapter.Mode[3] memory stale = [
            MockOracleAdapter.Mode.SequencerDownMode,
            MockOracleAdapter.Mode.SequencerGracePeriodMode,
            MockOracleAdapter.Mode.FeedUnreadableMode
        ];
        for (uint256 i; i < stale.length; ++i) {
            adapter.setMode(stale[i]);
            (condition,,,,) = market.hook.oracleCondition();
            assertEq(
                uint8(condition), uint8(UnicaMarketHook.OracleCondition.STALE_ORACLE), "a failure did not map to STALE"
            );
        }

        // A zero price and a stale timestamp are STALE too, with the hook's own selector as the reason.
        adapter.setMode(MockOracleAdapter.Mode.Live);
        adapter.setPrice(0);
        (condition, reason,,,) = market.hook.oracleCondition();
        assertEq(uint8(condition), uint8(UnicaMarketHook.OracleCondition.STALE_ORACLE));
        assertEq(reason, UnicaMarketHook.OraclePriceZero.selector);
        adapter.setPrice(PRICE_1_TO_1);

        // PAUSED and RETIRED override any oracle condition, whatever the adapter says.
        registry.pause(market.marketId);
        (condition, reason,,,) = market.hook.oracleCondition();
        assertEq(uint8(condition), uint8(UnicaMarketHook.OracleCondition.MARKET_CLOSED), "PAUSED did not override");
        registry.retire(market.marketId);
        (condition,,,,) = market.hook.oracleCondition();
        assertEq(uint8(condition), uint8(UnicaMarketHook.OracleCondition.MARKET_CLOSED), "RETIRED did not override");
    }

    function test_O20_aDemonstrationMarketReportsItselfAsOneAndZeroesTheReference() public {
        Market memory demo = deployMarket(defaultSpec()); // no adapter at all

        (UnicaMarketHook.OracleCondition condition, bytes4 reason, uint256 p, uint8 d, uint256 t) =
            demo.hook.oracleCondition();
        assertEq(uint8(condition), uint8(UnicaMarketHook.OracleCondition.DEMONSTRATION_ONLY));
        assertEq(reason, bytes4(0));
        assertEq(p, 0);
        assertEq(d, 0);
        assertEq(t, 0);

        (uint256 price, uint8 decimals, uint64 updatedAt, bool demoFlag) =
            _settleAndReadReferenceOn(demo, AMOUNT_IN, "o20");
        assertEq(price, 0, "a demonstration receipt carried a price");
        assertEq(decimals, 0, "a demonstration receipt carried decimals");
        assertEq(uint256(updatedAt), 0, "a demonstration receipt carried a timestamp");
        assertTrue(demoFlag, "a demonstration receipt was not flagged");
        assertTrue(registry.getMarket(demo.marketId).demonstrationOnly, "the record and the receipt disagree");
    }

    // ---- O27: the price read is a STATICCALL, and the EVM enforces it ------------------------------------

    function test_O27_anAdapterThatWritesStorageCannotBeRead() public {
        MarketSpec memory hostileSpec = defaultSpec();
        (address assetAddr, address payoutAddr) = peekTokens(hostileSpec.assetIsCurrency0);
        StateWritingOracleAdapter writer = new StateWritingOracleAdapter(
            assetAddr, payoutAddr, FEED_ID, PRICE_1_TO_1, PRICE_DECIMALS, block.timestamp - 60
        );
        hostileSpec.adapter = address(writer);
        hostileSpec.feedId = FEED_ID;
        hostileSpec.maxAge = MAX_AGE;
        hostileSpec.maxDeviationBps = MAX_BPS;
        Market memory m = deployMarket(hostileSpec);

        bytes32 orderId = createOrder(m, AMOUNT_IN, 1, "o27");
        fundPayer(m, payer, AMOUNT_IN);

        // The STATICCALL fails with no data of its own, and the PoolManager wraps the hook's empty
        // revert. The envelope is the assertion: the refusal came from THIS hook, inside afterSwap.
        vm.prank(payer);
        expectWrappedHookRevert(address(m.hook), "");
        m.executor.pay(orderId);
        assertEq(m.hook.receiptCount(), 0, "a receipt survived a failed price read");

        // Control: a `view` adapter on the same shape settles.
        _settles("o27-control");
    }

    // ---- helpers --------------------------------------------------------------------------------------

    function _expectRefusal(bytes memory innerRevert, bytes32 salt) private {
        bytes32 orderId = createOrder(market, AMOUNT_IN, 1, salt);
        fundPayer(market, payer, AMOUNT_IN);
        vm.prank(payer);
        expectWrappedHookRevert(address(market.hook), innerRevert);
        market.executor.pay(orderId);
    }

    function _settles(bytes32 salt) private {
        bytes32 orderId = createOrder(market, AMOUNT_IN, 1, salt);
        fundPayer(market, payer, AMOUNT_IN);
        uint256 before = market.payout.balanceOf(merchant);
        vm.prank(payer);
        market.executor.pay(orderId);
        assertGt(market.payout.balanceOf(merchant), before, "the control did not settle");
    }

    function _settleAndReadReference(uint128 amountIn, bytes32 salt)
        private
        returns (uint256 price, uint8 decimals, uint64 updatedAt, bool demonstrationOnly)
    {
        return _settleAndReadReferenceOn(market, amountIn, salt);
    }

    function _settleAndReadReferenceOn(Market memory m, uint128 amountIn, bytes32 salt)
        private
        returns (uint256 price, uint8 decimals, uint64 updatedAt, bool demonstrationOnly)
    {
        bytes32 orderId = createOrder(m, amountIn, 1, salt);
        fundPayer(m, payer, amountIn);

        vm.recordLogs();
        vm.prank(payer);
        m.executor.pay(orderId);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        int256 at = indexOfLog(logs, address(m.hook), RECEIPT_TOPIC);
        require(at >= 0, "no receipt");
        // Words 10 to 13 of the receipt's data: referencePrice, referenceDecimals,
        // referenceUpdatedAt, demonstrationOnly. Read by offset rather than with a thirteen-type
        // `abi.decode`, which the legacy code generator cannot fit on the stack either.
        bytes memory data = logs[uint256(at)].data;
        assembly ("memory-safe") {
            price := mload(add(data, 0x140))
            decimals := mload(add(data, 0x160))
            updatedAt := mload(add(data, 0x180))
            demonstrationOnly := mload(add(data, 0x1a0))
        }
    }

    // ---- the band, recomputed here (SO §4.2) --------------------------------------------------------------

    function _refOutFloor(uint256 price, uint24 swapFee) private view returns (uint256) {
        return FullMath.mulDiv(
            uint256(AMOUNT_IN) * (1e6 - uint256(swapFee)),
            price * (10 ** uint256(market.payoutDecimals)),
            10 ** (6 + uint256(market.assetDecimals) + uint256(PRICE_DECIMALS))
        );
    }

    function _refOutCeil(uint256 price, uint24 swapFee) private view returns (uint256) {
        return FullMath.mulDivRoundingUp(
            uint256(AMOUNT_IN) * (1e6 - uint256(swapFee)),
            price * (10 ** uint256(market.payoutDecimals)),
            10 ** (6 + uint256(market.assetDecimals) + uint256(PRICE_DECIMALS))
        );
    }

    function _minAllowed(uint256 price, uint24 swapFee) private view returns (uint256) {
        return FullMath.mulDivRoundingUp(_refOutCeil(price, swapFee), 10_000 - uint256(MAX_BPS), 10_000);
    }

    function _maxAllowed(uint256 price, uint24 swapFee) private view returns (uint256) {
        return FullMath.mulDiv(_refOutFloor(price, swapFee), 10_000 + uint256(MAX_BPS), 10_000);
    }

    /// @dev `minAllowed` is monotone non-decreasing in the price, so a binary search finds the largest
    ///      price that still admits `produced` — the value the row then puts on the adapter so the
    ///      output sits exactly on the bound.
    function _highestPriceWhoseFloorAdmits(uint256 produced, uint24 swapFee) private view returns (uint256) {
        uint256 low = 1;
        uint256 high = PRICE_1_TO_1 * 4;
        require(_minAllowed(low, swapFee) <= produced, "the search range starts too high");
        require(_minAllowed(high, swapFee) > produced, "the search range ends too low");
        while (high - low > 1) {
            uint256 mid = (low + high) / 2;
            if (_minAllowed(mid, swapFee) <= produced) low = mid;
            else high = mid;
        }
        return low;
    }

    /// @dev `maxAllowed` is monotone non-decreasing in the price too, so the smallest price that still
    ///      admits `produced` is the mirror search.
    function _lowestPriceWhoseCeilingAdmits(uint256 produced, uint24 swapFee) private view returns (uint256) {
        uint256 low = 1;
        uint256 high = PRICE_1_TO_1 * 4;
        require(_maxAllowed(low, swapFee) < produced, "the search range starts too high");
        require(_maxAllowed(high, swapFee) >= produced, "the search range ends too low");
        while (high - low > 1) {
            uint256 mid = (low + high) / 2;
            if (_maxAllowed(mid, swapFee) >= produced) high = mid;
            else low = mid;
        }
        return high;
    }
}
