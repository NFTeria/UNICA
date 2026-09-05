// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

/// @title ForkLiquidityHelper, a test-only unlock caller for a PoolManager whose test routers are absent
/// @notice Test-only, for the fork probes under `test/fork/`. On a chain where v4-core's
///         `PoolModifyLiquidityTest` and `PoolSwapTest` are not deployed, a probe still needs to put
///         liquidity into a pool and, for one control, to swap directly against the PoolManager. This
///         contract does both through `unlock` and closes every delta the way the official router does:
///         for an ERC-20 debt, `sync`, transfer, `settle`; for a native debt, `sync` the native slot,
///         then `settle` with value (invariant I7's lesson: a stale synced ERC-20 must never be in the
///         slot when native value is settled). A credit is taken to the payer. Anything left over is
///         refunded, so the helper holds nothing between calls.
contract ForkLiquidityHelper is IUnlockCallback {
    using CurrencyLibrary for Currency;

    IPoolManager public immutable MANAGER;

    uint8 internal constant MODE_MODIFY = 1;
    uint8 internal constant MODE_SWAP = 2;

    error NotThePoolManager(address caller);
    error RefundFailed(address to, uint256 amount);

    constructor(IPoolManager manager) {
        MANAGER = manager;
    }

    /// @notice Adds or removes liquidity for `msg.sender`, who has approved this contract for any ERC-20
    ///         side and sent value for a native side. Returns the caller's delta.
    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params)
        external
        payable
        returns (BalanceDelta delta)
    {
        bytes memory result = MANAGER.unlock(abi.encode(MODE_MODIFY, msg.sender, key, abi.encode(params), bytes("")));
        delta = abi.decode(result, (BalanceDelta));
        _refund(msg.sender);
    }

    /// @notice A direct swap against the PoolManager, so a hook sees THIS contract as `sender`. This is
    ///         the control that shows a recorded sender is the real `msg.sender` of `swap` and not a constant.
    function swap(PoolKey memory key, SwapParams memory params, bytes memory hookData)
        external
        payable
        returns (BalanceDelta delta)
    {
        bytes memory result = MANAGER.unlock(abi.encode(MODE_SWAP, msg.sender, key, abi.encode(params), hookData));
        delta = abi.decode(result, (BalanceDelta));
        _refund(msg.sender);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(MANAGER)) revert NotThePoolManager(msg.sender);
        (uint8 mode, address payer, PoolKey memory key, bytes memory encodedParams, bytes memory hookData) =
            abi.decode(raw, (uint8, address, PoolKey, bytes, bytes));

        BalanceDelta delta;
        if (mode == MODE_MODIFY) {
            (delta,) = MANAGER.modifyLiquidity(key, abi.decode(encodedParams, (ModifyLiquidityParams)), hookData);
        } else {
            delta = MANAGER.swap(key, abi.decode(encodedParams, (SwapParams)), hookData);
        }
        _close(key.currency0, delta.amount0(), payer);
        _close(key.currency1, delta.amount1(), payer);
        return abi.encode(delta);
    }

    /// @dev Settles a debt or takes a credit for one currency. Sync always precedes settle.
    function _close(Currency currency, int128 amount, address payer) internal {
        if (amount < 0) {
            uint256 owed = uint256(uint128(-amount));
            MANAGER.sync(currency);
            if (currency.isAddressZero()) {
                MANAGER.settle{value: owed}();
            } else {
                IERC20Minimal(Currency.unwrap(currency)).transferFrom(payer, address(MANAGER), owed);
                MANAGER.settle();
            }
        } else if (amount > 0) {
            MANAGER.take(currency, payer, uint256(uint128(amount)));
        }
    }

    function _refund(address to) internal {
        uint256 left = address(this).balance;
        if (left == 0) return;
        (bool ok,) = to.call{value: left}("");
        if (!ok) revert RefundFailed(to, left);
    }

    receive() external payable {}
}
