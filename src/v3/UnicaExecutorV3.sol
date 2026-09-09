// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {ActionConstants} from "@uniswap/v4-periphery/src/libraries/ActionConstants.sol";
import {RouterParamsCodec} from "../compat/RouterParamsCodec.sol";
import {UnicaDeploymentsV3} from "./UnicaDeploymentsV3.sol";

/// @notice The one function of Uniswap's Universal Router this contract calls.
interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @notice The one thing this contract asks the hook: how many settlements it has receipted.
interface ISettlementReceiptsV3 {
    function receiptCount() external view returns (uint256);
}

/// @title UnicaExecutorV3, the settlement executor that knows which router it is talking to
/// @notice V1's invariants, unchanged and non-negotiable: the plan is built from STORAGE and never
///         from caller data; the swap is exact-input for exactly the order's amount; the recipient is
///         the one registered when the order was created; a partial fill or a short delivery reverts
///         the whole payment. What is new is that the swap parameters are encoded for the layout the
///         router on THIS chain actually decodes, through `src/compat/RouterParamsCodec.sol`, instead
///         of for the one this repository's pinned v4-periphery happens to define.
///
///         THE LAYOUT IS BOUND TO THE ROUTER'S IDENTITY, NOT TO THE CHAIN ID. A chain id is a number
///         an RPC endpoint asserts; the router's runtime code hash is what the router is. Every
///         payment re-reads `UNIVERSAL_ROUTER.codehash` and refuses to build a plan unless it is the
///         hash `UnicaDeploymentsV3` recorded for this chain. A Universal Router redeployed under a
///         live executor changes which head it decodes without changing its address, and this
///         contract must stop rather than keep sending the old shape into the new decoder.
///
///         WHY THAT REFUSAL IS WORTH ITS GAS. A mismatched layout is not reliably loud. On a
///         NATIVE-input pool — `currency0 == address(0)`, the only pool shape UNICA settles through —
///         a five-field router hands a six-field call's `minHopPriceX36 = 0` to its decoder as the
///         hook data offset; offset zero lands back on `currency0`, and the zero there reads as
///         length zero. The swap SUCCEEDS and the hook is handed empty bytes. UNICA survives that
///         because `UnicaHookV3` requires exactly one `bytes32` of hook data and refuses a swap
///         without it, so a dropped order id becomes a refusal rather than a payment with no receipt.
///         This check is the layer in front of that backstop: it fails before any value is forwarded,
///         with a named error that says which hash was expected, instead of relying on the hook to
///         catch the consequence.
///
/// @dev One constructor argument, the hook this executor serves, exactly as in V1: an order is
///      accepted only for a pool that hook guards, so no settlement can bypass the hook by naming
///      another pool. The hook derives this contract's CREATE2 address from this creation code plus
///      its own address, so the pair is bound both ways and nothing is configurable after deploy.
///      The contract never holds a balance: native value arrives only through `pay` and leaves in the
///      same call through the router; there is no `receive`, so a stray transfer reverts.
///
///      A CONSEQUENCE WORTH STATING PLAINLY. The recorded code hash lives in `UnicaDeploymentsV3`,
///      which is embedded in this contract's creation code, which fixes this contract's CREATE2
///      address, which the hook embeds, which fixes the hook's mined address. So a router upgrade on
///      any of the five chains is not a config change — it is a NEW GENERATION, with new addresses
///      and a new pool. That is the same rule that keeps V1's deployed bytecode checkable against its
///      source, applied one generation later.
contract UnicaExecutorV3 {
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;

    /// @notice An order's life: created, being paid (the hook admits a swap only in this state),
    ///         settled. There is no way back from Settled, and Paying is entered before any external
    ///         call.
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
    /// @notice The runtime code hash that router must still have. Read from `UnicaDeploymentsV3` at
    ///         construction and never writable afterwards, so the binding cannot be edited loose.
    bytes32 public immutable UNIVERSAL_ROUTER_CODE_HASH;
    /// @notice Which `ExactInputSingleParams` layout that router decodes. An enum, resolved once.
    RouterParamsCodec.Layout public immutable ROUTER_LAYOUT;
    /// @notice The settlement hook every order's pool must carry, and the only receipt this contract trusts.
    address public immutable HOOK;
    /// @notice Uniswap's PoolManager on this chain. Read only to refuse it as a recipient.
    address public immutable POOL_MANAGER;
    /// @notice The one currency a settlement may pay out on this chain.
    address public immutable PAYOUT_CURRENCY;

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
    ///         hook's receipt is the one emitted from inside the swap.
    event Settled(
        bytes32 indexed orderId, address indexed payer, address indexed recipient, uint256 amountIn, uint256 amountOut
    );

    error ZeroRecipient();
    /// @notice A recipient no settlement may name: the router's two sentinels (address(1) is its
    ///         caller, address(2) is itself), and the contracts on the path. Output sent to the
    ///         router is sweepable by the next caller; output sent to this executor, the hook or the
    ///         PoolManager is stranded, because none of them can move a token out. An order naming
    ///         one is refused where it is created, not where it is paid.
    error ReservedRecipient(address recipient);
    /// @notice The order's pool is not guarded by this executor's hook.
    error PoolNotGuarded(address hooks);
    /// @notice The order's payout currency is not this chain's. The hook refuses such a pool at
    ///         initialisation; this is the same refusal one step earlier, with a clear name.
    error PayoutCurrencyNotAllowed(address currency1);
    /// @notice The hook did not receipt exactly one settlement for this payment.
    error NoReceipt(bytes32 orderId);
    /// @notice The recipient's balance grew by less than the order's minimum: the pool credited
    ///         enough, but the token did not deliver it. Nothing is settled short.
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
    /// @notice The router at the recorded address is not the build whose layout this executor encodes
    ///         for. Refused before any value is forwarded, with both hashes named so an operator can
    ///         see at a glance whether the router moved or the table is stale.
    error RouterCodeChanged(address router, bytes32 expected, bytes32 found);
    /// @notice The deployments table answered `Layout.Unknown` for this chain. Nothing can be encoded
    ///         from that, and picking one of the two would be a coin flip on a native-input pool where
    ///         the wrong choice succeeds silently. Refused at construction.
    error RouterLayoutUnknown(uint256 chainId);

    /// @dev The Universal Router command that runs v4 actions.
    uint8 internal constant COMMAND_V4_SWAP = 0x10;

    /// @dev No per-hop price floor is ever requested. Every UNICA settlement is a SINGLE hop, and for
    ///      a single hop the whole-swap minimum below (`amountOutMinimum = order.minOut`) is already
    ///      the binding constraint — a per-hop floor could only duplicate it. Zero is also the exact
    ///      behaviour a five-field router has, because it has no such field, which is what lets one
    ///      order settle identically under both layouts. It is a named constant rather than a bare
    ///      `0` in the struct literal so that the day a multi-hop plan is written, the thing that has
    ///      to be reconsidered has a name to search for.
    uint256 internal constant NO_PER_HOP_PRICE_FLOOR = 0;

    constructor(address hook) {
        UnicaDeploymentsV3.Routing memory r = UnicaDeploymentsV3.routing(block.chainid);
        if (r.layout == RouterParamsCodec.Layout.Unknown) revert RouterLayoutUnknown(block.chainid);

        UNIVERSAL_ROUTER = r.universalRouter;
        UNIVERSAL_ROUTER_CODE_HASH = r.universalRouterCodeHash;
        ROUTER_LAYOUT = r.layout;
        POOL_MANAGER = r.poolManager;
        // Reverts on a chain with no verified payout token, so this executor cannot exist there.
        PAYOUT_CURRENCY = UnicaDeploymentsV3.payoutCurrency(block.chainid);
        HOOK = hook;

        // Deploy time is the cheapest moment to discover the table is stale, so ask once here as
        // well as on every payment. A deploy onto a chain whose router has already moved fails now,
        // loudly, instead of at the first settlement.
        _requireRouterUnchanged();
    }

    /// @notice Registers what a payment must do. Anyone may create an order; only the order decides
    ///         where output goes. Native ETH is the only input currency. The id is
    ///         `keccak256(chainid, executor, creator, salt)`: bound to this chain and this executor,
    ///         owned by the creator, and known before the call, so a caller can compute it offline
    ///         and a script pays the id it simulated, whatever other orders land in between.
    function createOrder(
        address recipient,
        PoolKey calldata key,
        uint128 amountIn,
        uint128 minOut,
        uint64 deadline,
        bytes32 salt
    ) external returns (bytes32 orderId) {
        if (recipient == address(0)) revert ZeroRecipient();
        if (
            recipient == ActionConstants.MSG_SENDER || recipient == ActionConstants.ADDRESS_THIS
                || recipient == UNIVERSAL_ROUTER || recipient == address(this) || recipient == HOOK
                || recipient == POOL_MANAGER
        ) {
            revert ReservedRecipient(recipient);
        }
        if (address(key.hooks) != HOOK) revert PoolNotGuarded(address(key.hooks));
        if (Currency.unwrap(key.currency1) != PAYOUT_CURRENCY) {
            revert PayoutCurrencyNotAllowed(Currency.unwrap(key.currency1));
        }
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
    ///         sent; the registered recipient receives at least `minOut` of the output currency in
    ///         this same transaction, or the call reverts and the payer keeps everything.
    function pay(bytes32 orderId) external payable {
        Order storage order = _orders[orderId];
        if (order.status == Status.None) revert UnknownOrder(orderId);
        if (order.status != Status.Open) revert OrderNotOpen(orderId, order.status);
        if (block.timestamp > order.deadline) revert OrderExpired(orderId, order.deadline);
        if (msg.value != order.amountIn) revert WrongValue(order.amountIn, msg.value);

        // Before anything is committed and before a single wei moves: is the router still the build
        // whose parameter layout this contract encodes for? A router replaced underneath a live
        // executor must stop the settlement, not silently change what its calldata means.
        _requireRouterUnchanged();

        // The order leaves Open before any external call. The hook admits the swap only while the
        // order is Paying, so a second payment, reentrant or later, is refused.
        order.payer = msg.sender;
        order.status = Status.Paying;

        uint256 recipientBefore = IERC20Minimal(Currency.unwrap(order.key.currency1)).balanceOf(order.recipient);
        uint256 receiptsBefore = ISettlementReceiptsV3(HOOK).receiptCount();
        (bytes memory commands, bytes[] memory inputs) = _plan(orderId, order);
        IUniversalRouter(UNIVERSAL_ROUTER).execute{value: order.amountIn}(commands, inputs, order.deadline);
        // The hook receipted exactly one settlement inside that call, or this was not a settlement.
        if (ISettlementReceiptsV3(HOOK).receiptCount() != receiptsBefore + 1) revert NoReceipt(orderId);
        // What the recipient actually holds now, against what the order promised. The hook enforced
        // the minimum on the pool's credit; this is the same floor at the recipient, so a token that
        // delivers less than the pool credited cannot settle an order short. A balance that did not
        // grow counts as nothing received; there is no underflow.
        uint256 recipientAfter = IERC20Minimal(Currency.unwrap(order.key.currency1)).balanceOf(order.recipient);
        uint256 amountOut = recipientAfter > recipientBefore ? recipientAfter - recipientBefore : 0;
        if (amountOut < order.minOut) revert RecipientShort(orderId, order.minOut, amountOut);

        order.status = Status.Settled;
        emit Settled(orderId, msg.sender, order.recipient, order.amountIn, amountOut);
    }

    /// @notice The exact plan this executor would build for an order, without paying it.
    /// @dev Read-only, so an operator or a script can diff the calldata against what a probe says the
    ///      router wants BEFORE signing anything. It runs the same code path `pay` does, including
    ///      the router-identity check, so what it shows is what would be sent or nothing at all.
    function planFor(bytes32 orderId) external view returns (bytes memory commands, bytes[] memory inputs) {
        Order storage order = _orders[orderId];
        if (order.status == Status.None) revert UnknownOrder(orderId);
        _requireRouterUnchanged();
        return _plan(orderId, order);
    }

    /// @dev The router at the recorded address is still the recorded build, or nothing proceeds.
    ///      `codehash` is zero for an account that does not exist and `keccak256("")` for one with no
    ///      code, and neither can equal a recorded runtime hash, so an empty or self-destructed
    ///      address fails here rather than sliding through as "well, it did not mismatch".
    function _requireRouterUnchanged() internal view {
        bytes32 found = UNIVERSAL_ROUTER.codehash;
        if (found != UNIVERSAL_ROUTER_CODE_HASH) {
            revert RouterCodeChanged(UNIVERSAL_ROUTER, UNIVERSAL_ROUTER_CODE_HASH, found);
        }
    }

    /// @dev The Universal Router plan for one order: swap exact input with only the order id as hook
    ///      data, settle the native input from the value forwarded with the call, take the whole
    ///      output to the order's recipient. The router cannot bind that recipient itself; this is
    ///      the capability the executor exists for.
    ///
    ///      Only `params[0]` differs from V1, and only in its ENCODING: `RouterParamsCodec` lays the
    ///      same six values out as nine head words or ten depending on `ROUTER_LAYOUT`. The `SETTLE`
    ///      and `TAKE` parameters are plain tuples that both router builds decode identically, which
    ///      is why the layout question is confined to one line.
    function _plan(bytes32 orderId, Order storage order)
        internal
        view
        returns (bytes memory commands, bytes[] memory inputs)
    {
        bytes memory actions =
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE), uint8(Actions.TAKE));
        bytes[] memory params = new bytes[](3);
        params[0] = RouterParamsCodec.encode(
            ROUTER_LAYOUT,
            RouterParamsCodec.SwapExactInSingle({
                poolKey: order.key,
                zeroForOne: true,
                amountIn: order.amountIn,
                amountOutMinimum: order.minOut,
                minHopPriceX36: NO_PER_HOP_PRICE_FLOOR,
                hookData: abi.encode(orderId)
            })
        );
        // SETTLE the native input: the full debt, from the router's own balance (the value forwarded).
        params[1] = abi.encode(order.key.currency0, ActionConstants.OPEN_DELTA, false);
        // TAKE the full output credit to the order's recipient.
        params[2] = abi.encode(order.key.currency1, order.recipient, ActionConstants.OPEN_DELTA);

        inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
        commands = abi.encodePacked(COMMAND_V4_SWAP);
    }
}
