#!/usr/bin/env bash
# verify-v3.sh — re-proves the UNICA V3 four-chain deployment FROM THE CHAIN, not from this
# repository's claims. Pure reads: nothing here signs, broadcasts, or spends.
#
#   bash script/verify-v3.sh                # all four chains
#   bash script/verify-v3.sh --offline      # only the rows that need no endpoint at all
#   bash script/verify-v3.sh --self-test    # sabotage the instrument and prove each row can go red
#   bash script/verify-v3.sh sepolia_testnet base_testnet   # a subset, by foundry.toml alias
#
# Shape borrowed from docs/proof/verify-live.sh, deliberately: PASS/FAIL per row, one row per fact,
# each row naming what it read and what it expected, a stated count at the end, non-zero exit on any
# failure. The `cast` retry wrapper is SOURCED from docs/proof/retry.sh rather than written a second
# time — see that file for the measurement that made it necessary (28/31, 24/31, 28/31 in one minute
# against a chain that had not changed).
#
# A chain that cannot be reached is a SKIP printed as a SKIP. It is never folded into a pass, and it
# never turns into a FAIL either: "the endpoint did not answer" and "the chain says no" are
# different sentences and this script refuses to print the second when it means the first.
#
# WHAT THIS PROVES AND WHAT IT DOES NOT. It proves DEPLOYED and BOUND on four chains. It does not
# prove EXERCISED: `receiptCount()` and `orderCount()` are 0 on all four, this script prints those
# zeros as zeros, and no row here asserts that a settlement has happened. If one ever does, the two
# VALUE rows change and nothing else does.
set -uo pipefail
cd "$(dirname "$0")/.."

# ------------------------------------------------------------------------------------------------
# THE PINNED TABLE. Every constant below was read from the chain on 2026-09-09 and is re-read on
# every run; the script's job is to disagree with this table out loud when the chain disagrees.
# ------------------------------------------------------------------------------------------------
HOOK=0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0
EXEC=0x015692C9E43ca19a2504F79368D1156A56680517
HOOK_BYTES=10634
EXEC_BYTES=12953

# alias | chain id | that chain's official v4 PoolManager | hook runtime keccak | executor runtime keccak
#
# The two hashes are PER CHAIN and they are all different, which is the opposite of what a reader
# expects and is the single most important thing on this page. See the masked-hash rows below.
CHAINS=(
  "sepolia_testnet|11155111|0xE03A1074c86CFeDd5C142C4F04F1a1536e203543|0xc5639b87f5ca3cf799c357705e5a4a868e05514803b70eb0215ac5551e16389c|0x710a9580051b0fff0f7eb7efd8d04d6ddd8089dffcfabc1fc52a1ce22a08797d"  # keccak: hook runtime hash | executor runtime hash
  "unichain_testnet|1301|0x00B036B58a818B1BC34d502D3fE730Db729e62AC|0xe64418f5094a0878d199974bc37d49aee0d49e22235943a0cb7473534e7df091|0xf7465fe2cdf3005d1ba75f22d56960a72811da5b3fab8a88670d146faf59684c"  # keccak: hook runtime hash | executor runtime hash
  "base_testnet|84532|0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408|0xf59dab21ea1acbe17b32704416790c384deb6c3de81810f42c7cdc1c3b50d9e1|0xd89597705cd1ddca983674bbf97a623264250a126293e2e95a82d8aee0ee7688"  # keccak: hook runtime hash | executor runtime hash
  "arbitrum_testnet|421614|0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317|0x3644c4848cb85bd4b3bb32336327515fba0f78e9c1a6ed43a8fda2db803f287e|0xdb966b8c0cf6471f22c03cad712e691f34baaabc9b06ea8c11be2fbc84e52910"  # keccak: hook runtime hash | executor runtime hash
)

