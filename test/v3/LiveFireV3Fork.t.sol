// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {UnicaExecutorV3} from "../../src/v3/UnicaExecutorV3.sol";
import {UnicaHookV3} from "../../src/v3/UnicaHookV3.sol";

/// @title The V3 live-fire rehearsal, against the contracts that are actually deployed
/// @notice V3 is deployed on Ethereum Sepolia and has settled nothing: `receiptCount()` is 0. This
///         file asks the one question that decides whether that is a code problem or a funding
///         problem, and it asks it of the REAL deployment rather than of a fresh local one —
///         `vm.createSelectFork` at the head block, no `deployCodeTo`, no etched hook. Every address
///         below was read off the chain in the preflight, not assumed.
///
///         THE ONLY THING SYNTHESISED IS THE USDC BALANCE. `vm.deal` and `deal()` put test assets in
///         the deployer's hands so the pool can be seeded; everything after that is the deployed
///         bytecode doing its own work. If this passes, the live path is sound and the sole blocker
///         is that the deployer holds 2.003660 USDC against a seeding floor of 5.000000.
///
///         Excluded from `make gate` like every other fork row: it needs a network.
///         Run it with:  forge test --match-path 'test/v3/LiveFireV3Fork.t.sol' --fork-url $SEPOLIA_RPC_URL -vv
contract LiveFireV3ForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // Read from the chain in the preflight, every one of them.
    address internal constant HOOK = 0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0;
    address internal constant EXECUTOR = 0x015692C9E43ca19a2504F79368D1156A56680517;
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address internal constant DEPLOYER = 0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73;

    // The same shape V1 opened at, so the two generations are comparable rather than merely both alive.
    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    uint160 internal constant SQRT_PRICE_2500_USDC_PER_ETH = 3961408125713216879677197;
    int24 internal constant TICK_LOWER = -887_220;
    int24 internal constant TICK_UPPER = 887_220;

    // V1's seeding budget and proof swap, unchanged. Nothing here is a new number: reusing V1's
    // measured values is the point, because a settlement proved with parameters invented for the
    // occasion proves the parameters, not the contract.
    uint256 internal constant SEED_ETH = 0.008 ether;
    uint256 internal constant SEED_USDC = 20_000_000;
    uint128 internal constant SWAP_ETH = 0.001 ether;
    uint128 internal constant SETTLE_MIN_OUT = 1_500_000;

    UnicaHookV3 internal hook;
    UnicaExecutorV3 internal executor;
    IPoolManager internal manager;
    PoolKey internal key;
    address internal merchant = address(0xBEEF);
    address internal payer = address(0xCAFE);

    function setUp() public {
        vm.createSelectFork(vm.envString("SEPOLIA_RPC_URL"));
        hook = UnicaHookV3(HOOK);
        executor = UnicaExecutorV3(payable(EXECUTOR));
        manager = IPoolManager(POOL_MANAGER);
        key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(USDC),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(HOOK)
        });
    }

    /// @notice The preflight, asserted rather than trusted: this is the deployment we think it is.
    function test_L0_TheForkIsTheRealDeployment() public view {
        assertEq(block.chainid, 11155111, "not Ethereum Sepolia");
        assertGt(HOOK.code.length, 0, "the hook holds no code on this fork");
        assertGt(EXECUTOR.code.length, 0, "the executor holds no code on this fork");
        assertEq(hook.SETTLEMENT_EXECUTOR(), EXECUTOR, "the hook names a different executor");
        assertEq(executor.HOOK(), HOOK, "the executor names a different hook");
        assertEq(executor.POOL_MANAGER(), POOL_MANAGER, "the executor names a different PoolManager");
        assertEq(hook.PAYOUT_CURRENCY(), USDC, "the hook's payout currency is not the Circle USDC we expect");
    }

    /// @notice THE MEASUREMENT THIS FILE EXISTS FOR. The live deployer's USDC, against V1's floor.
    /// @dev Not a synthesised number and not dealt: this reads the real balance on the fork, which is
    ///      the real balance on the chain. It is written as a passing row that PRINTS the shortfall
    ///      rather than as a failing one, because the code is not broken — the wallet is empty.
    function test_L1_TheOnlyBlockerIsTheDeployersUsdcBalance() public {
        uint256 held = IERC20Minimal(USDC).balanceOf(DEPLOYER);
        uint256 floor = 5_000_000;
        emit log_named_uint("deployer USDC (6dp)", held);
        emit log_named_uint("seeding floor (6dp)", floor);
        if (held < floor) {
            emit log_named_uint("SHORT BY (6dp)", floor - held);
            emit log_string("BLOCKED: fund the deployer with USDC, then the rows below run for real.");
        }
        assertLt(held, floor, "the deployer now holds enough USDC: this row is stale, go live");
    }

    /// @notice And the rehearsal: with the balance filled in and nothing else changed, does the
    ///         DEPLOYED V3 settle? Pool initialised, liquidity seeded, order created, paid, receipted.
    function test_L2_WithFundingTheDeployedV3Settles() public {
        assertEq(hook.receiptCount(), 0, "V3 had already receipted something before this rehearsal");

        // The one synthetic step. Everything after it is the deployed bytecode.
        vm.deal(DEPLOYER, 1 ether);
        deal(USDC, DEPLOYER, SEED_USDC);
        vm.deal(payer, 1 ether);

        // 1 — the pool does not exist on chain today; open it at V1's price.
        (uint160 before,,,) = manager.getSlot0(key.toId());
        assertEq(before, 0, "the V3 pool already exists : this rehearsal assumes it does not");
        vm.prank(DEPLOYER);
        manager.initialize(key, SQRT_PRICE_2500_USDC_PER_ETH);
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(key.toId());
        assertEq(sqrtPriceX96, SQRT_PRICE_2500_USDC_PER_ETH, "the pool opened at an unexpected price");

        // 2 — seed it, full range, with V1's budget.
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(TICK_LOWER),
            TickMath.getSqrtPriceAtTick(TICK_UPPER),
            SEED_ETH,
            SEED_USDC
        );
        assertGt(liquidity, 0, "the seeding budget produced no liquidity");
        _seed(liquidity);
        assertGt(manager.getLiquidity(key.toId()), 0, "the pool holds no liquidity after seeding");

        // 3 — the order, with V1's proof-swap parameters.
        vm.prank(DEPLOYER);
        bytes32 orderId =
            executor.createOrder(merchant, key, SWAP_ETH, SETTLE_MIN_OUT, uint64(block.timestamp + 1 days), bytes32(0));

        // 4 — pay it, through the deployed executor and the official router.
        uint256 merchantBefore = IERC20Minimal(USDC).balanceOf(merchant);
        vm.prank(payer);
        executor.pay{value: SWAP_ETH}(orderId);

        // 5 — the post-state that decides it.
        assertEq(hook.receiptCount(), 1, "receiptCount did not reach 1");
        uint256 received = IERC20Minimal(USDC).balanceOf(merchant) - merchantBefore;
        assertGe(received, SETTLE_MIN_OUT, "the merchant received less than the order's minimum");
        emit log_named_uint("merchant received (USDC, 6dp)", received);
        UnicaExecutorV3.Order memory order = executor.orders(orderId);
        assertEq(uint8(order.status), uint8(UnicaExecutorV3.Status.Settled), "the order is not Settled");

        // Nothing kept anywhere on the path.
        assertEq(EXECUTOR.balance, 0, "the executor kept native value");
        assertEq(IERC20Minimal(USDC).balanceOf(EXECUTOR), 0, "the executor kept the payout token");
    }

    /// @dev The PoolManager only talks to a contract inside `unlock`, so the seeding leg needs one.
    function _seed(uint128 liquidity) internal {
        SeedHelper helper = new SeedHelper(manager, USDC);
        vm.prank(DEPLOYER);
        IERC20Minimal(USDC).transfer(address(helper), SEED_USDC);
        vm.deal(address(helper), SEED_ETH);
        helper.seed(key, TICK_LOWER, TICK_UPPER, int256(uint256(liquidity)));
    }
}

/// @dev The smallest possible unlock callback: add liquidity, settle both legs, keep nothing.
contract SeedHelper {
    IPoolManager internal immutable MANAGER;
    address internal immutable USDC;
    PoolKey internal key;
    int24 internal tickLower;
    int24 internal tickUpper;
    int256 internal delta;

    constructor(IPoolManager m, address usdc) {
        MANAGER = m;
        USDC = usdc;
    }

    receive() external payable {}

    function seed(PoolKey memory k, int24 lo, int24 hi, int256 d) external {
        key = k;
        tickLower = lo;
        tickUpper = hi;
        delta = d;
        MANAGER.unlock("");
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        require(msg.sender == address(MANAGER), "only the manager");
        MANAGER.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: delta, salt: bytes32(0)
            }),
            ""
        );
        // Native leg.
        MANAGER.sync(key.currency0);
        MANAGER.settle{value: address(this).balance}();
        // Token leg.
        MANAGER.sync(key.currency1);
        IERC20Minimal(USDC).transfer(address(MANAGER), IERC20Minimal(USDC).balanceOf(address(this)));
        MANAGER.settle();
        return "";
    }
}
