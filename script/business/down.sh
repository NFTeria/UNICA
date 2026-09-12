#!/usr/bin/env bash
# down.sh: stop everything this machine started for the demonstration: the web screens and the
# practice chain. Safe to run twice; safe to run when nothing is up.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=script/business/lib.sh
. script/business/lib.sh
heading "Stopping"
if [ -f "$BUSINESS_SERVER_PID_FILE" ] && kill -0 "$(cat "$BUSINESS_SERVER_PID_FILE")" 2>/dev/null; then
  kill "$(cat "$BUSINESS_SERVER_PID_FILE")" || true
  log "  the screens are closed"
else
  log "  the screens were not running"
fi
rm -f "$BUSINESS_SERVER_PID_FILE"
# A server this command did not start is not this command's to stop. Say it is still there rather
# than leaving the owner to wonder why the screens still answer.
if curl -fsS "http://127.0.0.1:${UNICA_SERVE_PORT:-8787}/" >/dev/null 2>&1; then
  log "  something is still serving the screens on port ${UNICA_SERVE_PORT:-8787}; this command did not start it and has not stopped it"
fi
bash script/anvil/down.sh
log "  everything this demonstration started is stopped."
