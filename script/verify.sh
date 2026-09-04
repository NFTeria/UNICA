#!/usr/bin/env bash
# verify.sh <rpc-url> — source verification of the hook AND the executor. Sourcify needs no key;
# Etherscan runs too when ETHERSCAN_API_KEY is set in the environment. Prints what it did.
set -euo pipefail
RPC="${1:?rpc url}"
CHAIN=$(cast chain-id --rpc-url "$RPC")
HOOK=$(forge script script/LiveFire.s.sol:LiveFire --sig "predict()" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
EXECUTOR=$(forge script script/LiveFire.s.sol:LiveFire --sig "predictExecutor()" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{40}' | head -1)

# The compiler version is taken from whichever artifact's runtime matches the chain byte for byte
# outside the immutables (measured 2026-09-04: an unpinned tree built the hook twice).
matching_solc() {
  local addr="$1" name="$2"
  ONCHAIN="$(cast code "$addr" --rpc-url "$RPC")" NAME="$name" python3 - <<'PYEOF'
import json,glob,os
onchain=os.environ['ONCHAIN'][2:].lower(); name=os.environ['NAME']
for path in sorted(glob.glob(f'out/**/{name}.json', recursive=True)):
    a=json.load(open(path)); d=a['deployedBytecode']['object'][2:].lower()
    if len(d)!=len(onchain): continue
    mask=set()
    for v in a['deployedBytecode'].get('immutableReferences',{}).values():
        for r in v: mask.update(range(r['start'],r['start']+r['length']))
    if all(onchain[2*i:2*i+2]==d[2*i:2*i+2] for i in range(len(d)//2) if i not in mask):
        print(json.loads(a['rawMetadata'])['compiler']['version']); break
else:
    raise SystemExit(f"no artifact under out/ matches the deployed {name}; run forge build first")
PYEOF
}

verify_one() {
  local addr="$1" src="$2" name="$3"
  if [ "$(cast code "$addr" --rpc-url "$RPC")" = "0x" ]; then echo "$name: no code at $addr on chain $CHAIN, skipping"; return; fi
  local solc; solc=$(matching_solc "$addr" "$name")
  echo "verifying $name at $addr on chain $CHAIN with $solc"
  forge verify-contract "$addr" "$src:$name" --chain-id "$CHAIN" --compiler-version "$solc" --verifier sourcify --watch || echo "$name sourcify: failed (see above)"
  if [ -n "${ETHERSCAN_API_KEY:-}" ]; then
    forge verify-contract "$addr" "$src:$name" --chain-id "$CHAIN" --compiler-version "$solc" --verifier etherscan --watch || echo "$name etherscan: failed (see above)"
  else
    echo "$name etherscan: skipped, ETHERSCAN_API_KEY not set"
  fi
}

verify_one "$EXECUTOR" src/SettlementExecutor.sol SettlementExecutor
verify_one "$HOOK" src/V4SettlementHook.sol V4SettlementHook
