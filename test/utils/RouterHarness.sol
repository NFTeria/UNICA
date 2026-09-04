// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";

/// @title RouterHarness, a stand-in for the official router with invariant I7's defence made switchable
/// @notice Test-only. Placed at the Universal Router's address so the hook admits it, it runs the
///         executor's three-action plan the way the official router does (swap, settle the native
///         input, take the output) and answers `msgSender()` the same way. Two switches: drop the
///         `sync` before the native `settle` (the defence off), and sync a foreign ERC-20 earlier in
///         the same unlock (the precondition present). Both are needed to show the defect: without
///         the precondition, an untouched synced slot still takes the native branch and the
///         defenceless settle passes, which is exactly why a test that merely omits the sync proves
///         nothing. The official router's own settle (`DeltaResolver._settle`) always syncs first.
contract RouterHarness is IUnlockCallback {
    using TransientStateLibrary for IPoolManager;

    IPoolManager public immutable POOL_MANAGER;
    address internal locker;
    bool public skipSync;
    Currency public foreignCurrencyToSyncFirst;

    constructor(IPoolManager manager) {
        POOL_MANAGER = manager;
    }

    function setSkipSync(bool v) external {
        skipSync = v;
    }

    function setForeignSyncFirst(Currency c) external {
        foreignCurrencyToSyncFirst = c;
    }

    /// @notice The attribution the official router provides: who called `execute`.
    function msgSender() external view returns (address) {
        return locker;
    }

    function execute(bytes calldata, bytes[] calldata inputs, uint256 deadline) external payable {
        require(block.timestamp <= deadline, "deadline");
        locker = msg.sender;
        POOL_MANAGER.unlock(inputs[0]);
        locker = address(0);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(POOL_MANAGER), "not the PoolManager");
        (, bytes[] memory params) = abi.decode(data, (bytes, bytes[]));

        IV4Router.ExactInputSingleParams memory swap = abi.decode(params[0], (IV4Router.ExactInputSingleParams));
        POOL_MANAGER.swap(
            swap.poolKey,
            SwapParams({
                zeroForOne: swap.zeroForOne,
                amountSpecified: -int256(uint256(swap.amountIn)),
                sqrtPriceLimitX96: swap.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            swap.hookData
        );

        // The native settle, invariant I7's site.
        (Currency input,,) = abi.decode(params[1], (Currency, uint256, bool));
        uint256 debt = uint256(-POOL_MANAGER.currencyDelta(address(this), input));
        if (!foreignCurrencyToSyncFirst.isAddressZero()) {
            // The precondition: an earlier leg of the same unlock left an ERC-20 synced.
            POOL_MANAGER.sync(foreignCurrencyToSyncFirst);
        }
        if (!skipSync) {
            POOL_MANAGER.sync(CurrencyLibrary.ADDRESS_ZERO);
        }
        POOL_MANAGER.settle{value: debt}();

        (Currency output, address to,) = abi.decode(params[2], (Currency, address, uint256));
        uint256 credit = uint256(POOL_MANAGER.currencyDelta(address(this), output));
        POOL_MANAGER.take(output, to, credit);
        return "";
    }

    receive() external payable {}
}
