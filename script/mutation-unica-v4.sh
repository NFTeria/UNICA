#!/usr/bin/env bash
# The UNICA v4 mutation suite — one defect at a time, each with the ONE row that must notice.
#
# WHY THIS EXISTS. A green suite is a claim about the tests, not about the code. The v4 security
# review found six money-path guards in the executor that no row could turn red: the two residual
# checks, the reentrancy latch, `SettlementDidNotClose`, `DeliveryNotExact` and `NotPoolManager`.
# Every one of them could have been deleted and the suite would still have said "ok". This file is
# the standing answer: each guard is fed a specific, single-substitution defect, and the guard is
# only credited when the row that NAMES it goes red.
#
# ── WHY IT RUNS ON A COPY, AND WHY THAT IS NOT NEGOTIABLE ──────────────────────────────────────────
# The first version of this runner mutated the WORKING TREE and restored each file afterwards. On
# 2026-09-11 that cost us a bad commit: while the "drop `_markSwapped`" mutant was applied to
# `src/unica-v4/UnicaMarketHook.sol`, another builder committed an unrelated formatting change with
# `git commit -a`, and 263b729 shipped a hook whose one-swap-per-order mark was never set. The
# runner then restored the file, so the working tree looked right and HEAD did not. Nothing about
# that was detectable from the runner's own output; it was found because the post-restore
# `git diff --quiet` check tripped on a HEAD that had moved underneath it.
#
# A restore window one mutation wide is still a window, and `git commit -a` does not know it is
# standing in one. So this runner NEVER writes to the working tree. It mirrors `src/`, `test/` and
# `script/` into `.rehearsal/mutants/tree` (gitignored, `lib/` symlinked, its own `out/` and
# `cache/`), mutates only in there, and refuses to start if it finds itself pointed at the real
# repository. The working tree's three source files are hashed against `git show HEAD:<path>` before
# and after the run and printed, so "nothing was touched" is a stated measurement rather than a
# hope.
#
# THE THREE VERDICTS.
#   KILLED         the declared row went red and no other row in its file did.
#   MISATTRIBUTED  the declared row went red, and so did others in the same file. Recorded as a
#                  finding, not counted as a clean kill. It is not always a fault: several rows may
#                  legitimately reach one guard by different routes, and the note says which went
#                  red so a reader can tell that case from a suite that cannot name what it caught.
#   SURVIVED       nothing in the file noticed. The guard is unprotected; the run fails.
# COMPILE, STALE and NO SUCH ROW are recorded separately: a mutation the compiler rejects was
# refused by the compiler and not by a test, and a mutation whose target text or killer row has
# drifted is a broken table entry rather than a result. All three fail the run, because a table that
# does not apply is not evidence.
#
# Run:  bash script/mutation-unica-v4.sh [--only ID[,ID...]] [--list] [--fresh]
# Exit: 0 only when every mutation is KILLED or MISATTRIBUTED, and no entry is SURVIVED, COMPILE,
#       STALE or NO SUCH ROW.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
exec python3 -u - "$@" <<'PY'
import hashlib, json, os, pathlib, shutil, subprocess, sys

ONLY = None
if '--only' in sys.argv:
    ONLY = [s for s in sys.argv[sys.argv.index('--only') + 1].split(',') if s]
LIST_ONLY = '--list' in sys.argv
FRESH = '--fresh' in sys.argv

REPO = pathlib.Path.cwd().resolve()
MIRROR = REPO / '.rehearsal' / 'mutants' / 'tree'

EXEC = 'src/unica-v4/UnicaMarketExecutor.sol'
HOOK = 'src/unica-v4/UnicaMarketHook.sol'
REG = 'src/unica-v4/UnicaMarketRegistry.sol'

GUARDS = 'test/unica-v4/hook/Guards.t.sol'
SETTLE = 'test/unica-v4/hook/Settlement.t.sol'
ORACLE = 'test/unica-v4/hook/Oracle.t.sol'
REGISTRY_T = 'test/unica-v4/registry/Registry.t.sol'

