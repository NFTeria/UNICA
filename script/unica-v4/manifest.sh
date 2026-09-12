#!/usr/bin/env bash
# manifest.sh — write deployments/unica-v4/<chainId>.json for a public UNICA v4 deployment, from the
# chain, in the shape tools/unica-evidence and tools/unica-pos-cli read.
#
#   bash script/unica-v4/manifest.sh <rpc alias or loopback URL> <config.env> [out path]
#
# Every address comes from the configuration the stages filled in (UNICA_FACTORY, UNICA_REGISTRY,
# UNICA_MARKET_ID ...); everything else — code hashes and sizes, the pool key, the market record,
# the hook and executor — is READ from the chain, never copied from a log. Refuses an address with no
# code and a market whose reverse lookups disagree with its id. Verification status is recorded only
# when the caller passes UNICA_VERIFICATION_JSON (a read-only explorer result); otherwise "not verified".
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$HOME/.foundry/bin:$PATH"
RPC=${1:-}; CONFIG=${2:-}; OUT=${3:-}
fail() { echo "STOP: $1"; exit 1; }
test -n "$RPC" && test -f "${CONFIG:-/nonexistent}" || fail "usage: manifest.sh <alias|url> <config.env> [out]"
set -a; . "$CONFIG"; set +a
for v in UNICA_FACTORY UNICA_REGISTRY UNICA_MARKET_ID UNICA_POOL_MANAGER UNICA_ASSET UNICA_PAYOUT; do
  test -n "${!v:-}" || fail "$v is not set in $CONFIG (run the stages first and copy their outputs in)"
done
chain=$(cast chain-id --rpc-url "$RPC")
test "$chain" = "$UNICA_CHAIN_ID" || fail "the endpoint reports chain $chain, the configuration says $UNICA_CHAIN_ID"
OUT=${OUT:-deployments/unica-v4/$chain.json}
mkdir -p "$(dirname "$OUT")"

