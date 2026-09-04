#!/usr/bin/env bash
# rehearse-anvil.sh — the full live-fire sequence on an anvil FORK of Sepolia, as the real
# deployer, by impersonation. Real PoolManager, real USDC, real router bytecode, real nonce and
# balances at the fork block; zero real transactions and no key or password anywhere.
#
# Broadcast artifacts from the fork are written under .rehearsal/ (ignored), never under
# broadcast/, so the committed record only ever holds real-chain transactions.
set -euo pipefail
RPC="${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}"
DEPLOYER="${DEPLOYER:?set DEPLOYER to the public address of the deployer}"
PORT="${PORT:-8546}"
LOCAL="http://127.0.0.1:$PORT"
USDC=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
# cast signatures live in variables: bash 3.2 (macOS /bin/bash) cannot parse a parenthesised
# single-quoted argument inside a $( ) substitution
SIG_BALANCE_OF='balanceOf(address)(uint256)'

echo "== forking $RPC on :$PORT"
anvil --fork-url "$RPC" --port "$PORT" --auto-impersonate --silent &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do cast chain-id --rpc-url "$LOCAL" >/dev/null 2>&1 && break; sleep 0.5; done
echo "fork chain id: $(cast chain-id --rpc-url "$LOCAL")  block: $(cast block-number --rpc-url "$LOCAL")"

echo "== the deployer as the fork sees it (real state at the fork block)"
eth=$(cast balance "$DEPLOYER" --rpc-url "$LOCAL" --ether)
usdc=$(cast call "$USDC" "$SIG_BALANCE_OF" "$DEPLOYER" --rpc-url "$LOCAL")
nonce=$(cast nonce "$DEPLOYER" --rpc-url "$LOCAL")
echo "ETH : $eth"
echo "USDC: $usdc"
echo "nonce: $nonce"

echo "== all four stages, impersonated, broadcast to the fork only"
FOUNDRY_BROADCAST=.rehearsal/broadcast forge script script/LiveFire.s.sol:LiveFire \
  --rpc-url "$LOCAL" --unlocked --sender "$DEPLOYER" --broadcast -vvv

echo "== read back from the fork"
bash "$(dirname "$0")/readback.sh" "$LOCAL"
echo "== rehearsal complete; the fork is discarded"
