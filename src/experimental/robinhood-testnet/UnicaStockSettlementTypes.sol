// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @title UnicaStockSettlementTypes — the shapes the experimental generation settles against
/// @notice EXPERIMENTAL. Not deployed anywhere. Not a version of the live V3 generation, which is
///         untouched. This generation exists to answer one question: can a payment funded with an
///         ERC-20 the payer already holds settle into a different ERC-20 the merchant chose, with a
///         Uniswap v4 hook as the policy boundary, and nothing trusted that does not have to be.
library UnicaStockSettlementTypes {
    /// @notice An order's life. The numbering is load-bearing: it is read out of a chain word, and
    ///         `Settled` must stay 3 so an interface written against the live generation reads this
    ///         one without a translation table.
    enum Status {
        None,
        Open,
        Paying,
        Settled
    }

    /// @notice Everything a settlement is allowed to depend on, fixed before any value moves.
    /// @dev `recipient` is stored, never a name. Nothing in the settlement path resolves a name, so
    ///      a name record that changes after an order exists cannot redirect that order — it can
    ///      only affect the next one.
    struct Order {
        address recipient;
        address creator;
        /// @dev Zero means any address may pay. Non-zero binds the payment to one payer.
        address boundPayer;
        address payer;
        PoolKey key;
        /// @dev The exact input taken from the payer. Not a maximum and not a minimum.
        uint128 amountIn;
        /// @dev The floor the merchant's own balance must actually rise by.
        uint128 minOut;
        uint64 deadline;
        Status status;
    }
}
