#!/usr/bin/env bash
# The V2 mutation suite. Not a coverage report — a list of specific defects, each with the row
# that is supposed to catch it, run one at a time against the real tree.
#
# WHY IT IS SHAPED THIS WAY. "The tests pass" says nothing about whether the tests would notice if
# the code were wrong. This repository has already measured that twice: a guard deleted from both
# hook callbacks left every row green, and an unconstrained pool-match check survived a full suite.
# So every guard here is validated by DELETION, and a mutation is only marked killed when the row
# that NAMES it goes red. A mutation that turns some other row red is recorded as MISATTRIBUTED,
# which is a finding rather than a pass: it means the suite noticed something and named it wrong.
#
# Run: bash script/mutation-suite.sh [--only ID]
# Exit 0 only when every mutation is killed by its own declared row, and the unmutated control is
# fully green.
set -uo pipefail
cd "$(dirname "$0")/.."
exec python3 - "$@" <<'PY'
import json, os, pathlib, shutil, subprocess, sys, tempfile

ONLY = None
if '--only' in sys.argv:
    ONLY = sys.argv[sys.argv.index('--only') + 1]

# `--fork` re-runs the highest-value mutations against pinned live Sepolia dependencies instead of
# against local doubles. It is a smaller table on purpose: four of the local mutations are killed by
# rows that need a MISBEHAVING token, and USDC and WETH behave. Saying which four are missing is
# more useful than pretending the fork covers everything.
FORK = '--fork' in sys.argv
TEST_GLOB = 'test/fork/*.t.sol' if FORK else 'test/v2/*.t.sol'

HOOK = 'src/v2/QuoteSettlementHook.sol'
EXEC = 'src/v2/QuoteSettlementExecutor.sol'

