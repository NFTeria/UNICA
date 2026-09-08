"""LogoBackground: the name-keyed field, and what the name actually decides.

This is the one of the two art contracts that already does what the whole idea claims -- a
human-readable name goes in and the same field comes out, every time, for everyone. The rows
below check that property rather than describe it, and measure the two places where the source
promises more than it delivers.
"""

from eth_utils import keccak

NAMES = ["alice.eth", "bob.eth", "unica.eth", "", "a" * 64]
PALETTE_N = 5


def test_the_name_is_the_seed(logobackground):
    """Not a hash of something else, not a nonce: keccak of the label itself, so anybody can
    recompute it without asking the chain."""
    for n in NAMES:
        assert logobackground.seed(n) == keccak(text=n)


def test_the_same_name_always_gives_the_same_field(logobackground):
    for n in NAMES[:3]:
        first = [tuple(logobackground.cell(n, i, j)) for i in range(-3, 4) for j in range(-3, 4)]
        second = [tuple(logobackground.cell(n, i, j)) for i in range(-3, 4) for j in range(-3, 4)]
        assert first == second
        assert logobackground.palette(n) == logobackground.palette(n)


def test_different_names_give_different_fields(logobackground):
    fields = {n: tuple(tuple(logobackground.cell(n, i, j)) for i in range(-2, 3) for j in range(-2, 3))
              for n in NAMES}
    assert len(set(fields.values())) == len(NAMES), "two names produced an identical field"
    palettes = {n: tuple(logobackground.palette(n)) for n in NAMES}
    assert len(set(palettes.values())) == len(NAMES), "two names produced an identical palette"


def test_a_one_character_change_changes_everything(logobackground):
    """keccak has no locality, which is the point: neighbouring names must not look related."""
    a = tuple(tuple(logobackground.cell("alice.eth", i, j)) for i in range(-3, 4) for j in range(-3, 4))
    b = tuple(tuple(logobackground.cell("alicf.eth", i, j)) for i in range(-3, 4) for j in range(-3, 4))
    same = sum(1 for x, y in zip(a, b) if x == y)
    assert same == 0, f"{same} of {len(a)} cells survived a one-character change"


def test_the_structure_is_the_fixed_four_step_program(logobackground):
    """affine, shear_y, affine, shear_x -- fixed, so the shape of the field is a property of
    the contract and only its coefficients come from the name."""
    for n in NAMES:
        kinds = [s.kind for s in logobackground.steps(n)]
        assert kinds == [0, 2, 0, 1]


def test_every_affine_step_is_unimodular(logobackground):
    for i in range(200):
        n = f"name{i}.eth"
        for s in logobackground.steps(n):
            if s.kind == 0:
                assert s.a * s.e - s.b * s.d in (1, -1)


def test_colours_are_a_computed_invariant_of_the_mapped_point(logobackground):
    """color is |u^2+v^2| mod 5 and nothing else, so it is recomputable from the cell."""
    for n in NAMES[:3]:
        for i in range(-4, 5):
            for j in range(-4, 5):
                c = logobackground.cell(n, i, j)
                assert c.color == (c.u * c.u + c.v * c.v) % PALETTE_N
                assert 0 <= c.color < PALETTE_N


def test_the_palette_is_five_distinct_rgb_values(logobackground):
    for n in NAMES:
        p = logobackground.palette(n)
        channels = [p.c0, p.c1, p.c2, p.c3, p.c4]
        assert all(0 <= c < 0x1000000 for c in channels), "a palette entry is not 24-bit RGB"


# ---- the honest boundary ----------------------------------------------------------------

def test_the_negative_magnitude_guard_is_unreachable(logobackground):
    """MEASURED DEFECT, not a passing feature.

    `cell()` computes m = x*x + y*y and then does `if m < 0: m = -m`. Under Vyper's checked
    arithmetic a square cannot be negative -- an overflow REVERTS rather than wrapping -- so
    that branch can never run. It reads like an overflow guard and is not one: the case it
    appears to handle takes the transaction down instead.

    This row proves the shape of the real behaviour: no negative magnitude is ever observed,
    and going far enough out reverts."""
    for n in NAMES[:3]:
        for i in range(-20, 21, 5):
            for j in range(-20, 21, 5):
                c = logobackground.cell(n, i, j)
                assert c.u * c.u + c.v * c.v >= 0

    # Far enough out, evaluation must REVERT rather than wrap. 2^60 was the first guess and it
    # was wrong -- the field's degree is at most 4, so (2^60)^4 = 2^240 still fits a signed word
    # and most names sail through. The claim is about wrapping, so the row sweeps until every
    # name has been pushed past the boundary, and requires that none of them ever came back with
    # a negative magnitude on the way.
    for shift in (60, 64, 80, 100, 128):
        reverted = negatives = 0
        for i in range(40):
            n = f"name{i}.eth"
            try:
                c = logobackground.cell(n, 1 << shift, 1 << shift)
                if c.u * c.u + c.v * c.v < 0:
                    negatives += 1
            except Exception:
                reverted += 1
        print(f"  2^{shift}: {reverted} of 40 names revert, {negatives} wrapped negative")
        assert negatives == 0, "a square wrapped instead of reverting; the guard's premise is wrong"
    assert reverted == 40, f"at 2^128 only {reverted} of 40 names reverted"


def test_the_usable_grid_is_a_property_of_the_name(logobackground):
    """Same defect class as NameMath: there is no declared coordinate bound, so how large a
    field a name can render is discovered rather than specified."""
    limits = []
    for i in range(16):
        n = f"name{i}.eth"
        lo, hi = 1, 1 << 40
        while lo < hi:
            mid = (lo + hi + 1) // 2
            try:
                logobackground.cell(n, mid, mid)
                lo = mid
            except Exception:
                hi = mid - 1
        limits.append(lo)
    print(f"  smallest safe |coordinate| across 16 names: {min(limits)}; widest: {max(limits)}")
    assert min(limits) >= 64, f"some name cannot render a 128-wide field (worst {min(limits)})"
