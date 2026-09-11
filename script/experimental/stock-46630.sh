#!/usr/bin/env bash
# stock-46630.sh — ONE stage of the stock-settlement experiment on Robinhood testnet, owner-run.
#
# The stages, in the only order they work (each prints the address the next one needs):
#
#   STAGE=token                                                   1 tx   the testnet payout token
#   STAGE=pair   TOKEN=0x..                                       2 tx   hook (mined CREATE2) + executor
#   STAGE=pool   TOKEN=0x.. HOOK=0x.. RATE=<uTUSD per TSLA> SEED=<whole uTUSD>      5 tx (4 resuming)
#   STAGE=settle TOKEN=0x.. HOOK=0x.. EXECUTOR=0x.. MERCHANT=0x.. AMOUNT_IN=<raw TSLA> SALT=0x<32 bytes>  3 tx
#   STAGE=verify TOKEN=0x.. HOOK=0x.. EXECUTOR=0x..               read-only, sends nothing, ever
#
# THREE MODES, decided before anything touches a network, and exactly one of them can send:
#
#   DRY_RUN=1            simulate against the live chain and print the plan. Sends nothing.
#   REHEARSE=1           a LOCAL ANVIL FORK only. ENDPOINT must be a loopback URL and the node must
#                        identify itself as anvil, or this stops before anything else runs. The
#                        sender is impersonated with --unlocked; nothing is signed; run records go
#                        under .rehearsal/, never the committed broadcast/.
#   LIVE_BROADCAST=I_UNDERSTAND_THIS_SENDS_TRANSACTIONS
#                        the only mode that sends. Also needs DEPLOYER_ACCOUNT (a keystore name) and
#                        a terminal: after the simulation it prints the whole plan, then asks you to
#                        type SEND. Anything else, or no terminal, stops with nothing sent. The
#                        keystore password is asked for after that, by forge.
#
# With none of the three set, this refuses. There is no default that sends.
#
# ENDPOINT is a foundry.toml alias and defaults to robinhood_testnet — the keyed primary endpoint,
# because forge cannot fetch account state through the keyless explorer alias ("Query parameter
# 'block' is invalid", measured 2026-09-10). A URL given as ENDPOINT is only ever printed as its host.
#
# ONCE SENT, A TRANSACTION CANNOT BE UNDONE. Nothing in this repository can roll back a broadcast.
# See docs/experimental/STOCK-46630-DEPLOY-PLAN.md for the plan and what can and cannot be recovered.
set -euo pipefail
cd "$(dirname "$0")/../.."
fail() { echo "STOP: $1"; exit 1; }
# scheme://host for a URL, the string itself for an alias. Never a path, where a key would live.
shown() { case "$1" in http://*|https://*) printf '%s' "$1" | cut -d/ -f1-3 ;; *) printf '%s' "$1" ;; esac; }

STAGE="${STAGE:-}"
# ENDPOINT, never CHAIN: foundry reads an environment variable called CHAIN as its --chain option,
# so a CHAIN exported for this script made every `cast call` below reject a URL as a chain name
# (measured 2026-09-10, in this script's own rehearsal). Any CHAIN left in the caller's shell is
# unset for the same reason: it would silently become forge's and cast's --chain.
ENDPOINT="${ENDPOINT:-robinhood_testnet}"
unset CHAIN
DEPLOYER="${DEPLOYER:-}"
OPT_IN="I_UNDERSTAND_THIS_SENDS_TRANSACTIONS"
test -n "$STAGE" || fail "STAGE is not set: token | pair | pool | settle | verify"
test -n "$DEPLOYER" || fail "DEPLOYER (the public address that will sign) is not set"

# ---- the mode, fixed first ---------------------------------------------------------------------
if [ "$STAGE" = "verify" ] || [ "${DRY_RUN:-}" = "1" ]; then
  MODE=dry
elif [ "${REHEARSE:-}" = "1" ]; then
  MODE=rehearse
elif [ "${LIVE_BROADCAST:-}" = "$OPT_IN" ]; then
  MODE=live
elif [ -n "${LIVE_BROADCAST:-}" ]; then
  fail "LIVE_BROADCAST must be exactly $OPT_IN; nothing was run"
else
  fail "no mode: set DRY_RUN=1 to simulate, REHEARSE=1 for a local fork, or LIVE_BROADCAST=$OPT_IN to send"
fi
if [ "${REHEARSE:-}" = "1" ] && [ "${LIVE_BROADCAST:-}" = "$OPT_IN" ]; then
  fail "REHEARSE=1 and LIVE_BROADCAST together are contradictory; nothing was run"
fi

# A rehearsal refuses anything that is not a loopback anvil, BEFORE a single call leaves this host.
# "It would have failed harmlessly against a hosted node" is luck, not a guard.
if [ "$MODE" = "rehearse" ]; then
  case "$ENDPOINT" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) fail "REHEARSE=1 needs a loopback anvil URL as ENDPOINT; got '$(shown "$ENDPOINT")'. Nothing was run." ;;
  esac
  client=$(cast rpc web3_clientVersion --rpc-url "$ENDPOINT" 2>/dev/null | tr -d '"' || true)
  case "$client" in
    anvil*) ;;
    *) fail "REHEARSE=1: the node at $(shown "$ENDPOINT") is '${client:-unreachable}', not anvil. Nothing was run." ;;
  esac
