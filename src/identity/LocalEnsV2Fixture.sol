// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// LOCAL ENSv2-COMPATIBLE FIXTURE for Anvil integration tests. Not the isolated ENSv2 Sepolia
// deployment; mirrors its measured Enhanced Access Control shape (per-key text resources, role
// bitmaps, admin bits at +128) so the order-admission path can be tested end to end without a
// network. Pinned Sepolia configuration lives in integrations/ensv2/profile.mjs.

import {IIdentityAuthority} from "./interfaces/IIdentityAuthority.sol";

/// @title LocalEnsV2Fixture
/// @notice One contract standing in for BOTH a `PermissionedRegistry` (the name tree: owner,
///         parent, subregistry, resolver-pointer) and a `PermissionedResolver` (records: addr,
///         text) plus the Enhanced Access Control (EAC) role bitmap they share on the real
///         deployment. Written from `docs/unica-v5/ens/ACCESS-CONTROL.md` §3, §5, §8-9 and
///         `docs/unica-v5/ens/POS-TERMINALS.md` §3-6 — every constant and derivation below is
///         named there and cross-checked against `integrations/ensv2/profile.mjs`'s live-measured
///         rows; nothing is copied from an ENS implementation.
/// @dev SIMPLIFICATIONS this fixture makes relative to the real deployment, stated so nobody
///      mistakes this for a spec:
///        - The real registry derives its resource from the LABEL alone
///          (`registryResource` in profile.mjs); this fixture uses `uint256(node)` directly. Both
///          are "one resource per name, chosen at registration," which is the property every test
///          here depends on — the exact bit pattern is not.
///        - The real deployment refuses `grantRoles` for a delegation and only accepts
///          `authorize*` (profile.mjs `DELEGATION_MECHANISM`); this fixture keeps only the
///          `authorize*` entry points for the same reason — there is no `grantRoles` here to call
///          by mistake.
///        - The real registry never lets ANY account — including the owner — grant an admin bit
///          after registration (profile.mjs `ADMIN_ROLE_RULE`). This fixture is looser:
///          `authorizeNameRoles` lets the owner, and only the owner, extend an admin bit later, so
///          a single contract can play both "at registration" and "later" without a second
///          entry point. No test here exercises that path; it is recorded so the divergence is
///          not silently inherited by a future test.
contract LocalEnsV2Fixture is IIdentityAuthority {
    // ── EAC constants (ACCESS-CONTROL.md §5, §3.1) ──────────────────────────────────────────────

    uint256 public constant ROOT_RESOURCE = 0;
    uint256 public constant ADMIN_SHIFT = 128;

    uint256 public constant ROLE_SET_ADDR = 1 << 0;
    uint256 public constant ROLE_SET_TEXT = 1 << 4;
    uint256 public constant ROLE_SET_CONTENTHASH = 1 << 8;
    uint256 public constant ROLE_RENEW = 1 << 16;
    uint256 public constant ROLE_SET_SUBREGISTRY = 1 << 20;
    uint256 public constant ROLE_SET_RESOLVER = 1 << 24;

    /// @notice The admin bit for name-transfer authority. Unlike the other roles above, this bit
    ///         IS the admin bit itself (ACCESS-CONTROL.md §5.1: "admin-only, bit 156") — there is
    ///         no separate "regular" transfer-admin role to shift. Revoking it from the owner
    ///         makes the name permanently untransferable ("soulbound").
    uint256 public constant ROLE_CAN_TRANSFER_ADMIN = 1 << 156;

    uint256 private constant ALL_REGULAR =
        ROLE_SET_ADDR | ROLE_SET_TEXT | ROLE_SET_CONTENTHASH | ROLE_RENEW | ROLE_SET_SUBREGISTRY | ROLE_SET_RESOLVER;
    uint256 private constant ALL_ADMIN = ALL_REGULAR << ADMIN_SHIFT;

    /// @dev What a fresh owner is granted at their own node's resource: every regular role, every
    ///      matching admin role, and transfer-admin (so the name starts transferable and
    ///      `revokeTransferAdmin` has something to take away — ACCESS-CONTROL.md §5.1: "auto-
    ///      granted to the name owner at registration").
    uint256 private constant OWNER_GRANT = ALL_REGULAR | ALL_ADMIN | ROLE_CAN_TRANSFER_ADMIN;

    /// @dev Every bit at or above `ADMIN_SHIFT`, used to detect an attempt to hand out admin
    ///      authority through `authorizeNameRoles`.
    uint256 private constant ADMIN_MASK = type(uint256).max << ADMIN_SHIFT;

    // ── EAC storage ──────────────────────────────────────────────────────────────────────────────

    /// @notice `roles[resource][account]` — the raw bitmap held AT that resource only. Reading
    ///         this alone and concluding "no authority" is the exact mistake
    ///         ACCESS-CONTROL.md §3.2 / profile.mjs `AUTHORITY_READ_RULE` names as dangerous;
    ///         `hasRoles` below is the authoritative read.
    mapping(uint256 => mapping(address => uint256)) public roles;

    // ── name tree storage ────────────────────────────────────────────────────────────────────────

    mapping(bytes32 => bool) private _exists;
    mapping(bytes32 => address) private _owner;
    mapping(bytes32 => bytes32) private _parent;
    mapping(bytes32 => address) private _resolverOf;
    mapping(bytes32 => address) private _subregistryOf;

    // ── resolver storage ─────────────────────────────────────────────────────────────────────────

    mapping(bytes32 => address) private _addrOf;
    mapping(bytes32 => mapping(string => string)) private _textOf;

    // ── events ───────────────────────────────────────────────────────────────────────────────────

    event RolesGranted(uint256 indexed resource, uint256 roles, address indexed account);
    event RolesRevoked(uint256 indexed resource, uint256 roles, address indexed account);
    event SubnameRegistered(bytes32 indexed parent, bytes32 indexed node, string label, address owner);
    event TextChanged(bytes32 indexed node, string key, string value);
    event AddrChanged(bytes32 indexed node, address addr);
    event Transferred(bytes32 indexed node, address from, address to);

    // ── errors ───────────────────────────────────────────────────────────────────────────────────

    error EACUnauthorizedAccountRoles(uint256 resource, uint256 roles, address account);
    error NotOwner();
    error TransferAdminRevoked(bytes32 node);
    error AlreadyExists();

    // ── name tree ────────────────────────────────────────────────────────────────────────────────

    /// @notice Registers a root-level label (e.g. `"eth"`) under the zero node. Callable once per
    ///         label by anyone — there is no gatekeeper above a root in this fixture, mirroring
    ///         that the real root registry's own authority is out of any single registrant's
    ///         control (ACCESS-CONTROL.md §7.1).
    function createRoot(string calldata label) external returns (bytes32 node) {
        node = keccak256(abi.encodePacked(bytes32(0), keccak256(bytes(label))));
        if (_exists[node]) revert AlreadyExists();
        _exists[node] = true;
        _owner[node] = msg.sender;
        _parent[node] = bytes32(0);
        _grantRoles(uint256(node), OWNER_GRANT, msg.sender);
        emit SubnameRegistered(bytes32(0), node, label, msg.sender);
    }

    /// @notice Registers `label` under `parent`. Requires `ROLE_SET_SUBREGISTRY` at the parent's
    ///         resource (or at `ROOT_RESOURCE`, folded in by `hasRoles`).
    function register(bytes32 parent, string calldata label, address owner) external returns (bytes32 node) {
        if (!hasRoles(uint256(parent), ROLE_SET_SUBREGISTRY, msg.sender)) {
            revert EACUnauthorizedAccountRoles(uint256(parent), ROLE_SET_SUBREGISTRY, msg.sender);
        }
        node = keccak256(abi.encodePacked(parent, keccak256(bytes(label))));
        if (_exists[node]) revert AlreadyExists();
        _exists[node] = true;
        _owner[node] = owner;
        _parent[node] = parent;
        _grantRoles(uint256(node), OWNER_GRANT, owner);
        emit SubnameRegistered(parent, node, label, owner);
    }

    function setResolver(bytes32 node, address resolver) external {
        if (!hasRoles(uint256(node), ROLE_SET_RESOLVER, msg.sender)) {
            revert EACUnauthorizedAccountRoles(uint256(node), ROLE_SET_RESOLVER, msg.sender);
        }
        _resolverOf[node] = resolver;
    }

    function setSubregistry(bytes32 node, address subregistry) external {
        if (!hasRoles(uint256(node), ROLE_SET_SUBREGISTRY, msg.sender)) {
            revert EACUnauthorizedAccountRoles(uint256(node), ROLE_SET_SUBREGISTRY, msg.sender);
        }
        _subregistryOf[node] = subregistry;
    }

    function resolverOf(bytes32 node) external view returns (address) {
        return _resolverOf[node];
    }

    function subregistryOf(bytes32 node) external view returns (address) {
        return _subregistryOf[node];
    }

    /// @notice Moves ownership of `node`. Requires the caller to BE the current owner (`from` must
    ///         match) and to still hold `ROLE_CAN_TRANSFER_ADMIN` at the node's resource — the bit
    ///         `revokeTransferAdmin` takes away to make a name soulbound. The full role bitmap the
    ///         old owner held at that resource moves to the new owner, so a transfer leaves no
    ///         stale authority behind on the old key.
    function transferFrom(address from, address to, bytes32 node) external {
        address currentOwner = _owner[node];
        if (msg.sender != currentOwner || from != currentOwner) revert NotOwner();
        uint256 resource = uint256(node);
        uint256 held = roles[resource][currentOwner];
        if (held & ROLE_CAN_TRANSFER_ADMIN == 0) revert TransferAdminRevoked(node);
        _revokeRoles(resource, held, currentOwner);
        _grantRoles(resource, held, to);
        _owner[node] = to;
        emit Transferred(node, currentOwner, to);
    }

    /// @notice Permanently clears the owner's own `ROLE_CAN_TRANSFER_ADMIN` at `node`. There is no
    ///         un-revoke: this is the soulbound switch (ACCESS-CONTROL.md §5.1).
    function revokeTransferAdmin(bytes32 node) external {
        if (msg.sender != _owner[node]) revert NotOwner();
        _revokeRoles(uint256(node), ROLE_CAN_TRANSFER_ADMIN, msg.sender);
    }

    // ── resolver ─────────────────────────────────────────────────────────────────────────────────

    function setAddr(bytes32 node, address a) external {
        if (!hasRoles(uint256(node), ROLE_SET_ADDR, msg.sender)) {
            revert EACUnauthorizedAccountRoles(uint256(node), ROLE_SET_ADDR, msg.sender);
        }
        _addrOf[node] = a;
        emit AddrChanged(node, a);
    }

    /// @notice Requires `ROLE_SET_TEXT` at the per-key resource of `(node, key)` OR at the node's
    ///         own resource — either one, `hasRoles` folding `ROOT_RESOURCE` into both, exactly as
    ///         `docs/unica-v5/ens/ACCESS-CONTROL.md` §6 and `integrations/ensv2/roles.mjs` describe
    ///         the measured deployment's own per-key/name-level dual scope.
    function setText(bytes32 node, string calldata key, string calldata value) external {
        uint256 perKey = textResource(node, key);
        bool ok = hasRoles(perKey, ROLE_SET_TEXT, msg.sender) || hasRoles(uint256(node), ROLE_SET_TEXT, msg.sender);
        if (!ok) revert EACUnauthorizedAccountRoles(perKey, ROLE_SET_TEXT, msg.sender);
        _textOf[node][key] = value;
        emit TextChanged(node, key, value);
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return _textOf[node][key];
    }

    function addr(bytes32 node) external view returns (address) {
        return _addrOf[node];
    }

    // ── EAC ──────────────────────────────────────────────────────────────────────────────────────

    /// @notice True when `account` holds every bit of `roleBitmap` at `resource`, folding in
    ///         whatever is separately held at `ROOT_RESOURCE` — the authoritative read
    ///         (ACCESS-CONTROL.md §3.2; profile.mjs `AUTHORITY_READ_RULE`).
    function hasRoles(uint256 resource, uint256 roleBitmap, address account) public view returns (bool) {
        uint256 held = roles[resource][account];
        if (resource != ROOT_RESOURCE) held |= roles[ROOT_RESOURCE][account];
        return held & roleBitmap == roleBitmap;
    }

    function hasRootRoles(uint256 roleBitmap, address account) public view returns (bool) {
        return roles[ROOT_RESOURCE][account] & roleBitmap == roleBitmap;
    }

    /// @notice The delegation primitive (profile.mjs `DELEGATION_MECHANISM`): grants or revokes
    ///         `ROLE_SET_TEXT`, and only `ROLE_SET_TEXT`, at the per-key resource of
    ///         `(node, key)`. The caller must hold the ADMIN bit of `ROLE_SET_TEXT` at the node's
    ///         own resource — the regular bit is not enough, matching the measured deployment.
    function authorizeTextRoles(bytes32 node, string calldata key, address account, bool grant) external {
        uint256 nodeResource = uint256(node);
        uint256 adminBit = ROLE_SET_TEXT << ADMIN_SHIFT;
        if (!hasRoles(nodeResource, adminBit, msg.sender)) {
            revert EACUnauthorizedAccountRoles(nodeResource, adminBit, msg.sender);
        }
        uint256 perKey = textResource(node, key);
        if (grant) {
            _grantRoles(perKey, ROLE_SET_TEXT, account);
        } else {
            _revokeRoles(perKey, ROLE_SET_TEXT, account);
        }
    }

    /// @notice The `authorizeTextRoles` sibling for `ROLE_SET_ADDR`. This fixture's
    ///         `IIdentityAuthority` surface exposes no per-key resource for `addr` (there is one
    ///         payout address per name, not one per key), so the grant/revoke lands at the node's
    ///         own resource — the caller still needs the admin bit of `ROLE_SET_ADDR` there.
    function authorizeAddrRoles(bytes32 node, address account, bool grant) external {
        uint256 nodeResource = uint256(node);
        uint256 adminBit = ROLE_SET_ADDR << ADMIN_SHIFT;
        if (!hasRoles(nodeResource, adminBit, msg.sender)) {
            revert EACUnauthorizedAccountRoles(nodeResource, adminBit, msg.sender);
        }
        if (grant) {
            _grantRoles(nodeResource, ROLE_SET_ADDR, account);
        } else {
            _revokeRoles(nodeResource, ROLE_SET_ADDR, account);
        }
    }

    /// @notice Grants/revokes an arbitrary regular-role bitmap at `node`'s own resource. The caller
    ///         must hold the admin bit of EVERY role named in `roleBitmap`. Granting a bitmap that
    ///         itself contains an admin bit (>= `ADMIN_SHIFT`) is refused unless the caller is the
    ///         node's owner — see the divergence noted in this contract's header comment.
    function authorizeNameRoles(bytes32 node, uint256 roleBitmap, address account, bool grant) external {
        uint256 resource = uint256(node);
        uint256 adminNeeded = roleBitmap << ADMIN_SHIFT;
        if (!hasRoles(resource, adminNeeded, msg.sender)) {
            revert EACUnauthorizedAccountRoles(resource, adminNeeded, msg.sender);
        }
        if (grant) {
            if (roleBitmap & ADMIN_MASK != 0 && msg.sender != _owner[node]) {
                revert EACUnauthorizedAccountRoles(resource, roleBitmap & ADMIN_MASK, msg.sender);
            }
            _grantRoles(resource, roleBitmap, account);
        } else {
            _revokeRoles(resource, roleBitmap, account);
        }
    }

    // ── IIdentityAuthority ───────────────────────────────────────────────────────────────────────

    function isNamespaceController(bytes32 node, address account) external view returns (bool) {
        return _owner[node] == account;
    }

    function ownerOf(bytes32 node) external view returns (address) {
        return _owner[node];
    }

    function parentOf(bytes32 node) external view returns (bytes32) {
        return _parent[node];
    }

    /// @notice `uint256(keccak256(abi.encode(node, keccak256(bytes(key)))))` — the per-key
    ///         resource shape measured on the real deployment
    ///         (`integrations/ensv2/profile.mjs`'s `resolverScopedResource`/`textScopeHash`,
    ///         `FORK_EXECUTED`).
    function textResource(bytes32 node, string calldata key) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(node, keccak256(bytes(key)))));
    }

    // ── internal ─────────────────────────────────────────────────────────────────────────────────

    function _grantRoles(uint256 resource, uint256 roleBitmap, address account) internal {
        roles[resource][account] |= roleBitmap;
        emit RolesGranted(resource, roleBitmap, account);
    }

    function _revokeRoles(uint256 resource, uint256 roleBitmap, address account) internal {
        roles[resource][account] &= ~roleBitmap;
        emit RolesRevoked(resource, roleBitmap, account);
    }
}
