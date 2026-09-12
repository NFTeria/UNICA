// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// TEST ONLY. The token here is uUSD, a local test dollar with six decimals. It is not, and is
// never labelled as, any real world stablecoin, and no amount in this file carries value.
//
// WHAT THIS FILE IS FOR. `ProductCatalog.t.sol` proves each of the catalogue's own refusals fires.
// These rows go after the properties that only show up once there is more than one party in the
// room: an attacker holding the strongest position the contract allows, a second catalogue that
// looks exactly like the first, a seller who wants to change the deal after a subscriber has paid,
// and a buyer who wants somebody else's approval to pay for their shopping.
//
// Every row states the attacker's position, runs a control that differs from the attack by one
// switch, and then asserts the outcome. A row that only shows a revert is not evidence: it cannot
// tell a live check apart from a fixture that never reached one.

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {IProductCatalog} from "../../src/unica-v5/IProductCatalog.sol";
import {ProductCatalog} from "../../src/unica-v5/ProductCatalog.sol";

/// @title SelfBuyingAsset, the token that buys the SAME product again from inside the sale
/// @notice The cross-product reentry is covered in `ProductCatalog.t.sol`. This one goes at the
///         narrower case a one-off would care about most: a second purchase of the very product
///         being paid for, from inside its own transfer, before the first sale has finished.
contract SelfBuyingAsset is MockERC20 {
    address public catalog;
    uint256 public productId;
    bool public armed;
    bool public entered;
    bytes public lastError;
    bool public reentrantCallSucceeded;

    constructor(string memory n, string memory s, uint8 d) MockERC20(n, s, d) {}

    function arm(address catalog_, uint256 productId_) external {
        catalog = catalog_;
        productId = productId_;
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
            try IProductCatalog(catalog).buy(productId) {
                reentrantCallSucceeded = true;
            } catch (bytes memory err) {
                lastError = err;
            }
        }
        return true;
    }
}

