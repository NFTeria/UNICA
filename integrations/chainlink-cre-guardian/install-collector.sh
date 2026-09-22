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
# Resolve both binaries BEFORE deriving anything from them, and accept only an absolute path to an
# executable file. `command -v` prints nothing for a missing binary, and `dirname ""` prints "." --
# so the old one-liner, dirname "$(command -v cre)", never came back empty, the guard could never
# fire, and a machine without `cre` got a loaded launchd job with a relative "." on its PATH. A
# non-empty answer is not enough either: for a shell function `command -v` prints the bare name,
# with "." or an empty entry on PATH some shells print a relative path, and dash reports a file
# that is not executable -- each of those also lands a relative or dead entry in the job.
# `|| true` keeps `set -e` from ending the run early, so the guard reports it, not a shell error.
NODE_BIN="$(command -v node || true)"
# Not CRE_*: script/check-cre-confidentiality.sh treats every UNICA_* and CRE_* name in this tree
# as a secret name and refuses any populated assignment to one, whatever the value is.
CLI_BIN="$(command -v cre || true)"
usable() { case "$1" in /*) [ -f "$1" ] && [ -x "$1" ] ;; *) return 1 ;; esac; }
if ! usable "$NODE_BIN" || ! usable "$CLI_BIN"; then
  echo "could not resolve node/cre to an absolute executable path — aborting without touching anything" >&2
  exit 1
fi

LABEL="$(node -e "import('$SCRIPT_DIR/cre-lib.mjs').then(l => console.log(l.LAUNCHD_LABEL))")" || LABEL=""
if [ -z "$LABEL" ]; then
  echo "could not resolve the launchd label — aborting without touching anything" >&2
  exit 1
fi
CLI_DIR="$(dirname "$CLI_BIN")"
NODE_DIR="$(dirname "$NODE_BIN")"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"

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
    <string>${NODE_DIR}:${CLI_DIR}:/usr/bin:/bin:/usr/sbin:/sbin</string>
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
