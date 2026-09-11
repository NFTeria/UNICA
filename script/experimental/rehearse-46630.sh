#!/usr/bin/env bash
# rehearse-46630.sh — all four stock-settlement stages on an anvil FORK of Robinhood testnet, as the
# real deployer, by impersonation. Real PoolManager, real PositionManager and Permit2, real faucet
# TSLA proxy, real deployer nonce and balances at the fork block. Zero real transactions, and no key
# or password anywhere: the fork is discarded when this exits.
#
# It drives script/experimental/stock-46630.sh — the SAME wrapper the owner runs — with REHEARSE=1,
# so what is rehearsed is the handoff command itself, not a lookalike. Run records go under
# .rehearsal/, never under the committed broadcast/.
#
#   DEPLOYER=0x... bash script/experimental/rehearse-46630.sh        (or: make stock-rehearse)
#
# FAILS CLOSED ON ANYTHING THAT IS NOT A LOOPBACK ANVIL. The target is built from a port on
# 127.0.0.1, the node must answer web3_clientVersion as anvil, and the wrapper refuses REHEARSE=1
# against any non-loopback URL on its own. A LIVE_BROADCAST value in the environment stops this
# before anvil starts, so a variable left over from a live session cannot ride along.
#
# The fork source, in order: ROBINHOOD_FORK_URL if set; else ROBINHOOD_TESTNET_RPC_URL read from .env
# HERE, by this script, so the key never appears on a make line or a pasteable command; else the
# keyless explorer endpoint — which, measured 2026-09-10, CANNOT back a fork (anvil's genesis fetch
# is refused with "Query parameter 'block' is invalid") and so fails loudly at the fork step. Only
# the host of the source is ever printed.
set -euo pipefail
cd "$(dirname "$0")/../.."
stop() { echo "STOP: $1"; exit 1; }
DEPLOYER="${DEPLOYER:?set DEPLOYER to the public address of the deployer}"
test -z "${LIVE_BROADCAST:-}" || stop "LIVE_BROADCAST is set in this environment; a rehearsal will not run beside it"
PORT="${PORT:-8547}"
LOCAL="http://127.0.0.1:$PORT"
if [ -z "${ROBINHOOD_FORK_URL:-}" ] && [ -f .env ]; then
  git check-ignore -q .env || stop ".env is not gitignored; refusing to read a key from it"
  ROBINHOOD_FORK_URL=$(grep -m1 '^ROBINHOOD_TESTNET_RPC_URL=' .env | cut -d= -f2- | tr -d '"'"'" || true)
fi
SRC="${ROBINHOOD_FORK_URL:-https://explorer.testnet.chain.robinhood.com/api/eth-rpc}"
# A placeholder recipient for the rehearsal only: the first address anvil's well-known test mnemonic
# derives. It holds nothing real and is never used outside a local fork.
MERCHANT="${MERCHANT:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}"
RATE="${RATE:-395}"
SEED="${SEED:-10000}"
AMOUNT_IN="${AMOUNT_IN:-100000000000000000}"
SALT="${SALT:-0x0000000000000000000000000000000000000000000000000000000000000001}"
LOG=.rehearsal/rehearse-46630
rm -rf "$LOG"; mkdir -p "$LOG"

echo "== forking $(printf '%s' "$SRC" | cut -d/ -f3) on :$PORT"
anvil --fork-url "$SRC" --port "$PORT" --auto-impersonate --silent &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true' EXIT
for _ in $(seq 1 120); do
  kill -0 "$ANVIL" 2>/dev/null || stop "anvil exited before the fork was up (see its error above)"
  cast chain-id --rpc-url "$LOCAL" >/dev/null 2>&1 && break
  sleep 0.5
done
test "$(cast chain-id --rpc-url "$LOCAL" 2>/dev/null)" = "46630" || stop "the fork is not answering as 46630"
client=$(cast rpc web3_clientVersion --rpc-url "$LOCAL" | tr -d '"')
case "$client" in anvil*) ;; *) stop "the node on $LOCAL is '$client', not anvil" ;; esac
NONCE0=$(cast nonce "$DEPLOYER" --rpc-url "$LOCAL")
echo "fork: chain 46630, block $(cast block-number --rpc-url "$LOCAL"), node $client"
echo "deployer nonce $NONCE0, balance $(cast balance "$DEPLOYER" --ether --rpc-url "$LOCAL") ETH"

# One stage through the owner's wrapper. The address a later stage needs is read from the Solidity's
# own console line ("TOKEN 0x..."), never retyped.
stage() {
  local name="$1"; shift
  echo "== stage $name"
  env "$@" STAGE="$name" ENDPOINT="$LOCAL" DEPLOYER="$DEPLOYER" REHEARSE=1 \
    bash script/experimental/stock-46630.sh > "$LOG/$name.log" 2>&1 \
    || { echo "STAGE $name FAILED — last lines:"; tail -40 "$LOG/$name.log"; exit 1; }
  grep -E '^[[:space:]]+(PASS|FAIL) |checks run:' "$LOG/$name.log" | awk '!seen[$0]++' | sed 's/^/   /'
}
pick() { grep -E "^[[:space:]]*$1 0x[0-9a-fA-F]{40}" "$LOG/$2.log" | tail -1 | awk '{print $2}'; }
predicted() { grep -E "PLAN tx $1 .*predicted at 0x" "$LOG/$2.log" | head -1 | grep -oE '0x[0-9a-fA-F]{40}$'; }

