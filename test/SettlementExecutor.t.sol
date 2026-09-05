// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {SettlementTestBase} from "./utils/SettlementTestBase.sol";
import {FeeOnTakeERC20} from "./utils/FeeOnTakeERC20.sol";
import {ReenteringERC20, IPayable} from "./utils/ReenteringERC20.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {V4SettlementHook} from "../src/V4SettlementHook.sol";
import {SettlementExecutor} from "../src/SettlementExecutor.sol";

/// @title Tests for the executor: invariant I1's positive path through the official router, the
///        receipt (I2), and the order rules
/// @notice Every assertion is about SHAPE, never the implementation's arithmetic: who received, who
///         paid, that neither the executor nor the router holds anything, that the hook receipted
///         exactly one settlement, and that each refusal leaves the order payable (invariant I6).
contract SettlementExecutorTest is SettlementTestBase {
    using PoolIdLibrary for PoolKey;

    address internal merchant = makeAddr("merchant");
    address internal payer = makeAddr("payer");
    PoolKey internal key;

    uint128 internal constant AMOUNT_IN = 1e15;
    /// @dev Threat T12; set from the measurement in test_Gas_OneSettlementStaysUnderTheCeiling.
    uint256 internal constant SETTLEMENT_GAS_CEILING = 300_000;

    function setUp() public {
        setUpV4();
        deploySettlement();
        (key,) = initNativePoolWithLiquidity(IHooks(address(hook)), 10 ether);
        vm.deal(payer, 1 ether);
    }

    // ------------------------------------------------------------------ I1, the positive path

    /// @notice Invariant I1. Through Uniswap's own router, the order's recipient, and nobody else,
    ///         receives the output; the payer pays exactly the order's amount; the executor and the
    ///         router end with nothing; the hook receipted one settlement; the order is Settled.
    function test_SettlementDeliversToTheRegisteredRecipient() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        uint256 merchantBefore = usdc.balanceOf(merchant);
        uint256 payerBefore = payer.balance;
        assertEq(address(executor).balance, 0);

        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);

        (uint256 receipts, uint256 amountOut) = receiptsEmitted();
        assertEq(receipts, 1, "exactly one receipt");
        assertGt(amountOut, 0, "no output");
        assertEq(usdc.balanceOf(merchant) - merchantBefore, amountOut, "recipient did not receive the receipted output");
        assertEq(usdc.balanceOf(payer), 0, "payer must not receive output");
        assertEq(usdc.balanceOf(address(executor)), 0, "executor must not keep output");
        assertEq(usdc.balanceOf(universalRouter), 0, "router must not keep output");
        assertEq(payerBefore - payer.balance, AMOUNT_IN, "payer paid something other than the order amount");
        assertEq(address(executor).balance, 0, "executor holds native value after settlement");
        assertEq(universalRouter.balance, 0, "router holds native value after settlement");
        assertEq(hook.receiptCount(), 1, "the hook did not receipt exactly one settlement");
        SettlementExecutor.Order memory o = executor.orders(orderId);
        assertEq(uint8(o.status), uint8(SettlementExecutor.Status.Settled));
        assertEq(o.payer, payer, "the payer was not recorded");
    }

    /// @notice Invariant I2. One receipt, from the hook, inside the settling swap, in schema v1: the
    ///         version, the order id, the pool, the recipient, the authenticated payer (resolved
    ///         through the router's msgSender and the order, never from hook data), the executor,
    ///         both currencies, both amounts, a zero fee, and a zero policy id. Beside it, exactly one
    ///         OpenZeppelin-standard HookFee, so a generic indexer sees the settlement too.
    function test_ReceiptCarriesTheOrderAndTheStandardEvent() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 receipts;
        uint256 fees;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(hook)) continue;
            if (logs[i].topics[0] == RECEIPT_TOPIC) {
                receipts++;
                assertEq(logs[i].topics[1], orderId, "receipt names another order");
                assertEq(logs[i].topics[2], PoolId.unwrap(key.toId()), "receipt names another pool");
                assertEq(address(uint160(uint256(logs[i].topics[3]))), merchant, "receipt names another recipient");
                _assertReceiptData(logs[i].data);
            } else if (logs[i].topics[0] == HOOK_FEE_TOPIC) {
                fees++;
                assertEq(logs[i].topics[1], PoolId.unwrap(key.toId()));
                assertEq(address(uint160(uint256(logs[i].topics[2]))), payer);
                (uint128 fee0, uint128 fee1) = abi.decode(logs[i].data, (uint128, uint128));
                assertEq(fee0, 0);
                assertEq(fee1, 0);
            }
        }
        assertEq(receipts, 1, "exactly one SettlementReceipt");
        assertEq(fees, 1, "exactly one HookFee");
    }

    function _assertReceiptData(bytes memory data) internal view {
        (
            uint16 version,
            address p,
            address exec,
            address currencyIn,
            address currencyOut,
            uint128 amountIn,
            uint128 amountOut,
            uint128 fee,
            bytes32 policyId
        ) = abi.decode(data, (uint16, address, address, address, address, uint128, uint128, uint128, bytes32));
        assertEq(version, hook.RECEIPT_SCHEMA_VERSION(), "schema version");
        assertEq(version, 1, "schema v1 is what this test knows");
        assertEq(p, payer, "receipt names another payer");
        assertEq(exec, address(executor), "receipt names another executor");
        assertEq(currencyIn, address(0), "input currency is native ETH");
        assertEq(currencyOut, address(usdc), "output currency is the pool's currency1");
        assertEq(amountIn, AMOUNT_IN);
        assertEq(amountOut, usdc.balanceOf(merchant), "receipted output differs from what arrived");
        assertEq(fee, 0, "this hook takes no fee");
        assertEq(policyId, bytes32(0), "no benefit applied, so no policy id");
    }

    /// @notice Every payment size the pool can fill is delivered once and receipted once. The upper
    ///         bound is below the ETH the liquidity band holds (about 6e15 wei for 1e18 liquidity at
    ///         plus or minus 120 ticks); a larger order is a partial fill, tested separately below.
    function testFuzz_EveryPaymentIsDeliveredOnce(uint128 amountIn) public {
        amountIn = uint128(bound(amountIn, 1e9, 5e15));
        bytes32 orderId = _order(amountIn, 1);
        uint256 merchantBefore = usdc.balanceOf(merchant);
        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: amountIn}(orderId);
        (uint256 receipts, uint256 amountOut) = receiptsEmitted();
        assertEq(receipts, 1);
        assertEq(usdc.balanceOf(merchant) - merchantBefore, amountOut);
        assertEq(address(executor).balance, 0);
        assertEq(universalRouter.balance, 0);
        assertEq(hook.receiptCount(), 1);
    }

    // ------------------------------------------------------------------ the order rules

    /// @notice Invariant I5 at the executor: one order settles at most once.
    function test_RevertWhen_OrderPaidTwice() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
        vm.expectRevert(
            abi.encodeWithSelector(SettlementExecutor.OrderNotOpen.selector, orderId, SettlementExecutor.Status.Settled)
        );
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
    }

    /// @notice Invariant I4 at the executor: an order cannot be paid past its deadline.
    function test_RevertWhen_OrderExpired() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        uint64 deadline = executor.orders(orderId).deadline;
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(SettlementExecutor.OrderExpired.selector, orderId, deadline));
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
    }

    /// @notice The payer must send exactly the order's amount; more or less is refused.
    function test_RevertWhen_ValueDiffersFromTheOrder() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        vm.expectRevert(abi.encodeWithSelector(SettlementExecutor.WrongValue.selector, AMOUNT_IN, AMOUNT_IN - 1));
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN - 1}(orderId);
        vm.expectRevert(abi.encodeWithSelector(SettlementExecutor.WrongValue.selector, AMOUNT_IN, AMOUNT_IN + 1));
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN + 1}(orderId);
    }

    /// @notice Invariant I6 at the HOOK: output below the order's minimum is refused inside the swap,
    ///         with the hook's own error, and the whole payment unwinds: the payer keeps the ETH, the
    ///         recipient receives nothing, the order stays payable, no receipt exists. The exact
    ///         output is measured first on a snapshot so the revert bytes are asserted exactly.
    function test_RevertWhen_OutputBelowMinimum_NothingMoves() public {
        uint256 snapshot = vm.snapshotState();
        bytes32 probe = _order(AMOUNT_IN, 1);
        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(probe);
        (, uint256 actualOut) = receiptsEmitted();
        vm.revertToState(snapshot);

        uint128 minOut = uint128(actualOut) + 1;
        bytes32 orderId = _order(AMOUNT_IN, minOut);
        uint256 payerBefore = payer.balance;
        vm.recordLogs();
        vm.expectRevert(
            _wrapped(
                IHooks.afterSwap.selector,
                abi.encodeWithSelector(
                    V4SettlementHook.OutputBelowMinimum.selector, orderId, minOut, uint128(actualOut)
                )
            )
        );
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
        _assertNothingMoved(orderId, payerBefore);
    }

    /// @notice Spec addendum A13 and invariant I6, now enforced by the HOOK: an order the pool cannot
    ///         fill in full is refused, never settled short. Found by the fuzzer on 2026-09-04 at
    ///         0.0428 ETH against a band holding about 0.006 ETH: the pool consumed
    ///         6,035,841,794,200,769 wei. Nothing moves and the order stays payable.
    function test_RevertWhen_PoolCannotFillTheOrder_NothingMoves() public {
        uint128 tooLarge = 42775716203246101;
        bytes32 orderId = _order(tooLarge, 1);
        uint256 payerBefore = payer.balance;
        vm.recordLogs();
        vm.expectRevert(
            _wrapped(
                IHooks.afterSwap.selector,
                abi.encodeWithSelector(
                    V4SettlementHook.PartialFill.selector, orderId, tooLarge, uint128(6035841794200769)
                )
            )
        );
        vm.prank(payer);
        executor.pay{value: tooLarge}(orderId);
        _assertNothingMoved(orderId, payerBefore);
    }

    function test_RevertWhen_OrderUnknown() public {
        bytes32 bogus = keccak256("no such order");
        vm.expectRevert(abi.encodeWithSelector(SettlementExecutor.UnknownOrder.selector, bogus));
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(bogus);
    }

    function test_RevertWhen_CreateOrderRejectsBadInputs() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        vm.expectRevert(SettlementExecutor.ZeroRecipient.selector);
        executor.createOrder(address(0), key, AMOUNT_IN, 1, deadline, _salt());
        vm.expectRevert(SettlementExecutor.ZeroAmount.selector);
        executor.createOrder(merchant, key, 0, 1, deadline, _salt());
        vm.expectRevert(SettlementExecutor.ZeroMinOut.selector);
        executor.createOrder(merchant, key, AMOUNT_IN, 0, deadline, _salt());
        vm.expectRevert(abi.encodeWithSelector(SettlementExecutor.DeadlineInPast.selector, uint64(block.timestamp)));
        executor.createOrder(merchant, key, AMOUNT_IN, 1, uint64(block.timestamp), _salt());
        PoolKey memory erc20In = key;
        erc20In.currency0 = usdcCurrency;
        vm.expectRevert(SettlementExecutor.NativeInputOnly.selector);
        executor.createOrder(merchant, erc20In, AMOUNT_IN, 1, deadline, _salt());
    }

    /// @notice An order may name only a pool this executor's hook guards. A key with no hook, and a
    ///         key with a different hook, are both refused at creation, so no settlement can run with
    ///         none of I3 to I6 enforced and no receipt.
    function test_RevertWhen_OrderNamesAPoolTheHookDoesNotGuard() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        PoolKey memory hookless = key;
        hookless.hooks = IHooks(address(0));
        vm.expectRevert(abi.encodeWithSelector(SettlementExecutor.PoolNotGuarded.selector, address(0)));
        executor.createOrder(merchant, hookless, AMOUNT_IN, 1, deadline, _salt());
        PoolKey memory otherHook = key;
        otherHook.hooks = IHooks(address(uint160(DECLARED_MASK) ^ (0x5555 << 144)));
        vm.expectRevert(abi.encodeWithSelector(SettlementExecutor.PoolNotGuarded.selector, address(otherHook.hooks)));
        executor.createOrder(merchant, otherHook, AMOUNT_IN, 1, deadline, _salt());
        assertEq(executor.orderCount(), 0, "a refused order was counted");
    }

    /// @notice Invariant I3 where it is felt, at the recipient. A payout token that burns a share of
    ///         every transfer out of the PoolManager (spec C4's hazard) leaves the recipient short of
    ///         what the pool credited. The hook cannot see that: it enforces the minimum on the
    ///         credit. The executor measures the recipient's balance and refuses the order, so the
    ///         payer keeps the ETH and the order stays payable. The control: the same order with a
    ///         minimum at what actually arrives settles, and the executor's own event records the
    ///         delivered amount while the hook's receipt records the pool's credit.
    function test_RevertWhen_RecipientReceivesLessThanTheMinimum_FeeOnTransfer() public {
        // The payout currency is fixed by the chain (spec C2, C4), so a hostile token cannot be
        // brought in as currency1 at all. The residual risk the allowlist does not remove is the
        // sanctioned token itself behaving this way, so that is what is tested: the fee-on-take
        // runtime is placed at the payout address, keeping the balances already there.
        FeeOnTakeERC20 template = new FeeOnTakeERC20(address(manager), 100);
        vm.etch(address(usdc), address(template).code);
        FeeOnTakeERC20 fot = FeeOnTakeERC20(address(usdc));
        PoolKey memory fotKey = key;

        // Measure the pool's credit for this order size on a snapshot, then unwind.
        uint256 snapshot = vm.snapshotState();
        vm.prank(merchant);
        bytes32 probe = executor.createOrder(merchant, fotKey, AMOUNT_IN, 1, uint64(block.timestamp + 1 hours), _salt());
        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(probe);
        (, uint256 credit) = receiptsEmitted();
        uint256 delivered = fot.balanceOf(merchant);
        assertLt(delivered, credit, "the control token did not take a fee");
        vm.revertToState(snapshot);

        // The order asks for the full credit: the pool gives it, the token does not deliver it, refused.
        vm.prank(merchant);
        bytes32 orderId = executor.createOrder(
            merchant, fotKey, AMOUNT_IN, uint128(credit), uint64(block.timestamp + 1 hours), _salt()
        );
        uint256 payerBefore = payer.balance;
        vm.expectRevert(
            abi.encodeWithSelector(SettlementExecutor.RecipientShort.selector, orderId, uint128(credit), delivered)
        );
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
        assertEq(payer.balance, payerBefore, "payer lost value on a refused payment");
        assertEq(fot.balanceOf(merchant), 0, "recipient received output from a refused payment");
        assertEq(uint8(executor.orders(orderId).status), uint8(SettlementExecutor.Status.Open));
        assertEq(hook.receiptCount(), 0, "the hook receipted a refused settlement");

        // The control: a minimum at what arrives settles, and the two records say what each measured.
        vm.prank(merchant);
        bytes32 ok = executor.createOrder(
            merchant, fotKey, AMOUNT_IN, uint128(delivered), uint64(block.timestamp + 1 hours), _salt()
        );
        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(ok);
        (uint256 receipts, uint256 receiptedCredit) = receiptsEmitted();
        assertEq(receipts, 1);
        assertEq(receiptedCredit, credit, "the hook's receipt records the pool's credit");
        assertEq(fot.balanceOf(merchant), delivered, "the recipient received the delivered amount");
        assertEq(hook.receiptCount(), 1);
    }

    /// @notice No settlement may name a contract on its own path as the recipient. Output sent to
    ///         the router is sweepable by whoever calls it next; output sent to the executor, the
    ///         hook or the PoolManager is stranded, since none of them can move a token out. All six
    ///         reserved addresses are refused where the order is created (day-5 attack review).
    function test_RevertWhen_RecipientIsAContractOnThePath() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        address[6] memory reserved =
            [address(1), address(2), executor.UNIVERSAL_ROUTER(), address(executor), address(hook), address(manager)];
        for (uint256 i = 0; i < reserved.length; i++) {
            vm.expectRevert(abi.encodeWithSelector(SettlementExecutor.ReservedRecipient.selector, reserved[i]));
            executor.createOrder(reserved[i], key, AMOUNT_IN, 1, deadline, _salt());
        }
        assertEq(executor.orderCount(), 0, "a refused order was counted");
    }

    /// @notice The executor has no door to the PoolManager at all: it never unlocks, so it has no
    ///         unlock callback to guard. The official router owns that surface.
    function test_ExecutorHasNoUnlockCallback() public {
        (bool ok,) = address(executor).call(abi.encodeWithSignature("unlockCallback(bytes)", ""));
        assertFalse(ok, "the executor answered an unlock callback");
    }

    /// @notice The executor has no receive function: value can only arrive through pay.
    function test_RevertWhen_NativeSentDirectly() public {
        (bool ok,) = address(executor).call{value: 1}("");
        assertFalse(ok, "executor accepted a bare transfer");
        assertEq(address(executor).balance, 0);
    }

    /// @notice Order ids are bound to the chain, the executor, and the creator, and are known before
    ///         the call: the same creator and salt is refused, and another creator with the same salt
    ///         gets a different id. A deploy script can therefore pay the id it simulated.
    function test_OrderIdsAreChainBoundCreatorBoundAndKnownInAdvance() public {
        bytes32 salt = keccak256("order salt");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 expected = keccak256(abi.encode(block.chainid, address(executor), merchant, salt));
        vm.prank(merchant);
        bytes32 a = executor.createOrder(merchant, key, AMOUNT_IN, 1, deadline, salt);
        assertEq(a, expected, "the id is not the documented derivation");
        vm.expectRevert(abi.encodeWithSelector(SettlementExecutor.OrderExists.selector, expected));
        vm.prank(merchant);
        executor.createOrder(merchant, key, AMOUNT_IN, 1, deadline, salt);
        vm.prank(payer);
        bytes32 b = executor.createOrder(merchant, key, AMOUNT_IN, 1, deadline, salt);
        assertTrue(a != b, "two creators collided on one salt");
        assertEq(executor.orderCount(), 2);
    }

    // ------------------------------------------------------------------ T9, dust

    /// @notice Threat T9, the control. The plan settles the whole debt and takes the whole credit
    ///         (`OPEN_DELTA`), never a caller-typed amount a rounding could strand or a `clear()` could
    ///         forfeit. An input small enough that the fee rounds up against it still settles, and
    ///         every unit the pool credited reaches the recipient; nothing stays on the path.
    function test_SmallSettlementReachesTheRecipientWhole() public {
        bytes32 small = _order(1_000, 1);
        uint256 merchantBefore = usdc.balanceOf(merchant);
        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: 1_000}(small);

        (uint256 receipts, uint256 credited) = receiptsEmitted();
        assertEq(receipts, 1);
        assertGt(credited, 0, "the control produced no output; it is not a control");
        assertLt(credited, 1_000, "the control did not cross the fee; it is not small");
        assertEq(usdc.balanceOf(merchant) - merchantBefore, credited, "the credit did not reach the recipient whole");
        assertEq(usdc.balanceOf(universalRouter), 0, "output stayed on the router");
        assertEq(usdc.balanceOf(address(executor)), 0, "output stayed on the executor");
        assertEq(universalRouter.balance, 0);
        assertEq(address(executor).balance, 0);
    }

    /// @notice Threat T9, the dust row. One wei of input is consumed whole by the fee and yields no
    ///         output at all. The hook refuses the order below its minimum inside the swap, so the pool
    ///         is never asked to settle a nothing: the payer keeps the wei, the order stays payable.
    function test_RevertWhen_DustYieldsNoOutput_NothingMoves() public {
        bytes32 dust = _order(1, 1);
        uint256 payerBefore = payer.balance;
        vm.recordLogs();
        vm.expectRevert(
            _wrapped(
                IHooks.afterSwap.selector,
                abi.encodeWithSelector(V4SettlementHook.OutputBelowMinimum.selector, dust, uint128(1), uint128(0))
            )
        );
        vm.prank(payer);
        executor.pay{value: 1}(dust);
        _assertNothingMoved(dust, payerBefore);
    }

    // ------------------------------------------------------------------ T6, reentrancy

    /// @notice Threat T6, the same order. A payout token that calls out on transfer re-enters `pay`
    ///         for the very order being paid, from inside the take that pays the recipient, while the
    ///         PoolManager is still unlocked. The order left Open before any external call (invariant
    ///         I5), so the inner payment is refused by the order's own state and its value goes back;
    ///         the outer settlement completes with exactly one receipt; the recipient is paid once.
    function test_ReentrantPaymentOfTheSameOrderIsRefusedByItsState() public {
        ReenteringERC20 token = _armablePayoutToken();
        bytes32 orderId = _order(AMOUNT_IN, 1);
        token.arm(IPayable(address(executor)), orderId, AMOUNT_IN);
        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);

        assertEq(token.reentries(), 1, "the token did not re-enter; this is not the test");
        assertFalse(token.innerSucceeded(), "a reentrant payment of the same order succeeded");
        assertEq(
            token.innerRevert(),
            abi.encodeWithSelector(SettlementExecutor.OrderNotOpen.selector, orderId, SettlementExecutor.Status.Paying)
        );
        (uint256 receipts, uint256 amountOut) = receiptsEmitted();
        assertEq(receipts, 1, "exactly one receipt");
        assertEq(usdc.balanceOf(merchant), amountOut, "the recipient was paid other than once");
        assertEq(hook.receiptCount(), 1);
        assertEq(uint8(executor.orders(orderId).status), uint8(SettlementExecutor.Status.Settled));
        assertEq(address(token).balance, AMOUNT_IN, "the token's value moved on a refused reentry");
    }

    /// @notice Threat T6, another order. The same token instead pays a second, open order from inside
    ///         the first one's unlock. That payment reaches the official router, whose own lock refuses
    ///         a nested execute (`ContractLocked`, universal-router `base/Lock.sol`) before the
    ///         PoolManager, whose `AlreadyUnlocked` would refuse it next, is even reached. Measured:
    ///         the prediction was the PoolManager's refusal; the router's came first. The refusal
    ///         unwinds the inner payment entirely, so the second order is not left Paying (a poisoned
    ///         order would be unpayable for ever) and it settles normally afterwards, the control.
    function test_ReentrantPaymentOfAnotherOrderIsRefusedByTheRouterLock_AndStaysPayable() public {
        ReenteringERC20 token = _armablePayoutToken();
        bytes32 first = _order(AMOUNT_IN, 1);
        bytes32 second = _order(AMOUNT_IN, 1);
        token.arm(IPayable(address(executor)), second, AMOUNT_IN);
        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(first);

        assertEq(token.reentries(), 1, "the token did not re-enter; this is not the test");
        assertFalse(token.innerSucceeded(), "a payment inside another payment's unlock succeeded");
        assertEq(token.innerRevert(), abi.encodeWithSelector(bytes4(keccak256("ContractLocked()"))));
        (uint256 receipts,) = receiptsEmitted();
        assertEq(receipts, 1, "the outer settlement did not produce exactly one receipt");
        assertEq(uint8(executor.orders(first).status), uint8(SettlementExecutor.Status.Settled));
        SettlementExecutor.Order memory o = executor.orders(second);
        assertEq(
            uint8(o.status),
            uint8(SettlementExecutor.Status.Open),
            "the refused inner payment poisoned the second order"
        );
        assertEq(o.payer, address(0), "the refused inner payment left a payer on the second order");

        // The control: the second order settles on its own afterwards.
        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(second);
        (receipts,) = receiptsEmitted();
        assertEq(receipts, 1);
        assertEq(hook.receiptCount(), 2);
        assertEq(uint8(executor.orders(second).status), uint8(SettlementExecutor.Status.Settled));
    }

    // ------------------------------------------------------------------ T12, gas

    /// @notice Threat T12. Neither the hook nor the executor loops over anything a caller controls;
    ///         this bounds one whole settlement, both callbacks included, at a ceiling a later change
    ///         cannot cross unnoticed. Measured at 236,726 gas on the commit that added this test
    ///         (the pool at 1:1 with one position, a cold order, a cold payer); the ceiling leaves room
    ///         for a compiler or a dependency to move, not for a loop.
    function test_Gas_OneSettlementStaysUnderTheCeiling() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        vm.prank(payer);
        uint256 before = gasleft();
        executor.pay{value: AMOUNT_IN}(orderId);
        uint256 used = before - gasleft();
        emit log_named_uint("settlement gas", used);
        assertLt(used, SETTLEMENT_GAS_CEILING, "the settlement crossed its gas ceiling");
        assertEq(hook.receiptCount(), 1);
    }

    // ------------------------------------------------------------------ helpers

    function _order(uint128 amountIn, uint128 minOut) internal returns (bytes32) {
        vm.prank(merchant);
        return executor.createOrder(merchant, key, amountIn, minOut, uint64(block.timestamp + 1 hours), _salt());
    }

    /// @dev The reentering runtime at the payout address, keeping the balances already there (the
    ///      same placement as the fee-on-take test: the payout currency is fixed by the chain, so
    ///      the residual risk is the sanctioned token itself behaving this way). Funded for one payment.
    function _armablePayoutToken() internal returns (ReenteringERC20 token) {
        ReenteringERC20 template = new ReenteringERC20(address(manager));
        vm.etch(address(usdc), address(template).code);
        token = ReenteringERC20(payable(address(usdc)));
        vm.deal(address(token), AMOUNT_IN);
    }

    /// @dev After a revert of the whole call these hold by EVM semantics; they are asserted so that a
    ///      future pay() that caught the failure and returned would be caught here, not by a reader.
    function _assertNothingMoved(bytes32 orderId, uint256 payerBefore) internal {
        assertEq(payer.balance, payerBefore, "payer lost value on a refused payment");
        assertEq(usdc.balanceOf(merchant), 0, "recipient received output from a refused payment");
        assertEq(address(executor).balance, 0);
        assertEq(universalRouter.balance, 0);
        assertEq(
            uint8(executor.orders(orderId).status),
            uint8(SettlementExecutor.Status.Open),
            "a refused payment consumed the order"
        );
        assertEq(hook.receiptCount(), 0, "the hook receipted a refused settlement");
        (uint256 receipts,) = receiptsEmitted();
        assertEq(receipts, 0, "a receipt was emitted for a refused settlement");
    }

    function _wrapped(bytes4 callback, bytes memory reason) internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            CustomRevert.WrappedError.selector,
            address(hook),
            callback,
            reason,
            abi.encodeWithSelector(Hooks.HookCallFailed.selector)
        );
    }
}
