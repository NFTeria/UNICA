#!/usr/bin/env bash
# serve.sh — a Node static server for the built apps/web/out/ artifact, plus a small /local/
# runtime-configuration API that connects the smallest existing browser screen (the /pay/ route) to
# a running local Anvil demonstration. LOCAL_ANVIL_NO_VALUE.
#
# No dependency: node:http, node:fs and node:url from the standard library only. No secret, no key
# material, no signing — every RPC call this makes or forwards is either a read or an
# `eth_sendTransaction` the BROWSER issues from its own already-unlocked Anvil account.
#
# WHY THIS REFUSES TO START WITHOUT A MANIFEST. Serving the static site with a /local/config.json
# that lies about a chain that was never deployed is worse than not serving it: a payer would read
# terms that do not correspond to anything real. `deployments/31337.local.json` existing is the one
# precondition checked before this binds a socket at all.
#
# WHY IT ALSO SERVES TWO FILES OUTSIDE apps/web/out/. `apps/web/assets/local-pay.js` imports
# `tools/unica-pos-cli/render.mjs` (the one place UNICA states its PAID rule) and
# `web/ensv2/keccak.mjs` (already-written, browser-safe keccak-256) by their real, ordinary relative
# paths — the same specifier resolves correctly under `node --test` (a real file on disk) and in a
# browser (through the two passthrough routes below). Nothing is copied or duplicated to make that
# work: these two routes stream the real files, byte for byte, read fresh on every request.
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

exec node --input-type=module - <<'JS'
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, extname, normalize, sep } from "node:path";

import { authenticateReceipt, projectEvidence } from "./tools/unica-evidence/index.mjs";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, process.env.UNICA_OUT_DIR);
const MANIFEST_PATH = join(ROOT, process.env.UNICA_MANIFEST_PATH);
const RECORD_PATH = join(ROOT, process.env.UNICA_RECORD_PATH);
const HOST = process.env.UNICA_HOST;
const PORT = Number(process.env.UNICA_PORT);
const RPC_URL = process.env.UNICA_RPC_URL;

// Read-only passthrough of two real repository files, by their exact repo-relative path, so
// apps/web/assets/local-pay.js can `import` them with an ordinary relative specifier that resolves
// the same way on disk (node --test) and over HTTP (a browser). Nothing else is served from outside
// OUT_DIR — this allowlist is deliberately exactly two entries.
const PASSTHROUGH = new Map([
  ["/web/ensv2/keccak.mjs", join(ROOT, "web/ensv2/keccak.mjs")],
  ["/tools/unica-pos-cli/render.mjs", join(ROOT, "tools/unica-pos-cli/render.mjs")],
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

const HASH32 = /^0x[0-9a-fA-F]{64}$/;

function readJsonSync(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function readManifest() {
  return readJsonSync(MANIFEST_PATH);
}
function readRecord() {
  return existsSync(RECORD_PATH) ? readJsonSync(RECORD_PATH) : null;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

async function sendFile(res, path, status = 200) {
  const body = await readFile(path);
  res.writeHead(status, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(body);
}

async function serveStatic(res, pathname) {
  let rel = normalize(decodeURIComponent(pathname));
  if (rel.split(sep).includes("..")) return sendFile(res, join(OUT_DIR, "404.html"), 404).catch(() => { res.writeHead(404); res.end("not found"); });
  if (rel === sep || rel === ".") rel = "index.html";
  let filePath = join(OUT_DIR, rel);
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, "index.html");
    await sendFile(res, filePath);
  } catch {
    try {
      await sendFile(res, join(OUT_DIR, "404.html"), 404);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  }
}

const server = createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${HOST}:${PORT}`);
  } catch {
    res.writeHead(400);
    return res.end("bad request");
  }

  try {
    if (PASSTHROUGH.has(url.pathname)) {
      return await sendFile(res, PASSTHROUGH.get(url.pathname));
    }

    if (url.pathname === "/local/config.json") {
      const manifest = readManifest();
      const record = readRecord();
      return sendJson(res, 200, { rpc: RPC_URL, chainId: manifest.chainId, manifest, record });
    }

    if (url.pathname === "/local/record") {
      return sendJson(res, 200, readRecord());
    }

    if (url.pathname === "/local/evidence") {
      const order = url.searchParams.get("order");
      if (!order || !HASH32.test(order)) {
        return sendJson(res, 400, { decision: "UNKNOWN", reasonCodes: ["MALFORMED_ORDER_ID"], receipt: null });
      }
      try {
        const manifest = readManifest();
        const projection = await projectEvidence({ rpc: RPC_URL, manifest });
        const verdict = authenticateReceipt({
          orderId: order,
          logs: projection.logs,
          manifest,
          chainHead: projection.chainHead,
          requiredConfirmations: 0,
        });
        return sendJson(res, 200, verdict);
      } catch (e) {
        return sendJson(res, 502, { decision: "UNKNOWN", reasonCodes: ["EVIDENCE_ENDPOINT_UNAVAILABLE"], receipt: null, error: String(e?.message ?? e) });
      }
    }

    if (url.pathname.startsWith("/local/")) {
      return sendJson(res, 404, { error: "no such /local/ endpoint", path: url.pathname });
    }

    return await serveStatic(res, url.pathname);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(`internal error: ${e?.message ?? e}`);
  }
});

server.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`;
  console.log(`UNICA local demo server listening on ${base}/`);
  console.log(`Pay screen:            ${base}/pay/`);
  const record = readRecord();
  if (record?.order?.id) {
    console.log(`Pay screen (this order): ${base}/pay/?order=${record.order.id}`);
    console.log(`  as the wrong payer:    ${base}/pay/?order=${record.order.id}&as=0x0000000000000000000000000000000000000001`);
  } else {
    console.log("No demo record yet at " + process.env.UNICA_RECORD_PATH + " -- run: make anvil-demo, then reload.");
  }
});
JS
