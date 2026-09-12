// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";

import {ChainlinkFeedAdapter} from "../../../src/unica-v4/oracle/ChainlinkFeedAdapter.sol";
import {UnicaMarketTypes} from "../../../src/unica-v4/UnicaMarketTypes.sol";
import {UnicaMarketRegistry} from "../../../src/unica-v4/UnicaMarketRegistry.sol";
import {FixtureAggregator} from "../fixtures/FixtureAggregator.sol";

/// @title Rows O28 and O29 for `ChainlinkFeedAdapter`, plus the configuration-only second route
/// @notice Written from `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` §7 and `TEST-MATRIX.md`. Every
///         price here comes from a `FixtureAggregator`: a settable stand-in that is not authenticated
///         pricing and carries no value. NOTHING in this file is a market price, a quotation, or a
///         claim about any real asset. The rows exist to prove that each refusal the adapter names
///         actually fires, which is only knowable by feeding it the fault on purpose.
///
///         Every negative row sits beside the control that differs from it in exactly one field, in
///         the same function, because a revert on its own cannot tell a working check apart from a
///         fixture that never reached it.
contract ChainlinkFeedAdapterTest is Test {
    address internal constant ASSET = address(0xA55E7);
    address internal constant QUOTE = address(0x9407E);
    address internal constant OTHER_ASSET = address(0x07E4);

    uint256 internal constant GRACE = 3600;

    FixtureAggregator internal assetFeed;
    FixtureAggregator internal quoteFeed;
    FixtureAggregator internal sequencer;

    ChainlinkFeedAdapter internal adapter;

    function setUp() public {
        vm.warp(1_700_000_000);
        assetFeed = new FixtureAggregator(8, "FIXTURE ASSET / USD - not authenticated pricing - no value");
        quoteFeed = new FixtureAggregator(8, "FIXTURE QUOTE / USD - not authenticated pricing - no value");
        sequencer = new FixtureAggregator(0, "FIXTURE sequencer uptime - no value");

        adapter = new ChainlinkFeedAdapter(address(assetFeed), address(quoteFeed), ASSET, QUOTE, address(0), 0);
        _healthy();
    }

    // ---- construction ---------------------------------------------------------------------------------

    function test_O28_constructorRefusals() public {
        vm.expectRevert(ChainlinkFeedAdapter.ZeroAddress.selector);
        new ChainlinkFeedAdapter(address(assetFeed), address(quoteFeed), address(0), QUOTE, address(0), 0);

        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.SameToken.selector, ASSET));
        new ChainlinkFeedAdapter(address(assetFeed), address(quoteFeed), ASSET, ASSET, address(0), 0);

        address hollow = address(0xDEAD);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.FeedNoCode.selector, hollow));
        new ChainlinkFeedAdapter(hollow, address(quoteFeed), ASSET, QUOTE, address(0), 0);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.FeedNoCode.selector, hollow));
        new ChainlinkFeedAdapter(address(assetFeed), hollow, ASSET, QUOTE, address(0), 0);

        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.SequencerFeedNoCode.selector, hollow));
        new ChainlinkFeedAdapter(address(assetFeed), address(quoteFeed), ASSET, QUOTE, hollow, GRACE);

        // Control: the same arguments with real feeds construct, and a zero sequencer feed is the
        // documented "this chain has none" case rather than a mistake.
        ChainlinkFeedAdapter noSequencer =
            new ChainlinkFeedAdapter(address(assetFeed), address(quoteFeed), ASSET, QUOTE, address(0), 0);
        assertEq(noSequencer.SEQUENCER_FEED(), address(0), "no sequencer feed");
        ChainlinkFeedAdapter withSequencer =
            new ChainlinkFeedAdapter(address(assetFeed), address(quoteFeed), ASSET, QUOTE, address(sequencer), GRACE);
        assertEq(withSequencer.SEQUENCER_FEED(), address(sequencer), "sequencer feed recorded");
        assertEq(withSequencer.GRACE_PERIOD(), GRACE, "grace period recorded");
    }

    // ---- the route identity ------------------------------------------------------------------------------

    function test_O28_feedIdIsDeterministicAndBindsBothProxies() public {
        bytes32 expected = keccak256(abi.encode("CHAINLINK_FEED", address(assetFeed), address(quoteFeed)));
        assertEq(adapter.feedIdFor(ASSET, QUOTE), expected, "feedId is the kind tag over both proxies");
        assertEq(adapter.adapterKind(), keccak256("CHAINLINK_FEED"), "adapterKind");

        // A second instance over the same pair but a different asset proxy is a different route.
        FixtureAggregator otherAssetFeed =
            new FixtureAggregator(8, "FIXTURE OTHER / USD - not authenticated pricing - no value");
        ChainlinkFeedAdapter other =
            new ChainlinkFeedAdapter(address(otherAssetFeed), address(quoteFeed), ASSET, QUOTE, address(0), 0);
        assertTrue(other.feedIdFor(ASSET, QUOTE) != expected, "a different proxy is a different feedId");

        // Control on determinism: an identical instance derives the identical id.
        ChainlinkFeedAdapter twin =
            new ChainlinkFeedAdapter(address(assetFeed), address(quoteFeed), ASSET, QUOTE, address(0), 0);
        assertEq(twin.feedIdFor(ASSET, QUOTE), expected, "the same two proxies give the same feedId");
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

    function test_O28_cleanCrossRouteAt18DecimalsWithTheOlderTimestamp() public {
        assetFeed.set(int256(395e8), 1_700_000_000, 7, 7);
        quoteFeed.set(int256(1e8), 1_699_999_000, 4, 4);

        (uint256 price, uint8 decimals, uint256 updatedAt) = adapter.latestPrice(ASSET, QUOTE);
        assertEq(price, 395e18, "cross price per whole asset");
        assertEq(decimals, 18, "always 18");
        assertEq(updatedAt, 1_699_999_000, "the OLDER of the two publish times");

        // The other ordering of staleness gives the other timestamp, so the row is not passing by
        // accident on a fixed argument order.
        assetFeed.set(int256(395e8), 1_699_998_000, 8, 8);
        (,, updatedAt) = adapter.latestPrice(ASSET, QUOTE);
        assertEq(updatedAt, 1_699_998_000, "still the older one");
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

        // Control: `answeredInRound == roundId` is the boundary and it passes, as does a later one.
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
            new ChainlinkFeedAdapter(address(assetFeed), address(quoteFeed), ASSET, QUOTE, address(sequencer), GRACE);

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
    ///         market whose committed feedId belongs to the other route.
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
            new ChainlinkFeedAdapter(address(secondAssetFeed), address(quoteFeed), OTHER_ASSET, QUOTE, address(0), 0);

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

    // ---- helpers -------------------------------------------------------------------------------------------------

    /// @dev A clean round on both legs: 395 quote units per whole asset, both feeds at 8 decimals.
    ///      Not a price of anything.
    function _healthy() internal {
        assetFeed.setDecimals(8);
        quoteFeed.setDecimals(8);
        assetFeed.set(int256(395e8), 1_700_000_000, 1, 1);
        quoteFeed.set(int256(1e8), 1_700_000_000, 1, 1);
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
