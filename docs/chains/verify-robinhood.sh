#!/usr/bin/env bash
# verify-robinhood.sh — re-proves, from the chain rather than from this repository's claims, every
# fact `docs/chains/ROBINHOOD.md` states about Robinhood testnet (chain 46630). Pure reads and local
# forks: nothing here signs, sends, or spends. Prints PASS/FAIL/SKIP per check and a count at the
# end, and exits non-zero if any check failed.
#
#   bash docs/chains/verify-robinhood.sh [rpc] [control-rpc]
#
# `rpc` defaults to the `robinhood_testnet` alias in foundry.toml, which resolves from `.env`. The
# alias is used rather than a URL because a provider endpoint carries its API key in the path, and
# this repository is public.
#
# WHY THE CONTROL RPC IS AN ARGUMENT TOO. Two rows compare against Ethereum Sepolia, the chain UNICA
# is actually live on. "The same build" means nothing unless the thing it is compared to is read at
# the same time from its own chain. If the control cannot be reached those rows print SKIP and say
# so; a SKIP is never folded into a pass.
#
# WHAT THIS CANNOT TELL YOU. Every row is about a chain UNICA has never been deployed on. They prove
# the ground is what the document says it is. They do not prove a deploy would succeed, and the row
# "the frozen source still does NOT resolve chain 46630" is expected to report exactly that for as
# long as the freeze holds.
set -uo pipefail

# Every `cast` below is retried on an empty answer. See docs/proof/retry.sh for the measurement that
# made this necessary: an endpoint that does not answer prints nothing, and an empty answer would
# otherwise score identically to a chain that said no.
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 2
. "$ROOT/docs/proof/retry.sh"

RPC="${1:-robinhood_testnet}"
CONTROL_RPC="${2:-https://ethereum-sepolia-rpc.publicnode.com}"

CHAIN_ID=46630

# ---- the deployment, as Uniswap's own deployments page lists it for "Robinhood Chain" -------------
POOL_MANAGER=0x8366a39cc670b4001a1121b8f6a443a643e40951
ROUTER=0x8876789976decbfcbbbe364623c63652db8c0904
POSITION_MANAGER=0x58daec3116aae6d93017baaea7749052e8a04fa7
POSITION_DESCRIPTOR=0x9639443158e8c5efa35bd45287bf2effd3d8dc06
QUOTER=0x8dc178efb8111bb0973dd9d722ebeff267c98f94
STATE_VIEW=0xf3334192d15450cdd385c8b70e03f9a6bd9e673b
PERMIT2=0x000000000022D473030F116dDEE9F6B43aC78BA3
FACTORY=0x4e59b44847b379578588920cA78FbF26c0B4956C

# The Universal Router runtime this document is about, read 2026-09-09. Pinned because every layout
# claim below is about THIS bytecode: a redeploy at that address must go red here rather than
# quietly change what the rows mean.
ROUTER_CODEHASH=0xfdd90802f39ce5fc8bac4c2f1b3ac7bac530fd17ff46b0630f1bd00f1e14082f

# The three canonical MAINNET addresses from Robinhood's own docs. They are read here to be shown
# ABSENT: this is the evidence for the equity verdict, not a transcription of it.
MAINNET_TSLA=0x322F0929c4625eD5bAd873c95208D54E1c003b2d
MAINNET_WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
MAINNET_USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168

# The addresses this repository's current creation code mines to, on any chain.
HOOK=0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0
EXECUTOR=0x044bc8a8773EC7b9B8de2467766636dFFCaC6210

