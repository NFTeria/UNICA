// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {AddressConstants} from "hookmate/constants/AddressConstants.sol";
import {UnicaSettlementRouter} from "./UnicaSettlementRouter.sol";

/// @title UnicaHook, the settlement hook
/// @notice Admits exactly one swap sender, the settlement router, and observes every swap it admits.
///         A passive hook cannot promise where output lands (spec section 2); this one makes the pool
///         usable only through the router that always delivers to the registered recipient
///         (invariant I1). Permissions are `beforeSwap | afterSwap`, mask 0xC0 (spec section 5).
/// @dev Zero-argument constructor on purpose (spec section 7d): a constructor argument enters the
///      CREATE2 init-code hash, so a per-chain argument would put the hook at a different address on
///      every chain. The manager is resolved from the chain id, and the router's address is derived
///      from the router's own creation code and a fixed salt through the canonical CREATE2 factory,
///      so both are the same on every chain hookmate knows and nothing is configurable after deploy.
contract UnicaHook is BaseHook {
    using PoolIdLibrary for PoolKey;

    /// @notice The canonical CREATE2 factory (the same one forge scripts use) and the salt the router
    ///         is deployed with. Together with the router's creation code they fix `SETTLER`.
    address public constant CREATE2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 public constant ROUTER_SALT = bytes32(0);

    /// @notice The only address whose swaps this hook admits: the settlement router at its CREATE2
    ///         address. Computed at construction from the router's creation code, never configured.
    address public immutable SETTLER;

    /// @notice A swap arrived from a sender that is not the settlement router (invariant I1).
    error NotSettler(address sender);

    /// @notice Number of swaps the PoolManager has reported to this hook.
    /// @dev Exists so a test and a live transaction can prove the callback actually ran. A
    ///      permission-bit mismatch fails silently (spec section 5, threat T5): the callback is
    ///      simply never called, and this counter would stay at zero.
    uint256 public afterSwapCount;

    /// @notice Emitted once per `afterSwap` callback with exactly what v4 handed the hook.
    /// @dev The settlement receipt of spec section 3 (invariant I2) replaces this once the router
    ///      gate lands; until then this is the observable that proves the hook is in the path.
    event AfterSwapObserved(address indexed sender, PoolId indexed poolId, BalanceDelta delta);

    constructor() BaseHook(IPoolManager(AddressConstants.getPoolManagerAddress(block.chainid))) {
        SETTLER = computeSettler();
    }

    /// @notice The router's CREATE2 address for this creation code, factory, and salt.
    /// @dev Pure and public so a test and a deploy script can check the derivation against the
    ///      address the router actually lands on.
    function computeSettler() public pure returns (address) {
        bytes32 initCodeHash = keccak256(type(UnicaSettlementRouter).creationCode);
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_FACTORY, ROUTER_SALT, initCodeHash))))
        );
    }

    /// @inheritdoc BaseHook
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @dev Invariant I1's gate. Reached only through `BaseHook.beforeSwap`, which is `onlyPoolManager`
    ///      (threat T1); `sender` is the address that called `PoolManager.swap`, and only the router may.
    function _beforeSwap(address sender, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (sender != SETTLER) revert NotSettler(sender);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
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
