"""IdentityToken: an ERC-721 written from EIP-721's text, non-transferable (N7), bound to
namespace authority at mint (N7), and whose tokenURI reads no mutable external state (N2).

`identity_token` (vy/tests/conftest.py) is FUNCTION scoped -- a token minted by one example
must not exist in the next -- and is wired to a fresh `authority_double`
(vy/tests/authority_double.vy) each time.
"""

import base64
import json
from pathlib import Path

import boa
import pytest
from eth_utils import keccak


def namehash_py(name: str) -> bytes:
    node = b"\x00" * 32
    for label in reversed(name.split(".")):
        node = keccak(node + keccak(text=label))
    return node


NAME = "acme.unica.eth"
NODE = namehash_py(NAME)


def _mint(identity_token, authority_double, name=NAME, node=None, to=None, minter=None):
    node = NODE if node is None else node
    to = to or boa.env.generate_address()
    minter = minter or identity_token.MINTER()
    authority_double.set(node, to, True)
    token_id = identity_token.mint(to, node, name, sender=minter)
    return token_id, to


# ---- minting: authority, namehash, one-per-node ---------------------------------------------

def test_mint_succeeds_for_the_namespace_controller(identity_token, authority_double):
    token_id, to = _mint(identity_token, authority_double)
    assert token_id == 1
    assert identity_token.ownerOf(token_id) == to
    assert identity_token.balanceOf(to) == 1
    assert identity_token.node_of(token_id) == NODE
    assert identity_token.name_of(token_id) == NAME
    assert identity_token.token_of_node(NODE) == token_id
    assert identity_token.total_minted() == 1


def test_token_ids_are_sequential_from_one(identity_token, authority_double):
    to = boa.env.generate_address()
    minter = identity_token.MINTER()
    for i, name in enumerate(["a.unica.eth", "b.unica.eth", "c.unica.eth"], start=1):
        node = namehash_py(name)
        authority_double.set(node, to, True)
        token_id = identity_token.mint(to, node, name, sender=minter)
        assert token_id == i
    assert identity_token.total_minted() == 3


def test_mint_reverts_for_a_non_minter(identity_token, authority_double):
    to = boa.env.generate_address()
    authority_double.set(NODE, to, True)
    with boa.reverts():
        identity_token.mint(to, NODE, NAME, sender=to)


def test_mint_reverts_when_the_authority_refuses(identity_token, authority_double):
    to = boa.env.generate_address()
    minter = identity_token.MINTER()
    # deliberately never call authority_double.set(...): the default answer is False
    with boa.reverts():
        identity_token.mint(to, NODE, NAME, sender=minter)


def test_mint_reverts_when_namehash_does_not_match_the_node(identity_token, authority_double):
    to = boa.env.generate_address()
    minter = identity_token.MINTER()
    authority_double.set(NODE, to, True)
    with boa.reverts():
        identity_token.mint(to, NODE, "different.unica.eth", sender=minter)


def test_mint_reverts_on_a_second_mint_of_the_same_node(identity_token, authority_double):
    token_id, to = _mint(identity_token, authority_double)
    other = boa.env.generate_address()
    authority_double.set(NODE, other, True)
    with boa.reverts():
        identity_token.mint(other, NODE, NAME, sender=identity_token.MINTER())


def test_mint_reverts_on_a_non_normalized_name(identity_token, authority_double):
    to = boa.env.generate_address()
    minter = identity_token.MINTER()
    bad_name = "NOT-NORMALIZED.unica.eth"
    with boa.reverts():
        identity_token.mint(to, namehash_py(bad_name.lower()), bad_name, sender=minter)


def test_mint_emits_a_transfer_from_zero(identity_token, authority_double):
    to = boa.env.generate_address()
    minter = identity_token.MINTER()
    authority_double.set(NODE, to, True)
    identity_token.mint(to, NODE, NAME, sender=minter)
    logs = identity_token.get_logs()
    transfers = [l for l in logs if type(l).__name__ == "Transfer"]
    assert len(transfers) == 1
    assert transfers[0].sender == "0x0000000000000000000000000000000000000000"
    assert transfers[0].receiver == to
    assert transfers[0].token_id == 1


# ---- tokenURI: correct shape, and reads no mutable state (N2) ------------------------------

