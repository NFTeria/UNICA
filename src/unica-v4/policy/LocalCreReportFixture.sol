// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {UnicaPolicyTypes} from "./UnicaPolicyTypes.sol";

/// @notice LOCAL CRE REPORT FIXTURE — NOT A DON REPORT. A pure-computation library that assembles
///         the bytes a real CRE report would carry to `UnicaPolicyReceiver.onReport`, written fresh
///         from `docs/unica-v5/chainlink/RECEIVER.md` §5 (metadata layout) and `docs/unica-v5/
///         chainlink/REPORT-SCHEMA.md` §4-§5 (report layout, the domain separator, and the struct
///         hash) — never from any Chainlink source file. Used by `test/policy/*` and by the local
///         Anvil demo script, which must itself assert it is running against a local chain before
///         using anything here (this library has no way to enforce that on its own: it only builds
///         bytes, it never checks a chain id). Nothing this library produces is signed by anything,
///         is a DON report, or has ever been delivered by a real Keystone forwarder.
library LocalCreReportFixture {
    /// @notice Byte 0 = `schemaVersion`; bytes 1.. = `abi.encode(r)`. Every field of
    ///         `UnicaPolicyTypes.AdmissionReport` is a static ABI type, so this is always exactly
    ///         1 + 25*32 = 801 bytes — the exact layout `UnicaPolicyReceiver.onReport` decodes.
    function encodeReport(uint8 schemaVersion, UnicaPolicyTypes.AdmissionReport memory r)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(schemaVersion, abi.encode(r));
    }

    /// @notice The 64-byte Keystone-shaped metadata argument (RECEIVER.md §5 step 3 / REPORT-
    ///         SCHEMA.md §3): `workflowId` (32) || `workflowName` (10) || `workflowOwner` (20) ||
    ///         `reportId` (2), packed with no padding between fields.
    function metadata(bytes32 workflowId, bytes10 workflowName, address workflowOwner, bytes2 reportId)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(workflowId, workflowName, workflowOwner, reportId);
    }

    /// @notice The hash `UnicaPolicyReceiver.onReport` stores as `Admission.reportHash` — the whole
    ///         `report` argument it received, tag byte included.
    function reportHash(bytes memory report) internal pure returns (bytes32) {
        return keccak256(report);
    }

    /// @notice `admissionDigest`, REPORT-SCHEMA.md §5: `domainSeparator = hash("UNICA-ADMISSION-V1",
    ///         chainId, verifyingContract, unicaRelease, registry)`, `structHash` over the remaining
    ///         21 fields in that document's own order, `admissionDigest = hash(domainSeparator,
    ///         structHash)`. Not a signature — see this library's header and REPORT-SCHEMA.md §5's
    ///         own note that a real DON's `f+1` signatures, once one exists, already cover every
    ///         byte of `report`, this digest included.
    function digest(UnicaPolicyTypes.AdmissionReport memory r) internal pure returns (bytes32) {
        return keccak256(abi.encode(_domainSeparator(r), _structHash(r)));
    }

    function _domainSeparator(UnicaPolicyTypes.AdmissionReport memory r) private pure returns (bytes32) {
        return keccak256(abi.encode("UNICA-ADMISSION-V1", r.chainId, r.verifyingContract, r.unicaRelease, r.registry));
    }

    function _structHash(UnicaPolicyTypes.AdmissionReport memory r) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                r.marketId,
                r.marketVersion,
                r.merchant,
                r.payer,
                r.inputAsset,
                r.outputAsset,
                r.exactInput,
                r.inputAmount,
                r.minOutput,
                r.orderNonce,
                r.quoteExpiry,
                r.policyExpiry,
                r.terminalNode,
                r.terminalStatusSnapshot,
                r.ensDeploymentId,
                r.policyVersionHash,
                r.privateInputCommitment,
                r.workflowId,
                r.workflowOwner,
                r.workflowVersion,
                r.receiver
            )
        );
    }
}
