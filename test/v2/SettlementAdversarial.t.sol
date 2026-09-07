// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IQuoteSettlement} from "../../src/v2/interfaces/IQuoteSettlement.sol";
import {QuoteSettlementExecutor} from "../../src/v2/QuoteSettlementExecutor.sol";
import {SettlementFixture, MisbehavingToken} from "./util/SettlementFixture.sol";

/// @title GATE 3 — the adversarial rows: a hostile output token, from both directions
/// @notice Two claims are under attack here. "The merchant receives exactly amountOut" is attacked
///         by a token that delivers less than it was told to. "One settlement at a time" is
///         attacked by a token that calls back into the executor during delivery — which is a real
///         reentrancy surface, because `take` transfers the output while the PoolManager's unlock
///         is still open.
contract SettlementAdversarialTest is SettlementFixture {
    uint256 internal constant AMOUNT_OUT = 1e9;
    uint256 internal constant MAX_IN = 10 ether;

    MisbehavingToken internal hostile;

    function _deployTokens() internal override returns (MockERC20 a, MockERC20 b) {
        a = new MockERC20("In", "IN", 18);
        hostile = new MisbehavingToken("Out", "OUT", 6);
        // The fixture sorts, but this suite needs the HOSTILE token to be the output, so it has to
        // sort above the input. Redeploy until it does: each deployment takes the next nonce.
        while (address(hostile) < address(a)) {
            hostile = new MisbehavingToken("Out", "OUT", 6);
        }
        b = MockERC20(address(hostile));
    }

    function setUp() public {
        _setUpSettlement();
        assertEq(address(tokenOut), address(hostile), "this suite needs the hostile token as the output");
    }

    /// @dev THE CONTROL. While the token behaves, the settlement behaves. Without this row the two
    ///      below could pass because the fixture was broken rather than because the guards work.
    function test_Adv_Control_AnHonestDeliveryStillSettles() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("honest"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        (, uint256 delivered) = executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 0));
        assertEq(delivered, AMOUNT_OUT, "the control settlement did not deliver the invoice");
        assertEq(tokenOut.balanceOf(recipient), AMOUNT_OUT, "the control merchant was not paid");
    }

    /// @dev A token that skims ONE UNIT on delivery. The PoolManager's accounting is satisfied —
    ///      it transferred what it owed — and every delta closes. Only a balance read on the
    ///      merchant's own address can see it, which is why the check is written that way and not
    ///      as a comparison of the numbers this contract already had.
    function test_Adv_ATokenThatSkimsOnDeliveryIsRefused() public {
        hostile.arm(MisbehavingToken.Mode.SkimOnDelivery, recipient, address(0));

        IQuoteSettlement.Quote memory q = _quote(bytes32("skim"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(
                IQuoteSettlement.MerchantNotPaidExactly.selector, q.quoteId, AMOUNT_OUT, AMOUNT_OUT - 1
            )
        );
        executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 1));

        assertEq(tokenOut.balanceOf(recipient), 0, "a refused settlement paid the merchant anyway");
        emit log_string("UNICA refuses an output token whose transfer cannot carry the word 'exactly'.");
        emit log_string("The alternative was to weaken the promise to 'at least', which is a different promise.");
    }

    /// @dev The reentrancy surface that actually exists: `take` transfers the output to the
    ///      merchant while the PoolManager's unlock is still open and the active invoice is still
    ///      live. A token that calls back gets the guard, not the context.
    function test_Adv_ATokenThatReentersDuringDeliveryIsRefused() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("reenter"), AMOUNT_OUT, MAX_IN);
        IQuoteSettlement.Quote memory second = _quote(bytes32("reenter2"), AMOUNT_OUT, MAX_IN);

        hostile.arm(MisbehavingToken.Mode.ReenterOnDelivery, recipient, address(0));
        hostile.armReentry(
            address(executor),
            abi.encodeCall(
                QuoteSettlementExecutor.settle, (second, _signQuoteAs(second, merchantKey), _auth(second, 9))
            )
        );

        vm.prank(relayer);
        (, uint256 delivered) = executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 2));

        assertTrue(hostile.reentryAttempted(), "the token never tried to reenter, so this proves nothing");
        assertFalse(hostile.reentrySucceeded(), "a second settlement ran inside the first one");
        bytes memory reason = hostile.lastReentryRevert();
        assertGe(reason.length, 4, "the reentrant call left no reason to read");
        assertEq(
            bytes4(reason),
            IQuoteSettlement.SettlementAlreadyInProgress.selector,
            "the reentrant settlement was refused, but not by the active-context guard"
        );

        // The outer settlement is unharmed, and the merchant is paid once.
        assertEq(delivered, AMOUNT_OUT, "the outer settlement did not complete");
        assertEq(tokenOut.balanceOf(recipient), AMOUNT_OUT, "the merchant was paid twice, or not at all");
        assertTrue(hook.consumed(_quoteDigest(q)), "the outer invoice was not consumed");
        assertFalse(hook.consumed(_quoteDigest(second)), "the reentrant invoice was consumed");
    }

    /// @dev And the context the reentrant call SAW was the outer one, live. That is exactly what a
    ///      borrowed context would be: readable, correct, and belonging to somebody else — so the
    ///      guard above is not refusing an empty context, it is refusing a real one that is not the
    ///      caller's. The first version of this row had the peeker revert after recording, which
    ///      rolled back its own recording and read zeros; it now returns normally and the token
    ///      tolerates a reentrant call that succeeds, because whether it succeeds is the assertion
    ///      and not a precondition of the harness.
    function test_Adv_TheContextTheReentrantCallSeesIsTheOuterOne() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("peek"), AMOUNT_OUT, MAX_IN);
        Peeker peeker = new Peeker(address(executor));

        hostile.arm(MisbehavingToken.Mode.ReenterOnDelivery, recipient, address(0));
        hostile.armReentry(address(peeker), abi.encodeCall(Peeker.peek, ()));

        vm.prank(relayer);
        executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 3));

        assertEq(peeker.seenDigest(), _quoteDigest(q), "the live context was not the outer invoice");
        assertEq(peeker.seenRequiredOut(), AMOUNT_OUT, "the live required amount was not the outer one");
        assertEq(peeker.seenPayer(), payer, "the live payer was not the outer one");
    }

    /// @dev A token that quietly pays the EXECUTOR a unit while delivering to the merchant. The
    ///      merchant is paid exactly, every delta closes, and the only thing wrong is that the
    ///      conduit is now holding something. Written because the mutation ledger showed that
    ///      deleting the no-custody checks turned no row red: nothing in the suite could make the
    ///      executor hold anything, so "no custody" was an unfalsifiable sentence.
    function test_Adv_ATokenThatQuietlyPaysTheExecutorIsRefused() public {
        hostile.arm(MisbehavingToken.Mode.DonateToBeneficiaryOnDelivery, recipient, address(executor));

        IQuoteSettlement.Quote memory q = _quote(bytes32("donate"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(IQuoteSettlement.ExecutorHeldTheOutput.selector, uint256(0), uint256(1)));
        executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 4));

        assertEq(tokenOut.balanceOf(recipient), 0, "a refused settlement paid the merchant anyway");
        assertEq(tokenOut.balanceOf(address(executor)), 0, "the donation survived the refusal");
    }

    function _auth(IQuoteSettlement.Quote memory q, uint256 nonce)
        internal
        view
        returns (QuoteSettlementExecutor.PayerAuthorization memory)
    {
        return _authorize(q, nonce, block.timestamp + 1 hours, payerKey);
    }
}

/// @dev Reads the live context and then fails, so the token's `require(!ok)` is satisfied and the
///      outer settlement survives to be inspected.
contract Peeker {
    QuoteSettlementExecutor internal immutable EXECUTOR;
    bytes32 public seenDigest;
    uint256 public seenRequiredOut;
    address public seenPayer;

    constructor(address executor_) {
        EXECUTOR = QuoteSettlementExecutor(executor_);
    }

    function peek() external {
        (bytes32 d, uint256 r,,) = EXECUTOR.activeQuote();
        seenDigest = d;
        seenRequiredOut = r;
        seenPayer = EXECUTOR.activePayer();
    }
}
