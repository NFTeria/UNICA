// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {UnicaMarketTypes} from "./UnicaMarketTypes.sol";
import {IUnicaMarketExecutor} from "./interfaces/IUnicaMarketExecutor.sol";
import {IUnicaMarketRegistry} from "./interfaces/IUnicaMarketRegistry.sol";

/// @dev The four calls this contract makes on a token, declared here rather than imported so the
///      return value is handled explicitly at every site: a token that returns nothing, or `false`,
///      is refused by name instead of being read as success.
interface IUnicaERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev The one thing the executor asks its hook: how many settlements it has receipted. Reading it
///      on both sides of the unlock is what turns "the swap did not revert" into "the hook ran".
interface IUnicaReceiptCounter {
    function receiptCount() external view returns (uint256);
}

/// @title UnicaMarketExecutor, the only address its market's hook lets swap
/// @notice Written from `docs/unica-v4/SPEC-CONTRACTS.md` §9. One instance per market, created by
///         that market's hook, so `HOOK = msg.sender` and the pair is bound at birth. It takes the
///         PoolManager lock itself rather than going through a router, so the `sender` the hook sees
///         is established by the PoolManager instead of being reported by a third party.
///
///         WHAT A PAYMENT IS HERE. Exactly `amountIn` is pulled from the address the order names,
///         swapped exact-input into the market's pool, and taken straight to the recipient the order
///         froze at creation. Every step is then measured against what was intended — the fill, the
///         delivery, the executor's own two balances, the hook's receipt count and the caps — and any
///         disagreement reverts the whole transaction. There is no partial success: the payer keeps
///         the input or the merchant is paid, never neither and never both.
///
/// @dev No `receive()`, no sweep, no admin, no setter. The contract holds no balance between calls
///      and has no path that moves a token except `transferFrom(order.payer, …)` inside `pay` and the
///      settle transfer to the PoolManager inside its own unlock. Donations are possible and
///      unrecoverable; the residual checks are snapshot-relative so a donation never blocks a
///      payment. Every external read on the hot path is a `view`, hence a STATICCALL.
contract UnicaMarketExecutor is IUnicaMarketExecutor, IUnlockCallback {
    /// @dev What a payment is measured against: the order's own terms, the caps read live at the top
    ///      of `pay`, and the four readings taken before the first external call.
    struct Snapshot {
        address recipient;
        uint128 amountIn;
        uint128 minOut;
        uint128 maxPerTxPayout;
        uint128 maxPerDayPayout;
        uint256 assetBefore;
        uint256 payoutBefore;
        uint256 recipientBefore;
        uint256 receiptsBefore;
    }

    // ---- immutables ------------------------------------------------------------------------------

    IPoolManager public immutable POOL_MANAGER;
    /// @inheritdoc IUnicaMarketExecutor
    address public immutable HOOK;
    /// @inheritdoc IUnicaMarketExecutor
    address public immutable REGISTRY;
    /// @inheritdoc IUnicaMarketExecutor
    bytes32 public immutable MARKET_ID;
    /// @inheritdoc IUnicaMarketExecutor
    address public immutable ASSET_TOKEN;
    /// @inheritdoc IUnicaMarketExecutor
    address public immutable PAYOUT_TOKEN;
    uint24 public immutable FEE;
    int24 public immutable TICK_SPACING;
    /// @notice Derived from the addresses, never configured: the pool's currency order is the token
    ///         order, so a market cannot be told it trades in a direction it does not.
    bool public immutable ASSET_IS_CURRENCY0;

    // ---- storage ---------------------------------------------------------------------------------

    mapping(bytes32 => UnicaMarketTypes.Order) private _orders;
    /// @inheritdoc IUnicaMarketExecutor
    uint256 public orderCount;
    mapping(uint256 => uint256) private _payoutUsedOnDay;

    /// @dev The reentrancy latch, in transient storage: it costs nothing to clear and cannot survive
    ///      the transaction that set it. Namespaced so it cannot collide with anything else.
    bytes32 private constant LOCK_SLOT = keccak256("UnicaMarketExecutor.lock");

    /// @dev Seconds in a UTC day. The cap window is `block.timestamp / 86400`, so days turn at
    ///      00:00 UTC and a new day starts at zero without anyone writing to storage.
    uint256 private constant SECONDS_PER_DAY = 86400;

    /// @dev The largest exact input a v4 swap can carry: `amountSpecified` is an `int256` but every
    ///      balance delta component is an `int128`, so anything above this cannot be represented on
    ///      the way back out.
    uint128 private constant MAX_AMOUNT = uint128(uint128(type(int128).max));

    // ---- errors (SC §9.3) -------------------------------------------------------------------------

    error MarketNotActive(bytes32 marketId, uint8 status);
    error NotOrderCreator(address caller);
    error ZeroRecipient();
    error ReservedRecipient(address recipient);
    error ZeroPayer();
    error ZeroAmount();
    error ZeroMinOut();
    error AmountTooLarge(uint256 amount);
    error OrderAboveCap(uint128 minOut, uint128 cap);
    error DeadlineInPast(uint64 deadline);
    error OrderExists(bytes32 orderId);
    error UnknownOrder(bytes32 orderId);
    error OrderNotOpen(bytes32 orderId, uint8 status);
    error OrderExpired(bytes32 orderId, uint64 deadline);
    error WrongPayer(bytes32 orderId, address payer, address caller);
    error AllowanceTooLow(address payer, uint256 allowance, uint256 needed);
    error InputNotExact(uint128 expected, uint256 received);
    error TransferFailed(address token);
    error SettlementDidNotClose(uint256 expected, uint256 paid);
    error NoReceipt(bytes32 orderId);
    error RecipientShort(bytes32 orderId, uint128 minOut, uint256 delivered);
    error DeliveryNotExact(bytes32 orderId, uint256 out, uint256 delta);
    error ExecutorResidualInput(uint256 before_, uint256 after_);
    error ExecutorResidualPayout(uint256 before_, uint256 after_);
    error PaymentAboveCap(uint256 out, uint128 cap);
    error DailyCapExceeded(uint256 day, uint256 used, uint128 cap);
    error Reentered();
    error NotPoolManager(address caller);
    error OrderNotInFlight(bytes32 orderId, uint8 status);

    /// @dev Run only by the hook's constructor, which is itself run only by the factory's CREATE2, so
    ///      `HOOK` is the hook that will admit this executor and nothing else can claim the slot.
    ///      224 bytes of arguments, which verification has to supply.
    constructor(
        IPoolManager poolManager_,
        address registry_,
        bytes32 marketId_,
        address asset_,
        address payout_,
        uint24 fee_,
        int24 tickSpacing_
    ) {
        POOL_MANAGER = poolManager_;
        HOOK = msg.sender;
        REGISTRY = registry_;
        MARKET_ID = marketId_;
        ASSET_TOKEN = asset_;
        PAYOUT_TOKEN = payout_;
        FEE = fee_;
        TICK_SPACING = tickSpacing_;
        ASSET_IS_CURRENCY0 = asset_ < payout_;
    }

    // ---- creation ---------------------------------------------------------------------------------

    /// @inheritdoc IUnicaMarketExecutor
    /// @dev The checks are in SC §9.1's order, and the order is part of the contract: a caller that
    ///      is not an allowlisted creator learns that before it learns anything about its arguments.
    function createOrder(
        address recipient,
        address payer,
        uint128 amountIn,
        uint128 minOut,
        uint64 deadline,
        bytes32 salt
    ) external returns (bytes32 orderId) {
        (uint8 status, uint128 maxPerTxPayout,) = IUnicaMarketRegistry(REGISTRY).executionTermsOf(MARKET_ID);
        if (status != uint8(UnicaMarketTypes.MarketStatus.ACTIVE)) revert MarketNotActive(MARKET_ID, status);
        if (!IUnicaMarketRegistry(REGISTRY).canCreateOrders(msg.sender)) revert NotOrderCreator(msg.sender);

        if (recipient == address(0)) revert ZeroRecipient();
        if (_isReserved(recipient)) revert ReservedRecipient(recipient);
        if (payer == address(0)) revert ZeroPayer();
        if (amountIn == 0) revert ZeroAmount();
        if (minOut == 0) revert ZeroMinOut();
        if (amountIn > MAX_AMOUNT) revert AmountTooLarge(amountIn);
        if (minOut > MAX_AMOUNT) revert AmountTooLarge(minOut);
        if (minOut > maxPerTxPayout) revert OrderAboveCap(minOut, maxPerTxPayout);
        if (deadline <= block.timestamp) revert DeadlineInPast(deadline);

        orderId = keccak256(abi.encode(block.chainid, address(this), msg.sender, salt));
        if (_orders[orderId].status != UnicaMarketTypes.OrderStatus.None) revert OrderExists(orderId);

        _orders[orderId] = UnicaMarketTypes.Order({
            recipient: recipient,
            creator: msg.sender,
            payer: payer,
            amountIn: amountIn,
            minOut: minOut,
            deadline: deadline,
            status: UnicaMarketTypes.OrderStatus.Open
        });
        unchecked {
            ++orderCount;
        }
        emit OrderCreated(orderId, recipient, msg.sender, payer, amountIn, minOut, deadline);
    }

    /// @dev The addresses a settlement may never name as the merchant. Sending the payout to any of
    ///      them either destroys it or feeds it back into the machinery that is supposed to be
    ///      measuring the delivery; the factory is here because it is the one address that could
    ///      otherwise receive a payment and look official while doing it (A16).
    function _isReserved(address recipient) private view returns (bool) {
        return recipient == address(this) || recipient == HOOK || recipient == address(POOL_MANAGER)
            || recipient == ASSET_TOKEN || recipient == PAYOUT_TOKEN || recipient == REGISTRY
            || recipient == IUnicaMarketRegistry(REGISTRY).FACTORY();
    }

    // ---- payment ----------------------------------------------------------------------------------

    /// @inheritdoc IUnicaMarketExecutor
    /// @dev SC §9.1 steps 1 to 7, in that order. Everything measured after the unlock is measured
    ///      against a snapshot taken before the first external call, so a hostile token cannot make
    ///      a short delivery look like a full one by moving a balance underneath the check.
    function pay(bytes32 orderId) external {
        _lock();

        Snapshot memory snap = _admit(orderId);

        // Step 3. Exactly `amountIn` arrives, or this is not the payment the order describes: a
        // fee-on-transfer or rebasing input token is refused here rather than short-changing the pool.
        _pullExact(msg.sender, snap.amountIn, snap.assetBefore);

        // Step 4. The lock is this contract's own, so the `sender` the hook sees is established by
        // the PoolManager rather than reported by a router.
        uint256 out = abi.decode(POOL_MANAGER.unlock(abi.encode(orderId)), (uint256));

        // Steps 5 and 6.
        uint256 delivered = _verifyAndAccount(orderId, snap, out);

        // Step 7. The success signal, last.
        _orders[orderId].status = UnicaMarketTypes.OrderStatus.Settled;
        emit Settled(orderId, msg.sender, snap.recipient, ASSET_TOKEN, PAYOUT_TOKEN, snap.amountIn, delivered);

        _unlock();
    }

    /// @dev Step 1 and step 2: every precondition, then Paying and the four readings everything after
    ///      the unlock is measured against. Split out of `pay` because one frame does not hold it —
    ///      the legacy code generator runs out of stack, and via-IR is not an option in a tree whose
    ///      hook address is mined against its creation code.
    function _admit(bytes32 orderId) private returns (Snapshot memory snap) {
        (uint8 status, uint128 maxPerTxPayout, uint128 maxPerDayPayout) =
            IUnicaMarketRegistry(REGISTRY).executionTermsOf(MARKET_ID);
        if (status != uint8(UnicaMarketTypes.MarketStatus.ACTIVE)) revert MarketNotActive(MARKET_ID, status);

        UnicaMarketTypes.Order storage order = _orders[orderId];
        UnicaMarketTypes.OrderStatus stored = order.status;
        if (stored == UnicaMarketTypes.OrderStatus.None) revert UnknownOrder(orderId);
        if (stored != UnicaMarketTypes.OrderStatus.Open) revert OrderNotOpen(orderId, uint8(stored));
        if (order.deadline < block.timestamp) revert OrderExpired(orderId, order.deadline);
        if (msg.sender != order.payer) revert WrongPayer(orderId, order.payer, msg.sender);

        snap.amountIn = order.amountIn;
        uint256 allowed = IUnicaERC20(ASSET_TOKEN).allowance(msg.sender, address(this));
        if (allowed < snap.amountIn) revert AllowanceTooLow(msg.sender, allowed, snap.amountIn);

        // Step 2. Paying before any external call, so a re-entrant caller finds an in-flight order
        // rather than an open one, and so the hook can tell an admitted swap from a forged one.
        order.status = UnicaMarketTypes.OrderStatus.Paying;

        snap.recipient = order.recipient;
        snap.minOut = order.minOut;
        snap.maxPerTxPayout = maxPerTxPayout;
        snap.maxPerDayPayout = maxPerDayPayout;
        snap.assetBefore = IUnicaERC20(ASSET_TOKEN).balanceOf(address(this));
        snap.payoutBefore = IUnicaERC20(PAYOUT_TOKEN).balanceOf(address(this));
        snap.recipientBefore = IUnicaERC20(PAYOUT_TOKEN).balanceOf(snap.recipient);
        snap.receiptsBefore = IUnicaReceiptCounter(HOOK).receiptCount();
    }

    /// @dev Steps 5 and 6. Every comparison is against the snapshot, never against an absolute
    ///      balance, so a donation made before the payment neither blocks it nor hides a residual.
    function _verifyAndAccount(bytes32 orderId, Snapshot memory snap, uint256 out) private returns (uint256 delivered) {
        if (IUnicaReceiptCounter(HOOK).receiptCount() != snap.receiptsBefore + 1) revert NoReceipt(orderId);

        // A payout token that DEBITS the recipient while the manager is unlocked would underflow
        // here; that is refused by name, not by a bare panic, so the diagnosis survives.
        uint256 recipientAfter = IUnicaERC20(PAYOUT_TOKEN).balanceOf(snap.recipient);
        if (recipientAfter < snap.recipientBefore) revert DeliveryNotExact(orderId, out, 0);
        delivered = recipientAfter - snap.recipientBefore;
        if (delivered < snap.minOut) revert RecipientShort(orderId, snap.minOut, delivered);
        if (delivered != out) revert DeliveryNotExact(orderId, out, delivered);

        uint256 assetAfter = IUnicaERC20(ASSET_TOKEN).balanceOf(address(this));
        if (assetAfter != snap.assetBefore) revert ExecutorResidualInput(snap.assetBefore, assetAfter);
        uint256 payoutAfter = IUnicaERC20(PAYOUT_TOKEN).balanceOf(address(this));
        if (payoutAfter != snap.payoutBefore) revert ExecutorResidualPayout(snap.payoutBefore, payoutAfter);

        // Step 6. On the measured delivery, never on `minOut` and never on the input.
        if (out > snap.maxPerTxPayout) revert PaymentAboveCap(out, snap.maxPerTxPayout);
        uint256 day = block.timestamp / SECONDS_PER_DAY;
        uint256 usedAfter = _payoutUsedOnDay[day] + out;
        if (usedAfter > snap.maxPerDayPayout) revert DailyCapExceeded(day, usedAfter, snap.maxPerDayPayout);
        _payoutUsedOnDay[day] = usedAfter;
    }

    /// @notice The PoolManager's callback for the lock this contract took in `pay`.
    /// @dev The only caller is the PoolManager, and the only order it will act on is one already in
    ///      flight, so a forged callback finds neither. The hook's own checks run inside `swap`.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(POOL_MANAGER)) revert NotPoolManager(msg.sender);
        bytes32 orderId = abi.decode(data, (bytes32));
        UnicaMarketTypes.Order storage order = _orders[orderId];
        if (order.status != UnicaMarketTypes.OrderStatus.Paying) {
            revert OrderNotInFlight(orderId, uint8(order.status));
        }

        uint128 amountIn = order.amountIn;
        bool zeroForOne = ASSET_IS_CURRENCY0;
        BalanceDelta delta = POOL_MANAGER.swap(
            poolKey(),
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(uint256(amountIn)),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            abi.encode(orderId)
        );

        // The input leg: hand the pool exactly what it is owed and prove the credit closed it.
        Currency assetCurrency = Currency.wrap(ASSET_TOKEN);
        POOL_MANAGER.sync(assetCurrency);
        _sendToken(ASSET_TOKEN, address(POOL_MANAGER), amountIn);
        uint256 paid = POOL_MANAGER.settle();
        if (paid != amountIn) revert SettlementDidNotClose(amountIn, paid);

        // The output leg: straight to the merchant the order froze, never through this contract.
        int128 produced = zeroForOne ? delta.amount1() : delta.amount0();
        uint256 out = produced > 0 ? uint256(uint128(produced)) : 0;
        POOL_MANAGER.take(Currency.wrap(PAYOUT_TOKEN), order.recipient, out);

        return abi.encode(out);
    }

    // ---- views ------------------------------------------------------------------------------------

    /// @inheritdoc IUnicaMarketExecutor
    function orders(bytes32 orderId) external view returns (UnicaMarketTypes.Order memory) {
        return _orders[orderId];
    }

    /// @inheritdoc IUnicaMarketExecutor
    /// @dev Rebuilt from immutables every time rather than stored, so the key this contract swaps on
    ///      and the key the hook admits are the same expression over the same values (A4).
    function poolKey() public view returns (PoolKey memory) {
        (address currency0, address currency1) =
            ASSET_IS_CURRENCY0 ? (ASSET_TOKEN, PAYOUT_TOKEN) : (PAYOUT_TOKEN, ASSET_TOKEN);
        return PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(HOOK)
        });
    }

    /// @inheritdoc IUnicaMarketExecutor
    function payoutUsedOnDay(uint256 utcDay) external view returns (uint256) {
        return _payoutUsedOnDay[utcDay];
    }

    /// @inheritdoc IUnicaMarketExecutor
    function remainingToday() external view returns (uint256 perDayLeft, uint128 perTx) {
        (, uint128 maxPerTxPayout, uint128 maxPerDayPayout) = IUnicaMarketRegistry(REGISTRY).executionTermsOf(MARKET_ID);
        uint256 used = _payoutUsedOnDay[block.timestamp / SECONDS_PER_DAY];
        perDayLeft = used >= maxPerDayPayout ? 0 : maxPerDayPayout - used;
        perTx = maxPerTxPayout;
    }

    // ---- internals --------------------------------------------------------------------------------

    function _lock() private {
        bytes32 slot = LOCK_SLOT;
        uint256 held;
        assembly ("memory-safe") {
            held := tload(slot)
        }
        if (held != 0) revert Reentered();
        assembly ("memory-safe") {
            tstore(slot, 1)
        }
    }

    function _unlock() private {
        bytes32 slot = LOCK_SLOT;
        assembly ("memory-safe") {
            tstore(slot, 0)
        }
    }

    /// @dev Pulls the input and measures it. `InputNotExact` is deliberately a different refusal from
    ///      `TransferFailed`: the first is a token that moved the wrong amount and said it worked, the
    ///      second is a token that said it did not work, and the two need different diagnoses.
    function _pullExact(address from, uint128 amountIn, uint256 balanceBefore) private {
        (bool ok, bytes memory ret) =
            ASSET_TOKEN.call(abi.encodeCall(IUnicaERC20.transferFrom, (from, address(this), amountIn)));
        if (!ok || ret.length != 32 || !abi.decode(ret, (bool))) revert TransferFailed(ASSET_TOKEN);
        uint256 received = IUnicaERC20(ASSET_TOKEN).balanceOf(address(this)) - balanceBefore;
        if (received != amountIn) revert InputNotExact(amountIn, received);
    }

    function _sendToken(address token, address to, uint256 amount) private {
        (bool ok, bytes memory ret) = token.call(abi.encodeCall(IUnicaERC20.transfer, (to, amount)));
        if (!ok || ret.length != 32 || !abi.decode(ret, (bool))) revert TransferFailed(token);
    }
}
