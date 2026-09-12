// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {HookSalt} from "../../src/unica-v4/HookSalt.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {V4PoolManagerDeployer} from "hookmate/artifacts/V4PoolManager.sol";

import {UnicaMarketTypes} from "../../src/unica-v4/UnicaMarketTypes.sol";
import {UnicaMarketMath} from "../../src/unica-v4/UnicaMarketMath.sol";
import {UnicaMarketFactory} from "../../src/unica-v4/UnicaMarketFactory.sol";
import {UnicaMarketHook} from "../../src/unica-v4/UnicaMarketHook.sol";
import {IUnicaMarketRegistry} from "../../src/unica-v4/interfaces/IUnicaMarketRegistry.sol";
import {IUnicaMarketExecutor} from "../../src/unica-v4/interfaces/IUnicaMarketExecutor.sol";
import {IUnicaOracleRoute} from "../../src/unica-v4/interfaces/IUnicaPriceOracle.sol";
import {ChainlinkFeedAdapter} from "../../src/unica-v4/oracle/ChainlinkFeedAdapter.sol";
import {UnicaPolicyReceiver} from "../../src/unica-v4/policy/UnicaPolicyReceiver.sol";
import {LocalKeystoneForwarderFixture} from "../../src/unica-v4/policy/LocalKeystoneForwarderFixture.sol";
import {LocalCreReportFixture} from "../../src/unica-v4/policy/LocalCreReportFixture.sol";
import {UnicaPolicyTypes} from "../../src/unica-v4/policy/UnicaPolicyTypes.sol";
import {LocalEnsV2Fixture} from "../../src/identity/LocalEnsV2Fixture.sol";
import {TerminalAdmission} from "../../src/identity/TerminalAdmission.sol";
import {MerchantOnboarding} from "../../src/identity/MerchantOnboarding.sol";
import {DirectSettlement} from "../../src/unica-v5/DirectSettlement.sol";
import {IDirectSettlement} from "../../src/unica-v5/IDirectSettlement.sol";
import {IProductCatalog} from "../../src/unica-v5/IProductCatalog.sol";
import {ProductCatalog} from "../../src/unica-v5/ProductCatalog.sol";
import {IMerchantOnboarding} from "../../src/identity/IMerchantOnboarding.sol";
import {FixtureAggregator} from "../../test/unica-v4/fixtures/FixtureAggregator.sol";
import {LookalikeFactory} from "../../test/unica-v4/fixtures/LookalikeFactory.sol";

/// @notice The read-only surface of the identity token this script uses after deploying its
///         bytecode. There is deliberately no `mint` here: only `MerchantOnboarding` may mint, and
///         a mint entry point on this script would be a second way to hand out a badge.
interface IIdentityToken {
    function tokenURI(uint256 tokenId) external view returns (string memory);
    function ownerOf(uint256 tokenId) external view returns (address);
    function token_of_node(bytes32 node) external view returns (uint256);
}

