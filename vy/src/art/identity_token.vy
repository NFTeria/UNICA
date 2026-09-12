# pragma version 0.4.3
"""
@title  IdentityToken
@notice N1 (verbatim, owner ruling 2026-09-11): "Identity badge only. The token proves the
        normalized merchant name, the ENS deployment and the renderer version and provenance.
        It proves nothing about current name control, address ownership, operational status,
        payment, receipt count, settlement volume or merchant legitimacy."

        Written from EIP-721's text (name/description/image metadata schema; tokenURI(uint256)
        external view returns (string); the URI MAY be mutable, but this one never is) and from
        the owner rulings N1-N9 / H1-H12 in docs/unica-v4/DECISIONS.md. No snekmate, no vendored
        library, no import of the legacy modules (H10) or of anything under vy/src/unica/ (H3).

        The constructor takes no address for a math or SVG helper contract, so every piece of
        name-validation, truncation, hex/base64 encoding and SVG assembly this token's tokenURI
        needs is reproduced here as @internal/@pure logic, mirroring (never importing)
        `vy/src/math/namecheck.vy` and `vy/src/art/svgrender.vy` -- three independent files
        written from the same spec, each independently deployable and independently testable,
        exactly as this workspace's own test layout expects.

        Non-transferable (N7): every transfer/approval entry point reverts. Minting checks
        namespace authority through `AUTHORITY.isNamespaceController`, which `tokenURI` never
        calls -- tokenURI reads only immutable constructor data and the token's own storage as
        written once at mint (N2).
"""

interface IIdentityAuthority:
    def isNamespaceController(node: bytes32, account: address) -> bool: view


MAX_LABELS: constant(uint256) = 128
HEX_CHARS: constant(String[16]) = "0123456789abcdef"
DIGIT_CHARS: constant(String[10]) = "0123456789"
B64_CHARS: constant(String[64]) = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
JSON_MAX: constant(uint256) = 12264   # 12264 / 3 * 4 + the 30-byte data-uri prefix <= 16384

INTERFACE_ID_ERC165: constant(bytes4) = 0x01ffc9a7
INTERFACE_ID_ERC721: constant(bytes4) = 0x80ac58cd
INTERFACE_ID_ERC721_METADATA: constant(bytes4) = 0x5b5e139f

struct Scan:
    valid: bool
    count: uint256
    starts: DynArray[uint256, MAX_LABELS]
    lens: DynArray[uint256, MAX_LABELS]


# ---------- constructor immutables ----------

MINTER: public(immutable(address))
AUTHORITY: public(immutable(IIdentityAuthority))
REGISTRY_POINTER: public(immutable(address))
ENS_DEPLOYMENT_ID: public(immutable(bytes32))
RENDERER_VERSION: public(immutable(String[32]))
EXTERNAL_URL_BASE: public(immutable(String[128]))


# ---------- token facts, written exactly once, at mint ----------

node_of: public(HashMap[uint256, bytes32])
name_of: public(HashMap[uint256, String[255]])
fingerprint_of: public(HashMap[uint256, String[8]])
minted_at: public(HashMap[uint256, uint256])
token_of_node: public(HashMap[bytes32, uint256])
total_minted: public(uint256)

_owners: HashMap[uint256, address]
_balances: HashMap[address, uint256]


event Transfer:
    sender: indexed(address)
    receiver: indexed(address)
    token_id: indexed(uint256)

event Approval:
    owner: indexed(address)
    spender: indexed(address)
    token_id: indexed(uint256)

event ApprovalForAll:
    owner: indexed(address)
    operator: indexed(address)
    approved: bool


@deploy
def __init__(
    minter: address,
    authority: address,
    registry_pointer: address,
    ens_deployment_id: bytes32,
    renderer_version: String[32],
    external_url_base: String[128],
):
    assert self._is_safe_constructor_string(convert(renderer_version, Bytes[128])), "UnsafeConstructorString"
    assert self._is_safe_constructor_string(convert(external_url_base, Bytes[128])), "UnsafeConstructorString"

    MINTER = minter
    AUTHORITY = IIdentityAuthority(authority)
    REGISTRY_POINTER = registry_pointer
    ENS_DEPLOYMENT_ID = ens_deployment_id
    RENDERER_VERSION = renderer_version
    EXTERNAL_URL_BASE = external_url_base