# id, file, find, replace, killer test, what the mutation represents
MUTATIONS = [
    ('M01', HOOK,
     'if (sender != EXECUTOR) revert SwapperIsNotTheExecutor(EXECUTOR, sender);', 'sender;',
     'test_Admit_AnyoneButTheExecutorIsRefused',
     'anyone may swap through the invoice pool'),
    ('M02', HOOK,
     'if (digest == bytes32(0)) revert NotAnInvoiceDischarge();', '',
     'test_Admit_ASwapWithNoLiveInvoiceIsRefused',
     'a swap discharging no invoice is admitted'),
    ('M03', HOOK,
     'if (consumed[digest]) revert QuoteAlreadySettled(digest);', '',
     'test_Admit_AConsumedInvoiceCannotBeDischargedAgain',
     'an invoice can be discharged twice'),
    ('M04', HOOK,
     'if (PoolId.unwrap(key.toId()) != poolId) revert PoolDoesNotMatchQuote();', '',
     'test_Admit_AnInvoiceNamingASiblingPoolIsRefused',
     'an invoice for one pool is discharged through another'),
    ('M05', HOOK,
     'if (params.zeroForOne != zeroForOne) revert DirectionDoesNotMatchQuote();', '',
     'test_Admit_ASwapInTheWrongDirectionIsRefused',
     'the swap runs in the direction the invoice did not name'),
    ('M06', HOOK,
     'if (params.amountSpecified <= 0) revert ExactOutputRequired();', '',
     'test_Fill_AnExactInputSwapIsRefused',
     'an exact-input swap satisfies an exact-output invoice by luck'),
    ('M07', HOOK,
     'if (delivered < 0 || uint256(uint128(delivered)) < requiredOut) {', 'if (false) {',
     'test_Fill_AShortFilledInvoiceIsRefused',
     'the short fill Gate 0 measured is admitted'),
    ('M08', HOOK,
     'consumed[digest] = true;', '',
     'test_Admit_AConsumedInvoiceCannotBeDischargedAgain',
     'a discharged invoice is never marked, so it replays forever'),
    ('M09', HOOK,
     'if (key.currency0.isAddressZero() || key.currency1.isAddressZero()) revert NativeCurrencyNotSettleable();',
     '',
     'test_Init_ANativeCurrencyPoolIsRefused',
     'a native-currency pool carries a hook whose delivery promise it cannot keep'),
    ('M10', HOOK,
     'if (key.fee.isDynamicFee()) revert DynamicFeeNotSettleable();', '',
     'test_Init_ADynamicFeePoolIsRefused',
     'a pool trades at a fee this hook cannot set'),

    ('M11', EXEC,
     'if (deliveredOut != q.amountOut) revert DeliveryIsNotTheInvoice(q.quoteId, q.amountOut, deliveredOut);',
     '',
     'test_Layers_TheExecutorRefusesAShortFillWithNoHookToHelp',
     'the exact-output equality is dropped and the floor alone decides'),
    ('M12', EXEC,
     'to: address(POOL_MANAGER),', 'to: q.recipient,',
     'test_Settle_TheMerchantIsPaidExactlyAndNobodyElseHoldsAnything',
     'the Permit2 destination is not the PoolManager'),
    ('M13', EXEC,
     'requestedAmount: actualIn', 'requestedAmount: q.maxIn',
     'test_Settle_TheMerchantIsPaidExactlyAndNobodyElseHoldsAnything',
     'the payer is debited the ceiling instead of what the swap cost'),
    ('M14', EXEC,
     'POOL_MANAGER.sync(Currency.wrap(q.tokenIn));', '',
     'test_Settle_TheMerchantIsPaidExactlyAndNobodyElseHoldsAnything',
     'sync is omitted, so settle credits against a stale reserve reading'),
    ('M15', EXEC,
     'uint256 credited = POOL_MANAGER.settle();', 'uint256 credited = actualIn;',
     'test_Settle_TheMerchantIsPaidExactlyAndNobodyElseHoldsAnything',
     'settle is never called and the input delta is never cleared'),
    ('M16', EXEC,
     'POOL_MANAGER.take(Currency.wrap(q.tokenOut), q.recipient, q.amountOut);',
     'POOL_MANAGER.take(Currency.wrap(q.tokenOut), address(this), q.amountOut);',
     'test_Settle_TheMerchantIsPaidExactlyAndNobodyElseHoldsAnything',
     'the output is taken to the executor instead of the merchant'),
    ('M17', EXEC,
     'if (received != q.amountOut) revert MerchantNotPaidExactly(q.quoteId, q.amountOut, received);', '',
     'test_Adv_ATokenThatSkimsOnDeliveryIsRefused',
     'the merchant delivery is never verified'),
    ('M18', EXEC,
     'if (credited != actualIn) revert SettlementDidNotClose(actualIn, credited);', '',
     'test_AdvIn_ATokenThatOverpaysTheVenueIsRefused',
     'the PoolManager credit is not compared with what the swap said was owed'),
    ('M19', EXEC,
     'if (actualIn > q.maxIn) revert InputCeilingExceeded(q.quoteId, q.maxIn, actualIn);', '',
     'test_Refuse_ASwapThatCostsMoreThanTheSignedCeiling',
     'the payer pays past the ceiling they signed'),
    ('M20', EXEC,
     'if (_activeDigest != bytes32(0)) revert SettlementAlreadyInProgress(_activeDigest);', '',
     'test_Adv_ATokenThatReentersDuringDeliveryIsRefused',
     'a settlement can begin inside another settlement'),
    ('M21', EXEC,
     '_clearActiveContext();', '',
     'test_Settle_TheMerchantIsPaidExactlyAndNobodyElseHoldsAnything',
     'the active context outlives the settlement that opened it'),
    ('M22', EXEC,
     'if (q.amountOut == 0) revert ZeroAmountOut();', '',
     'test_Refuse_AZeroAmountOut',
     'a zero-amount invoice is accepted'),
    ('M23', EXEC,
     'if (q.maxIn == 0) revert ZeroMaxIn();', '',
     'test_Refuse_AZeroCeiling',
     'a zero ceiling is accepted'),
    ('M24', EXEC,
     'if (ECDSA.recover(digest, merchantSignature) != q.merchantSigner) revert WrongMerchantSignature(q.quoteId);',
     '',
     'test_Refuse_ASignatureFromSomebodyElse',
     'an unsigned quote settles'),
    ('M25', EXEC,
     'if (IInvoiceHook(q.hook).consumed(digest)) revert QuoteAlreadySettled(q.quoteId);', '',
     'test_Refuse_ASettledQuoteCannotBeSettledAgain',
     'the executor does not ask whether the invoice is already spent'),
    ('M26', EXEC,
     'if (boundTo != address(this)) revert HookIsNotBoundToThisExecutor(q.hook, boundTo);', '',
     'test_Refuse_AHookBoundToAnotherExecutor',
     'the merchant chooses a venue this executor is not bound to'),
    ('M27', EXEC,
     'if (q.tokenIn != expectedIn || q.tokenOut != expectedOut) {', 'if (false) {',
     'test_Refuse_CurrenciesThatDoNotMatchTheDirection',
     'the quote names assets that are not the ones the pool would move'),
    ('M28', EXEC,
     'if (closing != opening.executorIn) revert ExecutorHeldTheInput(opening.executorIn, closing);', '',
     'test_AdvIn_ATokenThatQuietlyPaysTheExecutorIsRefused',
     'the no-custody claim on the input is never measured'),
    ('M29', EXEC,
     'if (closing != opening.executorOut) revert ExecutorHeldTheOutput(opening.executorOut, closing);', '',
     'test_Adv_ATokenThatQuietlyPaysTheExecutorIsRefused',
     'the no-custody claim on the output is never measured'),
    ('M30', EXEC,
     'if (msg.sender != address(POOL_MANAGER)) revert NotThePoolManager(address(POOL_MANAGER), msg.sender);',
     '',
     'test_Refuse_AStrangerCallingTheUnlockCallback',
     'anyone can drive the settlement callback directly'),
]


