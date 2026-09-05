#!/usr/bin/env bash
# local-e2e.sh — settlement input → official Uniswap-compatible execution path → V4SettlementHook
# → one receipt → graph-node handler → a queryable Settlement entity, entirely local. Then a
# refused payment, and the entity count does not move. No credentials, no Studio, no broadcast:
# anvil forks Sepolia, the deployer is impersonated, graph-node runs in Docker against the fork.
# Usage: DEPLOYER=<public address> bash integrations/graph/local-e2e.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
RPC="${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}"
DEPLOYER="${DEPLOYER:?set DEPLOYER to the public address of the deployer}"
PORT="${PORT:-8546}"
LOCAL="http://127.0.0.1:$PORT"
NODE="http://localhost:8020"
IPFS="http://localhost:5001"
QUERY="http://localhost:8000/subgraphs/name/unica/settlement"
NAME="unica/settlement"
BROADCAST="$REPO/.rehearsal/e2e-broadcast"
SIG_PAY='pay(bytes32)'
QUERY_JSON='{"query":"{ settlements(orderBy: logIndex) { id orderId poolId payer recipient currencyIn currencyOut amountIn amountOut fee policyId executor hook schemaVersion blockNumber transactionHash logIndex } }"}'

cleanup() {
  kill "${ANVIL:-}" 2>/dev/null || true
  docker compose -f "$HERE/local/docker-compose.yml" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== 1. fork $(printf '%s' "$RPC" | cut -d/ -f3) on :$PORT"
# The head by default. After 2026-09-05 the head holds the live deployment, and this run indexes it
# as it stands: the live receipt plus one fresh settlement. FORK_BLOCK_NUMBER=<block> forks earlier so
# the stages deploy a fresh pool instead; that needs an RPC with state at that block, which the
# public node does not keep (measured: "historical state ... is not available" at 11639894).
if [ -n "${FORK_BLOCK_NUMBER:-}" ]; then
  anvil --fork-url "$RPC" --fork-block-number "$FORK_BLOCK_NUMBER" --port "$PORT" --auto-impersonate --silent &
else
  anvil --fork-url "$RPC" --port "$PORT" --auto-impersonate --silent &
fi
ANVIL=$!
for _ in $(seq 1 60); do cast chain-id --rpc-url "$LOCAL" >/dev/null 2>&1 && break; sleep 0.5; done
FORK_BLOCK=$(cast block-number --rpc-url "$LOCAL")
echo "chain $(cast chain-id --rpc-url "$LOCAL") at block $FORK_BLOCK"

cd "$REPO"
HOOK=$(forge script script/LiveFire.s.sol:LiveFire --sig "predict()" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
EXECUTOR=$(forge script script/LiveFire.s.sol:LiveFire --sig "predictExecutor()" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
if [ "$(cast code "$HOOK" --rpc-url "$LOCAL")" != "0x" ]; then
  LIVE=1
  echo "== 2. the live deployment is on the fork: hook $HOOK, executor $EXECUTOR; the deploy, init and seed stages are skipped"
else
  LIVE=0
  echo "== 2. deploy, initialise, seed on the fork (the repository's own stages)"
  for stage in "DeploySettlement.s.sol:DeploySettlement" "Interactions.s.sol:InitPool" "Interactions.s.sol:SeedLiquidity"; do
    FOUNDRY_BROADCAST="$BROADCAST" forge script "script/$stage" --rpc-url "$LOCAL" --unlocked --sender "$DEPLOYER" --broadcast -q >/dev/null
    echo "   $stage: done"
  done
fi
echo "hook $HOOK  executor $EXECUTOR  (code: $(cast code "$HOOK" --rpc-url "$LOCAL" | wc -c | tr -d ' ') / $(cast code "$EXECUTOR" --rpc-url "$LOCAL" | wc -c | tr -d ' ') hex chars)"

echo "== 3. graph-node, ipfs, postgres"
docker compose -f "$HERE/local/docker-compose.yml" up -d >/dev/null
for _ in $(seq 1 120); do curl -s "$NODE" -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"subgraph_create","params":{"name":"probe"}}' >/dev/null 2>&1 && break; sleep 1; done
echo "graph-node admin endpoint answering"

echo "== 4. the manifest for THIS deployment"
cd "$HERE"
if [ "$LIVE" = 1 ]; then
  # The committed network map names the live deployment; the fork's hook must be that address.
  START=$(python3 -c "import json;n=json.load(open('networks.json'))['sepolia']['V4SettlementHook'];assert n['address'].lower()=='$HOOK'.lower(), n['address'];print(n['startBlock'])")
  echo "   the live deployment: address from the fork, start block $START from the committed networks.json (the deploy block)"
else
  START=$FORK_BLOCK
  echo "   address and start block from the fork, nothing hard-coded"
fi
python3 - "$HOOK" "$START" <<'PY'
import json, sys
json.dump({"sepolia": {"V4SettlementHook": {"address": sys.argv[1], "startBlock": int(sys.argv[2])}}}, open("networks.local.json", "w"), indent=2)
PY
# graph build --network rewrites the manifest it is given, so it is given a copy: the committed
# subgraph.yaml keeps the zero placeholder, and subgraph.local.yaml (ignored) carries this fork's
# address and start block.
cp subgraph.yaml subgraph.local.yaml
npx graph codegen subgraph.local.yaml >/dev/null
npx graph build subgraph.local.yaml --network sepolia --network-file networks.local.json >/dev/null
npx graph create --node "$NODE" "$NAME" >/dev/null
npx graph deploy --node "$NODE" --ipfs "$IPFS" --version-label v0.1.0 --network sepolia --network-file networks.local.json "$NAME" subgraph.local.yaml 2>&1 | grep -E "Deployed|Build completed|error" | head -3
git -C "$HERE" diff --quiet -- subgraph.yaml || { echo "FAIL: the committed manifest was modified by the build"; exit 1; }

echo "== 5. one settlement through the executor and the official router"
cd "$REPO"
USDC=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
RTOPIC=$(cast keccak 'SettlementReceipt(bytes32,bytes32,address,uint16,address,address,address,address,uint128,uint128,uint128,bytes32)')
if [ "$LIVE" = 1 ]; then
  # The settle stage's order asks for 1.5 USDC and the live pool no longer pays that for 0.001 ETH
  # (docs/DEPLOYMENT.md, "Protecting the live pool"); the hook would refuse it, which is the
  # invariant. So the executor is driven the way any application drives it: createOrder with a
  # minimum of one unit and a fresh salt, then pay. Same path, same hook, same receipt.
  SALT=$(cast keccak "e2e $(date +%s)")
  ORDER_ID=$(cast keccak "$(cast abi-encode 'f(uint256,address,address,bytes32)' 11155111 "$EXECUTOR" "$DEPLOYER" "$SALT")")
  DEADLINE=$(( $(cast block latest --field timestamp --rpc-url "$LOCAL") + 86400 ))
  cast send "$EXECUTOR" "createOrder(address,(address,address,uint24,int24,address),uint128,uint128,uint64,bytes32)" "$DEPLOYER" "(0x0000000000000000000000000000000000000000,$USDC,3000,60,$HOOK)" 1000000000000000 1 "$DEADLINE" "$SALT" --unlocked --from "$DEPLOYER" --rpc-url "$LOCAL" >/dev/null
  PAY=$(cast send "$EXECUTOR" "$SIG_PAY" "$ORDER_ID" --value 1000000000000000 --unlocked --from "$DEPLOYER" --rpc-url "$LOCAL" --json)
  FORK_OUT=$(printf '%s' "$PAY" | python3 -c "import sys,json;r=json.load(sys.stdin);l=[l for l in r['logs'] if l['address'].lower()=='$HOOK'.lower() and l['topics'][0]=='$RTOPIC'];print(int(l[0]['data'][2:][64*6:64*7],16) if l else -1)")
  echo "   fork settlement: receipted amountOut $FORK_OUT, block $(printf '%s' "$PAY" | python3 -c "import sys,json;print(int(json.load(sys.stdin)['blockNumber'],16))")"
  EXPECTED=2
else
  SETTLE_LOG=$(FOUNDRY_BROADCAST="$BROADCAST" ORDER_SALT=e2e forge script script/Interactions.s.sol:Settle --rpc-url "$LOCAL" --unlocked --sender "$DEPLOYER" --broadcast 2>&1)
  ORDER_ID=$(printf '%s' "$SETTLE_LOG" | grep -A1 "order id" | grep -oE '0x[0-9a-f]{64}' | head -1)
  printf '%s\n' "$SETTLE_LOG" | grep -E "receiptCount|USDC received" | sed 's/^/   /'
  FORK_OUT=""
  EXPECTED=1
fi
echo "order id $ORDER_ID"

echo "== 6. the entities, reconstructed from the logs by the handler (expected: $EXPECTED)"
COUNT=0
for _ in $(seq 1 240); do
  RESP=$(curl -s "$QUERY" -X POST -H 'content-type: application/json' -d "$QUERY_JSON")
  COUNT=$(printf '%s' "$RESP" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("data",{}).get("settlements") or []))' 2>/dev/null || echo 0)
  [ "$COUNT" = "$EXPECTED" ] && break
  sleep 2
done
printf '%s\n' "$RESP" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(d, indent=2))' | head -60
test "$COUNT" = "$EXPECTED" || { echo "FAIL: expected $EXPECTED Settlement entities, got $COUNT"; exit 1; }
printf '%s' "$RESP" | grep -q "$ORDER_ID" || { echo "FAIL: no entity carries the order id this run paid"; exit 1; }
# The response travels in the environment: a heredoc is python's stdin, so a pipe here would be lost.
RESP="$RESP" python3 - "$HOOK" "$EXECUTOR" "$LIVE" "$ORDER_ID" "$FORK_OUT" <<'PY'
import json,sys,os
hook,executor,live,order_id,fork_out=sys.argv[1:6]
ds=json.loads(os.environ["RESP"])['data']['settlements']
for d in ds:
    assert d['hook'].lower()==hook.lower(), d['hook']; assert d['executor'].lower()==executor.lower(), d['executor']; assert d['schemaVersion']==1
