#!/usr/bin/env bash
# down.sh — stop the local Anvil node started by up.sh. Leaves the manifest and the evidence
# records under .rehearsal/anvil/ in place for inspection; `make anvil-up` clears the chain.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=script/anvil/lib.sh
. script/anvil/lib.sh
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  kill "$(cat "$PID_FILE")"
  log "stopped anvil (pid $(cat "$PID_FILE"))"
else
  log "no local node was running"
fi
rm -f "$PID_FILE"