fi
if [ "$MODE" = "live" ]; then
  test -n "${DEPLOYER_ACCOUNT:-}" || fail "LIVE_BROADCAST needs DEPLOYER_ACCOUNT (the keystore name). Nothing was run."
  { : < /dev/tty; } 2>/dev/null || fail "LIVE_BROADCAST needs a terminal to confirm in. Nothing was run."
fi

# ---- guard: the chain id the endpoint actually reports. A mainnet is refused by the one list in
# script/mainnet-guard.sh; anything that is not 46630 is refused here, because this script's
# addresses are 46630's and nothing else's.
# shellcheck source=script/mainnet-guard.sh
. script/mainnet-guard.sh
chain=$(cast chain-id --rpc-url "$ENDPOINT" 2>/dev/null || true)
refuse_mainnet_id "$chain" || fail "script/mainnet-guard.sh refused chain id '$chain'"
test "$chain" = "46630" || fail "the endpoint reports chain '$chain', and this script is for 46630 only"

# ---- the block the simulation runs at, NAMED. On an Arbitrum-type chain forge otherwise pins its
# fork to the L1 block number the EVM reports; see script/v3/deploy-v3.sh for the measurement.
head=$(cast block-number --rpc-url "$ENDPOINT" 2>/dev/null || true)
test -n "$head" || fail "the endpoint answered a chain id but not a block number"
echo "== stage '$STAGE', mode $MODE, chain $chain via $(shown "$ENDPOINT"), block $head, as $DEPLOYER"

need() { test -n "${!1:-}" || fail "$1 is not set for STAGE=$STAGE"; }
case "$STAGE" in
  token)  SIG='token()'; ARGS=() ;;
  pair)   need TOKEN; SIG='pair(address)'; ARGS=("$TOKEN") ;;
  pool)   need TOKEN; need HOOK; need RATE; need SEED
          SIG='pool(address,address,uint256,uint256)'; ARGS=("$TOKEN" "$HOOK" "$RATE" "$SEED") ;;
  settle) need TOKEN; need HOOK; need EXECUTOR; need MERCHANT; need AMOUNT_IN; need SALT
          SIG='settle(address,address,address,address,uint128,bytes32)'
          ARGS=("$TOKEN" "$HOOK" "$EXECUTOR" "$MERCHANT" "$AMOUNT_IN" "$SALT") ;;
  verify) need TOKEN; need HOOK; need EXECUTOR
          SIG='verify(address,address,address)'; ARGS=("$TOKEN" "$HOOK" "$EXECUTOR") ;;
  *)      fail "unknown STAGE '$STAGE'" ;;
esac
TARGET=script/experimental/StockSettlement46630.s.sol:StockSettlement46630
# ${ARGS[@]+"${ARGS[@]}"} below, not "${ARGS[@]}": macOS's /bin/bash is 3.2, where an EMPTY array under
# `set -u` is an unbound variable. The token stage takes no arguments, and the plain form stopped it
# dead in the first rehearsal. This form expands to nothing when empty, in every bash.

