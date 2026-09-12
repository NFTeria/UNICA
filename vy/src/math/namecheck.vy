# pragma version 0.4.3
"""
@title  NameCheck
@notice Pure ASCII-conservative ENS name validation, EIP-137 namehash, safe truncation for
        display, an ASCII-confusable warning flag, and XML/JSON string escaping.

        This module matches `web/ensv2/resolve.mjs`'s `normalizeName` EXACTLY (read
        2026-09-11, lines 62-79): a name is accepted only if every byte is one of
        `a-z0-9.-`, every label is 1-63 bytes, no label starts or ends with a hyphen,
        there are at least two labels, and the total length fits in 255 bytes (the
        `String[255]` parameter bound already enforces the last point at the ABI level).

        This is a defence-in-depth gate, not a copy of resolve.mjs's bytes: the off-chain
        normalizer lower-cases before validating, so an already-normalized name is expected
        here. Anything outside that exact byte-alphabet -- including every uppercase ASCII
        letter, every C0 control byte, DEL, and every byte >= 0x80 -- is refused by
        construction. Unicode names are out of v1 and refused, never silently mangled.

        No imports. Nothing here reads block state, storage, or any other module: every
        function is @pure. H10 forbids importing namemath.vy / logobackground.vy /
        merchant_policy.vy / payany_router.vy, and nothing below does.
"""

MAX_LABELS: constant(uint256) = 128    # ceil((255 + 1) / 2): the most 1-byte labels that fit
MAX_LABEL_LEN: constant(uint256) = 63
HEX_CHARS: constant(String[16]) = "0123456789abcdef"
DIGIT_CHARS: constant(String[10]) = "0123456789"

struct Scan:
    valid: bool
    count: uint256
    starts: DynArray[uint256, MAX_LABELS]
    lens: DynArray[uint256, MAX_LABELS]


# ---------- internal: one pass validates AND records label spans ----------

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
        c: uint8 = convert(slice(data, i, 1), uint8)
        is_lower: bool = c >= 97 and c <= 122
        is_digit: bool = c >= 48 and c <= 57
        is_dot: bool = c == 46
        is_hyphen: bool = c == 45

        if not (is_lower or is_digit or is_dot or is_hyphen):
            return result   # byte outside a-z0-9.- : refused, not mangled

        if is_dot:
            if label_len == 0:
                return result   # empty label ("..", leading ".", trailing ".")
            if prev_hyphen:
                return result   # label ends in a hyphen
            result.starts.append(label_start)
            result.lens.append(label_len)
            result.count += 1
            label_start = i + 1
            label_len = 0
            is_label_start = True
        else:
            if is_label_start and is_hyphen:
                return result   # label starts with a hyphen
            if label_len >= MAX_LABEL_LEN:
                return result   # label would exceed 63 bytes
            label_len += 1
            is_label_start = False
            prev_hyphen = is_hyphen

    # the final label never sees a trailing dot
    if label_len == 0:
        return result
    if prev_hyphen:
        return result
    result.starts.append(label_start)
    result.lens.append(label_len)
    result.count += 1

    if result.count < 2:
        return result   # at least two labels required

    result.valid = True
    return result


@internal
@pure
def _hex2(b: uint8) -> String[2]:
    hi: uint256 = convert(b, uint256) // 16
    lo: uint256 = convert(b, uint256) % 16
    return concat(slice(HEX_CHARS, hi, 1), slice(HEX_CHARS, lo, 1))


# ---------- external, pure API ----------

@external
@pure
def is_normalized(name: String[255]) -> bool:
    return self._scan(name).valid


@external
@pure
def label_count(name: String[255]) -> uint256:
    scan: Scan = self._scan(name)
    assert scan.valid, "namecheck: not normalized"
    return scan.count


@external
@pure
def namehash(name: String[255]) -> bytes32:
    """EIP-137, folded right to left: node = keccak256(node || keccak256(label))."""
    scan: Scan = self._scan(name)
    assert scan.valid, "namecheck: not normalized"
    data: Bytes[255] = convert(name, Bytes[255])
    node: bytes32 = empty(bytes32)
    for k: uint256 in range(MAX_LABELS):
        if k >= scan.count:
            break
        idx: uint256 = scan.count - 1 - k
        label_bytes: Bytes[255] = slice(data, scan.starts[idx], scan.lens[idx])
        node = keccak256(concat(node, keccak256(label_bytes)))
    return node


