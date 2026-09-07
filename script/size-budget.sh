#!/usr/bin/env bash
# The V2 contracts' size budget, stated every run rather than only when it breaks.
#
# EIP-170 caps runtime code at 24,576 bytes and EIP-3860 caps init code at 49,152. Forge fails the
# build at the hard limit, which is too late to be useful: by then the change is written. The owner's
# threshold is 90%, and crossing it is a WARNING rather than a failure — deliberately, because the
# decision at that point is a design one and a build error is not the right way to have it.
#
# What IS fatal is a missing measurement. A budget report that silently found nothing looks exactly
# like a budget report where everything is fine, and this repository does not accept a blank pass.
set -uo pipefail
cd "$(dirname "$0")/.."

RUNTIME_LIMIT=24576   # EIP-170
INITCODE_LIMIT=49152  # EIP-3860
WARN_PCT=90

sizes=$(forge build --sizes 2>/dev/null)
ok=0; fail=0; warn=0

check () {
  name="$1"
  row=$(printf '%s' "$sizes" | grep -E "^\| $name " | head -1)
  if [ -z "$row" ]; then
    echo "FAIL  $name: no size row found — the reporter, not the contract, is broken"
    fail=$((fail+1)); return
  fi
  rt=$(printf '%s' "$row" | awk -F'|' '{gsub(/[ ,]/,"",$3); print $3}')
  ic=$(printf '%s' "$row" | awk -F'|' '{gsub(/[ ,]/,"",$4); print $4}')
  if ! [ "$rt" -gt 0 ] 2>/dev/null || ! [ "$ic" -gt 0 ] 2>/dev/null; then
    echo "FAIL  $name: size row did not parse as numbers"
    fail=$((fail+1)); return
  fi
  rtp=$(( rt * 100 / RUNTIME_LIMIT ))
  icp=$(( ic * 100 / INITCODE_LIMIT ))
  printf 'SIZE  %-24s runtime %6s / %s = %2s%%   initcode %6s / %s = %2s%%\n' \
    "$name" "$rt" "$RUNTIME_LIMIT" "$rtp" "$ic" "$INITCODE_LIMIT" "$icp"
  ok=$((ok+1))
  if [ "$rtp" -ge "$WARN_PCT" ]; then
    echo "WARN  $name runtime is at ${rtp}% of EIP-170 — stop and decide before adding more"
    warn=$((warn+1))
  fi
  if [ "$icp" -ge "$WARN_PCT" ]; then
    echo "WARN  $name initcode is at ${icp}% of EIP-3860 — stop and decide before adding more"
    warn=$((warn+1))
  fi
}

check QuoteSettlementHook
check QuoteSettlementExecutor

echo "contracts measured: $((ok+fail)), reported: $ok, unmeasurable: $fail, over ${WARN_PCT}%: $warn"
[ "$fail" -eq 0 ]