def test_token_uri_json_has_exactly_four_fields_and_decodes(identity_token, authority_double):
    token_id, to = _mint(identity_token, authority_double)
    uri = identity_token.tokenURI(token_id)
    assert uri.startswith("data:application/json;base64,")
    raw = base64.b64decode(uri[len("data:application/json;base64,"):])
    parsed = json.loads(raw)
    assert set(parsed.keys()) == {"name", "description", "image", "external_url"}
    assert parsed["name"] == NAME
    assert parsed["external_url"] == f"https://unica.example/id/{token_id}"
    assert parsed["image"].startswith("data:image/svg+xml;base64,")


def test_token_uri_reverts_for_a_nonexistent_token(identity_token):
    with boa.reverts():
        identity_token.tokenURI(999)


def test_token_uri_is_byte_identical_across_two_calls(identity_token, authority_double):
    token_id, _ = _mint(identity_token, authority_double)
    a = identity_token.tokenURI(token_id)
    b = identity_token.tokenURI(token_id)
    assert a == b


def test_token_uri_is_identical_after_a_time_travel(identity_token, authority_double):
    token_id, _ = _mint(identity_token, authority_double)
    before = identity_token.tokenURI(token_id)
    boa.env.time_travel(seconds=50_000_000)
    after = identity_token.tokenURI(token_id)
    assert before == after


def test_token_uri_is_unaffected_by_the_authority_changing_its_answer(identity_token, authority_double):
    """N2: tokenURI reads no mutable external state. Changing what the authority would say
    TODAY about this node must not change a token already minted."""
    token_id, to = _mint(identity_token, authority_double)
    before = identity_token.tokenURI(token_id)
    authority_double.set(NODE, to, False)   # the authority now says "no" for this node/account
    after = identity_token.tokenURI(token_id)
    assert before == after


def test_fingerprint_of_matches_svgrender(identity_token, authority_double, svgrender):
    token_id, _ = _mint(identity_token, authority_double)
    expected = svgrender.fingerprint(
        NAME, NODE, identity_token.ENS_DEPLOYMENT_ID(), identity_token.RENDERER_VERSION()
    )
    assert identity_token.fingerprint_of(token_id) == expected


def test_minted_at_is_recorded_once_and_not_reused_by_tokenuri(identity_token, authority_double):
    token_id, _ = _mint(identity_token, authority_double)
    minted_at = identity_token.minted_at(token_id)
    assert minted_at == boa.env.evm.patch.timestamp
    uri_before = identity_token.tokenURI(token_id)
    boa.env.time_travel(seconds=999)
    assert identity_token.minted_at(token_id) == minted_at   # never re-read/updated
    assert identity_token.tokenURI(token_id) == uri_before


# ---- non-transferable (N7): every transfer/approval path reverts, ownerOf never moves ------

def test_transfer_from_reverts(identity_token, authority_double):
    token_id, to = _mint(identity_token, authority_double)
    other = boa.env.generate_address()
    with boa.reverts("NonTransferable"):
        identity_token.transferFrom(to, other, token_id, sender=to)
    assert identity_token.ownerOf(token_id) == to


def test_safe_transfer_from_three_arg_reverts(identity_token, authority_double):
    token_id, to = _mint(identity_token, authority_double)
    other = boa.env.generate_address()
    with boa.reverts("NonTransferable"):
        identity_token.safeTransferFrom(to, other, token_id, sender=to)
    assert identity_token.ownerOf(token_id) == to


def test_safe_transfer_from_four_arg_reverts(identity_token, authority_double):
    token_id, to = _mint(identity_token, authority_double)
    other = boa.env.generate_address()
    with boa.reverts("NonTransferable"):
        identity_token.safeTransferFrom(to, other, token_id, b"", sender=to)
    assert identity_token.ownerOf(token_id) == to


def test_approve_reverts(identity_token, authority_double):
    token_id, to = _mint(identity_token, authority_double)
    other = boa.env.generate_address()
    with boa.reverts("NonTransferable"):
        identity_token.approve(other, token_id, sender=to)
    assert identity_token.getApproved(token_id) == "0x0000000000000000000000000000000000000000"


def test_set_approval_for_all_reverts(identity_token, authority_double):
    token_id, to = _mint(identity_token, authority_double)
    other = boa.env.generate_address()
    with boa.reverts("NonTransferable"):
        identity_token.setApprovalForAll(other, True, sender=to)
    assert identity_token.isApprovedForAll(to, other) is False


# ---- ERC-721 views ---------------------------------------------------------------------------

def test_name_and_symbol(identity_token):
    assert identity_token.name() == "UNICA Identity"
    assert identity_token.symbol() == "UNICA-ID"


