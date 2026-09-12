// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// LOCAL FIXTURE — NOT AUTHENTICATED PRICING — NO VALUE
//
// A settable stand-in for a Chainlink push feed proxy, for unit rows and the local Anvil
// demonstration. Every number it returns was put there by whoever deployed or last poked it: it is
// not a price, it is not signed by anyone, it is not derived from any market, and nothing that
// reads it learns anything about the world. It exists so a refusal path can be exercised on purpose
// — an answer of zero, a carried-over round, a missing timestamp, a sequencer that just came back —
// which is the only way to know the adapter's checks are alive rather than merely unexercised.
//
// It lives under `test/` and belongs there. Nothing in `src/`, `script/` or `deployments/` may
// reference it.

import {AggregatorV3Interface} from "../../../src/unica-v4/oracle/AggregatorV3Interface.sol";

contract FixtureAggregator is AggregatorV3Interface {
    uint8 private _decimals;
    string private _description;

    int256 private _answer;
    uint256 private _startedAt;
    uint256 private _updatedAt;
    uint80 private _roundId;
    uint80 private _answeredInRound;

    /// @dev A revert switch, so the `FeedUnreadable` row has something that actually reverts rather
    ///      than a call to an empty address, which fails for a different reason.
    bool public reverting;

    /// @param description_ what `description()` returns. Callers pass a string beginning with
    ///        "FIXTURE " so a human reading a log or an explorer sees what this is immediately.
    constructor(uint8 decimals_, string memory description_) {
        _decimals = decimals_;
        _description = description_;
    }

    /// @notice Sets the whole round in one call, including the two fields a real feed moves together
    ///         and a broken one does not.
    function set(int256 answer, uint256 updatedAt, uint80 roundId, uint80 answeredInRound) external {
        _answer = answer;
        _updatedAt = updatedAt;
        // A real feed starts a round before it answers it. Rows that need `startedAt` zero on its
        // own set it through `setStartedAt` after this call.
        _startedAt = updatedAt;
        _roundId = roundId;
        _answeredInRound = answeredInRound;
    }

    function setStartedAt(uint256 startedAt) external {
        _startedAt = startedAt;
    }

    function setDecimals(uint8 decimals_) external {
        _decimals = decimals_;
    }

    function setReverting(bool value) external {
        reverting = value;
    }

    function decimals() external view returns (uint8) {
        if (reverting) revert("FIXTURE feed unreadable");
        return _decimals;
    }

    function description() external view returns (string memory) {
        return _description;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        if (reverting) revert("FIXTURE feed unreadable");
        return (_roundId, _answer, _startedAt, _updatedAt, _answeredInRound);
    }
}
