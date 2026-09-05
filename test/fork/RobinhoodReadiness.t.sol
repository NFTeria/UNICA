// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {IStateView} from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import {IImmutableState} from "@uniswap/v4-periphery/src/interfaces/IImmutableState.sol";
import {IMsgSender} from "@uniswap/v4-periphery/src/interfaces/IMsgSender.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {ActionConstants} from "@uniswap/v4-periphery/src/libraries/ActionConstants.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {ObserverHook} from "./ObserverHook.sol";
import {ForkLiquidityHelper} from "./ForkLiquidityHelper.sol";

/// @notice The one function of the observed router this probe calls, as the executor declares it.
interface IObservedUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @title RobinhoodReadiness, a read-only compatibility probe of an observed v4 stack on a fork
/// @notice Robinhood testnet is under compatibility investigation. This file runs only against a fork
///         of chain id 46630 and is skipped everywhere else: set `ROBINHOOD_RPC_URL` (or pass
///         `--fork-url`) to run it. Nothing here is broadcast, and nothing here is the settlement hook.
///
///         The five addresses below were OBSERVED on that chain with `cast code` on 2026-09-05; they are
///         not read from this repository's chain tables, which do not list chain 46630 and revert for it.
///         Every probe is labelled by what it exercises:
///           REAL FORK BEHAVIOUR: calls into the observed bytecode at those addresses, unmodified.
///           MOCKED CONTROL: contracts this file deploys itself (two test tokens, a liquidity helper,
///           an observer hook). They are instruments, never the subject.
///
///         Every test asserts what the observed stack DOES, so a change on that chain shows up as a
///         failure here. The finding the swap probes record, measured 2026-09-05: the observed router
///         refuses the executor's exact plan whenever `hookData` is non-empty (an empty revert from
///         inside its `unlockCallback`, before any call to the PoolManager), accepts the same plan with
///         empty `hookData`, and accepts non-empty `hookData` only when `ExactInputSingleParams` carries
///         one extra static word between `amountOutMinimum` and `hookData`: the `uint256 minHopPriceX36`
///         field v4-periphery added in commit 03b2d09 ("feat: add per-hop slippage to single swaps and
///         flip to output/input ratio (#516)", 2026-03-17). The periphery this repository pins
///         (7ebd04b) and the router listed for Sepolia predate that field. The settlement hook requires
///         exactly one bytes32 of hook data (spec C1), so the executor's shipped encoding cannot settle
///         through this router. `test/fork/SepoliaRouterControl.t.sol` runs the same instrument and the
///         same encoding through the listed Sepolia router and passes.
///
///         NOT RUN here, on purpose: everything that is a property of `V4SettlementHook` and
///         `SettlementExecutor`. Both resolve the router, the payout currency and the PoolManager from
///         the chain id at construction and revert with `UnsupportedChainId` on 46630, so neither can
///         exist on this fork without a source change, and this probe makes none. That leaves the
///         admitted-path refusals (invariant I1), full-fill and minimum-output refusals (I6), the
///         native-settle defence (I7), replay refusal (I5), the hostile-pool and wrong-currency
///         refusals (spec C2/C4) all unexercised on this chain. The observer hook below records the
///         same three inputs the admission check reads; it enforces nothing.
contract RobinhoodReadinessTest is Test {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    uint256 internal constant CHAIN_ID = 46630;

    // The observed stack, and the code each address held on 2026-09-05 (size in bytes, keccak256 of
    // the runtime, both read with `cast code | cast keccak`). Probe (a) re-reads them on the fork.
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    uint256 internal constant POOL_MANAGER_SIZE = 24009;
    bytes32 internal constant POOL_MANAGER_KECCAK = 0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626;

    address internal constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    uint256 internal constant UNIVERSAL_ROUTER_SIZE = 24546;
    bytes32 internal constant UNIVERSAL_ROUTER_KECCAK =
        0xfdd90802f39ce5fc8bac4c2f1b3ac7bac530fd17ff46b0630f1bd00f1e14082f;

    address internal constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    uint256 internal constant STATE_VIEW_SIZE = 3531;
    bytes32 internal constant STATE_VIEW_KECCAK = 0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6;

    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 internal constant PERMIT2_SIZE = 9152;
    bytes32 internal constant PERMIT2_KECCAK = 0x0117e0ed818bc3f2a8729ffc336c837e63e965f04b473047b39b35ad86aac259;

    address internal constant CREATE2_FACTORY_OBSERVED = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint256 internal constant CREATE2_FACTORY_SIZE = 69;
    bytes32 internal constant CREATE2_FACTORY_KECCAK =
        0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989;

    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    int24 internal constant TICK_LOWER = -120;
    int24 internal constant TICK_UPPER = 120;
    int256 internal constant LIQUIDITY = 1e18;
    uint128 internal constant AMOUNT_IN = 1e15;
    /// @dev The Universal Router command that runs v4 actions, as the executor encodes it.
    uint8 internal constant COMMAND_V4_SWAP = 0x10;
    /// @dev The observer's permission bits: beforeSwap | afterSwap, the settlement hook's two swap callbacks.
    uint160 internal constant OBSERVER_FLAGS = Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;

    IPoolManager internal manager = IPoolManager(POOL_MANAGER);
    IStateView internal stateView = IStateView(STATE_VIEW);

    // MOCKED CONTROL: everything below is deployed by this test.
    MockERC20 internal tokenA;
    MockERC20 internal tokenB;
    ForkLiquidityHelper internal helper;
    address internal merchant = makeAddr("merchant");

    /// @dev Everything a swap through the observed router leaves behind, read once and asserted by
    ///      probes (e), (f) and (g) each from their own angle.
    struct SwapObservation {
        PoolKey key;
        ObserverHook observer;
        bytes32 hookData;
        uint256 routerNativeBefore;
        uint256 routerNativeAfter;
        uint256 routerTokenAfter;
        uint256 callerNativeBefore;
        uint256 callerNativeAfter;
        uint256 callerTokenBefore;
        uint256 callerTokenAfter;
        uint256 merchantTokenBefore;
        uint256 merchantTokenAfter;
        uint256 managerNativeBefore;
        uint256 managerNativeAfter;
    }

    function setUp() public {
        if (block.chainid != CHAIN_ID) {
            string memory url = vm.envOr("ROBINHOOD_RPC_URL", string(""));
            if (bytes(url).length == 0) {
                vm.skip(true);
                return;
            }
            vm.createSelectFork(url);
        }
        assertEq(block.chainid, CHAIN_ID, "not a fork of the Robinhood testnet");

        tokenA = new MockERC20("Probe Token A", "PTA", 18);
        tokenB = new MockERC20("Probe Token B", "PTB", 18);
        helper = new ForkLiquidityHelper(manager);
        tokenA.mint(address(this), 1_000_000 ether);
        tokenB.mint(address(this), 1_000_000 ether);
        tokenA.approve(address(helper), type(uint256).max);
        tokenB.approve(address(helper), type(uint256).max);
        vm.deal(address(this), 100 ether);

        vm.label(POOL_MANAGER, "PoolManager(observed)");
        vm.label(UNIVERSAL_ROUTER, "UniversalRouter(observed)");
        vm.label(STATE_VIEW, "StateView(observed)");
        vm.label(PERMIT2, "Permit2(observed)");
        vm.label(CREATE2_FACTORY_OBSERVED, "CREATE2Factory(observed)");
        vm.label(address(tokenA), "PTA(mock)");
        vm.label(address(tokenB), "PTB(mock)");
        vm.label(address(helper), "ForkLiquidityHelper(mock)");
    }

    // ------------------------------------------------------------------ (a) code readback. REAL.

    /// @notice Probe (a), REAL FORK BEHAVIOUR: the five addresses hold exactly the code read on
    ///         2026-09-05, by size and by keccak256. A redeploy at any of them fails this test, which is
    ///         the point: every other probe is about this bytecode and no other.
    function test_a_ObservedCodeMatchesTheReadback() public view {
        _assertCode(POOL_MANAGER, POOL_MANAGER_SIZE, POOL_MANAGER_KECCAK, "PoolManager");
        _assertCode(UNIVERSAL_ROUTER, UNIVERSAL_ROUTER_SIZE, UNIVERSAL_ROUTER_KECCAK, "UniversalRouter");
        _assertCode(STATE_VIEW, STATE_VIEW_SIZE, STATE_VIEW_KECCAK, "StateView");
        _assertCode(PERMIT2, PERMIT2_SIZE, PERMIT2_KECCAK, "Permit2");
        _assertCode(CREATE2_FACTORY_OBSERVED, CREATE2_FACTORY_SIZE, CREATE2_FACTORY_KECCAK, "CREATE2 factory");
    }

    /// @notice Probe (a), REAL FORK BEHAVIOUR: the interfaces the settlement path depends on answer.
    ///         Outside an unlock the router's `msgSender()` is zero, exactly as the Sepolia router answers.
    function test_a_ObservedInterfacesAnswer() public view {
        assertEq(IMsgSender(UNIVERSAL_ROUTER).msgSender(), address(0), "router msgSender outside a lock");
        (bool ok, bytes memory ret) = POOL_MANAGER.staticcall(abi.encodeWithSignature("protocolFeeController()"));
        assertTrue(ok && ret.length == 32, "PoolManager.protocolFeeController() did not answer");
        assertEq(abi.decode(ret, (address)), address(0), "protocol fee controller is set on this PoolManager");
    }

    // ------------------------------------------------------------------ (b) linkage. REAL.

    /// @notice Probe (b), REAL FORK BEHAVIOUR: the StateView and the Universal Router both name the
    ///         observed PoolManager as theirs, so the three form one stack rather than three strays.
    function test_b_StateViewAndRouterPointAtThePoolManager() public view {
        assertEq(address(stateView.poolManager()), POOL_MANAGER, "StateView.poolManager()");
        assertEq(
            address(IImmutableState(UNIVERSAL_ROUTER).poolManager()), POOL_MANAGER, "UniversalRouter.poolManager()"
        );
    }

    // ------------------------------------------------------------------ (c) hook-address validation. REAL.

    /// @notice Probe (c), REAL FORK BEHAVIOUR: the observed PoolManager's own Hooks library refuses a
    ///         hook address whose flag bits are inconsistent, refuses a non-zero hook address with no
    ///         flags, refuses the zero address with a dynamic fee, and accepts the zero address with a
    ///         static fee. This is the validation the settlement hook's mined address must pass.
    function test_c_PoolManagerValidatesHookAddresses() public {
        (Currency c0, Currency c1) = _orderedTokens();

        // A returns-delta flag without its action flag: invalid by the library's first rule.
        address inconsistent = address(uint160(0x4444 << 144) | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG);
        _expectHookAddressNotValid(inconsistent);
        manager.initialize(_key(c0, c1, FEE, IHooks(inconsistent)), SQRT_PRICE_1_1);

        // A non-zero address with no flag bits and a static fee: invalid.
        address flagless = address(uint160(0x4444 << 144));
        _expectHookAddressNotValid(flagless);
        manager.initialize(_key(c0, c1, FEE, IHooks(flagless)), SQRT_PRICE_1_1);

        // The zero address with a dynamic fee: invalid.
        _expectHookAddressNotValid(address(0));
        manager.initialize(_key(c0, c1, LPFeeLibrary.DYNAMIC_FEE_FLAG, IHooks(address(0))), SQRT_PRICE_1_1);

        // The zero address with a static fee: a hookless pool, accepted.
        int24 tick = manager.initialize(_key(c0, c1, FEE, IHooks(address(0))), SQRT_PRICE_1_1);
        assertEq(tick, 0, "a 1:1 pool initialises at tick 0");
    }

    // ------------------------------------------------------------------ (d) hookless pool. REAL manager, MOCKED tokens.

    /// @notice Probe (d), REAL PoolManager and StateView, MOCKED tokens and liquidity helper: a fresh
    ///         hookless pool initialises at 1:1, reads back through the observed StateView, takes
    ///         liquidity settled with sync-then-settle, and reports it.
    function test_d_HooklessPoolInitialisesAndTakesLiquidity() public {
        (Currency c0, Currency c1) = _orderedTokens();
        PoolKey memory key = _key(c0, c1, FEE, IHooks(address(0)));
        PoolId id = key.toId();

        manager.initialize(key, SQRT_PRICE_1_1);
        (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee) = stateView.getSlot0(id);
        assertEq(sqrtPriceX96, SQRT_PRICE_1_1, "slot0 price");
        assertEq(tick, 0, "slot0 tick");
        assertEq(protocolFee, 0, "slot0 protocol fee");
        assertEq(lpFee, FEE, "slot0 lp fee");
        assertEq(stateView.getLiquidity(id), 0, "liquidity before");

        uint256 manager0Before = c0.balanceOf(POOL_MANAGER);
        uint256 manager1Before = c1.balanceOf(POOL_MANAGER);
        BalanceDelta delta = helper.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: LIQUIDITY, salt: 0})
        );
        assertLt(delta.amount0(), 0, "adding liquidity owes currency0");
        assertLt(delta.amount1(), 0, "adding liquidity owes currency1");
        assertEq(stateView.getLiquidity(id), uint128(uint256(LIQUIDITY)), "liquidity after");
        assertEq(c0.balanceOf(POOL_MANAGER) - manager0Before, uint256(uint128(-delta.amount0())), "currency0 settled");
        assertEq(c1.balanceOf(POOL_MANAGER) - manager1Before, uint256(uint128(-delta.amount1())), "currency1 settled");
        assertEq(c0.balanceOf(address(helper)), 0, "helper keeps currency0");
        assertEq(c1.balanceOf(address(helper)), 0, "helper keeps currency1");
    }

    // ------------------------------------------------------------------ (e) the executor's plan. REAL router, MOCKED hook.

    /// @notice Probe (e) as specified, REAL Universal Router and PoolManager, MOCKED observer hook: the
    ///         executor's exact plan (command 0x10; SWAP_EXACT_IN_SINGLE, SETTLE, TAKE; OPEN_DELTA;
    ///         hookData = one bytes32) is REFUSED by the observed router: an empty revert from inside its
    ///         `unlockCallback`, before any call reaches the PoolManager. The observer never runs and
    ///         nothing moves. This is the compatibility finding; the two tests after it locate the cause.
    function test_e_RouterRefusesTheExecutorsPlanWithHookData() public {
        (PoolKey memory key, ObserverHook observer) = _observedPool();
        bytes32 hookData = keccak256(abi.encode(block.chainid, address(this), "probe order"));
        (bytes memory commands, bytes[] memory inputs) = _executorPlan(key, AMOUNT_IN, abi.encode(hookData));
        uint256 callerBefore = address(this).balance;

        vm.expectRevert(bytes(""));
        IObservedUniversalRouter(UNIVERSAL_ROUTER).execute{value: AMOUNT_IN}(
            commands, inputs, block.timestamp + 1 hours
        );

        assertEq(observer.beforeSwapCalls(), 0, "the observer ran");
        assertEq(observer.afterSwapCalls(), 0, "the observer ran");
        assertEq(address(this).balance, callerBefore, "value left the caller");
        assertEq(tokenA.balanceOf(merchant), 0, "the recipient received output");
    }

    /// @notice Probe (e) cause, part one, REAL router: the identical plan with EMPTY hookData is
    ///         accepted and swaps through the hooked pool, so the refusal is about the hook data, not
    ///         the hook, the pool, the actions or the native settle.
    function test_e_RouterAcceptsTheExecutorsPlanOnlyWithEmptyHookData() public {
        (PoolKey memory key, ObserverHook observer) = _observedPool();
        (bytes memory commands, bytes[] memory inputs) = _executorPlan(key, AMOUNT_IN, "");

        IObservedUniversalRouter(UNIVERSAL_ROUTER).execute{value: AMOUNT_IN}(
            commands, inputs, block.timestamp + 1 hours
        );

        assertEq(observer.beforeSwapCalls(), 1, "one beforeSwap");
        assertEq(observer.afterSwapCalls(), 1, "one afterSwap");
        assertEq(observer.beforeSender(), UNIVERSAL_ROUTER, "sender");
        assertEq(observer.beforeRouterCaller(), address(this), "router.msgSender()");
        assertEq(observer.beforeHookDataLength(), 0, "hookData length");
        assertEq(observer.afterAmount0(), -int128(AMOUNT_IN), "full fill");
        assertGt(tokenA.balanceOf(merchant), 0, "recipient paid");
    }

    /// @notice Probe (e) cause, part two, REAL router, MOCKED observer: the same bytes32 hookData IS
    ///         delivered when `ExactInputSingleParams` is encoded with one extra static word before
    ///         `hookData` (`minHopPriceX36`, v4-periphery commit 03b2d09, 2026-03-17). The observer
    ///         then sees the three inputs the settlement hook's admission check reads: `sender` = the
    ///         observed router, the router's `msgSender()` = this contract, `hookData` = the bytes32.
    ///         The executor does not produce this layout; this test documents what the router expects.
    function test_e_PerHopLayoutDeliversHookDataAndCaller() public {
        SwapObservation memory o = _swapThroughTheObservedRouterPerHopLayout();
        assertEq(o.observer.beforeSender(), UNIVERSAL_ROUTER, "beforeSwap sender is not the observed router");
        assertEq(o.observer.beforeRouterCaller(), address(this), "router.msgSender() during the callback");
        assertEq(o.observer.beforeHookDataLength(), 32, "hookData length in beforeSwap");
        assertEq(o.observer.beforeHookData(), o.hookData, "hookData in beforeSwap");
        assertEq(o.observer.afterSender(), UNIVERSAL_ROUTER, "afterSwap sender is not the observed router");
        assertEq(o.observer.afterHookDataLength(), 32, "hookData length in afterSwap");
        assertEq(o.observer.afterHookData(), o.hookData, "hookData in afterSwap");
        assertTrue(o.observer.beforeZeroForOne(), "direction");
    }

    /// @notice Probe (e) control, REAL PoolManager, MOCKED sender: the same pool swapped directly
    ///         through the helper records the helper as `sender` and zero as the router caller, so the
    ///         recorded sender is the real `msg.sender` of `swap` and not a constant, and the counters count.
    function test_e_Control_DirectSwapRecordsADifferentSender() public {
        (PoolKey memory key, ObserverHook observer) = _observedPool();
        bytes32 other = keccak256("direct hookData");
        helper.swap{value: AMOUNT_IN}(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(uint256(AMOUNT_IN)),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            abi.encode(other)
        );
        assertEq(observer.beforeSwapCalls(), 1, "one beforeSwap");
        assertEq(observer.afterSwapCalls(), 1, "one afterSwap");
        assertEq(observer.beforeSender(), address(helper), "direct sender is the helper");
        assertEq(observer.beforeRouterCaller(), address(0), "a non-router sender answers no msgSender");
        assertEq(observer.beforeHookData(), other, "hookData");
    }

    // ------------------------------------------------------------------ (f) full fill, one callback each. REAL router, MOCKED hook.

    /// @notice Probe (f), REAL router and PoolManager, MOCKED observer, under the legacy layout the
    ///         router accepts: exactly one beforeSwap and one afterSwap, the specified input consumed in
    ///         full, and the pool's credit equal to what the recipient received.
    function test_f_PerHopLayoutOneCallbackEachAndFullFill() public {
        SwapObservation memory o = _swapThroughTheObservedRouterPerHopLayout();
        assertEq(o.observer.beforeSwapCalls(), 1, "exactly one beforeSwap");
        assertEq(o.observer.afterSwapCalls(), 1, "exactly one afterSwap");
        assertEq(o.observer.beforeAmountSpecified(), -int256(uint256(AMOUNT_IN)), "amountSpecified in beforeSwap");
        assertEq(o.observer.afterAmountSpecified(), -int256(uint256(AMOUNT_IN)), "amountSpecified in afterSwap");
        assertEq(o.observer.afterAmount0(), -int128(AMOUNT_IN), "consumed equals specified (full fill)");
        int128 out = o.observer.afterAmount1();
        assertGt(out, 0, "no output");
        assertEq(o.merchantTokenAfter - o.merchantTokenBefore, uint256(uint128(out)), "recipient received the credit");
    }

    // ------------------------------------------------------------------ (g) never strand. REAL router.

    /// @notice Probe (g), REAL router and PoolManager, under the per-hop-slippage layout the router accepts: after
    ///         the swap the observed router holds no native value and none of the output token, this
    ///         contract received none of the output and paid exactly the input, and the PoolManager's
    ///         native balance grew by exactly that input.
    function test_g_PerHopLayoutNothingIsStranded() public {
        SwapObservation memory o = _swapThroughTheObservedRouterPerHopLayout();
        assertEq(o.routerNativeAfter, o.routerNativeBefore, "router native balance changed");
        assertEq(o.routerNativeAfter, 0, "router holds native value");
        assertEq(o.routerTokenAfter, 0, "router holds the output token");
        // This contract minted the token, so it holds a balance; the output must not have come here.
        assertEq(o.callerTokenAfter, o.callerTokenBefore, "caller received output token");
        assertEq(o.callerNativeBefore - o.callerNativeAfter, AMOUNT_IN, "caller paid something other than the input");
        assertEq(o.managerNativeAfter - o.managerNativeBefore, AMOUNT_IN, "PoolManager did not receive the input");
    }

    // ------------------------------------------------------------------ the shared swap

    /// @dev Mines and deploys the observer at an address carrying its flag bits, initialises a native /
    ///      mock-token pool with it on the observed PoolManager, and adds liquidity through the helper.
    function _observedPool() internal returns (PoolKey memory key, ObserverHook observer) {
        observer = _deployObserver();
        key = _key(CurrencyLibrary.ADDRESS_ZERO, Currency.wrap(address(tokenA)), FEE, IHooks(address(observer)));
        manager.initialize(key, SQRT_PRICE_1_1);
        helper.modifyLiquidity{value: 1 ether}(
            key,
            ModifyLiquidityParams({tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: LIQUIDITY, salt: 0})
        );
        assertEq(observer.beforeSwapCalls(), 0, "no swap yet");
    }

    /// @dev One swap through the observed Universal Router in the per-hop-slippage layout it accepts, with one
    ///      bytes32 of hook data, and the balances around it.
    function _swapThroughTheObservedRouterPerHopLayout() internal returns (SwapObservation memory o) {
        (o.key, o.observer) = _observedPool();
        o.hookData = keccak256(abi.encode(block.chainid, address(this), "probe order"));
        (bytes memory commands, bytes[] memory inputs) = _perHopLayoutPlan(o.key, AMOUNT_IN, abi.encode(o.hookData));

        o.routerNativeBefore = UNIVERSAL_ROUTER.balance;
        o.callerNativeBefore = address(this).balance;
        o.callerTokenBefore = tokenA.balanceOf(address(this));
        o.merchantTokenBefore = tokenA.balanceOf(merchant);
        o.managerNativeBefore = POOL_MANAGER.balance;

        IObservedUniversalRouter(UNIVERSAL_ROUTER).execute{value: AMOUNT_IN}(
            commands, inputs, block.timestamp + 1 hours
        );

        o.routerNativeAfter = UNIVERSAL_ROUTER.balance;
        o.routerTokenAfter = tokenA.balanceOf(UNIVERSAL_ROUTER);
        o.callerNativeAfter = address(this).balance;
        o.callerTokenAfter = tokenA.balanceOf(address(this));
        o.merchantTokenAfter = tokenA.balanceOf(merchant);
        o.managerNativeAfter = POOL_MANAGER.balance;
    }

    /// @dev The executor's plan, field for field (`SettlementExecutor._plan`): swap exact input with the
    ///      given hook data, settle the native input from the router's forwarded value, take the whole
    ///      output to the recipient. Only the minimum output differs: one wei here, the order's minimum there.
    function _executorPlan(PoolKey memory key, uint128 amountIn, bytes memory hookData)
        internal
        view
        returns (bytes memory commands, bytes[] memory inputs)
    {
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: key, zeroForOne: true, amountIn: amountIn, amountOutMinimum: 1, hookData: hookData
            })
        );
        return _plan(key, params);
    }

    /// @dev The same plan with `ExactInputSingleParams` in the layout v4-periphery has had since commit
    ///      03b2d09: `poolKey, zeroForOne, amountIn, amountOutMinimum, uint256 minHopPriceX36, hookData`,
    ///      with `minHopPriceX36 = 0` (no per-hop floor). Encoded as a dynamic struct: an outer offset
    ///      word, then the ten-word head, then the hook data tail.
    function _perHopLayoutPlan(PoolKey memory key, uint128 amountIn, bytes memory hookData)
        internal
        view
        returns (bytes memory commands, bytes[] memory inputs)
    {
        bytes[] memory params = new bytes[](3);
        bytes memory head = abi.encode(key, true, amountIn, uint128(1), uint160(0), hookData);
        params[0] = abi.encodePacked(uint256(0x20), head);
        return _plan(key, params);
    }

    function _plan(PoolKey memory key, bytes[] memory params)
        internal
        view
        returns (bytes memory commands, bytes[] memory inputs)
    {
        bytes memory actions =
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE), uint8(Actions.TAKE));
        params[1] = abi.encode(key.currency0, ActionConstants.OPEN_DELTA, false);
        params[2] = abi.encode(key.currency1, merchant, ActionConstants.OPEN_DELTA);
        inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
        commands = abi.encodePacked(COMMAND_V4_SWAP);
    }

    /// @dev CREATE2 from this contract with a salt mined for the observer's flag bits. The search checks
    ///      the bits only: on a fork, checking each candidate for code would cost one RPC read per try.
    function _deployObserver() internal returns (ObserverHook observer) {
        bytes32 initCodeHash = keccak256(abi.encodePacked(type(ObserverHook).creationCode, abi.encode(manager)));
        bytes32 salt;
        address predicted;
        for (uint256 i = 0; i < 200_000; i++) {
            salt = bytes32(i);
            predicted = vm.computeCreate2Address(salt, initCodeHash, address(this));
            if (uint160(predicted) & Hooks.ALL_HOOK_MASK == OBSERVER_FLAGS) break;
            predicted = address(0);
        }
        require(predicted != address(0), "no salt found for the observer's flags");
        observer = new ObserverHook{salt: salt}(manager);
        assertEq(address(observer), predicted, "observer landed elsewhere");
        assertEq(uint160(address(observer)) & Hooks.ALL_HOOK_MASK, OBSERVER_FLAGS, "observer flags");
        vm.label(address(observer), "ObserverHook(mock)");
    }

    // ------------------------------------------------------------------ helpers

    function _assertCode(address at, uint256 size, bytes32 hash, string memory name) internal view {
        bytes memory code = at.code;
        assertEq(code.length, size, string.concat(name, ": code size"));
        assertEq(keccak256(code), hash, string.concat(name, ": code keccak"));
    }

    function _expectHookAddressNotValid(address hooks) internal {
        vm.expectRevert(abi.encodeWithSelector(Hooks.HookAddressNotValid.selector, hooks));
    }

    function _orderedTokens() internal view returns (Currency c0, Currency c1) {
        (address lo, address hi) =
            address(tokenA) < address(tokenB) ? (address(tokenA), address(tokenB)) : (address(tokenB), address(tokenA));
        return (Currency.wrap(lo), Currency.wrap(hi));
    }

    function _key(Currency c0, Currency c1, uint24 fee, IHooks hooks) internal pure returns (PoolKey memory) {
        return PoolKey({currency0: c0, currency1: c1, fee: fee, tickSpacing: TICK_SPACING, hooks: hooks});
    }

    receive() external payable {}
}
