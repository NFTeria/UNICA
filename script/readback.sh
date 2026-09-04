#!/usr/bin/env bash
# readback.sh <rpc-url> — what the chain says right now about the hook and the pool. Pure reads.
# Cast signatures live in variables: macOS bash 3.2 mis-parses some quoted arguments inside $( ).
set -euo pipefail
RPC="${1:?rpc url}"
USDC=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
SV=0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C
ZERO=0x0000000000000000000000000000000000000000
SIG_COUNT='receiptCount()(uint256)'
SIG_EXEC='SETTLEMENT_EXECUTOR()(address)'
SIG_HOOK='HOOK()(address)'
SIG_UR='UNIVERSAL_ROUTER()(address)'
SIG_PM='poolManager()(address)'
SIG_KEY='f(address,address,uint24,int24,address)'
SIG_SLOT0='getSlot0(bytes32)(uint160,int24,uint24,uint24)'
SIG_LIQ='getLiquidity(bytes32)(uint128)'

chain=$(cast chain-id --rpc-url "$RPC")
hook=$(forge script script/LiveFire.s.sol:LiveFire --sig "predict()" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
executor=$(forge script script/LiveFire.s.sol:LiveFire --sig "predictExecutor()" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
rcode=$(cast code "$executor" --rpc-url "$RPC")
SIG_ORDERS='orderCount()(uint256)'

code=$(cast code "$hook" --rpc-url "$RPC")
bytes=$(( (${#code} - 2) / 2 ))
echo "chain id        : $chain"
echo "executor (derived): $executor  code bytes: $(( (${#rcode} - 2) / 2 ))"
if [ "$rcode" != "0x" ]; then
  echo "orders created  : $(cast call "$executor" "$SIG_ORDERS" --rpc-url "$RPC")"
  echo "executor.HOOK   : $(cast call "$executor" "$SIG_HOOK" --rpc-url "$RPC")  (must equal the hook below)"
  echo "executor.router : $(cast call "$executor" "$SIG_UR" --rpc-url "$RPC")"
fi
echo "hook (predicted): $hook"
echo "hook code bytes : $bytes"
if [ "$code" != "0x" ]; then
  count=$(cast call "$hook" "$SIG_COUNT" --rpc-url "$RPC")
  pm=$(cast call "$hook" "$SIG_PM" --rpc-url "$RPC")
  encoded=$(cast abi-encode "$SIG_KEY" "$ZERO" "$USDC" 3000 60 "$hook")
  id=$(cast keccak "$encoded")
  slot0=$(cast call "$SV" "$SIG_SLOT0" "$id" --rpc-url "$RPC" | tr '\n' ' ')
  liq=$(cast call "$SV" "$SIG_LIQ" "$id" --rpc-url "$RPC")
  echo "receiptCount    : $count"
  echo "hook.executor   : $(cast call "$hook" "$SIG_EXEC" --rpc-url "$RPC")  (must equal the executor above)"
  echo "hook.poolManager: $pm"
  echo "pool id         : $id"
  echo "slot0           : $slot0"
  echo "liquidity       : $liq"
fi
