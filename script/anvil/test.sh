#!/usr/bin/env bash
# test.sh — the complete local integration suite from a clean chain: up, deploy, seed, demo,
# attacks, down. LOCAL_ANVIL_NO_VALUE. Fails on the first unexpected error; the node is stopped
# on every exit path so a failed run never leaves a stale chain for the next one to mistake for
# fresh state. Prints the evidence record the run produced.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=script/anvil/lib.sh
. script/anvil/lib.sh
START=$(date -u +%FT%TZ)
trap 'bash script/anvil/down.sh >/dev/null 2>&1 || true' EXIT

bash script/anvil/up.sh
bash script/anvil/deploy.sh
bash script/anvil/seed.sh
bash script/anvil/demo.sh
bash script/anvil/attacks.sh

END=$(date -u +%FT%TZ)
node - "$MANIFEST_PATH" "$REHEARSAL_DIR/demo-record.json" "$START" "$END" "$REHEARSAL_DIR/run-evidence.json" <<'EOF'
const [manifestPath, recordPath, start, end, out] = process.argv.slice(2);
const fs = require("fs"), crypto = require("crypto");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
const evidence = {
  command: "make anvil-test",
  commit: manifest.commit,
  toolchain: manifest.toolchain,
  startedAt: start, endedAt: end,
  chainId: manifest.chainId,
  manifestSha256: crypto.createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex"),
  orderId: record.order.id,
  settlementTransaction: record.settlement.transactionHash,
  merchantBalanceDelta: record.settlement.outputDelivered,
  identityToken: record.merchant.identityToken,
  receiptDecision: record.evidence.decision,
  lookalikeDecision: record.lookalike.evidence.decision,
  externalNetworkContacted: false,
  externalNetworkNote: "loopback Anvil only; every RPC URL in this run was http://127.0.0.1",
};
fs.writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
EOF
log "local integration suite: complete."
