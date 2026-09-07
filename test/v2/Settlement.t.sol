// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {IQuoteSettlement} from "../../src/v2/interfaces/IQuoteSettlement.sol";
import {QuoteSettlementExecutor} from "../../src/v2/QuoteSettlementExecutor.sol";
import {SettlementFixture} from "./util/SettlementFixture.sol";

/// @title GATE 2 — the integrated path: a signed invoice becomes a paid merchant
/// @notice The hook proves the SWAP; this file is where the PAYMENT is proved. Every number below
///         is read from a real balance across a real settlement against the official PoolManager
///         and the official Permit2 runtime, both constructed at their canonical addresses.
contract SettlementTest is SettlementFixture {
    uint256 internal constant AMOUNT_OUT = 1e9;
    uint256 internal constant MAX_IN = 10 ether;

    function setUp() public {
        _setUpSettlement();
    }

    // ---- the two derivations of the merchant's digest ----------------------------------------

    /// @dev The executor's hash and the test's hash are written from the same type string in two
    ///      places. If either is edited alone this row fails, which is the whole reason the test
    ///      does not simply call `executor.hashQuote` and sign whatever comes back.
    function test_Settle_TheQuoteDigestIsDerivedTheSameWayTwice() public view {
        IQuoteSettlement.Quote memory q = _quote(bytes32("q1"), AMOUNT_OUT, MAX_IN);
        assertEq(executor.hashQuote(q), _localHashQuote(q), "the struct hashes disagree");
        assertEq(executor.DOMAIN_SEPARATOR(), _localDomain(), "the domains disagree");
        assertEq(executor.paymentWitness(q), _witness(q), "the payer witnesses disagree");
        assertEq(executor.paymentWitnessTypeString(), _witnessTypeString(), "the witness type strings disagree");
    }

    // ---- THE HAPPY PATH ------------------------------------------------------------------------

    function test_Settle_TheMerchantIsPaidExactlyAndNobodyElseHoldsAnything() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("q1"), AMOUNT_OUT, MAX_IN);
        bytes memory msig = _signQuoteAs(q, merchantKey);
        QuoteSettlementExecutor.PayerAuthorization memory auth = _authorize(q, 0, block.timestamp + 1 hours, payerKey);

        uint256 merchantBefore = tokenOut.balanceOf(recipient);
        uint256 payerBefore = tokenIn.balanceOf(payer);
        uint256 managerInBefore = tokenIn.balanceOf(address(manager));

        vm.recordLogs();
        vm.prank(relayer); // a third party submits; both signatures are already in hand
        (uint256 actualIn, uint256 deliveredOut) = executor.settle(q, msig, auth);

        assertEq(tokenOut.balanceOf(recipient) - merchantBefore, AMOUNT_OUT, "the merchant was not paid exactly");
        assertEq(deliveredOut, AMOUNT_OUT, "the reported delivery is not the invoice");
        assertEq(payerBefore - tokenIn.balanceOf(payer), actualIn, "the payer was debited a different amount");
        assertLe(actualIn, MAX_IN, "the payer paid more than the signed ceiling");
        assertGt(actualIn, 0, "the swap cost nothing, so this proves nothing");
        assertEq(
            tokenIn.balanceOf(address(manager)) - managerInBefore,
            actualIn,
            "the payer's input did not land in the PoolManager"
        );

        // NO CUSTODY, measured on the executor rather than argued from a diagram.
        assertEq(tokenIn.balanceOf(address(executor)), 0, "the executor held the payer's token");
        assertEq(tokenOut.balanceOf(address(executor)), 0, "the executor held the merchant's token");

        assertTrue(hook.consumed(_quoteDigest(q)), "the invoice was not consumed");
        _assertExactlyOneReceipt(q, actualIn, deliveredOut);

        // and no context survives a success
        (bytes32 d, uint256 r, bytes32 p, bool z) = executor.activeQuote();
        assertEq(d, bytes32(0), "a digest survived the settlement");
        assertEq(r, 0, "a required amount survived the settlement");
        assertEq(p, bytes32(0), "a pool id survived the settlement");
        assertFalse(z, "a direction survived the settlement");
        assertEq(executor.activePayer(), address(0), "a payer survived the settlement");
    }

    /// @dev The receipt, decoded from the log rather than matched against a template. Asserting the
    ///      COUNT matters as much as the fields: "exactly one" is the claim, and a second receipt
    ///      for the same settlement would be indistinguishable from a second settlement.
    function _assertExactlyOneReceipt(IQuoteSettlement.Quote memory q, uint256 actualIn, uint256 deliveredOut)
        internal
        view
    {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256(
            "QuoteSettled(bytes32,address,address,uint16,bytes32,address,address,bytes32,address,uint256,uint256,address,uint256,uint256,uint32)"
        );
        uint256 count;
        uint256 which;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == topic) {
                count++;
                which = i;
                assertEq(logs[i].emitter, address(executor), "the receipt was emitted by something else");
            }
        }
        assertEq(count, 1, "a settlement must emit exactly one receipt");

        assertEq(logs[which].topics[1], q.quoteId, "receipt: quoteId");
        assertEq(address(uint160(uint256(logs[which].topics[2]))), q.recipient, "receipt: recipient");
        assertEq(address(uint160(uint256(logs[which].topics[3]))), q.payer, "receipt: payer");

        ReceiptData memory r = abi.decode(logs[which].data, (ReceiptData));

        assertEq(r.schemaVersion, executor.RECEIPT_SCHEMA_VERSION(), "receipt: schema version");
        assertEq(r.quoteDigest, _quoteDigest(q), "receipt: the digest is not what the merchant signed");
        assertEq(r.merchantSigner, q.merchantSigner, "receipt: merchant signer");
        assertEq(r.hook, q.hook, "receipt: hook");
        assertEq(r.poolId, _poolId(q), "receipt: pool id");
        assertEq(r.tokenIn, q.tokenIn, "receipt: tokenIn");
        assertEq(r.actualIn, actualIn, "receipt: actualIn disagrees with the returned value");
        assertEq(r.maxIn, q.maxIn, "receipt: maxIn");
        assertEq(r.tokenOut, q.tokenOut, "receipt: tokenOut");
        assertEq(r.amountOut, q.amountOut, "receipt: amountOut");
        assertEq(r.deliveredOut, deliveredOut, "receipt: deliveredOut");
        assertEq(r.policyVersion, q.policyVersion, "receipt: policy version");
    }

    /// @dev The receipt's non-indexed half, as a struct. Decoding a twelve-element tuple into
    ///      locals does not fit the stack with the IR pipeline off, and the pipeline stays off
    ///      because turning it on would change the bytecode of the V1 hook whose deployed address
    ///      was mined against these exact settings.
    struct ReceiptData {
        uint16 schemaVersion;
        bytes32 quoteDigest;
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
}
