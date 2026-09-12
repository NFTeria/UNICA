// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {HookSalt} from "../../../src/unica-v4/HookSalt.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {V4PoolManagerDeployer} from "hookmate/artifacts/V4PoolManager.sol";

import {UnicaMarketTypes} from "../../../src/unica-v4/UnicaMarketTypes.sol";
import {UnicaMarketHook} from "../../../src/unica-v4/UnicaMarketHook.sol";
import {UnicaMarketExecutor} from "../../../src/unica-v4/UnicaMarketExecutor.sol";
import {UnicaMarketFactory} from "../../../src/unica-v4/UnicaMarketFactory.sol";
import {UnicaMarketRegistry} from "../../../src/unica-v4/UnicaMarketRegistry.sol";
import {UnicaV4TestBase} from "../util/UnicaV4TestBase.sol";
import {MockOracleAdapter} from "../fixtures/MockOracleAdapter.sol";
import {
    SyncingAsset,
    ReenteringAsset,
    DebitingPayout,
    CreditingAsset,
    SwapDuringUnlockAsset
} from "../fixtures/HostileTokens.sol";

/// @title Guard rows — the six money-path refusals nothing could turn red, and the five never asserted
/// @notice TEST-MATRIX rows X9a to X9d, X12, X14, X16, X17, H5c, H13, H14 and O26, plus the three
///         errors the review found declared and never reached: `DeliveryNotExact`,
///         `OpeningTickMismatch` (below, in `GuardsFactoryTest`), `HookDeployFailed` and
///         `OraclePriceOutOfRange`.
///
///         Every row here reproduces the attack's PRECONDITION with a token that really misbehaves,
///         and stands beside a control that settles on the same market with the same order shape and
///         the one hostile switch off. A row that only asserted "it reverted" would pass against the
///         wrong refusal, so each one names the error and its arguments — through the PoolManager's
///         `WrappedError` envelope where the refusal is the hook's.
///
/// @dev WHY SOME REFUSALS ARE READ OFF THE TOKEN. The executor moves tokens with a low-level call and
///      converts every revert inside them into `TransferFailed(token)`. Where the attack's refusal is
///      raised INSIDE that call — the re-entrant `pay` of X17, the intruding `swap` of X9c — the
///      fixture catches it and the row asserts the recorded bytes. The refusal is still the
///      contract's; the envelope is just not the executor's to give.
contract GuardsTest is UnicaV4TestBase {
    /// @dev The oracle rows' reference: one whole payout per whole asset, eight decimals, the shape a
    ///      push feed reports.
    bytes32 internal constant FEED_ID = keccak256("GUARDS/UNICA-TEST");
    uint256 internal constant PRICE_1_TO_1 = 1e8;
    uint8 internal constant PRICE_DECIMALS = 8;
    uint48 internal constant MAX_AGE = 300;
    uint16 internal constant MAX_BPS = 200;

    uint128 internal constant AMOUNT_IN = 1e18;

    MarketSpec internal spec;
    Market internal market;

    function setUp() public {
        setUpBase();
        spec = defaultSpec();
        market = deployMarket(spec);
    }

    // ---- X9a: a foreign sync makes the settle credit the wrong credit ------------------------------

    function test_X9a_aForeignSyncDuringTheSettleTransferIsRefused() public {
        SyncingAsset token = _etchSyncingAsset();
        token.setTarget(manager, market.key.currency1);

        // Control first, on this very market with the behaviour off: the etched token settles.
        _settles("x9a-control");

        token.armForeignSync(true);
        uint128 amountIn = AMOUNT_IN;
        bytes32 orderId = createOrder(market, amountIn, 1, "x9a");
        fundPayer(market, payer, amountIn);

        uint256 merchantBefore = market.payout.balanceOf(merchant);
        vm.prank(payer);
        // The executor synced the asset; the token then synced the payout on its way to the pool, so
        // `settle()` measures a currency nothing moved and credits zero.
        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketExecutor.SettlementDidNotClose.selector, uint256(amountIn), uint256(0))
        );
        market.executor.pay(orderId);

        assertEq(market.payout.balanceOf(merchant), merchantBefore, "the merchant's balance moved on a refusal");
        assertEq(uint8(market.executor.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Open));
    }

    // ---- X16: an input token charging a fee only on the way to the pool -----------------------------

    function test_X16_aTokenThatSkimsOnlyOnTheSettleTransferIsRefused() public {
        SyncingAsset token = _etchSyncingAsset();
        token.setTarget(manager, market.key.currency1);
        _settles("x16-control");

        // 1 % kept on the transfer to the PoolManager and nothing kept on the pull, so `InputNotExact`
        // cannot fire and only the settle credit disagrees.
        token.armSkim(100);
        uint128 amountIn = AMOUNT_IN;
        bytes32 orderId = createOrder(market, amountIn, 1, "x16");
        fundPayer(market, payer, amountIn);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(
                UnicaMarketExecutor.SettlementDidNotClose.selector, uint256(amountIn), uint256(amountIn) - 1e16
            )
        );
        market.executor.pay(orderId);
        assertEq(uint8(market.executor.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Open));
    }

    // ---- X9b: settleFor, which steals the credit the executor is about to claim ------------------------

    function test_X9b_settleForDuringTheUnlockLeavesNothingMoved() public {
        SwapDuringUnlockAsset token = _etchSwapDuringUnlockAsset();
        _settles("x9b-control");

        token.arm(SwapDuringUnlockAsset.Action.SettleFor, 0, 0);
        uint128 amountIn = AMOUNT_IN;
        bytes32 orderId = createOrder(market, amountIn, 1, "x9b");
        fundPayer(market, payer, amountIn);

        uint256 payerBefore = market.asset.balanceOf(payer);
        uint256 merchantBefore = market.payout.balanceOf(merchant);
        uint256 receiptsBefore = market.hook.receiptCount();

        // What the row observes: `settleFor` succeeds, so the synced currency is reset and the
        // executor's own `settle()` measures the native branch — zero. The named refusal is the
        // executor's, and it fires before anything is taken.
        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketExecutor.SettlementDidNotClose.selector, uint256(amountIn), uint256(0))
        );
        market.executor.pay(orderId);

        assertEq(market.asset.balanceOf(payer), payerBefore, "the payer's input moved");
        assertEq(market.payout.balanceOf(merchant), merchantBefore, "the merchant's balance moved");
        assertEq(market.hook.receiptCount(), receiptsBefore, "a receipt survived");
        assertEq(uint8(market.executor.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Open));
    }

    // ---- X9c: a swap from inside the unlock is not the executor ---------------------------------------

    function test_X9c_aSwapDuringTheUnlockIsNotTheSettlementExecutor() public {
        SwapDuringUnlockAsset token = _etchSwapDuringUnlockAsset();

        // The control and the attack are the SAME payment on the SAME pool state: the row snapshots,
        // runs the armed payment, rewinds and runs it again disarmed, so "delivery unchanged" is a
        // comparison of two numbers rather than a hope.
        uint128 amountIn = AMOUNT_IN;
        uint256 snapshot = vm.snapshotState();

        token.arm(SwapDuringUnlockAsset.Action.Swap, 0, 0);
        uint256 deliveredUnderAttack = _payAndMeasure(amountIn, "x9c");
        bytes memory recorded = token.lastError();
        uint256 receiptsUnderAttack = market.hook.receiptCount();

        assertEq(
            keccak256(recorded),
            keccak256(
                abi.encodeWithSignature(
                    "WrappedError(address,bytes4,bytes,bytes)",
                    address(market.hook),
                    IHooks.beforeSwap.selector,
                    abi.encodeWithSelector(UnicaMarketHook.NotSettlementExecutor.selector, address(market.asset)),
                    abi.encodeWithSignature("HookCallFailed()")
                )
            ),
            "the intruding swap was not refused as NotSettlementExecutor"
        );

        vm.revertToState(snapshot);
        token = _etchSwapDuringUnlockAsset();
        uint256 deliveredClean = _payAndMeasure(amountIn, "x9c");

        assertEq(deliveredUnderAttack, deliveredClean, "the intrusion changed the delivery");
        assertEq(receiptsUnderAttack, market.hook.receiptCount(), "the intrusion changed the receipt count");
    }

    // ---- X9d: modifyLiquidity from inside the unlock changes neither delivery nor receipt ---------------

    function test_X9d_modifyLiquidityDuringTheUnlockChangesNeitherDeliveryNorReceipt() public {
        SwapDuringUnlockAsset token = _etchSwapDuringUnlockAsset();
        int24 lower = _floorToSpacing(market.initTick, spec.tickSpacing) - spec.tickSpacing;
        int24 upper = lower + 2 * spec.tickSpacing;

        uint128 amountIn = AMOUNT_IN;
        uint256 snapshot = vm.snapshotState();

        token.arm(SwapDuringUnlockAsset.Action.ModifyLiquidity, lower, upper);
        uint256 deliveredUnderAttack = _payAndMeasure(amountIn, "x9d");
        uint256 receiptsUnderAttack = market.hook.receiptCount();
        // The PoolManager refuses an intruder's touch of a position it does not hold, so the attempt
        // reverts inside the token's own frame and rolls back. What matters to the row is the pair of
        // numbers below, not which of the manager's refusals it was.
        assertGt(token.lastError().length, 0, "modifyLiquidity was not even attempted");

        vm.revertToState(snapshot);
        token = _etchSwapDuringUnlockAsset();
        uint256 deliveredClean = _payAndMeasure(amountIn, "x9d");

        assertEq(deliveredUnderAttack, deliveredClean, "the intrusion changed the delivery");
        assertEq(receiptsUnderAttack, market.hook.receiptCount(), "the intrusion changed the receipt count");
        assertEq(receiptsUnderAttack, 1, "the payment did not receipt exactly once");
    }

    // ---- X12: the forged callback ------------------------------------------------------------------------

    function test_X12_aForgedUnlockCallbackIsRefusedTwoWays() public {
        uint128 amountIn = AMOUNT_IN;
        bytes32 orderId = createOrder(market, amountIn, 1, "x12");
        fundPayer(market, payer, amountIn);

        // A stranger, with a real in-flight-looking payload: the caller is checked before anything else.
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.NotPoolManager.selector, stranger));
        market.executor.unlockCallback(abi.encode(orderId));

        // The PoolManager itself, for an order that is Open rather than Paying.
        vm.prank(address(manager));
        vm.expectRevert(
            abi.encodeWithSelector(
                UnicaMarketExecutor.OrderNotInFlight.selector, orderId, uint8(UnicaMarketTypes.OrderStatus.Open)
            )
        );
        market.executor.unlockCallback(abi.encode(orderId));

        // And for an order that does not exist at all.
        bytes32 unknown = keccak256("never created here");
        vm.prank(address(manager));
        vm.expectRevert(
            abi.encodeWithSelector(
                UnicaMarketExecutor.OrderNotInFlight.selector, unknown, uint8(UnicaMarketTypes.OrderStatus.None)
            )
        );
        market.executor.unlockCallback(abi.encode(unknown));

        // Control: the PoolManager's own callback, reached the only way it is meant to be.
        vm.prank(payer);
        market.executor.pay(orderId);
        assertEq(uint8(market.executor.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Settled));
    }

    // ---- X14a: a residual of the INPUT token ---------------------------------------------------------------

    function test_X14a_anInputTokenThatCreditsTheExecutorIsRefused() public {
        CreditingAsset token = _etchCreditingAsset();
        token.setTarget(address(market.executor), address(manager));
        _settles("x14a-control");

        // Credited during the pull, the extra unit is caught EARLIER, by the exact-input measurement.
        token.arm(CreditingAsset.When.OnPull, 1);
        uint128 amountIn = AMOUNT_IN;
        bytes32 early = createOrder(market, amountIn, 1, "x14a-pull");
        fundPayer(market, payer, amountIn);
        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketExecutor.InputNotExact.selector, amountIn, uint256(amountIn) + 1)
        );
        market.executor.pay(early);

        // Credited during the transfer to the pool instead: the pull was exact, the pool was paid in
        // full, the merchant was paid in full, and only the executor's own balance disagrees.
        token.arm(CreditingAsset.When.OnSettleTransfer, 1);
        bytes32 orderId = createOrder(market, amountIn, 1, "x14a");
        fundPayer(market, payer, amountIn);
        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketExecutor.ExecutorResidualInput.selector, uint256(0), uint256(1))
        );
        market.executor.pay(orderId);
        assertEq(uint8(market.executor.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Open));
    }

    // ---- X14b: a residual of the PAYOUT token, and the donation that must not block a payment ----------------

    function test_X14b_aPayoutTokenThatCreditsTheExecutorIsRefused() public {
        DebitingPayout token = _etchDebitingPayout();
        token.setTarget(merchant, address(market.executor));
        _settles("x14b-control");

        token.arm(DebitingPayout.Mode.CreditExecutor, 1);
        uint128 amountIn = AMOUNT_IN;
        bytes32 orderId = createOrder(market, amountIn, 1, "x14b");
        fundPayer(market, payer, amountIn);
        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketExecutor.ExecutorResidualPayout.selector, uint256(0), uint256(1))
        );
        market.executor.pay(orderId);

        // The matrix's own control for X14: the residual checks are SNAPSHOT-relative, so a donation
        // made to the executor before the payment neither blocks it nor hides a residual.
        token.arm(DebitingPayout.Mode.Off, 0);
        market.payout.mint(address(market.executor), 5);
        market.asset.mint(address(market.executor), 7);
        vm.prank(payer);
        market.executor.pay(orderId);
        assertEq(uint8(market.executor.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Settled));
        assertEq(market.payout.balanceOf(address(market.executor)), 5, "the donation was not left exactly as it was");
        assertEq(market.asset.balanceOf(address(market.executor)), 7, "the donation was not left exactly as it was");
    }

    // ---- DeliveryNotExact: a payout that takes back part of what it just delivered -------------------------

    function test_DeliveryNotExact_aPayoutThatDebitsTheRecipientDuringTake() public {
        DebitingPayout token = _etchDebitingPayout();
        token.setTarget(merchant, address(market.executor));

        uint128 amountIn = AMOUNT_IN;
        uint256 out = quote(market, amountIn);
        assertGt(out, 1, "the pool quoted nothing to debit from");

        // One unit back off the merchant, inside the same `transfer` the PoolManager's `take` made.
        // The delivery still clears `minOut`, so the only thing left to catch it is the equality
        // between what the pool said it produced and what the merchant actually kept.
        token.arm(DebitingPayout.Mode.DebitRecipient, 1);
        bytes32 orderId = createOrder(market, amountIn, 1, "dne");
        fundPayer(market, payer, amountIn);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.DeliveryNotExact.selector, orderId, out, out - 1));
        market.executor.pay(orderId);

        // review-8, the underflow half. A debit LARGER than the delivery drives the recipient BELOW
        // the balance the snapshot recorded, which is the case that used to reach the executor's own
        // subtraction and die there as a bare arithmetic panic. It is named now — the guard added at
        // `_verifyAndAccount` reports `DeliveryNotExact(orderId, out, 0)`, a zero delivery rather than
        // a negative one — so the row asserts the name. If this ever goes back to `stdError
        // .arithmeticError`, the diagnosis has been lost again and this assertion is what says so.
        market.payout.mint(merchant, 1_000_000);
        token.arm(DebitingPayout.Mode.DebitRecipient, out + 5);
        bytes32 deep = createOrder(market, amountIn, 1, "dne-deep");
        fundPayer(market, payer, amountIn);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.DeliveryNotExact.selector, deep, out, uint256(0)));
        market.executor.pay(deep);

        // Control: the same order, the same token, the debit switched off.
        token.arm(DebitingPayout.Mode.Off, 0);
        uint256 before = market.payout.balanceOf(merchant);
        vm.prank(payer);
        market.executor.pay(orderId);
        assertGt(market.payout.balanceOf(merchant), before, "the control did not settle");
    }

    // ---- X17: re-entry through the input token's own transferFrom -----------------------------------------

    function test_X17_aReentrantTransferFromIsRefusedByTheLatch() public {
        ReenteringAsset token = _etchReenteringAsset();

        uint128 amountIn = AMOUNT_IN;
        bytes32 first = createOrder(market, amountIn, 1, "x17-a");
        // The SECOND order names the token itself as its payer, funded and approved, so nothing but
        // the latch refuses the re-entrant `pay`: a re-entry `WrongPayer` would have caught anyway
        // proves nothing about the latch.
        bytes32 second = market.executor
            .createOrder(merchant, address(market.asset), amountIn, 1, uint64(block.timestamp + 1 hours), "x17-b");

        fundPayer(market, payer, amountIn);
        market.asset.mint(address(market.asset), amountIn);
        vm.prank(address(market.asset));
        market.asset.approve(address(market.executor), type(uint256).max);

        token.arm(address(market.executor), second);
        vm.prank(payer);
        market.executor.pay(first);

        bytes memory recorded = token.lastError();
        assertFalse(token.reentrantCallSucceeded(), "a second payment ran inside the first");
        assertEq(recorded.length, 4, "the re-entrant refusal was not a bare custom error");
        assertEq(bytes4(recorded), UnicaMarketExecutor.Reentered.selector, "the re-entry was not refused as Reentered");

        // Control: both orders settle, one after the other, once the re-entry is not attempted.
        token.disarm();
        assertEq(uint8(market.executor.orders(first).status), uint8(UnicaMarketTypes.OrderStatus.Settled));
        assertEq(uint8(market.executor.orders(second).status), uint8(UnicaMarketTypes.OrderStatus.Open));
        vm.prank(address(market.asset));
        market.executor.pay(second);
        assertEq(uint8(market.executor.orders(second).status), uint8(UnicaMarketTypes.OrderStatus.Settled));
        assertEq(market.hook.receiptCount(), 2, "two settlements did not produce two receipts");
    }

    // ---- H5c: market A's executor against market B's pool ---------------------------------------------------

    function test_H5c_oneMarketsExecutorCannotSwapOnAnothersPool() public {
        Market memory b = deployMarket(defaultSpec());

        // A raw swapper placed at market A's executor address, so hook B sees exactly the address it
        // would see if A's executor itself had reached across — and refuses it by that name.
        ForeignSwapper template = new ForeignSwapper();
        address executorA = address(market.executor);
        vm.etch(executorA, address(template).code);
        ForeignSwapper(executorA).configure(manager);

        expectWrappedBeforeSwapRevert(
            address(b.hook), abi.encodeWithSelector(UnicaMarketHook.NotSettlementExecutor.selector, executorA)
        );
        ForeignSwapper(executorA).swap(b.key, b.assetIsCurrency0, 1e18);

        // Control: B's own executor settles B.
        bytes32 orderId = createOrder(b, 1e18, 1, "h5c");
        fundPayer(b, payer, 1e18);
        vm.prank(payer);
        b.executor.pay(orderId);
        assertEq(b.hook.receiptCount(), 1, "B's own executor did not settle B");
    }

    // ---- H13: an oversized order at the smallest allowed spacing, under a gas ceiling -------------------------

    /// @dev A13. Spacing 10 is the smallest tier the factory allows, which is the one where an
    ///      oversized order walks the most bitmap words before the pool runs out of depth. The row
    ///      pins that the walk terminates inside a stated ceiling AND that the refusal is a named one
    ///      rather than an out-of-gas, which would look identical to `vm.expectRevert()` alone.
    uint256 internal constant H13_GAS_CEILING = 3_000_000;

    function test_H13_anOversizedOrderAtSpacingTenRefusesUnderTheGasCeiling() public {
        MarketSpec memory thin = defaultSpec();
        thin.fee = 500;
        thin.tickSpacing = SPACING_10;
        thin.seedSteps = 20;
        thin.seedAssetWhole = 1;
        thin.seedPayoutWhole = 1;
        Market memory m = deployMarket(thin);

        uint128 huge = 1e30;
        bytes32 orderId = createOrder(m, huge, 1, "h13");
        fundPayer(m, payer, huge);

        uint256 before = gasleft();
        vm.prank(payer);
        try m.executor.pay{gas: H13_GAS_CEILING}(orderId) {
            revert("the oversized order settled");
        } catch (bytes memory err) {
            uint256 used = before - gasleft();
            emit log_named_uint("H13 gas used by the refused oversized order", used);
            assertLt(used, H13_GAS_CEILING, "the refusal did not fit inside the ceiling");
            assertGt(err.length, 0, "the call ran out of gas instead of refusing by name");

            (bytes4 inner,) = _unwrapHookError(err);
            assertTrue(
                inner == UnicaMarketHook.PartialFill.selector || inner == UnicaMarketHook.OutputBelowMinimum.selector,
                "the refusal was neither PartialFill nor OutputBelowMinimum"
            );
        }

        // Control: an order inside the seed settles, at the same spacing.
        uint128 small = 1e14;
        bytes32 ok = createOrder(m, small, 1, "h13-ok");
        fundPayer(m, payer, small);
        vm.prank(payer);
        m.executor.pay(ok);
        assertEq(m.hook.receiptCount(), 1, "the control did not settle");
    }

    // ---- H14: the hook's external ABI, pinned -----------------------------------------------------------------

    /// @notice A4. The surface is the thirty functions below and nothing else. `keccak256` over their
    ///         selectors, concatenated in the declared order, is compared against a constant; the
    ///         constant was produced by running this row once with `EXPECTED_ABI_DIGEST` set to zero
    ///         and reading the value it logged, and it changes the moment a signature is added,
    ///         removed or renamed.
    /// @dev The second half is the part that catches an ADDITION the list was not told about: the
    ///      deployed runtime is scanned for the legacy dispatcher's `PUSH4 <selector> EQ` pattern and
    ///      the recovered set is required to be exactly the declared one. That depends on the frozen
    ///      build profile (optimizer off, via-IR false), which is why it is asserted here and not
    ///      assumed.
    bytes32 internal constant EXPECTED_ABI_DIGEST = 0x8d6c13f4cb217131ab8eaa0fced18d42ed44cdec9576431e53396f9e23a8449e;

    function test_H14_theHooksExternalAbiIsPinned() public {
        bytes4[] memory expected = _declaredHookSelectors();
        assertEq(expected.length, 30, "the declared surface is not thirty functions");

        bytes memory concatenated;
        for (uint256 i; i < expected.length; ++i) {
            concatenated = bytes.concat(concatenated, expected[i]);
        }
        bytes32 digest = keccak256(concatenated);
        emit log_named_bytes32("H14 hook ABI digest", digest);
        assertEq(digest, EXPECTED_ABI_DIGEST, "the hook's external ABI changed");

        // Every declared selector really is dispatched by the deployed hook, and nothing else is.
        bytes4[] memory dispatched = _dispatchedSelectors(address(market.hook).code);
        assertEq(dispatched.length, expected.length, "the hook dispatches a different number of functions");
        for (uint256 i; i < expected.length; ++i) {
            assertTrue(_contains(dispatched, expected[i]), "a declared selector is not dispatched by the hook");
        }
    }

    // ---- O26: each payment spends band, and the halt lands exactly on it ---------------------------------------

    /// @dev SC §8.3. Only the executor swaps and only asset → payout, so the pool price walks one way
    ///      and never comes back: every payment spends band. The row pays the same maximum-sized
    ///      payment repeatedly on the maximum seed until the hook stops it, then recomputes the bound
    ///      from SO §4.2 independently of the hook and requires the two to agree to the raw unit.
    function test_O26_repeatedPaymentsHaltExactlyWhenTheBandIsSpent() public {
        (Market memory m, MockOracleAdapter oracle) = _oracleMarket(defaultSpec());
        uint128 amountIn = 5_000e18;

        uint256 settled;
        uint256 producedAtHalt;
        uint256 minAllowedAtHalt;
        bool halted;

        for (uint256 i; i < 60 && !halted; ++i) {
            bytes32 orderId = createOrder(m, amountIn, 1, keccak256(abi.encode("o26", i)));
            fundPayer(m, payer, amountIn);
            oracle.setUpdatedAt(block.timestamp - 60);
            vm.prank(payer);
            try m.executor.pay(orderId) {
                ++settled;
            } catch (bytes memory err) {
                (bytes4 inner, bytes memory reason) = _unwrapHookError(err);
                assertEq(
                    inner,
                    UnicaMarketHook.ExecutionBelowOracleBand.selector,
                    "the halt was not the band being spent downwards"
                );
                (, producedAtHalt, minAllowedAtHalt) = abi.decode(reason, (bytes32, uint256, uint256));
                halted = true;
            }
        }

        assertTrue(halted, "sixty maximum payments never spent the band");
        assertGt(settled, 0, "the FIRST payment already failed; the control of this row is the first one settling");

        // The bound, recomputed here from the spec rather than read from the hook.
        (,, uint24 swapFee) = m.hook.feeRates();
        uint256 netInput = uint256(amountIn) * (1e6 - uint256(swapFee));
        uint256 scaledPrice = PRICE_1_TO_1 * (10 ** uint256(m.payoutDecimals));
        uint256 denominator = 10 ** (6 + uint256(m.assetDecimals) + uint256(PRICE_DECIMALS));
        uint256 refOutCeil = FullMath.mulDivRoundingUp(netInput, scaledPrice, denominator);
        uint256 independent = FullMath.mulDivRoundingUp(refOutCeil, 10_000 - uint256(MAX_BPS), 10_000);

        assertEq(minAllowedAtHalt, independent, "the hook's floor is not the floor SO 4.2 computes");
        assertLt(producedAtHalt, minAllowedAtHalt, "the halt fired above the floor");
        emit log_named_uint("O26 payments that settled before the band was spent", settled);
        emit log_named_uint("O26 output at the halt", producedAtHalt);
        emit log_named_uint("O26 floor at the halt", minAllowedAtHalt);

        // Control: a market at the same bps whose price has not walked settles the same payment.
        (Market memory fresh,) = _oracleMarket(defaultSpec());
        bytes32 ok = createOrder(fresh, amountIn, 1, "o26-control");
        fundPayer(fresh, payer, amountIn);
        vm.prank(payer);
        fresh.executor.pay(ok);
        assertEq(fresh.hook.receiptCount(), 1, "the first payment at the configured bps did not settle");
    }

    // ---- OraclePriceOutOfRange: both ways past the bound --------------------------------------------------------

    function test_OraclePriceOutOfRange_rawAndScaled() public {
        // The mirrored ordering (6-decimal asset, 18-decimal payout) is the one where the SCALED form
        // can overflow while the raw price is still inside `uint128`; the default ordering cannot
        // reach the second check at all, which is why this row is built on the mirror.
        (Market memory m, MockOracleAdapter oracle) = _oracleMarket(mirroredSpec());
        uint128 amountIn = 1e6;

        // The raw bound: one above `type(uint128).max`.
        uint256 tooBig = uint256(type(uint128).max) + 1;
        oracle.setReading(tooBig, PRICE_DECIMALS, block.timestamp - 60);
        _expectRefusalOn(
            m,
            amountIn,
            abi.encodeWithSelector(UnicaMarketHook.OraclePriceOutOfRange.selector, m.marketId, tooBig),
            "opr-a"
        );

        // The scaled bound: a price inside `uint128` whose value for one whole asset is not. At zero
        // oracle decimals the payout's eighteen and the asset's six leave a factor of 1e12.
        uint256 scaledOver = 1e27;
        oracle.setReading(scaledOver, 0, block.timestamp - 60);
        _expectRefusalOn(
            m,
            amountIn,
            abi.encodeWithSelector(UnicaMarketHook.OraclePriceOutOfRange.selector, m.marketId, scaledOver),
            "opr-b"
        );

        // Control: a sane reading on the same market settles.
        oracle.setReading(PRICE_1_TO_1, PRICE_DECIMALS, block.timestamp - 60);
        bytes32 ok = createOrder(m, amountIn, 1, "opr-control");
        fundPayer(m, payer, amountIn);
        vm.prank(payer);
        m.executor.pay(ok);
        assertEq(m.hook.receiptCount(), 1, "the control did not settle");
    }

    // ---- helpers ----------------------------------------------------------------------------------------------

    function _settles(bytes32 salt) private {
        bytes32 orderId = createOrder(market, AMOUNT_IN, 1, salt);
        fundPayer(market, payer, AMOUNT_IN);
        uint256 before = market.payout.balanceOf(merchant);
        vm.prank(payer);
        market.executor.pay(orderId);
        assertGt(market.payout.balanceOf(merchant), before, "the control did not settle");
    }

    function _payAndMeasure(uint128 amountIn, bytes32 salt) private returns (uint256 delivered) {
        bytes32 orderId = createOrder(market, amountIn, 1, salt);
        fundPayer(market, payer, amountIn);
        uint256 before = market.payout.balanceOf(merchant);
        vm.prank(payer);
        market.executor.pay(orderId);
        delivered = market.payout.balanceOf(merchant) - before;
    }

    function _expectRefusalOn(Market memory m, uint128 amountIn, bytes memory innerRevert, bytes32 salt) private {
        bytes32 orderId = createOrder(m, amountIn, 1, salt);
        fundPayer(m, payer, amountIn);
        vm.prank(payer);
        expectWrappedHookRevert(address(m.hook), innerRevert);
        m.executor.pay(orderId);
    }

    /// @dev A market with a live oracle policy on it. The adapter binds its pair as immutables, so it
    ///      has to exist before the market it serves; `peekTokens` is what makes that possible.
    function _oracleMarket(MarketSpec memory base) private returns (Market memory m, MockOracleAdapter oracle) {
        (address assetAddr, address payoutAddr) = peekTokens(base.assetIsCurrency0);
        oracle =
            new MockOracleAdapter(assetAddr, payoutAddr, FEED_ID, PRICE_1_TO_1, PRICE_DECIMALS, block.timestamp - 60);
        base.adapter = address(oracle);
        base.feedId = FEED_ID;
        base.maxAge = MAX_AGE;
        base.maxDeviationBps = MAX_BPS;
        m = deployMarket(base);
        require(address(m.asset) == assetAddr, "the adapter and the market disagree about the asset");
    }

    // ---- etching a hostile token over a live market's token -------------------------------------------------------

    function _etchSyncingAsset() private returns (SyncingAsset token) {
        SyncingAsset template = new SyncingAsset("h", "H", market.assetDecimals);
        vm.etch(address(market.asset), address(template).code);
        return SyncingAsset(address(market.asset));
    }

    function _etchReenteringAsset() private returns (ReenteringAsset token) {
        ReenteringAsset template = new ReenteringAsset("h", "H", market.assetDecimals);
        vm.etch(address(market.asset), address(template).code);
        return ReenteringAsset(address(market.asset));
    }

    function _etchCreditingAsset() private returns (CreditingAsset token) {
        CreditingAsset template = new CreditingAsset("h", "H", market.assetDecimals);
        vm.etch(address(market.asset), address(template).code);
        return CreditingAsset(address(market.asset));
    }

    function _etchDebitingPayout() private returns (DebitingPayout token) {
        DebitingPayout template = new DebitingPayout("h", "H", market.payoutDecimals);
        vm.etch(address(market.payout), address(template).code);
        return DebitingPayout(address(market.payout));
    }

    function _etchSwapDuringUnlockAsset() private returns (SwapDuringUnlockAsset token) {
        SwapDuringUnlockAsset template = new SwapDuringUnlockAsset("h", "H", market.assetDecimals);
        vm.etch(address(market.asset), address(template).code);
        token = SwapDuringUnlockAsset(address(market.asset));
        token.setTarget(manager, market.key, address(market.executor));
    }

    // ---- the hook's declared surface, and the one the bytecode actually dispatches -----------------------------------

    function _declaredHookSelectors() private view returns (bytes4[] memory out) {
        UnicaMarketHook h = market.hook;
        out = new bytes4[](30);
        // BaseHook's ten callbacks, in IHooks' own order.
        out[0] = h.beforeInitialize.selector;
        out[1] = h.afterInitialize.selector;
        out[2] = h.beforeAddLiquidity.selector;
        out[3] = h.afterAddLiquidity.selector;
        out[4] = h.beforeRemoveLiquidity.selector;
        out[5] = h.afterRemoveLiquidity.selector;
        out[6] = h.beforeSwap.selector;
        out[7] = h.afterSwap.selector;
        out[8] = h.beforeDonate.selector;
        out[9] = h.afterDonate.selector;
        // BaseHook's two views.
        out[10] = h.getHookPermissions.selector;
        out[11] = h.poolManager.selector;
        // The market's own identity (SC §8.1).
        out[12] = h.FACTORY.selector;
        out[13] = h.REGISTRY.selector;
        out[14] = h.MARKET_ID.selector;
        out[15] = h.EXECUTOR.selector;
        out[16] = h.POOL_ID.selector;
        out[17] = h.ASSET_TOKEN.selector;
        out[18] = h.PAYOUT_TOKEN.selector;
        out[19] = h.FEE.selector;
        out[20] = h.TICK_SPACING.selector;
        out[21] = h.ASSET_DECIMALS.selector;
        out[22] = h.PAYOUT_DECIMALS.selector;
        out[23] = h.ASSET_IS_CURRENCY0.selector;
        out[24] = h.REQUIRE_ORACLE.selector;
        // The four the settlement and its readers use.
        out[25] = h.HOOK_FEE_PIPS.selector;
        out[26] = h.receiptCount.selector;
        out[27] = h.SETTLEMENT_RECEIPT_TOPIC.selector;
        out[28] = h.feeRates.selector;
        out[29] = h.oracleCondition.selector;
    }

    /// @dev The legacy code generator dispatches with a chain of `DUP1 PUSH4 <selector> EQ …`. This
    ///      recovers every selector that appears in that exact shape, deduplicated. A `PUSH4` used as
    ///      a pivot in a binary split is followed by `GT`/`LT`, not `EQ`, so it is not collected.
    function _dispatchedSelectors(bytes memory code) private pure returns (bytes4[] memory out) {
        bytes4[] memory buffer = new bytes4[](256);
        uint256 n;
        for (uint256 i; i + 5 < code.length; ++i) {
            if (uint8(code[i]) != 0x63) continue; // PUSH4
            if (uint8(code[i + 5]) != 0x14) continue; // EQ
            bytes4 selector = bytes4(
                uint32(uint8(code[i + 1])) << 24 | uint32(uint8(code[i + 2])) << 16 | uint32(uint8(code[i + 3])) << 8
                    | uint32(uint8(code[i + 4]))
            );
            bool seen;
            for (uint256 j; j < n; ++j) {
                if (buffer[j] == selector) {
                    seen = true;
                    break;
                }
            }
            if (!seen) buffer[n++] = selector;
        }
        out = new bytes4[](n);
        for (uint256 i; i < n; ++i) {
            out[i] = buffer[i];
        }
    }

    function _contains(bytes4[] memory haystack, bytes4 needle) private pure returns (bool) {
        for (uint256 i; i < haystack.length; ++i) {
            if (haystack[i] == needle) return true;
        }
        return false;
    }

    /// @dev Pulls the hook's own selector and arguments out of the PoolManager's `WrappedError`.
    function _unwrapHookError(bytes memory err) internal pure returns (bytes4 innerSelector, bytes memory reason) {
        bytes memory payload = new bytes(err.length - 4);
        for (uint256 i; i < payload.length; ++i) {
            payload[i] = err[i + 4];
        }
        (,, bytes memory inner,) = abi.decode(payload, (address, bytes4, bytes, bytes));
        innerSelector = bytes4(inner);
        reason = new bytes(inner.length - 4);
        for (uint256 i; i < reason.length; ++i) {
            reason[i] = inner[i + 4];
        }
    }
}

