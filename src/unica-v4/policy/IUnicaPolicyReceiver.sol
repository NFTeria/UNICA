// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice The admission record a confidential-policy report leaves behind, and the one question an
///         order-admission wrapper asks it (docs/unica-v5/chainlink/RECEIVER.md §6). The receiver
///         never creates, signs or settles an order; it only records that an exact set of terms was
///         authorized, and the wrapper compares by literal equality at order-creation time.
interface IUnicaPolicyReceiver {
    struct Admission {
        bytes32 marketId;
        uint32 marketVersion;
        address merchant;
        address payer;
        address inputAsset;
        address outputAsset;
        bool exactInput;
        uint256 inputAmount;
        uint128 minOutput;
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
        bytes32 reportHash;
        uint64 recordedAt;
        bool exists;
    }

    /// @notice Emitted once per accepted report; a rejected report emits nothing and reverts.
    event AdmissionRecorded(
        bytes32 indexed orderNonce,
        bytes32 indexed marketId,
        address indexed payer,
        address merchant,
        bytes32 reportHash
    );

    function FORWARDER() external view returns (address);
    function REGISTRY() external view returns (address);
    function UNICA_RELEASE() external view returns (bytes32);
    function WORKFLOW_ID() external view returns (bytes32);
    function WORKFLOW_OWNER() external view returns (address);
    function REPORT_SCHEMA_VERSION() external view returns (uint8);

    function admissionOf(bytes32 orderNonce) external view returns (Admission memory);

    /// @notice True only when an admission exists for `orderNonce`, is unexpired at `block.timestamp`
    ///         (both `quoteExpiry` and `policyExpiry`), and every term equals the stored one exactly.
    ///         A zero `payer` in the record is never a wildcard.
    function isAdmitted(
        bytes32 orderNonce,
        bytes32 marketId,
        address merchant,
        address payer,
        address inputAsset,
        address outputAsset,
        uint256 inputAmount,
        uint128 minOutput,
        bytes32 terminalNode
    ) external view returns (bool);
}