# ---- the simulation: the Solidity opens with rows that must all pass and reverts if one fails, and
# `set -e` stops here. No --broadcast, so this signs nothing whatever the mode.
LOGDIR=.rehearsal/stock-46630; mkdir -p "$LOGDIR"
SIM="$LOGDIR/$STAGE-simulation.log"
# forge splits every run record in two: the public half under broadcast/ (here, $LOGDIR) and a
# "sensitive" half under cache/<script>/<chain>/ that holds the ENDPOINT URL — with its key, when
# the alias is the keyed primary. Measured 2026-09-10: a dry run of this script against the live
# alias left the full keyed URL in cache/StockSettlement46630.s.sol/46630/dry-run/. cache/ is
# gitignored, so it never reaches a commit, but a key should not sit on disk because a simulation
# ran. So the DRY-RUN half is removed on every exit. A LIVE run's sensitive record is kept on
# purpose: `forge script --resume` needs it to finish a broadcast that stopped part-way.
ENDPOINT_RECORDS="cache/StockSettlement46630.s.sol"
scrub() { find "$ENDPOINT_RECORDS" -type d -name dry-run -prune -exec rm -rf {} + 2>/dev/null || true; }
trap scrub EXIT
# `|| fail` rather than a PIPESTATUS test on the next line: under `set -e` with pipefail, a failed
# pipeline exits the script at once, so a status check after it never runs and the owner would
# get forge's last line instead of the sentence that says nothing was sent.
FOUNDRY_BROADCAST=$LOGDIR forge script "$TARGET" --sig "$SIG" ${ARGS[@]+"${ARGS[@]}"} \
  --rpc-url "$ENDPOINT" --fork-block-number "$head" --sender "$DEPLOYER" -vv 2>&1 | tee "$SIM" \
  || fail "the simulation failed; nothing was broadcast"
if [ "$STAGE" = "verify" ]; then echo "verify is read-only: nothing to broadcast"; exit 0; fi

# ---- the plan, printed in full before anything can be confirmed --------------------------------
SIG_BAL='balanceOf(address)(uint256)'
wei=$(cast balance "$DEPLOYER" --rpc-url "$ENDPOINT")
est=$(grep -m1 'Estimated amount required:' "$SIM" | awk '{print $4}')
test -n "$est" || fail "forge printed no spend estimate for this stage; refusing to go on without one"
est_wei=$(cast to-wei "$est" ether)
ceiling_wei=$(python3 -c "print(2 * int('$est_wei'))")
echo
echo "================================ THE PLAN ================================"
echo "stage              $STAGE      mode $MODE"
echo "chain id           $chain      endpoint $(shown "$ENDPOINT")      block $head"
echo "deployer           $DEPLOYER"
echo "deployer nonce     $(cast nonce "$DEPLOYER" --rpc-url "$ENDPOINT")"
echo "native balance     $(cast from-wei "$wei") ETH"
echo "TSLA balance (raw) $(cast call 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E "$SIG_BAL" "$DEPLOYER" --rpc-url "$ENDPOINT")"
if [ -n "${TOKEN:-}" ]; then
  echo "uTUSD balance (raw) $(cast call "$TOKEN" "$SIG_BAL" "$DEPLOYER" --rpc-url "$ENDPOINT" 2>/dev/null || echo unreadable)"
fi
grep -E '^[[:space:]]*PLAN ' "$SIM" | sed -E 's/^[[:space:]]*PLAN /  /' | awk '!seen[$0]++'
echo "gas estimate       $est ETH (forge's own, at the simulated gas price)"
echo "spend ceiling      $(cast from-wei "$ceiling_wei") ETH (2x the estimate: headroom for fees the estimate may not capture, such as this chain's L1 data fee)"
echo "=========================================================================="
python3 -c "import sys; sys.exit(0 if int('$wei') >= int('$ceiling_wei') else 1)" \
  || fail "the deployer holds less native gas than the spend ceiling; nothing was broadcast"

if [ "$MODE" = "dry" ]; then echo "DRY_RUN=1: stopping before the broadcast line; nothing was sent"; exit 0; fi

# ---- the broadcast. --slow sends one transaction at a time and waits for each receipt, which the
# pair stage depends on: the executor must be the deployer's very next transaction after the hook.
if [ "$MODE" = "rehearse" ]; then
  echo "== REHEARSE=1: broadcasting to the local anvil fork, impersonated, nothing signed"
  FOUNDRY_BROADCAST=$LOGDIR forge script "$TARGET" --sig "$SIG" ${ARGS[@]+"${ARGS[@]}"} \
    --rpc-url "$ENDPOINT" --unlocked --sender "$DEPLOYER" --broadcast --slow -vv
  exit 0
fi

echo
echo "These transactions are REAL and CANNOT BE UNDONE once sent."
printf 'Type SEND to broadcast stage %s from %s, anything else stops: ' "$STAGE" "$DEPLOYER"
IFS= read -r answer < /dev/tty || answer=""
test "$answer" = "SEND" || fail "not confirmed; nothing was broadcast"
echo "== signing with keystore '$DEPLOYER_ACCOUNT' as $DEPLOYER; forge will ask for the password"
forge script "$TARGET" --sig "$SIG" ${ARGS[@]+"${ARGS[@]}"} \
  --rpc-url "$ENDPOINT" --account "$DEPLOYER_ACCOUNT" --sender "$DEPLOYER" --broadcast --slow -vv
