// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IMerchantOnboarding} from "./IMerchantOnboarding.sol";
import {IIdentityAuthority} from "./interfaces/IIdentityAuthority.sol";

/// @title IOnboardingAuthority
/// @notice The write surface `MerchantOnboarding` needs on top of the read-only `IIdentityAuthority`:
///         register a subname, set the payout address, delegate and write one text key, and hand a
///         node to its owner. Declared here, from the ENSv2-shaped fixture's own signatures
///         (`LocalEnsV2Fixture.sol`), so this contract depends on a named surface and never on the
///         fixture's concrete type.
/// @dev `roles` is the RAW per-resource bitmap. `docs/unica-v5/ens/ACCESS-CONTROL.md` section 3.2
///      warns that reading it alone cannot prove "no authority", because a root-level grant is not
///      folded in. This contract uses it for the opposite question, "did every bit I was granted AT
///      this resource leave with the transfer", which is exactly the per-resource fact it reports.
interface IOnboardingAuthority is IIdentityAuthority {
    function register(bytes32 parent, string calldata label, address owner) external returns (bytes32 node);
    function setAddr(bytes32 node, address a) external;
    function setText(bytes32 node, string calldata key, string calldata value) external;
    function authorizeTextRoles(bytes32 node, string calldata key, address account, bool grant) external;
    function transferFrom(address from, address to, bytes32 node) external;
    function roles(uint256 resource, address account) external view returns (uint256);
}

/// @title IIdentityBadge
/// @notice The three calls this contract makes on the identity token (`vy/src/art/identity_token.vy`):
///         who may mint, mint one badge for one node, and whether a node already carries one.
///         `String[255]` in the Vyper source is `string` at the ABI, so the signatures match the
///         deployed token byte for byte.
interface IIdentityBadge {
    function MINTER() external view returns (address);
    function mint(address to, bytes32 node, string calldata normalizedName) external returns (uint256);
    function token_of_node(bytes32 node) external view returns (uint256);
}

