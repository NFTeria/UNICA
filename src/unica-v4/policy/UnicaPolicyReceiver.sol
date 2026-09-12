// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IUnicaPolicyReceiver} from "./IUnicaPolicyReceiver.sol";
import {UnicaPolicyTypes} from "./UnicaPolicyTypes.sol";
import {IUnicaMarketRegistry} from "../interfaces/IUnicaMarketRegistry.sol";
import {UnicaMarketTypes} from "../UnicaMarketTypes.sol";

/// @notice LOCAL CRE REPORT FIXTURE — NOT A DON REPORT. This contract is the confidential-policy
///         admission receiver docs/unica-v5/chainlink/RECEIVER.md specifies, written fresh from that
///         document's §3-§7 (never from Chainlink's own `KeystoneForwarder`/`IReceiver` source, which
///         this file never opens — only the two verified signatures, `onReport(bytes,bytes)` and
///         `supportsInterface(bytes4)`, are reproduced, per D4's independently-derived interface id).
///         Nothing in this repository has deployed a `KeystoneForwarder`, run a CRE workflow, or
///         received a DON-signed report; `docs/unica-v5/chainlink/SIMULATION-VS-DON.md` §2-§3 states
///         exactly which of the six rungs between "compiles locally" and "a live DON delivers this"
///         this tree has climbed (none, for this subject). This contract is exercised in this
///         repository only against `LocalKeystoneForwarderFixture` and `LocalCreReportFixture` —
///         both local stand-ins, never a real Keystone forwarder or a real CRE workflow.
/// @dev Report layout this contract decodes (REPORT-SCHEMA.md §4, §8 item 5): byte 0 is the schema
///      version tag; bytes 1.. are `abi.encode(UnicaPolicyTypes.AdmissionReport)`. Every field of
///      that struct is a static ABI type, so the encoded struct is exactly 25 * 32 = 800 bytes with
///      no dynamic offsets — which is what lets this contract check for trailing bytes with a single
///      length comparison rather than a decoder-level guarantee (RECEIVER.md §5 step 7).
contract UnicaPolicyReceiver is IUnicaPolicyReceiver {
    uint256 private constant ADMISSION_REPORT_FIELD_COUNT = 25;
    uint256 private constant ADMISSION_REPORT_ENCODED_SIZE = ADMISSION_REPORT_FIELD_COUNT * 32;
    uint256 private constant MIN_REPORT_LENGTH = 1 + ADMISSION_REPORT_ENCODED_SIZE;

    bytes4 private constant INTERFACE_ID_ERC165 = 0x01ffc9a7;
    bytes4 private constant INTERFACE_ID_IRECEIVER = 0x805f2132;

    address public immutable override FORWARDER;
    address public immutable override REGISTRY;
    bytes32 public immutable override UNICA_RELEASE;
    bytes32 public immutable override WORKFLOW_ID;
    address public immutable override WORKFLOW_OWNER;
    uint8 public immutable override REPORT_SCHEMA_VERSION;

    mapping(bytes32 orderNonce => Admission) private _admissions;

    error NotForwarder();
    error MalformedMetadata();
    error WorkflowMismatch();
    error WorkflowOwnerMismatch();
    error EmptyOrShortReport();
    error ReportSchemaUnsupported();
    error UnknownTrailingData();
    error ReportChainMismatch();
    error ReportReceiverMismatch();
    error ReleaseMismatch();
    error RegistryMismatch();
    error MarketVersionStale();
    error MarketNotActive();
    error QuoteExpired();
    error PolicyExpired();
    error NonceAlreadyUsed();
    error ZeroAddress();
    error RegistryHasNoCode(address registry);

    constructor(
        address forwarder,
        address registry,
        bytes32 unicaRelease,
        bytes32 workflowId,
        address workflowOwner,
        uint8 reportSchemaVersion
    ) {
        // A zero forwarder would brick every onReport silently; a registry without code would make
        // every market-status read revert. Both are deployment mistakes, refused at deployment.
        if (forwarder == address(0) || registry == address(0) || workflowOwner == address(0)) revert ZeroAddress();
        if (registry.code.length == 0) revert RegistryHasNoCode(registry);
        FORWARDER = forwarder;
        REGISTRY = registry;
        UNICA_RELEASE = unicaRelease;
        WORKFLOW_ID = workflowId;
        WORKFLOW_OWNER = workflowOwner;
        REPORT_SCHEMA_VERSION = reportSchemaVersion;
    }

    /// @notice ERC-165, checked by a real forwarder's `route()` before `onReport` is ever called
    ///         (RECEIVER.md §3): true for `IReceiver` (D4's independently-derived `0x805f2132`) and
    ///         for ERC-165's own `0x01ffc9a7`, false for `0xffffffff` and everything else.
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == INTERFACE_ID_IRECEIVER || interfaceId == INTERFACE_ID_ERC165;
    }

    /// @notice RECEIVER.md §5's fifteen checks, in order. Every rejection is a revert, never a
    ///         `return` — §7's design rule, so `ReportProcessed(..., true)` (emitted by whatever
    ///         forwarder-shaped caller routed this call) can only ever correspond to step 15 having
    ///         actually run and an admission having actually been stored.
    function onReport(bytes calldata metadata, bytes calldata report) external {
        // Step 1 — caller.
        if (msg.sender != FORWARDER) revert NotForwarder();

        // Step 2 — metadata length.
        if (metadata.length != 64) revert MalformedMetadata();

        // Step 3 — metadata decode (workflowId: bytes 0-31; workflowName: bytes 32-41, unchecked;
        // workflowOwner: bytes 42-61; reportId: bytes 62-63, unused by the receiver).
        (bytes32 metaWorkflowId, bytes32 metaTail) = abi.decode(metadata, (bytes32, bytes32));
        address metaWorkflowOwner = address(uint160((uint256(metaTail) << 80) >> 96));

        // Step 4 — workflow identity, checked once here against the forwarder's own argument.
        if (metaWorkflowId != WORKFLOW_ID) revert WorkflowMismatch();
        if (metaWorkflowOwner != WORKFLOW_OWNER) revert WorkflowOwnerMismatch();

        // Step 5 — non-empty, minimum length.
        if (report.length < MIN_REPORT_LENGTH) revert EmptyOrShortReport();

        // Step 6 — report schema tag, checked before any ABI decode is attempted.
        if (report[0] != bytes1(REPORT_SCHEMA_VERSION)) revert ReportSchemaUnsupported();

        // Step 7 — decode, exact length. Every field of AdmissionReport is a static ABI type, so
        // MIN_REPORT_LENGTH is also the exact length; `abi.decode` alone would silently ignore any
        // bytes past it, so the length is asserted explicitly.
        if (report.length != MIN_REPORT_LENGTH) revert UnknownTrailingData();
        UnicaPolicyTypes.AdmissionReport memory r = abi.decode(report[1:], (UnicaPolicyTypes.AdmissionReport));

        // Step 8 — chain id.
        if (r.chainId != block.chainid) revert ReportChainMismatch();

        // Step 9 — verifying contract and receiver.
        if (r.verifyingContract != address(this) || r.receiver != address(this)) revert ReportReceiverMismatch();

        // Step 10 — release and registry.
        if (r.unicaRelease != UNICA_RELEASE) revert ReleaseMismatch();
        if (r.registry != REGISTRY) revert RegistryMismatch();

        // Step 4, repeated — workflow identity, now from inside the signed business payload.
        if (r.workflowId != WORKFLOW_ID) revert WorkflowMismatch();
        if (r.workflowOwner != WORKFLOW_OWNER) revert WorkflowOwnerMismatch();

        // Step 11 — market registration and status, read live, never cached from the report.
        UnicaMarketTypes.Market memory market = IUnicaMarketRegistry(REGISTRY).getMarket(r.marketId);
        if (market.version != r.marketVersion) revert MarketVersionStale();
        if (IUnicaMarketRegistry(REGISTRY).statusOf(r.marketId) != uint8(UnicaMarketTypes.MarketStatus.ACTIVE)) {
            revert MarketNotActive();
        }

        // Step 12 — expiry, two separate conditions, two separate errors.
        if (block.timestamp > r.quoteExpiry) revert QuoteExpired();
        if (block.timestamp > r.policyExpiry) revert PolicyExpired();

        // Step 13 — terminal status snapshot: no stronger check than policyExpiry's bound exists
        // here (RECEIVER.md §5 step 13, §8); this contract cannot re-resolve ENS state itself.

        // Step 14 — single-use nonce, checked before any state write (checks-effects-interactions).
        if (_admissions[r.orderNonce].exists) revert NonceAlreadyUsed();

        // Step 15 — compute and store. No branch above this line returns normally; every one reverts.
        bytes32 rHash = keccak256(report);
        _admissions[r.orderNonce] = Admission({
            marketId: r.marketId,
            marketVersion: r.marketVersion,
            merchant: r.merchant,
            payer: r.payer,
            inputAsset: r.inputAsset,
            outputAsset: r.outputAsset,
            exactInput: r.exactInput,
            inputAmount: r.inputAmount,
            minOutput: r.minOutput,
            quoteExpiry: r.quoteExpiry,
            policyExpiry: r.policyExpiry,
            terminalNode: r.terminalNode,
            terminalStatusSnapshot: r.terminalStatusSnapshot,
            ensDeploymentId: r.ensDeploymentId,
            policyVersionHash: r.policyVersionHash,
            privateInputCommitment: r.privateInputCommitment,
            workflowId: r.workflowId,
            workflowOwner: r.workflowOwner,
            workflowVersion: r.workflowVersion,
            reportHash: rHash,
            recordedAt: uint64(block.timestamp),
            exists: true
        });

        emit AdmissionRecorded(r.orderNonce, r.marketId, r.payer, r.merchant, rHash);
    }

    function admissionOf(bytes32 orderNonce) external view override returns (Admission memory) {
        return _admissions[orderNonce];
    }

    /// @notice True only when an admission exists, is unexpired at `block.timestamp` (both
    ///         expiries), and every passed term equals the stored one exactly. A stored zero
    ///         `payer` is compared by the same literal equality as any other value — never read as
    ///         a wildcard authorizing any caller.
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
    ) external view override returns (bool) {
        Admission storage a = _admissions[orderNonce];
        if (!a.exists) return false;
        if (block.timestamp > a.quoteExpiry || block.timestamp > a.policyExpiry) return false;
        return a.marketId == marketId && a.merchant == merchant && a.payer == payer && a.inputAsset == inputAsset
            && a.outputAsset == outputAsset && a.inputAmount == inputAmount && a.minOutput == minOutput
            && a.terminalNode == terminalNode;
    }
}
