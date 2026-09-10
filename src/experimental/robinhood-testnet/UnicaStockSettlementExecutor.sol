// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {UnicaStockSettlementTypes as T} from "./UnicaStockSettlementTypes.sol";
import {UnicaStockSettlementErrors as E} from "./UnicaStockSettlementErrors.sol";
import {UnicaStockSettlementEvents as Ev} from "./UnicaStockSettlementEvents.sol";

interface IReceiptCounter {
    function receiptCount() external view returns (uint256);
}

interface IERC20Minimal {
    function balanceOf(address) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title UnicaStockSettlementExecutor — the experimental ERC-20-input settlement path
/// @notice EXPERIMENTAL. Deployed nowhere. The live V3 generation is untouched and unaffected.
///
///         NO ROUTER, NO PERMIT2, AND WHY. V3 reaches the pool through Uniswap's Universal Router,
///         which for an ERC-20 input would need a Permit2 leg. Two facts made that the wrong choice
///         here. The router build on the chain this generation targets decodes a DIFFERENT parameter
///         head than the one V3 encodes, and refuses the other with an empty revert that names
///         nothing. And Permit2 on that chain is byte-verified but has never had a signature
///         transfer run against it. Rather than trust two unverified things, this executor takes the
///         PoolManager's lock itself and performs sync / transfer / settle / take directly.
///
///         What that buys: the hook's `sender` is this executor, established by the PoolManager
///         rather than reported by a router; the parameter-layout hazard disappears; and the payout
///         goes from the PoolManager to the merchant in one `take`, with nothing in between.
///
///         What it costs: the payer must grant this executor an ERC-20 allowance before paying,
///         which is a second transaction where a Permit2 signature would have been one. The
///         allowance is bounded — `pay` reads it, requires at least the order's exact input, and
///         moves exactly that. A payer who approves more keeps the excess as a standing allowance,
///         which is the honest downside and is stated rather than hidden.
contract UnicaStockSettlementExecutor is IUnlockCallback {
    using PoolIdLibrary for PoolKey;

    IPoolManager public immutable POOL_MANAGER;
    address public immutable HOOK;
    address public immutable INPUT_CURRENCY;
    address public immutable PAYOUT_CURRENCY;

    mapping(bytes32 orderId => T.Order) internal _orders;
    uint256 public orderCount;

    /// @dev The four measurements taken before any value moves, carried as one struct so the
    ///      postcondition frame can be a separate function. Splitting it is not cosmetic: the
    ///      compiler ran out of stack with these as locals, and reaching for via_ir to hide that
    ///      would have hidden the real point — these are four independent measurements, and they
    ///      belong together.
    struct Snapshot {
        uint256 execInput;
        uint256 execPayout;
        uint256 recipient;
        uint256 receipts;
    }

    /// @dev Transient reentrancy latch. A payout token that calls back during `take` must not be
    ///      able to start a second settlement inside the first.
    bytes32 private constant LOCK_SLOT = keccak256("unica.experimental.stock.lock");

    constructor(IPoolManager poolManager_, address hook_, address inputCurrency_, address payoutCurrency_) {
        POOL_MANAGER = poolManager_;
        HOOK = hook_;
        INPUT_CURRENCY = inputCurrency_;
        PAYOUT_CURRENCY = payoutCurrency_;
    }

    function orders(bytes32 orderId) external view returns (T.Order memory) {
        return _orders[orderId];
    }

    // ── registration ──────────────────────────────────────────────────────────────────────────

    /// @notice Fixes everything a settlement may depend on, before any value moves.
    /// @param boundPayer Zero to let any address pay; an address to bind the order to that payer.
    function createOrder(
        address recipient,
        PoolKey calldata key,
        uint128 amountIn,
        uint128 minOut,
        uint64 deadline,
        address boundPayer,
        bytes32 salt
    ) external returns (bytes32 orderId) {
        if (recipient == address(0)) revert E.ZeroRecipient();
        // Addresses whose balances either cannot move out again or are sweepable by whoever calls
        // next. Refused where the order is CREATED, not where it is paid.
        if (
            recipient == address(this) || recipient == HOOK || recipient == address(POOL_MANAGER)
                || recipient == INPUT_CURRENCY || recipient == PAYOUT_CURRENCY
        ) revert E.ReservedRecipient(recipient);
        if (address(key.hooks) != HOOK) revert E.PoolNotGuarded(address(key.hooks));

        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        bool shaped = (c0 == INPUT_CURRENCY && c1 == PAYOUT_CURRENCY) || (c0 == PAYOUT_CURRENCY && c1 == INPUT_CURRENCY);
        if (!shaped) revert E.NotTheSettlementShape(c0, c1);

        if (amountIn == 0) revert E.ZeroAmount();
        if (minOut == 0) revert E.ZeroMinOut();
        if (deadline <= block.timestamp) revert E.DeadlineInPast(deadline);

        orderId = keccak256(abi.encode(block.chainid, address(this), msg.sender, salt));
        if (_orders[orderId].status != T.Status.None) revert E.OrderExists(orderId);

        _orders[orderId] = T.Order({
            recipient: recipient,
            creator: msg.sender,
            boundPayer: boundPayer,
            payer: address(0),
            key: key,
            amountIn: amountIn,
            minOut: minOut,
            deadline: deadline,
            status: T.Status.Open
        });
        unchecked {
            orderCount++;
        }
        emit Ev.OrderCreated(orderId, recipient, msg.sender, boundPayer, amountIn, minOut, deadline);
    }

    // ── payment ───────────────────────────────────────────────────────────────────────────────

    /// @notice Pays one order. Everything that can be checked before value moves is checked before
    ///         value moves; everything that can only be measured afterwards is measured afterwards.
    function pay(bytes32 orderId) external {
        if (_locked()) revert E.Reentered();
        _lock();

        T.Order storage o = _orders[orderId];
        if (o.status == T.Status.None) revert E.UnknownOrder(orderId);
        if (o.status != T.Status.Open) revert E.OrderNotOpen(orderId, o.status);
        if (o.deadline < block.timestamp) revert E.OrderExpired(orderId, o.deadline);
        if (o.boundPayer != address(0) && o.boundPayer != msg.sender) {
            revert E.WrongPayer(orderId, o.boundPayer, msg.sender);
        }

        uint128 amountIn = o.amountIn;
        uint128 minOut = o.minOut;
        address recipient = o.recipient;

        uint256 allowed = IERC20Minimal(INPUT_CURRENCY).allowance(msg.sender, address(this));
        if (allowed < amountIn) revert E.AllowanceTooLow(INPUT_CURRENCY, amountIn, allowed);

        // Status moves BEFORE any external call. A second entry for this order finds Paying, not
        // Open, whatever the token tries during transfer.
        o.payer = msg.sender;
        o.status = T.Status.Paying;

        Snapshot memory snap = Snapshot({
            execInput: IERC20Minimal(INPUT_CURRENCY).balanceOf(address(this)),
            execPayout: IERC20Minimal(PAYOUT_CURRENCY).balanceOf(address(this)),
            recipient: IERC20Minimal(PAYOUT_CURRENCY).balanceOf(recipient),
            receipts: IReceiptCounter(HOOK).receiptCount()
        });

        // Pull exactly the order's input, then MEASURE what arrived. A fee-on-transfer or rebasing
        // input lands on InputNotExact rather than settling an amount the order does not name.
        _safeTransferFrom(INPUT_CURRENCY, msg.sender, address(this), amountIn);
        uint256 received = IERC20Minimal(INPUT_CURRENCY).balanceOf(address(this)) - snap.execInput;
        if (received != amountIn) revert E.InputNotExact(amountIn, received);

        POOL_MANAGER.unlock(abi.encode(orderId));

        uint256 delivered = _verifyDelivery(orderId, recipient, minOut, snap);

        o.status = T.Status.Settled;
        emit Ev.Settled(orderId, msg.sender, recipient, INPUT_CURRENCY, PAYOUT_CURRENCY, amountIn, delivered);
        _unlock();
    }

    /// @dev Everything the hook could NOT prove, measured after the lock has closed. The hook saw
    ///      the pool's delta, which is authoritative about the swap and silent about whether the
    ///      token then delivered. These four rows are the difference.
    function _verifyDelivery(bytes32 orderId, address recipient, uint128 minOut, Snapshot memory snap)
        private
        view
        returns (uint256 delivered)
    {
        if (IReceiptCounter(HOOK).receiptCount() != snap.receipts + 1) revert E.NoReceipt(orderId);

        delivered = IERC20Minimal(PAYOUT_CURRENCY).balanceOf(recipient) - snap.recipient;
        if (delivered < minOut) revert E.RecipientShort(orderId, minOut, delivered);

        uint256 execInputAfter = IERC20Minimal(INPUT_CURRENCY).balanceOf(address(this));
        if (execInputAfter != snap.execInput) revert E.ExecutorResidualInput(snap.execInput, execInputAfter);
        uint256 execPayoutAfter = IERC20Minimal(PAYOUT_CURRENCY).balanceOf(address(this));
        if (execPayoutAfter != snap.execPayout) revert E.ExecutorResidualPayout(snap.execPayout, execPayoutAfter);
    }

    /// @notice The PoolManager's callback. Unreachable from anywhere else.
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(POOL_MANAGER)) revert E.NotPoolManager(msg.sender);
        bytes32 orderId = abi.decode(data, (bytes32));
        T.Order memory o = _orders[orderId];
        // Only `pay` sets Paying, and only within its own reentrancy latch. Nothing else can arrive
        // here with an order in flight.
        if (o.status != T.Status.Paying) revert E.OrderNotInFlight(orderId, o.status);

