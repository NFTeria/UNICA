#!/usr/bin/env bash
# deploy-v3.sh — the live deploy of the UNICA V3 pair onto ONE named testnet.
# Run it with `make deploy-v3 CHAIN=<alias> ...`; `make deploy-v3-check CHAIN=<alias> ...` runs the
# pre-flight alone and stops before the broadcast line, exactly as `go-live-check` does for V1.
#
# Purpose : deploy UnicaHookV3 at its mined salt through the canonical CREATE2 factory, then
#           UnicaExecutorV3 at salt zero bound to it. TWO transactions, on the chain named in CHAIN.
# Targets : one hook address and one executor address for ALL of the deployable chains — the hook's
#           creation code takes no constructor argument and no chain id, so one salt lands on one
#           address everywhere. `make predict-v3` (script/v3/MineHookV3.s.sol) prints them, and the
#           pre-flight below re-derives them rather than being handed them.
# Chains  : CHAIN is a `foundry.toml` rpc alias, never a URL — a provider URL carries its API key in
#           the path and this repository is public. Four aliases are deployable today:
#             sepolia_testnet · unichain_testnet · base_testnet · arbitrum_testnet
#           robinhood_testnet (46630) is REFUSED, on purpose and by name: no payout currency has been
#           verified on it, so UnicaDeploymentsV3 has none to give and both constructors revert.
# Signing : forge's keystore account named in DEPLOYER_ACCOUNT. You will be asked "Enter keystore
#           password:" in a real terminal. There is no private-key path in this repository and no key
#           material in this file, the Makefile, or anywhere in the tree.
# Refuses : a mainnet chain id, by number, through script/mainnet-guard.sh — the one list; a chain
#           the endpoint answers that is not the chain CHAIN names; a chain with no verified payout
#           currency; a dependency with no code; a router whose live runtime hash is not the hash
#           recorded beside its layout; an occupied hook or executor address; a deployer who cannot
#           pay for it. Every one of those stops the run BEFORE the keystore prompt.
# After   : forge script's own broadcast record under broadcast/DeployV3.s.sol/<chainid>/, then read
#           the pair back from the chain and verify the sources.
set -euo pipefail
cd "$(dirname "$0")/../.."

CHAIN=${CHAIN:-}
DEPLOYER=${DEPLOYER:-}
DEPLOYER_ACCOUNT=${DEPLOYER_ACCOUNT:-}

fail() { echo "STOP: $1"; exit 1; }

test -n "$CHAIN" || fail "CHAIN is not set. Name the foundry.toml rpc alias, e.g. CHAIN=sepolia_testnet.
       There is deliberately no default: a deploy target that picks a chain for you is a deploy
       that can reach the wrong one by omission."
test -n "$DEPLOYER" || fail "DEPLOYER (the public address that will sign) is not set"

echo "== pre-flight for the V3 deploy on '$CHAIN'; every row is read from the chain now"

# ---- guard 1: the chain id the endpoint actually reports, refused by number if it is a mainnet ----
# The alias goes to `cast`, so the URL behind it never appears on a command line or in this output.
# The list and the refusal message live in script/mainnet-guard.sh and nowhere else.
# shellcheck source=script/mainnet-guard.sh
. script/mainnet-guard.sh
chain=$(cast chain-id --rpc-url "$CHAIN" 2>/dev/null || true)
test -n "$chain" || fail "the alias '$CHAIN' did not answer a chain id. Check that its environment
       variable is set in .env (script/rpc-setup.sh writes them). A guard that cannot read the chain
       must not assume the chain is safe."
refuse_mainnet_id "$chain" || fail "script/mainnet-guard.sh refused chain id $chain"
echo "chain id            $chain  (alias: $CHAIN)"

# ---- the block everything below is simulated at, NAMED, because on one chain forge picks wrong ----
# `forge script --rpc-url <alias>` with no block pins its fork to the block number the EVM reports,
# and on Arbitrum `block.number` is the L1 block, not the L2 one. Measured 2026-09-09 on Arbitrum
# Sepolia (foundry 1.3.5): the fork pinned to L2 block 11,666,418 while the head was 306,994,573, so
# forge's own simulation of the two transactions ran against state from before v4 existed and the
# executor's constructor reverted RouterCodeChanged(router, <recorded hash>, 0x0) — a real guard
# firing on an unreal chain. Naming the block here removes the guess on every chain at once, and
# makes the pre-flight and the simulation describe the same block instead of two nearby ones.
head=$(cast block-number --rpc-url "$CHAIN" 2>/dev/null || true)
test -n "$head" || fail "the alias '$CHAIN' answered a chain id but not a block number"
echo "block               $head  (this chain's own head; every row below is read at it)"

# ---- guard 2: the pre-flight proper, in Solidity, against the live chain -------------------------
# No --broadcast, so this is a simulation and signs nothing. It exits non-zero on any FAIL row, and
# `set -e` turns that into a stop before the broadcast line below.
#
# FOUNDRY_BROADCAST is redirected because even a simulation writes a run record, and the default
# location is the committed broadcast/ directory that holds the day-1 evidence.
FOUNDRY_BROADCAST=.rehearsal/deploy-v3 forge script script/v3/DeployV3.s.sol:DeployV3 \
  --sig "preflight(string)" "$CHAIN" \
  --rpc-url "$CHAIN" --fork-block-number "$head" --sender "$DEPLOYER" -vv

echo "pre-flight: go"
if [ "${DRY_RUN:-}" = "1" ]; then echo "DRY_RUN=1: stopping before the broadcast line"; exit 0; fi

test -n "$DEPLOYER_ACCOUNT" || fail "DEPLOYER_ACCOUNT (the keystore account name) is not set; the
       pre-flight passed but there is nothing to sign with. Nothing was broadcast."

echo "== deploying on '$CHAIN' (keystore password prompt follows)"
make _deploy-v3-broadcast CHAIN="$CHAIN" BLOCK="$head" DEPLOYER="$DEPLOYER" DEPLOYER_ACCOUNT="$DEPLOYER_ACCOUNT"
