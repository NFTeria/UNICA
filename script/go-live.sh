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
# After   : make readback, make proof (verify-day1 14/14 and verify-live must go from its pre-deploy
#           red to all green), make verify (Sourcify; Etherscan if ETHERSCAN_API_KEY is set), then the
#           closing tag live-green.
set -euo pipefail
cd "$(dirname "$0")/.."
RPC=https://ethereum-sepolia-rpc.publicnode.com
DEPLOYER=0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73
HOOK=0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0
EXECUTOR=0x044bc8a8773EC7b9B8de2467766636dFFCaC6210
NONCE_AT_VALIDATION=450
FREEZE_TAG=${FREEZE_TAG:-deploy-candidate-3}

echo "== pre-flight against live Sepolia, every line is read from the chain or the tree now"
USDC=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
PM=0xE03A1074c86CFeDd5C142C4F04F1a1536e203543
ROUTER=0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b
SIG_BAL='balanceOf(address)(uint256)'
fail() { echo "STOP: $1"; exit 1; }

chain=$(cast chain-id --rpc-url "$RPC"); test "$chain" = "11155111" || fail "wrong chain: $chain"
echo "chain id            $chain"

# The addresses derive from the compiled creation code and the salt the deploy script mines, so the
# Solidity and the compiler settings must equal the frozen tag, and HEAD must BE the frozen tag so
# what is reviewed is what runs. A later fix gets a new candidate tag, never a moved one.
git rev-parse -q --verify "$FREEZE_TAG^{commit}" >/dev/null || fail "no tag $FREEZE_TAG"
test "$(git rev-parse HEAD)" = "$(git rev-parse "$FREEZE_TAG^{commit}")" || fail "HEAD $(git rev-parse --short HEAD) is not the frozen candidate $FREEZE_TAG ($(git rev-parse --short "$FREEZE_TAG^{commit}"))"
test -z "$(git status --short)" || fail "the working tree is not clean"
FROZEN="src foundry.toml remappings.txt $(git ls-files 'script/*.sol')"
git diff --quiet "$FREEZE_TAG" -- $FROZEN || fail "the Solidity or the compiler settings differ from $FREEZE_TAG"
echo "frozen candidate    $FREEZE_TAG = $(git rev-parse --short HEAD), tree clean, Solidity and compiler settings identical"

nonce=$(cast nonce "$DEPLOYER" --rpc-url "$RPC"); pending=$(cast nonce "$DEPLOYER" --rpc-url "$RPC" --block pending)
test "$nonce" = "$NONCE_AT_VALIDATION" && test "$pending" = "$NONCE_AT_VALIDATION" || fail "nonce moved since validation (latest $nonce, pending $pending, validated $NONCE_AT_VALIDATION)"
echo "deployer nonce      $nonce latest, $pending pending (validated at $NONCE_AT_VALIDATION)"

hookcode=$(cast code "$HOOK" --rpc-url "$RPC"); execcode=$(cast code "$EXECUTOR" --rpc-url "$RPC")
test "$hookcode" = "0x" && test "$execcode" = "0x" || fail "a target already has code; this deploy already happened or the address moved"
predicted=$(forge script script/LiveFire.s.sol:LiveFire --sig "predict()" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
predictedExec=$(forge script script/LiveFire.s.sol:LiveFire --sig "predictExecutor()" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
test "$predicted" = "$HOOK" || fail "predicted hook $predicted differs from the validated target $HOOK"
test "$predictedExec" = "$EXECUTOR" || fail "predicted executor $predictedExec differs from the validated target $EXECUTOR"
echo "hook                $HOOK  vacant, prediction matches (mask 0x20C0)"
echo "executor            $EXECUTOR  vacant, prediction matches"

eth=$(cast balance "$DEPLOYER" --rpc-url "$RPC"); usdc=$(cast call "$USDC" "$SIG_BAL" "$DEPLOYER" --rpc-url "$RPC" | awk '{print $1}')
# Floors: the seven transactions were estimated at about 0.02 ETH of gas plus 0.008 ETH seeded and
# 0.001 ETH settled; the seed stage refuses below 5 USDC on its own.
test "$eth" -ge 50000000000000000 || fail "deployer holds $(cast from-wei "$eth") ETH, below the 0.05 ETH floor"
test "$usdc" -ge 5000000 || fail "deployer holds $usdc USDC units, below the 5 USDC seeding floor"
echo "deployer balances   $(cast from-wei "$eth") ETH, $(python3 -c "print($usdc/1e6)") USDC"

echo "configured          PoolManager $PM"
echo "                    USDC        $USDC (the only payout currency the hook accepts on this chain)"
echo "                    router      $ROUTER (Uniswap's Universal Router, the only swap sender the hook admits)"
echo "                    pool        native ETH / USDC, fee 3000, tick spacing 60, initial price 2,500 USDC per ETH"
echo "                    seed        up to 0.008 ETH and up to 20 USDC, full range, from what the deployer holds"
echo "                    settlement  0.001 ETH for a minimum of 1.5 USDC, recipient = the deployer"
echo "                    price guard both init and seed refuse a pool at a price this script did not choose (fork control: an attacker initialised at 1:1, both refused, liquidity 0)"
echo "pre-flight: go"
if [ "${DRY_RUN:-}" = "1" ]; then echo "DRY_RUN=1: stopping before the broadcast line"; exit 0; fi

echo "== make live on the Sepolia path (keystore password prompt follows)"
make live ARGS="--network sepolia" DEPLOYER_ACCOUNT=default DEPLOYER="$DEPLOYER"
