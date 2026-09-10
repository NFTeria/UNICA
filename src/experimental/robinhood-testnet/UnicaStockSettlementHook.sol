// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {UnicaStockSettlementTypes as T} from "./UnicaStockSettlementTypes.sol";
import {UnicaStockSettlementErrors as E} from "./UnicaStockSettlementErrors.sol";
import {UnicaStockSettlementEvents as Ev} from "./UnicaStockSettlementEvents.sol";
import {IUnicaStockOrders} from "./interfaces/IUnicaStockOrders.sol";

/// @title UnicaStockSettlementHook — the policy boundary, enforcing only what it can prove
/// @notice EXPERIMENTAL. Deployed nowhere. The live V3 generation is untouched.
///
///         WHY THERE IS NO ROUTER IN THIS GENERATION, which is the design's largest departure.
///         V3 reaches the pool through Uniswap's Universal Router and must therefore trust two
///         things it cannot verify: that the router decodes the parameter head the executor encoded
///         (the chain this generation targets carries a router build that decodes a DIFFERENT head,
///         and refuses the other with an empty revert), and that the router's own `msgSender()`
///         faithfully reports who drove it. Here the executor takes the PoolManager's lock itself,
///         so `sender` in `beforeSwap` IS the executor — an identity the PoolManager establishes,
///         not one a third contract reports. One fewer trusted party, and the parameter-layout
///         hazard disappears with it.
///
///         WHAT THIS HOOK DOES NOT CLAIM. It never asserts the merchant was paid. At `afterSwap`
///         the pool's delta is authoritative about the SWAP, and says nothing about whether the
///         token then delivered — `take` has not run yet, and a token that lies about `transfer`
///         would still be believed here. The executor measures the merchant's own balance after the
///         lock closes, and only that measurement is allowed to end an order.
contract UnicaStockSettlementHook is BaseHook {
    using PoolIdLibrary for PoolKey;

    /// @notice The one contract permitted to drive a settlement swap through this hook.
    address public immutable SETTLEMENT_EXECUTOR;
    /// @notice The only currency a payer may fund with, on this generation.
    address public immutable INPUT_CURRENCY;
    /// @notice The only currency a merchant may be paid in, on this generation.
    address public immutable PAYOUT_CURRENCY;

    /// @notice Settlements this hook has receipted. Read by the executor across one payment to
    ///         prove exactly one receipt was emitted — a count, not a statistic.
    uint256 public receiptCount;

    /// @dev Transient: order ids already swapped in THIS transaction. One settlement lifecycle per
    ///      committed context, enforced where a second swap would otherwise be indistinguishable
    ///      from the first. Transient rather than persistent because the constraint is per
    ///      transaction; an order that fails and is retried in a later transaction is not a replay.
    bytes32 private constant SWAPPED_SLOT = keccak256("unica.experimental.stock.swapped");

    constructor(IPoolManager poolManager_, address executor_, address inputCurrency_, address payoutCurrency_)
        BaseHook(poolManager_)
    {
        SETTLEMENT_EXECUTOR = executor_;
        INPUT_CURRENCY = inputCurrency_;
        PAYOUT_CURRENCY = payoutCurrency_;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            // Deliberately false. A hook that returns a delta can claim to have handled a swap it
            // did not perform, and keep the input. Nothing this generation does requires it.
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @dev Enforced where a pool is BORN rather than where it is used. Without this, anyone could
    ///      initialise a pool naming this hook against a token they printed, settle through it, and
    ///      emit a receipt indistinguishable from a real one. The check is on the currencies, not on
    ///      the caller, so the hook stays permissionless: anyone may create the sanctioned shape at
    ///      any fee tier, and nobody may create any other shape.
    function _beforeInitialize(address, PoolKey calldata key, uint160) internal view override returns (bytes4) {
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        bool shaped = (c0 == INPUT_CURRENCY && c1 == PAYOUT_CURRENCY) || (c0 == PAYOUT_CURRENCY && c1 == INPUT_CURRENCY);
        if (!shaped) revert E.NotTheSettlementShape(c0, c1);
        return BaseHook.beforeInitialize.selector;
    }

    /// @dev `sender` here is the address that called `PoolManager.swap`. Because this generation
    ///      takes the lock itself, that is the executor directly — established by the PoolManager,
    ///      not reported by a router. A forged direct call cannot reach this function at all:
    ///      `BaseHook` is `onlyPoolManager`.
    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (sender != SETTLEMENT_EXECUTOR) revert E.NotSettlementExecutor(sender);
        if (hookData.length != 32) revert E.MalformedHookData(hookData.length);
        bytes32 orderId = abi.decode(hookData, (bytes32));

        T.Order memory order = _order(orderId);
        if (order.status != T.Status.Paying) revert E.OrderNotInFlight(orderId, order.status);
        if (_swapped(orderId)) revert E.OrderAlreadySwapped(orderId);
        if (order.deadline < block.timestamp) revert E.OrderExpired(orderId, order.deadline);

        // Direction is DERIVED from the order's own pool key, never hard-coded. The input token may
        // sort either side of the payout token, and a constant here would silently settle backwards
        // on any pair that sorts the other way.
        bool expectZeroForOne = Currency.unwrap(key.currency0) == INPUT_CURRENCY;
        if (params.zeroForOne != expectZeroForOne) revert E.ParamsDoNotMatchOrder(orderId);
        if (params.amountSpecified != -int256(uint256(order.amountIn))) revert E.ParamsDoNotMatchOrder(orderId);
        if (PoolId.unwrap(key.toId()) != PoolId.unwrap(order.key.toId())) revert E.PoolDoesNotMatchOrder(orderId);

        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev The only place the swap's outcome exists. Refuses a partial fill and an output below the
    ///      order's floor, then records the receipt. Says nothing about delivery — see the notice.
    function _afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta delta, bytes calldata hookData)
        internal
        override
        returns (bytes4, int128)
    {
        bytes32 orderId = abi.decode(hookData, (bytes32));
        T.Order memory order = _order(orderId);

        bool zeroForOne = Currency.unwrap(key.currency0) == INPUT_CURRENCY;
        int128 spent = zeroForOne ? delta.amount0() : delta.amount1();
        int128 got = zeroForOne ? delta.amount1() : delta.amount0();

        uint128 consumed = uint128(-spent);
        if (consumed != order.amountIn) revert E.PartialFill(orderId, order.amountIn, consumed);
        uint128 produced = uint128(got);
        if (produced < order.minOut) revert E.OutputBelowMinimum(orderId, order.minOut, produced);

        _markSwapped(orderId);
        unchecked {
            receiptCount++;
        }
        emit Ev.SettlementReceipt(
            orderId,
            order.recipient,
            order.payer,
            INPUT_CURRENCY,
            PAYOUT_CURRENCY,
            order.amountIn,
            produced,
            0,
            bytes32(0)
        );
        return (BaseHook.afterSwap.selector, int128(0));
    }

    function _order(bytes32 orderId) private view returns (T.Order memory) {
        return IUnicaStockOrders(SETTLEMENT_EXECUTOR).orders(orderId);
    }

    function _swapped(bytes32 orderId) private view returns (bool seen) {
        bytes32 slot = keccak256(abi.encode(SWAPPED_SLOT, orderId));
        assembly ("memory-safe") {
            seen := tload(slot)
        }
    }

    function _markSwapped(bytes32 orderId) private {
        bytes32 slot = keccak256(abi.encode(SWAPPED_SLOT, orderId));
        assembly ("memory-safe") {
            tstore(slot, 1)
        }
    }
}