# ================================================================================================
# name validation + namehash (mirrors namecheck.vy's algorithm; see module docstring)
# ================================================================================================

@internal
@pure
def _byte_at(data: Bytes[255], i: uint256) -> uint8:
    return convert(slice(data, i, 1), uint8)


@internal
@pure
def _is_safe_constructor_string(data: Bytes[128]) -> bool:
    """Constructor-time guard (security-review finding, 2026-09-11): renderer_version and
    external_url_base used to be interpolated raw into SVG text and JSON string fields.
    Escaping at render time (below) makes that safe regardless, but a constructor value
    that NEEDED escaping in the first place is almost certainly a mistake -- so it is
    refused up front, once, rather than silently escaped forever after. Rejects double
    quote, single quote, '<', '>', '&' and any C0 control byte or DEL."""
    n: uint256 = len(data)
    for i: uint256 in range(128):
        if i >= n:
            break
        c: uint8 = convert(slice(data, i, 1), uint8)
        if c < 32 or c == 127:
            return False
        if c == 34 or c == 39 or c == 60 or c == 62 or c == 38:
            return False
    return True


@internal
@pure
def _scan(name: String[255]) -> Scan:
    n: uint256 = len(name)
    result: Scan = Scan(valid=False, count=0, starts=[], lens=[])
    if n == 0:
        return result
    data: Bytes[255] = convert(name, Bytes[255])
    label_start: uint256 = 0
    label_len: uint256 = 0
    is_label_start: bool = True
    prev_hyphen: bool = False
    for i: uint256 in range(255):
        if i >= n:
            break
        c: uint8 = self._byte_at(data, i)
        is_lower: bool = c >= 97 and c <= 122
        is_digit: bool = c >= 48 and c <= 57
        is_dot: bool = c == 46
        is_hyphen: bool = c == 45
        if not (is_lower or is_digit or is_dot or is_hyphen):
            return result
        if is_dot:
            if label_len == 0 or prev_hyphen:
                return result
            result.starts.append(label_start)
            result.lens.append(label_len)
            result.count += 1
            label_start = i + 1
            label_len = 0
            is_label_start = True
        else:
            if is_label_start and is_hyphen:
                return result
            if label_len >= 63:
                return result
            label_len += 1
            is_label_start = False
            prev_hyphen = is_hyphen
    if label_len == 0 or prev_hyphen:
        return result
    result.starts.append(label_start)
    result.lens.append(label_len)
    result.count += 1
    if result.count < 2:
        return result
    result.valid = True
    return result


@internal
@pure
def _namehash(name: String[255], scan: Scan) -> bytes32:
    data: Bytes[255] = convert(name, Bytes[255])
    node: bytes32 = empty(bytes32)
    for k: uint256 in range(MAX_LABELS):
        if k >= scan.count:
            break
        idx: uint256 = scan.count - 1 - k
        label_bytes: Bytes[255] = slice(data, scan.starts[idx], scan.lens[idx])
        node = keccak256(concat(node, keccak256(label_bytes)))
    return node


@internal
@pure
def _truncate(name: String[255], scan: Scan, max_len: uint256) -> String[131]:
    """Mirrors namecheck.vy's truncate_for_svg exactly (see that function's docstring for
    the full reasoning): shows the whole name when it fits max_len, otherwise "..." plus
    the final two labels IN FULL, always -- never just the last label alone, even when
    that exceeds max_len (security-review finding, 2026-09-11)."""
    ml: uint256 = max_len
    if ml > 131:
        ml = 131
    if ml < 8:
        ml = 8
    n: uint256 = len(name)
    if n <= ml:
        return convert(name, String[131])
    data: Bytes[255] = convert(name, Bytes[255])
    idx2: uint256 = scan.count - 2
    two_start: uint256 = scan.starts[idx2]
    suffix: Bytes[255] = slice(data, two_start, n - two_start)
    return convert(concat("...", convert(suffix, String[255])), String[131])


