// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
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
import {AddressConstants} from "hookmate/constants/AddressConstants.sol";
import {V4PoolManagerDeployer} from "hookmate/artifacts/V4PoolManager.sol";

/// @title UnicaTestBase, the local v4 topology every UNICA test stands on
/// @notice The PoolManager under test is the OFFICIAL bytecode, not a local compile: hookmate ships
///         the creation code of Uniswap's deployment, and it is placed at the canonical Sepolia
///         address so the hook's zero-argument constructor resolves it exactly as on the live chain.
///         The routers are v4-core's own test routers. The second currency is a labelled mock;
///         the live pool uses Circle USDC. Nothing here is a live-testnet result.
/// @dev Why not compile v4-core's PoolManager: its exact `0.8.26` pragma would force a second
///      compiler into the tree, and on day 1 that produced two different builds of the hook.
abstract contract UnicaTestBase is Test {
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

    IPoolManager internal manager;
    PoolSwapTest internal swapRouter;
    PoolModifyLiquidityTest internal liquidityRouter;
    /// @notice A labelled local stand-in for the payout token. 18 decimals so a 1:1 pool price reads plainly.
    MockERC20 internal usdc;
    Currency internal usdcCurrency;

    /// @notice Deploys the official PoolManager bytecode at the canonical address, the two official
    ///         routers, and the mock token; funds this contract; approves the routers.
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

    /// @notice The native-ETH / mock-USDC key for a given hook, matching the live pool's shape.
    function nativeUsdcKey(IHooks hook) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: usdcCurrency,
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: hook
        });
    }

    /// @notice Initialises the pool at 1:1 and adds symmetric liquidity around the price.
    function initNativePoolWithLiquidity(IHooks hook, uint256 ethForLiquidity)
        internal
        returns (PoolKey memory key, PoolId id)
    {
        key = nativeUsdcKey(hook);
        id = key.toId();
        manager.initialize(key, SQRT_PRICE_1_1);
        liquidityRouter.modifyLiquidity{value: ethForLiquidity}(
            key, ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: 1e18, salt: 0}), ZERO_BYTES
        );
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

    receive() external payable {}
}
