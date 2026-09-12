// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {IUnicaPriceOracle, IUnicaOracleRoute} from "../interfaces/IUnicaPriceOracle.sol";
import {AggregatorV3Interface} from "./AggregatorV3Interface.sol";

/// @title ChainlinkFeedAdapter, one immutable route over one or two push Data Feeds
/// @notice Written from `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` §7, SC §10 and the owner ruling of
///         2026-09-12 on per-leg freshness (`docs/unica-v4/ORACLE-FRESHNESS-O2.md`). One instance
///         serves exactly one (asset, quote) pair; every route address and every freshness bound is
///         fixed in the constructor. There is no admin and no setter, so a market's
///         `(adapter, feedId)` commitment cannot drift under it, which is the only reason the
///         registry's `feedIdFor` check at `register` and the hook's repeat of it on every swap mean
///         anything (ruling S8).
///
///         WHAT IT REFUSES RATHER THAN GUESSES. A stablecoin quote is never assumed to be a dollar:
///         its own feed is read and the cross is computed. A round that carried over from an earlier
///         one, a feed that reverts, a zero or negative answer, a missing timestamp, an answer too
///         large to multiply, a publish time in the future, a leg older than the bound its own
///         deployer reviewed for it: each is a typed revert, never a zero and never a placeholder.
///
///         WHY FRESHNESS IS JUDGED HERE, PER LEG. Two feeds are two products with two heartbeats. A
///         major asset feed may publish every few minutes while the stablecoin feed behind the payout
///         unit publishes once a day, and both are behaving correctly. A single bound applied to the
///         older of the two timestamps cannot express that: set it to the fast leg's heartbeat and
///         every settlement refuses, set it to the slow leg's and a frozen asset feed passes unseen.
///         So each leg is checked against ITS OWN bound here, in the adapter, and the pair of bounds
///         is part of the route identity.
///
///         WHICH LEG THE MARKET'S OWN CEILING REACHES, EXACTLY. The hook is unchanged and keeps
///         applying the market's `policy.maxAge` to the single timestamp this contract reports. That
///         timestamp is the ASSET leg's, so `policy.maxAge` bounds the ASSET LEG ONLY. It does not
///         reach the quote leg, and no reading of it does: the quote leg's age is not in the value
///         the hook receives. The quote leg is bounded here and only here, by `QUOTE_MAX_AGE` at
///         construction and, downward from it, by `quoteMaxAgeInForce`. Saying otherwise, as an
///         earlier version of this note did, would leave an operator believing that tightening the
///         market's policy during a stablecoin incident does something on the quote leg. It does
///         not; `tightenQuoteMaxAge` is the lever that does.
///
///         WHAT `updatedAt` MEANS NOW. It is the ASSET leg's own publish time, not the older of the
///         two. The quote leg's staleness has already been enforced here against the bound that was
///         reviewed for that feed, so folding it into the returned timestamp would apply the asset
///         leg's tolerance to the quote leg a second time, which is exactly the refusal-of-everything
///         this ruling exists to remove. What the hook receives is therefore the answer to the
///         question it is asking: how old is the price of the thing being sold.
contract ChainlinkFeedAdapter is IUnicaPriceOracle, IUnicaOracleRoute {
    /// @notice The only asset this instance prices.
    address public immutable ASSET;
    /// @notice The only quote this instance prices it in.
    address public immutable QUOTE;
    /// @notice The pinned proxy for the asset's own feed.
    address public immutable ASSET_FEED;
    /// @notice The pinned proxy for the quote token's own feed, or zero in DIRECT MODE.
    address public immutable QUOTE_FEED;
    /// @notice The oldest the asset leg may be, in seconds. Always non-zero.
    uint48 public immutable ASSET_MAX_AGE;
    /// @notice The CEILING on how old the quote leg may be, in seconds, fixed at construction and
    ///         folded into the route identity. Zero exactly when there is no quote leg. What is
    ///         actually enforced is `quoteMaxAgeInForce`, which starts equal to this and can only
    ///         ever be moved DOWN, so this value remains a true upper bound on what any reading off
    ///         this route was allowed to be.
    uint48 public immutable QUOTE_MAX_AGE;
    /// @notice The only account that may tighten the quote leg's bound, or zero for an adapter with
    ///         no lever at all, which is the behaviour every instance had before this was added.
    ///         It cannot loosen a bound, cannot touch the asset leg, cannot change a feed, and
    ///         cannot make any price pass that would otherwise have been refused.
    address public immutable QUOTE_FRESHNESS_OPERATOR;
    /// @notice The bound the quote leg is actually checked against right now. Starts at
    ///         `QUOTE_MAX_AGE` and only ever decreases.
    ///
    ///         WHY THERE IS A LEVER HERE AT ALL. The market's `policy.maxAge` reaches the asset leg
    ///         only (see the contract note), so without this the quote leg would have no on-chain
    ///         response of any kind: during a stablecoin incident the only remedy would be deploying
    ///         a new adapter and registering a new market, while the old one kept settling at the
    ///         bound reviewed in calmer weather. Downward-only is what keeps that from becoming a
    ///         hole: an operator can refuse more, never less, so nothing this account does can make
    ///         the route accept a reading the market did not already register for.
    uint48 public quoteMaxAgeInForce;
    /// @notice The L2 sequencer uptime feed, or zero on a chain that has none (SO §7.3).
    address public immutable SEQUENCER_FEED;
    /// @notice How long after the sequencer comes back a price is still refused, in seconds.
    uint256 public immutable GRACE_PERIOD;

    /// @notice The largest feed `decimals()` the arithmetic accepts.
    uint8 internal constant MAX_FEED_DECIMALS = 18;

    /// @notice The quote leg's enforced bound moved down. There is no matching loosening event
    ///         because there is no loosening.
    event QuoteMaxAgeTightened(uint48 previous, uint48 next);

    error ZeroAddress();
    error SameToken(address token);
    error FeedNoCode(address feed);
    error SequencerFeedNoCode(address feed);
    /// @notice `decimals()` or `latestRoundData()` reverted, or returned something undecodable.
    error FeedUnreadable(address feed);
    error FeedDecimalsUnsupported(address feed, uint8 decimals);
    error FeedAnswerNotPositive(address feed, int256 answer);
    error FeedAnswerOutOfRange(address feed, uint256 answer);
    error FeedNoTimestamp(address feed);
    error FeedRoundIncomplete(address feed, uint80 roundId, uint80 answeredInRound);
    /// @notice The leg's own publish time is further back than the bound reviewed for that feed.
    error FeedStale(address feed, uint256 updatedAt, uint256 maxAge);
    /// @notice A publish time later than the block reading it is a state this contract cannot reason
    ///         about, so it is refused rather than treated as maximally fresh.
    error FeedTimestampInFuture(address feed, uint256 updatedAt, uint256 blockTimestamp);
    /// @notice A freshness bound of zero would accept only a price published in this very second, so
    ///         it is never what a deployer meant; the asset leg always needs a reviewed value.
    error MaxAgeRequired(address feed);
    /// @notice DIRECT MODE has no quote leg, so a bound for one is a configuration that does not
    ///         describe anything and is refused rather than silently ignored.
    error QuoteMaxAgeWithoutQuoteFeed(uint48 quoteMaxAge);
    error SequencerDown();
    error SequencerStatusUnknown();
    error SequencerGracePeriod(uint256 startedAt, uint256 gracePeriod);
    error PairNotSupported(address asset, address quote);
    /// @notice Only `QUOTE_FRESHNESS_OPERATOR` may tighten the quote bound, and on an adapter that
    ///         named no operator nobody may, which is what a zero operator means.
    error NotQuoteFreshnessOperator(address caller);
    /// @notice DIRECT MODE has no quote leg, so there is no bound on one to tighten.
    error NoQuoteLegToTighten();
    /// @notice A new bound that is zero, or not strictly below the one in force, is refused. Zero
    ///         would accept only a price published in this very second; anything else would be a
    ///         loosening, and this lever does not loosen.
    error QuoteMaxAgeNotTighter(uint48 inForce, uint48 next);

    /// @param assetFeed the asset's proxy; the proxy, never the aggregator behind it (CA §2b).
    /// @param assetMaxAge the oldest the asset leg may be, in seconds. There is NO default and no
    ///        approved constant: the deployer reads the feed's published heartbeat and deviation
    ///        threshold for the specific network and pair, and sets a value at least as large as the
    ///        heartbeat. The numbers used in the local demonstration and in the example configuration
    ///        are illustrations of the shape, not approved production values.
    /// @param quoteFeed the quote token's own proxy, or ZERO for DIRECT MODE, in which the asset feed
    ///        already prices the asset in the payout unit and no cross is computed. A payout token is
    ///        otherwise never assumed to be worth one dollar.
    /// @param quoteMaxAge the oldest the quote leg may be, in seconds, reviewed the same way and
    ///        usually a different number: the two feeds are two products. Must be zero in DIRECT MODE.
    /// @param sequencerFeed zero only on a chain with no sequencer feed to read (SO §7.3). Nothing
    ///        on-chain can prove a chain has none, so this is a deployment-time claim the chain file
    ///        carries with evidence; what IS enforced here is that a non-zero one has code.
    /// @param gracePeriod seconds after a sequencer restart during which every price is refused.
    /// @param quoteFreshnessOperator the one account allowed to tighten the quote leg's bound during
    ///        an incident, or ZERO for no lever, which leaves the instance exactly as immutable as
    ///        every instance was before this parameter existed. It is folded into `feedIdFor`, so an
    ///        adapter with a lever and an otherwise identical one without are two routes and a market
    ///        registered against one can never be silently pointed at the other.
    constructor(
        address assetFeed,
        uint48 assetMaxAge,
        address quoteFeed,
        uint48 quoteMaxAge,
        address asset,
        address quote,
        address sequencerFeed,
        uint256 gracePeriod,
        address quoteFreshnessOperator
    ) {
        if (asset == address(0) || quote == address(0)) revert ZeroAddress();
        if (asset == quote) revert SameToken(asset);
        if (assetFeed.code.length == 0) revert FeedNoCode(assetFeed);
        if (assetMaxAge == 0) revert MaxAgeRequired(assetFeed);
        if (quoteFeed == address(0)) {
            // DIRECT MODE. There is no second leg, so there is nothing for a second bound to govern.
            if (quoteMaxAge != 0) revert QuoteMaxAgeWithoutQuoteFeed(quoteMaxAge);
        } else {
            if (quoteFeed.code.length == 0) revert FeedNoCode(quoteFeed);
            if (quoteMaxAge == 0) revert MaxAgeRequired(quoteFeed);
        }
        if (sequencerFeed != address(0) && sequencerFeed.code.length == 0) revert SequencerFeedNoCode(sequencerFeed);

        ASSET = asset;
        QUOTE = quote;
        ASSET_FEED = assetFeed;
        QUOTE_FEED = quoteFeed;
        ASSET_MAX_AGE = assetMaxAge;
        QUOTE_MAX_AGE = quoteMaxAge;
        quoteMaxAgeInForce = quoteMaxAge;
        QUOTE_FRESHNESS_OPERATOR = quoteFreshnessOperator;
        SEQUENCER_FEED = sequencerFeed;
        GRACE_PERIOD = gracePeriod;
    }

    /// @notice Lowers the bound the quote leg is checked against. The only write on this contract.
    /// @dev Downward only, and the refusal is by name in all three directions it can be wrong:
    ///      wrong caller, no quote leg to govern, and a value that is not strictly tighter. There is
    ///      no way back up, which is deliberate and is the same shape the registry's own
    ///      `tightenOraclePolicy` has: an over-tightened bound refuses settlements loudly, where a
    ///      loosening lever would let one account quietly widen what a settled market accepts.
    ///      Recovering from an over-tightening means a new adapter and a new market, exactly as
    ///      changing any other part of the route does.
    function tightenQuoteMaxAge(uint48 next) external {
        // A zero operator needs no separate branch: no transaction has a zero `msg.sender`, so an
        // adapter that named none refuses every caller here, which is what "no lever" means.
        if (msg.sender != QUOTE_FRESHNESS_OPERATOR) revert NotQuoteFreshnessOperator(msg.sender);
        if (QUOTE_FEED == address(0)) revert NoQuoteLegToTighten();
        uint48 inForce = quoteMaxAgeInForce;
        if (next == 0 || next >= inForce) revert QuoteMaxAgeNotTighter(inForce, next);
        quoteMaxAgeInForce = next;
        emit QuoteMaxAgeTightened(inForce, next);
    }

    /// @inheritdoc IUnicaOracleRoute
    /// @dev Derived from the kind tag, every immutable source identifier, BOTH freshness ceilings,
    ///      the account allowed to tighten the quote one, the pair, and the chain. The ceilings are
    ///      in here on purpose: a freshness policy is part of what a price means, so changing one is
    ///      a new route, which forces a new adapter, a new `feedId` and therefore a new market. A
    ///      market that was registered under the old ceilings keeps its own adapter, unchanged and
    ///      unreachable by the new deployment, so its history stays exactly what it was settled
    ///      under. The chain id is in here so the same two proxy addresses on two networks are two
    ///      routes rather than one.
    ///
    ///      The OPERATOR is in here for the same reason the ceilings are, and this is the honest
    ///      reading of the one mutable value on this contract: what the id commits to is "the quote
    ///      leg is never older than `QUOTE_MAX_AGE`, and this named account may make that stricter".
    ///      `quoteMaxAgeInForce` itself is deliberately NOT in the id, because folding it in would
    ///      change the id the moment an operator tightened and break the very market the tightening
    ///      was meant to protect. A tightening can only refuse readings the ceiling already allowed,
    ///      so the id's promise stays exactly true after one.
    function feedIdFor(address asset, address quote) external view returns (bytes32) {
        if (asset != ASSET || quote != QUOTE) revert PairNotSupported(asset, quote);
        return keccak256(
            abi.encode(
                "CHAINLINK_FEED",
                ASSET_FEED,
                QUOTE_FEED,
                ASSET_MAX_AGE,
                QUOTE_MAX_AGE,
                QUOTE_FRESHNESS_OPERATOR,
                ASSET,
                QUOTE,
                block.chainid
            )
        );
    }

    /// @inheritdoc IUnicaOracleRoute
    function adapterKind() external pure returns (bytes32) {
        return keccak256("CHAINLINK_FEED");
    }

    /// @notice True when this instance prices the asset directly in the payout unit, with no cross.
    function isDirectRoute() external view returns (bool) {
        return QUOTE_FEED == address(0);
    }

    /// @inheritdoc IUnicaPriceOracle
    /// @return price quote per ONE whole asset at a fixed 18 decimals.
    /// @return decimals always 18 for this adapter.
    /// @return updatedAt the ASSET leg's own publish time. The quote leg is not folded in because its
    ///         staleness was already enforced above against its own reviewed bound; see the contract
    ///         note. The hook then applies the market's `maxAge` to THIS value, which means a market
    ///         may be stricter than the adapter on the ASSET LEG and never looser — and that it says
    ///         nothing at all about the quote leg, whose only bounds are `QUOTE_MAX_AGE` and the
    ///         tightened `quoteMaxAgeInForce` enforced here.
    function latestPrice(address asset, address quote)
        external
        view
        returns (uint256 price, uint8 decimals, uint256 updatedAt)
    {
        if (asset != ASSET || quote != QUOTE) revert PairNotSupported(asset, quote);

        _checkSequencer();

        (uint256 assetAnswer, uint8 assetDecimals, uint256 assetUpdatedAt) = _read(ASSET_FEED, ASSET_MAX_AGE);
        // Answers are bounded BEFORE any multiplication, so an absurd feed value refuses by name and
        // never by a bare arithmetic panic (security review, finding 12).
        if (assetAnswer > type(uint128).max) revert FeedAnswerOutOfRange(ASSET_FEED, assetAnswer);

        if (QUOTE_FEED == address(0)) {
            // DIRECT MODE: the asset feed is already quoted in the payout unit, so the only work left
            // is moving it from the feed's own scale to the fixed 18.
            price = FullMath.mulDiv(assetAnswer, 1e18, 10 ** assetDecimals);
        } else {
            (uint256 quoteAnswer, uint8 quoteDecimals,) = _read(QUOTE_FEED, quoteMaxAgeInForce);
            if (quoteAnswer > type(uint128).max) revert FeedAnswerOutOfRange(QUOTE_FEED, quoteAnswer);
            // quote per whole asset = (assetAnswer / 10**da) / (quoteAnswer / 10**dq), at 1e18.
            price = FullMath.mulDiv(assetAnswer, 1e18 * (10 ** quoteDecimals), quoteAnswer * (10 ** assetDecimals));
        }
        decimals = 18;
        updatedAt = assetUpdatedAt;
    }

    // ---- internals ----------------------------------------------------------------------------

    /// @dev SO §7.3, before any price read. Zero is the only "up" value; one is down and every other
    ///      value is treated as down, never as up. A price can look perfectly fresh while the
    ///      sequencer has only just come back, so the grace period is a refusal, not a warning.
    function _checkSequencer() private view {
        address feed = SEQUENCER_FEED;
        if (feed == address(0)) return;
        (, int256 answer, uint256 startedAt,,) = _roundData(feed);
        if (answer != 0) revert SequencerDown();
        // A zero or FUTURE start time is a status this contract cannot reason about: unknown, not up.
        if (startedAt == 0 || startedAt > block.timestamp) revert SequencerStatusUnknown();
        if (block.timestamp - startedAt <= GRACE_PERIOD) revert SequencerGracePeriod(startedAt, GRACE_PERIOD);
    }

    /// @dev SO §7.2 step 2, in its order, for one feed, followed by that feed's OWN freshness bound.
    ///      Freshness is checked last because a stale reading of a broken round should be named as the
    ///      broken round it is; the order changes which error a deployer sees, never whether it fails.
    function _read(address feed, uint48 maxAge)
        private
        view
        returns (uint256 answer, uint8 decimals, uint256 updatedAt)
    {
        try AggregatorV3Interface(feed).decimals() returns (uint8 d) {
            decimals = d;
        } catch {
            revert FeedUnreadable(feed);
        }
        if (decimals > MAX_FEED_DECIMALS) revert FeedDecimalsUnsupported(feed, decimals);

        (uint80 roundId, int256 raw, uint256 startedAt, uint256 stamp, uint80 answeredInRound) = _roundData(feed);
        if (raw <= 0) revert FeedAnswerNotPositive(feed, raw);
        if (stamp == 0 || startedAt == 0) revert FeedNoTimestamp(feed);
        if (answeredInRound < roundId) revert FeedRoundIncomplete(feed, roundId, answeredInRound);
        if (stamp > block.timestamp) revert FeedTimestampInFuture(feed, stamp, block.timestamp);
        if (block.timestamp - stamp > maxAge) revert FeedStale(feed, stamp, maxAge);

        answer = uint256(raw);
        updatedAt = stamp;
    }

    function _roundData(address feed)
        private
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        try AggregatorV3Interface(feed).latestRoundData() returns (
            uint80 r, int256 a, uint256 s, uint256 u, uint80 ar
        ) {
            return (r, a, s, u, ar);
        } catch {
            revert FeedUnreadable(feed);
        }
    }
}