print("every entity names this hook and executor at schema version 1")
if live=="1":
    LIVE_TX="0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83"
    lv=[d for d in ds if d['transactionHash'].lower()==LIVE_TX]
    assert len(lv)==1, "the live receipt was indexed %d times" % len(lv)
    assert lv[0]['orderId'].lower()=="0x72b25a9b4e6f89138766bb0251a1fc41f8da15efb0d87f058390da1737aab8e9" and int(lv[0]['amountOut'])==2003660 and int(lv[0]['logIndex'])==107, lv[0]  # the live settlement: order id, receipt values
    print("the live receipt (block 11640026, log 107) is indexed exactly once with its on-chain values")
    fk=[d for d in ds if d['orderId'].lower()==order_id.lower()]
    assert len(fk)==1 and int(fk[0]['amountOut'])==int(fork_out), fk
    print("the fork settlement is indexed once with the amountOut its receipt carries")
PY

echo "== 7. a refused payment: the same order paid again reverts on chain, and the count does not move"
set +e
cast send "$EXECUTOR" "$SIG_PAY" "$ORDER_ID" --value 1000000000000000 --unlocked --from "$DEPLOYER" --rpc-url "$LOCAL" >/dev/null 2>&1
RC=$?
set -e
test "$RC" -ne 0 || { echo "FAIL: a second payment of a settled order did not revert"; exit 1; }
echo "   second pay reverted (exit $RC)"
sleep 4
RESP=$(curl -s "$QUERY" -X POST -H 'content-type: application/json' -d "$QUERY_JSON")
COUNT=$(printf '%s' "$RESP" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["data"]["settlements"]))')
test "$COUNT" = "$EXPECTED" || { echo "FAIL: the refused payment produced an entity"; exit 1; }
echo "   entities after the refusal: $COUNT"

echo "== RESULT: settlement → V4SettlementHook → receipt → graph-node → $EXPECTED Settlement entities (the live receipt among them when the fork holds the live deployment); refused path → no entity. Local, no credentials, nothing broadcast to Sepolia."
