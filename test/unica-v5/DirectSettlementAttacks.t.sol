// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// TEST ONLY. The local tokens here are uUSD, a local test dollar, and tAST, a local test asset.
// Neither is, and neither is ever labelled as, any real world stablecoin. Every price in the oracle
// rows comes from a settable fixture: it is not authenticated pricing and it carries no value.
//
// WHAT THIS FILE IS FOR. `DirectSettlement.t.sol` proves the settler's own refusals fire. These rows
// go after the properties that live BETWEEN contracts, where each piece can be individually correct
// and the seam between them wrong: who may add an order creator versus who may add a direct settler,
// what a maximum approval exposes, what a settler built on an address with no code will still
// accept, and which legs of a cross route a market's freshness ceiling actually reaches.
//
// Every row states the attacker's position, runs the control that differs from the attack by one
// switch, and then asserts the outcome. A row that only shows a revert is not evidence: it cannot
// tell a live check apart from a fixture that never reached one.

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {DirectSettlement} from "../../src/unica-v5/DirectSettlement.sol";
import {IDirectSettlement} from "../../src/unica-v5/IDirectSettlement.sol";
import {UnicaMarketTypes} from "../../src/unica-v4/UnicaMarketTypes.sol";

import {LocalEnsV2Fixture} from "../../src/identity/LocalEnsV2Fixture.sol";
import {TerminalAdmission} from "../../src/identity/TerminalAdmission.sol";
import {RegistryDouble} from "../identity/util/RegistryDouble.sol";

import {ChainlinkFeedAdapter} from "../../src/unica-v4/oracle/ChainlinkFeedAdapter.sol";
import {FixtureAggregator} from "../unica-v4/fixtures/FixtureAggregator.sol";

