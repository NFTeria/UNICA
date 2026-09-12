// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IProductCatalog} from "./IProductCatalog.sol";

/// @dev The two calls this contract makes on a token, declared here rather than imported so the
///      return value is handled explicitly at both sites. `transferFrom` goes out through a low
///      level call because a token that returns nothing at all is still a token a business may
///      price in, and the compiler's generated call would reject it; the balance measurement in
///      `buy` is what actually proves the money arrived, not the token's answer.
interface IProductERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title ProductCatalog, the list of what a business sells
/// @notice A business writes down what it sells — the name it uses for it, the asset it wants, the
///         price — and from then on a customer can pay for it in one transaction. Three shapes,
///         set out in `IProductCatalog`: something sold once, something paid for every period, and
///         something on the shelf forever.
///
///         WHY THE TERMS NEVER MOVE. Price, asset, kind, period and name are written once, at
///         listing, and there is no function anywhere in this contract that changes any of them.
///         The reason is the subscriber: somebody who agreed to pay 20 a month cannot wake up
///         paying 200 a month because the seller edited a row, and somebody who bought a permanent
///         product cannot find that the thing they bought is now named something else. A seller who
///         wants different terms lists a new product and stops selling the old one — which leaves
///         both on the chain, in order, for anyone to read. The one thing a seller may change is
///         whether they are selling it at all.
///
///         WHAT A SALE IS HERE. Exactly the price, in the asset the product names, from the buyer
///         to the payout wallet, in the same transaction. The arrival is measured as a balance
///         change on the payout wallet, never taken from the token's return value, so a token that
///         skims a fee, that rebases, or that credits somebody else is refused and the whole
///         transaction is undone. There is no partial sale: either the business is paid in full or
///         nothing moved. This is the same rule `DirectSettlement` enforces on the same-asset
///         payment path, for the same reason and by the same measurement.
///
///         WHAT THIS CONTRACT CANNOT DO. It never holds a balance, so there is nothing to sweep and
///         no rescue function. It has no owner, no admin, no pauser and no upgrade path, so there
///         is no account that can take a listing down, redirect a payment, refund a buyer, or
///         change a subscriber's terms. It never converts anything: a customer who wants to pay in
///         a different asset uses the market path, which is a different contract with a different
///         trust surface.
contract ProductCatalog is IProductCatalog {
    // ---- refusals beyond the interface -------------------------------------------------------------

    /// @dev `IProductCatalog` names the refusals a buyer or a seller has to handle at the moment of
    ///      a sale. These are this implementation's own listing-time rules, kept as named errors so
    ///      a refused listing says which sentence it broke rather than reverting anonymously.
    error NameEmpty();
    error NameTooLong(uint256 length);
    error ZeroPrice();
    /// @notice An address with no code can never move a token, so a product priced in one could
    ///         never be bought. Refused when it is listed, loudly, rather than when somebody tries.
    error AssetNoCode(address asset);
    error PeriodRequired();
    error PeriodNotAllowed(uint8 kind, uint64 period);
    /// @notice A period longer than this is not a subscription anybody is going to honour, and an
    ///         unbounded one would let the date a buyer is paid through run past what a `uint64`
    ///         can hold. Bounded here so the refusal is a sentence rather than an arithmetic panic.
    error PeriodTooLong(uint64 period, uint64 maximum);
    /// @notice Only something sold once can be promised to one named person. A subscription or a
    ///         shelf product bound to a single buyer is a contradiction, so it is refused instead
    ///         of silently ignored.
    error BuyerBindingNotAllowed(uint8 kind, address onlyBuyer);
    /// @notice Paying the catalogue itself, or the token contract, is never what a business meant,
    ///         and both would make the delivery measurement meaningless.
    error ReservedPayout(address payout);
    /// @notice Buying your own product, into your own wallet, moves nothing: the balance this
    ///         contract measures ends exactly where it started, so there is no payment to record
    ///         and a receipt for one would be a lie. Said in a sentence rather than left to surface
    ///         as a confusing `DeliveryNotExact(price, 0)`.
    error PayingYourself(uint256 productId, address payout);
    error Reentered();

    // ---- constants and immutables ------------------------------------------------------------------

    /// @notice Ten years. See `PeriodTooLong`.
    uint64 public constant MAX_PERIOD = 3650 days;
    /// @notice The longest name this catalogue stores, in bytes. Long enough for what a business
    ///         calls a haircut and short enough that a listing cannot be used as cheap storage.
    uint256 public constant MAX_NAME_BYTES = 64;

    /// @inheritdoc IProductCatalog
    bytes32 public immutable CATALOG_ID;

    /// @dev The reentrancy latch, in transient storage: it costs nothing to clear and cannot
    ///      survive the transaction that set it. Namespaced so it cannot collide with anything.
    bytes32 private constant LOCK_SLOT = keccak256("ProductCatalog.lock");

    // ---- storage ---------------------------------------------------------------------------------

    mapping(uint256 => Product) private _products;
    mapping(address => uint256[]) private _productsOf;
    mapping(uint256 => mapping(address => uint64)) private _paidThrough;

    /// @inheritdoc IProductCatalog
    /// @dev Ids count from 1, so a zero id is never a real product and a caller that forgot to set
    ///      one is refused rather than served product number zero.
    uint256 public productCount;
    /// @inheritdoc IProductCatalog
    uint256 public salesCount;

    constructor() {
        CATALOG_ID = keccak256(abi.encode(block.chainid, address(this)));
    }

    // ---- listing ------------------------------------------------------------------------------

    /// @inheritdoc IProductCatalog
    /// @dev Every rule is checked before anything is written, and each one is its own named error,
    ///      so a business whose listing is refused is told which part of it was wrong.
    function list(
        string calldata name,
        address asset,
        uint256 price,
        Kind kind,
        uint64 period,
        address payout,
        address onlyBuyer
    ) external returns (uint256 productId) {
        uint256 nameLength = bytes(name).length;
        if (nameLength == 0) revert NameEmpty();
        if (nameLength > MAX_NAME_BYTES) revert NameTooLong(nameLength);
        if (price == 0) revert ZeroPrice();
        if (asset.code.length == 0) revert AssetNoCode(asset);

        if (kind == Kind.RECURRING) {
            if (period == 0) revert PeriodRequired();
            if (period > MAX_PERIOD) revert PeriodTooLong(period, MAX_PERIOD);
        } else if (period != 0) {
            revert PeriodNotAllowed(uint8(kind), period);
        }

        if (onlyBuyer != address(0) && kind != Kind.ONE_OFF) revert BuyerBindingNotAllowed(uint8(kind), onlyBuyer);

        address where = payout == address(0) ? msg.sender : payout;
        if (where == address(this) || where == asset) revert ReservedPayout(where);

        unchecked {
            productId = ++productCount;
        }
        _products[productId] = Product({
            seller: msg.sender,
            payout: where,
            asset: asset,
            price: price,
            kind: kind,
            period: period,
            onlyBuyer: onlyBuyer,
            active: true,
            sold: false,
            name: name
        });
        _productsOf[msg.sender].push(productId);
        _emitListed(productId, name);
    }

    /// @dev Split out for the same reason as `_emitSold`: nine event fields plus this function's
    ///      own locals do not fit on the stack in one frame with the optimizer off. Everything but
    ///      the name is read back from the row that was just written, so the event and the stored
    ///      product cannot drift apart.
    function _emitListed(uint256 productId, string calldata name) private {
        Product storage p = _products[productId];
        emit ProductListed(productId, p.seller, p.asset, p.price, p.kind, p.period, p.payout, p.onlyBuyer, name);
    }

    /// @inheritdoc IProductCatalog
    /// @dev The only thing about a listing that ever changes, and only the seller may change it.
    ///      Taking a product down does not undo a sale, does not touch a subscriber's paid-through
    ///      date, and does not stop that date from being read: it stops new sales and nothing else.
    function setActive(uint256 productId, bool active) external {
        Product storage p = _products[productId];
        if (p.seller == address(0)) revert UnknownProduct(productId);
        if (msg.sender != p.seller) revert NotSeller(productId, p.seller, msg.sender);
        p.active = active;
        emit ProductActivity(productId, p.seller, active);
    }

    // ---- buying ------------------------------------------------------------------------------

    /// @inheritdoc IProductCatalog
    /// @dev Checks, then effects, then the one interaction, then the measurement of that
    ///      interaction, then the success signal. A ONE_OFF is marked sold and a RECURRING buyer's
    ///      paid-through date is moved BEFORE the token is called, so a token that calls back in
    ///      finds a sale already made rather than one still open; the transient latch refuses the
    ///      reentry outright in any case, including into a different product. Delivery is measured
    ///      as the payout wallet's own balance change across the transfer.
    function buy(uint256 productId) external returns (bytes32 saleId) {
        _lock();

        Product storage p = _products[productId];
        if (p.seller == address(0)) revert UnknownProduct(productId);
        if (!p.active) revert ProductInactive(productId);

        if (p.payout == msg.sender) revert PayingYourself(productId, msg.sender);

        uint64 coveredThrough = _recordSale(productId, p);
        _collect(p.asset, p.payout, p.price);

        saleId = keccak256(abi.encode(block.chainid, address(this), productId, msg.sender, salesCount));
        unchecked {
            ++salesCount;
        }
        _emitSold(productId, saleId, coveredThrough);

        _unlock();
    }

    /// @dev The whole of the sale's effect on this contract's own storage, written before the token
    ///      is called. Returns the date the buyer is covered to, which is zero for every kind but
    ///      RECURRING because the other two cover no stretch of time.
    function _recordSale(uint256 productId, Product storage p) private returns (uint64 coveredThrough) {
        Kind kind = p.kind;
        if (kind == Kind.ONE_OFF) {
            if (p.sold) revert AlreadySold(productId);
            address bound = p.onlyBuyer;
            if (bound != address(0) && msg.sender != bound) revert WrongBuyer(productId, bound, msg.sender);
            p.sold = true;
        } else if (kind == Kind.RECURRING) {
            // From today, or from the date already reached, whichever is later: paying early
            // lengthens the cover rather than throwing away what is left of it, and a lapsed
            // subscription starts again from today rather than from the date it lapsed, so nobody
            // is charged for the stretch they were not covered for.
            uint64 reached = _paidThrough[productId][msg.sender];
            uint64 from = reached > uint64(block.timestamp) ? reached : uint64(block.timestamp);
            coveredThrough = from + p.period;
            _paidThrough[productId][msg.sender] = coveredThrough;
        }
    }

    /// @dev The one interaction, and the measurement of it. Exactly `price` must ARRIVE at the
    ///      payout wallet: the token's own answer is never taken as proof.
    function _collect(address asset, address payout, uint256 price) private {
        uint256 payoutBefore = IProductERC20(asset).balanceOf(payout);
        _transferFrom(asset, msg.sender, payout, price);
        uint256 payoutAfter = IProductERC20(asset).balanceOf(payout);
        // A token that DEBITS the payout wallet inside its own transfer would underflow here, so
        // that case is refused by name and the diagnosis survives instead of becoming a panic.
        uint256 delivered = payoutAfter < payoutBefore ? 0 : payoutAfter - payoutBefore;
        if (delivered != price) revert DeliveryNotExact(price, delivered);
    }

    /// @dev Split out for one reason: nine event fields plus the sale's own locals do not fit on
    ///      the stack in one frame with the optimizer off, which this repository compiles with.
    ///      The fields are read from storage, which nothing can have changed — the latch is still
    ///      held, so the token had no way to re-enter and edit the product between the sale and
    ///      this line.
    function _emitSold(uint256 productId, bytes32 saleId, uint64 coveredThrough) private {
        Product storage p = _products[productId];
        emit ProductSold(
            productId, msg.sender, p.seller, p.payout, p.asset, p.price, uint8(p.kind), coveredThrough, saleId
        );
    }

    // ---- views ------------------------------------------------------------------------------

    /// @inheritdoc IProductCatalog
    /// @dev Written out rather than left to a public mapping, because Solidity's generated getter
    ///      drops a struct's `string` member and a product without its name is not a product.
    function products(uint256 productId) external view returns (Product memory) {
        return _products[productId];
    }

    /// @inheritdoc IProductCatalog
    function productsOf(address seller) external view returns (uint256[] memory) {
        return _productsOf[seller];
    }

    /// @inheritdoc IProductCatalog
    function paidThrough(uint256 productId, address buyer) external view returns (uint64) {
        return _paidThrough[productId][buyer];
    }

    /// @inheritdoc IProductCatalog
    /// @dev The cover runs UP TO that second and not through it: at exactly the paid-through
    ///      instant it has run out, which is the reading that never claims cover nobody paid for.
    ///      A product nobody subscribed to, and every kind that is not RECURRING, answers false.
    function isPaidUp(uint256 productId, address buyer) external view returns (bool) {
        return _paidThrough[productId][buyer] > uint64(block.timestamp);
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
    ///      measurement in `buy` is what actually proves the money arrived.
    function _transferFrom(address asset, address from, address to, uint256 amount) private {
        (bool ok, bytes memory ret) = asset.call(abi.encodeCall(IProductERC20.transferFrom, (from, to, amount)));
        if (!ok) revert TransferFailed();
        if (ret.length != 0 && (ret.length != 32 || !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
