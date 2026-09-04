// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {AddressConstants} from "hookmate/constants/AddressConstants.sol";
import {V4PoolManagerDeployer} from "hookmate/artifacts/V4PoolManager.sol";
import {V4SettlementHook} from "../../src/V4SettlementHook.sol";
import {SettlementExecutor} from "../../src/SettlementExecutor.sol";
import {UniswapDeployments} from "../../src/libraries/UniswapDeployments.sol";
import {UniversalRouterV2Sepolia} from "./artifacts/UniversalRouterV2Sepolia.sol";
import {ExecutorHarness} from "./ExecutorHarness.sol";

/// @title SettlementTestBase, the local v4 topology every UNICA test stands on
/// @notice The PoolManager under test is the OFFICIAL bytecode, not a local compile: hookmate ships
///         the creation code of Uniswap's deployment, and it is placed at the canonical Sepolia
///         address so the hook's zero-argument constructor resolves it exactly as on the live chain.
///         The Universal Router is the OFFICIAL deployed runtime, read from Sepolia and placed at its
///         Sepolia address; its immutables already point at that PoolManager. The other routers are
///         v4-core's own test routers. The second currency is a labelled mock; the live pool uses
///         Circle USDC. Nothing here is a live-testnet result.
/// @dev Why not compile v4-core's PoolManager: its exact `0.8.26` pragma would force a second
///      compiler into the tree, and on day 1 that produced two different builds of the hook.
abstract contract SettlementTestBase is Test {
    using PoolIdLibrary for PoolKey;

    uint256 internal constant SEPOLIA = 11155111;
    /// @dev The size of Uniswap's deployed PoolManager runtime on every v4 testnet, measured with
    ///      `cast code` on 2026-09-04. The base asserts the etched bytecode has exactly this size.
    uint256 internal constant OFFICIAL_POOL_MANAGER_RUNTIME_BYTES = 24009;

    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint160 internal constant MIN_PRICE_LIMIT = TickMath.MIN_SQRT_PRICE + 1;
    uint160 internal constant MAX_PRICE_LIMIT = TickMath.MAX_SQRT_PRICE - 1;
    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    bytes internal constant ZERO_BYTES = "";

    /// @dev The declared permission set, spec section 5: beforeSwap | afterSwap = 0xC0.
    uint160 internal constant DECLARED_MASK = Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
    /// @dev Namespaced so an etched address never lands on a precompile or a reserved prefix.
    address internal constant HOOK_ADDR = address(uint160(DECLARED_MASK) ^ (0x4444 << 144));

    bytes32 internal constant RECEIPT_TOPIC =
        keccak256("SettlementReceipt(bytes32,bytes32,address,address,uint128,uint128,uint128)");
    bytes32 internal constant HOOK_FEE_TOPIC = keccak256("HookFee(bytes32,address,uint128,uint128)");

    IPoolManager internal manager;
    /// @notice The official Universal Router, at its Sepolia address, running its deployed bytecode.
    address internal universalRouter;
    V4SettlementHook internal hook;
    SettlementExecutor internal executor;
    PoolSwapTest internal swapRouter;
    PoolModifyLiquidityTest internal liquidityRouter;
    /// @notice A labelled local stand-in for the payout token. 18 decimals so a 1:1 pool price reads plainly.
    MockERC20 internal usdc;
    Currency internal usdcCurrency;

    /// @notice Deploys the official PoolManager bytecode at the canonical address, the official
    ///         Universal Router runtime at its address, the two test routers, and the mock token;
    ///         funds this contract; approves the test routers.
    function setUpV4() internal {
        vm.chainId(SEPOLIA);
        vm.deal(address(this), 100 ether);

        address canonical = AddressConstants.getPoolManagerAddress(block.chainid);
        bytes memory initcode = abi.encodePacked(V4PoolManagerDeployer.initcode(), abi.encode(address(this)));
        // The same technique forge-std uses for deployCodeTo: run the init code at the target address.
        vm.etch(canonical, initcode);
        (bool ok, bytes memory runtime) = canonical.call("");
        require(ok, "official PoolManager init code reverted");
        vm.etch(canonical, runtime);
        assertEq(runtime.length, OFFICIAL_POOL_MANAGER_RUNTIME_BYTES, "etched PoolManager is not the official runtime");
        manager = IPoolManager(canonical);
        vm.label(canonical, "PoolManager(official bytecode)");

        universalRouter = UniswapDeployments.universalRouter(block.chainid);
        etchOfficialUniversalRouter();

        swapRouter = new PoolSwapTest(manager);
        liquidityRouter = new PoolModifyLiquidityTest(manager);
        vm.label(address(swapRouter), "PoolSwapTest");
        vm.label(address(liquidityRouter), "PoolModifyLiquidityTest");

        usdc = new MockERC20("USD Coin (local mock)", "USDC", 18);
        usdcCurrency = Currency.wrap(address(usdc));
        usdc.mint(address(this), 1_000_000 ether);
        usdc.approve(address(swapRouter), type(uint256).max);
        usdc.approve(address(liquidityRouter), type(uint256).max);
        vm.label(address(usdc), "USDC(mock)");
    }

    /// @notice Places the deployed Universal Router runtime at its Sepolia address and proves it is
    ///         the recorded bytecode. Called by setUpV4 and again by a test that replaced it.
    function etchOfficialUniversalRouter() internal {
        assertEq(universalRouter, UniversalRouterV2Sepolia.ADDRESS);
        vm.etch(universalRouter, UniversalRouterV2Sepolia.runtime());
        assertEq(
            keccak256(universalRouter.code), UniversalRouterV2Sepolia.RUNTIME_KECCAK, "not the deployed router runtime"
        );
        vm.label(universalRouter, "UniversalRouter(official bytecode)");
    }

    /// @notice Deploys the hook at the namespaced 0xC0 address and the executor at the address the hook
    ///         derives for it, so `hook.SETTLEMENT_EXECUTOR()` is a contract that exists.
    function deploySettlement() internal {
        deployCodeTo("V4SettlementHook.sol:V4SettlementHook", "", HOOK_ADDR);
        hook = V4SettlementHook(HOOK_ADDR);
        deployCodeTo("SettlementExecutor.sol:SettlementExecutor", "", hook.SETTLEMENT_EXECUTOR());
        executor = SettlementExecutor(hook.SETTLEMENT_EXECUTOR());
        vm.label(HOOK_ADDR, "V4SettlementHook");
        vm.label(hook.SETTLEMENT_EXECUTOR(), "SettlementExecutor");
    }

    /// @notice Places the executor HARNESS at the executor's address instead, so a test can drive the
    ///         official router with a plan the real executor would never compose and reach the
    ///         hook's own checks. The hook admits it by address alone, exactly as it would the real one.
    function deployExecutorHarness() internal returns (ExecutorHarness harness) {
        deployCodeTo("ExecutorHarness.sol:ExecutorHarness", "", hook.SETTLEMENT_EXECUTOR());
        harness = ExecutorHarness(hook.SETTLEMENT_EXECUTOR());
        executor = SettlementExecutor(address(harness));
        vm.label(address(harness), "ExecutorHarness");
    }

    /// @notice The native-ETH / mock-USDC key for a given hook, matching the live pool's shape.
    function nativeUsdcKey(IHooks withHook) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: usdcCurrency,
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: withHook
        });
    }

    /// @notice Initialises the pool at 1:1 and adds symmetric liquidity around the price.
    function initNativePoolWithLiquidity(IHooks withHook, uint256 ethForLiquidity)
        internal
        returns (PoolKey memory key, PoolId id)
    {
        key = nativeUsdcKey(withHook);
        return initPoolWithLiquidity(key, ethForLiquidity);
    }

    /// @notice Initialises any native/USDC key at 1:1 and adds symmetric liquidity around the price.
    function initPoolWithLiquidity(PoolKey memory key, uint256 ethForLiquidity)
        internal
        returns (PoolKey memory, PoolId id)
    {
        id = key.toId();
        manager.initialize(key, SQRT_PRICE_1_1);
        int24 lower = -120 - (-120 % key.tickSpacing);
        int24 upper = 120 - (120 % key.tickSpacing);
        liquidityRouter.modifyLiquidity{value: ethForLiquidity}(
            key, ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: 1e18, salt: 0}), ZERO_BYTES
        );
        return (key, id);
    }

    /// @notice An exact-input native swap through the official test router (the day-1 path).
    function swapNativeExactIn(PoolKey memory key, uint256 amountIn, bytes memory hookData)
        internal
        returns (BalanceDelta)
    {
        return swapRouter.swap{value: amountIn}(
            key,
            SwapParams({zeroForOne: true, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: MIN_PRICE_LIMIT}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );
    }

    /// @dev The receipts the hook emitted since `vm.recordLogs()`, and the amountOut of the last one.
    function receiptsEmitted() internal view returns (uint256 n, uint256 lastAmountOut) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(hook) && logs[i].topics[0] == RECEIPT_TOPIC) {
                n++;
                (,, lastAmountOut,) = abi.decode(logs[i].data, (address, uint128, uint128, uint128));
            }
        }
    }

    receive() external payable {}
}
