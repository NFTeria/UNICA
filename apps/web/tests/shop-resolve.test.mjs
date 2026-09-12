import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveShop, shopLabel, shopPath } from "../assets/shop-resolve.js";
import { encodeCall, topicOf, BUSINESS_JOINED_SIGNATURE } from "../assets/abi.js";

const ONBOARDING = "0x59b670e9fA9D0A427751Af201D676719a970857b";
const OWNER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const PAYOUT = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const NODE = "0x" + "f2".repeat(32);
const word = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
const joinedLog = () => {
  const label = Buffer.from("freshcuts", "utf8").toString("hex").padEnd(64, "0");
  const data = "0x" + word("a0") + word(PAYOUT) + "ab".repeat(32) + "cd".repeat(32) + word("7") + word("9") + label;
  return { topics: [topicOf(BUSINESS_JOINED_SIGNATURE), NODE, "0x" + word(OWNER)], data };
};
const session = (node, logs) => ({
  call: async ({ data }) => { assert.equal(data.slice(0, 10), encodeCall("nodeOf(string)", ["freshcuts"]).slice(0, 10)); return node; },
  request: async (method, [filter]) => { assert.equal(method, "eth_getLogs"); assert.equal(filter.topics[1], NODE); return logs; },
});
const config = { merchantOnboarding: ONBOARDING, parentName: "unica.eth" };

test("a shop label is the name a person typed, with the parent and the case removed, and nothing foreign", () => {
  assert.equal(shopLabel("FreshCuts", "unica.eth"), "freshcuts");
  assert.equal(shopLabel("freshcuts.unica.eth", "unica.eth"), "freshcuts");
  assert.equal(shopLabel(" freshcuts ", null), "freshcuts");
  assert.equal(shopLabel("vitalik.eth", "unica.eth"), null);
  assert.equal(shopLabel("a.b", null), null);
  assert.equal(shopLabel("", "unica.eth"), null);
  assert.equal(shopLabel("has space", "unica.eth"), null);
  assert.equal(shopPath("FreshCuts"), "shop/?name=freshcuts");
});

test("a name resolves on the chain to the business that registered it", async () => {
  const r = await resolveShop(session(NODE, [joinedLog()]), config, "freshcuts.unica.eth");
  assert.equal(r.by, "name");
  assert.equal(r.seller.toLowerCase(), OWNER);
  assert.equal(r.payout.toLowerCase(), PAYOUT);
  assert.equal(r.label, "freshcuts");
  assert.equal(r.name, "freshcuts.unica.eth");
  assert.equal(r.merchantNode, NODE);
});

test("an address is accepted as is, an unknown name is null, and a network without sign-up resolves no name", async () => {
  const addr = await resolveShop({}, config, OWNER);
  assert.deepEqual(addr, { by: "address", seller: OWNER });
  assert.equal(await resolveShop(session("0x" + "0".repeat(64), []), config, "nobody"), null);
  assert.equal(await resolveShop(session(NODE, []), config, "freshcuts"), null, "a node with no record is not a shop");
  assert.equal(await resolveShop(session(NODE, [joinedLog()]), { merchantOnboarding: null }, "freshcuts"), null);
});
