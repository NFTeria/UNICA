// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {IHookEvents} from "@openzeppelin/uniswap-hooks/src/interfaces/IHookEvents.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IMsgSender} from "@uniswap/v4-periphery/src/interfaces/IMsgSender.sol";
import {AddressConstants} from "hookmate/constants/AddressConstants.sol";
import {UniswapDeployments} from "./libraries/UniswapDeployments.sol";
import {SettlementExecutor} from "./SettlementExecutor.sol";

/// @title V4SettlementHook, the settlement hook
/// @notice Makes a pool usable only for settlements: a swap is admitted when it arrives through
///         Uniswap's official Universal Router, driven by the SettlementExecutor, for an order that is
///         being paid right now, with the swap parameters the order dictates (invariant I1). After
///         the swap it refuses a partial fill or an output below the order's minimum (invariant I6)
///         and emits the receipt (invariant I2): UNICA's order-bearing `SettlementReceipt` and
///         OpenZeppelin's standard `HookFee`, so a generic indexer sees the settlement too.
///         Caller-supplied hook data authenticates nothing; it carries one order id, and everything
///         the hook checks is read from the executor's storage (spec C1). Permissions are
///         `beforeSwap | afterSwap`, mask 0xC0 (spec section 5).
/// @dev Zero-argument constructor on purpose (spec section 7d): a constructor argument enters the
///      CREATE2 init-code hash, so a per-chain argument would put the hook at a different address on
///      every chain. The manager and the router are resolved from the chain id, and the executor's
///      address is derived from its own creation code and a fixed salt through the canonical CREATE2
///      factory, so all three are the same on every listed chain and nothing is configurable after
///      deploy. The hook takes no fee this event: `HookFee` reports zero, honestly.
contract V4SettlementHook is BaseHook, IHookEvents {
    using PoolIdLibrary for PoolKey;

    /// @notice The canonical CREATE2 factory (the same one forge scripts use) and the salt the executor
    ///         is deployed with. Together with the executor's creation code they fix `SETTLEMENT_EXECUTOR`.
    address public constant CREATE2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 public constant EXECUTOR_SALT = bytes32(0);

    /// @notice Uniswap's Universal Router on this chain: the only `sender` a swap may carry.
    address public immutable UNIVERSAL_ROUTER;
    /// @notice The SettlementExecutor at its CREATE2 address: the only caller the router may report.
    address public immutable SETTLEMENT_EXECUTOR;

    /// @notice Number of settlements this hook has receipted.
    /// @dev Exists so a test and a live transaction can prove the callback actually ran. A
    ///      permission-bit mismatch fails silently (spec section 5, threat T5): the callback is
    ///      simply never called, and this counter would stay at zero.
    uint256 public receiptCount;

    /// @notice The settlement receipt (invariant I2), emitted from inside the swap that settled the
    ///         order, so it exists only if the recipient was paid in the same transaction.
    event SettlementReceipt(
        bytes32 indexed orderId,
        PoolId indexed poolId,
        address indexed recipient,
        address payer,
        uint128 amountIn,
        uint128 amountOut,
        uint128 fee
    );

    /// @notice The swap did not arrive through the official router (invariant I1).
    error NotOfficialPath(address sender);
    /// @notice The router was driven by something other than the executor (invariant I1).
    error NotSettlementExecutor(address caller);
    /// @notice Hook data is not exactly one order id (spec C1).
    error MalformedHookData(uint256 length);
    /// @notice The order is not being paid right now: unknown, still open, or already settled (invariant I5).
    error OrderNotInFlight(bytes32 orderId, SettlementExecutor.Status status);
    /// @notice The order's deadline has passed (invariant I4).
    error OrderExpired(bytes32 orderId, uint64 deadline);
    /// @notice The swap's direction or amount is not the order's (invariant I3).
    error ParamsDoNotMatchOrder(bytes32 orderId);
    /// @notice The swap is in a pool other than the order's (invariant I3).
    error PoolDoesNotMatchOrder(bytes32 orderId);
    /// @notice The pool consumed less than the order's input: a partial fill is never a settlement (invariant I6).
    error PartialFill(bytes32 orderId, uint128 requested, uint128 consumed);
    /// @notice The output is below the order's minimum (invariant I6).
    error OutputBelowMinimum(bytes32 orderId, uint128 minOut, uint128 amountOut);

    constructor() BaseHook(IPoolManager(AddressConstants.getPoolManagerAddress(block.chainid))) {
        UNIVERSAL_ROUTER = UniswapDeployments.universalRouter(block.chainid);
        SETTLEMENT_EXECUTOR = _computeExecutor();
    }

    /// @dev The executor's CREATE2 address for its creation code, the factory, and the salt. Internal
    ///      and called from the constructor only, so the executor's creation code lives in this
    ///      contract's creation code and never in its runtime (a public version carried it into the
    ///      runtime and tripled the deployed size). Tests and the deploy script recompute the same
    ///      arithmetic themselves and compare it with SETTLEMENT_EXECUTOR.
    function _computeExecutor() internal pure returns (address) {
        bytes32 initCodeHash = keccak256(type(SettlementExecutor).creationCode);
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_FACTORY, EXECUTOR_SALT, initCodeHash))))
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

    /// @dev Invariant I1's gate, then the order's own terms. Reached only through `BaseHook.beforeSwap`,
    ///      which is `onlyPoolManager` (threat T1). `sender` is the address that called
    ///      `PoolManager.swap`; the official router reports who drove it through `msgSender()`, the
    ///      escape hatch Uniswap's own guide prescribes for attributing a swap. The router is asked
    ///      only after its address is confirmed, so no unknown contract is ever called.
    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (sender != UNIVERSAL_ROUTER) revert NotOfficialPath(sender);
        address caller = IMsgSender(sender).msgSender();
        if (caller != SETTLEMENT_EXECUTOR) revert NotSettlementExecutor(caller);

        (bytes32 orderId, SettlementExecutor.Order memory order) = _inFlightOrder(hookData);
        if (block.timestamp > order.deadline) revert OrderExpired(orderId, order.deadline);
        if (!params.zeroForOne || params.amountSpecified != -int256(uint256(order.amountIn))) {
            revert ParamsDoNotMatchOrder(orderId);
        }
        if (PoolId.unwrap(key.toId()) != PoolId.unwrap(order.key.toId())) revert PoolDoesNotMatchOrder(orderId);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev Invariant I6, then the receipt. Reached only through `BaseHook.afterSwap`, which is
    ///      `onlyPoolManager` (threat T1), for the swap `_beforeSwap` admitted with the same hook data.
    ///      `delta` is the swapper's: negative input in currency0, positive output in currency1.
    function _afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta delta, bytes calldata hookData)
        internal
        override
        returns (bytes4, int128)
    {
        (bytes32 orderId, SettlementExecutor.Order memory order) = _inFlightOrder(hookData);

        uint128 consumed = uint128(uint256(-int256(delta.amount0())));
        if (consumed != order.amountIn) revert PartialFill(orderId, order.amountIn, consumed);
        int128 out = delta.amount1();
        uint128 amountOut = out > 0 ? uint128(out) : 0;
        if (amountOut < order.minOut) revert OutputBelowMinimum(orderId, order.minOut, amountOut);

        unchecked {
            ++receiptCount;
        }
        PoolId poolId = key.toId();
        emit SettlementReceipt(orderId, poolId, order.recipient, order.payer, order.amountIn, amountOut, 0);
        emit HookFee(PoolId.unwrap(poolId), order.payer, 0, 0);
        return (IHooks.afterSwap.selector, 0);
    }

    /// @dev The one thing hook data may carry, resolved against the executor's storage (spec C1).
    ///      The order must be in the Paying state, which only `SettlementExecutor.pay` enters and
    ///      only for the duration of its own call (invariant I5).
    function _inFlightOrder(bytes calldata hookData)
        internal
        view
        returns (bytes32 orderId, SettlementExecutor.Order memory order)
    {
        if (hookData.length != 32) revert MalformedHookData(hookData.length);
        orderId = abi.decode(hookData, (bytes32));
        order = SettlementExecutor(SETTLEMENT_EXECUTOR).orders(orderId);
        if (order.status != SettlementExecutor.Status.Paying) revert OrderNotInFlight(orderId, order.status);
    }
}
