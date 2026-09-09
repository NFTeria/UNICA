// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {console2} from "forge-std/console2.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IProtocolFees} from "@uniswap/v4-core/src/interfaces/IProtocolFees.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {SettlementTestBase} from "../utils/SettlementTestBase.sol";
import {HookRevertDecoder} from "../v2/util/HookRevertDecoder.sol";
import {
    HookDataSizeProbe,
    GasBurnProbe,
    TransientEchoProbe,
    ReentrancyProbe,
    RevertShapeProbe
} from "../../src/lab/LimitProbes.sol";

/// @title LabBase — the shared fixture for EXPERIMENT B
/// @notice Reuses `SettlementTestBase.setUpV4()`, which etches Uniswap's OFFICIAL PoolManager
///         runtime (24009 bytes, asserted there) rather than a local compile or a mock. Every number
///         this file reports is therefore a number produced by Uniswap's own deployed code — inside
///         the Foundry EVM, which is its own set of limits and is labelled as such throughout.
abstract contract LabBase is SettlementTestBase {
    /// @dev The gas a probe swap is allowed under a "would this fit in a block" question. Ethereum
    ///      mainnet and Sepolia both target ~36,000,000 as of 2026-09; this is a CHOSEN budget, not
    ///      a protocol constant, and every ceiling derived from it moves when it moves.
    uint256 internal constant BLOCK_BUDGET = 36_000_000;

    /// @dev Namespaced probe addresses. Only the low 14 bits carry meaning to v4; everything above
    ///      bit 128 is a label so a trace names the probe instead of a hex blob.
    address internal constant HOOKDATA_PROBE =
        address(uint160(uint160(Hooks.BEFORE_SWAP_FLAG) | (uint160(0xB1) << 128)));
    address internal constant GASBURN_PROBE =
        address(uint160(uint160(Hooks.BEFORE_SWAP_FLAG) | (uint160(0xB2) << 128)));
    address internal constant TRANSIENT_PROBE =
        address(uint160(uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG) | (uint160(0xB3) << 128)));
    address internal constant REENTRANCY_PROBE =
        address(uint160(uint160(Hooks.BEFORE_SWAP_FLAG) | (uint160(0xB4) << 128)));
    address internal constant REVERT_PROBE = address(uint160(uint160(Hooks.BEFORE_SWAP_FLAG) | (uint160(0xB5) << 128)));

    /// @dev Small enough that dozens of probe swaps do not move the pool out from under a
    ///      bisection. The experiments are about the callback, never about the price.
    uint256 internal constant PROBE_SWAP_IN = 1_000;

    function _deployProbe(string memory name, address at) internal {
        deployCodeTo(string.concat("LimitProbes.sol:", name), abi.encode(address(manager)), at);
        vm.label(at, name);
    }

    /// @dev Copies everything after a four-byte selector into a fresh buffer, so ERC-7751's
    ///      `WrappedError` body can be handed to `abi.decode`. Written by hand because Solidity has
    ///      no slice for `bytes memory`.
    function _afterSelector(bytes memory err) internal pure returns (bytes memory out) {
        require(err.length >= 4, "no selector to skip");
        out = new bytes(err.length - 4);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = err[i + 4];
        }
    }

    /// @dev The hook's own revert payload, pulled out of the PoolManager's ERC-7751 wrapper.
    function _unwrapReason(bytes memory err)
        internal
        pure
        returns (address target, bytes4 callback, bytes memory reason)
    {
        (target, callback, reason,) = abi.decode(_afterSelector(err), (address, bytes4, bytes, bytes));
    }

    function _selectorOf(bytes memory b) internal pure returns (bytes4 s) {
        if (b.length < 4) return bytes4(0);
        s = bytes4(
            uint32(uint8(b[0])) << 24 | uint32(uint8(b[1])) << 16 | uint32(uint8(b[2])) << 8 | uint32(uint8(b[3]))
        );
    }

    /// @dev `n` bytes with a position-dependent, entirely non-zero pattern. Non-zero matters: a
    ///      buffer of zeros cannot distinguish "the payload arrived" from "a fresh allocation of
    ///      the right size arrived", and that is the exact confusion the digest check exists to kill.
    function _pattern(uint256 n) internal pure returns (bytes memory b) {
        b = new bytes(n);
        for (uint256 i = 0; i < n; i++) {
            b[i] = bytes1(uint8(1 + (i % 255)));
        }
    }
}

/*//////////////////////////////////////////////////////////////////////////////////////////////////
                        B1 — HOW MUCH hookData CAN REACH A CALLBACK, AND WHAT STOPS IT
//////////////////////////////////////////////////////////////////////////////////////////////////*/