/// @title AnvilLocal, the complete UNICA vertical slice on a local Anvil chain, and nothing else
/// @notice LOCAL_ANVIL_NO_VALUE. Every entry point refuses any chain but 31337, so this file cannot
///         reach a public network by accident. Accounts are Anvil's default unlocked accounts,
///         handed in by address through the environment (`script/anvil/env.sh`) and impersonated
///         with `--unlocked`; nothing in this repository signs.
///
///         Four entry points, one per `make anvil-*` stage, so a stage can be re-run and inspected:
///           deploy() — Uniswap's OFFICIAL PoolManager bytecode, two test tokens, the fixture price
///                      feeds behind the REAL ChainlinkFeedAdapter, the UNICA v4 factory + registry,
///                      one registered market (PROPOSED), the local ENSv2-compatible identity fixture
///                      holding the PARENT name only, the self-serve onboarding door, the identity
///                      NFT (Vyper bytecode supplied by the wrapper) whose minter is that door, the
///                      CRE policy receiver behind a local forwarder fixture, the terminal-admission
///                      gate, and a look-alike hook behind a spoofed registry.
///           join()   — the barbershop joins from ITS OWN wallet through that same door, exactly as
///                      any business would: name, payout record, terminals branch, first register,
///                      badge. The script registers nothing on the business's behalf.
///           seed()   — initialise the pool at the recorded opening price, add the capped no-value
///                      seed over the band-width range, prove SEEDED from PoolManager state, ACTIVATE.
///           demo()   — read the badge back, revoke the lost terminal, refresh the fixture feeds,
///                      deliver the LOCAL CRE REPORT FIXTURE, admit the order through the active
///                      terminal. The payment itself and every expected refusal run from the wrapper
///                      so their transaction hashes and revert selectors are captured as evidence.
///
///         Fixture facts, labelled as such: the price feeds are settable stand-ins (their
///         `description()` starts with "FIXTURE "), the $5-equivalent seed is a DEMONSTRATION cap
///         and never production liquidity, the CRE report is generated locally and is NOT A DON
///         REPORT, the identity fixture mirrors the measured ENSv2 access-control shape and is not
///         the hosted Sepolia deployment. Nothing here has value.
contract AnvilLocal is Script {
    using PoolIdLibrary for PoolKey;

    uint256 internal constant LOCAL_CHAIN = 31337;
    uint160 internal constant HOOK_FLAGS =
        uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);

    // ---- market shape: a demonstration rate the admin sets, never a market price ---------------
    uint256 internal constant RATE_E18 = 2e18; // 2 uUSD per 1 tAST
    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    uint48 internal constant MAX_AGE = 300;
    uint16 internal constant MAX_DEVIATION_BPS = 200;
    uint128 internal constant MAX_PER_TX = 10_000_000; // $10 in 6-decimal payout units
    uint128 internal constant MAX_PER_DAY = 25_000_000; // $25
    uint128 internal constant MAX_SEED = 5_000_000; // $5 demonstration cap
    uint256 internal constant SEED_PAYOUT = 4_900_000; // just under the cap, on the payout side

    // ---- the barbershop -----------------------------------------------------------------------
    string internal constant MERCHANT_NAME = "freshcuts.unica.eth";
    /// @dev The parent every business joins under. `PARENT_NAME` must be the dotted form of the
    ///      node built as `eth` -> `unica`, or `MerchantOnboarding`'s constructor refuses the pair.
    string internal constant PARENT_NAME = "unica.eth";
    string internal constant MERCHANT_LABEL = "freshcuts";
    string internal constant FIRST_TERMINAL_LABEL = "chair-1";
    string internal constant TERMINAL_STATUS_KEY = "com.unica.terminal-status";
    string internal constant RENDERER_VERSION = "unica-identity-svg/1";
    string internal constant EXTERNAL_URL_BASE = "https://nfteria.github.io/unica/identity/";
    bytes32 internal constant UNICA_RELEASE = keccak256("UNICA-V4-LOCAL-ANVIL");
    bytes32 internal constant WORKFLOW_ID = keccak256("unica-confidential-admission/1");
    uint8 internal constant REPORT_SCHEMA_VERSION = 1;

    struct Accounts {
        address admin;
        address merchantOwner;
        address merchantPayout;
        address payer;
        address wrongPayer;
        address opChair1;
        address opLostTablet;
        address seeder;
        address attacker;
        address workflowOwner;
    }

    struct Deployed {
        address poolManager;
        address asset;
        address payout;
        address assetUsdFeed;
        address payoutUsdFeed;
        address adapter;
        address factory;
        address registry;
        address hook;
        address executor;
        bytes32 marketId;
        bytes32 poolId;
        bytes32 feedId;
        bytes32 hookSalt;
        address identity;
        address onboarding;
        address identityToken;
        address forwarder;
        address policyReceiver;
        address admission;
        address lookalikeFactory;
        address lookalikeHook;
        address lookalikeExecutor;
        address directSettlement;
        address directAdmission;
        address productCatalog;
        bytes32 catalogId;
        address lookalikeCatalog;
        bytes32 ensDeploymentId;
        bytes32 rootNode;
        bytes32 unicaNode;
        bytes32 merchantNode;
        bytes32 terminalsNode;
        bytes32 chair1Node;
        bytes32 lostTabletNode;
        bytes32 agentNode;
    }

    Accounts internal a;
    Deployed internal d;

    error NotLocalChain(uint256 chainId);

    modifier localOnly() {
        if (block.chainid != LOCAL_CHAIN) revert NotLocalChain(block.chainid);
        _;
    }

    // =========================================================================================
    // stage 1: deploy
    // =========================================================================================

    function deploy() external localOnly {
        _readAccounts();
        _deployInfrastructure();
        _deployMarket();
        _deployIdentity();
        _deployIdentityToken();
        _deployPolicy();
        _deployAdmission();
        _deployDirect();
        _deployCatalog();
        _deployLookalike();
        _deployLookalikeCatalog();
        _printManifest();
    }

    function _readAccounts() internal {
        a = Accounts({
            admin: vm.envAddress("ANVIL_ADMIN"),
            merchantOwner: vm.envAddress("ANVIL_MERCHANT_OWNER"),
            merchantPayout: vm.envAddress("ANVIL_MERCHANT_PAYOUT"),
            payer: vm.envAddress("ANVIL_PAYER"),
            wrongPayer: vm.envAddress("ANVIL_WRONG_PAYER"),
            opChair1: vm.envAddress("ANVIL_OP_CHAIR1"),
            opLostTablet: vm.envAddress("ANVIL_OP_LOST_TABLET"),
            seeder: vm.envAddress("ANVIL_SEEDER"),
            attacker: vm.envAddress("ANVIL_ATTACKER"),
            workflowOwner: vm.envAddress("ANVIL_WORKFLOW_OWNER")
        });
    }

    /// @dev Uniswap's official PoolManager creation code from hookmate's artifact, owned by the
    ///      admin so protocol-fee rows can be exercised locally; two solmate test tokens; two
    ///      fixture feeds behind the REAL Chainlink feed adapter.
    function _deployInfrastructure() internal {
        vm.startBroadcast(a.admin);
        bytes memory initcode = abi.encodePacked(V4PoolManagerDeployer.initcode(), abi.encode(a.admin));
        address pm;
        assembly ("memory-safe") {
            pm := create(0, add(initcode, 0x20), mload(initcode))
        }
        require(pm != address(0), "PoolManager creation failed");
        d.poolManager = pm;

        MockERC20 asset = new MockERC20("UNICA test asset (no value)", "tAST", 18);
        MockERC20 payout = new MockERC20("UNICA test dollar (no value)", "uUSD", 6);
        d.asset = address(asset);
        d.payout = address(payout);
        asset.mint(a.payer, 1_000e18);
        asset.mint(a.wrongPayer, 1_000e18);
        asset.mint(a.attacker, 1_000e18);
        asset.mint(a.seeder, 1_000e18);
        payout.mint(a.seeder, 1_000_000e6);
        payout.mint(a.attacker, 1_000_000e6);
        // A same-asset sale is paid in the very asset the business is paid out in, so the two
        // customer wallets hold the local test dollar as well as the test asset. Without this the
        // direct path would fail on an empty wallet and look like a settlement defect.
        payout.mint(a.payer, 1_000e6);
        payout.mint(a.wrongPayer, 1_000e6);

        FixtureAggregator assetUsd = new FixtureAggregator(8, "FIXTURE tAST / USD - LOCAL ANVIL - NO VALUE");
        FixtureAggregator payoutUsd = new FixtureAggregator(8, "FIXTURE uUSD / USD - LOCAL ANVIL - NO VALUE");
        assetUsd.set(2e8, block.timestamp - 1, 1, 1);
        payoutUsd.set(1e8, block.timestamp - 1, 1, 1);
        d.assetUsdFeed = address(assetUsd);
        d.payoutUsdFeed = address(payoutUsd);

        // The two freshness bounds are DEMONSTRATION values for a local chain whose fixture feeds are
        // poked by this script, chosen only to show the shape of a fast asset leg and a slow quote
        // leg. Neither 300 nor 86400 is an approved production constant: a public deployment reads
        // the real feed's heartbeat and sets its own (docs/unica-v4/ORACLE-FRESHNESS-O2.md).
        d.adapter = address(
            new ChainlinkFeedAdapter(
                address(assetUsd),
                uint48(300),
                address(payoutUsd),
                uint48(86_400),
                d.asset,
                d.payout,
                address(0),
                0,
                // The local admin is also the account allowed to tighten the quote leg during an
                // incident. The market's own policy ceiling reaches the asset leg only, so without
                // this the local demonstration would have no lever over the slow leg at all.
                a.admin
            )
        );
        vm.stopBroadcast();
    }

    /// @dev The factory creates the registry; the market is created at a mined salt so the hook
    ///      lands with exactly the 0x20C0 permission bits; the oracle route is bound into marketId.
    function _deployMarket() internal {
        vm.startBroadcast(a.admin);
        bytes memory creationCode = type(UnicaMarketHook).creationCode;
        UnicaMarketFactory factory =
            new UnicaMarketFactory(a.admin, IPoolManager(d.poolManager), keccak256(creationCode), true);
        d.factory = address(factory);
        d.registry = address(factory.REGISTRY());

        d.feedId = IUnicaOracleRoute(d.adapter).feedIdFor(d.asset, d.payout);
        UnicaMarketTypes.MarketConfig memory cfg = _config();
        (bytes32 marketId,, bytes memory hookArgs,) = factory.previewMarket(cfg);
        (address predicted, bytes32 salt) = HookSalt.find(d.factory, HOOK_FLAGS, creationCode, hookArgs);
        (bytes32 id, address hook, address executor) = factory.createMarket(cfg, salt, creationCode);
        require(id == marketId && hook == predicted, "preview and creation disagree");
        d.marketId = id;
        d.hook = hook;
        d.executor = executor;
        d.hookSalt = salt;
        d.poolId = PoolId.unwrap(factory.poolKeyOf(id).toId());
        vm.stopBroadcast();
    }

    function _config() internal view returns (UnicaMarketTypes.MarketConfig memory cfg) {
        cfg = UnicaMarketTypes.MarketConfig({
            asset: d.asset,
            payout: d.payout,
            rateE18: RATE_E18,
            fee: FEE,
            tickSpacing: TICK_SPACING,
            policy: UnicaMarketTypes.OraclePolicy({
                adapter: d.adapter, feedId: d.feedId, maxAge: MAX_AGE, maxDeviationBps: MAX_DEVIATION_BPS, enabled: true
            }),
            caps: UnicaMarketTypes.Caps({
                maxPerTxPayout: MAX_PER_TX, maxPerDayPayout: MAX_PER_DAY, maxSeedPayout: MAX_SEED
            })
        });
    }

    /// @dev The parent only. `eth` -> `unica.eth` held by the admin, and the self-serve door
    ///      (`MerchantOnboarding`) granted the ONE standing role it ever holds: SET_SUBREGISTRY at
    ///      the parent, so it can register a business's name when that business asks it to.
    ///      Nothing about the barbershop is registered here: the barbershop joins in `join()`,
    ///      through the same door and from the same kind of wallet a real business would use, so
    ///      the demo cannot pass on a tree the script hand-built and the door never had to produce.
    function _deployIdentity() internal {
        vm.startBroadcast(a.admin);
        LocalEnsV2Fixture identity = new LocalEnsV2Fixture();
        d.identity = address(identity);
        d.rootNode = identity.createRoot("eth");
        d.unicaNode = identity.register(d.rootNode, "unica", a.admin);
        MerchantOnboarding onboarding =
            new MerchantOnboarding(d.identity, d.unicaNode, PARENT_NAME, a.admin, TERMINAL_STATUS_KEY);
        d.onboarding = address(onboarding);
        identity.authorizeNameRoles(d.unicaNode, identity.ROLE_SET_SUBREGISTRY(), d.onboarding, true);
        vm.stopBroadcast();

        // Locally the identity fixture stands in for the Universal Resolver entry point in the id.
        d.ensDeploymentId = keccak256(abi.encode(block.chainid, d.identity));
    }

    /// @dev The Vyper identity token: the wrapper compiles `vy/src/art/identity_token.vy` with the
    ///      pinned compiler and hands the bytecode in; the constructor arguments are appended here
    ///      because two of them are addresses this very run created. The MINTER is the onboarding
    ///      door, not the admin, because the badge is part of joining: no human hands one out.
    ///      `linkBadge` is the admin's only power over the door and can be used exactly once.
    function _deployIdentityToken() internal {
        bytes memory bytecode = vm.envBytes("IDENTITY_TOKEN_BYTECODE");
        bytes memory initcode = abi.encodePacked(
            bytecode,
            abi.encode(d.onboarding, d.identity, d.identity, d.ensDeploymentId, RENDERER_VERSION, EXTERNAL_URL_BASE)
        );
        vm.startBroadcast(a.admin);
        address token;
        assembly ("memory-safe") {
            token := create(0, add(initcode, 0x20), mload(initcode))
        }
        vm.stopBroadcast();
        require(token != address(0), "identity token creation failed");
        d.identityToken = token;

        vm.startBroadcast(a.admin);
        MerchantOnboarding(d.onboarding).linkBadge(token);
        vm.stopBroadcast();
    }

    function _deployPolicy() internal {
        vm.startBroadcast(a.admin);
        LocalKeystoneForwarderFixture forwarder = new LocalKeystoneForwarderFixture();
        d.forwarder = address(forwarder);
        d.policyReceiver = address(
            new UnicaPolicyReceiver(
                d.forwarder, d.registry, UNICA_RELEASE, WORKFLOW_ID, a.workflowOwner, REPORT_SCHEMA_VERSION
            )
        );
        vm.stopBroadcast();
    }

    function _deployAdmission() internal {
        vm.startBroadcast(a.admin);
        TerminalAdmission admission =
            new TerminalAdmission(d.identity, d.registry, d.ensDeploymentId, d.policyReceiver, TERMINAL_STATUS_KEY);
        d.admission = address(admission);
        IUnicaMarketRegistry(d.registry).setOrderCreator(d.admission, true);
        vm.stopBroadcast();
    }

    /// @dev UNICA v5 direct settlement: the customer pays in the very asset the business wants to
    ///      receive, so there is nothing to convert and no pool is touched. Two things are wired
    ///      here.
    ///
    ///      First, the settler is added to the MAIN admission gate's direct settler list, which is
    ///      the list that gate consults instead of the market registry for an address that has no
    ///      market id.
    ///
    ///      Second, a SEPARATE instance of the same admission contract is deployed with no policy
    ///      receiver configured, and that is the gate the local direct sale is admitted through.
    ///      The reason is a real limit and not a convenience: the confidential policy receiver only
    ///      records terms for a market the official registry knows and reports ACTIVE, and a direct
    ///      settler has no market at all, so no report for a direct sale can ever be delivered and
    ///      the main gate's policy step can only ever refuse one. Both gates read the same identity
    ///      fixture and enforce the same register authority, status text and payout address, so the
    ///      direct path loses the confidential policy step and nothing else. When the receiver
    ///      learns to record a direct sale, the second gate stops being needed and the main gate
    ///      already carries the settler on its list.
    function _deployDirect() internal {
        vm.startBroadcast(a.admin);
        // The settler takes the REGISTRY, not an admin address: its creator authority is that
        // registry's live `admin()`, which is the same account the gate below asks before it will
        // list the settler at all. One key, both surfaces.
        DirectSettlement direct = new DirectSettlement(d.payout, d.registry);
        d.directSettlement = address(direct);

        TerminalAdmission directAdmission =
            new TerminalAdmission(d.identity, d.registry, d.ensDeploymentId, address(0), TERMINAL_STATUS_KEY);
        d.directAdmission = address(directAdmission);

        TerminalAdmission(d.admission).setDirectSettler(d.directSettlement, true);
        directAdmission.setDirectSettler(d.directSettlement, true);
        direct.setOrderCreator(d.directAdmission, true);
        vm.stopBroadcast();
    }

    /// @dev The list of what a business sells. It answers to nobody: no admin, no registry, no gate,
    ///      no allowlist of sellers. That is not an omission — a shop's own list of its own prices
    ///      is not something a payment network should be able to edit, and a seller here can reach
    ///      only their own rows. It is deployed by the admin account purely because something has to
    ///      pay the gas; the deployer holds no power over it afterwards, which the attack suite
    ///      reads back rather than taking on trust.
    function _deployCatalog() internal {
        vm.startBroadcast(a.admin);
        ProductCatalog catalog = new ProductCatalog();
        vm.stopBroadcast();
        d.productCatalog = address(catalog);
        d.catalogId = catalog.CATALOG_ID();
    }

    /// @dev The same hook source, an attacker-controlled registry, the OFFICIAL marketId in its
    ///      immutables. Its receipts are indistinguishable by topic and by field; only the emitter
    ///      address, checked against the official registry, tells them apart. That is the point.
    function _deployLookalike() internal {
        vm.startBroadcast(a.attacker);
        LookalikeFactory lf = new LookalikeFactory(a.attacker, IPoolManager(d.poolManager));
        d.lookalikeFactory = address(lf);
        bytes memory creationCode = type(UnicaMarketHook).creationCode;
        bytes memory args = abi.encode(
            d.poolManager, lf.REGISTRY(), d.marketId, d.asset, d.payout, FEE, TICK_SPACING, uint8(18), uint8(6)
        );
        (, bytes32 salt) = HookSalt.find(address(lf), HOOK_FLAGS, creationCode, args);
        lf.spoof(
            d.marketId,
            UnicaMarketTypes.Caps({maxPerTxPayout: MAX_PER_TX, maxPerDayPayout: MAX_PER_DAY, maxSeedPayout: MAX_SEED}),
            UnicaMarketTypes.OraclePolicy({
                adapter: address(0), feedId: 0, maxAge: 0, maxDeviationBps: 0, enabled: false
            })
        );
        (address hook, address executor) = lf.deploy(creationCode, args, salt);
        d.lookalikeHook = hook;
        d.lookalikeExecutor = executor;
        vm.stopBroadcast();
    }

    /// @dev The counterfeit shopfront, deployed and owned by the attacker: the SAME catalogue
    ///      source, on which they will list a product with the same name at the same price and point
    ///      its money at the real shop's own wallet. Its sale event is identical in every field a
    ///      shopper can see; only the address it comes from differs, and only the evidence reader's
    ///      emitter rule tells them apart. Deployed here for the same reason the look-alike hook is:
    ///      a refusal nobody can reproduce is a claim.
    function _deployLookalikeCatalog() internal {
        vm.startBroadcast(a.attacker);
        d.lookalikeCatalog = address(new ProductCatalog());
        vm.stopBroadcast();
    }

    // =========================================================================================
    // stage 1b: join — the barbershop walks through the self-serve door
    // =========================================================================================

    /// @notice Broadcast by the MERCHANT OWNER's own wallet, never by the admin. One call to
    ///         `MerchantOnboarding.join` produces the whole business: `freshcuts.unica.eth` owned
    ///         by that wallet, its payout address, the `terminals` branch, `chair-1` ACTIVE, and
    ///         the identity badge. Everything after that call is ordinary owner work on nodes the
    ///         owner now holds: a second register, the agent subname, and the operator grants.
    /// @dev The door's own authority is gone before this function's first statement returns:
    ///      `join` reverts with `RolesRetained` unless every role bit it held at each of the three
    ///      new resources moved to the caller. `test/anvil/Attacks.t.sol` reads the same bitmaps
    ///      back from the live chain afterwards, because a contract's self-assertion is a claim.
    function join() external localOnly {
        _readAccounts();
        d.identity = vm.envAddress("UNICA_IDENTITY");
        d.onboarding = vm.envAddress("UNICA_ONBOARDING");
        d.identityToken = vm.envAddress("UNICA_IDENTITY_TOKEN");
        LocalEnsV2Fixture identity = LocalEnsV2Fixture(d.identity);
        uint256 tokenId;

        vm.startBroadcast(a.merchantOwner);
        (d.merchantNode, d.terminalsNode, d.chair1Node, tokenId) =
            IMerchantOnboarding(d.onboarding).join(MERCHANT_LABEL, a.merchantPayout, FIRST_TERMINAL_LABEL);
        // From here the owner is acting on its own property. A second register, so the demo has
        // one to lose, and the agent subname, which holds one narrow key and no admission power.
        d.lostTabletNode = identity.register(d.terminalsNode, "lost-tablet", a.merchantOwner);
        d.agentNode = identity.register(d.merchantNode, "agent", a.merchantOwner);
        // Each operator holds SET_TEXT at exactly ONE per-key resource and nothing else. `join`
        // delegated chair-1's key to the owner's own wallet; the owner hands it to the till.
        identity.authorizeTextRoles(d.chair1Node, TERMINAL_STATUS_KEY, a.opChair1, true);
        identity.authorizeTextRoles(d.lostTabletNode, TERMINAL_STATUS_KEY, a.opLostTablet, true);
        identity.setText(d.lostTabletNode, TERMINAL_STATUS_KEY, "active");
        identity.authorizeTextRoles(d.agentNode, "com.unica.agent-status", a.opLostTablet, true);
        vm.stopBroadcast();

        _printJoin(tokenId);
    }

    function _printJoin(uint256 tokenId) internal view {
        string memory P = "JOIN";
        _emit(P, "merchantNode", vm.toString(d.merchantNode));
        _emit(P, "terminalsNode", vm.toString(d.terminalsNode));
        _emit(P, "chair1Node", vm.toString(d.chair1Node));
        _emit(P, "lostTabletNode", vm.toString(d.lostTabletNode));
        _emit(P, "agentNode", vm.toString(d.agentNode));
        _emit(P, "tokenId", vm.toString(tokenId));
        _emit(P, "badgeOwner", vm.toString(IIdentityToken(d.identityToken).ownerOf(tokenId)));
        _emit(P, "joinedBy", vm.toString(a.merchantOwner));
        _emit(P, "payoutAddress", vm.toString(LocalEnsV2Fixture(d.identity).addr(d.merchantNode)));
        _emit(P, "payName", MERCHANT_NAME);
        _emit(P, "firstTerminalLabel", FIRST_TERMINAL_LABEL);
        _emit(P, "chair1Status", LocalEnsV2Fixture(d.identity).text(d.chair1Node, TERMINAL_STATUS_KEY));
        _emit(P, "lostTabletStatus", LocalEnsV2Fixture(d.identity).text(d.lostTabletNode, TERMINAL_STATUS_KEY));
    }

    // =========================================================================================
    // stage 2: seed
    // =========================================================================================

    function seed() external localOnly {
        _readAccounts();
        _readDeployed();
        UnicaMarketFactory factory = UnicaMarketFactory(d.factory);
        UnicaMarketTypes.Market memory m = IUnicaMarketRegistry(d.registry).getMarket(d.marketId);

        vm.startBroadcast(a.admin);
        int24 tick = factory.initializeMarket(d.marketId);
        vm.stopBroadcast();
        require(tick == m.initTick, "opening tick disagrees with the record");

        PoolKey memory key = factory.poolKeyOf(d.marketId);
        int24 width = UnicaMarketMath.seedWidth(TICK_SPACING, true, MAX_DEVIATION_BPS);
        (int24 lower, int24 upper) = UnicaMarketMath.seedRange(m.initTick, width, m.assetIsCurrency0);
        uint128 liquidity = _liquidityForSeed(lower, upper, m.assetIsCurrency0);

        vm.startBroadcast(a.seeder);
        PoolModifyLiquidityTest router = new PoolModifyLiquidityTest(IPoolManager(d.poolManager));
        MockERC20(d.asset).approve(address(router), type(uint256).max);
        MockERC20(d.payout).approve(address(router), type(uint256).max);
        router.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: lower, tickUpper: upper, liquidityDelta: int256(uint256(liquidity)), salt: 0
            }),
            ""
        );
        vm.stopBroadcast();

        vm.startBroadcast(a.admin);
        uint128 depth = factory.markSeeded(d.marketId, 1);
        IUnicaMarketRegistry(d.registry).activate(d.marketId);
        vm.stopBroadcast();

        string memory P = "SEED";
        _emit(P, "tickLower", vm.toString(lower));
        _emit(P, "tickUpper", vm.toString(upper));
        _emit(P, "width", vm.toString(width));
        _emit(P, "liquidity", vm.toString(liquidity));
        _emit(P, "depthAtOpeningTick", vm.toString(depth));
        _emit(P, "seedPayoutUnits", vm.toString(SEED_PAYOUT));
        _emit(P, "maxSeedPayout", vm.toString(MAX_SEED));
        _emit(P, "status", vm.toString(IUnicaMarketRegistry(d.registry).statusOf(d.marketId)));
        _emit(P, "liquidityRouter", vm.toString(address(router)));
        _emit(P, "label", "$5-equivalent DEMONSTRATION seed, not production liquidity, no value");
    }

    /// @dev The seed sits on the payout side of the opening tick, so the whole of it is what a
    ///      payment can buy: `SEED_PAYOUT` payout units across [lower, upper].
    function _liquidityForSeed(int24 lower, int24 upper, bool assetIsCurrency0) internal pure returns (uint128) {
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(lower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(upper);
        // payout is currency1 when the asset is currency0, and currency0 otherwise
        return assetIsCurrency0
            ? LiquidityAmounts.getLiquidityForAmount1(sqrtLower, sqrtUpper, SEED_PAYOUT)
            : LiquidityAmounts.getLiquidityForAmount0(sqrtLower, sqrtUpper, SEED_PAYOUT);
    }

    // =========================================================================================
    // stage 3: demo (the positive path up to admission; the wrapper pays and probes refusals)
    // =========================================================================================

    struct DemoTerms {
        uint128 amountIn;
        uint128 minOut;
        uint64 deadline;
        bytes32 nonce;
    }

    function _terms() internal view returns (DemoTerms memory t) {
        t.amountIn = uint128(vm.envUint("DEMO_AMOUNT_IN"));
        t.minOut = uint128(vm.envUint("DEMO_MIN_OUT"));
        t.deadline = uint64(block.timestamp + vm.envUint("DEMO_TTL_SECONDS"));
        t.nonce = keccak256(abi.encode("freshcuts/chair-1/order", vm.envUint("DEMO_ORDER_SEQ")));
    }

    /// @notice Steps 2, 4 and the policy delivery: mint the badge, revoke the lost tablet, refresh
    ///         the fixture feeds, deliver the LOCAL CRE REPORT FIXTURE for the exact order terms.
    function demoPrepare() external localOnly {
        _readAccounts();
        _readDeployed();
        DemoTerms memory t = _terms();

        // 2. the immutable identity badge. Nothing mints here any more: the badge was minted by the
        //    door inside `join`, in the business's own transaction, so this stage only reads it
        //    back. A zero here means the business never actually joined, and the demo must stop
        //    rather than quietly hand out a badge the join was supposed to have produced.
        uint256 tokenId = IIdentityToken(d.identityToken).token_of_node(d.merchantNode);
        require(tokenId != 0, "no badge for the merchant node: the business did not join");

        // 4. the lost tablet is revoked: its per-key role is removed and its status text says so
        vm.startBroadcast(a.merchantOwner);
        LocalEnsV2Fixture(d.identity).authorizeTextRoles(d.lostTabletNode, TERMINAL_STATUS_KEY, a.opLostTablet, false);
        LocalEnsV2Fixture(d.identity).setText(d.lostTabletNode, TERMINAL_STATUS_KEY, "revoked");
        vm.stopBroadcast();

        // fixture feeds refreshed so the authenticated price is fresh at settlement
        vm.startBroadcast(a.admin);
        FixtureAggregator(d.assetUsdFeed).set(2e8, block.timestamp - 1, 2, 2);
        FixtureAggregator(d.payoutUsdFeed).set(1e8, block.timestamp - 1, 2, 2);
        vm.stopBroadcast();

        // 9 (policy). LOCAL CRE REPORT FIXTURE - NOT A DON REPORT, delivered through the fixture
        // forwarder, whose success means nothing until the receiver's own record exists.
        bytes32 reportHash = _deliverPolicyReport(t.amountIn, t.minOut, t.nonce, t.deadline);

        string memory P = "PREPARE";
        _emit(P, "tokenId", vm.toString(tokenId));
        _emit(P, "tokenOwner", vm.toString(IIdentityToken(d.identityToken).ownerOf(tokenId)));
        _emit(P, "reportHash", vm.toString(reportHash));
        _emit(P, "orderNonce", vm.toString(t.nonce));
        _emit(P, "lostTabletStatus", LocalEnsV2Fixture(d.identity).text(d.lostTabletNode, TERMINAL_STATUS_KEY));
        _emit(P, "chair1Status", LocalEnsV2Fixture(d.identity).text(d.chair1Node, TERMINAL_STATUS_KEY));
        _emit(P, "policyLabel", "LOCAL CRE REPORT FIXTURE - NOT A DON REPORT");
    }

    /// @notice Step 6: the active terminal admits the exact payer-bound order. The deadline is
    ///         recomputed from the same TTL, so the policy record (quoteExpiry) and the order agree
    ///         only when both stages run within the same second window; the wrapper runs them
    ///         back to back and the receiver checks freshness, never equality, on expiry.
    function demoAdmit() external localOnly {
        _readAccounts();
        _readDeployed();
        DemoTerms memory t = _terms();

        vm.startBroadcast(a.opChair1);
        bytes32 orderId = TerminalAdmission(d.admission)
            .requestOrder(
                d.merchantNode,
                d.chair1Node,
                d.ensDeploymentId,
                d.executor,
                a.merchantPayout,
                a.payer,
                t.amountIn,
                t.minOut,
                t.deadline,
                t.nonce
            );
        vm.stopBroadcast();

        UnicaMarketTypes.Order memory o = IUnicaMarketExecutor(d.executor).orders(orderId);
        string memory P = "DEMO";
        _emit(P, "orderId", vm.toString(orderId));
        _emit(P, "orderNonce", vm.toString(t.nonce));
        _emit(P, "recipient", vm.toString(o.recipient));
        _emit(P, "payer", vm.toString(o.payer));
        _emit(P, "amountIn", vm.toString(o.amountIn));
        _emit(P, "minOut", vm.toString(o.minOut));
        _emit(P, "deadline", vm.toString(o.deadline));
        _emit(P, "chair1Status", LocalEnsV2Fixture(d.identity).text(d.chair1Node, TERMINAL_STATUS_KEY));
    }

    /// @notice The same-asset sale: the customer pays in the very asset the business is paid out
    ///         in, so no conversion happens and no pool is involved. Admission is the same ENS
    ///         check as every other sale (this register, under this business, published active, to
    ///         the payout address the business record resolves to now), performed by the gate
    ///         instance that has no confidential policy receiver configured, for the reason set out
    ///         on `_deployDirect`. The payment itself runs from the wrapper so its transaction hash
    ///         is captured as evidence.
    function demoDirect() external localOnly {
        _readAccounts();
        _readDeployed();
        uint128 amount = uint128(vm.envUint("DIRECT_AMOUNT"));
        uint64 deadline = uint64(block.timestamp + vm.envUint("DIRECT_TTL_SECONDS"));
        bytes32 nonce = keccak256(abi.encode("freshcuts/chair-1/direct", vm.envUint("DIRECT_ORDER_SEQ")));

        vm.startBroadcast(a.opChair1);
        bytes32 orderId = TerminalAdmission(d.directAdmission)
            .requestOrder(
                d.merchantNode,
                d.chair1Node,
                d.ensDeploymentId,
                d.directSettlement,
                a.merchantPayout,
                a.payer,
                amount,
                amount,
                deadline,
                nonce
            );
        // A SECOND sale, raised by the same register in the same breath and deliberately left
        // unpaid. The refusal suite needs an OPEN same-asset sale to prove the customer binding on,
        // and by the time it runs this register has been revoked and can raise nothing at all. A
        // sale raised here, while the register is still active, is the only honest way to have one.
        bytes32 openOrderId = TerminalAdmission(d.directAdmission)
            .requestOrder(
                d.merchantNode,
                d.chair1Node,
                d.ensDeploymentId,
                d.directSettlement,
                a.merchantPayout,
                a.payer,
                amount,
                amount,
                deadline,
                keccak256(abi.encode("freshcuts/chair-1/direct-open", vm.envUint("DIRECT_ORDER_SEQ")))
            );
        vm.stopBroadcast();

        _printDirect(orderId, nonce);
        _emit("DIRECT", "openOrderId", vm.toString(openOrderId));
    }

    function _printDirect(bytes32 orderId, bytes32 nonce) internal view {
        UnicaMarketTypes.Order memory o = IDirectSettlement(d.directSettlement).orders(orderId);
        string memory P = "DIRECT";
        _emit(P, "orderId", vm.toString(orderId));
        _emit(P, "orderNonce", vm.toString(nonce));
        _emit(P, "settler", vm.toString(d.directSettlement));
        _emit(P, "gate", vm.toString(d.directAdmission));
        _emit(P, "asset", vm.toString(IDirectSettlement(d.directSettlement).ASSET()));
        _emit(P, "settlementId", vm.toString(IDirectSettlement(d.directSettlement).SETTLEMENT_ID()));
        _emit(P, "recipient", vm.toString(o.recipient));
        _emit(P, "payer", vm.toString(o.payer));
        _emit(P, "amountIn", vm.toString(o.amountIn));
        _emit(P, "minOut", vm.toString(o.minOut));
        _emit(P, "deadline", vm.toString(o.deadline));
        _emit(P, "chair1Status", LocalEnsV2Fixture(d.identity).text(d.chair1Node, TERMINAL_STATUS_KEY));
    }

    /// @notice The business writes down what it sells: a haircut anyone can buy any number of times,
    ///         and a membership paid for a period at a time. Broadcast by the BUSINESS OWNER's own
    ///         wallet, never by the admin — the list belongs to the shop, and the deployment cannot
    ///         put anything on it. The money for both is sent to the same address the business is
    ///         paid at everywhere else in this demonstration.
    function listProducts() external localOnly {
        _readAccounts();
        _readDeployed();
        uint256 haircutPrice = vm.envUint("PRODUCT_HAIRCUT_PRICE");
        uint256 membershipPrice = vm.envUint("PRODUCT_MEMBERSHIP_PRICE");
        uint64 membershipPeriod = uint64(vm.envUint("PRODUCT_MEMBERSHIP_PERIOD"));

        vm.startBroadcast(a.merchantOwner);
        uint256 haircut = IProductCatalog(d.productCatalog)
            .list("Haircut", d.payout, haircutPrice, IProductCatalog.Kind.PERMANENT, 0, a.merchantPayout, address(0));
        uint256 membership = IProductCatalog(d.productCatalog)
            .list(
                "Monthly membership",
                d.payout,
                membershipPrice,
                IProductCatalog.Kind.RECURRING,
                membershipPeriod,
                a.merchantPayout,
                address(0)
            );
        vm.stopBroadcast();

        _printProducts(haircut, membership);
    }

    function _printProducts(uint256 haircut, uint256 membership) internal view {
        string memory P = "PRODUCTS";
        IProductCatalog c = IProductCatalog(d.productCatalog);
        _emit(P, "catalog", vm.toString(d.productCatalog));
        _emit(P, "catalogId", vm.toString(c.CATALOG_ID()));
        _emit(P, "haircutId", vm.toString(haircut));
        _emit(P, "haircutName", c.products(haircut).name);
        _emit(P, "haircutPrice", vm.toString(c.products(haircut).price));
        _emit(P, "membershipId", vm.toString(membership));
        _emit(P, "membershipName", c.products(membership).name);
        _emit(P, "membershipPrice", vm.toString(c.products(membership).price));
        _emit(P, "membershipPeriod", vm.toString(uint256(c.products(membership).period)));
        _emit(P, "asset", vm.toString(c.products(haircut).asset));
        _emit(P, "payTo", vm.toString(c.products(haircut).payout));
        _emit(P, "listedBy", vm.toString(c.products(haircut).seller));
    }

    /// @notice Step 16b: the counterfeit shopfront makes a sale. The attacker lists a product with
    ///         the same name at the same price on their own catalogue and buys it themselves, and
    ///         they point its money at the REAL shop's wallet, so the sale even shows up in that
    ///         wallet's own list of what it was paid. Everything about the event a shopper can read
    ///         is the same; the address it came from is not.
    function lookalikeSale() external localOnly {
        _readAccounts();
        _readDeployed();
        address fake = vm.envAddress("UNICA_LOOKALIKE_CATALOG");
        uint256 price = vm.envUint("PRODUCT_HAIRCUT_PRICE");

        vm.startBroadcast(a.attacker);
        uint256 productId = IProductCatalog(fake)
            .list("Haircut", d.payout, price, IProductCatalog.Kind.PERMANENT, 0, a.merchantPayout, address(0));
        MockERC20(d.payout).approve(fake, price);
        bytes32 saleId = IProductCatalog(fake).buy(productId);
        vm.stopBroadcast();

        string memory P = "LOOKSALE";
        _emit(P, "catalog", vm.toString(fake));
        _emit(P, "officialCatalog", vm.toString(d.productCatalog));
        _emit(P, "productId", vm.toString(productId));
        _emit(P, "saleId", vm.toString(saleId));
        _emit(P, "paidTo", vm.toString(a.merchantPayout));
        _emit(P, "price", vm.toString(price));
        _emit(
            P, "label", "same catalogue source, attacker's own deployment, the real shop's wallet paid; never official"
        );
    }

    /// @notice Step 16: the attacker settles through the look-alike hook. Same hook source, the
    ///         official marketId in its immutables, a receipt with the same topic and fields —
    ///         emitted from an address the official registry has never heard of. The evidence layer
    ///         must refuse it on the emitter alone.
    function lookalike() external localOnly {
        _readAccounts();
        _readDeployed();
        address lf = vm.envAddress("UNICA_LOOKALIKE_FACTORY");
        address hook = vm.envAddress("UNICA_LOOKALIKE_HOOK");
        address executor = vm.envAddress("UNICA_LOOKALIKE_EXECUTOR");
        UnicaMarketTypes.Market memory m = IUnicaMarketRegistry(d.registry).getMarket(d.marketId);
        PoolKey memory key = UnicaMarketFactory(d.factory).poolKeyOf(d.marketId);
        key.hooks = IHooks(hook);

        vm.startBroadcast(a.attacker);
        (uint160 sqrtPriceNow,,,) = StateLibrary.getSlot0(IPoolManager(d.poolManager), key.toId());
        if (sqrtPriceNow == 0) LookalikeFactory(lf).initialize(key, m.initSqrtPriceX96);
        PoolModifyLiquidityTest router = new PoolModifyLiquidityTest(IPoolManager(d.poolManager));
        MockERC20(d.asset).approve(address(router), type(uint256).max);
        MockERC20(d.payout).approve(address(router), type(uint256).max);
        int24 width = UnicaMarketMath.seedWidth(TICK_SPACING, false, 0);
        (int24 lower, int24 upper) = UnicaMarketMath.seedRange(m.initTick, width, m.assetIsCurrency0);
        router.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: 1e15, salt: 0}), ""
        );
        bytes32 orderId = IUnicaMarketExecutor(executor)
            .createOrder(
                a.attacker,
                a.attacker,
                1e17,
                1,
                uint64(block.timestamp + 3600),
                keccak256(abi.encode("lookalike", vm.envUint("DEMO_ORDER_SEQ")))
            );
        MockERC20(d.asset).approve(executor, 1e17);
        IUnicaMarketExecutor(executor).pay(orderId);
        vm.stopBroadcast();

        string memory P = "LOOKALIKE";
        _emit(P, "orderId", vm.toString(orderId));
        _emit(P, "hook", vm.toString(hook));
        _emit(P, "executor", vm.toString(executor));
        _emit(P, "claimedMarketId", vm.toString(d.marketId));
        _emit(P, "officialHook", vm.toString(d.hook));
        _emit(P, "label", "same hook source, attacker registry, official marketId in the receipt; never official");
    }

    function _deliverPolicyReport(uint128 amountIn, uint128 minOut, bytes32 nonce, uint64 deadline)
        internal
        returns (bytes32 reportHash)
    {
        UnicaPolicyTypes.AdmissionReport memory r = UnicaPolicyTypes.AdmissionReport({
            chainId: block.chainid,
            verifyingContract: d.policyReceiver,
            unicaRelease: UNICA_RELEASE,
            registry: d.registry,
            marketId: d.marketId,
            marketVersion: 1,
            merchant: a.merchantPayout,
            payer: a.payer,
            inputAsset: d.asset,
            outputAsset: d.payout,
            exactInput: true,
            inputAmount: amountIn,
            minOutput: minOut,
            orderNonce: nonce,
            quoteExpiry: deadline,
            policyExpiry: deadline,
            terminalNode: d.chair1Node,
            terminalStatusSnapshot: keccak256("active"),
            ensDeploymentId: d.ensDeploymentId,
            policyVersionHash: keccak256("unica-confidential-policy/1"),
            privateInputCommitment: keccak256("LOCAL CRE REPORT FIXTURE - NOT A DON REPORT - private input commitment"),
            workflowId: WORKFLOW_ID,
            workflowOwner: a.workflowOwner,
            workflowVersion: keccak256("fixture-workflow-version/1"),
            receiver: d.policyReceiver
        });
        bytes memory report = LocalCreReportFixture.encodeReport(REPORT_SCHEMA_VERSION, r);
        bytes memory metadata =
            LocalCreReportFixture.metadata(WORKFLOW_ID, bytes10("unica-adm"), a.workflowOwner, bytes2(uint16(1)));
        vm.startBroadcast(a.workflowOwner);
        bool ok = LocalKeystoneForwarderFixture(d.forwarder).route(d.policyReceiver, metadata, report);
        vm.stopBroadcast();
        require(ok, "the fixture forwarder reported success=false: the receiver rejected the report");
        require(
            UnicaPolicyReceiver(d.policyReceiver).admissionOf(nonce).exists,
            "forwarder success is not delivery: no admission record exists"
        );
        reportHash = LocalCreReportFixture.reportHash(report);
    }

    // =========================================================================================
    // helpers
    // =========================================================================================

    function _readDeployed() internal {
        d.poolManager = vm.envAddress("UNICA_POOL_MANAGER");
        d.asset = vm.envAddress("UNICA_ASSET");
        d.payout = vm.envAddress("UNICA_PAYOUT");
        d.assetUsdFeed = vm.envAddress("UNICA_ASSET_USD_FEED");
        d.payoutUsdFeed = vm.envAddress("UNICA_PAYOUT_USD_FEED");
        d.adapter = vm.envAddress("UNICA_ORACLE_ADAPTER");
        d.factory = vm.envAddress("UNICA_FACTORY");
        d.registry = vm.envAddress("UNICA_REGISTRY");
        d.hook = vm.envAddress("UNICA_HOOK");
        d.executor = vm.envAddress("UNICA_EXECUTOR");
        d.marketId = vm.envBytes32("UNICA_MARKET_ID");
        d.identity = vm.envAddress("UNICA_IDENTITY");
        d.identityToken = vm.envAddress("UNICA_IDENTITY_TOKEN");
        d.forwarder = vm.envAddress("UNICA_FORWARDER");
        d.policyReceiver = vm.envAddress("UNICA_POLICY_RECEIVER");
        d.admission = vm.envAddress("UNICA_ADMISSION");
        d.directSettlement = vm.envAddress("UNICA_DIRECT_SETTLEMENT");
        d.directAdmission = vm.envAddress("UNICA_DIRECT_ADMISSION");
        d.productCatalog = vm.envAddress("UNICA_PRODUCT_CATALOG");
        d.lookalikeCatalog = vm.envAddress("UNICA_LOOKALIKE_CATALOG");
        d.ensDeploymentId = vm.envBytes32("UNICA_ENS_DEPLOYMENT_ID");
        d.merchantNode = vm.envBytes32("UNICA_MERCHANT_NODE");
        d.chair1Node = vm.envBytes32("UNICA_CHAIR1_NODE");
        d.lostTabletNode = vm.envBytes32("UNICA_LOST_TABLET_NODE");
    }

    function _kv(string memory k, string memory v) internal pure returns (string memory) {
        return string.concat('"', k, '":"', v, '"');
    }

    /// @dev One record field per console line, `PREFIX:"key":"value",`; the wrapper joins the lines
    ///      of one prefix and wraps them in braces. Keeps every function far from the stack limit.
    function _emit(string memory prefix, string memory k, string memory v) internal pure {
        console.log(string.concat(prefix, ":", _kv(k, v), ","));
    }

    function _printManifest() internal view {
        string memory P = "MANIFEST";
        _emit(P, "poolManager", vm.toString(d.poolManager));
        _emit(P, "assetToken", vm.toString(d.asset));
        _emit(P, "payoutToken", vm.toString(d.payout));
        _emit(P, "assetUsdFeed", vm.toString(d.assetUsdFeed));
        _emit(P, "payoutUsdFeed", vm.toString(d.payoutUsdFeed));
        _emit(P, "oracleAdapter", vm.toString(d.adapter));
        _emit(P, "factory", vm.toString(d.factory));
        _emit(P, "registry", vm.toString(d.registry));
        _emit(P, "hook", vm.toString(d.hook));
        _emit(P, "executor", vm.toString(d.executor));
        _emit(P, "marketId", vm.toString(d.marketId));
        _emit(P, "poolId", vm.toString(d.poolId));
        _emit(P, "feedId", vm.toString(d.feedId));
        _emit(P, "hookSalt", vm.toString(d.hookSalt));
        _emit(P, "identityFixture", vm.toString(d.identity));
        _emit(P, "merchantOnboarding", vm.toString(d.onboarding));
        _emit(P, "identityToken", vm.toString(d.identityToken));
        _emit(P, "forwarderFixture", vm.toString(d.forwarder));
        _emit(P, "policyReceiver", vm.toString(d.policyReceiver));
        _emit(P, "terminalAdmission", vm.toString(d.admission));
        _emit(P, "directSettlement", vm.toString(d.directSettlement));
        _emit(P, "directAdmission", vm.toString(d.directAdmission));
        _emit(P, "productCatalog", vm.toString(d.productCatalog));
        _emit(P, "catalogId", vm.toString(d.catalogId));
        _emit(P, "lookalikeCatalog", vm.toString(d.lookalikeCatalog));
        _emit(P, "lookalikeFactory", vm.toString(d.lookalikeFactory));
        _emit(P, "lookalikeHook", vm.toString(d.lookalikeHook));
        _emit(P, "lookalikeExecutor", vm.toString(d.lookalikeExecutor));
        _emit(P, "ensDeploymentId", vm.toString(d.ensDeploymentId));
        _emit(P, "rootNode", vm.toString(d.rootNode));
        _emit(P, "unicaNode", vm.toString(d.unicaNode));
        // The parent, not the business. Every node under it is produced by `join()`, which runs
        // next and prints its own record; nothing here can be mistaken for a pre-built barbershop.
        _emit(P, "parentNode", vm.toString(d.unicaNode));
        _emit(P, "parentName", PARENT_NAME);
        _emit(P, "firstTerminalLabel", FIRST_TERMINAL_LABEL);
        _emit(P, "rateE18", vm.toString(RATE_E18));
        _emit(P, "fee", vm.toString(uint256(FEE)));
        _emit(P, "tickSpacing", vm.toString(TICK_SPACING));
        _emit(P, "maxAge", vm.toString(uint256(MAX_AGE)));
        _emit(P, "maxDeviationBps", vm.toString(uint256(MAX_DEVIATION_BPS)));
        _emit(P, "maxPerTxPayout", vm.toString(MAX_PER_TX));
        _emit(P, "maxPerDayPayout", vm.toString(MAX_PER_DAY));
        _emit(P, "maxSeedPayout", vm.toString(MAX_SEED));
        _emit(P, "rendererVersion", RENDERER_VERSION);
        _emit(P, "merchantName", MERCHANT_NAME);
        _emit(P, "terminalStatusKey", TERMINAL_STATUS_KEY);
        _emit(P, "unicaRelease", vm.toString(UNICA_RELEASE));
        _emit(P, "workflowId", vm.toString(WORKFLOW_ID));
    }
}
