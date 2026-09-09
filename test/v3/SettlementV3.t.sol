// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {RouterParamsCodec} from "../../src/compat/RouterParamsCodec.sol";
import {UnicaDeploymentsV3} from "../../src/v3/UnicaDeploymentsV3.sol";
import {UnicaExecutorV3} from "../../src/v3/UnicaExecutorV3.sol";
import {UnicaHookV3} from "../../src/v3/UnicaHookV3.sol";
import {UniversalRouterV2Sepolia} from "../utils/artifacts/UniversalRouterV2Sepolia.sol";
import {V3SettlementBase} from "./util/V3SettlementBase.sol";

/// @title The V3 settlement, and the guards around it, each broken on purpose
/// @notice Row 1 is the one that has to PASS: a whole settlement, through the official Universal
///         Router's real bytecode, encoded for the layout `UnicaDeploymentsV3` says this chain wants,
///         ending in the same twelve-field receipt V1 emits. Everything after it is that same
///         settlement with exactly one thing broken, so each guard is measured against a run that is
///         known to work rather than against nothing.
/// @dev Ethereum Sepolia locally, for the reason given in `V3SettlementBase`. The lead chain's
///      six-field router is measured against the real chain in `test/v3/DeploymentsV3Fork.t.sol`.
contract SettlementV3Test is V3SettlementBase {
    using PoolIdLibrary for PoolKey;

    uint128 internal constant AMOUNT_IN = 1e15;
    uint128 internal constant MIN_OUT = 9e14;

    PoolKey internal key;

    function setUp() public {
        setUpV3();
        key = initialisePoolWithLiquidity();
    }

    // ---- the row that must pass ------------------------------------------------------------------

    /// @notice A settlement, end to end: order registered, paid through the official router, merchant
    ///         paid at least the minimum, exactly one receipt, order Settled.
    function test_V3_1_SettlesThroughTheOfficialRouterAndReceipts() public {
        bytes32 orderId = _createOrder();

        uint256 merchantBefore = payout.balanceOf(merchant);
        assertEq(hook.receiptCount(), 0, "the hook had receipted something before this row ran");

        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(hook.receiptCount(), 1, "the hook did not receipt exactly one settlement");
        uint256 received = payout.balanceOf(merchant) - merchantBefore;
        assertGe(received, MIN_OUT, "the merchant received less than the order's minimum");

        UnicaExecutorV3.Order memory order = executor.orders(orderId);
        assertEq(uint8(order.status), uint8(UnicaExecutorV3.Status.Settled), "the order is not Settled");
        assertEq(order.payer, payer, "the order records the wrong payer");

        // The receipt exists, comes from the hook, and carries THIS order id and THIS merchant.
        // Read from the raw log rather than from `expectEmit`, because the claim being made includes
        // the topic itself: an indexer keyed on V1's topic must still find this one.
        (bool found, Vm.Log memory receipt) = _findReceipt(logs);
        assertTrue(found, "no SettlementReceipt was emitted");
        assertEq(receipt.emitter, address(hook), "the receipt did not come from the hook");
        assertEq(receipt.topics[1], orderId, "the receipt names a different order");
        assertEq(receipt.topics[2], PoolId.unwrap(key.toId()), "the receipt names a different pool");
        assertEq(address(uint160(uint256(receipt.topics[3]))), merchant, "the receipt names a different recipient");

        // Nothing was kept anywhere on the path.
        assertEq(address(executor).balance, 0, "the executor kept native value");
        assertEq(payout.balanceOf(address(executor)), 0, "the executor kept the payout token");
        assertEq(universalRouter.balance, 0, "the router kept native value");
        assertEq(payout.balanceOf(universalRouter), 0, "the router kept the payout token");
    }

    /// @notice The receipt's topic is V1's, so this generation reads on the existing indexer.
    /// @dev The one thing that would make a V3 deployment invisible to everything already built. It
    ///      is asserted against the signature STRING, so a reordered or retyped field breaks it.
    function test_V3_2_TheReceiptTopicIsUnchangedFromV1() public {
        bytes32 orderId = _createOrder();
        vm.recordLogs();
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
        (bool found, Vm.Log memory receipt) = _findReceipt(vm.getRecordedLogs());
        assertTrue(found, "no SettlementReceipt was emitted");
        assertEq(receipt.topics[0], RECEIPT_TOPIC, "the receipt topic moved, so every existing reader breaks");
        assertEq(hook.RECEIPT_SCHEMA_VERSION(), 1, "the schema version moved without the fields moving");
    }

    // ---- the layout, which is the whole reason V3 exists ------------------------------------------

    /// @notice On this chain the executor encodes the FIVE-field head, because that is what this
    ///         chain's router build decodes — and the plan it builds decodes back into the pinned
    ///         five-field struct field for field.
    /// @dev Decoding the bytes back is the check that matters. "The enum says Legacy" only proves the
    ///      table was read; decoding proves the bytes that would actually be sent have the shape the
    ///      router will read them with.
    function test_V3_3_ThePlanIsEncodedForThisChainsLayout() public {
        assertEq(
            uint8(executor.ROUTER_LAYOUT()),
            uint8(RouterParamsCodec.Layout.Legacy),
            "chain 11155111's router expects the five-field head"
        );
        assertEq(
            uint8(UnicaDeploymentsV3.routerLayout(LOCAL_CHAIN)),
            uint8(executor.ROUTER_LAYOUT()),
            "the executor and the table disagree about this chain"
        );

        bytes32 orderId = _createOrder();
        (bytes memory commands, bytes[] memory inputs) = executor.planFor(orderId);
        assertEq(commands.length, 1, "the plan is not one command");
        assertEq(uint8(commands[0]), 0x10, "the plan's command is not V4_SWAP");

        (, bytes[] memory params) = abi.decode(inputs[0], (bytes, bytes[]));
        IV4Router.ExactInputSingleParams memory p = abi.decode(params[0], (IV4Router.ExactInputSingleParams));
        assertEq(Currency.unwrap(p.poolKey.currency0), address(0), "the plan's input currency is not native");
        assertEq(Currency.unwrap(p.poolKey.currency1), address(payout), "the plan's output currency is not the payout");
        assertEq(address(p.poolKey.hooks), address(hook), "the plan names a pool this hook does not guard");
        assertTrue(p.zeroForOne, "the plan's direction is wrong");
        assertEq(p.amountIn, AMOUNT_IN, "the plan's input is not the order's");
        assertEq(p.amountOutMinimum, MIN_OUT, "the plan's minimum is not the order's");
        assertEq(p.hookData, abi.encode(orderId), "the plan carries something other than the order id");
    }

    /// @notice The six-field head is not what this chain's plan produces, and the two encodings really
    ///         are different bytes for the same order.
    /// @dev The control for the row above. Without it, "the plan decodes as five fields" would be
    ///      consistent with the codec producing one encoding for both layouts.
    function test_V3_4_TheTwoLayoutsAreDifferentBytesForTheSameOrder() public {
        bytes32 orderId = _createOrder();
        (, bytes[] memory inputs) = executor.planFor(orderId);
        (, bytes[] memory params) = abi.decode(inputs[0], (bytes, bytes[]));

        RouterParamsCodec.SwapExactInSingle memory p = RouterParamsCodec.SwapExactInSingle({
            poolKey: key,
            zeroForOne: true,
            amountIn: AMOUNT_IN,
            amountOutMinimum: MIN_OUT,
            minHopPriceX36: 0,
            hookData: abi.encode(orderId)
        });
        assertEq(params[0], RouterParamsCodec.encodeLegacy(p), "the plan is not the legacy encoding of this order");
        assertTrue(
            keccak256(params[0]) != keccak256(RouterParamsCodec.encodePerHop(p)),
            "the two layouts produced identical bytes, so nothing here distinguishes them"
        );
        // One extra static word, and nothing else: 32 bytes wider.
        assertEq(
            RouterParamsCodec.encodePerHop(p).length,
            params[0].length + 32,
            "the per-hop encoding is not exactly one word wider than the legacy one"
        );
    }

    // ---- the guard, broken on purpose ------------------------------------------------------------

    /// @notice SABOTAGE. Replace the router's runtime under a live executor and the settlement stops,
    ///         by name, before any value moves. Then put the real router back and the same order
    ///         settles — which is what makes the red above a measurement of the guard and not of the
    ///         damage.
    function test_V3_5_RouterReplacedUnderneathRefusesThenRecovers() public {
        bytes32 orderId = _createOrder();
        bytes32 expected = executor.UNIVERSAL_ROUTER_CODE_HASH();

        // A different build at the same address. Any different bytes would do; this one is short and
        // obviously not a router, so nothing about the row depends on what the replacement does.
        vm.etch(universalRouter, hex"60006000fd");
        bytes32 found = universalRouter.codehash;
        assertTrue(found != expected, "the sabotage did not change the router's code hash");

        uint256 payerBefore = payer.balance;
        uint256 merchantBefore = payout.balanceOf(merchant);
        vm.expectRevert(
            abi.encodeWithSelector(UnicaExecutorV3.RouterCodeChanged.selector, universalRouter, expected, found)
        );
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);

        assertEq(payer.balance, payerBefore, "value left the payer on a refused settlement");
        assertEq(payout.balanceOf(merchant), merchantBefore, "the merchant was paid on a refused settlement");
        assertEq(hook.receiptCount(), 0, "a refused settlement receipted");
        assertEq(
            uint8(executor.orders(orderId).status),
            uint8(UnicaExecutorV3.Status.Open),
            "the order did not stay Open after a refusal"
        );

        // Restore, and the same order goes through. The guard was the only thing standing in the way.
        etchOfficialUniversalRouter();
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
        assertEq(hook.receiptCount(), 1, "the settlement did not recover once the router was restored");
        assertGe(payout.balanceOf(merchant) - merchantBefore, MIN_OUT, "the merchant was short after recovery");
    }

    /// @notice SABOTAGE. An address with no code at all is a mismatch too, not an absence of one.
    /// @dev `codehash` is zero for an account that does not exist. The row exists because "not equal"
    ///      and "nothing there" are the same verdict here only if the comparison is written the right
    ///      way round, and a check that passes on an empty address would be worse than none.
    function test_V3_6_ARouterThatVanishedIsAlsoRefused() public {
        bytes32 orderId = _createOrder();
        bytes32 expected = executor.UNIVERSAL_ROUTER_CODE_HASH();
        vm.etch(universalRouter, "");
        vm.expectRevert(
            abi.encodeWithSelector(
                UnicaExecutorV3.RouterCodeChanged.selector, universalRouter, expected, universalRouter.codehash
            )
        );
        vm.prank(payer);
        executor.pay{value: AMOUNT_IN}(orderId);
    }

    /// @notice The recorded hash is the one an independently recorded artifact holds.
    /// @dev `UniswapDeploymentsV3`'s hash was read from the chain in the session that wrote it;
    ///      `UniversalRouterV2Sepolia.RUNTIME_KECCAK` was recorded earlier, from a different read, by
    ///      a different piece of work. Two independent readings of the same bytecode agreeing is what
    ///      makes the table evidence rather than a transcription.
    function test_V3_7_TheRecordedRouterHashAgreesWithTheStoredArtifact() public view {
        assertEq(
            UnicaDeploymentsV3.universalRouterCodeHash(LOCAL_CHAIN),
            UniversalRouterV2Sepolia.RUNTIME_KECCAK,
            "the deployments table and the stored router artifact disagree"
        );
        assertEq(executor.UNIVERSAL_ROUTER_CODE_HASH(), UniversalRouterV2Sepolia.RUNTIME_KECCAK, "the executor too");
    }

    // ---- the hook's own refusals, still intact in this generation ---------------------------------

    /// @notice The pool shape is refused where a pool is born: only native in, this chain's payout out.
    function test_V3_8_APoolOfSomeOtherShapeCannotCarryThisHook() public {
        PoolKey memory bad = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(makeAddr("a token somebody printed")),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(minedHook)
        });
        vm.expectRevert();
        manager.initialize(bad, SQRT_PRICE_1_1);
    }

    /// @notice The executor and the hook point at each other, and at nothing else.
    function test_V3_9_TheHookAndTheExecutorAreBoundBothWays() public view {
        assertEq(hook.SETTLEMENT_EXECUTOR(), address(executor), "the hook does not name this executor");
        assertEq(executor.HOOK(), address(hook), "the executor does not name this hook");
        assertEq(executor.UNIVERSAL_ROUTER(), hook.UNIVERSAL_ROUTER(), "they disagree about the router");
        assertEq(executor.PAYOUT_CURRENCY(), hook.PAYOUT_CURRENCY(), "they disagree about the payout currency");
        assertEq(executor.POOL_MANAGER(), address(manager), "the executor names a different PoolManager");
    }

    /// @notice An order for a pool this hook does not guard is refused where it is created.
    function test_V3_10_AnOrderForAnUnguardedPoolIsRefused() public {
        PoolKey memory foreign = settlementKey();
        foreign.hooks = IHooks(makeAddr("some other hook"));
        vm.expectRevert(abi.encodeWithSelector(UnicaExecutorV3.PoolNotGuarded.selector, address(foreign.hooks)));
        executor.createOrder(merchant, foreign, AMOUNT_IN, MIN_OUT, uint64(block.timestamp + 1 hours), bytes32("x"));
    }

    // ---- helpers ---------------------------------------------------------------------------------

    function _createOrder() internal returns (bytes32) {
        return executor.createOrder(
            merchant, key, AMOUNT_IN, MIN_OUT, uint64(block.timestamp + 1 hours), keccak256(abi.encode(orderSalt++))
        );
    }

    uint256 internal orderSalt;

    function _findReceipt(Vm.Log[] memory logs) internal pure returns (bool, Vm.Log memory) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length == 4 && logs[i].topics[0] == RECEIPT_TOPIC) return (true, logs[i]);
        }
        Vm.Log memory empty;
        return (false, empty);
    }
}