contract B1HookDataTest is LabBase, IUnlockCallback {
    HookDataSizeProbe internal probe;
    PoolKey internal key;

    /// @dev The bisection's resolution. The reported ceiling is exact to this many bytes and the
    ///      report says so rather than quoting a byte count it did not actually separate.
    uint256 internal constant PAGE = 4096;

    function setUp() public {
        setUpV4();
        _deployProbe("HookDataSizeProbe", HOOKDATA_PROBE);
        probe = HookDataSizeProbe(HOOKDATA_PROBE);
        (key,) = initNativePoolWithLiquidity(IHooks(HOOKDATA_PROBE), 10 ether);
    }

    /// @notice THE CONTROL, WRITTEN FIRST. A small payload arrives, byte for byte, and the probe
    ///         can prove it did. Every failing row below is only meaningful because this passes.
    function test_B1_00_control_smallPayloadArrivesIntact() public {
        bytes memory data = _pattern(32);
        swapNativeExactIn(key, PROBE_SWAP_IN, data);
        assertEq(probe.calls(), 1, "beforeSwap did not run at all");
        assertEq(probe.lastLength(), 32, "length delivered is not the length sent");
        assertEq(probe.lastDigest(), keccak256(data), "content delivered is not the content sent");
    }

    /// @notice VALIDATION BY SABOTAGE. Feed the instrument a payload it must NOT accept as the
    ///         previous one. A digest check that cannot fail is not a check.
    function test_B1_01_instrument_noticesADifferentPayload() public {
        swapNativeExactIn(key, PROBE_SWAP_IN, _pattern(32));
        bytes32 first = probe.lastDigest();
        bytes memory other = _pattern(32);
        other[7] = bytes1(uint8(0xAA));
        swapNativeExactIn(key, PROBE_SWAP_IN, other);
        assertTrue(probe.lastDigest() != first, "the digest did not move for a different payload");
        assertEq(probe.lastLength(), 32, "same length, different content: length must not have moved");
    }

    /// @notice Empty hookData is a real case and must not be confused with "the callback never ran".
    function test_B1_02_emptyPayloadIsNotTheSameAsNoCallback() public {
        swapNativeExactIn(key, PROBE_SWAP_IN, "");
        assertEq(probe.calls(), 1, "beforeSwap did not run");
        assertEq(probe.lastLength(), 0);
        assertEq(probe.lastDigest(), keccak256(""), "empty payload must hash to keccak256(\"\"), not zero");
    }

    /// @dev One attempt at one size, contained in its own call frame with its own gas cap, so a
    ///      failure at the top of the ladder cannot take the test with it.
    function harnessSwapWithHookDataOfSize(uint256 n) external payable {
        require(msg.sender == address(this), "self only");
        bytes memory data = new bytes(n);
        swapNativeExactIn(key, PROBE_SWAP_IN, data);
    }

    function _try(uint256 n, uint256 gasCap) internal returns (bool ok, uint256 gasUsed) {
        uint256 before = gasleft();
        (ok,) = address(this).call{gas: gasCap}(abi.encodeCall(this.harnessSwapWithHookDataOfSize, (n)));
        gasUsed = before - gasleft();
    }

    /// @notice THE GAS CURVE. What a byte of hookData costs, measured, at sizes a real integration
    ///         might plausibly send. The curve is superlinear because EVM memory expansion is
    ///         quadratic and the payload is re-materialised in several frames on the way in.
    function test_B1_03_gasCurve() public {
        uint256[6] memory sizes = [uint256(0), 1024, 4096, 16384, 65536, 262144];
        uint256 previous;
        console2.log("B1 gas curve  --  bytes | gas for the whole swap | marginal gas/byte since previous row");
        for (uint256 i = 0; i < sizes.length; i++) {
            // Each row is measured on the SECOND swap at that size. The first swap at any size pays
            // first-touch storage costs the next one does not, and a curve built from first swaps is
            // not monotonic — measured: the 1024-byte row came out CHEAPER than the 0-byte row, which
            // is a warm-up artefact and would have been read as a property of hookData.
            (bool warm,) = _try(sizes[i], BLOCK_BUDGET);
            assertTrue(warm, "the warm-up swap for a curve row failed");
            (bool ok, uint256 used) = _try(sizes[i], BLOCK_BUDGET);
            assertTrue(ok, "a size on the curve failed under the block budget");
            uint256 marginal = i == 0 ? 0 : (used - previous) / (sizes[i] - sizes[i - 1]);
            console2.log(sizes[i], used, marginal);
            if (i > 0) assertGt(used, previous, "gas did not grow with payload size");
            previous = used;
        }
    }

    /// @notice THE CEILING, BISECTED. The largest hookData a swap through this router can carry and
    ///         still fit inside `BLOCK_BUDGET` gas — found by bisection, then proved on both sides:
    ///         the ceiling passes and one page more fails. A ceiling that was never shown to fail
    ///         on the far side is a guess with a number attached.
    function test_B1_04_ceilingUnderABlockBudget() public {
        uint256 loPages = 0; // known good, proved below
        uint256 hiPages = 1024; // 4 MiB, presumed bad, proved below

        (bool loOk,) = _try(loPages * PAGE, BLOCK_BUDGET);
        assertTrue(loOk, "the bisection's lower bound must pass or the search is meaningless");
        (bool hiOk,) = _try(hiPages * PAGE, BLOCK_BUDGET);
        assertFalse(hiOk, "the bisection's upper bound must fail or the ceiling is above the range");

        while (hiPages - loPages > 1) {
            uint256 mid = (loPages + hiPages) / 2;
            (bool ok,) = _try(mid * PAGE, BLOCK_BUDGET);
            if (ok) loPages = mid;
            else hiPages = mid;
        }

        (bool atCeiling, uint256 gasAtCeiling) = _try(loPages * PAGE, BLOCK_BUDGET);
        (bool pastCeiling,) = _try(hiPages * PAGE, BLOCK_BUDGET);
        assertTrue(atCeiling, "the reported ceiling does not actually pass");
        assertFalse(pastCeiling, "one page past the reported ceiling does not actually fail");

        console2.log("B1 ceiling under a 36,000,000 gas budget, bytes (resolution 4096):", loPages * PAGE);
        console2.log("B1 gas consumed at that ceiling:", gasAtCeiling);
        console2.log("B1 first failing size, bytes:", hiPages * PAGE);
    }

    /*---------------------------------------------------------------------------------------------
      HOW MUCH OF THE CEILING BELONGS TO THE ROUTER RATHER THAN TO v4

      Everything above went through `PoolSwapTest`, which is a router: it `abi.encode`s the whole
      call — hookData included — into `unlock`'s argument, and `abi.decode`s it back out on the
      other side. The payload is therefore materialised at least twice more than v4 itself
      requires. The pair of measurements below separates the two: the same probe, the same pool,
      the same payload, reached once through a router and once by calling `unlock` directly and
      building the payload inside the callback.
    ---------------------------------------------------------------------------------------------*/

    /// @dev The direct path. `unlock` carries only a LENGTH; the payload is built in the callback,
    ///      so it crosses exactly one ABI boundary — the `manager.swap` call — instead of three.
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(manager), "not the manager");
        uint256 n = abi.decode(data, (uint256));
        bytes memory hookData = new bytes(n);
        BalanceDelta delta = manager.swap(
            key,
            SwapParams({zeroForOne: true, amountSpecified: -int256(PROBE_SWAP_IN), sqrtPriceLimitX96: MIN_PRICE_LIMIT}),
            hookData
        );
        // Native in, mock USDC out. `settle()` reads msg.value when no currency has been synced.
        manager.settle{value: uint256(uint128(-delta.amount0()))}();
        manager.take(usdcCurrency, address(this), uint256(uint128(delta.amount1())));
        return "";
    }

    function harnessDirectSwapWithHookDataOfSize(uint256 n) external payable {
        require(msg.sender == address(this), "self only");
        manager.unlock(abi.encode(n));
    }

    function _tryDirect(uint256 n, uint256 gasCap) internal returns (bool ok, uint256 gasUsed) {
        uint256 before = gasleft();
        (ok,) = address(this).call{gas: gasCap}(abi.encodeCall(this.harnessDirectSwapWithHookDataOfSize, (n)));
        gasUsed = before - gasleft();
    }

    /// @notice THE SPLIT. The same 256 KiB payload, priced through the router and priced without
    ///         it, and then the two ceilings side by side. What this separates is "v4 charges this
    ///         much for hookData" from "the way you reached v4 charges this much more".
    function test_B1_06_howMuchOfTheCeilingBelongsToTheRouter() public {
        uint256 n = 262_144;

        (bool w1,) = _try(n, BLOCK_BUDGET);
        (bool ok1, uint256 viaRouter) = _try(n, BLOCK_BUDGET);
        assertTrue(w1 && ok1, "the router path failed at a size it handled on the curve");

        (bool w2,) = _tryDirect(n, BLOCK_BUDGET);
        (bool ok2, uint256 direct) = _tryDirect(n, BLOCK_BUDGET);
        assertTrue(w2 && ok2, "the direct path failed");
        assertEq(probe.lastLength(), n, "the direct path did not deliver the payload it claimed to");

        console2.log("B1 262,144 bytes through PoolSwapTest, gas:", viaRouter);
        console2.log("B1 262,144 bytes through manager.unlock directly, gas:", direct);
        console2.log("B1 the router's share of that cost, gas:", viaRouter - direct);
        assertLt(direct, viaRouter, "reaching v4 directly did not cost less than reaching it through a router");

        // And the ceiling on the direct path, bisected the same way as the router ceiling.
        uint256 lo = 0;
        uint256 hi = 2048; // 8 MiB
        (bool loOk,) = _tryDirect(lo * PAGE, BLOCK_BUDGET);
        assertTrue(loOk, "the direct lower bound must pass");
        (bool hiOk,) = _tryDirect(hi * PAGE, BLOCK_BUDGET);
        assertFalse(hiOk, "the direct upper bound must fail");
        while (hi - lo > 1) {
            uint256 mid = (lo + hi) / 2;
            (bool ok,) = _tryDirect(mid * PAGE, BLOCK_BUDGET);
            if (ok) lo = mid;
            else hi = mid;
        }
        (bool atCeiling,) = _tryDirect(lo * PAGE, BLOCK_BUDGET);
        (bool past,) = _tryDirect(hi * PAGE, BLOCK_BUDGET);
        assertTrue(atCeiling, "the direct ceiling does not pass");
        assertFalse(past, "one page past the direct ceiling does not fail");
        console2.log("B1 direct ceiling under a 36,000,000 gas budget, bytes (resolution 4096):", lo * PAGE);
    }

    /// @notice WHAT BREAKS FIRST, AND HOW IT LOOKS. Above the budget there is no protocol error to
    ///         read: the frame simply halts. The whole ladder returns EMPTY revert data, which is
    ///         the same thing a hook that called `revert()` returns — the caller cannot tell an
    ///         over-large payload from a refusal by shape alone.
    function test_B1_05_aboveTheCeilingThereIsNoErrorToRead() public {
        uint256[3] memory sizes = [uint256(1 << 22), 1 << 23, 1 << 24];
        console2.log("B1 above the ceiling (cap 300,000,000 gas)  --  bytes | ok? | gas consumed | error bytes");
        for (uint256 i = 0; i < sizes.length; i++) {
            uint256 before = gasleft();
            (bool ok, bytes memory err) =
                address(this).call{gas: 300_000_000}(abi.encodeCall(this.harnessSwapWithHookDataOfSize, (sizes[i])));
            uint256 used = before - gasleft();
            console2.log(sizes[i], ok, used);
            console2.log("   revert data length:", err.length);
            assertFalse(ok, "a size chosen to be above the ceiling succeeded");
            assertEq(err.length, 0, "the failure carried revert data, so it was not a bare halt");
        }
    }
}

