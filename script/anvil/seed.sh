#!/usr/bin/env bash
# seed.sh — initialise the market's pool at the recorded opening price, add the $5-equivalent
# DEMONSTRATION seed over the band-width range on the payout side, prove SEEDED from PoolManager
# state, and ACTIVATE. LOCAL_ANVIL_NO_VALUE. A live market is never reseeded, widened or recentred:
# this stage refuses to run twice because `initializeMarket` requires PROPOSED.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=script/anvil/lib.sh
. script/anvil/lib.sh
require_tools
require_local_chain
load_accounts
load_manifest_env

step "seeding (forge script seed(), impersonated admin and seeder)"
SEED_LOG="$REHEARSAL_DIR/seed.log"
FOUNDRY_BROADCAST="$REHEARSAL_DIR/broadcast" forge script script/anvil/AnvilLocal.s.sol:AnvilLocal \
  --sig 'seed()' --rpc-url "$UNICA_LOCAL_RPC" --unlocked --sender "$ANVIL_ADMIN" --broadcast -vv \
  | tee "$SEED_LOG"
SEED=$(grep -o 'SEED:.*' "$SEED_LOG" | sed 's/^SEED://')
test -n "$SEED" || die "seed() printed no record"

node - "$SEED" "$MANIFEST_PATH" <<'EOF'
const [seed, path] = process.argv.slice(2);
const fs = require("fs");
const m = JSON.parse(fs.readFileSync(path, "utf8"));
m.seed = JSON.parse(seed);
fs.writeFileSync(path, JSON.stringify(m, null, 2) + "\n");
console.log(JSON.stringify(m.seed, null, 2));
EOF

STATUS=$(call "$UNICA_REGISTRY" 'statusOf(bytes32)(uint8)' "$UNICA_MARKET_ID")
test "$STATUS" = "4" || die "market status is $STATUS, expected 4 (ACTIVE)"
log "market $UNICA_MARKET_ID is ACTIVE"
