// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";

import {ChainlinkFeedAdapter} from "../../../src/unica-v4/oracle/ChainlinkFeedAdapter.sol";
import {UnicaMarketTypes} from "../../../src/unica-v4/UnicaMarketTypes.sol";
import {UnicaMarketRegistry} from "../../../src/unica-v4/UnicaMarketRegistry.sol";
import {FixtureAggregator} from "../fixtures/FixtureAggregator.sol";

/// @title Rows O28 and O29 for `ChainlinkFeedAdapter`, plus the configuration-only second route
/// @notice Written from `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` §7, `TEST-MATRIX.md` and
///         `docs/unica-v4/ORACLE-FRESHNESS-O2.md`. Every price here comes from a `FixtureAggregator`:
///         a settable stand-in that is not authenticated pricing and carries no value. NOTHING in
///         this file is a market price, a quotation, or a claim about any real asset. The rows exist
///         to prove that each refusal the adapter names actually fires, which is only knowable by
///         feeding it the fault on purpose.
///
///         Every negative row sits beside the control that differs from it in exactly one field, in
///         the same function, because a revert on its own cannot tell a working check apart from a
///         fixture that never reached it.
contract ChainlinkFeedAdapterTest is Test {
    address internal constant ASSET = address(0xA55E7);
    address internal constant QUOTE = address(0x9407E);
    address internal constant OTHER_ASSET = address(0x07E4);

    uint256 internal constant GRACE = 3600;

    /// @dev Test bounds, not approved constants. They are deliberately far apart so a row that only
    ///      passes because both legs share one bound would fail here.
    uint48 internal constant ASSET_MAX_AGE = 3600;
    uint48 internal constant QUOTE_MAX_AGE = 86_400;

    FixtureAggregator internal assetFeed;
    FixtureAggregator internal quoteFeed;
    FixtureAggregator internal sequencer;

    ChainlinkFeedAdapter internal adapter;

    function setUp() public {
        vm.warp(1_700_000_000);
        assetFeed = new FixtureAggregator(8, "FIXTURE ASSET / USD - not authenticated pricing - no value");
        quoteFeed = new FixtureAggregator(8, "FIXTURE QUOTE / USD - not authenticated pricing - no value");
        sequencer = new FixtureAggregator(0, "FIXTURE sequencer uptime - no value");

        adapter = _cross(address(assetFeed), address(quoteFeed), ASSET, QUOTE, address(0), 0);
        _healthy();
    }

    // ---- construction ---------------------------------------------------------------------------------

    function test_O28_constructorRefusals() public {
        vm.expectRevert(ChainlinkFeedAdapter.ZeroAddress.selector);
        _cross(address(assetFeed), address(quoteFeed), address(0), QUOTE, address(0), 0);

        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.SameToken.selector, ASSET));
        _cross(address(assetFeed), address(quoteFeed), ASSET, ASSET, address(0), 0);

        address hollow = address(0xDEAD);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.FeedNoCode.selector, hollow));
        _cross(hollow, address(quoteFeed), ASSET, QUOTE, address(0), 0);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.FeedNoCode.selector, hollow));
        _cross(address(assetFeed), hollow, ASSET, QUOTE, address(0), 0);

        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.SequencerFeedNoCode.selector, hollow));
        _cross(address(assetFeed), address(quoteFeed), ASSET, QUOTE, hollow, GRACE);

        // Control: the same arguments with real feeds construct, and a zero sequencer feed is the
        // documented "this chain has none" case rather than a mistake.
        ChainlinkFeedAdapter noSequencer = _cross(address(assetFeed), address(quoteFeed), ASSET, QUOTE, address(0), 0);
        assertEq(noSequencer.SEQUENCER_FEED(), address(0), "no sequencer feed");
        ChainlinkFeedAdapter withSequencer =
            _cross(address(assetFeed), address(quoteFeed), ASSET, QUOTE, address(sequencer), GRACE);
        assertEq(withSequencer.SEQUENCER_FEED(), address(sequencer), "sequencer feed recorded");
        assertEq(withSequencer.GRACE_PERIOD(), GRACE, "grace period recorded");
    }

    /// @notice A freshness bound is never inferred, never defaulted and never ignored.
    function test_O30_constructorRefusesUnreviewedFreshnessBounds() public {
        // A zero asset bound would accept only a price published in this very second. Nobody means
        // that, so it is refused rather than obeyed.
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.MaxAgeRequired.selector, address(assetFeed)));
        new ChainlinkFeedAdapter(
            address(assetFeed), 0, address(quoteFeed), QUOTE_MAX_AGE, ASSET, QUOTE, address(0), 0, address(0)
        );

        // In cross mode the quote leg needs its own reviewed bound too.
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.MaxAgeRequired.selector, address(quoteFeed)));
        new ChainlinkFeedAdapter(
            address(assetFeed), ASSET_MAX_AGE, address(quoteFeed), 0, ASSET, QUOTE, address(0), 0, address(0)
        );

        // In direct mode there is no quote leg, so a bound for one describes nothing.
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkFeedAdapter.QuoteMaxAgeWithoutQuoteFeed.selector, QUOTE_MAX_AGE)
        );
        new ChainlinkFeedAdapter(
            address(assetFeed), ASSET_MAX_AGE, address(0), QUOTE_MAX_AGE, ASSET, QUOTE, address(0), 0, address(0)
        );

        // Controls: one second is a bound, and both modes record what they were given.
        ChainlinkFeedAdapter tight = new ChainlinkFeedAdapter(
            address(assetFeed), 1, address(quoteFeed), 1, ASSET, QUOTE, address(0), 0, address(0)
        );
        assertEq(tight.ASSET_MAX_AGE(), 1, "a one second bound is a bound");
        assertEq(tight.QUOTE_MAX_AGE(), 1, "and so is the quote leg's");
        assertFalse(tight.isDirectRoute(), "two feeds is a cross route");

        ChainlinkFeedAdapter direct = _direct(address(assetFeed), ASSET, QUOTE, address(0), 0);
        assertEq(direct.QUOTE_FEED(), address(0), "direct mode has no quote proxy");
        assertEq(direct.QUOTE_MAX_AGE(), 0, "and no quote bound");
        assertTrue(direct.isDirectRoute(), "one feed is a direct route");
    }

    // ---- the route identity ------------------------------------------------------------------------------

    function test_O28_feedIdIsDeterministicAndBindsBothProxies() public {
        bytes32 expected =
            _expectedFeedId(address(assetFeed), address(quoteFeed), ASSET_MAX_AGE, QUOTE_MAX_AGE, ASSET, QUOTE);
        assertEq(adapter.feedIdFor(ASSET, QUOTE), expected, "feedId commits to the whole route");
        assertEq(adapter.adapterKind(), keccak256("CHAINLINK_FEED"), "adapterKind");

        // A second instance over the same pair but a different asset proxy is a different route.
        FixtureAggregator otherAssetFeed =
            new FixtureAggregator(8, "FIXTURE OTHER / USD - not authenticated pricing - no value");
        ChainlinkFeedAdapter other = _cross(address(otherAssetFeed), address(quoteFeed), ASSET, QUOTE, address(0), 0);
        assertTrue(other.feedIdFor(ASSET, QUOTE) != expected, "a different proxy is a different feedId");

        // Control on determinism: an identical instance derives the identical id.
        ChainlinkFeedAdapter twin = _cross(address(assetFeed), address(quoteFeed), ASSET, QUOTE, address(0), 0);
        assertEq(twin.feedIdFor(ASSET, QUOTE), expected, "the same route gives the same feedId");
    }

    /// @notice POLICY MISMATCH. Changing either freshness bound is a different route, because the
    ///         bound is part of what the price means. Nothing else about the deployment changes.
    function test_O30_feedIdChangesWhenAFreshnessBoundChanges() public {
        bytes32 base = adapter.feedIdFor(ASSET, QUOTE);

        ChainlinkFeedAdapter looserAsset = new ChainlinkFeedAdapter(
            address(assetFeed),
            ASSET_MAX_AGE + 1,
            address(quoteFeed),
            QUOTE_MAX_AGE,
            ASSET,
            QUOTE,
            address(0),
            0,
            address(0)
        );
        assertTrue(looserAsset.feedIdFor(ASSET, QUOTE) != base, "one second on the asset leg is a new route");

        ChainlinkFeedAdapter looserQuote = new ChainlinkFeedAdapter(
            address(assetFeed),
            ASSET_MAX_AGE,
            address(quoteFeed),
            QUOTE_MAX_AGE + 1,
            ASSET,
            QUOTE,
            address(0),
            0,
            address(0)
        );
        assertTrue(looserQuote.feedIdFor(ASSET, QUOTE) != base, "one second on the quote leg is a new route");
        assertTrue(
            looserQuote.feedIdFor(ASSET, QUOTE) != looserAsset.feedIdFor(ASSET, QUOTE),
            "and the two changes are not the same change"
        );

        // A direct route over the same asset proxy is a different route again: no quote leg at all.
        ChainlinkFeedAdapter direct = _direct(address(assetFeed), ASSET, QUOTE, address(0), 0);
        assertTrue(direct.feedIdFor(ASSET, QUOTE) != base, "dropping the cross is a new route");

        // Control: the same bounds a second time reproduce the same id, so the difference above is
        // the bound and not the deployment.
        ChainlinkFeedAdapter same = _cross(address(assetFeed), address(quoteFeed), ASSET, QUOTE, address(0), 0);
        assertEq(same.feedIdFor(ASSET, QUOTE), base, "unchanged bounds, unchanged id");
    }

    /// @notice HISTORICAL STABILITY. Deploying the new policy does not reach back into the old one.
    ///         A market registered under the old adapter keeps reading the old adapter, whose id and
    ///         whose bounds are exactly what they were, so its settled history stays interpretable.
    function test_O30_anOldAdaptersFeedIdSurvivesTheNewPolicy() public {
        ChainlinkFeedAdapter old = _cross(address(assetFeed), address(quoteFeed), ASSET, QUOTE, address(0), 0);
        bytes32 idBefore = old.feedIdFor(ASSET, QUOTE);
        uint48 assetBoundBefore = old.ASSET_MAX_AGE();
        uint48 quoteBoundBefore = old.QUOTE_MAX_AGE();

        // The policy change lands as a NEW adapter, deployed beside the old one.
        ChainlinkFeedAdapter replacement = new ChainlinkFeedAdapter(
            address(assetFeed), 60, address(quoteFeed), 120, ASSET, QUOTE, address(0), 0, address(0)
        );
        assertTrue(replacement.feedIdFor(ASSET, QUOTE) != idBefore, "the replacement is a different route");

        assertEq(old.feedIdFor(ASSET, QUOTE), idBefore, "the old route's id is untouched");
        assertEq(old.ASSET_MAX_AGE(), assetBoundBefore, "and so is its asset bound");
        assertEq(old.QUOTE_MAX_AGE(), quoteBoundBefore, "and its quote bound");

        // And it still prices: a reading the replacement's tighter bound would refuse is still fresh
        // enough for the market that was registered under the old one.
        assetFeed.set(int256(395e8), block.timestamp - 600, 1, 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkFeedAdapter.FeedStale.selector, address(assetFeed), block.timestamp - 600, uint256(60)
            )
        );
        replacement.latestPrice(ASSET, QUOTE);
        (uint256 price,,) = old.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "the historical market's own adapter is unaffected");
    }

    function test_O29_reversedArgumentsAreNotSupported() public {
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.PairNotSupported.selector, QUOTE, ASSET));
        adapter.feedIdFor(QUOTE, ASSET);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.PairNotSupported.selector, QUOTE, ASSET));
        adapter.latestPrice(QUOTE, ASSET);

        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.PairNotSupported.selector, OTHER_ASSET, QUOTE));
        adapter.latestPrice(OTHER_ASSET, QUOTE);

        // Control: the pair in the order the adapter was built for.
        (uint256 price,,) = adapter.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "the supported ordering reads");
    }

    // ---- the clean read ------------------------------------------------------------------------------------

    /// @notice FRESH TWO-LEG. Both legs inside their own bounds, and the timestamp handed to the hook
    ///         is the ASSET leg's, not the older of the two.
    function test_O30_freshTwoLegReportsTheAssetLegsTimestamp() public {
        assetFeed.set(int256(395e8), 1_700_000_000, 7, 7);
        quoteFeed.set(int256(1e8), 1_700_000_000 - 50_000, 4, 4);

        (uint256 price, uint8 decimals, uint256 updatedAt) = adapter.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "cross price per whole asset");
        assertEq(decimals, 18, "always 18");
        assertEq(updatedAt, 1_700_000_000, "the ASSET leg's own publish time");

        // The quote leg being 50,000 seconds old is fine here and would not be if the two legs shared
        // the asset leg's bound: the row is about the two bounds being genuinely separate.
        assertTrue(50_000 > ASSET_MAX_AGE, "the quote leg is older than the asset leg's bound");
        assertTrue(50_000 < QUOTE_MAX_AGE, "and younger than its own");

        // Moving the asset leg moves the reported time; moving only the quote leg does not.
        assetFeed.set(int256(395e8), 1_700_000_000 - 1_000, 8, 8);
        (,, updatedAt) = adapter.latestPrice(ASSET, QUOTE);
        assertEq(updatedAt, 1_700_000_000 - 1_000, "the asset leg drives the reported time");
        quoteFeed.set(int256(1e8), 1_700_000_000 - 60_000, 5, 5);
        (,, updatedAt) = adapter.latestPrice(ASSET, QUOTE);
        assertEq(updatedAt, 1_700_000_000 - 1_000, "and the quote leg does not");
    }

    /// @notice FRESH DIRECT. One feed, already quoted in the payout unit, no cross computed.
    function test_O30_freshDirectRoute() public {
        ChainlinkFeedAdapter direct = _direct(address(assetFeed), ASSET, QUOTE, address(0), 0);

        assetFeed.set(int256(395e8), 1_700_000_000 - 10, 1, 1);
        (uint256 price, uint8 decimals, uint256 updatedAt) = direct.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "the feed's own answer, moved to 18 decimals");
        assertEq(decimals, 18, "always 18");
        assertEq(updatedAt, 1_700_000_000 - 10, "the one leg's publish time");

        // The quote feed is not consulted at all: breaking it changes nothing.
        quoteFeed.setReverting(true);
        (price,,) = direct.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "a direct route reads no second feed");

        // And the scale of the single feed is handled, not assumed.
        assetFeed.setDecimals(18);
        assetFeed.set(int256(395e18), 1_700_000_000 - 10, 2, 2);
        (price,,) = direct.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "an 18 decimal feed needs no rescaling");
        assetFeed.setDecimals(6);
        assetFeed.set(int256(395e6), 1_700_000_000 - 10, 3, 3);
        (price,,) = direct.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "a 6 decimal feed is scaled up");
    }

    function test_O28_crossRouteOverSixEightAndEighteenDecimalFeeds() public {
        uint8[3] memory ds = [uint8(6), 8, 18];
        for (uint256 i; i < ds.length; ++i) {
            for (uint256 j; j < ds.length; ++j) {
                assetFeed.setDecimals(ds[i]);
                quoteFeed.setDecimals(ds[j]);
                // 250 units of quote per whole asset, expressed in each feed's own scale.
                assetFeed.set(int256(500 * (10 ** uint256(ds[i]))), 1_700_000_000, 1, 1);
                quoteFeed.set(int256(2 * (10 ** uint256(ds[j]))), 1_700_000_000, 1, 1);

                (uint256 price, uint8 decimals,) = adapter.latestPrice(ASSET, QUOTE);
                assertEq(price, 250e18, "the decimals of the two feeds cancel");
                assertEq(decimals, 18, "the answer is always at 18");
            }
        }
    }

    // ---- freshness, one leg at a time ------------------------------------------------------------------------

    /// @notice STALE ASSET LEG, with the quote leg fresh, so the refusal cannot be the other leg's.
    function test_O30_staleAssetLegIsRefusedAgainstItsOwnBound() public {
        quoteFeed.set(int256(1e8), block.timestamp, 4, 4);

        uint256 tooOld = block.timestamp - ASSET_MAX_AGE - 1;
        assetFeed.set(int256(395e8), tooOld, 1, 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkFeedAdapter.FeedStale.selector, address(assetFeed), tooOld, uint256(ASSET_MAX_AGE)
            )
        );
        adapter.latestPrice(ASSET, QUOTE);

        // Control: the boundary itself is accepted. Exactly maxAge old is inside the bound; one
        // second more is not, and those two rows are the whole difference.
        assetFeed.set(int256(395e8), block.timestamp - ASSET_MAX_AGE, 1, 1);
        (uint256 price,, uint256 updatedAt) = adapter.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "exactly at the bound reads");
        assertEq(updatedAt, block.timestamp - ASSET_MAX_AGE, "and reports its own age");
    }

    /// @notice STALE QUOTE LEG while the asset leg is fresh. Under one shared bound this reading
    ///         would have been refused for the wrong reason or accepted for none; here it is named.
    function test_O30_staleQuoteLegIsRefusedWhileTheAssetLegIsFresh() public {
        assetFeed.set(int256(395e8), block.timestamp, 1, 1);

        uint256 tooOld = block.timestamp - QUOTE_MAX_AGE - 1;
        quoteFeed.set(int256(1e8), tooOld, 4, 4);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkFeedAdapter.FeedStale.selector, address(quoteFeed), tooOld, uint256(QUOTE_MAX_AGE)
            )
        );
        adapter.latestPrice(ASSET, QUOTE);

        // Control: one second younger, on the quote leg alone, and the same call reads.
        quoteFeed.set(int256(1e8), block.timestamp - QUOTE_MAX_AGE, 4, 4);
        (uint256 price,, uint256 updatedAt) = adapter.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "the quote leg at its own bound reads");
        assertEq(updatedAt, block.timestamp, "and the reported time is still the asset leg's");
    }

    /// @notice STALE DIRECT. The single leg is judged against the single bound.
    function test_O30_staleDirectRouteIsRefused() public {
        ChainlinkFeedAdapter direct = _direct(address(assetFeed), ASSET, QUOTE, address(0), 0);

        uint256 tooOld = block.timestamp - ASSET_MAX_AGE - 1;
        assetFeed.set(int256(395e8), tooOld, 1, 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkFeedAdapter.FeedStale.selector, address(assetFeed), tooOld, uint256(ASSET_MAX_AGE)
            )
        );
        direct.latestPrice(ASSET, QUOTE);

        // Control: one second younger and the same route reads.
        assetFeed.set(int256(395e8), tooOld + 1, 1, 1);
        (uint256 price,,) = direct.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "inside the bound the direct route reads");
    }

    /// @notice A publish time later than the block reading it is refused, not treated as brand new.
    function test_O30_timestampInTheFutureIsRefused() public {
        assetFeed.set(int256(395e8), block.timestamp + 1, 1, 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkFeedAdapter.FeedTimestampInFuture.selector,
                address(assetFeed),
                block.timestamp + 1,
                block.timestamp
            )
        );
        adapter.latestPrice(ASSET, QUOTE);

        // Control: this very second is not the future.
        assetFeed.set(int256(395e8), block.timestamp, 1, 1);
        (uint256 price,,) = adapter.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "a reading published now reads");
    }

    // ---- one fault at a time -------------------------------------------------------------------------------

    function test_O28_answerNotPositive() public {
        assetFeed.set(0, 1_700_000_000, 1, 1);
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkFeedAdapter.FeedAnswerNotPositive.selector, address(assetFeed), int256(0))
        );
        adapter.latestPrice(ASSET, QUOTE);

        assetFeed.set(-1, 1_700_000_000, 1, 1);
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkFeedAdapter.FeedAnswerNotPositive.selector, address(assetFeed), int256(-1))
        );
        adapter.latestPrice(ASSET, QUOTE);

        // The quote leg is checked too, not just the asset leg.
        _healthy();
        quoteFeed.set(-5, 1_700_000_000, 1, 1);
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkFeedAdapter.FeedAnswerNotPositive.selector, address(quoteFeed), int256(-5))
        );
        adapter.latestPrice(ASSET, QUOTE);

        // Control: one wei of answer is positive and reads.
        _healthy();
        (uint256 price,,) = adapter.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "a positive answer reads");
    }

    /// @notice OUT OF RANGE. An answer too large to multiply refuses by name, on either leg, before
    ///         any arithmetic is attempted.
    function test_O30_answerOutOfRange() public {
        int256 tooBig = int256(uint256(type(uint128).max) + 1);

        assetFeed.set(tooBig, block.timestamp, 1, 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkFeedAdapter.FeedAnswerOutOfRange.selector, address(assetFeed), uint256(tooBig)
            )
        );
        adapter.latestPrice(ASSET, QUOTE);

        _healthy();
        quoteFeed.set(tooBig, block.timestamp, 1, 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkFeedAdapter.FeedAnswerOutOfRange.selector, address(quoteFeed), uint256(tooBig)
            )
        );
        adapter.latestPrice(ASSET, QUOTE);

        // A direct route bounds its single leg the same way.
        _healthy();
        ChainlinkFeedAdapter direct = _direct(address(assetFeed), ASSET, QUOTE, address(0), 0);
        assetFeed.set(tooBig, block.timestamp, 1, 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkFeedAdapter.FeedAnswerOutOfRange.selector, address(assetFeed), uint256(tooBig)
            )
        );
        direct.latestPrice(ASSET, QUOTE);

        // Control: exactly the largest accepted answer is accepted, so the bound is a bound and not
        // a refusal of everything large.
        _healthy();
        assetFeed.setDecimals(0);
        assetFeed.set(int256(uint256(type(uint128).max)), block.timestamp, 1, 1);
        quoteFeed.setDecimals(0);
        quoteFeed.set(int256(1), block.timestamp, 1, 1);
        (uint256 price,,) = adapter.latestPrice(ASSET, QUOTE);
        assertEq(price, uint256(type(uint128).max) * 1e18, "the largest accepted answer reads");
    }

    function test_O28_missingTimestamps() public {
        assetFeed.set(int256(395e8), 0, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.FeedNoTimestamp.selector, address(assetFeed)));
        adapter.latestPrice(ASSET, QUOTE);

        // `startedAt` zero on its own is the same refusal: a round that never opened.
        _healthy();
        assetFeed.setStartedAt(0);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.FeedNoTimestamp.selector, address(assetFeed)));
        adapter.latestPrice(ASSET, QUOTE);

        // Control: both timestamps present.
        _healthy();
        (,, uint256 updatedAt) = adapter.latestPrice(ASSET, QUOTE);
        assertEq(updatedAt, 1_700_000_000, "a timestamped round reads");
    }

    function test_O28_carriedOverRound() public {
        assetFeed.set(int256(395e8), 1_700_000_000, 9, 8);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkFeedAdapter.FeedRoundIncomplete.selector, address(assetFeed), uint80(9), uint80(8)
            )
        );
        adapter.latestPrice(ASSET, QUOTE);

        // The quote leg carries the same check.
        _healthy();
        quoteFeed.set(int256(1e8), 1_700_000_000, 4, 3);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkFeedAdapter.FeedRoundIncomplete.selector, address(quoteFeed), uint80(4), uint80(3)
            )
        );
        adapter.latestPrice(ASSET, QUOTE);

        // Control: `answeredInRound == roundId` is the boundary and it passes, as does a later one.
        _healthy();
        assetFeed.set(int256(395e8), 1_700_000_000, 9, 9);
        (uint256 price,,) = adapter.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "a completed round reads");
        assetFeed.set(int256(395e8), 1_700_000_000, 9, 10);
        (price,,) = adapter.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "and so does a later answeredInRound");
    }

    function test_O28_decimalsAboveTheBound() public {
        assetFeed.setDecimals(19);
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkFeedAdapter.FeedDecimalsUnsupported.selector, address(assetFeed), uint8(19))
        );
        adapter.latestPrice(ASSET, QUOTE);

        // Control: exactly 18 is the boundary and it is accepted.
        assetFeed.setDecimals(18);
        assetFeed.set(int256(395e18), 1_700_000_000, 1, 1);
        (uint256 price,,) = adapter.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "18 decimals is inside the bound");
    }

    function test_O28_unreadableFeed() public {
        assetFeed.setReverting(true);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.FeedUnreadable.selector, address(assetFeed)));
        adapter.latestPrice(ASSET, QUOTE);

        quoteFeed.setReverting(true);
        assetFeed.setReverting(false);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.FeedUnreadable.selector, address(quoteFeed)));
        adapter.latestPrice(ASSET, QUOTE);

        // Control: both feeds answering.
        quoteFeed.setReverting(false);
        (uint256 price,,) = adapter.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "a readable pair reads");
    }

    // ---- the sequencer ---------------------------------------------------------------------------------------

    function test_O28_sequencerDownGraceAndUnknown() public {
        ChainlinkFeedAdapter guarded =
            _cross(address(assetFeed), address(quoteFeed), ASSET, QUOTE, address(sequencer), GRACE);

        // Down: one is the documented "down" value.
        sequencer.set(1, block.timestamp - GRACE - 1, 1, 1);
        vm.expectRevert(ChainlinkFeedAdapter.SequencerDown.selector);
        guarded.latestPrice(ASSET, QUOTE);

        // Any other non-zero value is also treated as down, never as up.
        sequencer.set(7, block.timestamp - GRACE - 1, 1, 1);
        vm.expectRevert(ChainlinkFeedAdapter.SequencerDown.selector);
        guarded.latestPrice(ASSET, QUOTE);

        // Up but with no start time: the status is unknown, which is not the same as up.
        sequencer.set(0, block.timestamp - GRACE - 1, 1, 1);
        sequencer.setStartedAt(0);
        vm.expectRevert(ChainlinkFeedAdapter.SequencerStatusUnknown.selector);
        guarded.latestPrice(ASSET, QUOTE);

        // Up, but only just: inside the grace period a fresh-looking price is still refused.
        uint256 justBack = block.timestamp - GRACE;
        sequencer.set(0, justBack, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.SequencerGracePeriod.selector, justBack, GRACE));
        guarded.latestPrice(ASSET, QUOTE);

        // Control: one second past the grace period, the same reading is accepted.
        sequencer.set(0, block.timestamp - GRACE - 1, 1, 1);
        (uint256 price,,) = guarded.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "past the grace period the price reads");

        // And the adapter with no sequencer feed never asks: the same "down" sequencer is invisible.
        sequencer.set(1, block.timestamp - GRACE - 1, 1, 1);
        (price,,) = adapter.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "an adapter without a sequencer feed does not consult one");
    }

    // ---- the configuration-only second route -----------------------------------------------------------------

    /// @notice A SECOND pair onboarded through a SECOND adapter instance, and the registry refusing a
    ///         market whose committed feedId belongs to the other route. This is the wrong-feed-id
    ///         refusal at the moment a market is registered, which is the same check the hook repeats
    ///         on every swap.
    /// @dev The second aggregator is a test fixture - not an approved demonstration rate - no value.
    ///      Nothing here quotes, implies or approves a rate for any real security. What the row
    ///      proves is a configuration property only: two routes are two feedIds, and the registry
    ///      will not let a market commit to one while pointing at the other.
    function test_O29_secondRouteIsADifferentFeedIdAndTheRegistryRefusesTheMismatch() public {
        // "test fixture - not an approved demonstration rate - no value"
        FixtureAggregator secondAssetFeed = new FixtureAggregator(
            8, "FIXTURE second pair / USD - test fixture - not an approved demonstration rate - no value"
        );
        secondAssetFeed.set(int256(600e8), 1_700_000_000, 1, 1);

        ChainlinkFeedAdapter secondAdapter =
            _cross(address(secondAssetFeed), address(quoteFeed), OTHER_ASSET, QUOTE, address(0), 0);

        bytes32 firstRoute = adapter.feedIdFor(ASSET, QUOTE);
        bytes32 secondRoute = secondAdapter.feedIdFor(OTHER_ASSET, QUOTE);
        assertTrue(firstRoute != secondRoute, "two routes, two feedIds");

        // Neither adapter answers for the other's pair.
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.PairNotSupported.selector, OTHER_ASSET, QUOTE));
        adapter.feedIdFor(OTHER_ASSET, QUOTE);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.PairNotSupported.selector, ASSET, QUOTE));
        secondAdapter.feedIdFor(ASSET, QUOTE);

        // The registry, with this test contract as its factory, refuses a market on the second pair
        // that commits to the FIRST route's feedId while pointing at the second adapter.
        UnicaMarketRegistry registry = new UnicaMarketRegistry(address(this), true);
        UnicaMarketTypes.Market memory m = _record(OTHER_ASSET, QUOTE);
        bytes32 wrongId = keccak256(
            abi.encode(
                block.chainid, address(registry), OTHER_ASSET, QUOTE, uint32(1), address(secondAdapter), firstRoute
            )
        );
        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketRegistry.OracleFeedMismatch.selector, wrongId, firstRoute, secondRoute)
        );
        registry.register(
            wrongId,
            m,
            UnicaMarketTypes.OraclePolicy(address(secondAdapter), firstRoute, 300, 200, true),
            UnicaMarketTypes.Caps(1, 2, 3)
        );

        // Control: the same market committing to the route its adapter actually serves registers.
        bytes32 rightId = keccak256(
            abi.encode(
                block.chainid, address(registry), OTHER_ASSET, QUOTE, uint32(1), address(secondAdapter), secondRoute
            )
        );
        registry.register(
            rightId,
            m,
            UnicaMarketTypes.OraclePolicy(address(secondAdapter), secondRoute, 300, 200, true),
            UnicaMarketTypes.Caps(1, 2, 3)
        );
        assertEq(registry.statusOf(rightId), 1, "the matching route registers");
    }

    /// @notice The same refusal reached by the change this ruling introduces: a market registered
    ///         against one freshness policy does not accept an adapter carrying another.
    function test_O30_registryRefusesAMarketWhoseFreshnessPolicyMoved() public {
        UnicaMarketRegistry registry = new UnicaMarketRegistry(address(this), true);
        UnicaMarketTypes.Market memory m = _record(ASSET, QUOTE);

        ChainlinkFeedAdapter tightened = new ChainlinkFeedAdapter(
            address(assetFeed), 60, address(quoteFeed), QUOTE_MAX_AGE, ASSET, QUOTE, address(0), 0, address(0)
        );
        bytes32 oldRoute = adapter.feedIdFor(ASSET, QUOTE);
        bytes32 newRoute = tightened.feedIdFor(ASSET, QUOTE);

        bytes32 wrongId = keccak256(
            abi.encode(block.chainid, address(registry), ASSET, QUOTE, uint32(1), address(tightened), oldRoute)
        );
        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketRegistry.OracleFeedMismatch.selector, wrongId, oldRoute, newRoute)
        );
        registry.register(
            wrongId,
            m,
            UnicaMarketTypes.OraclePolicy(address(tightened), oldRoute, 300, 200, true),
            UnicaMarketTypes.Caps(1, 2, 3)
        );

        // Control: committing to the new adapter's own route registers, which is the intended path.
        bytes32 rightId = keccak256(
            abi.encode(block.chainid, address(registry), ASSET, QUOTE, uint32(1), address(tightened), newRoute)
        );
        registry.register(
            rightId,
            m,
            UnicaMarketTypes.OraclePolicy(address(tightened), newRoute, 300, 200, true),
            UnicaMarketTypes.Caps(1, 2, 3)
        );
        assertEq(registry.statusOf(rightId), 1, "a new policy is a new market");
    }

    // ---- the quote leg's incident lever ------------------------------------------------------------------------
    //
    // The market's `policy.maxAge` is applied by the hook to the one timestamp this adapter reports,
    // and that timestamp is the ASSET leg's. So the market's ceiling does not reach the quote leg,
    // and `tightenOraclePolicy` is inert there. These rows are about the lever that does reach it,
    // and about the two things it must never be able to do: loosen, or belong to anyone else.

    /// @notice The lever bites: a quote reading that was legal a moment ago is refused after the
    ///         operator tightens, and the asset leg is untouched by the same call.
    function test_O31_tighteningTheQuoteBoundRefusesAReadingItUsedToAccept() public {
        address operator = makeAddr("quoteFreshnessOperator");
        ChainlinkFeedAdapter lever = new ChainlinkFeedAdapter(
            address(assetFeed), ASSET_MAX_AGE, address(quoteFeed), QUOTE_MAX_AGE, ASSET, QUOTE, address(0), 0, operator
        );
        assertEq(lever.quoteMaxAgeInForce(), QUOTE_MAX_AGE, "in force starts at the ceiling");

        // A quote leg well inside its reviewed bound, and an asset leg that is fresh throughout.
        uint256 quoteAge = QUOTE_MAX_AGE / 2;
        assetFeed.set(int256(395e8), block.timestamp - 60, 1, 1);
        quoteFeed.set(int256(1e8), block.timestamp - quoteAge, 1, 1);
        (uint256 priceBefore,,) = lever.latestPrice(ASSET, QUOTE);
        assertGt(priceBefore, 0, "the position under test: this reading is accepted today");

        uint48 next = uint48(quoteAge - 1);
        vm.expectEmit(false, false, false, true, address(lever));
        emit ChainlinkFeedAdapter.QuoteMaxAgeTightened(QUOTE_MAX_AGE, next);
        vm.prank(operator);
        lever.tightenQuoteMaxAge(next);
        assertEq(lever.quoteMaxAgeInForce(), next, "the enforced bound moved");
        assertEq(lever.QUOTE_MAX_AGE(), QUOTE_MAX_AGE, "the ceiling did not, so the route still means what it said");

        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkFeedAdapter.FeedStale.selector, address(quoteFeed), block.timestamp - quoteAge, next
            )
        );
        lever.latestPrice(ASSET, QUOTE);

        // Control: republish the quote leg inside the new bound and the same adapter prices again,
        // so the refusal above was the tightened bound and not a broken adapter.
        quoteFeed.set(int256(1e8), block.timestamp - 1, 2, 2);
        (uint256 priceAfter,,) = lever.latestPrice(ASSET, QUOTE);
        assertEq(priceAfter, priceBefore, "the same price, once the quote leg is inside the new bound");
    }

    /// @notice The lever cannot loosen, cannot be used by anyone else, and does not exist at all on
    ///         an adapter that named no operator.
    function test_O31_theQuoteLeverCannotLoosenAndBelongsToNobodyElse() public {
        address operator = makeAddr("quoteFreshnessOperator");
        address stranger = makeAddr("stranger");
        ChainlinkFeedAdapter lever = new ChainlinkFeedAdapter(
            address(assetFeed), ASSET_MAX_AGE, address(quoteFeed), QUOTE_MAX_AGE, ASSET, QUOTE, address(0), 0, operator
        );

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.NotQuoteFreshnessOperator.selector, stranger));
        lever.tightenQuoteMaxAge(60);

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkFeedAdapter.QuoteMaxAgeNotTighter.selector, QUOTE_MAX_AGE, QUOTE_MAX_AGE + 1
            )
        );
        lever.tightenQuoteMaxAge(QUOTE_MAX_AGE + 1);

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkFeedAdapter.QuoteMaxAgeNotTighter.selector, QUOTE_MAX_AGE, QUOTE_MAX_AGE)
        );
        lever.tightenQuoteMaxAge(QUOTE_MAX_AGE);

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkFeedAdapter.QuoteMaxAgeNotTighter.selector, QUOTE_MAX_AGE, uint48(0))
        );
        lever.tightenQuoteMaxAge(0);

        // Having tightened once, the operator cannot walk it back up.
        vm.prank(operator);
        lever.tightenQuoteMaxAge(120);
        assertEq(lever.quoteMaxAgeInForce(), 120);
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkFeedAdapter.QuoteMaxAgeNotTighter.selector, uint48(120), uint48(121))
        );
        lever.tightenQuoteMaxAge(121);

        // An adapter with no operator has no lever, for anybody, including the deployer.
        ChainlinkFeedAdapter noLever = _cross(address(assetFeed), address(quoteFeed), ASSET, QUOTE, address(0), 0);
        assertEq(noLever.QUOTE_FRESHNESS_OPERATOR(), address(0), "the position under test");
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.NotQuoteFreshnessOperator.selector, address(this)));
        noLever.tightenQuoteMaxAge(60);

        // Control: the operator's own call at a strictly tighter value still works, so the four
        // refusals above are the guard and not a lever that refuses everything.
        vm.prank(operator);
        lever.tightenQuoteMaxAge(119);
        assertEq(lever.quoteMaxAgeInForce(), 119, "the control moves it one second down");
    }

    /// @notice DIRECT MODE has no quote leg, so there is nothing for the lever to govern, and the
    ///         operator is refused by a different name than a stranger is.
    function test_O31_directModeHasNoQuoteBoundToTighten() public {
        address operator = makeAddr("quoteFreshnessOperator");
        ChainlinkFeedAdapter direct = new ChainlinkFeedAdapter(
            address(assetFeed), ASSET_MAX_AGE, address(0), 0, ASSET, QUOTE, address(0), 0, operator
        );
        assertTrue(direct.isDirectRoute(), "the position under test");
        assertEq(direct.quoteMaxAgeInForce(), 0, "no quote leg, no bound in force");

        vm.prank(operator);
        vm.expectRevert(ChainlinkFeedAdapter.NoQuoteLegToTighten.selector);
        direct.tightenQuoteMaxAge(60);

        // Control: the same operator on a cross route over the same asset feed can tighten, so the
        // refusal above is the missing quote leg and not the operator.
        ChainlinkFeedAdapter cross = new ChainlinkFeedAdapter(
            address(assetFeed), ASSET_MAX_AGE, address(quoteFeed), QUOTE_MAX_AGE, ASSET, QUOTE, address(0), 0, operator
        );
        vm.prank(operator);
        cross.tightenQuoteMaxAge(60);
        assertEq(cross.quoteMaxAgeInForce(), 60, "the control tightens");
    }

    /// @notice The operator is part of the route identity, and the tightening is not. An adapter
    ///         with a lever is a different route from one without; using the lever does not move the
    ///         route out from under a market that registered against it.
    function test_O31_theOperatorIsInTheRouteIdAndTheTighteningIsNot() public {
        address operator = makeAddr("quoteFreshnessOperator");
        ChainlinkFeedAdapter lever = new ChainlinkFeedAdapter(
            address(assetFeed), ASSET_MAX_AGE, address(quoteFeed), QUOTE_MAX_AGE, ASSET, QUOTE, address(0), 0, operator
        );
        ChainlinkFeedAdapter noLever = _cross(address(assetFeed), address(quoteFeed), ASSET, QUOTE, address(0), 0);
        assertTrue(
            lever.feedIdFor(ASSET, QUOTE) != noLever.feedIdFor(ASSET, QUOTE),
            "who may tighten is part of what the route promises"
        );

        bytes32 idBefore = lever.feedIdFor(ASSET, QUOTE);
        vm.prank(operator);
        lever.tightenQuoteMaxAge(60);
        assertEq(
            lever.feedIdFor(ASSET, QUOTE), idBefore, "a tightening does not change the id, so it cannot orphan a market"
        );

        // Control: a second adapter naming a DIFFERENT operator is a different route again, so the
        // equality above is the tightening being excluded and not the operator being ignored.
        ChainlinkFeedAdapter other = new ChainlinkFeedAdapter(
            address(assetFeed),
            ASSET_MAX_AGE,
            address(quoteFeed),
            QUOTE_MAX_AGE,
            ASSET,
            QUOTE,
            address(0),
            0,
            makeAddr("anotherOperator")
        );
        assertTrue(other.feedIdFor(ASSET, QUOTE) != idBefore, "a different operator is a different route");
    }

    // ---- helpers -------------------------------------------------------------------------------------------------

    function _cross(address af, address qf, address asset, address quote, address seq, uint256 grace)
        internal
        returns (ChainlinkFeedAdapter)
    {
        return new ChainlinkFeedAdapter(af, ASSET_MAX_AGE, qf, QUOTE_MAX_AGE, asset, quote, seq, grace, address(0));
    }

    function _direct(address af, address asset, address quote, address seq, uint256 grace)
        internal
        returns (ChainlinkFeedAdapter)
    {
        return new ChainlinkFeedAdapter(af, ASSET_MAX_AGE, address(0), 0, asset, quote, seq, grace, address(0));
    }

    /// @dev The operator slot is `address(0)` here because every adapter this helper is compared
    ///      against is built without a lever; the rows that are about the operator build their own.
    function _expectedFeedId(address af, address qf, uint48 aMax, uint48 qMax, address asset, address quote)
        internal
        view
        returns (bytes32)
    {
        return keccak256(abi.encode("CHAINLINK_FEED", af, qf, aMax, qMax, address(0), asset, quote, block.chainid));
    }

    /// @dev A clean round on both legs: 395 quote units per whole asset, both feeds at 8 decimals.
    ///      Not a price of anything.
    function _healthy() internal {
        assetFeed.setReverting(false);
        quoteFeed.setReverting(false);
        assetFeed.setDecimals(8);
        quoteFeed.setDecimals(8);
        assetFeed.set(int256(395e8), block.timestamp, 1, 1);
        quoteFeed.set(int256(1e8), block.timestamp, 1, 1);
    }

    function _record(address asset, address payout) internal pure returns (UnicaMarketTypes.Market memory m) {
        m.asset = asset;
        m.payout = payout;
        m.version = 1;
        m.hook = address(0x4001);
        m.executor = address(0x4002);
        m.poolId = keccak256("configuration-only pool");
        m.rateE18 = 1e18;
        m.initSqrtPriceX96 = 79228162514264337593543950336;
        m.initTick = 0;
        m.fee = 3000;
        m.tickSpacing = 60;
        m.assetDecimals = 18;
        m.payoutDecimals = 6;
        m.assetIsCurrency0 = asset < payout;
    }
}
