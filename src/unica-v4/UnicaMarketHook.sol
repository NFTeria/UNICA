// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {ProtocolFeeLibrary} from "@uniswap/v4-core/src/libraries/ProtocolFeeLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

import {UnicaMarketTypes} from "./UnicaMarketTypes.sol";
import {UnicaMarketExecutor} from "./UnicaMarketExecutor.sol";
import {IUnicaMarketHook} from "./interfaces/IUnicaMarketHook.sol";
import {IUnicaMarketExecutor} from "./interfaces/IUnicaMarketExecutor.sol";
import {IUnicaMarketRegistry} from "./interfaces/IUnicaMarketRegistry.sol";
import {IUnicaPriceOracle, IUnicaOracleRoute} from "./interfaces/IUnicaPriceOracle.sol";

/// @title UnicaMarketHook, the market's own rule about what a swap in its pool has to be
/// @notice Written from `docs/unica-v4/SPEC-CONTRACTS.md` §8 and §11 and
///         `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` §4. One source, one instance per market, at a
///         factory CREATE2 address whose low fourteen bits are exactly `0x20C0`.
///
///         WHAT IT ENFORCES, IN ORDER. One pool, initialised by the factory alone. One swapper, the
///         executor this hook created in its own constructor. Before the swap: an order that is being
///         paid right now, not already swapped in this transaction, not expired, and swap parameters
///         that are the order's own. After the swap: the full fill, the order's minimum, and — when
///         the market carries an oracle policy — a two-sided band around the reference price with the
///         pool fee divided out. Only then is the receipt emitted. Any failure reverts the whole
///         settlement: the payer keeps the input, the merchant receives nothing, and no receipt
///         survives, because the receipt and the payment are one transaction.
///
///         WHAT IT CANNOT DO. It takes no fee — `HOOK_FEE_PIPS` is the constant zero, the fee
///         override it returns is zero and neither return-delta flag is set, so there is no path by
///         which it could keep a unit of either token. It has no admin, no setter and no storage
///         anyone can steer. It never calls `initialize`, `swap`, `unlock`, `modifyLiquidity` or
///         `donate` on the PoolManager (A4); the PoolManager skips a hook's own callbacks when the
///         hook is the caller, so a hook that reached back into the pool would be a hook whose own
///         rules did not apply to it.
///
/// @dev Every external call this contract makes on the swap path is to a function declared `view`,
///      which the compiler emits as a STATICCALL: the executor's `orders`, the registry's
///      `oraclePolicyOf`, the adapter's `feedIdFor` and `latestPrice`, and `extsload` behind
///      `StateLibrary`. That is what makes the two `slot0` readings — the pool's own and this hook's —
///      provably the same value: nothing reachable from here can change a protocol fee in between
///      (A14). `oracleCondition()` is the single exception that catches an adapter revert, and it is
///      a view that no settlement path calls.
contract UnicaMarketHook is BaseHook, IUnicaMarketHook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @notice The computed answer to "is the reference usable right now" (SO §6). Never stored.
    enum OracleCondition {
        OK,
        DEMONSTRATION_ONLY,
        STALE_ORACLE,
        MARKET_CLOSED
    }

    /// @dev The receipt under construction, in memory. It exists because the receipt has sixteen
    ///      fields and the legacy code generator cannot hold sixteen values plus a callback's
    ///      arguments on the stack; via-IR is not the way out, because switching it on would change
    ///      the bytecode of contracts whose addresses are mined against their creation code. Each
    ///      stage fills its own fields and none reads a field a later stage has not written yet.
    struct ReceiptData {
        bytes32 orderId;
        address recipient;
        address payer;
        uint128 amountIn;
        uint128 amountOut;
        uint24 lpFee;
        uint24 protocolFee;
        uint24 swapFee;
        uint256 price;
        uint8 decimals;
        uint64 updatedAt;
        bool demonstrationOnly;
    }

    // ---- immutables and constants -----------------------------------------------------------------

    /// @notice This hook takes no fee, and structurally cannot: the field exists so a reader never
    ///         has to infer it from an absence.
    uint24 public constant HOOK_FEE_PIPS = 0;

    /// @inheritdoc IUnicaMarketHook
    address public immutable FACTORY;
    /// @inheritdoc IUnicaMarketHook
    address public immutable REGISTRY;
    /// @inheritdoc IUnicaMarketHook
    bytes32 public immutable MARKET_ID;
    /// @inheritdoc IUnicaMarketHook
    address public immutable EXECUTOR;
    /// @inheritdoc IUnicaMarketHook
    bytes32 public immutable POOL_ID;

    address public immutable ASSET_TOKEN;
    address public immutable PAYOUT_TOKEN;
    uint24 public immutable FEE;
    int24 public immutable TICK_SPACING;
    uint8 public immutable ASSET_DECIMALS;
    uint8 public immutable PAYOUT_DECIMALS;
    /// @notice Derived from the two addresses, never configured.
    bool public immutable ASSET_IS_CURRENCY0;
    /// @notice Read from the registry at construction, so a registry mutant that stopped enforcing an
    ///         oracle policy at `register` still cannot make this hook settle without one.
    bool public immutable REQUIRE_ORACLE;

    /// @inheritdoc IUnicaMarketHook
    uint256 public receiptCount;

    // ---- errors (SC §8.3) ---------------------------------------------------------------------------

    error NotMarketFactory(address sender);
    error NotTheMarketPool(bytes32 poolId);
    error NotSettlementExecutor(address sender);
    error MalformedHookData(uint256 length);
    error OrderNotInFlight(bytes32 orderId, uint8 status);
    error OrderAlreadySwapped(bytes32 orderId);
    error OrderExpired(bytes32 orderId, uint64 deadline);
    error ParamsDoNotMatchOrder(bytes32 orderId);
    error PartialFill(bytes32 orderId, uint128 expected, uint128 consumed);
    error OutputBelowMinimum(bytes32 orderId, uint128 minOut, uint128 produced);
    error OraclePolicyRequired(bytes32 marketId);
    error OracleFeedMismatch(bytes32 marketId, bytes32 expected, bytes32 actual);
    error OraclePriceZero(bytes32 marketId);
    error OracleDecimalsUnsupported(bytes32 marketId, uint8 decimals);
    error OraclePriceOutOfRange(bytes32 marketId, uint256 price);
    error OracleTimestampInFuture(bytes32 marketId, uint256 updatedAt);
    error OracleTimestampNotBeforeBlock(bytes32 marketId, uint256 updatedAt);
    error OracleStale(bytes32 marketId, uint256 age, uint48 maxAge);
    error ExecutionBelowOracleBand(bytes32 marketId, uint256 out, uint256 minAllowed);
    error ExecutionAboveOracleBand(bytes32 marketId, uint256 out, uint256 maxAllowed);

    /// @dev BaseHook's constructor runs first and reverts unless all fourteen permission bits match
    ///      this address, so a hook at a wrong address never finishes being born. Then the pool id is
    ///      computed from the sorted currencies, and the executor is created — `CREATE(hook, 1)`,
    ///      because a new contract's nonce starts at 1 (EIP-161), which is what lets the factory
    ///      predict the pair from the hook's arguments alone.
    constructor(
        IPoolManager poolManager_,
        address registry_,
        bytes32 marketId_,
        address asset_,
        address payout_,
        uint24 fee_,
        int24 tickSpacing_,
        uint8 assetDecimals_,
        uint8 payoutDecimals_
    ) BaseHook(poolManager_) {
        FACTORY = msg.sender;
        REGISTRY = registry_;
        MARKET_ID = marketId_;
        ASSET_TOKEN = asset_;
        PAYOUT_TOKEN = payout_;
        FEE = fee_;
        TICK_SPACING = tickSpacing_;
        ASSET_DECIMALS = assetDecimals_;
        PAYOUT_DECIMALS = payoutDecimals_;

        bool assetIsCurrency0 = asset_ < payout_;
        ASSET_IS_CURRENCY0 = assetIsCurrency0;
        (address currency0, address currency1) = assetIsCurrency0 ? (asset_, payout_) : (payout_, asset_);
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: fee_,
            tickSpacing: tickSpacing_,
            hooks: IHooks(address(this))
        });
        POOL_ID = PoolId.unwrap(poolKey.toId());

        REQUIRE_ORACLE = IUnicaMarketRegistry(registry_).REQUIRE_ORACLE();
        EXECUTOR =
            address(new UnicaMarketExecutor(poolManager_, registry_, marketId_, asset_, payout_, fee_, tickSpacing_));
    }

    /// @inheritdoc BaseHook
    /// @dev Exactly `beforeInitialize | beforeSwap | afterSwap`, which is `0x20C0`. No return-delta
    ///      flag is set, which is half of why this hook cannot take a fee; the other half is that the
    ///      fee override it returns is zero.
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

    // ---- callbacks ----------------------------------------------------------------------------------

    /// @dev One pool, born once, from the factory. Reached only through `BaseHook.beforeInitialize`,
    ///      which is `onlyPoolManager`. The key check is unreachable through the factory, which builds
    ///      the key from the same values this hook was given; it is here because "unreachable through
    ///      the intended caller" is not the same as "impossible".
    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal view override returns (bytes4) {
        if (sender != FACTORY) revert NotMarketFactory(sender);
        bytes32 id = PoolId.unwrap(key.toId());
        if (id != POOL_ID) revert NotTheMarketPool(id);
        return IHooks.beforeInitialize.selector;
    }

    /// @dev The admission gate. `sender` is the address that called `PoolManager.swap`, established by
    ///      the PoolManager rather than reported by anyone, and the only address this market admits is
    ///      the executor born in this hook's own constructor. Everything else is read from that
    ///      executor's storage: hook data carries one order id and authenticates nothing by itself.
    function _beforeSwap(address sender, PoolKey calldata, SwapParams calldata params, bytes calldata hookData)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (sender != EXECUTOR) revert NotSettlementExecutor(sender);
        if (hookData.length != 32) revert MalformedHookData(hookData.length);
        bytes32 orderId = abi.decode(hookData, (bytes32));

        UnicaMarketTypes.Order memory order = IUnicaMarketExecutor(EXECUTOR).orders(orderId);
        if (order.status != UnicaMarketTypes.OrderStatus.Paying) {
            revert OrderNotInFlight(orderId, uint8(order.status));
        }
        if (_swapped(orderId)) revert OrderAlreadySwapped(orderId);
        if (order.deadline < block.timestamp) revert OrderExpired(orderId, order.deadline);
        if (params.zeroForOne != ASSET_IS_CURRENCY0 || params.amountSpecified != -int256(uint256(order.amountIn))) {
            revert ParamsDoNotMatchOrder(orderId);
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev The fill, the oracle and the receipt, in three frames. Split not for taste but because
    ///      one frame does not fit: the legacy code generator runs out of stack, and via-IR is not an
    ///      option here because switching it on would change the bytecode of contracts whose addresses
    ///      are mined against their creation code.
    function _afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta delta, bytes calldata hookData)
        internal
        override
        returns (bytes4, int128)
    {
        ReceiptData memory receipt;
        receipt.orderId = abi.decode(hookData, (bytes32));

        UnicaMarketTypes.Order memory order = IUnicaMarketExecutor(EXECUTOR).orders(receipt.orderId);
        receipt.recipient = order.recipient;
        receipt.payer = order.payer;

        (receipt.amountIn, receipt.amountOut) = _roleAmounts(delta);
        _checkFill(receipt.orderId, order, receipt.amountIn, receipt.amountOut);

        _readFees(receipt);
        _checkOracle(receipt);
        _emitReceipt(receipt);

        return (IHooks.afterSwap.selector, 0);
    }

    /// @dev Amounts by ROLE, never by currency index: the same two lines have to be right for a market
    ///      whose asset sorts first and one whose asset sorts second, and reading `amount0` as "the
    ///      input" is exactly the bug that only shows up on half the markets.
    function _roleAmounts(BalanceDelta delta) private view returns (uint128 consumed, uint128 produced) {
        int128 inLeg = ASSET_IS_CURRENCY0 ? delta.amount0() : delta.amount1();
        int128 outLeg = ASSET_IS_CURRENCY0 ? delta.amount1() : delta.amount0();
        consumed = inLeg < 0 ? uint128(-inLeg) : 0;
        produced = outLeg > 0 ? uint128(outLeg) : 0;
    }

    /// @dev A partial fill is never a settlement, and the order's floor is checked here as well as at
    ///      the executor: this one is about what the POOL did, the executor's `RecipientShort` is about
    ///      what the merchant actually received, and a token can make those two disagree.
    function _checkFill(bytes32 orderId, UnicaMarketTypes.Order memory order, uint128 consumed, uint128 produced)
        private
        pure
    {
        if (consumed != order.amountIn) revert PartialFill(orderId, order.amountIn, consumed);
        if (produced < order.minOut) revert OutputBelowMinimum(orderId, order.minOut, produced);
    }

    /// @dev SC §8.2 steps 1 to 5. Nothing here is caught: an adapter that reverts reverts the
    ///      settlement, and the PoolManager wraps it as `WrappedError` so the inner selector survives
    ///      to the caller. The two range checks run BEFORE any multiplication, so an absurd price
    ///      refuses by name instead of by an arithmetic panic that says nothing about why.
    function _checkOracle(ReceiptData memory receipt) private view {
        UnicaMarketTypes.OraclePolicy memory policy = IUnicaMarketRegistry(REGISTRY).oraclePolicyOf(MARKET_ID);
        if (!policy.enabled) {
            if (REQUIRE_ORACLE) revert OraclePolicyRequired(MARKET_ID);
            receipt.demonstrationOnly = true;
            return;
        }

        bytes32 routeId = IUnicaOracleRoute(policy.adapter).feedIdFor(ASSET_TOKEN, PAYOUT_TOKEN);
        if (routeId != policy.feedId) revert OracleFeedMismatch(MARKET_ID, policy.feedId, routeId);

        (uint256 price, uint8 decimals, uint256 updatedAt) =
            IUnicaPriceOracle(policy.adapter).latestPrice(ASSET_TOKEN, PAYOUT_TOKEN);

        if (price == 0) revert OraclePriceZero(MARKET_ID);
        if (updatedAt > block.timestamp) revert OracleTimestampInFuture(MARKET_ID, updatedAt);
        // A timestamp equal to the block is never proof of freshness: a source that stamps "now" makes
        // every age zero. The cost is one retry by the payer.
        if (updatedAt == block.timestamp) revert OracleTimestampNotBeforeBlock(MARKET_ID, updatedAt);
        uint256 age = block.timestamp - updatedAt;
        if (age > policy.maxAge) revert OracleStale(MARKET_ID, age, policy.maxAge);
        if (decimals > 18) revert OracleDecimalsUnsupported(MARKET_ID, decimals);
        if (price > type(uint128).max) revert OraclePriceOutOfRange(MARKET_ID, price);
        uint256 unitValue = (price * (10 ** uint256(PAYOUT_DECIMALS))) / (10 ** (uint256(ASSET_DECIMALS) + decimals));
        if (unitValue > type(uint128).max) revert OraclePriceOutOfRange(MARKET_ID, price);

        _checkBand(receipt, price, decimals, policy.maxDeviationBps);

        receipt.price = price;
        receipt.decimals = decimals;
        // `updatedAt <= block.timestamp` was already proved above, so this narrowing cannot lose a
        // bit; the bound is asserted rather than assumed because a `uint64` field silently wrapping a
        // `uint256` reading is exactly the kind of thing that only shows up in the year 2554.
        if (updatedAt > type(uint64).max) revert OracleTimestampInFuture(MARKET_ID, updatedAt);
        receipt.updatedAt = uint64(updatedAt);
    }

    /// @dev SO §4.2, verbatim. The pool fee is divided out so the band measures pricing plus impact
    ///      against the reference rather than the fee, and every rounding goes AGAINST acceptance: the
    ///      floor of the reference widens the ceiling, its ceiling narrows the floor. Both bounds are
    ///      inclusive; one raw unit beyond either is a refusal.
    function _checkBand(ReceiptData memory receipt, uint256 price, uint8 oracleDecimals, uint16 maxDeviationBps)
        private
        view
    {
        uint256 produced = receipt.amountOut;
        uint256 netInput = uint256(receipt.amountIn) * (1e6 - uint256(receipt.swapFee));
        uint256 scaledPrice = price * (10 ** uint256(PAYOUT_DECIMALS));
        uint256 denominator = 10 ** (6 + uint256(ASSET_DECIMALS) + uint256(oracleDecimals));

        uint256 refOutFloor = FullMath.mulDiv(netInput, scaledPrice, denominator);
        uint256 refOutCeil = FullMath.mulDivRoundingUp(netInput, scaledPrice, denominator);

        uint256 minAllowed = FullMath.mulDivRoundingUp(refOutCeil, 10_000 - uint256(maxDeviationBps), 10_000);
        uint256 maxAllowed = FullMath.mulDiv(refOutFloor, 10_000 + uint256(maxDeviationBps), 10_000);

        if (produced < minAllowed) revert ExecutionBelowOracleBand(MARKET_ID, produced, minAllowed);
        if (produced > maxAllowed) revert ExecutionAboveOracleBand(MARKET_ID, produced, maxAllowed);
    }

    /// @dev The mark, the count and the sixteen fields, last, after every check has passed.
    function _emitReceipt(ReceiptData memory receipt) private {
        _markSwapped(receipt.orderId);
        unchecked {
            ++receiptCount;
        }

        // Thirteen non-indexed fields and three topics is two values more than the legacy code
        // generator can reach on the stack, so the record is encoded first and written with `log4`.
        // The layout is the compiler's own `abi.encode` of the event's argument list in order, and
        // the topic is the hash of the signature `IUnicaMarketHook` declares, so a decoder built from
        // the ABI reads this exactly as it would a compiler-emitted event. The two are pinned to each
        // other by test: `SETTLEMENT_RECEIPT_TOPIC` is asserted equal to
        // `IUnicaMarketHook.SettlementReceipt.selector`, which is the only thing that could drift.
        _log4(_receiptBody(receipt), receipt.orderId, receipt.recipient, receipt.payer);
    }

    /// @dev The thirteen non-indexed fields, in the event's own order. Encoded in two halves and
    ///      concatenated: every field is a static type, so `abi.encode` of each half is just its
    ///      32-byte words and the join is byte-identical to encoding all thirteen at once — which the
    ///      legacy code generator cannot do in one expression.
    function _receiptBody(ReceiptData memory receipt) private view returns (bytes memory) {
        return abi.encodePacked(
            abi.encode(MARKET_ID, ASSET_TOKEN, PAYOUT_TOKEN, receipt.amountIn, receipt.amountOut, HOOK_FEE_PIPS),
            abi.encode(
                receipt.lpFee,
                receipt.protocolFee,
                receipt.swapFee,
                receipt.price,
                receipt.decimals,
                receipt.updatedAt,
                receipt.demonstrationOnly
            )
        );
    }

    function _log4(bytes memory body, bytes32 orderId, address recipient, address payer) private {
        bytes32 topic0 = SETTLEMENT_RECEIPT_TOPIC;
        bytes32 topic2 = bytes32(uint256(uint160(recipient)));
        bytes32 topic3 = bytes32(uint256(uint160(payer)));
        assembly ("memory-safe") {
            log4(add(body, 0x20), mload(body), topic0, orderId, topic2, topic3)
        }
    }

    /// @notice `topic0` of `SettlementReceipt`, pinned as a constant because the event is written with
    ///         `log4` rather than by the compiler (see `_emitReceipt`). A test asserts it equals
    ///         `IUnicaMarketHook.SettlementReceipt.selector`, so the declaration stays the authority.
    bytes32 public constant SETTLEMENT_RECEIPT_TOPIC = keccak256(
        "SettlementReceipt(bytes32,address,address,bytes32,address,address,uint128,uint128,uint24,uint24,uint24,uint24,uint256,uint8,uint64,bool)"
    );

    // ---- views --------------------------------------------------------------------------------------

    /// @inheritdoc IUnicaMarketHook
    /// @dev The rates for THIS market's direction. `protocolFee` is the twelve-bit half that Uniswap
    ///      v4's `Pool.sol` applies to a swap going this way — the low half when the asset is
    ///      currency0, the high half otherwise — and `swapFee` is the expression the PoolManager
    ///      itself emits as `Swap.fee`, so a receipt and the swap it describes can be compared field
    ///      to field instead of by eye.
    function feeRates() public view returns (uint24 lpFee, uint24 protocolFee, uint24 swapFee) {
        (,, uint24 storedProtocolFee, uint24 storedLpFee) = poolManager.getSlot0(PoolId.wrap(POOL_ID));
        uint16 half = ASSET_IS_CURRENCY0
            ? ProtocolFeeLibrary.getZeroForOneFee(storedProtocolFee)
            : ProtocolFeeLibrary.getOneForZeroFee(storedProtocolFee);
        lpFee = storedLpFee;
        protocolFee = uint24(half);
        swapFee = half == 0 ? storedLpFee : ProtocolFeeLibrary.calculateSwapFee(half, storedLpFee);
    }

    /// @dev One `slot0` read, recorded into the receipt so the band and the receipt cannot disagree
    ///      about which fee was applied.
    function _readFees(ReceiptData memory receipt) private view {
        (receipt.lpFee, receipt.protocolFee, receipt.swapFee) = feeRates();
    }

    /// @notice Whether the reference is usable right now, and why not when it is not (SO §6).
    /// @dev The ONLY place that catches an adapter revert; the settlement path never does. It runs
    ///      SO §4.1 steps 1 to 7 and cannot run step 8, which needs a swap — so `OK` means the
    ///      reference is readable, not that a settlement will pass. The registry status is read first,
    ///      because a paused or retired market is not open whatever the oracle says.
    function oracleCondition()
        external
        view
        returns (OracleCondition condition, bytes4 reason, uint256 price, uint8 decimals, uint256 updatedAt)
    {
        // Any status but ACTIVE is a market that cannot settle: PAUSED and RETIRED as SO §6 names,
        // and the pre-activation states too, so a dashboard never shows OK for a market whose every
        // payment would revert MarketNotActive (security review, finding 13).
        uint8 status = IUnicaMarketRegistry(REGISTRY).statusOf(MARKET_ID);
        if (status != uint8(UnicaMarketTypes.MarketStatus.ACTIVE)) {
            return (OracleCondition.MARKET_CLOSED, bytes4(0), 0, 0, 0);
        }

        UnicaMarketTypes.OraclePolicy memory policy = IUnicaMarketRegistry(REGISTRY).oraclePolicyOf(MARKET_ID);
        if (!policy.enabled) return (OracleCondition.DEMONSTRATION_ONLY, bytes4(0), 0, 0, 0);

        try IUnicaOracleRoute(policy.adapter).feedIdFor(ASSET_TOKEN, PAYOUT_TOKEN) returns (bytes32 routeId) {
            if (routeId != policy.feedId) {
                return (OracleCondition.STALE_ORACLE, OracleFeedMismatch.selector, 0, 0, 0);
            }
        } catch (bytes memory err) {
            return (_conditionFor(err), _selectorOf(err), 0, 0, 0);
        }

        try IUnicaPriceOracle(policy.adapter).latestPrice(ASSET_TOKEN, PAYOUT_TOKEN) returns (
            uint256 p, uint8 d, uint256 t
        ) {
            price = p;
            decimals = d;
            updatedAt = t;
        } catch (bytes memory err) {
            return (_conditionFor(err), _selectorOf(err), 0, 0, 0);
        }

        if (price == 0) return (OracleCondition.STALE_ORACLE, OraclePriceZero.selector, price, decimals, updatedAt);
        if (decimals > 18) {
            return (OracleCondition.STALE_ORACLE, OracleDecimalsUnsupported.selector, price, decimals, updatedAt);
        }
        if (updatedAt > block.timestamp) {
            return (OracleCondition.STALE_ORACLE, OracleTimestampInFuture.selector, price, decimals, updatedAt);
        }
        if (updatedAt == block.timestamp) {
            return (OracleCondition.STALE_ORACLE, OracleTimestampNotBeforeBlock.selector, price, decimals, updatedAt);
        }
        if (block.timestamp - updatedAt > policy.maxAge) {
            return (OracleCondition.STALE_ORACLE, OracleStale.selector, price, decimals, updatedAt);
        }
        return (OracleCondition.OK, bytes4(0), price, decimals, updatedAt);
    }

    /// @dev An issuer hold, a dead sequencer and an unreadable feed are all STALE_ORACLE: none of them
    ///      is proof that the market itself is closed. Only the adapter that can actually observe a
    ///      closed market says so, and it says so by name.
    function _conditionFor(bytes memory err) private pure returns (OracleCondition) {
        return _selectorOf(err) == MARKET_CLOSED_SELECTOR ? OracleCondition.MARKET_CLOSED : OracleCondition.STALE_ORACLE;
    }

    /// @dev `MarketClosed()` on an oracle adapter (SO §5). Written as the hash of the signature rather
    ///      than imported, so this hook does not depend on any particular adapter's source.
    bytes4 private constant MARKET_CLOSED_SELECTOR = bytes4(keccak256("MarketClosed()"));

    function _selectorOf(bytes memory err) private pure returns (bytes4 selector) {
        if (err.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := mload(add(err, 0x20))
        }
    }

    // ---- the one-swap-per-order mark ------------------------------------------------------------------

    /// @dev Transient storage (EIP-1153): the mark costs no persistent state and cannot outlive the
    ///      transaction. It closes the one gap the order's own status does not — two swaps for one
    ///      in-flight order inside a single unlock, which would otherwise receipt twice. The namespace
    ///      names this generation, so a hook of another generation sharing a transaction cannot read
    ///      or clear this mark.
    function _swapped(bytes32 orderId) private view returns (bool marked) {
        bytes32 slot = keccak256(abi.encode(orderId, "UnicaMarketHook.swapped"));
        assembly ("memory-safe") {
            marked := tload(slot)
        }
    }

    function _markSwapped(bytes32 orderId) private {
        bytes32 slot = keccak256(abi.encode(orderId, "UnicaMarketHook.swapped"));
        assembly ("memory-safe") {
            tstore(slot, 1)
        }
    }
}
