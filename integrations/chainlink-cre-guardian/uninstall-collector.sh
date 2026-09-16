#!/bin/sh
# uninstall-collector.sh — stop and remove the hourly CRE execution collector's launchd job.
#
# Does not touch local/execution-history.jsonl or anything else this system has collected — only
# the scheduling registration and its generated plist. Safe to run even if the job was never
# installed (bootout on a missing job is a no-op here, not an error).
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="$(node -e "import('$SCRIPT_DIR/cre-lib.mjs').then(l => console.log(l.LAUNCHD_LABEL))")"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"

launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
rm -f "$PLIST_PATH"

echo "uninstalled: ${LABEL}"
echo "removed:     ${PLIST_PATH}"
echo "collected data left untouched: $SCRIPT_DIR/local/"
