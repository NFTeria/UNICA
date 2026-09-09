// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IProtocolFees} from "@uniswap/v4-core/src/interfaces/IProtocolFees.sol";

/// @title LimitProbes — five separate instruments for measuring where a Uniswap v4 hook stops
///
/// @notice EXPERIMENT B of the UNICA laboratory. Nothing in this file is part of UNICA's settlement
///         path, nothing here is deployed to any chain, and no probe in it is a hook anyone should
///         put on a real pool. Each probe exists to make ONE limit visible and to fail loudly at it.
///
/// @dev FIVE CONTRACTS, NOT ONE, AND THAT IS THE POINT. A single probe carrying every behaviour
///      would be unreviewable, and the callback surface it exposed would be shared between
///      experiments that must not contaminate each other — a gas-burn loop in the same contract as
///      the transient-storage echo would make "was the slot still set?" un-answerable. Every probe
///      below declares its own permission bits, so the address it must be etched at differs, and
///      the PoolManager therefore calls a different, smaller thing for each measurement.
///
/// @dev WHAT THESE PROBES CANNOT TELL YOU. Every number this file produces is produced INSIDE the
///      Foundry EVM, against Uniswap's official PoolManager runtime placed there by the shared test
///      base. Transaction calldata pricing, block-builder behaviour, and mempool economics are not
///      in scope of any measurement here and are recorded as NOT MEASURED in docs/lab/HOOK-LIMITS.md
///      rather than estimated in a comment that would read like a result.
library LimitProbeFlags {
    /// @dev `beforeSwap` alone. Four of the five probes need exactly this and nothing else.
    uint160 internal constant BEFORE_SWAP = Hooks.BEFORE_SWAP_FLAG;
    /// @dev `beforeSwap | afterSwap`. Only the transient-storage probe needs both halves of a swap.
    uint160 internal constant BEFORE_AND_AFTER_SWAP = Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
}

/*//////////////////////////////////////////////////////////////////////////////////////////////////
                           B1 — HOW MUCH hookData CAN REACH A CALLBACK
//////////////////////////////////////////////////////////////////////////////////////////////////*/

/// @title HookDataSizeProbe — reports what actually arrived, so a size claim is never assumed
/// @notice Records the length of the `hookData` the PoolManager delivered, and a digest of it. The
///         digest exists because "the callback received 262144 bytes" and "the callback received
///         262144 bytes THAT THE CALLER SENT" are different claims, and only the second one is
///         evidence that nothing in the router/manager path truncated or re-allocated the payload.
/// @dev Deliberately does almost nothing else: this probe's gas must stay a small constant so the
///      gas curve it produces is the curve of the DATA, not of the probe.
contract HookDataSizeProbe is BaseHook {
    /// @notice Length of the hookData delivered to the most recent `beforeSwap`.
    uint256 public lastLength;
    /// @notice keccak256 of that hookData. Zero-length data hashes to keccak256("") — not to zero.
    bytes32 public lastDigest;
    /// @notice How many times `beforeSwap` ran. A permission-bit mistake leaves this at zero, and a
    ///         suite that only checked `lastLength` could not tell that apart from a zero-length payload.
    uint256 public calls;

    constructor(IPoolManager _manager) BaseHook(_manager) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeSwap = true;
    }

    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        lastLength = hookData.length;
        lastDigest = keccak256(hookData);
        calls++;
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}

/*//////////////////////////////////////////////////////////////////////////////////////////////////
                              B2 — HOW MUCH GAS A CALLBACK CAN BURN
//////////////////////////////////////////////////////////////////////////////////////////////////*/