# ================================================================================================
# hex / decimal / base64 (mirrors svgrender.vy's algorithm; see module docstring)
# ================================================================================================

@internal
@pure
def _hex2(b: uint8) -> String[2]:
    hi: uint256 = convert(b, uint256) // 16
    lo: uint256 = convert(b, uint256) % 16
    return concat(slice(HEX_CHARS, hi, 1), slice(HEX_CHARS, lo, 1))


@internal
@pure
def _hex_bytes32(h: bytes32) -> String[64]:
    out: String[64] = ""
    for i: uint256 in range(32):
        b: uint8 = convert(slice(h, i, 1), uint8)
        out = convert(concat(out, self._hex2(b)), String[64])
    return out


@internal
@pure
def _escape_xml_32(s: String[32]) -> String[192]:
    """Escapes the five XML special characters, mirroring namecheck.vy's escape_xml.
    Sized for RENDERER_VERSION (String[32]), the only String[32]-typed value this token
    ever writes into a <text> node -- a deployer-controlled constructor string, but
    embedded here unescaped in an earlier version of this file (security-review finding,
    2026-09-11); escaped now regardless, and its bytes are also refused up front at
    construction time by `_is_safe_constructor_string` if they would have needed it."""
    n: uint256 = len(s)
    data: Bytes[32] = convert(s, Bytes[32])
    out: Bytes[192] = b""
    for i: uint256 in range(32):
        if i >= n:
            break
        c: uint8 = convert(slice(data, i, 1), uint8)
        piece: Bytes[6] = b""
        if c == 38:
            piece = b"&amp;"
        elif c == 60:
            piece = b"&lt;"
        elif c == 62:
            piece = b"&gt;"
        elif c == 34:
            piece = b"&quot;"
        elif c == 39:
            piece = b"&#39;"
        else:
            piece = slice(data, i, 1)
        out = convert(concat(out, piece), Bytes[192])
    return convert(out, String[192])


@internal
@pure
def _escape_json_bytes(data: Bytes[128]) -> String[768]:
    """Escapes backslash, double quote, and C0/DEL control bytes, mirroring
    namecheck.vy's escape_json. Takes Bytes[128] so the one function serves both
    RENDERER_VERSION (String[32]) and EXTERNAL_URL_BASE (String[128]) -- both convert to
    Bytes[128] by simple cross-class widening, which preserves the real runtime length."""
    n: uint256 = len(data)
    out: String[768] = ""
    for i: uint256 in range(128):
        if i >= n:
            break
        c: uint8 = convert(slice(data, i, 1), uint8)
        piece: String[8] = ""
        if c == 92:
            piece = "\\\\"
        elif c == 34:
            piece = "\\\""
        elif c < 32 or c == 127:
            piece = concat("\\u00", self._hex2(c))
        else:
            piece = convert(slice(data, i, 1), String[8])
        out = convert(concat(out, piece), String[768])
    return out


@internal
@pure
def _uint3(v: uint256) -> String[3]:
    vv: uint256 = v
    if vv > 999:
        vv = 999
    if vv == 0:
        return "0"
    out: String[3] = ""
    for i: uint256 in range(3):
        if vv == 0:
            break
        d: uint256 = vv % 10
        vv = vv // 10
        out = convert(concat(slice(DIGIT_CHARS, d, 1), out), String[3])
    return out


@internal
@pure
def _uint_decimal(v: uint256) -> String[78]:
    if v == 0:
        return "0"
    vv: uint256 = v
    out: Bytes[78] = b""
    for i: uint256 in range(78):
        if vv == 0:
            break
        d: uint256 = vv % 10
        vv = vv // 10
        dchar: Bytes[1] = convert(slice(DIGIT_CHARS, d, 1), Bytes[1])
        out = convert(concat(dchar, out), Bytes[78])
    return convert(out, String[78])


@internal
@pure
def _fingerprint_hash(normalized_name: String[255], node: bytes32, ens_deployment_id: bytes32, renderer_version: String[32]) -> bytes32:
    name_hash: bytes32 = keccak256(normalized_name)
    version_hash: bytes32 = keccak256(renderer_version)
    return keccak256(concat(name_hash, node, ens_deployment_id, version_hash))


