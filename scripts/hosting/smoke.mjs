// scripts/hosting/smoke.mjs — the public-hosting adapter, driven without publishing anything.
//
// api/local.mjs is the file a public host runs. It cannot be proved by deploying it: a deployment
// is the owner's to make, and a green deployment would anyway prove only that the host accepted the
// upload. What matters is what the function ANSWERS, so this drives its handler directly with plain
// request and response objects, through the exact shape a vercel.json rewrite produces — the path
// in `__companionPath`, the visitor's own query beside it.
//
// NOTHING HERE REACHES A NETWORK. `globalThis.fetch` is replaced by a fake node that refuses any URL
// but the invalid one this file invents, so a regression that made the companion call out would
// fail here rather than quietly working on somebody's machine and nowhere else.
//
// Run it: node scripts/hosting/smoke.mjs

import assert from "node:assert/strict";
import { Readable } from "node:stream";

// A node URL that cannot resolve, so a leak is a failure rather than a request. `.invalid` is
// reserved for exactly this (RFC 2606) and no DNS will ever answer for it.
const FAKE_NODE = "http://unica-smoke-node.invalid/rpc";
const CHAIN_ID_ANSWER = "0xaa36a7"; // 11155111, what a Sepolia node answers to eth_chainId

process.env.UNICA_MANIFEST_PATH = "deployments/unica-v4/11155111.json";
process.env.UNICA_RPC_URL = FAKE_NODE;
delete process.env.UNICA_SUBGRAPH_URL;

let reached = 0;
globalThis.fetch = async (url, init) => {
  if (String(url) !== FAKE_NODE)
    throw new Error(`the companion called out to something other than the node: ${url}`);
  reached += 1;
  const body = JSON.parse(init?.body ?? "{}");
  const answer = (result) => ({ jsonrpc: "2.0", id: body.id ?? 1, result });
  // eth_chainId is the one call this proves end to end. Everything else — the token label reads the
  // config route makes — answers empty data, which is a real state: the screens then show the asset
  // as temporarily unlabelled rather than inventing a symbol.
  const result = body.method === "eth_chainId" ? CHAIN_ID_ANSWER : "0x";
  return {
    status: 200,
    async json() {
      return answer(result);
    },
    async text() {
      return JSON.stringify(answer(result));
    },
  };
};

const { default: handler } = await import("../../api/local.mjs");

/** One request, shaped the way a rewrite delivers it: the real path in `__companionPath`. */
function request({ method = "GET", path, query = "", headers = {}, body = null }) {
  const rewritten = `/api/local?__companionPath=${path}${query ? `&${query}` : ""}`;
  const req = body === null ? Readable.from([]) : Readable.from([Buffer.from(body, "utf8")]);
  req.method = method;
  req.url = rewritten;
  req.headers = { host: "example.vercel.app", ...headers };
  return req;
}

/** A response that remembers what was written to it, and a promise that settles when it ends. */
function response() {
  let settle;
  const done = new Promise((r) => {
    settle = r;
  });
  const out = {
    statusCode: 200,
    headers: {},
    body: "",
    done,
    setHeader(k, v) {
      out.headers[String(k).toLowerCase()] = v;
    },
    writeHead(status, headers = {}) {
      out.statusCode = status;
      for (const [k, v] of Object.entries(headers)) out.headers[String(k).toLowerCase()] = v;
      return out;
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null)
        out.body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      settle(out);
      return out;
    },
  };
  return out;
}

async function ask(options) {
  const res = response();
  await handler(request(options), res);
  return res.done;
}

let ran = 0;
let failed = 0;
async function check(name, run) {
  ran += 1;
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(`      ${e?.message ?? e}`);
  }
}

await check("GET /local/config.json names chain 11155111 and the pipe, never the node", async () => {
  const res = await ask({ path: "/local/config.json" });
  assert.equal(res.statusCode, 200);
  const config = JSON.parse(res.body);
  assert.equal(config.chainId, 11155111);
  assert.equal(config.rpc, "/local/rpc");
  assert.equal(config.graph.url, null);
});

// The control on the row above. A companion that handed the browser the node's own URL would still
// answer 200 with the right chain id, so the check that matters is this one: the served bytes do
// not contain the URL anywhere, under any key.
await check("control: the served config carries no node URL at all", async () => {
  const res = await ask({ path: "/local/config.json" });
  assert.equal(res.statusCode, 200); // a 404 body carries no URL either; this row must judge a real answer
  assert.ok(!res.body.includes("unica-smoke-node"), "the node URL reached the browser");
  assert.ok(!res.body.includes(FAKE_NODE), "the node URL reached the browser");
});

await check("POST /local/rpc from this host's own page is forwarded to the node", async () => {
  const before = reached;
  const res = await ask({
    method: "POST",
    path: "/local/rpc",
    headers: {
      origin: "https://example.vercel.app",
      host: "example.vercel.app",
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "eth_chainId", params: [] }),
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { jsonrpc: "2.0", id: 7, result: CHAIN_ID_ANSWER });
  assert.ok(reached > before, "the request never reached the node");
});

await check("POST /local/rpc from a foreign origin is refused", async () => {
  const before = reached;
  const res = await ask({
    method: "POST",
    path: "/local/rpc",
    headers: {
      origin: "https://evil.example",
      host: "example.vercel.app",
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "eth_chainId", params: [] }),
  });
  assert.equal(res.statusCode, 403);
  assert.equal(reached, before, "a refused request still reached the node");
});

await check("GET /local/order with a malformed id is refused as a bad request", async () => {
  const res = await ask({ path: "/local/order", query: "id=not-an-order-id" });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).order, null);
});

console.log(`checks run: ${ran}, passed: ${ran - failed}, failed: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
