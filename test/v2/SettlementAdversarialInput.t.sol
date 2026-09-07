// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IQuoteSettlement} from "../../src/v2/interfaces/IQuoteSettlement.sol";
import {QuoteSettlementExecutor} from "../../src/v2/QuoteSettlementExecutor.sol";
import {SettlementFixture, MisbehavingToken} from "./util/SettlementFixture.sol";

/// @title GATE 3 — a hostile INPUT token, and the two checks nothing else could reach
/// @notice The V2 mutation ledger is the reason this file exists. Deleting the PoolManager credit
///         comparison and the no-custody check on the input turned NO row red: in every scenario
///         the suite could build, those numbers agreed by construction, so two guards were
///         unfalsifiable sentences rather than checks. A token that quietly pays extra during the
///         pull is how they disagree, and it is a thing real tokens do — rebasing, rewards,
///         reflections, and any transfer hook with a mind of its own.
contract SettlementAdversarialInputTest is SettlementFixture {
    uint256 internal constant AMOUNT_OUT = 1e9;
    uint256 internal constant MAX_IN = 10 ether;

    MisbehavingToken internal hostile;

    function _deployTokens() internal override returns (MockERC20 a, MockERC20 b) {
        b = new MockERC20("Out", "OUT", 6);
        hostile = new MisbehavingToken("In", "IN", 18);
        // This suite needs the hostile token to be the INPUT, so it has to sort below the output.
        while (address(hostile) > address(b)) {
            hostile = new MisbehavingToken("In", "IN", 18);
        }
        a = MockERC20(address(hostile));
    }

    function setUp() public {
        _setUpSettlement();
        assertEq(address(tokenIn), address(hostile), "this suite needs the hostile token as the input");
    }

    /// @dev THE CONTROL. While the token behaves, the settlement behaves.
    function test_AdvIn_Control_AnHonestPullStillSettles() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("honest"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        (uint256 actualIn,) = executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 0));
        assertGt(actualIn, 0, "the control settlement cost nothing, so it proves nothing");
        assertEq(tokenOut.balanceOf(recipient), AMOUNT_OUT, "the control merchant was not paid");
    }

    /// @dev An extra unit lands in the PoolManager during the pull. The swap said one number was
    ///      owed and `settle()` credits another, and the executor refuses rather than letting a
    ///      stray credit be absorbed into this settlement's accounting.
    function test_AdvIn_ATokenThatOverpaysTheVenueIsRefused() public {
        hostile.arm(MisbehavingToken.Mode.DonateToVictimOnPull, address(manager), address(0));

        IQuoteSettlement.Quote memory q = _quote(bytes32("overpay"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        try executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 1)) returns (uint256, uint256) {
            fail();
            emit log_string("the PoolManager credited more than the swap said was owed and nothing objected");
        } catch (bytes memory err) {
            assertEq(
                bytes4(err),
                IQuoteSettlement.SettlementDidNotClose.selector,
                "refused, but not by the credit comparison"
            );
            (uint256 owed, uint256 credited) = abi.decode(_body(err), (uint256, uint256));
            assertEq(credited, owed + 1, "the donation was not the difference the executor saw");
            emit log_named_uint("the swap said was owed", owed);
            emit log_named_uint("the manager credited  ", credited);
        }
        assertEq(tokenOut.balanceOf(recipient), 0, "a refused settlement paid the merchant");
    }

    /// @dev And an extra unit landing on the EXECUTOR during the pull. Everything else is correct —
    ///      the merchant is paid exactly, the venue is credited exactly — and the only thing wrong
    ///      is that the conduit is holding the payer's asset.
    function test_AdvIn_ATokenThatQuietlyPaysTheExecutorIsRefused() public {
        hostile.arm(MisbehavingToken.Mode.DonateToBeneficiaryOnPull, address(manager), address(executor));

        IQuoteSettlement.Quote memory q = _quote(bytes32("skim-in"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(IQuoteSettlement.ExecutorHeldTheInput.selector, uint256(0), uint256(1)));
        executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 2));

        assertEq(tokenIn.balanceOf(address(executor)), 0, "the donation survived the refusal");
        assertEq(tokenOut.balanceOf(recipient), 0, "a refused settlement paid the merchant");
    }

    function _auth(IQuoteSettlement.Quote memory q, uint256 nonce)
        internal
        view
        returns (QuoteSettlementExecutor.PayerAuthorization memory)
    {
        return _authorize(q, nonce, block.timestamp + 1 hours, payerKey);
    }

    function _body(bytes memory err) internal pure returns (bytes memory out) {
        out = new bytes(err.length - 4);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = err[i + 4];
        }
    }
}
