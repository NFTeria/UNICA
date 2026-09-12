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
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {UnicaExecutorV3} from "../../src/v3/UnicaExecutorV3.sol";
import {UnicaHookV3} from "../../src/v3/UnicaHookV3.sol";

/// @title The V3 live-fire rehearsal, against the contracts that are actually deployed
/// @notice V3 is deployed on Ethereum Sepolia. This file asks the one question that decides whether
///         a deployment that has not settled has a code problem or a funding problem, and it asks it
///         of the REAL deployment rather than of a fresh local one —
///         `vm.createSelectFork` at the head block, no `deployCodeTo`, no etched hook. Every address
///         below was read off the chain in the preflight, not assumed.
///
///         THE ONLY THING SYNTHESISED IS THE USDC BALANCE. `vm.deal` and `deal()` put test assets in
///         the deployer's hands so the pool can be seeded; everything after that is the deployed
///         bytecode doing its own work. If this passes, the live path is sound.
///
///         NOTHING HERE ASSERTS A MOMENT IN TIME. Two rows used to: one held that the deployer was
///         short of the seeding floor, the other that the deployment had never receipted anything.
///         Both were true when they were written and both became false as the chain moved, and then
///         they reported real progress as failures. The balance row now asserts the precondition it
///         cares about (the deployer CAN seed), and the settlement row asserts a DELTA of one
///         receipt across the rehearsal, which stays true however many came before.
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
    /// @dev V1's floor was a flat 1.500000 USDC, which was V1's proof swap valued at the price V1
    ///      opened its pool at. It is not a property of the code: the live pool's price has moved,
    ///      and a fixed floor written for one price refuses every swap at another. The floor is now
    ///      derived from the pool's OWN current price, less this allowance for the fee and the
    ///      slippage the swap itself causes. It is a tolerance, not a valuation, and nothing here is
    ///      a claim about what an asset is worth.
    uint256 internal constant SETTLE_FLOOR_BPS = 9000; // 90% of the price-implied output

    UnicaHookV3 internal hook;
    UnicaExecutorV3 internal executor;
    IPoolManager internal manager;
    PoolKey internal key;
    address internal merchant = address(0xBEEF);
    address internal payer = address(0xCAFE);

    /// @dev Like every fork row, this needs a network. Without one it says so and skips rather than
    ///      failing on a missing environment variable, so a bare run reports a stated negative
    ///      instead of a red that looks like broken code.
    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true, "SEPOLIA_RPC_URL is unset: this rehearsal needs a fork of Ethereum Sepolia");
            return;
        }
        vm.createSelectFork(rpc);
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

    /// @notice THE PRECONDITION THE REHEARSAL BELOW NEEDS. The live deployer's USDC, against V1's
    ///         seeding floor.
    /// @dev THIS ROW WAS INVERTED ON 2026-09-12, and the inversion is the point. It used to assert
    ///      `held < floor` under the title "the only blocker is the deployer's USDC balance", which
    ///      was a passing row exactly while the wallet was empty. The wallet was funded, the balance
    ///      passed the floor, and the row failed — reporting the good news as a defect. A row that
    ///      can only be true once is a snapshot, not a check. What is worth checking every run is
    ///      the precondition itself: the deployer can seed the pool. It reads the real balance on
    ///      the fork, which is the real balance on the chain, and nothing here is dealt.
    function test_L1_TheDeployerCanAffordToSeed() public {
        uint256 held = IERC20Minimal(USDC).balanceOf(DEPLOYER);
        uint256 floor = 5_000_000;
        emit log_named_uint("deployer USDC (6dp)", held);
        emit log_named_uint("seeding floor (6dp)", floor);
        if (held < floor) {
            emit log_named_uint("SHORT BY (6dp)", floor - held);
            emit log_string("BLOCKED: fund the deployer with USDC, then this row and the one below run for real.");
        }
        assertGe(held, floor, "the deployer cannot cover the seeding floor: fund it before going live");
    }

    /// @notice And the rehearsal: with the balance filled in and nothing else changed, does the
    ///         DEPLOYED V3 settle? Pool initialised, liquidity seeded, order created, paid, receipted.
    /// @dev MEASURED AS A DELTA, NOT AS AN ABSOLUTE. This row used to open with
    ///      `assertEq(hook.receiptCount(), 0)`, which asserted that the deployment had never settled
    ///      anything. That can only be true until the first settlement, including one this very file
    ///      produces, so it was a claim about one moment rather than about the code. What the
    ///      rehearsal actually proves is that ONE more receipt exists afterwards than before,
    ///      whatever the count was on arrival.
    function test_L2_WithFundingTheDeployedV3Settles() public {
        uint256 receiptsBefore = hook.receiptCount();
        emit log_named_uint("receipts before this rehearsal", receiptsBefore);

        // The one synthetic step. Everything after it is the deployed bytecode.
        vm.deal(DEPLOYER, 1 ether);
        deal(USDC, DEPLOYER, SEED_USDC + 1); // the budget, plus the one unit the pool may round up by
        vm.deal(payer, 1 ether);

        // 1 — open the pool at V1's price if it is not open yet. Whether it already exists is
        //     another fact about a moment in time, so it is READ and branched on rather than
        //     asserted; either way the rehearsal below runs against a pool at a known price.
        (uint160 existing,,,) = manager.getSlot0(key.toId());
        if (existing == 0) {
            vm.prank(DEPLOYER);
            manager.initialize(key, SQRT_PRICE_2500_USDC_PER_ETH);
        } else {
            emit log_named_uint("the V3 pool was already open at sqrtPriceX96", existing);
        }
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(key.toId());
        assertGt(sqrtPriceX96, 0, "the pool is not open after the initialisation step");

        // 2 — seed it, full range, with V1's budget.
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(TICK_LOWER),
            TickMath.getSqrtPriceAtTick(TICK_UPPER),
            SEED_ETH,
            SEED_USDC
        );
        assertGt(liquidity, 0, "the seeding budget produced no liquidity");

        // What that liquidity actually costs at the price the pool is at NOW, read back rather than
        // assumed. `getLiquidityForAmounts` rounds DOWN to the liquidity the budget can buy and the
        // PoolManager rounds the deposit UP, so the position needs up to one unit more of each leg
        // than the budget names. Funding the helper with the measured requirement plus that one unit
        // is arithmetic hygiene, not a bigger budget: the size of the position is still V1's, and
        // both legs are asserted to stay inside V1's budget below.
        (uint256 need0, uint256 need1) = LiquidityAmounts.getAmountsForLiquidity(
            sqrtPriceX96, TickMath.getSqrtPriceAtTick(TICK_LOWER), TickMath.getSqrtPriceAtTick(TICK_UPPER), liquidity
        );
        emit log_named_uint("seeding needs (wei, native leg)", need0);
        emit log_named_uint("seeding needs (USDC, 6dp)", need1);
        assertLe(need0, SEED_ETH, "the native leg outgrew V1's budget");
        assertLe(need1, SEED_USDC, "the USDC leg outgrew V1's budget");
        _seed(liquidity, need0 + 1, need1 + 1);
        assertGt(manager.getLiquidity(key.toId()), 0, "the pool holds no liquidity after seeding");

        // 3 — the order, with V1's proof-swap parameters. The SALT is derived rather than fixed: a
        //     zero salt names one order id per creator for the life of the deployment, and this
        //     deployment has already used it, so a fixed salt is another assertion about a moment in
        //     time (`OrderExists`). The parameters that matter to the rehearsal are unchanged.
        bytes32 salt = keccak256(abi.encode("unica-v3 live fire rehearsal", block.number, receiptsBefore));
        uint128 minOut = _floorAtCurrentPrice(sqrtPriceX96);
        emit log_named_uint("order minimum, derived from the pool's own price (USDC, 6dp)", minOut);
        vm.prank(DEPLOYER);
        bytes32 orderId = executor.createOrder(merchant, key, SWAP_ETH, minOut, uint64(block.timestamp + 1 days), salt);

        // 4 — pay it, through the deployed executor and the official router.
        uint256 merchantBefore = IERC20Minimal(USDC).balanceOf(merchant);
        vm.prank(payer);
        executor.pay{value: SWAP_ETH}(orderId);

        // 5 — the post-state that decides it.
        assertEq(hook.receiptCount(), receiptsBefore + 1, "the rehearsal did not add exactly one receipt");
        uint256 received = IERC20Minimal(USDC).balanceOf(merchant) - merchantBefore;
        assertGe(received, minOut, "the merchant received less than the order's minimum");
        emit log_named_uint("merchant received (USDC, 6dp)", received);
        UnicaExecutorV3.Order memory order = executor.orders(orderId);
        assertEq(uint8(order.status), uint8(UnicaExecutorV3.Status.Settled), "the order is not Settled");

        // Nothing kept anywhere on the path.
        assertEq(EXECUTOR.balance, 0, "the executor kept native value");
        assertEq(IERC20Minimal(USDC).balanceOf(EXECUTOR), 0, "the executor kept the payout token");
    }

    /// @dev What `SWAP_ETH` is worth in the payout token at the pool's CURRENT price, less the
    ///      tolerance above. `price = (sqrtPriceX96 / 2**96) ** 2` in raw units of currency1 per raw
    ///      unit of currency0, applied in two `mulDiv` steps so the intermediate never overflows.
    ///      Read off the pool, never assumed, so this rehearsal keeps working at any price.
    function _floorAtCurrentPrice(uint160 sqrtPriceX96) internal pure returns (uint128) {
        uint256 half = FullMath.mulDiv(SWAP_ETH, sqrtPriceX96, 1 << 96);
        uint256 quoted = FullMath.mulDiv(half, sqrtPriceX96, 1 << 96);
        uint256 floorAmount = (quoted * SETTLE_FLOOR_BPS) / 10_000;
        require(floorAmount > 0 && floorAmount <= type(uint128).max, "the pool's price implies no usable output");
        return uint128(floorAmount);
    }

    /// @dev The PoolManager only talks to a contract inside `unlock`, so the seeding leg needs one.
    ///      It is handed exactly what the position costs; whatever the pool does not take, it keeps,
    ///      and the caller asserts the cost stayed inside V1's budget before calling.
    function _seed(uint128 liquidity, uint256 fund0, uint256 fund1) internal {
        SeedHelper helper = new SeedHelper(manager, USDC);
        vm.prank(DEPLOYER);
        IERC20Minimal(USDC).transfer(address(helper), fund1);
        vm.deal(address(helper), fund0);
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
