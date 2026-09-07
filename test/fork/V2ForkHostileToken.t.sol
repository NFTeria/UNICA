// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IQuoteSettlement} from "../../src/v2/interfaces/IQuoteSettlement.sol";
import {MisbehavingToken} from "../v2/util/SettlementFixture.sol";
import {V2ForkFixture} from "./util/V2ForkFixture.sol";

/// @title FORK — the three checks real USDC and WETH cannot exercise
/// @notice `make fork-mutants` prints that four mutations are not covered on the fork, because each
///         needs two numbers to disagree and USDC and WETH behave. Three of them are closed here:
///         one currency of the pool is a token this suite deployed and can arm, and everything else
///         stays real — the official PoolManager, the official Permit2, canonical WETH9 as the
///         payer's input, and a hook mined and deployed through the canonical CREATE2 deployer.
contract V2ForkHostileTokenTest is V2ForkFixture {
    uint256 internal constant AMOUNT_OUT = 100e6;
    uint256 internal constant MAX_IN = 1e18;

    MisbehavingToken internal hostile;

    /// @dev The payout currency must be currency0, so the deployed token has to sort below WETH9.
    ///      Redeploy until it does: each deployment takes the next nonce.
    function _poolCurrencies() internal override returns (address, address) {
        hostile = new MisbehavingToken("Hostile USD", "hUSD", 6);
        while (address(hostile) > WETH9) {
            hostile = new MisbehavingToken("Hostile USD", "hUSD", 6);
        }
        return (address(hostile), WETH9);
    }

    function setUp() public {
        _setUpForkV2();
        assertEq(payoutCurrency, address(hostile), "this suite needs the hostile token as the payout");
        assertEq(inputCurrency, WETH9, "the payer's input must stay a real token");
    }

    /// @dev THE CONTROL. While the token behaves, the settlement behaves — against the real stack.
    function test_ForkH_Control_AnHonestPayoutTokenSettles() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("h-ok"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        (uint256 actualIn, uint256 delivered) = executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 0));
        assertEq(delivered, AMOUNT_OUT, "the control did not deliver the invoice");
        assertEq(IERC20(payoutCurrency).balanceOf(recipient), AMOUNT_OUT, "the control merchant was not paid");
        assertGt(actualIn, 0, "the control cost nothing, so it proves nothing");
    }

    /// @dev Kills M17: the merchant-delivery check. The token skims one unit on the way to the
    ///      merchant. Every PoolManager delta closes — it transferred what it owed — and only a
    ///      balance read on the merchant's own address can see it.
    function test_ForkH_ATokenThatSkimsOnDeliveryIsRefused() public {
        hostile.arm(MisbehavingToken.Mode.SkimOnDelivery, recipient, address(0));

        IQuoteSettlement.Quote memory q = _quote(bytes32("h-skim"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(
                IQuoteSettlement.MerchantNotPaidExactly.selector, q.quoteId, AMOUNT_OUT, AMOUNT_OUT - 1
            )
        );
        executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 1));

        assertEq(IERC20(payoutCurrency).balanceOf(recipient), 0, "a refused settlement paid the merchant");
        assertFalse(hook.consumed(_quoteDigest(q)), "a refused settlement consumed the invoice");
    }

    /// @dev Kills M29: the no-custody check on the OUTPUT. The merchant is paid exactly, every
    ///      delta closes, and the only thing wrong is that the conduit is holding something.
    function test_ForkH_ATokenThatQuietlyPaysTheExecutorIsRefused() public {
        hostile.arm(MisbehavingToken.Mode.DonateToBeneficiaryOnDelivery, recipient, address(executor));

        IQuoteSettlement.Quote memory q = _quote(bytes32("h-donate"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(IQuoteSettlement.ExecutorHeldTheOutput.selector, uint256(0), uint256(1)));
        executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 2));

        assertEq(IERC20(payoutCurrency).balanceOf(address(executor)), 0, "the donation survived the refusal");
        assertEq(IERC20(payoutCurrency).balanceOf(recipient), 0, "a refused settlement paid the merchant");
    }

    /// @dev Kills M20: the active-context guard, against the real PoolManager. `take` transfers the
    ///      output while the unlock is still open and the invoice is still live, so a token that
    ///      calls back gets the guard rather than the context.
    function test_ForkH_ATokenThatReentersDuringDeliveryIsRefused() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("h-re"), AMOUNT_OUT, MAX_IN);
        IQuoteSettlement.Quote memory second = _quote(bytes32("h-re2"), AMOUNT_OUT, MAX_IN);

        hostile.arm(MisbehavingToken.Mode.ReenterOnDelivery, recipient, address(0));
        hostile.armReentry(
            address(executor),
            abi.encodeCall(executor.settle, (second, _signQuoteAs(second, merchantKey), _auth(second, 9)))
        );

        vm.prank(relayer);
        (, uint256 delivered) = executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 3));

        assertTrue(hostile.reentryAttempted(), "the token never tried to reenter");
        assertFalse(hostile.reentrySucceeded(), "a second settlement ran inside the first");
        bytes memory reason = hostile.lastReentryRevert();
        assertGe(reason.length, 4, "the reentrant call left no reason to read");
        assertEq(
            bytes4(reason),
            IQuoteSettlement.SettlementAlreadyInProgress.selector,
            "refused, but not by the active-context guard"
        );

        assertEq(delivered, AMOUNT_OUT, "the outer settlement did not complete");
        assertEq(IERC20(payoutCurrency).balanceOf(recipient), AMOUNT_OUT, "the merchant was paid twice, or not at all");
        assertFalse(hook.consumed(_quoteDigest(second)), "the reentrant invoice was consumed");
    }
}
