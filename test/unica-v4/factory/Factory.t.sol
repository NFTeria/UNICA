// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {HookSalt} from "../../../src/unica-v4/HookSalt.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {V4PoolManagerDeployer} from "hookmate/artifacts/V4PoolManager.sol";

import {UnicaMarketTypes} from "../../../src/unica-v4/UnicaMarketTypes.sol";
import {UnicaMarketMath} from "../../../src/unica-v4/UnicaMarketMath.sol";
import {UnicaMarketFactory} from "../../../src/unica-v4/UnicaMarketFactory.sol";
import {UnicaMarketRegistry} from "../../../src/unica-v4/UnicaMarketRegistry.sol";
import {UnicaMarketHook} from "../../../src/unica-v4/UnicaMarketHook.sol";
import {IUnicaMarketHook} from "../../../src/unica-v4/interfaces/IUnicaMarketHook.sol";

/// @dev A token whose `decimals()` cannot be believed, one shape per instance.
contract AwkwardDecimals {
    enum Mode {
        Reverts,
        Short,
        Long,
        Nineteen
    }

    Mode public mode;

    constructor(Mode mode_) {
        mode = mode_;
    }

    fallback(bytes calldata) external returns (bytes memory) {
        if (mode == Mode.Reverts) revert("no decimals here");
        if (mode == Mode.Short) return hex"12";
        if (mode == Mode.Long) return abi.encode(uint256(18), uint256(18));
        return abi.encode(uint256(19));
    }
}