# id, source file, exact text to find, text to replace it with, killer row, the row's file, what the
# defect would mean if it shipped.
MUTATIONS = [
    ('M01', EXEC,
     'if (assetAfter != snap.assetBefore) revert ExecutorResidualInput(snap.assetBefore, assetAfter);', '',
     'test_X14a_anInputTokenThatCreditsTheExecutorIsRefused', GUARDS,
     'the executor may end a payment holding input tokens it did not start with'),
    ('M02', EXEC,
     'if (payoutAfter != snap.payoutBefore) revert ExecutorResidualPayout(snap.payoutBefore, payoutAfter);', '',
     'test_X14b_aPayoutTokenThatCreditsTheExecutorIsRefused', GUARDS,
     'the executor may keep part of the merchant payout'),
    ('M03', EXEC,
     'if (held != 0) revert Reentered();', '',
     'test_X17_aReentrantTransferFromIsRefusedByTheLatch', GUARDS,
     'a payment may begin inside another payment, through the input token'),
    ('M04', EXEC,
     'if (msg.sender != order.payer) revert WrongPayer(orderId, order.payer, msg.sender);', '',
     'test_X2_wrongPayerRefused_andTheBoundPayerSettles', SETTLE,
     'anyone holding the asset may pay someone else’s order'),
    ('M05', EXEC,
     'if (stored != UnicaMarketTypes.OrderStatus.Open) revert OrderNotOpen(orderId, uint8(stored));', '',
     'test_X4_replayRefusedThreeWays', SETTLE,
     'a settled order can be paid a second time'),
    ('M06', EXEC,
     'if (msg.sender != address(POOL_MANAGER)) revert NotPoolManager(msg.sender);', '',
     'test_X12_aForgedUnlockCallbackIsRefusedTwoWays', GUARDS,
     'a stranger can drive the settlement callback directly'),
    ('M07', EXEC,
     'if (paid != amountIn) revert SettlementDidNotClose(amountIn, paid);', '',
     'test_X16_aTokenThatSkimsOnlyOnTheSettleTransferIsRefused', GUARDS,
     'the pool may be handed less than it is owed and the payment still complete'),
    ('M08', EXEC,
     'if (delivered != out) revert DeliveryNotExact(orderId, out, delivered);', '',
     'test_DeliveryNotExact_aPayoutThatDebitsTheRecipientDuringTake', GUARDS,
     'the merchant may keep less than the pool produced, with only the floor to catch it'),

    ('M09', HOOK,
     '_markSwapped(receipt.orderId);', '',
     'test_H7_H8_H9_theHookRefusesEveryMalformedSwap', SETTLE,
     'one in-flight order can be swapped twice inside a single unlock'),
    ('M10', HOOK,
     'if (routeId != policy.feedId) revert OracleFeedMismatch(MARKET_ID, policy.feedId, routeId);', '',
     'test_changedFeedIdIsCaughtOnTheNextSwap', ORACLE,
     'an adapter may change the route it serves after the market committed to it'),
    ('M11', HOOK,
     'if (produced < minAllowed) revert ExecutionBelowOracleBand(MARKET_ID, produced, minAllowed);', '',
     'test_O26_repeatedPaymentsHaltExactlyWhenTheBandIsSpent', GUARDS,
     'payments continue below the oracle band once the band is spent'),
    ('M12', HOOK,
     'if (produced > maxAllowed) revert ExecutionAboveOracleBand(MARKET_ID, produced, maxAllowed);', '',
     'test_O16_O17_theBandIsInclusiveAtBothEdges', ORACLE,
     'a payment far above the reference settles unremarked'),
    ('M-fee-1', HOOK,
     'swapFee = half == 0 ? storedLpFee : ProtocolFeeLibrary.calculateSwapFee(half, storedLpFee);',
     'swapFee = storedLpFee;',
     'test_H12b_assetIsCurrency0_takesTheLowTwelveBits', SETTLE,
     'the receipt reports the LP fee as the swap fee, so the band divides out the wrong number'),
    ('M-fee-2', HOOK,
     'uint16 half = ASSET_IS_CURRENCY0\n'
     '            ? ProtocolFeeLibrary.getZeroForOneFee(storedProtocolFee)\n'
     '            : ProtocolFeeLibrary.getOneForZeroFee(storedProtocolFee);',
     'uint16 half = ProtocolFeeLibrary.getZeroForOneFee(storedProtocolFee);',
     'test_H12c_assetIsCurrency1_takesTheHighTwelveBits', SETTLE,
     'the protocol-fee half is read for the wrong direction on half of all markets'),
    ('M1', HOOK,
     'int128 inLeg = ASSET_IS_CURRENCY0 ? delta.amount0() : delta.amount1();\n'
     '        int128 outLeg = ASSET_IS_CURRENCY0 ? delta.amount1() : delta.amount0();',
     'int128 inLeg = delta.amount0();\n'
     '        int128 outLeg = delta.amount1();',
     'test_X1b_settlesInTheMirroredOrdering', SETTLE,
     'the fill is measured by currency index instead of by role, so it is wrong wherever the asset sorts second'),

    ('M16', REG,
     'if (expected != marketId) revert MarketIdMismatch(expected, marketId);', '',
     'test_R7_registerRefusesAnIdItDidNotComputeAndAFeedTheRouteDoesNotServe', REGISTRY_T,
     'the factory may register a market under an id the registry did not compute'),
    ('M17', REG,
     'if (actual != policy.feedId) revert OracleFeedMismatch(marketId, policy.feedId, actual);', '',
     'test_R7_registerRefusesAnIdItDidNotComputeAndAFeedTheRouteDoesNotServe', REGISTRY_T,
     'a market may be registered against an adapter that does not serve its route'),
    ('M18', REG,
     'if (current == UnicaMarketTypes.MarketStatus.RETIRED) revert WrongMarketStatus(marketId, uint8(current));\n'
     '        m.status = UnicaMarketTypes.MarketStatus.RETIRED;',
     'm.status = UnicaMarketTypes.MarketStatus.RETIRED;',
     'test_R4_retiredIsTerminal', REGISTRY_T,
     'RETIRED stops being terminal and a retired market can be retired again, re-emitting its ending'),
]

