// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice The one price read a UNICA v4 hook makes (SC §10). A quote per ONE whole asset, scaled
///         by `10**decimals`; `updatedAt` is the source's own publish time, never arrival or block
///         time. `view`, so the hook's call is a STATICCALL and cannot re-enter. An unpriceable pair
///         is a typed revert, never a zero or a placeholder.
interface IUnicaPriceOracle {
    function latestPrice(address asset, address quote)
        external
        view
        returns (uint256 price, uint8 decimals, uint256 updatedAt);
}

/// @notice The adapter-level route identity (SC §10, ruling S8). `feedIdFor` is the defence: the
///         registry checks it at `register` and the hook repeats the check on every swap, so a
///         market's `(adapter, feedId)` commitment is verified on-chain, never by readback alone.
///         `adapterKind` is a label, not a defence.
interface IUnicaOracleRoute {
    function feedIdFor(address asset, address quote) external view returns (bytes32 feedId);
    function adapterKind() external view returns (bytes32);
}
