// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title HookRevertDecoder — the one place in this suite that reads a v4 hook refusal
/// @notice A hook's error never reaches the caller unchanged. `Hooks.callHook` bubbles it through
///         `CustomRevert.bubbleUpAndRevertWith`, which re-reverts with ERC-7751's
///         `WrappedError(address target, bytes4 selector, bytes reason, bytes details)` — the hook
///         address, the CALLBACK that failed, the hook's own revert data, and `HookCallFailed` as
///         context. So `bytes4(err)` is `0x90bfb865` for every refusal this hook can make, and a
///         suite that reads it learns only that something, somewhere, said no.
///
///         This decoder exists because of a measured failure in this repository: a sabotage run
///         deleted the no-live-invoice guard from BOTH callbacks and every row stayed green, because
///         each row asserted only that the call reverted. Asserting a nested selector alone is not
///         enough either — the same selector raised by a different contract, or under a different
///         callback, is a different event and must not satisfy the same assertion.
///
/// @dev Deliberately parses by hand rather than calling `abi.decode`. `abi.decode` reverts on
///      malformed input, and "the wrapper did not parse" is one of the six outcomes this decoder
///      has to be able to REPORT rather than die on.
library HookRevertDecoder {
    /// @dev Derived from the signature rather than pasted as a literal, so a change to the shape
    ///      shows up as a compile-time text change and not as a magic number nobody can check.
    bytes4 internal constant WRAPPED_ERROR_SELECTOR = bytes4(keccak256("WrappedError(address,bytes4,bytes,bytes)"));

    /// @notice The six things a failed swap's revert data can be. Every one of them is a different
    ///         claim about what happened, and collapsing any two of them hides a defect.
    enum Kind {
        /// @dev Zero bytes. A bare `revert()`, an out-of-gas, or a call into an address with no code.
        Empty,
        /// @dev One to three bytes: too short to carry a selector at all.
        Truncated,
        /// @dev A custom error that was never wrapped: the router, the PoolManager, or a test double.
        Direct,
        /// @dev A well-formed ERC-7751 wrapper carrying a reason long enough to hold a selector.
        Wrapped,
        /// @dev A well-formed wrapper whose reason is shorter than a selector — a hook that
        ///      reverted with no data, or with a string too short to identify.
        WrappedEmptyReason,
        /// @dev Claims the wrapper selector and does not decode as one. Truncated in transit,
        ///      hand-built wrongly, or produced by something imitating the shape.
        Malformed
    }

    struct Refusal {
        Kind kind;
        /// @dev Always the first four bytes when there are four. For a wrapper this is
        ///      `WRAPPED_ERROR_SELECTOR`; for anything else it is the error that actually spoke.
        bytes4 outerSelector;
        /// @dev The contract the PoolManager called and that reverted. Zero unless `Wrapped`.
        address target;
        /// @dev Which callback failed — `IHooks.beforeSwap.selector`, `afterSwap`, and so on. Zero
        ///      unless `Wrapped`. This is the field that separates "the hook refused admission"
        ///      from "the hook refused the fill", which are different guards with different tests.
        bytes4 callbackSelector;
        /// @dev The hook's own error selector. Zero unless `Wrapped`.
        bytes4 reasonSelector;
        /// @dev Length of the reason payload, so a caller can tell an argument-carrying error from
        ///      a bare one without decoding it.
        uint256 reasonLength;
        /// @dev Index of the first byte AFTER the reason. Everything a refusal is identified by
        ///      lives below this offset, so a payload cut at or after it still identifies the same
        ///      refusal — measured in the truncation sweep, not assumed. Zero unless the wrapper
        ///      parsed far enough to know.
        uint256 reasonEnd;
    }

    function decode(bytes memory err) internal pure returns (Refusal memory r) {
        if (err.length == 0) return r; // Kind.Empty is the zero value, and that is deliberate
        if (err.length < 4) {
            r.kind = Kind.Truncated;
            return r;
        }

        r.outerSelector = _selectorAt(err, 0);
        if (r.outerSelector != WRAPPED_ERROR_SELECTOR) {
            r.kind = Kind.Direct;
            return r;
        }

        // Past this point the payload CLAIMS to be a wrapper. Every read below is bounds-checked
        // against the actual length, and any read that would run off the end is `Malformed`.
        // Head: target | callback selector | offset(reason) | offset(details) — four words.
        uint256 base = 4;
        if (err.length < base + 0x80) {
            r.kind = Kind.Malformed;
            return r;
        }

        uint256 offsetReason = _wordAt(err, base + 0x40);
        // An offset large enough to overflow the addition below is malformed by construction, and
        // checking it here means the arithmetic that follows cannot wrap.
        if (offsetReason > err.length) {
            r.kind = Kind.Malformed;
            return r;
        }
        uint256 reasonAt = base + offsetReason;
        if (reasonAt + 0x20 > err.length) {
            r.kind = Kind.Malformed;
            return r;
        }
        uint256 reasonLength = _wordAt(err, reasonAt);
        if (reasonLength > err.length || reasonAt + 0x20 + reasonLength > err.length) {
            r.kind = Kind.Malformed;
            return r;
        }

        r.target = address(uint160(_wordAt(err, base)));
        r.callbackSelector = bytes4(bytes32(_wordAt(err, base + 0x20)));
        r.reasonLength = reasonLength;
        r.reasonEnd = reasonAt + 0x20 + reasonLength;

        if (reasonLength < 4) {
            r.kind = Kind.WrappedEmptyReason;
            return r;
        }
        r.reasonSelector = _selectorAt(err, reasonAt + 0x20);
        r.kind = Kind.Wrapped;
    }

    /// @notice The whole assertion, in one call: a wrapped refusal, from THIS hook, under THIS
    ///         callback, for THIS reason. Anything less is a different event.
    /// @dev Never search revert data for a selector. A nested selector that appears anywhere in a
    ///      blob is not evidence that the blob is the refusal you meant to provoke.
    function isRefusal(Refusal memory r, address target, bytes4 callback, bytes4 reason) internal pure returns (bool) {
        return
            r.kind == Kind.Wrapped && r.target == target && r.callbackSelector == callback && r.reasonSelector == reason;
    }

    function kindName(Kind k) internal pure returns (string memory) {
        if (k == Kind.Empty) return "Empty";
        if (k == Kind.Truncated) return "Truncated";
        if (k == Kind.Direct) return "Direct";
        if (k == Kind.Wrapped) return "Wrapped";
        if (k == Kind.WrappedEmptyReason) return "WrappedEmptyReason";
        return "Malformed";
    }

    /// @dev Byte-at-a-time so Solidity's own bounds check on `bytes` indexing does the work. A
    ///      32-byte `mload` near the end of the buffer would read whatever memory follows it.
    function _selectorAt(bytes memory b, uint256 at) private pure returns (bytes4) {
        return bytes4(
            uint32(uint8(b[at])) << 24 | uint32(uint8(b[at + 1])) << 16 | uint32(uint8(b[at + 2])) << 8
                | uint32(uint8(b[at + 3]))
        );
    }

    /// @dev Callers MUST have established `at + 32 <= b.length` before calling this.
    function _wordAt(bytes memory b, uint256 at) private pure returns (uint256 w) {
        assembly ("memory-safe") {
            w := mload(add(add(b, 0x20), at))
        }
    }
}
