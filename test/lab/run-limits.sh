#!/usr/bin/env bash
# ---------------------------------------------------------------------------------------------
# run-limits.sh — the EXPERIMENT B runner
#
# Runs the limit suite, runs the discriminator that separates a GAS ceiling from a TOOLCHAIN
# memory ceiling, runs the sabotage sweep that proves the instruments can fail, and ends with a
# stated tally. It prints "checks run: N, passed: P, failed: F" — never a blank panel — and exits
# non-zero when F is greater than zero. An empty result and a broken reporter look identical from
# the outside, so this script refuses to finish silently: a run that cannot even compile reports
# one failed check rather than zero of everything.
#
# Usage:  bash test/lab/run-limits.sh
#
# Env:
#   LIMITS_FORGE_SKIP   a --skip glob handed to forge. Empty by default and it should stay that
#                       way. It exists because src/lab/ is a shared laboratory: while EXPERIMENT B
#                       was written, EXPERIMENT A's files were being written in the same directory
#                       by another session and did not compile yet. The measurements in
#                       docs/lab/HOOK-LIMITS.md were taken with
#                       LIMITS_FORGE_SKIP='*NanoAuthorization*', and the doc says so. A skip is a
#                       fact about the tree at the time of the run, never a property of this
#                       experiment, which is why it is a parameter and not a hard-coded flag.
# ---------------------------------------------------------------------------------------------
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 2
TESTS="test/lab/Limits.t.sol"
SKIP_ARGS=()
if [ -n "${LIMITS_FORGE_SKIP:-}" ]; then SKIP_ARGS=(--skip "${LIMITS_FORGE_SKIP}"); fi

RUN=0
PASSED=0
FAILED=0

note_pass() { PASSED=$((PASSED + 1)); RUN=$((RUN + 1)); echo "  ok      $1"; }
note_fail() { FAILED=$((FAILED + 1)); RUN=$((RUN + 1)); echo "  FAILED  $1"; }

echo "EXPERIMENT B — where a Uniswap v4 hook stops"
echo "repository: $(pwd)"
echo "forge:      $(forge --version | head -1)"
echo "solc:       $(forge config 2>/dev/null | grep -E '^solc ' | head -1)"
echo "skip glob:  ${LIMITS_FORGE_SKIP:-<none>}"
echo

# ---- 1. the suite ----------------------------------------------------------------------------
echo "1. the limit suite"
JSON=$(forge test ${SKIP_ARGS[@]+"${SKIP_ARGS[@]}"} --match-path "$TESTS" --json 2>/dev/null)
SUITE_STATUS=$?

if [ -z "$JSON" ]; then
  note_fail "forge produced no result at all (a compile failure, or the path matched nothing)"
  forge test ${SKIP_ARGS[@]+"${SKIP_ARGS[@]}"} --match-path "$TESTS" 2>&1 | tail -25
else
  # One line per test: "<suite>::<name> <PASS|FAIL>". Counted here rather than trusting the exit
  # code alone, so "0 tests ran" can never be reported as a pass.
  RESULTS=$(printf '%s' "$JSON" | python3 "$(dirname "$0")/summarise-forge-json.py" 2>/dev/null)

  if [ -z "$RESULTS" ]; then
    note_fail "the suite reported no test results, which is not the same as passing"
  else
    while IFS= read -r line; do
      case "$line" in
        *" Success") note_pass "${line% Success}" ;;
        *)          note_fail "$line" ;;
      esac
    done <<< "$RESULTS"
  fi
fi
echo

# ---- 2. gas ceiling, or toolchain memory ceiling? --------------------------------------------
# The B1 ladder above the ceiling halts with no revert data, and an out-of-gas and a
# `MemoryLimitOOG` are indistinguishable from inside the EVM. They ARE distinguishable from
# outside: raise Foundry's memory limit and re-run. If the outcome moves, the limit measured was
# the toolchain's. If it does not move, the limit measured was gas.
echo "2. discriminator — is the hookData ceiling gas, or Foundry's memory limit?"
LADDER_DEFAULT=$(forge test ${SKIP_ARGS[@]+"${SKIP_ARGS[@]}"} --match-path "$TESTS" --match-test 'test_B1_05' -vv 2>/dev/null \
  | grep -E '^\s+[0-9]+ (true|false) [0-9]+$' | awk '{print $1, $2}')
LADDER_BIG=$(forge test ${SKIP_ARGS[@]+"${SKIP_ARGS[@]}"} --memory-limit 4294967296 --match-path "$TESTS" --match-test 'test_B1_05' -vv 2>/dev/null \
  | grep -E '^\s+[0-9]+ (true|false) [0-9]+$' | awk '{print $1, $2}')

if [ -z "$LADDER_DEFAULT" ]; then
  note_fail "the ladder produced no rows to compare, so the discriminator proved nothing"
elif [ "$LADDER_DEFAULT" = "$LADDER_BIG" ]; then
  note_pass "same verdicts at 128 MiB and at 4 GiB of EVM memory -> the ceiling is GAS, not the toolchain"
  echo "          rows (bytes, succeeded): $(printf '%s' "$LADDER_DEFAULT" | tr '\n' ';')"
else
  note_fail "the verdicts MOVED when the memory limit was raised -> the ceiling reported is Foundry's, not gas"
  echo "          at 128 MiB: $(printf '%s' "$LADDER_DEFAULT" | tr '\n' ';')"
  echo "          at   4 GiB: $(printf '%s' "$LADDER_BIG" | tr '\n' ';')"
fi
echo

# ---- 3. the instruments must be able to fail --------------------------------------------------
echo "3. sabotage sweep"
SAB=$(bash test/lab/sabotage-limits.sh 2>&1)
SAB_STATUS=$?
printf '%s\n' "$SAB" | sed 's/^/  /'
SAB_LINE=$(printf '%s' "$SAB" | grep -E '^sabotage checks run:' | tail -1)
if [ -n "$SAB_LINE" ]; then
  SAB_RUN=$(printf '%s' "$SAB_LINE" | sed -E 's/.*run: ([0-9]+).*/\1/')
  SAB_PASS=$(printf '%s' "$SAB_LINE" | sed -E 's/.*passed: ([0-9]+).*/\1/')
  SAB_FAIL=$(printf '%s' "$SAB_LINE" | sed -E 's/.*failed: ([0-9]+).*/\1/')
  RUN=$((RUN + SAB_RUN)); PASSED=$((PASSED + SAB_PASS)); FAILED=$((FAILED + SAB_FAIL))
elif [ $SAB_STATUS -ne 0 ]; then
  note_fail "the sabotage sweep did not report a tally and did not exit clean"
else
  note_fail "the sabotage sweep exited clean without reporting a tally, which is not evidence"
fi
echo

# ---- the tally ---------------------------------------------------------------------------------
echo "checks run: ${RUN}, passed: ${PASSED}, failed: ${FAILED}"
[ "$FAILED" -eq 0 ] || exit 1
[ "$RUN" -gt 0 ] || { echo "no checks ran at all, which is a failure and not a pass"; exit 1; }
exit 0