/// @title Factory rows F1-F19 and K4
/// @notice Written from `docs/unica-v4/SPEC-CONTRACTS.md` §7 and `TEST-MATRIX.md`. The PoolManager is
///         UNISWAP'S OWN DEPLOYED BYTECODE, not a local recompile: hookmate ships the creation code
///         of Uniswap's deployment, and this file runs it at a chosen address and keeps the runtime
///         it returns. A hook's address bits, a CREATE2 prediction and a pool initialisation are all
///         only as meaningful as the manager they are checked against, and a re-compiled manager is
///         a different artifact from the one any chain runs.
///
///         The salt is MINED here, never pasted. A pasted salt stops matching the moment a comment
///         in the hook changes, and the row would go on passing against an address nobody deploys.
contract FactoryTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint160 internal constant FLAGS = 0x20C0;
    uint24 internal constant FEE = 3000;
    int24 internal constant SPACING = 60;
    uint256 internal constant RATE = 395e18;

    uint128 internal constant CAP_TX = 10_000_000;
    uint128 internal constant CAP_DAY = 25_000_000;
    uint128 internal constant CAP_SEED = type(uint128).max;

    IPoolManager internal manager;
    UnicaMarketFactory internal factory;
    UnicaMarketRegistry internal registry;
    PoolModifyLiquidityTest internal liquidityRouter;

    address internal admin = makeAddr("admin");
    address internal stranger = makeAddr("stranger");

    MockERC20 internal asset;
    MockERC20 internal payout;

    function setUp() public {
        _etchOfficialPoolManager();
        factory = new UnicaMarketFactory(admin, manager, keccak256(type(UnicaMarketHook).creationCode), false);
        registry = factory.REGISTRY();
        liquidityRouter = new PoolModifyLiquidityTest(manager);

        asset = new MockERC20("Fixture Asset", "FIXA", 18);
        payout = new MockERC20("Fixture Payout", "FIXP", 6);
    }

    // ---- F15, F16: the pinned hash and the two CREATE addresses -----------------------------------------

    function test_F15_F16_codeHashAndCreateAddresses() public {
        assertEq(
            factory.HOOK_CREATION_CODE_HASH(),
            keccak256(type(UnicaMarketHook).creationCode),
            "the pinned hash is of the hook source in this tree"
        );

        // `registry == CREATE(factory, 1)`: a fresh contract's first CREATE uses nonce 1 (EIP-161).
        assertEq(address(registry), vm.computeCreateAddress(address(factory), 1), "registry is CREATE(factory, 1)");

        (, address hook, address executor) = _createDefaultMarket();
        assertEq(executor, vm.computeCreateAddress(hook, 1), "executor is CREATE(hook, 1)");
        assertEq(IUnicaMarketHook(hook).EXECUTOR(), executor, "and the hook agrees");
        assertEq(uint160(hook) & 0x3FFF, FLAGS, "the deployed hook carries the declared flags");
    }

    // ---- F1, F1b, F1c: only the admin, and the admin is read live ------------------------------------------

    function test_F1_F1b_F1c_onlyAdminAndTheAdminIsReadLive() public {
        (UnicaMarketTypes.MarketConfig memory config, bytes32 salt) = _minedConfig();

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketFactory.NotAdmin.selector, stranger));
        factory.createMarket(config, salt, type(UnicaMarketHook).creationCode);

        vm.prank(admin);
        (bytes32 id,,) = factory.createMarket(config, salt, type(UnicaMarketHook).creationCode);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketFactory.NotAdmin.selector, stranger));
        factory.initializeMarket(id);

        // The admin moves. The factory holds no owner of its own, so the new one takes effect here
        // at once and the OLD one loses these rights (C16).
        address next = makeAddr("nextAdmin");
        vm.prank(admin);
        registry.transferAdmin(next);
        vm.prank(next);
        registry.acceptAdmin();

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketFactory.NotAdmin.selector, admin));
        factory.initializeMarket(id);

        // Control: the new admin does both of the calls the old one just could not.
        vm.prank(next);
        factory.initializeMarket(id);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketFactory.NotAdmin.selector, admin));
        factory.markSeeded(id, 1);
        vm.prank(next);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketFactory.ZeroMinDepth.selector));
        factory.markSeeded(id, 0);
    }

    // ---- F4, F5: the code and the bits ------------------------------------------------------------------------

    function test_F4_wrongHookCodeIsRefused() public {
        (UnicaMarketTypes.MarketConfig memory config, bytes32 salt) = _minedConfig();

        bytes memory flipped = type(UnicaMarketHook).creationCode;
        flipped[flipped.length - 1] = bytes1(uint8(flipped[flipped.length - 1]) ^ 0x01);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketFactory.WrongHookCode.selector, keccak256(flipped)));
        factory.createMarket(config, salt, flipped);

        // Control: the pinned bytes with the same salt create.
        vm.prank(admin);
        factory.createMarket(config, salt, type(UnicaMarketHook).creationCode);
        assertEq(registry.marketCount(), 1, "the pinned code creates");
    }

    function test_F5_unminedSaltIsRefusedBeforeAnythingIsDeployed() public {
        (UnicaMarketTypes.MarketConfig memory config, bytes32 goodSalt) = _minedConfig();

        bytes32 badSalt = bytes32(uint256(goodSalt) ^ uint256(1));
        address predicted = _predict(badSalt, config);
        vm.assume(uint160(predicted) & 0x3FFF != FLAGS);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketFactory.HookFlagsWrong.selector, predicted));
        factory.createMarket(config, badSalt, type(UnicaMarketHook).creationCode);
        assertEq(predicted.code.length, 0, "nothing was deployed at the refused address");
        assertEq(registry.marketCount(), 0, "and nothing was registered");

        // Control: the mined salt creates, and lands exactly where it was predicted. The prediction
        // is taken BEFORE the call, because `previewMarket` reads `latestVersion` live and a created
        // market moves it — a prediction taken afterwards would be for the NEXT market.
        address expected = _predict(goodSalt, config);
        vm.prank(admin);
        (, address hook,) = factory.createMarket(config, goodSalt, type(UnicaMarketHook).creationCode);
        assertEq(hook, expected, "the hook lands at the predicted address");
    }

    // ---- F6, F7, F8: the two tokens ------------------------------------------------------------------------------

    function test_F6_F7_F8_tokenRefusalsAndTheDecimalsThatAreAccepted() public {
        UnicaMarketTypes.MarketConfig memory config = _config(address(asset), address(asset));
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketFactory.SameToken.selector, address(asset)));
        factory.previewMarket(config);

        address hollow = makeAddr("no code");
        config = _config(hollow, address(payout));
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketFactory.NoCode.selector, hollow));
        factory.previewMarket(config);
        config = _config(address(asset), hollow);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketFactory.NoCode.selector, hollow));
        factory.previewMarket(config);

        AwkwardDecimals.Mode[4] memory modes = [
            AwkwardDecimals.Mode.Reverts,
            AwkwardDecimals.Mode.Short,
            AwkwardDecimals.Mode.Long,
            AwkwardDecimals.Mode.Nineteen
        ];
        for (uint256 i; i < modes.length; ++i) {
            address awkward = address(new AwkwardDecimals(modes[i]));
            config = _config(awkward, address(payout));
            vm.expectRevert(abi.encodeWithSelector(UnicaMarketFactory.DecimalsUnreadable.selector, awkward));
            factory.previewMarket(config);
        }

        // Control: 6, 8 and 18 are all read and carried into the record.
        uint8[3] memory ds = [uint8(6), 8, 18];
        for (uint256 i; i < ds.length; ++i) {
            MockERC20 token = new MockERC20("Fixture", "FIX", ds[i]);
            config = _config(address(token), address(payout));
            (,,, UnicaMarketTypes.Market memory m) = factory.previewMarket(config);
            assertEq(m.assetDecimals, ds[i], "the asset's own decimals are read");
            assertEq(m.payoutDecimals, 6, "and the payout's");
        }
    }

    // ---- F9, F10, F19: the configuration -------------------------------------------------------------------------

    function test_F9_onlyTheThreeFeeTiers() public {
        uint24[4] memory fees = [uint24(3000), 1_000_000, 500, 0x800000];
        int24[4] memory spacings = [int24(10), 60, 60, 60];
        for (uint256 i; i < fees.length; ++i) {
            UnicaMarketTypes.MarketConfig memory bad = _config(address(asset), address(payout));
            bad.fee = fees[i];
            bad.tickSpacing = spacings[i];
            vm.expectRevert(
                abi.encodeWithSelector(UnicaMarketFactory.FeeTierUnsupported.selector, fees[i], spacings[i])
            );
            factory.previewMarket(bad);
        }

        // Control: each of the three allowed pairings is accepted.
        uint24[3] memory okFees = [uint24(500), 3000, 10000];
        int24[3] memory okSpacings = [int24(10), 60, 200];
        for (uint256 i; i < okFees.length; ++i) {
            UnicaMarketTypes.MarketConfig memory good = _config(address(asset), address(payout));
            good.fee = okFees[i];
            good.tickSpacing = okSpacings[i];
            (,,, UnicaMarketTypes.Market memory m) = factory.previewMarket(good);
            assertEq(m.fee, okFees[i], "fee carried");
            assertEq(m.tickSpacing, okSpacings[i], "spacing carried");
        }
    }

    function test_F10_rateOutOfRange() public {
        uint256[2] memory bad = [uint256(0), 1e36 + 1];
        for (uint256 i; i < bad.length; ++i) {
            UnicaMarketTypes.MarketConfig memory config = _config(address(asset), address(payout));
            config.rateE18 = bad[i];
            vm.expectRevert(abi.encodeWithSelector(UnicaMarketMath.RateOutOfRange.selector, bad[i]));
            factory.previewMarket(config);
        }

        // SC §7 names a THIRD shape of this refusal — an opening tick outside the usable range — and
        // it is UNREACHABLE through the factory, which is a finding, not a gap. With `rateE18` capped
        // at 1e36 and both decimals capped at 18, the widest price ratio is 1e36, whose tick is about
        // 828,943 against a usable limit of 887,200 at the widest allowed spacing. The row asserts
        // that instead of pretending to exercise it: the extreme rate PRICES rather than reverting.
        UnicaMarketTypes.MarketConfig memory extreme = _config(address(asset), address(payout));
        extreme.rateE18 = 1e36;
        (,,, UnicaMarketTypes.Market memory extremeRecord) = factory.previewMarket(extreme);
        assertTrue(extremeRecord.initTick < TickMath.maxUsableTick(SPACING), "inside the grid");
        assertTrue(extremeRecord.initTick > TickMath.minUsableTick(SPACING), "on both sides");

        extreme.rateE18 = 1;
        (,,, extremeRecord) = factory.previewMarket(extreme);
        assertTrue(extremeRecord.initTick > TickMath.minUsableTick(SPACING), "and so is the smallest rate");

        // Control: the boundary rates on either side of the refusals are accepted.
        UnicaMarketTypes.MarketConfig memory ok = _config(address(asset), address(payout));
        ok.rateE18 = RATE;
        (,,, UnicaMarketTypes.Market memory m) = factory.previewMarket(ok);
        assertEq(m.rateE18, RATE, "395e18 prices");
        assertTrue(m.initSqrtPriceX96 != 0, "and produces an opening price");
    }

    function test_F19_capsInvalid() public {
        (UnicaMarketTypes.MarketConfig memory config, bytes32 salt) = _minedConfig();
        UnicaMarketTypes.Caps[3] memory bad = [
            UnicaMarketTypes.Caps(0, CAP_DAY, CAP_SEED),
            UnicaMarketTypes.Caps(CAP_DAY, CAP_TX, CAP_SEED),
            UnicaMarketTypes.Caps(CAP_TX, CAP_DAY, 0)
        ];
        (bytes32 id,,,) = factory.previewMarket(config);
        for (uint256 i; i < bad.length; ++i) {
            UnicaMarketTypes.MarketConfig memory attempt = _config(address(asset), address(payout));
            attempt.caps = bad[i];
            vm.prank(admin);
            vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.CapsInvalid.selector, id));
            factory.createMarket(attempt, salt, type(UnicaMarketHook).creationCode);
        }

        // Control: the same call with valid caps creates.
        vm.prank(admin);
        factory.createMarket(config, salt, type(UnicaMarketHook).creationCode);
        assertEq(registry.capsOf(id).maxPerTxPayout, CAP_TX, "caps stored");
    }

    // ---- F11: preview equals what is deployed --------------------------------------------------------------------

    function test_F11_previewEqualsTheStoredRecordAndTheHookArguments() public {
        (UnicaMarketTypes.MarketConfig memory config, bytes32 salt) = _minedConfig();
        (bytes32 previewId, uint32 version, bytes memory hookArgs, UnicaMarketTypes.Market memory preview) =
            factory.previewMarket(config);
        assertEq(hookArgs.length, 288, "the hook's arguments are 288 bytes");

        vm.prank(admin);
        (bytes32 id, address hook, address executor) =
            factory.createMarket(config, salt, type(UnicaMarketHook).creationCode);
        assertEq(id, previewId, "the id was predicted exactly");

        UnicaMarketTypes.Market memory stored = registry.getMarket(id);
        assertEq(stored.asset, preview.asset, "asset");
        assertEq(stored.payout, preview.payout, "payout");
        assertEq(stored.version, version, "version");
        assertEq(stored.rateE18, preview.rateE18, "rate");
        assertEq(stored.initSqrtPriceX96, preview.initSqrtPriceX96, "opening price");
        assertEq(stored.initTick, preview.initTick, "opening tick");
        assertEq(stored.fee, preview.fee, "fee");
        assertEq(stored.tickSpacing, preview.tickSpacing, "spacing");
        assertEq(stored.assetDecimals, preview.assetDecimals, "asset decimals");
        assertEq(stored.payoutDecimals, preview.payoutDecimals, "payout decimals");
        assertEq(stored.assetIsCurrency0, preview.assetIsCurrency0, "ordering");
        assertEq(stored.hook, hook, "the hook the factory returned");
        assertEq(stored.executor, executor, "and its executor");

        // The 288 bytes decode to the nine values the hook was actually built with.
        (
            address pm,
            address reg,
            bytes32 argId,
            address argAsset,
            address argPayout,
            uint24 argFee,
            int24 argSpacing,
            uint8 argAssetDecimals,
            uint8 argPayoutDecimals
        ) = abi.decode(hookArgs, (address, address, bytes32, address, address, uint24, int24, uint8, uint8));
        assertEq(pm, address(manager), "pool manager");
        assertEq(reg, address(registry), "registry");
        assertEq(argId, id, "market id");
        assertEq(argAsset, address(asset), "asset");
        assertEq(argPayout, address(payout), "payout");
        assertEq(argFee, FEE, "fee");
        assertEq(argSpacing, SPACING, "spacing");
        assertEq(argAssetDecimals, 18, "asset decimals");
        assertEq(argPayoutDecimals, 6, "payout decimals");
        assertEq(IUnicaMarketHook(hook).MARKET_ID(), id, "and the hook stored the same id");
    }

    // ---- F2, F3: liveness and the reverse pair ---------------------------------------------------------------------

    function test_F2_F3_liveMarketAndTheReversePair() public {
        (bytes32 id,,) = _createDefaultMarket();

        // A second market on the same pair, with a fresh mined salt, is refused while one is live.
        UnicaMarketTypes.MarketConfig memory again = _config(address(asset), address(payout));
        (bytes32 nextId,, bytes memory args,) = factory.previewMarket(again);
        (, bytes32 freshSalt) = HookSalt.find(address(factory), FLAGS, type(UnicaMarketHook).creationCode, args);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketRegistry.LiveMarketExists.selector, id));
        factory.createMarket(again, freshSalt, type(UnicaMarketHook).creationCode);
        assertTrue(nextId != id, "the relisting would have had its own id");

        // Control: the REVERSE pair is a different market and is allowed alongside.
        UnicaMarketTypes.MarketConfig memory reversed = _config(address(payout), address(asset));
        (bytes32 reversedId,, bytes memory reversedArgs,) = factory.previewMarket(reversed);
        (, bytes32 reversedSalt) =
            HookSalt.find(address(factory), FLAGS, type(UnicaMarketHook).creationCode, reversedArgs);
        vm.prank(admin);
        factory.createMarket(reversed, reversedSalt, type(UnicaMarketHook).creationCode);
        assertTrue(reversedId != id, "the reverse pair has a distinct id");
        assertEq(registry.statusOf(reversedId), 1, "and it registers");
    }

    // ---- F12, F18: initialisation ----------------------------------------------------------------------------------

    function test_F12_initialiseOnceAtTheRecordedPrice() public {
        (bytes32 id,,) = _createDefaultMarket();
        UnicaMarketTypes.Market memory m = registry.getMarket(id);

        vm.prank(admin);
        int24 tick = factory.initializeMarket(id);
        assertEq(tick, m.initTick, "the pool opened on the recorded tick");
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(PoolId.wrap(m.poolId));
        assertEq(sqrtPriceX96, m.initSqrtPriceX96, "and at the recorded price");
        assertEq(registry.statusOf(id), 2, "INITIALIZED");

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketFactory.WrongMarketStatus.selector, id, uint8(2)));
        factory.initializeMarket(id);
    }

    function test_F18_theHookAdmitsOnlyTheFactory() public {
        (UnicaMarketTypes.MarketConfig memory config, bytes32 salt) = _minedConfig();
        address predicted = _predict(salt, config);

        // Before the hook exists, a pool naming that address cannot be initialised: the manager's
        // hook-address validation is what refuses, and a published salt is therefore safe (A5).
        PoolKey memory key = _key(predicted);
        vm.expectRevert();
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));

        vm.prank(admin);
        (bytes32 id, address hook,) = factory.createMarket(config, salt, type(UnicaMarketHook).creationCode);
        assertEq(hook, predicted, "the hook landed where the salt said");

        // After it exists, a stranger naming the real key is refused by the hook itself.
        PoolKey memory realKey = factory.poolKeyOf(id);
        UnicaMarketTypes.Market memory m = registry.getMarket(id);
        vm.prank(stranger);
        vm.expectRevert();
        manager.initialize(realKey, m.initSqrtPriceX96);

        // Control: the factory initialises the same key.
        vm.prank(admin);
        factory.initializeMarket(id);
        assertEq(registry.statusOf(id), 2, "the factory is the one initialiser");
    }

    // ---- F13, K4: the seed proof and the seed cap -----------------------------------------------------------------------

    function test_F13_seedTooShallowAndZeroMinDepth() public {
        (bytes32 id,,) = _createDefaultMarket();
        vm.prank(admin);
        factory.initializeMarket(id);

        vm.prank(admin);
        vm.expectRevert(UnicaMarketFactory.ZeroMinDepth.selector);
        factory.markSeeded(id, 0);

        // No liquidity at all: depth is zero and the market cannot seed.
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketFactory.SeedTooShallow.selector, id, uint128(0), uint128(1)));
        factory.markSeeded(id, 1);

        // A range one grid step short of the opening tick is not depth AT the opening tick. "Short"
        // is directional: the payout side sits BELOW the opening tick when the asset is currency0
        // and ABOVE it when it is currency1, so falling short means stepping away from it either way.
        UnicaMarketTypes.Market memory m = registry.getMarket(id);
        int24 width = UnicaMarketMath.seedWidth(m.tickSpacing, false, 0);
        (int24 lower, int24 upper) = UnicaMarketMath.seedRange(m.initTick, width, m.assetIsCurrency0);
        int24 away = m.assetIsCurrency0 ? -m.tickSpacing : m.tickSpacing;
        _mint(id, lower + away, upper + away, 1e15);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketFactory.SeedTooShallow.selector, id, uint128(0), uint128(1)));
        factory.markSeeded(id, 1);

        // Control: the designed range, at the opening tick, records a depth.
        _mint(id, lower, upper, 1e15);
        vm.prank(admin);
        uint128 depth = factory.markSeeded(id, 1);
        assertEq(depth, 1e15, "the seed's own liquidity is what is recorded");
        assertEq(registry.statusOf(id), 3, "SEEDED");
        assertEq(registry.getMarket(id).seedDepth, depth, "and stored");
    }

    function test_K4_seedCapAtTheBoundary() public {
        // A cap set to exactly what the designed range holds passes; one unit less does not.
        (bytes32 id,,) = _createMarketWithSeedCap(type(uint128).max);
        vm.prank(admin);
        factory.initializeMarket(id);
        UnicaMarketTypes.Market memory m = registry.getMarket(id);
        int24 width = UnicaMarketMath.seedWidth(m.tickSpacing, false, 0);
        (int24 lower, int24 upper) = UnicaMarketMath.seedRange(m.initTick, width, m.assetIsCurrency0);
        _mint(id, lower, upper, 1e15);
        uint256 equivalent = _payoutEquivalent(m, lower, upper, 1e15);
        vm.prank(admin);
        factory.markSeeded(id, 1);

        // The same seed against a cap one unit below the measured equivalent is refused.
        (bytes32 tight,,) = _createMarketWithSeedCap(uint128(equivalent - 1));
        vm.prank(admin);
        factory.initializeMarket(tight);
        UnicaMarketTypes.Market memory tm = registry.getMarket(tight);
        (int24 tl, int24 tu) = UnicaMarketMath.seedRange(tm.initTick, width, tm.assetIsCurrency0);
        _mint(tight, tl, tu, 1e15);
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(UnicaMarketFactory.SeedAboveCap.selector, tight, equivalent, uint128(equivalent - 1))
        );
        factory.markSeeded(tight, 1);

        // Control: the cap set to exactly the equivalent passes.
        (bytes32 exact,,) = _createMarketWithSeedCap(uint128(equivalent));
        vm.prank(admin);
        factory.initializeMarket(exact);
        UnicaMarketTypes.Market memory em = registry.getMarket(exact);
        (int24 el, int24 eu) = UnicaMarketMath.seedRange(em.initTick, width, em.assetIsCurrency0);
        _mint(exact, el, eu, 1e15);
        vm.prank(admin);
        factory.markSeeded(exact, 1);
        assertEq(registry.statusOf(exact), 3, "equal to the cap is inside it");
    }

    // ---- helpers ------------------------------------------------------------------------------------------------------

    /// @dev Uniswap's own PoolManager creation code, run at a chosen address, with the runtime it
    ///      returns kept there. Not a recompile: the bytes come from hookmate's recorded artifact.
    function _etchOfficialPoolManager() private {
        address where = makeAddr("PoolManager");
        bytes memory initcode = abi.encodePacked(V4PoolManagerDeployer.initcode(), abi.encode(address(this)));
        vm.etch(where, initcode);
        (bool ok, bytes memory runtime) = where.call("");
        require(ok, "official PoolManager init code reverted");
        require(runtime.length > 20_000, "the etched runtime is not a PoolManager");
        vm.etch(where, runtime);
        manager = IPoolManager(where);
        vm.label(where, "PoolManager(official bytecode)");
    }

    function _config(address asset_, address payout_)
        internal
        pure
        returns (UnicaMarketTypes.MarketConfig memory config)
    {
        config.asset = asset_;
        config.payout = payout_;
        config.rateE18 = RATE;
        config.fee = FEE;
        config.tickSpacing = SPACING;
        config.policy = UnicaMarketTypes.OraclePolicy(address(0), bytes32(0), 0, 0, false);
        config.caps = UnicaMarketTypes.Caps(CAP_TX, CAP_DAY, CAP_SEED);
    }

    function _minedConfig() internal view returns (UnicaMarketTypes.MarketConfig memory config, bytes32 salt) {
        config = _config(address(asset), address(payout));
        (,, bytes memory args,) = factory.previewMarket(config);
        (, salt) = HookSalt.find(address(factory), FLAGS, type(UnicaMarketHook).creationCode, args);
    }

    function _predict(bytes32 salt, UnicaMarketTypes.MarketConfig memory config) internal view returns (address) {
        (,, bytes memory args,) = factory.previewMarket(config);
        bytes32 initHash = keccak256(bytes.concat(type(UnicaMarketHook).creationCode, args));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(factory), salt, initHash)))));
    }

    function _key(address hook) internal view returns (PoolKey memory) {
        (address c0, address c1) =
            address(asset) < address(payout) ? (address(asset), address(payout)) : (address(payout), address(asset));
        return PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: FEE,
            tickSpacing: SPACING,
            hooks: IHooks(hook)
        });
    }

    function _createDefaultMarket() internal returns (bytes32 id, address hook, address executor) {
        (UnicaMarketTypes.MarketConfig memory config, bytes32 salt) = _minedConfig();
        vm.prank(admin);
        (id, hook, executor) = factory.createMarket(config, salt, type(UnicaMarketHook).creationCode);
    }

    /// @dev A fresh pair each time, so several markets can coexist in one row.
    function _createMarketWithSeedCap(uint128 maxSeedPayout)
        internal
        returns (bytes32 id, address hook, address executor)
    {
        MockERC20 a = new MockERC20("Fixture Asset", "FIXA", 18);
        MockERC20 p = new MockERC20("Fixture Payout", "FIXP", 6);
        UnicaMarketTypes.MarketConfig memory config = _config(address(a), address(p));
        config.caps = UnicaMarketTypes.Caps(CAP_TX, CAP_DAY, maxSeedPayout);
        (,, bytes memory args,) = factory.previewMarket(config);
        (, bytes32 salt) = HookSalt.find(address(factory), FLAGS, type(UnicaMarketHook).creationCode, args);
        vm.prank(admin);
        (id, hook, executor) = factory.createMarket(config, salt, type(UnicaMarketHook).creationCode);
    }

    function _mint(bytes32 id, int24 lower, int24 upper, int256 liquidity) internal {
        PoolKey memory key = factory.poolKeyOf(id);
        MockERC20(Currency.unwrap(key.currency0)).mint(address(this), type(uint128).max);
        MockERC20(Currency.unwrap(key.currency1)).mint(address(this), type(uint128).max);
        MockERC20(Currency.unwrap(key.currency0)).approve(address(liquidityRouter), type(uint256).max);
        MockERC20(Currency.unwrap(key.currency1)).approve(address(liquidityRouter), type(uint256).max);
        liquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: liquidity, salt: bytes32(0)}),
            ""
        );
    }

    function _payoutEquivalent(UnicaMarketTypes.Market memory m, int24 lower, int24 upper, uint128 depth)
        internal
        pure
        returns (uint256)
    {
        uint160 sl = TickMath.getSqrtPriceAtTick(lower);
        uint160 su = TickMath.getSqrtPriceAtTick(upper);
        return m.assetIsCurrency0
            ? SqrtPriceMath.getAmount1Delta(sl, su, depth, true)
            : SqrtPriceMath.getAmount0Delta(sl, su, depth, true);
    }
}
