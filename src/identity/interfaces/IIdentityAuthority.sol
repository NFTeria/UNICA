// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// LOCAL ENSv2-COMPATIBLE FIXTURE for Anvil integration tests. Not the isolated ENSv2 Sepolia
// deployment; mirrors its measured Enhanced Access Control shape (per-key text resources, role
// bitmaps, admin bits at +128) so the order-admission path can be tested end to end without a
// network. Pinned Sepolia configuration lives in integrations/ensv2/profile.mjs.

/// @title IIdentityAuthority
/// @notice The narrow read surface an order-admission contract needs from an ENSv2-shaped identity
///         system: who controls a name, what its parent is, whether an account holds a role
///         bitmap at a resource, and its text/addr records. Written from
///         `docs/unica-v5/ens/ACCESS-CONTROL.md` §5, §8-9 and `docs/unica-v5/ens/POS-TERMINALS.md`
///         §3-6 — never from a copied implementation.
/// @dev `hasRoles` is the only authoritative role read (ACCESS-CONTROL.md §3.2's own warning:
///      `roles()` alone omits anything granted at `ROOT_RESOURCE`). Nothing here is specific to
///      any one deployment; a caller that only knows this interface cannot tell whether it is
///      talking to a local fixture or a real ENSv2-shaped registry+resolver pair.
interface IIdentityAuthority {
    /// @notice True iff `account` is the registered owner of `node`.
    function isNamespaceController(bytes32 node, address account) external view returns (bool);

    /// @notice The current owner of `node`, or the zero address if `node` was never registered.
    function ownerOf(bytes32 node) external view returns (address);

    /// @notice The parent of `node` as recorded at registration, or `bytes32(0)` for a root name.
    function parentOf(bytes32 node) external view returns (bytes32);

    /// @notice True when `account` holds every bit of `roleBitmap` at `resource` — folding in
    ///         whatever is held at `ROOT_RESOURCE`, per the read rule this interface exists to
    ///         make impossible to get wrong from the outside.
    function hasRoles(uint256 resource, uint256 roleBitmap, address account) external view returns (bool);

    /// @notice The text record `key` on `node`, or `""` if never set.
    function text(bytes32 node, string calldata key) external view returns (string memory);

    /// @notice The address record on `node`, or the zero address if never set.
    function addr(bytes32 node) external view returns (address);

    /// @notice The per-key resource `setText`/`authorizeTextRoles` scope to for (`node`, `key`),
    ///         derived exactly as the measured resolver shape derives it
    ///         (`integrations/ensv2/profile.mjs`'s `resolverScopedResource`/`textScopeHash`):
    ///         `uint256(keccak256(abi.encode(node, keccak256(bytes(key)))))`.
    function textResource(bytes32 node, string calldata key) external pure returns (uint256);
}
