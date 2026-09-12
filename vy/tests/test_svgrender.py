"""SvgRender: output = f(normalized_name, namehash, ens_deployment_id, renderer_version), and
nothing else -- never time, never an address, never caller-supplied entropy (H6, H11, N2).

The rows below check that determinism holds byte-for-byte, that the base64 helper matches
Python's own RFC 4648 implementation at every length class, that the JSON envelope carries
exactly the four required fields and decodes, and that the two required marks, the truncated
name and the fingerprint are all actually present in the rendered SVG.
"""

import base64 as _b64
import json
from pathlib import Path

import boa
from eth_utils import keccak
from hypothesis import given, settings, strategies as st

GOLDEN = json.loads((Path(__file__).parent / "vectors" / "identity-golden.json").read_text())
ENS_DEPLOYMENT_ID = bytes.fromhex(GOLDEN["ens_deployment_id_bytes32"][2:])
RENDERER_VERSION = GOLDEN["renderer_version"]


def namehash_py(name: str) -> bytes:
    node = b"\x00" * 32
    for label in reversed(name.split(".")):
        node = keccak(node + keccak(text=label))
    return node


# ---- golden vectors: fingerprint matched byte for byte -------------------------------------

def test_at_least_six_golden_names():
    assert len(GOLDEN["vectors"]) >= 6


def test_golden_fingerprints_match(svgrender):
    for v in GOLDEN["vectors"]:
        nh = bytes.fromhex(v["namehash"][2:])
        fp = svgrender.fingerprint(v["name"], nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION)
        assert fp == v["fingerprint"], v["name"]


# ---- determinism (H6): identical inputs, identical output, forever ------------------------

def test_render_is_byte_identical_across_two_calls(svgrender):
    name = "acme.unica.eth"
    nh = namehash_py(name)
    a = svgrender.render(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION)
    b = svgrender.render(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION)
    assert a == b


def test_render_is_byte_identical_across_two_deployments(svgrender):
    other = boa.load("src/art/svgrender.vy")
    name = "acme.unica.eth"
    nh = namehash_py(name)
    a = svgrender.render(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION)
    b = other.render(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION)
    assert a == b


def test_render_is_identical_across_block_numbers_and_time(svgrender):
    """A tokenURI/render call reading block state would make two calls at different blocks
    for the same inputs potentially disagree -- this asserts the opposite, directly."""
    name = "acme.unica.eth"
    nh = namehash_py(name)
    before = svgrender.render(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION)
    boa.env.time_travel(seconds=10_000_000)
    after = svgrender.render(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION)
    assert before == after


def test_varying_any_one_of_the_three_inputs_changes_the_output(svgrender):
    name = "acme.unica.eth"
    nh = namehash_py(name)
    base = svgrender.render(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION)

    other_name = "other.unica.eth"
    assert svgrender.render(other_name, namehash_py(other_name), ENS_DEPLOYMENT_ID, RENDERER_VERSION) != base

    other_nh = keccak(nh + b"x")   # a different, still namehash-shaped 32-byte value
    assert svgrender.render(name, other_nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION) != base

    other_ens_id = keccak(text="a different ensv2 deployment")
    assert svgrender.render(name, nh, other_ens_id, RENDERER_VERSION) != base

    assert svgrender.render(name, nh, ENS_DEPLOYMENT_ID, "unica-identity-svg/2") != base


# ---- the SVG carries what N8/N9 require -----------------------------------------------------

def test_svg_contains_both_required_marks(svgrender):
    name = "acme.unica.eth"
    nh = namehash_py(name)
    svg = svgrender.render(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION)
    assert "SEPOLIA TESTNET" in svg
    assert "ENSv2 BETA - NO VALUE" in svg


def test_svg_contains_the_fingerprint_and_truncated_name(svgrender):
    name = "acme.unica.eth"
    nh = namehash_py(name)
    fp = svgrender.fingerprint(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION)
    svg = svgrender.render(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION)
    assert fp in svg
    assert name in svg   # short enough not to be truncated


def test_long_name_is_truncated_in_the_svg(svgrender):
    name = "a" * 60 + ".merchant.unica.eth"
    nh = namehash_py(name)
    svg = svgrender.render(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION)
    assert name not in svg
    assert "..." in svg
    assert "unica.eth" in svg   # the final two labels always survive whole


def test_long_two_label_name_keeps_the_merchant_label_whole_in_the_svg(svgrender):
    """Security-review finding, 2026-09-11: for a TWO-label name, the final two labels ARE
    the merchant label plus the tld, so this is the case that most directly proves the
    fix -- the merchant-identifying label must never be dropped."""
    name = "reallylongmerchantnamehere.eth"
    nh = namehash_py(name)
    svg = svgrender.render(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION)
    assert "reallylongmerchantnamehere.eth" in svg


