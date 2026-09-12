// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {HookSalt} from "../../src/unica-v4/HookSalt.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";

import {UnicaMarketTypes} from "../../src/unica-v4/UnicaMarketTypes.sol";
import {UnicaMarketMath} from "../../src/unica-v4/UnicaMarketMath.sol";
import {UnicaMarketFactory} from "../../src/unica-v4/UnicaMarketFactory.sol";
import {UnicaMarketHook} from "../../src/unica-v4/UnicaMarketHook.sol";
import {IUnicaMarketRegistry} from "../../src/unica-v4/interfaces/IUnicaMarketRegistry.sol";
import {IUnicaOracleRoute, IUnicaPriceOracle} from "../../src/unica-v4/interfaces/IUnicaPriceOracle.sol";
import {ChainlinkFeedAdapter} from "../../src/unica-v4/oracle/ChainlinkFeedAdapter.sol";
import {AggregatorV3Interface} from "../../src/unica-v4/oracle/AggregatorV3Interface.sol";
import {UnicaPolicyReceiver} from "../../src/unica-v4/policy/UnicaPolicyReceiver.sol";
import {TerminalAdmission} from "../../src/identity/TerminalAdmission.sol";

/// @notice The one read this script makes of a forwarder before trusting it with a receiver.
interface ITypeAndVersion {
    function typeAndVersion() external view returns (string memory);
}

