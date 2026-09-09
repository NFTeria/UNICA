#!/usr/bin/env bash
# ---------------------------------------------------------------------------------------------
# sabotage-limits.sh — proves the EXPERIMENT B instruments can fail
#
# A check that has never failed is not a check. This script breaks one probe at a time, on
# purpose, runs the single test that is supposed to notice, and requires that test to FAIL. Then
# it restores the file and proves the restore was exact by comparing a SHA-256 taken before the
# edit. A sabotage that could not be undone byte-for-byte would leave the laboratory dirtier than
# it found it, so the restore is verified rather than assumed.
#
# Every row below names: what is broken, and which test must scream. If a test does NOT fail under
# its sabotage, that test is decorative and this script says so and exits non-zero.
#
# Usage:  bash test/lab/sabotage-limits.sh
# Env:    LIMITS_FORGE_SKIP   extra --skip glob passed to forge (see run-limits.sh)
# ---------------------------------------------------------------------------------------------
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 2
PROBES="src/lab/LimitProbes.sol"
TESTS="test/lab/Limits.t.sol"
SKIP_ARGS=()
if [ -n "${LIMITS_FORGE_SKIP:-}" ]; then SKIP_ARGS=(--skip "${LIMITS_FORGE_SKIP}"); fi

RUN=0
PASSED=0
FAILED=0

BEFORE_PROBES=$(shasum -a 256 "$PROBES" | awk '{print $1}')
BEFORE_TESTS=$(shasum -a 256 "$TESTS" | awk '{print $1}')
BACKUP_DIR=$(mktemp -d)
cp "$PROBES" "$BACKUP_DIR/probes.sol"
cp "$TESTS"  "$BACKUP_DIR/tests.sol"

restore() {
  cp "$BACKUP_DIR/probes.sol" "$PROBES"
  cp "$BACKUP_DIR/tests.sol"  "$TESTS"
}
trap 'restore; rm -rf "$BACKUP_DIR"' EXIT

# $1 file, $2 label, $3 test filter, $4 python replacement expression file content
sabotage() {
  local file="$1" label="$2" filter="$3" find="$4" replace="$5"
  RUN=$((RUN + 1))

  if ! FIND="$find" REPLACE="$replace" FILE="$file" python3 - <<'PY'
import os, sys
f, find, rep = os.environ["FILE"], os.environ["FIND"], os.environ["REPLACE"]
s = open(f).read()
if s.count(find) != 1:
    print(f"  the sabotage anchor is not unique ({s.count(find)} matches) — the file moved under this script", file=sys.stderr)
    sys.exit(1)
open(f, "w").write(s.replace(find, rep))
PY
  then
    echo "  FAILED  ${label}: could not apply the sabotage"
    FAILED=$((FAILED + 1)); restore; return
  fi

  local out
  out=$(forge test ${SKIP_ARGS[@]+"${SKIP_ARGS[@]}"} --match-path "$TESTS" --match-test "$filter" 2>&1)
  local status=$?
  restore

  if [ $status -ne 0 ]; then
    echo "  ok      ${label}  ->  ${filter} failed, as it must"
    PASSED=$((PASSED + 1))
  else
    echo "  FAILED  ${label}  ->  ${filter} still PASSED under sabotage; it is not checking what it claims"
    printf '%s\n' "$out" | tail -20
    FAILED=$((FAILED + 1))
  fi
}

echo "sabotage sweep — every instrument in EXPERIMENT B, broken on purpose"
echo

sabotage "$PROBES" \
  "B1 hookData digest is not the payload's" \
  "test_B1_00_control_smallPayloadArrivesIntact" \
  'lastDigest = keccak256(hookData);' \
  'lastDigest = keccak256(hex"");'

sabotage "$PROBES" \
  "B2 the burn loop burns a thousandth of what it is asked" \
  "test_B2_01_instrument_theBurnerActuallyBurns" \
  'uint256 stop = start - target;' \
  'uint256 stop = start - (target / 1000);'

sabotage "$PROBES" \
  "B3 peek() reads persistent storage instead of the transient slot" \
  "test_B3_04_theSlotIsEmptyInTheNextTransaction" \
  '            v := tload(SLOT)
        }
    }' \
  '            v := sload(lastWritten.slot)
        }
    }'

sabotage "$PROBES" \
  "B4 the re-entrancy reporter always reports success" \
  "test_B4_01_instrument_reportModeCarriesBothVerdicts" \
  'if (mode == Mode.Report) revert Reentered(uint8(target), ok, ret);' \
  'if (mode == Mode.Report) revert Reentered(uint8(target), true, ret);'

sabotage "$PROBES" \
  "B5 the argument-carrying error is replaced by the bare one" \
  "test_B5_01_aCustomErrorArrivesWhole" \
  'if (s == Shape.CustomWithArgs) revert ProbeRefusedWithArgs(address(this), 42, "limit-probe");' \
  'if (s == Shape.CustomWithArgs) revert ProbeRefusedNoArgs();'

sabotage "$TESTS" \
  "B6 the miner accepts a superset of the wanted permission bits" \
  "test_B6_01_instrument_theMinerRejectsTheWrongPattern" \
  'if (_addressFor(ptr, salt) & ALL_HOOK_BITS == wantedBits) return (i, salt);' \
  'if (_addressFor(ptr, salt) & wantedBits == wantedBits) return (i, salt);'

# ---- the restore has to be exact, and "exact" means a hash, not a glance ----------------------
RUN=$((RUN + 1))
AFTER_PROBES=$(shasum -a 256 "$PROBES" | awk '{print $1}')
AFTER_TESTS=$(shasum -a 256 "$TESTS" | awk '{print $1}')
if [ "$BEFORE_PROBES" = "$AFTER_PROBES" ] && [ "$BEFORE_TESTS" = "$AFTER_TESTS" ]; then
  echo "  ok      both files restored byte-for-byte (sha256 matches)"
  PASSED=$((PASSED + 1))
else
  echo "  FAILED  a sabotaged file was NOT restored exactly"
  echo "          probes before ${BEFORE_PROBES} after ${AFTER_PROBES}"
  echo "          tests  before ${BEFORE_TESTS} after ${AFTER_TESTS}"
  FAILED=$((FAILED + 1))
fi

echo
echo "sabotage checks run: ${RUN}, passed: ${PASSED}, failed: ${FAILED}"
[ "$FAILED" -eq 0 ] || exit 1