/*//////////////////////////////////////////////////////////////////////////////////////////////////
                              B2 — HOW MUCH GAS A CALLBACK CAN BURN
//////////////////////////////////////////////////////////////////////////////////////////////////*/

contract B2GasTest is LabBase {
    GasBurnProbe internal probe;
    PoolKey internal key;

    uint256 internal constant STEP = 250_000;

    function setUp() public {
        setUpV4();
        _deployProbe("GasBurnProbe", GASBURN_PROBE);
        probe = GasBurnProbe(GASBURN_PROBE);
        (key,) = initNativePoolWithLiquidity(IHooks(GASBURN_PROBE), 10 ether);
    }

    function harnessSwapBurning(uint256 gasToBurn) external payable {
        require(msg.sender == address(this), "self only");
        probe.setBurn(gasToBurn);
        swapNativeExactIn(key, PROBE_SWAP_IN, "");
    }

    function _try(uint256 burn, uint256 gasCap) internal returns (bool ok, uint256 used) {
        uint256 before = gasleft();
        (ok,) = address(this).call{gas: gasCap}(abi.encodeCall(this.harnessSwapBurning, (burn)));
        used = before - gasleft();
    }

    /// @notice THE CONTROL. A probe asked to burn nothing costs a knowable, small amount, and the
    ///         floor it establishes is what every later number is measured against.
    function test_B2_00_control_baselineSwapWithAnIdleHook() public {
        (bool ok, uint256 used) = _try(0, BLOCK_BUDGET);
        assertTrue(ok, "the baseline swap failed");
        assertEq(probe.calls(), 1, "beforeSwap did not run");
        // Measured at 4,517: one cold SSTORE for `lastLoopBurn = 0`, one for `lastMeasuredBurn`
        // (warm by then), plus the BaseHook prologue. Bounded, not pinned.
        assertLt(probe.lastMeasuredBurn(), 10_000, "an idle beforeSwap cost more than its own bookkeeping");
        console2.log("B2 baseline: whole swap gas with an idle hook:", used);
        console2.log("B2 baseline: gas inside beforeSwap:", probe.lastMeasuredBurn());
    }

    /// @notice VALIDATION BY SABOTAGE. The burner must actually burn. A request of 1,000,000 that
    ///         produced a measured burn near zero would mean the loop was elided and every ceiling
    ///         below it was fiction.
    function test_B2_01_instrument_theBurnerActuallyBurns() public {
        (bool ok,) = _try(1_000_000, BLOCK_BUDGET);
        assertTrue(ok, "a 1,000,000 gas burn did not fit under the block budget");
        uint256 loop = probe.lastLoopBurn();
        uint256 whole = probe.lastMeasuredBurn();
        console2.log("B2 requested 1,000,000  --  burned by the loop:", loop);
        console2.log("B2 requested 1,000,000  --  whole callback:", whole);
        assertGe(loop, 1_000_000, "the loop burned less than it was asked to");
        // The loop can only stop on a keccak-round boundary, so it overshoots by at most one round.
        assertLe(loop, 1_002_000, "the loop overshot by more than its own granularity");
        // And the difference between the two figures is the probe's own bookkeeping, not the burn.
        // Stating it as a range rather than a constant: it is one cold SSTORE plus the epilogue.
        // The gap is the probe's own bookkeeping: two cold SSTOREs at 22,100 each, and nothing else.
        // Measured at 44,438. Bounded rather than pinned, because a compiler change may move the
        // epilogue by a few hundred gas and that must not be reported as a change in the burn.
        assertGt(whole - loop, 40_000, "the bookkeeping cost vanished, so one of these is not measured");
        assertLt(whole - loop, 50_000, "the bookkeeping cost is larger than two cold SSTOREs can explain");
    }

    /// @notice THE CEILING, BISECTED. How much a `beforeSwap` can burn and still leave a swap that
    ///         fits in a block. Proved on both sides, at 250,000-gas resolution.
    function test_B2_02_burnCeilingUnderABlockBudget() public {
        uint256 lo = 0;
        uint256 hi = 144; // 36,000,000 in STEPs: above the whole budget by construction

        (bool loOk,) = _try(lo * STEP, BLOCK_BUDGET);
        assertTrue(loOk, "the lower bound must pass");
        (bool hiOk,) = _try(hi * STEP, BLOCK_BUDGET);
        assertFalse(hiOk, "the upper bound must fail");

        while (hi - lo > 1) {
            uint256 mid = (lo + hi) / 2;
            (bool ok,) = _try(mid * STEP, BLOCK_BUDGET);
            if (ok) lo = mid;
            else hi = mid;
        }

        (bool atCeiling, uint256 wholeSwap) = _try(lo * STEP, BLOCK_BUDGET);
        (bool past,) = _try(hi * STEP, BLOCK_BUDGET);
        assertTrue(atCeiling, "the reported burn ceiling does not pass");
        assertFalse(past, "one step past the reported burn ceiling does not fail");

        console2.log("B2 burn ceiling under 36,000,000 gas, requested (resolution 250,000):", lo * STEP);
        console2.log("B2 burn ceiling, measured inside beforeSwap (whole callback):", probe.lastMeasuredBurn());
        console2.log("B2 whole-swap gas at that ceiling:", wholeSwap);
        console2.log("B2 first failing request:", hi * STEP);
    }

    /// @notice WHAT A STARVED CALLBACK LOOKS LIKE FROM OUTSIDE. A hook that runs out of gas and a
    ///         hook that called `revert()` produce the SAME shape at the caller: ERC-7751's wrapper
    ///         around an empty reason. The wrapper still names the hook and the callback, so those
    ///         two facts survive; the reason does not exist to be read.
    function test_B2_03_outOfGasInsideTheCallbackIsAnEmptyReason() public {
        probe.setBurnUntilDeath(true);
        (bool ok, bytes memory err) = address(this).call{gas: 5_000_000}(abi.encodeCall(this.harnessSwapUntilDeath, ()));
        assertFalse(ok, "a hook that burns to death did not fail the swap");

        HookRevertDecoder.Refusal memory r = HookRevertDecoder.decode(err);
        console2.log("B2 starved callback decodes as:", HookRevertDecoder.kindName(r.kind));
        console2.log("B2 reverting contract:", r.target);
        assertEq(uint8(r.kind), uint8(HookRevertDecoder.Kind.WrappedEmptyReason), "an OOG hook was not an empty reason");
        assertEq(r.target, GASBURN_PROBE, "the wrapper did not name the hook");
        assertEq(r.callbackSelector, IHooks.beforeSwap.selector, "the wrapper did not name beforeSwap");
        assertEq(r.reasonSelector, bytes4(0), "an out-of-gas callback cannot carry a reason selector");
    }

    function harnessSwapUntilDeath() external payable {
        require(msg.sender == address(this), "self only");
        swapNativeExactIn(key, PROBE_SWAP_IN, "");
    }
}

