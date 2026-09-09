// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {IImmutableState} from "@uniswap/v4-periphery/src/interfaces/IImmutableState.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {ActionConstants} from "@uniswap/v4-periphery/src/libraries/ActionConstants.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {RouterParamsCodec} from "../../src/compat/RouterParamsCodec.sol";
import {RouterProbe, IUniversalRouterExecute} from "../../src/compat/RouterProbe.sol";
import {ObserverHook} from "./util/ObserverHook.sol";

/// @title CompatForkBase, one instrument pointed at two chains
/// @notice Every row in `test/compat/` runs against REAL DEPLOYED BYTECODE — the Universal Router and
///         the PoolManager already on the forked chain, unmodified. What this file deploys INTO the
///         fork is instrumentation and is labelled as such: one mock token, v4-core's own liquidity
///         test router, and an `ObserverHook` that records and enforces nothing. The subject is always
///         the router; these are only how it is watched.
///
///         The pool is native ETH against the mock token, swapped zero-for-one, settled from the value
///         forwarded to the router and taken to a third address — the exact plan shape
///         `SettlementExecutor._plan` builds, so a row that passes here is a statement about the path
///         a settlement actually uses, and not about a simpler one invented for the test.
///
///         The PoolManager is not hardcoded per chain. It is read from the router being measured
///         (`IImmutableState.poolManager()`), which also makes every row assert, for free, that the
///         router and the manager under it are one stack rather than two strays.
/// @dev Nothing is broadcast. Forks are read-only sandboxes; the contracts deployed here exist only
///      inside the test process and no row claims otherwise.
abstract contract CompatForkBase is Test {
    using CurrencyLibrary for Currency;

    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    int24 internal constant TICK_LOWER = -120;
    int24 internal constant TICK_UPPER = 120;
    int256 internal constant LIQUIDITY = 1e18;
    uint128 internal constant AMOUNT_IN = 1e15;
    /// @dev The Universal Router command that runs v4 actions, as `SettlementExecutor` encodes it.
    uint8 internal constant COMMAND_V4_SWAP = 0x10;
    /// @dev The observer's permission bits: `beforeSwap | afterSwap`, the settlement hook's two swap
    ///      callbacks. The PoolManager reads these from the ADDRESS, so the address must be mined.
    uint160 internal constant OBSERVER_FLAGS = Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;

    /// @notice The one word of hook data every row carries. A settlement's is an order id; the only
    ///         property that matters to these rows is that it is NOT empty, because empty hook data is
    ///         precisely the case both router builds accept and the case no settlement can use.
    bytes32 internal constant ORDER_ID = keccak256("UNICA compat row: one order id, non-empty on purpose");

    address internal router;
    IPoolManager internal manager;
    MockERC20 internal token;
    PoolModifyLiquidityTest internal lp;
    address internal merchant = makeAddr("merchant");

    /// @dev Everything one swap through the router leaves behind, read on both sides of the call.
    struct Observation {
        PoolKey key;
        ObserverHook observer;
        uint256 merchantBefore;
        uint256 merchantAfter;
        uint256 callerNativeBefore;
        uint256 callerNativeAfter;
        uint256 routerNativeAfter;
        uint256 routerTokenAfter;
    }

    /// @notice Stands the instrumentation up on whatever fork is already selected.
    /// @dev Called after the fork is created, never before: the router's PoolManager is read from the
    ///      forked chain, so this asserts the fork is live as its first act.
    function _bootstrap(address router_) internal {
        require(router_.code.length > 0, "compat: no router code on this fork");
        router = router_;
        manager = IImmutableState(router_).poolManager();
        require(address(manager).code.length > 0, "compat: the router names a PoolManager with no code");

        token = new MockERC20("Compat Probe Token", "CPT", 18);
        lp = new PoolModifyLiquidityTest(manager);
        token.mint(address(this), 1_000_000 ether);
        token.approve(address(lp), type(uint256).max);
        vm.deal(address(this), 100 ether);

        vm.label(router_, "UniversalRouter(deployed)");
        vm.label(address(manager), "PoolManager(deployed)");
        vm.label(address(token), "CPT(mock)");
        vm.label(address(lp), "PoolModifyLiquidityTest(mock)");
    }

    // ---- the pool ------------------------------------------------------------------------------

    /// @notice A fresh native/token pool guarded by a fresh observer, with liquidity in it.
    /// @dev One pool per row rather than one per suite, so a row can never read a counter another row
    ///      moved. The salt is the block's own hash mixed with a counter, so two rows in one suite
    ///      never mine the same address.
    function _freshPool() internal returns (PoolKey memory key, ObserverHook observer) {
        observer = _deployObserver();
        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(observer))
        });
        manager.initialize(key, SQRT_PRICE_1_1);
        lp.modifyLiquidity{value: 1 ether}(
            key,
            ModifyLiquidityParams({tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: LIQUIDITY, salt: 0}),
            ""
        );
        assertEq(observer.beforeSwapCalls(), 0, "the observer counted a swap before any row ran");
    }

    uint256 private _observerNonce;

    /// @dev CREATE2 from this test contract with a salt mined for the observer's flag bits. Only the
    ///      bits are searched; the one candidate that wins is then checked for existing code, because
    ///      on a fork every such check is an RPC read and 200,000 of them is a different kind of test.
    function _deployObserver() internal returns (ObserverHook observer) {
        bytes32 initCodeHash = keccak256(abi.encodePacked(type(ObserverHook).creationCode, abi.encode(manager)));
        uint256 start = uint256(keccak256(abi.encode(block.number, address(this), _observerNonce++)));
        for (uint256 i = 0; i < 500_000; i++) {
            bytes32 salt = bytes32(start + i);
            address predicted = vm.computeCreate2Address(salt, initCodeHash, address(this));
            if (uint160(predicted) & Hooks.ALL_HOOK_MASK != OBSERVER_FLAGS) continue;
            if (predicted.code.length != 0) continue;
            observer = new ObserverHook{salt: salt}(manager);
            assertEq(address(observer), predicted, "CREATE2 did not land where it was computed");
            vm.label(address(observer), "ObserverHook(mock)");
            return observer;
        }
        revert("compat: no salt found for the observer's permission bits");
    }

    // ---- the plan ------------------------------------------------------------------------------

    /// @notice `SettlementExecutor._plan`, field for field, with the swap parameters encoded for the
    ///         named layout: swap exact input carrying the order id as hook data, settle the native
    ///         input from the forwarded value, take the whole output to the merchant.
    /// @dev The only difference from the shipped plan is the minimum output — one wei here, the
    ///      order's minimum there — because these rows measure the ENCODING, and a minimum that binds
    ///      would let a price move on the forked chain masquerade as a layout refusal.
    function _plan(RouterParamsCodec.Layout layout, PoolKey memory key, bytes memory hookData)
        internal
        view
        returns (bytes memory commands, bytes[] memory inputs)
    {
        bytes memory actions =
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE), uint8(Actions.TAKE));
        bytes[] memory params = new bytes[](3);
        params[0] = RouterParamsCodec.encode(
            layout,
            RouterParamsCodec.SwapExactInSingle({
                poolKey: key,
                zeroForOne: true,
                amountIn: AMOUNT_IN,
                amountOutMinimum: 1,
                minHopPriceX36: 0,
                hookData: hookData
            })
        );
        params[1] = abi.encode(key.currency0, ActionConstants.OPEN_DELTA, false);
        params[2] = abi.encode(key.currency1, merchant, ActionConstants.OPEN_DELTA);
        inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
        commands = abi.encodePacked(COMMAND_V4_SWAP);
    }

    /// @notice One settlement-shaped swap through the deployed router, and the balances around it.
    function _swap(RouterParamsCodec.Layout layout, bytes memory hookData) internal returns (Observation memory o) {
        (o.key, o.observer) = _freshPool();
        (bytes memory commands, bytes[] memory inputs) = _plan(layout, o.key, hookData);

        o.merchantBefore = token.balanceOf(merchant);
        o.callerNativeBefore = address(this).balance;
        IUniversalRouterExecute(router).execute{value: AMOUNT_IN}(commands, inputs, block.timestamp + 1 hours);
        o.merchantAfter = token.balanceOf(merchant);
        o.callerNativeAfter = address(this).balance;
        o.routerNativeAfter = router.balance;
        o.routerTokenAfter = token.balanceOf(router);
    }

    /// @notice The same call, expected to be refused with EMPTY revert data, and nothing moved.
    /// @dev A low-level call rather than `vm.expectRevert`, because the claim being made is about the
    ///      revert DATA and not merely that something reverted. A router that refused for any other
    ///      reason — a named error, a require string, `SliceOutOfBounds` — returns bytes, fails the
    ///      length assertion, and the row goes red. That distinction is the entire finding, and it is
    ///      the same classification `RouterProbe` makes, exercised here against the same bytecode.
    function _refusedSwap(RouterParamsCodec.Layout layout, bytes memory hookData)
        internal
        returns (ObserverHook observer, bytes memory returnData)
    {
        PoolKey memory key;
        (key, observer) = _freshPool();
        (bytes memory commands, bytes[] memory inputs) = _plan(layout, key, hookData);
        uint256 callerBefore = address(this).balance;
        uint256 merchantBefore = token.balanceOf(merchant);

        bool ok;
        (ok, returnData) = router.call{value: AMOUNT_IN}(
            abi.encodeCall(IUniversalRouterExecute.execute, (commands, inputs, block.timestamp + 1 hours))
        );

        assertFalse(ok, "the router accepted a call this row says it refuses");
        assertEq(observer.beforeSwapCalls(), 0, "the hook ran, so the refusal was not before the pool");
        assertEq(observer.afterSwapCalls(), 0, "the hook ran, so the refusal was not before the pool");
        assertEq(address(this).balance, callerBefore, "value left the caller on a refused call");
        assertEq(token.balanceOf(merchant), merchantBefore, "the merchant was paid by a refused call");
    }

    // ---- shared assertions ---------------------------------------------------------------------

    /// @notice The row every fork runs: the probe's pool key is refused by the REAL PoolManager on
    ///         this chain, for two independent reasons. This is what makes `RouterProbe` safe rather
    ///         than merely careful — it is the claim "that pool cannot exist", measured.
    function _assertProbeKeyCannotBeInitialised() internal {
        PoolKey memory key = RouterProbe.probeKey();

        vm.expectRevert(abi.encodeWithSelector(IPoolManager.TickSpacingTooSmall.selector, int24(0)));
        manager.initialize(key, SQRT_PRICE_1_1);

        // Reason two, on its own: even with a legal tick spacing the two currencies are the same.
        key.tickSpacing = TICK_SPACING;
        vm.expectRevert(
            abi.encodeWithSelector(
                IPoolManager.CurrenciesOutOfOrderOrEqual.selector,
                Currency.unwrap(key.currency0),
                Currency.unwrap(key.currency1)
            )
        );
        manager.initialize(key, SQRT_PRICE_1_1);
    }

    /// @notice The hook data reached the hook, in both callbacks, unchanged, and the swap filled.
    function _assertHookDataDelivered(Observation memory o, bytes32 expected) internal view {
        assertEq(o.observer.beforeSwapCalls(), 1, "exactly one beforeSwap");
        assertEq(o.observer.afterSwapCalls(), 1, "exactly one afterSwap");
        assertEq(o.observer.beforeSender(), router, "beforeSwap sender is not the router under test");
        assertEq(o.observer.beforeHookData(), abi.encode(expected), "hook data in beforeSwap");
        assertEq(o.observer.afterHookData(), abi.encode(expected), "hook data in afterSwap");
        assertTrue(o.observer.beforeZeroForOne(), "direction");
        assertEq(o.observer.beforeAmountSpecified(), -int256(uint256(AMOUNT_IN)), "amount specified");
        assertEq(o.observer.afterAmount0(), -int128(AMOUNT_IN), "the input was not consumed in full");
        assertGt(o.observer.afterAmount1(), 0, "the pool credited nothing");
        assertEq(
            o.merchantAfter - o.merchantBefore, uint256(uint128(o.observer.afterAmount1())), "the merchant was short"
        );
        assertEq(o.callerNativeBefore - o.callerNativeAfter, AMOUNT_IN, "the caller paid something else");
        assertEq(o.routerNativeAfter, 0, "the router kept native value");
        assertEq(o.routerTokenAfter, 0, "the router kept the output token");
    }

    /// @dev The liquidity router refunds unspent native value, so this contract must be able to take
    ///      it back. Nothing else is ever sent here.
    receive() external payable {}
}
