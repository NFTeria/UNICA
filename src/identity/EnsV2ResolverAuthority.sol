// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// THE REAL ENSv2 ADAPTER — not a fixture. Every authority read below leaves this contract and lands
// on a deployed PermissionedResolver on the isolated ENSv2 Sepolia deployment. `LocalEnsV2Fixture`
// answers the same interface from local storage and is for Anvil; this one answers it from somebody
// else's live bytecode, which is why it is fork-tested (`test/fork/EnsV2AuthorityFork.t.sol`)
// against that deployment before anything relies on it.
//
// WHAT THIS ADAPTER BINDS, AND WHAT IT DOES NOT PROVE.
//
//   IT BINDS admission to the ENSv2 RESOLVER's access control. `hasRoles`, `text` and `addr` are
//   forwarded verbatim to the resolver named at construction, so a `TerminalAdmission` sitting on
//   top of this contract admits an order exactly when that resolver says the operator currently
//   holds SET_TEXT at the terminal's status-key resource and publishes "active" there.
//
//   IT PROVES NOTHING ABOUT REGISTRY OWNERSHIP. The PermissionedRegistry is a different contract
//   with a differently-derived resource (`integrations/ensv2/profile.mjs`,
//   `RESOURCE_DERIVATIONS`: the registry scopes to the LABEL hash, the resolver to the NAMEHASH),
//   and this adapter never calls it. Nothing here can tell you who owns a name, who may transfer
//   it, or whether it is even registered — on this deployment `unica.eth` is held in SUBTREE /
//   WILDCARD mode, so its subnames are SERVED and not REGISTERED at all
//   (`script/ensv2/unica-sepolia.json`, `_mode`). `ownerOf` therefore refuses rather than guessing,
//   and `parentOf` is answered from a lineage registry of provable facts rather than from a
//   registry read that does not exist.
//
//   THE DEPLOYMENT MANIFEST PINS THE RESOLVER ADDRESS AND THE ENS DEPLOYMENT ID. The constructor
//   takes one address and no other literal: the resolver is volatile — a per-name proxy that only
//   exists once the parent has been registered and pointed at it — and the only ENSv2 address this
//   repository is willing to hard-code anywhere is the Universal Resolver entry point
//   0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe, which is not this. `TerminalAdmission`'s
//   `ENS_DEPLOYMENT_ID` is a typo guard between two configurations and is likewise the manifest's
//   to pin; neither this contract nor that one can prove on chain that the pair belongs together.

import {IIdentityAuthority} from "./interfaces/IIdentityAuthority.sol";

/// @dev The exact slice of the measured PermissionedResolver ABI this adapter calls. Signatures are
///      the ones recorded in `integrations/ensv2/permissioned.mjs` `SIGNATURES` and re-read against
///      the live deployment by the fork suite.
///
///      `roles(uint256,address)` and `hasRootRoles(uint256,address)` exist on that resolver and are
///      DELIBERATELY ABSENT here. `roles()` reports only the bitmap stored at the resource asked
///      about, while authority granted at ROOT_RESOURCE applies to every resource and does not
///      appear in it (`profile.mjs` `AUTHORITY_READ_RULE`, measured: `roles(nameResource,owner)=0`
///      with `hasRoles(nameResource,SET_ADDR,owner)=true`). Exposing it through an adapter whose
///      whole purpose is answering "may this account do this" would be handing callers the read
///      that fails in the unsafe direction.
interface IEnsV2PermissionedResolver {
    function hasRoles(uint256 resource, uint256 roleBitmap, address account) external view returns (bool);
    function text(bytes32 node, string calldata key) external view returns (string memory);
    function addr(bytes32 node) external view returns (address);
}

