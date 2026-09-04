#!/usr/bin/env bash
# verify.sh <rpc-url> — source verification of the deployed hook. Sourcify needs no key;
# Etherscan runs too when ETHERSCAN_API_KEY is set in the environment. Prints what it did.
set -euo pipefail
RPC="${1:?rpc url}"
CHAIN=$(cast chain-id --rpc-url "$RPC")
HOOK=$(forge script script/LiveFire.s.sol:LiveFire --sig "predict()" --rpc-url "$RPC" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
echo "verifying UnicaHook at $HOOK on chain $CHAIN"
# The tree has no solc pin on purpose (foundry.toml says why), so the version that produced the
# deployed bytecode is read from the artifact and passed explicitly.
SOLC=$(python3 -c "import json;a=json.load(open('out/UnicaHook.sol/UnicaHook.json'));print(json.loads(a['rawMetadata'])['compiler']['version'])")
echo "compiler from the artifact: $SOLC"
forge verify-contract "$HOOK" src/UnicaHook.sol:UnicaHook --chain-id "$CHAIN" --compiler-version "$SOLC" --verifier sourcify --watch || echo "sourcify: failed (see above)"
if [ -n "${ETHERSCAN_API_KEY:-}" ]; then
  forge verify-contract "$HOOK" src/UnicaHook.sol:UnicaHook --chain-id "$CHAIN" --compiler-version "$SOLC" --verifier etherscan --watch || echo "etherscan: failed (see above)"
else
  echo "etherscan: skipped, ETHERSCAN_API_KEY not set"
fi
