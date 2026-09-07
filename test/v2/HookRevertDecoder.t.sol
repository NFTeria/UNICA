// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {HookRevertDecoder} from "./util/HookRevertDecoder.sol";
import {HookRevertAsserts} from "./util/HookRevertAsserts.sol";

/// @dev Two shapes of failure a hook can produce: one carrying an argument, one carrying nothing.
contract Reverter {
    error Boom(uint256 x);
    error Different();

    function boom() external pure {
        revert Boom(7);
    }

    function different() external pure {
        revert Different();
    }

    function silent() external pure {
        revert();
    }
}

/// @dev Produces a GENUINE ERC-7751 wrapper by calling v4-core's own `bubbleUpAndRevertWith`, so
///      the decoder is tested against the encoder that will actually be on the other side of it.
///      A hand-written fixture would only ever test my model of the encoding.
contract Bubbler {
    function callAndBubble(address target, bytes memory data, bytes4 callbackSelector) external {
        (bool ok,) = target.call(data);
        if (!ok) CustomRevert.bubbleUpAndRevertWith(target, callbackSelector, bytes4(0xDEADBEEF));
        revert("expected the inner call to fail");
    }
}

/// @title Self-tests for the hook-refusal decoder
/// @notice The decoder is the instrument every other V2 row reads its result from, so it is
///         validated before it is trusted: it must ACCEPT the genuine article and REJECT five
///         near-misses. A decoder that only ever says yes turns a suite of assertions into a suite
///         of hopes — which is what this repository already measured once, when a sabotage deleted
///         a guard from both callbacks and every row stayed green.
contract HookRevertDecoderSelfTest is HookRevertAsserts {
    Reverter internal reverter;
    Bubbler internal bubbler;

    address internal constant OTHER_CONTRACT = address(0xDEAD);

    function setUp() public {
        reverter = new Reverter();
        bubbler = new Bubbler();
    }

    // ---- it accepts the genuine article --------------------------------------------------

    function test_Decoder_ReadsAGenuineWrappedHookRevert() public {
        bytes memory err = _bubble(abi.encodeCall(Reverter.boom, ()), IHooks.beforeSwap.selector);

        HookRevertDecoder.Refusal memory r = HookRevertDecoder.decode(err);
        assertTrue(r.kind == HookRevertDecoder.Kind.Wrapped, "a real wrapper did not decode as Wrapped");
        assertEq(r.target, address(reverter), "the reverting contract was misread");
        assertEq(r.callbackSelector, IHooks.beforeSwap.selector, "the failed callback was misread");
        assertEq(r.reasonSelector, Reverter.Boom.selector, "the hook's own reason was misread");
        assertEq(r.reasonLength, 36, "an error carrying one uint256 is 4 + 32 bytes");
        assertEq(r.outerSelector, HookRevertDecoder.WRAPPED_ERROR_SELECTOR, "outer selector is not WrappedError");

        assertHookRefusal(err, address(reverter), IHooks.beforeSwap.selector, Reverter.Boom.selector, "genuine");
    }

    // ---- the five rejections, which are what make it an instrument -----------------------

    /// @dev The right reason under the wrong callback. `beforeSwap` refusing admission and
    ///      `afterSwap` refusing the fill are different guards; a decoder that cannot tell them
    ///      apart lets a test for one be satisfied by the other.
    function test_Decoder_RejectsTheRightReasonUnderTheWrongCallback() public {
        bytes memory err = _bubble(abi.encodeCall(Reverter.boom, ()), IHooks.afterSwap.selector);
        assertNotHookRefusal(
            err, address(reverter), IHooks.beforeSwap.selector, Reverter.Boom.selector, "wrong callback"
        );
        assertHookRefusal(
            err, address(reverter), IHooks.afterSwap.selector, Reverter.Boom.selector, "and right under its own"
        );
    }

    /// @dev The right reason from the wrong contract. Any contract may declare an error with the
    ///      same name and therefore the same selector; only the target says whose refusal it was.
    function test_Decoder_RejectsTheRightReasonFromTheWrongTarget() public {
        bytes memory err = _bubble(abi.encodeCall(Reverter.boom, ()), IHooks.beforeSwap.selector);
        assertNotHookRefusal(err, OTHER_CONTRACT, IHooks.beforeSwap.selector, Reverter.Boom.selector, "wrong target");
    }

    /// @dev A wrapper cut short. This row was written expecting EVERY truncation to be malformed
    ///      and it failed, correctly: ERC-7751 puts `details` last, and a payload cut anywhere
    ///      inside that trailing field still carries an intact target, callback and reason. The
    ///      fact is recorded rather than papered over, and the sweep now asserts the real
    ///      partition — including that the decoder never flips back to readable once the cut has
    ///      reached the reason, which is the property that would let a mangled payload masquerade
    ///      as a refusal.
    function test_Decoder_RejectsATruncationThatReachesTheReason() public {
        bytes memory full = _bubble(abi.encodeCall(Reverter.boom, ()), IHooks.beforeSwap.selector);
        uint256 boundary = HookRevertDecoder.decode(full).reasonEnd;
        assertGt(boundary, 0, "the full payload did not parse, so the sweep would prove nothing");
        assertLt(boundary, full.length, "this payload has no trailing details, so there is nothing to sweep");

        uint256 stillReadable;
        uint256 malformed;
        bool everReadableAfterMalformed;
        bool seenMalformed;

        for (uint256 len = full.length; len >= 4; len--) {
            bytes memory cut = _head(full, len);
            HookRevertDecoder.Refusal memory r = HookRevertDecoder.decode(cut);

            if (r.kind == HookRevertDecoder.Kind.Wrapped) {
                stillReadable++;
                if (seenMalformed) everReadableAfterMalformed = true;
                assertGe(len, boundary, "a payload shorter than its own reason decoded as readable");
                assertHookRefusal(
                    cut,
                    address(reverter),
                    IHooks.beforeSwap.selector,
                    Reverter.Boom.selector,
                    "a cut above the reason must still identify the same refusal"
                );
            } else {
                seenMalformed = true;
                malformed++;
                assertTrue(r.kind == HookRevertDecoder.Kind.Malformed, "a damaged wrapper decoded as something else");
                assertLt(len, boundary, "a payload carrying its whole reason was called malformed");
                assertNotHookRefusal(
                    cut, address(reverter), IHooks.beforeSwap.selector, Reverter.Boom.selector, "damaged wrapper"
                );
            }
        }

        assertFalse(everReadableAfterMalformed, "the decoder recovered after the reason was damaged");
        emit log_named_uint("payload bytes                 ", full.length);
        emit log_named_uint("bytes needed to identify it   ", boundary);
        emit log_named_uint("cuts still identifying it     ", stillReadable);
        emit log_named_uint("cuts reported malformed       ", malformed);
        assertGt(stillReadable, 0, "no cut survived; the trailing-details finding is not reproduced");
        assertGt(malformed, 0, "no cut was rejected; this sweep proves nothing");
    }

    /// @dev An error that was never a wrapper at all: the router, the PoolManager, or a test
    ///      double failing on its own account.
    function test_Decoder_RejectsAnUnrelatedOuterRevert() public {
        bytes memory err = abi.encodeWithSelector(Reverter.Boom.selector, uint256(7));
        assertRefusalKind(err, HookRevertDecoder.Kind.Direct, "an unwrapped custom error");

        HookRevertDecoder.Refusal memory r = HookRevertDecoder.decode(err);
        assertEq(r.outerSelector, Reverter.Boom.selector, "the direct selector should still be readable");
        assertEq(r.target, address(0), "a direct error names no target");
        assertNotHookRefusal(err, address(reverter), IHooks.beforeSwap.selector, Reverter.Boom.selector, "unwrapped");
    }

    /// @dev A different nested error from the right contract under the right callback. This is the
    ///      case the whole guard matrix depends on: one guard's refusal must never satisfy
    ///      another guard's row.
    function test_Decoder_RejectsADifferentNestedError() public {
        bytes memory err = _bubble(abi.encodeCall(Reverter.different, ()), IHooks.beforeSwap.selector);
        assertNotHookRefusal(
            err, address(reverter), IHooks.beforeSwap.selector, Reverter.Boom.selector, "different nested error"
        );
        assertHookRefusal(
            err, address(reverter), IHooks.beforeSwap.selector, Reverter.Different.selector, "and right for its own"
        );
    }

    // ---- the remaining kinds, so every branch of the enum is reachable and named ----------

    function test_Decoder_ReadsAnEmptyRevert() public {
        assertRefusalKind("", HookRevertDecoder.Kind.Empty, "zero bytes");
    }

    function test_Decoder_ReadsATruncatedSelector() public {
        assertRefusalKind(hex"90bf", HookRevertDecoder.Kind.Truncated, "two bytes cannot carry a selector");
    }

    /// @dev A hook that reverts with no data at all still produces a well-formed wrapper — with an
    ///      empty reason. It is a refusal whose reason is unknowable, and saying so is the point.
    function test_Decoder_ReadsAWrapperWithNoReason() public {
        bytes memory err = _bubble(abi.encodeCall(Reverter.silent, ()), IHooks.beforeSwap.selector);
        assertRefusalKind(err, HookRevertDecoder.Kind.WrappedEmptyReason, "a hook that reverted silently");

        HookRevertDecoder.Refusal memory r = HookRevertDecoder.decode(err);
        assertEq(r.target, address(reverter), "the target is still readable without a reason");
        assertEq(r.reasonLength, 0, "there was no reason to read");
        assertEq(r.reasonSelector, bytes4(0), "a reason selector must not be invented");

        // And it satisfies NO refusal assertion — not even one naming the zero selector, which is
        // what the decoded fields literally hold. Added because a sabotage that deleted the
        // `kind == Wrapped` test from `isRefusal` turned no row red: without this line the kind
        // was decoration. A hook that reverts with no data has refused for a reason nobody can
        // name, and no row is allowed to claim otherwise.
        assertNotHookRefusal(err, address(reverter), IHooks.beforeSwap.selector, bytes4(0), "a silent hook revert");
    }

    /// @dev A payload wearing the wrapper's selector with a nonsense offset. It must be reported,
    ///      not decoded and not fatal — this is the shape a revert-data bomb or a hostile imitator
    ///      would take.
    function test_Decoder_RejectsAWrapperWithAnImpossibleOffset() public {
        bytes memory err = abi.encodePacked(
            HookRevertDecoder.WRAPPED_ERROR_SELECTOR,
            bytes32(uint256(uint160(address(reverter)))),
            bytes32(IHooks.beforeSwap.selector),
            bytes32(type(uint256).max), // offset to the reason: off the end of the universe
            bytes32(uint256(0x100)),
            bytes32(uint256(4)),
            bytes32(Reverter.Boom.selector)
        );
        assertRefusalKind(err, HookRevertDecoder.Kind.Malformed, "an offset past the end of the payload");
        assertNotHookRefusal(
            err, address(reverter), IHooks.beforeSwap.selector, Reverter.Boom.selector, "impossible offset"
        );
    }

    /// @dev The selector is derived from the signature in the library; pinned here against the
    ///      value v4-core's own library declares, so a divergence is a test failure and not a
    ///      silent mismatch.
    function test_Decoder_TheWrapperSelectorMatchesV4Core() public pure {
        assertEq(
            HookRevertDecoder.WRAPPED_ERROR_SELECTOR,
            CustomRevert.WrappedError.selector,
            "this suite and v4-core disagree about what a wrapped error is"
        );
    }

    // ---- plumbing ------------------------------------------------------------------------

    function _bubble(bytes memory innerCall, bytes4 callbackSelector) internal returns (bytes memory) {
        try bubbler.callAndBubble(address(reverter), innerCall, callbackSelector) {
            revert("the bubbler was supposed to revert");
        } catch (bytes memory err) {
            return err;
        }
    }

    function _head(bytes memory b, uint256 len) internal pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            out[i] = b[i];
        }
    }
}
