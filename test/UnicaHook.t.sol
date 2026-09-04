// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {UnicaTestBase} from "./utils/UnicaTestBase.sol";
import {UnicaHook} from "../src/UnicaHook.sol";
import {UnicaSettlementRouter} from "../src/UnicaSettlementRouter.sol";

/// @title Tests for the hook itself: the permission-bit guard and the router-only gate
/// @notice Proves, against Uniswap's official PoolManager bytecode, that the address bits equal the
///         declared permissions (THREAT-MODEL T5), that the router address the hook trusts is the
///         one the router lands on, and that any other swap sender is refused (invariant I1).
contract UnicaHookTest is UnicaTestBase {
    function setUp() public {
        setUpV4();
        // T5, in this order on purpose: assert the mask numerically BEFORE deploying, because the
        // deploy cheat swallows the constructor's HookAddressNotValid into a bare cheatcode error.
        assertEq(
            _declaredMask(),
            DECLARED_MASK,
            "declared permissions drifted from the declared set (beforeSwap | afterSwap)"
        );
        deployUnica();
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

    /// @notice The day-1 address shape (afterSwap only, 0x40) is now refused too: the gate changed
    ///         the mask, so the scaffold's address can never carry this code.
    function test_RevertWhen_AddressBitsSayAfterSwapOnly() public {
        _expectRefusedAt(Hooks.AFTER_SWAP_FLAG);
    }

    /// @notice The positive twin: a salt mined for the declared mask deploys.
    function test_MinedSalt_DeploysAtTheDeclaredMask() public {
        bytes32 salt = _mineSalt(DECLARED_MASK);
        UnicaHook mined = new UnicaHook{salt: salt}();
        assertEq(address(mined), _create2Address(salt));
        assertEq(uint160(address(mined)) & Hooks.ALL_HOOK_MASK, DECLARED_MASK);
    }

    // ------------------------------------------------------------------ I1: the gate

    /// @notice The router address the hook derives is the address the router actually lands on.
    function test_SettlerDerivationMatchesTheRouterAddress() public view {
        assertEq(hook.SETTLER(), address(router));
        // The same arithmetic, recomputed here from the router's creation code, so a change to the
        // router, the factory, or the salt on either side is caught.
        bytes32 initCodeHash = keccak256(type(UnicaSettlementRouter).creationCode);
        address recomputed = address(
            uint160(
                uint256(
                    keccak256(abi.encodePacked(bytes1(0xff), hook.CREATE2_FACTORY(), hook.ROUTER_SALT(), initCodeHash))
                )
            )
        );
        assertEq(hook.SETTLER(), recomputed);
        assertGt(address(router).code.length, 0, "router has no code at the derived address");
    }

    /// @notice Invariant I1, the negative: a swap from any sender other than the router is refused by
    ///         the hook in beforeSwap, with the hook's own error wrapped by the PoolManager, and the
    ///         hook observes nothing.
    function test_RevertWhen_SwapSenderIsNotTheRouter() public {
        (PoolKey memory k,) = initNativePoolWithLiquidity(IHooks(address(hook)), 1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                IHooks.beforeSwap.selector,
                abi.encodeWithSelector(UnicaHook.NotSettler.selector, address(swapRouter)),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
        swapNativeExactIn(k, 1e15, ZERO_BYTES);
        assertEq(hook.afterSwapCount(), 0);
    }

    /// @notice A pool WITHOUT the hook is untouched by it: the counter measures this hook's path only.
    function test_SwapOnAHooklessPoolIsNotObserved() public {
        (PoolKey memory k,) = initNativePoolWithLiquidity(IHooks(address(0)), 1 ether);
        swapNativeExactIn(k, 1e15, ZERO_BYTES);
        assertEq(hook.afterSwapCount(), 0);
    }

    // ------------------------------------------------------------------ helpers

    function _expectRefusedAt(uint160 wrongMask) internal {
        bytes32 salt = _mineSalt(wrongMask);
        address predicted = _create2Address(salt);
        assertEq(uint160(predicted) & Hooks.ALL_HOOK_MASK, wrongMask);
        vm.expectRevert(abi.encodeWithSelector(Hooks.HookAddressNotValid.selector, predicted));
        new UnicaHook{salt: salt}();
    }

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
    ///      The init-code hash is computed once; recomputing it per iteration ran out of memory.
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
