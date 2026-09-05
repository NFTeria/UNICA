#!/usr/bin/env bash
# verify-hosted.sh — read-only verification of a hosted Subgraph Studio deployment of
# integrations/graph/ against the one live UNICA settlement and against the chain's
# own receipt counter. No credentials live in this file: the query URL is the first
# argument, an optional query key (only if the endpoint needs one) is the second
# argument, supplied by the owner at run time, sent only as a request header, and
# never written to disk by this script.
#
# Usage:
#   verify-hosted.sh <query-url> [query-key]
#   verify-hosted.sh --self-test
#
# --self-test runs the parsing logic against two local, canned fixtures — a control
# that must pass and a sabotaged one that must fail — and makes no network request.
# Run it before trusting a live result: a check that has never been shown to fail is
# not a check.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCHEMA="$HERE/schema.graphql"
RPC="${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}"
HOOK="0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0"
LIVE_TX="0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83"
LIVE_ORDER_ID="0x72b25a9b4e6f89138766bb0251a1fc41f8da15efb0d87f058390da1737aab8e9"  # tx hash
LIVE_AMOUNT_OUT="2003660"
LIVE_LOG_INDEX="107"
FAILED_TX="0xd4240fbde823a37ca484bbf90272e71fd6456277a7fe173ea4489acfc9cec089"
LIVE_BLOCK="11640026"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

