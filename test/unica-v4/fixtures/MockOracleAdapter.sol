// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// TEST ONLY — never deployed by any script.
//
// This adapter exists so the hook's oracle checks can be driven to every one of their outcomes on a
// local chain. It serves exactly one pair, its reading is whatever the test last set, and it can be
// asked to fail in each of the ways `SPEC-ORACLE-AND-CHAINS.md` §5 names. It is NOT a Chainlink
// adapter and proves nothing about Chainlink: what it proves is that UNICA's own checks fire.

import {IUnicaPriceOracle, IUnicaOracleRoute} from "../../../src/unica-v4/interfaces/IUnicaPriceOracle.sol";

/// @title MockOracleAdapter, one settable reference and every named way to refuse
/// @dev The revert modes are a mode enum rather than separate contracts so a row can flip a live
///      market's adapter behaviour between two swaps without changing its `marketId` — which is
///      exactly the shape of the attack the repeated `feedIdFor` check is there to catch.
contract MockOracleAdapter is IUnicaPriceOracle, IUnicaOracleRoute {
    enum Mode {
        Live,
        SequencerDownMode,
        SequencerGracePeriodMode,
        MarketClosedMode,
        PairNotSupportedMode,
        FeedUnreadableMode
    }

    /// @dev The adapter catalogue of SO §5, in the four shapes the condition view has to tell apart.
    error SequencerDown();
    error SequencerGracePeriod(uint256 since);
    error MarketClosed();
    error PairNotSupported(address asset, address quote);
    /// @dev The stand-in for "a push feed this adapter could not read at all" (SO §5), which maps to
    ///      STALE_ORACLE like every non-`MarketClosed` failure.
    error FeedUnreadable(address feed);

    address public immutable ASSET;
    address public immutable QUOTE;

    uint256 public price;
    uint8 public priceDecimals;
    uint256 public updatedAt;
    bytes32 private _feedId;
    Mode public mode;

    constructor(address asset_, address quote_, bytes32 feedId_, uint256 price_, uint8 decimals_, uint256 updatedAt_) {
        ASSET = asset_;
        QUOTE = quote_;
        _feedId = feedId_;
        price = price_;
        priceDecimals = decimals_;
        updatedAt = updatedAt_;
    }

    // ---- what a test steers -------------------------------------------------------------------

    function setReading(uint256 price_, uint8 decimals_, uint256 updatedAt_) external {
        price = price_;
        priceDecimals = decimals_;
        updatedAt = updatedAt_;
    }

    function setPrice(uint256 price_) external {
        price = price_;
    }

    function setUpdatedAt(uint256 updatedAt_) external {
        updatedAt = updatedAt_;
    }

    /// @dev The route identity is settable so a row can change it AFTER the market committed to it,
    ///      which is the only way to reach `OracleFeedMismatch` on the swap path.
    function setFeedId(bytes32 feedId_) external {
        _feedId = feedId_;
    }

    function setMode(Mode mode_) external {
        mode = mode_;
    }

    // ---- the interface the hook reads ------------------------------------------------------------

    function feedIdFor(address asset, address quote) external view returns (bytes32) {
        if (asset != ASSET || quote != QUOTE) revert PairNotSupported(asset, quote);
        return _feedId;
    }

    function adapterKind() external pure returns (bytes32) {
        return keccak256("MOCK_TEST_ONLY");
    }

    function latestPrice(address asset, address quote)
        external
        view
        returns (uint256 price_, uint8 decimals_, uint256 updatedAt_)
    {
        if (asset != ASSET || quote != QUOTE) revert PairNotSupported(asset, quote);
        Mode m = mode;
        if (m == Mode.SequencerDownMode) revert SequencerDown();
        if (m == Mode.SequencerGracePeriodMode) revert SequencerGracePeriod(block.timestamp);
        if (m == Mode.MarketClosedMode) revert MarketClosed();
        if (m == Mode.PairNotSupportedMode) revert PairNotSupported(asset, quote);
        if (m == Mode.FeedUnreadableMode) revert FeedUnreadable(address(this));
        return (price, priceDecimals, updatedAt);
    }
}

/// @title StateWritingOracleAdapter, an adapter that writes storage inside its price read
/// @dev TEST ONLY. It deliberately does NOT declare `latestPrice` as `view`, so it cannot claim to
///      implement `IUnicaPriceOracle`; the hook calls it through that interface anyway, which the
///      compiler emits as a STATICCALL, and the write makes the STATICCALL fail. That is the whole
///      point of row O27: the hook's promise that nothing can change between its two `slot0` readings
///      is enforced by the EVM, not by trusting an adapter's declaration.
contract StateWritingOracleAdapter is IUnicaOracleRoute {
    error PairNotSupported(address asset, address quote);

    address public immutable ASSET;
    address public immutable QUOTE;
    bytes32 private _feedId;

    uint256 public reads;
    uint256 public price;
    uint8 public priceDecimals;
    uint256 public updatedAt;

    constructor(address asset_, address quote_, bytes32 feedId_, uint256 price_, uint8 decimals_, uint256 updatedAt_) {
        ASSET = asset_;
        QUOTE = quote_;
        _feedId = feedId_;
        price = price_;
        priceDecimals = decimals_;
        updatedAt = updatedAt_;
    }

    function feedIdFor(address asset, address quote) external view returns (bytes32) {
        if (asset != ASSET || quote != QUOTE) revert PairNotSupported(asset, quote);
        return _feedId;
    }

    function adapterKind() external pure returns (bytes32) {
        return keccak256("MOCK_STATE_WRITING_TEST_ONLY");
    }

    function latestPrice(address asset, address quote)
        external
        returns (uint256 price_, uint8 decimals_, uint256 updatedAt_)
    {
        if (asset != ASSET || quote != QUOTE) revert PairNotSupported(asset, quote);
        ++reads; // the storage write that a STATICCALL cannot survive
        return (price, priceDecimals, updatedAt);
    }
}
