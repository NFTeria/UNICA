#!/usr/bin/env bash
# verify.sh <rpc-url> — source verification of the deployed hook. Sourcify needs no key;
# Etherscan runs too when ETHERSCAN_API_KEY is set in the environment. Prints what it did.
set -euo pipefail
RPC="${1:?rpc url}"
CHAIN=$(cast chain-id --rpc-url "$RPC")
HOOK=$(forge script script/LiveFire.s.sol:LiveFire --sig "predict()" --rpc-url "$RPC" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
echo "verifying UnicaHook at $HOOK on chain $CHAIN"
# The tree has no solc pin on purpose (foundry.toml says why), and forge may compile the same
# contract at different versions in different compilation units (measured 2026-09-04: the test
# unit at 0.8.26, the script unit that deployed at 0.8.30). So the compiler version is taken
# from whichever artifact's runtime matches the chain byte for byte outside the immutables.
ONCHAIN=$(cast code "$HOOK" --rpc-url "$RPC")
SOLC=$(ONCHAIN="$ONCHAIN" python3 - <<'PYEOF'
import json,glob,os
onchain=os.environ['ONCHAIN'][2:].lower()
for path in sorted(glob.glob('out/**/UnicaHook.json', recursive=True)):
    a=json.load(open(path)); d=a['deployedBytecode']['object'][2:].lower()
    if len(d)!=len(onchain): continue
    mask=set()
    for v in a['deployedBytecode'].get('immutableReferences',{}).values():
        for r in v: mask.update(range(r['start'],r['start']+r['length']))
    if all(onchain[2*i:2*i+2]==d[2*i:2*i+2] for i in range(len(d)//2) if i not in mask):
        print(json.loads(a['rawMetadata'])['compiler']['version']); break
else:
    raise SystemExit("no artifact under out/ matches the deployed runtime; run forge build first")
PYEOF
)
echo "compiler of the artifact that matches the chain: $SOLC"
forge verify-contract "$HOOK" src/UnicaHook.sol:UnicaHook --chain-id "$CHAIN" --compiler-version "$SOLC" --verifier sourcify --watch || echo "sourcify: failed (see above)"
if [ -n "${ETHERSCAN_API_KEY:-}" ]; then
  forge verify-contract "$HOOK" src/UnicaHook.sol:UnicaHook --chain-id "$CHAIN" --compiler-version "$SOLC" --verifier etherscan --watch || echo "etherscan: failed (see above)"
else
  echo "etherscan: skipped, ETHERSCAN_API_KEY not set"
fi
