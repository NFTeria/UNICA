// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {UnicaStockSettlementTypes} from "./UnicaStockSettlementTypes.sol";

/// @title UnicaStockSettlementErrors — every refusal, named
/// @notice One error per reason, never a shared generic. A caller that catches one must not
///         silently absorb another, and an interface cannot write a useful sentence in front of a
///         payer if every refusal arrives as the same word.
library UnicaStockSettlementErrors {
    // ── registration ──────────────────────────────────────────────────────────────────────────
    error ZeroRecipient();
    /// @notice A recipient no settlement may name: the contracts on the path, whose balances either
    ///         cannot move out again or are sweepable by the next caller.
    error ReservedRecipient(address recipient);
    error PoolNotGuarded(address hooks);
    error InputCurrencyNotAllowed(address currency);
    error PayoutCurrencyNotAllowed(address currency);
    /// @notice The pool's two currencies are not this generation's input and payout, in either order.
    error NotTheSettlementShape(address currency0, address currency1);
    error ZeroAmount();
    error ZeroMinOut();
    error DeadlineInPast(uint64 deadline);
    error OrderExists(bytes32 orderId);

    // ── payment ───────────────────────────────────────────────────────────────────────────────
    error UnknownOrder(bytes32 orderId);
    error OrderNotOpen(bytes32 orderId, UnicaStockSettlementTypes.Status status);
    error OrderExpired(bytes32 orderId, uint64 deadline);
    error WrongPayer(bytes32 orderId, address bound, address caller);
    error NativeNotAccepted();
    /// @notice The payer's allowance to this executor is below the order's exact input.
    error AllowanceTooLow(address token, uint256 needed, uint256 allowed);
    /// @notice The executor received an amount other than the order's input. A fee-on-transfer or
    ///         rebasing input token lands here, by design: this generation refuses it rather than
    ///         settling a different amount than the order names.
    error InputNotExact(uint128 expected, uint256 received);
    error TransferFailed(address token);
    /// @notice The PoolManager credited an amount other than what was handed to it.
    error SettlementDidNotClose(uint256 owed, uint256 credited);
    /// @notice The hook did not receipt exactly one settlement for this payment.
    error NoReceipt(bytes32 orderId);
    /// @notice The merchant's own balance grew by less than the committed minimum. The pool may have
    ///         credited enough; this is the check that the token actually delivered it.
    error RecipientShort(bytes32 orderId, uint128 minOut, uint256 received);
    /// @notice The executor still holds input or payout it should not. Measured, never assumed.
    error ExecutorResidualInput(uint256 before_, uint256 after_);
    error ExecutorResidualPayout(uint256 before_, uint256 after_);
    error Reentered();
    error NotPoolManager(address caller);

    // ── hook ──────────────────────────────────────────────────────────────────────────────────
    error NotSettlementExecutor(address caller);
    error MalformedHookData(uint256 length);
    error OrderNotInFlight(bytes32 orderId, UnicaStockSettlementTypes.Status status);
    error ParamsDoNotMatchOrder(bytes32 orderId);
    error PoolDoesNotMatchOrder(bytes32 orderId);
    error OrderAlreadySwapped(bytes32 orderId);
    error PartialFill(bytes32 orderId, uint128 requested, uint128 consumed);
    error OutputBelowMinimum(bytes32 orderId, uint128 minOut, uint128 amountOut);
}
