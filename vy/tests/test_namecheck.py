"""NameCheck: does the on-chain gate match `web/ensv2/resolve.mjs`'s normalizeName exactly,
and is EIP-137 namehash correct, total, and fail-closed on anything that is not normalized.

Golden vectors live in vy/tests/vectors/identity-golden.json so namecheck, svgrender and
identity_token can all be checked against the SAME fixed set of names and expectations.
"""

import json
from pathlib import Path

import boa
import pytest
from eth_utils import keccak
from hypothesis import given, settings, strategies as st

GOLDEN = json.loads((Path(__file__).parent / "vectors" / "identity-golden.json").read_text())
GOLDEN_NAMES = [v["name"] for v in GOLDEN["vectors"]]


def namehash_py(name: str) -> bytes:
    """Independent, off-chain re-implementation of ENSIP-1, used to cross-check the
    contract rather than to assert against a value only the contract itself produced."""
    node = b"\x00" * 32
    for label in reversed(name.split(".")):
        node = keccak(node + keccak(text=label))
    return node


# ---- the golden vectors, matched byte for byte -------------------------------------------

@pytest.mark.parametrize("vector", GOLDEN["vectors"], ids=GOLDEN_NAMES)
def test_golden_vectors_match_byte_for_byte(namecheck, vector):
    name = vector["name"]
    assert namecheck.is_normalized(name) == vector["is_normalized"]
    assert "0x" + namecheck.namehash(name).hex() == vector["namehash"]
    assert namecheck.label_count(name) == vector["label_count"]
    assert namecheck.last_two_labels(name) == vector["last_two_labels"]
    assert namecheck.truncate_for_svg(name) == vector["truncate_for_svg"]
    assert namecheck.has_confusable_ascii(name) == vector["has_confusable_ascii"]


def test_at_least_six_golden_names(namecheck):
    assert len(GOLDEN["vectors"]) >= 6


# ---- is_normalized matches resolve.mjs's rule exactly -------------------------------------

GOOD_NAMES = [
    "acme.unica.eth",
    "a.b",
    "x-y.eth",
    "sub.merchant.unica.eth",
    "123.eth",
    "a" * 63 + ".eth",           # a label at exactly the 63-byte bound
]

BAD_NAMES = [
    "",                          # empty
    "nodothere",                 # fewer than two labels
    "UPPER.ETH",                 # uppercase is not the canonical form
    "-lead.eth",                 # leading hyphen
    "trail-.eth",                # trailing hyphen
    "a..b",                      # empty label
    ".eth",                      # empty first label
    "eth.",                      # empty last label
    "a" * 64 + ".eth",           # a label one byte over the 63-byte bound
    "a b.eth",                   # space
    "a_b.eth",                   # underscore
    "a.eth ",                    # trailing space
    "café.eth",                  # non-ASCII
    "a.eth\x00",                 # NUL byte
    "a.eth\x7f",                 # DEL byte
]


@pytest.mark.parametrize("name", GOOD_NAMES)
def test_is_normalized_accepts_the_resolve_mjs_alphabet(namecheck, name):
    assert namecheck.is_normalized(name) is True


@pytest.mark.parametrize("name", BAD_NAMES)
def test_is_normalized_rejects_everything_resolve_mjs_rejects(namecheck, name):
    assert namecheck.is_normalized(name) is False


@pytest.mark.parametrize("name", BAD_NAMES)
def test_namehash_reverts_on_anything_not_normalized(namecheck, name):
    with boa.reverts():
        namecheck.namehash(name)


@pytest.mark.parametrize("name", BAD_NAMES)
def test_has_confusable_ascii_reverts_on_anything_not_normalized(namecheck, name):
    with boa.reverts():
        namecheck.has_confusable_ascii(name)


# ---- namehash: EIP-137, cross-checked against an independent implementation ---------------

@pytest.mark.parametrize("name", GOOD_NAMES + GOLDEN_NAMES)
def test_namehash_matches_an_independent_reimplementation(namecheck, name):
    assert namecheck.namehash(name) == namehash_py(name)


