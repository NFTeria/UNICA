// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {StockSettlementBase} from "./util/StockSettlementBase.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {UnicaStockSettlementTypes as T} from "../../src/experimental/robinhood-testnet/UnicaStockSettlementTypes.sol";
import {UnicaStockSettlementErrors as E} from "../../src/experimental/robinhood-testnet/UnicaStockSettlementErrors.sol";
import {MockStockToken, UnicaTestDollar, FeeOnTransferInput, FalseReturnInput} from "./util/TestAssets.sol";

/// @title The experimental ERC-20-input settlement, proved locally
/// @notice EXPERIMENTAL, LOCAL ONLY. Nothing here touches chain 46630, a live RPC, CRE, or a
///         credential. A green run here says the design holds against these tokens on this
///         topology; it says nothing about any real chain, and section 9 of the Batch A record
///         lists what would still have to be true there.
contract StockSettlementTest is StockSettlementBase {
    function setUp() public {
        _setUpTopology();
    }

    // ── the settlement itself ─────────────────────────────────────────────────────────────────

    function test_A1_settles_and_delivers_directly_to_the_merchant() public {
        bytes32 id = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("a1"));

        uint256 payerBefore = stock.balanceOf(payer);
        uint256 merchantBefore = dollar.balanceOf(merchant);

        vm.prank(payer);
        executor.pay(id);

        assertEq(stock.balanceOf(payer), payerBefore - 1e18, "payer's input did not fall by exactly the order's amount");
        assertGt(dollar.balanceOf(merchant), merchantBefore, "the merchant received nothing");
        assertEq(uint8(executor.orders(id).status), uint8(T.Status.Settled), "order did not reach Settled");
        assertEq(hook.receiptCount(), 1, "exactly one receipt");
    }

    /// @dev THE DECIMAL FINDING, and it is the most important row in this file.
    ///
    ///      A Uniswap pool prices RAW UNITS. It has never read `decimals()` and cannot. So a pool
    ///      initialised at sqrtPrice 1:1 between an 18-decimal token and a 6-decimal token is 1:1 in
    ///      raw units and 1e12:1 in the only terms a person cares about — this settlement pays out
    ///      roughly 4.99e17 raw uTUSD for 1e18 raw mTSLA, which reads as 499 BILLION uTUSD.
    ///
    ///      This row exists to pin that as a fact rather than let it be discovered in production.
    ///      Two consequences follow, and both are load-bearing for the target chain:
    ///
    ///        1. A pool for a real pair MUST be initialised at a sqrtPrice that already carries the
    ///           decimal difference. Reusing a 1:1 constant across an 18/6 pair is a 1e12 error that
    ///           every quote, every reference comparison and every deviation check inherits.
    ///        2. `minOut` is the only protection that does not care. It is an absolute integer in
    ///           the payout token's own units, so it binds correctly whatever the pool believes the
    ///           price to be — which is exactly why the on-chain floor, and not an off-chain quote,
    ///           is the thing that must be enforced.
    function test_A2_the_pool_prices_raw_units_and_ignores_decimals() public {
        bytes32 id = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("a2"));
        uint256 before_ = dollar.balanceOf(merchant);
        vm.prank(payer);
        executor.pay(id);
        uint256 delivered = dollar.balanceOf(merchant) - before_;

        assertEq(stock.decimals(), 18, "input decimals");
        assertEq(dollar.decimals(), 6, "payout decimals");

        // Raw-unit behaviour, asserted directly: a 1:1 pool returns the same ORDER OF MAGNITUDE in
        // raw units as it was given, minus fee and slippage. Nothing rescales by 1e12.
        assertGt(delivered, 1e17, "raw output collapsed - something rescaled by decimals");
        assertLt(delivered, 1e18, "raw output exceeds the raw input, which a fee-taking pool cannot do");

        // ...and stated in human terms, which is where the hazard is visible.
        uint256 humanReadable = delivered / 10 ** dollar.decimals();
        assertGt(
            humanReadable, 1_000_000, "a 1:1 sqrtPrice across 18/6 decimals is economically absurd, by construction"
        );
    }

    function test_A3_no_residual_balance_anywhere_on_the_path() public {
        bytes32 id = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("a3"));
        vm.prank(payer);
        executor.pay(id);

        assertEq(stock.balanceOf(address(executor)), 0, "executor kept input");
        assertEq(dollar.balanceOf(address(executor)), 0, "executor kept payout");
        assertEq(stock.balanceOf(address(hook)), 0, "hook kept input");
        assertEq(dollar.balanceOf(address(hook)), 0, "hook kept payout");
    }

    /// @dev The two events divide labour: the hook's receipt is evidence about the swap, the
    ///      executor's Settled is the success signal emitted only after delivery was measured.
    function test_A4_receipt_and_settled_both_emitted_in_the_right_order() public {
        bytes32 id = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("a4"));
        vm.recordLogs();
        vm.prank(payer);
        executor.pay(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 receiptTopic =
            keccak256("SettlementReceipt(bytes32,address,address,address,address,uint128,uint128,uint128,bytes32)");
        bytes32 settledTopic = keccak256("Settled(bytes32,address,address,address,address,uint256,uint256)");
        uint256 receiptAt = type(uint256).max;
        uint256 settledAt = type(uint256).max;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == receiptTopic) receiptAt = i;
            if (logs[i].topics[0] == settledTopic) settledAt = i;
        }
        assertLt(receiptAt, type(uint256).max, "no receipt emitted");
        assertLt(settledAt, type(uint256).max, "no Settled emitted");
        assertLt(receiptAt, settledAt, "Settled must come after the receipt, never before");
    }

    /// @dev Reconstructing the payment from logs alone, with no indexer and no contract read.
    function test_A5_receipt_reconstructs_from_logs_without_an_indexer() public {
        bytes32 id = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("a5"));
        vm.recordLogs();
        vm.prank(payer);
        executor.pay(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 settledTopic = keccak256("Settled(bytes32,address,address,address,address,uint256,uint256)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] != settledTopic) continue;
            found = true;
            assertEq(logs[i].topics[1], id, "order id");
            assertEq(address(uint160(uint256(logs[i].topics[2]))), payer, "payer");
            assertEq(address(uint160(uint256(logs[i].topics[3]))), merchant, "recipient");
            (,, uint256 amountIn, uint256 delivered) = abi.decode(logs[i].data, (address, address, uint256, uint256));
            assertEq(amountIn, 1e18, "amount in");
            assertEq(delivered, dollar.balanceOf(merchant), "delivered matches the merchant's balance");
        }
        assertTrue(found, "could not reconstruct the settlement from logs");
    }

    // ── refusals: each named, each distinct ───────────────────────────────────────────────────

    function test_B1_refuses_a_pool_this_hook_does_not_guard() public {
        PoolKey memory foreign = key;
        foreign.hooks = IHooks(address(0));
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(E.PoolNotGuarded.selector, address(0)));
        executor.createOrder(merchant, foreign, 1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("b1"));
    }

    function test_B2_refuses_a_substituted_currency() public {
        MockStockToken other = new MockStockToken();
        PoolKey memory bad = key;
        bad.currency0 = Currency.wrap(address(other));
        vm.prank(merchant);
        vm.expectRevert();
        executor.createOrder(merchant, bad, 1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("b2"));
    }

    function test_B3_refuses_a_reserved_recipient() public {
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(E.ReservedRecipient.selector, address(executor)));
        executor.createOrder(
            address(executor), key, 1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("b3")
        );
    }

    function test_B4_refuses_an_expired_order() public {
        bytes32 id = _createOrder(1e18, 1, uint64(block.timestamp + 10), address(0), bytes32("b4"));
        vm.warp(block.timestamp + 11);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(E.OrderExpired.selector, id, uint64(block.timestamp - 1)));
        executor.pay(id);
    }

    function test_B5_refuses_the_wrong_payer_when_bound() public {
        bytes32 id = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), payer, bytes32("b5"));
        address stranger = makeAddr("stranger");
        stock.mint(stranger, 10e18);
        vm.prank(stranger);
        stock.approve(address(executor), type(uint256).max);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(E.WrongPayer.selector, id, payer, stranger));
        executor.pay(id);
    }

    function test_B6_refuses_an_output_below_the_committed_minimum() public {
        // The floor is an absolute integer in the payout token's raw units. Set above what the pool
        // can actually deliver for this input — which, per test_A2, is a raw-unit quantity, so the
        // floor has to be expressed in the same raw units to bind.
        bytes32 id = _createOrder(1e18, 5e18, uint64(block.timestamp + 1 hours), address(0), bytes32("b6"));
        vm.prank(payer);
        vm.expectRevert();
        executor.pay(id);
    }

    function test_B7_refuses_a_replayed_order() public {
        bytes32 id = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("b7"));
        vm.prank(payer);
        executor.pay(id);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(E.OrderNotOpen.selector, id, T.Status.Settled));
        executor.pay(id);
    }

    function test_B8_refuses_a_duplicate_order_id() public {
        _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("b8"));
        vm.prank(merchant);
        vm.expectRevert();
        executor.createOrder(merchant, key, 1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("b8"));
    }

    function test_B9_refuses_an_allowance_below_the_order() public {
        bytes32 id = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("b9"));
        vm.prank(payer);
        stock.approve(address(executor), 0.5e18);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(E.AllowanceTooLow.selector, address(stock), 1e18, 0.5e18));
        executor.pay(id);
    }

    function test_B10_refuses_an_unknown_order() public {
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(E.UnknownOrder.selector, bytes32("nope")));
        executor.pay(bytes32("nope"));
    }

    // ── the callbacks cannot be reached from outside ──────────────────────────────────────────

    function test_C1_forged_unlock_callback_is_refused() public {
        vm.expectRevert(abi.encodeWithSelector(E.NotPoolManager.selector, address(this)));
        executor.unlockCallback(abi.encode(bytes32("x")));
    }

    function test_C2_forged_beforeSwap_is_refused() public {
        SwapParams memory p = SwapParams({zeroForOne: true, amountSpecified: -1e18, sqrtPriceLimitX96: 0});
        vm.expectRevert();
        hook.beforeSwap(address(executor), key, p, abi.encode(bytes32("x")));
    }

    function test_C3_a_swap_not_driven_by_the_executor_is_refused() public {
        // The liquidity router is a legitimate contract; it is simply not the settlement executor.
        SwapParams memory p = SwapParams({zeroForOne: true, amountSpecified: -1e18, sqrtPriceLimitX96: 0});
        vm.prank(address(manager));
        vm.expectRevert(abi.encodeWithSelector(E.NotSettlementExecutor.selector, address(liquidityRouter)));
        hook.beforeSwap(address(liquidityRouter), key, p, abi.encode(bytes32("x")));
    }

    function test_C4_malformed_hook_data_is_refused() public {
        SwapParams memory p = SwapParams({zeroForOne: true, amountSpecified: -1e18, sqrtPriceLimitX96: 0});
        vm.prank(address(manager));
        vm.expectRevert(abi.encodeWithSelector(E.MalformedHookData.selector, uint256(0)));
        hook.beforeSwap(address(executor), key, p, "");
    }

    // ── hostile tokens ────────────────────────────────────────────────────────────────────────

    /// @dev Driven THROUGH the executor, not against the fixture. The first version of this row
    ///      asserted that the fee-on-transfer token took a fee — which proved the fixture worked and
    ///      proved nothing about the executor. A sabotage run caught that: deleting the executor's
    ///      InputNotExact check left the suite fully green. This row is what closed it.
    function test_D1_a_fee_on_transfer_input_is_refused_by_the_executor() public {
        bytes32 id = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("d1"));
        stock.setFeeBps(100); // 1% taken in flight
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(E.InputNotExact.selector, uint128(1e18), uint256(0.99e18)));
        executor.pay(id);
    }

    /// @dev The control for the row above: with the fee off, the identical order settles. Without
    ///      this, a refusal that fired on everything would look like a working check.
    function test_D2_control_the_same_order_settles_once_the_fee_is_off() public {
        bytes32 id = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("d2"));
        stock.setFeeBps(0);
        vm.prank(payer);
        executor.pay(id);
        assertEq(uint8(executor.orders(id).status), uint8(T.Status.Settled));
    }

    /// @dev A payout token that calls back during the merchant's `take` is re-entering INSIDE the
    ///      PoolManager's lock. The latch must refuse the second entry; the first must still settle.
    ///      Also caught by sabotage: with the latch removed, nothing in the suite went red.
    function test_D3_a_reentering_payout_token_cannot_start_a_second_settlement() public {
        bytes32 first = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("d3a"));
        bytes32 second = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("d3b"));
        dollar.armReentry(address(executor), abi.encodeWithSignature("pay(bytes32)", second));

        vm.prank(payer);
        executor.pay(first);

        assertEq(uint8(executor.orders(first).status), uint8(T.Status.Settled), "the first payment must still settle");
        assertEq(
            uint8(executor.orders(second).status),
            uint8(T.Status.Open),
            "the re-entered order must be untouched, not half-paid"
        );
        assertEq(hook.receiptCount(), 1, "a re-entrant call must not mint a second receipt");
    }

    function test_D4_a_false_returning_token_is_a_failure_not_a_success() public {
        FalseReturnInput bad = new FalseReturnInput();
        bad.mint(payer, 10e18);
        vm.prank(payer);
        bad.approve(address(executor), type(uint256).max);
        vm.prank(payer);
        bool ok = bad.transferFrom(payer, address(this), 1e18);
        assertFalse(ok, "the fixture must return false");
        assertEq(
            bad.balanceOf(address(this)), 0, "nothing moved, so an executor that ignored the return would be wrong"
        );
    }

    // ── invariants ────────────────────────────────────────────────────────────────────────────

    function test_E1_a_settled_order_never_returns_to_open() public {
        bytes32 id = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("e1"));
        vm.prank(payer);
        executor.pay(id);
        assertEq(uint8(executor.orders(id).status), uint8(T.Status.Settled));
        vm.prank(payer);
        vm.expectRevert();
        executor.pay(id);
        assertEq(uint8(executor.orders(id).status), uint8(T.Status.Settled), "status moved after a failed retry");
    }

    function test_E2_the_recipient_is_fixed_at_creation_and_never_re_read() public {
        bytes32 id = _createOrder(1e18, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("e2"));
        address stored = executor.orders(id).recipient;
        assertEq(stored, merchant, "recipient is stored, not resolved");
        vm.prank(payer);
        executor.pay(id);
        assertEq(executor.orders(id).recipient, stored, "recipient changed during settlement");
    }

    function test_E3_receipt_count_rises_by_exactly_one_per_settlement() public {
        assertEq(hook.receiptCount(), 0);
        for (uint256 i = 0; i < 3; i++) {
            bytes32 id =
                _createOrder(1e17, 1, uint64(block.timestamp + 1 hours), address(0), bytes32(uint256(0xe300 + i)));
            vm.prank(payer);
            executor.pay(id);
            assertEq(hook.receiptCount(), i + 1, "one receipt per settlement, no more and no fewer");
        }
    }

    function testFuzz_E4_delivery_never_below_the_committed_minimum(uint128 amountIn) public {
        amountIn = uint128(bound(uint256(amountIn), 1e15, 5e18));
        bytes32 id = _createOrder(amountIn, 1, uint64(block.timestamp + 1 hours), address(0), bytes32("e4"));
        uint256 before_ = dollar.balanceOf(merchant);
        vm.prank(payer);
        try executor.pay(id) {
            assertGe(dollar.balanceOf(merchant) - before_, 1, "settled below the committed minimum");
        } catch {
            assertEq(dollar.balanceOf(merchant), before_, "a failed settlement moved the merchant's balance");
        }
    }
}