# THE RUNTIME CODE HASH IS **NOT** THE SAME ON ALL FOUR CHAINS, AND IT MUST NOT BE.
#
# It is tempting to write the row "the runtime code hash is identical everywhere" and it would be a
# false row. Measured on all four chains, 2026-09-09: the hook's runtime is 10,634 bytes on every
# chain and its keccak is a DIFFERENT value on every chain; the executor's is 12,953 bytes on every
# chain with four different keccaks. That is correct behaviour, not drift. Solidity `immutable`
# values are written into the runtime code at construction, UnicaDeploymentsV3 resolves this chain's
# PoolManager, router and payout currency at construction time, and so four chains give four
# runtimes. The CREATE2 address is unaffected because it is a function of the INIT code, which is
# identical everywhere — that identity is what the one shared address already proves.
#
# So the honest strong claim is made two ways instead:
#   (1) the runtime LENGTH is identical on all four, per contract; and
#   (2) with the immutable slots below blanked, the runtime hashes to ONE value across all four.
#
# The slot table was derived once, by diffing the four live runtimes byte for byte: every differing
# byte falls inside a run that is exactly 20 bytes (an address) or exactly 32 bytes (a bytes32), and
# there are no others. The offsets are PINNED here rather than re-derived at run time on purpose —
# a mask computed from the four codes being compared would agree with itself no matter what the
# chains said, which is a check that cannot fail. Pinned, a fifth differing byte anywhere outside
# these runs changes the masked hash and the row goes red.
HOOK_IMMUTABLES="1061:20 1219:20 1379:20 1573:20 1738:20 1936:20 2100:20 2138:20 2301:20 2598:20 2635:20 2789:20 2954:20 3095:20 4616:20"
EXEC_IMMUTABLES="718:20 965:20 1191:20 1517:20 4352:20 6277:20 6520:20 6544:32 6660:20 6706:32 6757:20 6778:32"
HOOK_MASKED=0x8a830c48fe4e8eacd8b93d7e0f99e36461a15ed380e0335384a9b1b83db17951  # keccak, immutables masked
EXEC_MASKED=0xe63a30383f0c10aa6a1d7772e245089d2570400e15c4b45b2834c8cfa0b6388e  # keccak, immutables masked

# The v4 flag encoding, from lib/uniswap-hooks/lib/v4-core/src/libraries/Hooks.sol: the fourteen
# permission booleans occupy bits 13..0 of the hook address, in the order getHookPermissions returns
# them. beforeInitialize is bit 13, beforeSwap is bit 7, afterSwap is bit 6.
FLAGS_EXPECTED=8384        # 0x20C0 — beforeInitialize | beforeSwap | afterSwap
BIT_BEFORE_SWAP_RETURNS_DELTA=3
BIT_AFTER_ADD_LIQUIDITY=10

SIG_PERMS='getHookPermissions()((bool,bool,bool,bool,bool,bool,bool,bool,bool,bool,bool,bool,bool,bool))'
RECORD_DIR=broadcast/DeployV3.s.sol

ok=0; fail=0; skip=0

pass() { echo "PASS  $1"; ok=$((ok+1)); }
red()  { echo "FAIL  $1"; fail=$((fail+1)); }
skipped() { echo "SKIP  $1"; skip=$((skip+1)); }

# One row, one fact: it names what it read, what it expected, and what it got when they differ.
# A row whose reading came back EMPTY is a SKIP, never a FAIL — nobody answered, so the chain said
# nothing, and printing "the chain says no" there is the lie this repository has caught itself in
# three times.
expect() { # name expected actual
  local name="$1" want="$2" got="$3"
  if [ -z "$got" ]; then skipped "$name — read came back EMPTY after ${CHAIN_READ_ATTEMPTS:-5} attempts; not a pass, not a chain failure"; return; fi
  if [ "$got" = "$want" ]; then pass "$name (read: $got)"; else red "$name — expected $want, chain said $got"; fi
}

# A number the chain reports that this script does NOT assert a value for. Printed, never scored.
value() { # name n
  local name="$1" n="$2"
  if [ -z "$n" ]; then skipped "$name — read came back EMPTY"; return; fi
  echo "VALUE $name: $n"
}

lower() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }

# The low fourteen bits of an address, as a decimal number. Pure arithmetic on a string: NO RPC.
low14() { python3 -c "import sys;print(int(sys.argv[1],16)&0x3fff)" "$1" 2>/dev/null; }

# Blank the pinned immutable runs and return the code as 0x-hex, so it can be hashed.
# Any run that reaches past the end of the code raises, prints nothing, and the row becomes a SKIP
# rather than a hash of a truncated body that happens to look plausible.
mask_hex() { # code-hex runs
  python3 -c '
import sys
code = bytearray(bytes.fromhex(sys.argv[1][2:]))
for run in sys.argv[2].split():
    s, l = (int(x) for x in run.split(":"))
    if s + l > len(code): raise SystemExit(1)
    code[s:s + l] = b"\x00" * l
print("0x" + code.hex())
' "$1" "$2" 2>/dev/null
}

