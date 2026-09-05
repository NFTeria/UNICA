#!/usr/bin/env bash
# go-live.sh — the live deploy of UNICA on Ethereum Sepolia. Run it with `make go-live`.
#
# Purpose : deploy V4SettlementHook at its mined salt and SettlementExecutor bound to it, initialise
#           the ETH/USDC pool, seed it, and settle one order through the executor and Uniswap's
#           official Universal Router. Seven transactions. make live, on the Sepolia path.
# Targets : hook     0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0  (salt 0xd76, flags 0x20C0)
#           executor 0x044bc8a8773EC7b9B8de2467766636dFFCaC6210  (salt 0, constructor = the hook)
#           both derived from the creation code at the commit named by the freeze check below; both vacant
#           on chain when validated.
# Predicted: hook and executor deployed at the targets above and naming each other; pool
#           initialised at 2,500 USDC/ETH and seeded from what the deployer holds (10.216 USDC,
#           1.588 ETH); one order for 0.001 ETH with a 1.5 USDC minimum paid; receiptCount 0 -> 1.
#           Simulated against live Sepolia before handoff: re-estimated by the pre-flight simulation.
# Pinned  : chain 11155111; the deployer's nonce was 450 (latest and pending) when validated. The
#           pre-flight below refuses to run if any of that changed, so a stale or repeated run
#           stops before the keystore prompt instead of misfiring or re-seeding.
# Signing : forge's keystore account "default" (~/.foundry/keystores/default). You will be asked
#           "Enter keystore password:" in a real terminal. No key material is in this file, the
#           Makefile, or the repository.
# Verify  : if ETHERSCAN_API_KEY is set in your shell, the Makefile adds --verify; otherwise run
#           `make verify` afterwards (Sourcify needs no key). Then `make readback`.
set -euo pipefail
cd "$(dirname "$0")/.."
RPC=https://ethereum-sepolia-rpc.publicnode.com
DEPLOYER=0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73
HOOK=0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0
EXECUTOR=0x044bc8a8773EC7b9B8de2467766636dFFCaC6210
NONCE_AT_VALIDATION=450
FREEZE_TAG=${FREEZE_TAG:-day5-green}

echo "== pre-flight against live Sepolia"
chain=$(cast chain-id --rpc-url "$RPC"); test "$chain" = "11155111" || { echo "wrong chain: $chain"; exit 1; }
# The addresses derive from the compiled creation code and the salt the deploy script mines, so the
# Solidity and the compiler settings must equal the frozen tag. A shell script under script/ cannot
# move an address, so it is not in this list; the prediction check below is the real guard either way.
FROZEN="src foundry.toml remappings.txt $(git ls-files 'script/*.sol')"
git diff --quiet "$FREEZE_TAG" -- $FROZEN || { echo "the Solidity or the compiler settings differ from $FREEZE_TAG; the addresses would move"; exit 1; }
test -z "$(git status --short -- $FROZEN)" || { echo "uncommitted Solidity or compiler settings; the addresses would move"; exit 1; }
nonce=$(cast nonce "$DEPLOYER" --rpc-url "$RPC"); pending=$(cast nonce "$DEPLOYER" --rpc-url "$RPC" --block pending)
test "$nonce" = "$NONCE_AT_VALIDATION" && test "$pending" = "$NONCE_AT_VALIDATION" || { echo "nonce moved since validation (latest $nonce, pending $pending, validated $NONCE_AT_VALIDATION): re-validate before running"; exit 1; }
hookcode=$(cast code "$HOOK" --rpc-url "$RPC"); execcode=$(cast code "$EXECUTOR" --rpc-url "$RPC")
test "$hookcode" = "0x" && test "$execcode" = "0x" || { echo "a target already has code; this deploy already happened or the address moved"; exit 1; }
predicted=$(forge script script/LiveFire.s.sol:LiveFire --sig "predict()" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
test "$predicted" = "$HOOK" || { echo "prediction $predicted differs from the validated target $HOOK"; exit 1; }
echo "chain 11155111, creation code equals $FREEZE_TAG, nonce $nonce, targets vacant, prediction matches: go"
if [ "${DRY_RUN:-}" = "1" ]; then echo "DRY_RUN=1: stopping before the broadcast line"; exit 0; fi

echo "== make live on the Sepolia path (keystore password prompt follows)"
make live ARGS="--network sepolia" DEPLOYER_ACCOUNT=default DEPLOYER="$DEPLOYER"
