// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {V4PoolManagerDeployer} from "hookmate/artifacts/V4PoolManager.sol";
import {UnicaStockSettlementHook} from "../../../src/experimental/robinhood-testnet/UnicaStockSettlementHook.sol";
import {
    UnicaStockSettlementExecutor
} from "../../../src/experimental/robinhood-testnet/UnicaStockSettlementExecutor.sol";
import {MockStockToken, UnicaTestDollar} from "./TestAssets.sol";

/// @title The local topology the experimental stock-settlement rows stand on
/// @notice Entirely local. No network, no chain 46630, no CRE, no credentials. The PoolManager is
///         Uniswap's own creation code as hookmate ships it — not a local re-compile — so the hook's
///         permission-bit validation is performed by the real implementation.
///
///         NO UNIVERSAL ROUTER IS ETCHED HERE, and its absence is the point. This generation reaches
///         the pool by taking the PoolManager's lock itself, so there is no router to place, no
///         parameter layout to guess, and no `msgSender()` attribution to trust.
abstract contract StockSettlementBase is Test {
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    int24 internal constant TICK_LOWER = -60000;
    int24 internal constant TICK_UPPER = 60000;
    uint256 internal constant OFFICIAL_POOL_MANAGER_RUNTIME_BYTES = 24009;

    uint160 internal constant DECLARED_FLAGS =
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;

    IPoolManager internal manager;
    PoolModifyLiquidityTest internal liquidityRouter;
    MockStockToken internal stock;
    UnicaTestDollar internal dollar;
    UnicaStockSettlementHook internal hook;
    UnicaStockSettlementExecutor internal executor;
    PoolKey internal key;

    address internal merchant = makeAddr("merchant");
    address internal payer = makeAddr("payer");

    function _setUpTopology() internal {
        manager = IPoolManager(address(V4PoolManagerDeployer.deploy(address(this))));
        assertEq(
            address(manager).code.length,
            OFFICIAL_POOL_MANAGER_RUNTIME_BYTES,
            "the etched PoolManager is not the official build"
        );
        liquidityRouter = new PoolModifyLiquidityTest(manager);

        stock = new MockStockToken();
        dollar = new UnicaTestDollar();

        // The executor is deployed by CREATE from this test contract, so its address is predictable
        // before it exists. That is what breaks the circular dependency: the hook needs the
        // executor's address at construction, and the executor needs the hook's.
        address predictedExecutor = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));

        bytes memory args = abi.encode(manager, predictedExecutor, address(stock), address(dollar));
        address minedHook = _localHookAddress();
        deployCodeTo("UnicaStockSettlementHook.sol:UnicaStockSettlementHook", args, minedHook);
        hook = UnicaStockSettlementHook(minedHook);

        executor = new UnicaStockSettlementExecutor(manager, minedHook, address(stock), address(dollar));
        assertEq(address(executor), predictedExecutor, "the executor did not land where the hook expects it");

        // The address encodes the permissions. Asserted numerically rather than assumed: a hook whose
        // address does not carry a flag is silently never called for that callback.
        assertEq(uint160(minedHook) & Hooks.ALL_HOOK_MASK, DECLARED_FLAGS, "address flags are not the declared set");
        assertEq(uint160(minedHook) & Hooks.ALL_HOOK_MASK, 0x20C0, "0x20C0 = beforeInitialize|beforeSwap|afterSwap");

        (Currency c0, Currency c1) = address(stock) < address(dollar)
            ? (Currency.wrap(address(stock)), Currency.wrap(address(dollar)))
            : (Currency.wrap(address(dollar)), Currency.wrap(address(stock)));
        key = PoolKey({currency0: c0, currency1: c1, fee: FEE, tickSpacing: TICK_SPACING, hooks: IHooks(minedHook)});
        manager.initialize(key, SQRT_PRICE_1_1);

        // Minted generously on BOTH sides. The payout token has six decimals, so the same nominal
        // price needs a very different integer amount than the eighteen-decimal side — under-minting
        // it makes the liquidity add underflow a balance, which surfaces as a bare panic rather than
        // a named revert. That is exactly how this fixture failed first.
        stock.mint(address(this), 1e30);
        dollar.mint(address(this), 1e30);
        stock.approve(address(liquidityRouter), type(uint256).max);
        dollar.approve(address(liquidityRouter), type(uint256).max);
        liquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: 1e18, salt: bytes32(0)
            }),
            ""
        );

        stock.mint(payer, 1_000e18);
        vm.prank(payer);
        stock.approve(address(executor), type(uint256).max);
    }

    /// @dev A LOCAL-ONLY hook address, and deliberately not a mined CREATE2 salt.
    ///
    ///      What v4 actually validates is the ADDRESS: its low 14 bits must equal the hook's
    ///      declared permissions. A real deployment reaches such an address by mining a CREATE2
    ///      salt; a test reaches it by etching, because `deployCodeTo` places code at an address of
    ///      our choosing. Mining here would burn time to arrive at the same validation.
    ///
    ///      THIS ADDRESS IS UNSUITABLE FOR ANY REAL DEPLOYMENT. It is derived from a local string,
    ///      not from creation code, so no salt produces it. A target-chain hook must be mined
    ///      against that chain's PoolManager, executor and currencies, and would land elsewhere.
    function _localHookAddress() internal pure returns (address) {
        uint160 high = uint160(uint256(keccak256("unica.experimental.stock.hook")));
        return address((high & ~uint160(Hooks.ALL_HOOK_MASK)) | DECLARED_FLAGS);
    }

    function _createOrder(uint128 amountIn, uint128 minOut, uint64 deadline, address boundPayer, bytes32 salt)
        internal
        returns (bytes32)
    {
        vm.prank(merchant);
        return executor.createOrder(merchant, key, amountIn, minOut, deadline, boundPayer, salt);
    }
}
