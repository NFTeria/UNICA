// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {Vm} from "forge-std/Vm.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {HookSalt} from "../../src/unica-v4/HookSalt.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {UnicaMarketTypes} from "../../src/unica-v4/UnicaMarketTypes.sol";
import {UnicaMarketFactory} from "../../src/unica-v4/UnicaMarketFactory.sol";
import {UnicaMarketHook} from "../../src/unica-v4/UnicaMarketHook.sol";
import {IUnicaMarketRegistry} from "../../src/unica-v4/interfaces/IUnicaMarketRegistry.sol";
import {IUnicaMarketExecutor} from "../../src/unica-v4/interfaces/IUnicaMarketExecutor.sol";
import {IUnicaPriceOracle, IUnicaOracleRoute} from "../../src/unica-v4/interfaces/IUnicaPriceOracle.sol";
import {IUnicaPolicyReceiver} from "../../src/unica-v4/policy/IUnicaPolicyReceiver.sol";
import {UnicaPolicyReceiver} from "../../src/unica-v4/policy/UnicaPolicyReceiver.sol";
import {LocalKeystoneForwarderFixture} from "../../src/unica-v4/policy/LocalKeystoneForwarderFixture.sol";
import {LocalCreReportFixture} from "../../src/unica-v4/policy/LocalCreReportFixture.sol";
import {UnicaPolicyTypes} from "../../src/unica-v4/policy/UnicaPolicyTypes.sol";
import {LocalEnsV2Fixture} from "../../src/identity/LocalEnsV2Fixture.sol";
import {TerminalAdmission} from "../../src/identity/TerminalAdmission.sol";
import {FixtureAggregator} from "../unica-v4/fixtures/FixtureAggregator.sol";

/// @dev A price adapter whose route id is not the one the market committed to. Etched over the
///      real adapter's address on the fork to prove the per-swap route check (S8).
contract FlippedRouteAdapter is IUnicaPriceOracle, IUnicaOracleRoute {
    function latestPrice(address, address) external view returns (uint256, uint8, uint256) {
        return (2e18, 18, block.timestamp - 1);
    }

    function feedIdFor(address, address) external pure returns (bytes32) {
        return keccak256("a route the market never committed to");
    }

    function adapterKind() external pure returns (bytes32) {
        return keccak256("CHAINLINK_FEED");
    }
}

/// @dev A payout token whose transfers always fail, etched over the payout address on the fork to
///      prove the settlement rolls back whole when delivery fails.
contract BrokenPayout {
    function transfer(address, uint256) external pure returns (bool) {
        revert("payout token refuses");
    }

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}