/// @title GasBurnProbe — burns a requested amount of gas inside `beforeSwap`, and reports the amount
///        it ACTUALLY burned
/// @notice The requested figure and the burned figure are different numbers and this probe never
///         conflates them. The loop's granularity is one keccak round, so the burn overshoots the
///         request by up to one round; a test that quoted the request as the measurement would be
///         quoting an input as a result.
/// @dev The accumulator is written to storage after the loop so the compiler cannot delete the work.
///      With `optimizer = false` (this repository's setting) it could not anyway, but a probe whose
///      correctness depends on the optimizer being off is a probe that lies the day someone turns it on.
contract GasBurnProbe is BaseHook {
    /// @notice Gas the last `beforeSwap` was asked to burn.
    uint256 public requestedBurn;
    /// @notice Gas the last `beforeSwap` consumed between its first and last `gasleft()` — the whole
    ///         callback, bookkeeping included.
    uint256 public lastMeasuredBurn;
    /// @notice Gas the BURN LOOP alone consumed, measured before the probe writes anything.
    /// @dev Kept separate because the two differ by a cold SSTORE — about 22,100 gas — and a probe
    ///      that reported only the total would look like a loop that overshoots its request by 2%.
    ///      Measured: requesting 1,000,000 produced a total of 1,022,466 and a loop burn of ~1,000,4xx.
    uint256 public lastLoopBurn;
    /// @notice Keeps the loop's work observable. Never read by a test as anything but liveness.
    uint256 public digestSink;
    uint256 public calls;
    /// @notice When set, `beforeSwap` loops until the EVM halts it rather than checking first.
    bool public burnUntilDeath;

    /// @notice The burn target could not be honoured because the callback was not given that much gas.
    /// @dev Raised BEFORE burning, so a starved probe says so rather than dying of out-of-gas and
    ///      leaving the empty revert data that an out-of-gas and a bare `revert()` share.
    error NotEnoughGasToBurn(uint256 requested, uint256 available);

    constructor(IPoolManager _manager) BaseHook(_manager) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeSwap = true;
    }

    /// @notice Sets how much gas the next `beforeSwap` will try to burn.
    function setBurn(uint256 gasToBurn) external {
        requestedBurn = gasToBurn;
    }

    /// @notice Makes the next `beforeSwap` loop until the EVM stops it.
    /// @dev The ONLY way to produce a genuine out-of-gas INSIDE a callback: the checked burn above
    ///      refuses politely instead, and a polite refusal has revert data, which is precisely the
    ///      thing an out-of-gas does not have. The two must not be measured with one instrument.
    function setBurnUntilDeath(bool on) external {
        burnUntilDeath = on;
    }

    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        uint256 start = gasleft();
        if (burnUntilDeath) {
            uint256 d = uint256(keccak256(abi.encode(start)));
            while (true) {
                d = uint256(keccak256(abi.encode(d)));
                digestSink = d;
            }
        }
        uint256 target = requestedBurn;
        // The reserve is what the probe needs after the loop to store its results and return: two
        // cold SSTOREs and the epilogue. Measured empirically at well under 50k; 60k is the margin.
        uint256 reserve = 60_000;
        if (target != 0) {
            if (start < target + reserve) revert NotEnoughGasToBurn(target, start);
            uint256 stop = start - target;
            uint256 h = uint256(keccak256(abi.encode(start, target)));
            while (gasleft() > stop) {
                h = uint256(keccak256(abi.encode(h)));
            }
            uint256 afterLoop = gasleft();
            digestSink = h;
            lastLoopBurn = start - afterLoop;
        } else {
            lastLoopBurn = 0;
        }
        lastMeasuredBurn = start - gasleft();
        calls++;
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}

/*//////////////////////////////////////////////////////////////////////////////////////////////////
                       B3 — WHAT TRANSIENT STORAGE DOES ACROSS A SWAP, AND AFTER IT
//////////////////////////////////////////////////////////////////////////////////////////////////*/

