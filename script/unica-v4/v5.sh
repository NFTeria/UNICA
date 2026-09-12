#!/usr/bin/env bash
# v5.sh — the owner's one-step-at-a-time public deployment, driven by `make v5-<step> NET=<alias>`.
# TESTNET / NO VALUE. Every LIVE step calls script/unica-v4/deploy-public.sh, which broadcasts only
# with LIVE_BROADCAST on its command line and a forge keystore named in DEPLOYER_ACCOUNT; the
# password is prompted by cast/forge in the terminal and never passes through this file.
# Steps: preflight | A | readback | B | C | activate | manifest | verify | evidence | commit | ens-records | ens-lineage
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$HOME/.foundry/bin:$HOME/.local/bin:$PATH"
NET=${1:?alias}; STEP=${2:?step}
case "$NET" in sepolia_testnet) C=11155111;; base_testnet) C=84532;; arbitrum_testnet) C=421614;; unichain_testnet) C=1301;; *) echo "STOP: unknown alias $NET"; exit 1;; esac
CFG=config/unica-v4/$C.env; MAN=deployments/unica-v4/$C.json
fail() { echo "STOP: $1"; exit 1; }
cfg() { { grep -E "^$1=" "$CFG" || true; } | head -1 | cut -d= -f2 | awk '{print $1}'; }   # a missing key is empty, never a failure under pipefail
chain() { [ "$(cast chain-id --rpc-url "$NET")" = "$C" ] || fail "$NET is not chain $C"; echo "chain ok $C ($NET)"; }
code() { local i; for i in 1 2 3 4 5 6 7 8 9 10; do if [ "$(cast code "$1" --rpc-url "$NET")" != "0x" ]; then echo "code ok $1"; return 0; fi; sleep 3; done; fail "no runtime code at $1 after 30 s"; }
need_account() { [ -n "${DEPLOYER_ACCOUNT:-}" ] || { echo "set DEPLOYER_ACCOUNT to one of:"; cast wallet list; exit 1; }; }
live() { need_account; chain; LIVE_BROADCAST=I_UNDERSTAND_THIS_SENDS_TRANSACTIONS DEPLOYER_ACCOUNT="$DEPLOYER_ACCOUNT" bash script/unica-v4/deploy-public.sh "$NET" "$1"; }
status_is() { local out; out=$(bash script/unica-v4/deploy-public.sh "$NET" readback 2>/dev/null || true); grep -q "\"status\":\"$1\"" <<<"$out" || fail "readback status is not $1"; echo "readback status $1 ok"; }
case "$STEP" in
  preflight) chain; bash script/unica-v4/deploy-public.sh "$NET" preflight ;;
  A) live A; for v in UNICA_FACTORY UNICA_REGISTRY UNICA_IDENTITY_AUTHORITY UNICA_ADMISSION UNICA_IDENTITY_TOKEN; do a=$(cfg $v); if [ -n "$a" ]; then code "$a"; fi; done; echo "stage A recorded in $CFG" ;;
  readback) bash script/unica-v4/deploy-public.sh "$NET" readback ;;
  B) live B; for v in UNICA_HOOK UNICA_EXECUTOR; do code "$(cfg $v)"; done; status_is 1 ;;
  C) live C; status_is 3 ;;
  activate) live activate; status_is 4 ;;
  manifest) status_is 4; bash script/unica-v4/manifest.sh "$NET" "$CFG" "$MAN" ;;
  verify) test -f "$MAN" || fail "no manifest; run: make v5-manifest NET=$NET"; RPC_ALIAS="$NET" bash script/unica-v4/verify-source.sh "$C" ;;
  evidence) test -f "$MAN" || fail "no manifest"; node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); for (const [k,v] of Object.entries(m.contracts)) console.log(k, v.address, v.codeHash)' "$MAN" | while read -r k a h; do [ "$(cast keccak "$(cast code "$a" --rpc-url "$NET")")" = "$h" ] || fail "manifest code hash mismatch for $k at $a"; echo "manifest ok $k"; done; node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log("environment", m.environment, "designation", m.designation, "chain", m.chainId, "market status", m.market.status, "demonstrationOnly", m.market.demonstrationOnly)' "$MAN" ;;
  commit) test -f "$MAN" || fail "no manifest"; git status --short | grep -q '^?? vy/src/unica/' && true; printf '%s\n' "deploy($NET): UNICA v5 on chain $C, recorded from readback and manifest (TESTNET / NO VALUE)" "" "Stages sent by the owner from a keystore; config recorded by the wrapper; manifest from chain reads." > ".rehearsal/deploy-$C.msg"; git add "$CFG" "$MAN" "broadcast/DeployPublic.s.sol/$C" && git commit -F ".rehearsal/deploy-$C.msg" && git push origin unicaV5-anvil && git log --oneline -1 ;;
  ens-records) [ "$C" = 11155111 ] || fail "ENS exists only on Ethereum Sepolia"; need_account; chain; DEPLOYER_ACCOUNT="$DEPLOYER_ACCOUNT" bash script/ensv2/freshcuts-broadcast.sh records ;;
  ens-lineage) [ "$C" = 11155111 ] || fail "ENS exists only on Ethereum Sepolia"; need_account; chain; AUTH=$(cfg UNICA_IDENTITY_AUTHORITY); [ -n "$AUTH" ] || fail "no UNICA_IDENTITY_AUTHORITY recorded; run stage A first"; code "$AUTH"; UNICA_IDENTITY_AUTHORITY="$AUTH" DEPLOYER_ACCOUNT="$DEPLOYER_ACCOUNT" bash script/ensv2/freshcuts-broadcast.sh lineage ;;
  *) fail "unknown step $STEP" ;;
esac