contract DirectSettlementAttacksTest is Test {
    MockERC20 internal uusd; // a local test dollar, 6 decimals
    DirectSettlement internal settler;

    /// @dev THE ONE AUTHORITY this file is about. `registryAdmin` is what `TerminalAdmission` asks
    ///      before it will list a direct settler, and it is also what the settler itself asks before
    ///      it will list an order creator, because the settler holds no admin of its own and reads
    ///      `REGISTRY.admin()` live. `strayAdmin` is the account that WOULD have been a second key
    ///      if the settler had kept its own copy; the rows below hold it against the real one.
    address internal registryAdmin = makeAddr("registryAdmin");
    address internal strayAdmin = makeAddr("strayAdmin");
    address internal nextRegistryAdmin = makeAddr("nextRegistryAdmin");

    /// @dev The registry the settler and the gate both answer to. One double, on purpose: the gate
    ///      refuses to list a settler that names a different registry, and that refusal is the
    ///      structural reason there cannot be two keys on this path.
    RegistryDouble internal registryDouble;

    address internal register = makeAddr("register");
    address internal business = makeAddr("business");
    address internal customer = makeAddr("customer");
    address internal attacker = makeAddr("attacker");

    uint128 internal constant AMOUNT = 25_000_000; // 25.00 uUSD
    uint64 internal DEADLINE;

    function setUp() public {
        vm.warp(1_700_000_000);
        DEADLINE = uint64(block.timestamp + 1 days);

        uusd = new MockERC20("Unica test dollar", "uUSD", 6);
        registryDouble = new RegistryDouble();
        registryDouble.setAdmin(registryAdmin);
        settler = new DirectSettlement(address(uusd), address(registryDouble));

        vm.prank(registryAdmin);
        settler.setOrderCreator(register, true);

        uusd.mint(customer, 1_000_000_000);
        vm.prank(customer);
        uusd.approve(address(settler), type(uint256).max);
    }

    // ── S1. a maximum approval is not a drainable balance ───────────────────────────────────────
    //
    // The customer approves the settler for everything they hold, which is what a register's own
    // pay screen asks for. The claim under test is that this exposes nothing: only the bound
    // customer can move the money, and only for a sale that names them.

    function test_S1_maxApprovalIsNotDrainableByAnyoneButTheBoundCustomer() public {
        assertEq(uusd.allowance(customer, address(settler)), type(uint256).max, "the position under test");

        // The attacker is listed as a creator by the one account that can do it, and raises a sale
        // that pays THEM, drawn on the customer's approval. This row grants the attacker the
        // strongest position the contract allows so the approval question is asked on its own.
        vm.prank(registryAdmin);
        settler.setOrderCreator(attacker, true);
        vm.prank(attacker);
        bytes32 rogue = settler.createOrder(attacker, customer, AMOUNT, AMOUNT, DEADLINE, keccak256("rogue"));

        // The attacker cannot pull it. Neither can the settler's own admin.
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IDirectSettlement.WrongPayer.selector, rogue, customer, attacker));
        settler.pay(rogue);

        vm.prank(registryAdmin);
        vm.expectRevert(abi.encodeWithSelector(IDirectSettlement.WrongPayer.selector, rogue, customer, registryAdmin));
        settler.pay(rogue);

        assertEq(uusd.balanceOf(attacker), 0, "no approval was spent");

        // Control: the same sale, from the customer, moves. The switch is the caller and nothing
        // else, so the two refusals above were the payer binding and not some other precondition.
        vm.prank(customer);
        settler.pay(rogue);
        assertEq(uusd.balanceOf(attacker), AMOUNT, "the control proves the sale was otherwise payable");
    }

    // ── S2. the two authorities are one authority ───────────────────────────────────────────────
    //
    // `TerminalAdmission.setDirectSettler` is guarded by `REGISTRY.admin()`, and its note says that
    // this is the same authority that decides who may raise an order at all. These rows are what
    // makes that a measured fact. The settler holds no admin of its own: it reads the SAME
    // registry's `admin()` live, and the gate refuses to list a settler that names a different
    // registry, so there is no second key for a revocation to miss.

    function test_S2_theRegistryAdminIsAlsoTheOnlyAccountThatMayListACreator() public {
        (TerminalAdmission admission,,,, address payoutAddr) = _identityTree();

        vm.prank(registryAdmin);
        admission.setDirectSettler(address(settler), true);
        assertTrue(admission.isDirectSettler(address(settler)));
        assertEq(settler.admin(), registryAdmin, "the very same account, resolved live from the registry");
        assertEq(settler.REGISTRY(), address(registryDouble), "and from the registry the gate itself uses");

        // The account that would have been the settler's own admin under the old shape has no
        // standing here at all, and neither does the attacker.
        vm.prank(strayAdmin);
        vm.expectRevert(abi.encodeWithSelector(DirectSettlement.NotAdmin.selector, strayAdmin));
        settler.setOrderCreator(attacker, true);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(DirectSettlement.NotAdmin.selector, attacker));
        settler.setOrderCreator(attacker, true);
        assertFalse(settler.isOrderCreator(attacker), "nobody but the registry admin can open this door");

        // Suppose the registry admin lists a creator that later turns out to be hostile. THE SAME
        // ACCOUNT that revokes the settler from the gate also revokes the creator, in one place, so
        // the revocation reaches the path the money actually moves on.
        vm.prank(registryAdmin);
        settler.setOrderCreator(attacker, true);
        vm.prank(attacker);
        bytes32 first = settler.createOrder(attacker, customer, AMOUNT, AMOUNT, DEADLINE, keccak256("first"));
        assertEq(
            uint8(settler.orders(first).status), uint8(UnicaMarketTypes.OrderStatus.Open), "the position under test"
        );

        vm.prank(registryAdmin);
        admission.setDirectSettler(address(settler), false);
        vm.prank(registryAdmin);
        settler.setOrderCreator(attacker, false);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IDirectSettlement.NotOrderCreator.selector, attacker));
        settler.createOrder(attacker, customer, AMOUNT, AMOUNT, DEADLINE, keccak256("second"));

        // Control, so the row is not merely describing a settler that refuses everything: the same
        // gate, on the same settler, admits a genuine sale whose record IS written.
        vm.prank(registryAdmin);
        admission.setDirectSettler(address(settler), true);
        vm.prank(registryAdmin);
        settler.setOrderCreator(address(admission), true);
        vm.prank(_operator());
        bytes32 genuine = admission.requestOrder(
            _businessNode,
            _registerNode,
            keccak256("unica-identity-fixture-v1"),
            address(settler),
            payoutAddr,
            customer,
            AMOUNT,
            AMOUNT,
            DEADLINE,
            keccak256("genuine")
        );
        assertEq(admission.admissionOf(genuine).recipientAtAdmission, payoutAddr, "the control writes a record");
    }

    /// @dev The other half of the same seam: the authority IS rotatable, because it is the
    ///      registry's, and a handover there carries the settler with it without any transaction on
    ///      the settler at all. The old holder is refused from that moment on.
    function test_S2b_aRegistryHandoverCarriesTheSettlerWithNoTransactionOnIt() public {
        assertEq(settler.admin(), registryAdmin, "the position under test");

        // The handover happens entirely on the registry. Nothing is called on the settler.
        registryDouble.setAdmin(nextRegistryAdmin);
        assertEq(settler.admin(), nextRegistryAdmin, "the settler followed with no transaction of its own");

        vm.prank(registryAdmin);
        vm.expectRevert(abi.encodeWithSelector(DirectSettlement.NotAdmin.selector, registryAdmin));
        settler.setOrderCreator(attacker, true);
        assertFalse(settler.isOrderCreator(attacker), "the account that used to hold it holds nothing now");

        // Control: the new holder can, so the refusal above is the handover and not a settler that
        // has stopped accepting the call.
        vm.prank(nextRegistryAdmin);
        settler.setOrderCreator(attacker, true);
        assertTrue(settler.isOrderCreator(attacker));

        // And the new holder can also take it back, which is the revocation the old shape could not
        // reach at all once a creator was listed.
        vm.prank(nextRegistryAdmin);
        settler.setOrderCreator(attacker, false);
        assertFalse(settler.isOrderCreator(attacker));
    }

    /// @dev The structural half: a settler that answers to a DIFFERENT registry cannot be listed on
    ///      this gate, which is what stops the two authorities drifting apart again by deployment
    ///      accident rather than by code.
    function test_S2c_theGateRefusesASettlerThatAnswersToAnotherRegistry() public {
        (TerminalAdmission admission,,,,) = _identityTree();

        RegistryDouble otherRegistry = new RegistryDouble();
        otherRegistry.setAdmin(strayAdmin);
        DirectSettlement stray = new DirectSettlement(address(uusd), address(otherRegistry));
        assertEq(stray.admin(), strayAdmin, "a settler with a different key on it");

        vm.prank(registryAdmin);
        vm.expectRevert(
            abi.encodeWithSelector(
                TerminalAdmission.SettlerRegistryMismatch.selector,
                address(stray),
                address(otherRegistry),
                address(registryDouble)
            )
        );
        admission.setDirectSettler(address(stray), true);
        assertFalse(admission.isDirectSettler(address(stray)));

        // An address that cannot answer the question at all is refused by its own name.
        vm.prank(registryAdmin);
        vm.expectRevert(abi.encodeWithSelector(TerminalAdmission.SettlerRegistryUnreadable.selector, address(uusd)));
        admission.setDirectSettler(address(uusd), true);

        // Control: the settler that names THIS registry is listed by the identical call, so the two
        // refusals above are the registry check and not a gate that lists nothing.
        vm.prank(registryAdmin);
        admission.setDirectSettler(address(settler), true);
        assertTrue(admission.isDirectSettler(address(settler)));

        // And removal never runs the check, so a settler that has stopped answering is still
        // revocable. Etching empty code over the listed settler is the cheapest way to prove it.
        vm.etch(address(settler), "");
        vm.prank(registryAdmin);
        admission.setDirectSettler(address(settler), false);
        assertFalse(admission.isDirectSettler(address(settler)), "revocation does not depend on the settler");
    }

    // ── S3. a settler built on an address with no code accepts sales it can never pay ───────────
    //
    // The constructor checks the asset is not the zero address and stops there. The adapter next
    // door refuses a feed with no code by name; this one does not, and the consequence is a settler
    // that a register can raise sales on and a customer can never settle.

    function test_S3_assetWithNoCodeDeploysAndTakesOrdersThatCanNeverSettle() public {
        address hollow = address(0xDEAD); // no code
        assertEq(hollow.code.length, 0, "the position under test");

        DirectSettlement dead = new DirectSettlement(hollow, address(registryDouble));
        vm.prank(registryAdmin);
        dead.setOrderCreator(register, true);

        vm.prank(register);
        bytes32 orderId = dead.createOrder(business, customer, AMOUNT, AMOUNT, DEADLINE, keccak256("hollow"));
        assertEq(uint8(dead.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Open), "the sale was raised");
        assertEq(dead.orderCount(), 1);

        // Every payment attempt fails, and the ASSET is immutable, so nothing can repair it.
        vm.prank(customer);
        vm.expectRevert();
        dead.pay(orderId);

        // Control: the identical construction over a real token settles, so the failure above is
        // the missing code and not something else about this sale.
        DirectSettlement live = new DirectSettlement(address(uusd), address(registryDouble));
        vm.prank(registryAdmin);
        live.setOrderCreator(register, true);
        vm.prank(customer);
        uusd.approve(address(live), type(uint256).max);
        vm.prank(register);
        bytes32 good = live.createOrder(business, customer, AMOUNT, AMOUNT, DEADLINE, keccak256("hollow"));
        vm.prank(customer);
        live.pay(good);
        assertEq(uusd.balanceOf(business), AMOUNT);
    }

    // ── S4. the same salt under two creators is two sales, and neither reaches the other ────────
    //
    // The order id folds in the creator, so a second creator cannot mint an id that lands on an
    // existing sale and move its frozen recipient. This is the redirection attack, and this row is
    // what makes its absence a measured fact rather than a reading of the derivation.

    function test_S4_aSecondCreatorCannotLandOnAnExistingSalesId() public {
        bytes32 salt = keccak256("same-salt");

        vm.prank(register);
        bytes32 first = settler.createOrder(business, customer, AMOUNT, AMOUNT, DEADLINE, salt);

        vm.prank(registryAdmin);
        settler.setOrderCreator(attacker, true);
        vm.prank(attacker);
        bytes32 second = settler.createOrder(attacker, customer, AMOUNT, AMOUNT, DEADLINE, salt);

        assertTrue(first != second, "two creators, two ids");
        assertEq(settler.orders(first).recipient, business, "the first sale's business address is untouched");
        assertEq(settler.orders(second).recipient, attacker);

        // Control: the SAME creator reusing the salt is refused by name, so the ids really are
        // creator-scoped and not merely lucky.
        vm.prank(register);
        vm.expectRevert(abi.encodeWithSelector(DirectSettlement.OrderExists.selector, first));
        settler.createOrder(business, customer, AMOUNT, AMOUNT, DEADLINE, salt);
    }

    // ── S5. admission cannot raise a direct sale that asks to receive a different amount ────────

    function test_S5_admissionCannotRaiseADirectSaleWithMinOutBelowAmountIn() public {
        (TerminalAdmission admission,, bytes32 businessNode, bytes32 registerNode, address payoutAddr) = _identityTree();
        vm.prank(registryAdmin);
        admission.setDirectSettler(address(settler), true);
        vm.prank(registryAdmin);
        settler.setOrderCreator(address(admission), true);

        uint128 short = AMOUNT - 1;
        vm.prank(_operator());
        vm.expectRevert(abi.encodeWithSelector(DirectSettlement.MinOutNotEqualAmountIn.selector, AMOUNT, short));
        admission.requestOrder(
            businessNode,
            registerNode,
            keccak256("unica-identity-fixture-v1"),
            address(settler),
            payoutAddr,
            customer,
            AMOUNT,
            short,
            DEADLINE,
            keccak256("slippage")
        );
        assertEq(settler.orderCount(), 0, "nothing was raised");

        // Control: the identical call with the two amounts equal is admitted, so the refusal above
        // was that one field.
        vm.prank(_operator());
        admission.requestOrder(
            businessNode,
            registerNode,
            keccak256("unica-identity-fixture-v1"),
            address(settler),
            payoutAddr,
            customer,
            AMOUNT,
            AMOUNT,
            DEADLINE,
            keccak256("slippage")
        );
        assertEq(settler.orderCount(), 1);
    }

    // ── O1. which leg the market's freshness ceiling reaches, and what covers the other ────────
    //
    // `updatedAt` is the ASSET leg's publish time alone, so the market's `policy.maxAge` bounds the
    // asset leg and nothing else: the quote leg's age is not in the value the hook receives, and no
    // amount of tightening on the market can change that. This row states that plainly, because the
    // adapter's note once claimed the opposite, and then shows the lever that DOES reach the quote
    // leg during an incident.

    function test_O1_theMarketCeilingReachesTheAssetLegAndTheQuoteLegHasItsOwnLever() public {
        FixtureAggregator assetFeed = new FixtureAggregator(8, "FIXTURE ASSET - not authenticated pricing - no value");
        FixtureAggregator quoteFeed = new FixtureAggregator(8, "FIXTURE QUOTE - not authenticated pricing - no value");

        address incidentOperator = makeAddr("quoteFreshnessOperator");
        uint48 assetMaxAge = 3600;
        uint48 quoteMaxAge = 86_400;
        ChainlinkFeedAdapter adapter = new ChainlinkFeedAdapter(
            address(assetFeed),
            assetMaxAge,
            address(quoteFeed),
            quoteMaxAge,
            address(0xA55E7),
            address(0x9407E),
            address(0),
            0,
            incidentOperator
        );

        // The asset leg published a minute ago. The quote leg published twenty hours ago: legal
        // under its own reviewed bound, and far past what a market tightened to sixty seconds would
        // accept if that ceiling could see it.
        uint256 quoteAge = 72_000;
        assetFeed.set(2000e8, block.timestamp - 60, 1, 1);
        quoteFeed.set(1e8, block.timestamp - quoteAge, 1, 1);

        (uint256 price,, uint256 updatedAt) = adapter.latestPrice(address(0xA55E7), address(0x9407E));
        assertGt(price, 0);
        assertEq(updatedAt, block.timestamp - 60, "the reported age is the asset leg's alone");

        // This is the check the hook runs, spelled out here rather than driven through a whole
        // market, because it is the arithmetic that decides the question.
        uint48 marketMaxAge = 60;
        assertLe(block.timestamp - updatedAt, marketMaxAge, "the market's ceiling passes on the asset leg");
        assertGt(quoteAge, marketMaxAge, "and says nothing about the leg it cannot see");

        // Control: the same adapter, the same market ceiling, with the ASSET leg aged instead. That
        // one the market does catch, which is what makes the reach specific rather than absent.
        assetFeed.set(2000e8, block.timestamp - 600, 2, 2);
        (,, uint256 agedUpdatedAt) = adapter.latestPrice(address(0xA55E7), address(0x9407E));
        assertGt(block.timestamp - agedUpdatedAt, marketMaxAge, "the asset leg is caught by the same ceiling");

        // THE LEVER. The operator tightens the quote bound, and the twenty hour old quote leg that
        // sailed past the market's ceiling is refused by name, on chain, with no redeployment and no
        // new market. The asset leg is republished fresh first so the refusal below can only be the
        // quote leg.
        assetFeed.set(2000e8, block.timestamp - 60, 3, 3);
        vm.prank(incidentOperator);
        adapter.tightenQuoteMaxAge(3600);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkFeedAdapter.FeedStale.selector, address(quoteFeed), block.timestamp - quoteAge, uint48(3600)
            )
        );
        adapter.latestPrice(address(0xA55E7), address(0x9407E));

        // Control on the lever: a quote leg inside the tightened bound prices again, so the refusal
        // is the age and not the tightening having broken the route.
        quoteFeed.set(1e8, block.timestamp - 120, 2, 2);
        (uint256 after_,,) = adapter.latestPrice(address(0xA55E7), address(0x9407E));
        assertGt(after_, 0, "the same adapter, the same route id, still pricing");
    }

    // ── O2. two routes that differ only in sequencer policy share one feed id ───────────────────
    //
    // `feedIdFor` folds in both freshness bounds on the ground that "a freshness policy is part of
    // what a price means". The sequencer feed and its grace period are exactly such a policy: they
    // decide whether a price is refused after an L2 restart, and neither is in the hash.

    function test_O2_feedIdIgnoresTheSequencerPolicy() public {
        FixtureAggregator assetFeed = new FixtureAggregator(8, "FIXTURE ASSET - not authenticated pricing - no value");
        FixtureAggregator quoteFeed = new FixtureAggregator(8, "FIXTURE QUOTE - not authenticated pricing - no value");
        FixtureAggregator sequencer = new FixtureAggregator(0, "FIXTURE sequencer uptime - no value");

        address asset = address(0xA55E7);
        address quote = address(0x9407E);

        ChainlinkFeedAdapter guarded = new ChainlinkFeedAdapter(
            address(assetFeed), 3600, address(quoteFeed), 86_400, asset, quote, address(sequencer), 3600, address(0)
        );
        ChainlinkFeedAdapter unguarded = new ChainlinkFeedAdapter(
            address(assetFeed), 3600, address(quoteFeed), 86_400, asset, quote, address(0), 0, address(0)
        );

        assertEq(
            guarded.feedIdFor(asset, quote),
            unguarded.feedIdFor(asset, quote),
            "one route id for two different refusal policies"
        );

        // And the policies really do differ: the guarded one refuses while the sequencer is down,
        // the unguarded one prices straight through it.
        assetFeed.set(2000e8, block.timestamp - 60, 1, 1);
        quoteFeed.set(1e8, block.timestamp - 60, 1, 1);
        sequencer.set(1, block.timestamp - 10, 1, 1); // 1 means down

        vm.expectRevert(ChainlinkFeedAdapter.SequencerDown.selector);
        guarded.latestPrice(asset, quote);

        (uint256 price,,) = unguarded.latestPrice(asset, quote);
        assertGt(price, 0, "the same two feeds, the same feed id, and no refusal");

        // Control: the guarded adapter with the sequencer up and past its grace period prices too,
        // so the refusal above was the sequencer state and not a broken construction.
        sequencer.set(0, block.timestamp - 7200, 2, 2);
        (uint256 guardedPrice,,) = guarded.latestPrice(asset, quote);
        assertEq(guardedPrice, price, "the same price, once the guard is satisfied");
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────────

    LocalEnsV2Fixture internal _ens;
    bytes32 internal _businessNode;
    bytes32 internal _registerNode;
    address internal _payoutAddr;
    address internal _registerOperator;

    function _operator() internal view returns (address) {
        return _registerOperator;
    }

    /// @dev One business, one register, one live operator key. The same barbershop tree the settler
    ///      suite uses, rebuilt here so these rows do not depend on that file's internals.
    function _identityTree()
        internal
        returns (
            TerminalAdmission admission,
            address operator,
            bytes32 businessNode,
            bytes32 registerNode,
            address payoutAddr
        )
    {
        address owner = makeAddr("businessOwner");
        payoutAddr = makeAddr("businessPayout");
        operator = makeAddr("registerOperator");

        _ens = new LocalEnsV2Fixture();
        bytes32 ethNode = _ens.createRoot("eth");
        bytes32 unicaNode = _ens.register(ethNode, "unica", address(this));
        businessNode = _ens.register(unicaNode, "freshcuts", owner);

        vm.startPrank(owner);
        _ens.setAddr(businessNode, payoutAddr);
        bytes32 registersNode = _ens.register(businessNode, "terminals", owner);
        registerNode = _ens.register(registersNode, "chair-1", owner);
        _ens.authorizeTextRoles(registerNode, "com.unica.terminal-status", operator, true);
        _ens.setText(registerNode, "com.unica.terminal-status", "active");
        vm.stopPrank();

        // The gate is built on the SAME registry double the settler answers to, which is what the
        // gate's own listing check requires and what makes the two surfaces one authority.
        admission = new TerminalAdmission(
            address(_ens),
            address(registryDouble),
            keccak256("unica-identity-fixture-v1"),
            address(0),
            "com.unica.terminal-status"
        );

        _businessNode = businessNode;
        _registerNode = registerNode;
        _payoutAddr = payoutAddr;
        _registerOperator = operator;
    }
}
