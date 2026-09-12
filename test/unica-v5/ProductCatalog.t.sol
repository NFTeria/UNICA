// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// TEST ONLY. The token here is uUSD, a local test dollar with six decimals. It is not, and is
// never labelled as, any real world stablecoin, and no amount in this file carries value.

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {IProductCatalog} from "../../src/unica-v5/IProductCatalog.sol";
import {ProductCatalog} from "../../src/unica-v5/ProductCatalog.sol";

/// @title SkimmingAsset, the token that hands the seller less than the buyer paid
/// @notice A catalogue sale is one `transferFrom` from the buyer straight to the payout wallet, so
///         the fee-on-transfer hazard has to be shaped around `transferFrom` rather than around
///         `transfer`. Armed per row, so the control and the refusal differ by one switch and
///         nothing else.
contract SkimmingAsset is MockERC20 {
    uint256 public feeBps;

    constructor(string memory n, string memory s, uint8 d) MockERC20(n, s, d) {}

    function arm(uint256 bps) external {
        feeBps = bps;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        uint256 fee = (amount * feeBps) / 10_000;
        balanceOf[from] -= amount;
        unchecked {
            balanceOf[to] += amount - fee;
            balanceOf[address(0xdead)] += fee;
        }
        return true;
    }
}

/// @title OverCreditingAsset, the token that hands the seller more than the buyer paid
/// @notice A surplus is not a gift: it means the number on the receipt is not the number that
///         moved, so the sale is refused on exactly the same measurement that catches a shortfall.
contract OverCreditingAsset is MockERC20 {
    address public target;
    uint256 public units;

    constructor(string memory n, string memory s, uint8 d) MockERC20(n, s, d) {}

    function arm(address target_, uint256 units_) external {
        target = target_;
        units = units_;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        bool ok = super.transferFrom(from, to, amount);
        if (target != address(0) && units != 0) {
            totalSupply += units;
            unchecked {
                balanceOf[target] += units;
            }
        }
        return ok;
    }
}

/// @title RefusingAsset, the token that says no by answering `false` instead of reverting
contract RefusingAsset is MockERC20 {
    constructor(string memory n, string memory s, uint8 d) MockERC20(n, s, d) {}

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}

/// @title ReenteringBuyerAsset, the token that buys a second product from inside the first sale
/// @notice The refusal is caught and recorded rather than bubbled, so the row can assert the latch
///         BY NAME. A row that only showed the outer sale reverting could not tell the latch apart
///         from any other disagreement further down.
contract ReenteringBuyerAsset is MockERC20 {
    address public catalog;
    uint256 public secondProductId;
    bool public armed;
    bool public entered;
    bytes public lastError;
    bool public reentrantCallSucceeded;

    constructor(string memory n, string memory s, uint8 d) MockERC20(n, s, d) {}

    function arm(address catalog_, uint256 secondProductId_) external {
        catalog = catalog_;
        secondProductId = secondProductId_;
        armed = true;
        entered = false;
        delete lastError;
        reentrantCallSucceeded = false;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        unchecked {
            balanceOf[to] += amount;
        }
        if (armed && !entered) {
            entered = true;
            try IProductCatalog(catalog).buy(secondProductId) {
                reentrantCallSucceeded = true;
            } catch (bytes memory err) {
                lastError = err;
            }
        }
        return true;
    }
}