contract ProductCatalogAttacksTest is Test {
    MockERC20 internal uusd;
    ProductCatalog internal catalog;

    address internal business = makeAddr("business");
    address internal payoutWallet = makeAddr("payoutWallet");
    address internal customer = makeAddr("customer");
    address internal subscriber = makeAddr("subscriber");
    address internal attacker = makeAddr("attacker");

    uint256 internal constant PRICE = 25_000_000; // 25.00 uUSD
    uint256 internal constant SUBSCRIPTION = 40_000_000; // 40.00 uUSD
    uint64 internal constant MONTH = 30 days;

    function setUp() public {
        vm.warp(1_700_000_000);
        uusd = new MockERC20("Unica test dollar", "uUSD", 6);
        catalog = new ProductCatalog();
        for (uint256 i = 0; i < 3; i++) {
            address who = [customer, subscriber, attacker][i];
            uusd.mint(who, 10_000_000_000);
            vm.prank(who);
            uusd.approve(address(catalog), type(uint256).max);
        }
    }

    function _listPermanent(address seller, uint256 price, address payout) internal returns (uint256 id) {
        vm.prank(seller);
        id = catalog.list("Haircut", address(uusd), price, IProductCatalog.Kind.PERMANENT, 0, payout, address(0));
    }

    // ── S1. a maximum approval is not a drainable balance ───────────────────────────────────────
    //
    // Every customer of this catalogue approves it for everything they hold, because that is what
    // one tap on a shop screen does. The claim under test is that this exposes nothing: the money
    // only ever moves from the account that called `buy`, and there is no argument, no listing and
    // no role that changes who that is.

    function test_S1_maxApprovalIsNotDrainableByAnybodyButTheBuyer() public {
        assertEq(uusd.allowance(customer, address(catalog)), type(uint256).max, "the position under test");
        uint256 victimHolds = uusd.balanceOf(customer);
        address attackerWallet = makeAddr("attackerWallet");

        // The attacker takes the strongest position the contract allows: they are a seller in their
        // own right, they set the price to the victim's whole balance, and they point the payout at
        // a wallet of their own. There is no argument left for them to reach the victim with.
        uint256 rogue = _listPermanent(attacker, victimHolds, attackerWallet);

        vm.prank(attacker);
        catalog.buy(rogue);

        assertEq(uusd.balanceOf(customer), victimHolds, "not one unit of the victim's approval was spent");
        // Control: the sale really did go through, so the row above is about WHOSE money moves and
        // not about a sale that failed for some unrelated reason.
        assertEq(catalog.salesCount(), 1);
        assertEq(uusd.balanceOf(attackerWallet), victimHolds, "the attacker paid themselves, with their own money");
        assertEq(uusd.balanceOf(attacker), 0, "which is the whole of what the listing let them do");
    }

    // ── S1b. buying from yourself into your own wallet moves nothing, and is refused ────────────

    function test_S1b_payingYourOwnWalletIsRefused() public {
        uint256 id = _listPermanent(attacker, PRICE, attacker);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(ProductCatalog.PayingYourself.selector, id, attacker));
        catalog.buy(id);
        assertEq(catalog.salesCount(), 0, "a sale in which nothing moved is not a sale");

        // control: anybody else buying the very same product pays it in full.
        vm.prank(customer);
        catalog.buy(id);
        assertEq(catalog.salesCount(), 1);
        assertEq(uusd.balanceOf(attacker), 10_000_000_000 + PRICE);
    }

    // ── S2. a seller controls their own products and nothing else ───────────────────────────────

    function test_S2_aSellerCannotTouchAnotherSellersListing() public {
        uint256 mine = _listPermanent(business, PRICE, payoutWallet);

        // The attacker becomes a seller in their own right first, so the row is not "a stranger is
        // refused" but the sharper "a seller with a listing of their own is still refused here".
        uint256 theirs = _listPermanent(attacker, PRICE, attacker);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IProductCatalog.NotSeller.selector, mine, business, attacker));
        catalog.setActive(mine, false);
        assertTrue(catalog.products(mine).active, "the other business is still selling");

        // control: the same call on their OWN listing works, so the refusal above was the owner
        // check and nothing else.
        vm.prank(attacker);
        catalog.setActive(theirs, false);
        assertFalse(catalog.products(theirs).active);

        // And listing cannot be done on somebody's behalf: the seller is always the caller, so a
        // listing an attacker makes names the attacker, and its money goes to the attacker.
        assertEq(catalog.products(theirs).seller, attacker);
        assertEq(catalog.products(theirs).payout, attacker);
        assertEq(catalog.productsOf(business).length, 1, "nothing was added to the other business's list");
    }

    // ── S3. a one-off promised to one person cannot be taken by whoever saw it first ────────────

    function test_S3_theBoundBuyerCannotBeFrontRun() public {
        vm.prank(business);
        uint256 id = catalog.list(
            "Quote 118 for Ana", address(uusd), PRICE, IProductCatalog.Kind.ONE_OFF, 0, payoutWallet, customer
        );

        // The attacker sees the listing in the same block and tries to take it first, with money
        // and an approval in place, so nothing but the binding can stop them.
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IProductCatalog.WrongBuyer.selector, id, customer, attacker));
        catalog.buy(id);
        assertEq(uusd.balanceOf(payoutWallet), 0);
        assertFalse(catalog.products(id).sold, "still waiting for the person it was written for");

        // control: the person it was written for buys it, in the same conditions.
        vm.prank(customer);
        catalog.buy(id);
        assertEq(uusd.balanceOf(payoutWallet), PRICE);
    }

    // ── S4. a subscriber's deal cannot be changed under them, and cannot be erased ──────────────
    //
    // The seller has exactly one power over a listing — whether it is on sale — and this row is
    // what makes that a measured fact rather than a claim in a comment. It exercises that power in
    // both directions and then reads back everything a subscriber could care about.

    function test_S4_theSellersOnlyPowerCannotReachASubscribersTerms() public {
        vm.prank(business);
        uint256 id = catalog.list(
            "Monthly membership",
            address(uusd),
            SUBSCRIPTION,
            IProductCatalog.Kind.RECURRING,
            MONTH,
            payoutWallet,
            address(0)
        );

        vm.prank(subscriber);
        catalog.buy(id);
        uint64 coveredTo = catalog.paidThrough(id, subscriber);
        IProductCatalog.Product memory agreed = catalog.products(id);
        assertTrue(catalog.isPaidUp(id, subscriber));

        // The seller stops selling it. That is everything they can do.
        vm.prank(business);
        catalog.setActive(id, false);

        assertEq(catalog.paidThrough(id, subscriber), coveredTo, "the date already paid for is untouched");
        assertTrue(catalog.isPaidUp(id, subscriber), "and the subscriber is still covered");
        IProductCatalog.Product memory nowP = catalog.products(id);
        assertEq(nowP.price, agreed.price, "the price cannot move");
        assertEq(nowP.period, agreed.period, "nor the length of a period");
        assertEq(nowP.asset, agreed.asset, "nor what it is paid in");
        assertEq(nowP.name, agreed.name, "nor what it is called");
        assertEq(nowP.payout, agreed.payout, "nor where the money goes");

        // What a stopped listing DOES do: no new payment for it. The refusal is the seller's one
        // power working, not a subscriber losing something they paid for.
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(IProductCatalog.ProductInactive.selector, id));
        catalog.buy(id);

        // control: put it back on sale and the next period is bought on the same terms.
        vm.prank(business);
        catalog.setActive(id, true);
        vm.prank(subscriber);
        catalog.buy(id);
        assertEq(catalog.paidThrough(id, subscriber), coveredTo + MONTH, "extended by exactly one agreed period");
    }

    // ── S5. a one-off that has been sold stays sold, whatever the seller does afterwards ────────

    function test_S5_takingASoldOneOffOffSaleAndBackDoesNotResurrectIt() public {
        vm.prank(business);
        uint256 id = catalog.list(
            "The chair in the window", address(uusd), PRICE, IProductCatalog.Kind.ONE_OFF, 0, payoutWallet, address(0)
        );
        vm.prank(customer);
        catalog.buy(id);

        vm.startPrank(business);
        catalog.setActive(id, false);
        catalog.setActive(id, true);
        vm.stopPrank();

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IProductCatalog.AlreadySold.selector, id));
        catalog.buy(id);
        assertEq(uusd.balanceOf(payoutWallet), PRICE, "paid once, and once only");

        // control: the seller lists the chair's twin and that one sells, so the refusal above was
        // "this one is gone" and not "this seller can no longer sell".
        vm.prank(business);
        uint256 twin = catalog.list(
            "The other chair", address(uusd), PRICE, IProductCatalog.Kind.ONE_OFF, 0, payoutWallet, address(0)
        );
        vm.prank(attacker);
        catalog.buy(twin);
        assertEq(uusd.balanceOf(payoutWallet), PRICE * 2);
    }

    // ── S6. a look-alike catalogue: identical shape, different address ──────────────────────────
    //
    // Anyone can deploy this same source and sell the same named product at the same price to the
    // same buyer, and the sale event they emit has the SAME topic and the same fields. Nothing on
    // the chain distinguishes the two but the address the log came from, which is why the evidence
    // reader's rule is "the emitter must be the catalogue the deployment named" and why that rule
    // is the only thing standing between a shopper and a counterfeit shopfront. This row measures
    // the indistinguishability so that the rule is answering a real question; the refusal itself is
    // asserted in `tools/unica-evidence/test/authenticate-product.test.mjs`, where the reader lives.

    function test_S6_aLookalikeCatalogueIsIdenticalExceptForItsAddress() public {
        ProductCatalog counterfeit = new ProductCatalog();
        vm.prank(customer);
        uusd.approve(address(counterfeit), type(uint256).max);

        vm.prank(business);
        uint256 real =
            catalog.list("Haircut", address(uusd), PRICE, IProductCatalog.Kind.PERMANENT, 0, payoutWallet, address(0));
        vm.prank(attacker);
        uint256 fake = counterfeit.list(
            "Haircut", address(uusd), PRICE, IProductCatalog.Kind.PERMANENT, 0, payoutWallet, address(0)
        );
        assertEq(real, fake, "the same product number, on both");

        vm.recordLogs();
        vm.prank(customer);
        catalog.buy(real);
        vm.prank(customer);
        counterfeit.buy(fake);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        Vm.Log memory a = _soldLogFrom(logs, address(catalog));
        Vm.Log memory b = _soldLogFrom(logs, address(counterfeit));
        assertEq(a.topics[0], b.topics[0], "the same event signature");
        assertEq(a.topics[1], b.topics[1], "the same product number");
        assertEq(a.topics[2], b.topics[2], "the same buyer");
        assertEq(a.data.length, 6 * 32, "six data words: payout, asset, amount, kind, paidThrough, saleId");
        // The first five say the same thing on both: where the money went, what it was, how much,
        // what kind of product and what date it covered.
        for (uint256 w = 0; w < 5; w++) {
            assertEq(_word(a.data, w), _word(b.data, w), "a field a shopper can see differs");
        }
        assertTrue(a.emitter != b.emitter, "the address is what tells them apart");

        // Two fields DO differ, and neither is one a shopper can check on its own. The seller topic
        // names the counterfeit's own lister, which only helps somebody who already knows which
        // address the real shop sells from...
        assertTrue(a.topics[3] != b.topics[3], "the seller topic differs");

        // ...and the sale id commits to the address of the catalogue that made the sale, which is
        // only usable by a reader that recomputes it from an address it already trusts. Both are
        // therefore the same act as checking the emitter, which is why the emitter is the rule the
        // evidence layer states. What the shopper's own receipt shows — the wallet paid, the asset,
        // the amount, the kind and the date — is identical on both.
        assertTrue(_word(a.data, 5) != _word(b.data, 5), "the sale id commits to the catalogue's address");
        assertTrue(catalog.CATALOG_ID() != counterfeit.CATALOG_ID(), "two catalogues, two ids");
        assertEq(catalog.CATALOG_ID(), keccak256(abi.encode(block.chainid, address(catalog))));
    }

    function _word(bytes memory data, uint256 index) internal pure returns (bytes32 out) {
        uint256 at = 32 + index * 32;
        assembly ("memory-safe") {
            out := mload(add(data, at))
        }
    }

    function _soldLogFrom(Vm.Log[] memory logs, address emitter) internal pure returns (Vm.Log memory found) {
        bytes32 topic0 = keccak256("ProductSold(uint256,address,address,address,address,uint256,uint8,uint64,bytes32)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == emitter && logs[i].topics.length > 0 && logs[i].topics[0] == topic0) {
                return logs[i];
            }
        }
        revert("no sale log from that address");
    }

    // ── S7. buying the same product again from inside its own sale is refused by the latch ──────

    function test_S7_reentryIntoTheSameProductIsRefused() public {
        SelfBuyingAsset token = new SelfBuyingAsset("Self", "SELF", 6);
        ProductCatalog c = new ProductCatalog();
        token.mint(customer, 10_000_000_000);
        vm.prank(customer);
        token.approve(address(c), type(uint256).max);
        token.mint(address(token), 10_000_000_000);
        vm.prank(address(token));
        token.approve(address(c), type(uint256).max);

        vm.prank(business);
        uint256 id = c.list(
            "The chair in the window", address(token), PRICE, IProductCatalog.Kind.ONE_OFF, 0, payoutWallet, address(0)
        );

        token.arm(address(c), id);
        vm.prank(customer);
        c.buy(id);

        assertFalse(token.reentrantCallSucceeded(), "the re-entrant purchase must not succeed");
        assertEq(
            token.lastError(),
            abi.encodeWithSelector(ProductCatalog.Reentered.selector),
            "the latch by name, not AlreadySold, which would have hidden a missing latch"
        );
        assertEq(c.salesCount(), 1, "one sale, one payment");
        assertEq(token.balanceOf(payoutWallet), PRICE);
    }

    // ── S8. the catalogue holds nothing, and a token sent to it by mistake changes no answer ────

    function test_S8_theCatalogueNeverHoldsTheMoneyAndAStrandedBalanceChangesNothing() public {
        uint256 id = _listPermanent(business, PRICE, payoutWallet);
        vm.prank(customer);
        catalog.buy(id);
        assertEq(uusd.balanceOf(address(catalog)), 0, "the money went straight past it");

        // Somebody sends the catalogue money by mistake. There is no sweep, no rescue and no admin,
        // so it is stranded — and, more to the point here, it changes nothing about the next sale,
        // because delivery is measured on the PAYOUT wallet and never on this contract.
        vm.prank(attacker);
        uusd.transfer(address(catalog), 1_000_000);
        uint256 payoutBefore = uusd.balanceOf(payoutWallet);

        vm.prank(customer);
        catalog.buy(id);
        assertEq(uusd.balanceOf(payoutWallet) - payoutBefore, PRICE, "still exactly the price, no more and no less");
        assertEq(uusd.balanceOf(address(catalog)), 1_000_000, "the stranded amount is still stranded");
    }

    // ── S9. one buyer's payment never moves another buyer's date ────────────────────────────────

    function test_S9_aSubscribersDateIsTheirsAlone() public {
        vm.prank(business);
        uint256 id = catalog.list(
            "Monthly membership",
            address(uusd),
            SUBSCRIPTION,
            IProductCatalog.Kind.RECURRING,
            MONTH,
            payoutWallet,
            address(0)
        );

        vm.prank(subscriber);
        catalog.buy(id);
        uint64 theirs = catalog.paidThrough(id, subscriber);

        // The attacker pays for the same subscription many times over, which is allowed and which
        // buys THEM cover. It must not buy the subscriber a single second.
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(attacker);
            catalog.buy(id);
        }
        assertEq(catalog.paidThrough(id, subscriber), theirs, "unmoved by somebody else's four payments");
        assertEq(
            catalog.paidThrough(id, attacker),
            uint64(block.timestamp) + 4 * MONTH,
            "control: the attacker's own date did move"
        );
        assertEq(uusd.balanceOf(payoutWallet), SUBSCRIPTION * 5, "and the business was paid for every one of them");
    }
}
