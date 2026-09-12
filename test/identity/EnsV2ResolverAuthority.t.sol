// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// LOCAL ROWS for the REAL-DEPLOYMENT adapter. The resolver here is a STAND-IN written in this file,
// not the ENSv2 Sepolia one: these rows fix the adapter's own arithmetic, its lineage registry and
// its refusals, at a speed a fork cannot reach. Everything that depends on somebody else's live
// bytecode behaving as measured is in `test/fork/EnsV2AuthorityFork.t.sol` and is not claimed here.

import {Test} from "forge-std/Test.sol";
import {EnsV2ResolverAuthority} from "../../src/identity/EnsV2ResolverAuthority.sol";
import {TerminalAdmission} from "../../src/identity/TerminalAdmission.sol";
import {ExecutorDouble} from "./util/ExecutorDouble.sol";
import {RegistryDouble} from "./util/RegistryDouble.sol";

/// @title ResolverStandIn
/// @notice A settable stand-in for the measured PermissionedResolver surface: raw role storage,
///         `hasRoles` folding ROOT_RESOURCE, `text`, `addr`, and the one delegation primitive
///         (`authorizeTextRoles`) that grants SET_TEXT at the PER-KEY resource while checking the
///         caller's ADMIN bit at the NAME-LEVEL resource.
/// @dev Two shapes here are copied from the measurement rather than from convenience, because the
///      adapter's rows are only worth anything if the thing they run against behaves like the thing
///      the adapter will meet:
///        - `nameResource(node)` is `keccak256(abi.encode(node, bytes32(0)))`, NOT `uint256(node)`.
///          The real resolver derives it that way (`profile.mjs` `resolverNameResource`) and the
///          difference is exactly the residual `isNamespaceController` documents.
///        - `hasRoles` folds whatever is held at ROOT_RESOURCE into every resource, which is what
///          makes a per-name resolver proxy's owner answer true everywhere.
///      It is a stand-in and not a model: it has no assignee cap, no admin-role one-shot, and its
///      `setRoles` lets a test write any bitmap at any resource, which no real caller can do.
contract ResolverStandIn {
    uint256 public constant ROOT_RESOURCE = 0;
    uint256 public constant ADMIN_SHIFT = 128;
    uint256 public constant ROLE_SET_ADDR = 1 << 0;
    uint256 public constant ROLE_SET_TEXT = 1 << 4;

    mapping(uint256 => mapping(address => uint256)) public roles;
    mapping(bytes32 => address) private _addr;
    mapping(bytes32 => mapping(string => string)) private _text;

    error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account);
    error EACCannotGrantRoles(uint256 resource, uint256 roleBitmap, address account);

    function setRoles(uint256 resource, address account, uint256 bitmap) external {
        roles[resource][account] = bitmap;
    }

    function nameResource(bytes32 node) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(node, bytes32(0))));
    }

    function textResource(bytes32 node, string memory key) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(node, keccak256(bytes(key)))));
    }

    function hasRoles(uint256 resource, uint256 roleBitmap, address account) public view returns (bool) {
        uint256 held = roles[resource][account];
        if (resource != ROOT_RESOURCE) held |= roles[ROOT_RESOURCE][account];
        return held & roleBitmap == roleBitmap;
    }

    function hasRootRoles(uint256 roleBitmap, address account) external view returns (bool) {
        return roles[ROOT_RESOURCE][account] & roleBitmap == roleBitmap;
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return _text[node][key];
    }

    function addr(bytes32 node) external view returns (address) {
        return _addr[node];
    }

    function setAddr(bytes32 node, address a) external {
        uint256 nr = nameResource(node);
        if (!hasRoles(nr, ROLE_SET_ADDR, msg.sender)) {
            revert EACUnauthorizedAccountRoles(nr, ROLE_SET_ADDR, msg.sender);
        }
        _addr[node] = a;
    }

    function setText(bytes32 node, string calldata key, string calldata value) external {
        uint256 perKey = textResource(node, key);
        bool ok = hasRoles(perKey, ROLE_SET_TEXT, msg.sender) || hasRoles(nameResource(node), ROLE_SET_TEXT, msg.sender);
        if (!ok) revert EACUnauthorizedAccountRoles(perKey, ROLE_SET_TEXT, msg.sender);
        _text[node][key] = value;
    }

    /// @dev The measured delegation: `adminRole(SET_TEXT)` at the name level is required of the
    ///      caller — the REGULAR bit is not enough — and SET_TEXT, only SET_TEXT, is written at the
    ///      per-key resource (`profile.mjs` `DELEGATION_MECHANISM`). The real call takes a
    ///      DNS-encoded name where this takes a node; the fork suite exercises the real signature.
    function authorizeTextRoles(bytes32 node, string calldata key, address account, bool grant) external {
        uint256 nr = nameResource(node);
        uint256 adminBit = ROLE_SET_TEXT << ADMIN_SHIFT;
        if (!hasRoles(nr, adminBit, msg.sender)) revert EACCannotGrantRoles(nr, ROLE_SET_TEXT, msg.sender);
        uint256 perKey = textResource(node, key);
        if (grant) {
            roles[perKey][account] |= ROLE_SET_TEXT;
        } else {
            roles[perKey][account] &= ~ROLE_SET_TEXT;
        }
    }
}