/// @title ProductCatalogTest
/// @notice A business lists what it sells, by name, in one of three shapes, and a customer pays
///         exactly the price into exactly the payout wallet, in one transaction, in the asset the
///         product names. Every row below is one way that sentence could be false. Every refusal
///         is asserted by its exact error and arguments, and every refusal has a control beside it
///         that differs by one switch, because a row that only shows a revert cannot tell a live
///         check apart from a fixture that never reached one.
contract ProductCatalogTest is Test {
    MockERC20 internal uusd; // a local test dollar, 6 decimals
    ProductCatalog internal catalog;

    address internal business = makeAddr("business");
    address internal payoutWallet = makeAddr("payoutWallet");
    address internal customer = makeAddr("customer");
    address internal secondCustomer = makeAddr("secondCustomer");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant HAIRCUT_PRICE = 25_000_000; // 25.00 uUSD
    uint256 internal constant MEMBERSHIP_PRICE = 40_000_000; // 40.00 uUSD
    uint64 internal constant MONTH = 30 days;

    function setUp() public {
        vm.warp(1_700_000_000);
        uusd = new MockERC20("Unica test dollar", "uUSD", 6);
        catalog = new ProductCatalog();

        for (uint256 i = 0; i < 3; i++) {
            address who = [customer, secondCustomer, stranger][i];
            uusd.mint(who, 10_000_000_000);
            vm.prank(who);
            uusd.approve(address(catalog), type(uint256).max);
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    function _listPermanent(string memory name, uint256 price) internal returns (uint256 id) {
        vm.prank(business);
        id = catalog.list(name, address(uusd), price, IProductCatalog.Kind.PERMANENT, 0, payoutWallet, address(0));
    }

    function _listOneOff(string memory name, uint256 price, address onlyBuyer) internal returns (uint256 id) {
        vm.prank(business);
        id = catalog.list(name, address(uusd), price, IProductCatalog.Kind.ONE_OFF, 0, payoutWallet, onlyBuyer);
    }

    function _listRecurring(string memory name, uint256 price, uint64 period) internal returns (uint256 id) {
        vm.prank(business);
        id = catalog.list(name, address(uusd), price, IProductCatalog.Kind.RECURRING, period, payoutWallet, address(0));
    }

    /// @dev Derived here from the documented expression rather than read back from the catalogue,
    ///      so a row proves the derivation and not merely that the contract agrees with itself.
    function _expectedSaleId(uint256 productId, address buyer, uint256 salesCountBefore)
        internal
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(catalog), productId, buyer, salesCountBefore));
    }

    /// @dev A fresh catalogue over a hostile token, with the buyers funded and approving, so a
    ///      hostile row runs against the same shape as every other row.
    function _catalogFor(address token) internal returns (ProductCatalog c) {
        c = new ProductCatalog();
        MockERC20(token).mint(customer, 10_000_000_000);
        vm.prank(customer);
        MockERC20(token).approve(address(c), type(uint256).max);
    }

    // ── 1. control: a permanent product is listed and bought, and what the two events say ───────

    function test_ListAndBuyPermanent_EventsAndBalances() public {
        vm.expectEmit(true, true, true, true, address(catalog));
        emit IProductCatalog.ProductListed(
            1,
            business,
            address(uusd),
            HAIRCUT_PRICE,
            IProductCatalog.Kind.PERMANENT,
            0,
            payoutWallet,
            address(0),
            "Haircut"
        );
        uint256 id = _listPermanent("Haircut", HAIRCUT_PRICE);
        assertEq(id, 1, "ids count from 1");
        assertEq(catalog.productCount(), 1);

        IProductCatalog.Product memory p = catalog.products(id);
        assertEq(p.seller, business);
        assertEq(p.payout, payoutWallet);
        assertEq(p.asset, address(uusd));
        assertEq(p.price, HAIRCUT_PRICE);
        assertEq(uint8(p.kind), uint8(IProductCatalog.Kind.PERMANENT));
        assertEq(p.period, 0);
        assertEq(p.onlyBuyer, address(0));
        assertTrue(p.active, "a new listing is on sale");
        assertFalse(p.sold);
        assertEq(p.name, "Haircut", "the business's own words for it");

        bytes32 expected = _expectedSaleId(id, customer, 0);
        uint256 customerBefore = uusd.balanceOf(customer);

        vm.expectEmit(true, true, true, true, address(catalog));
        emit IProductCatalog.ProductSold(
            id, customer, business, payoutWallet, address(uusd), HAIRCUT_PRICE, 2, 0, expected
        );
        vm.prank(customer);
        bytes32 saleId = catalog.buy(id);

        assertEq(saleId, expected, "the sale id must match the documented derivation");
        assertEq(uusd.balanceOf(payoutWallet), HAIRCUT_PRICE, "the business receives exactly the price");
        assertEq(uusd.balanceOf(customer), customerBefore - HAIRCUT_PRICE, "the customer pays exactly the price");
        assertEq(uusd.balanceOf(address(catalog)), 0, "the catalogue never holds the money");
        assertEq(catalog.salesCount(), 1);
        assertFalse(catalog.products(id).sold, "a permanent product is never used up");
    }

    // ── 2. a listing must name something, and the name has a length ─────────────────────────────

    function test_NameRules_Refused() public {
        vm.prank(business);
        vm.expectRevert(ProductCatalog.NameEmpty.selector);
        catalog.list("", address(uusd), HAIRCUT_PRICE, IProductCatalog.Kind.PERMANENT, 0, payoutWallet, address(0));

        string memory tooLong = new string(65);
        vm.prank(business);
        vm.expectRevert(abi.encodeWithSelector(ProductCatalog.NameTooLong.selector, 65));
        catalog.list(tooLong, address(uusd), HAIRCUT_PRICE, IProductCatalog.Kind.PERMANENT, 0, payoutWallet, address(0));
        assertEq(catalog.productCount(), 0, "nothing was listed");

        // control: the longest name that IS allowed is allowed
        string memory exactly64 = new string(64);
        vm.prank(business);
        uint256 id = catalog.list(
            exactly64, address(uusd), HAIRCUT_PRICE, IProductCatalog.Kind.PERMANENT, 0, payoutWallet, address(0)
        );
        assertEq(bytes(catalog.products(id).name).length, 64);
    }

    // ── 3. a price of nothing, and an asset that is not a contract ──────────────────────────────

    function test_ZeroPriceAndAssetWithoutCode_Refused() public {
        vm.prank(business);
        vm.expectRevert(ProductCatalog.ZeroPrice.selector);
        catalog.list("Haircut", address(uusd), 0, IProductCatalog.Kind.PERMANENT, 0, payoutWallet, address(0));

        address notAToken = makeAddr("not a token");
        vm.prank(business);
        vm.expectRevert(abi.encodeWithSelector(ProductCatalog.AssetNoCode.selector, notAToken));
        catalog.list("Haircut", notAToken, HAIRCUT_PRICE, IProductCatalog.Kind.PERMANENT, 0, payoutWallet, address(0));
        assertEq(catalog.productCount(), 0);

        // control: the same listing with a price and a real token
        assertEq(_listPermanent("Haircut", HAIRCUT_PRICE), 1);
    }

    // ── 4. the period belongs to the recurring kind and to no other ─────────────────────────────

    function test_PeriodRules_Refused() public {
        vm.prank(business);
        vm.expectRevert(ProductCatalog.PeriodRequired.selector);
        catalog.list(
            "Monthly membership",
            address(uusd),
            MEMBERSHIP_PRICE,
            IProductCatalog.Kind.RECURRING,
            0,
            payoutWallet,
            address(0)
        );

        vm.prank(business);
        vm.expectRevert(
            abi.encodeWithSelector(ProductCatalog.PeriodTooLong.selector, uint64(3650 days) + 1, catalog.MAX_PERIOD())
        );
        catalog.list(
            "Monthly membership",
            address(uusd),
            MEMBERSHIP_PRICE,
            IProductCatalog.Kind.RECURRING,
            uint64(3650 days) + 1,
            payoutWallet,
            address(0)
        );

        vm.prank(business);
        vm.expectRevert(
            abi.encodeWithSelector(ProductCatalog.PeriodNotAllowed.selector, uint8(IProductCatalog.Kind.ONE_OFF), MONTH)
        );
        catalog.list(
            "Haircut", address(uusd), HAIRCUT_PRICE, IProductCatalog.Kind.ONE_OFF, MONTH, payoutWallet, address(0)
        );

        vm.prank(business);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProductCatalog.PeriodNotAllowed.selector, uint8(IProductCatalog.Kind.PERMANENT), MONTH
            )
        );
        catalog.list(
            "Haircut", address(uusd), HAIRCUT_PRICE, IProductCatalog.Kind.PERMANENT, MONTH, payoutWallet, address(0)
        );
        assertEq(catalog.productCount(), 0, "not one of the four was listed");

        // controls: a recurring product WITH a period, and a permanent one WITHOUT one
        assertEq(_listRecurring("Monthly membership", MEMBERSHIP_PRICE, MONTH), 1);
        assertEq(_listPermanent("Haircut", HAIRCUT_PRICE), 2);
        assertEq(catalog.products(1).period, MONTH);
        assertEq(catalog.products(2).period, 0);
    }

    // ── 5. only a one-off can be promised to one named person ───────────────────────────────────

    function test_BuyerBinding_OnlyOnOneOff() public {
        vm.prank(business);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProductCatalog.BuyerBindingNotAllowed.selector, uint8(IProductCatalog.Kind.RECURRING), customer
            )
        );
        catalog.list(
            "Monthly membership",
            address(uusd),
            MEMBERSHIP_PRICE,
            IProductCatalog.Kind.RECURRING,
            MONTH,
            payoutWallet,
            customer
        );

        vm.prank(business);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProductCatalog.BuyerBindingNotAllowed.selector, uint8(IProductCatalog.Kind.PERMANENT), customer
            )
        );
        catalog.list("Haircut", address(uusd), HAIRCUT_PRICE, IProductCatalog.Kind.PERMANENT, 0, payoutWallet, customer);
        assertEq(catalog.productCount(), 0);

        // control: the identical binding on a one-off is admitted
        uint256 id = _listOneOff("Wedding party booking", HAIRCUT_PRICE, customer);
        assertEq(catalog.products(id).onlyBuyer, customer);
    }

    // ── 6. the payout wallet: empty means the seller, and two addresses are refused ─────────────

    function test_PayoutDefaultsToSeller_AndReservedAddressesRefused() public {
        vm.prank(business);
        uint256 id = catalog.list(
            "Haircut", address(uusd), HAIRCUT_PRICE, IProductCatalog.Kind.PERMANENT, 0, address(0), address(0)
        );
        assertEq(catalog.products(id).payout, business, "an empty payout means the seller's own address");

        vm.prank(business);
        vm.expectRevert(abi.encodeWithSelector(ProductCatalog.ReservedPayout.selector, address(catalog)));
        catalog.list(
            "Haircut", address(uusd), HAIRCUT_PRICE, IProductCatalog.Kind.PERMANENT, 0, address(catalog), address(0)
        );

        vm.prank(business);
        vm.expectRevert(abi.encodeWithSelector(ProductCatalog.ReservedPayout.selector, address(uusd)));
        catalog.list(
            "Haircut", address(uusd), HAIRCUT_PRICE, IProductCatalog.Kind.PERMANENT, 0, address(uusd), address(0)
        );

        // control: the money really does go to the seller on the product that defaulted
        vm.prank(customer);
        catalog.buy(id);
        assertEq(uusd.balanceOf(business), HAIRCUT_PRICE);
    }

    // ── 7. a one-off sells once ─────────────────────────────────────────────────────────────────

    function test_OneOff_SellsOnce() public {
        uint256 id = _listOneOff("The chair in the window", HAIRCUT_PRICE, address(0));

        vm.prank(customer);
        catalog.buy(id);
        assertTrue(catalog.products(id).sold);
        assertEq(uusd.balanceOf(payoutWallet), HAIRCUT_PRICE);

        vm.prank(secondCustomer);
        vm.expectRevert(abi.encodeWithSelector(IProductCatalog.AlreadySold.selector, id));
        catalog.buy(id);

        // even the buyer who bought it cannot buy it twice
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(IProductCatalog.AlreadySold.selector, id));
        catalog.buy(id);
        assertEq(uusd.balanceOf(payoutWallet), HAIRCUT_PRICE, "the business is paid once, not three times");

        // control: a second, identical one-off still sells to the customer who was refused above
        uint256 other = _listOneOff("The other chair", HAIRCUT_PRICE, address(0));
        vm.prank(secondCustomer);
        catalog.buy(other);
        assertEq(uusd.balanceOf(payoutWallet), HAIRCUT_PRICE * 2);
    }

    // ── 8. a one-off promised to one person is not for sale to anyone else ──────────────────────

    function test_OneOff_BoundBuyer() public {
        uint256 id = _listOneOff("Quote 118 for Ana", HAIRCUT_PRICE, customer);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IProductCatalog.WrongBuyer.selector, id, customer, stranger));
        catalog.buy(id);
        assertEq(uusd.balanceOf(payoutWallet), 0, "nothing moved on a refused sale");
        assertFalse(catalog.products(id).sold, "and it is still for sale to the person it was for");

        // control: the person it was for buys the very same product
        vm.prank(customer);
        catalog.buy(id);
        assertEq(uusd.balanceOf(payoutWallet), HAIRCUT_PRICE);
    }

    // ── 9. a subscription moves the paid-through date, from today or from the date reached ──────

    function test_Recurring_PaidThroughExtendsFromTheLaterOfTheTwo() public {
        uint256 id = _listRecurring("Monthly membership", MEMBERSHIP_PRICE, MONTH);
        assertEq(catalog.paidThrough(id, customer), 0, "nobody has paid yet");
        assertFalse(catalog.isPaidUp(id, customer));

        uint64 start = uint64(block.timestamp);
        vm.prank(customer);
        catalog.buy(id);
        assertEq(catalog.paidThrough(id, customer), start + MONTH, "one period from today");
        assertTrue(catalog.isPaidUp(id, customer));

        // paying EARLY, ten days in, adds a whole period to the date already reached — it does not
        // throw away the twenty days that were left.
        vm.warp(block.timestamp + 10 days);
        vm.prank(customer);
        catalog.buy(id);
        assertEq(catalog.paidThrough(id, customer), start + 2 * MONTH, "extended from the date reached, not from today");

        // letting it LAPSE and paying again starts from today, so nobody is charged for the stretch
        // they were not covered for.
        vm.warp(start + 2 * MONTH + 5 days);
        assertFalse(catalog.isPaidUp(id, customer), "the cover has run out");
        uint64 restart = uint64(block.timestamp);
        vm.prank(customer);
        catalog.buy(id);
        assertEq(catalog.paidThrough(id, customer), restart + MONTH, "one period from today, not from the lapsed date");

        // the boundary itself: covered up to that second, and not through it
        vm.warp(restart + MONTH - 1);
        assertTrue(catalog.isPaidUp(id, customer));
        vm.warp(restart + MONTH);
        assertFalse(catalog.isPaidUp(id, customer), "at the paid-through instant the cover has run out");

        // one subscriber's date is theirs alone
        assertEq(catalog.paidThrough(id, secondCustomer), 0);
        assertFalse(catalog.isPaidUp(id, secondCustomer));
        assertEq(uusd.balanceOf(payoutWallet), MEMBERSHIP_PRICE * 3, "three periods, three payments");
    }

    // ── 10. a permanent product is bought by many people, many times ────────────────────────────

    function test_Permanent_BoughtByManyManyTimes() public {
        uint256 id = _listPermanent("Haircut", HAIRCUT_PRICE);
        bytes32[] memory ids = new bytes32[](5);
        uint256 n = 0;
        for (uint256 round = 0; round < 2; round++) {
            for (uint256 i = 0; i < 2; i++) {
                address who = i == 0 ? customer : secondCustomer;
                vm.prank(who);
                ids[n] = catalog.buy(id);
                n++;
            }
        }
        vm.prank(stranger);
        ids[4] = catalog.buy(id);

        assertEq(catalog.salesCount(), 5);
        assertEq(uusd.balanceOf(payoutWallet), HAIRCUT_PRICE * 5);
        assertFalse(catalog.products(id).sold, "a permanent product is never used up");
        assertEq(catalog.paidThrough(id, customer), 0, "a permanent product covers no stretch of time");

        // Five sales, five different ids, even where the same person bought the same thing twice.
        for (uint256 i = 0; i < 5; i++) {
            for (uint256 j = i + 1; j < 5; j++) {
                assertTrue(ids[i] != ids[j], "two sales must never share an id");
            }
        }
    }

    // ── 11. only the seller starts and stops the selling, and a stopped product is not for sale ─

    function test_SetActive_SellerOnly_AndInactiveRefusesBuyers() public {
        uint256 id = _listPermanent("Haircut", HAIRCUT_PRICE);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IProductCatalog.NotSeller.selector, id, business, stranger));
        catalog.setActive(id, false);
        // not even the buyer of it
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(IProductCatalog.NotSeller.selector, id, business, customer));
        catalog.setActive(id, false);
        assertTrue(catalog.products(id).active);

        vm.expectEmit(true, true, true, true, address(catalog));
        emit IProductCatalog.ProductActivity(id, business, false);
        vm.prank(business);
        catalog.setActive(id, false);

        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(IProductCatalog.ProductInactive.selector, id));
        catalog.buy(id);
        assertEq(uusd.balanceOf(payoutWallet), 0);

        // control: the seller puts it back on sale and the same customer buys it
        vm.prank(business);
        catalog.setActive(id, true);
        vm.prank(customer);
        catalog.buy(id);
        assertEq(uusd.balanceOf(payoutWallet), HAIRCUT_PRICE);
    }

    // ── 12. an id nobody listed ─────────────────────────────────────────────────────────────────

    function test_UnknownProduct_Refused() public {
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(IProductCatalog.UnknownProduct.selector, uint256(7)));
        catalog.buy(7);

        vm.prank(business);
        vm.expectRevert(abi.encodeWithSelector(IProductCatalog.UnknownProduct.selector, uint256(0)));
        catalog.setActive(0, true);
    }

    // ── 13. the terms never move after the listing ──────────────────────────────────────────────

    function test_TermsAreFrozenAtListing() public {
        uint256 id = _listRecurring("Monthly membership", MEMBERSHIP_PRICE, MONTH);
        IProductCatalog.Product memory before = catalog.products(id);

        vm.prank(customer);
        catalog.buy(id);
        vm.prank(business);
        catalog.setActive(id, false);
        vm.prank(business);
        catalog.setActive(id, true);
        vm.warp(block.timestamp + 400 days);
        vm.prank(secondCustomer);
        catalog.buy(id);

        IProductCatalog.Product memory nowP = catalog.products(id);
        assertEq(nowP.seller, before.seller);
        assertEq(nowP.payout, before.payout);
        assertEq(nowP.asset, before.asset);
        assertEq(nowP.price, before.price, "a subscriber's price cannot move under them");
        assertEq(uint8(nowP.kind), uint8(before.kind));
        assertEq(nowP.period, before.period, "nor the length of what one payment buys");
        assertEq(nowP.onlyBuyer, before.onlyBuyer);
        assertEq(nowP.name, before.name, "nor what the thing is called");
    }

    // ── 14. a token that skims a fee is refused, and nothing is delivered ───────────────────────

    function test_FeeOnTransfer_Refused_NothingDelivered() public {
        SkimmingAsset token = new SkimmingAsset("Skim", "SKIM", 6);
        ProductCatalog c = _catalogFor(address(token));

        vm.prank(business);
        uint256 id = c.list(
            "Haircut", address(token), HAIRCUT_PRICE, IProductCatalog.Kind.PERMANENT, 0, payoutWallet, address(0)
        );

        // control, with the skim off: the sale settles and the business is paid in full.
        vm.prank(customer);
        c.buy(id);
        assertEq(token.balanceOf(payoutWallet), HAIRCUT_PRICE, "control: the whole price arrives");

        // the one switch: a 1% fee taken out of the very same transfer.
        token.arm(100);
        uint256 businessBefore = token.balanceOf(payoutWallet);
        uint256 customerBefore = token.balanceOf(customer);
        uint256 delivered = HAIRCUT_PRICE - (HAIRCUT_PRICE * 100) / 10_000;

        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(IProductCatalog.DeliveryNotExact.selector, HAIRCUT_PRICE, delivered));
        c.buy(id);

        assertEq(token.balanceOf(payoutWallet), businessBefore, "nothing is delivered");
        assertEq(token.balanceOf(customer), customerBefore, "and nothing is taken");
        assertEq(c.salesCount(), 1, "the refused sale was never counted");
    }

    // ── 15. a token that over-delivers is refused too ───────────────────────────────────────────

    function test_SurplusDelivery_Refused() public {
        OverCreditingAsset token = new OverCreditingAsset("Credit", "CRD", 6);
        ProductCatalog c = _catalogFor(address(token));

        vm.prank(business);
        uint256 id = c.list(
            "Haircut", address(token), HAIRCUT_PRICE, IProductCatalog.Kind.PERMANENT, 0, payoutWallet, address(0)
        );

        vm.prank(customer);
        c.buy(id);
        assertEq(token.balanceOf(payoutWallet), HAIRCUT_PRICE, "control: exactly the price arrives");

        token.arm(payoutWallet, 7);
        vm.prank(customer);
        vm.expectRevert(
            abi.encodeWithSelector(IProductCatalog.DeliveryNotExact.selector, HAIRCUT_PRICE, HAIRCUT_PRICE + 7)
        );
        c.buy(id);
        assertEq(token.balanceOf(payoutWallet), HAIRCUT_PRICE, "the surplus never lands");
    }

    // ── 16. a token that answers `false` is a refusal, not a success ────────────────────────────

    function test_TokenAnsweringFalse_Refused() public {
        RefusingAsset token = new RefusingAsset("False", "FLS", 6);
        ProductCatalog c = _catalogFor(address(token));

        vm.prank(business);
        uint256 id = c.list(
            "Haircut", address(token), HAIRCUT_PRICE, IProductCatalog.Kind.PERMANENT, 0, payoutWallet, address(0)
        );
        vm.prank(customer);
        vm.expectRevert(IProductCatalog.TransferFailed.selector);
        c.buy(id);
        assertEq(token.balanceOf(payoutWallet), 0);
        assertEq(c.salesCount(), 0);
    }

    // ── 17. a token that buys a second product from inside the first sale is refused by the latch ─

    function test_ReentrantToken_Refused() public {
        ReenteringBuyerAsset token = new ReenteringBuyerAsset("Reenter", "REEN", 6);
        ProductCatalog c = _catalogFor(address(token));

        // The second product is funded and approved from the token's own account, so that nothing
        // BUT the latch can refuse it. A reentry that some other precondition would have caught
        // anyway proves nothing about the latch.
        token.mint(address(token), 10_000_000_000);
        vm.prank(address(token));
        token.approve(address(c), type(uint256).max);

        vm.startPrank(business);
        uint256 first = c.list(
            "Haircut", address(token), HAIRCUT_PRICE, IProductCatalog.Kind.PERMANENT, 0, payoutWallet, address(0)
        );
        uint256 second = c.list(
            "Beard trim", address(token), HAIRCUT_PRICE, IProductCatalog.Kind.PERMANENT, 0, payoutWallet, address(0)
        );
        vm.stopPrank();

        token.arm(address(c), second);
        vm.prank(customer);
        c.buy(first);

        assertFalse(token.reentrantCallSucceeded(), "the re-entrant purchase must not succeed");
        assertEq(
            token.lastError(),
            abi.encodeWithSelector(ProductCatalog.Reentered.selector),
            "the latch, by name, not some later disagreement"
        );
        assertEq(c.salesCount(), 1, "one sale happened, not two");
        assertEq(token.balanceOf(payoutWallet), HAIRCUT_PRICE);
    }

    // ── 18. the views: what a business has listed, and the catalogue's own id ───────────────────

    function test_Views_ProductsOfAndCatalogId() public {
        uint256 a = _listPermanent("Haircut", HAIRCUT_PRICE);
        uint256 b = _listRecurring("Monthly membership", MEMBERSHIP_PRICE, MONTH);
        vm.prank(stranger);
        uint256 elsewhere =
            catalog.list("Something else", address(uusd), 1, IProductCatalog.Kind.PERMANENT, 0, address(0), address(0));

        uint256[] memory mine = catalog.productsOf(business);
        assertEq(mine.length, 2);
        assertEq(mine[0], a);
        assertEq(mine[1], b);
        assertEq(catalog.productsOf(stranger).length, 1);
        assertEq(catalog.productsOf(stranger)[0], elsewhere);
        assertEq(catalog.productsOf(customer).length, 0, "somebody who has listed nothing has nothing");
        assertEq(catalog.productCount(), 3);

        assertEq(
            catalog.CATALOG_ID(),
            keccak256(abi.encode(block.chainid, address(catalog))),
            "the id must match the documented derivation"
        );
        ProductCatalog other = new ProductCatalog();
        assertTrue(other.CATALOG_ID() != catalog.CATALOG_ID(), "two catalogues, two ids");
    }

    // ── 19. any price a business can name is paid exactly ───────────────────────────────────────

    function testFuzz_AnyPriceIsPaidExactly(uint256 price) public {
        price = bound(price, 1, type(uint128).max);
        uint256 id = _listPermanent("Haircut", price);
        uusd.mint(customer, price);
        uint256 payoutBefore = uusd.balanceOf(payoutWallet);
        uint256 customerBefore = uusd.balanceOf(customer);

        vm.prank(customer);
        catalog.buy(id);

        assertEq(uusd.balanceOf(payoutWallet) - payoutBefore, price, "exactly the price arrives");
        assertEq(customerBefore - uusd.balanceOf(customer), price, "and exactly the price is taken");
    }

    // ── 20. any period a business can name moves the date by exactly that much ──────────────────

    function testFuzz_AnyPeriodExtendsByExactlyThatMuch(uint64 period, uint32 waitFor) public {
        period = uint64(bound(period, 1, catalog.MAX_PERIOD()));
        uint256 id = _listRecurring("Monthly membership", MEMBERSHIP_PRICE, period);

        uint64 start = uint64(block.timestamp);
        vm.prank(customer);
        catalog.buy(id);
        assertEq(catalog.paidThrough(id, customer), start + period);

        vm.warp(uint256(start) + uint256(waitFor));
        uint64 reached = catalog.paidThrough(id, customer);
        uint64 from = reached > uint64(block.timestamp) ? reached : uint64(block.timestamp);
        vm.prank(customer);
        catalog.buy(id);
        assertEq(
            catalog.paidThrough(id, customer),
            from + period,
            "one more period from today or from the date reached, whichever is later"
        );
    }
}