def run_tests():
    """Returns {testName: 'Success'|'Failure'} across the V2 suites."""
    p = subprocess.run(
        ['forge', 'test', '--match-path', TEST_GLOB, '--no-match-test', 'Fuzz', '--json'],
        capture_output=True, text=True)
    out = p.stdout.strip()
    start = out.find('{')
    if start < 0:
        return None, p.stderr or out
    try:
        data = json.loads(out[start:])
    except json.JSONDecodeError:
        return None, 'forge did not return parseable JSON (a compile failure looks like this)'
    results = {}
    for suite in data.values():
        for name, r in suite.get('test_results', {}).items():
            results[name.split('(')[0]] = r.get('status')
    return results, None


FORK_MUTATIONS = [
    ('F01', HOOK,
     'if (sender != EXECUTOR) revert SwapperIsNotTheExecutor(EXECUTOR, sender);', 'sender;',
     'test_ForkN_AStrangerCannotSwapThroughTheInvoicePool',
     'anyone may swap through the invoice pool'),
    ('F02', HOOK,
     'if (delivered < 0 || uint256(uint128(delivered)) < requiredOut) {', 'if (false) {',
     'test_ForkN_AnInvoiceTheLiquidityCannotFill',
     'the short fill Gate 0 measured is admitted, against real liquidity'),
    ('F03', HOOK,
     'consumed[digest] = true;', '',
     'test_ForkD_AReplayChangesNothing',
     'a discharged invoice is never marked, so it replays forever'),
    ('F04', EXEC,
     'to: address(POOL_MANAGER),', 'to: q.recipient,',
     'test_ForkD_AMerchantIsPaidExactlyThroughTheOfficialStack',
     'the Permit2 destination is not the PoolManager'),
    ('F05', EXEC,
     'requestedAmount: actualIn', 'requestedAmount: q.maxIn',
     'test_ForkD_AMerchantIsPaidExactlyThroughTheOfficialStack',
     'the payer is debited the ceiling instead of what the swap cost'),
    ('F06', EXEC,
     'POOL_MANAGER.sync(Currency.wrap(q.tokenIn));', '',
     'test_ForkD_AMerchantIsPaidExactlyThroughTheOfficialStack',
     'sync is omitted, so settle credits against a stale reserve reading'),
    ('F07', EXEC,
     'uint256 credited = POOL_MANAGER.settle();', 'uint256 credited = actualIn;',
     'test_ForkD_AMerchantIsPaidExactlyThroughTheOfficialStack',
     'settle is never called and the input delta is never cleared'),
    ('F08', EXEC,
     'POOL_MANAGER.take(Currency.wrap(q.tokenOut), q.recipient, q.amountOut);',
     'POOL_MANAGER.take(Currency.wrap(q.tokenOut), address(this), q.amountOut);',
     'test_ForkD_AMerchantIsPaidExactlyThroughTheOfficialStack',
     'the output is taken to the executor instead of the merchant'),
    ('F09', EXEC,
     'if (actualIn > q.maxIn) revert InputCeilingExceeded(q.quoteId, q.maxIn, actualIn);', '',
     'test_ForkN_AnInputAboveTheCeilingIsRefusedAfterTheHookAdmitted',
     'the payer pays past the ceiling they signed'),
    ('F10', EXEC,
     'if (ECDSA.recover(digest, merchantSignature) != q.merchantSigner) revert WrongMerchantSignature(q.quoteId);',
     '',
     'test_ForkN_WrongMerchantSignature',
     'an unsigned quote settles'),
    ('F11', EXEC,
     '_clearActiveContext();', '',
     'test_ForkD_AMerchantIsPaidExactlyThroughTheOfficialStack',
     'the active context outlives the settlement that opened it'),
    ('F12', EXEC,
     'if (IInvoiceHook(q.hook).consumed(digest)) revert QuoteAlreadySettled(q.quoteId);', '',
     'test_ForkD_AReplayChangesNothing',
     'the executor does not ask whether the invoice is already spent'),
]