def test_namehash_is_deterministic(namecheck):
    for name in GOOD_NAMES:
        assert namecheck.namehash(name) == namecheck.namehash(name)


def test_a_one_character_change_changes_the_namehash(namecheck):
    a = namecheck.namehash("alice.unica.eth")
    b = namecheck.namehash("alicf.unica.eth")
    assert a != b


# ---- label_count / last_two_labels ---------------------------------------------------------

def test_label_count(namecheck):
    assert namecheck.label_count("a.b") == 2
    assert namecheck.label_count("a.b.c") == 3
    assert namecheck.label_count("sub.merchant.unica.eth") == 4


def test_last_two_labels_keeps_the_namespace(namecheck):
    assert namecheck.last_two_labels("acme.unica.eth") == "unica.eth"
    assert namecheck.last_two_labels("deep.sub.merchant.unica.eth") == "unica.eth"
    assert namecheck.last_two_labels("a.b") == "a.b"


# ---- truncate_for_svg: the ellipsis-from-the-front rule ------------------------------------

def test_short_names_are_not_truncated(namecheck):
    assert namecheck.truncate_for_svg("acme.unica.eth") == "acme.unica.eth"


def test_long_names_get_a_leading_ellipsis(namecheck):
    name = "a" * 40 + ".merchant.unica.eth"
    out = namecheck.truncate_for_svg(name)
    assert out.startswith("...")
    assert out.endswith("unica.eth")


def test_truncation_never_cuts_inside_the_final_two_labels(namecheck):
    """The final two labels ("merchant.eth") are short enough to survive a 24-char
    truncation whole; the front-loaded padding must be what gets cut instead."""
    name = "x" * 60 + ".merchant.eth"
    out = namecheck.truncate_for_svg(name)
    assert out.endswith("merchant.eth")
    assert out.startswith("...")


def test_a_name_over_two_hundred_characters_truncates_and_keeps_the_namespace(namecheck):
    label = "m" * 63
    name = f"{label}.{label}.{label}.unica.eth"
    assert len(name) > 200
    out = namecheck.truncate_for_svg(name)
    assert len(out) <= 131
    assert out.startswith("...")
    assert out.endswith("unica.eth")


def test_a_long_two_label_name_keeps_the_merchant_label_whole_even_past_max_len(namecheck):
    """Security-review finding, 2026-09-11: the earlier "..." + last-label-only fallback
    silently dropped the merchant label for any two-label name longer than max_len --
    "reallylongmerchantnamehere.eth" rendered as just "...eth", making every long ".eth"
    name indistinguishable from every other one. The new rule always keeps the final two
    labels whole, even past max_len=24."""
    name = "reallylongmerchantnamehere.eth"
    out = namecheck.truncate_for_svg(name, 24)
    assert out == "...reallylongmerchantnamehere.eth"
    assert "reallylongmerchantnamehere" in out
    assert len(out) > 24   # exceeding max_len here is the point, not a bug


def test_two_near_maximal_labels_are_both_kept_whole_and_still_fit_the_hard_bound(namecheck):
    """Two labels each near the 63-byte bound: even in this near-worst case the final two
    labels are shown in full (never just the last one), and the result still respects the
    hard String[131] bound the type declares (63+1+63+3 == 130)."""
    long_label = "m" * 60
    name = f"a.{long_label}.{long_label}"
    out = namecheck.truncate_for_svg(name)
    assert out == f"...{long_label}.{long_label}"
    assert len(out) <= 131


def test_truncate_for_svg_never_exceeds_the_hard_bound_for_maximal_labels(namecheck):
    long_label = "z" * 63
    name = f"{long_label}.{long_label}"
    out = namecheck.truncate_for_svg(name)
    assert out == f"...{long_label}.{long_label}"
    assert len(out) <= 131


# ---- has_confusable_ascii: a warning flag, never a rejection -------------------------------

def test_confusable_pair_burnaby_vs_bumaby(namecheck):
    """"burnaby" contains "rn", which reads as "m" at a glance; "bumaby" is the same name
    with that substitution already made. The two must hash differently -- confusability is
    a display warning, never a normalization outcome -- and only the "rn" spelling raises
    the flag."""
    a, b = "burnaby.unica.eth", "bumaby.unica.eth"
    assert namecheck.namehash(a) != namecheck.namehash(b)
    assert namecheck.has_confusable_ascii(a) is True
    assert namecheck.has_confusable_ascii(b) is False


