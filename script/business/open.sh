#!/usr/bin/env bash
# open.sh: serve the business and customer screens against the running practice chain, in the
# background, and print the addresses to open. `make business-down` closes them again.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=script/business/lib.sh
. script/business/lib.sh
require_local_chain
test -f "$MANIFEST_PATH" || die "the payment product is not installed yet; run: make business-up"
banner
if [ ! -d apps/web/out ]; then
  quietly "Building the screens" web-build node apps/web/build.mjs
fi
PORT="${UNICA_SERVE_PORT:-8787}"
if [ -f "$BUSINESS_SERVER_PID_FILE" ] && kill -0 "$(cat "$BUSINESS_SERVER_PID_FILE")" 2>/dev/null; then
  kill "$(cat "$BUSINESS_SERVER_PID_FILE")" || true
  sleep 1
fi
rm -f "$BUSINESS_SERVER_PID_FILE"
# Something else may already be serving these screens: another window, or another person on this
# machine. Starting a second one would fail on the port and, worse, killing the first would take
# down a window that is not ours. Reuse it and say so.
if curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
  log "  The screens were already running on port $PORT and were not started again."
  log "  This command did not start them, so make business-down will not stop them."
else
  SERVE_LOG="$REHEARSAL_DIR/business-serve.log"
  nohup bash script/anvil/serve.sh >"$SERVE_LOG" 2>&1 &
  echo $! >"$BUSINESS_SERVER_PID_FILE"
  for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then break; fi
    sleep 0.25
  done
  kill -0 "$(cat "$BUSINESS_SERVER_PID_FILE")" 2>/dev/null || { cat "$SERVE_LOG"; die "the screens did not start; the full output is in $SERVE_LOG"; }
  curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1 \
    || { cat "$SERVE_LOG"; die "the screens started but did not answer on port $PORT"; }
fi
heading "Open these"
log "  Your business:     http://127.0.0.1:$PORT/business/"
log "  Take a payment:    http://127.0.0.1:$PORT/business/payments/new/"
log "  Customer payment:  http://127.0.0.1:$PORT/pay/"
log "  Add a business:    http://127.0.0.1:$PORT/join/"
RECORD="$REHEARSAL_DIR/demo-record.json"
# Only offer the last demonstration's sale when that record is newer than the installation it was
# made against. `make business-up` empties the chain, and a link to a sale that no longer exists is
# worse than no link at all.
if [ -f "$RECORD" ] && [ "$RECORD" -nt "$MANIFEST_PATH" ]; then
  ORDER=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).order.id)' "$RECORD")
  log "  The sale from the last demonstration: http://127.0.0.1:$PORT/pay/?order=$ORDER"
fi
log ""
log "  Close them again with: make business-down"
