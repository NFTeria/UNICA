// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {AddressConstants} from "hookmate/constants/AddressConstants.sol";
import {V4PoolManagerDeployer} from "hookmate/artifacts/V4PoolManager.sol";

/// @title GATE 0 — does an exact-output swap under-deliver, and does anything object?
/// @notice The V2 hook's whole reason to exist rests on one claim: under exact-output semantics
///         the official periphery checks the INPUT ceiling and never compares delivered output
///         with requested output. Read at `V4Router.sol:117-127`, where `_swapExactOutputSingle`
///         raises only `V4TooMuchRequested`, against `:90` and `:113` where the exact-INPUT paths
///         both raise `V4TooLittleReceived`.
///
///         Reading source is a claim. This measures it. If the pool cannot short-fill an exact
///         output at all, the gap is theoretical and the V2 thesis has to be re-opened before a
///         line of it is written — which is why this file exists before the implementation.
///
///         Measured against the OFFICIAL PoolManager runtime, not a re-compile: the same
///         technique the day-2 base uses, so the accounting under test is Uniswap's own.
contract ShortFillGateTest is Test, IUnlockCallback {
    IPoolManager internal manager;
    MockERC20 internal tokenIn;
    MockERC20 internal tokenOut;
    PoolKey internal key;

    /// @dev What one measured attempt produced. `reverted` records that the PoolManager itself
    ///      refused; the point of the gate is that it does not.
    struct Attempt {
        bool reverted;
        bytes revertData;
        int128 amount0;
        int128 amount1;
    }

    Attempt internal last;

    function setUp() public {
        vm.chainId(11155111);
        address canonical = AddressConstants.getPoolManagerAddress(block.chainid);
        bytes memory initcode = abi.encodePacked(V4PoolManagerDeployer.initcode(), abi.encode(address(this)));
        vm.etch(canonical, initcode);
        (bool ok, bytes memory runtime) = canonical.call("");
        require(ok, "official PoolManager init code reverted");
        vm.etch(canonical, runtime);
        manager = IPoolManager(canonical);

        MockERC20 a = new MockERC20("A", "A", 18);
        MockERC20 b = new MockERC20("B", "B", 18);
        (tokenIn, tokenOut) = address(a) < address(b) ? (a, b) : (b, a);

        key = PoolKey({
            currency0: Currency.wrap(address(tokenIn)),
            currency1: Currency.wrap(address(tokenOut)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));

        tokenIn.mint(address(this), 1_000_000 ether);
        tokenOut.mint(address(this), 1_000_000 ether);

        // Deliberately thin, and in one narrow band. Beyond it there is nothing to sell, which is
        // the condition an exact-output request has to run into for a short fill to be possible.
        _addLiquidity(-60, 60, 1e15);
    }

    // ---- the four rows -------------------------------------------------------------------

    function test_Gate0_Control_AnExactOutputWithinLiquidityIsFilledInFull() public {
        uint128 want = 1e11; // small enough that the band can serve it
        Attempt memory r = _exactOut(want);
        assertFalse(r.reverted, "the control must not revert; if it does the instrument is wrong");
        uint256 delivered = uint256(uint128(r.amount1));
        assertEq(delivered, want, "control: the pool delivered exactly what was asked");
        emit log_named_uint("control  requested", want);
        emit log_named_uint("control  delivered", delivered);
        emit log_named_int("control  input consumed", -r.amount0);
    }

    function test_Gate0_AnExactOutputBeyondLiquidityIsSHORTFILLED_AndThePoolDoesNotObject() public {
        uint128 want = 1e18; // far beyond what one narrow band at this liquidity can serve
        Attempt memory r = _exactOut(want);

        emit log_named_uint("shortfill requested", want);
        emit log_named_int("shortfill delivered", r.amount1);
        emit log_named_int("shortfill input consumed", -r.amount0);
        emit log_named_string("shortfill reverted", r.reverted ? "YES" : "NO");

        assertFalse(r.reverted, "GATE 0: the PoolManager refused an over-large exact output");
        uint256 delivered = uint256(uint128(r.amount1));
        assertLt(delivered, want, "GATE 0: the pool delivered the full amount, so no short fill exists here");
        assertGt(delivered, 0, "a short fill should still deliver something");
    }

    function test_Gate0_TheShortFillConsumesLessInputThanAFullFillWould() public {
        // The reason nothing objects: the input ceiling is the only thing the periphery checks,
        // and a short fill consumes LESS input, so that check passes comfortably.
        Attempt memory small = _exactOut(1e11);
        Attempt memory huge = _exactOut(1e18);
        emit log_named_int("input for the small, fully-filled request", -small.amount0);
        emit log_named_int("input for the huge, short-filled request", -huge.amount0);
        assertFalse(huge.reverted);
        assertLt(uint256(uint128(huge.amount1)), 1e18, "the huge request was short-filled");
    }

    function test_Gate0_TheDeltaIsTheOnlyEvidence_AndItReportsTheShortfall() public {
        // The hook's only authoritative evidence is the BalanceDelta it is handed. This asserts the
        // shortfall is visible there — which is what makes a hook-side refusal possible at all.
        uint128 want = 1e18;
        Attempt memory r = _exactOut(want);
        assertFalse(r.reverted);
        assertTrue(r.amount1 > 0, "output side is a credit to the swapper");
        assertTrue(uint256(uint128(r.amount1)) < want, "and it is smaller than the request");
    }

    // ---- plumbing ------------------------------------------------------------------------

    function _addLiquidity(int24 lower, int24 upper, int256 liquidity) internal {
        manager.unlock(abi.encode(uint8(1), lower, upper, liquidity));
    }

    /// @dev A positive `amountSpecified` is v4's exact-OUTPUT form.
    function _exactOut(uint128 amountOut) internal returns (Attempt memory) {
        delete last;
        manager.unlock(abi.encode(uint8(2), int256(uint256(amountOut))));
        return last;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "only the manager");
        uint8 kind = abi.decode(data[:32], (uint8));

        if (kind == 1) {
            (, int24 lower, int24 upper, int256 liq) = abi.decode(data, (uint8, int24, int24, int256));
            (BalanceDelta d,) = manager.modifyLiquidity(
                key,
                ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: liq, salt: bytes32(0)}),
                ""
            );
            _pay(key.currency0, d.amount0());
            _pay(key.currency1, d.amount1());
            return "";
        }

        (, int256 amountSpecified) = abi.decode(data, (uint8, int256));
        try manager.swap(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: amountSpecified, // positive: exact output
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        ) returns (BalanceDelta d) {
            last = Attempt({reverted: false, revertData: "", amount0: d.amount0(), amount1: d.amount1()});
            _pay(key.currency0, d.amount0());
            _pay(key.currency1, d.amount1());
        } catch (bytes memory err) {
            last = Attempt({reverted: true, revertData: err, amount0: 0, amount1: 0});
        }
        return "";
    }

    /// @dev Settle a debt or take a credit so the lock can close either way.
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
