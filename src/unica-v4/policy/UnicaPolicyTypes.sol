// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice LOCAL CRE REPORT FIXTURE — NOT A DON REPORT. The one canonical shape of a UNICA v5
///         settlement-admission report (docs/unica-v5/chainlink/REPORT-SCHEMA.md §4), written fresh
///         from that document, never from any Chainlink source file. `UnicaPolicyReceiver` decodes
///         this struct out of a report's bytes; `LocalCreReportFixture` encodes it for tests and the
///         local Anvil demo script. Neither file redefines it — this is the single definition both
///         import.
/// @dev REPORT-SCHEMA.md §4 leaves two fields UNKNOWN in type: `ensDeploymentId` (row 19, pending
///      the ENS sibling stream's own encoding) and `workflowVersion` (row 24, pending an owner
///      decision between Chainlink's own workflow hash and a UNICA-side counter). This file resolves
///      both as `bytes32` — a local implementation choice recorded here, not a value taken from any
///      other document. Nothing in this file is a DON report, a CRE deployment, or a Keystone
///      forwarder.
library UnicaPolicyTypes {
    /// @notice Fields 1-25 of REPORT-SCHEMA.md §4, in the document's own order. Field 26
    ///         (`domainSeparator`) is derived, never decoded, and so is never a struct member here —
    ///         `LocalCreReportFixture.digest` computes it fresh from these 25 fields every time.
    struct AdmissionReport {
        uint256 chainId;
        address verifyingContract;
        bytes32 unicaRelease;
        address registry;
        bytes32 marketId;
        uint32 marketVersion;
        address merchant;
        address payer;
        address inputAsset;
        address outputAsset;
        bool exactInput;
        uint256 inputAmount;
        uint128 minOutput;
        bytes32 orderNonce;
        uint64 quoteExpiry;
        uint64 policyExpiry;
        bytes32 terminalNode;
        bytes32 terminalStatusSnapshot;
        bytes32 ensDeploymentId;
        bytes32 policyVersionHash;
        bytes32 privateInputCommitment;
        bytes32 workflowId;
        address workflowOwner;
        bytes32 workflowVersion;
        address receiver;
    }
}
