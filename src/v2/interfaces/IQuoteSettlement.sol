// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @title The V2 invoice, and the vocabulary the hook and the executor share
/// @notice V2 turns a v4 pool into an invoice-only venue: a merchant signs what they must be
///         paid, a payer authorises a ceiling of some other asset, and the pool admits the swap
///         only because it discharges that invoice. This file carries the shapes both contracts
///         must agree on, so neither can drift from the other's idea of what was signed.
///
///         SPECIFICATION IN PROGRESS. Nothing here is deployed, and the hook that reads it is
///         scaffolding until the red controls in `test/v2/` are green for the intended reasons.
interface IQuoteSettlement {
    /// @notice What the merchant signs. Every field is security-relevant and every field is in
    ///         the digest: a field outside it is a field a relayer can change on the way in.
    /// @dev `payer` is bound rather than open in this milestone. An open-payer quote is a bearer
    ///      instrument, and a bearer instrument that also names a price is a front-running target.
    struct Quote {
        uint8 version;
        bytes32 quoteId;
        address merchantSigner;
        address payer;
        address recipient;
        address tokenIn;
        uint256 maxIn;
        address tokenOut;
        uint256 amountOut;
        PoolKey pool;
        bool zeroForOne;
        uint256 deadline;
        address hook;
        address executor;
        bytes32 merchantConfigHash;
        uint32 policyVersion;
    }

    /// @notice What the payer signs, as the witness of a Permit2 signature transfer.
    /// @dev `destination` is carried even though Permit2 does not enforce it, because Permit2's
    ///      transfer destination is chosen by the CALLER at spend time — measured in
    ///      `test/v2/Permit2Witness.t.sol`, where a transfer to an attacker was accepted and the
    ///      payer's signature did not object. The executor fixes the real destination in code;
    ///      this field is what a verifier compares it against afterwards.
    struct Payment {
        bytes32 quoteId;
        address payer;
        address tokenIn;
        uint256 maxIn;
        address destination;
        address executor;
    }

    /// @notice The canonical V2 settlement record, emitted by the executor once the unlock has
    ///         returned and the merchant has been paid.
    /// @dev `actualIn` and `deliveredOut` are MEASURED; `amountOut` is what the invoice asked for.
    ///      They are separate fields because they can differ, and an indexer that cannot tell a
    ///      request from a measurement cannot audit anything.
    event QuoteSettled(
        bytes32 indexed quoteId,
        address indexed recipient,
        address indexed payer,
        uint16 schemaVersion,
        address merchantSigner,
        address executor,
        address hook,
        bytes32 poolId,
        address tokenIn,
        uint256 actualIn,
        address tokenOut,
        uint256 amountOut,
        uint256 deliveredOut,
        uint32 policyVersion
    );

    error QuoteExpired(bytes32 quoteId, uint256 deadline);
    error QuoteAlreadySettled(bytes32 quoteId);
    error NotTheQuotedPayer(address expected, address got);
    error NotTheQuotedExecutor(address expected, address got);
    error NotTheQuotedHook(address expected, address got);
    error WrongMerchantSignature(bytes32 quoteId);
    error ZeroAmountOut();
    error ZeroMaxIn();
    error ZeroRecipient();
    /// @notice The invoice was not delivered in full. Under exact output the official periphery
    ///         checks only the input ceiling, so this refusal exists here or nowhere — measured in
    ///         `test/v2/ShortFill.t.sol`, where a request for 1e18 was served 2,995,354,955,910
    ///         and nothing reverted.
    error InvoiceNotFilled(bytes32 quoteId, uint256 required, uint256 delivered);
    error InputCeilingExceeded(bytes32 quoteId, uint256 maxIn, uint256 actualIn);
    error PoolDoesNotMatchQuote();
    error DirectionDoesNotMatchQuote();
    error NotAnInvoiceDischarge();
    error MalformedHookData();
    error UnknownHookDataVersion(uint8 version);
}
