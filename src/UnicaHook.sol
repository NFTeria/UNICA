// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {AddressConstants} from "hookmate/constants/AddressConstants.sol";

/// @title UnicaHook, the settlement hook frame
/// @notice Day-1 scaffold. It declares `afterSwap` only and does nothing inside it except observe.
///         The design it implements is `specs/HOOK-SPEC.md`. The eventual permission set is
///         `beforeSwap | afterSwap` (spec section 5); the router gate arrives with invariant I1.
/// @dev Zero-argument constructor on purpose (spec section 7d): a constructor argument enters the
///      CREATE2 init-code hash, so a per-chain PoolManager argument would put the hook at a
///      different address on every chain. The manager is resolved from the chain id instead, which
///      keeps one salt and one address across every chain hookmate knows.
contract UnicaHook is BaseHook {
    using PoolIdLibrary for PoolKey;

    /// @notice Number of swaps the PoolManager has reported to this hook.
    /// @dev Exists so a test and a live transaction can prove the callback actually ran. A
    ///      permission-bit mismatch fails silently (spec section 5, threat T5): the callback is
    ///      simply never called, and this counter would stay at zero.
    uint256 public afterSwapCount;

    /// @notice Emitted once per `afterSwap` callback with exactly what v4 handed the hook.
    /// @dev The settlement receipt of spec section 3 (invariant I2) replaces this once the router
    ///      gate lands; until then this is the observable that proves the hook is in the path.
    event AfterSwapObserved(address indexed sender, PoolId indexed poolId, BalanceDelta delta);

    constructor() BaseHook(IPoolManager(AddressConstants.getPoolManagerAddress(block.chainid))) {}

    /// @inheritdoc BaseHook
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: false,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @dev Reached only through `BaseHook.afterSwap`, which is `onlyPoolManager` (threat T1).
    function _afterSwap(address sender, PoolKey calldata key, SwapParams calldata, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        unchecked {
            ++afterSwapCount;
        }
        emit AfterSwapObserved(sender, key.toId(), delta);
        return (IHooks.afterSwap.selector, 0);
    }
}
