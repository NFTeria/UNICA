// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// LOCAL ENSv2-COMPATIBLE FIXTURE for Anvil integration tests. Not the isolated ENSv2 Sepolia
// deployment; mirrors its measured Enhanced Access Control shape (per-key text resources, role
// bitmaps, admin bits at +128) so the onboarding path can be tested end to end without a network.

import {Test} from "forge-std/Test.sol";
import {LocalEnsV2Fixture} from "../../src/identity/LocalEnsV2Fixture.sol";
import {IIdentityAuthority} from "../../src/identity/interfaces/IIdentityAuthority.sol";
import {IMerchantOnboarding} from "../../src/identity/IMerchantOnboarding.sol";
import {MerchantOnboarding} from "../../src/identity/MerchantOnboarding.sol";

/// @title IdentityBadgeDouble
/// @notice A Solidity stand-in for `vy/src/art/identity_token.vy`, used because forge does not
///         compile Vyper in this tree. It keeps the four rules `mint` enforces there, with the same
///         revert strings, so a test against this double fails for the same reasons the real badge
///         would: only `MINTER` may mint, the name must namehash to the node, the recipient must be
///         the node's namespace controller at mint time, and one node carries one badge. Nothing
///         about rendering or metadata is reproduced; it is not needed to prove onboarding.
contract IdentityBadgeDouble {
    address public immutable MINTER;
    IIdentityAuthority public immutable AUTHORITY;

    uint256 public total_minted;
    mapping(uint256 => bytes32) public node_of;
    mapping(uint256 => string) public name_of;
    mapping(bytes32 => uint256) public token_of_node;
    mapping(uint256 => address) private _owners;

    event Transfer(address indexed sender, address indexed receiver, uint256 indexed token_id);

    constructor(address minter, address authority) {
        MINTER = minter;
        AUTHORITY = IIdentityAuthority(authority);
    }

    function mint(address to, bytes32 node, string calldata normalizedName) external returns (uint256 tokenId) {
        require(msg.sender == MINTER, "IdentityToken: not minter");
        require(to != address(0), "IdentityToken: zero address");
        require(_namehash(bytes(normalizedName)) == node, "IdentityToken: namehash mismatch");
        require(AUTHORITY.isNamespaceController(node, to), "IdentityToken: not namespace controller");
        require(token_of_node[node] == 0, "IdentityToken: node already minted");

        total_minted += 1;
        tokenId = total_minted;
        node_of[tokenId] = node;
        name_of[tokenId] = normalizedName;
        token_of_node[node] = tokenId;
        _owners[tokenId] = to;
        emit Transfer(address(0), to, tokenId);
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "IdentityToken: nonexistent token");
        return owner;
    }

    /// @dev A second, independent namehash: labels split on '.', folded from the right. Written
    ///      here rather than imported from the contract under test, so the two cannot agree by
    ///      construction.
    function _namehash(bytes memory name) internal pure returns (bytes32 node) {
        uint256 n = name.length;
        uint256 labelEnd = n;
        uint256 i = n;
        while (i > 0) {
            i--;
            if (name[i] == ".") {
                node = keccak256(abi.encodePacked(node, keccak256(_copy(name, i + 1, labelEnd))));
                labelEnd = i;
            }
        }
        node = keccak256(abi.encodePacked(node, keccak256(_copy(name, 0, labelEnd))));
    }

    function _copy(bytes memory src, uint256 from, uint256 to) internal pure returns (bytes memory out) {
        out = new bytes(to - from);
        for (uint256 k = from; k < to; k++) {
            out[k - from] = src[k];
        }
    }
}

