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
anvil --fork-url "$RPC" --port "$PORT" --auto-impersonate --silent &
ANVIL=$!
for _ in $(seq 1 60); do cast chain-id --rpc-url "$LOCAL" >/dev/null 2>&1 && break; sleep 0.5; done
FORK_BLOCK=$(cast block-number --rpc-url "$LOCAL")
echo "chain $(cast chain-id --rpc-url "$LOCAL") at block $FORK_BLOCK"

echo "== 2. deploy, initialise, seed on the fork (the repository's own stages)"
cd "$REPO"
for stage in "DeploySettlement.s.sol:DeploySettlement" "Interactions.s.sol:InitPool" "Interactions.s.sol:SeedLiquidity"; do
  FOUNDRY_BROADCAST="$BROADCAST" forge script "script/$stage" --rpc-url "$LOCAL" --unlocked --sender "$DEPLOYER" --broadcast -q >/dev/null
  echo "   $stage: done"
done
HOOK=$(forge script script/LiveFire.s.sol:LiveFire --sig "predict()" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
EXECUTOR=$(forge script script/LiveFire.s.sol:LiveFire --sig "predictExecutor()" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
echo "hook $HOOK  executor $EXECUTOR  (code: $(cast code "$HOOK" --rpc-url "$LOCAL" | wc -c | tr -d ' ') / $(cast code "$EXECUTOR" --rpc-url "$LOCAL" | wc -c | tr -d ' ') hex chars)"

echo "== 3. graph-node, ipfs, postgres"
docker compose -f "$HERE/local/docker-compose.yml" up -d >/dev/null
for _ in $(seq 1 120); do curl -s "$NODE" -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"subgraph_create","params":{"name":"probe"}}' >/dev/null 2>&1 && break; sleep 1; done
echo "graph-node admin endpoint answering"

echo "== 4. the manifest for THIS deployment: address and start block from the fork, nothing hard-coded"
cd "$HERE"
python3 - "$HOOK" "$FORK_BLOCK" <<'PY'
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
SETTLE_LOG=$(FOUNDRY_BROADCAST="$BROADCAST" ORDER_SALT=e2e forge script script/Interactions.s.sol:Settle --rpc-url "$LOCAL" --unlocked --sender "$DEPLOYER" --broadcast 2>&1)
ORDER_ID=$(printf '%s' "$SETTLE_LOG" | grep -A1 "order id" | grep -oE '0x[0-9a-f]{64}' | head -1)
printf '%s\n' "$SETTLE_LOG" | grep -E "receiptCount|USDC received" | sed 's/^/   /'
echo "order id $ORDER_ID"

echo "== 6. the entity, reconstructed from the log by the handler"
COUNT=0
for _ in $(seq 1 90); do
  RESP=$(curl -s "$QUERY" -X POST -H 'content-type: application/json' -d "$QUERY_JSON")
  COUNT=$(printf '%s' "$RESP" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("data",{}).get("settlements") or []))' 2>/dev/null || echo 0)
  [ "$COUNT" = "1" ] && break
  sleep 2
done
printf '%s\n' "$RESP" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(d, indent=2))' | head -40
test "$COUNT" = "1" || { echo "FAIL: expected one Settlement entity, got $COUNT"; exit 1; }
printf '%s' "$RESP" | grep -q "$ORDER_ID" || { echo "FAIL: the entity does not carry the order id the settle stage paid"; exit 1; }
printf '%s' "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin)['data']['settlements'][0]; assert d['hook'].lower()=='$HOOK'.lower(), d['hook']; assert d['executor'].lower()=='$EXECUTOR'.lower(), d['executor']; assert d['schemaVersion']==1; print('entity fields agree with the deployment: hook, executor, schema version 1')"

echo "== 7. a refused payment: the same order paid again reverts on chain, and the count stays at one"
set +e
cast send "$EXECUTOR" "$SIG_PAY" "$ORDER_ID" --value 1000000000000000 --unlocked --from "$DEPLOYER" --rpc-url "$LOCAL" >/dev/null 2>&1
RC=$?
set -e
test "$RC" -ne 0 || { echo "FAIL: a second payment of a settled order did not revert"; exit 1; }
echo "   second pay reverted (exit $RC)"
sleep 4
RESP=$(curl -s "$QUERY" -X POST -H 'content-type: application/json' -d "$QUERY_JSON")
COUNT=$(printf '%s' "$RESP" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["data"]["settlements"]))')
test "$COUNT" = "1" || { echo "FAIL: the refused payment produced an entity"; exit 1; }
echo "   entities after the refusal: $COUNT"

echo "== RESULT: settlement → V4SettlementHook → receipt → graph-node → 1 Settlement entity; refused path → no entity. Local, no credentials, nothing broadcast."