@internal
@pure
def _fingerprint(normalized_name: String[255], node: bytes32, ens_deployment_id: bytes32, renderer_version: String[32]) -> String[8]:
    h: bytes32 = self._fingerprint_hash(normalized_name, node, ens_deployment_id, renderer_version)
    out: String[8] = ""
    for i: uint256 in range(4):
        b: uint8 = convert(slice(h, i, 1), uint8)
        out = convert(concat(out, self._hex2(b)), String[8])
    return out


@internal
@pure
def _b64char(v: uint256) -> String[1]:
    return slice(B64_CHARS, v, 1)


@internal
@pure
def _byte_at_big(data: Bytes[JSON_MAX], i: uint256) -> uint8:
    return convert(slice(data, i, 1), uint8)


BASE64_BATCH_GROUPS: constant(uint256) = 16   # 48 input bytes -> 64 output chars per batch


@internal
@pure
def _base64_batch(data: Bytes[JSON_MAX], start: uint256, count: uint256) -> String[64]:
    """Encodes up to BASE64_BATCH_GROUPS 3-byte groups into a small, fixed-size local
    string. Kept tiny on purpose: the rolling-accumulator pattern (`out = concat(out,
    piece)` in a loop) is O(size^2) in the size it grows to, so confining that growth to
    a 64-char local buffer instead of the full output is what makes the outer loop below
    linear-ish instead of quadratic over the whole output."""
    out: String[64] = ""
    i: uint256 = start
    for j: uint256 in range(BASE64_BATCH_GROUPS):
        if j >= count:
            break
        b0: uint256 = convert(slice(data, i, 1), uint256)
        b1: uint256 = convert(slice(data, i + 1, 1), uint256)
        b2: uint256 = convert(slice(data, i + 2, 1), uint256)
        c0: uint256 = b0 >> 2
        c1: uint256 = ((b0 & 3) << 4) | (b1 >> 4)
        c2: uint256 = ((b1 & 15) << 2) | (b2 >> 6)
        c3: uint256 = b2 & 63
        out = convert(concat(
            out,
            slice(B64_CHARS, c0, 1), slice(B64_CHARS, c1, 1),
            slice(B64_CHARS, c2, 1), slice(B64_CHARS, c3, 1),
        ), String[64])
        i += 3
    return out


@internal
@pure
def _base64(data: Bytes[JSON_MAX]) -> String[16352]:
    """RFC 4648 base64. Measured while writing this file: a naive one-group-per-iteration
    rolling accumulator cost ~9.8M gas for a 60-character name's tokenURI (which calls
    this twice, once for the SVG and once for the whole JSON envelope) -- over the 8M
    budget -- because that pattern recopies the ENTIRE accumulated output on every one of
    up to ~4000 groups. Batching BASE64_BATCH_GROUPS groups per outer step (via
    `_base64_batch`, whose own accumulator never grows past 64 chars) cuts that recopy
    volume by roughly BASE64_BATCH_GROUPS-fold; re-measured after this change in
    test_identity_token.py (test_token_uri_gas_stays_under_budget)."""
    n: uint256 = len(data)
    full_groups: uint256 = n // 3
    rem: uint256 = n % 3
    out: String[16352] = ""
    i: uint256 = 0
    g: uint256 = 0
    for batch: uint256 in range(256):   # 4088 / BASE64_BATCH_GROUPS(16), rounded up
        if g >= full_groups:
            break
        remaining: uint256 = full_groups - g
        this_batch: uint256 = BASE64_BATCH_GROUPS
        if remaining < BASE64_BATCH_GROUPS:
            this_batch = remaining
        out = convert(concat(out, self._base64_batch(data, i, this_batch)), String[16352])
        i += this_batch * 3
        g += this_batch
    if rem == 1:
        b0: uint256 = convert(self._byte_at_big(data, i), uint256)
        c0: uint256 = b0 >> 2
        c1: uint256 = (b0 & 3) << 4
        out = convert(concat(out, self._b64char(c0), self._b64char(c1), "=="), String[16352])
    elif rem == 2:
        b0: uint256 = convert(self._byte_at_big(data, i), uint256)
        b1: uint256 = convert(self._byte_at_big(data, i + 1), uint256)
        c0: uint256 = b0 >> 2
        c1: uint256 = ((b0 & 3) << 4) | (b1 >> 4)
        c2: uint256 = (b1 & 15) << 2
        out = convert(concat(out, self._b64char(c0), self._b64char(c1), self._b64char(c2), "="), String[16352])
    return out


