#!/usr/bin/env bash
# verify.sh <rpc-url> — source verification of the deployed hook. Sourcify needs no key;
# Etherscan runs too when ETHERSCAN_API_KEY is set in the environment. Prints what it did.
set -euo pipefail
RPC="${1:?rpc url}"
CHAIN=$(cast chain-id --rpc-url "$RPC")
HOOK=$(forge script script/LiveFire.s.sol:LiveFire --sig "predict()" --rpc-url "$RPC" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
echo "verifying UnicaHook at $HOOK on chain $CHAIN"
forge verify-contract "$HOOK" src/UnicaHook.sol:UnicaHook --chain-id "$CHAIN" --verifier sourcify --watch || echo "sourcify: failed (see above)"
if [ -n "${ETHERSCAN_API_KEY:-}" ]; then
  forge verify-contract "$HOOK" src/UnicaHook.sol:UnicaHook --chain-id "$CHAIN" --verifier etherscan --watch || echo "etherscan: failed (see above)"
else
  echo "etherscan: skipped, ETHERSCAN_API_KEY not set"
fi
