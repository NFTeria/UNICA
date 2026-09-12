#!/usr/bin/env bash
# deploy-public.sh — UNICA v4 onto ONE named public chain, one stage at a time, dry-run by default.
#
#   bash script/unica-v4/deploy-public.sh <alias> <stage> [config.env]
#     alias   a foundry.toml rpc alias (sepolia_testnet, base_mainnet, ...) — never a URL
#     stage   preflight | A | B | C | activate | readback
#     config  defaults to config/unica-v4/<chainId>.env, read after the chain id is measured
#
# DRY RUN unless LIVE_BROADCAST=I_UNDERSTAND_THIS_SENDS_TRANSACTIONS is on the command line AND
# DEPLOYER_ACCOUNT names a forge keystore account; the password is prompted in a real terminal and
# never passes through this file. A mainnet id additionally requires UNICA_MAINNET_ACK typed on
# the same command line; the forge script re-checks it and the Safe-admin and pauser requirements.
#
# Every value comes from the config file; the Vyper identity token is compiled here with the pinned
# compiler when an identity authority is configured. Broadcast records land under
# broadcast/DeployPublic.s.sol/<chainId>/ and are committed as evidence after the owner's readback.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$HOME/.foundry/bin:$PATH"

ALIAS=${1:-}; STAGE=${2:-}; CONFIG=${3:-}
fail() { echo "STOP: $1"; exit 1; }
test -n "$ALIAS" || fail "name the foundry.toml rpc alias as the first argument"
case "$STAGE" in preflight|A|B|C|activate|readback) ;; *) fail "stage must be one of preflight | A | B | C | activate | readback" ;; esac

echo "== measuring the chain behind alias '$ALIAS'"
chain=$(cast chain-id --rpc-url "$ALIAS" 2>/dev/null || true)
test -n "$chain" || fail "the alias '$ALIAS' did not answer a chain id (is its variable set in .env?)"
head=$(cast block-number --rpc-url "$ALIAS")
echo "chain id $chain   head $head"

CONFIG=${CONFIG:-config/unica-v4/$chain.env}
test -f "$CONFIG" || fail "no configuration at $CONFIG (copy config/unica-v4/example.env and fill every value)"
# The one URL a configuration may carry is the badge's verification page; everything else that looks
# like an endpoint or a key is refused, because an RPC URL carries its credential in the path.
grep -vE '^UNICA_EXTERNAL_URL_BASE=' "$CONFIG" | grep -qiE 'https?://|(API|PRIVATE|SECRET)_?KEY|MNEMONIC|SEED_PHRASE' && fail "the configuration carries a URL or a key-shaped value; it must carry neither"
set -a; . "$CONFIG"; set +a
test "${UNICA_CHAIN_ID:-}" = "$chain" || fail "the configuration says chain ${UNICA_CHAIN_ID:-?}, the endpoint says $chain"
test -n "${DEPLOYER:-}" || fail "DEPLOYER (the public address that will sign) is not set in $CONFIG"

if [ "${UNICA_IS_MAINNET:-false}" = "true" ]; then
  test "${UNICA_MAINNET_ACK:-}" = "I_UNDERSTAND_THIS_IS_MAINNET" || fail "this is a MAINNET configuration; type UNICA_MAINNET_ACK=I_UNDERSTAND_THIS_IS_MAINNET on the command line to continue"
  admin_code=$(cast code "$UNICA_ADMIN" --rpc-url "$ALIAS")
  test "$admin_code" != "0x" || fail "on a mainnet the admin must be a contract (a Safe); $UNICA_ADMIN has no code"
  test -n "${UNICA_PAUSER:-}" && test "$UNICA_PAUSER" != "0x0000000000000000000000000000000000000000" || fail "on a mainnet a pauser is required"
fi

if [ -n "${UNICA_IDENTITY_AUTHORITY:-}" ] && [ "$STAGE" = "A" ]; then
  vy=$(vyper --version | head -1); case "$vy" in 0.4.3*) ;; *) fail "vyper 0.4.3 required exactly (ruling H8); found $vy" ;; esac
  IDENTITY_TOKEN_BYTECODE=$(vyper -p vy/src -f bytecode vy/src/art/identity_token.vy); export IDENTITY_TOKEN_BYTECODE
  echo "identity token bytecode: $(( (${#IDENTITY_TOKEN_BYTECODE} - 2) / 2 )) bytes (vyper $vy)"
fi

case "$STAGE" in
  preflight) SIG="preflight()" ;; A) SIG="stageA()" ;; B) SIG="stageB()" ;; C) SIG="stageC()" ;;
  activate) SIG="activate()" ;; readback) SIG="readback()" ;;
esac

if [ "${LIVE_BROADCAST:-}" = "I_UNDERSTAND_THIS_SENDS_TRANSACTIONS" ] && [ "$STAGE" != "preflight" ] && [ "$STAGE" != "readback" ]; then
  test -n "${DEPLOYER_ACCOUNT:-}" || fail "LIVE needs DEPLOYER_ACCOUNT (a forge keystore account name)"
  sender=$DEPLOYER; [ "$STAGE" = "activate" ] && sender=$UNICA_ADMIN
  echo "== LIVE stage $STAGE on chain $chain as $sender (keystore '$DEPLOYER_ACCOUNT'; password prompt follows)"
  forge script script/unica-v4/DeployPublic.s.sol:DeployPublic --sig "$SIG" \
    --rpc-url "$ALIAS" --fork-block-number "$head" --account "$DEPLOYER_ACCOUNT" --sender "$sender" --broadcast -vv
else
  echo "== DRY RUN stage $STAGE on chain $chain (simulation at block $head; nothing is signed or sent)"
  FOUNDRY_BROADCAST=.rehearsal/deploy-public forge script script/unica-v4/DeployPublic.s.sol:DeployPublic --sig "$SIG" \
    --rpc-url "$ALIAS" --fork-block-number "$head" --sender "${DEPLOYER}" -vv
  echo "dry run complete. To send: LIVE_BROADCAST=I_UNDERSTAND_THIS_SENDS_TRANSACTIONS DEPLOYER_ACCOUNT=<keystore> $0 $ALIAS $STAGE"
fi
