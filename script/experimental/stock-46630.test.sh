#!/usr/bin/env bash
# stock-46630.test.sh — the stage wrapper's refusals, OFFLINE. Part of `make gate`.
#
# Four local anvils, no fork, no RPC, no key: one answering chain id 46630 while holding none of
# 46630's contracts, one answering 31337, one answering 1 (a mainnet id), and one answering 46630
# with STAND-IN code etched at the two addresses the token stage checks — 24,009 bytes where the
# PoolManager lives and a stub that answers every call with zero where TSLA lives — so that stage's
# simulation SUCCEEDS offline and the plan summary after it can be tested too. Every case runs the
# REAL wrapper under `env -i`, so nothing in the caller's shell — a stray LIVE_BROADCAST, a stray
# CHAIN — can make a row pass or fail. Every refusal must exit non-zero AND print the sentence that
# names its reason; a non-zero exit for some other reason is a failed row, not a pass.
#
#   bash script/experimental/stock-46630.test.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
W=script/experimental/stock-46630.sh
D=0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73
OPT_IN=I_UNDERSTAND_THIS_SENDS_TRANSACTIONS
P46=18461; P31=18462; P1=18463; PDEAD=18464; PSTUB=18465
E46="http://127.0.0.1:$P46"; E31="http://127.0.0.1:$P31"; E1="http://127.0.0.1:$P1"; ESTUB="http://127.0.0.1:$PSTUB"
ok=0; bad=0; skipped=0

anvil --chain-id 46630 --port "$P46" --silent & A1=$!
anvil --port "$P31" --silent & A2=$!
anvil --chain-id 1 --port "$P1" --silent & A3=$!
anvil --chain-id 46630 --port "$PSTUB" --silent & A4=$!
trap 'kill $A1 $A2 $A3 $A4 2>/dev/null || true' EXIT
for e in "$E46" "$E31" "$E1" "$ESTUB"; do
  for _ in $(seq 1 60); do cast chain-id --rpc-url "$e" >/dev/null 2>&1 && break; sleep 0.25; done
done
# The stand-ins. 0x60206000f3 is PUSH1 32, PUSH1 0, RETURN: thirty-two zero bytes for any call, so
# TSLA.balanceOf answers 0. The PoolManager stand-in is 24,009 zero bytes; the stage checks only its
# size. Neither is the real contract and no row treats them as one.
cast rpc anvil_setCode 0x8366a39CC670B4001A1121B8F6A443A643e40951 "0x$(printf '%048018d' 0)" --rpc-url "$ESTUB" >/dev/null
cast rpc anvil_setCode 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E 0x60206000f3 --rpc-url "$ESTUB" >/dev/null
cast rpc anvil_setBalance "$D" 0xde0b6b3a7640000 --rpc-url "$ESTUB" >/dev/null
# Mined, because the wrapper pins forge's fork to the head block, and state edited after the last
# mined block is not part of that block. Without this the stand-ins are invisible to the simulation.
cast rpc anvil_mine 1 --rpc-url "$ESTUB" >/dev/null

# TARGET_SCRIPT defaults to the wrapper; S8 points it at the rehearsal driver instead.
run() { env -i PATH="$PATH" HOME="$HOME" "$@" bash "${TARGET_SCRIPT:-$W}" 2>&1; }
row() { # row <name> <substring that must appear> <expected: refuse|reach> <env assignments...>
  local name="$1" want="$2" expect="$3"; shift 3
  local out rc
  out=$(run "$@"); rc=$?
  if printf '%s' "$out" | grep -qF -- "$want" && { [ "$expect" = reach ] || [ "$rc" -ne 0 ]; }; then
    echo "PASS  $name"; ok=$((ok + 1))
  else
    echo "FAIL  $name   (exit $rc; wanted: $want)"; printf '%s\n' "$out" | tail -4 | sed 's/^/        /'; bad=$((bad + 1))
  fi
}

echo "# control: a well-formed dry run passes every wrapper guard and reaches the simulation"
row "S0  a valid dry run reaches the simulation on chain 46630" \
    "mode dry, chain 46630" reach DRY_RUN=1 STAGE=token DEPLOYER=$D ENDPOINT=$E46
row "S0b ...where the script's own rows refuse a chain holding none of 46630's contracts" \
    "the simulation failed; nothing was broadcast" refuse DRY_RUN=1 STAGE=token DEPLOYER=$D ENDPOINT=$E46
row "S0c on a chain holding 46630's shapes, a dry run prints the whole plan and sends nothing" \
    "DRY_RUN=1: stopping before the broadcast line; nothing was sent" reach DRY_RUN=1 STAGE=token DEPLOYER=$D ENDPOINT=$ESTUB
