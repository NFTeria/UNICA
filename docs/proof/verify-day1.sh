#!/usr/bin/env bash
# verify-day1.sh — re-proves the day-1 live-fire on Ethereum Sepolia from the chain, not from this
# repository's claims. Pure reads. Prints PASS/FAIL per check and a count at the end.
#   bash docs/proof/verify-day1.sh [rpc-url]
set -uo pipefail
RPC="${1:-https://ethereum-sepolia-rpc.publicnode.com}"
HOOK=0x23b46783709E4A94C229612bfA55580a6682c040
POOLID=0xaffd50d25121496e627f2d9574f160fee32829f04a945de1dbfea5af3668fde7
SV=0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C
SWAP=0x6d580aef7b3d8848fcee555ab8cd7c28fa28c1abeb4d538455be349d0a8a06bf
TXS="0x0171976a8716d2084890d8cfa155924fcf7b315b03263f1015d6794cee34b8da 0xe7cc4bbc094938ca3c74857d585f4e53cecc6161ae579e8838e11a32084df08b 0x7e56b7ca63d2ccf0be66f73f2e728bf20de645581a8aba5de7f9e5fc103e3213 0xb535627674e56b751d88335688021aa2cfc2e34dc6d749dc8f4a920da425baae $SWAP"
SIG_LIQ='getLiquidity(bytes32)(uint128)'
SIG_COUNT='afterSwapCount()(uint256)'
ok=0; fail=0
chk() { if eval "$2" >/dev/null 2>&1; then echo "PASS  $1"; ok=$((ok+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
status_of() { cast receipt "$1" --rpc-url "$RPC" --json 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])'; }
block_of()  { cast receipt "$1" --rpc-url "$RPC" --json 2>/dev/null | python3 -c 'import sys,json;print(int(json.load(sys.stdin)["blockNumber"],16))'; }

echo "# day-1 verification against $RPC, $(date -u +%Y-%m-%dT%H:%M:%SZ)"
chk "chain id is 11155111" "[ \"\$(cast chain-id --rpc-url $RPC)\" = 11155111 ]"
for h in $TXS; do
  chk "receipt status 1, block 11635908: ${h:0:12}" "[ \"\$(status_of $h)\" = 0x1 ] && [ \"\$(block_of $h)\" = 11635908 ]"
done
code=$(cast code $HOOK --rpc-url "$RPC" 2>/dev/null)
chk "hook has runtime code at $HOOK (6051 bytes)" "[ \$(( (\${#code}-2)/2 )) = 6051 ]"
chk "hook.poolManager is the official PoolManager" "[ \"\$(cast call $HOOK 'poolManager()(address)' --rpc-url $RPC)\" = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543 ]"
chk "pool liquidity is 400000000000" "[ \"\$(cast call $SV \"$SIG_LIQ\" $POOLID --rpc-url $RPC | awk '{print \$1}')\" = 400000000000 ]"
chk "afterSwapCount is at least 1" "[ \"\$(cast call $HOOK \"$SIG_COUNT\" --rpc-url $RPC | awk '{print \$1}')\" -ge 1 ]"
topic=$(cast keccak 'AfterSwapObserved(address,bytes32,int256)')
chk "swap receipt carries AfterSwapObserved from the hook" "[ \"\$(cast receipt $SWAP --rpc-url $RPC --json | python3 -c \"import sys,json;r=json.load(sys.stdin);print(any(l['address'].lower()=='$HOOK'.lower() and l['topics'][0]=='$topic' for l in r['logs']))\")\" = True ]"
chk "swap receipt carries the PoolManager Swap event" "[ \"\$(cast receipt $SWAP --rpc-url $RPC --json | python3 -c \"import sys,json;r=json.load(sys.stdin);print(any(l['topics'][0]=='\$(cast keccak 'Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)')' for l in r['logs']))\")\" = True ]"
if [ -f broadcast/LiveFire.s.sol/11155111/run-1788555540752.json ]; then
  chk "committed broadcast record: 5 receipts, all status 0x1" "[ \"\$(python3 -c \"import json;r=json.load(open('broadcast/LiveFire.s.sol/11155111/run-1788555540752.json'));print(len(r['receipts']), sorted(set(x['status'] for x in r['receipts'])))\")\" = \"5 ['0x1']\" ]"
  chk "broadcast record carries no secret-shaped field" "! grep -qiE 'PRIVATE_KEY|MNEMONIC|password|\"ciphertext\"' broadcast/LiveFire.s.sol/11155111/run-1788555540752.json"
fi
echo "checks run: $((ok+fail)), passed: $ok, failed: $fail"
[ "$fail" = 0 ]