def test_render_reverts_on_a_non_normalized_name(svgrender):
    with boa.reverts():
        svgrender.render("NOT-NORMALIZED", b"\x00" * 32, ENS_DEPLOYMENT_ID, RENDERER_VERSION)


def test_render_stays_within_the_declared_bound(svgrender):
    name = "a" * 63 + "." + "b" * 63 + "." + "c" * 63 + ".eth"
    nh = namehash_py(name)
    svg = svgrender.render(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION)
    assert len(svg) <= 8192


# ---- base64: RFC 4648, checked against Python's own implementation ------------------------

@given(st.binary(min_size=0, max_size=400))
@settings(max_examples=60)
def test_base64_matches_python_at_every_length_class(svgrender, data):
    assert svgrender.base64(data) == _b64.b64encode(data).decode()


def test_base64_boundary_lengths_explicitly(svgrender):
    for n in range(0, 10):
        data = bytes(range(n))
        assert svgrender.base64(data) == _b64.b64encode(data).decode(), n


# ---- tokenURI JSON envelope: exactly four keys, decodable ----------------------------------

def test_token_uri_json_has_exactly_the_required_four_fields(svgrender):
    name = "acme.unica.eth"
    nh = namehash_py(name)
    uri = svgrender.token_uri_json(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION,
                                    "https://unica.example/id/", 1)
    assert uri.startswith("data:application/json;base64,")
    raw = _b64.b64decode(uri[len("data:application/json;base64,"):])
    parsed = json.loads(raw)
    assert set(parsed.keys()) == {"name", "description", "image", "external_url"}
    assert parsed["name"] == name
    assert parsed["external_url"] == "https://unica.example/id/1"
    assert parsed["image"].startswith("data:image/svg+xml;base64,")
    svg_from_json = _b64.b64decode(
        parsed["image"][len("data:image/svg+xml;base64,"):]
    ).decode()
    assert svg_from_json == svgrender.render(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION)


def test_token_id_above_999_is_not_clamped(svgrender):
    """Security-review finding, 2026-09-11: this function used to encode the tokenId with
    `_uint3`, which silently clamps anything past 999 down to "999" -- diverging from
    identity_token.vy's own full-decimal encoding of the very same field. Both
    implementations must produce byte-identical output for the same inputs."""
    name = "acme.unica.eth"
    nh = namehash_py(name)
    uri = svgrender.token_uri_json(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION,
                                    "https://unica.example/id/", 1000)
    raw = _b64.b64decode(uri[len("data:application/json;base64,"):])
    parsed = json.loads(raw)
    assert parsed["external_url"] == "https://unica.example/id/1000"


def test_renderer_version_is_xml_and_json_escaped(svgrender):
    """Security-review finding, 2026-09-11: RENDERER_VERSION/external_url_base used to be
    interpolated raw into SVG text and the JSON envelope with escape_xml/escape_json
    defined but never called anywhere. A version string containing an XML/JSON special
    character must render safely rather than corrupt the document."""
    name = "acme.unica.eth"
    nh = namehash_py(name)
    hostile_version = 'v1"<x>&'
    svg = svgrender.render(name, nh, ENS_DEPLOYMENT_ID, hostile_version)
    assert '"<x>&' not in svg
    assert "&quot;&lt;x&gt;&amp;" in svg

    uri = svgrender.token_uri_json(name, nh, ENS_DEPLOYMENT_ID, hostile_version,
                                    "https://unica.example/id/", 1)
    raw = _b64.b64decode(uri[len("data:application/json;base64,"):])
    parsed = json.loads(raw)   # must not raise -- proves the JSON stayed well-formed
    assert hostile_version in parsed["description"]


def test_description_never_carries_forbidden_fields(svgrender):
    """N4/N5: no attributes, animation_url, background_color, payment totals, receipt
    counts, live status, marketing copy, or a claim of current ENS ownership."""
    name = "acme.unica.eth"
    nh = namehash_py(name)
    uri = svgrender.token_uri_json(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION,
                                    "https://unica.example/id/", 1)
    raw = _b64.b64decode(uri[len("data:application/json;base64,"):])
    parsed = json.loads(raw)
    desc = parsed["description"].lower()
    for forbidden in ("attributes", "animation_url", "background_color",
                      "total paid", "receipt", "active", "verified merchant"):
        assert forbidden not in desc
    assert "identity artwork only" in desc
    assert "not proof of payment" in desc


def test_token_uri_json_deterministic_across_time(svgrender):
    name = "acme.unica.eth"
    nh = namehash_py(name)
    a = svgrender.token_uri_json(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION,
                                  "https://unica.example/id/", 1)
    boa.env.time_travel(seconds=5_000_000)
    b = svgrender.token_uri_json(name, nh, ENS_DEPLOYMENT_ID, RENDERER_VERSION,
                                  "https://unica.example/id/", 1)
    assert a == b
