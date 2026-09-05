#!/usr/bin/env bash
# day4-handoff.sh — the day-4 live deploy of UNICA on Ethereum Sepolia, run by the owner.
#
# Purpose : deploy V4SettlementHook at its mined salt and SettlementExecutor bound to it, initialise
#           the ETH/USDC pool, seed it, and settle one order through the executor and Uniswap's
#           official Universal Router. Seven transactions. make live, on the Sepolia path.
# Targets : hook     0xe478371d804EF56D8e84403F8D97F6184bdEc0C0  (salt 0x32d, flags 0xC0)
#           executor 0x338Faac2D716AEBFd265EBc8DDf46664155eba72  (salt 0, constructor = the hook)
#           both derived from the creation code at commit 49edd20 (tag day3-green); both vacant
#           on chain when validated.
# Predicted: hook and executor deployed at the targets above and naming each other; pool
#           initialised at 2,500 USDC/ETH and seeded from what the deployer holds (10.216 USDC,
#           1.588 ETH); one order for 0.001 ETH with a 1.5 USDC minimum paid; receiptCount 0 -> 1.
#           Simulated against live Sepolia before handoff: estimated 8,308,711 gas, about
#           0.019 ETH at 2.26 gwei.
# Pinned  : chain 11155111; the deployer's nonce was 450 (latest and pending) when validated. The
#           pre-flight below refuses to run if any of that changed, so a stale or repeated run
#           stops before the keystore prompt instead of misfiring or re-seeding.
# Signing : forge's keystore account "default" (~/.foundry/keystores/default). You will be asked
#           "Enter keystore password:" in a real terminal. No key material is in this file, the
#           Makefile, or the repository.
# Verify  : if ETHERSCAN_API_KEY is set in your shell, the Makefile adds --verify; otherwise run
#           `make verify` afterwards (Sourcify needs no key). Then `make readback`.
set -euo pipefail
cd "$(dirname "$0")/../.."
RPC=https://ethereum-sepolia-rpc.publicnode.com
DEPLOYER=0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73
HOOK=0xe478371d804EF56D8e84403F8D97F6184bdEc0C0
EXECUTOR=0x338Faac2D716AEBFd265EBc8DDf46664155eba72
NONCE_AT_VALIDATION=450

echo "== pre-flight against live Sepolia"
chain=$(cast chain-id --rpc-url "$RPC"); test "$chain" = "11155111" || { echo "wrong chain: $chain"; exit 1; }
# The addresses derive from the creation code, so everything that shapes it must equal the tag.
git diff --quiet 49edd20 -- src script foundry.toml remappings.txt || { echo "src/, script/, foundry.toml or remappings.txt differ from 49edd20 (day3-green); the addresses would move"; exit 1; }
test -z "$(git status --short -- src script foundry.toml remappings.txt)" || { echo "uncommitted changes under src/ or script/; the addresses would move"; exit 1; }
nonce=$(cast nonce "$DEPLOYER" --rpc-url "$RPC"); pending=$(cast nonce "$DEPLOYER" --rpc-url "$RPC" --block pending)
test "$nonce" = "$NONCE_AT_VALIDATION" && test "$pending" = "$NONCE_AT_VALIDATION" || { echo "nonce moved since validation (latest $nonce, pending $pending, validated $NONCE_AT_VALIDATION): re-validate before running"; exit 1; }
hookcode=$(cast code "$HOOK" --rpc-url "$RPC"); execcode=$(cast code "$EXECUTOR" --rpc-url "$RPC")
test "$hookcode" = "0x" && test "$execcode" = "0x" || { echo "a target already has code; this deploy already happened or the address moved"; exit 1; }
predicted=$(forge script script/LiveFire.s.sol:LiveFire --sig "predict()" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
test "$predicted" = "$HOOK" || { echo "prediction $predicted differs from the validated target $HOOK"; exit 1; }
echo "chain 11155111, creation code equals day3-green, nonce $nonce, targets vacant, prediction matches: go"
if [ "${DRY_RUN:-}" = "1" ]; then echo "DRY_RUN=1: stopping before the broadcast line"; exit 0; fi

echo "== make live on the Sepolia path (keystore password prompt follows)"
make live ARGS="--network sepolia" DEPLOYER_ACCOUNT=default DEPLOYER="$DEPLOYER"
