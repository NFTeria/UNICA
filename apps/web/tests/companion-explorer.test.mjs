// The public host's business lookup reads lineage logs from an explorer. With a key configured the
// keyed Etherscan source is asked first; when it refuses, the manifest's keyless explorer answers the
// same filter; and the key never reaches a response. Every network call here is a double: the fetch
// global is replaced for the duration of each row and restored after it.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createCompanion } from "../../../script/anvil/companion.mjs";

const ROOT = new URL("../../../", import.meta.url).pathname;
const MANIFEST = "deployments/unica-v4/11155111.json"; // the real Sepolia manifest: authority, parent node, explorer
const AUTHORITY = "0xB3aCbD101b026669A5b61DBbcD13d5CAe1c8f133";
const PARENT = "0xa1666e95e38a3be2115a9a801792914ca6dca4fa6297d21e835f284254337537"; // namehash(unica.eth)
const CHILD = "0x" + "11".repeat(32); // a planted merchant node
const PAYOUT = "0xA121e1eF31bBF0826aA67dC01e7977e80Af58D73";
const LINEAGE_TOPIC0 = "0x97a36c7723679a0699c199fc7e1ae76c624ec139ccaa842cff1caf36a39c7239"; // keccak256("LineageRegistered(bytes32,bytes32,string)")
const ADDR_SELECTOR = "0x3b3b57de"; // addr(bytes32)
const TEXT_SELECTOR = "0x59d1d43c"; // text(bytes32,string)
const word = (hex) => String(hex).replace(/^0x/, "").padStart(64, "0");
const abiString = (s) => "0x" + word("20") + word(Buffer.from(s, "utf8").length.toString(16)) + Buffer.from(s, "utf8").toString("hex").padEnd(64, "0");
const lineageLog = {
  address: AUTHORITY,
  topics: [LINEAGE_TOPIC0, CHILD, PARENT],
  data: abiString("freshcuts"),
  blockNumber: "0xb260c3",
  logIndex: "0x0",
  transactionHash: "0x" + "ab".repeat(32),
  transactionIndex: "0x0",
};
const ETHERSCAN = /^https:\/\/api\.etherscan\.io\/v2\/api\?/;
const BLOCKSCOUT = /^https:\/\/eth-sepolia\.blockscout\.com\/api\?/;
const json = (obj, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => obj });

/** A node that answers every eth_call: the payout for addr(), an empty string for text(), false for everything else. */
function nodeAnswer(init) {
  const { method, params } = JSON.parse(init.body);
  let result = "0x" + word("0");
  if (method === "eth_call") {
    const data = String(params?.[0]?.data ?? "");
    if (data.startsWith(ADDR_SELECTOR)) result = "0x" + word(PAYOUT);
    else if (data.startsWith(TEXT_SELECTOR)) result = abiString("");
  }
  return json({ jsonrpc: "2.0", id: 1, result });
}

function fakeRes() {
  const out = { status: 0, body: "" };
  return { out, writeHead: (s) => (out.status = s), end: (b) => (out.body = String(b ?? "")) };
}

async function ask(companion, path) {
  const res = fakeRes();
  await companion.handler({ method: "GET", url: path, headers: { host: "127.0.0.1:1" } }, res);
  return { status: res.out.status, body: JSON.parse(res.out.body) };
}

async function withFetch(answer, run) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    return answer(String(url), init);
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = real;
  }
}

const make = (explorerKey) => createCompanion({ root: ROOT, outDir: null, manifestPath: MANIFEST, recordPath: null, rpcUrl: "https://node.invalid/rpc", explorerKey });

test("with a key the keyed explorer is asked first, its refusal falls back to the keyless one, and the key never reaches the answer", async () => {
  await withFetch(
    (url, init) => {
      if (ETHERSCAN.test(url)) return json({ status: "0", message: "NOTOK", result: "Missing/Invalid API Key" });
      if (BLOCKSCOUT.test(url)) return json({ status: "1", message: "OK", result: [lineageLog] });
      return nodeAnswer(init);
    },
    async (calls) => {
      const { status, body } = await ask(make("PLANTED-KEY"), "/local/businesses?label=freshcuts");
      assert.equal(status, 200, JSON.stringify(body));
      assert.equal(body.businesses.length, 1);
      assert.equal(body.businesses[0].name, "freshcuts.unica.eth");
      assert.equal(String(body.businesses[0].payout).toLowerCase(), PAYOUT.toLowerCase());
      assert.match(calls[0], ETHERSCAN, "the keyed source goes first");
      assert.match(calls[0], /chainid=11155111/);
      assert.match(calls[0], /apikey=PLANTED-KEY/);
      assert.match(calls[1], BLOCKSCOUT, "its refusal hands the filter to the keyless explorer");
      assert.doesNotMatch(JSON.stringify(body), /PLANTED-KEY/);
    },
  );
});

test("without a key the keyless explorer is the only source (control), and when every source refuses the answer is a 502 that names no key", async () => {
  await withFetch(
    (url, init) => {
      if (ETHERSCAN.test(url)) throw new Error("must not be asked without a key");
      if (BLOCKSCOUT.test(url)) return json({ status: "1", message: "OK", result: [lineageLog] });
      return nodeAnswer(init);
    },
    async (calls) => {
      const { status, body } = await ask(make(null), "/local/businesses?label=freshcuts");
      assert.equal(status, 200);
      assert.equal(body.businesses[0].name, "freshcuts.unica.eth");
      assert.ok(calls.some((u) => BLOCKSCOUT.test(u)) && !calls.some((u) => ETHERSCAN.test(u)));
    },
  );
  await withFetch(
    (url, init) => {
      if (ETHERSCAN.test(url)) return json({ status: "0", message: "NOTOK", result: "Invalid chainid" });
      if (BLOCKSCOUT.test(url)) return json({ status: "0", message: "NOTOK", result: "Too many requests" });
      return nodeAnswer(init);
    },
    async (calls) => {
      const { status, body } = await ask(make("PLANTED-KEY"), "/local/businesses?label=freshcuts");
      assert.equal(status, 502);
      assert.equal(body.businesses.length, 0);
      assert.match(body.error, /NOTOK/);
      assert.doesNotMatch(body.error, /PLANTED-KEY/);
      assert.ok(calls.some((u) => ETHERSCAN.test(u)) && calls.some((u) => BLOCKSCOUT.test(u)), "both sources were tried");
    },
  );
});