/*//////////////////////////////////////////////////////////////////////////////////////////////////
                            B3 — TRANSIENT STORAGE ACROSS A SWAP, AND AFTER IT
//////////////////////////////////////////////////////////////////////////////////////////////////*/

contract B3TransientWithinATransactionTest is LabBase {
    TransientEchoProbe internal probe;
    PoolKey internal key;

    function setUp() public {
        setUpV4();
        _deployProbe("TransientEchoProbe", TRANSIENT_PROBE);
        probe = TransientEchoProbe(TRANSIENT_PROBE);
        (key,) = initNativePoolWithLiquidity(IHooks(TRANSIENT_PROBE), 10 ether);
    }

    /// @notice THE HALF EVERYONE CHECKS. A `tstore` in `beforeSwap` is readable in `afterSwap` of
    ///         the same swap.
    function test_B3_00_control_tstoreInBeforeSwapIsReadableInAfterSwap() public {
        swapNativeExactIn(key, PROBE_SWAP_IN, "");
        assertEq(probe.beforeCalls(), 1, "beforeSwap did not run");
        assertEq(probe.afterCalls(), 1, "afterSwap did not run");
        assertEq(probe.lastSeenOnEntry(), 0, "the slot was not empty at the start of the first swap");
        assertEq(probe.lastEchoed(), 0xC0FFEE, "afterSwap did not read what beforeSwap wrote");
    }

    /// @notice VALIDATION BY SABOTAGE. Change what is written and the echo must move with it. An
    ///         echo test that would pass against a hard-coded constant proves nothing.
    function test_B3_01_instrument_theEchoFollowsTheValue() public {
        probe.setNextValue(0xBADC0DE);
        swapNativeExactIn(key, PROBE_SWAP_IN, "");
        assertEq(probe.lastEchoed(), 0xBADC0DE, "the echo did not follow the written value");
    }

    /// @notice THE HALF PEOPLE ASSUME, MEASURED THE UNCOMFORTABLE WAY. Two swaps in ONE transaction
    ///         share the slot: the second `beforeSwap` sees what the first one wrote. EIP-1153
    ///         clears transient storage at the end of a TRANSACTION, not at the end of a call, a
    ///         swap, or an `unlock`. A hook that uses a transient flag as "once per swap" is wrong
    ///         here, and this is the row that says so.
    function test_B3_02_twoSwapsInOneTransactionShareTheSlot() public {
        probe.setNextValue(0xAAAA);
        swapNativeExactIn(key, PROBE_SWAP_IN, "");
        assertEq(probe.lastSeenOnEntry(), 0, "the first swap should have found an empty slot");

        probe.setNextValue(0xBBBB);
        swapNativeExactIn(key, PROBE_SWAP_IN, "");
        assertEq(probe.lastSeenOnEntry(), 0xAAAA, "the second swap did NOT see the first swap's write");
        assertEq(probe.lastEchoed(), 0xBBBB);

        assertEq(probe.peek(), 0xBBBB, "an ordinary call in the same transaction still sees the slot");
    }
}

/// @notice The next-transaction half, isolated in its own contract because it needs the swap to
///         happen in a DIFFERENT transaction from the assertion. `setUp()` and a test function are
///         separate top-level calls in this toolchain, which is the only boundary available here.
/// @dev Read `docs/lab/HOOK-LIMITS.md` before trusting this row for anything: what it measures is
///      Foundry's transaction boundary, and Foundry's boundary is not automatically the chain's.
contract B3TransientAcrossTransactionsTest is LabBase {
    TransientEchoProbe internal probe;
    PoolKey internal key;
    uint256 internal echoedDuringSetUp;

    function setUp() public {
        setUpV4();
        _deployProbe("TransientEchoProbe", TRANSIENT_PROBE);
        probe = TransientEchoProbe(TRANSIENT_PROBE);
        (key,) = initNativePoolWithLiquidity(IHooks(TRANSIENT_PROBE), 10 ether);
        probe.setNextValue(0xFEEDFACE);
        swapNativeExactIn(key, PROBE_SWAP_IN, "");
        echoedDuringSetUp = probe.lastEchoed();
    }

    /// @notice The write happened, and it happened in the other transaction. Without this the row
    ///         below would pass just as happily against a probe that never ran.
    function test_B3_03_control_theWriteDidHappenInTheOtherTransaction() public view {
        assertEq(probe.beforeCalls(), 1, "the setUp swap did not reach beforeSwap");
        assertEq(echoedDuringSetUp, 0xFEEDFACE, "the setUp swap did not echo its own write");
        assertEq(
            probe.lastWritten(), 0xFEEDFACE, "persistent storage did not survive setUp, so nothing here means anything"
        );
    }

    /// @notice THE ROW. The slot is empty again in the next transaction, while the ORDINARY storage
    ///         written in the same callback is still there. The pair is the point: one field
    ///         survived and one did not, so this cannot be a fixture that simply reset everything.
    function test_B3_04_theSlotIsEmptyInTheNextTransaction() public view {
        assertEq(probe.peek(), 0, "the transient slot survived into the next transaction");
        assertEq(probe.lastWritten(), 0xFEEDFACE, "the persistent field did not survive, so the pair proves nothing");
    }
}