# The fourteen booleans getHookPermissions returns, packed the way the address encodes them: the
# first one printed is the most significant of the fourteen, which is bit 13.
pack_perms() { # "(true, false, ...)"
  printf '%s' "$1" | tr -d '() ' | tr ',' '\n' \
    | awk 'BEGIN{v=0;n=0} NF{v=v*2+($1=="true"?1:0);n++} END{if(n==14) printf "%d", v}'
}

# One contract out of a deploy record: "txhash recordedBlock recordedStatus", from the record only.
record_row() { # record-path contract-name
  python3 -c '
import json, sys
r = json.load(open(sys.argv[1]))
h = next(t["hash"] for t in r["transactions"] if t.get("contractName") == sys.argv[2])
rc = next(x for x in r["receipts"] if x["transactionHash"] == h)
print(h, int(rc["blockNumber"], 16), int(rc["status"], 16))
' "$1" "$2" 2>/dev/null
}

# The same transaction, read back from the chain: "block status". Never from the record's labels.
chain_row() { # txhash alias
  cast receipt "$1" --rpc-url "$2" --json 2>/dev/null \
    | python3 -c 'import json,sys;r=json.load(sys.stdin);h=lambda v:int(v,16) if isinstance(v,str) else v;print(h(r["blockNumber"]), h(r["status"]))' 2>/dev/null
}

