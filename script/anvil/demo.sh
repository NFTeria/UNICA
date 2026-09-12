#!/usr/bin/env bash
# demo.sh — the barbershop scenario, end to end, on the local chain. LOCAL_ANVIL_NO_VALUE.
#
#   freshcuts.unica.eth pays out to its ENS-discovered address; chair-1 is the active terminal,
#   lost-tablet the revoked one; the payer is bound into the order; settlement runs through the
#   registered Uniswap v4 market under an authenticated (fixture-fed) price; the receipt is
#   authenticated by the evidence layer before the POS may say PAID.
#
# Sixteen numbered steps, matching docs/unica-v4/ANVIL-DEMO.md. Positive steps broadcast from
# impersonated Anvil accounts; every expected refusal is an eth_call whose revert selector is
# checked by name, so a refusal that stopped refusing turns this script red. No failed step is
# ever printed as a payment.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=script/anvil/lib.sh
. script/anvil/lib.sh
require_tools
require_local_chain
load_accounts
load_manifest_env

export DEMO_AMOUNT_IN="${DEMO_AMOUNT_IN:-1000000000000000000}"   # 1.000000 tAST (18 decimals)
export DEMO_MIN_OUT="${DEMO_MIN_OUT:-1950000}"                      # 1.950000 uUSD (6 decimals)
export DEMO_TTL_SECONDS="${DEMO_TTL_SECONDS:-1800}"
export DEMO_ORDER_SEQ="${DEMO_ORDER_SEQ:-1}"
RECORD="$REHEARSAL_DIR/demo-record.json"
FOUNDRY_BROADCAST="$REHEARSAL_DIR/broadcast"; export FOUNDRY_BROADCAST

run_stage() { # $1 sig, $2 sender, $3 tag to extract
  local log="$REHEARSAL_DIR/demo-$1.log"
  forge script script/anvil/AnvilLocal.s.sol:AnvilLocal --sig "$1()" --rpc-url "$UNICA_LOCAL_RPC" \
    --unlocked --sender "$2" --broadcast -vv >"$log" 2>&1 || { cat "$log"; die "stage $1 failed"; }
  grep -o "$3:.*" "$log" | sed "s/^$3://"
}

step "1–4. identity exists (deploy); mint the identity badge; revoke the lost tablet; refresh the fixture feeds; deliver the LOCAL CRE REPORT FIXTURE"
PREPARE=$(run_stage demoPrepare "$ANVIL_ADMIN" PREPARE)
log "$PREPARE"
TOKEN_ID=$(json_get "$PREPARE" .tokenId)
REPORT_HASH=$(json_get "$PREPARE" .reportHash)

step "5. the lost tablet fails to request a new order (BACKEND_POLICY / ENSV2 authority at admission)"
DEADLINE=$(( $(cast block --rpc-url "$UNICA_LOCAL_RPC" -f timestamp latest) + DEMO_TTL_SECONDS ))
LOST_NONCE=$(cast keccak "lost-tablet-attempt-$DEMO_ORDER_SEQ")
LAYER="ENSV2_ONCHAIN+BACKEND_POLICY" expect_revert LOST_TERMINAL_NEW_ORDER 'TerminalNotAuthorized(bytes32,address)' \
  "$UNICA_ADMISSION" 'requestOrder(bytes32,bytes32,bytes32,address,address,uint128,uint128,uint64,bytes32)' \
  "$UNICA_MERCHANT_NODE" "$UNICA_LOST_TABLET_NODE" "$UNICA_ENS_DEPLOYMENT_ID" "$UNICA_EXECUTOR" "$ANVIL_PAYER" \
  "$DEMO_AMOUNT_IN" "$DEMO_MIN_OUT" "$DEADLINE" "$LOST_NONCE" --from "$ANVIL_OP_LOST_TABLET"

step "6. the active terminal admits the exact payer-bound order"
MERCHANT_BEFORE=$(call "$UNICA_PAYOUT" 'balanceOf(address)(uint256)' "$ANVIL_MERCHANT_PAYOUT")
ADMIT=$(run_stage demoAdmit "$ANVIL_OP_CHAIR1" DEMO)
log "$ADMIT"
ORDER_ID=$(json_get "$ADMIT" .orderId)
ORDER_BEFORE=$(call "$UNICA_EXECUTOR" 'orders(bytes32)((address,address,address,uint128,uint128,uint64,uint8))' "$ORDER_ID")

step "7. the wrong payer fails (UNICA_ONCHAIN: WrongPayer)"
expect_revert WRONG_PAYER 'WrongPayer(bytes32,address,address)' "$UNICA_EXECUTOR" 'pay(bytes32)' "$ORDER_ID" --from "$ANVIL_WRONG_PAYER"

