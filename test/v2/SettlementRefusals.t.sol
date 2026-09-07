// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IQuoteSettlement} from "../../src/v2/interfaces/IQuoteSettlement.sol";
import {IPermit2Transfer} from "../../src/v2/interfaces/IPermit2Transfer.sol";
import {QuoteSettlementExecutor} from "../../src/v2/QuoteSettlementExecutor.sol";
import {QuoteSettlementHook} from "../../src/v2/QuoteSettlementHook.sol";
import {SettlementFixture} from "./util/SettlementFixture.sol";
import {HookRevertDecoder} from "./util/HookRevertDecoder.sol";

/// @notice Permit2's own refusals, declared so a row can name which one fired.
interface IPermit2Errors {
    error InvalidAmount(uint256 maxAmount);
    error InvalidNonce();
    error InvalidSigner();
    error SignatureExpired(uint256 signatureDeadline);
}

/// @title GATE 2 — every way a settlement is refused, each naming its own reason
/// @notice The rule: construct state where every EARLIER check passes, break exactly one thing, and
///         assert the selector. Asserting only that `settle` reverted would let any guard stand in
///         for any other, which is the defect this repository already measured once in the hook.
///
///         Every quote below is signed correctly by the merchant, including the malformed ones.
///         The signature is checked LAST, so signing them properly is what makes each row a test of
///         the guard it names rather than a test of the signature check.
contract SettlementRefusalsTest is SettlementFixture, IPermit2Errors {
    uint256 internal constant AMOUNT_OUT = 1e9;
    uint256 internal constant MAX_IN = 10 ether;

    function setUp() public {
        _setUpSettlement();
    }

    // ---- the control -------------------------------------------------------------------------

    function test_Refuse_Control_AWellFormedSettlementSucceeds() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("ok"), AMOUNT_OUT, MAX_IN);
        bytes memory err = _trySettle(q, 0);
        assertEq(err.length, 0, "the control settlement was refused; no row below can be believed");
    }

    // ---- the quote's own fields ----------------------------------------------------------------

    function test_Refuse_AnExpiredQuote() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("expired"), AMOUNT_OUT, MAX_IN);
        q.deadline = block.timestamp - 1;
        _expect(q, 1, abi.encodeWithSelector(IQuoteSettlement.QuoteExpired.selector, q.quoteId, q.deadline));
    }

    function test_Refuse_AZeroAmountOut() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("zeroOut"), 0, MAX_IN);
        _expect(q, 2, abi.encodeWithSelector(IQuoteSettlement.ZeroAmountOut.selector));
    }

    function test_Refuse_AZeroCeiling() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("zeroIn"), AMOUNT_OUT, 0);
        _expect(q, 3, abi.encodeWithSelector(IQuoteSettlement.ZeroMaxIn.selector));
    }

    function test_Refuse_AZeroRecipient() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("zeroTo"), AMOUNT_OUT, MAX_IN);
        q.recipient = address(0);
        _expect(q, 4, abi.encodeWithSelector(IQuoteSettlement.ZeroRecipient.selector));
    }

    /// @dev A recipient that is the executor would make the custody assertion unfalsifiable: the
    ///      merchant's balance and the executor's balance would be the same number.
    function test_Refuse_ARecipientThatIsTheExecutor() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("selfTo"), AMOUNT_OUT, MAX_IN);
        q.recipient = address(executor);
        _expect(q, 5, abi.encodeWithSelector(IQuoteSettlement.RecipientIsTheExecutor.selector));
    }

    /// @dev And a recipient that is the PoolManager would be paying the venue, leaving the delta
    ///      accounting to describe money that never left.
    function test_Refuse_ARecipientThatIsThePoolManager() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("pmTo"), AMOUNT_OUT, MAX_IN);
        q.recipient = address(manager);
        _expect(q, 6, abi.encodeWithSelector(IQuoteSettlement.RecipientIsThePoolManager.selector));
    }

    function test_Refuse_AQuoteOfAnUnknownVersion() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("v9"), AMOUNT_OUT, MAX_IN);
        q.version = 9;
        _expect(q, 7, abi.encodeWithSelector(IQuoteSettlement.UnknownQuoteVersion.selector, uint8(9)));
    }

    function test_Refuse_AQuoteAddressedToAnotherExecutor() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("otherEx"), AMOUNT_OUT, MAX_IN);
        q.executor = address(0xBEEF);
        _expect(
            q,
            8,
            abi.encodeWithSelector(IQuoteSettlement.NotTheQuotedExecutor.selector, address(executor), address(0xBEEF))
        );
    }

    /// @dev The quote names a hook and also names a pool that carries a hook. If those two can
    ///      disagree, the field a verifier reads is not the contract that runs.
    function test_Refuse_AQuoteWhoseHookIsNotThePoolsHook() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("otherHook"), AMOUNT_OUT, MAX_IN);
        q.hook = address(0xBEEF);
        _expect(q, 9, abi.encodeWithSelector(IQuoteSettlement.NotTheQuotedHook.selector, HOOK_ADDR, address(0xBEEF)));
    }

    /// @dev THE OTHER HALF OF THE MUTUAL BINDING. A real hook, a real pool, a real merchant
    ///      signature — and a hook bound to a different executor. Without this check a merchant
    ///      could name any venue and this contract would swap through it.
    function test_Refuse_AHookBoundToAnotherExecutor() public {
        QuoteSettlementExecutor other = new QuoteSettlementExecutor(manager, IPermit2Transfer(PERMIT2));
        address foreignHook = address(uint160(DECLARED_MASK) ^ (0x4444 << 144));
        deployCodeTo("QuoteSettlementHook.sol:QuoteSettlementHook", abi.encode(manager, address(other)), foreignHook);
        PoolKey memory foreignPool = PoolKey({
            currency0: Currency.wrap(address(tokenIn)),
            currency1: Currency.wrap(address(tokenOut)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(foreignHook)
        });
        manager.initialize(foreignPool, TickMath.getSqrtPriceAtTick(0));

        IQuoteSettlement.Quote memory q = _quote(bytes32("foreign"), AMOUNT_OUT, MAX_IN);
        q.pool = foreignPool;
        q.hook = foreignHook;
        _expect(
            q,
            10,
            abi.encodeWithSelector(IQuoteSettlement.HookIsNotBoundToThisExecutor.selector, foreignHook, address(other))
        );
    }

    /// @dev The quote's tokens must sit where its direction says they sit. Without this a quote
    ///      could name a pool of the right shape and move the wrong asset while every other check
    ///      agreed with itself.
    function test_Refuse_CurrenciesThatDoNotMatchTheDirection() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("swapped"), AMOUNT_OUT, MAX_IN);
        (q.tokenIn, q.tokenOut) = (q.tokenOut, q.tokenIn);
        _expect(
            q,
            11,
            abi.encodeWithSelector(
                IQuoteSettlement.CurrenciesDoNotMatchPool.selector, address(tokenIn), address(tokenOut)
            )
        );
    }

    // ---- the merchant's signature ----------------------------------------------------------------

    function test_Refuse_ASignatureFromSomebodyElse() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("wrongsig"), AMOUNT_OUT, MAX_IN);
        bytes memory notTheMerchant = _signQuoteAs(q, 0xDECAF);
        bytes memory err = _trySettleWith(q, notTheMerchant, _authorize(q, 12, block.timestamp + 1 hours, payerKey));
        _assertSelector(err, IQuoteSettlement.WrongMerchantSignature.selector, "a stranger's signature was accepted");
    }

    /// @dev Signed, then edited. Every security-relevant field is inside the digest, so this is the
    ///      row that says so: the amount is raised after signing and the signature no longer fits.
    function test_Refuse_AQuoteAlteredAfterSigning() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("altered"), AMOUNT_OUT, MAX_IN);
        bytes memory msig = _signQuoteAs(q, merchantKey);
        q.amountOut = AMOUNT_OUT * 2;
        bytes memory err = _trySettleWith(q, msig, _authorize(q, 13, block.timestamp + 1 hours, payerKey));
        _assertSelector(err, IQuoteSettlement.WrongMerchantSignature.selector, "an edited quote was accepted");
    }

    /// @dev Every field, one at a time. A field outside the digest is a field a relayer can change
    ///      on the way in, and enumerating them is the only way to know none was left out.
    function test_Refuse_EverySignedFieldIsInsideTheDigest() public view {
        IQuoteSettlement.Quote memory base = _quote(bytes32("fields"), AMOUNT_OUT, MAX_IN);
        bytes32 d = _quoteDigest(base);

        IQuoteSettlement.Quote memory m = base;
        m.version = 2;
        assertTrue(_quoteDigest(m) != d, "version is not in the digest");
        m = base;
        m.quoteId = bytes32("other");
        assertTrue(_quoteDigest(m) != d, "quoteId is not in the digest");
        m = base;
        m.merchantSigner = address(0xA1);
        assertTrue(_quoteDigest(m) != d, "merchantSigner is not in the digest");
        m = base;
        m.payer = address(0xA2);
        assertTrue(_quoteDigest(m) != d, "payer is not in the digest");
        m = base;
        m.recipient = address(0xA3);
        assertTrue(_quoteDigest(m) != d, "recipient is not in the digest");
        m = base;
        m.tokenIn = address(0xA4);
        assertTrue(_quoteDigest(m) != d, "tokenIn is not in the digest");
        m = base;
        m.maxIn = MAX_IN + 1;
        assertTrue(_quoteDigest(m) != d, "maxIn is not in the digest");
        m = base;
        m.tokenOut = address(0xA5);
        assertTrue(_quoteDigest(m) != d, "tokenOut is not in the digest");
        m = base;
        m.amountOut = AMOUNT_OUT + 1;
        assertTrue(_quoteDigest(m) != d, "amountOut is not in the digest");
        m = base;
        m.zeroForOne = false;
        assertTrue(_quoteDigest(m) != d, "zeroForOne is not in the digest");
        m = base;
        m.deadline = base.deadline + 1;
        assertTrue(_quoteDigest(m) != d, "deadline is not in the digest");
        m = base;
        m.hook = address(0xA6);
        assertTrue(_quoteDigest(m) != d, "hook is not in the digest");
        m = base;
        m.executor = address(0xA7);
        assertTrue(_quoteDigest(m) != d, "executor is not in the digest");
        m = base;
        m.merchantConfigHash = keccak256("another merchant config");
        assertTrue(_quoteDigest(m) != d, "merchantConfigHash is not in the digest");
        m = base;
        m.policyVersion = 2;
        assertTrue(_quoteDigest(m) != d, "policyVersion is not in the digest");
        m = base;
        m.pool.fee = 500;
        assertTrue(_quoteDigest(m) != d, "the pool key is not in the digest");
    }

    // ---- replay ---------------------------------------------------------------------------------

    function test_Refuse_ASettledQuoteCannotBeSettledAgain() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("once"), AMOUNT_OUT, MAX_IN);
        assertEq(_trySettle(q, 20).length, 0, "the first settlement should succeed");

        // A fresh payer authorisation, so the refusal is the invoice's and not the nonce's.
        bytes memory err = _trySettleWith(q, _signQuoteAs(q, merchantKey), _authorize(q, 21, q.deadline, payerKey));
        _assertSelector(err, IQuoteSettlement.QuoteAlreadySettled.selector, "a settled invoice was settled again");
    }

    // ---- execution ------------------------------------------------------------------------------

    /// @dev The payer's ceiling, checked against what the swap really cost. Set just below it.
    function test_Refuse_ASwapThatCostsMoreThanTheSignedCeiling() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("ceiling"), AMOUNT_OUT, 1);
        bytes memory err = _trySettle(q, 30);
        _assertSelector(err, IQuoteSettlement.InputCeilingExceeded.selector, "the payer paid past their ceiling");
    }

    /// @dev The hook's refusal, seen from the executor's caller. It arrives wrapped in ERC-7751 and
    ///      is decoded rather than pattern-matched.
    function test_Refuse_AnInvoiceTheLiquidityCannotFill() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("toobig"), 1e30, type(uint128).max);
        bytes memory err = _trySettle(q, 31);
        assertHookRefusal(
            err,
            HOOK_ADDR,
            IHooks.afterSwap.selector,
            IQuoteSettlement.InvoiceNotFilled.selector,
            "an invoice larger than the pool can serve"
        );
    }

    // ---- the payer's authorisation ---------------------------------------------------------------

    function test_Refuse_AnExpiredPayerAuthorisation() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("permitold"), AMOUNT_OUT, MAX_IN);
        uint256 authDeadline = block.timestamp + 1;
        QuoteSettlementExecutor.PayerAuthorization memory auth = _authorize(q, 40, authDeadline, payerKey);
        vm.warp(authDeadline + 1);
        // The quote is still live; only the payer's authorisation has expired.
        q.deadline = block.timestamp + 1 hours;
        bytes memory err = _trySettleWith(q, _signQuoteAs(q, merchantKey), auth);
        _assertSelector(err, SignatureExpired.selector, "an expired payer authorisation was spent");
    }

    function test_Refuse_APayerAuthorisationForAnotherQuote() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("mine"), AMOUNT_OUT, MAX_IN);
        IQuoteSettlement.Quote memory other = _quote(bytes32("theirs"), AMOUNT_OUT, MAX_IN);
        QuoteSettlementExecutor.PayerAuthorization memory auth =
            _authorize(other, 41, block.timestamp + 1 hours, payerKey);
        bytes memory err = _trySettleWith(q, _signQuoteAs(q, merchantKey), auth);
        _assertSelector(err, InvalidSigner.selector, "an authorisation for another invoice was spent");
    }

    function test_Refuse_AnAuthorisationSignedByTheWrongPayer() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("notpayer"), AMOUNT_OUT, MAX_IN);
        QuoteSettlementExecutor.PayerAuthorization memory auth = _authorize(q, 42, block.timestamp + 1 hours, 0xDECAF);
        bytes memory err = _trySettleWith(q, _signQuoteAs(q, merchantKey), auth);
        _assertSelector(err, InvalidSigner.selector, "someone else authorised this payer's tokens");
    }

    function test_Refuse_AReusedPermit2Nonce() public {
        IQuoteSettlement.Quote memory q1 = _quote(bytes32("n1"), AMOUNT_OUT, MAX_IN);
        assertEq(_trySettle(q1, 50).length, 0, "the first settlement should succeed");

        IQuoteSettlement.Quote memory q2 = _quote(bytes32("n2"), AMOUNT_OUT, MAX_IN);
        bytes memory err = _trySettleWith(q2, _signQuoteAs(q2, merchantKey), _authorize(q2, 50, q2.deadline, payerKey));
        _assertSelector(err, InvalidNonce.selector, "a spent authorisation nonce was spent again");
    }

    // ---- the frame itself -------------------------------------------------------------------------

    function test_Refuse_AStrangerCallingTheUnlockCallback() public {
        vm.expectRevert(
            abi.encodeWithSelector(IQuoteSettlement.NotThePoolManager.selector, address(manager), address(this))
        );
        executor.unlockCallback("");
    }

    /// @dev Nothing above leaves anything behind. Every refusal is checked for a stale active
    ///      context AND for a receipt, because a receipt for a settlement that did not happen is
    ///      worse than no receipt at all.
    function test_Refuse_NoRefusalLeavesAContextOrAReceipt() public {
        IQuoteSettlement.Quote memory bad = _quote(bytes32("nothing"), AMOUNT_OUT, 1);
        vm.recordLogs();
        bytes memory err = _trySettle(bad, 60);
        assertGt(err.length, 0, "this row needs a refusal to observe");

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256(
            "QuoteSettled(bytes32,address,address,uint16,bytes32,address,address,bytes32,address,uint256,uint256,address,uint256,uint256,uint32)"
        );
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(
                logs[i].topics.length == 0 || logs[i].topics[0] != topic, "a refused settlement emitted a receipt"
            );
        }

        (bytes32 d, uint256 r, bytes32 p, bool z) = executor.activeQuote();
        assertEq(d, bytes32(0), "a refused settlement left a live digest");
        assertEq(r, 0, "a refused settlement left a required amount");
        assertEq(p, bytes32(0), "a refused settlement left a pool id");
        assertFalse(z, "a refused settlement left a direction");
        assertEq(executor.activePayer(), address(0), "a refused settlement left a payer");
        assertFalse(hook.consumed(_quoteDigest(bad)), "a refused settlement consumed the invoice");

        // and the very next settlement works, so the refusal poisoned nothing
        IQuoteSettlement.Quote memory good = _quote(bytes32("after"), AMOUNT_OUT, MAX_IN);
        assertEq(_trySettle(good, 61).length, 0, "a refusal left the executor unusable");
    }

    // ---- plumbing ----------------------------------------------------------------------------------

    function _trySettle(IQuoteSettlement.Quote memory q, uint256 nonce) internal returns (bytes memory) {
        return
            _trySettleWith(q, _signQuoteAs(q, merchantKey), _authorize(q, nonce, block.timestamp + 1 hours, payerKey));
    }

    function _trySettleWith(
        IQuoteSettlement.Quote memory q,
        bytes memory merchantSignature,
        QuoteSettlementExecutor.PayerAuthorization memory auth
    ) internal returns (bytes memory) {
        vm.prank(relayer);
        try executor.settle(q, merchantSignature, auth) returns (uint256, uint256) {
            return "";
        } catch (bytes memory err) {
            return err;
        }
    }

    /// @dev Asserts the WHOLE revert payload, arguments included. A selector alone would let
    ///      `InputCeilingExceeded(quoteId, 1, 999)` satisfy a row written for a different amount.
    function _expect(IQuoteSettlement.Quote memory q, uint256 nonce, bytes memory expected) internal {
        bytes memory err = _trySettle(q, nonce);
        assertGt(err.length, 0, "the settlement was accepted where a refusal was required");
        assertEq(keccak256(err), keccak256(expected), "refused, but not with the expected error and arguments");
    }

    function _assertSelector(bytes memory err, bytes4 expected, string memory why) internal {
        // >= 4, not > 4: `InvalidSigner()` and `InvalidNonce()` take no arguments and are
        // exactly four bytes. The first version of this helper demanded five and failed three
        // rows whose behaviour was correct — the harness was wrong, not the contract.
        assertGe(err.length, 4, "no revert data to read");
        assertEq(bytes4(err), expected, why);
    }
}
