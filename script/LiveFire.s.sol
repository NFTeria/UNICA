// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {AddressConstants} from "hookmate/constants/AddressConstants.sol";
import {UnicaHook} from "../src/UnicaHook.sol";
import {Chains} from "./Chains.sol";

/// @title LiveFire, the day-1 proof on a public testnet, one stage at a time
/// @notice Four stages: deploy the hook by CREATE2, initialise the native-ETH / USDC pool, seed it,
///         swap through it. The first three read the chain first and skip themselves if their result
///         already exists, so a re-run after a failure repeats none of them. The swap stage always
///         sends a fresh swap: every run of `run()` or `--sig "swap()"` spends 0.001 ETH. `run()` does
///         all four; `--sig "deploy()"` and friends do one.
/// @dev The signer is whatever `--account` / `--sender` the operator passes; nothing here reads a key.
///      The chain must be a testnet listed in `Chains`; a mainnet id reverts before any broadcast.
contract LiveFire is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // ---- the settlement pool, spec section 7c -----------------------------------------------
    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    /// @dev sqrt(2500e6 / 1e18) * 2^96: 2,500 USDC per ETH with USDC as the 6-decimal currency1.
    ///      Derived, not typed: `python3 -c "from math import isqrt; print(isqrt(2500*10**6 * 2**192 // 10**18))"`.
    uint160 internal constant SQRT_PRICE_2500_USDC_PER_ETH = 3961408125713216879677197;
    /// @dev The seeding budget that works with what the deployer holds today (spec section 7c,
    ///      fallback plan): 0.008 ETH against 20 USDC, 8 USDC kept for swaps.
    uint256 internal constant SEED_ETH = 0.008 ether;
    uint256 internal constant SEED_USDC = 20_000_000;
    /// @dev Full range, rounded to the tick spacing.
    int24 internal constant TICK_LOWER = -887_220;
    int24 internal constant TICK_UPPER = 887_220;
    /// @dev The proof swap: 0.001 ETH exact-input, native, into USDC.
    uint256 internal constant SWAP_ETH = 0.001 ether;

    // ---- the day-1 permission set ----------------------------------------------------------
    uint160 internal constant FLAGS = Hooks.AFTER_SWAP_FLAG;
    /// @dev Uniswap reserves the top address byte 0x91 as a routing signal (spec addendum A9).
    uint8 internal constant RESERVED_PREFIX = 0x91;

    function run() external {
        deploy();
        init();
        seed();
        swap();
    }

    // ---- stage 1: the hook -----------------------------------------------------------------

    /// @notice Mines the salt deterministically (first salt from zero whose address carries the
    ///         flags and avoids the reserved prefix), then deploys through the canonical CREATE2
    ///         factory. Re-running after a deploy finds the same salt and skips.
    function deploy() public returns (UnicaHook hook) {
        Chains.requireTestnet(block.chainid);
        (address predicted, bytes32 salt) = predict();
        console.log("chain          ", block.chainid);
        console.log("hook predicted ", predicted);
        console.logBytes32(salt);
        if (predicted.code.length != 0) {
            console.log("hook already deployed, skipping");
            return UnicaHook(predicted);
        }
        vm.startBroadcast();
        hook = new UnicaHook{salt: salt}();
        vm.stopBroadcast();
        require(address(hook) == predicted, "deployed address differs from the prediction");
        require(uint160(address(hook)) & Hooks.ALL_HOOK_MASK == FLAGS, "address flags differ from the day-1 set");
        console.log("hook deployed  ", address(hook));
    }

    /// @notice Pure: the address and salt this repository's creation code lands on, on every chain
    ///         hookmate knows, because the constructor takes no arguments (spec section 7d).
    function predict() public pure returns (address predicted, bytes32 salt) {
        bytes memory creationCode = type(UnicaHook).creationCode;
        for (uint256 i = 0; i < HookMiner.MAX_LOOP; i++) {
            address a = HookMiner.computeAddress(CREATE2_FACTORY, i, creationCode);
            if (uint160(a) & Hooks.ALL_HOOK_MASK != FLAGS) continue;
            if (uint8(uint160(a) >> 152) == RESERVED_PREFIX) continue;
            return (a, bytes32(i));
        }
        revert("no salt found");
    }

    // ---- stage 2: the pool -----------------------------------------------------------------

    function poolKey() public view returns (PoolKey memory) {
        (address hook,) = predict();
        Chains.Config memory c = Chains.get(block.chainid);
        return PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(c.usdc),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });
    }

    function manager() public view returns (IPoolManager) {
        return IPoolManager(AddressConstants.getPoolManagerAddress(block.chainid));
    }

    function init() public {
        Chains.requireTestnet(block.chainid);
        PoolKey memory key = poolKey();
        require(address(key.hooks).code.length != 0, "deploy the hook first");
        (uint160 sqrtPriceX96,,,) = manager().getSlot0(key.toId());
        console.log("pool id");
        console.logBytes32(PoolId.unwrap(key.toId()));
        if (sqrtPriceX96 != 0) {
            console.log("pool already initialised, skipping; sqrtPriceX96", sqrtPriceX96);
            return;
        }
        vm.startBroadcast();
        manager().initialize(key, SQRT_PRICE_2500_USDC_PER_ETH);
        vm.stopBroadcast();
        (sqrtPriceX96,,,) = manager().getSlot0(key.toId());
        require(sqrtPriceX96 == SQRT_PRICE_2500_USDC_PER_ETH, "initialised at an unexpected price");
        console.log("pool initialised at sqrtPriceX96", sqrtPriceX96);
    }

    // ---- stage 3: liquidity ----------------------------------------------------------------

    function seed() public {
        Chains.requireTestnet(block.chainid);
        Chains.Config memory c = Chains.get(block.chainid);
        PoolKey memory key = poolKey();
        (uint160 sqrtPriceX96,,,) = manager().getSlot0(key.toId());
        require(sqrtPriceX96 != 0, "initialise the pool first");
        if (manager().getLiquidity(key.toId()) != 0) {
            console.log("pool already has liquidity, skipping;", manager().getLiquidity(key.toId()));
            return;
        }
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(TICK_LOWER),
            TickMath.getSqrtPriceAtTick(TICK_UPPER),
            SEED_ETH,
            SEED_USDC
        );
        (uint256 amount0, uint256 amount1) = LiquidityAmounts.getAmountsForLiquidity(
            sqrtPriceX96, TickMath.getSqrtPriceAtTick(TICK_LOWER), TickMath.getSqrtPriceAtTick(TICK_UPPER), liquidity
        );
        console.log("liquidity      ", liquidity);
        console.log("needs ETH (wei)", amount0);
        console.log("needs USDC (6) ", amount1);
        require(amount0 <= SEED_ETH && amount1 <= SEED_USDC, "amounts exceed the seeding budget");

        PoolModifyLiquidityTest router = PoolModifyLiquidityTest(c.poolModifyLiquidityTest);
        vm.startBroadcast();
        // Approve exactly the budget, never unlimited. v4 may owe one wei more than the estimate.
        IERC20Minimal(c.usdc).approve(address(router), SEED_USDC);
        // The router refunds every unused wei of native value to the caller.
        router.modifyLiquidity{value: SEED_ETH}(
            key,
            ModifyLiquidityParams({
                tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: int256(uint256(liquidity)), salt: 0
            }),
            ""
        );
        vm.stopBroadcast();
        console.log("pool liquidity ", manager().getLiquidity(key.toId()));
    }

    // ---- stage 4: the swap, through the hook ------------------------------------------------

    function swap() public {
        Chains.requireTestnet(block.chainid);
        Chains.Config memory c = Chains.get(block.chainid);
        PoolKey memory key = poolKey();
        require(manager().getLiquidity(key.toId()) != 0, "seed the pool first");
        UnicaHook hook = UnicaHook(address(key.hooks));
        uint256 before = hook.afterSwapCount();
        uint256 usdcBefore = IERC20Minimal(c.usdc).balanceOf(msg.sender);

        PoolSwapTest router = PoolSwapTest(c.poolSwapTest);
        vm.startBroadcast();
        BalanceDelta delta = router.swap{value: SWAP_ETH}(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(SWAP_ETH), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopBroadcast();

        console.log("delta amount0  ", delta.amount0());
        console.log("delta amount1  ", delta.amount1());
        console.log("afterSwapCount ", before, "->", hook.afterSwapCount());
        require(hook.afterSwapCount() == before + 1, "the hook did not observe the swap");
        require(delta.amount0() < 0 && delta.amount1() > 0, "unexpected swap direction");
        console.log("USDC received  ", IERC20Minimal(c.usdc).balanceOf(msg.sender) - usdcBefore);
    }
}
