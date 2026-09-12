#!/usr/bin/env bash
# deploy.sh — the complete local fixture stack onto the running Anvil node, and the manifest.
# LOCAL_ANVIL_NO_VALUE. Refused on any chain but 31337 (checked here and again inside the script).
#
# What lands, in order (script/anvil/AnvilLocal.s.sol `deploy()`): Uniswap's official PoolManager
# bytecode; two test tokens; two FIXTURE price feeds behind the real ChainlinkFeedAdapter; the
# UNICA v4 factory, which creates its registry; one market at a mined hook address with the oracle
# route bound into its id (PROPOSED); the local ENSv2-compatible identity fixture with the
# barbershop name tree; the identity NFT, compiled here from vy/src/art/identity_token.vy with the
# pinned Vyper; the CRE policy receiver behind a LOCAL forwarder fixture; the terminal-admission
# gate, allowlisted as the market's order creator; and a look-alike hook behind a spoofed registry.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=script/anvil/lib.sh
. script/anvil/lib.sh
require_tools
require_local_chain
load_accounts
mkdir -p "$REHEARSAL_DIR" deployments

step "toolchain (pinned by the repository; recorded in the manifest)"
FORGE_VERSION=$(forge --version | head -1)
ANVIL_VERSION=$(anvil --version | head -1)
VYPER_VERSION=$(vyper --version | head -1)
NODE_VERSION=$(node --version)
log "$FORGE_VERSION"; log "$ANVIL_VERSION"; log "vyper $VYPER_VERSION"; log "node $NODE_VERSION"
case "$VYPER_VERSION" in 0.4.3*) ;; *) die "vyper 0.4.3 is required exactly (ruling H8); found $VYPER_VERSION" ;; esac

step "compiling the identity token (Vyper 0.4.3, vy/src/art/identity_token.vy)"
IDENTITY_TOKEN_BYTECODE=$(vyper -p vy/src -f bytecode vy/src/art/identity_token.vy)
vyper -p vy/src -f abi vy/src/art/identity_token.vy >"$REHEARSAL_DIR/identity_token.abi.json"
export IDENTITY_TOKEN_BYTECODE
log "bytecode bytes  $(( (${#IDENTITY_TOKEN_BYTECODE} - 2) / 2 ))"

step "deploying (forge script, impersonated Anvil accounts, broadcast to the local node only)"
DEPLOY_LOG="$REHEARSAL_DIR/deploy.log"
FOUNDRY_BROADCAST="$REHEARSAL_DIR/broadcast" forge script script/anvil/AnvilLocal.s.sol:AnvilLocal \
  --sig 'deploy()' --rpc-url "$UNICA_LOCAL_RPC" --unlocked --sender "$ANVIL_ADMIN" --broadcast -vv \
  | tee "$DEPLOY_LOG"

RAW=$(grep -o 'MANIFEST:.*' "$DEPLOY_LOG" | sed 's/^MANIFEST://' | tr -d '\n')
test -n "$RAW" || die "the deploy script printed no manifest"

