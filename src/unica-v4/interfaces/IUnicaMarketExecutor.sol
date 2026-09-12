// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {UnicaMarketTypes} from "../UnicaMarketTypes.sol";

/// @notice The executor of one UNICA v4 market (SC §9): the only address its hook lets swap. It
///         pulls exactly `amountIn` from the order's named payer, swaps, and takes the payout
///         straight to the frozen recipient, or reverts the whole payment.
interface IUnicaMarketExecutor {
    /// @notice Frozen shape (SC §9.3): `boundPayer` is always the non-zero payer in UNICA v4.
    event OrderCreated(
        bytes32 indexed orderId,
        address indexed recipient,
        address indexed creator,
        address boundPayer,
        uint128 amountIn,
        uint128 minOut,
        uint64 deadline
    );
    /// @notice The success signal, emitted after delivery is measured at the recipient.
    event Settled(
        bytes32 indexed orderId,
        address indexed payer,
        address indexed recipient,
        address currencyIn,
        address currencyOut,
        uint256 amountIn,
        uint256 amountDelivered
    );

    function HOOK() external view returns (address);
    function REGISTRY() external view returns (address);
    function MARKET_ID() external view returns (bytes32);
    function ASSET_TOKEN() external view returns (address);
    function PAYOUT_TOKEN() external view returns (address);

    /// @notice Registers what a payment must do. Only a registry-allowlisted creator may call it,
    ///         only on an ACTIVE market, and only naming a payer.
    /// @dev `orderId = keccak256(abi.encode(block.chainid, address(this), msg.sender, salt))`.
    function createOrder(
        address recipient,
        address payer,
        uint128 amountIn,
        uint128 minOut,
        uint64 deadline,
        bytes32 salt
    ) external returns (bytes32 orderId);

    /// @notice Pays an order. `msg.sender` must be the order's payer (`WrongPayer` otherwise).
    function pay(bytes32 orderId) external;

    function orders(bytes32 orderId) external view returns (UnicaMarketTypes.Order memory);
    function orderCount() external view returns (uint256);
    function poolKey() external view returns (PoolKey memory);
    function payoutUsedOnDay(uint256 utcDay) external view returns (uint256);
    function remainingToday() external view returns (uint256 perDayLeft, uint128 perTx);
}