# ================================================================================================
# --self-test — feed each instrument a known-bad input and require it to go red, and a known-good
# input and require it to go green. A check that has never failed is not a check. Every row here is
# OFFLINE: it needs no endpoint, no keys, and no deployment, so it runs in the gate.
# ================================================================================================
if [ "${1:-}" = "--self-test" ]; then
  t_ok=0; t_fail=0
  t() { if eval "$2"; then echo "PASS  $1"; t_ok=$((t_ok+1)); else echo "FAIL  $1"; t_fail=$((t_fail+1)); fi; }
  # The scoring helpers themselves: green on agreement, red on disagreement, SKIP on silence.
  score() { ok=0; fail=0; skip=0; expect "row" "$1" "$2" >/dev/null; echo "$ok $fail $skip"; }
  t "expect() PASSES when the chain agrees"                    "[ \"\$(score A A)\" = '1 0 0' ]"
  t "expect() FAILS when the chain disagrees"                  "[ \"\$(score A B)\" = '0 1 0' ]"
  t "expect() SKIPS on an empty read, scoring neither way"     "[ \"\$(score A '')\" = '0 0 1' ]"
  # SABOTAGE 1 — the pinned PoolManager, one nibble flipped. Sepolia's manager ...203543 becomes
  # ...203542. The row must go red; nothing else about the address changed.
  t "one flipped nibble in a pinned PoolManager goes RED" \
    "[ \"\$(score 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543 0xE03A1074c86CFeDd5C142C4F04F1a1536e203542)\" = '0 1 0' ]"
  # SABOTAGE 2 — the wrong byte count claimed for the hook.
  t "a byte count off by one goes RED"                         "[ \"\$(score $HOOK_BYTES 10633)\" = '0 1 0' ]"
  # SABOTAGE 3 — the live V1 hook in place of V3. NOTE, and this is the point of the row: the V1
  # hook on Sepolia is ALSO 10,634 bytes and its low fourteen bits are ALSO 0x20C0, so neither the
  # size row nor the flag row can tell the two apart. The runtime-hash row is the only one that can,
  # which is why the hash rows exist at all.
  V1_HOOK=0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0
  t "V1 and V3 hooks are indistinguishable by their low 14 bits (so the flag row cannot catch a mixup)" \
    "[ \"\$(low14 $V1_HOOK)\" = \"\$(low14 $HOOK)\" ]"
  t "a V1 runtime hash in the V3 hash row goes RED" \
    "[ \"\$(score 0xc5639b87f5ca3cf799c357705e5a4a868e05514803b70eb0215ac5551e16389c 0x0e33e64a90fdf8f8ecc3f6d3f26cd54d6b6cf9dd2c4b5be7dd2f0b1a0e4d5c6b)\" = '0 1 0' ]"  # keccak: the real V3 hash against a deliberately wrong hash
  # The flag arithmetic, offline, both directions.
  t "the V3 hook address low 14 bits are 0x20C0"               "[ \"\$(low14 $HOOK)\" = $FLAGS_EXPECTED ]"
  t "bit $BIT_BEFORE_SWAP_RETURNS_DELTA is clear in 0x20C0"    "[ \$(( $FLAGS_EXPECTED >> $BIT_BEFORE_SWAP_RETURNS_DELTA & 1 )) = 0 ]"
  t "bit $BIT_AFTER_ADD_LIQUIDITY is clear in 0x20C0"          "[ \$(( $FLAGS_EXPECTED >> $BIT_AFTER_ADD_LIQUIDITY & 1 )) = 0 ]"
  t "an address ending 20C8 is CAUGHT (bit 3 set)"             "[ \$(( \$(low14 0x000000000000000000000000000000000000A0C8) >> 3 & 1 )) = 1 ]"
  t "an address ending 24C0 is CAUGHT (bit 10 set)"            "[ \$(( \$(low14 0x00000000000000000000000000000000000024C0) >> 10 & 1 )) = 1 ]"
  # The permission packer, against the tuple the deployed hook actually returns, then sabotaged.
  GOOD='(true, false, false, false, false, false, true, true, false, false, false, false, false, false)'
  BAD_ADD='(true, false, false, true, false, false, true, true, false, false, false, false, false, false)'
  BAD_DELTA='(true, false, false, false, false, false, true, true, false, false, true, false, false, false)'
  t "the packer turns the live permission tuple into 0x20C0"   "[ \"\$(pack_perms \"\$GOOD\")\" = $FLAGS_EXPECTED ]"
  t "afterAddLiquidity=true packs to something else (bit 10)"  "[ \$(( \$(pack_perms \"\$BAD_ADD\") >> 10 & 1 )) = 1 ]"
  t "beforeSwapReturnDelta=true packs to something else (bit 3)" "[ \$(( \$(pack_perms \"\$BAD_DELTA\") >> 3 & 1 )) = 1 ]"
  t "a tuple with the wrong arity packs to NOTHING, not to 0"  "[ -z \"\$(pack_perms '(true, false)')\" ]"
  # The mask itself must discriminate: same body masked at the pinned runs is one value; masked at
  # the WRONG runs, or with a byte changed outside every run, it is a different value.
  # Every value below is computed HERE, not inside the eval string. The first draft of these four
  # rows built them with nested command substitution inside the quoted expression; bash could not
  # parse it, printed a syntax error, and "a byte changed OUTSIDE every masked run survives the
  # mask" went GREEN anyway — because two failed substitutions are unequal to each other. A row
  # that passes because both of its sides are broken is the exact failure this file exists to
  # catch, and it was caught by running the self-test rather than by reading it.
  BODY=0x$(python3 -c "print('ab'*64)")
  BODY_LAST_BYTE_CHANGED=0x$(python3 -c "print('ab'*63+'cd')")
  WANT_MASKED_AT_0=0x$(python3 -c "print('00'*4+'ab'*60)")
  GOT_MASKED_AT_0=$(mask_hex "$BODY" '0:4')
  GOT_MASKED_AT_8=$(mask_hex "$BODY" '8:4')
  GOT_MASKED_CHANGED=$(mask_hex "$BODY_LAST_BYTE_CHANGED" '0:4')
  t "mask_hex blanks exactly the run it was given, and nothing else" "[ \"$GOT_MASKED_AT_0\" = \"$WANT_MASKED_AT_0\" ]"
  t "mask_hex output is non-empty, so the row above compared real values" "[ -n \"$GOT_MASKED_AT_0\" ] && [ -n \"$GOT_MASKED_AT_8\" ] && [ -n \"$GOT_MASKED_CHANGED\" ]"
  t "mask_hex at a DIFFERENT offset gives a different body"    "[ \"$GOT_MASKED_AT_0\" != \"$GOT_MASKED_AT_8\" ]"
  t "mask_hex refuses a run past the end (prints nothing)"     "[ -z \"\$(mask_hex $BODY '60:20')\" ]"
  t "a byte changed OUTSIDE every masked run survives the mask" "[ \"$GOT_MASKED_AT_0\" != \"$GOT_MASKED_CHANGED\" ]"
  # The record reader must not invent a row when the record is missing.
  t "record_row on a missing file prints nothing"              "[ -z \"\$(record_row /nonexistent.json UnicaHookV3)\" ]"
  echo "checks run: $((t_ok+t_fail)), passed: $t_ok, failed: $t_fail"
  [ "$t_fail" = 0 ]
  exit $?