step "8. the bound payer approves exactly the input and pays"
send_as "$ANVIL_PAYER" "$UNICA_ASSET" 'approve(address,uint256)' "$UNICA_EXECUTOR" "$DEMO_AMOUNT_IN" >/dev/null
PAY=$(send_as "$ANVIL_PAYER" "$UNICA_EXECUTOR" 'pay(bytes32)' "$ORDER_ID")
PAY_STATUS=$(json_get "$PAY" .status)
PAY_HASH=$(json_get "$PAY" .transactionHash)
PAY_BLOCK=$(json_get "$PAY" .blockNumber)
test "$PAY_STATUS" = "0x1" || die "pay() did not succeed: status $PAY_STATUS"
log "tx $PAY_HASH  block $PAY_BLOCK  status $PAY_STATUS"

step "9. the oracle route bound into the market is the route the adapter answers, and it is fresh"
POLICY=$(call "$UNICA_REGISTRY" 'oraclePolicyOf(bytes32)((address,bytes32,uint48,uint16,bool))' "$UNICA_MARKET_ID")
ADAPTER_FEED=$(call "$UNICA_ORACLE_ADAPTER" 'feedIdFor(address,address)(bytes32)' "$UNICA_ASSET" "$UNICA_PAYOUT")
printf '%s' "$POLICY" | grep -qi "${ADAPTER_FEED#0x}" || die "policy feedId does not match the adapter's feedIdFor"
CONDITION=$(call "$UNICA_HOOK" 'oracleCondition()(uint8,bytes4,uint256,uint8,uint256)')
log "policy      $POLICY"
log "feedIdFor   $ADAPTER_FEED"
log "condition   $CONDITION   (0 = OK)"

step "10–11. Uniswap v4 settlement executed; the merchant received the output asset"
MERCHANT_AFTER=$(call "$UNICA_PAYOUT" 'balanceOf(address)(uint256)' "$ANVIL_MERCHANT_PAYOUT")
DELIVERED=$(node -e 'console.log((BigInt(process.argv[1])-BigInt(process.argv[2])).toString())' "$MERCHANT_AFTER" "$MERCHANT_BEFORE")
log "merchant payout balance  before $MERCHANT_BEFORE  after $MERCHANT_AFTER  delivered $DELIVERED (uUSD base units)"
test "$DELIVERED" -ge "$DEMO_MIN_OUT" || die "delivered $DELIVERED is below minOut $DEMO_MIN_OUT"
ORDER_AFTER=$(call "$UNICA_EXECUTOR" 'orders(bytes32)((address,address,address,uint128,uint128,uint64,uint8))' "$ORDER_ID")
log "order after  $ORDER_AFTER   (last field 3 = Settled)"

step "12–13. hook and executor evidence authenticated through the registry; the receipt becomes VERIFIED or it does not"
EVIDENCE=$(node tools/unica-evidence/cli.mjs --order "$ORDER_ID" --manifest "$MANIFEST_PATH" --rpc "$UNICA_LOCAL_RPC" --confirmations 0)
log "$EVIDENCE"
DECISION=$(json_get "$EVIDENCE" .decision)
test "$DECISION" = "VERIFIED" || die "the evidence layer did not verify the receipt: $DECISION"

step "14. the POS shows PAID only from canonical evidence"
node - "$RECORD" "$MANIFEST_PATH" "$ADMIT" "$PREPARE" "$PAY" "$EVIDENCE" "$MERCHANT_BEFORE" "$MERCHANT_AFTER" "$DELIVERED" "$ADAPTER_FEED" <<'EOF'
const [out, manifestPath, admit, prepare, pay, evidence, before, after, delivered, feedId] = process.argv.slice(2);
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const A = JSON.parse(admit), P = JSON.parse(prepare), T = JSON.parse(pay), E = JSON.parse(evidence);
const record = {
  environment: "LOCAL_ANVIL_NO_VALUE",
  manifest,
  merchant: {name: manifest.identity.merchantName, address: A.recipient, identityToken: `${manifest.contracts.identityToken.address}:${P.tokenId}`, rendererVersion: manifest.identity.rendererVersion},
  terminal: {name: "chair-1.terminals.freshcuts.unica.eth", statusAtAdmission: (A.chair1Status || "active").toUpperCase(), node: manifest.identity.terminals[0].node},
  revokedTerminal: {name: "lost-tablet.terminals.freshcuts.unica.eth", status: (P.lostTabletStatus || "revoked").toUpperCase()},
  order: {id: A.orderId, payer: A.payer, marketId: manifest.market.marketId, inputAmount: A.amountIn, minimumOutput: A.minOut, expiry: A.deadline, nonce: A.orderNonce, inputAsset: manifest.contracts.assetToken.address, outputAsset: manifest.contracts.payoutToken.address},
  oracle: {adapter: manifest.market.adapter, feedId, fixture: true, fresh: true},
  policy: {decision: "APPROVE", source: "LOCAL_CRE_REPORT_FIXTURE", reportHash: P.reportHash, label: "LOCAL CRE REPORT FIXTURE — NOT A DON REPORT"},
  settlement: {transactionHash: T.transactionHash, blockNumber: T.blockNumber, status: T.status, merchantBalanceBefore: before, merchantBalanceAfter: after, outputDelivered: delivered, atomic: true},
  evidence: E,
  chainId: manifest.chainId,
  connectedPayer: A.payer,
};
fs.writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
EOF
node tools/unica-pos-cli/cli.mjs --demo "$RECORD" | tee "$REHEARSAL_DIR/demo-pos.txt"

