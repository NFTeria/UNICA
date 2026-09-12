// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {UnicaPolicyReceiver} from "../../src/unica-v4/policy/UnicaPolicyReceiver.sol";
import {UnicaPolicyTypes} from "../../src/unica-v4/policy/UnicaPolicyTypes.sol";
import {LocalKeystoneForwarderFixture} from "../../src/unica-v4/policy/LocalKeystoneForwarderFixture.sol";
import {LocalCreReportFixture} from "../../src/unica-v4/policy/LocalCreReportFixture.sol";
import {IUnicaPolicyReceiver} from "../../src/unica-v4/policy/IUnicaPolicyReceiver.sol";
import {UnicaMarketTypes} from "../../src/unica-v4/UnicaMarketTypes.sol";
import {RegistryDouble} from "./util/RegistryDouble.sol";

/// @notice LOCAL CRE REPORT FIXTURE — NOT A DON REPORT. Every report this file builds and delivers
///         is assembled by `LocalCreReportFixture` and routed through `LocalKeystoneForwarderFixture`
///         or, for the direct-revert half of each rejection pair, delivered straight to `onReport`
///         under `vm.prank(forwarder)`. None of it is a DON report, a CRE deployment, or a real
///         Keystone forwarder — see the header of each of those two contracts.
contract PolicyReceiverTest is Test {
    UnicaPolicyReceiver internal receiver;
    LocalKeystoneForwarderFixture internal forwarder;
    RegistryDouble internal registry;

    bytes32 internal constant WORKFLOW_ID = keccak256("unica-v5-policy-workflow");
    bytes32 internal constant UNICA_RELEASE = keccak256("unica-v5-release-local");
    uint8 internal constant SCHEMA_VERSION = 1;
    bytes10 internal constant WORKFLOW_NAME = bytes10("unica-pol");
    bytes2 internal constant REPORT_ID = bytes2(0x0001);

    bytes32 internal constant MARKET_ID = keccak256("market-1");
    uint32 internal constant MARKET_VERSION = 3;

    address internal workflowOwner;
    address internal merchant;
    address internal payer;
    address internal inputAsset;
    address internal outputAsset;

    function setUp() public {
        workflowOwner = makeAddr("workflow-owner");
        merchant = makeAddr("merchant");
        payer = makeAddr("payer");
        inputAsset = makeAddr("input-asset");
        outputAsset = makeAddr("output-asset");

        registry = new RegistryDouble();
        forwarder = new LocalKeystoneForwarderFixture();
        receiver = new UnicaPolicyReceiver(
            address(forwarder), address(registry), UNICA_RELEASE, WORKFLOW_ID, workflowOwner, SCHEMA_VERSION
        );

        UnicaMarketTypes.Market memory market;
        market.version = MARKET_VERSION;
        registry.setMarket(MARKET_ID, market);
        registry.setStatus(MARKET_ID, uint8(UnicaMarketTypes.MarketStatus.ACTIVE));
    }

    // ---- helpers ----------------------------------------------------------------------------

    function _baseReport() internal view returns (UnicaPolicyTypes.AdmissionReport memory r) {
        r.chainId = block.chainid;
        r.verifyingContract = address(receiver);
        r.unicaRelease = UNICA_RELEASE;
        r.registry = address(registry);
        r.marketId = MARKET_ID;
        r.marketVersion = MARKET_VERSION;
        r.merchant = merchant;
        r.payer = payer;
        r.inputAsset = inputAsset;
        r.outputAsset = outputAsset;
        r.exactInput = true;
        r.inputAmount = 1_000e18;
        r.minOutput = 900e18;
        r.orderNonce = keccak256("order-nonce-1");
        r.quoteExpiry = uint64(block.timestamp + 1 hours);
        r.policyExpiry = uint64(block.timestamp + 1 days);
        r.terminalNode = keccak256("terminal-node");
        r.terminalStatusSnapshot = keccak256("terminal-status");
        r.ensDeploymentId = keccak256("ens-deployment");
        r.policyVersionHash = keccak256("policy-version");
        r.privateInputCommitment = keccak256("private-input");
        r.workflowId = WORKFLOW_ID;
        r.workflowOwner = workflowOwner;
        r.workflowVersion = keccak256("workflow-version");
        r.receiver = address(receiver);
    }

    function _metadata() internal view returns (bytes memory) {
        return LocalCreReportFixture.metadata(WORKFLOW_ID, WORKFLOW_NAME, workflowOwner, REPORT_ID);
    }

    /// @dev Builds a well-formed metadata + report pair for the baseline report, ready to deliver.
    function _deliverGood()
        internal
        view
        returns (bytes memory metadata_, bytes memory report_, UnicaPolicyTypes.AdmissionReport memory r)
    {
        r = _baseReport();
        metadata_ = _metadata();
        report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
    }

    function _assertForwarderRejects(bytes memory metadata_, bytes memory report_, bytes32 orderNonce) internal {
        bool ok = forwarder.route(address(receiver), metadata_, report_);
        assertFalse(ok, "forwarder route() must surface a rejected report as result=false, never revert");
        assertFalse(receiver.admissionOf(orderNonce).exists, "a rejected report must never create an admission");
    }

    function _assertDirectReverts(bytes memory metadata_, bytes memory report_, bytes4 selector) internal {
        vm.prank(address(forwarder));
        vm.expectRevert(selector);
        receiver.onReport(metadata_, report_);
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0) return true;
        if (n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return true;
        }
        return false;
    }

    // ---- control: a well-formed report is admitted -------------------------------------------

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_control_wellFormedReport_admitsThroughFixtureForwarder() public {
        (bytes memory metadata_, bytes memory report_, UnicaPolicyTypes.AdmissionReport memory r) = _deliverGood();

        vm.expectEmit(true, true, true, true, address(forwarder));
        emit LocalKeystoneForwarderFixture.ReportProcessed(
            address(receiver), keccak256(abi.encode(metadata_, report_)), REPORT_ID, true
        );

        bool ok = forwarder.route(address(receiver), metadata_, report_);
        assertTrue(ok, "a well-formed report must be accepted");

        IUnicaPolicyReceiver.Admission memory a = receiver.admissionOf(r.orderNonce);
        assertTrue(a.exists);
        assertEq(a.reportHash, keccak256(report_));
        assertEq(a.marketId, r.marketId);
        assertEq(a.merchant, r.merchant);
        assertEq(a.payer, r.payer);

        assertTrue(
            receiver.isAdmitted(
                r.orderNonce,
                r.marketId,
                r.merchant,
                r.payer,
                r.inputAsset,
                r.outputAsset,
                r.inputAmount,
                r.minOutput,
                r.terminalNode
            )
        );
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_control_directOnReport_emitsAdmissionRecorded() public {
        (bytes memory metadata_, bytes memory report_, UnicaPolicyTypes.AdmissionReport memory r) = _deliverGood();

        vm.expectEmit(true, true, true, true, address(receiver));
        emit IUnicaPolicyReceiver.AdmissionRecorded(r.orderNonce, r.marketId, r.payer, r.merchant, keccak256(report_));

        vm.prank(address(forwarder));
        receiver.onReport(metadata_, report_);
    }

    // ---- NotForwarder: only reachable directly, the fixture forwarder always calls as itself ---

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_notForwarder_strangerCaller() public {
        (bytes memory metadata_, bytes memory report_,) = _deliverGood();
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(UnicaPolicyReceiver.NotForwarder.selector);
        receiver.onReport(metadata_, report_);
    }

    // ---- MalformedMetadata ---------------------------------------------------------------------

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_malformedMetadata_forwarderResultFalse() public {
        (, bytes memory report_, UnicaPolicyTypes.AdmissionReport memory r) = _deliverGood();
        bytes memory badMetadata = new bytes(32);
        _assertForwarderRejects(badMetadata, report_, r.orderNonce);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_malformedMetadata_direct() public {
        (, bytes memory report_,) = _deliverGood();
        bytes memory badMetadata = new bytes(32);
        _assertDirectReverts(badMetadata, report_, UnicaPolicyReceiver.MalformedMetadata.selector);
    }

    // ---- WorkflowMismatch / WorkflowOwnerMismatch, from the metadata argument ------------------

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_workflowMismatchFromMetadata_forwarderResultFalse() public {
        (, bytes memory report_, UnicaPolicyTypes.AdmissionReport memory r) = _deliverGood();
        bytes memory badMetadata =
            LocalCreReportFixture.metadata(keccak256("wrong-workflow"), WORKFLOW_NAME, workflowOwner, REPORT_ID);
        _assertForwarderRejects(badMetadata, report_, r.orderNonce);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_workflowMismatchFromMetadata_direct() public {
        (, bytes memory report_,) = _deliverGood();
        bytes memory badMetadata =
            LocalCreReportFixture.metadata(keccak256("wrong-workflow"), WORKFLOW_NAME, workflowOwner, REPORT_ID);
        _assertDirectReverts(badMetadata, report_, UnicaPolicyReceiver.WorkflowMismatch.selector);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_workflowOwnerMismatchFromMetadata_forwarderResultFalse() public {
        (, bytes memory report_, UnicaPolicyTypes.AdmissionReport memory r) = _deliverGood();
        bytes memory badMetadata =
            LocalCreReportFixture.metadata(WORKFLOW_ID, WORKFLOW_NAME, makeAddr("wrong-owner"), REPORT_ID);
        _assertForwarderRejects(badMetadata, report_, r.orderNonce);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_workflowOwnerMismatchFromMetadata_direct() public {
        (, bytes memory report_,) = _deliverGood();
        bytes memory badMetadata =
            LocalCreReportFixture.metadata(WORKFLOW_ID, WORKFLOW_NAME, makeAddr("wrong-owner"), REPORT_ID);
        _assertDirectReverts(badMetadata, report_, UnicaPolicyReceiver.WorkflowOwnerMismatch.selector);
    }

    // ---- EmptyOrShortReport ----------------------------------------------------------------------

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_emptyOrShortReport_forwarderResultFalse() public {
        bytes memory metadata_ = _metadata();
        bytes memory shortReport = new bytes(10);
        bool ok = forwarder.route(address(receiver), metadata_, shortReport);
        assertFalse(ok);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_emptyOrShortReport_direct() public {
        bytes memory metadata_ = _metadata();
        bytes memory shortReport = new bytes(10);
        _assertDirectReverts(metadata_, shortReport, UnicaPolicyReceiver.EmptyOrShortReport.selector);
    }

    // ---- ReportSchemaUnsupported -------------------------------------------------------------

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_reportSchemaUnsupported_forwarderResultFalse() public {
        (bytes memory metadata_, bytes memory report_, UnicaPolicyTypes.AdmissionReport memory r) = _deliverGood();
        report_[0] = bytes1(SCHEMA_VERSION + 1);
        _assertForwarderRejects(metadata_, report_, r.orderNonce);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_reportSchemaUnsupported_direct() public {
        (bytes memory metadata_, bytes memory report_,) = _deliverGood();
        report_[0] = bytes1(SCHEMA_VERSION + 1);
        _assertDirectReverts(metadata_, report_, UnicaPolicyReceiver.ReportSchemaUnsupported.selector);
    }

    // ---- UnknownTrailingData -------------------------------------------------------------------

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_unknownTrailingData_forwarderResultFalse() public {
        (bytes memory metadata_, bytes memory report_, UnicaPolicyTypes.AdmissionReport memory r) = _deliverGood();
        bytes memory withTrailing = abi.encodePacked(report_, bytes1(0xff));
        _assertForwarderRejects(metadata_, withTrailing, r.orderNonce);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_unknownTrailingData_direct() public {
        (bytes memory metadata_, bytes memory report_,) = _deliverGood();
        bytes memory withTrailing = abi.encodePacked(report_, bytes1(0xff));
        _assertDirectReverts(metadata_, withTrailing, UnicaPolicyReceiver.UnknownTrailingData.selector);
    }

    // ---- ReportChainMismatch -------------------------------------------------------------------

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_reportChainMismatch_forwarderResultFalse() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.chainId = block.chainid + 1;
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertForwarderRejects(_metadata(), report_, r.orderNonce);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_reportChainMismatch_direct() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.chainId = block.chainid + 1;
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertDirectReverts(_metadata(), report_, UnicaPolicyReceiver.ReportChainMismatch.selector);
    }

    // ---- ReportReceiverMismatch ------------------------------------------------------------------

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_reportReceiverMismatchVerifyingContract_forwarderResultFalse() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.verifyingContract = makeAddr("wrong-verifying-contract");
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertForwarderRejects(_metadata(), report_, r.orderNonce);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_reportReceiverMismatchVerifyingContract_direct() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.verifyingContract = makeAddr("wrong-verifying-contract");
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertDirectReverts(_metadata(), report_, UnicaPolicyReceiver.ReportReceiverMismatch.selector);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_reportReceiverMismatchReceiverField_forwarderResultFalse() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.receiver = makeAddr("wrong-receiver-field");
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertForwarderRejects(_metadata(), report_, r.orderNonce);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_reportReceiverMismatchReceiverField_direct() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.receiver = makeAddr("wrong-receiver-field");
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertDirectReverts(_metadata(), report_, UnicaPolicyReceiver.ReportReceiverMismatch.selector);
    }

    // ---- ReleaseMismatch / RegistryMismatch -------------------------------------------------------

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_releaseMismatch_forwarderResultFalse() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.unicaRelease = keccak256("wrong-release");
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertForwarderRejects(_metadata(), report_, r.orderNonce);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_releaseMismatch_direct() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.unicaRelease = keccak256("wrong-release");
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertDirectReverts(_metadata(), report_, UnicaPolicyReceiver.ReleaseMismatch.selector);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_registryMismatch_forwarderResultFalse() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.registry = makeAddr("wrong-registry");
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertForwarderRejects(_metadata(), report_, r.orderNonce);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_registryMismatch_direct() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.registry = makeAddr("wrong-registry");
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertDirectReverts(_metadata(), report_, UnicaPolicyReceiver.RegistryMismatch.selector);
    }

    // ---- WorkflowMismatch / WorkflowOwnerMismatch, from the decoded report struct ----------------

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_workflowMismatchFromReportStruct_forwarderResultFalse() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.workflowId = keccak256("wrong-workflow-in-report");
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertForwarderRejects(_metadata(), report_, r.orderNonce);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_workflowMismatchFromReportStruct_direct() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.workflowId = keccak256("wrong-workflow-in-report");
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertDirectReverts(_metadata(), report_, UnicaPolicyReceiver.WorkflowMismatch.selector);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_workflowOwnerMismatchFromReportStruct_forwarderResultFalse() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.workflowOwner = makeAddr("wrong-owner-in-report");
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertForwarderRejects(_metadata(), report_, r.orderNonce);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_workflowOwnerMismatchFromReportStruct_direct() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.workflowOwner = makeAddr("wrong-owner-in-report");
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertDirectReverts(_metadata(), report_, UnicaPolicyReceiver.WorkflowOwnerMismatch.selector);
    }

    // ---- MarketVersionStale / MarketNotActive -----------------------------------------------------

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_marketVersionStale_forwarderResultFalse() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.marketVersion = MARKET_VERSION + 1;
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertForwarderRejects(_metadata(), report_, r.orderNonce);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_marketVersionStale_direct() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.marketVersion = MARKET_VERSION + 1;
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertDirectReverts(_metadata(), report_, UnicaPolicyReceiver.MarketVersionStale.selector);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_marketNotActive_forwarderResultFalse() public {
        registry.setStatus(MARKET_ID, uint8(UnicaMarketTypes.MarketStatus.PAUSED));
        (bytes memory metadata_, bytes memory report_, UnicaPolicyTypes.AdmissionReport memory r) = _deliverGood();
        _assertForwarderRejects(metadata_, report_, r.orderNonce);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_marketNotActive_direct() public {
        registry.setStatus(MARKET_ID, uint8(UnicaMarketTypes.MarketStatus.PAUSED));
        (bytes memory metadata_, bytes memory report_,) = _deliverGood();
        _assertDirectReverts(metadata_, report_, UnicaPolicyReceiver.MarketNotActive.selector);
    }

    // ---- QuoteExpired / PolicyExpired, separately -------------------------------------------------

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_quoteExpired_forwarderResultFalse() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.quoteExpiry = uint64(block.timestamp == 0 ? 0 : block.timestamp - 1);
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertForwarderRejects(_metadata(), report_, r.orderNonce);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_quoteExpired_direct() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.quoteExpiry = uint64(block.timestamp == 0 ? 0 : block.timestamp - 1);
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertDirectReverts(_metadata(), report_, UnicaPolicyReceiver.QuoteExpired.selector);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_policyExpired_forwarderResultFalse() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.policyExpiry = uint64(block.timestamp == 0 ? 0 : block.timestamp - 1);
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertForwarderRejects(_metadata(), report_, r.orderNonce);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_policyExpired_direct() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.policyExpiry = uint64(block.timestamp == 0 ? 0 : block.timestamp - 1);
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        _assertDirectReverts(_metadata(), report_, UnicaPolicyReceiver.PolicyExpired.selector);
    }

    // ---- NonceAlreadyUsed: replay ------------------------------------------------------------------

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_nonceAlreadyUsed_forwarderResultFalse() public {
        (bytes memory metadata_, bytes memory report1, UnicaPolicyTypes.AdmissionReport memory r1) = _deliverGood();
        bool ok1 = forwarder.route(address(receiver), metadata_, report1);
        assertTrue(ok1);
        bytes32 firstHash = receiver.admissionOf(r1.orderNonce).reportHash;

        UnicaPolicyTypes.AdmissionReport memory r2 = r1;
        r2.policyVersionHash = keccak256("different-policy-version");
        bytes memory report2 = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r2);

        bool ok2 = forwarder.route(address(receiver), metadata_, report2);
        assertFalse(ok2, "a replayed orderNonce must be rejected");
        assertEq(receiver.admissionOf(r1.orderNonce).reportHash, firstHash, "the original admission must be unchanged");
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_reject_nonceAlreadyUsed_direct() public {
        (bytes memory metadata_, bytes memory report1, UnicaPolicyTypes.AdmissionReport memory r1) = _deliverGood();
        vm.prank(address(forwarder));
        receiver.onReport(metadata_, report1);

        UnicaPolicyTypes.AdmissionReport memory r2 = r1;
        r2.policyVersionHash = keccak256("different-policy-version-2");
        bytes memory report2 = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r2);

        _assertDirectReverts(metadata_, report2, UnicaPolicyReceiver.NonceAlreadyUsed.selector);
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    /// @dev r1 and r2 are each built from an independent `_baseReport()` call, deliberately never
    ///      by copying one memory struct into another (`r2 = r1` would alias the same memory in
    ///      Solidity, not deep-copy it — mutating one would silently mutate the other).
    function test_distinctPolicyCommitmentsWithDistinctNonces_recordSeparateAdmissions() public {
        UnicaPolicyTypes.AdmissionReport memory r1 = _baseReport();
        r1.orderNonce = keccak256("nonce-A");
        r1.policyVersionHash = keccak256("policy-A");
        r1.privateInputCommitment = keccak256("private-A");
        bytes memory report1 = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r1);

        UnicaPolicyTypes.AdmissionReport memory r2 = _baseReport();
        r2.orderNonce = keccak256("nonce-B");
        r2.policyVersionHash = keccak256("policy-B");
        r2.privateInputCommitment = keccak256("private-B");
        bytes memory report2 = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r2);

        bytes memory metadata_ = _metadata();
        assertTrue(forwarder.route(address(receiver), metadata_, report1));
        assertTrue(forwarder.route(address(receiver), metadata_, report2));

        bytes32 hash1 = receiver.admissionOf(r1.orderNonce).reportHash;
        bytes32 hash2 = receiver.admissionOf(r2.orderNonce).reportHash;
        assertTrue(receiver.admissionOf(r1.orderNonce).exists);
        assertTrue(receiver.admissionOf(r2.orderNonce).exists);
        assertTrue(hash1 != hash2, "different policy/private commitments must yield different reportHash");
    }

    // ---- isAdmitted: exact-term matching, including the zero-payer non-wildcard rule --------------

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_isAdmitted_control_and_eachTermFlippedIndividually() public {
        (bytes memory metadata_, bytes memory report_, UnicaPolicyTypes.AdmissionReport memory r) = _deliverGood();
        assertTrue(forwarder.route(address(receiver), metadata_, report_));

        assertTrue(
            receiver.isAdmitted(
                r.orderNonce,
                r.marketId,
                r.merchant,
                r.payer,
                r.inputAsset,
                r.outputAsset,
                r.inputAmount,
                r.minOutput,
                r.terminalNode
            ),
            "control: unflipped terms must admit"
        );

        assertFalse(
            receiver.isAdmitted(
                r.orderNonce,
                keccak256("wrong-market"),
                r.merchant,
                r.payer,
                r.inputAsset,
                r.outputAsset,
                r.inputAmount,
                r.minOutput,
                r.terminalNode
            ),
            "marketId flipped"
        );
        assertFalse(
            receiver.isAdmitted(
                r.orderNonce,
                r.marketId,
                makeAddr("wrong-merchant"),
                r.payer,
                r.inputAsset,
                r.outputAsset,
                r.inputAmount,
                r.minOutput,
                r.terminalNode
            ),
            "merchant flipped"
        );
        assertFalse(
            receiver.isAdmitted(
                r.orderNonce,
                r.marketId,
                r.merchant,
                makeAddr("wrong-payer"),
                r.inputAsset,
                r.outputAsset,
                r.inputAmount,
                r.minOutput,
                r.terminalNode
            ),
            "payer flipped"
        );
        assertFalse(
            receiver.isAdmitted(
                r.orderNonce,
                r.marketId,
                r.merchant,
                r.payer,
                makeAddr("wrong-input-asset"),
                r.outputAsset,
                r.inputAmount,
                r.minOutput,
                r.terminalNode
            ),
            "inputAsset flipped"
        );
        assertFalse(
            receiver.isAdmitted(
                r.orderNonce,
                r.marketId,
                r.merchant,
                r.payer,
                r.inputAsset,
                makeAddr("wrong-output-asset"),
                r.inputAmount,
                r.minOutput,
                r.terminalNode
            ),
            "outputAsset flipped"
        );
        assertFalse(
            receiver.isAdmitted(
                r.orderNonce,
                r.marketId,
                r.merchant,
                r.payer,
                r.inputAsset,
                r.outputAsset,
                r.inputAmount + 1,
                r.minOutput,
                r.terminalNode
            ),
            "inputAmount flipped"
        );
        assertFalse(
            receiver.isAdmitted(
                r.orderNonce,
                r.marketId,
                r.merchant,
                r.payer,
                r.inputAsset,
                r.outputAsset,
                r.inputAmount,
                r.minOutput + 1,
                r.terminalNode
            ),
            "minOutput flipped"
        );
        assertFalse(
            receiver.isAdmitted(
                r.orderNonce,
                r.marketId,
                r.merchant,
                r.payer,
                r.inputAsset,
                r.outputAsset,
                r.inputAmount,
                r.minOutput,
                keccak256("wrong-terminal")
            ),
            "terminalNode flipped"
        );
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_isAdmitted_zeroPayerIsNeverWildcard() public {
        UnicaPolicyTypes.AdmissionReport memory r = _baseReport();
        r.payer = address(0);
        bytes memory report_ = LocalCreReportFixture.encodeReport(SCHEMA_VERSION, r);
        bytes memory metadata_ = _metadata();
        assertTrue(forwarder.route(address(receiver), metadata_, report_));

        assertTrue(
            receiver.isAdmitted(
                r.orderNonce,
                r.marketId,
                r.merchant,
                address(0),
                r.inputAsset,
                r.outputAsset,
                r.inputAmount,
                r.minOutput,
                r.terminalNode
            ),
            "a literal zero-payer query must match a zero-payer record"
        );
        assertFalse(
            receiver.isAdmitted(
                r.orderNonce,
                r.marketId,
                r.merchant,
                payer,
                r.inputAsset,
                r.outputAsset,
                r.inputAmount,
                r.minOutput,
                r.terminalNode
            ),
            "a real payer must never match a zero-payer record"
        );
    }

    /// LOCAL CRE REPORT FIXTURE — NOT A DON REPORT
    function test_isAdmitted_falseOnceExpired() public {
        (bytes memory metadata_, bytes memory report_, UnicaPolicyTypes.AdmissionReport memory r) = _deliverGood();
        forwarder.route(address(receiver), metadata_, report_);

        vm.warp(uint256(r.quoteExpiry) + 1);
        assertFalse(
            receiver.isAdmitted(
                r.orderNonce,
                r.marketId,
                r.merchant,
                r.payer,
                r.inputAsset,
                r.outputAsset,
                r.inputAmount,
                r.minOutput,
                r.terminalNode
            ),
            "an admission expired past quoteExpiry must no longer admit, even though it still exists"
        );
        assertTrue(receiver.admissionOf(r.orderNonce).exists, "the record itself is never deleted by expiry alone");
    }

    // ---- fixture vs. DON: the forwarder must self-identify as a local fixture --------------------

    function test_fixtureVsDon_typeAndVersionCarriesLabel() public view {
        string memory tv = forwarder.typeAndVersion();
        assertTrue(
            _contains(tv, "LOCAL CRE REPORT FIXTURE"),
            "the fixture forwarder must never be mistaken for a real KeystoneForwarder or MockKeystoneForwarder"
        );
        assertTrue(_contains(tv, "NOT A DON REPORT"));
    }
}
