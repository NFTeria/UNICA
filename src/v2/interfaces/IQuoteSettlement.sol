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
    /// @dev `executor` is NOT a field: the log's own `address` is the executor, and a field that
    ///      restates the emitter is a field that can disagree with it. `quoteDigest` is, because it
    ///      is the key the hook consumes on and the only identifier that covers every signed term —
    ///      `quoteId` is the merchant's label and two merchants may choose the same one.
    event QuoteSettled(
        bytes32 indexed quoteId,
        address indexed recipient,
        address indexed payer,
        uint16 schemaVersion,
        bytes32 quoteDigest,
        address merchantSigner,
        address hook,
        bytes32 poolId,
        address tokenIn,
        uint256 actualIn,
        uint256 maxIn,
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
    /// @notice Someone other than the bound executor tried to swap through an invoice pool.
    /// @dev This is what makes "every swap through this pool discharges an invoice" a property of
    ///      the POOL rather than a habit of one caller: anyone may call `PoolManager.swap`, and the
    ///      hook is the only party present at every one of those calls.
    error SwapperIsNotTheExecutor(address expected, address got);
    /// @notice A pool with a native currency cannot carry this hook.
    /// @dev The delivery statement V2 makes is "the recipient's balance increases by exactly
    ///      `amountOut` standard token units". Native currency has no `balanceOf`, and `take`
    ///      delivers it by a call the recipient can reject or exhaust. Refused at initialisation
    ///      rather than weakened into an ambiguous minimum at settlement.
    error NativeCurrencyNotSettleable();
    /// @notice A dynamic-fee pool cannot carry this hook.
    /// @dev A dynamic fee is a fee its hook sets. This hook never sets one and has no function to,
    ///      so such a pool would trade at whatever fee it was left at. A venue this contract cannot
    ///      price is a venue it refuses to police.
    error DynamicFeeNotSettleable();
    /// @notice An invoice is an exact-output instrument, so the swap that discharges one must be
    ///         an exact-output swap.
    /// @dev Under exact input the POOL chooses the output. Such a swap can satisfy an invoice's
    ///      floor by luck, and a venue whose admission depends on luck is not a payment venue.
    error ExactOutputRequired();
    error MalformedHookData();
    error UnknownHookDataVersion(uint8 version);

    // ---- the executor's refusals ----------------------------------------------------------
    error UnknownQuoteVersion(uint8 version);
    /// @notice A settlement is already live in this transaction.
    /// @dev The reentrancy guard AND the active-context guard, in one condition. A hostile token
    ///      with a transfer callback is the realistic way in.
    error SettlementAlreadyInProgress(bytes32 liveDigest);
    error NotThePoolManager(address expected, address got);
    /// @notice The quote names a hook that is not bound to this executor.
    /// @dev Mutual binding without a circular constructor: the hook is built knowing its executor,
    ///      and the executor asks the hook. Either half alone can be forged by a merchant signing a
    ///      quote for a venue of their choosing.
    error HookIsNotBoundToThisExecutor(address hook, address boundTo);
    /// @notice The quote's tokens do not sit where its direction says they sit in the pool key.
    error CurrenciesDoNotMatchPool(address expectedIn, address expectedOut);
    error RecipientIsTheExecutor();
    error RecipientIsThePoolManager();
    /// @notice The swap's input side was not a debit, so the sign convention this code relies on
    ///         did not hold. A cast precondition, stated rather than assumed.
    error InputIsNotADebit(int256 amount);
    /// @notice The swap did not deliver the invoice exactly.
    /// @dev The hook enforces a FLOOR and this enforces the EQUALITY, and they are two judges
    ///      rather than one judge consulted twice: `test/v2/SettlementLayers.t.sol` settles through
    ///      a hook with no floor at all and this is the error that speaks. Over-delivery is refused
    ///      rather than given a policy — the excess belongs to nobody this contract may choose for.
    error DeliveryIsNotTheInvoice(bytes32 quoteId, uint256 required, uint256 delivered);
    /// @notice The PoolManager credited a different amount than the swap said was owed.
    error SettlementDidNotClose(uint256 owed, uint256 credited);
    /// @notice THE PAYMENT CHECK. Measured on the recipient's own balance, across the whole
    ///         settlement, and required to be exact — not a minimum.
    error MerchantNotPaidExactly(bytes32 quoteId, uint256 required, uint256 delivered);
    /// @notice The executor's balance moved. It is a conduit; if it held anything, the no-custody
    ///         claim is false for this transaction and the transaction does not happen.
    error ExecutorHeldTheInput(uint256 opening, uint256 closing);
    error ExecutorHeldTheOutput(uint256 opening, uint256 closing);
}
