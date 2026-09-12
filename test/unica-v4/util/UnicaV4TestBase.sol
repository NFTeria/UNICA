// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {V4PoolManagerDeployer} from "hookmate/artifacts/V4PoolManager.sol";

import {UnicaMarketTypes} from "../../../src/unica-v4/UnicaMarketTypes.sol";
import {UnicaMarketRegistry} from "../../../src/unica-v4/UnicaMarketRegistry.sol";
import {UnicaMarketHook} from "../../../src/unica-v4/UnicaMarketHook.sol";
import {UnicaMarketExecutor} from "../../../src/unica-v4/UnicaMarketExecutor.sol";

/// @title UnicaV4TestBase, the local topology every UNICA v4 hook row stands on
/// @notice The PoolManager here is OFFICIAL BYTECODE — hookmate's copy of Uniswap's own deployment
///         creation code, run at a fresh address with this test contract as its owner. Nothing about
///         the swap path, the fee split or the `Swap` event is a local re-implementation, which is
///         what makes the fee rows (H12a to H12c) a measurement of Uniswap's arithmetic rather than
///         a restatement of our own.
///
///         WHAT PLAYS THE FACTORY. This test contract. The registry records `msg.sender` as its
///         `FACTORY` at construction, and the hook records `msg.sender` as its own `FACTORY` at
///         CREATE2 time, so deploying both from here makes the test the factory for both — the exact
///         relationship `UnicaMarketFactory` will have in production, without depending on a
///         contract another builder is writing at the same time. The hook is deployed with `new
///         …{salt: …}`, which is CREATE2 from this address, and the salt is mined against the very
///         creation code in the tree, so the address always carries the real flag bits.
///
/// @dev Every market is built from fresh token addresses, so `version` is always 1 and the registry's
///      one-live-market-per-pair rule never gets in the way of a second fixture in the same test.
///      Token ADDRESSES are chosen, not accepted: the currency ordering of a v4 pool is the address
///      ordering of its tokens, and half the arithmetic in the hook is about which side the asset is
///      on, so a row that only ever ran with the asset as currency0 would prove half the contract.
abstract contract UnicaV4TestBase is Test {
    /// @dev `beforeInitialize | beforeSwap | afterSwap`.
    uint160 internal constant HOOK_FLAGS =
        uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
    uint16 internal constant HOOK_FLAG_BITS = 0x20C0;

    uint24 internal constant FEE_3000 = 3000;
    int24 internal constant SPACING_60 = 60;
    int24 internal constant SPACING_10 = 10;

    /// @dev Caps generous enough that nothing in a settlement row trips one by accident; the cap rows
    ///      set their own.
    uint128 internal constant CAP_PER_TX = type(uint128).max / 4;
    uint128 internal constant CAP_PER_DAY = type(uint128).max / 2;
    uint128 internal constant CAP_SEED = type(uint128).max / 2;

    /// @notice Everything a row needs to talk to one market.
    struct Market {
        UnicaMarketHook hook;
        UnicaMarketExecutor executor;
        bytes32 marketId;
        PoolKey key;
        MockERC20 asset;
        MockERC20 payout;
        uint8 assetDecimals;
        uint8 payoutDecimals;
        bool assetIsCurrency0;
        int24 initTick;
        uint160 initSqrtPriceX96;
    }

    /// @notice How a row wants its market built. Defaults come from `defaultSpec()`.
    struct MarketSpec {
        uint8 assetDecimals;
        uint8 payoutDecimals;
        bool assetIsCurrency0;
        uint24 fee;
        int24 tickSpacing;
        // Seed sizes in WHOLE tokens; the base scales them by each token's decimals.
        uint256 seedAssetWhole;
        uint256 seedPayoutWhole;
        // Half-width of the seed range, in tick-spacing steps.
        int24 seedSteps;
        // Oracle policy. `adapter == address(0)` means a demonstration market.
        address adapter;
        bytes32 feedId;
        uint48 maxAge;
        uint16 maxDeviationBps;
        UnicaMarketTypes.Caps caps;
    }

    IPoolManager internal manager;
    UnicaMarketRegistry internal registry;
    PoolModifyLiquidityTest internal liquidityRouter;
    PoolSwapTest internal swapRouter;

    address internal merchant = makeAddr("merchant");
    address internal payer = makeAddr("payer");
    address internal stranger = makeAddr("stranger");

    /// @dev Token addresses are handed out in adjacent pairs so the low one and the high one are
    ///      always known before either contract exists.
    uint160 private _nextTokenPair = 0x100000;

    function setUpBase() internal {
        // A block timestamp far from zero: the oracle rows subtract ages from it, and `warp`ing
        // backwards from 1 is not a thing.
        vm.warp(1_800_000_000);

        manager = IPoolManager(V4PoolManagerDeployer.deploy(address(this)));
        vm.label(address(manager), "PoolManager(official bytecode)");

        registry = new UnicaMarketRegistry(address(this), false);
        vm.label(address(registry), "UnicaMarketRegistry");

        liquidityRouter = new PoolModifyLiquidityTest(manager);
        swapRouter = new PoolSwapTest(manager);
        vm.label(address(liquidityRouter), "PoolModifyLiquidityTest");
        vm.label(address(swapRouter), "PoolSwapTest");

        registry.setOrderCreator(address(this), true);
    }

    /// @notice The two addresses the NEXT market's tokens will occupy, in the spec's ordering. An
    ///         oracle adapter binds its pair as immutables, so it has to exist before the market it
    ///         serves; this is how a row builds one without guessing.
    function peekTokens(bool assetIsCurrency0) internal view returns (address asset, address payout) {
        address low = address(_nextTokenPair);
        address high = address(_nextTokenPair + 1);
        return assetIsCurrency0 ? (low, high) : (high, low);
    }

    /// @notice An 18-decimal asset that sorts first against a 6-decimal payout, fee 3000, spacing 60,
    ///         no oracle: the shape most rows want.
    function defaultSpec() internal pure returns (MarketSpec memory spec) {
        spec.assetDecimals = 18;
        spec.payoutDecimals = 6;
        spec.assetIsCurrency0 = true;
        spec.fee = FEE_3000;
        spec.tickSpacing = SPACING_60;
        spec.seedAssetWhole = 1_000_000;
        spec.seedPayoutWhole = 1_000_000;
        spec.seedSteps = 400;
        spec.caps =
            UnicaMarketTypes.Caps({maxPerTxPayout: CAP_PER_TX, maxPerDayPayout: CAP_PER_DAY, maxSeedPayout: CAP_SEED});
    }

    /// @notice The mirror shape: a 6-decimal asset that sorts second against an 18-decimal payout.
    /// @dev Named for what it changes rather than for a number, because "the other ordering" is the
    ///      thing under test — mutant M-fee-2 (always read the zeroForOne half) is invisible without it.
    function mirroredSpec() internal pure returns (MarketSpec memory spec) {
        spec = defaultSpec();
        spec.assetDecimals = 6;
        spec.payoutDecimals = 18;
        spec.assetIsCurrency0 = false;
    }

    // ---- building a market ---------------------------------------------------------------------

    /// @notice PROPOSED → INITIALIZED → SEEDED → ACTIVE, through the registry, with a real pool and
    ///         real liquidity underneath it.
    function deployMarket(MarketSpec memory spec) internal returns (Market memory m) {
        return deployMarketOn(registry, spec);
    }

    /// @notice The same, against a nominated registry. `Lookalike.t.sol` uses this to stand up an
    ///         attacker-owned copy of the whole arrangement.
    function deployMarketOn(UnicaMarketRegistry reg, MarketSpec memory spec) internal returns (Market memory m) {
        (m.asset, m.payout) = _newTokenPair(spec);
        m.assetDecimals = spec.assetDecimals;
        m.payoutDecimals = spec.payoutDecimals;
        m.assetIsCurrency0 = spec.assetIsCurrency0;

        m.marketId = keccak256(
            abi.encode(
                block.chainid, address(reg), address(m.asset), address(m.payout), uint32(1), spec.adapter, spec.feedId
            )
        );

        m.hook = _mineAndDeployHook(reg, spec, m);
        m.executor = UnicaMarketExecutor(m.hook.EXECUTOR());
        m.key = m.executor.poolKey();

        (m.initSqrtPriceX96, m.initTick) = _openingPrice(m.key, spec);

        _register(reg, spec, m);
        manager.initialize(m.key, m.initSqrtPriceX96);
        reg.recordInitialized(m.marketId);

        uint128 depth = _seed(m, spec);
        reg.recordSeeded(m.marketId, depth);
        reg.activate(m.marketId);

        vm.label(address(m.hook), "UnicaMarketHook");
        vm.label(address(m.executor), "UnicaMarketExecutor");
    }

    /// @dev The salt is mined against the creation code in the tree plus the exact 288 bytes of
    ///      arguments the market will carry, so the address this test deploys to is the address a
    ///      factory would predict for the same market, and its low fourteen bits really are 0x20C0.
    function _mineAndDeployHook(UnicaMarketRegistry reg, MarketSpec memory spec, Market memory m)
        private
        returns (UnicaMarketHook hook)
    {
        bytes memory args = abi.encode(
            manager,
            address(reg),
            m.marketId,
            address(m.asset),
            address(m.payout),
            spec.fee,
            spec.tickSpacing,
            spec.assetDecimals,
            spec.payoutDecimals
        );
        (address predicted, bytes32 salt) =
            HookMiner.find(address(this), HOOK_FLAGS, type(UnicaMarketHook).creationCode, args);

        hook = new UnicaMarketHook{salt: salt}(
            manager,
            address(reg),
            m.marketId,
            address(m.asset),
            address(m.payout),
            spec.fee,
            spec.tickSpacing,
            spec.assetDecimals,
            spec.payoutDecimals
        );
        assertEq(address(hook), predicted, "hook did not land at the mined address");
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, HOOK_FLAG_BITS, "hook flag bits are not 0x20C0");
    }

    function _register(UnicaMarketRegistry reg, MarketSpec memory spec, Market memory m) private {
        UnicaMarketTypes.Market memory record;
        record.asset = address(m.asset);
        record.payout = address(m.payout);
        record.version = 1;
        record.hook = address(m.hook);
        record.executor = address(m.executor);
        record.poolId = m.hook.POOL_ID();
        record.rateE18 = 1e18;
        record.initSqrtPriceX96 = m.initSqrtPriceX96;
        record.initTick = m.initTick;
        record.fee = spec.fee;
        record.tickSpacing = spec.tickSpacing;
        record.assetDecimals = spec.assetDecimals;
        record.payoutDecimals = spec.payoutDecimals;
        record.assetIsCurrency0 = m.assetIsCurrency0;

        reg.register(m.marketId, record, _policy(spec), spec.caps);
    }

    function _policy(MarketSpec memory spec) internal pure returns (UnicaMarketTypes.OraclePolicy memory policy) {
        if (spec.adapter == address(0)) return policy;
        policy.adapter = spec.adapter;
        policy.feedId = spec.feedId;
        policy.maxAge = spec.maxAge;
        policy.maxDeviationBps = spec.maxDeviationBps;
        policy.enabled = true;
    }

    /// @dev Two tokens whose ADDRESSES sort the way the spec asks. Deploying them at chosen addresses
    ///      rather than accepting whatever CREATE hands out is what makes "the other ordering" a
    ///      one-line change in a row instead of a lucky accident.
    function _newTokenPair(MarketSpec memory spec) private returns (MockERC20 asset, MockERC20 payout) {
        address low = address(_nextTokenPair);
        address high = address(_nextTokenPair + 1);
        _nextTokenPair += 2;

        (address assetAt, address payoutAt) = spec.assetIsCurrency0 ? (low, high) : (high, low);
        deployCodeTo("MockERC20.sol:MockERC20", abi.encode("UNICA test asset", "uASSET", spec.assetDecimals), assetAt);
        deployCodeTo("MockERC20.sol:MockERC20", abi.encode("UNICA test payout", "uPAY", spec.payoutDecimals), payoutAt);
        asset = MockERC20(assetAt);
        payout = MockERC20(payoutAt);
        vm.label(assetAt, "asset");
        vm.label(payoutAt, "payout");
    }

    /// @dev One whole asset for one whole payout, snapped DOWN onto the tick grid. Computed rather
    ///      than pasted, so a change of decimals in a spec cannot leave a stale constant behind.
    function _openingPrice(PoolKey memory key, MarketSpec memory spec)
        private
        pure
        returns (uint160 sqrtPriceX96, int24 tick)
    {
        (uint8 dec0, uint8 dec1) = spec.assetIsCurrency0
            ? (spec.assetDecimals, spec.payoutDecimals)
            : (spec.payoutDecimals, spec.assetDecimals);
        // price = raw currency1 per raw currency0 = 10**dec1 / 10**dec0, in Q192 before the square root.
        uint256 ratioQ192 = ((10 ** uint256(dec1)) << 192) / (10 ** uint256(dec0));
        sqrtPriceX96 = uint160(_sqrt(ratioQ192));

        tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        tick = _floorToSpacing(tick, key.tickSpacing);
        sqrtPriceX96 = TickMath.getSqrtPriceAtTick(tick);
    }

    function _floorToSpacing(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 rounded = (tick / spacing) * spacing;
        if (tick < 0 && rounded != tick) rounded -= spacing;
        return rounded;
    }

    /// @dev Babylonian square root, written here rather than imported so the opening price of these
    ///      fixtures does not silently depend on a library version.
    function _sqrt(uint256 x) private pure returns (uint256 z) {
        if (x == 0) return 0;
        z = x;
        uint256 y = (x >> 1) + 1;
        while (y < z) {
            z = y;
            y = (x / y + y) >> 1;
        }
    }

    /// @notice Real liquidity, centred on the opening tick, sized from whole-token amounts so the
    ///         same spec means the same depth whatever the decimals are.
    function _seed(Market memory m, MarketSpec memory spec) private returns (uint128 liquidity) {
        int24 halfWidth = spec.seedSteps * spec.tickSpacing;
        int24 lower = m.initTick - halfWidth;
        int24 upper = m.initTick + halfWidth;

        uint256 assetAmount = spec.seedAssetWhole * (10 ** uint256(spec.assetDecimals));
        uint256 payoutAmount = spec.seedPayoutWhole * (10 ** uint256(spec.payoutDecimals));
        (uint256 amount0, uint256 amount1) =
            spec.assetIsCurrency0 ? (assetAmount, payoutAmount) : (payoutAmount, assetAmount);

        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            m.initSqrtPriceX96, TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), amount0, amount1
        );
        require(liquidity > 0, "seed produced no liquidity");

        m.asset.mint(address(this), assetAmount * 4);
        m.payout.mint(address(this), payoutAmount * 4);
        m.asset.approve(address(liquidityRouter), type(uint256).max);
        m.payout.approve(address(liquidityRouter), type(uint256).max);

        liquidityRouter.modifyLiquidity(
            m.key,
            ModifyLiquidityParams({
                tickLower: lower, tickUpper: upper, liquidityDelta: int256(uint256(liquidity)), salt: 0
            }),
            ""
        );
    }

    /// @notice Withdraws the whole seed again, for the rows that ask what a drained market does.
    function drainSeed(Market memory m, MarketSpec memory spec, uint128 liquidity) internal {
        int24 halfWidth = spec.seedSteps * spec.tickSpacing;
        liquidityRouter.modifyLiquidity(
            m.key,
            ModifyLiquidityParams({
                tickLower: m.initTick - halfWidth,
                tickUpper: m.initTick + halfWidth,
                liquidityDelta: -int256(uint256(liquidity)),
                salt: 0
            }),
            ""
        );
    }

    /// @notice The liquidity currently sitting in the seed range, so a row can remove exactly it.
    function seedLiquidityOf(Market memory m, MarketSpec memory spec) internal view returns (uint128) {
        int24 halfWidth = spec.seedSteps * spec.tickSpacing;
        return LiquidityAmounts.getLiquidityForAmounts(
            m.initSqrtPriceX96,
            TickMath.getSqrtPriceAtTick(m.initTick - halfWidth),
            TickMath.getSqrtPriceAtTick(m.initTick + halfWidth),
            spec.assetIsCurrency0
                ? spec.seedAssetWhole * (10 ** uint256(spec.assetDecimals))
                : spec.seedPayoutWhole * (10 ** uint256(spec.payoutDecimals)),
            spec.assetIsCurrency0
                ? spec.seedPayoutWhole * (10 ** uint256(spec.payoutDecimals))
                : spec.seedAssetWhole * (10 ** uint256(spec.assetDecimals))
        );
    }

    // ---- payers and orders --------------------------------------------------------------------

    /// @notice Gives an address the input token and an approval to the market's executor.
    function fundPayer(Market memory m, address who, uint256 amount) internal {
        m.asset.mint(who, amount);
        vm.prank(who);
        m.asset.approve(address(m.executor), type(uint256).max);
    }

    /// @notice The order every settlement row starts from, created by this test as an allowlisted
    ///         creator, bound to `payer`, paying `merchant`.
    function createOrder(Market memory m, uint128 amountIn, uint128 minOut, bytes32 salt)
        internal
        returns (bytes32 orderId)
    {
        return m.executor.createOrder(merchant, payer, amountIn, minOut, uint64(block.timestamp + 1 hours), salt);
    }

    /// @notice What the pool would hand back for `amountIn` right now, measured by actually doing the
    ///         swap and undoing it with a state snapshot.
    /// @dev A quote from arithmetic would be a second implementation of the pool, and a wrong one is
    ///      indistinguishable from a wrong hook. This asks the pool.
    function quote(Market memory m, uint128 amountIn) internal returns (uint256 out) {
        uint256 snapshot = vm.snapshotState();
        bytes32 orderId = createOrder(m, amountIn, 1, keccak256(abi.encode("quote", amountIn, block.number)));
        fundPayer(m, payer, amountIn);
        uint256 before = m.payout.balanceOf(merchant);
        vm.prank(payer);
        m.executor.pay(orderId);
        out = m.payout.balanceOf(merchant) - before;
        vm.revertToState(snapshot);
    }

    // ---- decoding a hook revert -----------------------------------------------------------------

    /// @dev The PoolManager wraps every hook revert as
    ///      `WrappedError(address hook, bytes4 selector, bytes reason, bytes details)`. A row that
    ///      only asserted "it reverted" would pass against the wrong refusal, so every negative row
    ///      here unwraps it and reads the inner selector and arguments.
    function expectWrappedHookRevert(address hook, bytes memory innerRevert) internal {
        vm.expectRevert(
            abi.encodeWithSignature(
                "WrappedError(address,bytes4,bytes,bytes)",
                hook,
                IHooks.afterSwap.selector,
                innerRevert,
                abi.encodeWithSignature("HookCallFailed()")
            )
        );
    }

    function expectWrappedBeforeSwapRevert(address hook, bytes memory innerRevert) internal {
        vm.expectRevert(
            abi.encodeWithSignature(
                "WrappedError(address,bytes4,bytes,bytes)",
                hook,
                IHooks.beforeSwap.selector,
                innerRevert,
                abi.encodeWithSignature("HookCallFailed()")
            )
        );
    }

    function expectWrappedInitializeRevert(address hook, bytes memory innerRevert) internal {
        vm.expectRevert(
            abi.encodeWithSignature(
                "WrappedError(address,bytes4,bytes,bytes)",
                hook,
                IHooks.beforeInitialize.selector,
                innerRevert,
                abi.encodeWithSignature("HookCallFailed()")
            )
        );
    }

    // ---- log helpers ------------------------------------------------------------------------------

    function countLogs(Vm.Log[] memory logs, address emitter, bytes32 topic0) internal pure returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == emitter && logs[i].topics.length > 0 && logs[i].topics[0] == topic0) ++n;
        }
    }

    function indexOfLog(Vm.Log[] memory logs, address emitter, bytes32 topic0) internal pure returns (int256) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == emitter && logs[i].topics.length > 0 && logs[i].topics[0] == topic0) {
                return int256(i);
            }
        }
        return -1;
    }
}
