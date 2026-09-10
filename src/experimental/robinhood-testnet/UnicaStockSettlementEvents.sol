// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title UnicaStockSettlementEvents — enough to rebuild a receipt without an indexer
/// @notice The division of labour matters and is the point of having two events rather than one.
///
///         `SettlementReceipt` is the HOOK's record, emitted from inside the swap where the pool's
///         own delta is authoritative. It says the swap met the order's bounds. It is NOT a success
///         signal and must never be rendered as one: at the moment it is emitted, the merchant has
///         not yet been proven to hold anything.
///
///         `Settled` is the EXECUTOR's record, emitted only after the merchant's own token balance
///         has been measured and found to have risen by at least the committed minimum. That is the
///         success signal. Because the whole payment is one transaction, a failure anywhere unwinds
///         both — so a `SettlementReceipt` without a `Settled` cannot exist in committed state.
library UnicaStockSettlementEvents {
    /// @notice Emitted by the hook, inside the swap. Evidence, not success.
    event SettlementReceipt(
        bytes32 indexed orderId,
        address indexed recipient,
        address indexed payer,
        address currencyIn,
        address currencyOut,
        uint128 amountIn,
        uint128 amountOut,
        uint128 fee,
        bytes32 policyId
    );

    /// @notice Emitted by the executor, after delivery is measured. This is the success signal.
    event Settled(
        bytes32 indexed orderId,
        address indexed payer,
        address indexed recipient,
        address currencyIn,
        address currencyOut,
        uint256 amountIn,
        uint256 amountDelivered
    );

    event OrderCreated(
        bytes32 indexed orderId,
        address indexed recipient,
        address indexed creator,
        address boundPayer,
        uint128 amountIn,
        uint128 minOut,
        uint64 deadline
    );
}