/// @title TransientEchoProbe — writes a transient slot in `beforeSwap` and reads it in `afterSwap`
/// @notice Two halves, and the SECOND one is the half people assume rather than check:
///         (a) a `tstore` in `beforeSwap` is readable by `afterSwap` of the same swap, and
///         (b) the slot is empty again in the next TRANSACTION — not the next swap, not the next
///             call, the next transaction. EIP-1153 clears transient storage at the end of a
///             transaction, so two swaps in ONE transaction share it, and a hook that treats a
///             transient flag as "once per swap" is wrong in exactly that case.
/// @dev `beforeSwap` records what it found in the slot BEFORE writing, which is what makes the
///      leak-between-swaps-in-one-transaction case measurable instead of merely arguable.
contract TransientEchoProbe is BaseHook {
    /// @dev A fixed, human-checkable slot. Transient slots share no namespace with storage slots.
    uint256 internal constant SLOT = 0x1153;

    /// @notice Value the most recent `beforeSwap` wrote.
    uint256 public lastWritten;
    /// @notice Value `beforeSwap` found in the slot BEFORE it wrote — the leak detector.
    uint256 public lastSeenOnEntry;
    /// @notice Value the most recent `afterSwap` read back out of the slot.
    uint256 public lastEchoed;
    uint256 public beforeCalls;
    uint256 public afterCalls;

    /// @notice What the next `beforeSwap` will write. Never zero in a test, because zero is also
    ///         what an empty slot reads as, and a probe that writes zero cannot prove anything.
    uint256 public nextValue = 0xC0FFEE;

    constructor(IPoolManager _manager) BaseHook(_manager) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeSwap = true;
        p.afterSwap = true;
    }

    function setNextValue(uint256 v) external {
        nextValue = v;
    }

    /// @notice Reads the transient slot from an ordinary external call.
    /// @dev `view` and not `pure`: TLOAD reads state. This is the function a test calls in a LATER
    ///      transaction to prove the slot is empty; calling it in the SAME transaction proves the
    ///      opposite, and the difference between those two rows is the whole experiment.
    function peek() external view returns (uint256 v) {
        assembly ("memory-safe") {
            v := tload(SLOT)
        }
    }

    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        uint256 onEntry;
        uint256 v = nextValue;
        assembly ("memory-safe") {
            onEntry := tload(SLOT)
            tstore(SLOT, v)
        }
        lastSeenOnEntry = onEntry;
        lastWritten = v;
        beforeCalls++;
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        uint256 v;
        assembly ("memory-safe") {
            v := tload(SLOT)
        }
        lastEchoed = v;
        afterCalls++;
        return (BaseHook.afterSwap.selector, int128(0));
    }
}

/*//////////////////////////////////////////////////////////////////////////////////////////////////
                     B4 — WHAT A HOOK MAY CALL BACK INTO DURING A CALLBACK
//////////////////////////////////////////////////////////////////////////////////////////////////*/

