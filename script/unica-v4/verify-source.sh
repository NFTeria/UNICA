#!/usr/bin/env bash
# verify-source.sh — publish and check the SOURCE of every UNICA v4/v5 contract a public deployment produced.
#
#   bash script/unica-v4/verify-source.sh <chainId> [--dry-run] [--manifest <path>] [--broadcast-dir <dir>]
#
# Reads the deployment manifest (deployments/unica-v4/<chainId>.json) and the stage A broadcast record
# (broadcast/DeployPublic.s.sol/<chainId>/stageA-latest.json) and runs `forge verify-contract` for each
# Solidity contract with the constructor arguments those records carry; the registry, hook and executor
# were created by the factory, so their arguments are rebuilt from the manifest's market record and one
# read of the registry. Verifier: Etherscan V2 when ETHERSCAN_API_KEY is in the shell (never in a file),
# Sourcify otherwise. The Vyper identity badge is not verifiable by forge; its exact inputs are printed.
# Nothing here signs or broadcasts. --dry-run prints every command and runs none.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$HOME/.foundry/bin:$PATH"
CHAIN=${1:?chainId}; shift || true
DRY=0; MANIFEST=deployments/unica-v4/$CHAIN.json; BDIR=broadcast/DeployPublic.s.sol/$CHAIN
while [ $# -gt 0 ]; do case "$1" in --dry-run) DRY=1;; --manifest) MANIFEST=$2; shift;; --broadcast-dir) BDIR=$2; shift;; *) echo "STOP: unknown option $1"; exit 1;; esac; shift; done
test -f "$MANIFEST" || { echo "STOP: no manifest at $MANIFEST"; exit 1; }
test -f "$BDIR/stageA-latest.json" || { echo "STOP: no stage A broadcast record at $BDIR/stageA-latest.json"; exit 1; }
m() { node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log(process.argv[2].split(".").reduce((o,k)=>o?.[k], m) ?? "")' "$MANIFEST" "$1"; }
RPC=${RPC_ALIAS:-}
if [ -n "${ETHERSCAN_API_KEY:-}" ]; then VERIFIER=(--verifier etherscan --etherscan-api-key "$ETHERSCAN_API_KEY"); else VERIFIER=(--verifier sourcify); fi
run() { if [ "$DRY" = 1 ]; then printf 'DRY: forge verify-contract --chain-id %s --watch %s %s --constructor-args %s\n' "$CHAIN" "$2" "$3" "$4"; else forge verify-contract --chain-id "$CHAIN" --watch "${VERIFIER[@]}" --constructor-args "$4" "$2" "$3"; fi; }
sig_of() { case "$1" in
  UnicaMarketFactory) echo "constructor(address,address,bytes32,bool)";;
  EnsV2ResolverAuthority) echo "constructor(address)";;
  TerminalAdmission) echo "constructor(address,address,bytes32,address,string)";;
  ChainlinkFeedAdapter) echo "constructor(address,uint48,address,uint48,address,address,address,uint256,address)";;
  *) echo "";; esac; }
path_of() { case "$1" in
  UnicaMarketFactory) echo "src/unica-v4/UnicaMarketFactory.sol:UnicaMarketFactory";;
  EnsV2ResolverAuthority) echo "src/identity/EnsV2ResolverAuthority.sol:EnsV2ResolverAuthority";;
  TerminalAdmission) echo "src/identity/TerminalAdmission.sol:TerminalAdmission";;
  ChainlinkFeedAdapter) echo "src/unica-v4/oracle/ChainlinkFeedAdapter.sol:ChainlinkFeedAdapter";;
  esac; }
echo "== source verification for chain $CHAIN (manifest $MANIFEST; verifier ${VERIFIER[1]})"
# 1. contracts the deployer created directly in stage A, arguments as recorded by forge
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); for (const t of j.transactions) if (t.transactionType==="CREATE" && t.contractName) console.log(t.contractName, t.contractAddress, JSON.stringify(t.arguments||[]))' "$BDIR/stageA-latest.json" | while read -r name addr args; do
  sig=$(sig_of "$name"); [ -n "$sig" ] || { echo "skip $name at $addr (not a forge-verifiable Solidity contract here)"; continue; }
  # shellcheck disable=SC2046
  encoded=$(cast abi-encode "$sig" $(node -e 'for (const a of JSON.parse(process.argv[1])) console.log(a)' "$args"))
  run "$name" "$addr" "$(path_of "$name")" "$encoded"
done
# 2. the registry, created by the factory's constructor: (admin, requireOracle) where requireOracle is read from the registry
REG=$(m contracts.registry.address); ADMIN=$(m accounts.admin)
if [ "$DRY" = 1 ]; then REQ=false; else REQ=$(cast call "$REG" 'REQUIRE_ORACLE()(bool)' --rpc-url "${RPC:?set RPC_ALIAS to the foundry.toml alias}"); fi
run UnicaMarketRegistry "$REG" src/unica-v4/UnicaMarketRegistry.sol:UnicaMarketRegistry "$(cast abi-encode 'constructor(address,bool)' "$ADMIN" "$REQ")"
# 3. the hook and the executor, created by the factory in stage B from the market record
PM=$(m contracts.poolManager.address); MID=$(m market.marketId); A=$(m market.poolKey.currency0); B=$(m market.poolKey.currency1)
ASSET=$(m contracts.assetToken.address); PAYOUT=$(m contracts.payoutToken.address); FEE=$(m market.poolKey.fee); TS=$(m market.poolKey.tickSpacing)
AD=$(m market.assetDecimals); PD=$(m market.payoutDecimals); HOOK=$(m contracts.hook.address); EXEC=$(m contracts.executor.address)
run UnicaMarketHook "$HOOK" src/unica-v4/UnicaMarketHook.sol:UnicaMarketHook "$(cast abi-encode 'constructor(address,address,bytes32,address,address,uint24,int24,uint8,uint8)' "$PM" "$REG" "$MID" "$ASSET" "$PAYOUT" "$FEE" "$TS" "$AD" "$PD")"
run UnicaMarketExecutor "$EXEC" src/unica-v4/UnicaMarketExecutor.sol:UnicaMarketExecutor "$(cast abi-encode 'constructor(address,address,bytes32,address,address,uint24,int24)' "$PM" "$REG" "$MID" "$ASSET" "$PAYOUT" "$FEE" "$TS")"
# 4. the Vyper badge: forge cannot verify Vyper; the explorer form needs these exact inputs
TOK=$(m contracts.identityToken.address)
if [ -n "$TOK" ]; then echo "MANUAL: identity badge at $TOK is Vyper 0.4.3 (vy/src/art/identity_token.vy); verify it in the explorer's Vyper form with constructor args (admin, identityAuthority, registry, ensDeploymentId, rendererVersion, externalUrlBase) from the manifest's identity block."; fi
echo "source verification commands issued for chain $CHAIN"
