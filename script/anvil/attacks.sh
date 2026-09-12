#!/usr/bin/env bash
# attacks.sh — the highest-value failure demonstrations against the LIVE local deployment.
# LOCAL_ANVIL_NO_VALUE. Runs after demo.sh; every case prints one structured refusal line
#   {"case":..., "decision":"REFUSED"|"UNKNOWN", "reasonCodes":[...]}
# and the script exits non-zero the moment a case that must refuse does not. No failed case is
# ever represented as a successful payment.
#
# Three instruments, each measuring a different layer:
#   1. test/anvil/Attacks.t.sol on a fork of the local node — on-chain refusals with the exact
#      selectors (order, market, Uniswap, ENS/identity, Chainlink policy, NFT);
#   2. eth_call probes through cast — the same refusals from an unmodified client;
#   3. the evidence layer and the POS CLI — REFUSED / UNKNOWN decisions and display states.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=script/anvil/lib.sh
. script/anvil/lib.sh
require_tools
require_local_chain
load_accounts
load_manifest_env
RECORD="$REHEARSAL_DIR/demo-record.json"
test -f "$RECORD" || die "no demo record at $RECORD; run: make anvil-demo"
ORDER_ID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).order.id)' "$RECORD")
ORDER_NONCE=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).order.nonce)' "$RECORD")
LOOK_ORDER=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).lookalike.orderId)' "$RECORD")

step "A. on-chain refusals, from a fork of the live local state (test/anvil/Attacks.t.sol)"
ATTACK_LOG="$REHEARSAL_DIR/attacks-forge.log"
UNICA_DEMO_ORDER_ID="$ORDER_ID" UNICA_DEMO_ORDER_NONCE="$ORDER_NONCE" forge test --match-path 'test/anvil/Attacks.t.sol' --fork-url "$UNICA_LOCAL_RPC" -vv >"$ATTACK_LOG" 2>&1 \
  || { tail -60 "$ATTACK_LOG"; die "the on-chain attack suite did not pass"; }
grep -o 'ATTACK:.*' "$ATTACK_LOG" | sed 's/^ATTACK://'
grep -E 'Suite result|tests passed' "$ATTACK_LOG" | tail -2

step "B. the same refusals through an unmodified client (eth_call)"
expect_revert REPLAYED_ORDER 'OrderNotOpen(bytes32,uint8)' "$UNICA_EXECUTOR" 'pay(bytes32)' "$ORDER_ID" --from "$ANVIL_PAYER"
expect_revert WRONG_PAYER_REPLAY 'OrderNotOpen(bytes32,uint8)' "$UNICA_EXECUTOR" 'pay(bytes32)' "$ORDER_ID" --from "$ANVIL_WRONG_PAYER"
expect_revert UNKNOWN_ORDER 'UnknownOrder(bytes32)' "$UNICA_EXECUTOR" 'pay(bytes32)' "$(cast keccak nonexistent)" --from "$ANVIL_PAYER"
LAYER="ENSV2_ONCHAIN+BACKEND_POLICY" expect_revert WRONG_ENS_DEPLOYMENT 'WrongEnsDeployment(bytes32,bytes32)' \
  "$UNICA_ADMISSION" 'requestOrder(bytes32,bytes32,bytes32,address,address,address,uint128,uint128,uint64,bytes32)' \
  "$UNICA_MERCHANT_NODE" "$UNICA_CHAIR1_NODE" "$(cast keccak other-deployment)" "$UNICA_EXECUTOR" "$ANVIL_MERCHANT_PAYOUT" "$ANVIL_PAYER" \
  1000000000000000000 1950000 4102444800 "$(cast keccak wrong-deployment)" --from "$ANVIL_OP_CHAIR1"