/// @title EnsV2ResolverAuthority
/// @notice `IIdentityAuthority` over a real ENSv2 PermissionedResolver, plus the one thing ENSv2
///         does not expose for a wildcard subname — lineage — kept as a registry of facts anyone
///         may prove.
contract EnsV2ResolverAuthority is IIdentityAuthority {
    // ── EAC constants (docs/unica-v5/ens/ACCESS-CONTROL.md §5.2; profile.mjs RESOLVER_ROLE) ──────

    /// @dev Roles sit one NYBBLE apart and each role's admin sits 128 bits above it. §5.2's table
    ///      gives SET_ADDR admin bit 128 and SET_TEXT admin bit 132, which is this shift applied to
    ///      bits 0 and 4 — the two are cross-checks of each other, not one claim written twice.
    uint256 public constant ADMIN_SHIFT = 128;
    uint256 public constant ROLE_SET_ADDR = 1 << 0;
    uint256 public constant ROLE_SET_TEXT = 1 << 4;

    /// @notice The bitmap `isNamespaceController` asks about: the ADMIN bits of SET_ADDR and
    ///         SET_TEXT, both of them.
    uint256 public constant NAMESPACE_CONTROL_ROLES = (ROLE_SET_ADDR | ROLE_SET_TEXT) << ADMIN_SHIFT;

    /// @notice The resolver every authority read is forwarded to. One address, supplied by the
    ///         deployment manifest, checked for code at construction.
    IEnsV2PermissionedResolver public immutable RESOLVER;

    // ── the lineage registry ─────────────────────────────────────────────────────────────────────

    mapping(bytes32 => bytes32) private _parent;
    mapping(bytes32 => string) private _label;
    mapping(bytes32 => bool) private _known;

    event LineageRegistered(bytes32 indexed child, bytes32 indexed parent, string label);

    error ZeroResolver();
    error ResolverHasNoCode(address resolver);
    error EmptyLabel();
    /// @notice A second registration of the same child that does not agree with the first. Reaching
    ///         it through `registerLineage` requires a keccak collision, because the child is
    ///         DERIVED from the pair being registered — which is exactly why the guard is here and
    ///         why the local suite reaches it by planting a conflicting record in storage instead
    ///         of pretending the public path can.
    error LineageDisagrees(bytes32 child, bytes32 recordedParent, bytes32 offeredParent);
    /// @notice `ownerOf` is unsupported on this deployment. See the function's own comment.
    error OwnerNotEnumerable(address resolver, bytes32 node);

    /// @param resolver the PermissionedResolver (a per-name proxy, on this deployment) that answers
    ///        `text`/`addr` for the names this adapter is used with. Refused if zero, and refused
    ///        if it carries no code: an address with no code returns `0x` to every `eth_call`, and
    ///        `0x` decodes as "no roles" — the safest-looking wrong answer in this interface
    ///        (`script/ensv2/unica-sepolia.json`, `_resolver`).
    constructor(address resolver) {
        if (resolver == address(0)) revert ZeroResolver();
        if (resolver.code.length == 0) revert ResolverHasNoCode(resolver);
        RESOLVER = IEnsV2PermissionedResolver(resolver);
    }

    // ── forwarded reads ──────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IIdentityAuthority
    /// @dev Forwarded unchanged. The resolver's own `hasRoles` folds in whatever the account holds
    ///      at ROOT_RESOURCE, which is the fold this interface's contract promises — measured on
    ///      the live deployment, where the name owner's authority lives entirely at ROOT and
    ///      `hasRoles` answers true at every resource because of it.
    function hasRoles(uint256 resource, uint256 roleBitmap, address account) external view returns (bool) {
        return RESOLVER.hasRoles(resource, roleBitmap, account);
    }

    /// @inheritdoc IIdentityAuthority
    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return RESOLVER.text(node, key);
    }

    /// @inheritdoc IIdentityAuthority
    /// @dev A zero return is NOT evidence that a name is unregistered: on this deployment the
    ///      parent answers for its whole subtree by wildcard, and an unregistered subname resolves
    ///      to the zero address WITHOUT reverting (`profile.mjs` `WILDCARD`). Callers that treat a
    ///      zero payout address as a refusal — `TerminalAdmission` does — are correct; callers that
    ///      treat a successful call as proof of registration are not.
    function addr(bytes32 node) external view returns (address) {
        return RESOLVER.addr(node);
    }

    /// @inheritdoc IIdentityAuthority
    /// @dev `uint256(keccak256(abi.encode(node, keccak256(bytes(key)))))` — the per-key resource
    ///      `authorizeTextRoles` writes SET_TEXT at, established by executing that call against the
    ///      deployed bytecode on a pinned fork and finding the bit where this formula predicts
    ///      (`profile.mjs` `RESOURCE_DERIVATIONS`, `FORK_EXECUTED`). It is `abi.encode`, not
    ///      `abi.encodePacked`: two 32-byte words, the second the keccak of the key's UTF-8 bytes.
    ///      Pure, and deliberately so — a resource derivation that had to ask the chain could not be
    ///      checked against an independent computation, which is how the addr-scope derivation was
    ///      caught being wrong.
    function textResource(bytes32 node, string calldata key) external pure returns (uint256) {
        return uint256(keccak256(abi.encode(node, keccak256(bytes(key)))));
    }

    // ── namespace control ────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IIdentityAuthority
    /// @notice True when the resolver reports `account` holding the ADMIN bit of SET_ADDR **and**
    ///         the ADMIN bit of SET_TEXT at the node's resource.
    /// @dev BOTH, not either, and the reason is `docs/unica-v5/ens/ACCESS-CONTROL.md` §5.2. That
    ///      table lists SET_ADDR and SET_TEXT as two independent roles with two independent admin
    ///      bits (128 and 132) and a scope of "root, name, or record" each — so holding one says
    ///      nothing whatever about the other, and §6 shows why that matters in practice: a merchant
    ///      hands out `adminRole(SET_TEXT)` on a leaf to let something delegate a status key, and
    ///      that account has been given no authority at all over the payout address. Answering
    ///      "either" would report such a partial delegate as the controller of the namespace, which
    ///      is over-reporting an authority claim — the unsafe direction for a function whose only
    ///      use is deciding whom to trust. Requiring both names exactly the account that can
    ///      administer the two record classes UNICA actually consumes: `addr` for the payout
    ///      address and `text` for terminal status.
    ///
    ///      A single `hasRoles` call IS the "both" question: the interface's own contract is "holds
    ///      EVERY bit of `roleBitmap`", and the measured resolver implements it that way.
    ///
    ///      MEASURED RESIDUAL, stated because the fork suite found it rather than assumed it. The
    ///      resource asked about here is `uint256(node)`. The resolver's own NAME-LEVEL resource is
    ///      `keccak256(abi.encode(node, bytes32(0)))`, which is a different number
    ///      (`profile.mjs` `resolverNameResource`). On this deployment the difference does not
    ///      change the answer, because a per-name resolver proxy grants the name's owner everything
    ///      at ROOT_RESOURCE and `hasRoles` folds ROOT in at EVERY resource — measured live: true
    ///      at `uint256(node)`, true at the name-level resource, and true at an arbitrary resource
    ///      nobody has ever named. On a resolver SHARED between names it would change the answer,
    ///      and this function would then be asking about a resource nobody grants at. It is not
    ///      "wrong today"; it is right for a reason that is a property of the deployment rather
    ///      than of the formula, and that is the kind of thing that stops being true quietly.
    function isNamespaceController(bytes32 node, address account) external view returns (bool) {
        return RESOLVER.hasRoles(uint256(node), NAMESPACE_CONTROL_ROLES, account);
    }

    /// @inheritdoc IIdentityAuthority
    /// @dev UNSUPPORTED, and it reverts rather than faking it. ENSv2's Enhanced Access Control
    ///      stores role BITMAPS per (resource, account) and reports assignee COUNTS
    ///      (`getAssigneeCount` returns counts and maxima packed one nybble per role); it enumerates
    ///      no accounts, so there is no read on the resolver that turns a node into the address
    ///      holding its admin bits. Registry ownership is a different contract this adapter does not
    ///      call, and under this deployment's subtree/wildcard mode a subname has no registration to
    ///      own in the first place. The interface says a zero return means "never registered", so
    ///      returning zero here would be a lie in the unsafe direction and returning the resolver's
    ///      address would be a lie in the confusing one. `TerminalAdmission` never calls `ownerOf` —
    ///      that was checked against its source, not assumed — so refusing costs nothing that is
    ///      wired today, and the refusal is what stops a future caller from wiring it.
    function ownerOf(bytes32 node) external view returns (address) {
        revert OwnerNotEnumerable(address(RESOLVER), node);
    }

    // ── lineage ──────────────────────────────────────────────────────────────────────────────────

    /// @notice Record the provable fact that `label` under `parent` is the child it hashes to.
    /// @dev ENSv2 exposes no parent pointer for a wildcard subname — the subname is not registered,
    ///      so there is nothing holding a parent for it — and `TerminalAdmission` needs one, because
    ///      the terminal must sit at exactly `<label>.terminals.<merchant>`. What ENS cannot answer
    ///      the adapter keeps, and it keeps only facts that need no authority to state:
    ///      `child == keccak256(abi.encodePacked(parent, keccak256(bytes(label))))` is the namehash
    ///      recursion itself, checkable by anyone off chain in one line. So this function is
    ///      PERMISSIONLESS on purpose. It grants nothing, it cannot point a child at a parent the
    ///      hash does not support, and the worst a hostile caller can do is register a lineage
    ///      somebody else was going to register — after which the record agrees with what they
    ///      would have written, because both are the same derivation.
    /// @return child the derived node.
    function registerLineage(bytes32 parent, string calldata label) external returns (bytes32 child) {
        if (bytes(label).length == 0) revert EmptyLabel();
        child = keccak256(abi.encodePacked(parent, keccak256(bytes(label))));

        if (_known[child]) {
            // Idempotent, not an error: two callers racing to state the same fact both succeed.
            if (_parent[child] != parent || keccak256(bytes(_label[child])) != keccak256(bytes(label))) {
                revert LineageDisagrees(child, _parent[child], parent);
            }
            return child;
        }

        _known[child] = true;
        _parent[child] = parent;
        _label[child] = label;
        emit LineageRegistered(child, parent, label);
    }

    /// @inheritdoc IIdentityAuthority
    /// @dev `bytes32(0)` for a node whose lineage nobody has registered, which is the same value a
    ///      registered ROOT name answers with. `lineageKnown` is how the two are told apart; this
    ///      function keeps the interface's shape, and `TerminalAdmission` reads it twice in a row
    ///      and compares the result to a merchant node it was given, so an unregistered lineage
    ///      fails its check rather than passing it.
    function parentOf(bytes32 node) external view returns (bytes32) {
        return _parent[node];
    }

    /// @notice The label recorded for `node`, or `""` if its lineage was never registered.
    function labelOf(bytes32 node) external view returns (string memory) {
        return _label[node];
    }

    /// @notice Whether `node`'s lineage has been registered at all — the read that separates
    ///         "a root name, whose parent is genuinely zero" from "nobody has stated this yet".
    function lineageKnown(bytes32 node) external view returns (bool) {
        return _known[node];
    }
}