def test_balance_of_zero_address_reverts(identity_token):
    with boa.reverts():
        identity_token.balanceOf("0x0000000000000000000000000000000000000000")


def test_owner_of_nonexistent_token_reverts(identity_token):
    with boa.reverts():
        identity_token.ownerOf(999)


@pytest.mark.parametrize("interface_id,expected", [
    (bytes.fromhex("01ffc9a7"), True),    # ERC165
    (bytes.fromhex("80ac58cd"), True),    # ERC721
    (bytes.fromhex("5b5e139f"), True),    # ERC721Metadata
    (bytes.fromhex("ffffffff"), False),
    (bytes.fromhex("00000000"), False),
])
def test_supports_interface(identity_token, interface_id, expected):
    assert identity_token.supportsInterface(interface_id) is expected


def test_constructor_immutables_are_exposed(identity_token, authority_double):
    assert identity_token.MINTER() == boa.env.eoa
    assert identity_token.AUTHORITY() == authority_double.address
    assert identity_token.RENDERER_VERSION() == "unica-identity-svg/1"
    assert identity_token.EXTERNAL_URL_BASE() == "https://unica.example/id/"
    assert len(identity_token.ENS_DEPLOYMENT_ID()) == 32
    assert identity_token.REGISTRY_POINTER() is not None


# ---- constructor-time string validation (security review, 2026-09-11) ----------------------
#
# RENDERER_VERSION and EXTERNAL_URL_BASE are escaped wherever they enter the SVG/JSON (so a
# hostile value can never corrupt either document), but a value that NEEDED escaping in the
# first place is almost certainly a deployment mistake -- refused up front, once, rather than
# silently tolerated forever after.

IDENTITY_TOKEN_VY = str(Path(__file__).parent.parent / "src" / "art" / "identity_token.vy")


def _deploy(authority_double, renderer_version="unica-identity-svg/1",
            external_url_base="https://unica.example/id/"):
    return boa.load(
        IDENTITY_TOKEN_VY,
        boa.env.eoa, authority_double.address, boa.env.generate_address(),
        keccak(text="unica-ensv2-sepolia-v1"), renderer_version, external_url_base,
    )


def test_constructor_rejects_a_renderer_version_with_a_quote(authority_double):
    with boa.reverts("UnsafeConstructorString"):
        _deploy(authority_double, renderer_version='v1"x')


def test_constructor_rejects_an_external_url_base_with_angle_brackets(authority_double):
    with boa.reverts("UnsafeConstructorString"):
        _deploy(authority_double, external_url_base='https://evil.example/"><script>')


@pytest.mark.parametrize("bad_char", ['"', "'", "<", ">", "&", "\x01", "\x7f"])
def test_constructor_rejects_every_forbidden_character(authority_double, bad_char):
    with boa.reverts("UnsafeConstructorString"):
        _deploy(authority_double, renderer_version=f"v1{bad_char}")


def test_constructor_accepts_a_clean_renderer_version_and_url(authority_double):
    tok = _deploy(authority_double)
    assert tok.RENDERER_VERSION() == "unica-identity-svg/1"
    assert tok.EXTERNAL_URL_BASE() == "https://unica.example/id/"


# The escaping logic itself (defence in depth beyond the constructor guard above, for the
# case a hostile string reached storage some other way) is identical to svgrender.vy's own
# and is exercised directly there: test_svgrender.py::test_renderer_version_is_xml_and_json_escaped.


# ---- gas: tokenURI must stay well under a block's practical budget --------------------------

def test_token_uri_gas_stays_under_budget(identity_token, authority_double):
    """Measured while writing this file: a naive base64/JSON-assembly implementation that
    re-concatenates a growing accumulator one small piece at a time cost ~9.8M gas for a
    60-character name's tokenURI -- above this budget -- because that pattern recopies the
    entire accumulated output on every one of thousands of iterations. Batching the base64
    encoder (BASE64_BATCH_GROUPS groups per outer step) brought it down; this test is the
    permanent guard against that regressing silently."""
    name = "m" * 50 + ".unica.eth"
    node = namehash_py(name)
    to = boa.env.generate_address()
    authority_double.set(node, to, True)
    token_id = identity_token.mint(to, node, name, sender=identity_token.MINTER())

    before = boa.env.get_gas_used()
    identity_token.tokenURI(token_id)
    gas = boa.env.get_gas_used() - before
    print(f"\n  tokenURI gas for a 60-character name: {gas:,}")
    assert gas < 8_000_000, f"tokenURI cost {gas:,} gas, over the 8,000,000 budget"
