# pragma version 0.4.3
"""
@title  NameMath
@notice Seeded tame planar polynomial automorphisms with exact integer inverses.

        Each seed yields F : Z^2 -> Z^2 as a composition of
          - unimodular affine maps  (det = +1 or -1)
          - triangular shears       (x,y)->(x+p(y),y)  or  (x,y)->(x,y+p(x))
        By Jung-van der Kulk every planar polynomial automorphism is of this
        form, so F is invertible by construction and F^-1 is obtained by
        applying inverse steps in reverse. Jacobian(F) = product of affine
        determinants, so it is always +1 or -1.

        All arithmetic is checked int256. Evaluation reverts on overflow.
        Traits are computed from the seed, never assigned.
"""

MAX_STEPS: constant(uint256) = 6

K_AFFINE: constant(uint8) = 0
K_SHEAR_X: constant(uint8) = 1
K_SHEAR_Y: constant(uint8) = 2

struct Step:
    kind: uint8
    a: int256   # affine: [[a,b],[d,e]] + (c,f)   shear: p(t) = a + b*t + d*t^2
    b: int256
    c: int256
    d: int256
    e: int256
    f: int256

struct Point:
    x: int256
    y: int256

struct Traits:
    steps: uint256
    shears: uint256
    affines: uint256
    degree_bound: uint256
    jacobian: int256
    orientation_flips: uint256

seed_of: public(HashMap[uint256, bytes32])
owner: public(address)

event Registered:
    token_id: indexed(uint256)
    seed: bytes32


@deploy
def __init__():
    self.owner = msg.sender


# ---------- generation (pure) ----------

@internal
@pure
def _step(seed: bytes32, i: uint256) -> Step:
    r: uint256 = convert(keccak256(concat(seed, convert(i, bytes32))), uint256)
    kind: uint8 = convert(r % 3, uint8)
    r = r // 3
    s: Step = Step(kind=kind, a=0, b=0, c=0, d=0, e=0, f=0)

    if kind == K_AFFINE:
        form: uint256 = r % 4
        r = r // 4
        if form == 0:
            s.a = 1
            s.e = 1
        elif form == 1:
            s.b = -1
            s.d = 1
        elif form == 2:
            s.a = -1
            s.e = -1
        else:
            s.a = 1
            s.e = -1
        s.c = convert(r % 17, int256) - 8
        r = r // 17
        s.f = convert(r % 17, int256) - 8
    else:
        s.a = convert(r % 17, int256) - 8
        r = r // 17
        s.b = convert(r % 9, int256) - 4
        r = r // 9
        s.d = convert(r % 5, int256) - 2
    return s


@internal
@pure
def _steps(seed: bytes32) -> DynArray[Step, MAX_STEPS]:
    out: DynArray[Step, MAX_STEPS] = []
    for i: uint256 in range(MAX_STEPS):
        out.append(self._step(seed, i))
    return out


# ---------- evaluation (pure, exact) ----------

@internal
@pure
def _poly(s: Step, t: int256) -> int256:
    return s.a + s.b * t + s.d * t * t


@internal
@pure
def _apply(s: Step, p: Point) -> Point:
    if s.kind == K_AFFINE:
        return Point(
            x=s.a * p.x + s.b * p.y + s.c,
            y=s.d * p.x + s.e * p.y + s.f,
        )
    if s.kind == K_SHEAR_X:
        return Point(x=p.x + self._poly(s, p.y), y=p.y)
    return Point(x=p.x, y=p.y + self._poly(s, p.x))


@internal
@pure
def _unapply(s: Step, p: Point) -> Point:
    if s.kind == K_AFFINE:
        det: int256 = s.a * s.e - s.b * s.d
        assert det == 1 or det == -1, "non-unimodular"
        u: int256 = p.x - s.c
        v: int256 = p.y - s.f
        return Point(
            x=det * (s.e * u - s.b * v),
            y=det * (-s.d * u + s.a * v),
        )
    if s.kind == K_SHEAR_X:
        return Point(x=p.x - self._poly(s, p.y), y=p.y)
    return Point(x=p.x, y=p.y - self._poly(s, p.x))


@external
@pure
def steps(seed: bytes32) -> DynArray[Step, MAX_STEPS]:
    return self._steps(seed)


@external
@pure
def forward(seed: bytes32, x: int256, y: int256) -> Point:
    p: Point = Point(x=x, y=y)
    st: DynArray[Step, MAX_STEPS] = self._steps(seed)
    for i: uint256 in range(MAX_STEPS):
        p = self._apply(st[i], p)
    return p


@external
@pure
def inverse(seed: bytes32, x: int256, y: int256) -> Point:
    p: Point = Point(x=x, y=y)
    st: DynArray[Step, MAX_STEPS] = self._steps(seed)
    for k: uint256 in range(MAX_STEPS):
        i: uint256 = MAX_STEPS - 1 - k
        p = self._unapply(st[i], p)
    return p


@external
@pure
def verify_roundtrip(seed: bytes32, x: int256, y: int256) -> bool:
    p: Point = Point(x=x, y=y)
    st: DynArray[Step, MAX_STEPS] = self._steps(seed)
    for i: uint256 in range(MAX_STEPS):
        p = self._apply(st[i], p)
    for k: uint256 in range(MAX_STEPS):
        i: uint256 = MAX_STEPS - 1 - k
        p = self._unapply(st[i], p)
    return p.x == x and p.y == y


# ---------- traits (computed, not assigned) ----------

@external
@pure
def traits(seed: bytes32) -> Traits:
    st: DynArray[Step, MAX_STEPS] = self._steps(seed)
    t: Traits = Traits(
        steps=MAX_STEPS, shears=0, affines=0,
        degree_bound=1, jacobian=1, orientation_flips=0,
    )
    for i: uint256 in range(MAX_STEPS):
        s: Step = st[i]
        if s.kind == K_AFFINE:
            t.affines += 1
            det: int256 = s.a * s.e - s.b * s.d
            t.jacobian *= det
            if det == -1:
                t.orientation_flips += 1
        else:
            t.shears += 1
            deg: uint256 = 1
            if s.d != 0:
                deg = 2
            t.degree_bound *= deg
    return t


# ---------- registry ----------

@external
def register(token_id: uint256, entropy: bytes32) -> bytes32:
    assert self.seed_of[token_id] == empty(bytes32), "already registered"
    seed: bytes32 = keccak256(concat(
        block.prevrandao,
        convert(token_id, bytes32),
        convert(msg.sender, bytes32),
        entropy,
    ))
    self.seed_of[token_id] = seed
    log Registered(token_id=token_id, seed=seed)
    return seed


@external
@view
def forward_token(token_id: uint256, x: int256, y: int256) -> Point:
    seed: bytes32 = self.seed_of[token_id]
    assert seed != empty(bytes32), "unregistered"
    p: Point = Point(x=x, y=y)
    st: DynArray[Step, MAX_STEPS] = self._steps(seed)
    for i: uint256 in range(MAX_STEPS):
        p = self._apply(st[i], p)
    return p