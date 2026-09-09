// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {IHookEvents} from "@openzeppelin/uniswap-hooks/src/interfaces/IHookEvents.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IMsgSender} from "@uniswap/v4-periphery/src/interfaces/IMsgSender.sol";
import {UnicaDeploymentsV3} from "./UnicaDeploymentsV3.sol";
import {UnicaExecutorV3} from "./UnicaExecutorV3.sol";

/// @title UnicaHookV3, the settlement hook, on five chains instead of one
/// @notice Behaviourally this is V1's hook. A swap is admitted when it arrives through Uniswap's
///         official Universal Router, driven by this generation's executor, for an order that is
///         being paid right now, with the swap parameters the order dictates. After the swap it
///         refuses a partial fill or an output below the order's minimum, and emits the receipt.
///         Caller-supplied hook data authenticates nothing; it carries one order id, and everything
///         the hook checks is read from the executor's storage. Permissions are
///         `beforeInitialize | beforeSwap | afterSwap`.
///
///         WHAT CHANGED, AND ONLY THIS. The router, the PoolManager and the payout currency now come
///         from `UnicaDeploymentsV3`, which answers for five chains rather than one, and which the
///         executor also reads for the router's parameter layout. The receipt's fields, types and
///         order are untouched, so `SettlementReceipt`'s topic and `HookFee`'s are the same words the
///         V1 indexer and `tools/unica-verify` already key on: this generation's logs read on the
///         existing readers without a schema change.
///
///         WHY THE HOOK DOES NOT ALSO CHECK THE ROUTER'S CODE HASH. That check belongs in
///         `UnicaExecutorV3`, where it runs once per payment before any value moves and where being
///         wrong is recoverable by deploying a new executor. Putting it in the hook would put it on
///         the PoolManager's callback path — gas on every settlement, for a check the hook cannot act
///         on any better than refusing — and it would brick every pool carrying this hook, forever,
///         the moment a router was redeployed. The hook's own defence against a router that decodes a
///         different head is stronger and cheaper: it requires EXACTLY 32 bytes of hook data. A
///         mismatched layout on a native-input pool delivers ZERO bytes, and `MalformedHookData(0)`
///         is exactly what that becomes here. The quiet failure mode described in
///         `src/compat/RouterParamsCodec.sol` — merchant paid, order id dropped — cannot happen
///         through this hook, because the payment and the receipt are the same transaction and this
///         check reverts it.
///
/// @dev Zero-argument constructor on purpose: a constructor argument enters the CREATE2 init-code
///      hash, so a per-chain argument would put the hook at a different address on every chain.
///      Everything is resolved from the chain id at construction, and the executor's address is
///      derived from its creation code, this hook's address, and a fixed salt through the canonical
///      CREATE2 factory, so nothing is configurable after deploy and the pair is bound both ways.
///      The hook takes no fee: `HookFee` reports zero, honestly.
contract UnicaHookV3 is BaseHook, IHookEvents {
    using PoolIdLibrary for PoolKey;

    /// @notice The canonical CREATE2 factory and the salt the executor is deployed with. Together
    ///         with the executor's creation code they fix `SETTLEMENT_EXECUTOR`.
    address public constant CREATE2_FACTORY = UnicaDeploymentsV3.CREATE2_FACTORY;
    bytes32 public constant EXECUTOR_SALT = bytes32(0);

    /// @notice Uniswap's Universal Router on this chain: the only `sender` a swap may carry.
    address public immutable UNIVERSAL_ROUTER;
    /// @notice The only currency a pool carrying this hook may pay out.
    address public immutable PAYOUT_CURRENCY;
    /// @notice The executor at its CREATE2 address: the only caller the router may report.
    address public immutable SETTLEMENT_EXECUTOR;

    /// @notice Number of settlements this hook has receipted.
    /// @dev Exists so a test and a live transaction can prove the callback actually ran. A
    ///      permission-bit mismatch fails silently — the callback is simply never called, and this
    ///      counter would stay at zero. The executor reads it on both sides of every payment.
    uint256 public receiptCount;

    /// @notice Version of the receipt's field layout (`docs/RECEIPT-SCHEMA.md`). An indexer keys on
    ///         it. Still 1, because the fields below are byte-for-byte V1's; a change to any of them
    ///         is a new version, never an edit of this one.
    uint16 public constant RECEIPT_SCHEMA_VERSION = 1;

    /// @notice The settlement receipt, emitted from inside the swap that settled the order, so it
    ///         exists only if the recipient was paid in the same transaction. Every field comes from
    ///         the order or the swap; the hook address, chain id, transaction hash and log index come
    ///         from the indexing context. `policyId` is reserved for a benefit applied by the
    ///         executor (zero until one exists); `fee` is zero, this hook takes none.
    event SettlementReceipt(
        bytes32 indexed orderId,
        PoolId indexed poolId,
        address indexed recipient,
        uint16 schemaVersion,
        address payer,
        address executor,
        address currencyIn,
        address currencyOut,
        uint128 amountIn,
        uint128 amountOut,
        uint128 fee,
        bytes32 policyId
    );

    /// @notice The pool is not the settlement shape: native ETH in, this chain's payout currency out.
    ///         Refused at initialisation, so no such pool carrying this hook can exist.
    error NotTheSettlementShape(address currency0, address currency1);
    /// @notice The swap did not arrive through the official router.
    error NotOfficialPath(address sender);
    /// @notice The router was driven by something other than this generation's executor.
    error NotSettlementExecutor(address caller);
    /// @notice Hook data is not exactly one order id. A length of ZERO here is the signature of a
    ///         router whose parameter head this executor encoded wrongly: see the note at the top.
    error MalformedHookData(uint256 length);
    /// @notice The order is not being paid right now: unknown, still open, or already settled.
    error OrderNotInFlight(bytes32 orderId, UnicaExecutorV3.Status status);
    /// @notice The order's deadline has passed.
    error OrderExpired(bytes32 orderId, uint64 deadline);
    /// @notice The swap's direction or amount is not the order's.
    error ParamsDoNotMatchOrder(bytes32 orderId);
    /// @notice The swap is in a pool other than the order's.
    error PoolDoesNotMatchOrder(bytes32 orderId);
    /// @notice A second swap for the same order in the same transaction: one receipt per order.
    error OrderAlreadySwapped(bytes32 orderId);
    /// @notice The pool consumed less than the order's input: a partial fill is never a settlement.
    error PartialFill(bytes32 orderId, uint128 requested, uint128 consumed);
    /// @notice The output is below the order's minimum.
    error OutputBelowMinimum(bytes32 orderId, uint128 minOut, uint128 amountOut);

    constructor() BaseHook(IPoolManager(UnicaDeploymentsV3.poolManager(block.chainid))) {
        UNIVERSAL_ROUTER = UnicaDeploymentsV3.universalRouter(block.chainid);
        // Reverts on a chain with no verified payout token, so this hook cannot exist there. A hook
        // deployed against a guessed payout address would carry that guess in its own address and in
        // every receipt it ever emitted, and neither is undoable.
        PAYOUT_CURRENCY = UnicaDeploymentsV3.payoutCurrency(block.chainid);
        SETTLEMENT_EXECUTOR = _computeExecutor();
    }

    /// @dev The executor's CREATE2 address for its creation code plus this hook's address as its one
    ///      constructor argument, the factory, and the salt. So the executor is bound to this hook
    ///      and this hook to that executor, and neither can be paired with another. Internal and
    ///      called from the constructor only, so the executor's creation code lives in this
    ///      contract's creation code and never in its runtime. Scripts and tests recompute the same
    ///      arithmetic themselves, from the factory and salt they hold independently, and compare.
    function _computeExecutor() internal view returns (address) {
        bytes32 initCodeHash =
            keccak256(abi.encodePacked(type(UnicaExecutorV3).creationCode, abi.encode(address(this))));
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_FACTORY, EXECUTOR_SALT, initCodeHash))))
        );
    }

    /// @inheritdoc BaseHook
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
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @dev Enforced where a pool is born rather than where it is used: a pool carrying this hook is
    ///      native ETH against this chain's payout currency, or it does not exist. Without this,
    ///      anyone could initialise a pool naming this hook against a token they printed, settle
    ///      through it, and mint a receipt indistinguishable from a real one. Anyone may still create
    ///      the sanctioned shape at any fee tier: the check is on the currencies, not on the caller,
    ///      so the hook stays permissionless. Reached only through `BaseHook.beforeInitialize`, which
    ///      is `onlyPoolManager`.
    function _beforeInitialize(address, PoolKey calldata key, uint160) internal override returns (bytes4) {
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);
        if (currency0 != address(0) || currency1 != PAYOUT_CURRENCY) {
            revert NotTheSettlementShape(currency0, currency1);
        }
        return IHooks.beforeInitialize.selector;
    }

    /// @dev The admission gate, then the order's own terms. Reached only through `BaseHook.beforeSwap`,
    ///      which is `onlyPoolManager`. `sender` is the address that called `PoolManager.swap`; the
    ///      official router reports who drove it through `msgSender()`, the escape hatch Uniswap's own
    ///      guide prescribes for attributing a swap. The router is asked only after its address is
    ///      confirmed, so no unknown contract is ever called.
    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (sender != UNIVERSAL_ROUTER) revert NotOfficialPath(sender);
        address caller = IMsgSender(sender).msgSender();
        if (caller != SETTLEMENT_EXECUTOR) revert NotSettlementExecutor(caller);

        (bytes32 orderId, UnicaExecutorV3.Order memory order) = _inFlightOrder(hookData);
        if (_swapped(orderId)) revert OrderAlreadySwapped(orderId);
        if (block.timestamp > order.deadline) revert OrderExpired(orderId, order.deadline);
        if (!params.zeroForOne || params.amountSpecified != -int256(uint256(order.amountIn))) {
            revert ParamsDoNotMatchOrder(orderId);
        }
        if (PoolId.unwrap(key.toId()) != PoolId.unwrap(order.key.toId())) revert PoolDoesNotMatchOrder(orderId);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev The full-fill rule, then the receipt. Reached only through `BaseHook.afterSwap`, which is
    ///      `onlyPoolManager`, for the swap `_beforeSwap` admitted with the same hook data. `delta` is
    ///      the swapper's: negative input in currency0, positive output in currency1.
    function _afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta delta, bytes calldata hookData)
        internal
        override
        returns (bytes4, int128)
    {
        (bytes32 orderId, UnicaExecutorV3.Order memory order) = _inFlightOrder(hookData);

        uint128 consumed = uint128(uint256(-int256(delta.amount0())));
        if (consumed != order.amountIn) revert PartialFill(orderId, order.amountIn, consumed);
        int128 out = delta.amount1();
        uint128 amountOut = out > 0 ? uint128(out) : 0;
        if (amountOut < order.minOut) revert OutputBelowMinimum(orderId, order.minOut, amountOut);

        unchecked {
            ++receiptCount;
        }
        _markSwapped(orderId);
        _receipt(orderId, key, order, amountOut);
        return (IHooks.afterSwap.selector, 0);
    }

    /// @dev One swap per order per transaction, whatever plan the executor's caller composed: a plan
    ///      with two swaps for one in-flight order would otherwise receipt twice. Transient storage
    ///      (EIP-1153), so the mark costs no persistent state and vanishes with the transaction; the
    ///      order itself leaves Paying when the executor returns, so a later transaction cannot
    ///      re-enter here either. The slot is namespaced so it cannot collide with anything else, and
    ///      the namespace string names THIS generation so a V1 hook and a V3 hook sharing one
    ///      transaction cannot read each other's mark.
    function _swapped(bytes32 orderId) internal view returns (bool yes) {
        bytes32 slot = keccak256(abi.encode(orderId, "UnicaHookV3.swapped"));
        assembly ("memory-safe") {
            yes := tload(slot)
        }
    }

    function _markSwapped(bytes32 orderId) internal {
        bytes32 slot = keccak256(abi.encode(orderId, "UnicaHookV3.swapped"));
        assembly ("memory-safe") {
            tstore(slot, 1)
        }
    }

    /// @dev The two events, in their own frame so the receipt's twelve fields do not crowd the
    ///      callback's stack. Field order and types are V1's exactly; changing either is a new
    ///      schema version and a new indexer, not an edit here.
    function _receipt(bytes32 orderId, PoolKey calldata key, UnicaExecutorV3.Order memory order, uint128 amountOut)
        internal
    {
        PoolId poolId = key.toId();
        emit SettlementReceipt(
            orderId,
            poolId,
            order.recipient,
            RECEIPT_SCHEMA_VERSION,
            order.payer,
            SETTLEMENT_EXECUTOR,
            Currency.unwrap(key.currency0),
            Currency.unwrap(key.currency1),
            order.amountIn,
            amountOut,
            0,
            bytes32(0)
        );
        emit HookFee(PoolId.unwrap(poolId), order.payer, 0, 0);
    }

    /// @dev The one thing hook data may carry, resolved against the executor's storage. The order
    ///      must be in the Paying state, which only `UnicaExecutorV3.pay` enters and only for the
    ///      duration of its own call.
    function _inFlightOrder(bytes calldata hookData)
        internal
        view
        returns (bytes32 orderId, UnicaExecutorV3.Order memory order)
    {
        if (hookData.length != 32) revert MalformedHookData(hookData.length);
        orderId = abi.decode(hookData, (bytes32));
        order = UnicaExecutorV3(SETTLEMENT_EXECUTOR).orders(orderId);
        if (order.status != UnicaExecutorV3.Status.Paying) revert OrderNotInFlight(orderId, order.status);
    }
}
