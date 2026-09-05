// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IMsgSender} from "@uniswap/v4-periphery/src/interfaces/IMsgSender.sol";

/// @title ObserverHook, a test-only hook that records what a PoolManager tells it
/// @notice Test-only, for the fork probes under `test/fork/`. It is NOT the settlement hook and enforces
///         nothing: `beforeSwap` and `afterSwap` record their arguments and return the plain selectors
///         with zero deltas. It exists so a probe on a PoolManager the repository has never run against
///         can show, from inside the callback, which `sender` arrives, what `hookData` arrives, and what
///         the sender's `msgSender()` answers, which are the three inputs the settlement hook's
///         admission check (invariant I1) is built on. Permissions: beforeSwap | afterSwap, mask 0xC0,
///         the same two swap callbacks the settlement hook uses.
contract ObserverHook is BaseHook {
    uint256 public beforeSwapCalls;
    uint256 public afterSwapCalls;

    /// @notice What the last `beforeSwap` saw.
    address public beforeSender;
    /// @notice `IMsgSender(sender).msgSender()` asked during the last `beforeSwap`; zero when the sender
    ///         has no code or does not answer, so a sender that is not a router records as zero.
    address public beforeRouterCaller;
    bytes32 public beforeHookData;
    uint256 public beforeHookDataLength;
    int256 public beforeAmountSpecified;
    bool public beforeZeroForOne;

    /// @notice What the last `afterSwap` saw.
    address public afterSender;
    bytes32 public afterHookData;
    uint256 public afterHookDataLength;
    int256 public afterAmountSpecified;
    int128 public afterAmount0;
    int128 public afterAmount1;

    constructor(IPoolManager manager) BaseHook(manager) {}

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

    function _beforeSwap(address sender, PoolKey calldata, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        ++beforeSwapCalls;
        beforeSender = sender;
        beforeRouterCaller = _askMsgSender(sender);
        beforeHookDataLength = hookData.length;
        beforeHookData = hookData.length == 32 ? abi.decode(hookData, (bytes32)) : bytes32(0);
        beforeAmountSpecified = params.amountSpecified;
        beforeZeroForOne = params.zeroForOne;
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        ++afterSwapCalls;
        afterSender = sender;
        afterHookDataLength = hookData.length;
        afterHookData = hookData.length == 32 ? abi.decode(hookData, (bytes32)) : bytes32(0);
        afterAmountSpecified = params.amountSpecified;
        afterAmount0 = delta.amount0();
        afterAmount1 = delta.amount1();
        return (IHooks.afterSwap.selector, 0);
    }

    /// @dev A low-level staticcall so a sender without code, or without `msgSender()`, records as zero
    ///      instead of aborting the swap. The settlement hook calls it directly, after confirming the
    ///      sender is the official router; this observer confirms nothing, it only records.
    function _askMsgSender(address sender) internal view returns (address caller) {
        if (sender.code.length == 0) return address(0);
        (bool ok, bytes memory ret) = sender.staticcall(abi.encodeWithSelector(IMsgSender.msgSender.selector));
        if (ok && ret.length == 32) caller = abi.decode(ret, (address));
    }
}
