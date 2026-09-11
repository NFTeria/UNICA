// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {StockSettlementBase} from "./util/StockSettlementBase.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {UnicaStockSettlementTypes as T} from "../../src/experimental/robinhood-testnet/UnicaStockSettlementTypes.sol";
import {UnicaStockSettlementErrors as E} from "../../src/experimental/robinhood-testnet/UnicaStockSettlementErrors.sol";
import {UnicaStockSettlementHook} from "../../src/experimental/robinhood-testnet/UnicaStockSettlementHook.sol";
import {UnicaStockSettlementExecutor} from "../../src/experimental/robinhood-testnet/UnicaStockSettlementExecutor.sol";
import {UnicaTestDollar, FalseReturnInput, NoReturnInput} from "./util/TestAssets.sol";

/// @title The checks the first suite could not tell apart, each now isolated
/// @notice EXPERIMENTAL, LOCAL ONLY. Batch B deleted each security check in turn and found five of
///         nine left the suite green (docs/experimental/BATCH-B-LOCAL-SETTLEMENT.md section 5). Two
///         things caused it, and every row here answers one of them:
///
///         1. A BARE `expectRevert()` ACCEPTS ANY REVERT. Where two checks guard one property, the
///            second fires when the first is deleted and a bare row stays green. Every row below
///            names the exact error it expects, with its arguments.
///         2. A HOOK'S REVERT NEVER REACHES THE PAYER UNCHANGED. The PoolManager wraps it in
///            `WrappedError(hook, callback, reason, HookCallFailed)`. So a hook refusal is asserted
///            by unwrapping that envelope and comparing the reason inside it, never by a selector
///            match on the outer bytes, which would be matching the PoolManager instead.
///
///         Each row was proven by the same method that found the gaps: its check deleted from the
///         source, the row seen to go red, the check restored.
contract StockSettlementGapsTest is StockSettlementBase {
    function setUp() public {
        _setUpTopology();
    }

    // ── helpers ───────────────────────────────────────────────────────────────────────────────

    /// @dev Pays `id` as the payer and returns the revert bytes. Fails the row if it did not revert.
    function _payExpectingRevert(UnicaStockSettlementExecutor x, bytes32 id) internal returns (bytes memory err) {
        vm.prank(payer);
        try x.pay(id) {
            fail("the payment settled where it had to be refused");
        } catch (bytes memory e) {
            err = e;
        }
    }

    /// @dev Opens the PoolManager's envelope and returns the hook's own reason. Asserts the envelope
    ///      really came from THIS hook's `afterSwap`, so a revert from anywhere else cannot pass.
    function _hookReason(bytes memory err) internal view returns (bytes memory reason) {
        assertEq(bytes4(err), CustomRevert.WrappedError.selector, "not a wrapped hook revert");
        bytes memory body = new bytes(err.length - 4);
        for (uint256 i = 0; i < body.length; i++) {
            body[i] = err[i + 4];
        }
        (address target, bytes4 callback, bytes memory inner, bytes memory details) =
            abi.decode(body, (address, bytes4, bytes, bytes));
        assertEq(target, address(hook), "the refusal came from somewhere other than the hook");
        assertEq(callback, IHooks.afterSwap.selector, "the refusal came from a callback other than afterSwap");
        assertEq(details, abi.encodeWithSelector(Hooks.HookCallFailed.selector), "unexpected envelope details");
        reason = inner;
    }

    /// @dev What this pool delivers for `amountIn` right now, measured by settling it and rolling
    ///      back. A measured quote rather than a computed one: re-deriving the pool's arithmetic in
    ///      the test would test the arithmetic against itself.
    function _measure(uint128 amountIn, bytes32 salt) internal returns (uint256 delivered) {
        uint256 snap = vm.snapshotState();
        bytes32 id = _createOrder(amountIn, 1, uint64(block.timestamp + 1 hours), address(0), salt);
        uint256 before_ = dollar.balanceOf(merchant);
        vm.prank(payer);
        executor.pay(id);
        delivered = dollar.balanceOf(merchant) - before_;
        vm.revertToState(snap);
        assertGt(delivered, 0, "control: the measured settlement delivered nothing");
    }

    // ── B: the hook's PartialFill ─────────────────────────────────────────────────────────────

    /// @dev The first suite never drove a partial fill: at its sizes the pool always filled. Here the
    ///      order asks for more than the position can absorb — liquidity 1e18 across [-60000, 60000]
    ///      takes roughly 1.9e19 raw before the price leaves the range — so the swap stops short.
    ///      Delete PartialFill and the payment still fails, but on the PoolManager's
    ///      CurrencyNotSettled instead: the executor settled the full input against a smaller debt.
    function test_G1_a_partial_fill_is_refused_by_the_hook_by_name() public {
        uint128 amountIn = 100e18;
        bytes32 id = _createOrder(amountIn, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("g1"));
        bytes memory reason = _hookReason(_payExpectingRevert(executor, id));

        assertEq(bytes4(reason), E.PartialFill.selector, "refused, but not for a partial fill");
        bytes memory args = new bytes(reason.length - 4);
        for (uint256 i = 0; i < args.length; i++) {
            args[i] = reason[i + 4];
        }
        (bytes32 gotId, uint128 requested, uint128 consumed) = abi.decode(args, (bytes32, uint128, uint128));
        assertEq(gotId, id, "order id");
        assertEq(requested, amountIn, "requested");
        assertLt(consumed, amountIn, "a partial fill consumes less than was requested");
        assertEq(uint8(executor.orders(id).status), uint8(T.Status.Open), "a refused order stays open");
    }

    // ── C: the hook's OutputBelowMinimum, isolated from the executor's RecipientShort ─────────

    /// @dev The hook's delta check and the executor's balance check both catch an underpayment, which
    ///      is why deleting either left the first suite green. Here only the RIGHT one may answer: the
    ///      pool itself produces one unit less than the floor, so the hook refuses inside the swap.
    ///      Delete the hook's check and the executor's RecipientShort answers instead — a different,
    ///      unwrapped error, so this row goes red.
    function test_G2_an_output_below_the_floor_is_refused_by_the_hook_by_name() public {
        uint256 delivered = _measure(1e18, bytes32("g2"));
        uint128 minOut = uint128(delivered) + 1;
        bytes32 id = _createOrder(1e18, minOut, uint64(block.timestamp + 1 hours), address(0), bytes32("g2"));

        bytes memory reason = _hookReason(_payExpectingRevert(executor, id));
        assertEq(
            reason,
            abi.encodeWithSelector(E.OutputBelowMinimum.selector, id, minOut, uint128(delivered)),
            "refused, but not by the hook's floor, or with the wrong figures"
        );
    }

    // ── D: the executor's RecipientShort, isolated from the hook ──────────────────────────────

    /// @dev The case only the executor can see. The pool pays in full — its delta meets the floor, so
    ///      the hook is satisfied — but the payout token delivers 1% less than it was told to move.
    ///      The merchant's own balance is the only witness. Delete RecipientShort and this settles
    ///      short, silently.
    function test_G3_a_payout_token_that_delivers_short_is_refused_by_the_executor() public {
        uint256 delivered = _measure(1e18, bytes32("g3"));
        uint128 minOut = uint128(delivered);
        bytes32 id = _createOrder(1e18, minOut, uint64(block.timestamp + 1 hours), address(0), bytes32("g3"));
        dollar.setDeliveryFeeBps(100);

        bytes memory err = _payExpectingRevert(executor, id);
        uint256 arrived = delivered - (delivered * 100) / 10_000;
        assertEq(
            err,
            abi.encodeWithSelector(E.RecipientShort.selector, id, minOut, arrived),
            "refused, but not by the executor's delivery measurement"
        );
    }

    /// @dev The control for G3: the identical order, with the token delivering in full, settles.
    function test_G3c_control_the_same_order_settles_when_delivery_is_whole() public {
        uint256 delivered = _measure(1e18, bytes32("g3c"));
        bytes32 id =
            _createOrder(1e18, uint128(delivered), uint64(block.timestamp + 1 hours), address(0), bytes32("g3c"));
        vm.prank(payer);
        executor.pay(id);
        assertEq(uint8(executor.orders(id).status), uint8(T.Status.Settled), "control did not settle");
    }

    // ── E: the executor's reentrancy latch, where it is the only defence ─────────────────────

    /// @dev The first suite re-entered from the PAYOUT token, inside the PoolManager's lock — where
    ///      the PoolManager's own AlreadyUnlocked refuses a second settlement whether or not the latch
    ///      exists. That row could not tell. This one re-enters from the INPUT token's transferFrom,
    ///      BEFORE `pay` has taken the lock. There, nothing but the latch stands in the way.
    ///
    ///      With the latch: the inner call is refused as Reentered, and the outer payment settles.
    ///      Without it: the inner payment settles completely inside the outer one, the outer then
    ///      counts two receipts where it expected one, and the whole payment reverts on NoReceipt. So
    ///      deleting the latch turns a payment that should succeed into one that cannot.
    function test_G4_an_input_token_re_entering_before_the_lock_is_refused_by_the_latch() public {
        bytes32 first = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("g4a"));
        bytes32 second = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("g4b"));

        // Arm the token as a payer in its own right, so the inner call fails on the latch and on
        // nothing else: it holds input, and it has approved the executor.
        stock.mint(address(stock), 10e18);
        vm.prank(address(stock));
        stock.approve(address(executor), type(uint256).max);
        stock.armReentry(address(executor), abi.encodeWithSignature("pay(bytes32)", second));

        vm.prank(payer);
        executor.pay(first);

        assertEq(stock.lastReentryRevert(), abi.encodeWithSelector(E.Reentered.selector), "not refused by the latch");
        assertEq(uint8(executor.orders(first).status), uint8(T.Status.Settled), "the outer payment must settle");
        assertEq(uint8(executor.orders(second).status), uint8(T.Status.Open), "the inner order must be untouched");
        assertEq(hook.receiptCount(), 1, "exactly one receipt");
    }

    // ── I and its twin: nothing may be left behind in the executor ────────────────────────────

    /// @dev No first-suite row ever produced a residual, so the check was never exercised. Here the
    ///      payout token, during the merchant's `take`, slips one raw unit of the INPUT token into the
    ///      executor. The settlement itself is otherwise perfect; only the residual check notices.
    function test_G5_input_left_in_the_executor_is_refused_by_name() public {
        bytes32 id = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("g5"));
        stock.mint(address(dollar), 1);
        dollar.armReentry(address(stock), abi.encodeWithSignature("transfer(address,uint256)", address(executor), 1));

        bytes memory err = _payExpectingRevert(executor, id);
        assertEq(err, abi.encodeWithSelector(E.ExecutorResidualInput.selector, 0, 1), "not the residual-input check");
    }

    /// @dev The same, for the payout side, which Batch B's table did not list but the code does hold.
    function test_G6_payout_left_in_the_executor_is_refused_by_name() public {
        bytes32 id = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("g6"));
        dollar.mint(address(dollar), 1);
        dollar.armReentry(address(dollar), abi.encodeWithSignature("transfer(address,uint256)", address(executor), 1));

        bytes memory err = _payExpectingRevert(executor, id);
        assertEq(err, abi.encodeWithSelector(E.ExecutorResidualPayout.selector, 0, 1), "not the residual-payout check");
    }

    // ── the executor's token calls, driven through the executor this time ─────────────────────

    /// @dev test_D4 in the first suite proved the FIXTURE returns false and never called the
    ///      executor. This row binds a separate executor to that token and pays through it. Delete the
    ///      false-return clause and the executor proceeds having moved nothing, to be caught one line
    ///      later by InputNotExact — a different error, so this row goes red.
    function test_G7_a_false_returning_input_is_refused_as_a_failed_transfer() public {
        FalseReturnInput bad = new FalseReturnInput();
        UnicaTestDollar payout = new UnicaTestDollar();
        (, UnicaStockSettlementExecutor x, PoolKey memory k) =
            _buildSideTopology(address(bad), address(payout), "unica.experimental.stock.hook.false-return");

        bad.mint(payer, 10e18);
        vm.prank(payer);
        bad.approve(address(x), type(uint256).max);
        vm.prank(merchant);
        bytes32 id = x.createOrder(merchant, k, 1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("g7"));

        bytes memory err = _payExpectingRevert(x, id);
        assertEq(
            err, abi.encodeWithSelector(E.TransferFailed.selector, address(bad)), "not refused as a failed transfer"
        );
    }

    /// @dev The opposite hazard. A token that returns NOTHING on success must be accepted, which is
    ///      why the executor distinguishes empty from false. Make the executor treat empty as failure
    ///      and this legitimate payment is refused, so this row goes red.
    function test_G8_an_empty_returning_input_settles() public {
        NoReturnInput quiet = new NoReturnInput();
        UnicaTestDollar payout = new UnicaTestDollar();
        (UnicaStockSettlementHook h, UnicaStockSettlementExecutor x, PoolKey memory k) =
            _buildSideTopology(address(quiet), address(payout), "unica.experimental.stock.hook.empty-return");

        quiet.mint(payer, 10e18);
        vm.prank(payer);
        quiet.approve(address(x), type(uint256).max);
        vm.prank(merchant);
        bytes32 id = x.createOrder(merchant, k, 1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("g8"));

        vm.prank(payer);
        x.pay(id);

        assertEq(uint8(x.orders(id).status), uint8(T.Status.Settled), "an empty-returning input did not settle");
        assertEq(quiet.balanceOf(payer), 9e18, "the payer's input did not fall by exactly the order's amount");
        assertGt(payout.balanceOf(merchant), 0, "the merchant received nothing");
        assertEq(h.receiptCount(), 1, "exactly one receipt on the side hook");
    }
}
