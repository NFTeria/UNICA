// The customer's ENS profile: a claimed primary name is shown only after its addr record points back.
// Every chain answer here is the byte-for-byte fixture the Sepolia universal resolver returned on
// 2026-09-13 for the customer wallet, or a planted variation of it.
import assert from "node:assert/strict";
import { test } from "node:test";

import { UNIVERSAL_RESOLVER, avatarOf, avatarSource, customerProfile, decodeResolveReturn, decodeReverseReturn, dnsEncode, encodeResolveCall, encodeReverseCall, namehash, primaryName } from "../assets/ens-profile.js";
import { encodeCall, wordsOf } from "../assets/abi.js";

const CUSTOMER = "0x19E56831a10d43CfF5d77f886c799C6b916da7Ae";
const OTHER = "0xA121e1eF31bBF0826aA67dC01e7977e80Af58D73";
const config = { chainId: 11155111, rpc: "/local/rpc" };
// reverse(bytes,uint256) for CUSTOMER, as the chain answered: ("consumer.eth", resolver, reverseResolver)
const REVERSE_RETURN = "0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000f79a6184d2dd6f82086955cb2fbfd15b46fa5c70000000000000000000000000ae66c62acae72098bdac57d8e8aed53ef000b2ba000000000000000000000000000000000000000000000000000000000000000c636f6e73756d65722e6574680000000000000000000000000000000000000000"; // return vector, as the chain gave it
const word = (h) => String(h).replace(/^0x/, "").padStart(64, "0");
const resolveReturn = (innerHex) => {
  const inner = String(innerHex).replace(/^0x/, "");
  return "0x" + word("40") + word("f79a6184d2dd6f82086955cb2fbfd15b46fa5c70") + word((inner.length / 2).toString(16)) + inner + "0".repeat((64 - (inner.length % 64)) % 64);
};
const stringReturn = (s) => {
  const hex = Buffer.from(s, "utf8").toString("hex");
  return word("20") + word(s.length.toString(16)) + hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
};

test("the calldata for reverse() and resolve() are the shapes cast produces, and both returns decode", () => {
  assert.equal(
    encodeReverseCall(CUSTOMER),
    "0x5d78a2170000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000003c000000000000000000000000000000000000000000000000000000000000001419e56831a10d43cff5d77f886c799c6b916da7ae000000000000000000000000", // calldata vector, as cast produces it
  );
  assert.deepEqual(decodeReverseReturn(REVERSE_RETURN), { name: "consumer.eth", resolver: "0xf79a6184d2dd6f82086955cb2fbfd15b46fa5c70", reverseResolver: "0xae66c62acae72098bdac57d8e8aed53ef000b2ba" });
  assert.equal(decodeReverseReturn("0x"), null);
  assert.equal(dnsEncode("consumer.eth"), "0x08636f6e73756d65720365746800");
  assert.equal(namehash("consumer.eth").length, 66);
  assert.equal(namehash(""), "0x" + "0".repeat(64));
  const inner = encodeCall("addr(bytes32)", [namehash("consumer.eth")]);
  const call = encodeResolveCall(dnsEncode("consumer.eth"), inner);
  assert.match(call, /^0x9061b923/);
  assert.equal(wordsOf("0x" + call.slice(10)).length, 2 + 1 + 1 + 1 + 2, "offsets, dns length + one word, inner length + two words");
  const back = decodeResolveReturn(resolveReturn(word(CUSTOMER)));
  assert.equal(back.result.toLowerCase(), "0x" + word(CUSTOMER).toLowerCase());
  assert.equal(back.resolver, "0xf79a6184d2dd6f82086955cb2fbfd15b46fa5c70");
});

test("a claimed name is shown only when its addr record points back at the wallet", async () => {
  const chain = (addrAnswer) => async (to, data) => {
    assert.equal(to, UNIVERSAL_RESOLVER);
    if (data.startsWith("0x5d78a217")) return REVERSE_RETURN;
    if (data.startsWith("0x9061b923") && data.includes("3b3b57de")) return resolveReturn(word(addrAnswer));
    if (data.startsWith("0x9061b923") && data.includes("59d1d43c")) return resolveReturn(stringReturn("https://example.invalid/consumer.png"));
    throw new Error("unexpected call");
  };
  assert.equal(await primaryName(config, CUSTOMER, chain(CUSTOMER)), "consumer.eth");
  assert.equal(await primaryName(config, CUSTOMER, chain(OTHER)), null, "a name whose addr record points elsewhere is not this wallet's");
  assert.equal(await primaryName({ chainId: 84532, rpc: "/local/rpc" }, CUSTOMER, chain(CUSTOMER)), null, "no ENSv2 on that network");
  assert.equal(await primaryName(config, "not-a-wallet", chain(CUSTOMER)), null);
  assert.equal(await primaryName(config, CUSTOMER, async () => { throw new Error("away"); }), null, "a failed read is no name, never a throw");
  assert.equal(await primaryName(config, CUSTOMER, async () => "0x"), null, "an empty answer is no name");
  assert.deepEqual(await customerProfile(config, CUSTOMER, chain(CUSTOMER)), { name: "consumer.eth", avatar: "https://example.invalid/consumer.png" });
  assert.deepEqual(await customerProfile(config, CUSTOMER, chain(OTHER)), { name: null, avatar: null });
});

test("only an avatar this page can draw is drawn; an empty record is no avatar", async () => {
  assert.equal(avatarSource("https://example.invalid/a.png"), "https://example.invalid/a.png");
  assert.equal(avatarSource("ipfs://QmX"), "https://ipfs.io/ipfs/QmX");
  assert.equal(avatarSource("ipfs://ipfs/QmX"), "https://ipfs.io/ipfs/QmX");
  assert.equal(avatarSource("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
  assert.equal(avatarSource("eip155:1/erc721:0xabc/1"), null, "an NFT reference needs a lookup this release does not make");
  assert.equal(avatarSource("javascript:alert(1)"), null);
  assert.equal(avatarSource(""), null);
  const empty = async () => resolveReturn(stringReturn(""));
  assert.equal(await avatarOf(config, "consumer.eth", empty), null);
  assert.equal(await avatarOf(config, "consumer.eth", async () => { throw new Error("away"); }), null);
});
