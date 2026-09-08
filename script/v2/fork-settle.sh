#!/usr/bin/env bash
# Produce a REAL V2 settlement transaction on a LOCAL fork node, so `tools/unica-verify`'s online
# path has something to fetch.
#
# WHY THIS EXISTS. `forge test` proves the settlement's semantics against pinned live dependencies,
# but a test run leaves no transaction, no block and no log that a JSON-RPC client can ask for — so
# it cannot exercise an RPC verifier at all. This drives the same settlement through a node.
#
# IT REFUSES ANYTHING THAT IS NOT LOCAL. A verifier's evidence script that could be pointed at a
# public endpoint by editing one variable is a broadcast waiting to happen; the check below is on
# the host, before anything is signed, and it is the first thing that runs.
set -euo pipefail
cd "$(dirname "$0")/../.."

RPC="${UNICA_LOCAL_RPC:-http://127.0.0.1:8545}"
OUT="${UNICA_VERIFY_FIXTURE:-tools/unica-verify/fixtures/fork-settlement.json}"

case "$RPC" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "refusing: this script only ever talks to a local node, and '$RPC' is not one"; exit 1 ;;
esac
if ! curl -s --max-time 3 -o /dev/null "$RPC"; then
  echo "no local node at $RPC — start one with:"
  echo "  anvil --fork-url \$SEPOLIA_RPC_URL --port 8545 --auto-impersonate --silent"
  exit 1
fi

CHAIN=$(cast chain-id --rpc-url "$RPC")
[ "$CHAIN" = "11155111" ] || { echo "refusing: the local node reports chain $CHAIN, not a Sepolia fork"; exit 1; }

USDC=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
DEPLOYER=0x00000000000000000000000000000000000ABCDE
PAYER=$(cast wallet address --private-key "$(cast keccak 'unica.v2.fork.payer')")

echo "== staging the fork: ether for gas, USDC for the pool"
cast rpc anvil_setBalance "$DEPLOYER" 0x21e19e0c9bab2400000 --rpc-url "$RPC" >/dev/null
cast rpc anvil_setBalance "$PAYER"    0x21e19e0c9bab2400000 --rpc-url "$RPC" >/dev/null
# USDC's balance mapping is slot 9 of the FiatToken layout. Written directly rather than begged
# from a faucet, and read back below, because a stage that silently did nothing looks identical to
# one that worked until the settlement fails four steps later for an unrelated-looking reason.
STAGE_USDC=5000000000000   # 5,000,000.000000 USDC, in base units
cast rpc anvil_setStorageAt "$USDC" "$(cast index address "$DEPLOYER" 9)" \
  "$(cast to-uint256 "$STAGE_USDC")" --rpc-url "$RPC" >/dev/null
STAGED=$(cast call "$USDC" 'balanceOf(address)(uint256)' "$DEPLOYER" --rpc-url "$RPC" | cut -d' ' -f1)
[ "$STAGED" = "$STAGE_USDC" ] || { echo "the USDC stage did not take: balanceOf reads $STAGED"; exit 1; }
echo "   deployer USDC: $STAGED (5,000,000.000000)"

# Permit2 spends nonces from a bitmap, so the first free one has to be READ, not assumed. A rerun
# against a node that already holds a settlement finds nonce 0 spent and dies inside Permit2 with a
# bare selector; this turns that into a number.
PERMIT2=0x000000000022D473030F116dDEE9F6B43aC78BA3
BITMAP=$(cast call "$PERMIT2" 'nonceBitmap(address,uint256)(uint256)' "$PAYER" 0 --rpc-url "$RPC" | cut -d' ' -f1)
NONCE=0
while [ "$NONCE" -lt 256 ] && [ "$(python3 -c "print(($BITMAP >> $NONCE) & 1)")" = "1" ]; do
  NONCE=$((NONCE + 1))
done
[ "$NONCE" -lt 256 ] || { echo "the payer's first Permit2 nonce word is full; restart the node"; exit 1; }
export UNICA_PERMIT_NONCE="$NONCE"
echo "   payer Permit2 nonce: $NONCE"

echo "== deploying V2 and settling one invoice on the local fork"
# NO PIPELINE. `forge ... | tee log >/dev/null` reports tee's status, so a failed deploy exits
# zero and the run marches on to a capture with nothing to capture. Redirected to a file, status
# read explicitly, and the log printed on the way out — a driver whose diagnostics vanish exactly
# when something breaks is worse than no driver.
LOG=$(mktemp)
set +e
FOUNDRY_BROADCAST=.rehearsal/broadcast forge script script/v2/ForkSettle.s.sol:ForkSettleScript \
  --rpc-url "$RPC" --broadcast --unlocked --sender "$DEPLOYER" > "$LOG" 2>&1
STATUS=$?
set -e
if [ "$STATUS" -ne 0 ]; then
  echo "the settlement run failed (exit $STATUS):"
  tail -60 "$LOG"
  exit 1
fi

field() { grep -o "$1=[^ ]*" "$LOG" | tail -1 | cut -d= -f2; }
EXECUTOR=$(field UNICA_V2_EXECUTOR)
[ -n "$EXECUTOR" ] || { echo "the settlement reported no executor:"; tail -60 "$LOG"; exit 1; }

echo "== reading the settlement back off the node, read-only"
node script/v2/capture-fixture.mjs \
  --rpc "$RPC" \
  --executor "$EXECUTOR" \
  --hook "$(field UNICA_V2_HOOK)" \
  --pool-id "$(field UNICA_V2_POOL_ID)" \
  --quote-digest "$(field UNICA_V2_QUOTE_DIGEST)" \
  --merchant-signature "$(field UNICA_V2_MERCHANT_SIGNATURE)" \
  --merchant-signer "$(field UNICA_V2_MERCHANT_SIGNER)" \
  --payer "$(field UNICA_V2_PAYER)" \
  --recipient "$(field UNICA_V2_RECIPIENT)" \
  --config-hash "$(field UNICA_V2_CONFIG_HASH)" \
  --out "$OUT"
rm -f "$LOG"
echo "== wrote $OUT"
