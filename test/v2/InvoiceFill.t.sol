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
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {AddressConstants} from "hookmate/constants/AddressConstants.sol";
import {V4PoolManagerDeployer} from "hookmate/artifacts/V4PoolManager.sol";
import {QuoteSettlementHook} from "../../src/v2/QuoteSettlementHook.sol";
import {IQuoteSettlement} from "../../src/v2/interfaces/IQuoteSettlement.sol";

/// @notice Stands in for the V2 executor's transient "what is live right now" answer. The real
///         executor sets this from a merchant signature it has verified and clears it before it
///         returns; here it is set directly, because what is under test is the HOOK's judgement of
///         the fill, not the executor's judgement of a signature.
contract ActiveQuoteStub {
    bytes32 internal digest;
    uint256 internal requiredOut;
    bytes32 internal poolId;
    bool internal zeroForOne;

    function set(bytes32 d, uint256 r, bytes32 p, bool z) external {
        (digest, requiredOut, poolId, zeroForOne) = (d, r, p, z);
    }

    function activeQuote() external view returns (bytes32, uint256, bytes32, bool) {
        return (digest, requiredOut, poolId, zeroForOne);
    }
}

/// @title GATE 1 — the red control the whole V2 thesis rests on
/// @notice Gate 0 measured that a v4 pool short-fills an exact-output request and that nothing in
///         the official periphery objects: 1e18 asked, 2,995,354,955,910 served, no revert. The
///         claim V2 makes is that its hook refuses exactly that.
///
///         This is that control, and against the current scaffolding it MUST FAIL. A guard that
///         has never been seen to fail is not a guard, and a red control written after the code
///         it is meant to constrain proves nothing about the code.
///
///         Expected state today: RED, with the swap succeeding where `InvoiceNotFilled` was
///         required. Gate 2 makes it green by implementing the refusal, and no other way.
contract InvoiceFillRedControlTest is Test, IUnlockCallback {
    using PoolIdLibrary for PoolKey;

    /// @dev beforeInitialize | beforeSwap | afterSwap — the bits this hook's address must carry.
    uint160 internal constant DECLARED_MASK =
        uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
    /// @dev Namespaced so an etched address never lands on a precompile or a reserved prefix.
    address internal constant HOOK_ADDR = address(uint160(DECLARED_MASK) ^ (0x2222 << 144));
    address internal constant EXECUTOR_ADDR = address(0xE2E2);
    ActiveQuoteStub internal executor;

    IPoolManager internal manager;
    QuoteSettlementHook internal hook;
    MockERC20 internal tokenIn;
    MockERC20 internal tokenOut;
    PoolKey internal key;

    bool internal lastSwapReverted;
    uint256 internal lastDelivered;
    /// @dev The selector the swap reverted with. Asserting only THAT a call reverted cannot tell
    ///      one guard from another: with no invoice live the pool id is also zero, so a missing
    ///      no-invoice check is masked by the pool check refusing for its own reason. A sabotage
    ///      run proved exactly that — the guards were deleted from both callbacks and every row
    ///      stayed green.
    bytes4 internal lastRevertSelector;

    function setUp() public {
        vm.chainId(11155111);
        address canonical = AddressConstants.getPoolManagerAddress(block.chainid);
        bytes memory initcode = abi.encodePacked(V4PoolManagerDeployer.initcode(), abi.encode(address(this)));
        vm.etch(canonical, initcode);
        (bool ok, bytes memory runtime) = canonical.call("");
        require(ok, "official PoolManager init code reverted");
        vm.etch(canonical, runtime);
        manager = IPoolManager(canonical);

        deployCodeTo("InvoiceFill.t.sol:ActiveQuoteStub", "", EXECUTOR_ADDR);
        executor = ActiveQuoteStub(EXECUTOR_ADDR);
        deployCodeTo("QuoteSettlementHook.sol:QuoteSettlementHook", abi.encode(manager, EXECUTOR_ADDR), HOOK_ADDR);
        hook = QuoteSettlementHook(HOOK_ADDR);

        MockERC20 a = new MockERC20("A", "A", 18);
        MockERC20 b = new MockERC20("B", "B", 18);
        (tokenIn, tokenOut) = address(a) < address(b) ? (a, b) : (b, a);

        key = PoolKey({
            currency0: Currency.wrap(address(tokenIn)),
            currency1: Currency.wrap(address(tokenOut)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(HOOK_ADDR)
        });
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));

        tokenIn.mint(address(this), 1_000_000 ether);
        tokenOut.mint(address(this), 1_000_000 ether);
        manager.unlock(abi.encode(uint8(1), int256(1e15)));
    }

    /// @dev The control that must PASS: an invoice the pool can serve goes through untouched. If
    ///      this row is red the harness is broken, and nothing the red row says can be believed.
    function test_Gate1_Control_AnInvoiceWithinLiquidityIsAdmitted() public {
        _swapExactOut(1e11);
        assertFalse(lastSwapReverted, "the control invoice was refused; the harness is wrong");
        assertEq(lastDelivered, 1e11, "the control invoice was not filled exactly");
    }

    /// @dev THE RED CONTROL. Expected to FAIL against the scaffolding, which judges nothing.
    function test_Gate1_RED_AShortFilledInvoiceMustBeRefused() public {
        _swapExactOut(1e18);

        emit log_named_uint("invoice requested", 1e18);
        emit log_named_uint("pool delivered   ", lastDelivered);
        emit log_named_string("swap reverted    ", lastSwapReverted ? "YES" : "NO");

        assertTrue(
            lastSwapReverted,
            "RED CONTROL: the pool short-filled the invoice and the hook admitted it. "
            "Under exact output the periphery checks only the input ceiling, so this refusal "
            "exists in the hook or nowhere."
        );
        assertEq(lastDelivered, 0, "a refused settlement must deliver nothing");
        assertEq(lastRevertSelector, IQuoteSettlement.InvoiceNotFilled.selector, "refused, but not for the short fill");
    }

    /// @dev THE OTHER HALF OF THE THESIS. "Every swap through this pool discharges an invoice" is
    ///      only true if a swap with no invoice is refused. Added after a sabotage run: deleting
    ///      the no-live-invoice guard left every other row green, which meant the guard existed
    ///      and nothing constrained it.
    function test_Gate1_ASwapWithNoLiveInvoiceIsRefused() public {
        executor.set(bytes32(0), 0, bytes32(0), false); // nothing live
        lastSwapReverted = false;
        manager.unlock(abi.encode(uint8(2), int256(1e11)));
        assertTrue(lastSwapReverted, "the pool admitted a swap that discharged no invoice");
        assertEq(lastDelivered, 0, "a refused swap must deliver nothing");
        assertEq(
            lastRevertSelector,
            IQuoteSettlement.NotAnInvoiceDischarge.selector,
            "refused, but for the wrong reason: the no-invoice guard is not what spoke"
        );
    }

    /// @dev And an invoice already settled cannot be settled twice.
    function test_Gate1_AConsumedInvoiceCannotBeDischargedAgain() public {
        _swapExactOut(1e11);
        assertFalse(lastSwapReverted, "the first discharge should succeed");

        // the same digest, live again: the hook has already marked it consumed
        lastSwapReverted = false;
        executor.set(keccak256(abi.encode("invoice", uint256(1e11))), 1e11, PoolId.unwrap(key.toId()), true);
        manager.unlock(abi.encode(uint8(2), int256(1e11)));
        assertTrue(lastSwapReverted, "a consumed invoice was discharged a second time");
        assertEq(
            lastRevertSelector,
            IQuoteSettlement.QuoteAlreadySettled.selector,
            "refused, but not by the consumption guard"
        );
    }

    // ---- plumbing ------------------------------------------------------------------------

    /// @dev Sets the invoice live, exactly as the executor would, then swaps for it.
    function _swapExactOut(uint256 amountOut) internal {
        lastSwapReverted = false;
        lastDelivered = 0;
        executor.set(keccak256(abi.encode("invoice", amountOut)), amountOut, PoolId.unwrap(key.toId()), true);
        manager.unlock(abi.encode(uint8(2), int256(amountOut)));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "only the manager");
        uint8 kind = abi.decode(data[:32], (uint8));

        if (kind == 1) {
            (, int256 liq) = abi.decode(data, (uint8, int256));
            (BalanceDelta d,) = manager.modifyLiquidity(
                key, ModifyLiquidityParams({tickLower: -60, tickUpper: 60, liquidityDelta: liq, salt: bytes32(0)}), ""
            );
            _pay(key.currency0, d.amount0());
            _pay(key.currency1, d.amount1());
            return "";
        }

        (, int256 amountSpecified) = abi.decode(data, (uint8, int256));
        try manager.swap(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: amountSpecified, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        ) returns (
            BalanceDelta d
        ) {
            lastDelivered = uint256(uint128(d.amount1()));
            _pay(key.currency0, d.amount0());
            _pay(key.currency1, d.amount1());
        } catch (bytes memory err) {
            lastSwapReverted = true;
            lastRevertSelector = _unwrapHookRevert(err);
        }
        return "";
    }

    /// @dev v4 does not let a hook's error reach the caller unchanged: PoolManager wraps it in
    ///      ERC-7751's `WrappedError(address target, bytes4 selector, bytes reason, bytes details)`
    ///      (`CustomRevert.sol:11`, raised from the assembly at `:86-96`). Reading `bytes4(err)`
    ///      therefore returns `0x90bfb865` for EVERY hook refusal, which is how a suite ends up
    ///      asserting that something reverted while learning nothing about why. This unwraps one
    ///      layer and returns the hook's own selector.
    function _unwrapHookRevert(bytes memory err) internal pure returns (bytes4) {
        if (err.length < 4) return bytes4(0);
        bytes4 outer = bytes4(err);
        if (outer != bytes4(keccak256("WrappedError(address,bytes4,bytes,bytes)"))) return outer;

        bytes memory payload = new bytes(err.length - 4);
        for (uint256 i = 0; i < payload.length; i++) {
            payload[i] = err[i + 4];
        }
        (,, bytes memory reason,) = abi.decode(payload, (address, bytes4, bytes, bytes));
        return reason.length >= 4 ? bytes4(reason) : bytes4(0);
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
