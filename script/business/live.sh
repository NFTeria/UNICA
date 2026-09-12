#!/usr/bin/env bash
# live.sh — serve the business screens against a PUBLIC test network's recorded deployment.
#   make business-live NET=sepolia_testnet      (alias = the foundry.toml rpc alias; its URL lives only in .env)
#
# The companion runs in its own session (lib.sh detach) and reads the chain through the URL named by
# <ALIAS>_RPC_URL in .env; it hands the browser a
# same-origin pipe (/local/rpc), so the URL never reaches a page. The wallet in the browser is the login;
# nothing here holds a key. Testnet only: the manifest's own environment label is what the screens show.
set -euo pipefail
cd "$(dirname "$0")/../.."
NET=${1:-${NET:-}}; [ -n "$NET" ] || { echo "STOP: name the network alias, e.g. make business-live NET=sepolia_testnet"; exit 1; }
case "$NET" in sepolia_testnet) C=11155111;; base_testnet) C=84532;; arbitrum_testnet) C=421614;; unichain_testnet) C=1301;; robinhood_testnet) C=46630;; *) echo "STOP: unknown alias $NET"; exit 1;; esac
MAN=deployments/unica-v4/$C.json
[ -f "$MAN" ] || { echo "STOP: no recorded deployment at $MAN; run the v5 stages for $NET first"; exit 1; }
[ -f .env ] || { echo "STOP: no .env; it must define $(tr '[:lower:]' '[:upper:]' <<<"$NET")_RPC_URL"; exit 1; }
VAR="$(tr '[:lower:]' '[:upper:]' <<<"$NET")_RPC_URL"
set -a; . ./.env; set +a
URL="${!VAR:-}"
[ -n "$URL" ] || { echo "STOP: $VAR is not set in .env"; exit 1; }
PORT="${UNICA_SERVE_PORT:-8787}"
[ -d apps/web/out ] || node apps/web/build.mjs >/dev/null
if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then lsof -ti tcp:"$PORT" | xargs kill 2>/dev/null || true; sleep 1; fi
mkdir -p .rehearsal
. script/business/lib.sh
LIVE_LOG=".rehearsal/business-live-$C.log"
detach env MANIFEST_PATH="$MAN" UNICA_LOCAL_RPC="$URL" UNICA_SERVE_PORT="$PORT" bash -c 'exec bash script/anvil/serve.sh >"$0" 2>&1' "$LIVE_LOG"
for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; if curl -fsS "http://127.0.0.1:$PORT/local/config.json" >/dev/null 2>&1; then break; fi; done
curl -fsS "http://127.0.0.1:$PORT/local/config.json" >/dev/null 2>&1 || { echo "STOP: the companion did not answer on $PORT; see .rehearsal/business-live-$C.log"; exit 1; }
echo "UNICA on $NET (chain $C), testnet only, served at http://127.0.0.1:$PORT/"
echo "  Home (log in with your wallet):  http://127.0.0.1:$PORT/"
echo "  Your business:                   http://127.0.0.1:$PORT/business/"
echo "  Add a business:                  http://127.0.0.1:$PORT/join/"
echo "Stop it with: make business-down   (or kill the process listening on $PORT)"
