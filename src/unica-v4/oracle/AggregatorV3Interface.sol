// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice The three reads a UNICA v4 adapter makes of a Chainlink push feed proxy. Declared here
///         rather than pulled in as a dependency: this repository needs the shape, not the package,
///         and a local declaration is the shape the adapter is actually compiled against.
/// @dev `latestRoundData` returns a signed answer on purpose. A negative or zero answer is a real
///      thing a feed can publish and the adapter refuses it rather than casting it away.
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
