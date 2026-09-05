#!/usr/bin/env bash
# verify-day4.sh — re-proves the day-4 live deploy of the gated hook and its executor on Ethereum
# Sepolia from the chain, not from this repository's claims. Pure reads. Prints PASS/FAIL per check
# and a count at the end. Written before the deploy and run then as its own control: every chain
# check below was seen to FAIL against the vacant addresses, so a PASS afterwards means something.
#   bash docs/proof/verify-day4.sh [rpc-url] [broadcast-record]
set -uo pipefail
RPC="${1:-https://ethereum-sepolia-rpc.publicnode.com}"
RECORD="${2:-broadcast/LiveFire.s.sol/11155111/run-latest.json}"
HOOK=0xe478371d804EF56D8e84403F8D97F6184bdEc0C0
EXECUTOR=0x338Faac2D716AEBFd265EBc8DDf46664155eba72
ROUTER=0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b
PM=0xE03A1074c86CFeDd5C142C4F04F1a1536e203543
SV=0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C
POOLID=0x5770cd967059ebb7fdefa3eb16888578e2c74670b98e5a1a38d43c5e7100bc7b
SIG_LIQ='getLiquidity(bytes32)(uint128)'
SIG_SLOT0='getSlot0(bytes32)(uint160,int24,uint24,uint24)'
SIG_COUNT='receiptCount()(uint256)'
SIG_ORDERS='orderCount()(uint256)'
SIG_VER='RECEIPT_SCHEMA_VERSION()(uint16)'
ok=0; fail=0
chk() { if eval "$2" >/dev/null 2>&1; then echo "PASS  $1"; ok=$((ok+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
# First value of the first line only: a tuple return prints one value per line, and the first
# version of this helper read all of them, so an uninitialised pool's four zeros compared unequal
# to "0" and the check passed before the deploy (caught by running the script as its own control).
call() { cast call "$1" "$2" ${3:-} --rpc-url "$RPC" 2>/dev/null | head -1 | awk '{print $1}'; }

echo "# day-4 verification against $RPC, $(date -u +%Y-%m-%dT%H:%M:%SZ)"
chk "chain id is 11155111" "[ \"\$(cast chain-id --rpc-url $RPC)\" = 11155111 ]"
hcode=$(cast code $HOOK --rpc-url "$RPC" 2>/dev/null); ecode=$(cast code $EXECUTOR --rpc-url "$RPC" 2>/dev/null)
chk "hook has runtime code at $HOOK (10302 bytes)" "[ \$(( (\${#hcode}-2)/2 )) = 10302 ]"
chk "executor has runtime code at $EXECUTOR (10606 bytes)" "[ \$(( (\${#ecode}-2)/2 )) = 10606 ]"
chk "hook.poolManager is the official PoolManager" "[ \"\$(call $HOOK 'poolManager()(address)')\" = $PM ]"
chk "hook.UNIVERSAL_ROUTER is Uniswap's Sepolia Universal Router" "[ \"\$(call $HOOK 'UNIVERSAL_ROUTER()(address)')\" = $ROUTER ]"
chk "hook.SETTLEMENT_EXECUTOR is the executor" "[ \"\$(call $HOOK 'SETTLEMENT_EXECUTOR()(address)')\" = $EXECUTOR ]"
chk "executor.HOOK is the hook (bound both ways)" "[ \"\$(call $EXECUTOR 'HOOK()(address)')\" = $HOOK ]"
chk "executor.UNIVERSAL_ROUTER is the same router" "[ \"\$(call $EXECUTOR 'UNIVERSAL_ROUTER()(address)')\" = $ROUTER ]"
chk "receipt schema version is 1" "[ \"\$(call $HOOK \"$SIG_VER\")\" = 1 ]"
chk "hook.receiptCount is at least 1" "[ \"\$(call $HOOK \"$SIG_COUNT\")\" -ge 1 ]"
chk "executor.orderCount is at least 1" "[ \"\$(call $EXECUTOR \"$SIG_ORDERS\")\" -ge 1 ]"
chk "pool is initialised (slot0 sqrtPriceX96 non-zero)" "[ \"\$(call $SV \"$SIG_SLOT0\" $POOLID)\" != 0 ] && [ -n \"\$(call $SV \"$SIG_SLOT0\" $POOLID)\" ]"
chk "pool has liquidity" "[ \"\$(call $SV \"$SIG_LIQ\" $POOLID)\" -gt 0 ]"
chk "broadcast record: 7 receipts, all status 0x1" "[ \"\$(python3 -c \"import json;r=json.load(open('$RECORD'));print(len(r['receipts']),sorted(set(x['status'] for x in r['receipts'])))\")\" = \"7 ['0x1']\" ]"
settle=$(python3 -c "import json;r=json.load(open('$RECORD'));print(r['receipts'][-1]['transactionHash'])" 2>/dev/null)
rtopic=$(cast keccak 'SettlementReceipt(bytes32,bytes32,address,uint16,address,address,address,address,uint128,uint128,uint128,bytes32)')
ftopic=$(cast keccak 'HookFee(bytes32,address,uint128,uint128)')
chk "the settle transaction carries SettlementReceipt v1 from the hook" "[ \"\$(cast receipt $settle --rpc-url $RPC --json | python3 -c \"import sys,json;r=json.load(sys.stdin);print(any(l['address'].lower()=='$HOOK'.lower() and l['topics'][0]=='$rtopic' for l in r['logs']))\")\" = True ]"
chk "the settle transaction carries HookFee from the hook" "[ \"\$(cast receipt $settle --rpc-url $RPC --json | python3 -c \"import sys,json;r=json.load(sys.stdin);print(any(l['address'].lower()=='$HOOK'.lower() and l['topics'][0]=='$ftopic' for l in r['logs']))\")\" = True ]"
chk "the settle transaction's swap was sent by the Universal Router (PoolManager Swap event sender)" "[ \"\$(cast receipt $settle --rpc-url $RPC --json | python3 -c \"import sys,json;r=json.load(sys.stdin);t='\$(cast keccak 'Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)')';print(any(l['address'].lower()=='$PM'.lower() and l['topics'][0]==t and l['topics'][2][-40:].lower()=='$ROUTER'[2:].lower() for l in r['logs']))\")\" = True ]"
chk "Sourcify: hook source verified" "curl -sf https://sourcify.dev/server/v2/contract/11155111/$HOOK | grep -q '\"match\":\"'"
chk "Sourcify: executor source verified" "curl -sf https://sourcify.dev/server/v2/contract/11155111/$EXECUTOR | grep -q '\"match\":\"'"
echo "checks run: $((ok+fail)), passed: $ok, failed: $fail"
