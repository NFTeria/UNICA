// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice The hook of one UNICA v4 market (SC §8, §11): one pool, from the factory only; only its
///         executor swaps; the receipt is emitted inside the swap after every check.
interface IUnicaMarketHook {
    /// @notice The UNICA v4 receipt (SC §11). Evidence the swap met the order's bounds; the success
    ///         signal is the executor's `Settled` in the same transaction. A consumer accepts it only
    ///         when `log.address == registry.getMarket(marketId).hook`.
    event SettlementReceipt(
        bytes32 indexed orderId,
        address indexed recipient,
        address indexed payer,
        bytes32 marketId,
        address currencyIn,
        address currencyOut,
        uint128 amountIn,
        uint128 amountOut,
        uint24 hookFeePips,
        uint24 lpFeePips,
        uint24 protocolFeePips,
        uint24 swapFeePips,
        uint256 referencePrice,
        uint8 referenceDecimals,
        uint64 referenceUpdatedAt,
        bool demonstrationOnly
    );

    function FACTORY() external view returns (address);
    function REGISTRY() external view returns (address);
    function MARKET_ID() external view returns (bytes32);
    function EXECUTOR() external view returns (address);
    function POOL_ID() external view returns (bytes32);
    function receiptCount() external view returns (uint256);
    function feeRates() external view returns (uint24 lpFee, uint24 protocolFee, uint24 swapFee);
}
