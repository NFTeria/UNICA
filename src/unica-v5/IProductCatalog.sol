// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title IProductCatalog — a business lists what it sells, by name, and is paid for it (UNICA v5)
/// @notice Three shapes cover what a small business actually sells, and they are the only three:
///
///           ONE_OFF     one sale and then it is gone — a chair, a repair, an appointment slot.
///                       It may be bound to one named buyer, which is how a quote becomes an
///                       invoice: nobody else can take it.
///           RECURRING   a period the buyer keeps paying for. Each payment moves the date they
///                       are PAID THROUGH forward by exactly one period, from today or from the
///                       date they had already reached, whichever is later, so paying early
///                       lengthens the cover instead of wasting it.
///           PERMANENT   the thing on the shelf. Anyone buys it, any number of times, forever.
///
///         SAME ASSET ONLY. The buyer pays the asset the product names and the business's payout
///         wallet receives exactly the price, in the same transaction. There is no conversion here
///         and no price feed: a listing that needs one belongs on the market path, not in this
///         catalogue. The arrival is measured as a balance change on the payout wallet, so a token
///         that skims a fee is refused and nothing moves at all.
///
///         NOBODY IS IN CHARGE OF THIS CONTRACT. There is no owner, no admin, no pauser and no
///         upgrade path. A seller controls their own products and nothing else; no account,
///         including the deployer, can list on someone's behalf, take a listing down, move a
///         payment, or change what a buyer already agreed to.
interface IProductCatalog {
    /// @notice What kind of thing is being sold. Fixed at listing; see `ProductListed`.
    enum Kind {
        ONE_OFF,
        RECURRING,
        PERMANENT
    }

    /// @param seller    the account that listed it. The only account that may deactivate it.
    /// @param payout    where the money arrives. Defaults to the seller when the listing left it
    ///                  empty, so the simple case needs no second address.
    /// @param asset     the one asset this product is priced and paid in.
    /// @param price     exactly what the buyer pays and the payout wallet receives, in that
    ///                  asset's own base units.
    /// @param kind      ONE_OFF, RECURRING or PERMANENT.
    /// @param period    seconds one payment covers. Non-zero for RECURRING and zero for the other
    ///                  two, checked at listing rather than ignored.
    /// @param onlyBuyer the one account allowed to buy, when the listing named one. Only a ONE_OFF
    ///                  may carry it. `address(0)` means anyone.
    /// @param active    whether the seller is currently selling it.
    /// @param sold      a ONE_OFF that has been bought. Never set for the other two kinds.
    /// @param name      what the business calls it, as the business typed it. 1 to 64 bytes.
    struct Product {
        address seller;
        address payout;
        address asset;
        uint256 price;
        Kind kind;
        uint64 period;
        address onlyBuyer;
        bool active;
        bool sold;
        string name;
    }

    /// @notice A product exists from here on, on these terms, and the terms never move again.
    event ProductListed(
        uint256 indexed productId,
        address indexed seller,
        address asset,
        uint256 price,
        Kind kind,
        uint64 period,
        address payout,
        address onlyBuyer,
        string name
    );

    /// @notice The seller started or stopped selling it. The only thing about a listing that moves.
    event ProductActivity(uint256 indexed productId, address indexed seller, bool active);

    /// @notice One sale. `kind` is the product's kind as a plain number so a reader does not need
    ///         this file's enum to make sense of it. `paidThrough` is the date the buyer is now
    ///         covered to for a RECURRING product, and zero for the other two kinds, which cover
    ///         nothing over time. `saleId` is
    ///         `keccak256(abi.encode(chainId, catalogue, productId, buyer, salesCount))`, unique
    ///         across every sale this catalogue has ever made, so the same buyer buying the same
    ///         permanent product twice produces two different ids.
    event ProductSold(
        uint256 indexed productId,
        address indexed buyer,
        address indexed seller,
        address payout,
        address asset,
        uint256 amount,
        uint8 kind,
        uint64 paidThrough,
        bytes32 saleId
    );

    // ---- refusals a caller has to handle ---------------------------------------------------------

    error UnknownProduct(uint256 productId);
    error NotSeller(uint256 productId, address seller, address who);
    error ProductInactive(uint256 productId);
    error AlreadySold(uint256 productId);
    error WrongBuyer(uint256 productId, address expected, address actual);
    /// @notice The payout wallet's balance did not rise by exactly the price. A fee-on-transfer or
    ///         rebasing token lands here, and the whole sale is undone.
    error DeliveryNotExact(uint256 expected, uint256 delivered);
    error TransferFailed();

    /// @notice List something for sale. `msg.sender` becomes the seller.
    /// @param payout    where the money should arrive; `address(0)` means the seller's own address.
    /// @param onlyBuyer the one account allowed to buy it; `address(0)` means anyone. Only a
    ///                  ONE_OFF may name one.
    /// @return productId the new product's id, counting from 1.
    function list(
        string calldata name,
        address asset,
        uint256 price,
        Kind kind,
        uint64 period,
        address payout,
        address onlyBuyer
    ) external returns (uint256 productId);

    /// @notice Start or stop selling one of your own products.
    function setActive(uint256 productId, bool active) external;

    /// @notice Buy it: exactly `price` of the product's asset moves from you to the payout wallet.
    /// @return saleId the id this sale is recorded under in `ProductSold`.
    function buy(uint256 productId) external returns (bytes32 saleId);

    function products(uint256 productId) external view returns (Product memory);
    function productCount() external view returns (uint256);
    function productsOf(address seller) external view returns (uint256[] memory);
    /// @notice The date this buyer's cover of a RECURRING product runs to. Zero for anything else.
    function paidThrough(uint256 productId, address buyer) external view returns (uint64);
    /// @notice Whether that date is still ahead of now.
    function isPaidUp(uint256 productId, address buyer) external view returns (bool);
    /// @notice A stable id for evidence: `keccak256(abi.encode(chainId, address(this)))`.
    function CATALOG_ID() external view returns (bytes32);
    /// @notice How many sales this catalogue has ever made. Part of every `saleId`.
    function salesCount() external view returns (uint256);
}
