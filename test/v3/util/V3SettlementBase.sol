// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {V4PoolManagerDeployer} from "hookmate/artifacts/V4PoolManager.sol";
import {UnicaDeploymentsV3} from "../../../src/v3/UnicaDeploymentsV3.sol";
import {UnicaHookV3} from "../../../src/v3/UnicaHookV3.sol";
import {UnicaExecutorV3} from "../../../src/v3/UnicaExecutorV3.sol";
import {UniversalRouterV2Sepolia} from "../../utils/artifacts/UniversalRouterV2Sepolia.sol";

/// @title V3SettlementBase, the local topology the V3 settlement rows stand on
/// @notice Everything on the settlement path is OFFICIAL BYTECODE, not a local re-compile. The
///         PoolManager is the creation code hookmate ships of Uniswap's own deployment, run at the
///         canonical address so `UnicaHookV3`'s zero-argument constructor resolves it exactly as it
///         would on chain. The Universal Router is the deployed Sepolia RUNTIME, read from the chain
///         and placed at its own address, with its immutables already pointing at that PoolManager —
///         which is what makes `UnicaExecutorV3`'s code-hash check meaningful here rather than
///         circular: the hash it compares against was recorded from the live chain, and the bytes
///         etched here were read from the live chain, and neither knows about the other.
///
///         WHICH CHAIN THESE ROWS RUN AS, and why it is not the lead chain. Ethereum Sepolia, 11155111.
///         It is the only one of the five for which this repository holds BOTH an official router
///         runtime it can place locally AND a verified payout token, so it is the only chain where a
///         full settlement can be driven end to end without a network. The lead chain's six-field
///         router is measured where it actually lives instead — `test/v3/DeploymentsV3Fork.t.sol`
///         against a fork of chain 46630, and `test/compat/UpgradedRouterCompat.t.sol` before it.
///         Nothing here is a live-testnet result and no row claims otherwise.
///
/// @dev The mined hook address is DERIVED here, not pasted. A pasted address would silently stop
///      matching the creation code the moment a comment changed, and the test would go on passing
///      against an address nobody deploys to. Deriving it means these rows are always about the code
///      in the tree, and the flag assertion below is then a real check on that code.
abstract contract V3SettlementBase is Test {
    using CurrencyLibrary for Currency;

    /// @dev The chain these local rows run as. See the note above for why it is not 46630.
    uint256 internal constant LOCAL_CHAIN = 11155111;
    /// @dev The size of Uniswap's deployed PoolManager runtime on every v4 testnet studied here,
    ///      measured with `cast code` on 2026-09-09. Asserting it means an etch that silently placed
    ///      something else fails loudly.
    uint256 internal constant OFFICIAL_POOL_MANAGER_RUNTIME_BYTES = 24009;

    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    int24 internal constant TICK_LOWER = -120;
    int24 internal constant TICK_UPPER = 120;
    int256 internal constant LIQUIDITY = 1e18;

    /// @dev The declared permission set: beforeInitialize | beforeSwap | afterSwap.
    uint160 internal constant DECLARED_FLAGS =
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
    uint8 internal constant RESERVED_PREFIX = 0x91;
    uint256 internal constant MAX_SALT = 200_000;

    /// @dev Receipt schema v1 — the SAME twelve-field signature V1 emits. Written out rather than
    ///      imported so that a change to the event in `UnicaHookV3` is caught by a mismatch here
    ///      instead of being silently carried along by a shared constant.
    bytes32 internal constant RECEIPT_TOPIC = keccak256(
        "SettlementReceipt(bytes32,bytes32,address,uint16,address,address,address,address,uint128,uint128,uint128,bytes32)"
    );

    IPoolManager internal manager;
    address internal universalRouter;
    UnicaHookV3 internal hook;
    UnicaExecutorV3 internal executor;
    PoolModifyLiquidityTest internal liquidityRouter;
    MockERC20 internal payout;
    Currency internal payoutCurrency;
    address internal minedHook;
    bytes32 internal minedSalt;

    address internal merchant = makeAddr("merchant");
    address internal payer = makeAddr("payer");

    /// @notice Stands up the official PoolManager, the official router, the payout token mock, the
    ///         hook at its mined address and the executor at the address the hook derives for it.
    /// @dev The ORDER is load-bearing and is itself a check: the executor's constructor asks whether
    ///      the router at the recorded address is still the recorded build, so the router has to be
    ///      etched before the executor exists. If that ordering were wrong, `deploySettlementV3`
    ///      would revert with `RouterCodeChanged` rather than pass quietly.
    function setUpV3() internal {
        vm.chainId(LOCAL_CHAIN);
        vm.deal(address(this), 100 ether);
        vm.deal(payer, 100 ether);

        _etchOfficialPoolManager();
        etchOfficialUniversalRouter();
        _etchPayoutToken();

        liquidityRouter = new PoolModifyLiquidityTest(manager);
        payout.approve(address(liquidityRouter), type(uint256).max);
        vm.label(address(liquidityRouter), "PoolModifyLiquidityTest");

        deploySettlementV3();
    }

    function _etchOfficialPoolManager() private {
        address canonical = UnicaDeploymentsV3.poolManager(LOCAL_CHAIN);
        bytes memory initcode = abi.encodePacked(V4PoolManagerDeployer.initcode(), abi.encode(address(this)));
        // The same technique forge-std uses for deployCodeTo: run the init code at the target address.
        vm.etch(canonical, initcode);
        (bool ok, bytes memory runtime) = canonical.call("");
        require(ok, "official PoolManager init code reverted");
        vm.etch(canonical, runtime);
        assertEq(runtime.length, OFFICIAL_POOL_MANAGER_RUNTIME_BYTES, "etched PoolManager is not the official runtime");
        manager = IPoolManager(canonical);
        vm.label(canonical, "PoolManager(official bytecode)");
    }

    /// @notice Places the deployed Universal Router runtime at its Sepolia address and proves it is
    ///         the recorded bytecode. Called by `setUpV3` and again by any row that replaced it.
    function etchOfficialUniversalRouter() internal {
        universalRouter = UnicaDeploymentsV3.universalRouter(LOCAL_CHAIN);
        assertEq(universalRouter, UniversalRouterV2Sepolia.ADDRESS, "the table and the artifact name different routers");
        vm.etch(universalRouter, UniversalRouterV2Sepolia.runtime());
        assertEq(universalRouter.codehash, UniversalRouterV2Sepolia.RUNTIME_KECCAK, "not the deployed router runtime");
        vm.label(universalRouter, "UniversalRouter(official bytecode)");
    }

    /// @dev The mock stands at the address the table names, because every check on the payout currency
    ///      is a check on the ADDRESS. Eighteen decimals rather than USDC's six is deliberate and
    ///      harmless: v4 never reads decimals, and it keeps a 1:1 pool price readable.
    function _etchPayoutToken() private {
        address addr = UnicaDeploymentsV3.payoutCurrency(LOCAL_CHAIN);
        deployCodeTo("MockERC20.sol:MockERC20", abi.encode("USD Coin (local mock)", "USDC", uint8(18)), addr);
        payout = MockERC20(addr);
        payoutCurrency = Currency.wrap(addr);
        payout.mint(address(this), 1_000_000 ether);
        vm.label(addr, "payout(mock)");
    }

    /// @notice Deploys the hook at its MINED address and the executor at the address that hook derives.
    function deploySettlementV3() internal {
        (minedHook, minedSalt) = mineHookAddress();
        deployCodeTo("UnicaHookV3.sol:UnicaHookV3", "", minedHook);
        hook = UnicaHookV3(minedHook);
        deployCodeTo("UnicaExecutorV3.sol:UnicaExecutorV3", abi.encode(minedHook), hook.SETTLEMENT_EXECUTOR());
        executor = UnicaExecutorV3(hook.SETTLEMENT_EXECUTOR());
        vm.label(minedHook, "UnicaHookV3");
        vm.label(address(executor), "UnicaExecutorV3");
    }

    /// @notice The CREATE2 rule over the hook's real creation code: the first salt whose address
    ///         carries exactly the declared flags and avoids Uniswap's reserved prefix.
    /// @dev Deliberately the same arithmetic `script/v3/MineHookV3.s.sol` runs, re-implemented here
    ///      rather than imported, so that `test/v3/MineHookV3.t.sol` comparing the two is comparing
    ///      two things and not one thing with itself.
    function mineHookAddress() internal pure returns (address hookAddr, bytes32 salt) {
        bytes32 initCodeHash = keccak256(type(UnicaHookV3).creationCode);
        for (uint256 i = 0; i < MAX_SALT; i++) {
            address a = address(
                uint160(
                    uint256(
                        keccak256(
                            abi.encodePacked(bytes1(0xff), UnicaDeploymentsV3.CREATE2_FACTORY, bytes32(i), initCodeHash)
                        )
                    )
                )
            );
            if (uint160(a) & Hooks.ALL_HOOK_MASK != DECLARED_FLAGS) continue;
            if (uint8(uint160(a) >> 152) == RESERVED_PREFIX) continue;
            return (a, bytes32(i));
        }
        revert("no salt found below MAX_SALT");
    }

    // ---- the pool --------------------------------------------------------------------------------

    /// @notice The native / payout key for this hook: the only pool shape the hook admits.
    function settlementKey() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: payoutCurrency,
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(minedHook)
        });
    }

    /// @notice Initialises that pool at 1:1 and puts real liquidity in it.
    function initialisePoolWithLiquidity() internal returns (PoolKey memory key) {
        key = settlementKey();
        manager.initialize(key, SQRT_PRICE_1_1);
        liquidityRouter.modifyLiquidity{value: 10 ether}(
            key,
            ModifyLiquidityParams({tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: LIQUIDITY, salt: 0}),
            ""
        );
    }

    /// @dev The liquidity router refunds unspent native value, so this contract must be able to take
    ///      it back. Nothing else is ever sent here.
    receive() external payable {}
}
