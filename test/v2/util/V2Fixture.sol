// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {AddressConstants} from "hookmate/constants/AddressConstants.sol";
import {V4PoolManagerDeployer} from "hookmate/artifacts/V4PoolManager.sol";
import {QuoteSettlementHook} from "../../../src/v2/QuoteSettlementHook.sol";
import {HookRevertAsserts} from "./HookRevertAsserts.sol";

/// @notice Stands where the V2 executor will stand: it holds the unlock, it calls `swap`, and it
///         answers `activeQuote()`. The hook now requires the swapper to BE its executor, so a
///         harness that swaps in its own name cannot exercise the hook at all — which is the point
///         of the guard and the reason this stub exists rather than a `set()` on the test contract.
/// @dev It judges nothing. Every field of the active quote is set directly, because what these
///      suites test is the HOOK's judgement, not an executor's judgement of a signature. The real
///      executor arrives in its own file with its own rows.
contract SwapperStub is IUnlockCallback {
    IPoolManager public manager;

    bytes32 internal digest;
    uint256 internal requiredOut;
    bytes32 internal poolId;
    bool internal zeroForOne;

    bool public lastReverted;
    bytes public lastRevertData;
    uint256 public lastDelivered;
    uint256 public lastPaidIn;

    /// @dev Set after deployment rather than in a constructor: these stubs are placed at fixed
    ///      addresses with `deployCodeTo`, which takes constructor arguments but leaves nothing to
    ///      read them from until the manager exists.
    function bind(IPoolManager manager_) external {
        manager = manager_;
    }

    function set(bytes32 d, uint256 r, bytes32 p, bool z) external {
        (digest, requiredOut, poolId, zeroForOne) = (d, r, p, z);
    }

    function activeQuote() external view returns (bytes32, uint256, bytes32, bool) {
        return (digest, requiredOut, poolId, zeroForOne);
    }

    function addLiquidity(PoolKey calldata key, int256 liquidityDelta, int24 lower, int24 upper) external {
        manager.unlock(abi.encode(uint8(1), key, liquidityDelta, lower, upper));
    }

    /// @notice One exact-output swap, with the outcome recorded rather than bubbled.
    /// @dev Records the raw revert data so the caller can decode it with `HookRevertDecoder`.
    ///      Bubbling would force every row to use `vm.expectRevert`, which cannot see past the
    ///      ERC-7751 wrapper and would collapse six distinct refusals into one.
    function swapExactOut(PoolKey calldata key, bool zf1, uint256 amountOut) external {
        _swap(key, zf1, int256(amountOut));
    }

    /// @dev Negative `amountSpecified` is exact input. Needed so a row can attempt the shape the
    ///      hook refuses; without it that guard could only be read, never exercised.
    function swapExactIn(PoolKey calldata key, bool zf1, uint256 amountIn) external {
        _swap(key, zf1, -int256(amountIn));
    }

    function _swap(PoolKey calldata key, bool zf1, int256 amountSpecified) internal {
        lastReverted = false;
        lastRevertData = "";
        lastDelivered = 0;
        lastPaidIn = 0;
        manager.unlock(abi.encode(uint8(2), key, amountSpecified, zf1));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "only the manager");
        uint8 kind = abi.decode(data[:32], (uint8));

        if (kind == 1) {
            (, PoolKey memory key, int256 liq, int24 lower, int24 upper) =
                abi.decode(data, (uint8, PoolKey, int256, int24, int24));
            (BalanceDelta d,) = manager.modifyLiquidity(
                key,
                ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: liq, salt: bytes32(0)}),
                ""
            );
            _pay(key.currency0, d.amount0());
            _pay(key.currency1, d.amount1());
            return "";
        }

        (, PoolKey memory key2, int256 amountSpecified, bool zf1) = abi.decode(data, (uint8, PoolKey, int256, bool));
        try manager.swap(
            key2,
            SwapParams({
                zeroForOne: zf1,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zf1 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        ) returns (
            BalanceDelta d
        ) {
            lastDelivered = uint256(uint128(zf1 ? d.amount1() : d.amount0()));
            lastPaidIn = uint256(uint128(-(zf1 ? d.amount0() : d.amount1())));
            _pay(key2.currency0, d.amount0());
            _pay(key2.currency1, d.amount1());
        } catch (bytes memory err) {
            lastReverted = true;
            lastRevertData = err;
        }
        return "";
    }

    function _pay(Currency c, int128 amount) internal {
        if (amount < 0) {
            manager.sync(c);
            MockERC20(Currency.unwrap(c)).transfer(address(manager), uint256(uint128(-amount)));
            manager.settle();
        } else if (amount > 0) {
            manager.take(c, address(this), uint256(uint128(amount)));
        }
    }
}

