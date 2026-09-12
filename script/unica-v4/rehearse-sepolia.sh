#!/usr/bin/env bash
# rehearse-sepolia.sh — every public stage, in order, on an Anvil FORK of Sepolia, as the deployer,
# by impersonation. Real PoolManager, real WETH and USDC, the deployer's real balances and nonce at
# the fork block; zero real transactions, no key, no password. Broadcast artifacts go under
# .rehearsal/ (ignored), never under broadcast/, so the committed record holds only real-chain sends.
#
#   bash script/unica-v4/rehearse-sepolia.sh            # config/unica-v4/11155111.env
#
# Reads the endpoint variable the alias `sepolia_testnet` names from .env itself and never prints it.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$HOME/.foundry/bin:$PATH"
CONFIG=${CONFIG:-config/unica-v4/11155111.env}
PORT=${PORT:-8547}
LOCAL="http://127.0.0.1:$PORT"
OUT=.rehearsal/sepolia-rehearsal
mkdir -p "$OUT"
fail() { echo "STOP: $1"; exit 1; }

test -f .env || fail ".env with SEPOLIA_TESTNET_RPC_URL is required (script/rpc-setup.sh writes it)"
set -a; . ./.env; set +a
test -n "${SEPOLIA_TESTNET_RPC_URL:-}" || fail "SEPOLIA_TESTNET_RPC_URL is not set in .env"
set -a; . "$CONFIG"; set +a
test "$UNICA_CHAIN_ID" = "11155111" || fail "this rehearsal is for chain 11155111"

echo "== forking Sepolia on :$PORT (endpoint not printed)"
anvil --fork-url "$SEPOLIA_TESTNET_RPC_URL" --port "$PORT" --auto-impersonate --silent >"$OUT/anvil.log" 2>&1 &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true' EXIT
for _ in $(seq 1 90); do cast chain-id --rpc-url "$LOCAL" >/dev/null 2>&1 && break; sleep 0.5; done
CHAIN=$(cast chain-id --rpc-url "$LOCAL"); BLOCK=$(cast block-number --rpc-url "$LOCAL")
test "$CHAIN" = "11155111" || fail "the fork reports chain $CHAIN"
echo "fork chain id $CHAIN  block $BLOCK"
echo "deployer $DEPLOYER  ETH $(cast balance "$DEPLOYER" --rpc-url "$LOCAL" --ether)  USDC $(cast call "$UNICA_PAYOUT" 'balanceOf(address)(uint256)' "$DEPLOYER" --rpc-url "$LOCAL")  nonce $(cast nonce "$DEPLOYER" --rpc-url "$LOCAL")"

stage() { # $1 sig, $2 sender, $3 prefix
  local log="$OUT/$1.log"
  FOUNDRY_BROADCAST="$OUT/broadcast" forge script script/unica-v4/DeployPublic.s.sol:DeployPublic --sig "$1()" \
    --rpc-url "$LOCAL" --unlocked --sender "$2" --broadcast -vv >"$log" 2>&1 || { grep -vE "^\s*$" "$log" | grep -viE "https?://" | tail -25 >&2; echo "STOP: stage $1 failed on the fork (log: $log)" >&2; exit 1; }
  grep -o "$3:.*" "$log" | sed "s/^$3://" | tr -d '\n' | sed 's/,$//'
}
gas() { grep -E "Estimated total gas used|Estimated amount required" "$OUT/$1.log" | sed 's/^/    /'; }

if [ -n "${UNICA_IDENTITY_AUTHORITY:-}${UNICA_ENSV2_RESOLVER:-}" ]; then
  vy=$(vyper --version | head -1); case "$vy" in 0.4.3*) ;; *) fail "vyper 0.4.3 required exactly (ruling H8); found $vy" ;; esac
  IDENTITY_TOKEN_BYTECODE=$(vyper -p vy/src -f bytecode vy/src/art/identity_token.vy); export IDENTITY_TOKEN_BYTECODE
  echo "identity token bytecode: $(( (${#IDENTITY_TOKEN_BYTECODE} - 2) / 2 )) bytes (vyper $vy), so stage A deploys the badge as it will on Sepolia"
