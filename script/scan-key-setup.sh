#!/usr/bin/env bash
# scan-key-setup.sh — set a block-explorer API key, once, interactively. Nothing is echoed.
#
# WHY THIS EXISTS. An explorer key is a credential and this repository is public. The same rule the
# RPC endpoints already follow applies here: the value goes in .env (gitignored, chmod 600), and
# everything else refers to it by VARIABLE NAME. A key must never appear in a command line, a
# Makefile, a script, a commit, or a shell transcript — a command line is visible to `ps` and lands
# in ~/.zsh_history, which is why this prompts instead of taking an argument.
#
#   bash script/scan-key-setup.sh                       # every key below, in turn
#   bash script/scan-key-setup.sh ROBINHOOD_SCAN_API_KEY  # just one
#   bash script/scan-key-setup.sh --check               # report which are set, WITHOUT printing any
#
# WHAT IT NEVER DOES. It never prints a value, never sends one anywhere, and never writes one
# outside .env. `--check` reports set/unset and a length, which is enough to tell a typo from a
# paste failure and not enough to reconstruct anything.
set -uo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=".env"

# variable | what it is for | whether reads work without it
KEYS="
ROBINHOOD_SCAN_API_KEY|Robinhood testnet explorer (explorer.testnet.chain.robinhood.com)|yes — read-only API calls answered keyless on 2026-09-10; a key is for rate limits
ETHERSCAN_API_KEY|Etherscan V2, source verification and the opt-in proof rows|no — the verification rows are skipped without it
"

MODE="set"; ONLY=""
case "${1:-}" in
  --check) MODE="check" ;;
  "")      : ;;
  --*)     echo "unknown option: $1"; exit 2 ;;
  *)       ONLY="$1" ;;
esac

# Fails closed. If .env is not ignored, writing a key into it would stage a credential for commit,
# and that is not recoverable in a public repository once pushed.
git check-ignore -q "$ENV_FILE" || {
  echo "REFUSING: $ENV_FILE is not gitignored. Fix .gitignore before putting a key anywhere near it."
  exit 1
}
[ -f "$ENV_FILE" ] || { touch "$ENV_FILE"; echo "created $ENV_FILE"; }
chmod 600 "$ENV_FILE"

current() { grep -m1 "^${1}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- ; }

set_var() {
  local var="$1" val="$2" tmp
  tmp=$(mktemp)
  chmod 600 "$tmp"
  grep -v "^${var}=" "$ENV_FILE" > "$tmp" 2>/dev/null || true
  printf '%s=%s\n' "$var" "$val" >> "$tmp"
  mv "$tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"
}

if [ "$MODE" = "check" ]; then
  echo "Explorer keys in $ENV_FILE — set or unset only, never the value."
  n=0
  printf '%s\n' "$KEYS" | while IFS='|' read -r var what keyless; do
    [ -z "${var:-}" ] && continue
    val=$(current "$var")
    if [ -n "$val" ]; then printf '  %-24s SET   (%d characters)\n' "$var" "${#val}"
    else                   printf '  %-24s unset\n' "$var"; fi
  done
  echo
  echo "Reads that do not need a key stay keyless; see the notes in \`make scan-key\`."
  exit 0
fi

echo "Explorer API keys for UNICA."
echo "Nothing you type is echoed. Press Enter alone to keep the current value; type '-' to clear it."
echo "Never paste a key into a chat, an issue, a commit, or a command line — only into this prompt."
echo

changed=0
while IFS='|' read -r var what keyless; do
  [ -z "${var:-}" ] && continue
  [ -n "$ONLY" ] && [ "$ONLY" != "$var" ] && continue

  existing=$(current "$var")
  if [ -n "$existing" ]; then state="currently set, ${#existing} characters"; else state="currently unset"; fi
  echo "$var"
  echo "  for:      $what"
  echo "  keyless?  $keyless"
  echo "  status:   $state"
  printf '  value:    '
  # -s so it is not echoed; -r so a backslash in a key is not eaten.
  IFS= read -rs value || { echo; echo "no terminal on stdin — run this in an interactive shell"; exit 1; }
  echo

  if [ -z "$value" ]; then
    echo "  kept."
  elif [ "$value" = "-" ]; then
    set_var "$var" ""
    echo "  cleared."
    changed=$((changed + 1))
  else
    set_var "$var" "$value"
    echo "  stored in $ENV_FILE (${#value} characters, chmod 600). The value is not printed anywhere."
    changed=$((changed + 1))
  fi
  echo
done <<EOF
$KEYS
EOF

echo "$changed value(s) changed."
echo
echo "Verify the file never reaches a commit:"
echo "  git check-ignore -v $ENV_FILE   # must print a .gitignore rule"
echo "  bash script/scan.sh             # the secret scan; expect 37 of 37"
