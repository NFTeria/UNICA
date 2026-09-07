// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IQuoteSettlement} from "../../src/v2/interfaces/IQuoteSettlement.sol";
import {MisbehavingToken} from "../v2/util/SettlementFixture.sol";
import {V2ForkFixture} from "./util/V2ForkFixture.sol";

/// @title FORK — the two checks that need the PAYER's token to misbehave
/// @notice The output-side gaps were closed in `V2ForkHostileToken`. These are the input-side ones:
///         the PoolManager credit comparison and the no-custody check on the input. Both compare
///         two numbers that agree by construction unless something quietly moves tokens during the
///         pull, so the payer's currency is a token this suite deploys and arms. The merchant's
///         payout currency stays real USDC, and so do the PoolManager, Permit2 and the CREATE2
///         deployer.
contract V2ForkHostileInputTest is V2ForkFixture {
    uint256 internal constant AMOUNT_OUT = 100e6;
    uint256 internal constant MAX_IN = 1e18;

    MisbehavingToken internal hostile;

    /// @dev The payer's currency must be currency1, so the deployed token has to sort ABOVE USDC.
    function _poolCurrencies() internal override returns (address, address) {
        hostile = new MisbehavingToken("Hostile Ether", "hETH", 18);
        while (address(hostile) < USDC) {
            hostile = new MisbehavingToken("Hostile Ether", "hETH", 18);
        }
        return (USDC, address(hostile));
    }

    function setUp() public {
        _setUpForkV2();
        assertEq(inputCurrency, address(hostile), "this suite needs the hostile token as the payer's input");
        assertEq(payoutCurrency, USDC, "the merchant's payout must stay a real token");
    }

    function test_ForkI_Control_AnHonestPullStillSettles() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("i-ok"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        (uint256 actualIn,) = executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 0));
        assertGt(actualIn, 0, "the control cost nothing, so it proves nothing");
        assertEq(IERC20(USDC).balanceOf(recipient), AMOUNT_OUT, "the control merchant was not paid");
    }

    /// @dev An extra unit lands in the PoolManager during the Permit2 pull. The swap said one number
    ///      was owed and `settle()` credits another; the executor refuses rather than letting a
    ///      stray credit be absorbed into this settlement's accounting.
    function test_ForkI_ATokenThatOverpaysTheVenueIsRefused() public {
        hostile.arm(MisbehavingToken.Mode.DonateToVictimOnPull, POOL_MANAGER, address(0));

        IQuoteSettlement.Quote memory q = _quote(bytes32("i-over"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        try executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 1)) returns (uint256, uint256) {
            fail();
        } catch (bytes memory err) {
            assertEq(
                bytes4(err), IQuoteSettlement.SettlementDidNotClose.selector, "refused, but not by the credit check"
            );
            (uint256 owed, uint256 credited) = abi.decode(_body(err), (uint256, uint256));
            assertEq(credited, owed + 1, "the donation was not the difference the executor saw");
            emit log_named_uint("the swap said was owed", owed);
            emit log_named_uint("the manager credited  ", credited);
        }
        assertEq(IERC20(USDC).balanceOf(recipient), 0, "a refused settlement paid the merchant");
    }

    /// @dev And an extra unit landing on the EXECUTOR during the pull. Everything else is correct —
    ///      the merchant is paid exactly, the venue credited exactly — and the only thing wrong is
    ///      that the conduit is holding the payer's asset.
    function test_ForkI_ATokenThatQuietlyPaysTheExecutorIsRefused() public {
        hostile.arm(MisbehavingToken.Mode.DonateToBeneficiaryOnPull, POOL_MANAGER, address(executor));

        IQuoteSettlement.Quote memory q = _quote(bytes32("i-skim"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(IQuoteSettlement.ExecutorHeldTheInput.selector, uint256(0), uint256(1)));
        executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 2));

        assertEq(IERC20(inputCurrency).balanceOf(address(executor)), 0, "the donation survived the refusal");
        assertEq(IERC20(USDC).balanceOf(recipient), 0, "a refused settlement paid the merchant");
    }

    function _body(bytes memory err) internal pure returns (bytes memory out) {
        out = new bytes(err.length - 4);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = err[i + 4];
        }
    }
}