TOUCHED = sorted({m[1] for m in MUTATIONS})


def sha_bytes(b):
    return hashlib.sha256(b).hexdigest()


def sha_file(path):
    return sha_bytes(pathlib.Path(path).read_bytes())


def sha_head(rel):
    p = subprocess.run(['git', 'show', f'HEAD:{rel}'], cwd=REPO, capture_output=True)
    if p.returncode != 0:
        return None
    return sha_bytes(p.stdout)


def report_worktree(when):
    """Every file this table can mutate, hashed against HEAD. Printed, never inferred."""
    print(f'working tree vs HEAD ({when}):')
    all_same = True
    for rel in TOUCHED:
        w = sha_file(REPO / rel)
        h = sha_head(rel)
        same = (w == h)
        all_same = all_same and same
        print(f'  {"same as HEAD" if same else "DIFFERS FROM HEAD":18} {rel}')
        print(f'  {"":18} worktree {w}')
        print(f'  {"":18} HEAD     {h}')
    return all_same


def build_mirror():
    """src, test and script copied; lib symlinked; out and cache the mirror's own."""
    if FRESH and MIRROR.exists():
        shutil.rmtree(MIRROR)
    MIRROR.mkdir(parents=True, exist_ok=True)
    for name in ('foundry.toml', 'remappings.txt'):
        shutil.copy2(REPO / name, MIRROR / name)
    for name in ('src', 'test', 'script'):
        dst = MIRROR / name
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(REPO / name, dst, symlinks=True)
    link = MIRROR / 'lib'
    if not link.is_symlink():
        if link.exists():
            shutil.rmtree(link)
        link.symlink_to(REPO / 'lib')


def run_file(test_file):
    """Every row in one test file of the MIRROR: {rowName: 'Success'|'Failure'}, or (None, why)."""
    env = dict(os.environ, FOUNDRY_OUT='out', FOUNDRY_CACHE_PATH='cache')
    p = subprocess.run(
        ['forge', 'test', '--match-path', test_file, '--json'],
        cwd=MIRROR, env=env, capture_output=True, text=True)
    out = p.stdout.strip()
    start = out.find('{')
    if start < 0:
        return None, (p.stderr or out)[-2000:]
    try:
        data = json.loads(out[start:])
    except json.JSONDecodeError:
        return None, 'forge returned no parseable JSON (a compile failure looks exactly like this)'
    rows = {}
    for suite in data.values():
        for name, r in suite.get('test_results', {}).items():
            rows[name.split('(')[0]] = r.get('status')
    if not rows:
        return None, 'the run produced no rows at all'
    return rows, None