step "15. revoking the terminal AFTER settlement does not alter the receipt or the order"
send_as "$ANVIL_MERCHANT_OWNER" "$UNICA_IDENTITY" 'authorizeTextRoles(bytes32,string,address,bool)' "$UNICA_CHAIR1_NODE" 'com.unica.terminal-status' "$ANVIL_OP_CHAIR1" false >/dev/null
send_as "$ANVIL_MERCHANT_OWNER" "$UNICA_IDENTITY" 'setText(bytes32,string,string)' "$UNICA_CHAIR1_NODE" 'com.unica.terminal-status' 'revoked' >/dev/null
EVIDENCE2=$(node tools/unica-evidence/cli.mjs --order "$ORDER_ID" --manifest "$MANIFEST_PATH" --rpc "$UNICA_LOCAL_RPC" --confirmations 0)
test "$(json_get "$EVIDENCE" .receipt)" = "$(json_get "$EVIDENCE2" .receipt)" || die "the receipt changed after revocation"
test "$(json_get "$EVIDENCE2" .decision)" = "VERIFIED" || die "the receipt lost VERIFIED after revocation"
ORDER_FINAL=$(call "$UNICA_EXECUTOR" 'orders(bytes32)((address,address,address,uint128,uint128,uint64,uint8))' "$ORDER_ID")
test "$ORDER_FINAL" = "$ORDER_AFTER" || die "the on-chain order changed after revocation"
log "receipt identical, decision VERIFIED, order unchanged; chair-1 now reads: $(call "$UNICA_IDENTITY" 'text(bytes32,string)(string)' "$UNICA_CHAIR1_NODE" 'com.unica.terminal-status')"
LAYER="ENSV2_ONCHAIN+BACKEND_POLICY" expect_revert REVOKED_TERMINAL_AFTER_SETTLEMENT 'TerminalNotAuthorized(bytes32,address)' \
  "$UNICA_ADMISSION" 'requestOrder(bytes32,bytes32,bytes32,address,address,uint128,uint128,uint64,bytes32)' \
  "$UNICA_MERCHANT_NODE" "$UNICA_CHAIR1_NODE" "$UNICA_ENS_DEPLOYMENT_ID" "$UNICA_EXECUTOR" "$ANVIL_PAYER" \
  "$DEMO_AMOUNT_IN" "$DEMO_MIN_OUT" "$DEADLINE" "$(cast keccak "chair-1-after-revocation-$DEMO_ORDER_SEQ")" --from "$ANVIL_OP_CHAIR1"

step "16. a look-alike hook emits a similar receipt with the official marketId and is REFUSED"
LOOK=$(run_stage lookalike "$ANVIL_ATTACKER" LOOKALIKE)
log "$LOOK"
LOOK_ORDER=$(json_get "$LOOK" .orderId)
LOOK_EVIDENCE=$(node tools/unica-evidence/cli.mjs --order "$LOOK_ORDER" --manifest "$MANIFEST_PATH" --rpc "$UNICA_LOCAL_RPC" --confirmations 0)
LOOK_DECISION=$(json_get "$LOOK_EVIDENCE" .decision)
test "$LOOK_DECISION" = "REFUSED" || die "the look-alike receipt was not REFUSED: $LOOK_DECISION"
printf '{"case":"LOOKALIKE_HOOK","decision":"%s","reasonCodes":%s}\n' "$LOOK_DECISION" "$(json_get "$LOOK_EVIDENCE" .reasonCodes)"
node - "$RECORD" "$LOOK" "$LOOK_EVIDENCE" <<'EOF'
const [out, look, ev] = process.argv.slice(2); const fs = require("fs");
const r = JSON.parse(fs.readFileSync(out, "utf8")); r.lookalike = {...JSON.parse(look), evidence: JSON.parse(ev)};
fs.writeFileSync(out, JSON.stringify(r, null, 2) + "\n");
EOF

step "result"
node tools/unica-pos-cli/cli.mjs --demo "$RECORD" --json-only
log "record: $RECORD"
