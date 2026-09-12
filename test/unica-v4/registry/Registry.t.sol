// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {UnicaMarketTypes} from "../../../src/unica-v4/UnicaMarketTypes.sol";
import {UnicaMarketRegistry} from "../../../src/unica-v4/UnicaMarketRegistry.sol";
import {IUnicaOracleRoute} from "../../../src/unica-v4/interfaces/IUnicaPriceOracle.sol";

/// @notice A route with a settable answer and no price. The registry only ever asks an adapter one
///         question — "what feed do you serve for this pair?" — so this is the whole surface row O4
///         and row R7 need, and it is defined here rather than shared so a change to another
///         builder's mock cannot silently change what these rows assert.
contract RouteStub is IUnicaOracleRoute {
    bytes32 public answer;
    bool public reverting;

    error RouteStubRefuses();

    constructor(bytes32 answer_) {
        answer = answer_;
    }

    function setAnswer(bytes32 answer_) external {
        answer = answer_;
    }

    function setReverting(bool value) external {
        reverting = value;
    }

    function feedIdFor(address, address) external view returns (bytes32) {
        if (reverting) revert RouteStubRefuses();
        return answer;
    }

    function adapterKind() external pure returns (bytes32) {
        return keccak256("ROUTE_STUB");
    }
}

/// @title Registry rows R1-R11 and the oracle-policy rows O1-O10
/// @notice Written from `docs/unica-v4/SPEC-CONTRACTS.md` §5, §6, §13, `EVENT-SCHEMA.md` §4 and
///         `TEST-MATRIX.md`. THE TEST CONTRACT IS THE FACTORY: `UnicaMarketRegistry`'s constructor
///         records `msg.sender` as `FACTORY`, so constructing it here is what gives these rows the
///         factory's rights without a factory in the picture. That is deliberate — the registry's
///         own refusals are what is under test, and a real factory in front of them would mean a
///         failure here could be either contract's.
///
///         EVERY NEGATIVE ROW HAS ITS CONTROL IN THE SAME FUNCTION. A revert assertion on its own
///         proves nothing: a call that reverts for the wrong reason, or a fixture that never
///         reached the check, looks identical to a working guard. So each row does the failing thing
///         and then the succeeding thing that differs from it in exactly one way.
contract RegistryTest is Test {
    UnicaMarketRegistry internal registry;

    address internal admin = makeAddr("admin");
    address internal pauserKey = makeAddr("pauser");
    address internal stranger = makeAddr("stranger");

    RouteStub internal route;
    bytes32 internal constant FEED_ID = keccak256("FEED/ONE");
    bytes32 internal constant OTHER_FEED_ID = keccak256("FEED/TWO");

    uint128 internal constant CAP_TX = 10_000_000;
    uint128 internal constant CAP_DAY = 25_000_000;
    uint128 internal constant CAP_SEED = 100_000_000;

    uint256 internal nonce;

    // ---- events, redeclared so a change to the registry's signatures fails HERE ------------------

    event MarketProposed(
        bytes32 indexed marketId,
        address indexed asset,
        address indexed payout,
        uint32 version,
        address hook,
        address executor,
        bytes32 poolId,
        uint24 fee,
        int24 tickSpacing,
        uint256 rateE18,
        uint160 initSqrtPriceX96,
        int24 initTick,
        bool demonstrationOnly
    );
    event MarketStatusChanged(bytes32 indexed marketId, uint8 indexed from, uint8 indexed to);
    event MarketSeeded(bytes32 indexed marketId, uint128 depthAtOpeningTick);
    event OraclePolicySet(
        bytes32 indexed marketId, address adapter, bytes32 feedId, uint48 maxAge, uint16 maxDeviationBps, bool enabled
    );
    event CapsSet(bytes32 indexed marketId, uint128 maxPerTx, uint128 maxPerDay, uint128 maxSeed);
    event OrderCreatorSet(address indexed creator, bool allowed);
    event PauserSet(address indexed previousPauser, address indexed newPauser);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    function setUp() public {
        registry = new UnicaMarketRegistry(admin, false);
        route = new RouteStub(FEED_ID);
    }

    // ---- R1: construction --------------------------------------------------------------------------

    function test_R1_constructorRecordsAdminFactoryAndRequireOracle() public {
        assertEq(registry.admin(), admin, "admin is the constructor argument");
        assertEq(registry.FACTORY(), address(this), "FACTORY is whoever constructed it");
        assertEq(registry.REQUIRE_ORACLE(), false, "REQUIRE_ORACLE is as passed");

        UnicaMarketRegistry strict = new UnicaMarketRegistry(admin, true);
        assertEq(strict.REQUIRE_ORACLE(), true, "the other value survives too");
        assertEq(strict.FACTORY(), address(this), "and FACTORY is still the caller");
    }

    function test_R1_zeroAdminIsRefused() public {
        vm.expectRevert(UnicaMarketRegistry.ZeroAddress.selector);
        new UnicaMarketRegistry(address(0), false);

        // Control, differing in exactly one way: a non-zero admin constructs.
        UnicaMarketRegistry ok = new UnicaMarketRegistry(address(1), false);
        assertEq(ok.admin(), address(1), "a non-zero admin is taken");
    }

    function test_R1_constantsAreTheSpecCeilings() public view {
        assertEq(registry.MAX_ORACLE_AGE(), 300, "MAX_ORACLE_AGE");
        assertEq(registry.MAX_DEVIATION_BPS(), 300, "MAX_DEVIATION_BPS");
    }

    // ---- R2: only the factory registers and records ---------------------------------------------------

    function test_R2_registerAndRecordsRefuseEveryoneButTheFactory() public {
        (bytes32 id, UnicaMarketTypes.Market memory m) = _draft();

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.NotFactory.selector, admin));
        registry.register(id, m, _demoPolicy(), _caps());

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.NotFactory.selector, stranger));
        registry.register(id, m, _demoPolicy(), _caps());

        // Control: the factory — this contract — makes the same three calls and they land.
        registry.register(id, m, _demoPolicy(), _caps());
        assertEq(registry.statusOf(id), uint8(UnicaMarketTypes.MarketStatus.PROPOSED), "PROPOSED after register");

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.NotFactory.selector, admin));
        registry.recordInitialized(id);
        registry.recordInitialized(id);
        assertEq(registry.statusOf(id), uint8(UnicaMarketTypes.MarketStatus.INITIALIZED), "INITIALIZED");

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.NotFactory.selector, stranger));
        registry.recordSeeded(id, 1e18);
        registry.recordSeeded(id, 1e18);
        assertEq(registry.statusOf(id), uint8(UnicaMarketTypes.MarketStatus.SEEDED), "SEEDED");
        assertEq(registry.getMarket(id).seedDepth, 1e18, "seedDepth stored");
    }

    // ---- R3, R3b: the admin-only and pauser surfaces ----------------------------------------------------

    function test_R3_adminOnlyCallsRefuseStrangerAndPauser() public {
        bytes32 id = _liveMarket();
        vm.prank(admin);
        registry.setPauser(pauserKey);

        address[2] memory outsiders = [stranger, pauserKey];
        for (uint256 i; i < outsiders.length; ++i) {
            address who = outsiders[i];
            bytes memory notAdmin = abi.encodeWithSelector(UnicaMarketRegistry.NotAdmin.selector, who);

            vm.prank(who);
            vm.expectRevert(notAdmin);
            registry.activate(id);
            vm.prank(who);
            vm.expectRevert(notAdmin);
            registry.unpause(id);
            vm.prank(who);
            vm.expectRevert(notAdmin);
            registry.retire(id);
            vm.prank(who);
            vm.expectRevert(notAdmin);
            registry.tightenOraclePolicy(id, 100, 100);
            vm.prank(who);
            vm.expectRevert(notAdmin);
            registry.tightenCaps(id, 1, 1);
            vm.prank(who);
            vm.expectRevert(notAdmin);
            registry.setOrderCreator(who, true);
            vm.prank(who);
            vm.expectRevert(notAdmin);
            registry.setPauser(who);
            vm.prank(who);
            vm.expectRevert(notAdmin);
            registry.transferAdmin(who);
        }

        // Control: the admin makes each of the calls that are legal in this state and they land.
        vm.startPrank(admin);
        registry.setOrderCreator(stranger, true);
        assertTrue(registry.isOrderCreator(stranger), "allowlisted");
        registry.setPauser(pauserKey);
        registry.tightenCaps(id, CAP_TX - 1, CAP_DAY);
        registry.activate(id);
        assertEq(registry.statusOf(id), uint8(UnicaMarketTypes.MarketStatus.ACTIVE), "ACTIVE");
        registry.retire(id);
        vm.stopPrank();
        assertEq(registry.statusOf(id), uint8(UnicaMarketTypes.MarketStatus.RETIRED), "RETIRED");
    }

    function test_R3b_pauserPausesAndNothingElse() public {
        bytes32 id = _activeMarket();
        vm.prank(admin);
        registry.setPauser(pauserKey);

        vm.prank(pauserKey);
        registry.pause(id);
        assertEq(registry.statusOf(id), uint8(UnicaMarketTypes.MarketStatus.PAUSED), "the pauser can pause");

        vm.prank(pauserKey);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.NotAdmin.selector, pauserKey));
        registry.unpause(id);
        vm.prank(pauserKey);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.NotAdmin.selector, pauserKey));
        registry.retire(id);

        // A second pause reverts, so a watcher that acted on ACTIVE knows its pause is the one that
        // landed rather than one of several.
        vm.prank(pauserKey);
        vm.expectRevert(
            abi.encodeWithSelector(
                UnicaMarketRegistry.WrongMarketStatus.selector, id, uint8(UnicaMarketTypes.MarketStatus.PAUSED)
            )
        );
        registry.pause(id);

        // Control: ADMIN unpauses, and ADMIN can also pause directly (ruling S2).
        vm.prank(admin);
        registry.unpause(id);
        assertEq(registry.statusOf(id), uint8(UnicaMarketTypes.MarketStatus.ACTIVE), "ADMIN unpauses");
        vm.prank(admin);
        registry.pause(id);
        assertEq(registry.statusOf(id), uint8(UnicaMarketTypes.MarketStatus.PAUSED), "ADMIN pauses too");

        // A stranger is neither, and gets the pauser refusal rather than nothing.
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.NotPauser.selector, stranger));
        registry.pause(id);
    }

    // ---- R4: all 49 status pairs -----------------------------------------------------------------------

    /// @notice Every (from, to) over the seven stored values. Only SC §5's eleven edges succeed; the
    ///         rest revert. The legality table is written out here as data, so the row proves the
    ///         registry against a statement of the specification rather than against itself.
    function test_R4_allFortyNineStatusPairs() public {
        uint256 legal;
        uint256 refused;
        for (uint8 from; from < 7; ++from) {
            for (uint8 to; to < 7; ++to) {
                bool expected = _edgeIsLegal(from, to);
                bool moved = _attemptEdge(from, to);
                assertEq(moved, expected, string.concat("edge ", vm.toString(from), "->", vm.toString(to)));
                if (moved) ++legal;
                else ++refused;
            }
        }
        assertEq(legal, 11, "SC 5 names exactly eleven legal edges");
        assertEq(legal + refused, 49, "49 pairs walked");
    }

    function test_R4_retiredIsTerminal() public {
        bytes32 id = _marketInState(6);
        uint8 retired = uint8(UnicaMarketTypes.MarketStatus.RETIRED);
        bytes memory wrong = abi.encodeWithSelector(UnicaMarketRegistry.WrongMarketStatus.selector, id, retired);

        vm.startPrank(admin);
        vm.expectRevert(wrong);
        registry.activate(id);
        vm.expectRevert(wrong);
        registry.unpause(id);
        vm.expectRevert(wrong);
        registry.pause(id);
        vm.expectRevert(wrong);
        registry.retire(id);
        vm.stopPrank();

        // Control: a market that is not retired still moves.
        bytes32 live = _marketInState(3);
        vm.prank(admin);
        registry.activate(live);
        assertEq(registry.statusOf(live), 4, "a SEEDED market still activates");
    }

    function test_R4_unknownMarketIsNotWrongStatus() public {
        bytes32 ghost = keccak256("never registered");
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.UnknownMarket.selector, ghost));
        registry.activate(ghost);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.UnknownMarket.selector, ghost));
        registry.retire(ghost);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.UnknownMarket.selector, ghost));
        registry.tightenCaps(ghost, 1, 1);
        vm.stopPrank();

        // Control: a registered id in the same call is a status question, not an identity one.
        bytes32 id = _marketInState(1);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.WrongMarketStatus.selector, id, uint8(1)));
        registry.activate(id);
    }

    // ---- R5: the two-step admin transfer -----------------------------------------------------------------

    function test_R5_twoStepTransfer() public {
        address next = makeAddr("nextAdmin");

        vm.prank(admin);
        vm.expectRevert(UnicaMarketRegistry.ZeroAddress.selector);
        registry.transferAdmin(address(0));

        vm.prank(admin);
        registry.transferAdmin(next);
        assertEq(registry.pendingAdmin(), next, "pending recorded");

        // The pending admin has no power at all before accepting.
        vm.prank(next);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.NotAdmin.selector, next));
        registry.setPauser(next);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.NotPendingAdmin.selector, stranger));
        registry.acceptAdmin();

        // The old admin keeps every power until the moment it is accepted.
        assertTrue(registry.canCreateOrders(admin), "old admin is implicitly a creator");
        vm.prank(admin);
        registry.setPauser(pauserKey);

        vm.prank(next);
        registry.acceptAdmin();
        assertEq(registry.admin(), next, "admin moved");
        assertEq(registry.pendingAdmin(), address(0), "pending cleared");

        // And loses all of them after, the implicit order-creator right included.
        assertFalse(registry.canCreateOrders(admin), "the old admin is no longer implicitly a creator");
        assertTrue(registry.canCreateOrders(next), "the new one is");
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.NotAdmin.selector, admin));
        registry.setPauser(admin);

        // Control: the new admin can do what the old one just could not.
        vm.prank(next);
        registry.setPauser(admin);
        assertEq(registry.pauser(), admin, "the new admin sets the pauser");
    }

    // ---- R6: pagination ---------------------------------------------------------------------------------

    function test_R6_paginationEmptyClampAndOrder() public {
        assertEq(registry.marketCount(), 0, "starts empty");
        assertEq(registry.getMarkets(0, 10).length, 0, "empty list pages to nothing");

        bytes32 first = _marketInState(1);
        assertEq(registry.marketCount(), 1, "one market");
        bytes32[] memory one = registry.getMarkets(0, 10);
        assertEq(one.length, 1, "clamped to the list");
        assertEq(one[0], first, "and it is the one registered");
        assertEq(registry.getMarkets(1, 10).length, 0, "an offset at the end returns empty");
        assertEq(registry.getMarkets(99, 10).length, 0, "an offset past the end returns empty");

        bytes32[] memory expected = new bytes32[](250);
        expected[0] = first;
        for (uint256 i = 1; i < 250; ++i) {
            expected[i] = _marketInState(1);
        }
        assertEq(registry.marketCount(), 250, "250 markets");

        bytes32[] memory capped = registry.getMarkets(0, 250);
        assertEq(capped.length, 100, "limit is capped at PAGE_LIMIT");
        bytes32[] memory page101 = registry.getMarkets(100, 100);
        assertEq(page101.length, 100, "the second full page");
        bytes32[] memory tail = registry.getMarkets(200, 100);
        assertEq(tail.length, 50, "the last page is clamped to the list");

        for (uint256 i; i < 100; ++i) {
            assertEq(capped[i], expected[i], "registration order, page 1");
            assertEq(page101[i], expected[100 + i], "registration order, page 2");
        }
        for (uint256 i; i < 50; ++i) {
            assertEq(tail[i], expected[200 + i], "registration order, page 3");
            assertEq(registry.marketIdAt(200 + i), expected[200 + i], "marketIdAt agrees");
        }

        // Retired markets stay in the list.
        vm.prank(admin);
        registry.retire(first);
        assertEq(registry.marketCount(), 250, "retiring removes nothing");
        assertEq(registry.getMarkets(0, 1)[0], first, "the retired market still pages");
    }

    // ---- R7: the id is the route ---------------------------------------------------------------------------

    function test_R7_marketIdDiffersAcrossChainVersionAdapterAndFeed() public {
        address asset = _addr("asset");
        address payout = _addr("payout");

        bytes32 base = _computeId(asset, payout, 1, address(route), FEED_ID);
        assertTrue(base != _computeId(asset, payout, 2, address(route), FEED_ID), "version changes the id");
        assertTrue(base != _computeId(asset, payout, 1, address(0), FEED_ID), "adapter changes the id");
        assertTrue(base != _computeId(asset, payout, 1, address(route), OTHER_FEED_ID), "feedId changes the id");

        uint256 original = block.chainid;
        vm.chainId(original + 1);
        bytes32 elsewhere = _computeId(asset, payout, 1, address(route), FEED_ID);
        vm.chainId(original);
        assertTrue(base != elsewhere, "the chain id changes the id");

        // A demonstration market's id carries zeros for both route fields.
        assertEq(
            _computeId(asset, payout, 1, address(0), bytes32(0)),
            keccak256(abi.encode(block.chainid, address(registry), asset, payout, uint32(1), address(0), bytes32(0))),
            "demonstration id is the zero-route id"
        );
    }

    function test_R7_registerRefusesAnIdItDidNotComputeAndAFeedTheRouteDoesNotServe() public {
        (bytes32 id, UnicaMarketTypes.Market memory m) = _draft();
        bytes32 wrongId = keccak256("a plausible looking id");

        bytes32 expectedForWrong = keccak256(
            abi.encode(block.chainid, address(registry), m.asset, m.payout, m.version, address(0), bytes32(0))
        );
        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketRegistry.MarketIdMismatch.selector, expectedForWrong, wrongId)
        );
        registry.register(wrongId, m, _demoPolicy(), _caps());

        // The same market with an ENABLED policy whose feedId is not what the route serves.
        UnicaMarketTypes.OraclePolicy memory policy = _oraclePolicy(address(route), OTHER_FEED_ID, 300, 200);
        bytes32 oracleId = _computeId(m.asset, m.payout, 1, address(route), OTHER_FEED_ID);
        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketRegistry.OracleFeedMismatch.selector, oracleId, OTHER_FEED_ID, FEED_ID)
        );
        registry.register(oracleId, m, policy, _caps());

        // Control: the id the registry computes, with the feedId the route actually serves.
        policy.feedId = FEED_ID;
        bytes32 goodId = _computeId(m.asset, m.payout, 1, address(route), FEED_ID);
        registry.register(goodId, m, policy, _caps());
        assertEq(registry.statusOf(goodId), 1, "the matching id registers");
        assertEq(registry.oraclePolicyOf(goodId).feedId, FEED_ID, "and stores the route it was checked against");
        assertFalse(registry.getMarket(goodId).demonstrationOnly, "an enabled policy is not demonstration-only");
        // `id` was computed for the demonstration route and is not the id that landed.
        assertEq(registry.statusOf(id), 0, "the zero-route id was never registered");
    }

    // ---- R8: one live market per pair, versions after RETIRE -----------------------------------------------

    function test_R8_liveMarketAndVersioning() public {
        (bytes32 id, UnicaMarketTypes.Market memory m) = _draft();
        registry.register(id, m, _demoPolicy(), _caps());

        address asset = m.asset;
        address payout = m.payout;

        // A second market on the same pair, correctly versioned, is still refused while one is live.
        // NOTE: each relisting is built fresh rather than copied from `m` — a `Market memory` copy is
        // a reference, and mutating it would silently rewrite the market this row already registered.
        bytes32 secondId = _computeId(asset, payout, 2, address(0), bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.LiveMarketExists.selector, id));
        registry.register(secondId, _relisting(asset, payout, 2), _demoPolicy(), _caps());

        vm.prank(admin);
        registry.retire(id);
        assertEq(registry.liveMarketOf(asset, payout), bytes32(0), "retiring clears the live slot");

        // With the slot free, the wrong version is refused on its own.
        bytes32 thirdId = _computeId(asset, payout, 3, address(0), bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.WrongVersion.selector, uint32(2), uint32(3)));
        registry.register(thirdId, _relisting(asset, payout, 3), _demoPolicy(), _caps());

        // Control: version 2 relists, with a new id, and the old record stays readable forever.
        registry.register(secondId, _relisting(asset, payout, 2), _demoPolicy(), _caps());
        assertTrue(secondId != id, "the relisting has a different id");
        assertEq(registry.statusOf(secondId), 1, "version 2 is PROPOSED");
        assertEq(registry.statusOf(id), 6, "version 1 is still readable, and still RETIRED");
        assertEq(registry.latestVersion(asset, payout), 2, "latestVersion advanced");
        assertEq(registry.marketIdFor(asset, payout, 1), id, "version 1 is still resolvable");
        assertEq(registry.marketIdFor(asset, payout, 2), secondId, "and so is version 2");
    }

    function test_R8_theSameIdNeverRegistersTwice() public {
        (bytes32 id, UnicaMarketTypes.Market memory m) = _draft();
        registry.register(id, m, _demoPolicy(), _caps());
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.MarketExists.selector, id));
        registry.register(id, m, _demoPolicy(), _caps());

        // Control: a different pair with the same shape registers.
        (bytes32 other, UnicaMarketTypes.Market memory om) = _draft();
        registry.register(other, om, _demoPolicy(), _caps());
        assertEq(registry.marketCount(), 2, "two markets");
    }

    // ---- R9: the reverse maps ---------------------------------------------------------------------------------

    function test_R9_reverseMapsAreWriteOnceAndDoNotLeak() public {
        (bytes32 idA, UnicaMarketTypes.Market memory a) = _draft();
        registry.register(idA, a, _demoPolicy(), _caps());
        (bytes32 idB, UnicaMarketTypes.Market memory b) = _draft();
        registry.register(idB, b, _demoPolicy(), _caps());

        assertEq(registry.marketIdOfHook(a.hook), idA, "hook A");
        assertEq(registry.marketIdOfExecutor(a.executor), idA, "executor A");
        assertEq(registry.marketIdOfPool(a.poolId), idA, "pool A");
        assertEq(registry.marketIdOfHook(b.hook), idB, "hook B");
        assertEq(registry.marketIdOfExecutor(b.executor), idB, "executor B");
        assertEq(registry.marketIdOfPool(b.poolId), idB, "pool B");
        assertEq(registry.marketIdOfHook(_addr("nobody")), bytes32(0), "an unregistered address maps to zero");
        assertEq(registry.marketIdOfPool(keccak256("no pool")), bytes32(0), "an unregistered pool maps to zero");

        // A third market that reuses A's hook cannot take the entry, even from the factory.
        (bytes32 idC, UnicaMarketTypes.Market memory c) = _draft();
        c.hook = a.hook;
        bytes32 reuseId = _computeId(c.asset, c.payout, 1, address(0), bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.ReverseMapTaken.selector, idA));
        registry.register(reuseId, c, _demoPolicy(), _caps());
        assertEq(registry.marketIdOfHook(a.hook), idA, "A's entry is untouched");

        // Control: with its own hook the third market registers and changes neither of the first two.
        c.hook = _addr("hookC");
        registry.register(idC, c, _demoPolicy(), _caps());
        assertEq(registry.marketIdOfHook(a.hook), idA, "A still maps to A");
        assertEq(registry.marketIdOfHook(b.hook), idB, "B still maps to B");
        assertEq(registry.marketIdOfHook(c.hook), idC, "C maps to C");
    }

    // ---- R10, O10: exact topics and data ---------------------------------------------------------------------------

    function test_R10_registerEmitsTheFourEventsWithExactFields() public {
        (bytes32 id, UnicaMarketTypes.Market memory m) = _draft();
        UnicaMarketTypes.OraclePolicy memory policy = _demoPolicy();
        UnicaMarketTypes.Caps memory caps = _caps();

        vm.recordLogs();
        registry.register(id, m, policy, caps);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 4, "register emits exactly four events");

        // MarketProposed: three topics plus topic0, and ten words of data.
        assertEq(
            logs[0].topics[0],
            keccak256(
                "MarketProposed(bytes32,address,address,uint32,address,address,bytes32,uint24,int24,uint256,uint160,int24,bool)"
            ),
            "MarketProposed topic0"
        );
        assertEq(logs[0].topics[1], id, "indexed marketId");
        assertEq(logs[0].topics[2], bytes32(uint256(uint160(m.asset))), "indexed asset");
        assertEq(logs[0].topics[3], bytes32(uint256(uint160(m.payout))), "indexed payout");
        assertEq(
            logs[0].data,
            abi.encode(
                m.version,
                m.hook,
                m.executor,
                m.poolId,
                m.fee,
                m.tickSpacing,
                m.rateE18,
                m.initSqrtPriceX96,
                m.initTick,
                true
            ),
            "MarketProposed data"
        );

        assertEq(
            logs[1].topics[0],
            keccak256("OraclePolicySet(bytes32,address,bytes32,uint48,uint16,bool)"),
            "OraclePolicySet topic0"
        );
        assertEq(logs[1].topics[1], id, "indexed marketId");
        assertEq(
            logs[1].data,
            abi.encode(address(0), bytes32(0), uint48(0), uint16(0), false),
            "a demonstration policy logs all zeros"
        );

        assertEq(logs[2].topics[0], keccak256("CapsSet(bytes32,uint128,uint128,uint128)"), "CapsSet topic0");
        assertEq(logs[2].topics[1], id, "indexed marketId");
        assertEq(logs[2].data, abi.encode(CAP_TX, CAP_DAY, CAP_SEED), "CapsSet data");

        assertEq(logs[3].topics[0], keccak256("MarketStatusChanged(bytes32,uint8,uint8)"), "MarketStatusChanged topic0");
        assertEq(logs[3].topics[1], id, "indexed marketId");
        assertEq(uint256(logs[3].topics[2]), 0, "from None");
        assertEq(uint256(logs[3].topics[3]), 1, "to PROPOSED");
        assertEq(logs[3].data.length, 0, "all three fields are topics");
    }

    function test_R10_lifecycleAndSeedEventsCarryTheExactPairs() public {
        bytes32 id = _marketInState(1);

        vm.expectEmit(true, true, true, true, address(registry));
        emit MarketStatusChanged(id, 1, 2);
        registry.recordInitialized(id);

        vm.expectEmit(true, true, true, true, address(registry));
        emit MarketStatusChanged(id, 2, 3);
        vm.expectEmit(true, true, true, true, address(registry));
        emit MarketSeeded(id, 4242);
        registry.recordSeeded(id, 4242);

        vm.expectEmit(true, true, true, true, address(registry));
        emit MarketStatusChanged(id, 3, 4);
        vm.prank(admin);
        registry.activate(id);

        vm.expectEmit(true, true, true, true, address(registry));
        emit MarketStatusChanged(id, 4, 5);
        vm.prank(admin);
        registry.pause(id);

        vm.expectEmit(true, true, true, true, address(registry));
        emit MarketStatusChanged(id, 5, 4);
        vm.prank(admin);
        registry.unpause(id);

        vm.expectEmit(true, true, true, true, address(registry));
        emit MarketStatusChanged(id, 4, 6);
        vm.prank(admin);
        registry.retire(id);
    }

    function test_R10_roleEventsCarryTheirIndexedAddresses() public {
        vm.expectEmit(true, true, true, true, address(registry));
        emit OrderCreatorSet(stranger, true);
        vm.prank(admin);
        registry.setOrderCreator(stranger, true);

        vm.expectEmit(true, true, true, true, address(registry));
        emit PauserSet(address(0), pauserKey);
        vm.prank(admin);
        registry.setPauser(pauserKey);

        address next = makeAddr("next");
        vm.expectEmit(true, true, true, true, address(registry));
        emit AdminTransferStarted(admin, next);
        vm.prank(admin);
        registry.transferAdmin(next);

        vm.expectEmit(true, true, true, true, address(registry));
        emit AdminTransferred(admin, next);
        vm.prank(next);
        registry.acceptAdmin();
    }

    // ---- R11, O1: REQUIRE_ORACLE --------------------------------------------------------------------------------

    function test_R11_O1_requireOracleRefusesADisabledPolicy() public {
        UnicaMarketRegistry strict = new UnicaMarketRegistry(admin, true);
        (, UnicaMarketTypes.Market memory m) = _draft();
        bytes32 id =
            keccak256(abi.encode(block.chainid, address(strict), m.asset, m.payout, uint32(1), address(0), bytes32(0)));

        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.OraclePolicyRequired.selector, id));
        strict.register(id, m, _demoPolicy(), _caps());

        // Control 1: on that same strict registry an enabled, valid policy registers.
        UnicaMarketTypes.OraclePolicy memory policy = _oraclePolicy(address(route), FEED_ID, 300, 200);
        bytes32 oracleId = keccak256(
            abi.encode(block.chainid, address(strict), m.asset, m.payout, uint32(1), address(route), FEED_ID)
        );
        strict.register(oracleId, m, policy, _caps());
        assertEq(strict.statusOf(oracleId), 1, "an oracle market registers under REQUIRE_ORACLE");
        assertFalse(strict.getMarket(oracleId).demonstrationOnly, "not demonstration-only");

        // Control 2: the same disabled policy on a permissive registry stores demonstrationOnly.
        (bytes32 demoId, UnicaMarketTypes.Market memory dm) = _draft();
        registry.register(demoId, dm, _demoPolicy(), _caps());
        assertTrue(registry.getMarket(demoId).demonstrationOnly, "demonstrationOnly is set, not assumed");
    }

    // ---- O2-O6: policy validation, one fault each ------------------------------------------------------------------

    function test_O2_disabledPolicyWithAnyNonZeroFieldIsMalformed() public {
        UnicaMarketTypes.OraclePolicy[4] memory bad;
        bad[0] = UnicaMarketTypes.OraclePolicy(address(route), bytes32(0), 0, 0, false);
        bad[1] = UnicaMarketTypes.OraclePolicy(address(0), FEED_ID, 0, 0, false);
        bad[2] = UnicaMarketTypes.OraclePolicy(address(0), bytes32(0), 60, 0, false);
        bad[3] = UnicaMarketTypes.OraclePolicy(address(0), bytes32(0), 0, 100, false);

        for (uint256 i; i < bad.length; ++i) {
            (, UnicaMarketTypes.Market memory m) = _draft();
            bytes32 id = _computeId(m.asset, m.payout, 1, bad[i].adapter, bad[i].feedId);
            vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.OraclePolicyMalformed.selector, id));
            registry.register(id, m, bad[i], _caps());
        }

        // Control: every field zero and disabled registers.
        (bytes32 okId, UnicaMarketTypes.Market memory om) = _draft();
        registry.register(okId, om, _demoPolicy(), _caps());
        assertEq(registry.statusOf(okId), 1, "the all-zero disabled policy is the valid one");
    }

    function test_O3_anAdapterWithoutCodeIsRefused() public {
        address hollow = _addr("no code here");
        (, UnicaMarketTypes.Market memory m) = _draft();
        UnicaMarketTypes.OraclePolicy memory policy = _oraclePolicy(hollow, FEED_ID, 300, 200);
        bytes32 id = _computeId(m.asset, m.payout, 1, hollow, FEED_ID);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.OracleAdapterNoCode.selector, id, hollow));
        registry.register(id, m, policy, _caps());

        // Control: the same policy pointed at an adapter that has code.
        policy.adapter = address(route);
        bytes32 okId = _computeId(m.asset, m.payout, 1, address(route), FEED_ID);
        registry.register(okId, m, policy, _caps());
        assertEq(registry.statusOf(okId), 1, "a real adapter registers");
    }

    function test_O5_maxAgeBounds() public {
        _expectPolicyRefusal(
            0, 200, abi.encodeWithSelector(UnicaMarketRegistry.OracleMaxAgeOutOfRange.selector, bytes32(0), uint48(0))
        );
        _expectPolicyRefusal(
            301,
            200,
            abi.encodeWithSelector(UnicaMarketRegistry.OracleMaxAgeOutOfRange.selector, bytes32(0), uint48(301))
        );
        // Control: the boundary value itself is accepted.
        _expectPolicyAccepted(300, 200);
    }

    function test_O6_deviationBounds() public {
        _expectPolicyRefusal(
            300,
            0,
            abi.encodeWithSelector(UnicaMarketRegistry.OracleDeviationOutOfRange.selector, bytes32(0), uint16(0))
        );
        _expectPolicyRefusal(
            300,
            301,
            abi.encodeWithSelector(UnicaMarketRegistry.OracleDeviationOutOfRange.selector, bytes32(0), uint16(301))
        );
        // Control: the boundary value itself is accepted.
        _expectPolicyAccepted(300, 300);
    }

    // ---- O7, O8, O9, O10: tightening ------------------------------------------------------------------------------

    function test_O7_O8_oraclePolicyOnlyTightens() public {
        bytes32 id = _oracleMarket(300, 200);
        bytes memory notTighter = abi.encodeWithSelector(UnicaMarketRegistry.OraclePolicyNotTighter.selector, id);

        vm.startPrank(admin);
        vm.expectRevert(notTighter);
        registry.tightenOraclePolicy(id, 301, 200); // maxAge loosened
        vm.expectRevert(notTighter);
        registry.tightenOraclePolicy(id, 300, 201); // bps loosened
        vm.expectRevert(notTighter);
        registry.tightenOraclePolicy(id, 300, 200); // unchanged
        vm.expectRevert(notTighter);
        registry.tightenOraclePolicy(id, 0, 200); // zero is not a tightening, it is a disabling
        vm.expectRevert(notTighter);
        registry.tightenOraclePolicy(id, 300, 0);

        // Control, and O10: a real tightening lands and logs the FULL policy after the change.
        vm.expectEmit(true, true, true, true, address(registry));
        emit OraclePolicySet(id, address(route), FEED_ID, 120, 200, true);
        registry.tightenOraclePolicy(id, 120, 200);
        vm.stopPrank();

        UnicaMarketTypes.OraclePolicy memory p = registry.oraclePolicyOf(id);
        assertEq(p.maxAge, 120, "maxAge tightened");
        assertEq(p.maxDeviationBps, 200, "bps unchanged");
        assertEq(p.adapter, address(route), "the adapter never moves");
        assertEq(p.feedId, FEED_ID, "and neither does the feed");
        assertTrue(p.enabled, "still enabled");

        // And the new value is now the ceiling: the old one no longer passes.
        vm.prank(admin);
        vm.expectRevert(notTighter);
        registry.tightenOraclePolicy(id, 300, 200);
    }

    function test_O9_tightenRefusesRetiredAndDisabled() public {
        bytes32 retired = _oracleMarket(300, 200);
        vm.prank(admin);
        registry.retire(retired);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.WrongMarketStatus.selector, retired, uint8(6)));
        registry.tightenOraclePolicy(retired, 100, 100);

        bytes32 demo = _marketInState(1);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.OraclePolicyDisabled.selector, demo));
        registry.tightenOraclePolicy(demo, 100, 100);

        // Control: a live oracle market tightens.
        bytes32 live = _oracleMarket(300, 200);
        vm.prank(admin);
        registry.tightenOraclePolicy(live, 100, 100);
        assertEq(registry.oraclePolicyOf(live).maxAge, 100, "tightened");
    }

    function test_O_capsOnlyTighten() public {
        bytes32 id = _marketInState(1);
        bytes memory notTighter = abi.encodeWithSelector(UnicaMarketRegistry.CapsNotTighter.selector, id);

        vm.startPrank(admin);
        vm.expectRevert(notTighter);
        registry.tightenCaps(id, CAP_TX + 1, CAP_DAY);
        vm.expectRevert(notTighter);
        registry.tightenCaps(id, CAP_TX, CAP_DAY + 1);
        vm.expectRevert(notTighter);
        registry.tightenCaps(id, CAP_TX, CAP_DAY);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.CapsInvalid.selector, id));
        registry.tightenCaps(id, 0, CAP_DAY);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.CapsInvalid.selector, id));
        registry.tightenCaps(id, CAP_DAY, CAP_TX); // per-tx above per-day

        // Control: a real tightening lands, logs the full caps, and leaves the seed cap alone.
        vm.expectEmit(true, true, true, true, address(registry));
        emit CapsSet(id, CAP_TX - 1, CAP_DAY - 1, CAP_SEED);
        registry.tightenCaps(id, CAP_TX - 1, CAP_DAY - 1);
        vm.stopPrank();

        UnicaMarketTypes.Caps memory c = registry.capsOf(id);
        assertEq(c.maxPerTxPayout, CAP_TX - 1, "per-tx");
        assertEq(c.maxPerDayPayout, CAP_DAY - 1, "per-day");
        assertEq(c.maxSeedPayout, CAP_SEED, "the seed cap has no setter at all");
    }

    function test_O_capsInvalidAtRegister() public {
        UnicaMarketTypes.Caps[3] memory bad = [
            UnicaMarketTypes.Caps(0, CAP_DAY, CAP_SEED),
            UnicaMarketTypes.Caps(CAP_DAY, CAP_TX, CAP_SEED),
            UnicaMarketTypes.Caps(CAP_TX, CAP_DAY, 0)
        ];
        for (uint256 i; i < bad.length; ++i) {
            (bytes32 id, UnicaMarketTypes.Market memory m) = _draft();
            vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.CapsInvalid.selector, id));
            registry.register(id, m, _demoPolicy(), bad[i]);
        }

        // Control: valid caps register.
        (bytes32 okId, UnicaMarketTypes.Market memory om) = _draft();
        registry.register(okId, om, _demoPolicy(), _caps());
        assertEq(registry.capsOf(okId).maxSeedPayout, CAP_SEED, "caps stored");
    }

    // ---- views ------------------------------------------------------------------------------------------------------

    function test_executionTermsOfTracksStatusAndCaps() public {
        bytes32 id = _activeMarket();
        (uint8 status, uint128 perTx, uint128 perDay) = registry.executionTermsOf(id);
        assertEq(status, 4, "ACTIVE");
        assertEq(perTx, CAP_TX, "per-tx");
        assertEq(perDay, CAP_DAY, "per-day");

        vm.prank(admin);
        registry.pause(id);
        (status,,) = registry.executionTermsOf(id);
        assertEq(status, 5, "PAUSED is what the executor sees");

        (uint8 ghost, uint128 a, uint128 b) = registry.executionTermsOf(keccak256("nothing"));
        assertEq(ghost, 0, "an unknown market reads None");
        assertEq(a, 0, "with zero caps");
        assertEq(b, 0, "on both");
    }

    // ---- helpers -------------------------------------------------------------------------------------------------------

    function _addr(string memory label) internal returns (address) {
        nonce += 1;
        return address(uint160(uint256(keccak256(abi.encode(label, nonce)))));
    }

    function _computeId(address asset, address payout, uint32 version, address adapter, bytes32 feedId)
        internal
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(registry), asset, payout, version, adapter, feedId));
    }

    function _demoPolicy() internal pure returns (UnicaMarketTypes.OraclePolicy memory) {
        return UnicaMarketTypes.OraclePolicy(address(0), bytes32(0), 0, 0, false);
    }

    function _oraclePolicy(address adapter, bytes32 feedId, uint48 maxAge, uint16 bps)
        internal
        pure
        returns (UnicaMarketTypes.OraclePolicy memory)
    {
        return UnicaMarketTypes.OraclePolicy(adapter, feedId, maxAge, bps, true);
    }

    function _caps() internal pure returns (UnicaMarketTypes.Caps memory) {
        return UnicaMarketTypes.Caps(CAP_TX, CAP_DAY, CAP_SEED);
    }

    /// @dev A fresh, never-registered market on a fresh pair, plus the id the registry will compute
    ///      for it under the demonstration route.
    function _draft() internal returns (bytes32 id, UnicaMarketTypes.Market memory m) {
        m.asset = _addr("asset");
        m.payout = _addr("payout");
        m.version = 1;
        m.hook = _addr("hook");
        m.executor = _addr("executor");
        m.poolId = keccak256(abi.encode("pool", m.hook));
        m.rateE18 = 395e18;
        m.initSqrtPriceX96 = 1546038186842150969578659200;
        m.initTick = -216540;
        m.fee = 3000;
        m.tickSpacing = 60;
        m.assetDecimals = 18;
        m.payoutDecimals = 6;
        m.assetIsCurrency0 = m.asset < m.payout;
        id = _computeId(m.asset, m.payout, 1, address(0), bytes32(0));
    }

    /// @dev A later version of an existing pair, with its own hook, executor and pool.
    function _relisting(address asset, address payout, uint32 version)
        internal
        returns (UnicaMarketTypes.Market memory m)
    {
        m.asset = asset;
        m.payout = payout;
        m.version = version;
        m.hook = _addr("relisted hook");
        m.executor = _addr("relisted executor");
        m.poolId = keccak256(abi.encode("relisted pool", m.hook));
        m.rateE18 = 395e18;
        m.initSqrtPriceX96 = 1546038186842150969578659200;
        m.initTick = -216540;
        m.fee = 3000;
        m.tickSpacing = 60;
        m.assetDecimals = 18;
        m.payoutDecimals = 6;
        m.assetIsCurrency0 = asset < payout;
    }

    /// @dev A registered demonstration market walked forward to `target` (0 returns an id that was
    ///      never registered).
    function _marketInState(uint8 target) internal returns (bytes32 id) {
        if (target == 0) return keccak256(abi.encode("unregistered", ++nonce));
        UnicaMarketTypes.Market memory m;
        (id, m) = _draft();
        registry.register(id, m, _demoPolicy(), _caps());
        if (target == 1) return id;
        registry.recordInitialized(id);
        if (target == 2) return id;
        registry.recordSeeded(id, 1e18);
        if (target == 3) return id;
        if (target == 6) {
            vm.prank(admin);
            registry.retire(id);
            return id;
        }
        vm.prank(admin);
        registry.activate(id);
        if (target == 4) return id;
        vm.prank(admin);
        registry.pause(id);
        return id;
    }

    function _liveMarket() internal returns (bytes32) {
        return _marketInState(3);
    }

    function _activeMarket() internal returns (bytes32) {
        return _marketInState(4);
    }

    function _oracleMarket(uint48 maxAge, uint16 bps) internal returns (bytes32 id) {
        (, UnicaMarketTypes.Market memory m) = _draft();
        id = _computeId(m.asset, m.payout, 1, address(route), FEED_ID);
        registry.register(id, m, _oraclePolicy(address(route), FEED_ID, maxAge, bps), _caps());
    }

    function _expectPolicyRefusal(uint48 maxAge, uint16 bps, bytes memory selectorAndTail) internal {
        (, UnicaMarketTypes.Market memory m) = _draft();
        bytes32 id = _computeId(m.asset, m.payout, 1, address(route), FEED_ID);
        // The helper's caller cannot know the id in advance, so the expected error is rebuilt here
        // with the real one rather than matched loosely.
        bytes4 selector = bytes4(selectorAndTail);
        bytes memory expected = selector == UnicaMarketRegistry.OracleMaxAgeOutOfRange.selector
            ? abi.encodeWithSelector(selector, id, maxAge)
            : abi.encodeWithSelector(selector, id, bps);
        vm.expectRevert(expected);
        registry.register(id, m, _oraclePolicy(address(route), FEED_ID, maxAge, bps), _caps());
    }

    function _expectPolicyAccepted(uint48 maxAge, uint16 bps) internal {
        bytes32 id = _oracleMarket(maxAge, bps);
        assertEq(registry.statusOf(id), 1, "the boundary policy registers");
        assertEq(registry.oraclePolicyOf(id).maxAge, maxAge, "maxAge stored");
        assertEq(registry.oraclePolicyOf(id).maxDeviationBps, bps, "bps stored");
    }

    /// @dev SC §5's eleven edges, written as a statement rather than derived from the contract.
    function _edgeIsLegal(uint8 from, uint8 to) internal pure returns (bool) {
        if (from == 0 && to == 1) return true;
        if (from == 1 && to == 2) return true;
        if (from == 2 && to == 3) return true;
        if (from == 3 && to == 4) return true;
        if (from == 4 && to == 5) return true;
        if (from == 5 && to == 4) return true;
        if (to == 6 && from >= 1 && from <= 5) return true;
        return false;
    }

    /// @dev Builds a market in `from` and attempts the one function whose target is `to`. Returns
    ///      whether the market actually ended up in `to`; a revert of any kind returns false.
    function _attemptEdge(uint8 from, uint8 to) internal returns (bool) {
        bytes32 id = _marketInState(from);

        if (to == 0) return false; // no function in the contract transitions anything to None
        if (to == 1) {
            // Only a never-registered id can become PROPOSED, and `register` is the only way.
            UnicaMarketTypes.Market memory m;
            bytes32 freshId;
            (freshId, m) = _draft();
            if (from == 0) {
                registry.register(freshId, m, _demoPolicy(), _caps());
                return registry.statusOf(freshId) == 1;
            }
            try registry.register(id, m, _demoPolicy(), _caps()) {
                return false; // it would have to be a DIFFERENT market, so this is never the edge
            } catch {
                return false;
            }
        }
        if (to == 2) {
            try registry.recordInitialized(id) {
                return registry.statusOf(id) == 2;
            } catch {
                return false;
            }
        }
        if (to == 3) {
            try registry.recordSeeded(id, 1e18) {
                return registry.statusOf(id) == 3;
            } catch {
                return false;
            }
        }
        if (to == 4) {
            // Two functions land on ACTIVE: `activate` from SEEDED and `unpause` from PAUSED.
            vm.prank(admin);
            try registry.activate(id) {
                return registry.statusOf(id) == 4;
            } catch {}
            vm.prank(admin);
            try registry.unpause(id) {
                return registry.statusOf(id) == 4;
            } catch {
                return false;
            }
        }
        if (to == 5) {
            vm.prank(admin);
            try registry.pause(id) {
                return registry.statusOf(id) == 5;
            } catch {
                return false;
            }
        }
        vm.prank(admin);
        try registry.retire(id) {
            return registry.statusOf(id) == 6;
        } catch {
            return false;
        }
    }
}