/// @title MerchantOnboarding
/// @notice The self-serve door described by `IMerchantOnboarding`: one transaction from an ordinary
///         wallet gives a business its name under the UNICA parent, a payout record, a `terminals`
///         branch, one ACTIVE register operated by that same wallet, and the identity badge, and
///         then hands every node to the wallet. Written from `IMerchantOnboarding.sol`,
///         `docs/unica-v5/ens/POS-TERMINALS.md` sections 3 to 6 and
///         `docs/unica-v5/ens/NAMESPACE.md`; the shape of the tree is the one
///         `test/identity/TerminalTrustTree.t.sol` already proves `TerminalAdmission` admits.
///
/// @dev HOW THIS CONTRACT HOLDS AUTHORITY, AND FOR HOW LONG. The parent's owner grants this
///      contract `ROLE_SET_SUBREGISTRY` at the parent once (`authorizeNameRoles`), which is the only
///      standing authority it ever has. During `join` it is the temporary owner of the three new
///      nodes, because the fixture grants the full owner bitmap to whoever `register` names and a
///      contract cannot delegate a text key or write a status it does not own. Before `join`
///      returns, `transferFrom` moves the whole bitmap it held at each node to the caller, and the
///      contract then reads its own raw role bitmap at each resource and refuses to return unless
///      every one is zero. A test proves that a later call from this contract's address to any of
///      the business's nodes is refused by the identity authority itself.
///
///      WHY THE BADGE IS MINTED LAST. The identity token refuses to mint for an account that is not
///      the node's namespace controller, so the mint can only succeed once the merchant node has
///      already been handed to the caller. Minting earlier would revert against the real token; the
///      test double keeps the same rule so the ordering is proven, not assumed.
///
///      WHAT IS DELIBERATELY ABSENT. No `joinFor`, no admin path that names, renames, transfers or
///      revokes on a business's behalf, no upgradeability, no `selfdestruct`. The admin's only
///      power is the one-time `linkBadge`.
contract MerchantOnboarding is IMerchantOnboarding {
    /// @dev The same bit `LocalEnsV2Fixture.ROLE_SET_SUBREGISTRY` and `ACCESS-CONTROL.md` section 5
    ///      name; kept as a local constant so this contract's messages can name the role it needs
    ///      without importing the fixture.
    uint256 private constant ROLE_SET_SUBREGISTRY = 1 << 20;

    uint256 private constant LABEL_MIN = 3;
    uint256 private constant LABEL_MAX = 32;

    /// @notice A constructor argument was the zero address. Refused up front because an onboarding
    ///         door with no identity authority or no admin could never link a badge, and every join
    ///         would fail in a way that only shows up after deployment.
    error ZeroAddress();
    /// @notice `parentName` does not hash to `parentNode`. Refused at construction because the badge
    ///         is minted with `<label>.<parentName>` and checks that name against the node; a
    ///         mismatch here would make every single `join` revert inside the token, long after the
    ///         mistake was made.
    error ParentNameMismatch(bytes32 parentNode, bytes32 computedFromName);
    /// @notice `terminalStatusKey` was empty. A register whose status lives under an empty key can
    ///         never be admitted by a `TerminalAdmission` configured with the real key.
    error EmptyStatusKey();
    /// @notice The badge being linked does not name this contract as its minter, so no join could
    ///         ever mint. Caught at link time rather than on the first business's transaction.
    error BadgeMinterMismatch(address minter);
    /// @notice After handing the nodes over, this contract still held a role bit at `resource`. This
    ///         is the promise in `IMerchantOnboarding`'s notice ("this contract keeps no role on any
    ///         of them") enforced by the transaction itself, not only by a test.
    error RolesRetained(uint256 resource, uint256 heldRoles);

    /// @inheritdoc IMerchantOnboarding
    address public immutable IDENTITY;
    /// @inheritdoc IMerchantOnboarding
    bytes32 public immutable PARENT_NODE;
    /// @notice The admin that may call `linkBadge` once. Immutable: there is no way to hand the
    ///         role on, because there is nothing else the role can do.
    address public immutable ADMIN;
    /// @notice The human-readable parent (`unica.eth` locally). A plain state variable written once
    ///         in the constructor because `immutable` accepts value types only.
    string public PARENT_NAME;
    /// @inheritdoc IMerchantOnboarding
    string public TERMINAL_STATUS_KEY;
    /// @inheritdoc IMerchantOnboarding
    address public badge;

    /// @inheritdoc IMerchantOnboarding
    mapping(address => bytes32) public merchantOf;
    mapping(string => bytes32) private _nodeOf;

    IOnboardingAuthority private immutable _ens;

    /// @param identity the ENSv2-shaped identity authority (the local fixture in this release)
    /// @param parentNode the node every business joins under; must equal the namehash of `parentName`
    /// @param parentName the parent as a dotted name, used to build the badge's normalized name
    /// @param admin the one account allowed to call `linkBadge`
    /// @param terminalStatusKey the text key a register publishes "active" / "revoked" under
    constructor(
        address identity,
        bytes32 parentNode,
        string memory parentName,
        address admin,
        string memory terminalStatusKey
    ) {
        if (identity == address(0) || admin == address(0)) revert ZeroAddress();
        if (bytes(terminalStatusKey).length == 0) revert EmptyStatusKey();
        bytes32 computed = _namehash(parentName);
        if (computed != parentNode) revert ParentNameMismatch(parentNode, computed);
        IDENTITY = identity;
        _ens = IOnboardingAuthority(identity);
        PARENT_NODE = parentNode;
        PARENT_NAME = parentName;
        ADMIN = admin;
        TERMINAL_STATUS_KEY = terminalStatusKey;
    }

    // ── the door ─────────────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IMerchantOnboarding
    /// @dev Checks first, then the two records that make a second join from this wallet or for this
    ///      label impossible, then the tree, then the hand-over, then the badge. `firstTerminalLabel`
    ///      is held to the same rule as `label`: it becomes a node name in the same tree and there is
    ///      no reason to let a register carry a name the business itself could not.
    function join(string calldata label, address payout, string calldata firstTerminalLabel)
        external
        returns (bytes32 merchantNode, bytes32 terminalsNode, bytes32 firstTerminalNode, uint256 badgeTokenId)
    {
        address badgeAddr = badge;
        if (badgeAddr == address(0)) revert BadgeNotLinked();
        if (!_validLabel(bytes(label))) revert LabelInvalid(label);
        if (!_validLabel(bytes(firstTerminalLabel))) revert LabelInvalid(firstTerminalLabel);
        bytes32 existing = merchantOf[msg.sender];
        if (existing != bytes32(0)) revert AlreadyJoined(msg.sender, existing);

        merchantNode = _childNode(PARENT_NODE, label);
        if (
            _nodeOf[label] != bytes32(0) || _ens.ownerOf(merchantNode) != address(0)
                || IIdentityBadge(badgeAddr).token_of_node(merchantNode) != 0
        ) revert LabelTaken(label);

        if (payout == address(0)) payout = msg.sender;

        merchantOf[msg.sender] = merchantNode;
        _nodeOf[label] = merchantNode;

        (terminalsNode, firstTerminalNode) = _buildTree(label, payout, firstTerminalLabel);
        _handOver(merchantNode, terminalsNode, firstTerminalNode);

        badgeTokenId = IIdentityBadge(badgeAddr).mint(msg.sender, merchantNode, string.concat(label, ".", PARENT_NAME));

        emit BusinessJoined(merchantNode, msg.sender, label, payout, terminalsNode, firstTerminalNode, badgeTokenId);
    }

    /// @dev Registers the three nodes with this contract as their temporary owner, writes the payout
    ///      record, delegates the status key to the caller and publishes "active". Every one of
    ///      these calls needs a role this contract holds only because it owns the node in question;
    ///      `register` at the parent is the single call backed by the standing grant.
    function _buildTree(string calldata label, address payout, string calldata firstTerminalLabel)
        internal
        returns (bytes32 terminalsNode, bytes32 firstTerminalNode)
    {
        bytes32 merchantNode = _ens.register(PARENT_NODE, label, address(this));
        _ens.setAddr(merchantNode, payout);
        terminalsNode = _ens.register(merchantNode, "terminals", address(this));
        firstTerminalNode = _ens.register(terminalsNode, firstTerminalLabel, address(this));
        _ens.authorizeTextRoles(firstTerminalNode, TERMINAL_STATUS_KEY, msg.sender, true);
        _ens.setText(firstTerminalNode, TERMINAL_STATUS_KEY, "active");
    }

    /// @dev Leaf first, root last, so there is no moment at which the caller owns a parent while this
    ///      contract still owns a child under it. Then the raw bitmap at each of the three node
    ///      resources and at the register's per-key status resource is read back and must be zero.
    function _handOver(bytes32 merchantNode, bytes32 terminalsNode, bytes32 firstTerminalNode) internal {
        _ens.transferFrom(address(this), msg.sender, firstTerminalNode);
        _ens.transferFrom(address(this), msg.sender, terminalsNode);
        _ens.transferFrom(address(this), msg.sender, merchantNode);

        _requireNoRoles(uint256(firstTerminalNode));
        _requireNoRoles(uint256(terminalsNode));
        _requireNoRoles(uint256(merchantNode));
        _requireNoRoles(_ens.textResource(firstTerminalNode, TERMINAL_STATUS_KEY));
    }

    function _requireNoRoles(uint256 resource) internal view {
        uint256 held = _ens.roles(resource, address(this));
        if (held != 0) revert RolesRetained(resource, held);
    }

    // ── admin: the one-time badge link ───────────────────────────────────────────────────────────

    /// @inheritdoc IMerchantOnboarding
    /// @dev The badge names its minter at deployment and cannot change it, so the link is checked
    ///      both ways: this contract must be that minter, and this contract accepts a badge once.
    function linkBadge(address badgeToken) external {
        if (msg.sender != ADMIN) revert NotAdmin(msg.sender);
        if (badge != address(0)) revert BadgeAlreadyLinked(badge);
        if (badgeToken == address(0)) revert ZeroAddress();
        address minter = IIdentityBadge(badgeToken).MINTER();
        if (minter != address(this)) revert BadgeMinterMismatch(minter);
        badge = badgeToken;
    }

    // ── views ────────────────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IMerchantOnboarding
    function isValidLabel(string calldata label) external pure returns (bool) {
        return _validLabel(bytes(label));
    }

    /// @inheritdoc IMerchantOnboarding
    function nodeOf(string calldata label) external view returns (bytes32) {
        return _nodeOf[label];
    }

    // ── pure helpers ─────────────────────────────────────────────────────────────────────────────

    /// @dev The rule in `IMerchantOnboarding`'s notice: lowercase `a-z`, digits and hyphens, 3 to 32
    ///      bytes, no hyphen first or last, no two hyphens in a row. Byte-wise on purpose: any
    ///      multi-byte character fails the class check, which is what keeps a joined name inside the
    ///      set `vy/src/math/namecheck.vy` renders.
    function _validLabel(bytes calldata b) internal pure returns (bool) {
        uint256 n = b.length;
        if (n < LABEL_MIN || n > LABEL_MAX) return false;
        bool previousHyphen = false;
        for (uint256 i = 0; i < n; i++) {
            bytes1 c = b[i];
            bool lower = c >= 0x61 && c <= 0x7A;
            bool digit = c >= 0x30 && c <= 0x39;
            bool hyphen = c == 0x2D;
            if (!(lower || digit || hyphen)) return false;
            if (hyphen) {
                if (i == 0 || i == n - 1 || previousHyphen) return false;
            }
            previousHyphen = hyphen;
        }
        return true;
    }

    /// @dev `keccak256(parent, keccak256(label))`, the derivation the fixture and the badge share.
    function _childNode(bytes32 parent, string calldata label) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(parent, keccak256(bytes(label))));
    }

    /// @dev Namehash of a dotted name, folding labels from the right. Used once, in the constructor,
    ///      to prove `parentName` and `parentNode` describe the same name.
    function _namehash(string memory name) internal pure returns (bytes32 node) {
        bytes memory b = bytes(name);
        uint256 end = b.length;
        for (uint256 i = b.length; i > 0; i--) {
            if (b[i - 1] == 0x2E) {
                node = keccak256(abi.encodePacked(node, keccak256(_slice(b, i, end))));
                end = i - 1;
            }
        }
        node = keccak256(abi.encodePacked(node, keccak256(_slice(b, 0, end))));
    }

    function _slice(bytes memory b, uint256 start, uint256 end) internal pure returns (bytes memory out) {
        out = new bytes(end - start);
        for (uint256 i = start; i < end; i++) {
            out[i - start] = b[i];
        }
    }
}