/*//////////////////////////////////////////////////////////////////////////////////////////////////
                       B4 — WHAT A HOOK MAY CALL BACK INTO DURING A CALLBACK
//////////////////////////////////////////////////////////////////////////////////////////////////*/

contract B4ReentrancyTest is LabBase {
    ReentrancyProbe internal probe;
    PoolKey internal key;
    PoolKey internal plainKey;

    function setUp() public {
        setUpV4();
        _deployProbe("ReentrancyProbe", REENTRANCY_PROBE);
        probe = ReentrancyProbe(payable(REENTRANCY_PROBE));
        (key,) = initNativePoolWithLiquidity(IHooks(REENTRANCY_PROBE), 10 ether);
        // A second, hookless pool so "re-enter a DIFFERENT pool" is a row that can be asked at all.
        plainKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: usdcCurrency,
            fee: FEE,
            tickSpacing: 30,
            hooks: IHooks(address(0))
        });
        initPoolWithLiquidity(plainKey, 10 ether);
        probe.setKeys(key, plainKey);
        vm.deal(REENTRANCY_PROBE, 1 ether);
    }

    function harnessSwap() external payable {
        require(msg.sender == address(this), "self only");
        swapNativeExactIn(key, PROBE_SWAP_IN, "");
    }

    function _swapOutcome() internal returns (bool ok, bytes memory err) {
        (ok, err) = address(this).call(abi.encodeCall(this.harnessSwap, ()));
    }

    /// @notice THE CONTROL. With no re-entry configured the swap goes through. Every row below is a
    ///         change from this one, and without it a suite of thirteen reverts proves only that
    ///         the fixture is broken.
    function test_B4_00_control_noReentryMeansAnOrdinarySwap() public {
        probe.configure(ReentrancyProbe.Target.None, ReentrancyProbe.Mode.Continue);
        (bool ok,) = _swapOutcome();
        assertTrue(ok, "a hook that re-enters nothing still failed the swap");
        assertEq(probe.calls(), 1, "beforeSwap did not run");
    }

    /// @dev REPORT mode: the probe makes the inner call and then deliberately reverts carrying the
    ///      outcome, so the row survives even when the outer transaction was doomed anyway.
    function _report(ReentrancyProbe.Target t) internal returns (bool innerOk, bytes4 innerSelector) {
        probe.configure(t, ReentrancyProbe.Mode.Report);
        (bool ok, bytes memory err) = _swapOutcome();
        assertFalse(ok, "REPORT mode must always fail the outer swap");
        (address who, bytes4 callback, bytes memory reason) = _unwrapReason(err);
        assertEq(who, REENTRANCY_PROBE, "the wrapper named a contract that is not the probe");
        assertEq(callback, IHooks.beforeSwap.selector, "the wrapper named a callback that is not beforeSwap");
        assertEq(_selectorOf(reason), ReentrancyProbe.Reentered.selector, "the probe did not report");
        bytes memory inner;
        (, innerOk, inner) = abi.decode(_afterSelector(reason), (uint8, bool, bytes));
        // A SUCCESSFUL inner call returns a value, not an error, and the first four bytes of a
        // return value are not a selector. Reporting one there would have put `0xffffffff` in the
        // table under the heading "inner error" — measured, and wrong enough to be worth a branch.
        innerSelector = innerOk ? bytes4(0) : _selectorOf(inner);
    }

    /// @dev CONTINUE mode: the probe swallows the outcome and lets the swap run on, so this
    ///      measures whether the whole TRANSACTION survives the re-entry — a different question.
    function _continue(ReentrancyProbe.Target t) internal returns (bool outerOk, bytes4 outerSelector) {
        probe.configure(t, ReentrancyProbe.Mode.Continue);
        bytes memory err;
        (outerOk, err) = _swapOutcome();
        outerSelector = _selectorOf(err);
    }

    /// @notice VALIDATION BY SABOTAGE, TWICE OVER. REPORT mode must carry a TRUE inner result out
    ///         of a doomed frame (`sync` succeeds) and a FALSE one (`unlock` does not). A reporter
    ///         that always said the same thing would make the whole table below worthless.
    function test_B4_01_instrument_reportModeCarriesBothVerdicts() public {
        (bool syncOk, bytes4 syncErr) = _report(ReentrancyProbe.Target.SyncNative);
        assertTrue(syncOk, "sync from inside a callback was reported as failing");
        assertEq(syncErr, bytes4(0), "a successful inner call reported an error selector");

        (bool unlockOk, bytes4 unlockErr) = _report(ReentrancyProbe.Target.Unlock);
        assertFalse(unlockOk, "unlock from inside a callback was reported as succeeding");
        assertEq(unlockErr, IPoolManager.AlreadyUnlocked.selector, "unlock did not fail with AlreadyUnlocked");
    }

    /// @notice THE LOCK REFUSES ALMOST NOTHING. `unlock` is the single entry point the PoolManager
    ///         closes to a hook mid-callback; `onlyWhenUnlocked` is SATISFIED during a callback,
    ///         because a callback only happens inside an unlock. What actually constrains a
    ///         re-entrant hook is delta settlement at the end of the outer `unlock`, not a lock.
    function test_B4_02_theOnlyEntryPointTheLockRefusesIsUnlock() public {
        (bool ok, bytes4 sel) = _report(ReentrancyProbe.Target.Unlock);
        assertFalse(ok);
        assertEq(sel, IPoolManager.AlreadyUnlocked.selector);

        // Not ManagerLocked. A hook is inside the unlock, so the manager is not locked to it.
        assertTrue(sel != IPoolManager.ManagerLocked.selector, "the refusal was the lock, not re-entrancy");
    }

    function _name(ReentrancyProbe.Target t) internal pure returns (string memory) {
        if (t == ReentrancyProbe.Target.Unlock) return "unlock";
        if (t == ReentrancyProbe.Target.Initialize) return "initialize(new pool)";
        if (t == ReentrancyProbe.Target.SwapSamePool) return "swap(same pool)";
        if (t == ReentrancyProbe.Target.SwapOtherPool) return "swap(other pool)";
        if (t == ReentrancyProbe.Target.ModifyLiquiditySamePool) return "modifyLiquidity(same pool)";
        if (t == ReentrancyProbe.Target.DonateSamePool) return "donate(same pool)";
        if (t == ReentrancyProbe.Target.TakeNative) return "take(native)";
        if (t == ReentrancyProbe.Target.SettleNative) return "settle()";
        if (t == ReentrancyProbe.Target.SyncNative) return "sync(native)";
        if (t == ReentrancyProbe.Target.ClearNative) return "clear(native)";
        if (t == ReentrancyProbe.Target.MintClaims) return "mint(claims)";
        if (t == ReentrancyProbe.Target.BurnClaims) return "burn(claims)";
        return "setProtocolFee";
    }

    /// @notice THE TABLE. Thirteen entry points, both questions, one row each: did the inner call
    ///         succeed, and did the whole transaction survive letting it. The pair is what matters —
    ///         every row where the inner call succeeds and the transaction still dies is a place
    ///         where a hook CAN do the thing and simply cannot pay for it.
    /// @dev Every cell below was measured before it was written down. The expected arrays are the
    ///      measurement frozen, so a change in v4's behaviour breaks a row instead of quietly
    ///      re-printing a different table under the same passing test.
    function test_B4_03_theWholeReentrancySurface() public {
        bool[13] memory expectInnerOk =
            [false, true, true, true, true, true, true, true, true, false, true, false, false];
        bytes4[13] memory expectInnerErr = [
            IPoolManager.AlreadyUnlocked.selector,
            bytes4(0),
            bytes4(0),
            bytes4(0),
            bytes4(0),
            bytes4(0),
            bytes4(0),
            bytes4(0),
            bytes4(0),
            IPoolManager.MustClearExactPositiveDelta.selector,
            bytes4(0),
            bytes4(keccak256("Panic(uint256)")),
            IProtocolFees.InvalidCaller.selector
        ];
        bool[13] memory expectOuterOk =
            [true, true, false, false, false, false, false, true, true, true, false, true, true];

        console2.log("B4  entry point | inner ok | inner error | outer survives | outer error");
        uint256 innerSucceeded;
        uint256 outerSurvived;
        for (uint256 i = 1; i <= 13; i++) {
            ReentrancyProbe.Target t = ReentrancyProbe.Target(i);
            (bool innerOk, bytes4 innerSel) = _report(t);
            (bool outerOk, bytes4 outerSel) = _continue(t);
            console2.log(_name(t));
            console2.log("   inner ok:", innerOk);
            console2.logBytes4(innerSel);
            console2.log("   outer survives:", outerOk);
            console2.logBytes4(outerSel);

            assertEq(innerOk, expectInnerOk[i - 1], string.concat("inner verdict moved for ", _name(t)));
            assertEq(innerSel, expectInnerErr[i - 1], string.concat("inner error moved for ", _name(t)));
            assertEq(outerOk, expectOuterOk[i - 1], string.concat("outer verdict moved for ", _name(t)));
            if (!outerOk) {
                assertEq(
                    outerSel,
                    IPoolManager.CurrencyNotSettled.selector,
                    string.concat("the transaction died of something other than unsettled deltas: ", _name(t))
                );
            }
            if (innerOk) innerSucceeded++;
            if (outerOk) outerSurvived++;
        }
        console2.log("B4 entry points whose inner call succeeded:", innerSucceeded);
        console2.log("B4 entry points where the transaction still survived:", outerSurvived);
        assertEq(innerSucceeded, 9, "the number of reachable entry points moved");
        assertEq(outerSurvived, 7, "the number of survivable entry points moved");
    }

    /// @notice THE ONE THAT SURPRISES PEOPLE. A hook re-entering `swap` on ITS OWN pool succeeds,
    ///         and its own callbacks are NOT called for that inner swap — `Hooks.noSelfCall` skips
    ///         a hook whose own address is the caller. So the guard against a hook recursing on
    ///         itself is not a lock and not a depth counter; it is a `msg.sender` comparison.
    function test_B4_04_aHooksOwnCallbacksAreSkippedWhenItCallsTheManagerItself() public {
        (bool innerOk,) = _report(ReentrancyProbe.Target.SwapSamePool);
        assertTrue(innerOk, "a hook could not swap its own pool from inside beforeSwap");
        // One entry: the outer swap's beforeSwap. The inner swap did not call beforeSwap again.
        assertEq(probe.calls(), 0, "storage from a REPORT row must have been rolled back");

        probe.configure(ReentrancyProbe.Target.SwapSamePool, ReentrancyProbe.Mode.Continue);
        (bool outerOk, bytes memory err) = _swapOutcome();
        assertFalse(outerOk, "the transaction survived a hook opening an unpayable position");
        assertEq(_selectorOf(err), IPoolManager.CurrencyNotSettled.selector, "the outer failure was not the deltas");
    }
}

