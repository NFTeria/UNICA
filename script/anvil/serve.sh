#!/usr/bin/env bash
# serve.sh — the UNICA companion on this machine: the built apps/web/out/ artifact, plus the /local/
# runtime-configuration API that connects the whole business payment product — home, join, the
# business dashboard, the register, the customer checkout and the receipt — to a running chain.
# LOCAL_ANVIL_NO_VALUE by default; `make business-live` points it at a public test network instead.
#
# THE PROGRAM IS NOT IN THIS FILE. It is script/anvil/companion.mjs, a module that reads nothing
# from the environment and binds nothing: every value arrives as a parameter. This file is the part
# that is about THIS MACHINE — the arguments, the environment, the two preconditions, and the port.
# The same module answers the same endpoints behind a public host, so a rule that holds here cannot
# quietly stop holding there.
#
# No dependency beyond the standard library. No secret, no key material, no signing — every RPC call
# the companion makes or forwards is either a read or an `eth_sendTransaction` the BROWSER issues
# from its own already-unlocked account.
#
# WHY THIS REFUSES TO START WITHOUT A MANIFEST. Serving the static site with a /local/config.json
# that lies about a chain that was never deployed is worse than not serving it: a payer would read
# terms that do not correspond to anything real. The manifest existing is the one precondition
# checked before this binds a socket at all.
#
# WHY IT ALSO SERVES TWO FILES OUTSIDE apps/web/out/. The browser assets import
# `tools/unica-pos-cli/render.mjs` (the one place UNICA states its PAID rule) and
# `web/ensv2/keccak.mjs` (already-written, browser-safe keccak-256) by their real, ordinary relative
# paths — the same specifier resolves correctly under `node --test` (a real file on disk) and in a
# browser (through the companion's two passthrough routes). Nothing is copied or duplicated to make
# that work: those routes stream the real files, byte for byte, read fresh on every request.
set -euo pipefail
cd "$(dirname "$0")/../.."

MANIFEST_PATH="${MANIFEST_PATH:-deployments/31337.local.json}"
RECORD_PATH="${REHEARSAL_DIR:-.rehearsal/anvil}/demo-record.json"
OUT_DIR="apps/web/out"
HOST="127.0.0.1"
PORT="${UNICA_SERVE_PORT:-8787}"
RPC_URL="${UNICA_LOCAL_RPC:-http://127.0.0.1:8545}"

if [ ! -f "$MANIFEST_PATH" ]; then
  echo "STOP: no manifest at $MANIFEST_PATH" >&2
  echo "  run: make anvil-up && make anvil-deploy && make anvil-seed   (then: make anvil-demo)" >&2
  exit 1
fi
if [ ! -d "$OUT_DIR" ]; then
  echo "STOP: $OUT_DIR does not exist" >&2
  echo "  run: node apps/web/build.mjs" >&2
  exit 1
fi

export UNICA_MANIFEST_PATH="$MANIFEST_PATH"
export UNICA_RECORD_PATH="$RECORD_PATH"
export UNICA_OUT_DIR="$OUT_DIR"
export UNICA_HOST="$HOST"
export UNICA_PORT="$PORT"
export UNICA_RPC_URL="$RPC_URL"

# The environment is read HERE and nowhere else. What crosses into the module is a plain object of
# values, so the module can be run by a serverless host that has no shell and no .env at all.
exec node --input-type=module - <<'JS'
import { startCompanion } from "./script/anvil/companion.mjs";

startCompanion({
  root: process.cwd(),
  outDir: process.env.UNICA_OUT_DIR,
  manifestPath: process.env.UNICA_MANIFEST_PATH,
  recordPath: process.env.UNICA_RECORD_PATH,
  rpcUrl: process.env.UNICA_RPC_URL,
  subgraphUrl: process.env.UNICA_SUBGRAPH_URL || null,
  explorerKey: process.env.ETHERSCAN_API_KEY || null, // a keyed log source when .env carries one; never printed
  host: process.env.UNICA_HOST,
  port: Number(process.env.UNICA_PORT),
  logWindow: Number(process.env.UNICA_LOG_WINDOW ?? 2000),
});
JS
