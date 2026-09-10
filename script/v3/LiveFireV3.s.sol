// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {UnicaExecutorV3} from "../../src/v3/UnicaExecutorV3.sol";
import {UnicaHookV3} from "../../src/v3/UnicaHookV3.sol";

/// @title V3's first settlement, against the deployment that already exists
/// @notice V3 was deployed on 2026-09-09 and has settled nothing. This does not deploy anything: it
///         opens the pool that V3's hook guards, seeds it, registers one order and pays it, so
///         `receiptCount()` goes from 0 to 1. Every address is PINNED to what the chain already
///         holds and re-asserted at the top of every stage, because a script that re-derives an
///         address can quietly point at a different deployment than the one being claimed.
///
/// @dev Four stages, four signatures, in order. Each one is separately callable so a failure stops
///      at a boundary instead of half-way through a batch:
///
///        forge script script/v3/LiveFireV3.s.sol:LiveFireV3 --sig "check()"   -- read-only
///        forge script script/v3/LiveFireV3.s.sol:LiveFireV3 --sig "init()"    --broadcast ...
///        forge script script/v3/LiveFireV3.s.sol:LiveFireV3 --sig "seed()"    --broadcast ...
///        forge script script/v3/LiveFireV3.s.sol:LiveFireV3 --sig "order()"   --broadcast ...
///        forge script script/v3/LiveFireV3.s.sol:LiveFireV3 --sig "settle()"  --broadcast ...
///
///      The parameters are V1's, unchanged. A settlement proved with numbers invented for the
///      occasion proves the numbers; reusing the measured ones makes the two generations comparable.
///      Rehearsed end to end against live state in `test/v3/LiveFireV3Fork.t.sol`.
contract LiveFireV3 is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address internal constant HOOK = 0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0;
    address internal constant EXECUTOR = 0x015692C9E43ca19a2504F79368D1156A56680517;
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address internal constant LP_ROUTER = 0x0C478023803a644c94c4CE1C1e7b9A087e411B0A;

    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    uint160 internal constant SQRT_PRICE_2500_USDC_PER_ETH = 3961408125713216879677197;
    int24 internal constant TICK_LOWER = -887_220;
    int24 internal constant TICK_UPPER = 887_220;

    uint256 internal constant SEED_ETH = 0.008 ether;
    uint256 internal constant SEED_USDC = 20_000_000;
    uint256 internal constant SEED_USDC_FLOOR = 5_000_000;
    uint128 internal constant SWAP_ETH = 0.001 ether;
    uint128 internal constant SETTLE_MIN_OUT = 1_500_000;
    uint64 internal constant ORDER_TTL = 1 days;

    /// @dev The order id is deterministic, so `order()` and `settle()` agree without passing state
    ///      between two separately-signed runs. Zero, exactly as V1's first order used.
    bytes32 internal constant ORDER_SALT = bytes32(0);

    function key() public pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(USDC),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(HOOK)
        });
    }

    function manager() internal pure returns (IPoolManager) {
        return IPoolManager(POOL_MANAGER);
    }

    /// @dev Asserted at the top of every stage. The cost of being wrong here is a transaction aimed
    ///      at a contract nobody reviewed, so it is cheaper to re-read it four times than once.
    function _preflight() internal view {
        require(block.chainid == 11155111, "not Ethereum Sepolia");
        require(HOOK.code.length > 0, "the hook holds no code");
        require(EXECUTOR.code.length > 0, "the executor holds no code");
        require(UnicaHookV3(HOOK).SETTLEMENT_EXECUTOR() == EXECUTOR, "the hook names a different executor");
        require(UnicaExecutorV3(payable(EXECUTOR)).HOOK() == HOOK, "the executor names a different hook");
        require(
            UnicaExecutorV3(payable(EXECUTOR)).POOL_MANAGER() == POOL_MANAGER,
            "the executor names a different PoolManager"
        );
        require(UnicaHookV3(HOOK).PAYOUT_CURRENCY() == USDC, "the hook's payout currency is not this USDC");
    }

    /// @notice Read-only. Everything a signer should see before the first broadcast.
    function check() public view {
        _preflight();
        (uint160 sqrtPriceX96,,,) = manager().getSlot0(key().toId());
        console.log("chain id       ", block.chainid);
        console.log("hook           ", HOOK);
        console.log("executor       ", EXECUTOR);
        console.log("pool id        ");
        console.logBytes32(PoolId.unwrap(key().toId()));
        console.log("pool price     ", sqrtPriceX96, sqrtPriceX96 == 0 ? "(NOT INITIALISED)" : "(open)");
        console.log("pool liquidity ", manager().getLiquidity(key().toId()));
        console.log("receiptCount   ", UnicaHookV3(HOOK).receiptCount());
        console.log("orderCount     ", UnicaExecutorV3(payable(EXECUTOR)).orderCount());
        console.log("deployer USDC  ", IERC20Minimal(USDC).balanceOf(msg.sender));
        console.log("deployer ETH   ", msg.sender.balance);
    }

    /// @notice Stage 1 - open the pool V3's hook guards, at the price V1 opened at.
    function init() public {
        _preflight();
        (uint160 existing,,,) = manager().getSlot0(key().toId());
        if (existing != 0) {
            console.log("pool already open at", existing, "- skipping");
            return;
        }
        vm.startBroadcast();
        manager().initialize(key(), SQRT_PRICE_2500_USDC_PER_ETH);
        vm.stopBroadcast();
        (uint160 got,,,) = manager().getSlot0(key().toId());
        require(got == SQRT_PRICE_2500_USDC_PER_ETH, "the pool opened at an unexpected price");
        console.log("pool opened at ", got);
    }

    /// @notice Stage 2 - seed it, full range, on V1's budget and never more than the wallet holds.
    function seed() public {
        _preflight();
        (uint160 sqrtPriceX96,,,) = manager().getSlot0(key().toId());
        require(sqrtPriceX96 == SQRT_PRICE_2500_USDC_PER_ETH, "run init() first, or the price moved");
        if (manager().getLiquidity(key().toId()) > 0) {
            console.log("pool already has liquidity - skipping");
            return;
        }

        uint256 held = IERC20Minimal(USDC).balanceOf(msg.sender);
        uint256 budget = held < SEED_USDC ? held : SEED_USDC;
        require(budget >= SEED_USDC_FLOOR, "deployer holds less USDC than the seeding floor; top up first");

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(TICK_LOWER),
            TickMath.getSqrtPriceAtTick(TICK_UPPER),
            SEED_ETH,
            budget
        );
        require(liquidity > 0, "the seeding budget produced no liquidity");
        console.log("seeding USDC   ", budget);
        console.log("seeding ETH    ", SEED_ETH);
        console.log("liquidity      ", liquidity);

        vm.startBroadcast();
        // Exactly the budget, never unlimited: v4 may owe one wei more than the estimate, and an
        // unlimited approval outlives the transaction that needed it.
        IERC20Minimal(USDC).approve(LP_ROUTER, budget);
        PoolModifyLiquidityTest(LP_ROUTER).modifyLiquidity{value: SEED_ETH}(
            key(),
            ModifyLiquidityParams({
                tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: int256(uint256(liquidity)), salt: 0
            }),
            ""
        );
        vm.stopBroadcast();
        console.log("pool liquidity ", manager().getLiquidity(key().toId()));
    }

    /// @notice Stage 3 - one order, recipient = the signer, on V1's proof-swap parameters.
    function order() public {
        _preflight();
        require(manager().getLiquidity(key().toId()) > 0, "the pool holds no liquidity; run seed() first");
        vm.startBroadcast();
        bytes32 orderId = UnicaExecutorV3(payable(EXECUTOR))
            .createOrder(msg.sender, key(), SWAP_ETH, SETTLE_MIN_OUT, uint64(block.timestamp) + ORDER_TTL, ORDER_SALT);
        vm.stopBroadcast();
        console.log("order id       ");
        console.logBytes32(orderId);
        console.log("recipient      ", msg.sender);
        console.log("amountIn (wei) ", SWAP_ETH);
        console.log("minOut (USDC)  ", SETTLE_MIN_OUT);
    }

    /// @notice Stage 4 - pay it. This is the one that makes receiptCount 1.
    function settle() public {
        _preflight();
        UnicaExecutorV3 exec = UnicaExecutorV3(payable(EXECUTOR));
        uint256 before = UnicaHookV3(HOOK).receiptCount();
        uint256 merchantBefore = IERC20Minimal(USDC).balanceOf(msg.sender);

        bytes32 orderId = _orderIdFor(msg.sender);
        UnicaExecutorV3.Order memory o = exec.orders(orderId);
        require(o.recipient != address(0), "no such order; run order() first");
        require(uint8(o.status) == uint8(UnicaExecutorV3.Status.Open), "the order is not Open");

        vm.startBroadcast();
        exec.pay{value: SWAP_ETH}(orderId);
        vm.stopBroadcast();

        uint256 nowCount = UnicaHookV3(HOOK).receiptCount();
        require(nowCount == before + 1, "receiptCount did not increase by exactly one");
        uint256 received = IERC20Minimal(USDC).balanceOf(msg.sender) - merchantBefore;
        require(received >= SETTLE_MIN_OUT, "the merchant received less than the order's minimum");
        console.log("receiptCount   ", before, "->", nowCount);
        console.log("received USDC  ", received);
    }

    /// @dev Read from the executor's own line 217: the id is keyed on the CREATOR and a salt, not on
    ///      the order's contents. Mirrored here so `settle()` needs nothing carried over from
    ///      `order()`'s separate run, and checked against the chain before anything is signed - if
    ///      the recipient reads zero the id is wrong and the stage stops rather than paying a guess.
    function _orderIdFor(address creator) internal view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, EXECUTOR, creator, ORDER_SALT));
    }
}