fi
echo "== stage A (infrastructure)"
A=$(stage stageA "$DEPLOYER" STAGE_A); echo "  {$A}"; gas stageA
eval "$(node -e 'const o=JSON.parse("{"+process.argv[1]+"}"); console.log(`export UNICA_FACTORY=${o.factory} UNICA_REGISTRY=${o.registry} UNICA_ORACLE_ADAPTER=${o.oracleAdapter} UNICA_POLICY_RECEIVER=${o.policyReceiver} UNICA_ADMISSION=${o.terminalAdmission} UNICA_IDENTITY_AUTHORITY=${o.identityAuthority} UNICA_IDENTITY_TOKEN=${o.identityToken}`)' "$A")"
for v in UNICA_ORACLE_ADAPTER UNICA_POLICY_RECEIVER UNICA_ADMISSION UNICA_IDENTITY_AUTHORITY UNICA_IDENTITY_TOKEN; do
  [ "${!v}" = "0x0000000000000000000000000000000000000000" ] && unset "$v"   # not deployed on this chain: absent, never a zero address
done

echo "== stage B (propose the market)"
B=$(stage stageB "$DEPLOYER" STAGE_B); echo "  {$B}"; gas stageB
eval "$(node -e 'const o=JSON.parse("{"+process.argv[1]+"}"); console.log(`export UNICA_MARKET_ID=${o.marketId} UNICA_HOOK=${o.hook} UNICA_EXECUTOR=${o.executor}`)' "$B")"

echo "== stage C (initialise, seed, prove SEEDED)"
C=$(stage stageC "$DEPLOYER" STAGE_C); echo "  {$C}"; gas stageC

echo "== activate (as the admin, after readback)"
ACT=$(stage activate "$UNICA_ADMIN" ACTIVATE); echo "  {$ACT}"; gas activate

echo "== readback"
FOUNDRY_BROADCAST="$OUT/broadcast" forge script script/unica-v4/DeployPublic.s.sol:DeployPublic --sig "readback()" \
  --rpc-url "$LOCAL" --sender "$DEPLOYER" -vv 2>&1 | grep -o 'READBACK:.*' | sed 's/^READBACK://' | sed 's/,$//' | sed 's/^/  /'

echo "== manifest, written from the fork's state the way it will be from Sepolia's"
{ cat "$CONFIG"; echo "UNICA_FACTORY=$UNICA_FACTORY"; echo "UNICA_REGISTRY=$UNICA_REGISTRY"; echo "UNICA_MARKET_ID=$UNICA_MARKET_ID"
  for v in UNICA_ORACLE_ADAPTER UNICA_POLICY_RECEIVER UNICA_ADMISSION UNICA_IDENTITY_AUTHORITY UNICA_IDENTITY_TOKEN; do [ -n "${!v:-}" ] && echo "$v=${!v}"; done; } >"$OUT/config-after-stages.env"
bash script/unica-v4/manifest.sh "$LOCAL" "$OUT/config-after-stages.env" "$OUT/11155111.rehearsal.json"
node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log("  contracts:", Object.keys(m.contracts).join(", ")); console.log("  market:", m.market.marketId, "status", m.market.status, "demonstrationOnly", m.market.demonstrationOnly)' "$OUT/11155111.rehearsal.json"

echo "== nonce delta on the fork: $(( $(cast nonce "$DEPLOYER" --rpc-url "$LOCAL") - $(cast nonce "$DEPLOYER" --rpc-url "$LOCAL" --block "$BLOCK") )) transactions from the deployer"
echo "rehearsal complete; the fork is discarded. Nothing reached Sepolia."