LAYER="UNICA_ONCHAIN" expect_revert UNAUTHORIZED_CREATOR_DIRECT 'NotOrderCreator(address)' \
  "$UNICA_EXECUTOR" 'createOrder(address,address,uint128,uint128,uint64,bytes32)' \
  "$ANVIL_MERCHANT_PAYOUT" "$ANVIL_PAYER" 1000000000000000000 1950000 4102444800 "$(cast keccak stranger)" --from "$ANVIL_ATTACKER"
LAYER="ENSV2_ONCHAIN" expect_revert TERMINAL_CANNOT_SET_RESOLVER 'EACUnauthorizedAccountRoles(uint256,uint256,address)' \
  "$UNICA_IDENTITY" 'setResolver(bytes32,address)' "$UNICA_MERCHANT_NODE" "$ANVIL_ATTACKER" --from "$ANVIL_OP_CHAIR1"
LAYER="ENSV2_ONCHAIN" expect_revert TERMINAL_CANNOT_INSTALL_SUBREGISTRY 'EACUnauthorizedAccountRoles(uint256,uint256,address)' \
  "$UNICA_IDENTITY" 'setSubregistry(bytes32,address)' "$UNICA_MERCHANT_NODE" "$ANVIL_ATTACKER" --from "$ANVIL_OP_CHAIR1"
LAYER="ENSV2_ONCHAIN" expect_revert TERMINAL_CANNOT_CREATE_PEER 'EACUnauthorizedAccountRoles(uint256,uint256,address)' \
  "$UNICA_IDENTITY" 'register(bytes32,string,address)' "$(call "$UNICA_IDENTITY" 'parentOf(bytes32)(bytes32)' "$UNICA_CHAIR1_NODE")" 'chair-9' "$ANVIL_OP_CHAIR1" --from "$ANVIL_OP_CHAIR1"
LAYER="ENSV2_ONCHAIN" expect_revert TERMINAL_CANNOT_CHANGE_PAYOUT_DISCOVERY 'EACUnauthorizedAccountRoles(uint256,uint256,address)' \
  "$UNICA_IDENTITY" 'setAddr(bytes32,address)' "$UNICA_MERCHANT_NODE" "$ANVIL_ATTACKER" --from "$ANVIL_OP_CHAIR1"
LAYER="ENSV2_ONCHAIN" expect_revert UNAUTHORIZED_TEXT_UPDATE 'EACUnauthorizedAccountRoles(uint256,uint256,address)' \
  "$UNICA_IDENTITY" 'setText(bytes32,string,string)' "$UNICA_CHAIR1_NODE" 'com.unica.terminal-status' 'active' --from "$ANVIL_ATTACKER"
LAYER="IDENTITY_NFT" expect_revert NFT_TRANSFER_ATTEMPT 'NonTransferable()' \
  "$UNICA_IDENTITY_TOKEN" 'transferFrom(address,address,uint256)' "$ANVIL_MERCHANT_OWNER" "$ANVIL_ATTACKER" 1 --from "$ANVIL_MERCHANT_OWNER"
LAYER="IDENTITY_NFT" expect_revert NFT_APPROVAL_ATTEMPT 'NonTransferable()' \
  "$UNICA_IDENTITY_TOKEN" 'approve(address,uint256)' "$ANVIL_ATTACKER" 1 --from "$ANVIL_MERCHANT_OWNER"
# The self-serve door is open to anyone, which is exactly why its three refusals matter: a name
# already taken, a name that is not a name, and a wallet that already runs a business.
LAYER="UNICA_ONCHAIN+ENSV2_ONCHAIN" expect_revert JOIN_LABEL_TAKEN 'LabelTaken(string)' \
  "$UNICA_ONBOARDING" 'join(string,address,string)' 'freshcuts' "$ANVIL_ATTACKER" 'register-1' --from "$ANVIL_ATTACKER"
LAYER="UNICA_ONCHAIN" expect_revert JOIN_BAD_LABEL 'LabelInvalid(string)' \
  "$UNICA_ONBOARDING" 'join(string,address,string)' 'Fresh Cuts!' "$ANVIL_ATTACKER" 'register-1' --from "$ANVIL_ATTACKER"