/// @title ReentrancyProbe — calls one chosen PoolManager entry point from inside `beforeSwap`
/// @notice Two modes, because one mode cannot answer the question:
///         REPORT   — make the call, then revert carrying the exact outcome out through the
///                    PoolManager's ERC-7751 wrapper. Always tells the truth about the INNER call,
///                    including in the cases where the outer transaction was going to die anyway.
///         CONTINUE — make the call, swallow the outcome, let the swap proceed. Tells you whether
///                    the WHOLE transaction survives the re-entry, which is a different fact.
/// @dev A probe that only recorded outcomes to storage would silently lose every row whose outer
///      transaction reverts, because the storage write reverts with it — and those are precisely
///      the rows worth having. REPORT mode exists because of that.
contract ReentrancyProbe is BaseHook {
    enum Target {
        None,
        Unlock,
        Initialize,
        SwapSamePool,
        SwapOtherPool,
        ModifyLiquiditySamePool,
        DonateSamePool,
        TakeNative,
        SettleNative,
        SyncNative,
        ClearNative,
        MintClaims,
        BurnClaims,
        SetProtocolFee
    }

    enum Mode {
        Report,
        Continue
    }

    /// @notice The outcome of the inner call, carried out of the callback deliberately.
    /// @dev The PoolManager wraps this in ERC-7751's `WrappedError`, so a test reads it through the
    ///      repository's `HookRevertDecoder` exactly as it reads a real hook refusal.
    error Reentered(uint8 target, bool ok, bytes returnData);

    Target public target;
    Mode public mode;
    PoolKey internal selfKey;
    PoolKey internal otherKey;

    /// @notice CONTINUE-mode record. Only readable when the outer transaction survived.
    bool public lastOk;
    bytes public lastReturnData;
    uint256 public calls;

    constructor(IPoolManager _manager) BaseHook(_manager) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeSwap = true;
    }

    function configure(Target t, Mode m) external {
        target = t;
        mode = m;
    }

    function setKeys(PoolKey calldata self_, PoolKey calldata other_) external {
        selfKey = self_;
        otherKey = other_;
    }

    /// @dev `take` sends native currency here, so the probe must be able to hold it or the row
    ///      would fail for a reason that has nothing to do with the PoolManager's lock.
    receive() external payable {}

    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        calls++;
        if (target != Target.None) {
            (bool ok, bytes memory ret) = address(poolManager).call{value: 0}(_encode(target));
            if (mode == Mode.Report) revert Reentered(uint8(target), ok, ret);
            lastOk = ok;
            lastReturnData = ret;
        }
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev One call, one encoding, no dispatch cleverness. Every amount below is deliberately tiny:
    ///      the experiment is about what the lock permits, not about moving value.
    function _encode(Target t) internal view returns (bytes memory) {
        if (t == Target.Unlock) {
            return abi.encodeCall(IPoolManager.unlock, (hex""));
        }
        if (t == Target.Initialize) {
            // A pool this probe has nothing to do with: hookless, and a tick spacing no other pool
            // in the fixture uses, so a success here cannot be confused with touching an existing pool.
            PoolKey memory fresh = otherKey;
            fresh.tickSpacing = 61;
            return abi.encodeCall(IPoolManager.initialize, (fresh, 79228162514264337593543950336));
        }
        if (t == Target.SwapSamePool) {
            return abi.encodeCall(
                IPoolManager.swap,
                (selfKey, SwapParams({zeroForOne: true, amountSpecified: -1e6, sqrtPriceLimitX96: 4295128740}), hex"")
            );
        }
        if (t == Target.SwapOtherPool) {
            return abi.encodeCall(
                IPoolManager.swap,
                (otherKey, SwapParams({zeroForOne: true, amountSpecified: -1e6, sqrtPriceLimitX96: 4295128740}), hex"")
            );
        }
        if (t == Target.ModifyLiquiditySamePool) {
            return abi.encodeCall(
                IPoolManager.modifyLiquidity,
                (
                    selfKey,
                    ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: 1e12, salt: 0}),
                    hex""
                )
            );
        }
        if (t == Target.DonateSamePool) {
            return abi.encodeCall(IPoolManager.donate, (selfKey, 1, 1, hex""));
        }
        if (t == Target.TakeNative) {
            return abi.encodeCall(IPoolManager.take, (Currency.wrap(address(0)), address(this), 1));
        }
        if (t == Target.SettleNative) {
            return abi.encodeCall(IPoolManager.settle, ());
        }
        if (t == Target.SyncNative) {
            return abi.encodeCall(IPoolManager.sync, (Currency.wrap(address(0))));
        }
        if (t == Target.ClearNative) {
            return abi.encodeCall(IPoolManager.clear, (Currency.wrap(address(0)), 1));
        }
        if (t == Target.MintClaims) {
            return abi.encodeCall(IPoolManager.mint, (address(this), 0, 1));
        }
        if (t == Target.BurnClaims) {
            return abi.encodeCall(IPoolManager.burn, (address(this), 0, 1));
        }
        // Target.SetProtocolFee
        return abi.encodeCall(IProtocolFees.setProtocolFee, (selfKey, 100));
    }
}

/*//////////////////////////////////////////////////////////////////////////////////////////////////
                        B5 — WHAT SURVIVES OF A HOOK'S REVERT ON THE WAY OUT
//////////////////////////////////////////////////////////////////////////////////////////////////*/

