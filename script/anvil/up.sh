#!/usr/bin/env bash
# up.sh — start a fresh local Anvil node for the UNICA demonstration. LOCAL_ANVIL_NO_VALUE.
#
# Deterministic where Anvil lets it be: chain id 31337, Anvil's default account set (public
# fixture accounts, never used on any public network), a pinned genesis timestamp, instant
# mining, auto-impersonation so every stage signs nothing. A node already listening on the port
# is stopped first: the demo always starts from an empty chain, so a stale deployment can never
# be mistaken for this run's.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=script/anvil/lib.sh
. script/anvil/lib.sh
require_tools
mkdir -p "$REHEARSAL_DIR"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  step "stopping the previous local node (pid $(cat "$PID_FILE"))"
  kill "$(cat "$PID_FILE")" || true
  sleep 1
fi
rm -f "$PID_FILE"

step "starting anvil on 127.0.0.1:$UNICA_LOCAL_PORT (chain $UNICA_LOCAL_CHAIN_ID, genesis timestamp $UNICA_LOCAL_GENESIS_TIMESTAMP)"
anvil --version
nohup anvil \
  --host 127.0.0.1 --port "$UNICA_LOCAL_PORT" \
  --chain-id "$UNICA_LOCAL_CHAIN_ID" \
  --timestamp "$UNICA_LOCAL_GENESIS_TIMESTAMP" \
  --auto-impersonate \
  --silent \
  >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"

for _ in $(seq 1 60); do
  if cast chain-id --rpc-url "$UNICA_LOCAL_RPC" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
require_local_chain
load_accounts
log "chain id      $(cast chain-id --rpc-url "$UNICA_LOCAL_RPC")"
log "block         $(cast block-number --rpc-url "$UNICA_LOCAL_RPC")"
log "admin         $ANVIL_ADMIN   (Anvil default account 0, public fixture, no value)"
log "payer         $ANVIL_PAYER   (account 3)"
log "merchant pay  $ANVIL_MERCHANT_PAYOUT   (account 2)"
log "node log      $LOG_FILE"
log "up."