/// @title The shared V2 hook fixture: the official PoolManager, the hook, and three real pools
/// @notice Every pool here is initialised through the hook's own `beforeInitialize`, so the fixture
///         itself is evidence that the shapes it builds are shapes the hook accepts.
abstract contract V2Fixture is HookRevertAsserts {
    using PoolIdLibrary for PoolKey;

    /// @dev beforeInitialize | beforeSwap | afterSwap — the bits this hook's address must carry.
    uint160 internal constant DECLARED_MASK =
        uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
    /// @dev Namespaced so an etched address never lands on a precompile or a reserved prefix.
    address internal constant HOOK_ADDR = address(uint160(DECLARED_MASK) ^ (0x2222 << 144));
    address internal constant EXECUTOR_ADDR = address(uint160(0x2222 << 144) | 0xE2E2);

    IPoolManager internal manager;
    QuoteSettlementHook internal hook;
    SwapperStub internal executor;
    /// @dev A second, identical swapper that the hook was NOT bound to. Nothing about it is
    ///      malformed; the only thing wrong with it is that it is not the executor.
    SwapperStub internal outsider;

    MockERC20 internal tokenIn;
    MockERC20 internal tokenOut;
    MockERC20 internal tokenThird;

    /// @dev The invoice pool.
    PoolKey internal key;
    /// @dev The same two currencies in the same order at a different fee: a real, initialised,
    ///      liquid pool whose only difference from `key` is one field of the commitment.
    PoolKey internal siblingKey;
    /// @dev A different currency pair entirely, so `tokenIn` sits on the other side of the key.
    PoolKey internal foreignKey;

    function _setUpFixture() internal {
        vm.chainId(11155111);
        address canonical = AddressConstants.getPoolManagerAddress(block.chainid);
        bytes memory initcode = abi.encodePacked(V4PoolManagerDeployer.initcode(), abi.encode(address(this)));
        vm.etch(canonical, initcode);
        (bool ok, bytes memory runtime) = canonical.call("");
        require(ok, "official PoolManager init code reverted");
        vm.etch(canonical, runtime);
        manager = IPoolManager(canonical);

        deployCodeTo("V2Fixture.sol:SwapperStub", "", EXECUTOR_ADDR);
        executor = SwapperStub(EXECUTOR_ADDR);
        executor.bind(manager);
        outsider = new SwapperStub();
        outsider.bind(manager);

        deployCodeTo("QuoteSettlementHook.sol:QuoteSettlementHook", abi.encode(manager, EXECUTOR_ADDR), HOOK_ADDR);
        hook = QuoteSettlementHook(HOOK_ADDR);

        MockERC20 a = new MockERC20("A", "A", 18);
        MockERC20 b = new MockERC20("B", "B", 18);
        (tokenIn, tokenOut) = address(a) < address(b) ? (a, b) : (b, a);
        tokenThird = new MockERC20("C", "C", 18);
        while (address(tokenThird) < address(tokenOut)) {
            tokenThird = new MockERC20("C", "C", 18);
        }

        key = _key(address(tokenIn), address(tokenOut), 3000, 60);
        siblingKey = _key(address(tokenIn), address(tokenOut), 500, 10);
        foreignKey = _key(address(tokenOut), address(tokenThird), 3000, 60);

        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));
        manager.initialize(siblingKey, TickMath.getSqrtPriceAtTick(0));
        manager.initialize(foreignKey, TickMath.getSqrtPriceAtTick(0));

        // Both swappers are funded identically: an outsider that fails for want of tokens would be
        // a different finding than an outsider the hook refused, and the rows must not confuse them.
        for (uint256 i = 0; i < 2; i++) {
            address who = i == 0 ? address(executor) : address(outsider);
            tokenIn.mint(who, 1_000_000 ether);
            tokenOut.mint(who, 1_000_000 ether);
            tokenThird.mint(who, 1_000_000 ether);
        }

        executor.addLiquidity(key, 1e15, -60, 60);
        executor.addLiquidity(siblingKey, 1e15, -10, 10);
        executor.addLiquidity(foreignKey, 1e15, -60, 60);
    }

    function _key(address x, address y, uint24 fee, int24 tickSpacing) internal pure returns (PoolKey memory) {
        (address c0, address c1) = x < y ? (x, y) : (y, x);
        return PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(HOOK_ADDR)
        });
    }

    function _id(PoolKey memory k) internal pure returns (bytes32) {
        return PoolId.unwrap(k.toId());
    }
}
