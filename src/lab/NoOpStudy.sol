// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

/// @title NoOpStudy — a STUDY of `beforeSwapReturnDelta`, never a tool
/// @notice THIS IS A STUDY. It is not a product, not a library, not something to deploy, and not
///         something to import. It exists so the repository can measure, against Uniswap's real
///         PoolManager bytecode, what the `beforeSwapReturnDelta` permission actually permits — and
///         so the honest limits of any defence against it are written down beside the measurement
///         rather than guessed at. `docs/lab/RETURNS-DELTA.md` carries the rows and those limits.
///
///         The finding, in one line: a hook whose address holds `BEFORE_SWAP_RETURNS_DELTA_FLAG`
///         can consume the whole swap amount in `beforeSwap`, take the payer's input currency for
///         itself, let the pool swap nothing, and return. The payer pays in full and receives
///         nothing. No revert, no missing event, no failed transaction — the swap succeeds.
///
/// @dev Mechanism, from v4-core, so a reader does not have to trust this comment:
///      1. `Hooks.beforeSwap` reads the hook's returned `deltaSpecified` ONLY if the hook's address
///         holds `BEFORE_SWAP_RETURNS_DELTA_FLAG` — `1 << 3`, ADDRESS BIT 3, not bit 10; it is the
///         eleventh field of `Hooks.Permissions`, which is where the name "bit 10" comes from, and
///         address bit 10 is `afterAddLiquidity`, an unrelated permission. It then sets
///         `amountToSwap += deltaSpecified`; returning `-amountSpecified` makes `amountToSwap` zero.
///      2. `Pool.swap` returns a zero delta immediately when `amountSpecified == 0`, so the pool
///         moves no price, no liquidity and no tokens.
///      3. `Hooks.afterSwap` folds that same `deltaSpecified` into `hookDelta` and does
///         `swapDelta = swapDelta - hookDelta`, which is the line the comment beside it describes as
///         the caller paying for the hook's delta. `PoolManager.swap` then credits `hookDelta` to
///         the hook and debits `swapDelta` to the router.
///      The hook calls `take` inside `beforeSwap`; that debit and the credit from step 3 cancel, so
///      the hook's own currency delta is zero at unlock and nothing complains.
///
/// @dev SCOPE. Exact-input only. Exact-output has a different sign convention and is not modelled
///      here; the contract reverts rather than pretend to cover a case it was not measured on.
contract NoOpStudy is BaseHook {
    /// @notice The study models the exact-input case only, and refuses anything else out loud.
    error StudyModelsExactInputOnly();

    /// @notice Input currency taken by this hook, cumulative. A test reads it; nothing else should.
    uint256 public takenTotal;

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    /// @dev `beforeSwap` (0x80) plus `beforeSwapReturnDelta` (0x08) — address mask 0x88.
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @notice Claims the entire swap and delivers nothing.
    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (params.amountSpecified >= 0) revert StudyModelsExactInputOnly();

        uint256 amountIn = uint256(-params.amountSpecified);
        Currency input = params.zeroForOne ? key.currency0 : key.currency1;

        // The payer's input, moved to this contract inside the same call that will tell the pool
        // there is nothing to swap.
        poolManager.take(input, address(this), amountIn);
        takenTotal += amountIn;

        // deltaSpecified = -amountSpecified drives `amountToSwap` to zero.
        return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(int128(-params.amountSpecified), 0), 0);
    }

    receive() external payable {}
}

/// @title PassiveDeltaStudy — the same permission bits, behaving well
/// @notice ALSO A STUDY. Its address holds exactly the same fourteen permission bits as `NoOpStudy`
///         (mask 0x88, the return-delta bit set), and it takes nothing: it returns a zero delta and lets the pool
///         serve the swap. It exists for one purpose — to be the row that proves a payer cannot read
///         intent out of an address. Two hooks, one address mask, opposite outcomes for the payer.
contract PassiveDeltaStudy is BaseHook {
    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    /// @dev Identical to `NoOpStudy.getHookPermissions`. That is the point of this contract.
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        pure
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}

/// @title NoBitTenStudy — the same theft, attempted WITHOUT the return-delta bit
/// @notice ALSO A STUDY, and the control that makes the other measurement mean something. The body
///         below is `NoOpStudy`'s, line for line, with one difference: this contract's address does
///         not hold `beforeSwapReturnDelta` (mask 0x80). v4-core therefore never reads
///         the returned delta, the `take` is never balanced by a credit, and the unlock ends with an
///         unsettled currency — the whole transaction reverts. The theft is a property of the
///         PERMISSION BIT, not of the returned value, and this is how that is measured, not assumed.
contract NoBitTenStudy is BaseHook {
    error StudyModelsExactInputOnly();

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    /// @dev `beforeSwap` alone — address mask 0x80. The single difference from `NoOpStudy`.
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (params.amountSpecified >= 0) revert StudyModelsExactInputOnly();

        uint256 amountIn = uint256(-params.amountSpecified);
        Currency input = params.zeroForOne ? key.currency0 : key.currency1;

        poolManager.take(input, address(this), amountIn);

        return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(int128(-params.amountSpecified), 0), 0);
    }

    receive() external payable {}
}
