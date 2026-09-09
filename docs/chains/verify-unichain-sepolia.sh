#!/usr/bin/env bash
# verify-unichain-sepolia.sh — re-proves, from the chain rather than from this repository's claims,
# every fact `docs/chains/UNICHAIN-SEPOLIA.md` states about Unichain Sepolia (chain 1301). Pure
# reads and local forks: nothing here signs, sends, or spends. Prints PASS/FAIL/SKIP per check and a
# count at the end, and exits non-zero if any check failed.
#
#   bash docs/chains/verify-unichain-sepolia.sh [rpc-url] [sepolia-rpc-url]
#
# WHY THE CONTROL RPC IS AN ARGUMENT TOO. Two of the rows below are comparisons against Ethereum
# Sepolia — the chain UNICA is actually live on. A claim that Unichain Sepolia's Universal Router is
# "the same build" means nothing unless the thing it is being compared to is read at the same time,
# from its own chain. If the control endpoint cannot be reached those rows print SKIP and say so;
# they are never quietly dropped, and a SKIP is never folded into a pass.
#
# WHAT THIS CANNOT TELL YOU. Every row here is about a chain UNICA has never been deployed on. They
# prove the ground is what the document says it is. They do not prove a deploy would succeed, and
# row "frozen source resolves chain 1301" is expected to report NO for as long as the freeze holds.
set -uo pipefail

# Every `cast` below is retried on an empty answer. See docs/proof/retry.sh for the measurement that
# made this necessary: a public endpoint that does not answer prints nothing, and an empty answer
# would otherwise score identically to a chain that said no.
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
. "$ROOT/docs/proof/retry.sh"

RPC="${1:-https://sepolia.unichain.org}"
CONTROL_RPC="${2:-https://ethereum-sepolia-rpc.publicnode.com}"

CHAIN_ID=1301
POOL_MANAGER=0x00b036b58a818b1bc34d502d3fe730db729e62ac
ROUTER=0xf70536B3bcC1bD1a972dc186A2cf84cC6da6Be5D
POSITION_MANAGER=0xf969aee60879c54baaed9f3ed26147db216fd664
STATE_VIEW=0xc199f1072a74d4e905aba1a84d9a45e2546b6222
QUOTER=0x56dcd40a3f2d466f48e7f48bdbe5cc9b92ae4472
POOL_SWAP_TEST=0x9140a78c1a137c7ff1c151ec8231272af78a99a4
POOL_MODIFY_LIQUIDITY_TEST=0x5fa728c0a5cfd51bee4b060773f50554c0c8a7ab
PERMIT2=0x000000000022D473030F116dDEE9F6B43aC78BA3
FACTORY=0x4e59b44847b379578588920cA78FbF26c0B4956C
USDC=0x31d0220469e10c4E71834a79b1f276d740d3768F

# Ethereum Sepolia, the control: the chain UNICA is live on.
SEPOLIA_ROUTER=0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b
SEPOLIA_POOL_MANAGER=0xE03A1074c86CFeDd5C142C4F04F1a1536e203543

# The addresses this repository's current creation code mines to, on any chain (script/HookAddressForChain.s.sol).
HOOK=0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0
EXECUTOR=0x044bc8a8773EC7b9B8de2467766636dFFCaC6210