/// @dev An address that holds code but answers nothing — used to prove the constructor's code check
///      passes on code rather than on a name, and never reached by a row that expects an answer.
contract Bystander {
    uint256 public marker = 1;
}

contract EnsV2ResolverAuthorityTest is Test {
    // Redeclared with the adapter's exact signature so `vm.expectEmit` can match it.
    event LineageRegistered(bytes32 indexed child, bytes32 indexed parent, string label);

    ResolverStandIn internal resolver;
    EnsV2ResolverAuthority internal authority;
    TerminalAdmission internal admission;
    ExecutorDouble internal executor;
    RegistryDouble internal registryDouble;

    address internal merchant = makeAddr("merchant");
    address internal operatorA = makeAddr("operatorA");
    address internal operatorB = makeAddr("operatorB");
    address internal payer = makeAddr("payer");
    address internal payoutAddr = makeAddr("merchantPayout");
    address internal stranger = makeAddr("stranger");

    bytes32 internal ethNode;
    bytes32 internal unicaNode;
    bytes32 internal merchantNode;
    bytes32 internal terminalsNode;
    bytes32 internal chair1Node;
    bytes32 internal lostTabletNode;

    bytes32 internal constant ENS_DEPLOYMENT_ID = keccak256("unica-ensv2-sepolia-adapter-v1");
    string internal constant STATUS_KEY = "com.unica.terminal-status";

    bytes32 internal constant MARKET_ID = keccak256("test-market");
    uint128 internal constant AMOUNT_IN = 100e6;
    uint128 internal constant MIN_OUT = 99e6;
    uint64 internal DEADLINE;

    uint256 internal constant ROLE_SET_ADDR = 1 << 0;
    uint256 internal constant ROLE_SET_TEXT = 1 << 4;
    uint256 internal constant ADMIN_SHIFT = 128;

    /// @dev The lineage registry's own derivation, written out here instead of imported, so a row
    ///      that compares the two is comparing two computations rather than one.
    function _child(bytes32 parent, string memory label) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(parent, keccak256(bytes(label))));
    }

    function setUp() public {
        DEADLINE = uint64(block.timestamp + 1 days);

        resolver = new ResolverStandIn();
        authority = new EnsV2ResolverAuthority(address(resolver));

        ethNode = _child(bytes32(0), "eth");
        unicaNode = _child(ethNode, "unica");
        merchantNode = _child(unicaNode, "freshcuts");
        terminalsNode = _child(merchantNode, "terminals");
        chair1Node = _child(terminalsNode, "chair-1");
        lostTabletNode = _child(terminalsNode, "lost-tablet");

        // Lineage: permissionless, so anyone may state it. This test contract does.
        authority.registerLineage(bytes32(0), "eth");
        authority.registerLineage(ethNode, "unica");
        authority.registerLineage(unicaNode, "freshcuts");
        authority.registerLineage(merchantNode, "terminals");
        authority.registerLineage(terminalsNode, "chair-1");
        authority.registerLineage(terminalsNode, "lost-tablet");

        // The merchant's authority is held at ROOT_RESOURCE, which is the shape measured on the
        // live deployment: on a per-name resolver proxy the owner holds every role at ROOT and
        // nothing at the name resource.
        resolver.setRoles(0, merchant, ROLE_SET_ADDR | ROLE_SET_TEXT | ((ROLE_SET_ADDR | ROLE_SET_TEXT) << ADMIN_SHIFT));

        vm.startPrank(merchant);
        resolver.setAddr(merchantNode, payoutAddr);
        resolver.authorizeTextRoles(chair1Node, STATUS_KEY, operatorA, true);
        resolver.authorizeTextRoles(lostTabletNode, STATUS_KEY, operatorB, true);
        vm.stopPrank();

        // Each operator publishes its own status under the key it was delegated.
        vm.prank(operatorA);
        resolver.setText(chair1Node, STATUS_KEY, "active");
        vm.prank(operatorB);
        resolver.setText(lostTabletNode, STATUS_KEY, "active");

        // ...and lost-tablet is then revoked: the grant pulled and the text overwritten.
        vm.prank(merchant);
        resolver.authorizeTextRoles(lostTabletNode, STATUS_KEY, operatorB, false);
        vm.prank(merchant);
        resolver.setText(lostTabletNode, STATUS_KEY, "revoked");

        executor = new ExecutorDouble(
            makeAddr("hook"), makeAddr("registry"), MARKET_ID, makeAddr("assetToken"), makeAddr("payoutToken")
        );
        registryDouble = new RegistryDouble();
        registryDouble.vouch(address(executor), MARKET_ID);
        admission = new TerminalAdmission(
            address(authority), address(registryDouble), ENS_DEPLOYMENT_ID, address(0), STATUS_KEY
        );
    }

    // ── construction ─────────────────────────────────────────────────────────────────────────────

    function test_constructor_refusesZeroResolver() public {
        vm.expectRevert(EnsV2ResolverAuthority.ZeroResolver.selector);
        new EnsV2ResolverAuthority(address(0));
    }

    function test_constructor_refusesCodelessResolver() public {
        address empty = makeAddr("anEOA");
        assertEq(empty.code.length, 0, "the control is only a control if the address really has no code");
        vm.expectRevert(abi.encodeWithSelector(EnsV2ResolverAuthority.ResolverHasNoCode.selector, empty));
        new EnsV2ResolverAuthority(empty);

        // CONTROL: an address that does have code is accepted, so the refusal above is about code
        // and not about the address being unfamiliar.
        address withCode = address(new Bystander());
        EnsV2ResolverAuthority ok = new EnsV2ResolverAuthority(withCode);
        assertEq(address(ok.RESOLVER()), withCode, "a code-carrying resolver was not accepted");
    }

    // ── forwarding ───────────────────────────────────────────────────────────────────────────────

    function test_forwardsHasRolesTextAndAddr() public view {
        // addr and text come back byte-identical to what the resolver holds.
        assertEq(authority.addr(merchantNode), payoutAddr, "addr was not forwarded");
        assertEq(authority.addr(chair1Node), address(0), "a name with no addr record must read zero");
        assertEq(authority.text(chair1Node, STATUS_KEY), "active", "text was not forwarded");
        assertEq(authority.text(lostTabletNode, STATUS_KEY), "revoked", "text was not forwarded");
        assertEq(authority.text(chair1Node, "com.unica.unset"), "", "an unset key must read empty");

        // hasRoles is forwarded including the ROOT_RESOURCE fold, which is the whole reason the
        // interface insists on this read rather than on roles().
        uint256 perKey = authority.textResource(chair1Node, STATUS_KEY);
        assertTrue(authority.hasRoles(perKey, ROLE_SET_TEXT, operatorA), "the delegated operator must read true");
        assertFalse(authority.hasRoles(perKey, ROLE_SET_TEXT, operatorB), "a stranger to this key must read false");
        assertTrue(
            authority.hasRoles(perKey, ROLE_SET_TEXT, merchant),
            "the merchant holds SET_TEXT at ROOT and hasRoles must fold it in at every resource"
        );
        assertEq(
            resolver.roles(perKey, merchant),
            0,
            "the fold is the point: roles() at this resource is zero for the merchant"
        );
    }

    // ── the per-key resource ─────────────────────────────────────────────────────────────────────

    function test_textResourceMatchesTheIndependentFormula() public view {
        uint256 fromAdapter = authority.textResource(chair1Node, STATUS_KEY);
        uint256 independent = uint256(keccak256(abi.encode(chair1Node, keccak256(bytes(STATUS_KEY)))));
        assertEq(fromAdapter, independent, "the adapter's per-key resource is not the measured derivation");

        // It must not collide with any of the three numbers it is easiest to confuse it with, and
        // each of those was a real mistake somewhere in this repository's history.
        assertTrue(fromAdapter != uint256(chair1Node), "the per-key resource must not be the node");
        assertTrue(
            fromAdapter != uint256(keccak256(abi.encode(chair1Node, bytes32(0)))),
            "the per-key resource must not be the name-level resource"
        );
        assertTrue(
            fromAdapter != authority.textResource(chair1Node, "com.unica.agent-status"),
            "two keys on one name must not share a resource"
        );
        assertTrue(
            fromAdapter != authority.textResource(lostTabletNode, STATUS_KEY),
            "one key on two names must not share a resource"
        );
        // WRITTEN AS A DIFFERENCE FIRST, AND THE TEST REFUTED IT. This row originally asserted that
        // the `abi.encodePacked` form is a DIFFERENT number, on the strength of the addr-scope
        // mistake recorded in profile.mjs. It is not: both operands here are `bytes32`, which
        // `abi.encode` does not pad and does not prefix, so the two encodings are byte-identical
        // and the assertion failed. Kept as an equality with the reason attached, because the real
        // lesson survives in a different place — the packed/encoded distinction bites on the SCOPE
        // HASH (`keccak256(abi.encode(uint256(coinType)))`, not `bytes32(coinType)`), not on this
        // concatenation of two words.
        assertEq(
            fromAdapter,
            uint256(keccak256(abi.encodePacked(chair1Node, keccak256(bytes(STATUS_KEY))))),
            "two bytes32 operands encode identically packed or not; if this ever diverges, solc changed"
        );
    }

    // ── lineage ──────────────────────────────────────────────────────────────────────────────────

    function test_lineageRegistrationIsTheNamehashRecursion() public {
        bytes32 expected = _child(terminalsNode, "chair-2");
        vm.expectEmit(true, true, false, true, address(authority));
        emit LineageRegistered(expected, terminalsNode, "chair-2");
        bytes32 child = authority.registerLineage(terminalsNode, "chair-2");

        assertEq(child, expected, "the returned child is not the namehash recursion");
        assertEq(authority.parentOf(child), terminalsNode, "parentOf was not recorded");
        assertEq(authority.labelOf(child), "chair-2", "labelOf was not recorded");
        assertTrue(authority.lineageKnown(child), "the lineage must be marked known");

        // An unregistered node is distinguishable from a root name only by lineageKnown.
        bytes32 unknown = _child(terminalsNode, "never-registered");
        assertEq(authority.parentOf(unknown), bytes32(0), "an unregistered node must report a zero parent");
        assertFalse(authority.lineageKnown(unknown), "an unregistered node must not be marked known");
        assertTrue(authority.lineageKnown(ethNode), "a root name IS known, and its parent is genuinely zero");
        assertEq(authority.parentOf(ethNode), bytes32(0), "a root name's parent is zero");
    }

    function test_lineageGrandparentChainResolves() public view {
        // The exact read TerminalAdmission makes: two hops up from the terminal is the merchant.
        assertEq(authority.parentOf(chair1Node), terminalsNode, "one hop up is terminals.");
        assertEq(
            authority.parentOf(authority.parentOf(chair1Node)),
            merchantNode,
            "two hops up from the terminal must be the merchant"
        );
        assertTrue(
            authority.parentOf(authority.parentOf(lostTabletNode)) == merchantNode,
            "the second terminal must sit under the same merchant"
        );
        // ...and a name one level short of the pattern must NOT satisfy it.
        assertTrue(
            authority.parentOf(authority.parentOf(terminalsNode)) != merchantNode,
            "terminals. itself must not read as a terminal under the merchant"
        );
    }

    function test_lineageRepeatedRegistrationIsIdempotent() public {
        bytes32 first = authority.registerLineage(terminalsNode, "chair-1");
        assertEq(first, chair1Node, "a repeat registration must return the same child");
        assertEq(authority.parentOf(chair1Node), terminalsNode, "a repeat must not disturb the record");

        // Anyone may state the same fact, including a caller with no relationship to the name.
        vm.prank(stranger);
        bytes32 again = authority.registerLineage(terminalsNode, "chair-1");
        assertEq(again, chair1Node, "the registry is permissionless and idempotent");
    }

    /// @dev SABOTAGE ROW. `registerLineage` derives the child from the pair it is given, so the
    ///      disagreement guard cannot be reached through the public interface without a keccak
    ///      collision. A guard that can never fire is not a guard, so the conflicting record is
    ///      planted directly in the adapter's storage — and the plant is VERIFIED through the
    ///      adapter's own reader before the refusal is expected, so a wrong slot fails this test
    ///      loudly instead of letting it pass on an unplanted contract.
    function test_lineageDisagreementIsRefused_parentPlanted() public {
        bytes32 forgedParent = keccak256("a parent this child never had");
        // slot 0 is `_parent`, the first declared mapping.
        vm.store(address(authority), keccak256(abi.encode(chair1Node, uint256(0))), forgedParent);
        assertEq(authority.parentOf(chair1Node), forgedParent, "the sabotage did not land; the slot is wrong");

        vm.expectRevert(
            abi.encodeWithSelector(
                EnsV2ResolverAuthority.LineageDisagrees.selector, chair1Node, forgedParent, terminalsNode
            )
        );
        authority.registerLineage(terminalsNode, "chair-1");
    }

    /// @dev The same guard's second clause: the parent agrees and the LABEL does not.
    function test_lineageDisagreementIsRefused_labelPlanted() public {
        // slot 1 is `_label`. A string of 31 bytes or fewer lives in one word: the bytes
        // left-aligned, with twice the length in the lowest byte.
        bytes memory forged = bytes("chair-9");
        bytes32 word;
        assembly {
            word := mload(add(forged, 32))
        }
        word |= bytes32(forged.length * 2);
        vm.store(address(authority), keccak256(abi.encode(chair1Node, uint256(1))), word);
        assertEq(authority.labelOf(chair1Node), "chair-9", "the sabotage did not land; the slot is wrong");

        vm.expectRevert(
            abi.encodeWithSelector(
                EnsV2ResolverAuthority.LineageDisagrees.selector, chair1Node, terminalsNode, terminalsNode
            )
        );
        authority.registerLineage(terminalsNode, "chair-1");
    }

    function test_lineageRefusesAnEmptyLabel() public {
        vm.expectRevert(EnsV2ResolverAuthority.EmptyLabel.selector);
        authority.registerLineage(terminalsNode, "");
    }

    // ── namespace control ────────────────────────────────────────────────────────────────────────

    function test_isNamespaceControllerNeedsBothAdminBits() public {
        address delegate = makeAddr("partialDelegate");
        uint256 nodeResource = uint256(merchantNode);

        // Nothing held: false.
        assertFalse(authority.isNamespaceController(merchantNode, delegate), "an account with nothing must read false");

        // Both REGULAR bits, no admin: still false. This is the row that says the function is
        // asking about administration and not about record-writing.
        resolver.setRoles(nodeResource, delegate, ROLE_SET_ADDR | ROLE_SET_TEXT);
        assertFalse(
            authority.isNamespaceController(merchantNode, delegate), "the regular bits must not read as control"
        );

        // One admin bit only (SET_TEXT): still false — the "either" answer would say true here.
        resolver.setRoles(nodeResource, delegate, ROLE_SET_TEXT << ADMIN_SHIFT);
        assertFalse(
            authority.isNamespaceController(merchantNode, delegate),
            "adminRole(SET_TEXT) alone is a partial delegate, not the namespace controller"
        );

        // The other admin bit only (SET_ADDR): still false.
        resolver.setRoles(nodeResource, delegate, ROLE_SET_ADDR << ADMIN_SHIFT);
        assertFalse(
            authority.isNamespaceController(merchantNode, delegate), "adminRole(SET_ADDR) alone is not control either"
        );

        // Both admin bits: true.
        resolver.setRoles(nodeResource, delegate, (ROLE_SET_ADDR | ROLE_SET_TEXT) << ADMIN_SHIFT);
        assertTrue(authority.isNamespaceController(merchantNode, delegate), "both admin bits must read as control");

        // And it is per-node: the same holder at one node is not the controller of another.
        assertFalse(
            authority.isNamespaceController(chair1Node, delegate), "control at one node must not leak to another"
        );
    }

    function test_isNamespaceControllerFoldsRootAndNotTheNameLevelResource() public {
        // The merchant's authority lives at ROOT_RESOURCE, and hasRoles folds it in everywhere —
        // which is how the live deployment is configured, measured on the fork.
        assertTrue(
            authority.isNamespaceController(merchantNode, merchant), "a ROOT_RESOURCE holder controls every node"
        );

        // THE MEASURED RESIDUAL, made into a row rather than left in a comment. The resolver's own
        // NAME-LEVEL resource is keccak256(abi.encode(node, bytes32(0))); this function asks about
        // uint256(node). An account granted both admin bits at the name-level resource ONLY is
        // therefore reported as NOT the controller. On the live deployment that never bites,
        // because the owner's grant is at ROOT; on a shared resolver it would.
        address nameLevelOnly = makeAddr("nameLevelOnly");
        resolver.setRoles(
            resolver.nameResource(merchantNode), nameLevelOnly, (ROLE_SET_ADDR | ROLE_SET_TEXT) << ADMIN_SHIFT
        );
        assertTrue(
            resolver.hasRoles(
                resolver.nameResource(merchantNode), (ROLE_SET_ADDR | ROLE_SET_TEXT) << ADMIN_SHIFT, nameLevelOnly
            ),
            "the control: the resolver really does report this holder at the name-level resource"
        );
        assertFalse(
            authority.isNamespaceController(merchantNode, nameLevelOnly),
            "documented residual: uint256(node) is not the resolver's name-level resource"
        );
    }

    // ── ownerOf ──────────────────────────────────────────────────────────────────────────────────

    function test_ownerOfRefusesRatherThanFaking() public {
        vm.expectRevert(
            abi.encodeWithSelector(EnsV2ResolverAuthority.OwnerNotEnumerable.selector, address(resolver), merchantNode)
        );
        authority.ownerOf(merchantNode);

        // Even for a node whose lineage IS registered and whose records ARE set: there is no
        // enumeration on the resolver, so there is nothing to answer with.
        vm.expectRevert(
            abi.encodeWithSelector(EnsV2ResolverAuthority.OwnerNotEnumerable.selector, address(resolver), chair1Node)
        );
        authority.ownerOf(chair1Node);
    }

    // ── TerminalAdmission over the adapter ───────────────────────────────────────────────────────

    function test_terminalAdmissionAdmitsThroughTheAdapter() public {
        bytes32 salt = keccak256("order-1");
        bytes32 expectedId = keccak256(
            abi.encode(block.chainid, address(executor), address(admission), keccak256(abi.encode(chair1Node, salt)))
        );

        vm.prank(operatorA);
        bytes32 orderId = admission.requestOrder(
            merchantNode,
            chair1Node,
            ENS_DEPLOYMENT_ID,
            address(executor),
            payoutAddr,
            payer,
            AMOUNT_IN,
            MIN_OUT,
            DEADLINE,
            salt
        );

        assertEq(orderId, expectedId, "the admitted order id is not the executor's own derivation");
        assertEq(executor.callCount(), 1, "exactly one createOrder must have reached the executor");
        TerminalAdmission.AdmissionRecord memory rec = admission.admissionOf(orderId);
        assertEq(rec.operator, operatorA, "the admission record must name the operator that called");
        assertEq(rec.merchantNode, merchantNode, "the admission record must name the merchant");
        assertEq(rec.terminalNode, chair1Node, "the admission record must name the terminal");
        assertEq(rec.recipientAtAdmission, payoutAddr, "the recipient must be the merchant's resolved addr");
    }

    function test_terminalAdmissionRefusesARevokedTerminal() public {
        bytes32 salt = keccak256("order-2");

        // The revoked operator is refused on authority, before status is even consulted.
        vm.prank(operatorB);
        vm.expectRevert(
            abi.encodeWithSelector(TerminalAdmission.TerminalNotAuthorized.selector, lostTabletNode, operatorB)
        );
        admission.requestOrder(
            merchantNode,
            lostTabletNode,
            ENS_DEPLOYMENT_ID,
            address(executor),
            payoutAddr,
            payer,
            AMOUNT_IN,
            MIN_OUT,
            DEADLINE,
            salt
        );

        // A stranger holding nothing anywhere is refused the same way on the LIVE terminal, so the
        // refusal above is not "this terminal is broken".
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TerminalAdmission.TerminalNotAuthorized.selector, chair1Node, stranger));
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
            salt
        );

        assertEq(executor.callCount(), 0, "a refused admission must never reach the executor");
    }

    function test_terminalAdmissionRefusesAnUnregisteredLineage() public {
        // A terminal whose lineage nobody has stated reads parentOf == 0 twice, which is not the
        // merchant — so the gate refuses instead of admitting on an unproven tree.
        bytes32 orphan = _child(terminalsNode, "unstated");
        vm.prank(merchant);
        resolver.authorizeTextRoles(orphan, STATUS_KEY, operatorA, true);
        vm.prank(operatorA);
        resolver.setText(orphan, STATUS_KEY, "active");

        vm.prank(operatorA);
        vm.expectRevert(
            abi.encodeWithSelector(TerminalAdmission.TerminalNotUnderMerchant.selector, orphan, merchantNode)
        );
        admission.requestOrder(
            merchantNode,
            orphan,
            ENS_DEPLOYMENT_ID,
            address(executor),
            payoutAddr,
            payer,
            AMOUNT_IN,
            MIN_OUT,
            DEADLINE,
            keccak256("order-3")
        );

        // CONTROL: state the lineage and the identical call is admitted.
        authority.registerLineage(terminalsNode, "unstated");
        vm.prank(operatorA);
        admission.requestOrder(
            merchantNode,
            orphan,
            ENS_DEPLOYMENT_ID,
            address(executor),
            payoutAddr,
            payer,
            AMOUNT_IN,
            MIN_OUT,
            DEADLINE,
            keccak256("order-3")
        );
        assertEq(executor.callCount(), 1, "the control must reach the executor exactly once");
    }
}