/// @title RevertShapeProbe — fails, or returns garbage, in one chosen shape per swap
/// @notice Covers both halves of "what the caller sees": a hook that REVERTS (wrapped by the
///         PoolManager into ERC-7751's `WrappedError`) and a hook that RETURNS something the
///         PoolManager will not accept (rejected by the PoolManager with its OWN error, naming
///         itself and not the hook). Those two produce revert data of completely different shape,
///         and a suite that only ever provokes the first kind will be surprised by the second.
/// @dev The return-shaped cases use assembly `return`, which exits the external call frame
///      immediately and bypasses Solidity's ABI encoder — the only way to emit a return value that
///      the language would otherwise refuse to construct.
contract RevertShapeProbe is BaseHook {
    enum Shape {
        /// @dev The control. Returns exactly what the PoolManager expects.
        Valid,
        /// @dev `revert()` with no data.
        BareRevert,
        /// @dev A one-byte revert payload: too short to be a selector.
        OneByteRevert,
        /// @dev A three-byte revert payload: one byte short of a selector.
        ThreeByteRevert,
        /// @dev A custom error with no arguments.
        CustomNoArgs,
        /// @dev A custom error carrying arguments.
        CustomWithArgs,
        /// @dev `require(false, "...")` — an ABI-encoded `Error(string)`.
        RequireString,
        /// @dev A `Panic(uint256)` raised by the language, not by us: division by zero.
        LanguagePanic,
        /// @dev A very large revert payload. The v4 source calls this a revert data bomb, in a
        ///      comment, on the function that bubbles it. This shape is that comment, measured.
        RevertBomb,
        /// @dev Returns the right shape with the WRONG selector.
        WrongSelector,
        /// @dev Returns nothing at all.
        EmptyReturn,
        /// @dev Returns 31 bytes: one short of the selector word the PoolManager parses.
        ShortReturn
    }

    error ProbeRefusedNoArgs();
    error ProbeRefusedWithArgs(address who, uint256 code, bytes32 tag);

    Shape public shape;
    /// @notice Size in bytes of the `RevertBomb` payload.
    uint256 public bombBytes = 100_000;
    uint256 public calls;

    constructor(IPoolManager _manager) BaseHook(_manager) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeSwap = true;
    }

    function setShape(Shape s) external {
        shape = s;
    }

    function setBombBytes(uint256 n) external {
        bombBytes = n;
    }

    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        calls++;
        Shape s = shape;

        if (s == Shape.BareRevert) revert();
        if (s == Shape.CustomNoArgs) revert ProbeRefusedNoArgs();
        if (s == Shape.CustomWithArgs) revert ProbeRefusedWithArgs(address(this), 42, "limit-probe");
        if (s == Shape.RequireString) require(false, "RevertShapeProbe: refused by string");
        if (s == Shape.LanguagePanic) {
            uint256 zero = calls - calls; // opaque to the compiler's constant folding
            uint256 boom = 1 / zero; // Panic(0x12)
            return (bytes4(uint32(boom)), BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        if (s == Shape.OneByteRevert) {
            assembly ("memory-safe") {
                mstore(0, 0xff)
                revert(0, 1)
            }
        }
        if (s == Shape.ThreeByteRevert) {
            assembly ("memory-safe") {
                mstore(0, 0xffffff)
                revert(0, 3)
            }
        }
        if (s == Shape.RevertBomb) {
            uint256 n = bombBytes;
            bytes memory bomb = new bytes(n);
            assembly ("memory-safe") {
                revert(add(bomb, 0x20), n)
            }
        }
        if (s == Shape.WrongSelector) {
            // Right length, right layout, wrong first word.
            bytes memory ret = abi.encode(bytes32(bytes4(0xdeadbeef)), BeforeSwapDeltaLibrary.ZERO_DELTA, uint24(0));
            assembly ("memory-safe") {
                return(add(ret, 0x20), mload(ret))
            }
        }
        if (s == Shape.EmptyReturn) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        if (s == Shape.ShortReturn) {
            assembly ("memory-safe") {
                mstore(0, 0)
                return(0, 31)
            }
        }
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}
