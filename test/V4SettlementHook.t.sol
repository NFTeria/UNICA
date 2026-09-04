// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {ActionConstants} from "@uniswap/v4-periphery/src/libraries/ActionConstants.sol";
import {SettlementTestBase} from "./utils/SettlementTestBase.sol";
import {ExecutorHarness} from "./utils/ExecutorHarness.sol";
import {UniversalRouterV2Sepolia} from "./utils/artifacts/UniversalRouterV2Sepolia.sol";
import {V4SettlementHook} from "../src/V4SettlementHook.sol";
import {SettlementExecutor, IUniversalRouter} from "../src/SettlementExecutor.sol";

/// @title Tests for the hook itself: the permission-bit guard, the gate, and the order checks
/// @notice Proves, against Uniswap's official PoolManager and Universal Router bytecode, that the
///         address bits equal the declared permissions (THREAT-MODEL T5), that the executor address
///         the hook trusts is the one the executor lands on, that a swap from anywhere but the official
///         router driven by the executor is refused (invariant I1), and that the hook verifies every
///         term of the order from the executor's storage, never from hook data (spec C1, I3, I4, I5).
contract V4SettlementHookTest is SettlementTestBase {
    address internal merchant = makeAddr("merchant");
    uint128 internal constant AMOUNT_IN = 1e15;

    function setUp() public {
        setUpV4();
        // T5, in this order on purpose: assert the mask numerically BEFORE deploying, because the
        // deploy cheat swallows the constructor's HookAddressNotValid into a bare cheatcode error.
        assertEq(
            _declaredMask(),
            DECLARED_MASK,
            "declared permissions drifted from the declared set (beforeSwap | afterSwap)"
        );
        deploySettlement();
    }

    // ------------------------------------------------------------------ T5: the flag guard

    /// @notice THREAT-MODEL T5. The mask encoded in the hook's address equals the permissions the
    ///         runtime code declares. Either side drifting makes this red; it was seen red on
    ///         2026-09-04 when beforeSwap was added and the test still expected the day-1 mask.
    function test_MinedAddress_MatchesDeclaredPermissions() public {
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, _declaredMask());
    }

    /// @notice Exactly the declared set: both swap callbacks, no returns-delta flag ever (threat T11).
    function test_NoUndeclaredPermissionsCreepIn() public {
        assertEq(_declaredMask(), DECLARED_MASK);
        Hooks.Permissions memory p = hook.getHookPermissions();
        assertTrue(p.beforeSwap);
        assertTrue(p.afterSwap);
        assertFalse(p.beforeSwapReturnDelta);
        assertFalse(p.afterSwapReturnDelta);
    }

    /// @notice The negative control from v4 itself: the same bytecode at an address whose bits say
    ///         beforeSwap-only is refused by the BaseHook constructor with HookAddressNotValid.
    function test_RevertWhen_AddressBitsSayBeforeSwapOnly() public {
        _expectRefusedAt(Hooks.BEFORE_SWAP_FLAG);
    }

    /// @notice The day-1 address shape (afterSwap only, 0x40) is refused too: the gate changed the
    ///         mask, so the scaffold's address can never carry this code.
    function test_RevertWhen_AddressBitsSayAfterSwapOnly() public {
        _expectRefusedAt(Hooks.AFTER_SWAP_FLAG);
    }

    /// @notice The positive twin: a salt mined for the declared mask deploys.
    function test_MinedSalt_DeploysAtTheDeclaredMask() public {
        bytes32 salt = _mineSalt(DECLARED_MASK);
        V4SettlementHook mined = new V4SettlementHook{salt: salt}();
        assertEq(address(mined), _create2Address(salt));
        assertEq(uint160(address(mined)) & Hooks.ALL_HOOK_MASK, DECLARED_MASK);
    }

    // ------------------------------------------------------------------ I1: the gate

    /// @notice The executor address the hook derives is the address the executor actually lands on,
    ///         and the executor is bound back to this hook. The arithmetic is recomputed here from
    ///         constants this test holds INDEPENDENTLY (the canonical factory, salt zero, the
    ///         executor's creation code plus the hook's address), so a wrong factory or salt in the
    ///         hook is caught rather than echoed.
    function test_ExecutorDerivationMatchesTheDeployedAddress() public view {
        assertEq(hook.SETTLEMENT_EXECUTOR(), address(executor));
        assertEq(executor.HOOK(), address(hook), "the executor is not bound to this hook");
        address canonicalFactory = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
        bytes32 salt = bytes32(0);
        bytes32 initCodeHash =
            keccak256(abi.encodePacked(type(SettlementExecutor).creationCode, abi.encode(address(hook))));
        address recomputed =
            address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), canonicalFactory, salt, initCodeHash)))));
        assertEq(hook.SETTLEMENT_EXECUTOR(), recomputed, "the hook's derivation differs from the independent one");
        assertEq(hook.CREATE2_FACTORY(), canonicalFactory);
        assertEq(hook.EXECUTOR_SALT(), salt);
        assertGt(address(executor).code.length, 0, "executor has no code at the derived address");
    }

    /// @notice The router the hook and the executor trust is Uniswap's, running its deployed bytecode.
    function test_OfficialRouterIsTheDeployedRuntime() public view {
        assertEq(hook.UNIVERSAL_ROUTER(), universalRouter);
        assertEq(executor.UNIVERSAL_ROUTER(), universalRouter);
        assertEq(keccak256(universalRouter.code), UniversalRouterV2Sepolia.RUNTIME_KECCAK);
    }

    /// @notice Invariant I1, first half: a swap from any sender other than the official router is
    ///         refused in beforeSwap, before the hook asks anyone anything, and nothing is receipted.
    function test_RevertWhen_SwapSenderIsNotTheOfficialRouter() public {
        (PoolKey memory k,) = initNativePoolWithLiquidity(IHooks(address(hook)), 1 ether);
        vm.expectRevert(
            _wrapped(
                IHooks.beforeSwap.selector,
                abi.encodeWithSelector(V4SettlementHook.NotOfficialPath.selector, address(swapRouter))
            )
        );
        swapNativeExactIn(k, AMOUNT_IN, ZERO_BYTES);
        assertEq(hook.receiptCount(), 0);
    }

    /// @notice Invariant I1, second half: the official router itself, driven by anyone but the
    ///         executor, is refused. The router reports its caller through msgSender() and the hook
    ///         names that caller in the error. The stranger keeps every wei.
    function test_RevertWhen_OfficialRouterIsDrivenByAStranger() public {
        (PoolKey memory k,) = initNativePoolWithLiquidity(IHooks(address(hook)), 1 ether);
        address stranger = makeAddr("stranger");
        vm.deal(stranger, 1 ether);
        (bytes memory commands, bytes[] memory inputs) = _plan(k, AMOUNT_IN, 1, stranger, abi.encode(bytes32(0)));
        vm.expectRevert(
            _wrapped(
                IHooks.beforeSwap.selector,
                abi.encodeWithSelector(V4SettlementHook.NotSettlementExecutor.selector, stranger)
            )
        );
        vm.prank(stranger);
        IUniversalRouter(universalRouter).execute{value: AMOUNT_IN}(commands, inputs, block.timestamp + 1);
        assertEq(hook.receiptCount(), 0);
        assertEq(stranger.balance, 1 ether);
    }

    /// @notice A pool WITHOUT the hook is untouched by it: the counter measures this hook's path only.
    function test_SwapOnAHooklessPoolIsNotObserved() public {
        (PoolKey memory k,) = initNativePoolWithLiquidity(IHooks(address(0)), 1 ether);
        swapNativeExactIn(k, AMOUNT_IN, ZERO_BYTES);
        assertEq(hook.receiptCount(), 0);
    }

    // ------------------------------------------------------------------ C1, I3, I4, I5: the order checks
    // Reached through the executor HARNESS at the executor's address, which drives the official router
    // with a plan the real executor would never compose. The hook cannot tell them apart by design.

    /// @notice Spec C1: hook data is one order id and nothing else. Empty data and a 20-byte payload,
    ///         the shape a hook that trusted hook data for a payee would accept, are both refused.
    function test_RevertWhen_HookDataIsNotAnOrderId() public {
        ExecutorHarness h = deployExecutorHarness();
        (PoolKey memory k,) = initNativePoolWithLiquidity(IHooks(address(hook)), 1 ether);
        bytes32 id = _order(h, k, AMOUNT_IN, 1);

        (bytes memory commands, bytes[] memory inputs) = _plan(k, AMOUNT_IN, 1, merchant, "");
        vm.expectRevert(
            _wrapped(IHooks.beforeSwap.selector, abi.encodeWithSelector(V4SettlementHook.MalformedHookData.selector, 0))
        );
        h.payWithPlan{value: AMOUNT_IN}(id, commands, inputs);

        (commands, inputs) = _plan(k, AMOUNT_IN, 1, merchant, abi.encodePacked(merchant));
        vm.expectRevert(
            _wrapped(
                IHooks.beforeSwap.selector, abi.encodeWithSelector(V4SettlementHook.MalformedHookData.selector, 20)
            )
        );
        h.payWithPlan{value: AMOUNT_IN}(id, commands, inputs);
        assertEq(hook.receiptCount(), 0);
    }

    /// @notice Invariant I5 at the hook: a swap names an order that is not being paid right now. An
    ///         unknown id, an order that was created but never paid, and an order already settled are
    ///         each refused with the state the hook read. The order the harness marked Paying is a
    ///         different one, so the id in hook data decides nothing on its own.
    function test_RevertWhen_OrderIsNotInFlight() public {
        ExecutorHarness h = deployExecutorHarness();
        (PoolKey memory k,) = initNativePoolWithLiquidity(IHooks(address(hook)), 1 ether);
        bytes32 inFlight = _order(h, k, AMOUNT_IN, 1);

        bytes32 unknown = keccak256("never created");
        _expectNotInFlight(h, k, inFlight, unknown, SettlementExecutor.Status.None);

        bytes32 open = _order(h, k, AMOUNT_IN, 1);
        _expectNotInFlight(h, k, inFlight, open, SettlementExecutor.Status.Open);

        bytes32 settled = _order(h, k, AMOUNT_IN, 1);
        (bytes memory commands, bytes[] memory inputs) = h.planFor(settled);
        h.payWithPlan{value: AMOUNT_IN}(settled, commands, inputs);
        assertEq(hook.receiptCount(), 1);
        _expectNotInFlight(h, k, inFlight, settled, SettlementExecutor.Status.Settled);
        assertEq(hook.receiptCount(), 1);
    }

    /// @notice Invariant I4 at the hook: the executor's own deadline check bypassed, the hook still
    ///         refuses an expired order from the deadline it reads itself.
    function test_RevertWhen_ExpiredOrderReachesTheHook() public {
        ExecutorHarness h = deployExecutorHarness();
        (PoolKey memory k,) = initNativePoolWithLiquidity(IHooks(address(hook)), 1 ether);
        bytes32 id = _order(h, k, AMOUNT_IN, 1);
        uint64 deadline = h.orders(id).deadline;
        vm.warp(deadline + 1);
        (bytes memory commands, bytes[] memory inputs) = h.planFor(id);
        vm.expectRevert(
            _wrapped(
                IHooks.beforeSwap.selector, abi.encodeWithSelector(V4SettlementHook.OrderExpired.selector, id, deadline)
            )
        );
        h.payWithPlan{value: AMOUNT_IN}(id, commands, inputs);
    }

    /// @notice Invariant I3 at the hook: the swap amount must be the order's.
    function test_RevertWhen_SwapParamsDisagreeWithTheOrder() public {
        ExecutorHarness h = deployExecutorHarness();
        (PoolKey memory k,) = initNativePoolWithLiquidity(IHooks(address(hook)), 1 ether);
        bytes32 id = _order(h, k, AMOUNT_IN, 1);
        (bytes memory commands, bytes[] memory inputs) = _plan(k, AMOUNT_IN + 1, 1, merchant, abi.encode(id));
        vm.expectRevert(
            _wrapped(
                IHooks.beforeSwap.selector, abi.encodeWithSelector(V4SettlementHook.ParamsDoNotMatchOrder.selector, id)
            )
        );
        h.payWithPlan{value: AMOUNT_IN + 1}(id, commands, inputs);
    }

    /// @notice Invariant I3 at the hook, the direction half: a swap the other way, output to input,
    ///         with the order's amount is refused before anything settles. Without this test, removing
    ///         the direction check left the whole suite green (review finding, 2026-09-04).
    function test_RevertWhen_SwapDirectionDisagreesWithTheOrder() public {
        ExecutorHarness h = deployExecutorHarness();
        (PoolKey memory k,) = initNativePoolWithLiquidity(IHooks(address(hook)), 1 ether);
        bytes32 id = _order(h, k, AMOUNT_IN, 1);
        (bytes memory commands, bytes[] memory inputs) = _plan(k, false, AMOUNT_IN, 1, merchant, abi.encode(id));
        vm.expectRevert(
            _wrapped(
                IHooks.beforeSwap.selector, abi.encodeWithSelector(V4SettlementHook.ParamsDoNotMatchOrder.selector, id)
            )
        );
        h.payWithPlan{value: AMOUNT_IN}(id, commands, inputs);
        assertEq(hook.receiptCount(), 0);
    }

    /// @notice Invariant I3 at the hook: the pool must be the order's. A second hooked pool with a
    ///         different fee tier is initialised so the swap reaches the hook and is refused there.
    function test_RevertWhen_PoolDisagreesWithTheOrder() public {
        ExecutorHarness h = deployExecutorHarness();
        (PoolKey memory k,) = initNativePoolWithLiquidity(IHooks(address(hook)), 1 ether);
        PoolKey memory other = nativeUsdcKey(IHooks(address(hook)));
        other.fee = 500;
        other.tickSpacing = 10;
        initPoolWithLiquidity(other, 1 ether);
        bytes32 id = _order(h, k, AMOUNT_IN, 1);
        (bytes memory commands, bytes[] memory inputs) = _plan(other, AMOUNT_IN, 1, merchant, abi.encode(id));
        vm.expectRevert(
            _wrapped(
                IHooks.beforeSwap.selector, abi.encodeWithSelector(V4SettlementHook.PoolDoesNotMatchOrder.selector, id)
            )
        );
        h.payWithPlan{value: AMOUNT_IN}(id, commands, inputs);
    }

    /// @notice Invariant I5 at the hook, within one transaction: a plan with two swaps for one order,
    ///         each with the order's own parameters, is refused at the second with the order named,
    ///         so exactly one receipt can ever exist for an order however the plan is composed. The
    ///         control is the same plan with one swap, which settles.
    function test_RevertWhen_OrderIsSwappedTwiceInOnePlan() public {
        ExecutorHarness h = deployExecutorHarness();
        (PoolKey memory k,) = initNativePoolWithLiquidity(IHooks(address(hook)), 10 ether);
        bytes32 id = _order(h, k, AMOUNT_IN, 1);
        (bytes memory commands, bytes[] memory inputs) = _twoSwapPlan(k, AMOUNT_IN, merchant, abi.encode(id));
        vm.expectRevert(
            _wrapped(
                IHooks.beforeSwap.selector, abi.encodeWithSelector(V4SettlementHook.OrderAlreadySwapped.selector, id)
            )
        );
        h.payWithPlan{value: 2 * AMOUNT_IN}(id, commands, inputs);
        assertEq(hook.receiptCount(), 0);

        (commands, inputs) = h.planFor(id);
        h.payWithPlan{value: AMOUNT_IN}(id, commands, inputs);
        assertEq(hook.receiptCount(), 1, "the control did not settle once");
    }

    // ------------------------------------------------------------------ helpers

    /// @dev Two identical exact-input swaps for the same order, then one settle and one take.
    function _twoSwapPlan(PoolKey memory k, uint128 amountIn, address recipient, bytes memory hookData)
        internal
        pure
        returns (bytes memory commands, bytes[] memory inputs)
    {
        bytes memory actions = abi.encodePacked(
            uint8(Actions.SWAP_EXACT_IN_SINGLE),
            uint8(Actions.SWAP_EXACT_IN_SINGLE),
            uint8(Actions.SETTLE),
            uint8(Actions.TAKE)
        );
        bytes[] memory params = new bytes[](4);
        bytes memory swapParams = abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: k, zeroForOne: true, amountIn: amountIn, amountOutMinimum: 1, hookData: hookData
            })
        );
        params[0] = swapParams;
        params[1] = swapParams;
        params[2] = abi.encode(k.currency0, ActionConstants.OPEN_DELTA, false);
        params[3] = abi.encode(k.currency1, recipient, ActionConstants.OPEN_DELTA);
        inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
        commands = abi.encodePacked(uint8(0x10));
    }

    function _expectNotInFlight(
        ExecutorHarness h,
        PoolKey memory k,
        bytes32 marked,
        bytes32 named,
        SettlementExecutor.Status expected
    ) internal {
        (bytes memory commands, bytes[] memory inputs) = _plan(k, AMOUNT_IN, 1, merchant, abi.encode(named));
        vm.expectRevert(
            _wrapped(
                IHooks.beforeSwap.selector,
                abi.encodeWithSelector(V4SettlementHook.OrderNotInFlight.selector, named, expected)
            )
        );
        h.payWithPlan{value: AMOUNT_IN}(marked, commands, inputs);
    }

    function _order(SettlementExecutor on, PoolKey memory k, uint128 amountIn, uint128 minOut)
        internal
        returns (bytes32)
    {
        vm.prank(merchant);
        return on.createOrder(merchant, k, amountIn, minOut, uint64(block.timestamp + 1 hours), _salt());
    }

    /// @dev The official router's plan for one exact-input native swap, with every field open, so a
    ///      test can compose what the executor never would.
    function _plan(PoolKey memory k, uint128 amountIn, uint128 minOut, address recipient, bytes memory hookData)
        internal
        pure
        returns (bytes memory commands, bytes[] memory inputs)
    {
        return _plan(k, true, amountIn, minOut, recipient, hookData);
    }

    /// @dev The same plan with the direction open, so the direction half of I3 has a test.
    function _plan(
        PoolKey memory k,
        bool zeroForOne,
        uint128 amountIn,
        uint128 minOut,
        address recipient,
        bytes memory hookData
    ) internal pure returns (bytes memory commands, bytes[] memory inputs) {
        bytes memory actions = abi.encodePacked(
            uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE), uint8(Actions.TAKE)
        );
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: k, zeroForOne: zeroForOne, amountIn: amountIn, amountOutMinimum: minOut, hookData: hookData
            })
        );
        params[1] = abi.encode(zeroForOne ? k.currency0 : k.currency1, ActionConstants.OPEN_DELTA, false);
        params[2] = abi.encode(zeroForOne ? k.currency1 : k.currency0, recipient, ActionConstants.OPEN_DELTA);
        inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
        commands = abi.encodePacked(uint8(0x10));
    }

    /// @dev The PoolManager wraps a hook's revert: the hook, the callback selector, the hook's own
    ///      reason, and HookCallFailed. The official router passes it up unchanged.
    function _wrapped(bytes4 callback, bytes memory reason) internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            CustomRevert.WrappedError.selector,
            address(hook),
            callback,
            reason,
            abi.encodeWithSelector(Hooks.HookCallFailed.selector)
        );
    }

    function _expectRefusedAt(uint160 wrongMask) internal {
        bytes32 salt = _mineSalt(wrongMask);
        address predicted = _create2Address(salt);
        assertEq(uint160(predicted) & Hooks.ALL_HOOK_MASK, wrongMask);
        vm.expectRevert(abi.encodeWithSelector(Hooks.HookAddressNotValid.selector, predicted));
        new V4SettlementHook{salt: salt}();
    }

    /// @dev Reads the permission struct off the REAL runtime code without running the constructor.
    ///      Etching lets the test read what the contract CLAIMS even when the claim disagrees with
    ///      the address it will be deployed at, which is the whole point of the guard.
    function _declaredMask() internal returns (uint160 mask) {
        address probe = makeAddr("permissions-probe");
        vm.etch(probe, vm.getDeployedCode("V4SettlementHook.sol:V4SettlementHook"));
        Hooks.Permissions memory p = V4SettlementHook(probe).getHookPermissions();
        if (p.beforeInitialize) mask |= Hooks.BEFORE_INITIALIZE_FLAG;
        if (p.afterInitialize) mask |= Hooks.AFTER_INITIALIZE_FLAG;
        if (p.beforeAddLiquidity) mask |= Hooks.BEFORE_ADD_LIQUIDITY_FLAG;
        if (p.afterAddLiquidity) mask |= Hooks.AFTER_ADD_LIQUIDITY_FLAG;
        if (p.beforeRemoveLiquidity) mask |= Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG;
        if (p.afterRemoveLiquidity) mask |= Hooks.AFTER_REMOVE_LIQUIDITY_FLAG;
        if (p.beforeSwap) mask |= Hooks.BEFORE_SWAP_FLAG;
        if (p.afterSwap) mask |= Hooks.AFTER_SWAP_FLAG;
        if (p.beforeDonate) mask |= Hooks.BEFORE_DONATE_FLAG;
        if (p.afterDonate) mask |= Hooks.AFTER_DONATE_FLAG;
        if (p.beforeSwapReturnDelta) mask |= Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG;
        if (p.afterSwapReturnDelta) mask |= Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        if (p.afterAddLiquidityReturnDelta) mask |= Hooks.AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG;
        if (p.afterRemoveLiquidityReturnDelta) mask |= Hooks.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG;
    }

    /// @dev Finds a salt whose CREATE2 address, deployed from this test contract, carries `wantMask`.
    ///      The init-code hash is computed once; recomputing it per iteration ran out of memory.
    function _mineSalt(uint160 wantMask) internal view returns (bytes32) {
        bytes32 initCodeHash = keccak256(type(V4SettlementHook).creationCode);
        for (uint256 i = 0; i < 200_000; i++) {
            bytes32 salt = bytes32(i);
            if (uint160(_create2Address(salt, initCodeHash)) & Hooks.ALL_HOOK_MASK == wantMask) return salt;
        }
        revert("no salt found");
    }

    function _create2Address(bytes32 salt) internal view returns (address) {
        return _create2Address(salt, keccak256(type(V4SettlementHook).creationCode));
    }

    function _create2Address(bytes32 salt, bytes32 initCodeHash) internal view returns (address) {
        bytes32 h = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash));
        return address(uint160(uint256(h)));
    }
}
