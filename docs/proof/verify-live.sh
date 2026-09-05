#!/usr/bin/env bash
# verify-live.sh — re-proves the live deploy of the gated hook and its executor on Ethereum
# Sepolia from the chain, not from this repository's claims. Pure reads. Prints PASS/FAIL per check
# and a count at the end. Written before the deploy and run then as its own control: every chain
# check below was seen to FAIL against the vacant addresses, so a PASS afterwards means something.
#   bash docs/proof/verify-live.sh [rpc-url] [broadcast-record]
set -uo pipefail
RPC="${1:-https://ethereum-sepolia-rpc.publicnode.com}"
RECORD="${2:-broadcast/LiveFire.s.sol/11155111/run-latest.json}"
HOOK=0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0
EXECUTOR=0x044bc8a8773EC7b9B8de2467766636dFFCaC6210
ROUTER=0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b
PM=0xE03A1074c86CFeDd5C142C4F04F1a1536e203543
SV=0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C
POOLID=0x5770cd967059ebb7fdefa3eb16888578e2c74670b98e5a1a38d43c5e7100bc7b
SIG_LIQ='getLiquidity(bytes32)(uint128)'
SIG_SLOT0='getSlot0(bytes32)(uint160,int24,uint24,uint24)'
SIG_COUNT='receiptCount()(uint256)'
SIG_ORDERS='orderCount()(uint256)'
SIG_VER='RECEIPT_SCHEMA_VERSION()(uint16)'
SIG_ORDER='orders(bytes32)'
SIG_BAL='balanceOf(address)(uint256)'
SIG_PAY='pay(bytes32)'
USDC=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
DEPLOYER=0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73
TTOPIC=$(cast keccak 'Transfer(address,address,uint256)')
ok=0; fail=0
chk() { if eval "$2" >/dev/null 2>&1; then echo "PASS  $1"; ok=$((ok+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
# First value of the first line only: a tuple return prints one value per line, and the first
# version of this helper read all of them, so an uninitialised pool's four zeros compared unequal
# to "0" and the check passed before the deploy (caught by running the script as its own control).
call() { cast call "$1" "$2" ${3:-} --rpc-url "$RPC" 2>/dev/null | head -1 | awk '{print $1}'; }

echo "# live-deploy verification against $RPC, $(date -u +%Y-%m-%dT%H:%M:%SZ)"
chk "chain id is 11155111" "[ \"\$(cast chain-id --rpc-url $RPC)\" = 11155111 ]"
hcode=$(cast code $HOOK --rpc-url "$RPC" 2>/dev/null); ecode=$(cast code $EXECUTOR --rpc-url "$RPC" 2>/dev/null)
chk "hook has runtime code at $HOOK (10634 bytes)" "[ \$(( (\${#hcode}-2)/2 )) = 10634 ]"
chk "executor has runtime code at $EXECUTOR (11289 bytes)" "[ \$(( (\${#ecode}-2)/2 )) = 11289 ]"
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
# The receipt itself, decoded: which order, and how much the recipient received according to the hook.
rlog=$(cast receipt "$settle" --rpc-url "$RPC" --json 2>/dev/null | python3 -c "import sys,json;r=json.load(sys.stdin);l=[l for l in r['logs'] if l['address'].lower()=='$HOOK'.lower() and l['topics'][0]=='$rtopic'];print(l[0]['topics'][1] if l else '');print(int(l[0]['data'][2:][64*6:64*7],16) if l else 0)" 2>/dev/null)
orderId=$(printf '%s' "$rlog" | sed -n 1p); receiptedOut=$(printf '%s' "$rlog" | sed -n 2p)
chk "the receipt names an order" "[ -n \"$orderId\" ] && [ \"$orderId\" != 0x ]"
chk "the order the receipt names is Settled and cannot be paid again (status 3)" "[ \"\$(cast call $EXECUTOR \"$SIG_ORDER\" $orderId --rpc-url $RPC 2>/dev/null | tail -1 | awk '{print \$1}')\" = 3 ]"
chk "a replay of pay(orderId) is refused (eth_call reverts)" "! cast call $EXECUTOR \"$SIG_PAY\" $orderId --value 1000000000000000 --from $DEPLOYER --rpc-url $RPC >/dev/null 2>&1"
chk "the recipient's USDC transfer in the settle transaction equals the receipted amountOut" "[ \"\$(cast receipt $settle --rpc-url $RPC --json | python3 -c \"import sys,json;r=json.load(sys.stdin);t=[l for l in r['logs'] if l['address'].lower()=='$USDC'.lower() and l['topics'][0]=='$TTOPIC' and l['topics'][2][-40:].lower()=='$DEPLOYER'[2:].lower()];print(int(t[-1]['data'],16) if t else -1)\")\" = \"$receiptedOut\" ]"
chk "the receipted amountOut is at least the 1.5 USDC minimum the order asked for" "[ \"$receiptedOut\" -ge 1500000 ]"
chk "no residual native balance on the executor" "[ \"\$(cast balance $EXECUTOR --rpc-url $RPC)\" = 0 ]"
chk "no residual USDC on the executor" "[ \"\$(call $USDC \"$SIG_BAL\" $EXECUTOR)\" = 0 ]"
chk "no residual USDC on the router" "[ \"\$(call $USDC \"$SIG_BAL\" $ROUTER)\" = 0 ]"
chk "every receipt in the record maps to an intended target (executor, hook, PoolManager, USDC, the liquidity router, executor, executor)" "[ \"\$(python3 -c \"import json;r=json.load(open('$RECORD'));print(','.join(((x.get('contractName') or x['transaction']['to'] or '')[:10]).lower() for x in r['transactions']))\")\" = \"settlement,v4settleme,0xe03a1074,0x1c7d4b19,0x0c478023,settlement,settlement\" ]"
chk "Sourcify: hook source verified" "curl -sf https://sourcify.dev/server/v2/contract/11155111/$HOOK | grep -q '\"match\":\"'"
chk "Sourcify: executor source verified" "curl -sf https://sourcify.dev/server/v2/contract/11155111/$EXECUTOR | grep -q '\"match\":\"'"
echo "checks run: $((ok+fail)), passed: $ok, failed: $fail"