ok=0; fail=0; skip=0
chk() { if eval "$2" >/dev/null 2>&1; then echo "PASS  $1"; ok=$((ok+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
skp() { echo "SKIP  $1 — $2"; skip=$((skip+1)); }

# Byte length of the runtime at an address, or -1 when the endpoint gave nothing back. -1 is not
# zero: an unanswered read and a vacant address must never print the same number. Three of the rows
# below assert a length of exactly 0, and without this distinction a dead endpoint would prove them.
codelen() {
  local c
  c=$(cast code "$1" --rpc-url "${2:-$RPC}" 2>/dev/null) || true
  [ -z "$c" ] && { echo -1; return; }
  echo $(( (${#c} - 2) / 2 ))
}
call()  { cast call "$1" "$2" --rpc-url "${3:-$RPC}" 2>/dev/null | head -1 | awk '{print $1}'; }
lower() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }

# A v4 pool id is the keccak of the abi-encoded PoolKey. Derived here rather than transcribed, so a
# pool named in the document cannot drift from the pool actually read.
poolid() {
  cast keccak "$(cast abi-encode 'f(address,address,uint24,int24,address)' "$1" "$2" "$3" "$4" "$5")" 2>/dev/null
}
liquidity() { call "$STATE_VIEW" "getLiquidity(bytes32)(uint128)" | sed 's/[^0-9].*//'; }
pool_liquidity() {
  local id; id=$(poolid "$@"); [ -z "$id" ] && { echo UNANSWERED; return; }
  local l; l=$(cast call "$STATE_VIEW" "getLiquidity(bytes32)(uint128)" "$id" --rpc-url "$RPC" 2>/dev/null | head -1 | awk '{print $1}')
  [ -z "$l" ] && { echo UNANSWERED; return; }
  echo "$l"
}
pool_price() {
  local id; id=$(poolid "$@"); [ -z "$id" ] && { echo UNANSWERED; return; }
  local s; s=$(cast call "$STATE_VIEW" "getSlot0(bytes32)(uint160,int24,uint24,uint24)" "$id" --rpc-url "$RPC" 2>/dev/null | head -1 | awk '{print $1}')
  [ -z "$s" ] && { echo UNANSWERED; return; }
  echo "$s"
}

echo "# Robinhood testnet (46630) verification against $RPC, $(date -u +%Y-%m-%dT%H:%M:%SZ)"

chk "chain id is $CHAIN_ID" "[ \"\$(cast chain-id --rpc-url $RPC)\" = $CHAIN_ID ]"

# ---- the deployment, address by address, each with the byte count the document records -----------
# The byte count is the point. An address that answers a call but holds a different build is the
# failure mode a bare "has code" check cannot see — and on this chain two of these contracts ARE a
# different build from the Sepolia ones, which is the whole subject of the document.
chk "PoolManager $POOL_MANAGER holds 24009 bytes"          "[ \"\$(codelen $POOL_MANAGER)\" = 24009 ]"
chk "Universal Router $ROUTER holds 24546 bytes"           "[ \"\$(codelen $ROUTER)\" = 24546 ]"
chk "PositionManager $POSITION_MANAGER holds 23877 bytes"  "[ \"\$(codelen $POSITION_MANAGER)\" = 23877 ]"
chk "PositionDescriptor $POSITION_DESCRIPTOR holds 752 bytes" "[ \"\$(codelen $POSITION_DESCRIPTOR)\" = 752 ]"
chk "Quoter $QUOTER holds 6118 bytes"                      "[ \"\$(codelen $QUOTER)\" = 6118 ]"
chk "StateView $STATE_VIEW holds 3531 bytes"               "[ \"\$(codelen $STATE_VIEW)\" = 3531 ]"
chk "Permit2 $PERMIT2 holds 9152 bytes"                    "[ \"\$(codelen $PERMIT2)\" = 9152 ]"
chk "CREATE2 factory $FACTORY holds 69 bytes"              "[ \"\$(codelen $FACTORY)\" = 69 ]"

# The router runtime is pinned by hash, not only by size: two different builds can share a size.
chk "the Universal Router runtime is the recorded build" \
  "[ \"\$(cast code $ROUTER --rpc-url $RPC | cast keccak)\" = $ROUTER_CODEHASH ]"

# ---- the cross-check that makes the table self-consistent ----------------------------------------
# Transcribing an address from a page is how a wrong address enters a document. Five contracts all
# reporting the same PoolManager is what makes the set self-consistent rather than merely copied.
for pair in "Universal Router:$ROUTER" "StateView:$STATE_VIEW" "PositionManager:$POSITION_MANAGER" \
            "Quoter:$QUOTER" "PositionDescriptor:$POSITION_DESCRIPTOR"; do
  nm="${pair%%:*}"; addr="${pair#*:}"
  chk "$nm reports PoolManager $POOL_MANAGER" \
    "[ \"\$(lower \"\$(call $addr 'poolManager()(address)')\")\" = \"$(lower $POOL_MANAGER)\" ]"
done

# ---- the CREATE2 factory is the same contract, which is what makes address arithmetic carry -------
if ! sep_factory=$(cast code "$FACTORY" --rpc-url "$CONTROL_RPC" 2>/dev/null) || \
   ! printf '%s' "$sep_factory" | grep -qE '^0x[0-9a-fA-F]{2,}$'; then
  skp "the CREATE2 factory is byte-identical to Ethereum Sepolia's" \
    "$CONTROL_RPC returned no runtime in $CHAIN_READ_ATTEMPTS attempts"
else
  chk "the CREATE2 factory is byte-identical to Ethereum Sepolia's" \
    "[ \"\$(cast code $FACTORY --rpc-url $RPC | cast keccak)\" = \"\$(printf '%s' '$sep_factory' | cast keccak)\" ]"
fi

# ---- the question the whole document exists to answer: is there liquidity here? -------------------
# PositionManager mints one ERC-721 per liquidity position, and its next id only ever goes up. This
# is the cheapest honest measure of "has anyone used v4 on this chain", and it needs no log scan —
# which matters, because the endpoints for this chain cap `eth_getLogs` at ten blocks and the chain
# is past block 116,000,000. See the document's section on what could NOT be swept.
chk "PositionManager reports at least 3622 as its next position id (3621 positions ever minted)" \
  "[ \"\$(call $POSITION_MANAGER 'nextTokenId()(uint256)')\" -ge 3622 ]"

# The singleton holds every pool's reserves, so a non-zero native balance is direct evidence that
# native-input pools on this chain are funded — the exact pool shape UNICA settles through.
chk "the PoolManager holds a non-zero native balance" \
  "[ \"\$(cast balance $POOL_MANAGER --rpc-url $RPC)\" != 0 ] && [ -n \"\$(cast balance $POOL_MANAGER --rpc-url $RPC)\" ]"

# THE POSITIVE CONTROL, BUILT FIRST. A named, real, native-input pool: currency0 is the zero address,
# which is the shape UNICA settles through. If this row cannot go green the instrument below it is
# not measuring anything, and the negative control that follows would pass for the wrong reason.
LIVE_POOL=(0x0000000000000000000000000000000000000000 0x17486A01bb8c3Ac90d94AeD9A16e8fE33b28F300 3000 60 0x0000000000000000000000000000000000000000)
chk "a real native-input pool (ETH/BCASHCAT, fee 3000, spacing 60) is initialised" \
  "[ \"\$(pool_price ${LIVE_POOL[*]})\" != 0 ] && [ \"\$(pool_price ${LIVE_POOL[*]})\" != UNANSWERED ]"
chk "that same pool holds non-zero liquidity" \
  "[ \"\$(pool_liquidity ${LIVE_POOL[*]})\" != 0 ] && [ \"\$(pool_liquidity ${LIVE_POOL[*]})\" != UNANSWERED ]"

# THE NEGATIVE CONTROL. The same reader, pointed at a pool key that CANNOT exist on any chain: two
# identical currencies and a zero tick spacing, both refused by `PoolManager.initialize`
# (`CurrenciesOutOfOrderOrEqual`, `TickSpacingTooSmall`) — the same impossible key `src/compat/
# RouterProbe.sol` uses, and for the same reason. A reader that answers "has liquidity" to this is
# broken, and the two rows above would be worthless without this one.
DEAD_POOL=(0xffffffffffffffffffffffffffffffffffffffff 0xffffffffffffffffffffffffffffffffffffffff 0 0 0x0000000000000000000000000000000000000000)
chk "the same reader says an impossible pool key holds zero liquidity" \
  "[ \"\$(pool_liquidity ${DEAD_POOL[*]})\" = 0 ]"
chk "the same reader says an impossible pool key has no price" \
  "[ \"\$(pool_price ${DEAD_POOL[*]})\" = 0 ]"

# ---- the settlement pair UNICA would actually want, and its absence ------------------------------
# Testnet USDG is real and has code (row below). What does not exist is a hookless native/USDG pool
# at any standard tier — so a first settlement on this chain has no ready-made venue and would have
# to create and fund one. Asserted in the direction that is true today, so it goes red the day
# somebody creates one, which is exactly when the document needs rewriting.
TESTNET_USDG=0xE7AEfb0d18F5a3597324d92aE470847E32F38FdB
chk "testnet USDG $TESTNET_USDG has code and reports 6 decimals" \
  "[ \"\$(codelen $TESTNET_USDG)\" -gt 0 ] && [ \"\$(call $TESTNET_USDG 'decimals()(uint8)')\" = 6 ]"
# The two counters are kept apart deliberately. Counting only "pools found" would let five
# unanswered reads score as "no pool exists" — an empty result and a broken reporter looking
# identical, which is the one thing this repository refuses to ship. A sabotage run against a dead
# endpoint caught exactly that in an earlier draft of this row: it printed PASS having read nothing.
usdg_pools=0
usdg_answered=0
for combo in "100 1" "500 10" "3000 60" "10000 200" "0 60"; do
  set -- $combo
  l=$(pool_liquidity 0x0000000000000000000000000000000000000000 "$TESTNET_USDG" "$1" "$2" 0x0000000000000000000000000000000000000000)
  [ "$l" = UNANSWERED ] && continue
  usdg_answered=$((usdg_answered+1))
  [ "$l" != 0 ] && usdg_pools=$((usdg_pools+1))
done
if [ "$usdg_answered" -lt 5 ]; then
  skp "no hookless native/USDG pool holds liquidity at any of the five standard tiers" \
    "only $usdg_answered of 5 tiers answered — an unread tier is not an empty tier"
else
  chk "no hookless native/USDG pool holds liquidity at any of the five standard tiers" "[ $usdg_pools -eq 0 ]"
fi

# ---- the equity verdict, read as an ABSENCE rather than transcribed ------------------------------
# Robinhood's docs list these three as canonical MAINNET addresses (chain 4663). Reading them here
# and finding no code is what makes "the canonical mainnet contracts are not at these addresses on
# this chain" a measurement rather than a transcription.
#
# SUPERSEDED SCOPE, 2026-09-10: these rows once carried a broader reading — that no stock-token
# contract of any kind existed here. That is no longer what they show. A public faucet has since
# issued five testnet stock-token contracts at DIFFERENT addresses (ROBINHOOD.md section 0), so
# what these three rows establish is narrower and still true: the canonical mainnet addresses hold
# no code on this chain.
chk "the mainnet TSLA stock token has no code on chain $CHAIN_ID" "[ \"\$(codelen $MAINNET_TSLA)\" = 0 ]"
chk "the mainnet WETH has no code on chain $CHAIN_ID"             "[ \"\$(codelen $MAINNET_WETH)\" = 0 ]"
chk "the mainnet USDG has no code on chain $CHAIN_ID"             "[ \"\$(codelen $MAINNET_USDG)\" = 0 ]"

# Robinhood's own public asset registry, which is what its docs page renders its token table from.
# A read that does not answer is a SKIP, never a pass: "the registry listed nothing for 46630" and
# "the registry did not answer" must not look the same.
assets=$(curl -sS --max-time 30 https://api.robinhood.com/rhj/assets 2>/dev/null)
if [ -z "$assets" ] || ! printf '%s' "$assets" | grep -q '"chainId"'; then
  skp "Robinhood's asset registry lists no stock token on chain $CHAIN_ID" "api.robinhood.com did not answer"
  skp "Robinhood's asset registry does list stock tokens on mainnet 4663" "api.robinhood.com did not answer"
else
  # Both directions. The absence of 46630 proves nothing unless the registry demonstrably HAS
  # content — a truncated or empty answer would satisfy the first row on its own.
  chk "Robinhood's asset registry does list stock tokens on mainnet 4663" \
    "[ \"\$(printf '%s' \"\$assets\" | grep -oE '\"chainId\":4663[^0-9]' | wc -l | tr -d ' ')\" -gt 100 ]"
  chk "Robinhood's asset registry lists no stock token on chain $CHAIN_ID" \
    "! printf '%s' \"\$assets\" | grep -q '\"chainId\":$CHAIN_ID'"
fi

# ---- the ERC-8056 probe, and the control that makes its "no" mean something ------------------------
# Robinhood's Stock Tokens carry an ERC-8056 corporate-action multiplier, `uiMultiplier()`. Asking a
# token for it is the on-chain test for "is this a stock token", and every token found in a pool on
# 46630 answers nothing.
#
# THAT NEGATIVE IS WORTHLESS ON ITS OWN. A probe that has never been seen answering YES cannot
# distinguish "no stock tokens here" from "this call never works". So the control is read FIRST, off
# a real stock token on Robinhood MAINNET (chain 4663) — a read, and only a read; nothing here
# broadcasts, and script/mainnet-guard.sh refuses that chain id for anything that would.
MAINNET_RPC="${ROBINHOOD_MAINNET_RPC:-https://rpc.mainnet.chain.robinhood.com}"
mainnet_id=$(cast chain-id --rpc-url "$MAINNET_RPC" 2>/dev/null)
if [ "$mainnet_id" != 4663 ]; then
  skp "the ERC-8056 probe answers on a real stock token (mainnet TSLA)" \
    "$MAINNET_RPC did not answer as chain 4663 — without this control the row below proves nothing"
  skp "no token in a pool on chain $CHAIN_ID answers uiMultiplier()" \
    "the probe has no positive control, so its silence is not evidence"
else
  chk "the ERC-8056 probe answers on a real stock token (mainnet TSLA reports uiMultiplier and 18 decimals)" \
    "[ -n \"\$(cast call $MAINNET_TSLA 'uiMultiplier()(uint256)' --rpc-url $MAINNET_RPC 2>/dev/null)\" ] && [ \"\$(cast call $MAINNET_TSLA 'decimals()(uint8)' --rpc-url $MAINNET_RPC 2>/dev/null | head -1)\" = 18 ]"
  # The same probe, same shape of call, against a token that really is in a pool on 46630.
  chk "testnet USDG on chain $CHAIN_ID does NOT answer uiMultiplier() (it is not a stock token)" \
    "[ -z \"\$(cast call $TESTNET_USDG 'uiMultiplier()(uint256)' --rpc-url $RPC 2>/dev/null)\" ]"
fi

# ---- what a UNICA deploy would land on, and the blocker that stops it -----------------------------
chk "the mined hook address $HOOK is vacant on this chain"          "[ \"\$(codelen $HOOK)\" = 0 ]"
chk "the derived executor address $EXECUTOR is vacant on this chain" "[ \"\$(codelen $EXECUTOR)\" = 0 ]"

# Asserted in the direction that is true TODAY, so it goes red the day chain 46630 is added to the
# frozen library — exactly when this document needs rewriting and is most likely to be forgotten.
chk "src/libraries/UniswapDeployments.sol still does NOT resolve chain $CHAIN_ID (the deploy blocker)" \
  "! grep -q '$CHAIN_ID' $ROOT/src/libraries/UniswapDeployments.sol"

# ---- the row the layout verdict rests on ---------------------------------------------------------
# The existing compat suite, run against a fork of this chain's real router bytecode. It is not
# re-implemented here: `test/compat/UpgradedRouterCompat.t.sol` already owns those six rows.
#
# THE ENDPOINT IS EXPORTED ON PURPOSE, and this is the row that taught the lesson. Left alone, all
# six of those rows report SKIP on this machine, for a reason worth writing down because it is
# invisible from the output: `forge` loads the project's `.env` before the shell environment is
# consulted, and this repository's `.env` sets `ROBINHOOD_RPC_URL` — the variable that suite prefers
# — to an endpoint that answers `HTTP 401 Must be authenticated!`. The working endpoint is under a
# DIFFERENT name, `ROBINHOOD_TESTNET_RPC_URL`. A stale credential under the preferred name therefore
# beats both fallbacks (the suite's second choice is a `foundry.toml` alias spelled `robinhood`,
# while this repository spells it `robinhood_testnet`, so that one cannot resolve either), and six
# rows about the router this whole document is about measure nothing while the suite still exits
# reporting "0 failed". Exporting the endpoint the operator actually gave this runner overrides the
# stale value. Measured 2026-09-09.
if ! command -v forge >/dev/null 2>&1; then
  skp "the router on chain $CHAIN_ID expects the SIX-field layout (6 of 6 compat rows)" "forge is not on PATH"
else
  compat=$(ROBINHOOD_RPC_URL="$RPC" forge test --match-path test/compat/UpgradedRouterCompat.t.sol 2>&1)
  if printf '%s' "$compat" | grep -q 'suite: 6 passed'  || printf '%s' "$compat" | grep -qE '6 tests passed'; then
    chk "the router on chain $CHAIN_ID expects the SIX-field layout (6 of 6 compat rows)" "true"
  elif printf '%s' "$compat" | grep -qE '\[SKIP\]|skipped: 6|6 skipped'; then
    skp "the router on chain $CHAIN_ID expects the SIX-field layout (6 of 6 compat rows)" \
      "the suite could not fork $RPC — it measured nothing, so this is not a pass"
  else
    chk "the router on chain $CHAIN_ID expects the SIX-field layout (6 of 6 compat rows)" "false"
  fi
fi

echo "checks run: $((ok+fail+skip)), passed: $ok, failed: $fail, skipped: $skip"
report_retries
[ "$fail" -eq 0 ]