r() { cast call --rpc-url "$RPC" "$@"; }
HOOK=$(r "$UNICA_REGISTRY" 'getMarket(bytes32)((address,address,uint32,address,address,bytes32,uint256,uint160,int24,uint24,int24,uint8,uint8,bool,bool,uint64,uint8,uint64,uint128))' "$UNICA_MARKET_ID")
MARKET_JSON=$(node -e '
  const t=process.argv[1].trim().replace(/^\(|\)$/g,"").split(/,\s*/).map(x=>x.split(" ")[0]);
  const [asset,payout,version,hook,executor,poolId,rateE18,initSqrtPriceX96,initTick,fee,tickSpacing,assetDecimals,payoutDecimals,assetIsCurrency0,demonstrationOnly,proposedAt,status,updatedAt,seedDepth]=t;
  console.log(JSON.stringify({asset,payout,version:Number(version),hook,executor,poolId,rateE18,initSqrtPriceX96,initTick:Number(initTick),fee:Number(fee),tickSpacing:Number(tickSpacing),assetDecimals:Number(assetDecimals),payoutDecimals:Number(payoutDecimals),assetIsCurrency0:assetIsCurrency0==="true",demonstrationOnly:demonstrationOnly==="true",proposedAt:Number(proposedAt),status:Number(status),updatedAt:Number(updatedAt),seedDepth}))' "$HOOK")
HOOK_ADDR=$(node -e 'console.log(JSON.parse(process.argv[1]).hook)' "$MARKET_JSON")
EXEC_ADDR=$(node -e 'console.log(JSON.parse(process.argv[1]).executor)' "$MARKET_JSON")
POOL_ID=$(node -e 'console.log(JSON.parse(process.argv[1]).poolId)' "$MARKET_JSON")
test "$(r "$UNICA_REGISTRY" 'marketIdOfHook(address)(bytes32)' "$HOOK_ADDR")" = "$UNICA_MARKET_ID" || fail "marketIdOfHook disagrees with the market id"
test "$(r "$UNICA_REGISTRY" 'marketIdOfExecutor(address)(bytes32)' "$EXEC_ADDR")" = "$UNICA_MARKET_ID" || fail "marketIdOfExecutor disagrees with the market id"
test "$(r "$UNICA_REGISTRY" 'marketIdOfPool(bytes32)(bytes32)' "$POOL_ID")" = "$UNICA_MARKET_ID" || fail "marketIdOfPool disagrees with the market id"
KEY=$(r "$UNICA_FACTORY" 'poolKeyOf(bytes32)((address,address,uint24,int24,address))' "$UNICA_MARKET_ID")
POLICY=$(r "$UNICA_REGISTRY" 'oraclePolicyOf(bytes32)((address,bytes32,uint48,uint16,bool))' "$UNICA_MARKET_ID")
CAPS=$(r "$UNICA_REGISTRY" 'capsOf(bytes32)((uint128,uint128,uint128))' "$UNICA_MARKET_ID")
COMMIT=$(git rev-parse HEAD)
HEAD_BLOCK=$(cast block-number --rpc-url "$RPC")

codeOf() { local c; c=$(cast code "$1" --rpc-url "$RPC"); test "$c" != "0x" || fail "$2 at $1 has no code"; printf '{"address":"%s","codeHash":"%s","codeSize":%s}' "$1" "$(cast keccak "$c")" "$(( (${#c} - 2) / 2 ))"; }
CONTRACTS="\"poolManager\":$(codeOf "$UNICA_POOL_MANAGER" poolManager),\"assetToken\":$(codeOf "$UNICA_ASSET" asset),\"payoutToken\":$(codeOf "$UNICA_PAYOUT" payout),\"factory\":$(codeOf "$UNICA_FACTORY" factory),\"registry\":$(codeOf "$UNICA_REGISTRY" registry),\"hook\":$(codeOf "$HOOK_ADDR" hook),\"executor\":$(codeOf "$EXEC_ADDR" executor)"
for opt in UNICA_ORACLE_ADAPTER:oracleAdapter UNICA_POLICY_RECEIVER:policyReceiver UNICA_ADMISSION:terminalAdmission UNICA_IDENTITY_TOKEN:identityToken UNICA_FORWARDER:forwarderFixture UNICA_IDENTITY_AUTHORITY:identityAuthority UNICA_ENSV2_RESOLVER:ensV2Resolver; do
  var=${opt%%:*}; name=${opt##*:}; val=${!var:-}
  if [ -n "$val" ] && [ "$val" != "0x0000000000000000000000000000000000000000" ]; then CONTRACTS="$CONTRACTS,\"$name\":$(codeOf "$val" "$name")"; fi
done

node - "$OUT" "$chain" "$COMMIT" "$HEAD_BLOCK" "$CONTRACTS" "$MARKET_JSON" "$KEY" "$POLICY" "$CAPS" <<'EOF'
const [out, chain, commit, headBlock, contracts, marketJson, key, policy, caps] = process.argv.slice(2);
const fs = require("fs"); const env = process.env;
const tuple = (s) => s.trim().replace(/^\(|\)$/g, "").split(/,\s*/).map((x) => x.split(" ")[0]);
const m = JSON.parse(marketJson); const k = tuple(key); const p = tuple(policy); const c = tuple(caps);
const manifest = {
  environment: env.UNICA_IS_MAINNET === "true" ? "PUBLIC_MAINNET" : "PUBLIC_TESTNET_NO_VALUE",
  designation: env.UNICA_IS_MAINNET === "true" ? "PRODUCTION" : "TEST_ONLY_NO_VALUE",
  chainId: Number(chain), commit, readAtBlock: Number(headBlock), releaseTag: env.UNICA_RELEASE_TAG || null,
  explorer: env.UNICA_EXPLORER_API ? {kind: "blockscout", api: env.UNICA_EXPLORER_API, url: env.UNICA_EXPLORER_URL || null, note: "public, keyless; a source of logs and links, never a judge"} : null,
  deployedAtBlock: (() => { try { const j = JSON.parse(fs.readFileSync("broadcast/DeployPublic.s.sol/" + chain + "/stageA-latest.json", "utf8")); const b = (j.receipts || []).map((r) => Number(BigInt(r.blockNumber))).filter(Number.isFinite); return b.length ? Math.min(...b) : null; } catch { return null; } })(),
  verification: env.UNICA_VERIFICATION_JSON ? JSON.parse(env.UNICA_VERIFICATION_JSON) : {status: "not verified", note: "no read-only explorer result was supplied"},
  contracts: JSON.parse("{" + contracts + "}"),
  market: {
    marketId: env.UNICA_MARKET_ID, version: m.version, status: m.status, demonstrationOnly: m.demonstrationOnly,
    poolKey: {currency0: k[0], currency1: k[1], fee: Number(k[2]), tickSpacing: Number(k[3]), hooks: k[4]},
    poolId: m.poolId, adapter: p[0], feedId: p[1],
    oracle: {maxAge: Number(p[2]), maxDeviationBps: Number(p[3]), enabled: p[4] === "true"},
    caps: {maxPerTxPayout: c[0], maxPerDayPayout: c[1], maxSeedPayout: c[2]},
    rateE18: m.rateE18, rateLabel: "a demonstration rate the admin sets, never a market price",
    initSqrtPriceX96: m.initSqrtPriceX96, initTick: m.initTick, seedDepth: m.seedDepth,
    assetDecimals: m.assetDecimals, payoutDecimals: m.payoutDecimals, assetIsCurrency0: m.assetIsCurrency0,
  },
  accounts: {admin: env.UNICA_ADMIN, pauser: env.UNICA_PAUSER || null, deployer: env.DEPLOYER},
  knownTokens: (env.UNICA_KNOWN_TOKENS || "").split(",").map((a) => a.trim()).filter(Boolean).map((address) => ({address, note: "named in the config as an asset a wallet on this chain may hold; symbol and decimals are read live by whoever displays it"})),
  identity: env.UNICA_IDENTITY_AUTHORITY ? {authority: env.UNICA_IDENTITY_AUTHORITY, authorityKind: env.UNICA_ENSV2_RESOLVER ? "EnsV2ResolverAuthority over the chain's ENSv2 permissioned resolver" : "pinned", ensV2Resolver: env.UNICA_ENSV2_RESOLVER || null, ensDeploymentId: env.UNICA_ENS_DEPLOYMENT_ID || null, terminalAdmission: env.UNICA_ADMISSION || null, identityToken: env.UNICA_IDENTITY_TOKEN || null, rendererVersion: env.UNICA_RENDERER_VERSION || null, terminalStatusKey: env.UNICA_TERMINAL_STATUS_KEY || null} : {note: "no identity authority configured; terminal admission is not deployed on this chain"},
  policy: env.UNICA_FORWARDER ? {forwarder: env.UNICA_FORWARDER, receiver: env.UNICA_POLICY_RECEIVER || null, workflowId: env.UNICA_WORKFLOW_ID || null} : {note: "no confidential-policy receiver configured on this chain"},
};
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(out);
EOF
echo "manifest sha256 $(shasum -a 256 "$OUT" | cut -d' ' -f1)"
