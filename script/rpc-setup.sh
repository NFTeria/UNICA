#!/usr/bin/env bash
# rpc-setup.sh — set the RPC endpoint for every chain UNICA touches, once, interactively.
#
# WHY THIS EXISTS. A provider endpoint carries its API key in the URL path, so the whole URL is a
# credential — and this repository is public. The URL goes in .env (gitignored, chmod 600) and
# foundry.toml refers to it by variable name, so `cast --rpc-url robinhood_testnet` works without a
# key ever appearing in a command, a script, a commit or a shell transcript.
#
# EVERY ALIAS SAYS WHICH IT IS. `sepolia_testnet`, not `sepolia`; `ethereum_mainnet`, not
# `ethereum`. A one-word ambiguity is the kind of thing that points a broadcast at the wrong chain,
# and this project is testnet-only — enforced by chain id in script/mainnet-guard.sh, not merely
# written down.
#
#   bash script/rpc-setup.sh                    # the six testnets
#   bash script/rpc-setup.sh --mainnet          # the five mainnets (read-only comparison)
#   bash script/rpc-setup.sh --all
#   bash script/rpc-setup.sh robinhood_testnet  # just one
set -uo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=".env"

# alias | variable | chain id | keyless public fallback ("" = none, deliberately)
TESTNETS="
sepolia_testnet|SEPOLIA_TESTNET_RPC_URL|11155111|https://ethereum-sepolia-rpc.publicnode.com
arbitrum_testnet|ARBITRUM_TESTNET_RPC_URL|421614|https://sepolia-rollup.arbitrum.io/rpc
base_testnet|BASE_TESTNET_RPC_URL|84532|https://sepolia.base.org
unichain_testnet|UNICHAIN_TESTNET_RPC_URL|1301|https://sepolia.unichain.org
robinhood_testnet|ROBINHOOD_TESTNET_RPC_URL|46630|https://rpc.testnet.chain.robinhood.com
arc_testnet|ARC_TESTNET_RPC_URL|5042002|https://rpc.testnet.arc.io
"
MAINNETS="
ethereum_mainnet|ETHEREUM_MAINNET_RPC_URL|1|
arbitrum_mainnet|ARBITRUM_MAINNET_RPC_URL|42161|
base_mainnet|BASE_MAINNET_RPC_URL|8453|
unichain_mainnet|UNICHAIN_MAINNET_RPC_URL|130|
robinhood_mainnet|ROBINHOOD_MAINNET_RPC_URL|4663|
"

GROUP="testnet"; CHAINS="$TESTNETS"; ONLY=""
case "${1:-}" in
  --mainnet) CHAINS="$MAINNETS"; GROUP="mainnet" ;;
  --all)     CHAINS="$TESTNETS$MAINNETS"; GROUP="testnet and mainnet" ;;
  "")        : ;;
  *)         ONLY="$1" ; CHAINS="$TESTNETS$MAINNETS" ;;
esac

git check-ignore -q "$ENV_FILE" || { echo "REFUSING: $ENV_FILE is not gitignored. Fix .gitignore first."; exit 1; }
[ -f "$ENV_FILE" ] || { touch "$ENV_FILE"; echo "created $ENV_FILE"; }
chmod 600 "$ENV_FILE"

set_var() {
  local var="$1" val="$2" tmp
  tmp=$(mktemp)
  grep -v "^${var}=" "$ENV_FILE" > "$tmp" 2>/dev/null || true
  printf '%s=%s\n' "$var" "$val" >> "$tmp"
  mv "$tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"
}

echo "RPC endpoints for UNICA — $GROUP."
echo "Nothing you type is echoed. Enter alone keeps the current value; type 'public' for the"
echo "keyless fallback where one exists."
if [ "$GROUP" != "testnet" ]; then
  echo
  echo "MAINNET endpoints are for READING ONLY — comparing a deployed router against the mainnet"
  echo "build is exactly the check this project does. Setting one does not enable a broadcast:"
  echo "script/mainnet-guard.sh refuses a mainnet chain id by number."
fi
echo

for row in $CHAINS; do
  name=$(printf '%s' "$row" | cut -d'|' -f1)
  var=$(printf  '%s' "$row" | cut -d'|' -f2)
  cid=$(printf  '%s' "$row" | cut -d'|' -f3)
  pub=$(printf  '%s' "$row" | cut -d'|' -f4)
  [ -n "$ONLY" ] && [ "$ONLY" != "$name" ] && continue

  cur=$(grep "^${var}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2-)
  if [ -n "$cur" ]; then state="set, ${#cur} chars"; else state="unset"; fi
  printf '%-19s chain %-9s [%s]\n' "$name" "$cid" "$state"
  printf '  %s: ' "$var"
  read -r -s val; echo
  if [ -z "$val" ]; then
    # An alias whose variable is unset is a DEAD alias: foundry errors rather than falling back,
    # because it has no default syntax. So Enter on an unset variable writes the public endpoint.
    if [ -z "$cur" ] && [ -n "$pub" ]; then
      set_var "$var" "$pub"; echo "  unset — wrote the keyless public endpoint so the alias resolves"
    else
      echo "  kept"
    fi
  elif [ "$val" = "public" ]; then
    if [ -n "$pub" ]; then set_var "$var" "$pub"; echo "  set to the keyless public endpoint"
    else echo "  REFUSED: no public fallback for a mainnet, on purpose"; fi
  else
    case "$val" in
      https://*) set_var "$var" "$val"; echo "  set (${#val} chars, not shown)" ;;
      *)         echo "  REFUSED: must begin with https:// — left unchanged" ;;
    esac
  fi
  echo
done

echo "Verifying each endpoint reports the chain id it should:"
set -a; . "$ENV_FILE" 2>/dev/null; set +a
pass=0; fail=0; skip=0
for row in $CHAINS; do
  name=$(printf '%s' "$row" | cut -d'|' -f1)
  var=$(printf  '%s' "$row" | cut -d'|' -f2)
  cid=$(printf  '%s' "$row" | cut -d'|' -f3)
  pub=$(printf  '%s' "$row" | cut -d'|' -f4)
  [ -n "$ONLY" ] && [ "$ONLY" != "$name" ] && continue
  eval "url=\${$var:-$pub}"
  if [ -z "$url" ]; then
    printf '  SKIP  %-19s unset, no fallback (a SKIP, not a pass)\n' "$name"; skip=$((skip+1)); continue
  fi
  got=$(curl -s --max-time 15 -X POST "$url" -H 'content-type: application/json' \
        -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
        | python3 -c 'import sys,json
try:
    r=json.load(sys.stdin).get("result"); print(int(r,16) if r else "no-result")
except Exception: print("unreachable")' 2>/dev/null)
  if [ "$got" = "$cid" ]; then printf '  PASS  %-19s answered %s\n' "$name" "$got"; pass=$((pass+1))
  else printf '  FAIL  %-19s expected %s, got %s\n' "$name" "$cid" "$got"; fail=$((fail+1)); fi
done
echo
echo "checks run: $((pass+fail+skip)), passed: $pass, failed: $fail, skipped: $skip"
echo
echo "Use them by name — no URL in any command:"
echo "  cast chain-id --rpc-url robinhood_testnet"
echo "  forge test --fork-url arbitrum_testnet"
echo "  bash script/rpc-setup.sh --mainnet     # read-only mainnet comparison endpoints"
[ "$fail" = 0 ]
