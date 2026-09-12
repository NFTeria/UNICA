#!/usr/bin/env bash
# lib.sh — shared helpers for the LOCAL_ANVIL_NO_VALUE command surface (`make anvil-*`).
#
# Everything here talks to one loopback Anvil node and nothing else. Accounts are Anvil's default
# unlocked accounts, read from the node with eth_accounts and impersonated; no key, mnemonic or
# credential appears in this file, in the Makefile, or in any log these scripts write.
#
# Sourced, never executed. Every script that sources it runs under `set -euo pipefail`, so the
# first unexpected error stops the stage: a demo that continued past a failed step would print a
# success block over a broken chain.

export PATH="$HOME/.foundry/bin:$PATH"

UNICA_LOCAL_RPC="${UNICA_LOCAL_RPC:-http://127.0.0.1:8545}"
UNICA_LOCAL_CHAIN_ID=31337
UNICA_LOCAL_PORT="${UNICA_LOCAL_PORT:-8545}"
# Genesis timestamp pinned so a fresh chain starts from one known instant (2026-09-11 00:00 UTC).
UNICA_LOCAL_GENESIS_TIMESTAMP="${UNICA_LOCAL_GENESIS_TIMESTAMP:-1789084800}"
REHEARSAL_DIR="${REHEARSAL_DIR:-.rehearsal/anvil}"
MANIFEST_PATH="${MANIFEST_PATH:-deployments/31337.local.json}"
PID_FILE="$REHEARSAL_DIR/anvil.pid"
LOG_FILE="$REHEARSAL_DIR/anvil.log"

log()  { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
die()  { printf 'STOP: %s\n' "$*" >&2; exit 1; }

require_tools() {
  for t in anvil cast forge node vyper; do
    command -v "$t" >/dev/null 2>&1 || die "$t is not installed (it is required for the local demo)"
  done
}

# The node must be the local one: the chain id it reports decides, never the URL.
require_local_chain() {
  local id
  id=$(cast chain-id --rpc-url "$UNICA_LOCAL_RPC" 2>/dev/null || true)
  test -n "$id" || die "no node answers at $UNICA_LOCAL_RPC; run: make anvil-up"
  test "$id" = "$UNICA_LOCAL_CHAIN_ID" || die "the node at $UNICA_LOCAL_RPC reports chain id $id, not $UNICA_LOCAL_CHAIN_ID; refusing"
  case "$UNICA_LOCAL_RPC" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) die "UNICA_LOCAL_RPC must be a loopback URL; got a non-local endpoint" ;;
  esac
}

# Roles are indices into Anvil's default accounts. Read from the node, so nothing is hard-coded.
load_accounts() {
  local accounts
  accounts=$(cast rpc eth_accounts --rpc-url "$UNICA_LOCAL_RPC")
  local i=0 addr
  while read -r addr; do
    case $i in
      0) ANVIL_ADMIN=$addr ;;
      1) ANVIL_MERCHANT_OWNER=$addr ;;
      2) ANVIL_MERCHANT_PAYOUT=$addr ;;
      3) ANVIL_PAYER=$addr ;;
      4) ANVIL_WRONG_PAYER=$addr ;;
      5) ANVIL_OP_CHAIR1=$addr ;;
      6) ANVIL_OP_LOST_TABLET=$addr ;;
      7) ANVIL_SEEDER=$addr ;;
      8) ANVIL_ATTACKER=$addr ;;
      9) ANVIL_WORKFLOW_OWNER=$addr ;;
    esac
    i=$((i + 1))
  done < <(node -e 'for (const a of JSON.parse(process.argv[1])) console.log(a)' "$accounts")
  test "$i" -ge 10 || die "the node exposes $i unlocked accounts; the demo needs 10"
  export ANVIL_ADMIN ANVIL_MERCHANT_OWNER ANVIL_MERCHANT_PAYOUT ANVIL_PAYER ANVIL_WRONG_PAYER \
    ANVIL_OP_CHAIR1 ANVIL_OP_LOST_TABLET ANVIL_SEEDER ANVIL_ATTACKER ANVIL_WORKFLOW_OWNER
}

