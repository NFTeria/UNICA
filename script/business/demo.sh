#!/usr/bin/env bash
# demo.sh: the whole product, in the words a business owner uses, from an empty chain.
# LOCAL_ANVIL_NO_VALUE.
#
# A barbershop joins, points its payments at the asset it wants to be paid in, authorizes one
# register, loses a tablet and revokes it, and then sells twice: once to a customer paying the very
# asset the shop is paid in, and once to a customer paying something else, which is converted on
# the way. Both payments are read back from the chain and the shop is only told "Paid" when a
# reader has confirmed the receipt.
#
# Everything an engineer needs is written to log files and printed at the end under "Advanced
# verification". Everything before that is what the owner sees.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=script/business/lib.sh
. script/business/lib.sh

RECORD="$REHEARSAL_DIR/demo-record.json"
JOIN_RECORD="$REHEARSAL_DIR/join-record.json"
PORT="${UNICA_SERVE_PORT:-8787}"

banner
heading "1. A clean start"
log "  Nothing from an earlier run is reused. The chain is emptied and the product is installed"
log "  fresh, so nothing you see below can be left over from yesterday."
quietly "Emptying the practice chain" up bash script/anvil/up.sh
quietly "Installing the payment product, and Fresh Cuts joining from its own wallet" deploy bash script/anvil/deploy.sh
quietly "Opening the conversion route, so a customer can pay in another asset" seed bash script/anvil/seed.sh

test -f "$JOIN_RECORD" || die "the business did not join; see $REHEARSAL_DIR/business-deploy.log"
JOIN=$(cat "$JOIN_RECORD")
load_accounts
load_manifest_env

heading "2. The business"
log "  Name                Fresh Cuts   ($(json_get "$JOIN" .payName))"
log "  Joined by           the owner's own wallet, $(json_get "$JOIN" .joinedBy)"
log "  Paid into           $(json_get "$JOIN" .payoutAddress)"
log "  Paid in             uUSD, a local test dollar (not USDC, worth nothing)"
log "  Registers           $(json_get "$JOIN" .firstTerminalLabel) (authorized), lost-tablet (authorized for now)"
log "  Business badge      #$(json_get "$JOIN" .tokenId), held by the owner and not transferable"

heading "3. Two sales, one lost tablet, and everything that must be refused"
quietly "Selling twice and testing every refusal" demo bash script/anvil/demo.sh
test -f "$RECORD" || die "no sales record was produced; see $REHEARSAL_DIR/business-demo.log"
R=$(cat "$RECORD")

DIRECT_AMOUNT=$(json_get "$R" .directPayment.amount)
DIRECT_DECISION=$(json_get "$R" .directPayment.decision)
DIRECT_ORDER=$(json_get "$R" .directPayment.orderId)
DIRECT_TX=$(json_get "$R" .directPayment.txHash)
DIRECT_BEFORE=$(json_get "$R" .directPayment.businessBalanceBefore)
DIRECT_AFTER=$(json_get "$R" .directPayment.businessBalanceAfter)
SWAP_IN=$(json_get "$R" .order.inputAmount)
SWAP_OUT=$(json_get "$R" .settlement.outputDelivered)
SWAP_DECISION=$(json_get "$R" .evidence.decision)
SWAP_ORDER=$(json_get "$R" .order.id)
SWAP_TX=$(json_get "$R" .settlement.transactionHash)
SWAP_BEFORE=$(json_get "$R" .settlement.merchantBalanceBefore)
SWAP_AFTER=$(json_get "$R" .settlement.merchantBalanceAfter)

# One rule, written once: a sale is only "Paid (checked)" when a reader confirmed the receipt.
# Anything else is "Not confirmed yet", and the reason is printed beside it.
state_of() { case "$1" in VERIFIED) printf 'Paid (checked)' ;; REFUSED) printf 'Declined' ;; *) printf 'Not confirmed yet' ;; esac; }

