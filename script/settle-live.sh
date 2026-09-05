#!/usr/bin/env bash
# settle-live.sh — the live SETTLEMENT stage of UNICA on Ethereum Sepolia, after the deploy landed.
# Run it with `make settle-live`; `make settle-check` runs the pre-flight alone.
#
# Why this exists: the first live run (block 11639895) landed the hook, the executor, the pool and
# its liquidity, and lost the settlement: the script computed the order's deadline at simulation
# time, forge asks for the keystore password AFTER simulating, and by the time the prompt was
# answered the deadline had passed, so createOrder reverted DeadlineInPast on chain and pay had no
# order. The contracts are live and must never be redeployed; go-live refuses (targets occupied),
# correctly. This runs only the stage that is missing.
# Purpose : create one order for 0.001 ETH with a 1.5 USDC minimum, recipient = the deployer, and
#           pay it through the executor and Uniswap's official Universal Router. Two transactions
#           (createOrder, pay). make settle, on the Sepolia path.
# Predicted: receiptCount and orderCount move by one; the deployer's USDC grows by the receipted
#           amount (about 2.0 USDC on a fork of the chain as it stood, see docs/DEPLOYMENT.md).
# Deadline: the order stays payable for ORDER_DEADLINE (a day, LiveFire.s.sol) measured from the
#           simulation. Answer the keystore prompt within that.
# Signing : forge's keystore account "default". No key material is in this file or the repository.
# After   : make readback, make proof (verify-day1 14/14; verify-live all green except Sourcify),
#           make verify (Sourcify; Etherscan if the key is set), make proof again, tag live-green.
set -euo pipefail
cd "$(dirname "$0")/.."
# Overridable so the pre-flight can be exercised against a local fork of the chain (DRY_RUN=1 there).
RPC=${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}
DEPLOYER=0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73
HOOK=0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0
EXECUTOR=0x044bc8a8773EC7b9B8de2467766636dFFCaC6210
FREEZE_TAG=${FREEZE_TAG:-deploy-candidate-5}
ORDER_SALT=${ORDER_SALT:-1}
USDC=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
SV=0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C
fail() { echo "STOP: $1"; exit 1; }
call() { cast call "$1" "$2" ${3:-} --rpc-url "$RPC" 2>/dev/null | head -1 | awk '{print $1}'; }

echo "== pre-flight for the settlement stage, every line is read from the chain or the tree now"
chain=$(cast chain-id --rpc-url "$RPC"); test "$chain" = "11155111" || fail "wrong chain: $chain"
echo "chain id            $chain  (rpc: $RPC)"

# What is reviewed is what runs: HEAD is the frozen candidate, the tree is clean, and the Solidity
# plus the compiler settings equal the tag. The contracts on chain were built from the same set.
git rev-parse -q --verify "$FREEZE_TAG^{commit}" >/dev/null || fail "no tag $FREEZE_TAG"
test "$(git rev-parse HEAD)" = "$(git rev-parse "$FREEZE_TAG^{commit}")" || fail "HEAD $(git rev-parse --short HEAD) is not the frozen candidate $FREEZE_TAG ($(git rev-parse --short "$FREEZE_TAG^{commit}"))"
test -z "$(git status --short)" || fail "the working tree is not clean; these entries are not committed:
$(git status --short)"
FROZEN="src foundry.toml remappings.txt $(git ls-files 'script/*.sol')"
git diff --quiet "$FREEZE_TAG" -- $FROZEN || fail "the Solidity or the compiler settings differ from $FREEZE_TAG"
echo "frozen candidate    $FREEZE_TAG = $(git rev-parse --short HEAD), tree clean, Solidity and compiler settings identical"

# The deploy that landed: both contracts at their addresses, at their sizes, naming each other.
hbytes=$(( ($(cast code "$HOOK" --rpc-url "$RPC" | wc -c) - 3) / 2 )); ebytes=$(( ($(cast code "$EXECUTOR" --rpc-url "$RPC" | wc -c) - 3) / 2 ))
test "$hbytes" = 10634 || fail "hook code is $hbytes bytes at $HOOK, expected 10634"
test "$ebytes" = 11289 || fail "executor code is $ebytes bytes at $EXECUTOR, expected 11289"
test "$(call $HOOK 'SETTLEMENT_EXECUTOR()(address)')" = "$EXECUTOR" || fail "hook.SETTLEMENT_EXECUTOR is not the executor"
test "$(call $EXECUTOR 'HOOK()(address)')" = "$HOOK" || fail "executor.HOOK is not the hook"
echo "hook                $HOOK  $hbytes bytes, names the executor"
echo "executor            $EXECUTOR  $ebytes bytes, names the hook"

# The pool that was seeded, by the id of the live key.
POOLID=$(cast keccak "$(cast abi-encode 'f((address,address,uint24,int24,address))' "(0x0000000000000000000000000000000000000000,$USDC,3000,60,$HOOK)")")
price=$(call $SV 'getSlot0(bytes32)(uint160,int24,uint24,uint24)' $POOLID); liq=$(call $SV 'getLiquidity(bytes32)(uint128)' $POOLID)
test -n "$price" && test "$price" != 0 || fail "the pool $POOLID is not initialised"
test -n "$liq" && test "$liq" -gt 0 || fail "the pool $POOLID has no liquidity"
echo "pool                $POOLID"
echo "                    sqrtPriceX96 $price, liquidity $liq  (2,500 USDC per ETH at initialisation is 3961408125713216879677197)"

# The order this run will create, computed the way the script computes it, and not yet used.
salt=$(cast keccak "unica settle stage $ORDER_SALT")
orderId=$(cast keccak "$(cast abi-encode 'f(uint256,address,address,bytes32)' 11155111 "$EXECUTOR" "$DEPLOYER" "$salt")")
# orders() returns the Order struct, twelve static words; the status is the last word.
status=$(python3 -c "print(int('$(cast call "$EXECUTOR" 'orders(bytes32)' "$orderId" --rpc-url "$RPC")'[-64:],16))")
test "$status" = 0 || fail "the order for ORDER_SALT=$ORDER_SALT ($orderId) already exists with status $status; run with a new ORDER_SALT=<anything new>"
echo "order               ORDER_SALT=$ORDER_SALT -> $orderId  (unused)"
echo "counters            receiptCount $(call $HOOK 'receiptCount()(uint256)'), orderCount $(call $EXECUTOR 'orderCount()(uint256)')  (both move by one)"

eth=$(cast balance "$DEPLOYER" --rpc-url "$RPC")
# Floor: 0.001 ETH settled plus two transactions of gas, measured at about 0.0004 ETH on the first run.
test "$eth" -ge 5000000000000000 || fail "deployer holds $(cast from-wei "$eth") ETH, below the 0.005 ETH floor"
echo "deployer            $(cast from-wei "$eth") ETH, $(python3 -c "print($(call $USDC 'balanceOf(address)(uint256)' $DEPLOYER)/1e6)") USDC (recipient of the settlement)"
echo "settlement          0.001 ETH for a minimum of 1.5 USDC, recipient = the deployer, deadline a day from the simulation"
echo "pre-flight: go"
if [ "${DRY_RUN:-}" = "1" ]; then echo "DRY_RUN=1: stopping before the broadcast line"; exit 0; fi

echo "== make settle on the Sepolia path (keystore password prompt follows; answer it within the day)"
ORDER_SALT="$ORDER_SALT" make settle ARGS="--network sepolia" DEPLOYER_ACCOUNT=default DEPLOYER="$DEPLOYER"
