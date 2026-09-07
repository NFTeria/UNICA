// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IQuoteSettlement} from "./interfaces/IQuoteSettlement.sol";
import {IPermit2Transfer, IInvoiceHook} from "./interfaces/IPermit2Transfer.sol";

/// @title QuoteSettlementExecutor — a payment terminal, not a router
/// @notice The hook proves the SWAP. This contract proves the PAYMENT, and the two are bound by the
///         atomicity of one transaction: the hook admits nothing that is not an invoice discharge,
///         and this contract reverts everything that is not an exact delivery to the named
///         recipient. Neither claim is true without the other, and neither is stated as if it were.
///
///         PATH B1, measured before it was written. The payer's token never touches this contract:
///         Permit2 moves it from the payer straight to the PoolManager, between `sync` and
///         `settle`, and the output is `take`n straight to the merchant. Both legs are asserted on
///         real balances at the end, so "no custody" is a measurement here and not a diagram.
///
/// @dev WHAT A RELAYER MAY CHOOSE: nothing. Not the Permit2 destination, not the PoolManager, not
///      the hook, not the recipient, not the settlement actions, not a router command. Everything
///      is either a constructor immutable or inside a signature. A relayer may only decide WHETHER
///      to submit a settlement that two other parties already agreed to.
///
/// @dev IMPLEMENTED AND LOCALLY TESTED, NOT DEPLOYED. No audit. See `test/v2/` for what is proven
///      and `docs/UNICA-TOOLS.md` for what is not.
contract QuoteSettlementExecutor is IUnlockCallback, IQuoteSettlement {
    using PoolIdLibrary for PoolKey;

    /// @notice The only quote shape this contract understands.
    uint8 public constant QUOTE_VERSION = 1;
    /// @notice The receipt schema this contract emits. Independent of the quote version, because an
    ///         indexer and a signer are different audiences with different reasons to change.
    uint16 public constant RECEIPT_SCHEMA_VERSION = 1;

    IPoolManager public immutable POOL_MANAGER;
    IPermit2Transfer public immutable PERMIT2;

    // ---- EIP-712 -----------------------------------------------------------------------------

    string public constant QUOTE_TYPE = "Quote(uint8 version,bytes32 quoteId,address merchantSigner,"
        "address payer,address recipient,address tokenIn,uint256 maxIn,address tokenOut,uint256 amountOut,"
        "PoolKey pool,bool zeroForOne,uint256 deadline,address hook,address executor,bytes32 merchantConfigHash,"
        "uint32 policyVersion)PoolKey(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
    bytes32 internal constant QUOTE_TYPEHASH = keccak256(bytes(QUOTE_TYPE));
    bytes32 internal constant POOL_KEY_TYPEHASH =
        keccak256("PoolKey(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)");

    /// @dev The payer's witness, and the type string Permit2 concatenates onto its own stub. The
    ///      struct is described ONCE, in `PAYMENT_TYPE`; the string Permit2 needs is built from it.
    ///      An earlier version of the test suite hand-maintained both, and a sabotage renaming a
    ///      field in one left every row green because signer and caller read the same corrupted
    ///      copy. The mismatch surfaces in a payer's wallet, not in a test.
    string public constant PAYMENT_TYPE =
        "Payment(bytes32 quoteId,address payer,address tokenIn,uint256 maxIn,address destination,address executor)";
    bytes32 internal constant PAYMENT_TYPEHASH = keccak256(bytes(PAYMENT_TYPE));

    /// @dev No cached domain separator. Permit2 caches one and it is the reason a test harness in
    ///      this repository spent a day proving that signatures no wallet would produce are valid:
    ///      the cache is an immutable, immutables live in runtime code, and code can be moved.
    ///      Recomputing costs a few hundred gas and cannot be wrong about which chain it is on.
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("UNICA"),
                keccak256("2"),
                block.chainid,
                address(this)
            )
        );
    }

    // ---- the active settlement context, in transient storage ----------------------------------

    /// @notice What the hook reads to learn which invoice is live in this transaction.
    /// @dev Transient (EIP-1153), so it costs no refundable storage and — the property that matters
    ///      — a revert anywhere in the transaction discards it. There is no code path that can
    ///      leave a stale context behind, because leaving one requires the transaction to succeed,
    ///      and every success path clears it explicitly before returning.
    bytes32 private transient _activeDigest;
    uint256 private transient _activeRequiredOut;
    bytes32 private transient _activePoolId;
    bool private transient _activeZeroForOne;
    address private transient _activePayer;

    /// @notice The hook's whole view of this contract.
    /// @dev Deliberately narrow. The hook needs to know WHAT is being discharged and WHERE; it has
    ///      no business reading a signature, and a wider surface would be a wider thing to forge.
    function activeQuote()
        external
        view
        returns (bytes32 digest, uint256 requiredOut, bytes32 poolId, bool zeroForOne)
    {
        return (_activeDigest, _activeRequiredOut, _activePoolId, _activeZeroForOne);
    }

    /// @notice The payer whose authorisation is being spent right now, or zero.
    function activePayer() external view returns (address) {
        return _activePayer;
    }

    constructor(IPoolManager poolManager_, IPermit2Transfer permit2_) {
        POOL_MANAGER = poolManager_;
        PERMIT2 = permit2_;
    }

    // ---- the one entry point -------------------------------------------------------------------

    /// @notice What a payer signs alongside their Permit2 authorisation.
    /// @dev Carried separately from the quote because it is the PAYER's half. The signature covers
    ///      the nonce and the deadline, so neither can be altered by whoever submits.
    struct PayerAuthorization {
        uint256 nonce;
        uint256 deadline;
        bytes signature;
    }

    /// @notice Discharge one merchant-signed invoice with one payer-authorised input.
    /// @dev Callable by anyone. That is not a weakness: both parties have signed, the recipient and
    ///      the amount are inside those signatures, and the only thing a submitter decides is
    ///      whether the settlement happens at all.
    /// @return actualIn what the swap really cost the payer, never more than the signed ceiling
    /// @return deliveredOut what the merchant really received, required to equal the invoice
    function settle(Quote calldata q, bytes calldata merchantSignature, PayerAuthorization calldata auth)
        external
        returns (uint256 actualIn, uint256 deliveredOut)
    {
        bytes32 digest = _validate(q, merchantSignature);

        _activeDigest = digest;
        _activeRequiredOut = q.amountOut;
        _activePoolId = PoolId.unwrap(q.pool.toId());
        _activeZeroForOne = q.zeroForOne;
        _activePayer = q.payer;

        Openings memory opening = Openings({
            merchant: IERC20(q.tokenOut).balanceOf(q.recipient),
            executorIn: IERC20(q.tokenIn).balanceOf(address(this)),
            executorOut: IERC20(q.tokenOut).balanceOf(address(this))
        });

        (actualIn, deliveredOut) = abi.decode(POOL_MANAGER.unlock(abi.encode(q, auth, digest)), (uint256, uint256));

        // Cleared BEFORE the checks below, so nothing after the swap runs with a live context.
        _clearActiveContext();

        _proveThePayment(q, opening);
        _emitReceipt(q, actualIn, deliveredOut, digest);
    }

    /// @dev Balances read before the settlement, so every claim afterwards is a difference measured
    ///      on the same addresses rather than an absolute number that includes whatever was already
    ///      there. An earlier B1 harness in this repository asserted an absolute balance and proved
    ///      nothing; the delta is the claim.
    struct Openings {
        uint256 merchant;
        uint256 executorIn;
        uint256 executorOut;
    }

    function _clearActiveContext() internal {
        _activeDigest = bytes32(0);
        _activeRequiredOut = 0;
        _activePoolId = bytes32(0);
        _activeZeroForOne = false;
        _activePayer = address(0);
    }

    /// @dev THE PAYMENT CHECK and THE CUSTODY CHECK, both measured on real balances.
    ///
    ///      The merchant's number is read from the merchant's own balance across the whole
    ///      settlement, because that is the only number a merchant cares about and the only one a
    ///      hostile token cannot describe away. A token that takes a fee on transfer fails here, by
    ///      design: this contract refuses an output whose transfer semantics cannot carry the word
    ///      "exactly", rather than weakening the word into "at least".
    function _proveThePayment(Quote calldata q, Openings memory opening) internal view {
        uint256 closing = IERC20(q.tokenOut).balanceOf(q.recipient);
        uint256 received = closing < opening.merchant ? 0 : closing - opening.merchant;
        if (received != q.amountOut) revert MerchantNotPaidExactly(q.quoteId, q.amountOut, received);

        closing = IERC20(q.tokenIn).balanceOf(address(this));
        if (closing != opening.executorIn) revert ExecutorHeldTheInput(opening.executorIn, closing);
        closing = IERC20(q.tokenOut).balanceOf(address(this));
        if (closing != opening.executorOut) revert ExecutorHeldTheOutput(opening.executorOut, closing);
    }

    /// @dev One receipt, emitted only after the unlock returned and the delivery was verified. A
    ///      receipt emitted inside the callback would survive a later check that failed, which is
    ///      the difference between a record of a payment and a record of an attempt.
    function _emitReceipt(Quote calldata q, uint256 actualIn, uint256 deliveredOut, bytes32 digest) internal {
        Receipt memory r = Receipt({
            quoteId: q.quoteId,
            quoteDigest: digest,
            recipient: q.recipient,
            payer: q.payer,
            merchantSigner: q.merchantSigner,
            hook: q.hook,
            poolId: PoolId.unwrap(q.pool.toId()),
            tokenIn: q.tokenIn,
            actualIn: actualIn,
            maxIn: q.maxIn,
            tokenOut: q.tokenOut,
            amountOut: q.amountOut,
            deliveredOut: deliveredOut,
            policyVersion: q.policyVersion
        });
        emit QuoteSettled(
            r.quoteId,
            r.recipient,
            r.payer,
            RECEIPT_SCHEMA_VERSION,
            r.quoteDigest,
            r.merchantSigner,
            r.hook,
            r.poolId,
            r.tokenIn,
            r.actualIn,
            r.maxIn,
            r.tokenOut,
            r.amountOut,
            r.deliveredOut,
            r.policyVersion
        );
    }

    /// @dev The receipt's fields, gathered in memory before the event is raised. Not decoration:
    ///      with the optimiser's IR pipeline deliberately off — turning it on would change the
    ///      bytecode of every contract in this tree, including the V1 hook whose deployed address
    ///      was mined against these exact settings — a fifteen-argument event evaluated straight
    ///      from calldata does not fit the EVM's stack. Gathering first is what makes it compile.
    struct Receipt {
        bytes32 quoteId;
        bytes32 quoteDigest;
        address recipient;
        address payer;
        address merchantSigner;
        address hook;
        bytes32 poolId;
        address tokenIn;
        uint256 actualIn;
        uint256 maxIn;
        address tokenOut;
        uint256 amountOut;
        uint256 deliveredOut;
        uint32 policyVersion;
    }

    // ---- validation ------------------------------------------------------------------------------

    /// @dev Every field of the quote is checked before any state is touched and before any external
    ///      call is made. Nothing here reads calldata that is not inside the merchant's signature.
    function _validate(Quote calldata q, bytes calldata merchantSignature) internal view returns (bytes32 digest) {
        if (_activeDigest != bytes32(0)) revert SettlementAlreadyInProgress(_activeDigest);
        if (q.version != QUOTE_VERSION) revert UnknownQuoteVersion(q.version);
        if (block.timestamp > q.deadline) revert QuoteExpired(q.quoteId, q.deadline);
        if (q.amountOut == 0) revert ZeroAmountOut();
        if (q.maxIn == 0) revert ZeroMaxIn();
        if (q.recipient == address(0)) revert ZeroRecipient();
        if (q.recipient == address(this)) revert RecipientIsTheExecutor();
        if (q.recipient == address(POOL_MANAGER)) revert RecipientIsThePoolManager();
        if (q.executor != address(this)) revert NotTheQuotedExecutor(address(this), q.executor);
        if (q.hook != address(q.pool.hooks)) revert NotTheQuotedHook(address(q.pool.hooks), q.hook);

        // The currencies must sit where the direction says they sit. Without this a quote could
        // name a pool of the right shape and the wrong assets, and the swap would move the wrong
        // token while every other check agreed with itself.
        address expectedIn = Currency.unwrap(q.zeroForOne ? q.pool.currency0 : q.pool.currency1);
        address expectedOut = Currency.unwrap(q.zeroForOne ? q.pool.currency1 : q.pool.currency0);
        if (q.tokenIn != expectedIn || q.tokenOut != expectedOut) {
            revert CurrenciesDoNotMatchPool(expectedIn, expectedOut);
        }

        // The other half of the mutual binding. The hook refuses a swapper that is not its
        // executor; this refuses a hook that does not name this executor. One without the other is
        // a merchant choosing the venue.
        address boundTo = IInvoiceHook(q.hook).EXECUTOR();
        if (boundTo != address(this)) revert HookIsNotBoundToThisExecutor(q.hook, boundTo);

        digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), hashQuote(q)));
        if (ECDSA.recover(digest, merchantSignature) != q.merchantSigner) revert WrongMerchantSignature(q.quoteId);

        // The hook is the one authority for consumption. Asked here so a replay fails with a name
        // rather than as a wrapped hook revert three frames deeper.
        if (IInvoiceHook(q.hook).consumed(digest)) revert QuoteAlreadySettled(q.quoteId);
    }

    /// @notice The EIP-712 struct hash of a quote, exposed so a merchant's signer and any verifier
    ///         can derive the same value without reimplementing it.
    function hashQuote(Quote calldata q) public pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(
                    QUOTE_TYPEHASH, q.version, q.quoteId, q.merchantSigner, q.payer, q.recipient, q.tokenIn, q.maxIn
                ),
                abi.encode(
                    q.tokenOut,
                    q.amountOut,
                    _hashPoolKey(q.pool),
                    q.zeroForOne,
                    q.deadline,
                    q.hook,
                    q.executor,
                    q.merchantConfigHash,
                    q.policyVersion
                )
            )
        );
    }

    function _hashPoolKey(PoolKey calldata k) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                POOL_KEY_TYPEHASH,
                Currency.unwrap(k.currency0),
                Currency.unwrap(k.currency1),
                k.fee,
                k.tickSpacing,
                address(k.hooks)
            )
        );
    }

    /// @notice The witness the payer's Permit2 signature carries.
    /// @dev `destination` is the PoolManager, written here as `address(POOL_MANAGER)` and written
    ///      again at the call site. Permit2 does not enforce a destination, so this field is what
    ///      lets a payer, a wallet, or a verifier see afterwards where the money was meant to go —
    ///      and it is inside the digest, so a signature made for this destination cannot be
    ///      presented for another.
    function paymentWitness(Quote calldata q) public view returns (bytes32) {
        return keccak256(
            abi.encode(PAYMENT_TYPEHASH, q.quoteId, q.payer, q.tokenIn, q.maxIn, address(POOL_MANAGER), address(this))
        );
    }

    /// @notice The string Permit2 concatenates onto its own type stub.
    /// @dev Built from `PAYMENT_TYPE` so the struct is described exactly once in this contract.
    ///      `TokenPermissions` comes last because EIP-712 orders referenced structs alphabetically
    ///      and `Payment` sorts first.
    function paymentWitnessTypeString() public pure returns (string memory) {
        return string.concat("Payment witness)", PAYMENT_TYPE, "TokenPermissions(address token,uint256 amount)");
    }

    // ---- the unlock ------------------------------------------------------------------------------

    /// @dev The whole settlement, inside one PoolManager unlock. The order is not decorative:
    ///      `sync` records the manager's balance, the Permit2 pull raises it by exactly what the
    ///      swap cost, and `settle` credits the difference. Anything between `sync` and `settle`
    ///      that moved the same currency would be credited to this settlement by mistake.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(POOL_MANAGER)) revert NotThePoolManager(address(POOL_MANAGER), msg.sender);
        (Quote memory q, PayerAuthorization memory auth, bytes32 digest) =
            abi.decode(data, (Quote, PayerAuthorization, bytes32));

        BalanceDelta delta = POOL_MANAGER.swap(
            q.pool,
            SwapParams({
                zeroForOne: q.zeroForOne,
                // Positive is exact output. The invoice names the output, so the swap does too.
                amountSpecified: int256(q.amountOut),
                // No price limit. The payer's protection is the signed input ceiling, checked
                // below against what the swap actually cost; a tick limit would be a second,
                // weaker version of the same promise expressed in units nobody signed.
                sqrtPriceLimitX96: q.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        // The passed delta is the only authoritative evidence here. Asking the PoolManager for
        // `currencyDelta` inside this frame would describe a state that has not happened yet.
        int128 inDelta = q.zeroForOne ? delta.amount0() : delta.amount1();
        int128 outDelta = q.zeroForOne ? delta.amount1() : delta.amount0();
        if (inDelta >= 0) revert InputIsNotADebit(inDelta);

        uint256 actualIn = uint256(uint128(-inDelta));
        uint256 deliveredOut = outDelta < 0 ? 0 : uint256(uint128(outDelta));

        // THE PAYER'S CEILING, against what the swap really cost rather than what was requested.
        if (actualIn > q.maxIn) revert InputCeilingExceeded(q.quoteId, q.maxIn, actualIn);
        // The hook enforced a floor. This is the equality, and it is here because the exact amount
        // is the executor's obligation, not the hook's.
        if (deliveredOut != q.amountOut) revert DeliveredMoreThanTheInvoice(q.quoteId, q.amountOut, deliveredOut);

        // B1: the payer's token goes from the payer to the PoolManager. It is never here.
        POOL_MANAGER.sync(Currency.wrap(q.tokenIn));
        PERMIT2.permitWitnessTransferFrom(
            IPermit2Transfer.PermitTransferFrom({
                permitted: IPermit2Transfer.TokenPermissions({token: q.tokenIn, amount: q.maxIn}),
                nonce: auth.nonce,
                deadline: auth.deadline
            }),
            IPermit2Transfer.SignatureTransferDetails({
                // A LITERAL, never calldata. Permit2 lets the caller choose this and does not tell
                // the payer's signature about it; `test/v2/Permit2Witness.t.sol` measured a
                // transfer to an attacker being accepted.
                to: address(POOL_MANAGER),
                // What the swap cost, not the ceiling.
                requestedAmount: actualIn
            }),
            q.payer,
            _witnessOf(q, digest),
            paymentWitnessTypeString(),
            auth.signature
        );
        uint256 credited = POOL_MANAGER.settle();
        if (credited != actualIn) revert SettlementDidNotClose(actualIn, credited);

        // And the output goes from the PoolManager to the merchant. Also never here.
        POOL_MANAGER.take(Currency.wrap(q.tokenOut), q.recipient, q.amountOut);

        return abi.encode(actualIn, deliveredOut);
    }

    /// @dev The memory-side twin of `paymentWitness`. `digest` is unused in the hash and taken only
    ///      so the compiler keeps the settlement's identity in view at the call site.
    function _witnessOf(Quote memory q, bytes32) internal view returns (bytes32) {
        return keccak256(
            abi.encode(PAYMENT_TYPEHASH, q.quoteId, q.payer, q.tokenIn, q.maxIn, address(POOL_MANAGER), address(this))
        );
    }
}