selected = [m for m in MUTATIONS if not ONLY or m[0] in ONLY]
if not selected:
    print(f'no mutation with id {ONLY}')
    sys.exit(2)

if LIST_ONLY:
    for mid, path, find, repl, killer, tfile, desc in selected:
        print(f'{mid:8} {path:42} {killer}')
    sys.exit(0)

print('UNICA v4 mutation suite')
print(f'repository : {REPO}')
print(f'mirror     : {MIRROR}   (the ONLY tree this run writes to)')
print(f'mutations  : {len(selected)}\n')

if MIRROR.resolve() == REPO:
    print('FAIL  the mirror resolves to the repository itself; refusing to mutate the working tree')
    sys.exit(1)

before_clean = report_worktree('before')
print()

build_mirror()

# The control, per test file: nothing below can be believed if a file is not green to begin with.
files = sorted({m[5] for m in selected})
baseline = {}
print('control: the unmutated mirror')
for f in files:
    rows, err = run_file(f)
    if rows is None:
        print(f'  FAIL  {f}: {err}')
        sys.exit(1)
    red = sorted(n for n, s in rows.items() if s != 'Success')
    if red:
        print(f'  FAIL  {f} is not green before any mutation: ' + ', '.join(red))
        sys.exit(1)
    baseline[f] = rows
    print(f'  PASS  {f}: {len(rows)} rows green, 0 red')
print()

results = []
for mid, path, find, repl, killer, tfile, desc in selected:
    p = MIRROR / path
    original = p.read_bytes()
    before = sha_bytes(original)
    text = original.decode()

    if text.count(find) != 1:
        results.append((mid, killer, 'STALE', f'the target text appears {text.count(find)} times, not once', desc))
        print(f'  {mid:8} STALE')
        continue
    if killer not in baseline[tfile]:
        results.append((mid, killer, 'NO SUCH ROW', f'{killer} is not a row in {tfile}', desc))
        print(f'  {mid:8} NO SUCH ROW')
        continue

    p.write_text(text.replace(find, repl, 1))
    try:
        rows, err = run_file(tfile)
        if rows is None:
            status, note = 'COMPILE', 'the mutated tree does not compile'
        else:
            red = sorted(n for n, s in rows.items() if s != 'Success')
            if not red:
                status, note = 'SURVIVED', 'no row in ' + tfile + ' noticed'
            elif killer not in red:
                status, note = 'MISATTRIBUTED', 'red instead: ' + ', '.join(red[:3])
            elif len(red) > 1:
                others = [r for r in red if r != killer]
                status = 'MISATTRIBUTED'
                note = f'its own row went red, and so did {len(others)}: ' + ', '.join(others[:3])
            else:
                status, note = 'KILLED', 'killed by its own row alone'
    finally:
        p.write_bytes(original)

    if sha_file(p) != before:
        print(f'\nFAIL  {p} was not restored byte-for-byte after {mid}. Stopping.')
        sys.exit(1)

    results.append((mid, killer, status, note, desc))
    print(f'  {mid:8} {status:14} {killer}')

width = max((len(r[1]) for r in results), default=10)
print(f'\n{"id":8} {"verdict":14} {"killed by":{width}}  note')
for mid, killer, status, note, desc in results:
    print(f'{mid:8} {status:14} {killer:{width}}  {note}')
    if status != 'KILLED':
        print(f'         -> if it shipped: {desc}')

killed = sum(1 for r in results if r[2] == 'KILLED')
misattributed = sum(1 for r in results if r[2] == 'MISATTRIBUTED')
survived = sum(1 for r in results if r[2] == 'SURVIVED')
broken = len(results) - killed - misattributed - survived
print(f'\nmutations run: {len(results)}, KILLED: {killed}, MISATTRIBUTED: {misattributed}, '
      f'SURVIVED: {survived}, COMPILE/STALE/NO SUCH ROW: {broken}')
print('Every mutation above was applied to the mirror, run against the row that names it, and '
      'restored byte-for-byte. The working tree was never written to.\n')

after_clean = report_worktree('after')
if not after_clean and before_clean:
    print('\nFAIL  a file this table can mutate now differs from HEAD and did not before. Stopping.')
    sys.exit(1)

sys.exit(0 if (survived == 0 and broken == 0) else 1)
PY