fi

# ================================================================================================
# The real run.
# ================================================================================================
. docs/proof/retry.sh

OFFLINE_ONLY=0
if [ "${1:-}" = "--offline" ]; then OFFLINE_ONLY=1; shift; fi
WANT="$*"

echo "# UNICA V3 four-chain verification, $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "# hook     $HOOK"
echo "# executor $EXEC"
echo

# ---- OFFLINE. These three rows read the hook ADDRESS and nothing else. No endpoint is contacted,
#      no record is opened; they are true on a laptop in a tunnel and they belong in the gate. ----
echo "-- offline (no RPC: these rows read the address itself)"
addr_flags=$(low14 "$HOOK")
expect "hook address low 14 bits are the v4 flags 0x20C0 = beforeInitialize|beforeSwap|afterSwap" \
  "$FLAGS_EXPECTED" "$addr_flags"
expect "bit $BIT_BEFORE_SWAP_RETURNS_DELTA BEFORE_SWAP_RETURNS_DELTA is CLEAR in the address" \
  0 "$(( addr_flags >> BIT_BEFORE_SWAP_RETURNS_DELTA & 1 ))"
expect "bit $BIT_AFTER_ADD_LIQUIDITY AFTER_ADD_LIQUIDITY is CLEAR in the address" \
  0 "$(( addr_flags >> BIT_AFTER_ADD_LIQUIDITY & 1 ))"
echo

if [ "$OFFLINE_ONLY" = 1 ]; then
  echo "checks run: $((ok+fail+skip)), passed: $ok, failed: $fail, skipped: $skip"
  echo "note: --offline was given, so every chain row was skipped by request, not by failure."
  [ "$fail" = 0 ]
  exit $?
fi

hook_masked_seen=""; exec_masked_seen=""; chains_read=0