heading "4. Sale one: the customer paid the same asset the business is paid in"
log "  Nothing was converted, and no conversion route was used at all."
log "  Amount asked        $(money "$DIRECT_AMOUNT" uUSD)"
log "  Business balance    $(money "$DIRECT_BEFORE" uUSD)  ->  $(money "$DIRECT_AFTER" uUSD)"
log "  Received            $(money "$(node -e 'console.log((BigInt(process.argv[1])-BigInt(process.argv[2])).toString())' "$DIRECT_AFTER" "$DIRECT_BEFORE")" uUSD), exactly the amount asked"
log "  Register            chair-1"
log "  Receipt             $(state_of "$DIRECT_DECISION")"
if [ "$DIRECT_DECISION" != "VERIFIED" ]; then
  log "                      $(json_get "$R" .directPayment.decisionNote)"
fi

heading "5. Sale two: the customer paid a different asset"
log "  The customer paid tAST and the business was paid uUSD. The conversion happened during the"
log "  payment, and the business never held the asset the customer used."
log "  Customer paid       $(money "$SWAP_IN" tAST)"
log "  Business balance    $(money "$SWAP_BEFORE" uUSD)  ->  $(money "$SWAP_AFTER" uUSD)"
log "  Received            $(money "$SWAP_OUT" uUSD)"
log "  Register            chair-1"
log "  Receipt             $(state_of "$SWAP_DECISION")"

heading "6. What was refused, and why that matters"
log "  A stranger tried to pay someone else's sale                      Declined"
log "  The lost tablet tried to raise a new sale after being revoked    Declined"
log "  The same register tried to raise a sale after being revoked      Declined"
log "  A look-alike copy of the product tried to pass off a receipt     Declined"
# One refusal that the sales run above does not reach: an amount too large to convert safely. The
# limit is the one recorded in the installation, read here rather than typed in.
CAP=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).market.caps.maxPerTxPayout)' "$MANIFEST_PATH")
OVER=$(node -e 'console.log((BigInt(process.argv[1])+1n).toString())' "$CAP")
OVERSIZED=$(LAYER="UNICA_ONCHAIN" expect_revert UNSAFE_CONVERSION_OVERSIZED 'OrderAboveCap(uint128,uint128)' \
  "$UNICA_EXECUTOR" 'createOrder(address,address,uint128,uint128,uint64,bytes32)' \
  "$ANVIL_MERCHANT_PAYOUT" "$ANVIL_PAYER" 1000000000000000000000 "$OVER" 4102444800 "$(cast keccak oversized-business-demo)" \
  --from "$UNICA_ADMISSION")
log "  A sale larger than this installation converts safely             Declined"
# Printing both amounts rounded to two decimals would show the same number twice, because the
# refused amount is one smallest-unit above the limit. Say that in words instead of showing a
# number that looks identical to the one it is supposed to exceed.
log "                      the limit is $(money "$CAP" uUSD) per sale, and a sale one smallest unit"
log "                      above it was refused before the sale existed"

heading "7. What the business can open right now"
log "  Your business       http://127.0.0.1:$PORT/business/"
log "  Take a payment      http://127.0.0.1:$PORT/business/payments/new/"
log "  Customer payment    http://127.0.0.1:$PORT/pay/?order=$SWAP_ORDER"
log "  Start the screens with: make business-open"

heading "Advanced verification"
log "  These are for an engineer checking the run. A business owner never needs them."
log "  same-asset sale id   $DIRECT_ORDER"
log "  same-asset payment   $DIRECT_TX"
log "  converted sale id    $SWAP_ORDER"
log "  converted payment    $SWAP_TX"
log "  oversized refusal    $OVERSIZED"
log "  full record          $RECORD"
log "  installation         $MANIFEST_PATH"
log "  stage logs           $REHEARSAL_DIR/business-*.log"
log ""
log "  TESTNET / NO VALUE. Nothing on this chain is money."
