#!/usr/bin/env bash
# UNICA router compatibility — the runner for src/compat/ and test/compat/.
#
# Every row is run on its own and reported on its own. There is no aggregate that can hide one row
# inside another, and there is no path through this script that prints a pass for something that did
# not run: a row whose fork endpoint is missing or unreachable prints SKIP, is counted as a SKIP, and
# makes the whole run exit non-zero. An empty result and a broken runner look identical, so the last
# line always states the numbers, including the zeros.
#
# The chain-46630 rows resolve their endpoint inside the suite (env, then the foundry.toml alias,
# then a verified public endpoint recorded in the suite itself). This script names no URL of its own.
#
#   ROBINHOOD_RPC_URL=<endpoint>  runs the upgraded-router rows
#   SEPOLIA_RPC_URL=<endpoint>    overrides the public Sepolia node (optional)
#   UNICA_FORK_BLOCK=<number>     pins the Sepolia rows to a block (needs an archive endpoint)
#
# NOTE ON `.env`: forge loads the project's `.env` before this script's own environment is consulted,
# so an `.env` naming an endpoint that answers 401 will take priority over the public default and
# every fork row will report SKIP (unreachable). That is the correct report — the rows did not run —
# but the fix is in `.env`, not here.

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

SUITES=(
  "test/compat/RouterParamsCodec.t.sol|local, no network"
  "test/compat/SepoliaRouterControl.t.sol|fork: Ethereum Sepolia (the control)"
  "test/compat/UpgradedRouterCompat.t.sol|fork: chain 46630 (the subject)"
)

run=0
passed=0
failed=0
skipped=0
failed_rows=()
skipped_rows=()

printf '\n'
printf 'UNICA router compatibility: does this router expect five fields or six?\n'
printf 'The control is built and read first; a refusal proves nothing without it.\n\n'

for entry in "${SUITES[@]}"; do
  file="${entry%%|*}"
  label="${entry##*|}"
  printf '%s  —  %s\n' "$file" "$label"

  # The row list comes from the source file, so a row added or renamed cannot go unrun by this script.
  rows=$(grep -oE 'function (test_[A-Za-z0-9_]+)\(' "$file" | sed -E 's/^function //; s/\($//')
  if [ -z "$rows" ]; then
    printf '  no rows found in %s — the runner is broken, not the code\n' "$file"
    exit 2
  fi

  for row in $rows; do
    run=$((run + 1))
    # forge matches the whole signature, so the anchor is the opening parenthesis, not end-of-string.
    out=$(forge test --match-path "$file" --match-test "^${row}\(" 2>&1)
    code=$?

    if printf '%s' "$out" | grep -q 'No tests found'; then
      printf '  ????  %s — the runner asked for a row forge could not find\n' "$row"
      exit 2
    fi

    # An endpoint that is missing or cannot be reached is not a compatibility result. It is the
    # ABSENCE of one, and it is reported as such: a stated SKIP that still makes this run exit
    # non-zero. The fork suites turn that case into a forge SKIP on purpose, so that `make gate` does
    # not fail on somebody else's downtime; this script is the runner that refuses to call it a pass.
    if printf '%s' "$out" | grep -qE '\[SKIP|could not instantiate forked environment|error sending request|HTTP error [45][0-9][0-9]'; then
      skipped=$((skipped + 1))
      skipped_rows+=("$row  (fork endpoint missing or unreachable)")
      printf '  SKIP  %s  — fork endpoint missing or unreachable\n' "$row"
    elif [ $code -eq 0 ] && printf '%s' "$out" | grep -qE '^\[PASS'; then
      passed=$((passed + 1))
      printf '  PASS  %s\n' "$row"
    else
      failed=$((failed + 1))
      failed_rows+=("$row")
      printf '  FAIL  %s\n' "$row"
      printf '%s\n' "$out" | grep -E '^\[FAIL|Error|error\[' | head -2 | sed 's/^/        /'
    fi
  done
  printf '\n'
done

if [ ${#skipped_rows[@]} -gt 0 ]; then
  printf 'SKIPPED, and stated rather than swallowed:\n'
  for row in "${skipped_rows[@]}"; do printf '  %s\n' "$row"; done
  printf '  The chain-46630 rows resolve an endpoint in this order: ROBINHOOD_RPC_URL, then the\n'
  printf "  'robinhood' alias in foundry.toml, then the verified public endpoint named in\n"
  printf '  test/compat/UpgradedRouterCompat.t.sol. A skip means every one of those was unreachable\n'
  printf '  — most often because ROBINHOOD_RPC_URL or SEPOLIA_RPC_URL is set, in the shell or in the\n'
  printf '  project .env, to an endpoint that answers 401. Check that first.\n'
  printf '  A skipped row measured nothing. It is not a pass and it is not a failure.\n'
  printf '\n'
fi

if [ ${#failed_rows[@]} -gt 0 ]; then
  printf 'FAILED:\n'
  for row in "${failed_rows[@]}"; do printf '  %s\n' "$row"; done
  printf '\n'
fi

printf 'checks run: %d, passed: %d, failed: %d, skipped: %d\n' "$run" "$passed" "$failed" "$skipped"

# A skip exits non-zero on purpose. A run that measured nothing about the chain it was written for is
# not a green run, and a caller that only reads the exit code must not be told otherwise.
if [ "$failed" -gt 0 ]; then exit 1; fi
if [ "$skipped" -gt 0 ]; then exit 3; fi
exit 0
