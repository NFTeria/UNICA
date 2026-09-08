# pragma version 0.4.3
"""
@title  LogoBackground
@notice Name-keyed background field. The seed is keccak256 of a label, so a
        given name always yields the same automorphism, the same lattice
        field, and the same palette. Fixed 4-step structure
        (affine, shear_y, affine, shear_x) with wider coefficient ranges for
        visual sweep. Cell color is a computed invariant of the mapped point.
"""

STEPS: constant(uint256) = 4
PALETTE_N: constant(uint256) = 5

struct Step:
    kind: uint8      # 0 affine, 1 shear_x, 2 shear_y
    a: int256
    b: int256
    c: int256
    d: int256
    e: int256
    f: int256

struct Cell:
    u: int256
    v: int256
    color: uint256   # index into palette(name)

struct Palette:
    c0: uint256      # 0xRRGGBB
    c1: uint256
    c2: uint256
    c3: uint256
    c4: uint256


@deploy
def __init__():
    pass


@internal
@pure
def _seed(name: String[64]) -> bytes32:
    return keccak256(name)


@internal
@pure
def _rand(seed: bytes32, tag: uint256) -> uint256:
    return convert(keccak256(concat(seed, convert(tag, bytes32))), uint256)


@internal
@pure
def _affine(seed: bytes32, tag: uint256) -> Step:
    r: uint256 = self._rand(seed, tag)
    s: Step = Step(kind=0, a=0, b=0, c=0, d=0, e=0, f=0)
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
    s.c = convert(r % 33, int256) - 16
    r = r // 33
    s.f = convert(r % 33, int256) - 16
    return s


@internal
@pure
def _shear(seed: bytes32, tag: uint256, kind: uint8) -> Step:
    r: uint256 = self._rand(seed, tag)
    s: Step = Step(kind=kind, a=0, b=0, c=0, d=0, e=0, f=0)
    s.a = convert(r % 33, int256) - 16
    r = r // 33
    s.b = convert(r % 13, int256) - 6
    r = r // 13
    s.d = convert(r % 7, int256) - 3
    return s


@internal
@pure
def _steps(seed: bytes32) -> DynArray[Step, STEPS]:
    out: DynArray[Step, STEPS] = []
    out.append(self._affine(seed, 0))
    out.append(self._shear(seed, 1, 2))
    out.append(self._affine(seed, 2))
    out.append(self._shear(seed, 3, 1))
    return out


@internal
@pure
def _apply(s: Step, x: int256, y: int256) -> (int256, int256):
    if s.kind == 0:
        return (s.a * x + s.b * y + s.c, s.d * x + s.e * y + s.f)
    if s.kind == 1:
        return (x + s.a + s.b * y + s.d * y * y, y)
    return (x, y + s.a + s.b * x + s.d * x * x)


@external
@pure
def seed(name: String[64]) -> bytes32:
    return self._seed(name)


@external
@pure
def steps(name: String[64]) -> DynArray[Step, STEPS]:
    return self._steps(self._seed(name))


@external
@pure
def cell(name: String[64], i: int256, j: int256) -> Cell:
    st: DynArray[Step, STEPS] = self._steps(self._seed(name))
    x: int256 = i
    y: int256 = j
    for k: uint256 in range(STEPS):
        x, y = self._apply(st[k], x, y)
    m: int256 = x * x + y * y
    if m < 0:
        m = -m
    return Cell(u=x, v=y, color=convert(m, uint256) % PALETTE_N)


@external
@pure
def palette(name: String[64]) -> Palette:
    s: bytes32 = self._seed(name)
    r: uint256 = self._rand(s, 999)
    return Palette(
        c0=r % 16777216,
        c1=(r // 16777216) % 16777216,
        c2=(r // 281474976710656) % 16777216,
        c3=(r // 4722366482869645213696) % 16777216,
        c4=(r // 79228162514264337593543950336) % 16777216,
    )