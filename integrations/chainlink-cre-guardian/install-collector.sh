#!/bin/sh
# install-collector.sh — register the hourly CRE execution collector with launchd.
#
# Generates the plist at install time rather than committing one to the repo, because the plist
# needs this machine's real absolute paths (this checkout's location, and wherever `cre` and
# `node` actually live) — a hardcoded path in a public repo would be wrong on every other machine
# and would leak this owner's local username for no benefit. The realized plist lives only in
# ~/Library/LaunchAgents/, never in git.
#
# Safe to re-run: it unloads any existing copy of this job before loading the new one, so editing
# this script and re-running it is how you change the schedule or paths later.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="$(node -e "import('$SCRIPT_DIR/cre-lib.mjs').then(l => console.log(l.LAUNCHD_LABEL))")"
NODE_BIN="$(command -v node)"
CRE_DIR="$(dirname "$(command -v cre)")"
NODE_DIR="$(dirname "$NODE_BIN")"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"

if [ -z "$LABEL" ] || [ -z "$NODE_BIN" ] || [ -z "$CRE_DIR" ]; then
  echo "could not resolve label/node/cre — aborting without touching anything" >&2
  exit 1
fi

mkdir -p "$SCRIPT_DIR/local/logs"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${SCRIPT_DIR}/execution-viewer.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${SCRIPT_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${NODE_DIR}:${CRE_DIR}:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartInterval</key>
  <integer>3600</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${SCRIPT_DIR}/local/logs/collector.out.log</string>
  <key>StandardErrorPath</key>
  <string>${SCRIPT_DIR}/local/logs/collector.err.log</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
PLIST

UID_NUM="$(id -u)"
# Idempotent: bootout an existing copy first (harmless if none is loaded), then bootstrap fresh.
launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/${UID_NUM}" "$PLIST_PATH"

echo "installed and loaded: ${LABEL}"
echo "plist:  ${PLIST_PATH}"
echo "runs:   every hour, and once now (RunAtLoad), and again after reboot/login"
echo "status: node $SCRIPT_DIR/status.mjs"
echo "logs:   $SCRIPT_DIR/local/logs/collector.out.log"
echo "        $SCRIPT_DIR/local/logs/collector.err.log"