@pytest.mark.parametrize("name,expected", [
    ("vvidget.unica.eth", True),     # "vv" reads as "w"
    ("cloud.unica.eth", True),       # "cl" reads as "d"
    ("z0rro.unica.eth", True),       # '0' and 'o' both present in "z0rro"
    ("plain.unica.eth", False),
])
def test_confusable_flag_on_assorted_labels(namecheck, name, expected):
    assert namecheck.has_confusable_ascii(name) == expected


def test_zero_and_letter_o_mixed_is_flagged(namecheck):
    assert namecheck.has_confusable_ascii("0ffice.unica.eth") is False   # only '0', no 'o'
    assert namecheck.has_confusable_ascii("0ffoce.unica.eth") is True    # both '0' and 'o'


def test_one_and_letter_l_mixed_is_flagged(namecheck):
    assert namecheck.has_confusable_ascii("royal.unica.eth") is False    # only 'l', no '1'
    assert namecheck.has_confusable_ascii("1oyal.unica.eth") is True     # '1' with an 'l'


# ---- escape_xml / escape_json: correct on hostile strings, independent of normalization ----

XML_SPECIALS = '<script>alert(1)</script>&"\'end'
JSON_SPECIALS = 'a"b\\c' + chr(1) + chr(31) + chr(127) + "end"


def test_escape_xml_escapes_every_special_character(namecheck):
    out = namecheck.escape_xml(XML_SPECIALS)
    assert "<" not in out
    assert ">" not in out
    assert '"' not in out
    assert "'" not in out
    # a bare unescaped '&' would appear as part of "&amp;" etc.; count it precisely instead
    # of just checking presence.
    assert out == (
        "&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;&#39;end"
    )


def test_escape_xml_never_reverts_on_hostile_input(namecheck):
    for s in [XML_SPECIALS, "", "plain text", "\x00\x01\x02", "a" * 255]:
        namecheck.escape_xml(s)   # must not revert


def test_escape_json_escapes_backslash_quote_and_control_bytes(namecheck):
    out = namecheck.escape_json(JSON_SPECIALS)
    assert out == 'a\\"b\\\\c\\u0001\\u001f\\u007fend'
    # the round trip through a real JSON parser must recover the original bytes
    import json as _json
    assert _json.loads('"' + out + '"') == JSON_SPECIALS


def test_escape_json_never_reverts_on_hostile_input(namecheck):
    for s in [JSON_SPECIALS, "", "plain text", "\x00" * 10, "a" * 255]:
        namecheck.escape_json(s)   # must not revert


@given(st.text(min_size=0, max_size=200))
@settings(max_examples=40)
def test_escape_json_output_always_json_decodable(namecheck, s):
    """Whatever comes in, wrapping the escaped output in quotes must always be valid JSON
    and must decode back to the original bytes it was given (mod the codec's own handling
    of characters outside the Bytes[255]-safe range, which resolve.mjs's own gate refuses
    before this is ever reached in the real flow)."""
    # only pure-ASCII inputs stay inside the String[255] parameter's expected shape here --
    # Vyper strings are ASCII-only, per the compiler's own literal restriction discovered
    # while writing svgrender.vy.
    ascii_s = "".join(c for c in s if ord(c) < 128)
    if not ascii_s:
        return
    out = namecheck.escape_json(ascii_s)
    import json as _json
    assert _json.loads('"' + out + '"') == ascii_s


# ---- injection is impossible because the normalizer refuses it before rendering -----------

@pytest.mark.parametrize("hostile", [
    "<script>alert(1)</script>.eth",
    'a".unica.eth',
    "a&b.unica.eth",
    "a'b.unica.eth",
])
def test_injection_strings_are_rejected_before_they_ever_reach_rendering(namecheck, hostile):
    assert namecheck.is_normalized(hostile) is False
    with boa.reverts():
        namecheck.namehash(hostile)
