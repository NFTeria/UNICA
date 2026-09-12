#!/usr/bin/env bash
# serve.sh — a Node static server for the built apps/web/out/ artifact, plus a small /local/
# runtime-configuration API that connects the whole business payment product — home, join, the
# business dashboard, the register, the customer checkout and the receipt — to a running local
# Anvil demonstration. LOCAL_ANVIL_NO_VALUE.
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
# WHY IT ALSO SERVES TWO FILES OUTSIDE apps/web/out/. The browser assets import
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

import { authenticateDirectReceipt, authenticateProductSale, authenticateReceipt, decodeDirectOrder, fetchDirectOrder, projectEvidence, receiptsForRecipient } from "./tools/unica-evidence/index.mjs";
import { ExplorerLogs } from "./tools/unica-evidence/explorer.mjs";
import { selectorOf } from "./tools/unica-sign/abi.mjs";
import { keccak256, toHex } from "./web/ensv2/keccak.mjs";
const keccak256Hex = (s) => toHex(keccak256(new TextEncoder().encode(s))).replace(/^0x/, "");

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, process.env.UNICA_OUT_DIR);
const MANIFEST_PATH = join(ROOT, process.env.UNICA_MANIFEST_PATH);
const RECORD_PATH = join(ROOT, process.env.UNICA_RECORD_PATH);
const HOST = process.env.UNICA_HOST;
const PORT = Number(process.env.UNICA_PORT);
const RPC_URL = process.env.UNICA_RPC_URL;
const RPC_PROXY_PATH = "/local/rpc";
const ORDERS_SELECTOR_HEX = selectorOf("orders(bytes32)").replace(/^0x/, ""); // computed, never typed: the same view on both settlers
const ORDER_SETTLED = 3; // UnicaMarketTypes.OrderStatus.Settled, frozen numbering
const LOCAL_CHAIN = 31337;
// Public nodes cap how many blocks one eth_getLogs may span; the practice chain does not. A scan
// therefore starts at the block the deployment was recorded from and walks forward in windows of
// this many blocks, and the result is kept for a few seconds so a dashboard's several reads share
// one scan. An indexer is the real answer for a long-lived deployment; this is the honest one for
// a companion on a laptop.
const LOG_WINDOW = Number(process.env.UNICA_LOG_WINDOW ?? 2000);
const PROJECTION_TTL_MS = 15_000;
let projectionMemo = { head: null, at: 0, value: null };