/// @title DeployPublic, the UNICA v4 stack onto a NAMED public chain, refused before signing if anything is off
/// @notice The same contracts the local suite proves (`script/anvil/`), with the fixtures replaced by
///         the real world: Chainlink feeds behind the real adapter, the chain's Keystone forwarder
///         behind the policy receiver, an ENSv2 authority adapter behind terminal admission. Nothing
///         is hard-coded: every value comes from `config/unica-v4/<chainId>.env` through the wrapper
///         `script/unica-v4/deploy-public.sh`, which is DRY-RUN by default and only ever broadcasts
///         from the owner's keystore, one stage at a time, with readback between stages.
///
///         REFUSALS, all before any state change:
///           - the endpoint's chain id differs from the configured one;
///           - a mainnet id without the acknowledgement phrase, without a CONTRACT as admin (a Safe,
///             rulings Q64/U6), without a pauser (Q70), or with the oracle requirement off;
///           - a feed whose `description()` starts with "FIXTURE ", or a forwarder whose
///             `typeAndVersion()` contains "FIXTURE": fixtures never leave the local chain;
///           - a token, feed, forwarder or PoolManager address with no code; decimals outside 0–18;
///           - a sequencer feed missing on a chain the configuration marks as an L2;
///           - a seed above the per-market cap, or an aggregate seed across the registry's live
///             markets above the configured total (ruling S5, an operator rule enforced here);
///           - a stage run out of order (each stage re-reads the registry's status first).
///
///         Stage letters follow docs/unica-v4/DEPLOYMENT-GATES.md: A infrastructure, B propose,
///         C open (initialise, seed, mark seeded), then `activate` after the owner's readback.
contract DeployPublic is Script {
    using PoolIdLibrary for PoolKey;

    uint160 internal constant HOOK_FLAGS =
        uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);

    struct Config {
        uint256 chainId;
        bool isMainnet;
        bool isL2;
        address admin;
        address pauser;
        address poolManager;
        address asset;
        address payout;
        address assetFeed;
        address quoteFeed;
        address sequencerFeed;
        uint256 gracePeriod;
        uint256 rateE18;
        uint24 fee;
        int24 tickSpacing;
        uint48 maxAge;
        uint16 maxDeviationBps;
        uint128 maxPerTx;
        uint128 maxPerDay;
        uint128 maxSeed;
        uint256 seedPayout;
        uint256 aggregateSeedCap;
        bool requireOracle;
        address forwarder;
        bytes32 workflowId;
        address workflowOwner;
        bytes32 releaseTag;
        address identityAuthority;
        bytes32 ensDeploymentId;
        string terminalStatusKey;
        string externalUrlBase;
        string rendererVersion;
        address deployer;
    }

    Config internal c;

    error WrongChain(uint256 expected, uint256 actual);
    error MainnetNotAcknowledged();
    error MainnetAdminMustBeAContract(address admin);
    error MainnetNeedsAPauser();
    error MainnetNeedsTheOracle();
    error NoCode(string what, address at);
    error FixtureRefused(string what, address at);
    error SequencerFeedRequired();
    error SeedAboveCap(uint256 seed, uint128 cap);
    error AggregateSeedAboveCap(uint256 total, uint256 cap);
    error WrongStage(uint8 status);
    error DecimalsOutOfRange(address token, uint8 decimals);

    // =========================================================================================
    // configuration
    // =========================================================================================

    function _load() internal {
        c.chainId = vm.envUint("UNICA_CHAIN_ID");
        c.isMainnet = vm.envBool("UNICA_IS_MAINNET");
        c.isL2 = vm.envBool("UNICA_IS_L2");
        c.admin = vm.envAddress("UNICA_ADMIN");
        c.pauser = vm.envOr("UNICA_PAUSER", address(0));
        c.poolManager = vm.envAddress("UNICA_POOL_MANAGER");
        c.asset = vm.envAddress("UNICA_ASSET");
        c.payout = vm.envAddress("UNICA_PAYOUT");
        c.assetFeed = vm.envAddress("UNICA_ASSET_FEED");
        c.quoteFeed = vm.envAddress("UNICA_QUOTE_FEED");
        c.sequencerFeed = vm.envOr("UNICA_SEQUENCER_FEED", address(0));
        c.gracePeriod = vm.envOr("UNICA_SEQUENCER_GRACE_PERIOD", uint256(3600));
        c.rateE18 = vm.envUint("UNICA_RATE_E18");
        c.fee = uint24(vm.envUint("UNICA_FEE"));
        c.tickSpacing = int24(vm.envInt("UNICA_TICK_SPACING"));
        c.maxAge = uint48(vm.envUint("UNICA_MAX_AGE"));
        c.maxDeviationBps = uint16(vm.envUint("UNICA_MAX_DEVIATION_BPS"));
        c.maxPerTx = uint128(vm.envUint("UNICA_MAX_PER_TX_PAYOUT"));
        c.maxPerDay = uint128(vm.envUint("UNICA_MAX_PER_DAY_PAYOUT"));
        c.maxSeed = uint128(vm.envUint("UNICA_MAX_SEED_PAYOUT"));
        c.seedPayout = vm.envUint("UNICA_SEED_PAYOUT");
        c.aggregateSeedCap = vm.envUint("UNICA_AGGREGATE_SEED_CAP");
        c.requireOracle = vm.envOr("UNICA_REQUIRE_ORACLE", true);
        c.forwarder = vm.envOr("UNICA_FORWARDER", address(0));
        c.workflowId = vm.envOr("UNICA_WORKFLOW_ID", bytes32(0));
        c.workflowOwner = vm.envOr("UNICA_WORKFLOW_OWNER", address(0));
        c.releaseTag = keccak256(bytes(vm.envString("UNICA_RELEASE_TAG")));
        c.identityAuthority = vm.envOr("UNICA_IDENTITY_AUTHORITY", address(0));
        c.ensDeploymentId = vm.envOr("UNICA_ENS_DEPLOYMENT_ID", bytes32(0));
        c.terminalStatusKey = vm.envOr("UNICA_TERMINAL_STATUS_KEY", string("com.unica.terminal-status"));
        c.externalUrlBase = vm.envOr("UNICA_EXTERNAL_URL_BASE", string(""));
        c.rendererVersion = vm.envOr("UNICA_RENDERER_VERSION", string("unica-identity-svg/1"));
        c.deployer = vm.envAddress("DEPLOYER");
        _guards();
    }

    /// @dev Every refusal that needs no deployed UNICA contract to evaluate.
    function _guards() internal view {
        if (block.chainid != c.chainId) revert WrongChain(c.chainId, block.chainid);
        if (c.isMainnet) {
            if (
                keccak256(bytes(vm.envOr("UNICA_MAINNET_ACK", string("")))) != keccak256("I_UNDERSTAND_THIS_IS_MAINNET")
            ) {
                revert MainnetNotAcknowledged();
            }
            if (c.admin.code.length == 0) revert MainnetAdminMustBeAContract(c.admin);
            if (c.pauser == address(0)) revert MainnetNeedsAPauser();
            if (!c.requireOracle) revert MainnetNeedsTheOracle();
        }
        if (c.poolManager.code.length == 0) revert NoCode("PoolManager", c.poolManager);
        if (c.asset.code.length == 0) revert NoCode("asset", c.asset);
        if (c.payout.code.length == 0) revert NoCode("payout", c.payout);
        _checkDecimals(c.asset);
        _checkDecimals(c.payout);
        if (c.requireOracle) {
            _checkFeed("asset feed", c.assetFeed);
            _checkFeed("quote feed", c.quoteFeed);
            if (c.isL2 && c.sequencerFeed == address(0)) revert SequencerFeedRequired();
            if (c.sequencerFeed != address(0)) _checkFeed("sequencer feed", c.sequencerFeed);
        }
        if (c.forwarder != address(0)) {
            if (c.forwarder.code.length == 0) revert NoCode("forwarder", c.forwarder);
            if (_contains(ITypeAndVersion(c.forwarder).typeAndVersion(), "FIXTURE")) {
                revert FixtureRefused("forwarder", c.forwarder);
            }
        }
        if (c.seedPayout > c.maxSeed) revert SeedAboveCap(c.seedPayout, c.maxSeed);
    }

    function _checkDecimals(address token) internal view {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || data.length != 32) revert NoCode("token decimals()", token);
        uint8 dec = abi.decode(data, (uint8));
        if (dec > 18) revert DecimalsOutOfRange(token, dec);
    }

    function _checkFeed(string memory what, address feed) internal view {
        if (feed.code.length == 0) revert NoCode(what, feed);
        string memory description = AggregatorV3Interface(feed).description();
        if (_startsWith(description, "FIXTURE ")) revert FixtureRefused(what, feed);
        (, int256 answer,, uint256 updatedAt,) = AggregatorV3Interface(feed).latestRoundData();
        console.log(
            string.concat(
                what, ": ", description, " answer ", vm.toString(answer), " updatedAt ", vm.toString(updatedAt)
            )
        );
    }

    // =========================================================================================
    // preflight: read everything, print the plan, change nothing
    // =========================================================================================

    function preflight() external {
        _load();
        console.log("== UNICA v4 public deployment preflight: every row read from the chain now");
        console.log(
            string.concat("chain            ", vm.toString(block.chainid), c.isMainnet ? "  (MAINNET)" : "  (testnet)")
        );
        console.log(
            string.concat(
                "admin            ", vm.toString(c.admin), c.admin.code.length > 0 ? "  (contract)" : "  (EOA)"
            )
        );
        console.log(string.concat("pauser           ", vm.toString(c.pauser)));
        console.log(
            string.concat("deployer         ", vm.toString(c.deployer), "  balance ", vm.toString(c.deployer.balance))
        );
        console.log(
            string.concat(
                "PoolManager      ", vm.toString(c.poolManager), "  codehash ", vm.toString(c.poolManager.codehash)
            )
        );
        console.log(string.concat("asset / payout   ", vm.toString(c.asset), " / ", vm.toString(c.payout)));
        console.log(
            string.concat(
                "rateE18          ",
                vm.toString(c.rateE18),
                "  fee ",
                vm.toString(uint256(c.fee)),
                "  spacing ",
                vm.toString(c.tickSpacing)
            )
        );
        console.log(
            string.concat(
                "oracle           maxAge ",
                vm.toString(uint256(c.maxAge)),
                "s  band ",
                vm.toString(uint256(c.maxDeviationBps)),
                " bps  required ",
                c.requireOracle ? "yes" : "NO"
            )
        );
        console.log(
            string.concat(
                "caps             tx ",
                vm.toString(c.maxPerTx),
                "  day ",
                vm.toString(c.maxPerDay),
                "  seed ",
                vm.toString(c.maxSeed),
                "  aggregate ",
                vm.toString(c.aggregateSeedCap)
            )
        );
        console.log(string.concat("hook code hash   ", vm.toString(keccak256(type(UnicaMarketHook).creationCode))));
        console.log(string.concat("forwarder        ", vm.toString(c.forwarder)));
        console.log(string.concat("identity auth.   ", vm.toString(c.identityAuthority)));
        console.log("preflight: go");
    }

    // =========================================================================================
    // stage A: infrastructure (adapter, factory + registry, policy receiver, admission, badge)
    // =========================================================================================

    function stageA() external {
        _load();
        vm.startBroadcast(c.deployer);
        address adapter;
        if (c.requireOracle) {
            adapter = address(
                new ChainlinkFeedAdapter(c.assetFeed, c.quoteFeed, c.asset, c.payout, c.sequencerFeed, c.gracePeriod)
            );
        }
        UnicaMarketFactory factory = new UnicaMarketFactory(
            c.admin, IPoolManager(c.poolManager), keccak256(type(UnicaMarketHook).creationCode), c.requireOracle
        );
        address registry = address(factory.REGISTRY());
        address policyReceiver;
        if (c.forwarder != address(0)) {
            policyReceiver =
                address(new UnicaPolicyReceiver(c.forwarder, registry, c.releaseTag, c.workflowId, c.workflowOwner, 1));
        }
        address admission;
        if (c.identityAuthority != address(0)) {
            admission = address(
                new TerminalAdmission(
                    c.identityAuthority, registry, c.ensDeploymentId, policyReceiver, c.terminalStatusKey
                )
            );
        }
        address badge = _deployBadge(registry);
        vm.stopBroadcast();

        _emit("STAGE_A", "oracleAdapter", vm.toString(adapter));
        _emit("STAGE_A", "factory", vm.toString(address(factory)));
        _emit("STAGE_A", "registry", vm.toString(registry));
        _emit("STAGE_A", "policyReceiver", vm.toString(policyReceiver));
        _emit("STAGE_A", "terminalAdmission", vm.toString(admission));
        _emit("STAGE_A", "identityToken", vm.toString(badge));
        _emit("STAGE_A", "hookCreationCodeHash", vm.toString(keccak256(type(UnicaMarketHook).creationCode)));
    }

    /// @dev The Vyper identity token, when the wrapper supplies its bytecode (compiled with the
    ///      pinned Vyper). The authority is the ENSv2 authority adapter; the registry pointer is
    ///      the market registry of this release, so a badge names the release it belongs to.
    function _deployBadge(address registry) internal returns (address token) {
        bytes memory bytecode = vm.envOr("IDENTITY_TOKEN_BYTECODE", bytes(""));
        if (bytecode.length == 0 || c.identityAuthority == address(0)) return address(0);
        bytes memory initcode = abi.encodePacked(
            bytecode,
            abi.encode(c.admin, c.identityAuthority, registry, c.ensDeploymentId, c.rendererVersion, c.externalUrlBase)
        );
        assembly ("memory-safe") {
            token := create(0, add(initcode, 0x20), mload(initcode))
        }
        require(token != address(0), "identity token creation failed");
    }

    // =========================================================================================
    // stage B: propose the market at a mined salt, under the aggregate seed cap
    // =========================================================================================

    struct Proposed {
        bytes32 marketId;
        address hook;
        address executor;
        bytes32 salt;
        bytes32 feedId;
    }

    function stageB() external {
        _load();
        UnicaMarketFactory factory = UnicaMarketFactory(vm.envAddress("UNICA_FACTORY"));
        _requireAggregateSeedCap(IUnicaMarketRegistry(address(factory.REGISTRY())));
        UnicaMarketTypes.MarketConfig memory cfg = _marketConfig();
        Proposed memory p = _propose(factory, cfg);
        _emit("STAGE_B", "marketId", vm.toString(p.marketId));
        _emit("STAGE_B", "hook", vm.toString(p.hook));
        _emit("STAGE_B", "executor", vm.toString(p.executor));
        _emit("STAGE_B", "salt", vm.toString(p.salt));
        _emit("STAGE_B", "poolId", vm.toString(PoolId.unwrap(factory.poolKeyOf(p.marketId).toId())));
        _emit("STAGE_B", "feedId", vm.toString(p.feedId));
    }

    function _marketConfig() internal view returns (UnicaMarketTypes.MarketConfig memory cfg) {
        address adapter = vm.envOr("UNICA_ORACLE_ADAPTER", address(0));
        cfg = UnicaMarketTypes.MarketConfig({
            asset: c.asset,
            payout: c.payout,
            rateE18: c.rateE18,
            fee: c.fee,
            tickSpacing: c.tickSpacing,
            policy: UnicaMarketTypes.OraclePolicy({
                adapter: adapter,
                feedId: adapter == address(0) ? bytes32(0) : IUnicaOracleRoute(adapter).feedIdFor(c.asset, c.payout),
                maxAge: c.maxAge,
                maxDeviationBps: c.maxDeviationBps,
                enabled: adapter != address(0)
            }),
            caps: UnicaMarketTypes.Caps({
                maxPerTxPayout: c.maxPerTx, maxPerDayPayout: c.maxPerDay, maxSeedPayout: c.maxSeed
            })
        });
    }

    /// @dev Mines the salt against the exact bytes the factory will deploy, creates the market, and
    ///      proves the preview and the creation agree.
    function _propose(UnicaMarketFactory factory, UnicaMarketTypes.MarketConfig memory cfg)
        internal
        returns (Proposed memory p)
    {
        bytes memory creationCode = type(UnicaMarketHook).creationCode;
        (bytes32 previewId,, bytes memory hookArgs,) = factory.previewMarket(cfg);
        (address predicted, bytes32 salt) = HookSalt.find(address(factory), HOOK_FLAGS, creationCode, hookArgs);
        vm.startBroadcast(c.deployer);
        (p.marketId, p.hook, p.executor) = factory.createMarket(cfg, salt, creationCode);
        vm.stopBroadcast();
        require(p.marketId == previewId && p.hook == predicted, "preview and creation disagree");
        p.salt = salt;
        p.feedId = cfg.policy.feedId;
    }

    /// @dev Ruling S5: the aggregate seed across live markets is an operator rule, enforced here by
    ///      enumerating the registry. Any inability to enumerate fails closed (the calls revert).
    function _requireAggregateSeedCap(IUnicaMarketRegistry registry) internal view {
        uint256 total = c.maxSeed;
        uint256 n = registry.marketCount();
        for (uint256 i = 0; i < n; i++) {
            bytes32 id = registry.marketIdAt(i);
            if (registry.statusOf(id) == uint8(UnicaMarketTypes.MarketStatus.RETIRED)) continue;
            total += registry.capsOf(id).maxSeedPayout;
        }
        if (total > c.aggregateSeedCap) revert AggregateSeedAboveCap(total, c.aggregateSeedCap);
    }

    // =========================================================================================
    // stage C: initialise, seed the band-width range, prove SEEDED
    // =========================================================================================

    struct SeedPlan {
        int24 lower;
        int24 upper;
        uint128 liquidity;
        int24 initTick;
    }

    function stageC() external {
        _load();
        UnicaMarketFactory factory = UnicaMarketFactory(vm.envAddress("UNICA_FACTORY"));
        bytes32 marketId = vm.envBytes32("UNICA_MARKET_ID");
        SeedPlan memory plan = _seedPlan(factory, marketId);
        require(IERC20Minimal(c.payout).balanceOf(c.deployer) >= c.seedPayout, "the deployer does not hold the seed");

        vm.startBroadcast(c.deployer);
        int24 tick = factory.initializeMarket(marketId);
        PoolModifyLiquidityTest router = new PoolModifyLiquidityTest(IPoolManager(c.poolManager));
        IERC20Minimal(c.asset).approve(address(router), type(uint256).max);
        IERC20Minimal(c.payout).approve(address(router), type(uint256).max);
        router.modifyLiquidity(
            factory.poolKeyOf(marketId),
            ModifyLiquidityParams({
                tickLower: plan.lower, tickUpper: plan.upper, liquidityDelta: int256(uint256(plan.liquidity)), salt: 0
            }),
            ""
        );
        uint128 depth = factory.markSeeded(marketId, 1);
        vm.stopBroadcast();
        require(tick == plan.initTick, "opening tick disagrees with the record");
        _emitStageC(factory, marketId, plan, depth, address(router));
    }

    /// @dev The band-width range on the payout side and the liquidity that puts exactly the
    ///      configured seed there, computed before any transaction.
    function _seedPlan(UnicaMarketFactory factory, bytes32 marketId) internal view returns (SeedPlan memory plan) {
        UnicaMarketTypes.Market memory m = IUnicaMarketRegistry(address(factory.REGISTRY())).getMarket(marketId);
        if (m.status != UnicaMarketTypes.MarketStatus.PROPOSED) revert WrongStage(uint8(m.status));
        int24 width = UnicaMarketMath.seedWidth(c.tickSpacing, !m.demonstrationOnly, c.maxDeviationBps);
        (plan.lower, plan.upper) = UnicaMarketMath.seedRange(m.initTick, width, m.assetIsCurrency0);
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(plan.lower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(plan.upper);
        plan.liquidity = m.assetIsCurrency0
            ? LiquidityAmounts.getLiquidityForAmount1(sqrtLower, sqrtUpper, c.seedPayout)
            : LiquidityAmounts.getLiquidityForAmount0(sqrtLower, sqrtUpper, c.seedPayout);
        plan.initTick = m.initTick;
    }

    function _emitStageC(
        UnicaMarketFactory factory,
        bytes32 marketId,
        SeedPlan memory plan,
        uint128 depth,
        address router
    ) internal view {
        _emit("STAGE_C", "tickLower", vm.toString(plan.lower));
        _emit("STAGE_C", "tickUpper", vm.toString(plan.upper));
        _emit("STAGE_C", "liquidity", vm.toString(plan.liquidity));
        _emit("STAGE_C", "depthAtOpeningTick", vm.toString(depth));
        _emit("STAGE_C", "seedPayout", vm.toString(c.seedPayout));
        _emit("STAGE_C", "liquidityRouter", vm.toString(router));
        _emit("STAGE_C", "status", vm.toString(IUnicaMarketRegistry(address(factory.REGISTRY())).statusOf(marketId)));
    }

    // =========================================================================================
    // activate: only after the owner's readback of stage C (ruling Q115)
    // =========================================================================================

    function activate() external {
        _load();
        IUnicaMarketRegistry registry = IUnicaMarketRegistry(vm.envAddress("UNICA_REGISTRY"));
        bytes32 marketId = vm.envBytes32("UNICA_MARKET_ID");
        address admission = vm.envOr("UNICA_ADMISSION", address(0));
        if (registry.statusOf(marketId) != uint8(UnicaMarketTypes.MarketStatus.SEEDED)) {
            revert WrongStage(registry.statusOf(marketId));
        }
        vm.startBroadcast(c.admin);
        if (c.pauser != address(0)) registry.setPauser(c.pauser);
        if (admission != address(0)) registry.setOrderCreator(admission, true);
        registry.activate(marketId);
        vm.stopBroadcast();
        _emit("ACTIVATE", "status", vm.toString(registry.statusOf(marketId)));
        _emit("ACTIVATE", "pauser", vm.toString(c.pauser));
        _emit("ACTIVATE", "orderCreator", vm.toString(admission));
    }

    // =========================================================================================
    // readback: what the chain says, for the owner to compare with the plan
    // =========================================================================================

    function readback() external {
        _load();
        UnicaMarketFactory factory = UnicaMarketFactory(vm.envAddress("UNICA_FACTORY"));
        IUnicaMarketRegistry registry = IUnicaMarketRegistry(address(factory.REGISTRY()));
        bytes32 marketId = vm.envBytes32("UNICA_MARKET_ID");
        UnicaMarketTypes.Market memory m = registry.getMarket(marketId);
        UnicaMarketTypes.OraclePolicy memory p = registry.oraclePolicyOf(marketId);
        _emit("READBACK", "registryFactory", vm.toString(registry.FACTORY()));
        _emit("READBACK", "admin", vm.toString(registry.admin()));
        _emit("READBACK", "pauser", vm.toString(registry.pauser()));
        _emit("READBACK", "requireOracle", registry.REQUIRE_ORACLE() ? "true" : "false");
        _emit("READBACK", "status", vm.toString(uint8(m.status)));
        _emit("READBACK", "hook", vm.toString(m.hook));
        _emit("READBACK", "hookBitsOk", (uint160(m.hook) & Hooks.ALL_HOOK_MASK) == HOOK_FLAGS ? "true" : "false");
        _emit("READBACK", "executor", vm.toString(m.executor));
        _emit("READBACK", "marketIdOfHook", vm.toString(registry.marketIdOfHook(m.hook)));
        _emit("READBACK", "marketIdOfExecutor", vm.toString(registry.marketIdOfExecutor(m.executor)));
        _emit("READBACK", "marketIdOfPool", vm.toString(registry.marketIdOfPool(m.poolId)));
        _emit("READBACK", "feedIdPolicy", vm.toString(p.feedId));
        if (p.adapter != address(0)) {
            _emit("READBACK", "feedIdAdapter", vm.toString(IUnicaOracleRoute(p.adapter).feedIdFor(m.asset, m.payout)));
            (uint256 price, uint8 dec, uint256 updatedAt) = IUnicaPriceOracle(p.adapter).latestPrice(m.asset, m.payout);
            _emit("READBACK", "price", vm.toString(price));
            _emit("READBACK", "priceDecimals", vm.toString(uint256(dec)));
            _emit("READBACK", "priceUpdatedAt", vm.toString(updatedAt));
        }
        (uint160 sqrtPrice, int24 tick,,) = StateLibrary.getSlot0(IPoolManager(c.poolManager), PoolId.wrap(m.poolId));
        _emit("READBACK", "slot0SqrtPrice", vm.toString(sqrtPrice));
        _emit("READBACK", "slot0Tick", vm.toString(tick));
        _emit("READBACK", "initSqrtPrice", vm.toString(m.initSqrtPriceX96));
        _emit("READBACK", "initTick", vm.toString(m.initTick));
        _emit("READBACK", "seedDepth", vm.toString(m.seedDepth));
    }

    // =========================================================================================
    // helpers
    // =========================================================================================

    function _emit(string memory prefix, string memory k, string memory v) internal pure {
        console.log(string.concat(prefix, ':"', k, '":"', v, '",'));
    }

    function _startsWith(string memory s, string memory prefix) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(prefix);
        if (b.length > a.length) return false;
        for (uint256 i = 0; i < b.length; i++) {
            if (a[i] != b[i]) return false;
        }
        return true;
    }

    function _contains(string memory s, string memory needle) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(needle);
        if (b.length > a.length) return false;
        for (uint256 i = 0; i + b.length <= a.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < b.length; j++) {
                if (a[i + j] != b[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}
