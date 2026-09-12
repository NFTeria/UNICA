// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// LOCAL ENSv2-COMPATIBLE FIXTURE for Anvil integration tests. Not the isolated ENSv2 Sepolia
// deployment; mirrors its measured Enhanced Access Control shape (per-key text resources, role
// bitmaps, admin bits at +128) so the order-admission path can be tested end to end without a
// network. Pinned Sepolia configuration lives in integrations/ensv2/profile.mjs.

import {IUnicaPolicyReceiver} from "../../../src/unica-v4/policy/IUnicaPolicyReceiver.sol";

/// @title PolicyDouble
/// @notice A test double for `IUnicaPolicyReceiver`: `isAdmitted` always returns a single
///         settable answer, regardless of the terms it is asked about, so
///         `TerminalAdmission`'s optional policy gate can be exercised both ways
///         (`setAdmitted(false)` / `setAdmitted(true)`) without modelling a real confidential
///         report.
contract PolicyDouble is IUnicaPolicyReceiver {
    bool public answer;

    address public immutable FORWARDER;
    address public immutable REGISTRY;
    bytes32 public immutable UNICA_RELEASE;
    bytes32 public immutable WORKFLOW_ID;
    address public immutable WORKFLOW_OWNER;
    uint8 public immutable REPORT_SCHEMA_VERSION;

    constructor() {
        FORWARDER = address(0);
        REGISTRY = address(0);
        UNICA_RELEASE = bytes32(0);
        WORKFLOW_ID = bytes32(0);
        WORKFLOW_OWNER = address(0);
        REPORT_SCHEMA_VERSION = 1;
    }

    function setAdmitted(bool value) external {
        answer = value;
    }

    function admissionOf(bytes32) external pure returns (Admission memory) {
        return Admission({
            marketId: bytes32(0),
            marketVersion: 0,
            merchant: address(0),
            payer: address(0),
            inputAsset: address(0),
            outputAsset: address(0),
            exactInput: false,
            inputAmount: 0,
            minOutput: 0,
            quoteExpiry: 0,
            policyExpiry: 0,
            terminalNode: bytes32(0),
            terminalStatusSnapshot: bytes32(0),
            ensDeploymentId: bytes32(0),
            policyVersionHash: bytes32(0),
            privateInputCommitment: bytes32(0),
            workflowId: bytes32(0),
            workflowOwner: address(0),
            workflowVersion: bytes32(0),
            reportHash: bytes32(0),
            recordedAt: 0,
            exists: false
        });
    }

    function isAdmitted(bytes32, bytes32, address, address, address, address, uint256, uint128, bytes32)
        external
        view
        returns (bool)
    {
        return answer;
    }
}
