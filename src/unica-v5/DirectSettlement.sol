// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {UnicaMarketTypes} from "../unica-v4/UnicaMarketTypes.sol";
import {IDirectSettlement} from "./IDirectSettlement.sol";

/// @dev The three calls this contract makes on a token, declared here rather than imported so the
///      return value is handled explicitly at every site. A token that reverts, or that answers
///      `false`, is refused by name instead of being read as success. `transferFrom` is called
///      through a low level call because a token that returns nothing at all is still a token this
///      settler must be able to move, and the compiler's generated call would reject it.
interface IDirectERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

/// @title DirectSettlement, a same asset payment that never touches a pool
/// @notice When the customer pays in the very asset the business wants to receive, there is nothing
///         to convert, so there is no reason to route the money through a market. This contract
///         moves exactly the amount the sale names, from the one customer the sale is bound to,
///         straight to the business address the sale froze when it was raised.
///
///         WHY IT IS ITS OWN CONTRACT. The v4 market executor's semantics are frozen around a swap:
///         a price, a pool, liquidity, caps measured on the delivered payout. A direct transfer has
///         none of those, so branching inside the executor would widen an audited trust surface for
///         a case that shares none of its risks. Instead this contract carries the same order shape
///         and the same three call names the executor exposes, so admission, the wallet layer and
///         the evidence reader treat both paths alike.
///
///         WHAT A PAYMENT IS HERE. Exactly `amountIn` of one asset leaves the customer the sale
///         named and arrives at the business address the sale froze. The arrival is measured as a
///         balance change on the receiving address, not assumed from the token's answer, so a token
///         that skims a fee, that rebases, or that credits somebody else is refused and the whole
///         transaction is undone. There is no partial success: either the business is paid the
///         whole amount or nothing moved at all.
///
/// @dev No `receive()`, no sweep, no rescue. This contract never holds a balance, because the money
///      goes from the customer to the business in one transfer and never lands here. The admin's
///      only power is `setOrderCreator`. Nothing, admin included, can move a token, change an
///      existing sale, or redirect a payment.
contract DirectSettlement is IDirectSettlement {
    // ---- immutables ------------------------------------------------------------------------------

    /// @inheritdoc IDirectSettlement
    address public immutable ASSET;
    /// @inheritdoc IDirectSettlement
    bytes32 public immutable SETTLEMENT_ID;
    /// @notice The only account that may add or remove an order creator. It cannot do anything else.
    address public immutable ADMIN;

    /// @notice Present so a caller written against the market executor's ABI reads the same three
    ///         fields here and gets true answers. There is no market, so the market id is this
    ///         settler's own stable id, and both sides of the trade are the one asset it moves.
    ///         Admission's optional policy gate reads exactly these three, which is why they exist.
    function MARKET_ID() external view returns (bytes32) {
        return SETTLEMENT_ID;
    }

    function ASSET_TOKEN() external view returns (address) {
        return ASSET;
    }

    function PAYOUT_TOKEN() external view returns (address) {
        return ASSET;
    }

    // ---- storage ---------------------------------------------------------------------------------

    mapping(bytes32 => UnicaMarketTypes.Order) private _orders;
    /// @dev The creator's salt, kept per sale so the receipt can say which register raised it. The
    ///      admission contract builds that salt as `keccak256(terminalNode, nonce)`, so the value
    ///      identifies the register without this contract needing to know anything about a name
    ///      tree. It is written once, by `createOrder`, and never changed.
    mapping(bytes32 => bytes32) private _terminalNodeOf;
    mapping(address => bool) private _orderCreators;
    /// @notice How many sales this settler has ever raised.
    uint256 public orderCount;

    /// @dev The reentrancy latch, in transient storage: it costs nothing to clear and cannot
    ///      survive the transaction that set it. Namespaced so it cannot collide with anything.
    bytes32 private constant LOCK_SLOT = keccak256("DirectSettlement.lock");

    /// @dev The largest amount this contract will accept, matching the market executor's own bound
    ///      so a sale that is legal on one path is legal on the other.
    uint128 private constant MAX_AMOUNT = uint128(uint128(type(int128).max));

    // ---- refusals beyond the interface -------------------------------------------------------------

    /// @dev `IDirectSettlement` names the refusals a caller has to handle. These five are this
    ///      implementation's own, kept as named errors rather than folded into a shared one so a
    ///      failed sale says which precondition it broke.
    error NotAdmin(address who);
    error ZeroAddress();
    error ZeroRecipient();
    error ZeroPayer();
    error ReservedRecipient(address recipient);
    error AmountTooLarge(uint256 amount);
    /// @notice There is nothing to convert here, so a sale that asks to receive a different amount
    ///         than it pays is not a direct settlement at all and is refused rather than rounded.
    error MinOutNotEqualAmountIn(uint128 amountIn, uint128 minOut);
    error DeadlineInPast(uint64 deadline);
    error OrderExists(bytes32 orderId);
    error Reentered();

    event OrderCreatorSet(address indexed creator, bool allowed);

    // ---- construction ------------------------------------------------------------------------------

    /// @param asset the one asset this settler moves. Both halves of every sale are this asset.
    /// @param admin the only account that may call `setOrderCreator`.
    constructor(address asset, address admin) {
        if (asset == address(0) || admin == address(0)) revert ZeroAddress();
        ASSET = asset;
        ADMIN = admin;
        SETTLEMENT_ID = keccak256(abi.encode("unica-v5/direct", block.chainid, address(this), asset));
    }

    // ---- creation ------------------------------------------------------------------------------

    /// @inheritdoc IDirectSettlement
    /// @dev The checks run in the market executor's order, and the order is part of the contract: a
    ///      caller that is not an allowlisted creator learns that before it learns anything about
    ///      its arguments.
    function createOrder(
        address recipient,
        address payer,
        uint128 amountIn,
        uint128 minOut,
        uint64 deadline,
        bytes32 salt
    ) external returns (bytes32 orderId) {
        if (!_orderCreators[msg.sender]) revert NotOrderCreator(msg.sender);

        if (recipient == address(0)) revert ZeroRecipient();
        if (recipient == address(this) || recipient == ASSET) revert ReservedRecipient(recipient);
        if (payer == address(0)) revert ZeroPayer();
        if (amountIn == 0) revert ZeroAmount();
        if (amountIn > MAX_AMOUNT) revert AmountTooLarge(amountIn);
        if (minOut != amountIn) revert MinOutNotEqualAmountIn(amountIn, minOut);
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
        _terminalNodeOf[orderId] = salt;
        unchecked {
            ++orderCount;
        }
        emit OrderCreated(orderId, recipient, payer, amountIn, deadline, salt);
    }

    // ---- payment ------------------------------------------------------------------------------

    /// @inheritdoc IDirectSettlement
    /// @dev Checks, then effects, then the one interaction, then the measurement of that
    ///      interaction, then the success signal. The status is written to Paying before the token
    ///      is called, so a token that calls back in finds a sale already in flight rather than an
    ///      open one, and the transient latch refuses the reentry outright even for a different
    ///      sale. Delivery is measured as the receiving address's own balance change across the
    ///      transfer, never taken from the token's return value.
    function pay(bytes32 orderId) external {
        _lock();

        UnicaMarketTypes.Order storage order = _orders[orderId];
        UnicaMarketTypes.OrderStatus stored = order.status;
        if (stored == UnicaMarketTypes.OrderStatus.None) revert UnknownOrder(orderId);
        if (stored != UnicaMarketTypes.OrderStatus.Open) revert OrderNotOpen(orderId, uint8(stored));
        if (order.deadline < block.timestamp) revert OrderExpired(orderId, order.deadline);
        if (msg.sender != order.payer) revert WrongPayer(orderId, order.payer, msg.sender);

        address recipient = order.recipient;
        uint128 amount = order.amountIn;
        order.status = UnicaMarketTypes.OrderStatus.Paying;

        uint256 recipientBefore = IDirectERC20(ASSET).balanceOf(recipient);
        _transferFrom(msg.sender, recipient, amount);
        uint256 recipientAfter = IDirectERC20(ASSET).balanceOf(recipient);

        // A token that DEBITS the receiving address inside its own transfer would underflow here,
        // so that case is refused by name and the diagnosis survives instead of becoming a panic.
        uint256 delivered = recipientAfter < recipientBefore ? 0 : recipientAfter - recipientBefore;
        if (delivered != amount) revert DeliveryNotExact(amount, delivered);

        order.status = UnicaMarketTypes.OrderStatus.Settled;
        emit DirectReceipt(
            orderId, recipient, msg.sender, ASSET, amount, _terminalNodeOf[orderId], uint64(block.timestamp)
        );

        _unlock();
    }

    // ---- views ------------------------------------------------------------------------------

    /// @inheritdoc IDirectSettlement
    function orders(bytes32 orderId) external view returns (UnicaMarketTypes.Order memory) {
        return _orders[orderId];
    }

    /// @notice The salt the creator supplied for this sale, which is how a receipt names the
    ///         register that raised it.
    function terminalNodeOf(bytes32 orderId) external view returns (bytes32) {
        return _terminalNodeOf[orderId];
    }

    /// @inheritdoc IDirectSettlement
    function isOrderCreator(address creator) external view returns (bool) {
        return _orderCreators[creator];
    }

    /// @notice How much of `ASSET` the bound customer has approved this settler to move.
    function allowanceOf(address payer) external view returns (uint256) {
        return IDirectERC20(ASSET).allowance(payer, address(this));
    }

    // ---- admin ------------------------------------------------------------------------------

    /// @inheritdoc IDirectSettlement
    /// @dev The admin's only power. It decides who may raise a sale; it can neither pay one, nor
    ///      change one, nor move a token.
    function setOrderCreator(address creator, bool allowed) external {
        if (msg.sender != ADMIN) revert NotAdmin(msg.sender);
        _orderCreators[creator] = allowed;
        emit OrderCreatorSet(creator, allowed);
    }

    // ---- internals ------------------------------------------------------------------------------

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

    /// @dev A token that reverts, or answers `false`, is a refusal. A token that answers nothing at
    ///      all is accepted here, because several long lived assets do exactly that and the balance
    ///      measurement in `pay` is what actually proves the money arrived.
    function _transferFrom(address from, address to, uint256 amount) private {
        (bool ok, bytes memory ret) = ASSET.call(abi.encodeCall(IDirectERC20.transferFrom, (from, to, amount)));
        if (!ok) revert TransferFailed();
        if (ret.length != 0 && (ret.length != 32 || !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
