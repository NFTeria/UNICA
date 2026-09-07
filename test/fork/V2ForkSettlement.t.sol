// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IQuoteSettlement} from "../../src/v2/interfaces/IQuoteSettlement.sol";
import {V2ForkFixture} from "./util/V2ForkFixture.sol";

/// @title FORK LAYERS C AND D — the V2 installation, and one real settlement through it
/// @notice FORK-LOCAL TEST SETUP. NOTHING WAS BROADCAST TO SEPOLIA. The hook and executor exist
///         only inside the fork. Everything they talk to is real and pinned: the official
///         PoolManager, the official Permit2, Circle's USDC proxy, canonical WETH9.
contract V2ForkSettlementTest is V2ForkFixture {
    /// @dev 100 USDC, six decimals. The merchant is paid in currency0, so the swap is one-for-zero.
    uint256 internal constant AMOUNT_OUT = 100e6;
    uint256 internal constant MAX_IN = 1e18;

    function setUp() public {
        _setUpForkV2();
    }

    // ---- C: the installation itself ----------------------------------------------------------

    function test_ForkC_TheHookAddressWasMinedAndDeployedThroughTheCanonicalDeployer() public {
        emit log_named_address("fork-local hook    ", address(hook));
        emit log_named_address("fork-local executor", address(executor));
        emit log_named_bytes32("mined salt         ", minedSalt);
        emit log_named_uint("hook runtime bytes  ", address(hook).code.length);
        emit log_named_int("initial tick        ", initialTick);
        emit log_named_uint("seeded USDC (6dp)   ", seededUsdc);
        emit log_named_uint("seeded WETH (18dp)  ", seededWeth);

        assertGt(address(hook).code.length, 0, "the mined hook has no code");
        assertEq(hook.EXECUTOR(), address(executor), "the hook is not bound to this executor");
        assertEq(address(executor.POOL_MANAGER()), POOL_MANAGER, "the executor names another PoolManager");
        assertEq(address(executor.PERMIT2()), PERMIT2, "the executor names another Permit2");
        assertGt(seededUsdc, 0, "no USDC was seeded, so no exact-output case is possible");
        assertGt(seededWeth, 0, "no WETH was seeded");
    }

    // ---- D: the integrated path ---------------------------------------------------------------

    function test_ForkD_AMerchantIsPaidExactlyThroughTheOfficialStack() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("fork-1"), AMOUNT_OUT, MAX_IN);

        uint256 merchantBefore = IERC20(USDC).balanceOf(recipient);
        uint256 payerBefore = IERC20(WETH9).balanceOf(payer);
        uint256 managerWethBefore = IERC20(WETH9).balanceOf(POOL_MANAGER);

        vm.recordLogs();
        vm.prank(relayer);
        (uint256 actualIn, uint256 deliveredOut) = executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 0));

        emit log_named_uint("merchant received (USDC, 6dp)", IERC20(USDC).balanceOf(recipient) - merchantBefore);
        emit log_named_uint("payer paid (WETH wei)        ", payerBefore - IERC20(WETH9).balanceOf(payer));
        emit log_named_uint("ceiling the payer signed     ", MAX_IN);

        assertEq(IERC20(USDC).balanceOf(recipient) - merchantBefore, AMOUNT_OUT, "the merchant was not paid exactly");
        assertEq(deliveredOut, AMOUNT_OUT, "the reported delivery is not the invoice");
        assertEq(payerBefore - IERC20(WETH9).balanceOf(payer), actualIn, "the payer was debited a different amount");
        assertLe(actualIn, MAX_IN, "the payer paid more than the signed ceiling");
        assertGt(actualIn, 0, "the swap cost nothing, so this proves nothing");
        assertEq(
            IERC20(WETH9).balanceOf(POOL_MANAGER) - managerWethBefore,
            actualIn,
            "the payer's input did not land in the PoolManager"
        );

        assertEq(IERC20(WETH9).balanceOf(address(executor)), 0, "the executor held the payer's token");
        assertEq(IERC20(USDC).balanceOf(address(executor)), 0, "the executor held the merchant's token");

        assertTrue(hook.consumed(_quoteDigest(q)), "the invoice was not consumed");
        _assertExactlyOneReceipt();

        (bytes32 d,,,) = executor.activeQuote();
        assertEq(d, bytes32(0), "a context survived the settlement");
        assertEq(executor.activePayer(), address(0), "a payer survived the settlement");
    }

    /// @dev The same invoice, twice. The second attempt must change nothing at all.
    function test_ForkD_AReplayChangesNothing() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("fork-2"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 1));

        uint256 merchantAfterFirst = IERC20(USDC).balanceOf(recipient);
        uint256 payerAfterFirst = IERC20(WETH9).balanceOf(payer);

        vm.recordLogs();
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(IQuoteSettlement.QuoteAlreadySettled.selector, q.quoteId));
        executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 2));

        assertEq(IERC20(USDC).balanceOf(recipient), merchantAfterFirst, "a replay moved the merchant's balance");
        assertEq(IERC20(WETH9).balanceOf(payer), payerAfterFirst, "a replay moved the payer's balance");
        _assertNoReceipt();
    }

    // ---- receipts -----------------------------------------------------------------------------

    bytes32 internal constant RECEIPT_TOPIC = keccak256(
        "QuoteSettled(bytes32,address,address,uint16,bytes32,address,address,bytes32,address,uint256,uint256,address,uint256,uint256,uint32)"
    );

    function _assertExactlyOneReceipt() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 count;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == RECEIPT_TOPIC) {
                count++;
                assertEq(logs[i].emitter, address(executor), "the receipt was emitted by something else");
            }
        }
        assertEq(count, 1, "a settlement must emit exactly one receipt");
    }

    function _assertNoReceipt() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(
                logs[i].topics.length == 0 || logs[i].topics[0] != RECEIPT_TOPIC,
                "a refused settlement emitted a receipt"
            );
        }
    }
}
