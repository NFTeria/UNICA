// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {UnicaMarketTypes} from "../unica-v4/UnicaMarketTypes.sol";

/// @title IDirectSettlement — a same-asset payment settles directly, without a pool (UNICA v5)
/// @notice When the customer pays in the asset the business wants to receive, there is nothing to
///         convert. This contract carries the SAME order shape and the same ABI the market executor
///         exposes (createOrder / pay / orders), so terminal admission, the wallet layer and the
///         evidence reader treat both paths alike, and the payer binding, exact amount, expiry and
///         single settlement are enforced identically. It never calls a pool, a hook or an oracle.
///         WHY a separate contract and not a branch in the executor: the v4 market executor's
///         semantics are frozen and audited around a swap; a direct transfer is a different trust
///         surface (no price, no liquidity) and gets its own small, reviewable code.
interface IDirectSettlement {
    /// @notice Emitted once per settlement. `asset` is the one asset paid and received.
    event DirectReceipt(
        bytes32 indexed orderId,
        address indexed recipient,
        address indexed payer,
        address asset,
        uint256 amount,
        bytes32 terminalNode,
        uint64 settledAt
    );
    event OrderCreated(
        bytes32 indexed orderId,
        address indexed recipient,
        address indexed payer,
        uint128 amount,
        uint64 deadline,
        bytes32 terminalNode
    );

    error NotOrderCreator(address who);
    error UnknownOrder(bytes32 orderId);
    error OrderNotOpen(bytes32 orderId, uint8 status);
    error WrongPayer(bytes32 orderId, address expected, address actual);
    error OrderExpired(bytes32 orderId, uint64 deadline);
    error ZeroAmount();
    error DeliveryNotExact(uint256 expected, uint256 delivered);
    error TransferFailed();

    /// @notice The one asset this settler moves (payout asset == customer asset).
    function ASSET() external view returns (address);
    /// @notice A stable id for evidence: keccak256("unica-v5/direct", chainid, this, asset).
    function SETTLEMENT_ID() external view returns (bytes32);
    /// @notice The official UNICA v4 registry this settler answers to. Fixed at construction.
    function REGISTRY() external view returns (address);
    /// @notice The only account that may call `setOrderCreator`: the registry's admin RIGHT NOW,
    ///         read live on every check rather than copied here at construction. It is the same
    ///         account `TerminalAdmission.setDirectSettler` asks for, so listing a settler on the
    ///         gate and deciding who may raise a sale on it are one authority, not two, and a
    ///         handover of the registry admin carries both without a transaction here.
    function admin() external view returns (address);

    /// @notice Same signature as the market executor's createOrder; `minOut` must equal `amountIn`.
    function createOrder(
        address recipient,
        address payer,
        uint128 amountIn,
        uint128 minOut,
        uint64 deadline,
        bytes32 salt
    ) external returns (bytes32 orderId);
    /// @notice Pull exactly `amount` of ASSET from the bound payer to the recipient; refuses a
    ///         fee-on-transfer shortfall (`DeliveryNotExact`), a wrong payer, replay and expiry.
    function pay(bytes32 orderId) external;
    function orders(bytes32 orderId) external view returns (UnicaMarketTypes.Order memory);
    function setOrderCreator(address creator, bool allowed) external;
    function isOrderCreator(address creator) external view returns (bool);
}
