// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IQuoteSettlement} from "../../src/v2/interfaces/IQuoteSettlement.sol";
import {V2Fixture} from "./util/V2Fixture.sol";
import {HookRevertDecoder} from "./util/HookRevertDecoder.sol";

/// @title GATE 1 — one row per admission guard, each with everything else made to pass
/// @notice The rule this file is written to, and the reason it exists: for each guard, construct
///         state where every PRIOR guard passes and only the targeted condition fails, assert the
///         hook's own nested selector under the right callback, and confirm by sabotage that
///         deleting that one guard turns this row — and no other row's reason — red.
///
///         Two measured failures shaped it. Asserting only that a call reverted let a deleted
///         no-invoice guard hide behind the pool check, because with no invoice live the pool id is
///         also zero. And asserting a bare selector was not enough either, because v4 wraps every
///         hook error in ERC-7751, so `bytes4(err)` reads `0x90bfb865` for all of them. Every row
///         here goes through `HookRevertDecoder`, which is itself validated by sabotage in
///         `test/v2/HookRevertDecoder.t.sol`.
contract HookAdmissionTest is V2Fixture {
    /// @dev Fillable against the fixture's liquidity, so that DELETING the guard under test makes
    ///      the swap succeed and the row fail. A request the pool could not fill would be refused
    ///      by the fill check instead, and the row would pass while proving nothing.
    uint256 internal constant FILLABLE = 1e11;

    bytes32 internal constant DIGEST = keccak256("an invoice");
    bytes32 internal constant OTHER_DIGEST = keccak256("a different invoice");

    function setUp() public {
        _setUpFixture();
    }

    // ---- beforeInitialize: the venue this hook agrees to police ---------------------------

    function test_Init_Control_AnOrdinaryTokenPoolIsAccepted() public {
        PoolKey memory k = _key(address(tokenIn), address(tokenThird), 100, 1);
        bytes memory err = _tryInitialize(k);
        assertEq(err.length, 0, "the control pool was refused; every refusal row below is unreadable");
    }

    /// @dev Native currency is refused at creation rather than handled at settlement. V2's promise
    ///      is an exact balance increase in standard token units; native has no `balanceOf`, and
    ///      `take` delivers it through a call the recipient can reject or exhaust. Narrowing the
    ///      venue is honest; widening the promise to "at least" would not be.
    function test_Init_ANativeCurrencyPoolIsRefused() public {
        PoolKey memory k = _key(address(0), address(tokenIn), 3000, 60);
        assertHookRefusal(
            _tryInitialize(k),
            HOOK_ADDR,
            IHooks.beforeInitialize.selector,
            IQuoteSettlement.NativeCurrencyNotSettleable.selector,
            "a pool with native currency0"
        );
    }

    /// @dev A dynamic fee is a fee its hook sets. This one never sets one and has no function to,
    ///      so such a pool would trade at whatever fee it was left at.
    function test_Init_ADynamicFeePoolIsRefused() public {
        PoolKey memory k = _key(address(tokenIn), address(tokenOut), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        assertHookRefusal(
            _tryInitialize(k),
            HOOK_ADDR,
            IHooks.beforeInitialize.selector,
            IQuoteSettlement.DynamicFeeNotSettleable.selector,
            "a pool whose fee this hook cannot set"
        );
    }

    // ---- beforeSwap: who may swap ---------------------------------------------------------

    /// @dev The guard that makes "invoice-only" a property of the POOL rather than a habit of one
    ///      caller. The outsider here is not malformed and is not underfunded — it is a byte-for-byte
    ///      identical swapper holding identical balances with an identical valid invoice live. The
    ///      only thing wrong with it is that the hook was not bound to it.
    function test_Admit_AnyoneButTheExecutorIsRefused() public {
        _activate(SwapperStubLike(address(executor)), DIGEST, FILLABLE, _id(key), true);
        _activate(SwapperStubLike(address(outsider)), DIGEST, FILLABLE, _id(key), true);

        outsider.swapExactOut(key, true, FILLABLE);

        assertTrue(outsider.lastReverted(), "a stranger swapped through an invoice-only pool");
        assertHookRefusal(
            outsider.lastRevertData(),
            HOOK_ADDR,
            IHooks.beforeSwap.selector,
            IQuoteSettlement.SwapperIsNotTheExecutor.selector,
            "an identical swapper the hook was not bound to"
        );
        assertEq(outsider.lastDelivered(), 0, "a refused swap must deliver nothing");
        assertFalse(hook.consumed(DIGEST), "a refused swap must not consume the invoice");
    }

    /// @dev And the control: the same call from the executor, with nothing else changed, goes
    ///      through. Without this row the one above could pass because the swap was impossible.
    function test_Admit_Control_TheExecutorWithTheSameInvoiceSucceeds() public {
        _activate(SwapperStubLike(address(executor)), DIGEST, FILLABLE, _id(key), true);
        executor.swapExactOut(key, true, FILLABLE);

        assertFalse(executor.lastReverted(), "the control swap was refused; the harness is wrong");
        assertEq(executor.lastDelivered(), FILLABLE, "the control invoice was not filled exactly");
        assertTrue(hook.consumed(DIGEST), "a discharged invoice was not marked consumed");
    }

    // ---- beforeSwap: what may be swapped for -----------------------------------------------

    function test_Admit_ASwapWithNoLiveInvoiceIsRefused() public {
        _activate(SwapperStubLike(address(executor)), bytes32(0), 0, bytes32(0), false);
        executor.swapExactOut(key, true, FILLABLE);

        assertTrue(executor.lastReverted(), "the pool admitted a swap that discharged no invoice");
        assertHookRefusal(
            executor.lastRevertData(),
            HOOK_ADDR,
            IHooks.beforeSwap.selector,
            IQuoteSettlement.NotAnInvoiceDischarge.selector,
            "no invoice live"
        );
    }

    /// @dev THE ROW THE LAST COMMIT SAID WAS OWED. The invoice names a pool that is real,
    ///      initialised, liquid, carries this same hook, and holds the same two currencies in the
    ///      same order — it differs from the pool being swapped in one field of the commitment.
    ///      A check that only asked "is this id nonzero" or "is this a pool I know" would pass it.
    function test_Admit_AnInvoiceNamingASiblingPoolIsRefused() public {
        _activate(SwapperStubLike(address(executor)), DIGEST, FILLABLE, _id(siblingKey), true);
        executor.swapExactOut(key, true, FILLABLE);

        assertTrue(executor.lastReverted(), "an invoice for one pool was discharged through another");
        assertHookRefusal(
            executor.lastRevertData(),
            HOOK_ADDR,
            IHooks.beforeSwap.selector,
            IQuoteSettlement.PoolDoesNotMatchQuote.selector,
            "same currencies, same order, same hook, different fee"
        );
        assertEq(executor.lastDelivered(), 0, "a refused swap must deliver nothing");
        assertFalse(hook.consumed(DIGEST), "a refused swap must not consume the invoice");
    }

    /// @dev And the currency-ordering case, which for the hook is the same comparison reached by a
    ///      different route: a pool whose currencies are a different pair entirely, so `tokenIn`
    ///      sits on the other side of the key. Stated as its own row because "wrong pool" and
    ///      "wrong currencies" are different mistakes even when one check catches both.
    function test_Admit_AnInvoiceNamingAPoolOfOtherCurrenciesIsRefused() public {
        _activate(SwapperStubLike(address(executor)), DIGEST, FILLABLE, _id(foreignKey), true);
        executor.swapExactOut(key, true, FILLABLE);

        assertTrue(executor.lastReverted(), "an invoice for another currency pair was discharged here");
        assertHookRefusal(
            executor.lastRevertData(),
            HOOK_ADDR,
            IHooks.beforeSwap.selector,
            IQuoteSettlement.PoolDoesNotMatchQuote.selector,
            "a pool of different currencies"
        );
    }

    function test_Admit_ASwapInTheWrongDirectionIsRefused() public {
        _activate(SwapperStubLike(address(executor)), DIGEST, FILLABLE, _id(key), false);
        executor.swapExactOut(key, true, FILLABLE);

        assertTrue(executor.lastReverted(), "the invoice named one direction and the pool served the other");
        assertHookRefusal(
            executor.lastRevertData(),
            HOOK_ADDR,
            IHooks.beforeSwap.selector,
            IQuoteSettlement.DirectionDoesNotMatchQuote.selector,
            "quote says one-for-zero, swap is zero-for-one"
        );
        assertEq(executor.lastDelivered(), 0, "a refused swap must deliver nothing");
    }

    // ---- beforeSwap: consumption is keyed by the digest, and only by the digest -------------

    function test_Admit_AConsumedInvoiceCannotBeDischargedAgain() public {
        _activate(SwapperStubLike(address(executor)), DIGEST, FILLABLE, _id(key), true);
        executor.swapExactOut(key, true, FILLABLE);
        assertFalse(executor.lastReverted(), "the first discharge should succeed");

        executor.swapExactOut(key, true, FILLABLE);
        assertTrue(executor.lastReverted(), "a consumed invoice was discharged a second time");
        assertHookRefusal(
            executor.lastRevertData(),
            HOOK_ADDR,
            IHooks.beforeSwap.selector,
            IQuoteSettlement.QuoteAlreadySettled.selector,
            "the same digest, live again"
        );
    }

    /// @dev A consumed digest cannot be revived by pointing it at a different pool. Consumption is
    ///      global to the digest, which is what makes an invoice a one-time instrument rather than
    ///      a one-time-per-venue one.
    function test_Admit_AConsumedDigestCannotBeRevivedInAnotherPool() public {
        _activate(SwapperStubLike(address(executor)), DIGEST, FILLABLE, _id(key), true);
        executor.swapExactOut(key, true, FILLABLE);
        assertFalse(executor.lastReverted(), "the first discharge should succeed");

        _activate(SwapperStubLike(address(executor)), DIGEST, FILLABLE, _id(siblingKey), true);
        executor.swapExactOut(siblingKey, true, FILLABLE);

        assertTrue(executor.lastReverted(), "a consumed digest was discharged again in a sibling pool");
        assertHookRefusal(
            executor.lastRevertData(),
            HOOK_ADDR,
            IHooks.beforeSwap.selector,
            IQuoteSettlement.QuoteAlreadySettled.selector,
            "consumption is keyed by digest, not by pool"
        );
    }

    /// @dev The discriminating positive: a DIFFERENT digest in the same pool is admitted. Without
    ///      it, a consumption check keyed on the pool instead of the digest would pass every row
    ///      above while quietly making each pool a single-use object.
    function test_Admit_ADifferentInvoiceInTheSamePoolIsAdmitted() public {
        _activate(SwapperStubLike(address(executor)), DIGEST, FILLABLE, _id(key), true);
        executor.swapExactOut(key, true, FILLABLE);
        assertFalse(executor.lastReverted(), "the first discharge should succeed");

        _activate(SwapperStubLike(address(executor)), OTHER_DIGEST, FILLABLE, _id(key), true);
        executor.swapExactOut(key, true, FILLABLE);

        assertFalse(executor.lastReverted(), "a second, distinct invoice was refused in a used pool");
        assertEq(executor.lastDelivered(), FILLABLE, "the second invoice was not filled exactly");
        assertTrue(hook.consumed(OTHER_DIGEST), "the second invoice was not marked consumed");
    }

    // ---- the instrument, read against a real PoolManager-produced wrapper -------------------

    /// @dev Everything above decodes revert data produced by the real PoolManager wrapping a real
    ///      hook. This row states the decoded fields out loud once, so the evidence is on the
    ///      record rather than implied by rows that would still pass if the decoder read nothing.
    function test_Admit_TheRefusalIsReadableInFull() public {
        _activate(SwapperStubLike(address(executor)), bytes32(0), 0, bytes32(0), false);
        executor.swapExactOut(key, true, FILLABLE);

        HookRevertDecoder.Refusal memory r = HookRevertDecoder.decode(executor.lastRevertData());
        emit log_named_string("decoded as        ", HookRevertDecoder.kindName(r.kind));
        emit log_named_address("reverting contract", r.target);
        emit log_named_bytes32("failed callback   ", bytes32(r.callbackSelector));
        emit log_named_bytes32("hook reason       ", bytes32(r.reasonSelector));
        assertTrue(r.kind == HookRevertDecoder.Kind.Wrapped, "a real refusal did not decode as a wrapper");
        assertEq(r.target, HOOK_ADDR, "the PoolManager named a different reverting contract");
        assertEq(r.callbackSelector, IHooks.beforeSwap.selector, "the wrapper named a different callback");
        assertEq(r.reasonSelector, IQuoteSettlement.NotAnInvoiceDischarge.selector, "the reason was not the hook's");
    }

    // ---- plumbing ---------------------------------------------------------------------------

    function _activate(SwapperStubLike who, bytes32 digest, uint256 requiredOut, bytes32 poolId, bool zeroForOne)
        internal
    {
        who.set(digest, requiredOut, poolId, zeroForOne);
    }

    function _tryInitialize(PoolKey memory k) internal returns (bytes memory) {
        try manager.initialize(k, TickMath.getSqrtPriceAtTick(0)) returns (int24) {
            return "";
        } catch (bytes memory err) {
            return err;
        }
    }
}

/// @dev The one method these rows need from a swapper stub, named so `_activate` can take either.
interface SwapperStubLike {
    function set(bytes32 d, uint256 r, bytes32 p, bool z) external;
}
