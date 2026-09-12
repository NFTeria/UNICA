// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {console} from "forge-std/console.sol";
import {ForkPin} from "./ForkPin.sol";
import {EnsV2ResolverAuthority} from "../../src/identity/EnsV2ResolverAuthority.sol";

/// @dev The measured PermissionedResolver surface, as `integrations/ensv2/permissioned.mjs`
///      `SIGNATURES` records it. `authorizeTextRoles` takes the DNS-encoded name, not the namehash.
interface ILivePermissionedResolver {
    function hasRoles(uint256 resource, uint256 roleBitmap, address account) external view returns (bool);
    function roles(uint256 resource, address account) external view returns (uint256);
    function hasRootRoles(uint256 roleBitmap, address account) external view returns (bool);
    function text(bytes32 node, string calldata key) external view returns (string memory);
    function addr(bytes32 node) external view returns (address);
    function authorizeTextRoles(bytes calldata name, string calldata key, address account, bool granted)
        external
        returns (bool);
}

interface ILivePermissionedRegistry {
    function getResolver(string calldata label) external view returns (address);
    function findOwner(string calldata label) external view returns (address);
}

/// @title The ENSv2 Sepolia adapter against the real deployment
/// @notice READ-MOSTLY, AND NOTHING BROADCASTS. Every write below happens INSIDE A LOCAL FORK, as
///         the name's owner, impersonated with `vm.prank`. `unica.eth`'s resolver on Sepolia is not
///         touched, and no row claims it was.
///
///         WHY THIS SUITE DOES NOT RUN AT `ForkPin.DEFAULT_BLOCK`. It cannot: the ENSv2 name this
///         adapter is for did not exist yet. MEASURED, not assumed — at 11661031 and again at
///         11666085, `getResolver("unica")` on the ETHRegistry returns the zero address and the
///         resolver proxy carries no code; a bisection between 11666085 and 11686000 puts the
///         proxy's first code at block 11669951. So this suite keeps ForkPin's chain id, its URL
///         rule and its `UNICA_FORK_BLOCK` override, and supplies its own default block that is
///         late enough for the name to exist. The relationship between the two constants is
///         ASSERTED below rather than left in this comment.
///
///         THE ENDPOINT. `_forkUrl()` is ForkPin's: `SEPOLIA_RPC_URL` if it is set, otherwise a
///         public keyless node. Nothing here prints it. On a pruning endpoint the default block
///         will eventually stop resolving; that is what `UNICA_FORK_BLOCK` is for, and the failure
///         when it happens is forge saying the state is unavailable — loud, and not a pass.
///
///         RUNNER DISCIPLINE. Every row runs inside ONE test function, in order, against ONE fork:
///         a per-row `setUp` would re-fork over somebody else's RPC a dozen times, and rows that
///         each fork separately cannot share the "before / after" measurement that is the point of
///         this file. `DECLARED_ROWS` is checked against the rows actually executed at the end, and
///         the ledger is printed. There is no skip path — a missing endpoint fails fork creation.
contract EnsV2AuthorityForkTest is ForkPin {
    // ── the pins ─────────────────────────────────────────────────────────────────────────────────

    /// @dev Measured by bisection on 2026-09-11: the per-name resolver proxy for `unica.eth` has no
    ///      code at 11669950 and has code at 11669951.
    uint256 internal constant ENSV2_RESOLVER_FIRST_CODE_BLOCK = 11669951;

    /// @dev This suite's default block. Overridable with `UNICA_FORK_BLOCK`, exactly as ForkPin's.
    uint256 internal constant ENSV2_PIN_BLOCK = 11685000;

    /// @notice The ONLY ENSv2 address this repository hard-codes: the fixed Universal Resolver
    ///         entry point. Everything below it — the middle proxy, the implementation, the
    ///         registries, and above all the per-name resolver — is volatile and is read live.
    address internal constant UNIVERSAL_RESOLVER = 0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe;

    /// @dev The `.eth` PermissionedRegistry, from `script/ensv2/unica-sepolia.json` `parentRegistry`
    ///      and `profile.mjs`'s `ETHRegistry` row. Used here to READ the resolver pointer, never
    ///      compiled into `src/`.
    address internal constant ETH_REGISTRY = 0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2;

    /// @dev What the manifest says the resolver is. This suite reads the pointer off the registry
    ///      and compares; the manifest is checked, not trusted.
    address internal constant MANIFEST_RESOLVER = 0x3D2d26801632e7b13B2fa75236a634e75684988c;

    /// @dev The two profile.mjs rows the brief names as candidates for "the resolver". Both are
    ///      probed below and both are expected NOT to be the answer for `unica.eth` — they are
    ///      shared/implementation contracts, and the name's records live on its own proxy.
    address internal constant PROFILE_ENSV2_RESOLVER = 0x508cb4E4596429Ca98a1bB3112d88D18F92456b5;
    address internal constant PROFILE_PERMISSIONED_RESOLVER_IMPL = 0x9EAe5C2730a7dD16BDD1DeE6421a1B91e3B0365e;

    /// @dev `script/ensv2/unica-sepolia.json` `merchantOwner`, the account `_measured` records as
    ///      holding the name. Impersonated, never signed for.
    address internal constant NAME_OWNER = 0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73;

    string internal constant STATUS_KEY = "com.unica.terminal-status";

    uint256 internal constant ROLE_SET_ADDR = 1 << 0;
    uint256 internal constant ROLE_SET_TEXT = 1 << 4;
    uint256 internal constant ADMIN_SHIFT = 128;

    /// @notice Rows this file says it runs. Compared with the rows it actually ran, at the end.
    uint256 internal constant DECLARED_ROWS = 15;

    uint256 internal executedRows;
    uint256 internal skippedRows;

    ILivePermissionedResolver internal resolver;
    EnsV2ResolverAuthority internal authority;

    bytes32 internal ethNode;
    bytes32 internal unicaNode;
    address internal freshDelegate = makeAddr("unica-fork-fresh-delegate");
    address internal stranger = makeAddr("unica-fork-stranger");

    // ── helpers, written here from the definitions rather than imported ──────────────────────────

    function _ensForkBlock() internal view returns (uint256) {
        return vm.envOr("UNICA_FORK_BLOCK", ENSV2_PIN_BLOCK);
    }

    /// @dev The namehash recursion: `namehash("") = 0`, and each label folds in as
    ///      `keccak256(parent ‖ keccak256(label))`.
    function _child(bytes32 parent, string memory label) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(parent, keccak256(bytes(label))));
    }

    /// @dev DNS wire format for a two-label name: `<len><label><len><label><0>`.
    function _dnsEncode2(string memory a, string memory b) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(bytes(a).length), bytes(a), uint8(bytes(b).length), bytes(b), uint8(0));
    }

    function _row(string memory name) internal {
        executedRows += 1;
        console.log("row %s: %s", executedRows, name);
    }

    function setUp() public {
        require(
            DEFAULT_BLOCK < ENSV2_RESOLVER_FIRST_CODE_BLOCK,
            "the recorded reason for not using ForkPin.DEFAULT_BLOCK no longer holds; re-measure before editing"
        );
        require(
            _ensForkBlock() >= ENSV2_RESOLVER_FIRST_CODE_BLOCK,
            "UNICA_FORK_BLOCK is earlier than the block unica.eth's resolver first had code"
        );
        vm.createSelectFork(_forkUrl(), _ensForkBlock());
    }

    function test_ensV2ResolverAuthority_againstTheLiveDeployment() public {
        // ── row 1: the fork is the chain and the block it claims to be ───────────────────────────
        _row("fork identity");
        assertEq(block.chainid, PINNED_CHAIN_ID, "wrong chain");
        assertEq(block.number, _ensForkBlock(), "wrong block");
        console.log("  chain id      %s", block.chainid);
        console.log("  block         %s", block.number);
        console.log("  timestamp     %s", block.timestamp);

        // ── row 2: the one hard-coded address is really there ────────────────────────────────────
        _row("Universal Resolver entry point carries code");
        assertGt(UNIVERSAL_RESOLVER.code.length, 0, "the fixed entry point has no code at this block");
        console.log("  entry point   %s", UNIVERSAL_RESOLVER);
        console.log("  code size     %s", UNIVERSAL_RESOLVER.code.length);
        console.logBytes32(keccak256(UNIVERSAL_RESOLVER.code));

        // ── row 3: the resolver is READ off the registry, not taken from the manifest ────────────
        _row("getResolver(\"unica\") read live off the ETHRegistry");
        address live = ILivePermissionedRegistry(ETH_REGISTRY).getResolver("unica");
        console.log("  registry      %s", ETH_REGISTRY);
        console.log("  resolver      %s", live);
        console.log("  manifest says %s", MANIFEST_RESOLVER);
        assertTrue(live != address(0), "unica.eth has no resolver at this block");
        assertGt(live.code.length, 0, "the resolver pointer names an address with no code");
        assertEq(live, MANIFEST_RESOLVER, "the manifest's resolver is not the one the registry points at");
        console.log("  code size     %s", live.code.length);

        // ── row 4: WHICH contract answers text/addr for this name ────────────────────────────────
        _row("which candidate answers text/addr for the unica.eth node");
        ethNode = _child(bytes32(0), "eth");
        unicaNode = _child(ethNode, "unica");
        assertTrue(_answersRecords(live, unicaNode), "the live resolver pointer does not answer records");
        // The two profile.mjs rows the brief offered as candidates are the SHARED implementation and
        // the mirror-path resolver. Neither is the name's resolver; recorded rather than assumed.
        console.log("  live pointer answers records:            true");
        console.log("  profile ENSV2Resolver answers records:   %s", _answersRecords(PROFILE_ENSV2_RESOLVER, unicaNode));
        console.log(
            "  profile PermissionedResolverImpl answers: %s",
            _answersRecords(PROFILE_PERMISSIONED_RESOLVER_IMPL, unicaNode)
        );
        console.log("  NOTE: answering is not being this name's resolver. The shared implementation");
        console.log("  answers because it IS a resolver contract holding no state for this node, and");
        console.log("  a zero/empty answer is indistinguishable from an unset record. Only the");
        console.log("  registry's own pointer decides, which is why row 3 reads it.");
        assertTrue(live != PROFILE_ENSV2_RESOLVER, "the name's resolver is not profile.mjs's ENSV2Resolver row");
        assertTrue(
            live != PROFILE_PERMISSIONED_RESOLVER_IMPL, "the name's resolver is not the shared PermissionedResolverImpl"
        );
        resolver = ILivePermissionedResolver(live);

        // ── row 5: the namehash, computed here ───────────────────────────────────────────────────
        _row("namehash computed in the test");
        console.logBytes32(ethNode);
        console.logBytes32(unicaNode);
        assertTrue(unicaNode != bytes32(0), "namehash(unica.eth) must not be zero");
        assertTrue(unicaNode != ethNode, "the two nodes must differ");

        // ── row 6: the adapter, deployed into the fork against the live resolver ─────────────────
        _row("deploy the adapter against the live resolver");
        authority = new EnsV2ResolverAuthority(live);
        assertEq(address(authority.RESOLVER()), live, "the adapter is bound to the wrong resolver");

        // ── row 7: addr, read through the adapter and off the resolver, and printed ──────────────
        _row("addr(unica.eth) read from chain");
        address a = authority.addr(unicaNode);
        console.log("  addr          %s", a);
        assertEq(a, resolver.addr(unicaNode), "the adapter's addr disagrees with the resolver's");

        // ── row 8: text, likewise ────────────────────────────────────────────────────────────────
        _row("text(unica.eth, terminal-status) read from chain");
        string memory t = authority.text(unicaNode, STATUS_KEY);
        console.log("  text          '%s'", t);
        assertEq(
            keccak256(bytes(t)), keccak256(bytes(resolver.text(unicaNode, STATUS_KEY))), "the adapter's text disagrees"
        );

        // ── row 9: lineage ───────────────────────────────────────────────────────────────────────
        _row("register the lineage unica under eth");
        bytes32 child = authority.registerLineage(ethNode, "unica");
        assertEq(child, unicaNode, "the lineage derivation is not the namehash recursion");
        assertEq(authority.parentOf(unicaNode), ethNode, "parentOf(namehash(unica.eth)) is not namehash(eth)");
        assertEq(authority.labelOf(unicaNode), "unica", "the label was not recorded");

        // ── row 10: the per-key resource, and the before reading ─────────────────────────────────
        _row("per-key resource, before the grant");
        uint256 perKey = authority.textResource(unicaNode, STATUS_KEY);
        uint256 nameLevel = uint256(keccak256(abi.encode(unicaNode, bytes32(0))));
        console.log("  per-key resource");
        console.logBytes32(bytes32(perKey));
        console.log("  name-level resource");
        console.logBytes32(bytes32(nameLevel));
        bool before = resolver.hasRoles(perKey, ROLE_SET_TEXT, freshDelegate);
        console.log("  hasRoles(perKey, SET_TEXT, fresh) BEFORE = %s", before);
        console.log("  roles(perKey, fresh) BEFORE              = %s", resolver.roles(perKey, freshDelegate));
        assertFalse(before, "the fresh address already holds SET_TEXT at this resource; it is not fresh");

        // ── row 11: THE MEASUREMENT — the grant, on the live bytecode ────────────────────────────
        _row("authorizeTextRoles from the name owner, on the live bytecode");
        bytes memory dns = _dnsEncode2("unica", "eth");
        console.logBytes(dns);
        vm.prank(NAME_OWNER);
        bool accepted = resolver.authorizeTextRoles(dns, STATUS_KEY, freshDelegate, true);
        assertTrue(accepted, "the owner's authorizeTextRoles was not accepted");

        bool atPerKey = resolver.hasRoles(perKey, ROLE_SET_TEXT, freshDelegate);
        uint256 rawPerKey = resolver.roles(perKey, freshDelegate);
        uint256 rawNameLevel = resolver.roles(nameLevel, freshDelegate);
        uint256 rawRoot = resolver.roles(0, freshDelegate);
        console.log("  hasRoles(perKey, SET_TEXT, fresh) AFTER  = %s", atPerKey);
        console.log("  roles(perKey, fresh)     AFTER = %s", rawPerKey);
        console.log("  roles(nameLevel, fresh)  AFTER = %s", rawNameLevel);
        console.log("  roles(ROOT, fresh)       AFTER = %s", rawRoot);
        assertTrue(
            atPerKey,
            "THE LIVE RESOLVER DOES NOT HONOUR THE PER-KEY RESOURCE: authorizeTextRoles was accepted but the "
            "SET_TEXT bit is not readable at keccak256(abi.encode(node, keccak256(key)))"
        );
        assertEq(
            rawPerKey, ROLE_SET_TEXT, "the grant wrote something other than exactly SET_TEXT at the per-key resource"
        );
        assertEq(rawNameLevel, 0, "the grant leaked to the name-level resource");
        assertEq(rawRoot, 0, "the grant leaked to ROOT_RESOURCE");

        // ── row 12: the grant is ONE key wide ────────────────────────────────────────────────────
        _row("a second key of the same name is untouched");
        uint256 otherKey = authority.textResource(unicaNode, "com.unica.agent-status");
        assertFalse(
            resolver.hasRoles(otherKey, ROLE_SET_TEXT, freshDelegate), "one authorized key carried authority to another"
        );
        console.log("  hasRoles(otherKey, SET_TEXT, fresh)      = false");

        // ── row 13: the revocation ───────────────────────────────────────────────────────────────
        _row("authorizeTextRoles(..., false) takes it away again");
        vm.prank(NAME_OWNER);
        bool revoked = resolver.authorizeTextRoles(dns, STATUS_KEY, freshDelegate, false);
        assertTrue(revoked, "the owner's revocation was not accepted");
        bool afterRevoke = resolver.hasRoles(perKey, ROLE_SET_TEXT, freshDelegate);
        console.log("  hasRoles(perKey, SET_TEXT, fresh) GONE   = %s", !afterRevoke);
        console.log("  roles(perKey, fresh)     AFTER REVOKE = %s", resolver.roles(perKey, freshDelegate));
        assertFalse(afterRevoke, "the revocation did not remove the bit");

        // ── row 14: the control that makes the acceptance mean something ─────────────────────────
        _row("the same call from a stranger is refused");
        vm.prank(stranger);
        vm.expectRevert();
        resolver.authorizeTextRoles(dns, STATUS_KEY, freshDelegate, true);
        console.log("  stranger refused: true");

        // ── row 15: the adapter's own two answers on live state ──────────────────────────────────
        _row("isNamespaceController and ownerOf on live state");
        bool ownerControls = authority.isNamespaceController(unicaNode, NAME_OWNER);
        bool strangerControls = authority.isNamespaceController(unicaNode, stranger);
        console.log("  isNamespaceController(unica.eth, owner)    = %s", ownerControls);
        console.log("  isNamespaceController(unica.eth, stranger) = %s", strangerControls);
        console.log("  roles(ROOT, owner) on this resolver:");
        console.logBytes32(bytes32(resolver.roles(0, NAME_OWNER)));
        assertTrue(ownerControls, "the name's owner must read as its namespace controller");
        assertFalse(strangerControls, "a stranger must not read as the namespace controller");
        vm.expectRevert(
            abi.encodeWithSelector(EnsV2ResolverAuthority.OwnerNotEnumerable.selector, address(resolver), unicaNode)
        );
        authority.ownerOf(unicaNode);

        // ── the ledger ───────────────────────────────────────────────────────────────────────────
        console.log("---- ENSv2 authority fork ledger ----");
        console.log("  block            %s", block.number);
        console.log("  declared rows    %s", DECLARED_ROWS);
        console.log("  executed rows    %s", executedRows);
        console.log("  skipped rows     %s", skippedRows);
        assertEq(executedRows, DECLARED_ROWS, "declared rows and executed rows disagree");
        assertEq(skippedRows, 0, "a row was skipped");
    }

    /// @dev Does `candidate` answer BOTH record reads for `node` without reverting? A code-less
    ///      address fails the first call, which is the point: `0x` decodes as a zero answer and a
    ///      probe that swallowed it would report "answers, with nothing" for an empty account.
    function _answersRecords(address candidate, bytes32 node) internal view returns (bool) {
        if (candidate.code.length == 0) return false;
        try ILivePermissionedResolver(candidate).addr(node) returns (address) {
            try ILivePermissionedResolver(candidate).text(node, STATUS_KEY) returns (string memory) {
                return true;
            } catch {
                return false;
            }
        } catch {
            return false;
        }
    }
}
