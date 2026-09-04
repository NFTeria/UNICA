// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {UnicaTestBase} from "./utils/UnicaTestBase.sol";
import {UnicaHook} from "../src/UnicaHook.sol";

/// @title Day-1 tests for the UnicaHook frame
/// @notice Two things are proven here and nothing else: the permission bits in the hook's address
///         equal the permissions the contract declares (THREAT-MODEL T5, spec section 5), and a
///         real swap through a real PoolManager reaches the hook's callback.
/// @dev The PoolManager under test is Uniswap's official bytecode, placed at the canonical Sepolia
///      address by `UnicaTestBase` so the zero-argument constructor (spec section 7d) resolves it.
///      The second currency is a labelled local ERC-20 mock; the live pool uses Circle USDC. Nothing
///      here is a live-testnet result.
contract UnicaHookTest is UnicaTestBase {
    /// @dev The day-1 permission set: afterSwap only. beforeSwap joins with invariant I1.
    uint160 internal constant DAY1_MASK = Hooks.AFTER_SWAP_FLAG;

    /// @dev Namespaced so an etched address never lands on a precompile or a reserved prefix.
    address internal constant HOOK_ADDR = address(uint160(DAY1_MASK) ^ (0x4444 << 144));

    UnicaHook internal hook;

    function setUp() public {
        setUpV4();

        // T5, in this order on purpose: assert the mask numerically BEFORE deploying, because
        // deployCodeTo swallows the constructor's HookAddressNotValid into a bare cheatcode error.
        assertEq(_declaredMask(), DAY1_MASK, "declared permissions drifted from the day-1 set (afterSwap only)");
        deployCodeTo("UnicaHook.sol:UnicaHook", "", HOOK_ADDR);
        hook = UnicaHook(HOOK_ADDR);
    }

    // ------------------------------------------------------------------ T5: the flag guard

    /// @notice THREAT-MODEL T5. The mask encoded in the hook's address equals the permissions the
    ///         runtime code declares. Either side drifting makes this red.
    function test_MinedAddress_MatchesDeclaredPermissions() public {
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, _declaredMask());
    }

    /// @notice No permission beyond the day-1 set is declared. The beforeSwap gate is added by the
    ///         router-gate work, and this test is what changes when it does.
    function test_NoUndeclaredPermissionsCreepIn() public {
        assertEq(_declaredMask(), DAY1_MASK);
        Hooks.Permissions memory p = hook.getHookPermissions();
        assertTrue(p.afterSwap);
        assertFalse(p.beforeSwap);
        assertFalse(p.beforeSwapReturnDelta);
        assertFalse(p.afterSwapReturnDelta);
    }

    /// @notice The negative control for T5, from v4 itself: the same bytecode deployed to an address
    ///         whose bits say beforeSwap-only is refused by the BaseHook constructor with
    ///         HookAddressNotValid. If this ever passes without reverting, the guard means nothing.
    function test_RevertWhen_AddressBitsSayBeforeSwapOnly() public {
        bytes32 salt = _mineSalt(Hooks.BEFORE_SWAP_FLAG);
        address predicted = _create2Address(salt);
        assertEq(uint160(predicted) & Hooks.ALL_HOOK_MASK, Hooks.BEFORE_SWAP_FLAG);
        vm.expectRevert(abi.encodeWithSelector(Hooks.HookAddressNotValid.selector, predicted));
        new UnicaHook{salt: salt}();
    }

    /// @notice The positive twin of the control above: a salt mined for the declared mask deploys.
    function test_MinedSalt_DeploysAtTheDeclaredMask() public {
        bytes32 salt = _mineSalt(DAY1_MASK);
        UnicaHook mined = new UnicaHook{salt: salt}();
        assertEq(address(mined), _create2Address(salt));
        assertEq(uint160(address(mined)) & Hooks.ALL_HOOK_MASK, DAY1_MASK);
    }

    // ------------------------------------------------------------------ the swap

    /// @notice A real swap through a real PoolManager reaches the callback: native ETH in,
    ///         mock USDC out, and the hook's counter moves from 0 to 1.
    function test_SwapExecutesThroughTheHook() public {
        (PoolKey memory k,) = initNativePoolWithLiquidity(IHooks(address(hook)), 1 ether);
        assertEq(hook.afterSwapCount(), 0);

        BalanceDelta d = swapNativeExactIn(k, 1e15, ZERO_BYTES);

        assertEq(hook.afterSwapCount(), 1, "the hook did not observe the swap");
        assertLt(d.amount0(), 0, "payer did not pay ETH");
        assertGt(d.amount1(), 0, "payer did not receive the payout token");
    }

    /// @notice Every swap size in the pool's range is observed exactly once.
    function testFuzz_EverySwapIsObservedOnce(uint128 amountIn) public {
        amountIn = uint128(bound(amountIn, 1e9, 1e17));
        (PoolKey memory k,) = initNativePoolWithLiquidity(IHooks(address(hook)), 1 ether);
        swapNativeExactIn(k, amountIn, ZERO_BYTES);
        assertEq(hook.afterSwapCount(), 1);
    }

    /// @notice A swap on a pool WITHOUT the hook does not touch the hook. The counter is a measure of
    ///         this hook's path, not of the manager's activity.
    function test_SwapOnAHooklessPoolIsNotObserved() public {
        (PoolKey memory k,) = initNativePoolWithLiquidity(IHooks(address(0)), 1 ether);
        swapNativeExactIn(k, 1e15, ZERO_BYTES);
        assertEq(hook.afterSwapCount(), 0);
    }

    // ------------------------------------------------------------------ helpers

    /// @dev Reads the permission struct off the REAL runtime code without running the constructor.
    ///      Etching lets the test read what the contract CLAIMS even when the claim disagrees with
    ///      the address it will be deployed at, which is the whole point of the guard.
    function _declaredMask() internal returns (uint160 mask) {
        address probe = makeAddr("permissions-probe");
        vm.etch(probe, vm.getDeployedCode("UnicaHook.sol:UnicaHook"));
        Hooks.Permissions memory p = UnicaHook(probe).getHookPermissions();
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
    ///      The init-code hash is computed once: copying the creation code on every iteration is
    ///      what ran the first version of this loop out of memory.
    function _mineSalt(uint160 wantMask) internal view returns (bytes32) {
        bytes32 initCodeHash = keccak256(type(UnicaHook).creationCode);
        for (uint256 i = 0; i < 200_000; i++) {
            bytes32 salt = bytes32(i);
            if (uint160(_create2Address(salt, initCodeHash)) & Hooks.ALL_HOOK_MASK == wantMask) return salt;
        }
        revert("no salt found");
    }

    function _create2Address(bytes32 salt) internal view returns (address) {
        return _create2Address(salt, keccak256(type(UnicaHook).creationCode));
    }

    function _create2Address(bytes32 salt, bytes32 initCodeHash) internal view returns (address) {
        bytes32 h = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash));
        return address(uint160(uint256(h)));
    }
}