RUN=0
FAILED=0
ok()   { echo "   PASS: $1"; RUN=$((RUN + 1)); }
bad()  { echo "   FAIL: $1"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

# ---------------------------------------------------------------------------------
# Field-name validation: every field a query below asks for must be a real field on
# Settlement in schema.graphql. Catches a query that would silently 400 or return
# null against the deployed schema, before it is ever sent.
validate_fields() {
  local label="$1"; shift
  local f
  for f in "$@"; do
    grep -qE "^[[:space:]]*${f}:" "$SCHEMA" || {
      echo "   FAIL: $label — field '$f' is not in schema.graphql"
      return 1
    }
  done
  echo "   fields for $label present in schema.graphql: $*"
  return 0
}

# ---------------------------------------------------------------------------------
# Parsers. Each takes a JSON response file (and, for checks 3-4, a comparison value)
# and prints one line plus exits 0 (the check holds) or 1 (it does not). Kept as
# separate functions, not inlined into the network calls, specifically so --self-test
# can run the exact same code against canned fixtures instead of a live response.

parse_check1() { # $1 = response json path
python3 - "$1" "$LIVE_ORDER_ID" "$LIVE_AMOUNT_OUT" "$LIVE_LOG_INDEX" <<'PY'
import json, sys
path, want_order, want_out, want_log = sys.argv[1:5]
with open(path) as f:
    d = json.load(f)
if d.get("errors"):
    print("GRAPHQL_ERROR:", d["errors"]); sys.exit(1)
rows = d.get("data", {}).get("settlements")
if rows is None:
    print("MISSING_DATA: no 'settlements' key in response"); sys.exit(1)
if len(rows) != 1:
    print(f"COUNT {len(rows)} != 1 entity for the live transaction hash"); sys.exit(1)
r = rows[0]
checks = {
    "orderId": (r.get("orderId"), want_order, True),
    "amountOut": (r.get("amountOut"), want_out, False),
    "logIndex": (r.get("logIndex"), want_log, False),
    "schemaVersion": (r.get("schemaVersion"), 1, False),
}
for name, (got, want, ci) in checks.items():
    g = got.lower() if (ci and isinstance(got, str)) else got
    w = want.lower() if (ci and isinstance(want, str)) else want
    if isinstance(w, int) and isinstance(got, str):
        try:
            g = int(got)
        except ValueError:
            pass
    if isinstance(w, str) and not ci and isinstance(got, (int, str)):
        w2 = w
        g2 = str(got)
        if g2 != w2:
            print(f"FIELD {name}: got {got!r} want {want!r}"); sys.exit(1)
        continue
    if g != w:
        print(f"FIELD {name}: got {got!r} want {want!r}"); sys.exit(1)
print(f"OK exactly one entity, id={r.get('id')}, every checked field matches the on-chain receipt")
sys.exit(0)
PY
}

parse_check2() { # $1 = response json path
python3 - "$1" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
if d.get("errors"):
    print("GRAPHQL_ERROR:", d["errors"]); sys.exit(1)
rows = d.get("data", {}).get("settlements")
if rows is None:
    print("MISSING_DATA: no 'settlements' key in response"); sys.exit(1)
if len(rows) != 0:
    print(f"COUNT {len(rows)} != 0 — the reverted attempt produced an entity"); sys.exit(1)
print("OK zero entities for the reverted (DeadlineInPast) attempt")
sys.exit(0)
PY
}

parse_check3() { # $1 = response json path, $2 = minimum block number
python3 - "$1" "$2" <<'PY'
import json, sys
path, want = sys.argv[1], int(sys.argv[2])
with open(path) as f:
    d = json.load(f)
if d.get("errors"):
    print("GRAPHQL_ERROR:", d["errors"]); sys.exit(1)
try:
    n = int(d["data"]["_meta"]["block"]["number"])
except (KeyError, TypeError, ValueError):
    print("MISSING_META: no data._meta.block.number in response"); sys.exit(1)
if n < want:
    print(f"BLOCK {n} < {want} — not yet synced past the settlement"); sys.exit(1)
print(f"OK synced to block {n} (>= {want})")
sys.exit(0)
PY
}

parse_check4() { # $1 = response json path, $2 = expected count (from the chain)
python3 - "$1" "$2" <<'PY'
import json, sys
path, want = sys.argv[1], int(sys.argv[2])
with open(path) as f:
    d = json.load(f)
if d.get("errors"):
    print("GRAPHQL_ERROR:", d["errors"]); sys.exit(1)
rows = d.get("data", {}).get("settlements")
if rows is None:
    print("MISSING_DATA: no 'settlements' key in response"); sys.exit(1)
got = len(rows)
if got == 1000:
    print("COUNT hit the page size (1000) — this script does not paginate, cannot state equality"); sys.exit(1)
if got != want:
    print(f"COUNT {got} != on-chain receiptCount {want} — hosted index and chain disagree"); sys.exit(1)
print(f"OK indexed count {got} equals the chain's receiptCount() ({want})")
sys.exit(0)
PY
}

# ---------------------------------------------------------------------------------
if [ "${1:-}" = "--self-test" ]; then
  echo "== self-test: the parser against a canned control (must pass) and a sabotaged fixture (must fail)"
  echo "   these are local files; nothing is sent over the network"
  echo

  cat > "$WORK/control.json" <<JSON
{"data":{"settlements":[{"id":"0x1120af18...cb83-107","orderId":"$LIVE_ORDER_ID","amountOut":"$LIVE_AMOUNT_OUT","logIndex":"$LIVE_LOG_INDEX","schemaVersion":1}]}}
JSON
  echo "-- control.json (a correct hosted response, hand-built to match the live receipt):"
  cat "$WORK/control.json"
  echo
  SELF_FAIL=0
  if OUT=$(parse_check1 "$WORK/control.json" 2>&1); then
    echo "   $OUT"
    ok "self-test control: parse_check1 passes on a correct response, as it must"
  else
    echo "   $OUT"
    bad "self-test control: parse_check1 wrongly rejected a correct response"
    SELF_FAIL=1
  fi
  echo

  # Sabotaged: amountOut is wrong by one unit — the one field a lazy check would
  # round away or coerce past. If this fixture passes, the checker is not checking.
  cat > "$WORK/sabotage.json" <<JSON
{"data":{"settlements":[{"id":"0x1120af18...cb83-107","orderId":"$LIVE_ORDER_ID","amountOut":"2003661","logIndex":"$LIVE_LOG_INDEX","schemaVersion":1}]}}
JSON
  echo "-- sabotage.json (amountOut off by one, everything else correct):"
  cat "$WORK/sabotage.json"
  echo
  if OUT=$(parse_check1 "$WORK/sabotage.json" 2>&1); then
    echo "   $OUT"
    bad "self-test sabotage: parse_check1 wrongly accepted a wrong amountOut"
    SELF_FAIL=1
  else
    echo "   $OUT"
    ok "self-test sabotage: parse_check1 correctly rejects a wrong amountOut"
  fi
  echo
  echo "self-test checks run: $RUN, failed: $FAILED"
  if [ "$SELF_FAIL" -ne 0 ] || [ "$FAILED" -ne 0 ]; then
    echo "SELF-TEST FAILED: the parser does not discriminate correct from incorrect — do not trust a live run until this is fixed"
    exit 1
  fi
  echo "SELF-TEST OK: the parser accepts the control and rejects the sabotage"
  exit 0
fi

# ---------------------------------------------------------------------------------
QUERY_URL="${1:-}"
QUERY_KEY="${2:-}"
if [ -z "$QUERY_URL" ]; then
  echo "usage: $0 <query-url> [query-key]   or   $0 --self-test" >&2
  exit 2
fi
[ -f "$SCHEMA" ] || { echo "FAIL: schema.graphql not found beside this script at $SCHEMA"; exit 2; }

post() { # $1 = GraphQL query string -> prints response body
  local query="$1"
  local body
  body=$(python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "$query")
  if [ -n "$QUERY_KEY" ]; then
    curl -sS -X POST "$QUERY_URL" -H 'content-type: application/json' -H "Authorization: Bearer $QUERY_KEY" -d "$body"
  else
    curl -sS -X POST "$QUERY_URL" -H 'content-type: application/json' -d "$body"
  fi
}

echo "== reading the chain's own receipt counter, for check 4"
RC_RAW=$(cast call "$HOOK" "receiptCount()(uint256)" --rpc-url "$RPC")
RECEIPT_COUNT=$(printf '%s' "$RC_RAW" | grep -oE '^[0-9]+' | head -1)
[ -n "$RECEIPT_COUNT" ] || { echo "FAIL: could not parse receiptCount() output: $RC_RAW"; exit 2; }
echo "   hook.receiptCount() over $RPC = $RECEIPT_COUNT"
echo

echo "== check 1: the live settlement (tx ${LIVE_TX:0:10}...${LIVE_TX: -6}) is exactly one entity with its receipted values"
validate_fields "check 1" id orderId amountOut logIndex schemaVersion transactionHash || bad "check 1 field validation"
Q1="{ settlements(where: { transactionHash: \"$LIVE_TX\" }) { id orderId amountOut logIndex schemaVersion } }"
post "$Q1" > "$WORK/check1.json"
if OUT=$(parse_check1 "$WORK/check1.json" 2>&1); then ok "check 1: $OUT"; else bad "check 1: $OUT"; fi
echo

echo "== check 2: the reverted attempt (tx ${FAILED_TX:0:10}...${FAILED_TX: -6}) produced no entity"
validate_fields "check 2" id transactionHash || bad "check 2 field validation"
Q2="{ settlements(where: { transactionHash: \"$FAILED_TX\" }) { id } }"
post "$Q2" > "$WORK/check2.json"
if OUT=$(parse_check2 "$WORK/check2.json" 2>&1); then ok "check 2: $OUT"; else bad "check 2: $OUT"; fi
echo

echo "== check 3: the subgraph is synced at or beyond block $LIVE_BLOCK"
Q3='{ _meta { block { number } } }'
post "$Q3" > "$WORK/check3.json"
if OUT=$(parse_check3 "$WORK/check3.json" "$LIVE_BLOCK" 2>&1); then ok "check 3: $OUT"; else bad "check 3: $OUT"; fi
echo

echo "== check 4: the hosted index's total settlement count matches the chain's receiptCount()"
validate_fields "check 4" id || bad "check 4 field validation"
Q4='{ settlements(first: 1000) { id } }'
post "$Q4" > "$WORK/check4.json"
if OUT=$(parse_check4 "$WORK/check4.json" "$RECEIPT_COUNT" 2>&1); then ok "check 4: $OUT"; else bad "check 4: $OUT"; fi
echo

echo "checks run: $RUN, passed: $((RUN - FAILED)), failed: $FAILED"
if [ "$FAILED" -ne 0 ]; then
  echo "RESULT: FAIL — the hosted subgraph does not yet match the live chain. Do not claim hosted availability."
  exit 1
fi
echo "RESULT: PASS — the hosted subgraph agrees with the chain on the live settlement, the refused attempt, sync height, and total count."