/** Never let an upstream message carry a URL to the browser: the node's address is not the page's business. */
function redact(text) {
  return String(text ?? "").replace(/https?:\/\/[^\s"'<>)]+/g, "<node>");
}

async function projectAll(manifest) {
  const headHex = await rpc("eth_blockNumber", []);
  const head = Number(BigInt(headHex));
  const now = Date.now();
  if (projectionMemo.value && projectionMemo.head === head && now - projectionMemo.at < PROJECTION_TTL_MS) return projectionMemo.value;
  const local = Number(manifest?.chainId) === LOCAL_CHAIN;
  const start = local ? 0 : Number(manifest?.deployedAtBlock ?? 0);
  // A public chain whose manifest names a Blockscout API gets its logs from the explorer in one
  // range; the node still answers block numbers, receipts and calls. Without an explorer the walk
  // below runs in windows, which a free-tier node may still refuse: the error then says so.
  const explorerApi = !local && manifest?.explorer?.kind === "blockscout" ? manifest.explorer.api : null;
  if (explorerApi) {
    const client = new ExplorerLogs({ api: explorerApi, rpc: RPC_URL });
    const one = await projectEvidence({ rpc: client, manifest, fromBlock: start, toBlock: head });
    projectionMemo = { head, at: now, value: one };
    return one;
  }
  if (local || !Number.isFinite(LOG_WINDOW) || LOG_WINDOW <= 0) {
    const one = await projectEvidence({ rpc: RPC_URL, manifest, fromBlock: start, toBlock: head });
    projectionMemo = { head, at: now, value: one };
    return one;
  }
  const logs = [];
  const seen = new Set();
  let receipts = {};
  for (let from = start; from <= head; from += LOG_WINDOW) {
    const to = Math.min(from + LOG_WINDOW - 1, head);
    const part = await projectEvidence({ rpc: RPC_URL, manifest, fromBlock: from, toBlock: to });
    for (const log of part.logs ?? []) {
      const key = `${log.transactionHash}:${log.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      logs.push(log);
    }
    receipts = { ...receipts, ...(part.receipts ?? {}) };
  }
  const merged = { logs, receipts, chainHead: head, fromBlock: start, toBlock: head };
  projectionMemo = { head, at: now, value: merged };
  return merged;
}

const BUSINESS_JOINED_TOPIC0 = "0x" + keccak256Hex("BusinessJoined(bytes32,address,string,address,bytes32,bytes32,uint256)");

/** The business whose payout wallet is `payout`, from the onboarding contract's own records; null when none or no onboarding here. */
async function businessByPayout(manifest, payout) {
  const onboarding = manifest?.contracts?.merchantOnboarding?.address ?? null;
  if (!onboarding || !payout) return null;
  try {
    const local = Number(manifest?.chainId) === LOCAL_CHAIN;
    const explorerApi = !local && manifest?.explorer?.kind === "blockscout" ? manifest.explorer.api : null;
    const filter = { address: onboarding, topics: [BUSINESS_JOINED_TOPIC0], fromBlock: local ? "0x0" : "0x" + Number(manifest?.deployedAtBlock ?? 0).toString(16), toBlock: "latest" };
    const logs = explorerApi ? await new ExplorerLogs({ api: explorerApi, rpc: RPC_URL }).logs(filter) : await rpc("eth_getLogs", [filter]);
    for (const log of (logs ?? []).slice().reverse()) {
      const words = String(log.data ?? "0x").slice(2).match(/.{64}/g) ?? [];
      if (words.length < 5) continue;
      const recordedPayout = "0x" + words[1].slice(24);
      if (recordedPayout.toLowerCase() !== String(payout).toLowerCase()) continue;
      const offset = Number(BigInt("0x" + words[0])) * 2;
      const raw = String(log.data).slice(2);
      const length = Number(BigInt("0x" + raw.slice(offset, offset + 64)));
      const label = Buffer.from(raw.slice(offset + 64, offset + 64 + length * 2), "hex").toString("utf8");
      const parent = manifest?.identity?.parentName ?? null;
      return { label, name: parent ? `${label}.${parent}` : label, owner: "0x" + String(log.topics[2]).slice(26), payout: recordedPayout, merchantNode: log.topics[1] };
    }
  } catch {
    return null;
  }
  return null;
}

/** True when the request comes from this server's own pages (or from no page at all, i.e. a local tool). */
function sameOriginRequest(req) {
  const site = String(req.headers["sec-fetch-site"] ?? "").toLowerCase();
  if (site === "cross-site" || site === "same-site") return false;
  const origin = req.headers.origin;
  if (!origin) return true; // no Origin: not a browser page, or a same-origin request from an older browser
  try {
    const o = new URL(origin);
    const host = o.hostname === "localhost" ? "127.0.0.1" : o.hostname;
    return (host === "127.0.0.1" || host === "::1" || host === HOST) && Number(o.port || (o.protocol === "https:" ? 443 : 80)) === PORT;
  } catch {
    return false;
  }
}

/** The request body up to `limit` bytes, or null when it is larger than that. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => { size += c.length; if (size > limit) { resolve(null); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

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

// @runtimeConfig-begin
// The object GET /local/config.json answers with. Pure: manifest, record and already-read token
// labels in, plain object out, so apps/web/tests/serve-config.test.mjs can run this exact function
// without binding a socket or reaching a chain.
//
// The join screen needs the onboarding contract, the identity authority, the badge contract and
// the parent every business joins under; each is null when the manifest does not carry it, and the
// screen says the local setup has no onboarding contract yet rather than guessing.
//
// The business screens additionally need the payment assets, the pair that can convert between
// them, and the direct settler. THREE RULES HOLD HERE, and each exists because the alternative
// misleads somebody:
//
//   1. An asset is only listed when its own label was READ FROM THE CHAIN the manifest names.
//      A manifest records addresses, not symbols or decimal places, and a screen that invents
//      "6 decimals" for a token it never asked would show a customer the wrong amount. An asset
//      whose label could not be read is listed with a null symbol, and every screen treats that
//      as temporarily unavailable.
//   2. `directSettlement` and `productCatalog` are null until those contracts are part of the
//      deployment. Null is a real answer that the screens turn into "temporarily unavailable" for
//      a same-asset payment, and into "this deployment has no list of things to sell yet" for the
//      catalogue; a guessed address would be a promise the checkout could not keep.
//   3. `marketPair.active` is true only at market status 4, ACTIVE, in the frozen status
//      numbering (src/unica-v4/UnicaMarketTypes.sol). A proposed, seeded, paused or retired
//      market cannot convert anything, so it must not be offered as if it could.
function assetsFrom(manifest, tokenLabels = {}) {
  const contracts = manifest?.contracts ?? {};
  const wanted = [
    ["payoutToken", "payout"],
    ["assetToken", "customer"],
  ];
  const out = [];
  for (const [key, role] of wanted) {
    const address = contracts[key]?.address ?? null;
    if (!address) continue;
    const label = tokenLabels[String(address).toLowerCase()] ?? {};
    out.push({
      key,
      role,
      address,
      symbol: label.symbol ?? null,
      decimals: label.decimals === undefined || label.decimals === null ? null : Number(label.decimals),
      labelled: Boolean(label.symbol) && label.decimals !== undefined && label.decimals !== null,
    });
  }
  return out;
}

// What a wallet on this network may hold, as far as this deployment knows: the two payment assets
// plus every address the manifest lists under `knownTokens`. The same rule 1 applies — a symbol
// or a decimal count is never invented — and an address that appears twice is listed once. The
// list is what the app KNOWS, never what the wallet has: a token the manifest does not name is
// invisible here, and the dashboard says so instead of pretending to be an indexer.
function holdingsFrom(manifest, tokenLabels = {}) {
  const seen = new Set();
  const out = [];
  const add = (address, role) => {
    if (!address) return;
    const key = String(address).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const label = tokenLabels[key] ?? {};
    out.push({
      role,
      address,
      symbol: label.symbol ?? null,
      decimals: label.decimals === undefined || label.decimals === null ? null : Number(label.decimals),
      labelled: Boolean(label.symbol) && label.decimals !== undefined && label.decimals !== null,
    });
  };
  for (const a of assetsFrom(manifest, tokenLabels)) add(a.address, a.role);
  for (const t of Array.isArray(manifest?.knownTokens) ? manifest.knownTokens : []) add(t?.address ?? null, "known");
  return out;
}

const MARKET_STATUS_ACTIVE = 4;

function marketPairFrom(manifest) {
  const market = manifest?.market;
  if (!market) return null;
  const status = Number(market.status ?? manifest?.seed?.status ?? 0);
  return {
    marketId: market.marketId ?? null,
    currency0: market.poolKey?.currency0 ?? null,
    currency1: market.poolKey?.currency1 ?? null,
    poolId: market.poolId ?? null,
    status,
    active: status === MARKET_STATUS_ACTIVE,
  };
}

// A record is served only when it belongs to the chain the manifest names. The practice-chain
// record carries chainId 31337; served under a public-network manifest it would show yesterday's
// local sale as if it had happened on that network. A record with no chainId at all is the older
// local shape and is accepted for the local practice chain only.
const LOCAL_PRACTICE_CHAIN_ID = 31337;
function recordFor(manifest, record) {
  if (!record || typeof record !== "object") return null;
  const chain = Number(manifest?.chainId);
  if (record.chainId === undefined || record.chainId === null) return chain === LOCAL_PRACTICE_CHAIN_ID ? record : null;
  return Number(record.chainId) === chain ? record : null;
}

function runtimeConfig(manifest, record, rpc, tokenLabels = {}) {
  const contracts = manifest?.contracts ?? {};
  const identity = manifest?.identity ?? {};
  return {
    rpc,
    chainId: manifest?.chainId ?? null,
    environment: manifest?.environment ?? null,
    manifest,
    record: recordFor(manifest, record),
    assets: assetsFrom(manifest, tokenLabels),
    holdings: holdingsFrom(manifest, tokenLabels),
    marketPair: marketPairFrom(manifest),
    contracts: {
      directSettlement: contracts.directSettlement?.address ?? null,
      terminalAdmission: contracts.terminalAdmission?.address ?? null,
      marketAdmission: contracts.marketAdmission?.address ?? null,
      directAdmission: contracts.directAdmission?.address ?? null,
      productCatalog: contracts.productCatalog?.address ?? null,
      executor: contracts.executor?.address ?? null,
      hook: contracts.hook?.address ?? null,
      registry: contracts.registry?.address ?? null,
      oracleAdapter: contracts.oracleAdapter?.address ?? null,
    },
    merchantOnboarding: contracts.merchantOnboarding?.address ?? null,
    identity: contracts.identityFixture?.address ?? null,
    identityToken: contracts.identityToken?.address ?? null,
    parentNode: identity.parentNode ?? null,
    parentName: identity.parentName ?? null,
    terminalStatusKey: identity.terminalStatusKey ?? null,
  };
}
// @runtimeConfig-end

// ---- reading an asset's own label from the chain -------------------------------------------------
// A manifest records addresses. A symbol and a decimal count are properties of the token itself,
// so they are asked of the token, once per address, and cached for the life of this process. An
// unreachable chain leaves the label unread: `assetsFrom` then marks the asset unlabelled and the
// screens show it as temporarily unavailable, which is true, instead of guessing a decimal count
// and showing a customer the wrong amount.

const SELECTOR_SYMBOL = "0x95d89b41"; // keccak256("symbol()") first four bytes
const SELECTOR_DECIMALS = "0x313ce567"; // keccak256("decimals()") first four bytes
const tokenLabelCache = new Map();

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

/** Decode one dynamic `string` return value: offset word, length word, then the bytes. */
function decodeStringReturn(hex) {
  const h = String(hex ?? "").replace(/^0x/, "");
  if (h.length < 128) return null;
  const at = Number(BigInt("0x" + h.slice(0, 64))) * 2;
  const length = Number(BigInt("0x" + h.slice(at, at + 64)));
  const bytes = h.slice(at + 64, at + 64 + length * 2);
  let out = "";
  for (let i = 0; i < bytes.length; i += 2) out += String.fromCharCode(parseInt(bytes.slice(i, i + 2), 16));
  return out;
}

async function readTokenLabel(address) {
  const key = String(address).toLowerCase();
  if (tokenLabelCache.has(key)) return tokenLabelCache.get(key);
  let label = {};
  try {
    const symbol = decodeStringReturn(await rpc("eth_call", [{ to: address, data: SELECTOR_SYMBOL }, "latest"]));
    const decimalsHex = await rpc("eth_call", [{ to: address, data: SELECTOR_DECIMALS }, "latest"]);
    const decimals = Number(BigInt(decimalsHex));
    if (symbol) label = { symbol, decimals };
  } catch {
    label = {}; // the chain is not up, or this address is not a token: say nothing rather than guess
  }
  if (label.symbol) tokenLabelCache.set(key, label); // only a successful read is remembered
  return label;
}

/** Labels for every token address the manifest names, keyed by lowercase address. */
async function readTokenLabels(manifest) {
  const contracts = manifest?.contracts ?? {};
  const labels = {};
  for (const key of ["payoutToken", "assetToken"]) {
    const address = contracts[key]?.address;
    if (!address) continue;
    labels[String(address).toLowerCase()] = await readTokenLabel(address);
  }
  for (const t of Array.isArray(manifest?.knownTokens) ? manifest.knownTokens : []) {
    if (!t?.address) continue;
    labels[String(t.address).toLowerCase()] = await readTokenLabel(t.address);
  }
  return labels;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

async function sendFile(res, path, status = 200) {
  const body = await readFile(path);
  res.writeHead(status, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store", "cache-control": "no-cache" });
  res.end(body);
}

async function serveStatic(res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendFile(res, join(OUT_DIR, "404.html"), 404).catch(() => { res.writeHead(404); res.end("not found"); });
  }
  let rel = normalize(decoded);
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
      return sendJson(res, 200, runtimeConfig(manifest, readRecord(), RPC_PROXY_PATH, await readTokenLabels(manifest)));
    }

    // The browser never learns the node's URL. Every read or send the screens make goes to this
    // path and is forwarded here, so a keyed or private endpoint named in UNICA_LOCAL_RPC stays in
    // this process. The body is passed through untouched and the node's answer is returned as is;
    // this is a pipe, not a policy, and it forwards only JSON-RPC-shaped POSTs of a bounded size.
    if (url.pathname === RPC_PROXY_PATH) {
      if (req.method !== "POST") return sendJson(res, 405, { error: "POST a JSON-RPC request" });
      // Only this site's own pages may use the pipe. Another tab on another origin could otherwise
      // POST here blind (a browser sends it without asking) and drive the local node through us.
      // A same-origin fetch carries Sec-Fetch-Site same-origin or an Origin of this server; a plain
      // curl on the same machine carries neither and is the owner's own hand, which is allowed.
      if (!sameOriginRequest(req)) return sendJson(res, 403, { error: "this path answers this site's own pages only" });
      const body = await readBody(req, 1 << 20);
      if (body === null) return sendJson(res, 413, { error: "request too large" });
      let parsed;
      try { parsed = JSON.parse(body); } catch { return sendJson(res, 400, { error: "not JSON" }); }
      const shaped = (x) => x && typeof x === "object" && !Array.isArray(x) && typeof x.method === "string";
      if (!(shaped(parsed) || (Array.isArray(parsed) && parsed.length > 0 && parsed.every(shaped)))) return sendJson(res, 400, { error: "not a JSON-RPC request" });
      const upstream = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body });
      const text = await upstream.text();
      res.writeHead(upstream.status, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(text);
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
        // Which settler holds this order, and is it settled yet? An OPEN order is a fact of its own
        // (UNKNOWN, ORDER_OPEN), never a refusal: the customer has simply not paid. Only a settled
        // order goes through the receipt rules, direct or market by where it lives.
        const settler = manifest?.contracts?.directSettlement?.address ?? null;
        const executor = manifest?.contracts?.executor?.address ?? null;
        const ordersData = "0x" + ORDERS_SELECTOR_HEX + order.slice(2).toLowerCase().padStart(64, "0");
        const readOrder = async (at) => {
          if (!at) return null;
          try { return decodeDirectOrder(await rpc("eth_call", [{ to: at, data: ordersData }, "latest"])); } catch { return null; }
        };
        const direct = await readOrder(settler);
        const market = direct && direct.status !== 0 ? null : await readOrder(executor);
        const held = direct && direct.status !== 0 ? { kind: "direct", order: direct } : market && market.status !== 0 ? { kind: "market", order: market } : null;
        if (held && held.order.status !== ORDER_SETTLED) {
          return sendJson(res, 200, { decision: "UNKNOWN", reasonCodes: ["ORDER_OPEN"], kind: held.kind, order: { ...held.order, amountIn: String(held.order.amountIn), minOut: String(held.order.minOut), deadline: String(held.order.deadline) }, receipt: null });
        }
        const projection = await projectAll(manifest);
        const common = { orderId: order, logs: projection.logs, manifest, chainHead: projection.chainHead, requiredConfirmations: 0 };
        const verdict = held?.kind === "direct"
          ? authenticateDirectReceipt({ ...common, directOrder: held.order })
          : authenticateReceipt(common);
        return sendJson(res, 200, { ...verdict, kind: held?.kind ?? "market" });
      } catch (e) {
        return sendJson(res, 502, { decision: "UNKNOWN", reasonCodes: ["EVIDENCE_ENDPOINT_UNAVAILABLE"], receipt: null, error: redact(e?.message ?? e) });
      }
    }

    // One order, by id, from whichever settler holds it, with the business it pays. This is how a
    // payment link becomes a card without a stored record: the id in the link is asked of the chain.
    if (url.pathname === "/local/order") {
      const id = url.searchParams.get("id");
      if (!id || !HASH32.test(id)) return sendJson(res, 400, { error: "id must be a 32-byte hex order id", order: null });
      try {
        const manifest = readManifest();
        const settler = manifest?.contracts?.directSettlement?.address ?? null;
        const executor = manifest?.contracts?.executor?.address ?? null;
        const data = "0x" + ORDERS_SELECTOR_HEX + id.slice(2).toLowerCase().padStart(64, "0");
        const readAt = async (at) => { if (!at) return null; try { return decodeDirectOrder(await rpc("eth_call", [{ to: at, data }, "latest"])); } catch { return null; } };
        const direct = await readAt(settler);
        const held = direct && direct.status !== 0 ? { kind: "direct", settler, order: direct } : null;
        const market = held ? null : await readAt(executor);
        const found = held ?? (market && market.status !== 0 ? { kind: "market", settler: executor, order: market } : null);
        if (!found) return sendJson(res, 404, { error: "no order with that id on this deployment", order: null });
        const labels = await readTokenLabels(manifest);
        const assetIn = found.kind === "direct" ? manifest?.contracts?.payoutToken?.address : manifest?.contracts?.assetToken?.address;
        const assetOut = manifest?.contracts?.payoutToken?.address ?? null;
        const label = (a) => (a ? { address: a, ...(labels[String(a).toLowerCase()] ?? { symbol: null, decimals: null }) } : null);
        const business = await businessByPayout(manifest, found.order.recipient);
        const o = found.order;
        return sendJson(res, 200, {
          orderId: id, kind: found.kind, settler: found.settler, chainId: manifest?.chainId ?? null,
          order: { recipient: o.recipient, payer: o.payer, amountIn: String(o.amountIn), minOut: String(o.minOut), deadline: String(o.deadline), status: o.status },
          assetIn: label(assetIn), assetOut: label(assetOut), business,
        });
      } catch (e) {
        return sendJson(res, 502, { error: redact(e?.message ?? e), order: null });
      }
    }

    // The payments one wallet has received, each with the same verdict the receipt screen would
    // give it. The list comes from the chain's logs; the verdict comes from the evidence rules; the
    // wallet comes from the query and is validated, never resolved. Nothing here is remembered.
    if (url.pathname === "/local/payments") {
      const wallet = url.searchParams.get("wallet");
      if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
        return sendJson(res, 400, { error: "wallet must be 0x followed by forty hex digits", payments: [] });
      }
      try {
        const manifest = readManifest();
        const projection = await projectAll(manifest);
        const settler = manifest?.contracts?.directSettlement?.address ?? null;
        const payments = [];
        for (const r of receiptsForRecipient({ logs: projection.logs, recipient: wallet })) {
          const common = { orderId: r.orderId, logs: projection.logs, manifest, chainHead: projection.chainHead, requiredConfirmations: 0 };
          let verdict;
          if (r.kind === "direct") {
            let directOrder = null;
            if (settler) {
              try { directOrder = await fetchDirectOrder({ rpc: RPC_URL, settler, orderId: r.orderId }); } catch { directOrder = null; }
            }
            verdict = authenticateDirectReceipt({ ...common, directOrder });
          } else if (r.kind === "product") {
            // A catalogue sale is judged by its sale id, which `receiptsForRecipient` puts in the
            // same `orderId` field every other row uses, so the row's own kind chooses the reader
            // and nothing here has to know how a sale id is built.
            const { orderId, ...rest } = common;
            verdict = authenticateProductSale({ saleId: orderId, ...rest });
          } else {
            verdict = authenticateReceipt(common);
          }
          let settledAt = r.settledAt;
          if (settledAt === null) {
            try {
              const block = await rpc("eth_getBlockByNumber", ["0x" + r.blockNumber.toString(16), false]);
              settledAt = block?.timestamp ? Number(BigInt(block.timestamp)) : null;
            } catch {
              settledAt = null;
            }
          }
          payments.push({ ...r, settledAt, decision: verdict.decision, reasonCodes: verdict.reasonCodes });
        }
        return sendJson(res, 200, { wallet, chainId: manifest?.chainId ?? null, chainHead: projection.chainHead ?? null, payments });
      } catch (e) {
        return sendJson(res, 502, { error: redact(e?.message ?? e), payments: [] });
      }
    }

    if (url.pathname.startsWith("/local/")) {
      return sendJson(res, 404, { error: "no such /local/ endpoint", path: url.pathname });
    }

    return await serveStatic(res, url.pathname);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(`internal error: ${redact(e?.message ?? e)}`);
  }
});

server.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`;
  console.log(`UNICA local demo server listening on ${base}/`);
  console.log(`Home:                  ${base}/`);
  console.log(`Add your business:     ${base}/join/`);
  console.log(`Business dashboard:    ${base}/business/`);
  console.log(`Create a payment:      ${base}/business/payments/new/`);
  console.log(`Customer checkout:     ${base}/pay/`);
  const onboarding = runtimeConfig(readManifest(), null, RPC_URL).merchantOnboarding;
  if (!onboarding) console.log("  (the manifest names no merchantOnboarding contract; the join screen will say so)");
  const record = readRecord();
  if (record?.order?.id) {
    console.log(`Pay screen (this order): ${base}/pay/?order=${record.order.id}`);
    console.log(`  as the wrong payer:    ${base}/pay/?order=${record.order.id}&as=0x0000000000000000000000000000000000000001`);
  } else {
    console.log("No demo record yet at " + process.env.UNICA_RECORD_PATH + " -- run: make anvil-demo, then reload.");
  }
});
JS
