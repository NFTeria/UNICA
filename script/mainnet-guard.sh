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
MAINNET_CHAIN_IDS="1 10 56 130 137 143 196 480 1868 4217 4326 4663 7777777 8453 42161 42220 43114 57073"

refuse_mainnet() {
  local url="$1" got
  got=$(curl -s --max-time 15 -X POST "$url" -H 'content-type: application/json' \
        -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
        | python3 -c 'import sys,json
try:
    r=json.load(sys.stdin).get("result"); print(int(r,16) if r else "")
except Exception: print("")' 2>/dev/null)
  if [ -z "$got" ]; then
    echo "REFUSING: could not read a chain id from the endpoint. A guard that cannot read the chain"
    echo "          must not assume the chain is safe."
    return 1
  fi
  for m in $MAINNET_CHAIN_IDS; do
    if [ "$got" = "$m" ]; then
      echo "REFUSING: chain id $got is a MAINNET. UNICA is testnet-only, and this is enforced here"
      echo "          rather than merely written down. Nothing in this repository has been deployed"
      echo "          to or broadcast on a mainnet."
      return 1
    fi
  done
  echo "chain id $got is not on the mainnet list"
  return 0
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
  echo "checks run: $((ok+fail)), passed: $ok, failed: $fail"
  [ "$fail" = 0 ]
fi
