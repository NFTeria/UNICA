#!/usr/bin/env bash
# topup-live.sh — a bounded liquidity top-up of the LIVE settlement pool on Ethereum Sepolia.
# Run it with `make topup-live`; `make topup-check` runs the pre-flight and prints the plan, sends nothing.
#
# Why: the hook admits swaps in one direction only (native ETH in, USDC out, through the executor),
# so nothing can move this pool's price back up and its USDC is a reservoir that only new liquidity
# refills. A top-up adds full-range liquidity at the price the pool has reached, which lowers the
# price impact of each later settlement; it cannot restore the price. The measured effect is in
# docs/DEPLOYMENT.md, "Protecting the live pool".
# Bounds  : one faucet round of USDC (up to 20 USDC, floor 5), an ETH leg capped at 0.02 ETH of which
#           the router refunds what the USDC leg does not need, full range, the position the seed
#           stage opened (held by Uniswap's PoolModifyLiquidityTest router; on this testnet router
#           anyone may withdraw it, so it is testnet money and nothing else). Two transactions.
# Refuses : wrong chain; HEAD not the frozen candidate or a dirty tree; contracts not at their
#           addresses and sizes or not naming each other; pool uninitialised or unseeded; price above
#           the opening 2,500 USDC/ETH or below 1,000; deployer below 5 USDC or below the ETH leg + gas.
# Signing : forge's keystore account "default". No key material is in this file or the repository.
# After   : make readback (liquidity must equal the plan's "liquidity after"), make proof.
set -euo pipefail
cd "$(dirname "$0")/.."
RPC=${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}
DEPLOYER=0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73
HOOK=0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0
EXECUTOR=0x044bc8a8773EC7b9B8de2467766636dFFCaC6210
FREEZE_TAG=${FREEZE_TAG:-deploy-candidate-7}
USDC=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
SV=0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C
SQRT_OPEN=3961408125713216879677197
fail() { echo "STOP: $1"; exit 1; }
call() { cast call "$1" "$2" ${3:-} --rpc-url "$RPC" 2>/dev/null | head -1 | awk '{print $1}'; }
ge() { python3 -c "import sys;sys.exit(0 if int('$1')>=int('$2') else 1)"; }

echo "== pre-flight for a bounded top-up, every line is read from the chain or the tree now"
chain=$(cast chain-id --rpc-url "$RPC"); test "$chain" = "11155111" || fail "wrong chain: $chain"
echo "chain id            $chain  (rpc: $RPC)"
git rev-parse -q --verify "$FREEZE_TAG^{commit}" >/dev/null || fail "no tag $FREEZE_TAG"
test "$(git rev-parse HEAD)" = "$(git rev-parse "$FREEZE_TAG^{commit}")" || fail "HEAD $(git rev-parse --short HEAD) is not the frozen candidate $FREEZE_TAG ($(git rev-parse --short "$FREEZE_TAG^{commit}"))"
test -z "$(git status --short)" || fail "the working tree is not clean; these entries are not committed:
$(git status --short)"
FROZEN="src foundry.toml remappings.txt $(git ls-files 'script/*.sol')"
git diff --quiet "$FREEZE_TAG" -- $FROZEN || fail "the Solidity or the compiler settings differ from $FREEZE_TAG"
echo "frozen candidate    $FREEZE_TAG = $(git rev-parse --short HEAD), tree clean, Solidity and compiler settings identical"

hbytes=$(( ($(cast code "$HOOK" --rpc-url "$RPC" | wc -c) - 3) / 2 )); ebytes=$(( ($(cast code "$EXECUTOR" --rpc-url "$RPC" | wc -c) - 3) / 2 ))
test "$hbytes" = 10634 || fail "hook code is $hbytes bytes, expected 10634"
test "$ebytes" = 11289 || fail "executor code is $ebytes bytes, expected 11289"
test "$(call $HOOK 'SETTLEMENT_EXECUTOR()(address)')" = "$EXECUTOR" || fail "hook.SETTLEMENT_EXECUTOR is not the executor"
test "$(call $EXECUTOR 'HOOK()(address)')" = "$HOOK" || fail "executor.HOOK is not the hook"
echo "hook / executor     at their addresses and sizes, naming each other"

POOLID=$(cast keccak "$(cast abi-encode 'f((address,address,uint24,int24,address))' "(0x0000000000000000000000000000000000000000,$USDC,3000,60,$HOOK)")")
price=$(call $SV 'getSlot0(bytes32)(uint160,int24,uint24,uint24)' $POOLID); liq=$(call $SV 'getLiquidity(bytes32)(uint128)' $POOLID)
test -n "$price" && test "$price" != 0 || fail "the pool is not initialised"
test -n "$liq" && test "$liq" -gt 0 || fail "the pool has no liquidity; this is a top-up, seed it first"
minsqrt=$(python3 -c "from math import isqrt; print(isqrt(1000*10**6 * 2**192 // 10**18))")
ge "$SQRT_OPEN" "$price" || fail "the pool is above its opening price, which no admitted swap can cause"
ge "$price" "$minsqrt" || fail "the pool is below 1,000 USDC per ETH; a top-up there buys nothing a demo can use"
echo "pool                $POOLID"
echo "                    sqrtPriceX96 $price (opened at $SQRT_OPEN, floor $minsqrt), liquidity $liq"

eth=$(cast balance "$DEPLOYER" --rpc-url "$RPC"); usdc=$(call $USDC 'balanceOf(address)(uint256)' $DEPLOYER)
test "$usdc" -ge 5000000 || fail "deployer holds $(python3 -c "print($usdc/1e6)") USDC, below the 5 USDC top-up floor; get USDC first (the Circle Sepolia faucet), then run this again"
test "$eth" -ge 25000000000000000 || fail "deployer holds $(cast from-wei "$eth") ETH, below the 0.02 ETH leg plus gas"
echo "deployer            $(cast from-wei "$eth") ETH, $(python3 -c "print($usdc/1e6)") USDC"
echo "== the plan, computed by the stage itself (pure reads, planTopup())"
forge script script/LiveFire.s.sol:LiveFire --sig "planTopup()" --rpc-url "$RPC" --sender "$DEPLOYER" 2>/dev/null | sed -n '/== Logs ==/,/^$/p' | grep -vE "^== Logs ==|^$" | sed 's/^/                    /'
echo "position            full range, the seed stage's position (the liquidity router's, salt 0); withdrawable by anyone on this testnet router"
echo "exposure            at most 0.02 ETH plus gas (two transactions, about 0.0004 ETH), and the USDC budget above"
echo "effect              lower price impact per settlement; the price itself cannot be restored (docs/DEPLOYMENT.md has the measured series)"
echo "pre-flight: go"
if [ "${DRY_RUN:-}" = "1" ]; then echo "DRY_RUN=1: stopping before the broadcast line"; exit 0; fi
echo "== make topup on the Sepolia path (keystore password prompt follows)"
make topup ARGS="--network sepolia" DEPLOYER_ACCOUNT=default DEPLOYER="$DEPLOYER"
