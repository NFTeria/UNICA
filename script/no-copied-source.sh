#!/usr/bin/env bash
# Guards the rule CLAUDE.md calls the one this repository is most likely to break by accident:
# nothing is copied in. Not from a dependency, not from a reference implementation, not from a
# spec's example block.
#
# WHAT IT COMPARES, and why it is narrower than it first looks. The obvious check — flag any
# tracked line that is byte-identical to a line of vendored source — does not work, and the
# reason is worth writing down so nobody widens it back:
#
#   * `import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";` has exactly one correct
#     spelling. So does a pragma, and so does an SPDX header.
#   * `function getHookPermissions() public pure override returns (Hooks.Permissions memory) {`
#     must match the base contract's signature or it does not compile. The same goes for
#     `unlockCallback`, `msgSender`, `_beforeSwap` and every other override.
#   * `return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);` is the value
#     the protocol demands, not a sentence someone chose.
#
# Conformance REQUIRES byte-identity, so a line-identity scan cannot tell it from copying. Run
# wide, this check produced 69 hits against this tree and every one was language-forced — a
# guard that cries wolf is a guard that gets ignored.
#
# So it compares BODY STATEMENTS only: declarations, wrapped signature fragments, canonical
# selector returns, imports and comments are all excluded. What remains is a line somebody
# chose how to write. Reproducing one of those verbatim is either a quotation or a paste, and
# this repository permits neither in place of writing from the description.
#
# LICENCE, not only credit. lib/uniswap-hooks/lib/v4-core/src/PoolManager.sol and seven core
# libraries are BUSL-1.1, non-production use only. This repository is MIT and public, and a
# push is permanent.
#
# It validates itself before it judges, twice over: a real vendored body statement must be
# caught, and a sentence of ordinary prose must not. Run --self-test to also plant a real
# vendored statement in a scratch file and watch the scan go red on it.
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 - "${1:-}" <<'PY'
import os, re, subprocess, sys, tempfile

SELF_TEST = sys.argv[1] == '--self-test' if len(sys.argv) > 1 else False
MIN = 40
ROOTS = [
    'lib/uniswap-hooks/lib/v4-core/src',
    'lib/uniswap-hooks/lib/v4-periphery/src',
    'lib/uniswap-hooks/lib/v4-periphery/lib/permit2/src',
    'lib/uniswap-hooks/src',
    'lib/hookmate/src',
]
DECL = re.compile(r'^(function |constructor|modifier |event |error |struct |enum |interface |contract |library |abstract )')

def forced(s):
    """True when the language, the compiler or an interface dictates this line's exact text."""
    if len(s) < MIN:
        return True
    if s.startswith(('import ', 'pragma ', '//', '/*', '*', '#', '|', '>', '- ', '* ', 'using ', '@')):
        return True
    if DECL.match(s):
        return True
    if s.endswith(('{', '(', ',')):
        return True
    if re.match(r'^returns? ?\(', s):
        return True
    if re.match(r'^return \(?[A-Za-z0-9_.]+\.selector', s):
        return True
    return False

vendored = {}
for root in ROOTS:
    for dirpath, _, names in os.walk(root):
        for n in names:
            if not n.endswith('.sol'):
                continue
            fp = os.path.join(dirpath, n)
            try:
                for line in open(fp, encoding='utf-8', errors='ignore'):
                    s = line.strip()
                    if not forced(s):
                        vendored.setdefault(s, fp)
            except OSError:
                pass

def scan(extra=None):
    files = subprocess.run(['git', 'ls-files'], capture_output=True, text=True).stdout.split()
    if extra:
        files = files + [extra]
    hits, n = [], 0
    for f in files:
        if f.startswith('lib/') or f.endswith(('.png', '.json', '.lock')):
            continue
        try:
            text = open(f, encoding='utf-8', errors='ignore').read()
        except OSError:
            continue
        n += 1
        for i, line in enumerate(text.split('\n'), 1):
            s = line.strip()
            if forced(s):
                continue
            src = vendored.get(s)
            if src:
                hits.append((f, i, s, src))
    return hits, n

checks = []
probe = next((l for l in vendored if len(l) > 55), None)
checks.append(('control: a real vendored body statement is recognised', probe is not None))
checks.append(('control: an ordinary sentence is not recognised',
               'The recipient receives at least the minimum the order names.' not in vendored))

if SELF_TEST:
    with tempfile.NamedTemporaryFile('w', suffix='.sol', dir='.', delete=False) as fh:
        fh.write('// planted\n' + probe + '\n')
        planted = os.path.basename(fh.name)
    try:
        h, _ = scan(extra=planted)
        checks.append(('sabotage: a planted vendored statement is caught',
                       any(x[0] == planted for x in h)))
    finally:
        os.unlink(planted)

hits, nfiles = scan()
checks.append((f'no tracked line reproduces a vendored body statement '
               f'({nfiles} files against {len(vendored)} vendored statements)', not hits))

for name, good in checks:
    print(('PASS  ' if good else 'FAIL  ') + name)
for f, i, s, src in hits[:20]:
    print(f'      {f}:{i}\n        {s[:110]}\n        matches {src}')
if len(hits) > 20:
    print(f'      ... and {len(hits) - 20} more')

npass = sum(1 for _, g in checks if g)
print(f'checks run: {len(checks)}, passed: {npass}, failed: {len(checks) - npass}')
sys.exit(0 if npass == len(checks) else 1)
PY
