// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {AddressConstants} from "hookmate/constants/AddressConstants.sol";

/// @title UnicaSettlementRouter, the only contract the hook admits as a swap sender
/// @notice A payer pays a registered order in native ETH; the recipient registered for that order
///         receives the pool's output currency, in the same transaction, or nothing moves at all.
///         This is the router half of the design in `specs/HOOK-SPEC.md` section 2: a passive hook
///         cannot promise where swap output lands, because `PoolManager.swap` credits the caller and
///         the caller chooses the recipient afterwards. So the recipient is chosen here, from storage
///         this contract wrote, and the hook refuses every other caller (invariant I1).
/// @dev Zero-argument constructor: the PoolManager is resolved from the chain id, so this creation
///      code, and with it the CREATE2 address the hook trusts, is the same on every chain hookmate
///      knows. The contract never holds a balance: native value arrives only through `pay` and leaves
///      through `settle` in the same call; there is no `receive`, so a stray transfer reverts.
contract UnicaSettlementRouter is IUnlockCallback {
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;

    /// @notice An order is the only source of who is paid, how much, into which pool, and until when.
    ///         Written once by `createOrder`; the swap's hook data carries only the id (spec C1).
    struct Order {
        address recipient;
        address creator;
        PoolKey key;
        uint128 amountIn;
        uint128 minOut;
        uint64 deadline;
        bool settled;
    }

    IPoolManager public immutable POOL_MANAGER;

    mapping(bytes32 orderId => Order) internal _orders;
    /// @notice Orders created so far; part of every order id, so ids never repeat.
    uint256 public orderCount;

    event OrderCreated(
        bytes32 indexed orderId,
        address indexed recipient,
        address indexed creator,
        PoolId poolId,
        uint128 amountIn,
        uint128 minOut,
        uint64 deadline
    );
    /// @notice The router's own record of a completed settlement. The hook's receipt (invariant I2)
    ///         is emitted from inside the swap; this one carries the payer the router saw.
    event Settled(
        bytes32 indexed orderId, address indexed payer, address indexed recipient, uint256 amountIn, uint256 amountOut
    );

    error NotPoolManager(address caller);
    error ZeroRecipient();
    error ZeroAmount();
    error DeadlineInPast(uint64 deadline);
    error NativeInputOnly();
    error UnknownOrder(bytes32 orderId);
    error OrderAlreadySettled(bytes32 orderId);
    error OrderExpired(bytes32 orderId, uint64 deadline);
    error WrongValue(uint256 expected, uint256 got);
    error PartialFill(uint256 expected, uint256 consumed);
    error OutputBelowMinimum(uint256 minOut, uint256 got);

    constructor() {
        POOL_MANAGER = IPoolManager(AddressConstants.getPoolManagerAddress(block.chainid));
    }

    /// @notice Registers what a payment must do. Anyone may create an order; only the order decides
    ///         where output goes. Native ETH is the only input currency today (the live pool's shape).
    /// @param recipient The only address the pool's output can reach for this order.
    /// @param key The pool the order settles through; `currency0` must be native ETH.
    /// @param amountIn The exact native amount the payer must send.
    /// @param minOut The least output the recipient accepts; less than this reverts the whole payment.
    /// @param deadline After this timestamp the order cannot be paid.
    function createOrder(address recipient, PoolKey calldata key, uint128 amountIn, uint128 minOut, uint64 deadline)
        external
        returns (bytes32 orderId)
    {
        if (recipient == address(0)) revert ZeroRecipient();
        if (amountIn == 0) revert ZeroAmount();
        if (deadline <= block.timestamp) revert DeadlineInPast(deadline);
        if (!key.currency0.isAddressZero()) revert NativeInputOnly();

        // Bound to this chain and this router, so an id can never be replayed elsewhere (threat T10).
        orderId = keccak256(abi.encode(block.chainid, address(this), ++orderCount));
        _orders[orderId] = Order({
            recipient: recipient,
            creator: msg.sender,
            key: key,
            amountIn: amountIn,
            minOut: minOut,
            deadline: deadline,
            settled: false
        });
        emit OrderCreated(orderId, recipient, msg.sender, key.toId(), amountIn, minOut, deadline);
    }

    /// @notice The order as stored. The hook reads this to verify a settlement it is asked to admit.
    function orders(bytes32 orderId) external view returns (Order memory) {
        return _orders[orderId];
    }

    /// @notice Pays an order. Exactly `amountIn` of native ETH must be sent; the registered recipient
    ///         receives at least `minOut` of the output currency in this same transaction, or the
    ///         call reverts and the payer keeps everything (invariant I6, never strand).
    function pay(bytes32 orderId) external payable {
        Order storage order = _orders[orderId];
        if (order.recipient == address(0)) revert UnknownOrder(orderId);
        if (order.settled) revert OrderAlreadySettled(orderId);
        if (block.timestamp > order.deadline) revert OrderExpired(orderId, order.deadline);
        if (msg.value != order.amountIn) revert WrongValue(order.amountIn, msg.value);

        // Invariant I5: consumed before any external effect, so a reentrant second payment of the
        // same order meets `settled == true` and reverts.
        order.settled = true;

        bytes memory result = POOL_MANAGER.unlock(abi.encode(orderId));
        uint256 amountOut = abi.decode(result, (uint256));
        emit Settled(orderId, msg.sender, order.recipient, order.amountIn, amountOut);
    }

    /// @inheritdoc IUnlockCallback
    /// @dev Runs inside the PoolManager's unlock window. Swap, verify the fill, settle the native
    ///      input (invariant I7), take the output to the registered recipient (invariant I1).
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(POOL_MANAGER)) revert NotPoolManager(msg.sender);
        bytes32 orderId = abi.decode(data, (bytes32));
        Order storage order = _orders[orderId];

        BalanceDelta delta = POOL_MANAGER.swap(
            order.key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(uint256(order.amountIn)),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            abi.encode(orderId) // spec C1: hook data carries only the id; everything else is in storage
        );

        // Exact input: amount0 is what the pool took, negative. A partial fill is a failed payment,
        // never a smaller one (spec addendum A13).
        uint256 consumed = uint256(uint128(-delta.amount0()));
        if (consumed != order.amountIn) revert PartialFill(order.amountIn, consumed);
        uint256 amountOut = uint256(uint128(delta.amount1()));
        if (amountOut < order.minOut) revert OutputBelowMinimum(order.minOut, amountOut);

        _settleNativeInput(order.amountIn);
        POOL_MANAGER.take(order.key.currency1, order.recipient, amountOut);
        return abi.encode(amountOut);
    }

    /// @dev Invariant I7. `sync` is called for the native currency immediately before the native
    ///      `settle`, with nothing between them. The PoolManager settles whatever currency was synced
    ///      last; if an earlier leg of the same unlock synced an ERC-20 and nothing reset it, a native
    ///      `settle{value:}` reverts with `NonzeroNativeValue`. v4-core's own `CurrencySettler` skips
    ///      this call and its comment says it is not required; `PoolManager.sol` says otherwise.
    ///      Virtual so a test can remove the defence and prove the difference.
    function _settleNativeInput(uint256 amount) internal virtual {
        POOL_MANAGER.sync(CurrencyLibrary.ADDRESS_ZERO);
        POOL_MANAGER.settle{value: amount}();
    }
}
