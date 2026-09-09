#!/usr/bin/env bash
# mainnet-guard.sh — refuse a mainnet chain id, by number, before anything can broadcast.
#
# UNICA is testnet-only and says so in public. That claim is worth exactly as much as the thing
# that enforces it, so this is the thing: sourced by every script that can broadcast, it compares
# the chain id the endpoint ACTUALLY reports against a list of mainnets and exits non-zero on a
# match. It reads the chain rather than trusting an alias, because an alias is a name someone
# chose and a chain id is what the node says it is.
#
#   . script/mainnet-guard.sh && refuse_mainnet "$RPC_URL"
#   . script/mainnet-guard.sh && refuse_mainnet_id "$CHAIN_ID"
#
# TWO ENTRY POINTS, ONE LIST, ONE REFUSAL. `refuse_mainnet` reads the chain id from an endpoint URL
# and hands it to `refuse_mainnet_id`, which owns the list and the message. The id form exists
# because a caller that names a chain by a `foundry.toml` ALIAS has no URL to pass: the URL carries
# an API key, so this repository never puts one on a command line. Such a caller reads the id with
# `cast chain-id --rpc-url <alias>` and refuses it here. Splitting the function is not splitting the
# list — there is still exactly one `MAINNET_CHAIN_IDS` and exactly one place that says REFUSING.
MAINNET_CHAIN_IDS="1 10 56 130 137 143 196 480 1868 4217 4326 4663 7777777 8453 42161 42220 43114 57073"

# Refuse a chain id that is already in hand. An EMPTY id is refused too: a guard that cannot read
# the chain must not assume the chain is safe.
refuse_mainnet_id() {
  local got="$1"
  if [ -z "$got" ]; then
    echo "REFUSING: could not read a chain id from the endpoint. A guard that cannot read the chain"
    echo "          must not assume the chain is safe."
    return 1
  fi
  # MEMBERSHIP BY SUBSTRING, NOT BY A `for` LOOP OVER THE LIST, and the difference is a fail-OPEN.
  # `for m in $MAINNET_CHAIN_IDS` relies on the shell splitting an unquoted variable into words. bash
  # does; ZSH DOES NOT. Sourced into a zsh session on 2026-09-09 the loop ran exactly once, comparing
  # "1" against the whole string "1 10 56 ...", and the guard cheerfully answered "chain id 1 is not
  # on the mainnet list" — a mainnet admitted, by a guard whose own self-test was green, because the
  # self-test runs under this file's bash shebang. The padded `case` below compares the same one list
  # the same way in both shells and depends on no splitting at all.
  case " $MAINNET_CHAIN_IDS " in
    *" $got "*)
      echo "REFUSING: chain id $got is a MAINNET. UNICA is testnet-only, and this is enforced here"
      echo "          rather than merely written down. Nothing in this repository has been deployed"
      echo "          to or broadcast on a mainnet."
      return 1
      ;;
  esac
  echo "chain id $got is not on the mainnet list"
  return 0
}

refuse_mainnet() {
  local url="$1" got
  got=$(curl -s --max-time 15 -X POST "$url" -H 'content-type: application/json' \
        -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
        | python3 -c 'import sys,json
try:
    r=json.load(sys.stdin).get("result"); print(int(r,16) if r else "")
except Exception: print("")' 2>/dev/null)
  refuse_mainnet_id "$got"
}

# Self-test: the guard must refuse a known mainnet and admit a known testnet. A guard that has
# never failed is not a guard.
if [ "${1:-}" = "--self-test" ]; then
  ok=0; fail=0
  chk() { if eval "$2"; then echo "PASS  $1"; ok=$((ok+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
  chk "a mainnet chain id is on the list"      "echo \$MAINNET_CHAIN_IDS | grep -qw 1"
  chk "Robinhood mainnet 4663 is on the list"  "echo \$MAINNET_CHAIN_IDS | grep -qw 4663"
  chk "Unichain mainnet 130 is on the list"    "echo \$MAINNET_CHAIN_IDS | grep -qw 130"
  chk "Sepolia 11155111 is NOT on the list"    "! echo \$MAINNET_CHAIN_IDS | grep -qw 11155111"
  chk "Robinhood testnet 46630 is NOT on it"   "! echo \$MAINNET_CHAIN_IDS | grep -qw 46630"
  chk "Unichain Sepolia 1301 is NOT on it"     "! echo \$MAINNET_CHAIN_IDS | grep -qw 1301"
  chk "Arc testnet 5042002 is NOT on it"       "! echo \$MAINNET_CHAIN_IDS | grep -qw 5042002"
  chk "an unreadable endpoint is REFUSED"      "! refuse_mainnet http://127.0.0.1:1 >/dev/null 2>&1"
  # The id form, sabotaged directly: it must refuse every mainnet it is handed, admit a testnet,
  # and refuse an EMPTY id rather than treat "I could not tell" as "not a mainnet".
  chk "id form REFUSES mainnet 1"              "! refuse_mainnet_id 1 >/dev/null 2>&1"
  chk "id form REFUSES Robinhood mainnet 4663" "! refuse_mainnet_id 4663 >/dev/null 2>&1"
  chk "id form REFUSES Base mainnet 8453"      "! refuse_mainnet_id 8453 >/dev/null 2>&1"
  chk "id form ADMITS Sepolia 11155111"        "refuse_mainnet_id 11155111 >/dev/null 2>&1"
  chk "id form ADMITS Robinhood testnet 46630" "refuse_mainnet_id 46630 >/dev/null 2>&1"
  chk "id form REFUSES an empty id"            "! refuse_mainnet_id '' >/dev/null 2>&1"
  echo "checks run: $((ok+fail)), passed: $ok, failed: $fail"
  [ "$fail" = 0 ]
fi