step "writing $MANIFEST_PATH"
COMMIT=$(git rev-parse HEAD)
DIRTY=$(git status --porcelain | grep -v '^??' | wc -l | tr -d ' ')
node - "$RAW" "$MANIFEST_PATH" "$UNICA_LOCAL_RPC" "$COMMIT" "$DIRTY" "$FORGE_VERSION" "$ANVIL_VERSION" "$VYPER_VERSION" "$NODE_VERSION" <<'EOF'
const [raw, out, rpc, commit, dirty, forge, anvil, vyper, node] = process.argv.slice(2);
const kv = JSON.parse(raw);
const fs = require("fs");
const env = process.env;
const rpcCall = async (method, params) => {
  const r = await fetch(rpc, {method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params})});
  const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error)); return j.result;
};
const {execFileSync} = require("child_process");
const keccakOfCode = (code) => execFileSync("cast", ["keccak", code], {encoding: "utf8"}).trim();
(async () => {
  const names = ["poolManager","assetToken","payoutToken","assetUsdFeed","payoutUsdFeed","oracleAdapter","factory","registry","hook","executor","identityFixture","identityToken","forwarderFixture","policyReceiver","terminalAdmission","lookalikeFactory","lookalikeHook","lookalikeExecutor"];
  const contracts = {};
  for (const n of names) {
    const address = kv[n]; if (!address) throw new Error(`manifest is missing ${n}`);
    const code = await rpcCall("eth_getCode", [address, "latest"]);
    if (code === "0x") throw new Error(`${n} at ${address} has no code`);
    contracts[n] = {address, codeHash: keccakOfCode(code), codeSize: (code.length - 2) / 2};
  }
  const poolKey = {currency0: null, currency1: null, fee: Number(kv.fee), tickSpacing: Number(kv.tickSpacing), hooks: kv.hook};
  const a = kv.assetToken.toLowerCase(), p = kv.payoutToken.toLowerCase();
  if (a < p) { poolKey.currency0 = kv.assetToken; poolKey.currency1 = kv.payoutToken; } else { poolKey.currency0 = kv.payoutToken; poolKey.currency1 = kv.assetToken; }
  const releaseId = keccakOfCode(("0x" + [31337, kv.factory, kv.registry].map(x => typeof x === "number" ? x.toString(16).padStart(64, "0") : x.slice(2).toLowerCase().padStart(64, "0")).join("")));
  const manifest = {
    environment: "LOCAL_ANVIL_NO_VALUE",
    designation: "TEST_ONLY_NO_VALUE",
    chainId: 31337,
    commit, workingTreeDirtyFiles: Number(dirty),
    toolchain: {forge, anvil, vyper: `vyper ${vyper}`, node, solc: "0.8.30", evm: "cancun", optimizer: "off"},
    releaseId,
    release: {tag: kv.unicaRelease, hookCreationCodeHash: null},
    contracts,
    market: {marketId: kv.marketId, version: 1, poolKey, poolId: kv.poolId, feedId: kv.feedId, adapter: kv.oracleAdapter,
      rateE18: kv.rateE18, rateLabel: "demonstration rate set by the admin, never a market price",
      oracle: {maxAge: Number(kv.maxAge), maxDeviationBps: Number(kv.maxDeviationBps), enabled: true, fixtureFeeds: true},
      caps: {maxPerTxPayout: kv.maxPerTxPayout, maxPerDayPayout: kv.maxPerDayPayout, maxSeedPayout: kv.maxSeedPayout, unit: "payout base units (6 decimals)", label: "$10 / $25 / $5-equivalent DEMONSTRATION caps, no value"},
      hookSalt: kv.hookSalt},
    accounts: {admin: env.ANVIL_ADMIN, merchantOwner: env.ANVIL_MERCHANT_OWNER, merchantPayout: env.ANVIL_MERCHANT_PAYOUT, payer: env.ANVIL_PAYER, wrongPayer: env.ANVIL_WRONG_PAYER,
      terminalChair1: env.ANVIL_OP_CHAIR1, terminalLostTablet: env.ANVIL_OP_LOST_TABLET, seeder: env.ANVIL_SEEDER, attacker: env.ANVIL_ATTACKER, workflowOwner: env.ANVIL_WORKFLOW_OWNER,
      label: "Anvil default unlocked accounts: PUBLIC FIXTURE KEYS, never to be used on any public network"},
    identity: {merchantName: kv.merchantName, merchantNode: kv.merchantNode, rootNode: kv.rootNode, unicaNode: kv.unicaNode, terminalsNode: kv.terminalsNode, agentNode: kv.agentNode,
      terminals: [{name: "chair-1.terminals.freshcuts.unica.eth", node: kv.chair1Node, status: "active"}, {name: "lost-tablet.terminals.freshcuts.unica.eth", node: kv.lostTabletNode, status: "active (revoked during the demo)"}],
      ensDeploymentId: kv.ensDeploymentId, ensDeploymentLabel: "LOCAL fixture id = keccak256(abi.encode(31337, identityFixture)); not the ENSv2 Sepolia deployment",
      terminalStatusKey: kv.terminalStatusKey, rendererVersion: kv.rendererVersion, tokenId: "1 (minted by the demo)"},
    policy: {receiver: kv.policyReceiver, forwarder: kv.forwarderFixture, workflowId: kv.workflowId, reportSchemaVersion: 1, source: "LOCAL_CRE_REPORT_FIXTURE", label: "LOCAL CRE REPORT FIXTURE — NOT A DON REPORT"},
    lookalike: {factory: kv.lookalikeFactory, hook: kv.lookalikeHook, executor: kv.lookalikeExecutor, label: "same hook source behind an attacker-controlled registry; never official"},
  };
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({chainId: manifest.chainId, commit, releaseId, registry: kv.registry, factory: kv.factory, hook: kv.hook, executor: kv.executor, marketId: kv.marketId, identityToken: kv.identityToken, policyReceiver: kv.policyReceiver}, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
EOF
MANIFEST_HASH=$(shasum -a 256 "$MANIFEST_PATH" | cut -d' ' -f1)
log "manifest sha256  $MANIFEST_HASH"
log "deployed."