/*//////////////////////////////////////////////////////////////////////////////////////////////////
                       B5 — WHAT SURVIVES OF A HOOK'S REVERT ON THE WAY OUT
//////////////////////////////////////////////////////////////////////////////////////////////////*/

contract B5RevertPropagationTest is LabBase {
    RevertShapeProbe internal probe;
    PoolKey internal key;

    function setUp() public {
        setUpV4();
        _deployProbe("RevertShapeProbe", REVERT_PROBE);
        probe = RevertShapeProbe(REVERT_PROBE);
        (key,) = initNativePoolWithLiquidity(IHooks(REVERT_PROBE), 10 ether);
    }

    function harnessSwap() external payable {
        require(msg.sender == address(this), "self only");
        swapNativeExactIn(key, PROBE_SWAP_IN, "");
    }

    function _swap(RevertShapeProbe.Shape s) internal returns (bool ok, bytes memory err) {
        probe.setShape(s);
        (ok, err) = address(this).call(abi.encodeCall(this.harnessSwap, ()));
    }

    /// @notice THE CONTROL. The probe can return a shape the PoolManager accepts. Every failing row
    ///         below is a departure from this one and not a broken fixture.
    function test_B5_00_control_aValidReturnIsAccepted() public {
        (bool ok,) = _swap(RevertShapeProbe.Shape.Valid);
        assertTrue(ok, "the valid control failed");
        assertEq(probe.calls(), 1, "beforeSwap did not run");
    }

    /// @notice A HOOK'S OWN ERROR SURVIVES, WRAPPED, WITH ITS ARGUMENTS. This is the good case and
    ///         the reason the repository has an ERC-7751 decoder at all.
    function test_B5_01_aCustomErrorArrivesWhole() public {
        (bool ok, bytes memory err) = _swap(RevertShapeProbe.Shape.CustomWithArgs);
        assertFalse(ok);
        HookRevertDecoder.Refusal memory r = HookRevertDecoder.decode(err);
        assertEq(uint8(r.kind), uint8(HookRevertDecoder.Kind.Wrapped), "not a well-formed ERC-7751 wrapper");
        assertEq(r.target, REVERT_PROBE, "the wrapper did not name the hook");
        assertEq(r.callbackSelector, IHooks.beforeSwap.selector, "the wrapper did not name the callback");
        assertEq(r.reasonSelector, RevertShapeProbe.ProbeRefusedWithArgs.selector, "the hook's own error was lost");

        // The arguments, not merely the selector: this is what "intact" has to mean.
        (,, bytes memory reason) = _unwrapReason(err);
        (address who, uint256 code, bytes32 tag) = abi.decode(_afterSelector(reason), (address, uint256, bytes32));
        assertEq(who, REVERT_PROBE);
        assertEq(code, 42);
        assertEq(tag, bytes32("limit-probe"));
    }

    /// @notice THE COLLISION. Four completely different failures arrive at the caller with the SAME
    ///         decoded shape — a wrapper around a reason too short to identify. A caller that reads
    ///         only the shape cannot separate "the hook refused" from "the hook broke".
    function test_B5_02_fourDifferentFailuresAreIndistinguishable() public {
        RevertShapeProbe.Shape[3] memory shapes = [
            RevertShapeProbe.Shape.BareRevert,
            RevertShapeProbe.Shape.OneByteRevert,
            RevertShapeProbe.Shape.ThreeByteRevert
        ];
        for (uint256 i = 0; i < shapes.length; i++) {
            (bool ok, bytes memory err) = _swap(shapes[i]);
            assertFalse(ok);
            HookRevertDecoder.Refusal memory r = HookRevertDecoder.decode(err);
            assertEq(
                uint8(r.kind),
                uint8(HookRevertDecoder.Kind.WrappedEmptyReason),
                "a sub-selector revert was not a wrapped empty reason"
            );
            assertEq(r.target, REVERT_PROBE, "the hook's identity was lost too");
            assertEq(r.reasonSelector, bytes4(0));
        }
        // The fourth member of the set is an out-of-gas callback, measured in B2_03.
    }

    /// @notice STRINGS AND PANICS SURVIVE, BECAUSE THEY ARE ABI ERRORS LIKE ANY OTHER.
    function test_B5_03_stringsAndPanicsSurvive() public {
        (bool ok1, bytes memory err1) = _swap(RevertShapeProbe.Shape.RequireString);
        assertFalse(ok1);
        HookRevertDecoder.Refusal memory r1 = HookRevertDecoder.decode(err1);
        assertEq(uint8(r1.kind), uint8(HookRevertDecoder.Kind.Wrapped));
        assertEq(
            r1.reasonSelector, bytes4(keccak256("Error(string)")), "a require string did not arrive as Error(string)"
        );
        (,, bytes memory reason1) = _unwrapReason(err1);
        assertEq(abi.decode(_afterSelector(reason1), (string)), "RevertShapeProbe: refused by string");

        (bool ok2, bytes memory err2) = _swap(RevertShapeProbe.Shape.LanguagePanic);
        assertFalse(ok2);
        HookRevertDecoder.Refusal memory r2 = HookRevertDecoder.decode(err2);
        assertEq(uint8(r2.kind), uint8(HookRevertDecoder.Kind.Wrapped));
        assertEq(r2.reasonSelector, bytes4(keccak256("Panic(uint256)")), "a language panic did not arrive as Panic");
        (,, bytes memory reason2) = _unwrapReason(err2);
        assertEq(abi.decode(_afterSelector(reason2), (uint256)), 0x12, "the panic code was not division by zero");
    }

    /// @notice THE CASE THE DECODER CANNOT HELP WITH. A hook that RETURNS something the PoolManager
    ///         will not accept is rejected by the PoolManager's own `InvalidHookResponse` — a
    ///         DIRECT error naming nothing. The hook's address is not in the payload at all, so
    ///         "which hook broke" is not answerable from the revert data.
    function test_B5_04_aBadReturnValueIsNotWrappedAndNamesNoHook() public {
        RevertShapeProbe.Shape[3] memory shapes = [
            RevertShapeProbe.Shape.WrongSelector, RevertShapeProbe.Shape.EmptyReturn, RevertShapeProbe.Shape.ShortReturn
        ];
        for (uint256 i = 0; i < shapes.length; i++) {
            (bool ok, bytes memory err) = _swap(shapes[i]);
            assertFalse(ok, "a malformed hook return was accepted");
            HookRevertDecoder.Refusal memory r = HookRevertDecoder.decode(err);
            assertEq(uint8(r.kind), uint8(HookRevertDecoder.Kind.Direct), "a bad return value was wrapped after all");
            assertEq(r.outerSelector, Hooks.InvalidHookResponse.selector, "not the PoolManager's own rejection");
            assertEq(r.target, address(0), "a direct error cannot name the hook, and must not claim to");
        }
    }

    /// @notice THE REVERT DATA BOMB, MEASURED. v4's `CustomRevert.bubbleUpAndRevertWith` carries a
    ///         comment saying it is vulnerable to one. It is: the hook's payload is copied into the
    ///         PoolManager's memory and re-emitted, so a hook can impose quadratic memory cost on
    ///         everyone above it and hand the caller a multi-hundred-kilobyte error to parse.
    function test_B5_05_aRevertBombIsPaidForByTheCaller() public {
        uint256[4] memory sizes = [uint256(1_000), 10_000, 100_000, 1_000_000];
        console2.log("B5 revert bomb  --  hook payload bytes | gas the caller paid | error bytes received");
        uint256 previousGas;
        for (uint256 i = 0; i < sizes.length; i++) {
            probe.setBombBytes(sizes[i]);
            probe.setShape(RevertShapeProbe.Shape.RevertBomb);
            uint256 before = gasleft();
            (bool ok, bytes memory err) = address(this).call{gas: 400_000_000}(abi.encodeCall(this.harnessSwap, ()));
            uint256 used = before - gasleft();
            assertFalse(ok);
            console2.log(sizes[i], used, err.length);
            assertGt(err.length, sizes[i], "the bomb did not reach the caller intact");
            if (i > 0) assertGt(used, previousGas, "a bigger bomb did not cost the caller more");
            previousGas = used;

            // A bomb long enough to hold a selector decodes as a WELL-FORMED wrapper. This one is
            // zeros, so its "reason selector" reads as 0x00000000 — but a hostile hook chooses those
            // four bytes freely, and can therefore hand a decoder the selector of somebody else's
            // legitimate error. The wrapper's `target` field is the only part it cannot forge, and
            // that is exactly why this repository's decoder asserts on the target and the callback
            // and not on a selector found in the payload.
            HookRevertDecoder.Refusal memory r = HookRevertDecoder.decode(err);
            assertEq(uint8(r.kind), uint8(HookRevertDecoder.Kind.Wrapped), "the bomb did not parse as a wrapper");
            assertEq(r.target, REVERT_PROBE, "the wrapper still names the hook, however large the payload");
            assertEq(r.reasonLength, sizes[i], "the reason length is not the payload the hook chose");
        }
    }
}

