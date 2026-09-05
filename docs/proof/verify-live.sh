#!/usr/bin/env bash
# verify-live.sh — re-proves the live deploy AND the live settlement of the gated hook and its
# executor on Ethereum Sepolia from the chain, not from this repository's claims. Pure reads. Prints
# PASS/FAIL per check and a count at the end.
#   bash docs/proof/verify-live.sh [rpc-url] [deploy-record] [settle-record]
# Written before the deploy and run then as its own control: every chain check failed against the
# vacant addresses. Rewritten 2026-09-05 after the deploy landed, for three measured reasons: the
# pool id is now derived from the live key instead of a constant that named a pool which did not
# exist (that version passed its pre-deploy control and would have failed for the wrong reason
# after); the deploy record is read from the chain by transaction hash, because the labels the
# toolchain printed beside the hashes were wrong; and the settlement is its own record, because the
# first run lost it to a deadline (docs/DEPLOYMENT.md). Control after the rewrite, on a fork of the
# chain before any settlement: the settlement rows fail and the deploy rows pass.
set -uo pipefail
RPC="${1:-https://ethereum-sepolia-rpc.publicnode.com}"
DEPLOY_RECORD="${2:-broadcast/LiveFire.s.sol/11155111/run-latest.json}"
SETTLE_RECORD="${3:-broadcast/Interactions.s.sol/11155111/run-latest.json}"
HOOK=0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0
EXECUTOR=0x044bc8a8773EC7b9B8de2467766636dFFCaC6210
ROUTER=0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b
PM=0xE03A1074c86CFeDd5C142C4F04F1a1536e203543
SV=0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C
USDC=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
DEPLOYER=0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73
FACTORY=0x4e59b44847b379578588920cA78FbF26c0B4956C      # the deterministic CREATE2 factory both deploys went through
LIQ_ROUTER=0x0C478023803a644c94c4CE1C1e7b9A087e411B0A   # the PoolModifyLiquidityTest the seed stage calls on Sepolia
SQRT_2500=3961408125713216879677197                      # 2,500 USDC per ETH, the price the script chose (LiveFire.s.sol)
SIG_LIQ='getLiquidity(bytes32)(uint128)'
SIG_SLOT0='getSlot0(bytes32)(uint160,int24,uint24,uint24)'
SIG_COUNT='receiptCount()(uint256)'
SIG_ORDERS='orderCount()(uint256)'
SIG_VER='RECEIPT_SCHEMA_VERSION()(uint16)'
SIG_ORDER='orders(bytes32)'
SIG_BAL='balanceOf(address)(uint256)'
SIG_PAY='pay(bytes32)'
TTOPIC=$(cast keccak 'Transfer(address,address,uint256)')
ITOPIC=$(cast keccak 'Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)')
RTOPIC=$(cast keccak 'SettlementReceipt(bytes32,bytes32,address,uint16,address,address,address,address,uint128,uint128,uint128,bytes32)')
FTOPIC=$(cast keccak 'HookFee(bytes32,address,uint128,uint128)')
STOPIC=$(cast keccak 'Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)')
ok=0; fail=0
chk() { if eval "$2" >/dev/null 2>&1; then echo "PASS  $1"; ok=$((ok+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
# First value of the first line only: a tuple return prints one value per line.
call() { cast call "$1" "$2" ${3:-} --rpc-url "$RPC" 2>/dev/null | head -1 | awk '{print $1}'; }
lower() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }
# One transaction, from the chain by hash: "nonce to status logs hash". Never from the record's labels.
txrow() {
  local h=$1 r n
  r=$(cast receipt "$h" --rpc-url "$RPC" --json 2>/dev/null) || { echo "? ? ? ? $h"; return; }
  n=$(cast tx "$h" nonce --rpc-url "$RPC" 2>/dev/null || echo "?")
  printf '%s' "$r" | python3 -c "import sys,json;r=json.load(sys.stdin);hx=lambda v:int(v,16) if isinstance(v,str) else v;print('$n',(r.get('to') or '').lower(),hx(r['status']),len(r.get('logs',[])),'$h')"
}
hashes_of() { python3 -c "import json;print('\n'.join(t['hash'] for t in json.load(open('$1'))['transactions']))" 2>/dev/null; }
receipt_has() { cast receipt "$1" --rpc-url "$RPC" --json 2>/dev/null | python3 -c "import sys,json;r=json.load(sys.stdin);print(any(l['address'].lower()=='$(lower $2)' and l['topics'][0]=='$3' for l in r['logs']))" 2>/dev/null; }

echo "# live verification against $RPC, $(date -u +%Y-%m-%dT%H:%M:%SZ)"
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

# The pool: its id is keccak256(abi.encode(key)) of the live key, computed here, never pasted.
POOLID=$(cast keccak "$(cast abi-encode 'f((address,address,uint24,int24,address))' "(0x0000000000000000000000000000000000000000,$USDC,3000,60,$HOOK)")")
echo "# pool id from the live key (native ETH / USDC, fee 3000, spacing 60, this hook): $POOLID"
price=$(call $SV "$SIG_SLOT0" $POOLID); liq=$(call $SV "$SIG_LIQ" $POOLID)
chk "pool is initialised (StateView slot0 sqrtPriceX96 non-zero; now $price)" "[ -n \"$price\" ] && [ \"$price\" != 0 ]"
chk "pool has liquidity (StateView; now $liq)" "[ -n \"$liq\" ] && [ \"$liq\" -gt 0 ]"

# The deploy record, read from the chain by hash and ordered by nonce.
dhashes=$(hashes_of "$DEPLOY_RECORD"); n_d=$(printf '%s\n' "$dhashes" | grep -c . || true)
dtable=$(for h in $dhashes; do txrow "$h"; done | sort -n)
landed=$(printf '%s\n' "$dtable" | awk '$3==1{printf "%s:%s ", $1, $2}')
failedrows=$(printf '%s\n' "$dtable" | awk '$3==0{printf "%s:%s:%s ", $1, $2, $4}')
inithash=$(printf '%s\n' "$dtable" | awk '$1==452{print $5}')
chk "deploy record holds seven transactions" "[ \"$n_d\" = 7 ]"
chk "five landed, in nonce order: hook and executor through the CREATE2 factory, initialise on the PoolManager, approve on USDC, seed on the liquidity router" "[ \"$landed\" = \"450:$(lower $FACTORY) 451:$(lower $FACTORY) 452:$(lower $PM) 453:$(lower $USDC) 454:$(lower $LIQ_ROUTER) \" ]"
chk "two failed, both calls to the executor with no logs: createOrder at 455 (DeadlineInPast) and pay at 456 (no order), the documented loss of the first settlement" "[ \"$failedrows\" = \"455:$(lower $EXECUTOR):0 456:$(lower $EXECUTOR):0 \" ]"
initprice=$(cast receipt "$inithash" --rpc-url "$RPC" --json 2>/dev/null | python3 -c "import sys,json;r=json.load(sys.stdin);l=[l for l in r['logs'] if l['address'].lower()=='$(lower $PM)' and l['topics'][0]=='$ITOPIC' and l['topics'][1]=='$POOLID'];print(int(l[0]['data'][2:][64*3:64*4],16) if l else '')" 2>/dev/null)
chk "the pool was initialised at 2,500 USDC per ETH (the Initialize event of the deploy's own transaction, for this pool id)" "[ \"$initprice\" = $SQRT_2500 ]"

# The settlement: counters, then its own record, then the transaction itself.
chk "hook.receiptCount is at least 1" "[ \"\$(call $HOOK \"$SIG_COUNT\")\" -ge 1 ]"
chk "executor.orderCount is at least 1" "[ \"\$(call $EXECUTOR \"$SIG_ORDERS\")\" -ge 1 ]"
shashes=$(hashes_of "$SETTLE_RECORD"); n_s=$(printf '%s\n' "$shashes" | grep -c . || true)
stable=$(for h in $shashes; do txrow "$h"; done | sort -n)
stargets=$(printf '%s\n' "$stable" | awk '{printf "%s:%s ", $2, $3}')
chk "settle record holds two transactions, both to the executor, both landed (createOrder, pay)" "[ \"$n_s\" = 2 ] && [ \"$stargets\" = \"$(lower $EXECUTOR):1 $(lower $EXECUTOR):1 \" ]"
settle=""; for h in $shashes; do if [ "$(receipt_has "$h" $HOOK $RTOPIC)" = True ]; then settle=$h; break; fi; done
chk "the settle transaction carries SettlementReceipt v1 from the hook" "[ -n \"$settle\" ]"
chk "the settle transaction carries HookFee from the hook" "[ -n \"$settle\" ] && [ \"\$(receipt_has $settle $HOOK $FTOPIC)\" = True ]"
chk "the settle transaction's swap was sent by the Universal Router (PoolManager Swap event sender)" "[ -n \"$settle\" ] && [ \"\$(cast receipt $settle --rpc-url $RPC --json | python3 -c \"import sys,json;r=json.load(sys.stdin);print(any(l['address'].lower()=='$(lower $PM)' and l['topics'][0]=='$STOPIC' and l['topics'][2][-40:].lower()=='$(lower ${ROUTER#0x})' for l in r['logs']))\")\" = True ]"
rlog=$( [ -n "$settle" ] && cast receipt "$settle" --rpc-url "$RPC" --json 2>/dev/null | python3 -c "import sys,json;r=json.load(sys.stdin);l=[l for l in r['logs'] if l['address'].lower()=='$(lower $HOOK)' and l['topics'][0]=='$RTOPIC'];print(l[0]['topics'][1] if l else '');print(int(l[0]['data'][2:][64*6:64*7],16) if l else 0)" 2>/dev/null || printf '\n0')
orderId=$(printf '%s' "$rlog" | sed -n 1p); receiptedOut=$(printf '%s' "$rlog" | sed -n 2p)
chk "the receipt names an order" "[ -n \"$orderId\" ] && [ \"$orderId\" != 0x ]"
chk "the order the receipt names is Settled and cannot be paid again (status 3)" "[ -n \"$orderId\" ] && [ \"\$(cast call $EXECUTOR \"$SIG_ORDER\" $orderId --rpc-url $RPC 2>/dev/null | tail -1 | awk '{print \$1}')\" = 3 ]"
chk "a replay of pay(orderId) is refused (eth_call reverts)" "[ -n \"$orderId\" ] && ! cast call $EXECUTOR \"$SIG_PAY\" $orderId --value 1000000000000000 --from $DEPLOYER --rpc-url $RPC >/dev/null 2>&1"
chk "the recipient's USDC transfer in the settle transaction equals the receipted amountOut" "[ -n \"$settle\" ] && [ \"\$(cast receipt $settle --rpc-url $RPC --json | python3 -c \"import sys,json;r=json.load(sys.stdin);t=[l for l in r['logs'] if l['address'].lower()=='$(lower $USDC)' and l['topics'][0]=='$TTOPIC' and l['topics'][2][-40:].lower()=='$(lower ${DEPLOYER#0x})'];print(int(t[-1]['data'],16) if t else -1)\")\" = \"$receiptedOut\" ]"
chk "the receipted amountOut is at least the 1.5 USDC minimum the order asked for" "[ -n \"$receiptedOut\" ] && [ \"$receiptedOut\" -ge 1500000 ]"
chk "no residual native balance on the executor" "[ \"\$(cast balance $EXECUTOR --rpc-url $RPC)\" = 0 ]"
chk "no residual USDC on the executor" "[ \"\$(call $USDC \"$SIG_BAL\" $EXECUTOR)\" = 0 ]"
chk "no residual USDC on the router" "[ \"\$(call $USDC \"$SIG_BAL\" $ROUTER)\" = 0 ]"
chk "Sourcify: hook source verified" "curl -sf https://sourcify.dev/server/v2/contract/11155111/$HOOK | grep -q '\"match\":\"'"
chk "Sourcify: executor source verified" "curl -sf https://sourcify.dev/server/v2/contract/11155111/$EXECUTOR | grep -q '\"match\":\"'"
echo "checks run: $((ok+fail)), passed: $ok, failed: $fail"
