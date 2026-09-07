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
#   * `"PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256
#     deadline,"` is a WIRE CONSTANT. It is not a statement; it is the exact byte string that goes
#     into an EIP-712 hash, and a signature computed over any other spelling is rejected by the
#     deployed contract. Added 2026-09-07 after this scan fired on the UNICA V2 payer digest and
#     the honest answer was "there is one correct spelling and this is it". The exemption is
#     narrow on purpose: a line that is ENTIRELY a string literal whose content opens as a type
#     signature — `Name(` — and nothing else. A copied error message or a copied sentence in
#     quotes is still caught, and there is a control below that proves it.
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
# IT READS UNTRACKED FILES TOO, and that is not a nicety. It did not, and on 2026-09-07 the local
# gate passed while CI failed on the same commit: the file the scan objected to was still untracked
# when the gate ran locally, and `git ls-files` cannot see an untracked file. A gate whose verdict
# depends on whether `git add` has happened yet is not a gate — it is a coin toss that CI resolves
# after the push. `script/scan.sh` had already learned this; this file had not.
#
# It validates itself before it judges, three times over: a real vendored body statement must be
# caught, a sentence of ordinary prose must not, and an UNTRACKED file carrying a vendored statement
# must be caught. Run --self-test to also plant a real vendored statement in a scratch file and
# watch the scan go red on it.
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
# A whole line that is one string literal opening as `Name(` — an EIP-712 or ABI type signature.
# Nothing else qualifies: the content must start with an identifier immediately followed by `(`.
TYPE_STRING = re.compile(r'^"[A-Za-z_][A-Za-z0-9_]*\([^"]*"[;,]?$')

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
    if TYPE_STRING.match(s):
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

def repo_files():
    """Tracked files AND untracked-but-not-ignored ones, which is what CI will see after a push.

    NUL-delimited. Splitting git's output on whitespace loses any path containing a space or a
    newline, and a scanner that silently skips a file is the same defect as one that cannot see
    untracked files: its input is not what it thinks it is.
    """
    def enumerate_with(*args):
        out = subprocess.run(['git'] + list(args) + ['-z'], capture_output=True, text=True).stdout
        return [f for f in out.split('\0') if f]

    return enumerate_with('ls-files') + enumerate_with('ls-files', '--others', '--exclude-standard')


def scan(extra=None):
    files = repo_files()
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
# The two halves of the wire-constant exemption, unit-tested against `forced` directly so the
# widening cannot be believed without evidence that it stayed narrow.
checks.append(('control: an EIP-712 type string is treated as a wire constant',
               forced('"PermitWitnessTransferFrom(TokenPermissions permitted,address spender,'
                      'uint256 nonce,uint256 deadline,";')))
checks.append(('control: a quoted sentence is NOT treated as a wire constant',
               not forced('"the recipient receives at least the minimum the order names, always";')))
checks.append(('control: a quoted call expression is NOT treated as a wire constant',
               not forced('require(balanceOf(msg.sender) >= amount, "not enough of the token here");')))

# The second blind spot in the same family: a path with a space in it must be scanned too. Both
# controls plant a real vendored statement and require the file WALK to find it — not a path handed
# in — because what is being tested is the enumeration, not the comparison.
with tempfile.NamedTemporaryFile('w', suffix='.sol', dir='.', delete=False, prefix='a name with spaces ') as fh:
    fh.write('// planted, spaced\n' + probe + '\n')
    spaced_probe = os.path.basename(fh.name)
try:
    h, _ = scan()
    checks.append(('control: a file whose NAME CONTAINS SPACES is caught',
                   any(x[0] == spaced_probe for x in h)))
finally:
    os.unlink(spaced_probe)

# The blind spot that let a green local gate meet a red CI: an untracked file must be scanned.
with tempfile.NamedTemporaryFile('w', suffix='.sol', dir='.', delete=False) as fh:
    fh.write('// planted, untracked\n' + probe + '\n')
    untracked_probe = os.path.basename(fh.name)
try:
    h, _ = scan()  # NOT passed as `extra` — it must be found by the file walk itself
    checks.append(('control: an UNTRACKED file carrying a vendored statement is caught',
                   any(x[0] == untracked_probe for x in h)))
finally:
    os.unlink(untracked_probe)

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
checks.append((f'no line in this working tree reproduces a vendored body statement '
               f'({nfiles} files, tracked and untracked, against {len(vendored)} vendored statements)',
               not hits))

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