for entry in "${CHAINS[@]}"; do
  IFS='|' read -r alias cid pm hhash ehash <<<"$entry"
  [ -n "$WANT" ] && ! printf '%s\n' $WANT | grep -qx "$alias" && continue
  echo "-- $alias (chain id $cid)"

  got_cid=$(cast chain-id --rpc-url "$alias" 2>/dev/null)
  if [ -z "$got_cid" ]; then
    skipped "$alias: the alias did not answer a chain id — endpoint unset in .env or unreachable. Every row for this chain is skipped, not failed."
    echo
    continue
  fi
  expect "$alias: the endpoint answers the chain id the alias claims" "$cid" "$got_cid"
  [ "$got_cid" != "$cid" ] && { echo "   (refusing the remaining rows for '$alias': it is not the chain it claims to be)"; echo; continue; }
  chains_read=$((chains_read+1))

  # -- code, by exact byte count, then by hash --------------------------------------------------
  hcode=$(cast code "$HOOK" --rpc-url "$alias" 2>/dev/null)
  ecode=$(cast code "$EXEC" --rpc-url "$alias" 2>/dev/null)
  expect "$alias: hook has runtime code at $HOOK, exactly $HOOK_BYTES bytes" \
    "$HOOK_BYTES" "$( [ -n "$hcode" ] && echo $(( (${#hcode} - 2) / 2 )) )"
  expect "$alias: executor has runtime code at $EXEC, exactly $EXEC_BYTES bytes" \
    "$EXEC_BYTES" "$( [ -n "$ecode" ] && echo $(( (${#ecode} - 2) / 2 )) )"
  expect "$alias: hook runtime keccak is this chain's pinned hash" \
    "$hhash" "$( [ -n "$hcode" ] && cast keccak "$hcode" )"
  expect "$alias: executor runtime keccak is this chain's pinned hash" \
    "$ehash" "$( [ -n "$ecode" ] && cast keccak "$ecode" )"

  # -- the same code with the immutable slots blanked: ONE hash across all four chains ------------
  hm=$( [ -n "$hcode" ] && cast keccak "$(mask_hex "$hcode" "$HOOK_IMMUTABLES")" 2>/dev/null )
  em=$( [ -n "$ecode" ] && cast keccak "$(mask_hex "$ecode" "$EXEC_IMMUTABLES")" 2>/dev/null )
  expect "$alias: hook runtime with its 15 immutable slots blanked hashes to the ONE cross-chain value" \
    "$HOOK_MASKED" "$hm"
  expect "$alias: executor runtime with its 12 immutable slots blanked hashes to the ONE cross-chain value" \
    "$EXEC_MASKED" "$em"
  [ -n "$hm" ] && hook_masked_seen="$hook_masked_seen $hm"
  [ -n "$em" ] && exec_masked_seen="$exec_masked_seen $em"

  # -- the binding, read from each side ----------------------------------------------------------
  expect "$alias: hook.SETTLEMENT_EXECUTOR() names the executor" \
    "$EXEC" "$(cast call "$HOOK" 'SETTLEMENT_EXECUTOR()(address)' --rpc-url "$alias" 2>/dev/null | head -1 | awk '{print $1}')"
  expect "$alias: executor.HOOK() names the hook (bound both ways)" \
    "$HOOK" "$(cast call "$EXEC" 'HOOK()(address)' --rpc-url "$alias" 2>/dev/null | head -1 | awk '{print $1}')"

  # -- this chain's own official PoolManager, against the pinned table ---------------------------
  expect "$alias: hook.poolManager() is this chain's official v4 PoolManager" \
    "$pm" "$(cast call "$HOOK" 'poolManager()(address)' --rpc-url "$alias" 2>/dev/null | head -1 | awk '{print $1}')"

  # -- the deployed contract's own permissions, packed, against the address it lives at -----------
  perms=$(cast call "$HOOK" "$SIG_PERMS" --rpc-url "$alias" 2>/dev/null | head -1)
  expect "$alias: getHookPermissions() read from the DEPLOYED hook packs to the address's low 14 bits" \
    "$addr_flags" "$(pack_perms "$perms")"

  # -- the deployment transactions, from the record, confirmed against the chain ------------------
  rec="$RECORD_DIR/$cid/run-latest.json"
  if [ ! -f "$rec" ]; then
    skipped "$alias: no deploy record at $rec — the two record rows are skipped. Nothing else changes."
  else
    for cn in UnicaHookV3 UnicaExecutorV3; do
      row=$(record_row "$rec" "$cn")
      if [ -z "$row" ]; then
        skipped "$alias: $rec names no landed $cn transaction — record row skipped"
        continue
      fi
      set -- $row; rh=$1; rblock=$2; rstatus=$3
      expect "$alias: $rec records $cn at block $rblock with status $rstatus" "1" "$rstatus"
      expect "$alias: the chain confirms $cn deploy ${rh:0:12} — status 1 at the recorded block $rblock" \
        "$rblock 1" "$(chain_row "$rh" "$alias")"
    done
  fi

  # -- the two counters. VALUES, not assertions. A zero is printed as a zero. ---------------------
  value "$alias: hook.receiptCount()" \
    "$(cast call "$HOOK" 'receiptCount()(uint256)' --rpc-url "$alias" 2>/dev/null | head -1 | awk '{print $1}')"
  value "$alias: executor.orderCount()" \
    "$(cast call "$EXEC" 'orderCount()(uint256)' --rpc-url "$alias" 2>/dev/null | head -1 | awk '{print $1}')"
  echo
done

# -- the cross-chain claim, stated once, over the chains that actually answered -------------------
if [ "$chains_read" -ge 2 ]; then
  echo "-- across the $chains_read chain(s) read this run"
  expect "the masked hook runtime is ONE value across every chain read" \
    1 "$(printf '%s\n' $hook_masked_seen | sort -u | grep -c .)"
  expect "the masked executor runtime is ONE value across every chain read" \
    1 "$(printf '%s\n' $exec_masked_seen | sort -u | grep -c .)"
  echo
else
  skipped "the cross-chain masked-hash comparison needs at least two chains; $chains_read answered"
  echo
fi

echo "checks run: $((ok+fail+skip)), passed: $ok, failed: $fail, skipped: $skip"
report_retries
echo "DEPLOYED and BOUND is what these rows reach. EXERCISED is not: the two VALUE rows above are the"
echo "settlement counters, and they are the honest state of this deployment, whatever they say."
if [ "$skip" != 0 ]; then
  echo "NOTE: $skip row(s) were skipped, not passed and not failed. Read the SKIP lines for why."
fi
[ "$fail" = 0 ]
