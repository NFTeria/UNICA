# retry.sh — ONE definition of "a chain read that did not answer is not a chain read that said no".
#
# WHY THIS EXISTS. Measured 2026-09-08, three runs of docs/proof/verify-day1.sh inside one minute
# against the default public endpoint: 14/14, then 12/14, then 11/14, with DIFFERENT transactions
# failing each time. verify-live.sh over the same minutes: 28/31, 24/31, 28/31 — never once 31.
# The chain had not changed. The endpoint did not answer, `cast` printed nothing, and an empty
# answer scored identically to "the chain says no".
#
# That is this repository's own stated defect — an empty result and a broken reporter must never
# look identical — living inside the two scripts the README invites a judge to re-run. A judge who
# ran either during a bad minute saw red rows and had no way to tell why, and every one of those
# rows was about a settlement that is fine.
#
# THE FIX IS A WRAPPER, NOT A REWRITE. Defining a `cast` shell function means all thirty-one rows
# in verify-live.sh get retries without one of them being edited, so the checks themselves stay
# exactly as written and reviewed. `command cast` reaches the real binary and cannot recurse.
#
# It retries only on EMPTY OUTPUT. A `cast` that answers "0x0" or "false" has reached the chain and
# is telling you something true; retrying that would be how a scan learns to lie in the other
# direction.
CHAIN_READ_ATTEMPTS="${CHAIN_READ_ATTEMPTS:-5}"
chain_read_retries=0

cast() {
  local out="" rc=0 i=1
  while [ "$i" -le "$CHAIN_READ_ATTEMPTS" ]; do
    out=$(command cast "$@" 2>/dev/null); rc=$?
    if [ $rc -eq 0 ] && [ -n "$out" ]; then
      [ "$i" -gt 1 ] && chain_read_retries=$((chain_read_retries + i - 1))
      printf '%s\n' "$out"; return 0
    fi
    i=$((i + 1))
    [ "$i" -le "$CHAIN_READ_ATTEMPTS" ] && sleep 1
  done
  chain_read_retries=$((chain_read_retries + CHAIN_READ_ATTEMPTS))
  printf '%s\n' "$out"
  return $rc
}

# Print after the count so a reader can tell a clean run from one that fought the endpoint for it.
report_retries() {
  [ "${chain_read_retries:-0}" -gt 0 ] && \
    echo "note: $chain_read_retries chain read(s) needed a retry — the endpoint was flaky, the chain was not"
  return 0
}