        bool zeroForOne = Currency.unwrap(o.key.currency0) == INPUT_CURRENCY;
        Currency inputCurrency = zeroForOne ? o.key.currency0 : o.key.currency1;
        Currency payoutCurrency = zeroForOne ? o.key.currency1 : o.key.currency0;

        BalanceDelta delta = POOL_MANAGER.swap(
            o.key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(uint256(o.amountIn)),
                sqrtPriceLimitX96: _priceLimit(zeroForOne)
            }),
            abi.encode(orderId)
        );

        // Pay what we owe: sync, hand the tokens over, settle. Control is yielded to nothing between
        // the sync and the settle.
        POOL_MANAGER.sync(inputCurrency);
        _safeTransfer(Currency.unwrap(inputCurrency), address(POOL_MANAGER), o.amountIn);
        uint256 credited = POOL_MANAGER.settle();
        if (credited != o.amountIn) revert E.SettlementDidNotClose(o.amountIn, credited);

        // DIRECT DELIVERY. The output goes from the PoolManager to the merchant. It never touches
        // this contract, so there is no moment at which it could be stranded here or swept.
        uint256 out = uint256(uint128(zeroForOne ? delta.amount1() : delta.amount0()));
        POOL_MANAGER.take(payoutCurrency, o.recipient, out);
        return "";
    }

    /// @dev No price protection is applied at this layer, deliberately. The order's `minOut` is the
    ///      binding floor and it is checked twice — once against the pool's delta and once against
    ///      the merchant's own balance. A tighter limit here would turn a survivable price move into
    ///      a revert without improving the payer's outcome. One step inside the extreme, because the
    ///      extremes themselves are out of range.
    function _priceLimit(bool zeroForOne) private pure returns (uint160) {
        if (zeroForOne) {
            return TickMath.MIN_SQRT_PRICE + 1;
        }
        return TickMath.MAX_SQRT_PRICE - 1;
    }

    // ── token calls that tolerate the tokens that exist ───────────────────────────────────────
    // Written here rather than imported: a token may return nothing, return false, or revert, and
    // all three must be handled the same way — as a failure with a name.

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert E.TransferFailed(token);
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory ret) =
            token.call(abi.encodeWithSelector(IERC20Minimal.transferFrom.selector, from, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert E.TransferFailed(token);
    }

    function _locked() private view returns (bool v) {
        bytes32 s = LOCK_SLOT;
        assembly ("memory-safe") {
            v := tload(s)
        }
    }

    function _lock() private {
        bytes32 s = LOCK_SLOT;
        assembly ("memory-safe") {
            tstore(s, 1)
        }
    }

    function _unlock() private {
        bytes32 s = LOCK_SLOT;
        assembly ("memory-safe") {
            tstore(s, 0)
        }
    }
}
