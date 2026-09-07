// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {HookRevertDecoder} from "./HookRevertDecoder.sol";

/// @title The assertion every hook-refusal row in this suite uses
/// @notice One call, four claims: the outer error was ERC-7751's wrapper, the contract that
///         reverted was this hook, the callback that failed was this one, and the hook's own reason
///         was this error. A row that asserts fewer than four of those can pass for a reason it did
///         not intend, which is the defect this file exists to make impossible to write.
abstract contract HookRevertAsserts is Test {
    using HookRevertDecoder for HookRevertDecoder.Refusal;

    function assertHookRefusal(bytes memory err, address hook, bytes4 callback, bytes4 reason, string memory ctx)
        internal
    {
        HookRevertDecoder.Refusal memory r = HookRevertDecoder.decode(err);
        if (HookRevertDecoder.isRefusal(r, hook, callback, reason)) return;
        emit log_named_string("context           ", ctx);
        emit log_named_string("decoded as        ", HookRevertDecoder.kindName(r.kind));
        emit log_named_bytes32("outer selector    ", bytes32(r.outerSelector));
        emit log_named_address("reverting contract", r.target);
        emit log_named_address("  expected        ", hook);
        emit log_named_bytes32("failed callback   ", bytes32(r.callbackSelector));
        emit log_named_bytes32("  expected        ", bytes32(callback));
        emit log_named_bytes32("hook reason       ", bytes32(r.reasonSelector));
        emit log_named_bytes32("  expected        ", bytes32(reason));
        fail();
    }

    /// @dev For the rows that must NOT be a given refusal. Stated positively so the failure
    ///      message says what was wrong rather than that a boolean was false.
    function assertNotHookRefusal(bytes memory err, address hook, bytes4 callback, bytes4 reason, string memory ctx)
        internal
    {
        HookRevertDecoder.Refusal memory r = HookRevertDecoder.decode(err);
        if (!HookRevertDecoder.isRefusal(r, hook, callback, reason)) return;
        emit log_named_string("context", ctx);
        emit log_string("this revert data WAS accepted as the refusal it was supposed to be rejected as");
        fail();
    }

    function assertRefusalKind(bytes memory err, HookRevertDecoder.Kind expected, string memory ctx) internal {
        HookRevertDecoder.Refusal memory r = HookRevertDecoder.decode(err);
        if (r.kind == expected) return;
        emit log_named_string("context ", ctx);
        emit log_named_string("expected", HookRevertDecoder.kindName(expected));
        emit log_named_string("got     ", HookRevertDecoder.kindName(r.kind));
        fail();
    }
}
