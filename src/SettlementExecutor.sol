// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {ActionConstants} from "@uniswap/v4-periphery/src/libraries/ActionConstants.sol";
import {UniswapDeployments} from "./libraries/UniswapDeployments.sol";

/// @notice The one function of Uniswap's Universal Router this contract calls.
interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @notice The one thing this contract asks the hook: how many settlements it has receipted.
interface ISettlementReceipts {
    function receiptCount() external view returns (uint256);
}

/// @title SettlementExecutor, the thin contract between an application and the official router
/// @notice UNICA uses Uniswap's official routing stack where compatible. This executor exists only to
///         enforce settlement-specific invariants the official router cannot currently express
///         (`docs/EXECUTION-PATH.md`): it keeps the orders, records who pays, and composes the
///         Universal Router's plan from the order so the output is taken to the order's recipient,
///         which the router would otherwise leave to whoever encodes the call. It never calls the
///         PoolManager, performs no route discovery, and is not a router.
/// @dev One constructor argument, the hook this executor serves: an order is accepted only for a
///      pool that hook guards, so no settlement can bypass the hook by naming another pool. The
///      hook derives this contract's CREATE2 address from this creation code plus its own address,
///      so the pair is bound both ways and nothing is configurable after deploy. The router is
///      resolved from the chain id. The contract never holds a balance: native value arrives only
///      through `pay` and leaves in the same call through the router; there is no `receive`, so a
///      stray transfer reverts.
contract SettlementExecutor {
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;

    /// @notice An order's life: created, being paid (the hook admits a swap only in this state),
    ///         settled. There is no way back from Settled, and Paying is entered before any
    ///         external call (invariant I5).
    enum Status {
        None,
        Open,
        Paying,
        Settled
    }

    /// @notice The only source of who is paid, by whom, how much, into which pool, and until when.
    struct Order {
        address recipient;
        address creator;
        address payer;
        PoolKey key;
        uint128 amountIn;
        uint128 minOut;
        uint64 deadline;
        Status status;
    }

    /// @notice Uniswap's Universal Router on this chain, the execution path the hook admits.
    address public immutable UNIVERSAL_ROUTER;
    /// @notice The settlement hook every order's pool must carry, and the only receipt this contract trusts.
    address public immutable HOOK;

    mapping(bytes32 orderId => Order) internal _orders;
    /// @notice Orders created so far. A statistic; ids come from the creator and a salt.
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
    /// @notice The executor's own record of a completed settlement, measured at the recipient. The
    ///         hook's receipt (invariant I2) is the one emitted from inside the swap.
    event Settled(
        bytes32 indexed orderId, address indexed payer, address indexed recipient, uint256 amountIn, uint256 amountOut
    );

    error ZeroRecipient();
    /// @notice The router maps address(1) and address(2) to itself or its caller; neither can be a recipient.
    error ReservedRecipient(address recipient);
    /// @notice The order's pool is not guarded by this executor's hook (invariants I3 to I6 would not apply).
    error PoolNotGuarded(address hooks);
    /// @notice The hook did not receipt exactly one settlement for this payment.
    error NoReceipt(bytes32 orderId);
    /// @notice The recipient's balance grew by less than the order's minimum: the pool credited enough,
    ///         but the token did not deliver it (a fee on transfer, for one). Nothing is settled short.
    error RecipientShort(bytes32 orderId, uint128 minOut, uint256 received);
    error ZeroAmount();
    error ZeroMinOut();
    error DeadlineInPast(uint64 deadline);
    error NativeInputOnly();
    error UnknownOrder(bytes32 orderId);
    /// @notice This creator already used this salt; the id would repeat.
    error OrderExists(bytes32 orderId);
    error OrderNotOpen(bytes32 orderId, Status status);
    error OrderExpired(bytes32 orderId, uint64 deadline);
    error WrongValue(uint256 expected, uint256 got);

    /// @dev The Universal Router command that runs v4 actions.
    uint8 internal constant COMMAND_V4_SWAP = 0x10;

    constructor(address hook) {
        UNIVERSAL_ROUTER = UniswapDeployments.universalRouter(block.chainid);
        HOOK = hook;
    }

    /// @notice Registers what a payment must do. Anyone may create an order; only the order decides
    ///         where output goes. Native ETH is the only input currency today (the live pool's shape).
    ///         The id is `keccak256(chainid, executor, creator, salt)`: bound to this chain and this
    ///         executor (threat T10), owned by the creator, and known before the call, so a caller can
    ///         compute it offline and a deploy script pays the id it simulated, whatever other orders
    ///         land in between. A creator reusing a salt is refused.
    function createOrder(
        address recipient,
        PoolKey calldata key,
        uint128 amountIn,
        uint128 minOut,
        uint64 deadline,
        bytes32 salt
    ) external returns (bytes32 orderId) {
        if (recipient == address(0)) revert ZeroRecipient();
        if (recipient == ActionConstants.MSG_SENDER || recipient == ActionConstants.ADDRESS_THIS) {
            revert ReservedRecipient(recipient);
        }
        if (address(key.hooks) != HOOK) revert PoolNotGuarded(address(key.hooks));
        if (amountIn == 0) revert ZeroAmount();
        if (minOut == 0) revert ZeroMinOut();
        if (deadline <= block.timestamp) revert DeadlineInPast(deadline);
        if (!key.currency0.isAddressZero()) revert NativeInputOnly();

        orderId = keccak256(abi.encode(block.chainid, address(this), msg.sender, salt));
        if (_orders[orderId].status != Status.None) revert OrderExists(orderId);
        ++orderCount;
        _orders[orderId] = Order({
            recipient: recipient,
            creator: msg.sender,
            payer: address(0),
            key: key,
            amountIn: amountIn,
            minOut: minOut,
            deadline: deadline,
            status: Status.Open
        });
        emit OrderCreated(orderId, recipient, msg.sender, key.toId(), amountIn, minOut, deadline);
    }

    /// @notice The order as stored. The hook reads this to verify the settlement it is asked to admit.
    function orders(bytes32 orderId) external view returns (Order memory) {
        return _orders[orderId];
    }

    /// @notice Pays an order through the Universal Router. Exactly `amountIn` of native ETH must be
    ///         sent; the registered recipient receives at least `minOut` of the output currency in this
    ///         same transaction, or the call reverts and the payer keeps everything (invariant I6).
    function pay(bytes32 orderId) external payable {
        Order storage order = _orders[orderId];
        if (order.status == Status.None) revert UnknownOrder(orderId);
        if (order.status != Status.Open) revert OrderNotOpen(orderId, order.status);
        if (block.timestamp > order.deadline) revert OrderExpired(orderId, order.deadline);
        if (msg.value != order.amountIn) revert WrongValue(order.amountIn, msg.value);

        // Invariant I5: the order leaves Open before any external call. The hook admits the swap only
        // while the order is Paying, so a second payment, reentrant or later, is refused.
        order.payer = msg.sender;
        order.status = Status.Paying;

        uint256 recipientBefore = IERC20Minimal(Currency.unwrap(order.key.currency1)).balanceOf(order.recipient);
        uint256 receiptsBefore = ISettlementReceipts(HOOK).receiptCount();
        (bytes memory commands, bytes[] memory inputs) = _plan(orderId, order);
        IUniversalRouter(UNIVERSAL_ROUTER).execute{value: order.amountIn}(commands, inputs, order.deadline);
        // The hook receipted exactly one settlement inside that call, or this was not a settlement.
        if (ISettlementReceipts(HOOK).receiptCount() != receiptsBefore + 1) revert NoReceipt(orderId);
        // What the recipient actually holds now, against what the order promised. The hook enforced
        // the minimum on the pool's credit; this is the same floor at the recipient, so a token that
        // delivers less than the pool credited cannot settle an order short (invariant I3 where it is
        // felt). A balance that did not grow counts as nothing received; there is no underflow.
        uint256 recipientAfter = IERC20Minimal(Currency.unwrap(order.key.currency1)).balanceOf(order.recipient);
        uint256 amountOut = recipientAfter > recipientBefore ? recipientAfter - recipientBefore : 0;
        if (amountOut < order.minOut) revert RecipientShort(orderId, order.minOut, amountOut);

        order.status = Status.Settled;
        emit Settled(orderId, msg.sender, order.recipient, order.amountIn, amountOut);
    }

    /// @dev The Universal Router plan for one order: swap exact input with only the order id as hook
    ///      data (spec C1), settle the native input from the value forwarded with the call, take the
    ///      whole output to the order's recipient. The router cannot bind that recipient itself; this
    ///      is the capability the executor exists for.
    function _plan(bytes32 orderId, Order storage order)
        internal
        view
        returns (bytes memory commands, bytes[] memory inputs)
    {
        bytes memory actions =
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE), uint8(Actions.TAKE));
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: order.key,
                zeroForOne: true,
                amountIn: order.amountIn,
                amountOutMinimum: order.minOut,
                hookData: abi.encode(orderId)
            })
        );
        // SETTLE the native input: the full debt, from the router's own balance (the value forwarded).
        params[1] = abi.encode(order.key.currency0, ActionConstants.OPEN_DELTA, false);
        // TAKE the full output credit to the order's recipient. Invariant I1 lives on this line.
        params[2] = abi.encode(order.key.currency1, order.recipient, ActionConstants.OPEN_DELTA);

        inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
        commands = abi.encodePacked(COMMAND_V4_SWAP);
    }
}