LAYER="UNICA_ONCHAIN" expect_revert JOIN_TWICE 'AlreadyJoined(address,bytes32)' \
  "$UNICA_ONBOARDING" 'join(string,address,string)' 'freshcuts-two' "$ANVIL_MERCHANT_PAYOUT" 'register-1' --from "$ANVIL_MERCHANT_OWNER"

step "C. evidence-layer decisions (GRAPH_EVIDENCE / CLIENT_VERIFICATION)"
HEAD=$(cast block-number --rpc-url "$UNICA_LOCAL_RPC")
ev() { node tools/unica-evidence/cli.mjs --manifest "$MANIFEST_PATH" "$@"; }
expect_decision() { # $1 case, $2 expected decision, rest: cli args
  local name=$1 want=$2; shift 2
  local out got
  out=$(ev "$@" 2>/dev/null || true)
  if [ -z "$out" ]; then out='{"decision":"NO_OUTPUT","reasonCodes":["CLI_PRINTED_NOTHING"]}'; fi
  got=$(json_get "$out" .decision)
  test "$got" = "$want" || die "$name: expected $want, got $got: $out"
  printf '{"case":"%s","decision":"%s","reasonCodes":%s}\n' "$name" "$got" "$(json_get "$out" .reasonCodes)"
}
expect_decision LOOKALIKE_HOOK REFUSED --order "$LOOK_ORDER" --rpc "$UNICA_LOCAL_RPC" --confirmations 0
expect_decision STALE_EVIDENCE UNKNOWN --order "$ORDER_ID" --rpc "$UNICA_LOCAL_RPC" --confirmations 0 --index-head 1
expect_decision UNFINALIZED_EVIDENCE UNKNOWN --order "$ORDER_ID" --rpc "$UNICA_LOCAL_RPC" --confirmations $((HEAD + 1000))
expect_decision EVIDENCE_ENDPOINT_UNAVAILABLE UNKNOWN --order "$ORDER_ID" --rpc http://127.0.0.1:9 --confirmations 0
# An order id with no receipt anywhere is not "unknown": the source answered and holds no settlement.
expect_decision UNPAID_ORDER_NO_RECEIPT REFUSED --order "$(cast keccak never-created)" --rpc "$UNICA_LOCAL_RPC" --confirmations 0
expect_decision LEGITIMATE_CONTROL VERIFIED --order "$ORDER_ID" --rpc "$UNICA_LOCAL_RPC" --confirmations 0

step "D. POS / wallet display states (unit rows: submitted is not PAID, reverted is FAILED, unknown is UNKNOWN, wrong network, wrong payer, expired, revoked terminal, label visible)"
POS_TEST_LOG="$REHEARSAL_DIR/attacks-pos.log"
for f in tools/unica-pos-cli/test/*.test.mjs tools/unica-evidence/test/*.test.mjs; do
  test -f "$f" || die "POS/evidence test file not found: $f"
  log "running $f"
  node --test "$f" >"$POS_TEST_LOG" 2>&1 || { grep -E 'not ok|Error|error' "$POS_TEST_LOG" | head -20; die "$f failed"; }
  grep -E '^# (tests|pass|fail)' "$POS_TEST_LOG" | tr '\n' ' '; echo
done

step "E. counterfeit identity NFT: same bytecode, attacker as minter, refused by provenance"
COUNTERFEIT=$(node tools/unica-pos-cli/cli.mjs --provenance-check "$MANIFEST_PATH" "$UNICA_LOOKALIKE_HOOK" 1)
printf '%s\n' "$COUNTERFEIT"
test "$(json_get "$COUNTERFEIT" .decision)" = "REFUSED" || die "a counterfeit identity contract was not refused"

log "attacks complete: every case refused or unknown, none paid."
