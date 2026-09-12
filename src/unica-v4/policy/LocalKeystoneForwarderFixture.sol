// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice LOCAL CRE REPORT FIXTURE — NOT A DON REPORT. A local stand-in for the one mechanic of
///         Chainlink's `KeystoneForwarder`/`MockKeystoneForwarder` that this repository's tests
///         depend on: `docs/unica-v5/chainlink/RECEIVER.md` §7, verified there against Chainlink's
///         own primary source, shows that a real forwarder's `route()` calls a receiver through a
///         raw, non-reverting `call()` and always emits `ReportProcessed` with that call's own
///         success boolean — so a mined, status-1 transaction can still mean "the receiver rejected
///         this." This contract reproduces exactly that isolation behavior, freshly written from the
///         description in RECEIVER.md §7, never from Chainlink's `KeystoneForwarder.sol` source
///         (never opened by this file or its author). It is not a `KeystoneForwarder`, not a
///         `MockKeystoneForwarder`, and not wired to any DON, workflow, or signature check of any
///         kind: `route()` below is permissionless and performs none of the checks a real forwarder
///         performs before it ever reaches this point (config lookup, signature threshold, per-
///         transmission dedup). It exists only so a receiver's own accept/reject logic can be tested
///         against the one property that matters for "was this actually delivered": that a receiver
///         failure never reverts the routing call, and is instead visible only in `ReportProcessed`'s
///         own boolean and the receiver's own state.
contract LocalKeystoneForwarderFixture {
    /// @notice Mirrors the real forwarder's own event shape (RECEIVER.md §7, D1/D2), reproduced here
    ///         as a signature only — `workflowExecutionId` and `reportId` are computed locally by
    ///         this fixture, not read from any real Keystone envelope.
    event ReportProcessed(
        address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result
    );

    constructor() {}

    /// @notice LOCAL CRE REPORT FIXTURE — NOT A DON REPORT.
    function typeAndVersion() external pure returns (string memory) {
        return "LocalKeystoneForwarderFixture 0.1.0 \xe2\x80\x94 LOCAL CRE REPORT FIXTURE \xe2\x80\x94 NOT A DON REPORT";
    }

    /// @notice Routes `report` to `receiver.onReport(metadata, report)` through a raw low-level
    ///         call. Never reverts on the receiver's behalf: whatever `onReport` does — accept,
    ///         revert with a custom error, or run out of gas — is captured only in `success` and in
    ///         `ReportProcessed`'s own `result` field, exactly as RECEIVER.md §7 describes for a real
    ///         forwarder. This function performs no validation of `metadata`, `report`, or `receiver`
    ///         of its own; it is a router, not a verifier.
    function route(address receiver, bytes calldata metadata, bytes calldata report) external returns (bool success) {
        bytes32 workflowExecutionId = keccak256(abi.encode(metadata, report));
        bytes2 reportId = _reportIdFromMetadata(metadata);

        (success,) = receiver.call(abi.encodeWithSignature("onReport(bytes,bytes)", metadata, report));

        emit ReportProcessed(receiver, workflowExecutionId, reportId, success);
    }

    /// @dev `reportId` is bytes 62-63 of a well-formed 64-byte metadata argument (RECEIVER.md §5
    ///      step 3). A shorter, malformed `metadata` — itself one of the conditions this fixture's
    ///      tests exercise against the receiver — has no such bytes; this fixture never reverts to
    ///      compute an event field, so it reports a zero `reportId` in that case instead.
    function _reportIdFromMetadata(bytes calldata metadata) private pure returns (bytes2) {
        if (metadata.length < 64) return bytes2(0);
        (, bytes32 tail) = abi.decode(metadata, (bytes32, bytes32));
        return bytes2(uint16(uint256(tail)));
    }
}