if FORK:
    MUTATIONS = FORK_MUTATIONS

print('UNICA V2 mutation suite' + (' — FORK' if FORK else ''))
print('control: the unmutated tree')
base, err = run_tests()
if base is None:
    print('  FAIL  the control did not run: ' + str(err))
    sys.exit(1)
base_red = sorted(n for n, s in base.items() if s != 'Success')
if base_red:
    print('  FAIL  the control is not green; nothing below can be believed')
    for n in base_red:
        print('        ' + n)
    sys.exit(1)
print(f'  PASS  {len(base)} rows green before any mutation\n')

rows = []
for mid, path, find, repl, killer, desc in MUTATIONS:
    if ONLY and mid != ONLY:
        continue
    p = pathlib.Path(path)
    original = p.read_text()
    if find not in original:
        rows.append((mid, path, killer, 'STALE', 'the mutation no longer matches the source', desc))
        continue
    if killer not in base:
        rows.append((mid, path, killer, 'NO SUCH ROW', 'the declared killer is not a test in this suite', desc))
        continue
    p.write_text(original.replace(find, repl, 1))
    try:
        after, err = run_tests()
        if after is None:
            # A mutation that will not compile is still a mutation the tree rejects, but it is the
            # COMPILER that rejected it and not a test. Recorded as such rather than counted.
            status, note = 'COMPILE', 'the mutated tree does not compile'
        else:
            red = sorted(n for n, s in after.items() if s != 'Success')
            if not red:
                status, note = 'SURVIVED', 'no row noticed'
            elif killer in red:
                others = [r for r in red if r != killer]
                status = 'KILLED'
                note = f'{len(red)} row(s) red, including its own' if others else 'killed by its own row alone'
            else:
                status, note = 'MISATTRIBUTED', 'red rows: ' + ', '.join(red[:3])
    finally:
        p.write_text(original)
    rows.append((mid, path, killer, status, note, desc))

width = max(len(r[2]) for r in rows) if rows else 10
print(f'{"id":4} {"status":14} {"killed by":{width}}  note')
for mid, path, killer, status, note, desc in rows:
    print(f'{mid:4} {status:14} {killer:{width}}  {note}')
    if status not in ('KILLED',):
        print(f'     -> {desc}')

killed = sum(1 for r in rows if r[3] == 'KILLED')
print(f'\nmutations run: {len(rows)}, killed by their own row: {killed}, other: {len(rows) - killed}')
if FORK:
    print('NOT covered on the fork, and covered locally instead: the exact-output equality, the')
    print('PoolManager credit comparison, and both no-custody checks. Each needs a MISBEHAVING')
    print('token to make two numbers disagree, and USDC and WETH behave. See `make mutants`.')

# Restore anything a crash might have left behind, then confirm.
final, _ = run_tests()
if final is None or any(s != 'Success' for s in final.values()):
    print('FAIL  the tree was not restored cleanly')
    sys.exit(1)
print('control restored: green')
sys.exit(0 if killed == len(rows) else 1)
PY
