// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// LOCAL ENSv2-COMPATIBLE FIXTURE for Anvil integration tests. Not the isolated ENSv2 Sepolia
// deployment; mirrors its measured Enhanced Access Control shape (per-key text resources, role
// bitmaps, admin bits at +128) so the join-then-admit path can be tested end to end without a
// network.

import {Test} from "forge-std/Test.sol";
import {LocalEnsV2Fixture} from "../../src/identity/LocalEnsV2Fixture.sol";
import {TerminalAdmission} from "../../src/identity/TerminalAdmission.sol";
import {MerchantOnboarding} from "../../src/identity/MerchantOnboarding.sol";
import {UnicaMarketTypes} from "../../src/unica-v4/UnicaMarketTypes.sol";
import {ExecutorDouble} from "./util/ExecutorDouble.sol";
import {RegistryDouble} from "./util/RegistryDouble.sol";
import {IdentityBadgeDouble} from "./MerchantOnboarding.t.sol";

/// @title JoinedMerchantAdmissionTest
/// @notice The two halves meet: a business that joined through `MerchantOnboarding`, with no hand
///         from anyone else, has a first register that `TerminalAdmission` admits a sale from. The
///         same register is refused once the owner revokes it through the fixture, and a register
///         under another business is refused when claimed under this one. Same executor and
///         registry doubles `TerminalTrustTree.t.sol` uses, so a difference here would be in the
///         tree the door built and nowhere else.
contract JoinedMerchantAdmissionTest is Test {
    LocalEnsV2Fixture internal ens;
    MerchantOnboarding internal onboarding;
    IdentityBadgeDouble internal badge;
    TerminalAdmission internal admission;
    ExecutorDouble internal executor;
    RegistryDouble internal registryDouble;

    address internal admin = makeAddr("admin");
    address internal owner = makeAddr("businessOwner");
    address internal otherOwner = makeAddr("otherBusinessOwner");
    address internal payout = makeAddr("payout");
    address internal otherPayout = makeAddr("otherPayout");
    address internal customer = makeAddr("customer");
    address internal secondOperator = makeAddr("secondOperator");

    bytes32 internal ethNode;
    bytes32 internal unicaNode;
    bytes32 internal merchantNode; // freshcuts.unica.eth
    bytes32 internal terminalsNode; // terminals.freshcuts.unica.eth
    bytes32 internal chair1; // chair-1.terminals.freshcuts.unica.eth

    string internal constant STATUS_KEY = "com.unica.terminal-status";
    bytes32 internal constant ENS_DEPLOYMENT_ID = keccak256("unica-identity-fixture-v1");
    bytes32 internal constant MARKET_ID = keccak256("test-market");
    uint128 internal constant AMOUNT_IN = 100e6;
    uint128 internal constant MIN_OUT = 99e6;
    uint64 internal DEADLINE;

    function setUp() public {
        DEADLINE = uint64(block.timestamp + 1 days);

        ens = new LocalEnsV2Fixture();
        ethNode = ens.createRoot("eth");
        unicaNode = ens.register(ethNode, "unica", address(this));

        onboarding = new MerchantOnboarding(address(ens), unicaNode, "unica.eth", admin, STATUS_KEY);
        badge = new IdentityBadgeDouble(address(onboarding), address(ens));
        vm.prank(admin);
        onboarding.linkBadge(address(badge));
        ens.authorizeNameRoles(unicaNode, ens.ROLE_SET_SUBREGISTRY(), address(onboarding), true);

        // The business joins from its own wallet. Nothing else touches its tree before the tests.
        vm.prank(owner);
        (merchantNode, terminalsNode, chair1,) = onboarding.join("freshcuts", payout, "chair-1");

        executor = new ExecutorDouble(
            makeAddr("hook"), makeAddr("registry"), MARKET_ID, makeAddr("assetToken"), makeAddr("payoutToken")
        );
        registryDouble = new RegistryDouble();
        registryDouble.vouch(address(executor), MARKET_ID);
        admission =
            new TerminalAdmission(address(ens), address(registryDouble), ENS_DEPLOYMENT_ID, address(0), STATUS_KEY);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    function _admit(bytes32 merchant, bytes32 terminal, address quoted, address caller, bytes32 salt)
        internal
        returns (bytes32 orderId)
    {
        vm.prank(caller);
        orderId = admission.requestOrder(
            merchant,
            terminal,
            ENS_DEPLOYMENT_ID,
            address(executor),
            quoted,
            customer,
            AMOUNT_IN,
            MIN_OUT,
            DEADLINE,
            salt
        );
    }

    // ── 1. the joined business's first register admits a sale ─────────────────────────────────

    function test_JoinedFirstRegister_AdmitsSale() public {
        bytes32 salt = bytes32(uint256(1));
        bytes32 orderId = _admit(merchantNode, chair1, payout, owner, salt);

        UnicaMarketTypes.Order memory order = executor.orders(orderId);
        assertEq(order.recipient, payout, "the sale pays the business's payout record");
        assertEq(order.payer, customer);
        assertEq(order.amountIn, AMOUNT_IN);
        assertEq(uint8(order.status), uint8(UnicaMarketTypes.OrderStatus.Open));

        TerminalAdmission.AdmissionRecord memory rec = admission.admissionOf(orderId);
        assertEq(rec.merchantNode, merchantNode);
        assertEq(rec.terminalNode, chair1);
        assertEq(rec.operator, owner, "the owner's wallet is the first register's operator");
        assertEq(rec.recipientAtAdmission, payout);
    }

    // ── 2. the owner revokes the register through the fixture; it is refused ───────────────────

    function test_OwnerRevokesFirstRegister_Refused() public {
        // Control: admitted before revocation.
        _admit(merchantNode, chair1, payout, owner, bytes32(uint256(1)));

        vm.startPrank(owner);
        ens.authorizeTextRoles(chair1, STATUS_KEY, owner, false);
        ens.setText(chair1, STATUS_KEY, "revoked");
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(TerminalAdmission.TerminalNotAuthorized.selector, chair1, owner));
        _admit(merchantNode, chair1, payout, owner, bytes32(uint256(2)));
    }

    // ── 3. the owner adds a second register with its own key; that key admits, the door cannot ─

    function test_OwnerAddsSecondRegister_NewOperatorAdmits() public {
        vm.startPrank(owner);
        bytes32 chair2 = ens.register(terminalsNode, "chair-2", owner);
        ens.authorizeTextRoles(chair2, STATUS_KEY, secondOperator, true);
        ens.setText(chair2, STATUS_KEY, "active");
        vm.stopPrank();

        bytes32 orderId = _admit(merchantNode, chair2, payout, secondOperator, bytes32(uint256(3)));
        assertEq(admission.admissionOf(orderId).operator, secondOperator);

        // The door's address holds no operator role on any register the business owns.
        vm.expectRevert(
            abi.encodeWithSelector(TerminalAdmission.TerminalNotAuthorized.selector, chair2, address(onboarding))
        );
        _admit(merchantNode, chair2, payout, address(onboarding), bytes32(uint256(4)));
    }

    // ── 4. a stranger register under another business is refused ──────────────────────────────

    function test_StrangerRegisterUnderAnotherBusiness_Refused() public {
        vm.prank(otherOwner);
        (bytes32 otherMerchant,, bytes32 otherTill,) = onboarding.join("otherco", otherPayout, "till-1");

        // Control: the other business admits against its own node.
        _admit(otherMerchant, otherTill, otherPayout, otherOwner, bytes32(uint256(1)));

        // Negative 1: the other business's register, claimed under this business.
        vm.expectRevert(
            abi.encodeWithSelector(TerminalAdmission.TerminalNotUnderMerchant.selector, otherTill, merchantNode)
        );
        _admit(merchantNode, otherTill, payout, otherOwner, bytes32(uint256(2)));

        // Negative 2: the other owner's key on this business's own register.
        vm.expectRevert(abi.encodeWithSelector(TerminalAdmission.TerminalNotAuthorized.selector, chair1, otherOwner));
        _admit(merchantNode, chair1, payout, otherOwner, bytes32(uint256(3)));
    }
}