# Export the manifest's addresses as the UNICA_* variables the forge script reads.
load_manifest_env() {
  test -f "$MANIFEST_PATH" || die "no manifest at $MANIFEST_PATH; run: make anvil-deploy"
  eval "$(node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const c = m.contracts, out = [];
    const put = (k, v) => out.push(`export ${k}=${v}`);
    put("UNICA_POOL_MANAGER", c.poolManager.address);
    put("UNICA_ASSET", c.assetToken.address);
    put("UNICA_PAYOUT", c.payoutToken.address);
    put("UNICA_ASSET_USD_FEED", c.assetUsdFeed.address);
    put("UNICA_PAYOUT_USD_FEED", c.payoutUsdFeed.address);
    put("UNICA_ORACLE_ADAPTER", c.oracleAdapter.address);
    put("UNICA_FACTORY", c.factory.address);
    put("UNICA_REGISTRY", c.registry.address);
    put("UNICA_HOOK", c.hook.address);
    put("UNICA_EXECUTOR", c.executor.address);
    put("UNICA_IDENTITY", c.identityFixture.address);
    put("UNICA_ONBOARDING", c.merchantOnboarding.address);
    put("UNICA_IDENTITY_TOKEN", c.identityToken.address);
    put("UNICA_FORWARDER", c.forwarderFixture.address);
    put("UNICA_POLICY_RECEIVER", c.policyReceiver.address);
    put("UNICA_ADMISSION", c.terminalAdmission.address);
    put("UNICA_DIRECT_SETTLEMENT", c.directSettlement.address);
    put("UNICA_DIRECT_ADMISSION", c.directAdmission.address);
    put("UNICA_LOOKALIKE_FACTORY", c.lookalikeFactory.address);
    put("UNICA_LOOKALIKE_HOOK", c.lookalikeHook.address);
    put("UNICA_LOOKALIKE_EXECUTOR", c.lookalikeExecutor.address);
    put("UNICA_MARKET_ID", m.market.marketId);
    put("UNICA_POOL_ID", m.market.poolId);
    put("UNICA_FEED_ID", m.market.feedId);
    put("UNICA_ENS_DEPLOYMENT_ID", m.identity.ensDeploymentId);
    put("UNICA_PARENT_NODE", m.identity.parentNode);
    put("UNICA_MERCHANT_NODE", m.identity.merchantNode);
    put("UNICA_TERMINALS_NODE", m.identity.terminalsNode);
    put("UNICA_CHAIR1_NODE", m.identity.terminals[0].node);
    put("UNICA_LOST_TABLET_NODE", m.identity.terminals[1].node);
    console.log(out.join("\n"));
  ' "$MANIFEST_PATH")"
}

# Run one `AnvilLocal.s.sol` stage and return the record it printed, as one JSON object.
# $1 the stage's function name and log suffix · $2 the sender to impersonate · $3 the line prefix
# the stage tags its fields with. The stage's own output goes to a file: on failure it is printed
# whole and the caller dies, so a half-run stage can never be read as a record.
run_stage() {
  local log="$REHEARSAL_DIR/stage-$1.log"
  forge script script/anvil/AnvilLocal.s.sol:AnvilLocal --sig "$1()" --rpc-url "$UNICA_LOCAL_RPC" \
    --unlocked --sender "$2" --broadcast -vv >"$log" 2>&1 || { cat "$log"; die "stage $1 failed"; }
  printf '{%s}' "$(grep -o "$3:.*" "$log" | sed "s/^$3://" | tr -d '\n' | sed 's/,$//')"
}

# `cast call` that MUST revert with the named custom error. Prints a structured refusal line.
# $1 case name · $2 error signature · rest: the cast call arguments (target, sig, args, --from).
expect_revert() {
  local name=$1 sig=$2; shift 2
  local sel out
  sel=$(cast sig "$sig")
  if out=$(cast call --rpc-url "$UNICA_LOCAL_RPC" "$@" 2>&1); then
    die "$name: expected revert $sig, but the call SUCCEEDED: $out"
  fi
  local errname=${sig%%(*}
  if printf '%s' "$out" | grep -qiE "${sel#0x}|$errname"; then
    printf '{"case":"%s","decision":"REFUSED","reasonCodes":["%s"],"layer":"%s"}\n' "$name" "$errname" "${LAYER:-UNICA_ONCHAIN}"
  else
    die "$name: reverted, but not with $sig. Output: $out"
  fi
}

# cast send from an unlocked Anvil account; prints the receipt JSON.
send_as() { # $1 from, rest cast send args
  local from=$1; shift
  cast send --rpc-url "$UNICA_LOCAL_RPC" --from "$from" --unlocked --json "$@"
}

call() { cast call --rpc-url "$UNICA_LOCAL_RPC" "$@"; }
# cast annotates large integers ("1987612 [1.987e6]"); a number read for arithmetic keeps the first field only.
call_uint() { cast call --rpc-url "$UNICA_LOCAL_RPC" "$@" | awk '{print $1}'; }

json_get() { # $1 json string, $2 js path expression e.g. .status
  node -e 'const o=JSON.parse(process.argv[1]); const f=new Function("o","return o"+process.argv[2]); const v=f(o); console.log(typeof v==="object"?JSON.stringify(v):String(v))' "$1" "$2"
}
