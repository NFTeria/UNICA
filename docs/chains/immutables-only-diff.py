#!/usr/bin/env python3
"""Exit 0 only if two runtime hex dumps differ ONLY in whole 20-byte runs.

Why this is the test. Two Universal Routers compiled from the same source but constructed with
different arguments differ exactly where those arguments were inlined into the runtime, and every
one of those sites is a 20-byte address. So "every differing byte lies inside a run of exactly 20"
is the shape of "one build, different immutables", and anything else — a run of 3, a run of 64, a
length mismatch — is the shape of different code. It is not proof of identical source, and this
script does not claim to be: it is the strongest statement two runtimes can make about each other
without a verified source match on both chains. Stated as a negative, it is the check that would
have caught the case this repository already met once, where a chain's router was a different,
larger build than Sepolia's (docs/feedback/uniswap/robinhood.md).

Usage: immutables-only-diff.py <a.hex> <b.hex>   (files hold 0x-prefixed runtime, as `cast code` prints)
"""
import sys


def load(path):
    with open(path) as fh:
        text = fh.read().strip()
    if text.startswith("0x"):
        text = text[2:]
    return bytes.fromhex(text)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: immutables-only-diff.py <a.hex> <b.hex>", file=sys.stderr)
        return 2
    a, b = load(sys.argv[1]), load(sys.argv[2])
    if not a or not b:
        print("one runtime is empty; refusing to call that a match", file=sys.stderr)
        return 1
    if len(a) != len(b):
        print(f"different sizes: {len(a)} vs {len(b)}", file=sys.stderr)
        return 1
    differing = [i for i in range(len(a)) if a[i] != b[i]]
    runs = []
    for i in differing:
        if runs and i == runs[-1][1] + 1:
            runs[-1][1] = i
        else:
            runs.append([i, i])
    bad = [r for r in runs if r[1] - r[0] + 1 != 20]
    print(f"size {len(a)}, differing bytes {len(differing)}, runs {len(runs)}, runs that are not 20 bytes {len(bad)}")
    if not runs:
        # Identical runtimes are not "one build with different immutables"; they are the same
        # deployment read twice. Say so rather than passing on a comparison that never happened.
        print("the two runtimes are byte-identical; that is not this check's subject", file=sys.stderr)
        return 1
    for r in bad:
        print(f"  run at offset {r[0]} is {r[1] - r[0] + 1} bytes, not 20", file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