/// @dev A swapper that takes the PoolManager lock itself, so it can be etched at one market's
///      executor address and pointed at another market's pool. Row H5c (C18).
contract ForeignSwapper is IUnlockCallback {
    IPoolManager private _manager;
    PoolKey private _key;
    bool private _zeroForOne;
    uint256 private _amount;

    function configure(IPoolManager manager_) external {
        _manager = manager_;
    }

    function swap(PoolKey memory key_, bool zeroForOne, uint256 amount) external {
        _key = key_;
        _zeroForOne = zeroForOne;
        _amount = amount;
        _manager.unlock("");
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        _manager.swap(
            _key,
            SwapParams({
                zeroForOne: _zeroForOne,
                amountSpecified: -int256(_amount),
                sqrtPriceLimitX96: _zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        return "";
    }
}

/// @title The two factory refusals the review found declared and never reached
/// @notice `HookDeployFailed` and `OpeningTickMismatch` are `UnicaMarketFactory`'s, and the hook test
///         base deliberately plays the factory itself rather than deploying one — so neither is
///         reachable through it. This contract stands up a real factory for the two rows.
contract GuardsFactoryTest is Test {
    uint160 internal constant FLAGS = 0x20C0;
    uint24 internal constant FEE = 3000;
    int24 internal constant SPACING = 60;
    uint256 internal constant RATE = 1e18;

    IPoolManager internal manager;
    UnicaMarketFactory internal factory;
    UnicaMarketRegistry internal registry;

    address internal admin = makeAddr("admin");
    MockERC20 internal asset;
    MockERC20 internal payout;

    function setUp() public {
        manager = IPoolManager(V4PoolManagerDeployer.deploy(address(this)));
        factory = new UnicaMarketFactory(admin, manager, keccak256(type(UnicaMarketHook).creationCode), false);
        registry = factory.REGISTRY();
        asset = new MockERC20("Guards Asset", "GA", 18);
        payout = new MockERC20("Guards Payout", "GP", 6);
    }

    /// @notice The address is mined, so the flag pre-check passes and CREATE2 is really attempted —
    ///         and then it lands on an address that is already occupied, which is the only way the
    ///         post-deploy check can be the one that fires.
    function test_HookDeployFailed_anOccupiedAddressIsRefusedAfterTheFlagCheck() public {
        (UnicaMarketTypes.MarketConfig memory config, bytes32 salt, address predicted) = _minedConfig();
        assertEq(uint160(predicted) & 0x3FFF, FLAGS, "the salt was not mined; this row would test the wrong check");

        vm.etch(predicted, hex"60006000f3");

        vm.prank(admin);
        vm.expectRevert(UnicaMarketFactory.HookDeployFailed.selector);
        factory.createMarket(config, salt, type(UnicaMarketHook).creationCode);
        assertEq(registry.marketCount(), 0, "a market was registered behind a failed deploy");

        // Control: the SAME config and the SAME salt, with the squatter removed. The only difference
        // between the refusal above and the creation below is whether the address was occupied.
        vm.etch(predicted, "");
        vm.prank(admin);
        (, address hook,) = factory.createMarket(config, salt, type(UnicaMarketHook).creationCode);
        assertEq(hook, predicted, "the control hook did not land where it was predicted");
        assertEq(registry.marketCount(), 1, "the control did not register");
    }

    /// @notice The tick the PoolManager returns is the only thing this check has to disagree with, and
    ///         nothing reachable from the factory can make the real manager return the wrong one — the
    ///         record's `initTick` is derived from the same `initSqrtPriceX96` the call passes. So the
    ///         manager's answer is mocked for exactly one call, which is the cheapest faithful
    ///         stand-in for a pool that opened somewhere other than where the record says.
    function test_OpeningTickMismatch_aPoolThatOpensAtTheWrongTickIsRefused() public {
        (UnicaMarketTypes.MarketConfig memory config, bytes32 salt,) = _minedConfig();
        vm.prank(admin);
        (bytes32 id,,) = factory.createMarket(config, salt, type(UnicaMarketHook).creationCode);

        int24 expectedTick = registry.getMarket(id).initTick;
        int24 wrongTick = expectedTick + SPACING;

        vm.mockCall(address(manager), abi.encodeWithSelector(IPoolManager.initialize.selector), abi.encode(wrongTick));
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketFactory.OpeningTickMismatch.selector, expectedTick, wrongTick)
        );
        factory.initializeMarket(id);
        vm.clearMockedCalls();

        assertEq(registry.statusOf(id), uint8(UnicaMarketTypes.MarketStatus.PROPOSED), "the market advanced anyway");

        // Control: the real manager opens the pool at the recorded tick and the market advances.
        vm.prank(admin);
        int24 got = factory.initializeMarket(id);
        assertEq(got, expectedTick, "the pool did not open at the recorded tick");
        assertEq(registry.statusOf(id), uint8(UnicaMarketTypes.MarketStatus.INITIALIZED), "the market did not advance");
    }

    // ---- helpers ---------------------------------------------------------------------------------------------

    function _minedConfig()
        private
        view
        returns (UnicaMarketTypes.MarketConfig memory config, bytes32 salt, address predicted)
    {
        config.asset = address(asset);
        config.payout = address(payout);
        config.rateE18 = RATE;
        config.fee = FEE;
        config.tickSpacing = SPACING;
        config.policy = UnicaMarketTypes.OraclePolicy(address(0), bytes32(0), 0, 0, false);
        config.caps = UnicaMarketTypes.Caps(type(uint128).max / 4, type(uint128).max / 2, type(uint128).max);

        (,, bytes memory args,) = factory.previewMarket(config);
        (predicted, salt) = HookSalt.find(address(factory), FLAGS, type(UnicaMarketHook).creationCode, args);
    }
}