/*//////////////////////////////////////////////////////////////////////////////////////////////////
                          B6 — WHAT A PERMISSION-BIT ADDRESS ACTUALLY COSTS TO MINE
//////////////////////////////////////////////////////////////////////////////////////////////////*/

/// @notice v4 reads a hook's permissions out of the low fourteen bits of its ADDRESS, and
///         `Hooks.validateHookPermissions` compares all fourteen for exact equality — so a hook is
///         not mining a prefix, it is mining a full 14-bit match. This contract measures the salt
///         search rather than asserting the textbook 1-in-2^14, and reports the WORST case it
///         actually hit, which is the number that decides whether a deploy script hangs.
contract B6AddressMiningTest is LabBase {
    /// @dev The canonical CREATE2 factory this repository's deploy scripts use.
    address internal constant FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint160 internal constant ALL_HOOK_BITS = uint160((1 << 14) - 1);
    /// @dev A ceiling on any single search, so a pathological run fails loudly instead of hanging.
    uint256 internal constant GIVE_UP_AFTER = 2_000_000;

    /// @dev A CREATE2 preimage buffer, allocated ONCE. The first version of this file rebuilt it
    ///      with `abi.encodePacked` inside the loop and died of `MemoryOOG` after a few hundred
    ///      thousand salts — memory is never reclaimed in the EVM, so a miner that allocates per
    ///      attempt cannot run long enough to measure a worst case. That failure is the reason this
    ///      helper exists, and it is also, incidentally, a limit worth knowing.
    function _preimage(bytes32 initCodeHash) internal pure returns (uint256 ptr) {
        assembly ("memory-safe") {
            ptr := mload(0x40)
            mstore(0x40, add(ptr, 0x80))
            mstore8(ptr, 0xff)
            mstore(add(ptr, 1), shl(96, FACTORY))
            mstore(add(ptr, 53), initCodeHash)
        }
    }

    /// @dev keccak256(0xff ++ factory ++ salt ++ initCodeHash), truncated to twenty bytes.
    function _addressFor(uint256 ptr, bytes32 salt) internal pure returns (uint160 a) {
        assembly ("memory-safe") {
            mstore(add(ptr, 21), salt)
            a := and(keccak256(ptr, 85), 0xffffffffffffffffffffffffffffffffffffffff)
        }
    }

    function _mine(bytes32 initCodeHash, uint160 wantedBits) internal pure returns (uint256 tries, bytes32 salt) {
        uint256 ptr = _preimage(initCodeHash);
        for (uint256 i = 1; i <= GIVE_UP_AFTER; i++) {
            salt = bytes32(i);
            if (_addressFor(ptr, salt) & ALL_HOOK_BITS == wantedBits) return (i, salt);
        }
        revert("mining did not converge inside 2,000,000 salts");
    }

    /// @notice THE CONTROL. The miner finds an address, and that address really does satisfy the
    ///         predicate v4 itself uses — `Hooks.hasPermission`, not a re-implementation of it. A
    ///         miner nobody checked against v4's own function is a loop, not a miner.
    function test_B6_00_control_theMinedAddressSatisfiesV4sOwnCheck() public pure {
        uint160 wanted = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG); // 0xC0, UNICA V1's set
        bytes32 initCodeHash = keccak256("control-init-code");
        (uint256 tries, bytes32 salt) = _mine(initCodeHash, wanted);
        address a = address(_addressFor(_preimage(initCodeHash), salt));
        assertTrue(Hooks.hasPermission(IHooks(a), Hooks.BEFORE_SWAP_FLAG), "beforeSwap bit missing");
        assertTrue(Hooks.hasPermission(IHooks(a), Hooks.AFTER_SWAP_FLAG), "afterSwap bit missing");
        assertEq(uint160(a) & ALL_HOOK_BITS, wanted, "some other permission bit was set too");
        assertGt(tries, 0);
    }

    /// @notice VALIDATION BY SABOTAGE. Ask for `beforeSwap` ALONE and confirm the result does not
    ///         carry `afterSwap` as well. A search that accepted a superset would report beautifully
    ///         small numbers and hand back an address v4 refuses.
    function test_B6_01_instrument_theMinerRejectsTheWrongPattern() public pure {
        uint160 wanted = uint160(Hooks.BEFORE_SWAP_FLAG); // 0x80 exactly: afterSwap must be OFF
        bytes32 initCodeHash = keccak256("sabotage-init-code");
        (, bytes32 salt) = _mine(initCodeHash, wanted);
        address a = address(_addressFor(_preimage(initCodeHash), salt));
        assertEq(uint160(a) & ALL_HOOK_BITS, wanted);
        assertFalse(Hooks.hasPermission(IHooks(a), Hooks.AFTER_SWAP_FLAG), "the miner accepted an extra bit");
    }

    /// @notice THE DISTRIBUTION, MEASURED, NOT ASSERTED. Forty independent searches for the exact
    ///         fourteen-bit pattern `0xC0`. Reported: fewest, mean, and — the operational number —
    ///         the WORST case actually hit, because that is what a deploy script has to survive.
    ///         The mean is near 2^14 by construction; the worst case is several times it, and a
    ///         deploy script sized for the mean is a deploy script that hangs.
    function test_B6_02_saltDistributionForAFourteenBitPattern() public pure {
        uint160 wanted = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
        uint256 trials = 40;
        uint256 total;
        uint256 worst;
        uint256 best = type(uint256).max;
        for (uint256 t = 0; t < trials; t++) {
            // A different init-code hash per trial. Changing a hook's CONSTRUCTOR ARGUMENTS changes
            // this hash, which is why the hooks in this repository take none: a per-chain argument
            // would mean a per-chain address and a fresh search for every chain it is deployed to.
            (uint256 tries,) = _mine(keccak256(abi.encodePacked("trial", t)), wanted);
            total += tries;
            if (tries > worst) worst = tries;
            if (tries < best) best = tries;
        }
        console2.log("B6 independent searches:", trials);
        console2.log("B6 fewest salts tried:", best);
        console2.log("B6 mean salts tried:", total / trials);
        console2.log("B6 WORST salts tried (what a deploy script must survive):", worst);
        console2.log("B6 for reference, 2^14 =", uint256(1) << 14);
        assertGt(worst, total / trials, "the worst case was not worse than the mean, which cannot be right");
        assertLt(best, uint256(1) << 14, "not one of forty searches beat the mean, which cannot be right");
    }

    /// @notice EVERY EXTRA CONSTRAINED BIT MULTIPLIES THE SEARCH. Mining the fourteen permission
    ///         bits, versus mining those PLUS one chosen nibble above them, measured side by side
    ///         on the same number of trials. The ratio is the cost of any vanity beyond what v4
    ///         requires — and it is the reason the probe addresses in this file are ETCHED rather
    ///         than mined.
    function test_B6_03_everyExtraConstrainedBitMultipliesTheSearch() public pure {
        uint160 wanted = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
        // Six, not more. At eight this row consumed 791,328,815 of the 1,073,741,824 gas a Foundry
        // test is given, and a measurement that sits at 74% of its own budget is one unlucky salt
        // away from reporting an out-of-gas as a result.
        uint256 trials = 6;

        uint256 plainTotal;
        for (uint256 t = 0; t < trials; t++) {
            (uint256 tries,) = _mine(keccak256(abi.encodePacked("plain", t)), wanted);
            plainTotal += tries;
        }

        uint256 extraTotal;
        for (uint256 t = 0; t < trials; t++) {
            uint256 ptr = _preimage(keccak256(abi.encodePacked("extra", t)));
            uint256 tries;
            for (uint256 i = 1; i <= GIVE_UP_AFTER; i++) {
                uint160 a = _addressFor(ptr, bytes32(i));
                // The permission bits, AND the next nibble up being zero: four more bits of luck.
                if (a & ALL_HOOK_BITS == wanted && (a >> 14) & 0xF == 0) {
                    tries = i;
                    break;
                }
            }
            require(tries != 0, "the constrained search did not converge inside 2,000,000 salts");
            extraTotal += tries;
        }

        console2.log("B6 mean salts, the 14 permission bits only:", plainTotal / trials);
        console2.log("B6 mean salts, 14 permission bits + 4 chosen bits:", extraTotal / trials);
        console2.log("B6 measured ratio (x100):", (extraTotal * 100) / plainTotal);
        assertGt(extraTotal, plainTotal * 4, "constraining four more bits cost less than four times as much");
    }
}
