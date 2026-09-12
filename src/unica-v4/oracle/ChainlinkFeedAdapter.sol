// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {IUnicaPriceOracle, IUnicaOracleRoute} from "../interfaces/IUnicaPriceOracle.sol";
import {AggregatorV3Interface} from "./AggregatorV3Interface.sol";

/// @title ChainlinkFeedAdapter, one immutable cross route over two push Data Feeds
/// @notice Written from `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` §7 and SC §10. One instance serves
///         exactly one (asset, quote) pair; every route address is fixed in the constructor. There
///         is no admin and no setter, so a market's `(adapter, feedId)` commitment cannot drift
///         under it — which is the only reason the registry's `feedIdFor` check at `register` and
///         the hook's repeat of it on every swap mean anything (ruling S8).
///
///         WHAT IT REFUSES RATHER THAN GUESSES. A stablecoin quote is never assumed to be a dollar:
///         its own feed is read and the cross is computed. A round that carried over from an earlier
///         one, a feed that reverts, a zero or negative answer, a missing timestamp — each is a
///         typed revert, never a zero and never a placeholder. Freshness itself is NOT judged here:
///         `updatedAt` is returned as the OLDER of the two feeds' own publish times and the hook
///         applies the market's `maxAge` to it (SO §7.2 step 4), so one adapter can serve markets
///         with different tolerances.
contract ChainlinkFeedAdapter is IUnicaPriceOracle, IUnicaOracleRoute {
    /// @notice The only asset this instance prices.
    address public immutable ASSET;
    /// @notice The only quote this instance prices it in.
    address public immutable QUOTE;
    /// @notice The pinned proxy for the asset's own USD feed.
    address public immutable ASSET_FEED;
    /// @notice The pinned proxy for the quote token's own USD feed.
    address public immutable QUOTE_FEED;
    /// @notice The L2 sequencer uptime feed, or zero on a chain that has none (SO §7.3).
    address public immutable SEQUENCER_FEED;
    /// @notice How long after the sequencer comes back a price is still refused, in seconds.
    uint256 public immutable GRACE_PERIOD;

    /// @notice The largest feed `decimals()` the cross arithmetic accepts.
    uint8 internal constant MAX_FEED_DECIMALS = 18;

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
    error SequencerDown();
    error SequencerStatusUnknown();
    error SequencerGracePeriod(uint256 startedAt, uint256 gracePeriod);
    error PairNotSupported(address asset, address quote);

    /// @param assetFeed the asset's USD proxy; the proxy, never the aggregator behind it (CA §2b).
    /// @param quoteFeed the quote token's own USD proxy. Required: a payout token is never assumed
    ///        to be worth one dollar, and no feed in the evidence is quoted in a payout token, so
    ///        the direct-route branch that a zero would select is not built rather than untested.
    /// @param sequencerFeed zero only on a chain with no sequencer feed to read (SO §7.3). Nothing
    ///        on-chain can prove a chain has none, so this is a deployment-time claim the chain file
    ///        carries with evidence; what IS enforced here is that a non-zero one has code.
    /// @param gracePeriod seconds after a sequencer restart during which every price is refused.
    constructor(
        address assetFeed,
        address quoteFeed,
        address asset,
        address quote,
        address sequencerFeed,
        uint256 gracePeriod
    ) {
        if (asset == address(0) || quote == address(0)) revert ZeroAddress();
        if (asset == quote) revert SameToken(asset);
        if (assetFeed.code.length == 0) revert FeedNoCode(assetFeed);
        if (quoteFeed.code.length == 0) revert FeedNoCode(quoteFeed);
        if (sequencerFeed != address(0) && sequencerFeed.code.length == 0) revert SequencerFeedNoCode(sequencerFeed);

        ASSET = asset;
        QUOTE = quote;
        ASSET_FEED = assetFeed;
        QUOTE_FEED = quoteFeed;
        SEQUENCER_FEED = sequencerFeed;
        GRACE_PERIOD = gracePeriod;
    }

    /// @inheritdoc IUnicaOracleRoute
    /// @dev Derived from the kind tag and every immutable source identifier, so two adapters that
    ///      read different feeds can never share a `feedId` and a market's id commits to the pair of
    ///      proxies it was registered against.
    function feedIdFor(address asset, address quote) external view returns (bytes32) {
        if (asset != ASSET || quote != QUOTE) revert PairNotSupported(asset, quote);
        return keccak256(abi.encode("CHAINLINK_FEED", ASSET_FEED, QUOTE_FEED));
    }

    /// @inheritdoc IUnicaOracleRoute
    function adapterKind() external pure returns (bytes32) {
        return keccak256("CHAINLINK_FEED");
    }

    /// @inheritdoc IUnicaPriceOracle
    /// @return price quote per ONE whole asset at a fixed 18 decimals.
    /// @return decimals always 18 for this adapter.
    /// @return updatedAt the OLDER of the two feeds' own publish times: a cross is only as fresh as
    ///         its stalest leg, and reporting the newer one would hide a frozen feed behind a live
    ///         one when the hook applies `maxAge`.
    function latestPrice(address asset, address quote)
        external
        view
        returns (uint256 price, uint8 decimals, uint256 updatedAt)
    {
        if (asset != ASSET || quote != QUOTE) revert PairNotSupported(asset, quote);

        _checkSequencer();

        (uint256 assetAnswer, uint8 assetDecimals, uint256 assetUpdatedAt) = _read(ASSET_FEED);
        (uint256 quoteAnswer, uint8 quoteDecimals, uint256 quoteUpdatedAt) = _read(QUOTE_FEED);

        // Both answers are bounded BEFORE any multiplication, so an absurd feed value refuses by
        // name and never by a bare arithmetic panic (security review, finding 12).
        if (assetAnswer > type(uint128).max) revert FeedAnswerOutOfRange(ASSET_FEED, assetAnswer);
        if (quoteAnswer > type(uint128).max) revert FeedAnswerOutOfRange(QUOTE_FEED, quoteAnswer);
        // quote per whole asset = (assetAnswer / 10**da) / (quoteAnswer / 10**dq), at 1e18.
        price = FullMath.mulDiv(assetAnswer, 1e18 * (10 ** quoteDecimals), quoteAnswer * (10 ** assetDecimals));
        decimals = 18;
        updatedAt = assetUpdatedAt < quoteUpdatedAt ? assetUpdatedAt : quoteUpdatedAt;
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

    /// @dev SO §7.2 step 2, in its order, for one feed.
    function _read(address feed) private view returns (uint256 answer, uint8 decimals, uint256 updatedAt) {
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
