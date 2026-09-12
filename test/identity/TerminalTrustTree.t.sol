// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// LOCAL ENSv2-COMPATIBLE FIXTURE for Anvil integration tests. Not the isolated ENSv2 Sepolia
// deployment; mirrors its measured Enhanced Access Control shape (per-key text resources, role
// bitmaps, admin bits at +128) so the order-admission path can be tested end to end without a
// network. Pinned Sepolia configuration lives in integrations/ensv2/profile.mjs.

import {Test} from "forge-std/Test.sol";
import {LocalEnsV2Fixture} from "../../src/identity/LocalEnsV2Fixture.sol";
import {TerminalAdmission} from "../../src/identity/TerminalAdmission.sol";
import {UnicaMarketTypes} from "../../src/unica-v4/UnicaMarketTypes.sol";
import {ExecutorDouble} from "./util/ExecutorDouble.sol";
import {RegistryDouble} from "./util/RegistryDouble.sol";
import {PolicyDouble} from "./util/PolicyDouble.sol";

/// @title TerminalTrustTree
/// @notice The barbershop tree (`docs/unica-v5/ens/POS-TERMINALS.md` §3-6,
///         `docs/unica-v5/ens/ACCESS-CONTROL.md` §5, §8-9): `unica.eth` -> `freshcuts.unica.eth`
///         (the merchant) -> `terminals.freshcuts.unica.eth` -> `chair-1`/`lost-tablet` (two POS
///         terminals), plus an `agent.freshcuts.unica.eth` leaf that holds a DIFFERENT key
///         entirely. Every negative row here sits beside a passing control in the same test
///         function, and every revert is asserted by exact custom error and arguments.
contract TerminalTrustTreeTest is Test {
    // Redeclared with the exact signature declared on `TerminalAdmission`, so `vm.expectEmit` can
    // match it — Solidity has no way to reference another contract's event by qualified name.
    event OrderAdmitted(
        bytes32 indexed orderId,
        bytes32 indexed merchantNode,
        bytes32 indexed terminalNode,
        address operator,
        address recipient,
        address payer,
        bytes32 orderNonce
    );

    LocalEnsV2Fixture internal ens;
    TerminalAdmission internal admission; // POLICY = address(0): no policy gate
    TerminalAdmission internal admissionWithPolicy; // POLICY = policyDouble
    ExecutorDouble internal executor;
    RegistryDouble internal registryDouble;
    PolicyDouble internal policyDouble;

    address internal merchant = makeAddr("merchant");
    address internal operatorA = makeAddr("operatorA"); // chair-1's operating key
    address internal operatorB = makeAddr("operatorB"); // lost-tablet's operating key, revoked
    address internal operatorC = makeAddr("operatorC"); // a second merchant's operating key
    address internal agentKey = makeAddr("agentKey"); // agent.freshcuts.unica.eth's key
    address internal payer = makeAddr("payer");
    address internal attacker = makeAddr("attacker");
    address internal payoutAddr = makeAddr("merchantPayout");
    /// @dev What each terminal quotes as the merchant's payout address (see `_admit`).
    mapping(bytes32 => address) internal quotedPayout;

    bytes32 internal ethNode;
    bytes32 internal unicaNode;
    bytes32 internal merchantNode; // freshcuts.unica.eth
    bytes32 internal terminalsNode; // terminals.freshcuts.unica.eth
    bytes32 internal chair1Node; // chair-1.terminals.freshcuts.unica.eth
    bytes32 internal lostTabletNode; // lost-tablet.terminals.freshcuts.unica.eth
    bytes32 internal agentNode; // agent.freshcuts.unica.eth

    bytes32 internal constant ENS_DEPLOYMENT_ID = keccak256("unica-identity-fixture-v1");
    string internal constant STATUS_KEY = "com.unica.terminal-status";
    string internal constant AGENT_STATUS_KEY = "com.unica.agent-status";

    bytes32 internal constant MARKET_ID = keccak256("test-market");
    address internal ASSET_TOKEN = makeAddr("assetToken");
    address internal PAYOUT_TOKEN = makeAddr("payoutToken");

    uint128 internal constant AMOUNT_IN = 100e6;
    uint128 internal constant MIN_OUT = 99e6;
    uint64 internal DEADLINE;

    function setUp() public {
        DEADLINE = uint64(block.timestamp + 1 days);

        ens = new LocalEnsV2Fixture();

        // unica.eth, owned by this test contract at every level down to the merchant.
        ethNode = ens.createRoot("eth");
        unicaNode = ens.register(ethNode, "unica", address(this));
        merchantNode = ens.register(unicaNode, "freshcuts", merchant);

        quotedPayout[merchantNode] = payoutAddr;
        vm.startPrank(merchant);
        ens.setAddr(merchantNode, payoutAddr);
        terminalsNode = ens.register(merchantNode, "terminals", merchant);
        chair1Node = ens.register(terminalsNode, "chair-1", merchant);
        lostTabletNode = ens.register(terminalsNode, "lost-tablet", merchant);
        agentNode = ens.register(merchantNode, "agent", merchant);

        ens.authorizeTextRoles(chair1Node, STATUS_KEY, operatorA, true);
        ens.setText(chair1Node, STATUS_KEY, "active");

        ens.authorizeTextRoles(lostTabletNode, STATUS_KEY, operatorB, true);
        ens.setText(lostTabletNode, STATUS_KEY, "active");
        // Revoked: the role is pulled AND the status text is overwritten, matching
        // POS-TERMINALS.md §4.7 ("set to revoked, and, if the operator chooses, the grant itself
        // is revoked").
        ens.authorizeTextRoles(lostTabletNode, STATUS_KEY, operatorB, false);
        ens.setText(lostTabletNode, STATUS_KEY, "revoked");

        // The agent holds SET_TEXT on ITS OWN leaf, scoped to a DIFFERENT key entirely.
        ens.authorizeTextRoles(agentNode, AGENT_STATUS_KEY, agentKey, true);
        vm.stopPrank();

        executor = new ExecutorDouble(makeAddr("hook"), makeAddr("registry"), MARKET_ID, ASSET_TOKEN, PAYOUT_TOKEN);
        policyDouble = new PolicyDouble();

        registryDouble = new RegistryDouble();
        registryDouble.vouch(address(executor), MARKET_ID);
        admission =
            new TerminalAdmission(address(ens), address(registryDouble), ENS_DEPLOYMENT_ID, address(0), STATUS_KEY);
        admissionWithPolicy = new TerminalAdmission(
            address(ens), address(registryDouble), ENS_DEPLOYMENT_ID, address(policyDouble), STATUS_KEY
        );
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    function _admit(TerminalAdmission a, bytes32 merchantNode_, bytes32 terminalNode_, address caller, bytes32 salt)
        internal
        returns (bytes32 orderId)
    {
        // The terminal quotes the payout address it resolved for the merchant, as a real terminal
        // would; kept in a test-side map so the helper makes no external read while a
        // `vm.expectRevert` is armed for the admission call.
        address quoted = quotedPayout[merchantNode_];
        vm.prank(caller);
        orderId = a.requestOrder(
            merchantNode_,
            terminalNode_,
            ENS_DEPLOYMENT_ID,
            address(executor),
            quoted,
            payer,
            AMOUNT_IN,
            MIN_OUT,
            DEADLINE,
            salt
        );
    }

    /// @dev `_admitOrder` hands the executor `keccak256(abi.encode(terminalNode, salt))`, never the
    ///      raw salt (`TerminalAdmission.sol`'s own executor-call line) — so an independent
    ///      prediction of the double's orderId has to derive the same value.
    function _expectedOrderId(address admissionContract, bytes32 terminalNode, bytes32 salt)
        internal
        view
        returns (bytes32)
    {
        bytes32 derivedSalt = keccak256(abi.encode(terminalNode, salt));
        return keccak256(abi.encode(block.chainid, address(executor), admissionContract, derivedSalt));
    }

    // ── 1. control: an active terminal admits an order ──────────────────────────────────────────

    function test_ActiveTerminalAdmitsOrder() public {
        bytes32 salt = bytes32(uint256(1));
        bytes32 expected = _expectedOrderId(address(admission), chair1Node, salt);

        vm.expectEmit(true, true, true, true, address(admission));
        emit OrderAdmitted(expected, merchantNode, chair1Node, operatorA, payoutAddr, payer, salt);
        bytes32 orderId = _admit(admission, merchantNode, chair1Node, operatorA, salt);

        assertEq(orderId, expected, "orderId must match the executor double's own derivation");

        UnicaMarketTypes.Order memory order = executor.orders(orderId);
        assertEq(order.recipient, payoutAddr, "recipient must be the merchant's ENS addr record");
        assertEq(order.payer, payer);
        assertEq(order.amountIn, AMOUNT_IN);
        assertEq(order.minOut, MIN_OUT);
        assertEq(uint8(order.status), uint8(UnicaMarketTypes.OrderStatus.Open));

        TerminalAdmission.AdmissionRecord memory rec = admission.admissionOf(orderId);
        assertEq(rec.merchantNode, merchantNode);
        assertEq(rec.terminalNode, chair1Node);
        assertEq(rec.operator, operatorA);
        assertEq(rec.recipientAtAdmission, payoutAddr);
        assertEq(rec.orderNonce, salt);
    }

    // ── 2. revoked terminal refused ──────────────────────────────────────────────────────────────

    function test_RevokedTerminal_TerminalNotAuthorized() public {
        // Control: the still-active terminal succeeds.
        _admit(admission, merchantNode, chair1Node, operatorA, bytes32(uint256(1)));

        // Negative: lost-tablet's role was revoked in setUp.
        vm.expectRevert(
            abi.encodeWithSelector(TerminalAdmission.TerminalNotAuthorized.selector, lostTabletNode, operatorB)
        );
        _admit(admission, merchantNode, lostTabletNode, operatorB, bytes32(uint256(2)));
    }

    // ── 3. role stands but the status text says otherwise ───────────────────────────────────────

    function test_RoleStandsButTextNotActive_TerminalNotActive() public {
        // Control: chair-1 is active and operatorA's role is intact.
        _admit(admission, merchantNode, chair1Node, operatorA, bytes32(uint256(1)));

        // The merchant changes the status text; operatorA's SET_TEXT grant is untouched.
        vm.prank(merchant);
        ens.setText(chair1Node, STATUS_KEY, "maintenance");

        vm.expectRevert(abi.encodeWithSelector(TerminalAdmission.TerminalNotActive.selector, chair1Node, "maintenance"));
        _admit(admission, merchantNode, chair1Node, operatorA, bytes32(uint256(2)));
    }

    // ── 4. wrong ENS deployment id ───────────────────────────────────────────────────────────────

    function test_WrongEnsDeployment_Refused() public {
        // Control: the correct id succeeds.
        _admit(admission, merchantNode, chair1Node, operatorA, bytes32(uint256(1)));

        bytes32 wrongId = keccak256("some-other-deployment");
        vm.prank(operatorA);
        vm.expectRevert(
            abi.encodeWithSelector(TerminalAdmission.WrongEnsDeployment.selector, ENS_DEPLOYMENT_ID, wrongId)
        );
        admission.requestOrder(
            merchantNode,
            chair1Node,
            wrongId,
            address(executor),
            payoutAddr,
            payer,
            AMOUNT_IN,
            MIN_OUT,
            DEADLINE,
            bytes32(uint256(2))
        );
    }

    // ── 5. a terminal under another merchant ────────────────────────────────────────────────────

    function test_TerminalUnderAnotherMerchant_Refused() public {
        bytes32 otherMerchantNode = ens.register(unicaNode, "otherco", operatorC);
        quotedPayout[otherMerchantNode] = makeAddr("otherPayout");
        vm.startPrank(operatorC);
        ens.setAddr(otherMerchantNode, makeAddr("otherPayout"));
        bytes32 otherTerminals = ens.register(otherMerchantNode, "terminals", operatorC);
        bytes32 otherChair = ens.register(otherTerminals, "till-1", operatorC);
        ens.authorizeTextRoles(otherChair, STATUS_KEY, operatorC, true);
        ens.setText(otherChair, STATUS_KEY, "active");
        vm.stopPrank();

        // Control: operatorC admits correctly against ITS OWN merchant node.
        _admit(admission, otherMerchantNode, otherChair, operatorC, bytes32(uint256(1)));

        // Negative: the same terminal, claimed under the WRONG merchant node.
        vm.expectRevert(
            abi.encodeWithSelector(TerminalAdmission.TerminalNotUnderMerchant.selector, otherChair, merchantNode)
        );
        _admit(admission, merchantNode, otherChair, operatorC, bytes32(uint256(2)));
    }

    // ── 6. a terminal operator cannot transfer the merchant name ────────────────────────────────

    function test_OperatorCannotTransferMerchantName() public {
        // Control: the merchant itself can transfer a disposable leaf it owns.
        vm.startPrank(merchant);
        bytes32 spareNode = ens.register(merchantNode, "spare", merchant);
        ens.transferFrom(merchant, attacker, spareNode);
        vm.stopPrank();
        assertEq(ens.ownerOf(spareNode), attacker);

        // Negative: operatorA holds no role anywhere on the merchant's own name.
        vm.prank(operatorA);
        vm.expectRevert(LocalEnsV2Fixture.NotOwner.selector);
        ens.transferFrom(merchant, attacker, merchantNode);
    }

    // ── 7. cannot setResolver on the merchant node ──────────────────────────────────────────────

    function test_OperatorCannotSetResolverOnMerchantNode() public {
        address newResolver = makeAddr("newResolver");
        // Read BEFORE pranking: `vm.prank` arms only the very next call, and an inline `ens.XXX()`
        // read used while building the pranked call's own arguments would silently consume it,
        // leaving the real call to run as this test contract instead of the intended sender.
        uint256 setResolverRole = ens.ROLE_SET_RESOLVER();

        // Control: the merchant can.
        vm.prank(merchant);
        ens.setResolver(merchantNode, newResolver);
        assertEq(ens.resolverOf(merchantNode), newResolver);

        // Negative: the terminal operator cannot.
        vm.prank(operatorA);
        vm.expectRevert(
            abi.encodeWithSelector(
                LocalEnsV2Fixture.EACUnauthorizedAccountRoles.selector,
                uint256(merchantNode),
                setResolverRole,
                operatorA
            )
        );
        ens.setResolver(merchantNode, makeAddr("hijackResolver"));
    }

    // ── 8. cannot setSubregistry on the merchant node ───────────────────────────────────────────

    function test_OperatorCannotSetSubregistry() public {
        address newSub = makeAddr("newSubregistry");
        uint256 setSubregistryRole = ens.ROLE_SET_SUBREGISTRY(); // see note in the previous test

        // Control: the merchant can.
        vm.prank(merchant);
        ens.setSubregistry(merchantNode, newSub);
        assertEq(ens.subregistryOf(merchantNode), newSub);

        // Negative.
        vm.prank(operatorA);
        vm.expectRevert(
            abi.encodeWithSelector(
                LocalEnsV2Fixture.EACUnauthorizedAccountRoles.selector,
                uint256(merchantNode),
                setSubregistryRole,
                operatorA
            )
        );
        ens.setSubregistry(merchantNode, makeAddr("hijackSubregistry"));
    }

    // ── 9. cannot register a peer terminal under terminals.* ────────────────────────────────────

    function test_OperatorCannotRegisterPeerTerminal() public {
        uint256 setSubregistryRole = ens.ROLE_SET_SUBREGISTRY(); // see note above

        // Control: the merchant can register a new terminal.
        vm.prank(merchant);
        bytes32 chair2 = ens.register(terminalsNode, "chair-2", merchant);
        assertEq(ens.ownerOf(chair2), merchant);

        // Negative: the terminal operator cannot.
        vm.prank(operatorA);
        vm.expectRevert(
            abi.encodeWithSelector(
                LocalEnsV2Fixture.EACUnauthorizedAccountRoles.selector,
                uint256(terminalsNode),
                setSubregistryRole,
                operatorA
            )
        );
        ens.register(terminalsNode, "chair-3", operatorA);
    }

    // ── 10. cannot setAddr on the merchant node ─────────────────────────────────────────────────

    function test_OperatorCannotSetAddrOnMerchantNode() public {
        address newPayout = makeAddr("newPayout");
        uint256 setAddrRole = ens.ROLE_SET_ADDR(); // see note above

        // Control: the merchant can change its own payout address.
        vm.prank(merchant);
        ens.setAddr(merchantNode, newPayout);
        assertEq(ens.addr(merchantNode), newPayout);

        // Negative.
        vm.prank(operatorA);
        vm.expectRevert(
            abi.encodeWithSelector(
                LocalEnsV2Fixture.EACUnauthorizedAccountRoles.selector, uint256(merchantNode), setAddrRole, operatorA
            )
        );
        ens.setAddr(merchantNode, attacker);
    }

    // ── 11. cannot authorizeTextRoles for another account ───────────────────────────────────────

    function test_OperatorCannotAuthorizeTextRolesForAnother() public {
        // Control: the merchant, holding admin(SET_TEXT) at chair-1, can grant a new account.
        vm.prank(merchant);
        ens.authorizeTextRoles(chair1Node, STATUS_KEY, attacker, true);
        assertTrue(ens.hasRoles(ens.textResource(chair1Node, STATUS_KEY), ens.ROLE_SET_TEXT(), attacker));

        // Negative: operatorA holds only the REGULAR SET_TEXT bit at the per-key resource, never
        // the admin bit at the node resource that authorizeTextRoles requires.
        uint256 adminBit = ens.ROLE_SET_TEXT() << ens.ADMIN_SHIFT();
        vm.prank(operatorA);
        vm.expectRevert(
            abi.encodeWithSelector(
                LocalEnsV2Fixture.EACUnauthorizedAccountRoles.selector, uint256(chair1Node), adminBit, operatorA
            )
        );
        ens.authorizeTextRoles(chair1Node, STATUS_KEY, attacker, true);
    }

    // ── 12. cannot change merchant admin ─────────────────────────────────────────────────────────

    function test_OperatorCannotChangeMerchantAdmin() public {
        // Read every constant BEFORE pranking (see the note in the setResolver test above) — in
        // particular, the ACTUAL pranked call below must never itself contain an `ens.XXX()` read
        // in its argument list, or that read becomes "the next call" instead of the intended one.
        uint256 transferAdminRole = ens.ROLE_CAN_TRANSFER_ADMIN();
        uint256 adminMask = type(uint256).max << ens.ADMIN_SHIFT();
        uint256 adminNeeded = transferAdminRole & adminMask;

        // Control: the merchant (owner) can extend an admin bit via authorizeNameRoles.
        vm.prank(merchant);
        ens.authorizeNameRoles(merchantNode, transferAdminRole, attacker, true);
        assertTrue(ens.hasRoles(uint256(merchantNode), transferAdminRole, attacker));

        // Negative: operatorA holds no admin bit at the merchant's own resource at all. (Shifting
        // `transferAdminRole` — already bit 156 — left by another 128 pushes it off the top of a
        // uint256 entirely, to 0; `authorizeNameRoles`'s OWN admin-bit-in-the-bitmap guard is what
        // actually refuses this call, and its revert names the bitmap masked to its admin bits,
        // i.e. `transferAdminRole` itself.)
        vm.prank(operatorA);
        vm.expectRevert(
            abi.encodeWithSelector(
                LocalEnsV2Fixture.EACUnauthorizedAccountRoles.selector, uint256(merchantNode), adminNeeded, operatorA
            )
        );
        ens.authorizeNameRoles(merchantNode, transferAdminRole, operatorA, true);
    }

    // ── 13. revocation after admission does not rewrite an existing order ──────────────────────

    function test_RevocationAfterAdmission_DoesNotRewriteExistingOrder() public {
        bytes32 salt = bytes32(uint256(1));
        bytes32 orderId = _admit(admission, merchantNode, chair1Node, operatorA, salt);

        TerminalAdmission.AdmissionRecord memory before = admission.admissionOf(orderId);
        UnicaMarketTypes.Order memory orderBefore = executor.orders(orderId);

        vm.startPrank(merchant);
        ens.authorizeTextRoles(chair1Node, STATUS_KEY, operatorA, false);
        ens.setText(chair1Node, STATUS_KEY, "revoked");
        vm.stopPrank();

        TerminalAdmission.AdmissionRecord memory afterRevocation = admission.admissionOf(orderId);
        UnicaMarketTypes.Order memory orderAfter = executor.orders(orderId);

        assertEq(afterRevocation.merchantNode, before.merchantNode);
        assertEq(afterRevocation.terminalNode, before.terminalNode);
        assertEq(afterRevocation.operator, before.operator);
        assertEq(afterRevocation.recipientAtAdmission, before.recipientAtAdmission);
        assertEq(afterRevocation.orderNonce, before.orderNonce);
        assertEq(orderAfter.recipient, orderBefore.recipient);
        assertEq(orderAfter.payer, orderBefore.payer);
        assertEq(orderAfter.amountIn, orderBefore.amountIn);
        assertEq(uint8(orderAfter.status), uint8(orderBefore.status));

        // And going forward, the revoked operator can no longer admit a NEW order.
        vm.expectRevert(abi.encodeWithSelector(TerminalAdmission.TerminalNotAuthorized.selector, chair1Node, operatorA));
        _admit(admission, merchantNode, chair1Node, operatorA, bytes32(uint256(2)));
    }

    // ── 14. changing the merchant's addr after admission doesn't change the order recipient ────

    function test_ChangingMerchantAddrAfterAdmission_DoesNotChangeOrderRecipient() public {
        bytes32 orderId = _admit(admission, merchantNode, chair1Node, operatorA, bytes32(uint256(1)));
        assertEq(executor.orders(orderId).recipient, payoutAddr);

        address newPayout = makeAddr("newPayoutAfterAdmission");
        vm.prank(merchant);
        ens.setAddr(merchantNode, newPayout);

        assertEq(ens.addr(merchantNode), newPayout, "the mutable ENS record DID change");
        assertEq(executor.orders(orderId).recipient, payoutAddr, "the already-created order must NOT");
    }

    // ── 15. an agent subname cannot admit orders and cannot set the terminal's key ─────────────

    function test_AgentSubname_CannotAdmitOrders_CannotSetTerminalKey() public {
        // Control: the agent CAN write the one key it was actually authorized for.
        vm.prank(agentKey);
        ens.setText(agentNode, AGENT_STATUS_KEY, "idle");
        assertEq(ens.text(agentNode, AGENT_STATUS_KEY), "idle");

        // Negative 1: the agent's own leaf is a direct child of the merchant, not of
        // `terminals.<merchant>`, so it can never satisfy `parentOf(parentOf(x)) == merchantNode`.
        vm.expectRevert(
            abi.encodeWithSelector(TerminalAdmission.TerminalNotUnderMerchant.selector, agentNode, merchantNode)
        );
        _admit(admission, merchantNode, agentNode, agentKey, bytes32(uint256(1)));

        // Negative 2: even ignoring that, the agent never holds SET_TEXT on
        // `com.unica.terminal-status` — only on `com.unica.agent-status`. Both reads happen BEFORE
        // pranking, for the same reason noted in the setResolver test above.
        uint256 terminalStatusResource = ens.textResource(agentNode, STATUS_KEY);
        uint256 setTextRole = ens.ROLE_SET_TEXT();
        vm.prank(agentKey);
        vm.expectRevert(
            abi.encodeWithSelector(
                LocalEnsV2Fixture.EACUnauthorizedAccountRoles.selector, terminalStatusResource, setTextRole, agentKey
            )
        );
        ens.setText(agentNode, STATUS_KEY, "active");
    }

    // ── 16. soulbound: revoking transfer-admin blocks the owner's own transferFrom ─────────────

    function test_Soulbound_RevokeTransferAdminBlocksOwnTransfer() public {
        // Control: before revocation, the merchant CAN transfer a disposable leaf.
        vm.startPrank(merchant);
        bytes32 spareNode = ens.register(merchantNode, "spare", merchant);
        ens.transferFrom(merchant, attacker, spareNode);
        assertEq(ens.ownerOf(spareNode), attacker);

        // Negative: after revoking transfer-admin on the merchant's own node, even the owner is
        // refused.
        ens.revokeTransferAdmin(merchantNode);
        vm.stopPrank();

        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(LocalEnsV2Fixture.TransferAdminRevoked.selector, merchantNode));
        ens.transferFrom(merchant, attacker, merchantNode);
    }

    // ── 17. the optional policy gate ────────────────────────────────────────────────────────────

    function test_PolicyGate_FalseRefuses_TrueAdmits() public {
        bytes32 salt = bytes32(uint256(1));

        policyDouble.setAdmitted(false);
        vm.expectRevert(abi.encodeWithSelector(TerminalAdmission.PolicyNotAuthorized.selector, salt));
        _admit(admissionWithPolicy, merchantNode, chair1Node, operatorA, salt);

        policyDouble.setAdmitted(true);
        bytes32 orderId = _admit(admissionWithPolicy, merchantNode, chair1Node, operatorA, salt);
        assertEq(orderId, _expectedOrderId(address(admissionWithPolicy), chair1Node, salt));
    }

    function test_PolicyGate_ZeroPolicySkipsGate() public {
        // `admission` was constructed with policyReceiver = address(0); PolicyDouble is never
        // touched, and admission still succeeds.
        assertEq(address(admission.POLICY()), address(0));
        bytes32 orderId = _admit(admission, merchantNode, chair1Node, operatorA, bytes32(uint256(1)));
        assertTrue(orderId != bytes32(0));
    }

    // ── 18. textResource, computed independently of the contract under test ────────────────────

    function test_TextResource_MatchesIndependentDerivation() public view {
        bytes32 independent = keccak256(abi.encode(chair1Node, keccak256(bytes(STATUS_KEY))));
        assertEq(ens.textResource(chair1Node, STATUS_KEY), uint256(independent));
    }

    // ── review finding 2: an executor the registry does not know is refused ────────────────────

    function test_UnregisteredExecutor_Refused() public {
        ExecutorDouble stub =
            new ExecutorDouble(makeAddr("hook2"), makeAddr("registry2"), MARKET_ID, ASSET_TOKEN, PAYOUT_TOKEN);
        vm.prank(operatorA);
        vm.expectRevert(abi.encodeWithSelector(TerminalAdmission.ExecutorNotRegistered.selector, address(stub)));
        admission.requestOrder(
            merchantNode,
            chair1Node,
            ENS_DEPLOYMENT_ID,
            address(stub),
            payoutAddr,
            payer,
            AMOUNT_IN,
            MIN_OUT,
            DEADLINE,
            bytes32(uint256(77))
        );
        // control: the vouched executor is admitted with the same terms
        _admit(admission, merchantNode, chair1Node, operatorA, bytes32(uint256(78)));
    }

    // ── review finding 3: the quoted recipient must equal the resolved one ─────────────────────

    function test_RecipientChangedBetweenQuoteAndAdmission_Refused() public {
        address moved = makeAddr("moved payout");
        vm.prank(merchant);
        ens.setAddr(merchantNode, moved);
        vm.prank(operatorA);
        vm.expectRevert(abi.encodeWithSelector(TerminalAdmission.RecipientMismatch.selector, payoutAddr, moved));
        admission.requestOrder(
            merchantNode,
            chair1Node,
            ENS_DEPLOYMENT_ID,
            address(executor),
            payoutAddr,
            payer,
            AMOUNT_IN,
            MIN_OUT,
            DEADLINE,
            bytes32(uint256(79))
        );
        // control: quoting the record as it now stands is admitted
        vm.prank(operatorA);
        bytes32 id = admission.requestOrder(
            merchantNode,
            chair1Node,
            ENS_DEPLOYMENT_ID,
            address(executor),
            moved,
            payer,
            AMOUNT_IN,
            MIN_OUT,
            DEADLINE,
            bytes32(uint256(80))
        );
        assertEq(admission.admissionOf(id).recipientAtAdmission, moved);
    }
}