ok=0; fail=0; skip=0
chk()  { if eval "$2" >/dev/null 2>&1; then echo "PASS  $1"; ok=$((ok+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
skp()  { echo "SKIP  $1 — $2"; skip=$((skip+1)); }
# Byte length of the runtime at an address, or -1 when the endpoint gave nothing back. -1 is not
# zero: an unanswered read and a vacant address must never print the same number.
codelen() {
  local c
  c=$(cast code "$1" --rpc-url "${2:-$RPC}" 2>/dev/null) || true
  [ -z "$c" ] && { echo -1; return; }
  echo $(( (${#c} - 2) / 2 ))
}
call() { cast call "$1" "$2" --rpc-url "${3:-$RPC}" 2>/dev/null | head -1 | awk '{print $1}'; }
lower() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }

# run_probe <sig> <rpc> <outfile> — the fork probe, under the same rule as every `cast` here: a run
# that produced no scoreboard did not reach the chain, and must not be scored as a chain that said
# no. MEASURED 2026-09-09: two consecutive runs of this file against the default public endpoint
# gave 28/28 and then 25/28 with two probe rows red, because a fork read went unanswered mid-run and
# `forge script` exited before printing anything. Those two red rows were about a router that had
# not changed. Retry until the output carries its own count line; if it never does, the caller
# prints SKIP and says which endpoint went quiet.
run_probe() {
  local sig="$1" rpc="$2" out="$3" i=1
  while [ "$i" -le "$CHAIN_READ_ATTEMPTS" ]; do
    (cd "$ROOT" && forge script "$PROBE" --sig "$sig" --rpc-url "$rpc") > "$out" 2>&1 || true
    if grep -q 'checks run:' "$out"; then
      [ "$i" -gt 1 ] && chain_read_retries=$((chain_read_retries + i - 1))
      return 0
    fi
    i=$((i + 1))
    [ "$i" -le "$CHAIN_READ_ATTEMPTS" ] && sleep 2
  done
  chain_read_retries=$((chain_read_retries + CHAIN_READ_ATTEMPTS))
  return 1
}

echo "# Unichain Sepolia verification against $RPC, $(date -u +%Y-%m-%dT%H:%M:%SZ)"

chk "chain id is $CHAIN_ID" "[ \"\$(cast chain-id --rpc-url $RPC)\" = $CHAIN_ID ]"

# ---- the deployment, address by address, each with the byte count the document records ----------
# The byte count is the point. An address that answers a call but holds a different build is the
# failure mode a bare "has code" check cannot see.
chk "PoolManager $POOL_MANAGER holds 24009 bytes"                  "[ \"\$(codelen $POOL_MANAGER)\" = 24009 ]"
chk "Universal Router $ROUTER holds 19540 bytes"                   "[ \"\$(codelen $ROUTER)\" = 19540 ]"
chk "PositionManager $POSITION_MANAGER holds 23877 bytes"          "[ \"\$(codelen $POSITION_MANAGER)\" = 23877 ]"
chk "StateView $STATE_VIEW holds 3531 bytes"                       "[ \"\$(codelen $STATE_VIEW)\" = 3531 ]"
chk "Quoter $QUOTER holds 5820 bytes"                              "[ \"\$(codelen $QUOTER)\" = 5820 ]"
chk "PoolSwapTest $POOL_SWAP_TEST holds 6950 bytes"                "[ \"\$(codelen $POOL_SWAP_TEST)\" = 6950 ]"
chk "PoolModifyLiquidityTest $POOL_MODIFY_LIQUIDITY_TEST holds 6050 bytes" "[ \"\$(codelen $POOL_MODIFY_LIQUIDITY_TEST)\" = 6050 ]"
chk "Permit2 $PERMIT2 holds 9152 bytes"                            "[ \"\$(codelen $PERMIT2)\" = 9152 ]"
chk "CREATE2 factory $FACTORY holds 69 bytes"                      "[ \"\$(codelen $FACTORY)\" = 69 ]"
chk "Circle USDC $USDC holds 1798 bytes"                           "[ \"\$(codelen $USDC)\" = 1798 ]"

# ---- the cross-check: every one of them names the same PoolManager -------------------------------
# Transcribing an address from a page is how a wrong address enters a document. Five contracts all
# reporting the same PoolManager is what makes the set self-consistent rather than merely copied.
for pair in "Universal Router:$ROUTER:poolManager()(address)" \
            "StateView:$STATE_VIEW:poolManager()(address)" \
            "PositionManager:$POSITION_MANAGER:poolManager()(address)" \
            "Quoter:$QUOTER:poolManager()(address)" \
            "PoolSwapTest:$POOL_SWAP_TEST:manager()(address)" \
            "PoolModifyLiquidityTest:$POOL_MODIFY_LIQUIDITY_TEST:manager()(address)"; do
  nm="${pair%%:*}"; rest="${pair#*:}"; addr="${rest%%:*}"; sig="${rest#*:}"
  chk "$nm reports PoolManager $POOL_MANAGER" "[ \"\$(lower \"\$(call $addr '$sig')\")\" = \"$(lower $POOL_MANAGER)\" ]"
done

chk "Circle USDC reports symbol USDC"  "[ \"\$(call $USDC 'symbol()(string)')\" = '\"USDC\"' ]"
chk "Circle USDC reports 6 decimals"   "[ \"\$(call $USDC 'decimals()(uint8)')\" = 6 ]"

# ---- the addresses UNICA would land on are still free --------------------------------------------
chk "the mined hook address $HOOK is vacant on this chain"     "[ \"\$(codelen $HOOK)\" = 0 ]"
chk "the derived executor address $EXECUTOR is vacant on this chain" "[ \"\$(codelen $EXECUTOR)\" = 0 ]"

# ---- the control rows: the same build, or not --------------------------------------------------
# Output is captured to files, never interpolated into an `eval`d string: probe output contains
# quotes and punctuation, and a runner that can be broken by the text of its own evidence is a
# runner that will one day report a syntax error as a chain result.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# `-s` is not enough here, and finding that out cost a sabotage run: the retrying `cast` in
# docs/proof/retry.sh prints its empty result through `printf '%s\n'`, so a read that never reached
# the chain still leaves a one-byte file behind. A file holding a bare newline is not a runtime.
# Ask for what a runtime actually looks like instead.
holds_runtime() { grep -qE '^0x[0-9a-fA-F]{2,}$' "$1" 2>/dev/null; }

cast code "$ROUTER" --rpc-url "$RPC" > "$TMP/uni-router.hex" 2>/dev/null || true
cast code "$SEPOLIA_ROUTER" --rpc-url "$CONTROL_RPC" > "$TMP/sep-router.hex" 2>/dev/null || true
if ! holds_runtime "$TMP/uni-router.hex" || ! holds_runtime "$TMP/sep-router.hex"; then
  skp "Ethereum Sepolia's Universal Router is the same size (19540)" \
    "one of $RPC / $CONTROL_RPC returned no runtime in $CHAIN_READ_ATTEMPTS attempts"
  skp "the two Universal Routers differ only in whole 20-byte runs (constructor immutables)" \
    "one of $RPC / $CONTROL_RPC returned no runtime in $CHAIN_READ_ATTEMPTS attempts"
else
  sep_router_len=$(( ($(wc -c < "$TMP/sep-router.hex") - 3) / 2 ))
  chk "Ethereum Sepolia's Universal Router is the same size (19540)" "[ \"$sep_router_len\" = 19540 ]"
  # The strongest evidence available short of source. If every differing byte falls inside a whole
  # 20-byte run, the two runtimes are one compiled build carrying different constructor immutables —
  # 20 bytes is an address and nothing else in EVM code is that shape by accident. A single differing
  # byte OUTSIDE such a run would mean genuinely different code, and this row would go red, which is
  # the case that would overturn the layout verdict below.
  chk "the two Universal Routers differ only in whole 20-byte runs (constructor immutables)" \
    "python3 '$ROOT/docs/chains/immutables-only-diff.py' '$TMP/uni-router.hex' '$TMP/sep-router.hex'"
fi

# ---- the row the whole chain assessment rests on -------------------------------------------------
# The router-layout probe, run against a fork of the real deployed bytecode. Its self-test runs
# FIRST: a probe whose deciding predicate has not been shown to fail is not evidence, so a broken
# instrument must stop this runner before its verdict is read, not after.
if ! command -v forge >/dev/null 2>&1; then
  skp "the router-layout probe self-test passes" "forge is not on PATH"
  skp "the router-layout probe reports 12 of 12 on chain 1301" "forge is not on PATH"
  skp "chain 1301's router delivers a 32-byte order id under the FIVE-field layout" "forge is not on PATH"
  skp "the same probe reports 12 of 12 on the Ethereum Sepolia control" "forge is not on PATH"
  skp "src/libraries/UniswapDeployments.sol still does NOT resolve chain 1301" "forge is not on PATH"
else
  PROBE="script/UnichainSepoliaProbe.s.sol:UnichainSepoliaProbe"

  if run_probe "selfTest()" "$RPC" "$TMP/selftest.txt"; then
    chk "the router-layout probe self-test passes (its deciding predicate goes red on a body that drops the order id)" \
      "grep -q 'failed: 0' '$TMP/selftest.txt'"
  else
    skp "the router-layout probe self-test passes" "$RPC did not answer in $CHAIN_READ_ATTEMPTS attempts"
  fi

  if run_probe "run()" "$RPC" "$TMP/probe-1301.txt"; then
    sed -n '/VERDICT for chain/,/skipped:/p' "$TMP/probe-1301.txt" | sed 's/^/      /'
    chk "the router-layout probe reports 12 of 12 on chain 1301" \
      "grep -q 'passed: 12' '$TMP/probe-1301.txt' && grep -q 'failed: 0' '$TMP/probe-1301.txt'"
    chk "chain 1301's router delivers a 32-byte order id under the FIVE-field layout" \
      "grep -q 'PASS  FIVE-field encoding with a 32-byte order id: the hook receives that order id' '$TMP/probe-1301.txt'"
    # The blocker, asserted in the direction that is true TODAY, so it goes red the day chain 1301 is
    # added to the frozen library — exactly when docs/chains/UNICHAIN-SEPOLIA.md needs rewriting and
    # is most likely to be forgotten.
    chk "src/libraries/UniswapDeployments.sol still does NOT resolve chain 1301 (the deploy blocker this document records)" \
      "grep -q 'UniswapDeployments.universalRouter knows this chain: false' '$TMP/probe-1301.txt'"
  else
    skp "the router-layout probe reports 12 of 12 on chain 1301" "$RPC did not answer in $CHAIN_READ_ATTEMPTS attempts"
    skp "chain 1301's router delivers a 32-byte order id under the FIVE-field layout" "$RPC did not answer"
    skp "src/libraries/UniswapDeployments.sol still does NOT resolve chain 1301" "$RPC did not answer"
  fi

  if run_probe "run()" "$CONTROL_RPC" "$TMP/probe-sepolia.txt"; then
    chk "the same probe reports 12 of 12 on the Ethereum Sepolia control" \
      "grep -q 'passed: 12' '$TMP/probe-sepolia.txt' && grep -q 'failed: 0' '$TMP/probe-sepolia.txt'"
  else
    skp "the same probe reports 12 of 12 on the Ethereum Sepolia control" \
      "$CONTROL_RPC did not answer in $CHAIN_READ_ATTEMPTS attempts"
  fi
fi

echo "checks run: $((ok+fail+skip)), passed: $ok, failed: $fail, skipped: $skip"
report_retries
[ "$fail" -eq 0 ]
