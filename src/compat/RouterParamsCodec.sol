// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";

/// @title RouterParamsCodec, one settlement input encoded for either Universal Router build
/// @notice A Universal Router built from v4-periphery before commit `03b2d09` (2026-03-17) decodes
///         `SWAP_EXACT_IN_SINGLE` parameters as five fields; a router built at or after that commit
///         decodes six, with `minHopPriceX36` inserted between `amountOutMinimum` and `hookData`.
///         The two encodings are not interchangeable and the difference is invisible in the ABI:
///         nothing on either router says which one it is. This library encodes both from one input,
///         so a caller decides the layout once, from a probe or from operator configuration, instead
///         of being pinned to whichever periphery commit its build happened to vendor.
///
///         WHY THIS IS NOT COSMETIC. A decoder reads the head word by word and takes ONE word as the
///         offset of the dynamic tail: word 8 under the legacy layout, word 9 under the per-hop
///         layout, because `minHopPriceX36` took word 8. Feed one layout to the other decoder and the
///         word read as an offset is a value from a different field entirely, so the tail is read from
///         the wrong place. What happens next depends on what that word happens to hold, and BOTH
///         outcomes are bad in different ways:
///
///         - The word points past the end of the calldata. The call reverts with EMPTY revert data
///           from inside the router's own `unlockCallback`, before anything reaches the PoolManager.
///           This is the loud failure, and it is the one `docs/feedback/uniswap/robinhood.md` records:
///           a five-field call, carrying a `bytes32` order id, refused by a six-field router.
///         - The word is ZERO. The offset points back at the head's first word, `currency0`, which the
///           decoder then reads as a LENGTH — and on a native-input pool `currency0` is the zero
///           address. Length zero. The decoder sees empty hook data, and the swap SUCCEEDS with the
///           hook data thrown away.
///
///         The second case is measured, not theorised: `test/compat/SepoliaRouterControl.t.sol` row 2
///         drives the SIX-field encoding through the listed five-field Sepolia router on a native pool
///         and the merchant is paid while the hook receives zero bytes. `minHopPriceX36` is zero for
///         any single-hop settlement, so that is the ordinary case, not a corner of it.
///
///         For UNICA the quiet failure is contained, and not by luck in the router: the settlement
///         hook requires exactly one `bytes32` of hook data (spec C1) and refuses a swap without it,
///         so a dropped order id becomes a refusal rather than a payment with no receipt. An
///         integrator whose hook data is optional has no such backstop. That asymmetry is the reason
///         this library refuses to guess a layout, and the reason `RouterProbe` measures one.
///
///         Measured, not assumed, in both directions: `test/compat/` drives the listed Sepolia router
///         as the control and an upgraded router on chain 46630 as the subject.
///
/// @dev Pure. No storage, no external calls, nothing to configure, nothing to own. The legacy branch
///      is encoded through this repository's pinned periphery type rather than by hand, so if that pin
///      ever moves the compiler — not a test — is the first thing to notice.
library RouterParamsCodec {
    /// @notice Which `ExactInputSingleParams` layout a router expects.
    /// @dev `Unknown` is the zero value on purpose: a caller that forgets to set it fails closed in
    ///      `encode`, rather than defaulting to one of the two and being wrong half the time.
    enum Layout {
        Unknown,
        Legacy,
        PerHop
    }

    /// @notice One settlement's swap, in the fields the caller actually has, superset of both layouts.
    /// @param poolKey The pool being swapped through. Five static words under both layouts.
    /// @param zeroForOne Direction. UNICA settlements are native in, payout out, so true.
    /// @param amountIn Exact input. `ActionConstants.OPEN_DELTA` means "whatever is owed", as ever.
    /// @param amountOutMinimum The floor on the whole swap's output. Both layouts carry this.
    /// @param minHopPriceX36 The PER-HOP floor, added by v4-periphery commit `03b2d09`
    ///        ("feat: add per-hop slippage to single swaps and flip to output/input ratio", #516,
    ///        2026-03-17). Zero means no per-hop floor, which is the behaviour a legacy router has
    ///        because it has no such field. For a single-hop swap the whole-swap minimum above is
    ///        already the binding constraint, which is why UNICA's own settlements pass zero here.
    ///        The exact fixed-point scaling of a NON-ZERO value is the one thing this library does not
    ///        claim: it is taken from the field's name and that commit title, and this repository does
    ///        not vendor a periphery that defines it, so nothing here has compiled against it. That is
    ///        also why `encodeLegacy` refuses a non-zero value instead of dropping it (see below).
    /// @param hookData The bytes handed to the pool's hook. For UNICA this is one `bytes32` order id,
    ///        and it is never empty, which is exactly why the layout mismatch is a total refusal here.
    struct SwapExactInSingle {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36;
        bytes hookData;
    }

    /// @notice `encode` was called with `Layout.Unknown`. There is no safe default to pick.
    error UnknownLayout();
    /// @notice A per-hop price floor was asked for, and the legacy layout has nowhere to put it.
    /// @dev Fail closed and loud. Encoding it away would send a swap with LESS slippage protection than
    ///      the caller asked for, and it would succeed, which is the worst shape a money bug can take.
    ///      A caller that genuinely wants no per-hop floor passes zero and this never fires.
    error LegacyLayoutCannotCarryMinHopPrice(uint256 minHopPriceX36);

    /// @dev Head words before the dynamic tail: 5 for the pool key, then `zeroForOne`, `amountIn`,
    ///      `amountOutMinimum`, then the `hookData` offset.
    uint256 internal constant LEGACY_HEAD_WORDS = 9;
    /// @dev The same, plus `minHopPriceX36` ahead of the offset.
    uint256 internal constant PER_HOP_HEAD_WORDS = 10;
    /// @dev Where `minHopPriceX36` sits in the per-hop head, and where the legacy layout keeps the
    ///      `hookData` offset instead. This single number is the whole incompatibility.
    uint256 internal constant MIN_HOP_PRICE_WORD_INDEX = 8;

    /// @notice Encodes one swap for the named layout, ready to be dropped into `params[0]` of a
    ///         `V4_SWAP` command's `SWAP_EXACT_IN_SINGLE` action.
    function encode(Layout layout, SwapExactInSingle memory p) internal pure returns (bytes memory) {
        if (layout == Layout.Legacy) return encodeLegacy(p);
        if (layout == Layout.PerHop) return encodePerHop(p);
        revert UnknownLayout();
    }

    /// @notice The five-field encoding: what this repository's pinned v4-periphery (`7ebd04b`) defines
    ///         and what the Universal Router listed for Ethereum Sepolia accepts.
    /// @dev Built from `IV4Router.ExactInputSingleParams` itself rather than word by word. That is
    ///      deliberate: this branch's correctness is then the compiler's problem, and the day the pin
    ///      moves past `03b2d09` this function stops compiling instead of silently changing shape.
    function encodeLegacy(SwapExactInSingle memory p) internal pure returns (bytes memory) {
        if (p.minHopPriceX36 != 0) revert LegacyLayoutCannotCarryMinHopPrice(p.minHopPriceX36);
        return abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: p.poolKey,
                zeroForOne: p.zeroForOne,
                amountIn: p.amountIn,
                amountOutMinimum: p.amountOutMinimum,
                hookData: p.hookData
            })
        );
    }

    /// @notice The six-field encoding: what a Universal Router built from v4-periphery at or after
    ///         commit `03b2d09` expects.
    /// @dev Written by hand because this repository cannot import the type — the pinned periphery
    ///      predates the field. The bytes are still ordinary ABI: `abi.encode` of the members in order
    ///      produces exactly the struct's tuple encoding (head then tail, the `hookData` offset
    ///      measured from the head's first word), and a top-level dynamic struct is that tuple behind
    ///      one offset word of `0x20`. `test/compat/RouterParamsCodec.t.sol` decodes these bytes back
    ///      into a six-field struct field for field rather than trusting the paragraph you just read.
    function encodePerHop(SwapExactInSingle memory p) internal pure returns (bytes memory) {
        bytes memory tuple =
            abi.encode(p.poolKey, p.zeroForOne, p.amountIn, p.amountOutMinimum, p.minHopPriceX36, p.hookData);
        return abi.encodePacked(uint256(0x20), tuple);
    }

    /// @notice The other layout. `Unknown` maps to itself, because the opposite of nothing is nothing.
    /// @dev Used by the probe to test both directions and by a caller that wants to say "not that one".
    function other(Layout layout) internal pure returns (Layout) {
        if (layout == Layout.Legacy) return Layout.PerHop;
        if (layout == Layout.PerHop) return Layout.Legacy;
        return Layout.Unknown;
    }

    /// @notice A human-readable name, for a script or a revert string. Never parsed by anything here.
    function name(Layout layout) internal pure returns (string memory) {
        if (layout == Layout.Legacy) return "legacy (five fields, v4-periphery before 03b2d09)";
        if (layout == Layout.PerHop) return "per-hop (six fields, v4-periphery 03b2d09 or later)";
        return "unknown";
    }
}
