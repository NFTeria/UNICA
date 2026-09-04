// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SettlementTestBase} from "./utils/SettlementTestBase.sol";
import {V4SettlementHook} from "../src/V4SettlementHook.sol";
import {SettlementExecutor} from "../src/SettlementExecutor.sol";

/// @title The receipt schema, version 1, as a conformance suite
/// @notice `docs/RECEIPT-SCHEMA.md` frozen as tests. Every assertion is one an indexer relies on:
///         exactly one receipt per settlement; the receipt's amounts equal the PoolManager's own
///         swap deltas and the recipient's balance change; the log order within the transaction;
///         decoding by topic and version alone, never by a hard-coded hook address, proven with
///         two hooks at two addresses; the uniqueness key; and the documented topic. The refusal
///         side (no receipt on a reverted, partial, wrong-caller, malformed, or replayed settlement)
///         is proven in the hook and executor suites and listed in the schema document.
contract ReceiptSchemaTest is SettlementTestBase {
    using PoolIdLibrary for PoolKey;

    /// @dev v4-core's Swap event, the PoolManager's own record of the amounts.
    bytes32 internal constant PM_SWAP_TOPIC =
        keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
    bytes32 internal constant ERC20_TRANSFER_TOPIC = keccak256("Transfer(address,address,uint256)");
    /// @dev The topic as written in docs/RECEIPT-SCHEMA.md. Binding the document to the code.
    bytes32 internal constant DOCUMENTED_TOPIC = 0xf9b834e9c2d7d0250251dfdb3c5fdc3f97d829dbe3402f45c89257ab4ec43563;

    address internal merchant = makeAddr("merchant");
    address internal payer = makeAddr("payer");
    PoolKey internal key;
    uint128 internal constant AMOUNT_IN = 1e15;

    /// @dev The non-indexed part of the event, a static tuple, decoded in one step.
    struct ReceiptData {
        uint16 version;
        address payer;
        address executor;
        address currencyIn;
        address currencyOut;
        uint128 amountIn;
        uint128 amountOut;
        uint128 fee;
        bytes32 policyId;
    }

    struct Decoded {
        address hook;
        bytes32 orderId;
        bytes32 poolId;
        address recipient;
        ReceiptData data;
        uint256 logIndex;
    }

    function setUp() public {
        setUpV4();
        deploySettlement();
        (key,) = initNativePoolWithLiquidity(IHooks(address(hook)), 10 ether);
        vm.deal(payer, 1 ether);
    }

    /// @notice The documented topic is the code's topic, and the version is one.
    function test_Schema_TopicAndVersionAreTheDocumentedOnes() public view {
        assertEq(RECEIPT_TOPIC, DOCUMENTED_TOPIC, "docs/RECEIPT-SCHEMA.md and the event signature disagree");
        assertEq(hook.RECEIPT_SCHEMA_VERSION(), 1);
    }

    /// @notice Exactly one receipt per settlement, and its amounts are the PoolManager's own swap
    ///         deltas and the recipient's balance change, not a restatement of the order.
    function test_Schema_OneReceiptWhoseAmountsAreTheDeltasAndTheBalanceChange() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        uint256 before = usdc.balanceOf(merchant);
        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        Decoded[] memory receipts = _decode(logs);
        assertEq(receipts.length, 1, "exactly one receipt");
        Decoded memory r = receipts[0];
        (int128 amount0, int128 amount1) = _poolManagerSwapDeltas(logs);
        assertEq(uint256(r.data.amountIn), uint256(uint128(-amount0)), "amountIn is not the PoolManager's amount0");
        assertEq(uint256(r.data.amountOut), uint256(uint128(amount1)), "amountOut is not the PoolManager's amount1");
        assertEq(usdc.balanceOf(merchant) - before, r.data.amountOut, "amountOut is not the recipient's balance change");
        assertEq(r.hook, address(key.hooks), "the emitter is not the pool's hook");
        assertEq(r.orderId, orderId);
        assertEq(r.poolId, PoolId.unwrap(key.toId()));
        assertEq(r.recipient, merchant);
        assertEq(r.data.payer, payer);
        assertEq(r.data.executor, address(executor));
        assertEq(r.data.currencyIn, address(0));
        assertEq(r.data.currencyOut, address(usdc));
        assertEq(r.data.fee, 0);
        assertEq(r.data.policyId, bytes32(0));
    }

    /// @notice Log order inside one transaction: the PoolManager's Swap, then the receipt, then the
    ///         standard HookFee, then the token's Transfer to the recipient (the router's take). The
    ///         receipt precedes payment in the log, which is why the executor verifies the recipient
    ///         afterwards and reverts, receipt included, if the payment fell short.
    function test_Schema_LogOrderIsSwapReceiptFeeThenPayment() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 swapAt = _indexOf(logs, address(manager), PM_SWAP_TOPIC);
        uint256 receiptAt = _indexOf(logs, address(hook), RECEIPT_TOPIC);
        uint256 feeAt = _indexOf(logs, address(hook), HOOK_FEE_TOPIC);
        uint256 payAt = _indexOfTransferTo(logs, address(usdc), merchant);
        assertLt(swapAt, receiptAt, "receipt before the PoolManager's Swap");
        assertLt(receiptAt, feeAt, "HookFee before the receipt");
        assertLt(feeAt, payAt, "the recipient was paid before the receipt");
    }

    /// @notice Decoding depends on the topic and the version, never on a hook address: two hooks at
    ///         two addresses, each with its own executor and pool, each settle one order, and one
    ///         decoder reconstructs both with the emitter as the hook. The uniqueness keys differ.
    function test_Schema_DecodingIsHookAddressAgnostic() public {
        address secondAddr = address(uint160(DECLARED_MASK) ^ (0x5555 << 144));
        deployCodeTo("V4SettlementHook.sol:V4SettlementHook", "", secondAddr);
        V4SettlementHook second = V4SettlementHook(secondAddr);
        deployCodeTo("SettlementExecutor.sol:SettlementExecutor", abi.encode(secondAddr), second.SETTLEMENT_EXECUTOR());
        SettlementExecutor secondExecutor = SettlementExecutor(second.SETTLEMENT_EXECUTOR());
        (PoolKey memory secondKey,) = initNativePoolWithLiquidity(IHooks(secondAddr), 10 ether);

        vm.recordLogs();
        bytes32 a = _order(AMOUNT_IN, 1);
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(a);
        vm.prank(merchant);
        bytes32 b =
            secondExecutor.createOrder(merchant, secondKey, AMOUNT_IN, 1, uint64(block.timestamp + 1 hours), _salt());
        vm.prank(payer);
        secondExecutor.pay{value: AMOUNT_IN}(b);

        Decoded[] memory receipts = _decode(vm.getRecordedLogs());
        assertEq(receipts.length, 2, "two settlements, two receipts");
        assertEq(receipts[0].hook, address(hook));
        assertEq(receipts[1].hook, secondAddr);
        assertEq(receipts[0].orderId, a);
        assertEq(receipts[1].orderId, b);
        assertEq(receipts[0].data.executor, address(executor));
        assertEq(receipts[1].data.executor, address(secondExecutor));
        bytes32 keyA = keccak256(abi.encode(block.chainid, receipts[0].hook, receipts[0].orderId));
        bytes32 keyB = keccak256(abi.encode(block.chainid, receipts[1].hook, receipts[1].orderId));
        assertTrue(keyA != keyB, "uniqueness keys collide");
    }

    /// @notice One order id yields at most one receipt across transactions: a second payment of a
    ///         settled order is refused before any swap, and the counter does not move.
    function test_Schema_DuplicateOrderIdCannotProduceTwoReceipts() public {
        bytes32 orderId = _order(AMOUNT_IN, 1);
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
        assertEq(hook.receiptCount(), 1);
        vm.expectRevert(
            abi.encodeWithSelector(SettlementExecutor.OrderNotOpen.selector, orderId, SettlementExecutor.Status.Settled)
        );
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
        assertEq(hook.receiptCount(), 1, "a second receipt for one order");
    }

    // ------------------------------------------------------------------ the decoder an indexer would write

    /// @dev Filters by topic and version only. The hook is whatever emitted the log.
    function _decode(Vm.Log[] memory logs) internal pure returns (Decoded[] memory out) {
        uint256 n;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == RECEIPT_TOPIC) n++;
        }
        out = new Decoded[](n);
        uint256 k;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] != RECEIPT_TOPIC) continue;
            Decoded memory d = _decodeOne(logs[i]);
            if (d.data.version != 1) continue;
            d.logIndex = i;
            out[k++] = d;
        }
        assembly ("memory-safe") {
            mstore(out, k)
        }
    }

    function _decodeOne(Vm.Log memory log) internal pure returns (Decoded memory d) {
        d.hook = log.emitter;
        d.orderId = log.topics[1];
        d.poolId = log.topics[2];
        d.recipient = address(uint160(uint256(log.topics[3])));
        d.data = abi.decode(log.data, (ReceiptData));
    }

    function _poolManagerSwapDeltas(Vm.Log[] memory logs) internal view returns (int128 amount0, int128 amount1) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(manager) && logs[i].topics[0] == PM_SWAP_TOPIC) {
                (amount0, amount1,,,,) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                return (amount0, amount1);
            }
        }
        revert("no PoolManager Swap event");
    }

    function _indexOf(Vm.Log[] memory logs, address emitter, bytes32 topic) internal pure returns (uint256) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == emitter && logs[i].topics[0] == topic) return i;
        }
        revert("event not found");
    }

    function _indexOfTransferTo(Vm.Log[] memory logs, address token, address to) internal pure returns (uint256) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].emitter == token && logs[i].topics[0] == ERC20_TRANSFER_TOPIC
                    && address(uint160(uint256(logs[i].topics[2]))) == to
            ) return i;
        }
        revert("transfer not found");
    }

    function _order(uint128 amountIn, uint128 minOut) internal returns (bytes32) {
        vm.prank(merchant);
        return executor.createOrder(merchant, key, amountIn, minOut, uint64(block.timestamp + 1 hours), _salt());
    }
}