@external
@pure
def last_two_labels(name: String[255]) -> String[255]:
    scan: Scan = self._scan(name)
    assert scan.valid, "namecheck: not normalized"
    data: Bytes[255] = convert(name, Bytes[255])
    idx: uint256 = scan.count - 2
    start: uint256 = scan.starts[idx]
    end: uint256 = scan.starts[scan.count - 1] + scan.lens[scan.count - 1]
    piece: Bytes[255] = slice(data, start, end - start)
    return convert(piece, String[255])


@external
@pure
def truncate_for_svg(name: String[255], max_len: uint256 = 24) -> String[131]:
    """Shows the whole name unmodified when it already fits max_len. Otherwise shows a
    leading ellipsis plus the FINAL TWO LABELS IN FULL, always -- even when that exceeds
    max_len -- because keeping the namespace legible outranks hitting an exact character
    budget (security-review finding, 2026-09-11: the earlier "..." + last-label-only
    fallback silently dropped the merchant label for every two-label name longer than
    max_len, e.g. "reallylongmerchantnamehere.eth" rendered as just "...eth", making every
    long ".eth" name indistinguishable from every other one). The SVG <text> element that
    displays this value carries textLength/lengthAdjust so any length still fits the
    canvas. The hard cap of two 63-byte labels plus the ellipsis and the dot between them
    (63+1+63+3=130) sizes the String[131] return bound; a caller-supplied max_len above
    that is clamped down so the "show the whole name unmodified" branch can never
    overflow it."""
    scan: Scan = self._scan(name)
    assert scan.valid, "namecheck: not normalized"

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


@external
@pure
def has_confusable_ascii(name: String[255]) -> bool:
    """A warning flag, never a rejection. Inside any single label: the pair rn, vv or cl
    (each resembling m, w or d), or the digit/letter pair 0-and-o or 1-and-l both present."""
    scan: Scan = self._scan(name)
    assert scan.valid, "namecheck: not normalized"
    data: Bytes[255] = convert(name, Bytes[255])

    for li: uint256 in range(MAX_LABELS):
        if li >= scan.count:
            break
        start: uint256 = scan.starts[li]
        ln: uint256 = scan.lens[li]
        has_0: bool = False
        has_o: bool = False
        has_1: bool = False
        has_l: bool = False
        prev: uint8 = 0
        for j: uint256 in range(MAX_LABEL_LEN):
            if j >= ln:
                break
            c: uint8 = convert(slice(data, start + j, 1), uint8)
            if c == 48:
                has_0 = True
            if c == 111:
                has_o = True
            if c == 49:
                has_1 = True
            if c == 108:
                has_l = True
            if j > 0:
                if prev == 114 and c == 110:     # "rn" -> looks like "m"
                    return True
                if prev == 118 and c == 118:     # "vv" -> looks like "w"
                    return True
                if prev == 99 and c == 108:      # "cl" -> looks like "d"
                    return True
            prev = c
        if (has_0 and has_o) or (has_1 and has_l):
            return True
    return False


@external
@pure
def escape_xml(s: String[255]) -> String[1536]:
    """Escapes the five XML special characters (ampersand, angle brackets, double and
    single quote) for safe embedding in an XML/SVG text node. Operates on ARBITRARY bytes
    -- this is a defence-in-depth encoder, not a validator; it never reverts."""
    n: uint256 = len(s)
    data: Bytes[255] = convert(s, Bytes[255])
    out: Bytes[1536] = b""
    for i: uint256 in range(255):
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
        out = convert(concat(out, piece), Bytes[1536])
    return convert(out, String[1536])


@external
@pure
def escape_json(s: String[255]) -> String[1536]:
    """Escapes backslash, double quote, and every C0 control byte plus DEL as a u00XX
    escape sequence, for safe embedding inside a JSON string literal. Arbitrary bytes in,
    never reverts."""
    n: uint256 = len(s)
    data: Bytes[255] = convert(s, Bytes[255])
    out: String[1536] = ""
    for i: uint256 in range(255):
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
        out = convert(concat(out, piece), String[1536])
    return out
