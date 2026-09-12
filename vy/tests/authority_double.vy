# pragma version 0.4.3
"""
@title  AuthorityDouble
@notice A tiny, deliberately trivial stand-in for IIdentityAuthority, used only by
        vy/tests/test_identity_token.py (loaded directly with `boa.load`, never under
        vy/src/ -- a test double is not a shipped contract). Lets a test flip a
        (node, account) pair's namespace-controller answer without any real ENS state.

        The (node, account) pair is flattened into a single keccak256 key rather than a
        two-level `HashMap[bytes32, HashMap[address, bool]]`: a nested HashMap at slot 0
        was found, while writing this file's tests, to collide with
        `vy/src/unica/merchant_policy.vy`'s own single-level `policies` HashMap inside
        titanoboa 0.2.8's global storage-preimage trace when both contracts are loaded in
        the same `mox test` process -- a pinned-tool interaction, not a Vyper semantics
        issue, and one this double avoids entirely by never nesting HashMaps.
"""

allowed: public(HashMap[bytes32, bool])


@internal
@pure
def _key(node: bytes32, account: address) -> bytes32:
    return keccak256(concat(node, convert(account, bytes32)))


@external
def set(node: bytes32, account: address, ok: bool):
    self.allowed[self._key(node, account)] = ok


@external
@view
def isNamespaceController(node: bytes32, account: address) -> bool:
    return self.allowed[self._key(node, account)]
