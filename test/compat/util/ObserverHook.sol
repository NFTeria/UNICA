// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

/// @title ObserverHook, the instrument the router compatibility rows measure with
/// @notice It records the three things the settlement hook's admission check reads — who called the
///         PoolManager, what the router reported as its own caller, and the hook data — and it
///         enforces nothing. That is deliberate: these rows ask whether a router DELIVERS hook data,
///         and a hook that refused anything would make a refusal ambiguous between the router's
///         encoding and the hook's own rules.
/// @dev TEST ONLY. Never deployed anywhere but into a fork. It carries `beforeSwap | afterSwap`, the
///      two permissions `V4SettlementHook` uses, so the pool it guards has the same callback shape as
///      a real settlement pool without any of its behaviour.
contract ObserverHook {
    /// @notice The PoolManager that is allowed to call this hook. Anything else is a bug in a test,
    ///         and a silent one if it is not refused here.
    IPoolManager public immutable MANAGER;

    uint256 public beforeSwapCalls;
    uint256 public afterSwapCalls;

    address public beforeSender;
    bool public beforeZeroForOne;
    int256 public beforeAmountSpecified;
    bytes public beforeHookData;

    address public afterSender;
    int128 public afterAmount0;
    int128 public afterAmount1;
    bytes public afterHookData;

    error NotThePoolManager(address caller);

    constructor(IPoolManager manager) {
        MANAGER = manager;
    }

    modifier onlyManager() {
        if (msg.sender != address(MANAGER)) revert NotThePoolManager(msg.sender);
        _;
    }

    function beforeSwap(address sender, PoolKey calldata, SwapParams calldata params, bytes calldata hookData)
        external
        onlyManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        ++beforeSwapCalls;
        beforeSender = sender;
        beforeZeroForOne = params.zeroForOne;
        beforeAmountSpecified = params.amountSpecified;
        beforeHookData = hookData;
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function afterSwap(
        address sender,
        PoolKey calldata,
        SwapParams calldata,
        BalanceDelta delta,
        bytes calldata hookData
    ) external onlyManager returns (bytes4, int128) {
        ++afterSwapCalls;
        afterSender = sender;
        afterAmount0 = delta.amount0();
        afterAmount1 = delta.amount1();
        afterHookData = hookData;
        return (IHooks.afterSwap.selector, int128(0));
    }
}