stage token
TOKEN=$(pick TOKEN token); test -n "$TOKEN" || stop "no TOKEN address in the token stage output"
P_TOKEN=$(predicted 1 token)
stage pair TOKEN="$TOKEN"
HOOK=$(pick HOOK pair); EXECUTOR=$(pick EXECUTOR pair)
test -n "$HOOK" && test -n "$EXECUTOR" || stop "no HOOK/EXECUTOR in the pair stage output"
P_HOOK=$(predicted 1 pair); P_EXECUTOR=$(predicted 2 pair)
stage pool TOKEN="$TOKEN" HOOK="$HOOK" RATE="$RATE" SEED="$SEED"
stage settle TOKEN="$TOKEN" HOOK="$HOOK" EXECUTOR="$EXECUTOR" MERCHANT="$MERCHANT" AMOUNT_IN="$AMOUNT_IN" SALT="$SALT"

# Once the pool has traded, the pool stage must refuse to run again: the price has moved off the
# stated rate, which is exactly what a pool somebody else initialised would look like. Simulation
# only; a pass here is the failure.
echo "== refusal: the pool stage must refuse a pool that has already traded"
if env STAGE=pool TOKEN="$TOKEN" HOOK="$HOOK" RATE="$RATE" SEED=100 ENDPOINT="$LOCAL" DEPLOYER="$DEPLOYER" DRY_RUN=1 \
  bash script/experimental/stock-46630.sh > "$LOG/pool-after-trade.log" 2>&1; then
  stop "the pool stage accepted a pool that had already traded"
fi
grep -m1 -E 'FAIL  the guarded pool is uninitialised, or initialised at exactly' "$LOG/pool-after-trade.log" \
  | sed 's/^ */   refused as required: /' || stop "refused, but not by the row that names the reason"

stage verify TOKEN="$TOKEN" HOOK="$HOOK" EXECUTOR="$EXECUTOR"

echo "== predicted against observed, read back with cast, independently of the script"
SIG_BAL='balanceOf(address)(uint256)'
SIG_RC='receiptCount()(uint256)'
SIG_EX='SETTLEMENT_EXECUTOR()(address)'
SIG_HK='HOOK()(address)'
same() { [ "$(printf '%s' "$1" | tr 'A-F' 'a-f')" = "$(printf '%s' "$2" | tr 'A-F' 'a-f')" ]; }
row() { if eval "$2"; then echo "   PASS  $1"; else echo "   FAIL  $1"; FAILS=$((FAILS + 1)); fi; }
FAILS=0
bytes() { echo $(( ($(cast code "$1" --rpc-url "$LOCAL" | wc -c) - 3) / 2 )); }
printf '   %-9s predicted %s\n   %-9s observed  %s  (%s bytes)\n' token "$P_TOKEN" "" "$TOKEN" "$(bytes "$TOKEN")"
printf '   %-9s predicted %s\n   %-9s observed  %s  (%s bytes)\n' hook "$P_HOOK" "" "$HOOK" "$(bytes "$HOOK")"
printf '   %-9s predicted %s\n   %-9s observed  %s  (%s bytes)\n' executor "$P_EXECUTOR" "" "$EXECUTOR" "$(bytes "$EXECUTOR")"
row "the token is where stage 1 predicted" "same '$P_TOKEN' '$TOKEN'"
row "the hook is where stage 2 mined it" "same '$P_HOOK' '$HOOK'"
row "the executor is where stage 2 predicted it" "same '$P_EXECUTOR' '$EXECUTOR'"
row "the hook's low 14 bits are 0x20C0" "[ $(( 0x${HOOK: -4} & 0x3FFF )) -eq $(( 0x20C0 )) ]"
row "the hook names the executor" "same \"\$(cast call $HOOK '$SIG_EX' --rpc-url $LOCAL)\" '$EXECUTOR'"
row "the executor names the hook" "same \"\$(cast call $EXECUTOR '$SIG_HK' --rpc-url $LOCAL)\" '$HOOK'"
row "exactly one receipt" "[ \"\$(cast call $HOOK '$SIG_RC' --rpc-url $LOCAL)\" = 1 ]"
NONCE1=$(cast nonce "$DEPLOYER" --rpc-url "$LOCAL")
row "exactly 11 transactions were sent from the deployer ($NONCE0 -> $NONCE1)" "[ $((NONCE1 - NONCE0)) -eq 11 ]"
DELIVERED=$(cast call "$TOKEN" "$SIG_BAL" "$MERCHANT" --rpc-url "$LOCAL" | awk '{print $1}')
row "the merchant received uTUSD ($DELIVERED raw)" "[ '$DELIVERED' -gt 0 ]"
echo "   checks run: 9, failed: $FAILS"
test "$FAILS" -eq 0 || stop "a predicted-against-observed row failed"
echo "== rehearsal complete; the fork is discarded, and nothing was sent to any real chain"