/// @title MerchantOnboardingTest
/// @notice The self-serve door end to end against the real `LocalEnsV2Fixture`: one business joins
///         and every post-condition is read back; every refusal in `IMerchantOnboarding` fires;
///         the parent grant is proven load-bearing by removing it; and after the join, the owner
///         alone can shape the tree while this contract's own address is refused by the fixture.
contract MerchantOnboardingTest is Test {
    LocalEnsV2Fixture internal ens;
    MerchantOnboarding internal onboarding;
    IdentityBadgeDouble internal badge;

    address internal admin = makeAddr("admin");
    address internal owner = makeAddr("businessOwner");
    address internal otherOwner = makeAddr("otherBusinessOwner");
    address internal stranger = makeAddr("stranger");
    address internal payout = makeAddr("payout");
    address internal secondOperator = makeAddr("secondOperator");

    bytes32 internal ethNode;
    bytes32 internal unicaNode;

    string internal constant PARENT_NAME = "unica.eth";
    string internal constant STATUS_KEY = "com.unica.terminal-status";
    string internal constant LABEL = "freshcuts";
    string internal constant TERMINAL = "chair-1";

    uint256 internal SET_SUBREGISTRY;
    uint256 internal SET_TEXT;

    function setUp() public {
        ens = new LocalEnsV2Fixture();
        SET_SUBREGISTRY = ens.ROLE_SET_SUBREGISTRY();
        SET_TEXT = ens.ROLE_SET_TEXT();

        ethNode = ens.createRoot("eth");
        unicaNode = ens.register(ethNode, "unica", address(this));

        onboarding = _deployDoor();
        badge = _linkFreshBadge(onboarding);
        _grantParent(onboarding);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    function _deployDoor() internal returns (MerchantOnboarding) {
        return new MerchantOnboarding(address(ens), unicaNode, PARENT_NAME, admin, STATUS_KEY);
    }

    function _linkFreshBadge(MerchantOnboarding door) internal returns (IdentityBadgeDouble b) {
        b = new IdentityBadgeDouble(address(door), address(ens));
        vm.prank(admin);
        door.linkBadge(address(b));
    }

    /// @dev The parent owner (this test contract) grants the door the one standing role it needs.
    function _grantParent(MerchantOnboarding door) internal {
        ens.authorizeNameRoles(unicaNode, SET_SUBREGISTRY, address(door), true);
    }

    function _node(bytes32 parent, string memory label) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(parent, keccak256(bytes(label))));
    }

    function _joinAs(address who, string memory label, address payoutAddr, string memory terminal)
        internal
        returns (bytes32 m, bytes32 t, bytes32 r, uint256 id)
    {
        vm.prank(who);
        (m, t, r, id) = onboarding.join(label, payoutAddr, terminal);
    }

    // ── 1. happy path, every post-condition read back ───────────────────────────────────────────

    function test_Join_HappyPath_EveryPostCondition() public {
        bytes32 expectedMerchant = _node(unicaNode, LABEL);
        bytes32 expectedTerminals = _node(expectedMerchant, "terminals");
        bytes32 expectedRegister = _node(expectedTerminals, TERMINAL);

        vm.expectEmit(true, true, true, true, address(onboarding));
        emit IMerchantOnboarding.BusinessJoined(
            expectedMerchant, owner, LABEL, payout, expectedTerminals, expectedRegister, 1
        );
        (bytes32 merchantNode, bytes32 terminalsNode, bytes32 registerNode, uint256 tokenId) =
            _joinAs(owner, LABEL, payout, TERMINAL);

        // Returned nodes are the namehash-derived ones.
        assertEq(merchantNode, expectedMerchant, "merchant node");
        assertEq(terminalsNode, expectedTerminals, "terminals node");
        assertEq(registerNode, expectedRegister, "register node");
        assertEq(tokenId, 1, "first badge");

        // Tree shape: register -> terminals -> merchant -> parent.
        assertEq(ens.parentOf(registerNode), terminalsNode);
        assertEq(ens.parentOf(terminalsNode), merchantNode);
        assertEq(ens.parentOf(merchantNode), unicaNode);

        // Ownership of all three nodes is the owner's wallet.
        assertEq(ens.ownerOf(merchantNode), owner, "merchant owner");
        assertEq(ens.ownerOf(terminalsNode), owner, "terminals owner");
        assertEq(ens.ownerOf(registerNode), owner, "register owner");

        // Records.
        assertEq(ens.addr(merchantNode), payout, "payout record");
        assertEq(ens.text(registerNode, STATUS_KEY), "active", "status text");

        // The owner holds SET_TEXT at the register's per-key status resource, the exact read
        // TerminalAdmission makes.
        uint256 statusResource = ens.textResource(registerNode, STATUS_KEY);
        assertTrue(ens.hasRoles(statusResource, SET_TEXT, owner), "owner is the register's operator");

        // The owner holds the full owner bitmap the door held at each node (transferFrom moved it).
        assertTrue(ens.hasRoles(uint256(merchantNode), SET_SUBREGISTRY << ens.ADMIN_SHIFT(), owner));
        assertTrue(ens.hasRoles(uint256(registerNode), SET_TEXT << ens.ADMIN_SHIFT(), owner));
        assertTrue(ens.hasRoles(uint256(merchantNode), ens.ROLE_CAN_TRANSFER_ADMIN(), owner));

        // The door holds zero roles at all three node resources and at the per-key resource.
        assertEq(ens.roles(uint256(merchantNode), address(onboarding)), 0, "door roles at merchant");
        assertEq(ens.roles(uint256(terminalsNode), address(onboarding)), 0, "door roles at terminals");
        assertEq(ens.roles(uint256(registerNode), address(onboarding)), 0, "door roles at register");
        assertEq(ens.roles(statusResource, address(onboarding)), 0, "door roles at status key");
        assertEq(ens.roles(ens.ROOT_RESOURCE(), address(onboarding)), 0, "door roles at root");

        // Badge.
        assertEq(badge.ownerOf(tokenId), owner, "badge holder");
        assertEq(badge.node_of(tokenId), merchantNode, "badge node");
        assertEq(badge.name_of(tokenId), "freshcuts.unica.eth", "badge name");
        assertEq(badge.token_of_node(merchantNode), tokenId, "badge by node");

        // Bookkeeping.
        assertEq(onboarding.merchantOf(owner), merchantNode);
        assertEq(onboarding.nodeOf(LABEL), merchantNode);
    }

    // ── 2. payout defaults to the caller ────────────────────────────────────────────────────────

    function test_Join_PayoutZeroMeansCaller() public {
        vm.expectEmit(true, true, true, true, address(onboarding));
        emit IMerchantOnboarding.BusinessJoined(
            _node(unicaNode, LABEL),
            owner,
            LABEL,
            owner,
            _node(_node(unicaNode, LABEL), "terminals"),
            _node(_node(_node(unicaNode, LABEL), "terminals"), TERMINAL),
            1
        );
        (bytes32 merchantNode,,,) = _joinAs(owner, LABEL, address(0), TERMINAL);
        assertEq(ens.addr(merchantNode), owner, "payout falls back to the caller");
    }

    // ── 3. every LabelInvalid class, each beside a passing control ─────────────────────────────

    function _expectInvalid(string memory label) internal {
        assertFalse(onboarding.isValidLabel(label), string.concat("isValidLabel should refuse: ", label));
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IMerchantOnboarding.LabelInvalid.selector, label));
        onboarding.join(label, payout, TERMINAL);
    }

    function test_LabelInvalid_Short() public {
        assertTrue(onboarding.isValidLabel("abc"), "3 is the floor");
        _expectInvalid("ab");
    }

    function test_LabelInvalid_Long() public {
        string memory thirtyTwo = "abcdefghijklmnopqrstuvwxyz012345";
        assertEq(bytes(thirtyTwo).length, 32);
        assertTrue(onboarding.isValidLabel(thirtyTwo), "32 is the ceiling");
        _expectInvalid(string.concat(thirtyTwo, "6"));
    }

    function test_LabelInvalid_Uppercase() public {
        assertTrue(onboarding.isValidLabel("freshcuts"));
        _expectInvalid("FreshCuts");
    }

    function test_LabelInvalid_LeadingHyphen() public {
        assertTrue(onboarding.isValidLabel("fresh-cuts"), "an inner hyphen is fine");
        _expectInvalid("-freshcuts");
    }

    function test_LabelInvalid_TrailingHyphen() public {
        _expectInvalid("freshcuts-");
    }

    function test_LabelInvalid_DoubleHyphen() public {
        _expectInvalid("fresh--cuts");
    }

    function test_LabelInvalid_Unicode() public {
        _expectInvalid(unicode"café");
    }

    function test_LabelInvalid_Empty() public {
        _expectInvalid("");
    }

    function test_LabelInvalid_OtherAscii() public {
        _expectInvalid("fresh_cuts");
        _expectInvalid("fresh.cuts");
        _expectInvalid("fresh cuts");
    }

    function test_LabelValid_DigitsAndHyphens() public view {
        assertTrue(onboarding.isValidLabel("a-1"));
        assertTrue(onboarding.isValidLabel("123"));
        assertTrue(onboarding.isValidLabel("chair-1"));
        assertTrue(onboarding.isValidLabel("a-b-c-d-e-f"));
    }

    function test_FirstTerminalLabelInvalid_Refused() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IMerchantOnboarding.LabelInvalid.selector, "Chair 1"));
        onboarding.join(LABEL, payout, "Chair 1");
        // Control: the same business joins once the register name follows the rule.
        _joinAs(owner, LABEL, payout, TERMINAL);
    }

    // ── 4. LabelTaken, both ways it can already be taken ────────────────────────────────────────

    function test_LabelTaken_AfterAnotherBusinessJoined() public {
        _joinAs(owner, LABEL, payout, TERMINAL);
        vm.prank(otherOwner);
        vm.expectRevert(abi.encodeWithSelector(IMerchantOnboarding.LabelTaken.selector, LABEL));
        onboarding.join(LABEL, payout, TERMINAL);
        // Control: a different label from the same wallet is fine.
        _joinAs(otherOwner, "otherco", payout, TERMINAL);
    }

    function test_LabelTaken_NodeAlreadyExistsInIdentity() public {
        // Registered under the parent directly, outside the door: nodeOf is zero but the identity
        // already has the node.
        ens.register(unicaNode, "manual", stranger);
        assertEq(onboarding.nodeOf("manual"), bytes32(0));
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IMerchantOnboarding.LabelTaken.selector, "manual"));
        onboarding.join("manual", payout, TERMINAL);
    }

    // ── 5. AlreadyJoined ────────────────────────────────────────────────────────────────────────

    function test_AlreadyJoined_OneBusinessPerWallet() public {
        (bytes32 merchantNode,,,) = _joinAs(owner, LABEL, payout, TERMINAL);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IMerchantOnboarding.AlreadyJoined.selector, owner, merchantNode));
        onboarding.join("secondshop", payout, TERMINAL);
        assertEq(onboarding.nodeOf("secondshop"), bytes32(0), "nothing recorded for the refused label");
    }

    // ── 6. BadgeNotLinked ───────────────────────────────────────────────────────────────────────

    function test_BadgeNotLinked_Refused() public {
        MerchantOnboarding unlinked = _deployDoor();
        _grantParent(unlinked);
        assertEq(unlinked.badge(), address(0));
        vm.prank(owner);
        vm.expectRevert(IMerchantOnboarding.BadgeNotLinked.selector);
        unlinked.join(LABEL, payout, TERMINAL);
        // Control: the same door admits once linked.
        _linkFreshBadge(unlinked);
        vm.prank(owner);
        unlinked.join(LABEL, payout, TERMINAL);
    }

    // ── 7. linkBadge rules ──────────────────────────────────────────────────────────────────────

    function test_LinkBadge_TwiceRefused() public {
        IdentityBadgeDouble another = new IdentityBadgeDouble(address(onboarding), address(ens));
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IMerchantOnboarding.BadgeAlreadyLinked.selector, address(badge)));
        onboarding.linkBadge(address(another));
        assertEq(onboarding.badge(), address(badge), "the first link stands");
    }

    function test_LinkBadge_StrangerRefused() public {
        MerchantOnboarding unlinked = _deployDoor();
        IdentityBadgeDouble b = new IdentityBadgeDouble(address(unlinked), address(ens));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IMerchantOnboarding.NotAdmin.selector, stranger));
        unlinked.linkBadge(address(b));
        assertEq(unlinked.badge(), address(0));
    }

    function test_LinkBadge_WrongMinterRefused() public {
        MerchantOnboarding unlinked = _deployDoor();
        IdentityBadgeDouble wrong = new IdentityBadgeDouble(stranger, address(ens));
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(MerchantOnboarding.BadgeMinterMismatch.selector, stranger));
        unlinked.linkBadge(address(wrong));
    }

    function test_LinkBadge_ZeroRefused() public {
        MerchantOnboarding unlinked = _deployDoor();
        vm.prank(admin);
        vm.expectRevert(MerchantOnboarding.ZeroAddress.selector);
        unlinked.linkBadge(address(0));
    }

    // ── 8. the parent grant is load-bearing ─────────────────────────────────────────────────────

    function test_Join_WithoutParentGrant_RefusedByIdentity() public {
        MerchantOnboarding ungranted = _deployDoor();
        _linkFreshBadge(ungranted);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                LocalEnsV2Fixture.EACUnauthorizedAccountRoles.selector,
                uint256(unicaNode),
                SET_SUBREGISTRY,
                address(ungranted)
            )
        );
        ungranted.join(LABEL, payout, TERMINAL);
        assertEq(ungranted.merchantOf(owner), bytes32(0), "the revert rolled back the bookkeeping");

        // Control: the grant, and only the grant, makes the same call succeed.
        _grantParent(ungranted);
        vm.prank(owner);
        ungranted.join(LABEL, payout, TERMINAL);
    }

    // ── 9. after the join, the owner shapes the tree; the door cannot touch it ─────────────────

    function test_OwnerAddsAndRevokesRegisters_DoorIsRefused() public {
        (bytes32 merchantNode, bytes32 terminalsNode, bytes32 chair1,) = _joinAs(owner, LABEL, payout, TERMINAL);

        // The owner adds a second register with a distinct operator key.
        vm.startPrank(owner);
        bytes32 chair2 = ens.register(terminalsNode, "chair-2", owner);
        ens.authorizeTextRoles(chair2, STATUS_KEY, secondOperator, true);
        ens.setText(chair2, STATUS_KEY, "active");
        // And revokes the first one.
        ens.authorizeTextRoles(chair1, STATUS_KEY, owner, false);
        ens.setText(chair1, STATUS_KEY, "revoked");
        vm.stopPrank();

        assertEq(ens.ownerOf(chair2), owner);
        assertTrue(ens.hasRoles(ens.textResource(chair2, STATUS_KEY), SET_TEXT, secondOperator));
        assertEq(ens.text(chair2, STATUS_KEY), "active");
        assertFalse(ens.hasRoles(ens.textResource(chair1, STATUS_KEY), SET_TEXT, owner));
        assertEq(ens.text(chair1, STATUS_KEY), "revoked");

        // The door's own address is refused everywhere. Every fixture read happens BEFORE the
        // prank so the pranked call is the one under test.
        uint256 chair1Status = ens.textResource(chair1, STATUS_KEY);
        uint256 setAddrRole = ens.ROLE_SET_ADDR();
        address door = address(onboarding);

        vm.prank(door);
        vm.expectRevert(
            abi.encodeWithSelector(LocalEnsV2Fixture.EACUnauthorizedAccountRoles.selector, chair1Status, SET_TEXT, door)
        );
        ens.setText(chair1, STATUS_KEY, "active");

        vm.prank(door);
        vm.expectRevert(
            abi.encodeWithSelector(
                LocalEnsV2Fixture.EACUnauthorizedAccountRoles.selector, uint256(terminalsNode), SET_SUBREGISTRY, door
            )
        );
        ens.register(terminalsNode, "chair-3", door);

        vm.prank(door);
        vm.expectRevert(
            abi.encodeWithSelector(
                LocalEnsV2Fixture.EACUnauthorizedAccountRoles.selector, uint256(merchantNode), setAddrRole, door
            )
        );
        ens.setAddr(merchantNode, stranger);

        vm.prank(door);
        vm.expectRevert(LocalEnsV2Fixture.NotOwner.selector);
        ens.transferFrom(owner, stranger, merchantNode);
    }

    // ── 10. constructor guards ──────────────────────────────────────────────────────────────────

    function test_Constructor_ParentNameMismatchRefused() public {
        bytes32 wrongNode = _node(ethNode, "unico");
        vm.expectRevert(abi.encodeWithSelector(MerchantOnboarding.ParentNameMismatch.selector, wrongNode, unicaNode));
        new MerchantOnboarding(address(ens), wrongNode, PARENT_NAME, admin, STATUS_KEY);
    }

    function test_Constructor_ZeroAddressRefused() public {
        vm.expectRevert(MerchantOnboarding.ZeroAddress.selector);
        new MerchantOnboarding(address(0), unicaNode, PARENT_NAME, admin, STATUS_KEY);
        vm.expectRevert(MerchantOnboarding.ZeroAddress.selector);
        new MerchantOnboarding(address(ens), unicaNode, PARENT_NAME, address(0), STATUS_KEY);
    }

    function test_Constructor_EmptyStatusKeyRefused() public {
        vm.expectRevert(MerchantOnboarding.EmptyStatusKey.selector);
        new MerchantOnboarding(address(ens), unicaNode, PARENT_NAME, admin, "");
    }

    function test_Constructor_ReadsBack() public view {
        assertEq(onboarding.IDENTITY(), address(ens));
        assertEq(onboarding.PARENT_NODE(), unicaNode);
        assertEq(onboarding.PARENT_NAME(), PARENT_NAME);
        assertEq(onboarding.ADMIN(), admin);
        assertEq(onboarding.TERMINAL_STATUS_KEY(), STATUS_KEY);
        assertEq(onboarding.badge(), address(badge));
    }

    // ── 11. the badge double itself refuses what the real token refuses ────────────────────────

    function test_BadgeDouble_RefusesNonMinterAndWrongName() public {
        (bytes32 merchantNode,,,) = _joinAs(owner, LABEL, payout, TERMINAL);

        vm.prank(stranger);
        vm.expectRevert(bytes("IdentityToken: not minter"));
        badge.mint(stranger, merchantNode, "freshcuts.unica.eth");

        vm.prank(address(onboarding));
        vm.expectRevert(bytes("IdentityToken: node already minted"));
        badge.mint(owner, merchantNode, "freshcuts.unica.eth");

        bytes32 unminted = _node(unicaNode, "nobody");
        vm.prank(address(onboarding));
        vm.expectRevert(bytes("IdentityToken: namehash mismatch"));
        badge.mint(owner, unminted, "somebody.unica.eth");

        vm.prank(address(onboarding));
        vm.expectRevert(bytes("IdentityToken: not namespace controller"));
        badge.mint(owner, unminted, "nobody.unica.eth");
    }
}
