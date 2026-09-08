"""NameMath: seeded tame planar automorphisms, and what they actually prove.

The central claim is exact invertibility over the integers. That is checkable rather than
arguable, so every row below computes it instead of describing it.

Two rows deliberately MEASURE defects rather than assert them away. A defect nobody wrote down
is a defect that gets rediscovered; a defect with a number beside it is a decision waiting to be
made.
"""

import boa
from eth_utils import keccak

K_AFFINE, K_SHEAR_X, K_SHEAR_Y = 0, 1, 2
MAX_STEPS = 6

SEEDS = [keccak(text=t) for t in ("alice.eth", "bob.eth", "", "a" * 64, "unica")]


def _grid(n):
    return [(x, y) for x in range(-n, n + 1) for y in range(-n, n + 1)]


# ---- the claim the whole design rests on ------------------------------------------------

def test_forward_then_inverse_is_the_identity(namemath):
    """F^-1(F(p)) = p, exactly, over a grid, for several unrelated seeds."""
    checked = 0
    for seed in SEEDS:
        for x, y in _grid(6):
            assert namemath.verify_roundtrip(seed, x, y), f"round trip failed at {(x, y)}"
            checked += 1
    assert checked == len(SEEDS) * 169


def test_inverse_then_forward_is_also_the_identity(namemath):
    """The other direction. An inverse that only works one way is not an inverse."""
    for seed in SEEDS[:3]:
        for x, y in _grid(4):
            q = namemath.inverse(seed, x, y)
            p = namemath.forward(seed, q.x, q.y)
            assert (p.x, p.y) == (x, y)


def test_the_map_is_injective_on_the_grid(namemath):
    """Distinct inputs give distinct outputs. Implied by invertibility, checked anyway:
    an inverse computed from the same broken table as the forward map would agree with it."""
    for seed in SEEDS[:3]:
        seen = {}
        for x, y in _grid(6):
            p = namemath.forward(seed, x, y)
            key = (p.x, p.y)
            assert key not in seen, f"{(x, y)} and {seen[key]} both map to {key}"
            seen[key] = (x, y)


# ---- the structural guarantee -----------------------------------------------------------

def test_every_generated_affine_is_unimodular(namemath):
    """Invertibility over Z requires det = +-1. If the generator can emit any other
    determinant, the inverse is not an integer map and the design is broken at the root."""
    dets = set()
    for i in range(400):
        seed = keccak(i.to_bytes(32, "big"))
        for s in namemath.steps(seed):
            if s.kind == K_AFFINE:
                dets.add(s.a * s.e - s.b * s.d)
    assert dets, "no affine step was generated in 400 seeds"
    assert dets <= {1, -1}, f"a non-unimodular affine was generated: {dets}"


def test_the_jacobian_is_always_plus_or_minus_one(namemath):
    for i in range(200):
        seed = keccak(i.to_bytes(32, "big"))
        assert namemath.traits(seed).jacobian in (1, -1)


def test_traits_are_computed_from_the_program_not_assigned(namemath):
    """Each trait is re-derived here from the steps, so a trait that drifted from its own
    program would show up as a disagreement rather than as a plausible number."""
    for i in range(50):
        seed = keccak(i.to_bytes(32, "big"))
        st = namemath.steps(seed)
        t = namemath.traits(seed)
        assert t.steps == MAX_STEPS == len(st)
        assert t.affines == sum(1 for s in st if s.kind == K_AFFINE)
        assert t.shears == sum(1 for s in st if s.kind != K_AFFINE)
        assert t.affines + t.shears == MAX_STEPS

        jac, flips, deg = 1, 0, 1
        for s in st:
            if s.kind == K_AFFINE:
                d = s.a * s.e - s.b * s.d
                jac *= d
                flips += 1 if d == -1 else 0
            else:
                deg *= 2 if s.d != 0 else 1
        assert (t.jacobian, t.orientation_flips, t.degree_bound) == (jac, flips, deg)


def test_the_same_seed_always_gives_the_same_program(namemath):
    for seed in SEEDS:
        assert namemath.steps(seed) == namemath.steps(seed)
        assert namemath.traits(seed) == namemath.traits(seed)


def test_a_different_seed_gives_a_different_program(namemath):
    programs = {tuple(tuple(s) for s in namemath.steps(keccak(i.to_bytes(32, "big"))))
                for i in range(64)}
    assert len(programs) == 64, "two of 64 seeds produced the same transform program"


# ---- the honest boundary ----------------------------------------------------------------

def test_evaluation_is_total_on_the_declared_grid_and_fails_closed_beyond_it(namemath):
    """The contract's own docstring says evaluation reverts on overflow. That is true and it
    is the right failure, but it means the usable domain is a property of the SEED rather
    than of the contract -- there is no declared bound anywhere in the source.

    Measured here rather than assumed, because a renderer that picks its grid without knowing
    this discovers the boundary as a failed mint."""
    limits = {}
    for i in range(24):
        seed = keccak(i.to_bytes(32, "big"))
        lo, hi = 1, 1 << 40
        while lo < hi:
            mid = (lo + hi + 1) // 2
            try:
                namemath.forward(seed, mid, mid)
                lo = mid
            except Exception:
                hi = mid - 1
        limits[i] = lo
    worst = min(limits.values())
    print(f"\n  smallest safe |coordinate| across 24 seeds: {worst}")
    print(f"  widest:                                     {max(limits.values())}")
    assert worst >= 64, (
        f"some seed overflows inside a 128-wide grid (worst {worst}); a renderer cannot pick "
        f"one grid for every token without a declared bound"
    )


def test_the_registry_seed_can_be_ground_by_the_caller(namemath):
    """MEASURED DEFECT, not a passing feature.

    `register(token_id, entropy)` mixes block.prevrandao, the token id, the caller and a
    CALLER-SUPPLIED entropy word. prevrandao is readable, so a minter can compute the seed for
    any entropy off chain and submit the one whose traits they like. This row measures how much
    choice that buys over a small search; it is the number that decides whether rarity here can
    carry money."""
    token_id = 7
    caller = boa.env.eoa
    prevrandao = boa.env.evm.patch.prevrandao
    if isinstance(prevrandao, int):
        prevrandao = prevrandao.to_bytes(32, "big")

    def seed_for(entropy: int) -> bytes:
        return keccak(
            prevrandao
            + token_id.to_bytes(32, "big")
            + bytes(12) + bytes.fromhex(caller[2:])
            + entropy.to_bytes(32, "big")
        )

    # Confirm the model matches the contract before drawing any conclusion from it.
    got = namemath.register(token_id, (0).to_bytes(32, "big"), sender=caller)
    assert got == seed_for(0), "the off-chain model of the seed disagrees with the contract"

    best = {}
    for e in range(1, 257):
        t = namemath.traits(seed_for(e))
        best.setdefault((t.jacobian, t.degree_bound), e)
    print(f"\n  256 candidate entropies reachable in one transaction gave "
          f"{len(best)} distinct (jacobian, degree_bound) classes")
    assert len(best) > 1, "the search found no choice at all, which would contradict the model"