# ================================================================================================
# SVG assembly (mirrors svgrender.vy's algorithm; see module docstring)
# ================================================================================================

@internal
@pure
def _gridpos(idx: uint256) -> uint256:
    if idx == 0:
        return 30
    elif idx == 1:
        return 120
    elif idx == 2:
        return 210
    elif idx == 3:
        return 300
    elif idx == 4:
        return 390
    return 480


@internal
@pure
def _palette(node: bytes32, idx: uint256) -> String[6]:
    base: uint256 = 3 + idx * 3
    r: uint8 = convert(slice(node, base, 1), uint8)
    g: uint8 = convert(slice(node, base + 1, 1), uint8)
    b: uint8 = convert(slice(node, base + 2, 1), uint8)
    return concat(self._hex2(r), self._hex2(g), self._hex2(b))


@internal
@pure
def _render(normalized_name: String[255], scan: Scan, node: bytes32, ens_deployment_id: bytes32, renderer_version: String[32]) -> String[8192]:
    truncated: String[131] = self._truncate(normalized_name, scan, 24)
    fp: String[8] = self._fingerprint(normalized_name, node, ens_deployment_id, renderer_version)
    safe_version: String[192] = self._escape_xml_32(renderer_version)

    bg: String[6] = concat(self._hex2(convert(slice(node, 0, 1), uint8)),
                            self._hex2(convert(slice(node, 1, 1), uint8)),
                            self._hex2(convert(slice(node, 2, 1), uint8)))

    svg: String[8192] = concat(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">',
        '<rect width="600" height="600" fill="#', bg, '"/>',
    )

    for row: uint256 in range(6):
        for col: uint256 in range(6):
            cell: uint256 = row * 6 + col
            byte_idx: uint256 = 15 + (cell % 17)
            cb: uint8 = convert(slice(node, byte_idx, 1), uint8)
            color_idx: uint256 = convert(cb, uint256) % 4
            jitter: uint256 = (convert(cb, uint256) // 4) % 8
            x: uint256 = self._gridpos(col) + jitter
            y: uint256 = self._gridpos(row) + jitter
            fill: String[6] = self._palette(node, color_idx)
            svg = convert(concat(
                svg,
                '<rect x="', self._uint3(x), '" y="', self._uint3(y),
                '" width="50" height="50" fill="#', fill, '"/>',
            ), String[8192])

    svg = convert(concat(
        svg,
        '<text x="300" y="40" font-size="20" text-anchor="middle" fill="#ffffff" '
        'font-family="monospace" textLength="520" lengthAdjust="spacingAndGlyphs">',
        truncated, '</text>',
        '<text x="300" y="555" font-size="20" text-anchor="middle" fill="#ffffff" font-family="monospace">SEPOLIA TESTNET</text>',
        '<text x="300" y="580" font-size="14" text-anchor="middle" fill="#ffffff" font-family="monospace">ENSv2 BETA - NO VALUE</text>',
        '<text x="10" y="592" font-size="10" fill="#ffffff" font-family="monospace">', fp, '</text>',
        '<text x="590" y="592" font-size="10" fill="#ffffff" font-family="monospace" text-anchor="end">', safe_version, '</text>',
        '</svg>',
    ), String[8192])
    return svg


@internal
@view
def _token_uri_json(token_id: uint256, normalized_name: String[255], node: bytes32) -> String[16384]:
    scan: Scan = self._scan(normalized_name)
    svg: String[8192] = self._render(normalized_name, scan, node, ENS_DEPLOYMENT_ID, RENDERER_VERSION)
    svg_b64: String[16352] = self._base64(convert(svg, Bytes[JSON_MAX]))

    deployment_hex: String[64] = self._hex_bytes32(ENS_DEPLOYMENT_ID)
    token_id_str: String[78] = self._uint_decimal(token_id)

    safe_version: String[768] = self._escape_json_bytes(convert(RENDERER_VERSION, Bytes[128]))
    safe_url_base: String[768] = self._escape_json_bytes(convert(EXTERNAL_URL_BASE, Bytes[128]))

    description: String[1792] = concat(
        normalized_name,
        ' - renderer ', safe_version,
        ' - ENSv2 deployment 0x', deployment_hex,
        ' - Identity artwork only. Not proof of payment, current ENS control, '
        'address ownership, merchant status, or endorsement.',
    )

    json: String[JSON_MAX] = convert(concat(
        '{"name":"', normalized_name, '"',
        ',"description":"', description, '"',
        ',"image":"data:image/svg+xml;base64,', svg_b64, '"',
        ',"external_url":"', safe_url_base, token_id_str, '"',
        '}',
    ), String[JSON_MAX])

    json_b64: String[16352] = self._base64(convert(json, Bytes[JSON_MAX]))
    return concat('data:application/json;base64,', json_b64)


# ================================================================================================
# minting
# ================================================================================================

@external
def mint(to: address, node: bytes32, normalized_name: String[255]) -> uint256:
    assert msg.sender == MINTER, "IdentityToken: not minter"
    assert to != empty(address), "IdentityToken: zero address"

    scan: Scan = self._scan(normalized_name)
    assert scan.valid, "IdentityToken: not normalized"

    computed_node: bytes32 = self._namehash(normalized_name, scan)
    assert computed_node == node, "IdentityToken: namehash mismatch"

    assert staticcall AUTHORITY.isNamespaceController(node, to), "IdentityToken: not namespace controller"
    assert self.token_of_node[node] == 0, "IdentityToken: node already minted"

    self.total_minted += 1
    token_id: uint256 = self.total_minted

    self.node_of[token_id] = node
    self.name_of[token_id] = normalized_name
    self.minted_at[token_id] = block.timestamp
    self.token_of_node[node] = token_id
    self.fingerprint_of[token_id] = self._fingerprint(normalized_name, node, ENS_DEPLOYMENT_ID, RENDERER_VERSION)

    self._owners[token_id] = to
    self._balances[to] += 1

    log Transfer(sender=empty(address), receiver=to, token_id=token_id)
    return token_id


@external
@view
def tokenURI(token_id: uint256) -> String[16384]:
    assert self._owners[token_id] != empty(address), "IdentityToken: nonexistent token"
    return self._token_uri_json(token_id, self.name_of[token_id], self.node_of[token_id])


# ================================================================================================
# ERC-721 views
# ================================================================================================

@external
@view
def name() -> String[32]:
    return "UNICA Identity"


@external
@view
def symbol() -> String[16]:
    return "UNICA-ID"


@external
@view
def balanceOf(owner: address) -> uint256:
    assert owner != empty(address), "IdentityToken: zero address"
    return self._balances[owner]


@external
@view
def ownerOf(token_id: uint256) -> address:
    owner: address = self._owners[token_id]
    assert owner != empty(address), "IdentityToken: nonexistent token"
    return owner


@external
@view
def getApproved(token_id: uint256) -> address:
    return empty(address)


@external
@view
def isApprovedForAll(owner: address, operator: address) -> bool:
    return False


@external
@view
def supportsInterface(interface_id: bytes4) -> bool:
    return (
        interface_id == INTERFACE_ID_ERC165
        or interface_id == INTERFACE_ID_ERC721
        or interface_id == INTERFACE_ID_ERC721_METADATA
    )


# ================================================================================================
# non-transferable (N7): every transfer/approval path reverts
# ================================================================================================

@external
def transferFrom(sender: address, receiver: address, token_id: uint256):
    raise "NonTransferable"


@external
def safeTransferFrom(sender: address, receiver: address, token_id: uint256, data: Bytes[1024] = b""):
    raise "NonTransferable"


@external
def approve(spender: address, token_id: uint256):
    raise "NonTransferable"


@external
def setApprovalForAll(operator: address, approved: bool):
    raise "NonTransferable"