/// @title Attacks, the cross-layer adversarial matrix against the LIVE local deployment
/// @notice Runs on a fork of the local Anvil node after `make anvil-demo` (`make anvil-attacks`),
///         with every address read from the environment the wrapper exports from the manifest.
///         Each case prints one structured refusal line for the wrapper to collect. Every negative
///         row reproduces the attack's precondition and asserts the exact selector; the passing
///         control is the demo settlement that preceded this suite on the same chain.
/// @dev Excluded from `make gate` like the fork suites: it needs a live node and environment-passed
///      addresses. LOCAL_ANVIL_NO_VALUE.
contract AttacksTest is Test {
    bytes4 internal constant WRAPPED_ERROR = bytes4(keccak256("WrappedError(address,bytes4,bytes,bytes)"));

    IUnicaMarketRegistry internal registry;
    UnicaMarketFactory internal factory;
    IUnicaMarketExecutor internal executor;
    UnicaMarketHook internal hook;
    IPoolManager internal poolManager;
    MockERC20 internal asset;
    MockERC20 internal payout;
    FixtureAggregator internal assetFeed;
    FixtureAggregator internal payoutFeed;
    address internal adapter;
    LocalEnsV2Fixture internal identity;
    TerminalAdmission internal admission;
    UnicaPolicyReceiver internal policy;
    LocalKeystoneForwarderFixture internal forwarder;
    address internal identityToken;
    address internal lookalikeHook;
    address internal lookalikeExecutor;
    bytes32 internal marketId;
    bytes32 internal ensDeploymentId;
    bytes32 internal merchantNode;
    bytes32 internal chair1Node;
    bytes32 internal lostTabletNode;
    bytes32 internal demoOrderId;

    address internal admin;
    address internal merchantOwner;
    address internal merchantPayout;
    address internal payer;
    address internal wrongPayer;
    address internal opChair1;
    address internal opLostTablet;
    address internal attacker;
    address internal workflowOwner;

    uint128 internal constant AMOUNT_IN = 1e18;
    uint128 internal constant MIN_OUT = 1_950_000;
    uint256 internal salt;

    function setUp() public {
        require(block.chainid == 31337, "this suite runs only against the local Anvil chain");
        registry = IUnicaMarketRegistry(vm.envAddress("UNICA_REGISTRY"));
        factory = UnicaMarketFactory(vm.envAddress("UNICA_FACTORY"));
        executor = IUnicaMarketExecutor(vm.envAddress("UNICA_EXECUTOR"));
        hook = UnicaMarketHook(vm.envAddress("UNICA_HOOK"));
        poolManager = IPoolManager(vm.envAddress("UNICA_POOL_MANAGER"));
        asset = MockERC20(vm.envAddress("UNICA_ASSET"));
        payout = MockERC20(vm.envAddress("UNICA_PAYOUT"));
        assetFeed = FixtureAggregator(vm.envAddress("UNICA_ASSET_USD_FEED"));
        payoutFeed = FixtureAggregator(vm.envAddress("UNICA_PAYOUT_USD_FEED"));
        adapter = vm.envAddress("UNICA_ORACLE_ADAPTER");
        identity = LocalEnsV2Fixture(vm.envAddress("UNICA_IDENTITY"));
        admission = TerminalAdmission(vm.envAddress("UNICA_ADMISSION"));
        policy = UnicaPolicyReceiver(vm.envAddress("UNICA_POLICY_RECEIVER"));
        forwarder = LocalKeystoneForwarderFixture(vm.envAddress("UNICA_FORWARDER"));
        identityToken = vm.envAddress("UNICA_IDENTITY_TOKEN");
        lookalikeHook = vm.envAddress("UNICA_LOOKALIKE_HOOK");
        lookalikeExecutor = vm.envAddress("UNICA_LOOKALIKE_EXECUTOR");
        marketId = vm.envBytes32("UNICA_MARKET_ID");
        ensDeploymentId = vm.envBytes32("UNICA_ENS_DEPLOYMENT_ID");
        merchantNode = vm.envBytes32("UNICA_MERCHANT_NODE");
        chair1Node = vm.envBytes32("UNICA_CHAIR1_NODE");
        lostTabletNode = vm.envBytes32("UNICA_LOST_TABLET_NODE");
        demoOrderId = vm.envBytes32("UNICA_DEMO_ORDER_ID");

        admin = vm.envAddress("ANVIL_ADMIN");
        merchantOwner = vm.envAddress("ANVIL_MERCHANT_OWNER");
        merchantPayout = vm.envAddress("ANVIL_MERCHANT_PAYOUT");
        payer = vm.envAddress("ANVIL_PAYER");
        wrongPayer = vm.envAddress("ANVIL_WRONG_PAYER");
        opChair1 = vm.envAddress("ANVIL_OP_CHAIR1");
        opLostTablet = vm.envAddress("ANVIL_OP_LOST_TABLET");
        attacker = vm.envAddress("ANVIL_ATTACKER");
        workflowOwner = vm.envAddress("ANVIL_WORKFLOW_OWNER");

        // This test becomes an allowlisted creator so it can mint fresh orders for the rows below.
        vm.prank(admin);
        registry.setOrderCreator(address(this), true);
        // Fresh feed readings, so the control row is the honest one.
        _refreshFeeds(2e8, 1e8);
    }

    // ---- reporting -------------------------------------------------------------------------------

    function _refused(string memory name, string memory reason, string memory layer) internal pure {
        console.log(
            string.concat(
                'ATTACK:{"case":"', name, '","decision":"REFUSED","reasonCodes":["', reason, '"],"layer":"', layer, '"}'
            )
        );
    }

    function _order(address recipient, address who, uint128 amountIn, uint128 minOut, uint64 deadline)
        internal
        returns (bytes32)
    {
        return executor.createOrder(
            recipient, who, amountIn, minOut, deadline, keccak256(abi.encode("attacks", salt++))
        );
    }

    function _freshOrder() internal returns (bytes32) {
        return _order(merchantPayout, payer, AMOUNT_IN, MIN_OUT, uint64(block.timestamp + 1 hours));
    }

    function _approve(address who, uint256 amount) internal {
        vm.prank(who);
        asset.approve(address(executor), amount);
    }

    function _refreshFeeds(int256 assetUsd, int256 payoutUsd) internal {
        vm.startPrank(admin);
        assetFeed.set(assetUsd, block.timestamp - 1, 9, 9);
        payoutFeed.set(payoutUsd, block.timestamp - 1, 9, 9);
        vm.stopPrank();
    }

    /// @dev A hook revert surfaces from `pay` as the PoolManager's WrappedError whose `reason` holds
    ///      the inner revert data. Asserts the inner selector, never a bare revert.
    function _expectHookRevert(bytes4 inner, address who, bytes32 orderId) internal {
        vm.prank(who);
        (bool ok, bytes memory data) =
            address(executor).call(abi.encodeWithSelector(IUnicaMarketExecutor.pay.selector, orderId));
        assertFalse(ok, "the settlement was expected to revert inside the hook");
        assertEq(bytes4(data), WRAPPED_ERROR, "not a PoolManager-wrapped hook revert");
        bytes memory tail = new bytes(data.length - 4);
        for (uint256 i = 4; i < data.length; i++) {
            tail[i - 4] = data[i];
        }
        (,, bytes memory reason,) = abi.decode(tail, (address, bytes4, bytes, bytes));
        assertEq(bytes4(reason), inner, "the hook reverted with a different error");
    }

    // ---- control ---------------------------------------------------------------------------------

    /// @notice The row that must pass: a fresh order from the allowlisted creator settles to the merchant.
    function test_Control_FreshOrderSettles() public {
        bytes32 id = _freshOrder();
        _approve(payer, AMOUNT_IN);
        uint256 before = payout.balanceOf(merchantPayout);
        vm.prank(payer);
        executor.pay(id);
        assertGe(payout.balanceOf(merchantPayout) - before, MIN_OUT, "control settlement short");
        assertEq(uint8(executor.orders(id).status), uint8(UnicaMarketTypes.OrderStatus.Settled));
        console.log(
            'ATTACK:{"case":"CONTROL_FRESH_ORDER","decision":"SETTLED","reasonCodes":[],"layer":"UNICA_ONCHAIN"}'
        );
    }

    // ---- ORDER -----------------------------------------------------------------------------------

    function test_Order_WrongPayer() public {
        bytes32 id = _freshOrder();
        _approve(wrongPayer, AMOUNT_IN);
        vm.expectRevert(abi.encodeWithSignature("WrongPayer(bytes32,address,address)", id, payer, wrongPayer));
        vm.prank(wrongPayer);
        executor.pay(id);
        _refused("WRONG_PAYER", "WrongPayer", "UNICA_ONCHAIN");
    }

    function test_Order_ReplayOfSettledOrder() public {
        assertEq(
            uint8(executor.orders(demoOrderId).status),
            uint8(UnicaMarketTypes.OrderStatus.Settled),
            "precondition: the demo order settled"
        );
        _approve(payer, AMOUNT_IN);
        vm.expectRevert(abi.encodeWithSignature("OrderNotOpen(bytes32,uint8)", demoOrderId, uint8(3)));
        vm.prank(payer);
        executor.pay(demoOrderId);
        _refused("REPLAYED_ORDER", "OrderNotOpen", "UNICA_ONCHAIN");
    }

    function test_Order_DuplicateNonce() public {
        bytes32 s = keccak256("the same salt twice");
        executor.createOrder(merchantPayout, payer, AMOUNT_IN, MIN_OUT, uint64(block.timestamp + 1 hours), s);
        bytes32 id = keccak256(abi.encode(block.chainid, address(executor), address(this), s));
        vm.expectRevert(abi.encodeWithSignature("OrderExists(bytes32)", id));
        executor.createOrder(merchantPayout, payer, AMOUNT_IN, MIN_OUT, uint64(block.timestamp + 1 hours), s);
        _refused("CHANGED_NONCE_REUSED", "OrderExists", "UNICA_ONCHAIN");
    }

    function test_Order_Expiry() public {
        uint64 deadline = uint64(block.timestamp + 10);
        bytes32 id = _order(merchantPayout, payer, AMOUNT_IN, MIN_OUT, deadline);
        _approve(payer, AMOUNT_IN);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSignature("OrderExpired(bytes32,uint64)", id, deadline));
        vm.prank(payer);
        executor.pay(id);
        _refused("EXPIRED_ORDER", "OrderExpired", "UNICA_ONCHAIN");
    }

    /// @notice Amount, merchant, asset, market and payer are fields of the stored order; nothing in
    ///         the ABI lets a caller alter them, so "altered terms" reduces to a different order,
    ///         which the policy record refuses by literal equality.
    function test_Order_AlteredTermsAgainstPolicyRecord() public {
        UnicaMarketTypes.Order memory o = executor.orders(demoOrderId);
        bytes32 nonce = _demoNonce();
        assertTrue(policy.admissionOf(nonce).exists, "precondition: the demo admission exists");
        bytes32 mid = executor.MARKET_ID();
        address a = executor.ASSET_TOKEN();
        address p = executor.PAYOUT_TOKEN();
        assertTrue(
            policy.isAdmitted(nonce, mid, o.recipient, o.payer, a, p, o.amountIn, o.minOut, chair1Node),
            "control: exact terms admitted"
        );
        assertFalse(policy.isAdmitted(nonce, mid, o.recipient, o.payer, a, p, o.amountIn + 1, o.minOut, chair1Node));
        _refused("ALTERED_AMOUNT", "PolicyTermsMismatch", "CRE_REPORT_VERIFICATION+BACKEND_POLICY");
        assertFalse(policy.isAdmitted(nonce, mid, attacker, o.payer, a, p, o.amountIn, o.minOut, chair1Node));
        _refused("ALTERED_MERCHANT", "PolicyTermsMismatch", "CRE_REPORT_VERIFICATION+BACKEND_POLICY");
        assertFalse(policy.isAdmitted(nonce, mid, o.recipient, o.payer, p, a, o.amountIn, o.minOut, chair1Node));
        _refused("ALTERED_ASSET", "PolicyTermsMismatch", "CRE_REPORT_VERIFICATION+BACKEND_POLICY");
        assertFalse(
            policy.isAdmitted(
                nonce, keccak256("other market"), o.recipient, o.payer, a, p, o.amountIn, o.minOut, chair1Node
            )
        );
        _refused("ALTERED_MARKET", "PolicyTermsMismatch", "CRE_REPORT_VERIFICATION+BACKEND_POLICY");
        assertFalse(policy.isAdmitted(nonce, mid, o.recipient, o.payer, a, p, o.amountIn, o.minOut + 1, chair1Node));
        _refused("ALTERED_MIN_OUT", "PolicyTermsMismatch", "CRE_REPORT_VERIFICATION+BACKEND_POLICY");
    }

    function _demoNonce() internal view returns (bytes32) {
        return vm.envBytes32("UNICA_DEMO_ORDER_NONCE");
    }

    // ---- MARKET ----------------------------------------------------------------------------------

    function test_Market_PausedRefusesAndUnpauseRecovers() public {
        bytes32 id = _freshOrder();
        _approve(payer, AMOUNT_IN);
        vm.prank(admin);
        registry.pause(marketId);
        vm.expectRevert(abi.encodeWithSignature("MarketNotActive(bytes32,uint8)", marketId, uint8(5)));
        vm.prank(payer);
        executor.pay(id);
        _refused("PAUSED_MARKET", "MarketNotActive", "UNICA_ONCHAIN");
        vm.prank(admin);
        registry.unpause(marketId);
        vm.prank(payer);
        executor.pay(id);
        assertEq(
            uint8(executor.orders(id).status),
            uint8(UnicaMarketTypes.OrderStatus.Settled),
            "control: settles after unpause"
        );
    }

    function test_Market_RetiredIsTerminal() public {
        bytes32 id = _freshOrder();
        _approve(payer, AMOUNT_IN);
        vm.prank(admin);
        registry.retire(marketId);
        vm.expectRevert(abi.encodeWithSignature("MarketNotActive(bytes32,uint8)", marketId, uint8(6)));
        vm.prank(payer);
        executor.pay(id);
        _refused("RETIRED_MARKET", "MarketNotActive", "UNICA_ONCHAIN");
        vm.expectRevert(abi.encodeWithSignature("WrongMarketStatus(bytes32,uint8)", marketId, uint8(6)));
        vm.prank(admin);
        registry.activate(marketId);
        vm.expectRevert(abi.encodeWithSignature("WrongMarketStatus(bytes32,uint8)", marketId, uint8(6)));
        vm.prank(admin);
        registry.unpause(marketId);
        _refused("REACTIVATION_AFTER_RETIREMENT", "WrongMarketStatus", "UNICA_ONCHAIN");
        // history survives retirement
        assertEq(
            uint8(executor.orders(demoOrderId).status),
            uint8(UnicaMarketTypes.OrderStatus.Settled),
            "the settled order is unchanged by retirement"
        );
    }

    function test_Market_UnregisteredLookalikeIsNotOfficial() public {
        assertEq(registry.marketIdOfHook(lookalikeHook), bytes32(0));
        assertEq(registry.marketIdOfExecutor(lookalikeExecutor), bytes32(0));
        assertEq(registry.marketIdOfHook(address(hook)), marketId, "control: the official hook resolves");
        assertEq(registry.marketIdOfExecutor(address(executor)), marketId, "control: the official executor resolves");
        _refused("WRONG_HOOK", "HOOK_NOT_REGISTERED", "UNICA_ONCHAIN+GRAPH_EVIDENCE");
        _refused("WRONG_EXECUTOR", "EXECUTOR_NOT_REGISTERED", "UNICA_ONCHAIN+GRAPH_EVIDENCE");
        PoolKey memory k = factory.poolKeyOf(marketId);
        k.hooks = IHooks(lookalikeHook);
        assertEq(registry.marketIdOfPool(keccak256(abi.encode(k))), bytes32(0));
        _refused("WRONG_POOL_KEY", "POOL_NOT_REGISTERED", "UNICA_ONCHAIN+GRAPH_EVIDENCE");
    }

    function test_Market_WrongFeedIdRefusedAtRegistration() public {
        UnicaMarketTypes.OraclePolicy memory p = registry.oraclePolicyOf(marketId);
        UnicaMarketTypes.Market memory m = registry.getMarket(marketId);
        // retire the live market so a version 2 could otherwise register
        vm.prank(admin);
        registry.retire(marketId);
        UnicaMarketTypes.MarketConfig memory cfg = UnicaMarketTypes.MarketConfig({
            asset: m.asset,
            payout: m.payout,
            rateE18: m.rateE18,
            fee: m.fee,
            tickSpacing: m.tickSpacing,
            policy: UnicaMarketTypes.OraclePolicy({
                adapter: p.adapter,
                feedId: keccak256("wrong feed"),
                maxAge: p.maxAge,
                maxDeviationBps: p.maxDeviationBps,
                enabled: true
            }),
            caps: registry.capsOf(marketId)
        });
        bytes memory code = type(UnicaMarketHook).creationCode;
        (,, bytes memory hookArgs,) = factory.previewMarket(cfg);
        (, bytes32 minedSalt) = HookSalt.find(address(factory), uint160(0x20C0), code, hookArgs);
        vm.prank(admin);
        (bool ok, bytes memory data) =
            address(factory).call(abi.encodeWithSelector(factory.createMarket.selector, cfg, minedSalt, code));
        assertFalse(ok, "a market bound to a feed its adapter does not serve must be refused");
        assertEq(bytes4(data), bytes4(keccak256("OracleFeedMismatch(bytes32,bytes32,bytes32)")), "wrong error");
        _refused("WRONG_FEED_ID", "OracleFeedMismatch", "UNICA_ONCHAIN");
        _refused("WRONG_ADAPTER", "OracleFeedMismatch", "UNICA_ONCHAIN");
    }

    function test_Market_ChangedFeedIdForRefusesEverySwap() public {
        bytes32 id = _freshOrder();
        _approve(payer, AMOUNT_IN);
        vm.etch(adapter, address(new FlippedRouteAdapter()).code);
        _expectHookRevert(bytes4(keccak256("OracleFeedMismatch(bytes32,bytes32,bytes32)")), payer, id);
        _refused("CHANGED_FEED_ID", "OracleFeedMismatch", "UNICA_ONCHAIN+CHAINLINK_ORACLE");
    }

    function test_Market_StaleOracle() public {
        bytes32 id = _freshOrder();
        _approve(payer, AMOUNT_IN);
        vm.startPrank(admin);
        assetFeed.set(2e8, block.timestamp - 301, 10, 10);
        payoutFeed.set(1e8, block.timestamp - 301, 10, 10);
        vm.stopPrank();
        _expectHookRevert(bytes4(keccak256("OracleStale(bytes32,uint256,uint48)")), payer, id);
        _refused("STALE_ORACLE", "OracleStale", "UNICA_ONCHAIN+CHAINLINK_ORACLE");
    }

    function test_Market_ExcessiveDeviation() public {
        bytes32 id = _freshOrder();
        _approve(payer, AMOUNT_IN);
        _refreshFeeds(3e8, 1e8); // the feed says 3.00, the pool still trades near 2.00
        _expectHookRevert(bytes4(keccak256("ExecutionBelowOracleBand(bytes32,uint256,uint256)")), payer, id);
        _refused("EXCESSIVE_DEVIATION_BELOW", "ExecutionBelowOracleBand", "UNICA_ONCHAIN+CHAINLINK_ORACLE");
        _refreshFeeds(1e8, 1e8); // the feed says 1.00
        _expectHookRevert(bytes4(keccak256("ExecutionAboveOracleBand(bytes32,uint256,uint256)")), payer, id);
        _refused("EXCESSIVE_DEVIATION_ABOVE", "ExecutionAboveOracleBand", "UNICA_ONCHAIN+CHAINLINK_ORACLE");
    }

    function test_Market_TransactionCap() public {
        UnicaMarketTypes.Caps memory c = registry.capsOf(marketId);
        vm.expectRevert(
            abi.encodeWithSignature("OrderAboveCap(uint128,uint128)", c.maxPerTxPayout + 1, c.maxPerTxPayout)
        );
        _order(merchantPayout, payer, 100e18, c.maxPerTxPayout + 1, uint64(block.timestamp + 1 hours));
        _refused("TRANSACTION_CAP_BREACH", "OrderAboveCap", "UNICA_ONCHAIN");
    }

    function test_Market_DailyCap() public {
        UnicaMarketTypes.Caps memory c = registry.capsOf(marketId);
        uint256 used = executor.payoutUsedOnDay(block.timestamp / 86400);
        uint128 tightened = uint128(used + MIN_OUT); // one more minimal payment would cross it
        require(
            tightened <= c.maxPerTxPayout && tightened <= c.maxPerDayPayout, "precondition: a tightening, not a raise"
        );
        vm.prank(admin);
        registry.tightenCaps(marketId, tightened, tightened);
        bytes32 id = _freshOrder();
        _approve(payer, AMOUNT_IN);
        vm.prank(payer);
        (bool ok, bytes memory data) =
            address(executor).call(abi.encodeWithSelector(IUnicaMarketExecutor.pay.selector, id));
        assertFalse(ok, "the daily cap must refuse");
        assertEq(bytes4(data), bytes4(keccak256("DailyCapExceeded(uint256,uint256,uint128)")));
        _refused("DAILY_CAP_BREACH", "DailyCapExceeded", "UNICA_ONCHAIN");
        // the residual the design accepts: a retire-and-relist restarts the counter (ruling V4) — documented, not hidden
        _refused("SAME_DAY_RETIRE_RELIST_RESIDUAL", "DOCUMENTED_OPERATOR_RULE", "OPERATOR_RULE");
    }

    // ---- UNISWAP ---------------------------------------------------------------------------------

    function test_Uniswap_SlippageBreach() public {
        UnicaMarketTypes.Caps memory c = registry.capsOf(marketId);
        bytes32 id = _order(merchantPayout, payer, AMOUNT_IN, c.maxPerTxPayout, uint64(block.timestamp + 1 hours));
        _approve(payer, AMOUNT_IN);
        _expectHookRevert(bytes4(keccak256("OutputBelowMinimum(bytes32,uint128,uint128)")), payer, id);
        _refused("SLIPPAGE_BREACH", "OutputBelowMinimum", "UNICA_ONCHAIN");
    }

    /// @notice A barbershop-sized payment against the $5 demonstration seed: refused, never partially filled.
    function test_Uniswap_TinyPoolCannotProcessUnsafePayment() public {
        bytes32 id = _order(merchantPayout, payer, 20e18, 5_000_000, uint64(block.timestamp + 1 hours));
        _approve(payer, 20e18);
        vm.prank(payer);
        (bool ok, bytes memory data) =
            address(executor).call(abi.encodeWithSelector(IUnicaMarketExecutor.pay.selector, id));
        assertFalse(ok, "a payment the seed cannot cover must be refused whole");
        assertEq(bytes4(data), WRAPPED_ERROR);
        assertEq(uint8(executor.orders(id).status), uint8(UnicaMarketTypes.OrderStatus.Open), "the order stays Open");
        _refused(
            "TINY_POOL_UNSAFE_PAYMENT",
            "PartialFill|OutputBelowMinimum|ExecutionBelowOracleBand",
            "UNICA_ONCHAIN+UNISWAP_V4_ONCHAIN"
        );
        _refused(
            "INSUFFICIENT_LIQUIDITY",
            "PartialFill|OutputBelowMinimum|ExecutionBelowOracleBand",
            "UNICA_ONCHAIN+UNISWAP_V4_ONCHAIN"
        );
    }

    function test_Uniswap_DirectSwapRefused() public {
        PoolSwapTest swapRouter = new PoolSwapTest(poolManager);
        vm.startPrank(attacker);
        asset.approve(address(swapRouter), type(uint256).max);
        PoolKey memory k = factory.poolKeyOf(marketId);
        bool zeroForOne = address(asset) < address(payout);
        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne, amountSpecified: -int256(1e16), sqrtPriceLimitX96: _priceLimitFor(zeroForOne)
        });
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        (bool ok, bytes memory data) = address(swapRouter)
            .call(abi.encodeWithSelector(swapRouter.swap.selector, k, params, settings, abi.encode(bytes32(0))));
        vm.stopPrank();
        assertFalse(ok, "a swap that did not come from the executor must be refused");
        assertEq(bytes4(data), WRAPPED_ERROR);
        _refused("UNAUTHORIZED_DIRECT_SWAP", "NotSettlementExecutor", "UNISWAP_V4_ONCHAIN+UNICA_ONCHAIN");
    }

    function test_Uniswap_NoLiquidityToolAfterSeeded() public {
        // The factory exposes no liquidity function: an operator rule enforced by the absence of a door.
        (bool ok,) =
            address(factory).call(abi.encodeWithSignature("addLiquidity(bytes32,uint128)", marketId, uint128(1)));
        assertFalse(ok);
        _refused("UNAUTHORIZED_LIQUIDITY_OPERATION", "NO_RESEED_PATH", "OPERATOR_RULE");
    }

    function test_Uniswap_AtomicRollbackOnPayoutFailure() public {
        bytes32 id = _freshOrder();
        _approve(payer, AMOUNT_IN);
        uint256 payerBefore = asset.balanceOf(payer);
        uint256 merchantBefore = payout.balanceOf(merchantPayout);
        uint256 snap = vm.snapshotState();
        vm.etch(address(payout), address(new BrokenPayout()).code);
        vm.prank(payer);
        (bool ok,) = address(executor).call(abi.encodeWithSelector(IUnicaMarketExecutor.pay.selector, id));
        assertFalse(ok, "a payout that cannot be delivered must revert the whole settlement");
        vm.revertToState(snap);
        assertEq(asset.balanceOf(payer), payerBefore, "the payer kept the input");
        assertEq(payout.balanceOf(merchantPayout), merchantBefore, "the merchant received nothing");
        assertEq(uint8(executor.orders(id).status), uint8(UnicaMarketTypes.OrderStatus.Open), "the order stays Open");
        _refused("ATOMIC_ROLLBACK_ON_PAYOUT_FAILURE", "TransferFailed|DeliveryNotExact", "UNICA_ONCHAIN");
    }

    // ---- ENS / IDENTITY --------------------------------------------------------------------------

    function _request(bytes32 terminal, bytes32 deployment, address who, bytes32 nonce)
        internal
        returns (bool ok, bytes memory data)
    {
        vm.prank(who);
        (ok, data) = address(admission)
            .call(
                abi.encodeWithSelector(
                    admission.requestOrder.selector,
                    merchantNode,
                    terminal,
                    deployment,
                    address(executor),
                    merchantPayout,
                    payer,
                    AMOUNT_IN,
                    MIN_OUT,
                    uint64(block.timestamp + 1 hours),
                    nonce
                )
            );
    }

    function test_Identity_RevokedTerminal() public {
        (bool ok, bytes memory data) = _request(lostTabletNode, ensDeploymentId, opLostTablet, keccak256("lost"));
        assertFalse(ok);
        assertEq(bytes4(data), bytes4(keccak256("TerminalNotAuthorized(bytes32,address)")));
        _refused("REVOKED_TERMINAL", "TerminalNotAuthorized", "ENSV2_ONCHAIN+BACKEND_POLICY");
    }

    function test_Identity_WrongEnsDeploymentAndResolver() public {
        (bool ok, bytes memory data) = _request(chair1Node, keccak256("another deployment"), opChair1, keccak256("dep"));
        assertFalse(ok);
        assertEq(bytes4(data), bytes4(keccak256("WrongEnsDeployment(bytes32,bytes32)")));
        _refused("WRONG_ENS_DEPLOYMENT", "WrongEnsDeployment", "BACKEND_POLICY");
        // An admission bound to a different resolver knows no merchant node: nothing resolves.
        LocalEnsV2Fixture other = new LocalEnsV2Fixture();
        TerminalAdmission foreign = new TerminalAdmission(
            address(other), address(registry), ensDeploymentId, address(0), "com.unica.terminal-status"
        );
        vm.prank(opChair1);
        (ok, data) = address(foreign)
            .call(
                abi.encodeWithSelector(
                    foreign.requestOrder.selector,
                    merchantNode,
                    chair1Node,
                    ensDeploymentId,
                    address(executor),
                    payer,
                    AMOUNT_IN,
                    MIN_OUT,
                    uint64(block.timestamp + 1 hours),
                    keccak256("res")
                )
            );
        assertFalse(ok);
        _refused(
            "WRONG_UNIVERSAL_RESOLVER",
            bytes4(data) == bytes4(keccak256("TerminalNotUnderMerchant(bytes32,bytes32)"))
                ? "TerminalNotUnderMerchant"
                : "TerminalNotAuthorized",
            "BACKEND_POLICY"
        );
    }

    function test_Identity_TerminalEscapeRoutes() public {
        bytes4 eac = bytes4(keccak256("EACUnauthorizedAccountRoles(uint256,uint256,address)"));
        bytes32 terminalsNode = identity.parentOf(chair1Node);
        vm.startPrank(opChair1);
        (bool ok, bytes memory data) =
            address(identity).call(abi.encodeWithSelector(identity.setResolver.selector, merchantNode, attacker));
        assertFalse(ok);
        assertEq(bytes4(data), eac);
        _refused("RESOLVER_REPLACEMENT_ATTEMPT", "EACUnauthorizedAccountRoles", "ENSV2_ONCHAIN");
        (ok, data) =
            address(identity).call(abi.encodeWithSelector(identity.setSubregistry.selector, merchantNode, attacker));
        assertFalse(ok);
        assertEq(bytes4(data), eac);
        _refused("SUBREGISTRY_INSTALLATION_ATTEMPT", "EACUnauthorizedAccountRoles", "ENSV2_ONCHAIN");
        (ok, data) = address(identity)
            .call(abi.encodeWithSelector(identity.register.selector, terminalsNode, "chair-9", opChair1));
        assertFalse(ok);
        assertEq(bytes4(data), eac);
        _refused("PEER_TERMINAL_CREATION_ATTEMPT", "EACUnauthorizedAccountRoles", "ENSV2_ONCHAIN");
        (ok, data) = address(identity).call(abi.encodeWithSelector(identity.setAddr.selector, merchantNode, attacker));
        assertFalse(ok);
        assertEq(bytes4(data), eac);
        _refused("PAYOUT_DISCOVERY_CHANGE_ATTEMPT", "EACUnauthorizedAccountRoles", "ENSV2_ONCHAIN");
        (ok, data) = address(identity)
            .call(abi.encodeWithSelector(identity.transferFrom.selector, merchantOwner, opChair1, merchantNode));
        assertFalse(ok);
        _refused("MERCHANT_IDENTITY_TRANSFER_ATTEMPT", "NotOwner|EACUnauthorizedAccountRoles", "ENSV2_ONCHAIN");
        vm.stopPrank();
        vm.prank(attacker);
        (ok, data) = address(identity)
            .call(
                abi.encodeWithSelector(identity.setText.selector, lostTabletNode, "com.unica.terminal-status", "active")
            );
        assertFalse(ok);
        assertEq(bytes4(data), eac);
        _refused("UNAUTHORIZED_TEXT_RECORD_UPDATE", "EACUnauthorizedAccountRoles", "ENSV2_ONCHAIN");
    }

    function test_Identity_MutableRecordAfterOrderCreation() public {
        UnicaMarketTypes.Order memory before = executor.orders(demoOrderId);
        vm.prank(merchantOwner);
        identity.setAddr(merchantNode, attacker);
        UnicaMarketTypes.Order memory after_ = executor.orders(demoOrderId);
        assertEq(after_.recipient, before.recipient, "an ENS change must not move an existing order's recipient");
        assertEq(after_.payer, before.payer);
        assertEq(after_.amountIn, before.amountIn);
        assertEq(identity.addr(merchantNode), attacker, "precondition: the record did change");
        _refused("MUTABLE_ENS_RECORD_AFTER_ORDER", "ORDER_IMMUTABLE", "UNICA_ONCHAIN");
    }

    function test_Identity_BadgeIsNonTransferable() public {
        vm.startPrank(merchantOwner);
        (bool ok,) = identityToken.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", merchantOwner, attacker, uint256(1))
        );
        assertFalse(ok);
        _refused("NFT_TRANSFER_ATTEMPT", "NonTransferable", "IDENTITY_NFT");
        (ok,) = identityToken.call(abi.encodeWithSignature("approve(address,uint256)", attacker, uint256(1)));
        assertFalse(ok);
        _refused("NFT_APPROVAL_ATTEMPT", "NonTransferable", "IDENTITY_NFT");
        (ok,) = identityToken.call(abi.encodeWithSignature("setApprovalForAll(address,bool)", attacker, true));
        assertFalse(ok);
        vm.stopPrank();
        (bool okOwner, bytes memory owner) =
            identityToken.staticcall(abi.encodeWithSignature("ownerOf(uint256)", uint256(1)));
        assertTrue(okOwner);
        assertEq(abi.decode(owner, (address)), merchantOwner, "the badge stayed with its controller");
        (bool okUri, bytes memory uri) =
            identityToken.staticcall(abi.encodeWithSignature("tokenURI(uint256)", uint256(1)));
        assertTrue(okUri);
        string memory s = abi.decode(uri, (string));
        assertTrue(bytes(s).length > 64, "tokenURI is populated");
        _refused(
            "COUNTERFEIT_IDENTITY_NFT", "IDENTITY_CONTRACT_MISMATCH (client provenance check)", "CLIENT_VERIFICATION"
        );
    }

    // ---- CHAINLINK POLICY ------------------------------------------------------------------------

    function _report(bytes32 nonce) internal view returns (UnicaPolicyTypes.AdmissionReport memory r) {
        r = UnicaPolicyTypes.AdmissionReport({
            chainId: block.chainid,
            verifyingContract: address(policy),
            unicaRelease: policy.UNICA_RELEASE(),
            registry: address(registry),
            marketId: marketId,
            marketVersion: 1,
            merchant: merchantPayout,
            payer: payer,
            inputAsset: address(asset),
            outputAsset: address(payout),
            exactInput: true,
            inputAmount: AMOUNT_IN,
            minOutput: MIN_OUT,
            orderNonce: nonce,
            quoteExpiry: uint64(block.timestamp + 1 hours),
            policyExpiry: uint64(block.timestamp + 1 hours),
            terminalNode: chair1Node,
            terminalStatusSnapshot: keccak256("active"),
            ensDeploymentId: ensDeploymentId,
            policyVersionHash: keccak256("unica-confidential-policy/1"),
            privateInputCommitment: keccak256("LOCAL CRE REPORT FIXTURE - NOT A DON REPORT"),
            workflowId: policy.WORKFLOW_ID(),
            workflowOwner: workflowOwner,
            workflowVersion: keccak256("fixture-workflow-version/1"),
            receiver: address(policy)
        });
    }

    function _meta() internal view returns (bytes memory) {
        return
            LocalCreReportFixture.metadata(policy.WORKFLOW_ID(), bytes10("unica-adm"), workflowOwner, bytes2(uint16(7)));
    }

    /// @dev Delivers through the fixture forwarder and asserts the measured Keystone semantics:
    ///      the forwarder call succeeds while the receiver rejected, and no admission exists.
    function _forwarderSucceedsReceiverRejects(
        string memory name,
        bytes memory metadata,
        bytes memory report,
        bytes32 nonce
    ) internal {
        vm.prank(workflowOwner);
        bool result = forwarder.route(address(policy), metadata, report);
        assertFalse(result, "the receiver must have rejected");
        assertFalse(policy.admissionOf(nonce).exists, "no admission may exist after a rejected report");
        // One case name for the whole class, because the trap is the same every time: the forwarder
        // transaction SUCCEEDS while the receiver rejected. The sub-case is the first reason code.
        console.log(
            string.concat(
                'ATTACK:{"case":"FORWARDER_SUCCESS_RECEIVER_REJECTED","decision":"REFUSED","reasonCodes":["',
                name,
                '","ReportProcessed(success=false), no admission"],"layer":"CRE_REPORT_VERIFICATION"}'
            )
        );
    }

    function test_Policy_Rejections() public {
        bytes32 nonce = keccak256("policy-attacks");
        UnicaPolicyTypes.AdmissionReport memory r = _report(nonce);
        uint8 v = policy.REPORT_SCHEMA_VERSION();

        _forwarderSucceedsReceiverRejects("EMPTY_REPORT", _meta(), "", nonce);

        vm.prank(attacker);
        (bool ok, bytes memory data) = address(policy)
            .call(abi.encodeWithSelector(policy.onReport.selector, _meta(), LocalCreReportFixture.encodeReport(v, r)));
        assertFalse(ok);
        assertEq(bytes4(data), bytes4(keccak256("NotForwarder()")));
        _refused("WRONG_FORWARDER", "NotForwarder", "CRE_REPORT_VERIFICATION");

        bytes memory badMeta = LocalCreReportFixture.metadata(
            keccak256("other workflow"), bytes10("unica-adm"), workflowOwner, bytes2(uint16(7))
        );
        _forwarderSucceedsReceiverRejects("WRONG_WORKFLOW", badMeta, LocalCreReportFixture.encodeReport(v, r), nonce);

        UnicaPolicyTypes.AdmissionReport memory r2 = _report(nonce);
        r2.receiver = attacker;
        _forwarderSucceedsReceiverRejects("WRONG_RECEIVER", _meta(), LocalCreReportFixture.encodeReport(v, r2), nonce);

        UnicaPolicyTypes.AdmissionReport memory r3 = _report(nonce);
        r3.chainId = 11155111;
        _forwarderSucceedsReceiverRejects(
            "WRONG_CHAIN_DOMAIN", _meta(), LocalCreReportFixture.encodeReport(v, r3), nonce
        );

        UnicaPolicyTypes.AdmissionReport memory r4 = _report(nonce);
        r4.policyExpiry = uint64(block.timestamp - 1);
        _forwarderSucceedsReceiverRejects("EXPIRED_REPORT", _meta(), LocalCreReportFixture.encodeReport(v, r4), nonce);

        _forwarderSucceedsReceiverRejects(
            "UNKNOWN_SCHEMA", _meta(), LocalCreReportFixture.encodeReport(v + 1, r), nonce
        );

        // the control: the honest report is accepted, then replay and same-nonce variants are refused
        vm.prank(workflowOwner);
        assertTrue(
            forwarder.route(address(policy), _meta(), LocalCreReportFixture.encodeReport(v, r)),
            "control: the honest report is accepted"
        );
        assertTrue(policy.admissionOf(nonce).exists);
        _forwarderSucceedsReceiverRejects(
            "REPLAYED_REPORT", _meta(), LocalCreReportFixture.encodeReport(v, r), keccak256("never-used")
        );
        UnicaPolicyTypes.AdmissionReport memory r5 = _report(nonce);
        r5.policyVersionHash = keccak256("policy/2");
        vm.prank(workflowOwner);
        assertFalse(forwarder.route(address(policy), _meta(), LocalCreReportFixture.encodeReport(v, r5)));
        _refused("WRONG_POLICY_VERSION_SAME_NONCE", "NonceAlreadyUsed", "CRE_REPORT_VERIFICATION");
        UnicaPolicyTypes.AdmissionReport memory r6 = _report(nonce);
        r6.privateInputCommitment = keccak256("other private input");
        vm.prank(workflowOwner);
        assertFalse(forwarder.route(address(policy), _meta(), LocalCreReportFixture.encodeReport(v, r6)));
        _refused("WRONG_PRIVATE_INPUT_COMMITMENT_SAME_NONCE", "NonceAlreadyUsed", "CRE_REPORT_VERIFICATION");
        _refused("FIXTURE_REPORT_IS_NOT_A_DON_REPORT", "LOCAL CRE REPORT FIXTURE label asserted", "LOCAL_FIXTURE_ONLY");
        assertTrue(
            _contains(forwarder.typeAndVersion(), "NOT A DON REPORT"), "the fixture forwarder must say what it is"
        );
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i = 0; i + n.length <= h.length; i++) {
            bool match_ = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) match_ = false;
                break;
            }
            if (match_) return true;
        }
        return false;
    }

    /// @dev One step inside the usable range on the side the swap moves towards.
    function _priceLimitFor(bool zeroForOne) internal pure returns (uint160) {
        if (zeroForOne) return TickMath.MIN_SQRT_PRICE + 1;
        return TickMath.MAX_SQRT_PRICE - 1;
    }
}