row "S0d ...and the plan names the spend ceiling before anything could be confirmed" \
    "spend ceiling" reach DRY_RUN=1 STAGE=token DEPLOYER=$D ENDPOINT=$ESTUB
# forge writes the endpoint URL into cache/<script>/<chain>/dry-run/; against the keyed primary that
# is the key. The wrapper removes that record on exit. Checked by the directory, after the run above.
if [ -d cache/StockSettlement46630.s.sol ] && find cache/StockSettlement46630.s.sol -type d -name dry-run | grep -q .; then
  echo "FAIL  S0e a dry run leaves no forge record of the endpoint behind"; bad=$((bad + 1))
else
  echo "PASS  S0e a dry run leaves no forge record of the endpoint behind"; ok=$((ok + 1))
fi

echo "# the mode: nothing sends without the exact opt-in"
row "S1  no mode at all is refused" "no mode:" refuse STAGE=token DEPLOYER=$D ENDPOINT=$E46
row "S2  a LIVE_BROADCAST that is not the exact sentence is refused" \
    "LIVE_BROADCAST must be exactly" refuse STAGE=token DEPLOYER=$D ENDPOINT=$E46 LIVE_BROADCAST=yes
row "S3  rehearsal and live together are refused" \
    "contradictory" refuse STAGE=token DEPLOYER=$D ENDPOINT=$E46 REHEARSE=1 LIVE_BROADCAST=$OPT_IN
row "S4  live without a keystore name is refused" \
    "needs DEPLOYER_ACCOUNT" refuse STAGE=token DEPLOYER=$D ENDPOINT=$E46 LIVE_BROADCAST=$OPT_IN
if { : < /dev/tty; } 2>/dev/null; then
  echo "SKIP  S5  live without a terminal — this shell HAS a terminal, so the case cannot be staged here"
  skipped=$((skipped + 1))
else
  row "S5  live without a terminal to confirm in is refused" \
      "needs a terminal" refuse STAGE=token DEPLOYER=$D ENDPOINT=$E46 LIVE_BROADCAST=$OPT_IN DEPLOYER_ACCOUNT=anyname
fi

echo "# accidental live broadcast during a rehearsal"
row "S6  a rehearsal against a hosted endpoint is refused before any call" \
    "needs a loopback anvil URL" refuse STAGE=token DEPLOYER=$D ENDPOINT=robinhood_testnet REHEARSE=1
row "S7  a rehearsal against a loopback port that is not anvil is refused" \
    "not anvil" refuse STAGE=token DEPLOYER=$D ENDPOINT=http://127.0.0.1:$PDEAD REHEARSE=1
TARGET_SCRIPT=script/experimental/rehearse-46630.sh \
row "S8  the rehearsal driver will not start beside a LIVE_BROADCAST value" \
    "will not run beside it" refuse LIVE_BROADCAST=$OPT_IN DEPLOYER=$D

echo "# the chain"
row "S9  a chain that is not 46630 is refused" \
    "this script is for 46630 only" refuse DRY_RUN=1 STAGE=token DEPLOYER=$D ENDPOINT=$E31
row "S10 a mainnet chain id is refused by the one mainnet list" \
    "refused chain id '1'" refuse DRY_RUN=1 STAGE=token DEPLOYER=$D ENDPOINT=$E1
# Run on the stand-in chain, because the plan summary's `cast call` is the command that reads CHAIN;
# on the empty chain the simulation stops first and a hijacked CHAIN would never show.
row "S11 a stray CHAIN in the environment cannot hijack cast's --chain" \
    "TSLA balance (raw) 0" reach DRY_RUN=1 STAGE=token DEPLOYER=$D ENDPOINT=$ESTUB CHAIN=not-a-chain

echo "# the inputs"
row "S12 no DEPLOYER is refused" "DEPLOYER (the public address" refuse DRY_RUN=1 STAGE=token ENDPOINT=$E46
row "S13 a missing stage input is refused by name" \
    "HOOK is not set for STAGE=pool" refuse DRY_RUN=1 STAGE=pool TOKEN=0x1 DEPLOYER=$D ENDPOINT=$E46
row "S14 an unknown stage is refused" "unknown STAGE" refuse DRY_RUN=1 STAGE=nope DEPLOYER=$D ENDPOINT=$E46

echo "checks run: $((ok + bad)), passed: $ok, failed: $bad, skipped: $skipped"
[ "$bad" -eq 0 ]
