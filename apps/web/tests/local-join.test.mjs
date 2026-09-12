// apps/web/tests/local-join.test.mjs: the pure parts of apps/web/assets/local-join.js: the ABI
// encoder for dynamic strings, the decoders, the name math, the label rules, the readiness rule,
// and the chain readers against a fake session. No DOM, no network, no chain.
//
// Every calldata and return-value vector below was produced independently with `cast` 1.3.5
// (`cast calldata`, `cast abi-encode`, `cast namehash`, `cast keccak`, `cast sig`) before the
// encoder was written, so the encoder is checked against a tool it does not share code with.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BUSINESS_JOINED_SIGNATURE,
  LABEL_RULE_SENTENCE,
  ROLES_GRANTED_SIGNATURE,
  ROLES_REVOKED_SIGNATURE,
  SUBNAME_REGISTERED_SIGNATURE,
  abiEncode,
  childNode,
  decodeAddress,
  decodeBool,
  decodeBusinessJoinedLog,
  decodeBytes32,
  decodeString,
  decodeSubnameRegisteredLog,
  decodeUint,
  encodeCall,
  foldRoleEvents,
  isAddress,
  isValidLabelLocal,
  isZeroBytes32,
  joinReadiness,
  listRegisters,
  paddedUtf8Hex,
  parseTokenUri,
  payNameFor,
  readBusinessJoined,
  readLabelStatus,
  registerStatusText,
  selectorOf,
  shortId,
  slugify,
  textResource,
  topicOf,
  typesOf,
  wordFromBool,
  wordFromUint,
} from "../assets/local-join.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const OWNER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const UNICA_NODE = "0xa1666e95e38a3be2115a9a801792914ca6dca4fa6297d21e835f284254337537"; // cast namehash unica.eth
const MERCHANT_NODE = "0xf20516307d58ce944ff8836b2f4327b03d3ff731d4451487b4377784ecf7bb12"; // cast namehash freshcuts.unica.eth
const TERMINALS_NODE = "0xae578a6fd5e5ee92c72a07935abbaf26c95c178cb81849718943b5417192d140"; // cast namehash terminals.freshcuts.unica.eth
const CHAIR1_NODE = "0x782b05e4c83262070602527c08c2d159cc29720f120ccd7dd0a57fbb0f72a1cf"; // cast namehash chair-1.terminals.freshcuts.unica.eth
const KEY = "com.unica.terminal-status";

// ---- selectors and topics, against cast sig / cast keccak -----------------------------------------

test("selectors match cast sig for every function this screen calls", () => {
  assert.equal(selectorOf("join(string,address,string)"), "0x253e1cd7");
  assert.equal(selectorOf("isValidLabel(string)"), "0x25719540");
  assert.equal(selectorOf("nodeOf(string)"), "0xfbff18df");
  assert.equal(selectorOf("merchantOf(address)"), "0x6633f4e8");
  assert.equal(selectorOf("register(bytes32,string,address)"), "0x6292a6bf");
  assert.equal(selectorOf("authorizeTextRoles(bytes32,string,address,bool)"), "0x06f98e33");
  assert.equal(selectorOf("setText(bytes32,string,string)"), "0x10f13a8c");
  assert.equal(selectorOf("text(bytes32,string)"), "0x59d1d43c");
  assert.equal(selectorOf("tokenURI(uint256)"), "0xc87b56dd");
  assert.equal(selectorOf("badge()"), "0x91d768de");
  assert.equal(selectorOf("TERMINAL_STATUS_KEY()"), "0x5dcc584f");
});
test("event topics match cast keccak", () => {
  assert.equal(topicOf(BUSINESS_JOINED_SIGNATURE), "0x363255a46b43937b4dcc59c7600746a03c7baa9d1c87d6b4f6530fcd11a6febe"); // topic vector
  assert.equal(topicOf(SUBNAME_REGISTERED_SIGNATURE), "0x1db20159fe1ffa671a06d2de6c8c697374da3db02ef15055809a0db8a0a30ec5"); // topic vector
  assert.equal(topicOf(ROLES_GRANTED_SIGNATURE), "0x2815f3be1b5829417dda0ae10f702d501242b31f3779c432cce79d479aecfdd5"); // topic vector
  assert.equal(topicOf(ROLES_REVOKED_SIGNATURE), "0x9a77cdfbf5a9127bc54eb2769aa9a37437f0a0821c3f79f0015acc87be16dd26"); // topic vector
});
test("typesOf reads the argument list out of a signature", () => {
  assert.deepEqual(typesOf("join(string,address,string)"), ["string", "address", "string"]);
  assert.deepEqual(typesOf("badge()"), []);
});

// ---- the dynamic-string encoder, against cast calldata --------------------------------------------

test("join(freshcuts, 0x0, register-1) matches cast calldata", () => {
  const expected = // cast calldata vector
    "0x253e1cd70000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000096672657368637574730000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a72656769737465722d3100000000000000000000000000000000000000000000"; // cast calldata vector
  assert.equal(encodeCall("join(string,address,string)", ["freshcuts", ZERO, "register-1"]), expected);
});
test("join with a 36-byte label (two tail words) and a real payout matches cast calldata", () => {
  const expected = // cast calldata vector
    "0x253e1cd7000000000000000000000000000000000000000000000000000000000000006000000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c800000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000246162636465666768696a6b6c6d6e6f707172737475767778797a3031323334353637383900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000763686169722d3100000000000000000000000000000000000000000000000000"; // cast calldata vector
  assert.equal(encodeCall("join(string,address,string)", ["abcdefghijklmnopqrstuvwxyz0123456789", OWNER, "chair-1"]), expected);
});
test("join with two empty strings matches cast calldata (a zero-length tail is one length word)", () => {
  const expected = // cast calldata vector
    "0x253e1cd700000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"; // cast calldata vector
  assert.equal(encodeCall("join(string,address,string)", ["", ZERO, ""]), expected);
});
test("isValidLabel(string) and nodeOf(string) match cast calldata", () => {
  const tail = "000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000096672657368637574730000000000000000000000000000000000000000000000"; // cast calldata vector
  assert.equal(encodeCall("isValidLabel(string)", ["freshcuts"]), "0x25719540" + tail);
  assert.equal(encodeCall("nodeOf(string)", ["freshcuts"]), "0xfbff18df" + tail);
});
test("merchantOf(address) matches cast calldata", () => {
  assert.equal(encodeCall("merchantOf(address)", [OWNER]), "0x6633f4e800000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8"); // cast calldata vector
});
test("register(bytes32,string,address) matches cast calldata", () => {
  const expected = // cast calldata vector
    "0x6292a6bfae578a6fd5e5ee92c72a07935abbaf26c95c178cb81849718943b5417192d140000000000000000000000000000000000000000000000000000000000000006000000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8000000000000000000000000000000000000000000000000000000000000000a72656769737465722d3200000000000000000000000000000000000000000000"; // cast calldata vector
  assert.equal(encodeCall("register(bytes32,string,address)", [TERMINALS_NODE, "register-2", OWNER]), expected);
});
test("authorizeTextRoles(bytes32,string,address,bool) matches cast calldata for grant and revoke", () => {
  const grant = // cast calldata vector
    "0x06f98e33ae578a6fd5e5ee92c72a07935abbaf26c95c178cb81849718943b5417192d140000000000000000000000000000000000000000000000000000000000000008000000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c800000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000019636f6d2e756e6963612e7465726d696e616c2d73746174757300000000000000"; // cast calldata vector
  const revoke = // cast calldata vector
    "0x06f98e33ae578a6fd5e5ee92c72a07935abbaf26c95c178cb81849718943b5417192d140000000000000000000000000000000000000000000000000000000000000008000000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000019636f6d2e756e6963612e7465726d696e616c2d73746174757300000000000000"; // cast calldata vector
  assert.equal(encodeCall("authorizeTextRoles(bytes32,string,address,bool)", [TERMINALS_NODE, KEY, OWNER, true]), grant);
  assert.equal(encodeCall("authorizeTextRoles(bytes32,string,address,bool)", [TERMINALS_NODE, KEY, OWNER, false]), revoke);
});
test("setText(bytes32,string,string) matches cast calldata for active and revoked", () => {
  const active = // cast calldata vector
    "0x10f13a8cae578a6fd5e5ee92c72a07935abbaf26c95c178cb81849718943b5417192d140000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000019636f6d2e756e6963612e7465726d696e616c2d7374617475730000000000000000000000000000000000000000000000000000000000000000000000000000066163746976650000000000000000000000000000000000000000000000000000"; // cast calldata vector
  const revoked = // cast calldata vector
    "0x10f13a8cae578a6fd5e5ee92c72a07935abbaf26c95c178cb81849718943b5417192d140000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000019636f6d2e756e6963612e7465726d696e616c2d7374617475730000000000000000000000000000000000000000000000000000000000000000000000000000077265766f6b656400000000000000000000000000000000000000000000000000"; // cast calldata vector
  assert.equal(encodeCall("setText(bytes32,string,string)", [TERMINALS_NODE, KEY, "active"]), active);
  assert.equal(encodeCall("setText(bytes32,string,string)", [TERMINALS_NODE, KEY, "revoked"]), revoked);
});
test("text(bytes32,string) and tokenURI(uint256) match cast calldata", () => {
  assert.equal(
    encodeCall("text(bytes32,string)", [TERMINALS_NODE, KEY]),
    "0x59d1d43cae578a6fd5e5ee92c72a07935abbaf26c95c178cb81849718943b5417192d14000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000019636f6d2e756e6963612e7465726d696e616c2d73746174757300000000000000", // cast calldata vector
  );
  assert.equal(encodeCall("tokenURI(uint256)", [1n]), "0xc87b56dd0000000000000000000000000000000000000000000000000000000000000001"); // cast calldata vector
});
test("encoder controls: wrong arity, a bad address and a negative uint are refused", () => {
  assert.throws(() => abiEncode(["string"], []), /expected 1 values/);
  assert.throws(() => encodeCall("merchantOf(address)", ["0x1234"]), /not a 20-byte address/);
  assert.throws(() => wordFromUint(-1n), /unsigned/);
  assert.equal(wordFromBool(true).endsWith("1"), true);
});
test("paddedUtf8Hex pads a 33-byte string to two words and reports the byte length, not the char count", () => {
  const { hex, byteLength } = paddedUtf8Hex("é" + "a".repeat(31)); // é is two bytes in UTF-8
  assert.equal(byteLength, 33);
  assert.equal(hex.length, 128);
});

// ---- decoders, against cast abi-encode ------------------------------------------------------------

test("decodeString reads a 49-byte string spanning two words", () => {
  const hex = "0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003168656c6c6f20776f726c642c2074686973206973206c6f6e676572207468616e207468697274792d74776f206279746573000000000000000000000000000000"; // cast abi-encode vector
  assert.equal(decodeString(hex), "hello world, this is longer than thirty-two bytes");
});
test("decodeString reads an empty string as empty, and no data as empty", () => {
  assert.equal(decodeString("0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000"), ""); // cast abi-encode vector
  assert.equal(decodeString("0x"), "");
});
test("decodeBool, decodeBytes32, decodeAddress, decodeUint read single words", () => {
  assert.equal(decodeBool("0x0000000000000000000000000000000000000000000000000000000000000001"), true); // cast abi-encode vector
  assert.equal(decodeBool("0x" + "0".repeat(64)), false); // zero word, a bytes32 vector
  assert.equal(decodeBytes32(TERMINALS_NODE), TERMINALS_NODE);
  assert.equal(decodeAddress("0x00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8"), OWNER); // cast abi-encode vector
  assert.equal(decodeUint("0x0000000000000000000000000000000000000000000000000000000000000007"), 7n); // cast abi-encode vector
  assert.equal(decodeBytes32("0x"), null);
});
test("isZeroBytes32 treats the zero word and nothing at all as 'nobody joined'", () => {
  assert.equal(isZeroBytes32("0x" + "0".repeat(64)), true); // zero bytes32 vector
  assert.equal(isZeroBytes32(null), true);
  assert.equal(isZeroBytes32(MERCHANT_NODE), false);
});

test("decodeBusinessJoinedLog reads every field from a log built with cast abi-encode", () => {
  const data = "0x00000000000000000000000000000000000000000000000000000000000000a000000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8ae578a6fd5e5ee92c72a07935abbaf26c95c178cb81849718943b5417192d140782b05e4c83262070602527c08c2d159cc29720f120ccd7dd0a57fbb0f72a1cf000000000000000000000000000000000000000000000000000000000000000700000000000000000000000000000000000000000000000000000000000000096672657368637574730000000000000000000000000000000000000000000000"; // cast abi-encode vector
  const log = { topics: [topicOf(BUSINESS_JOINED_SIGNATURE), MERCHANT_NODE, "0x00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8"], data }; // owner topic vector
  assert.deepEqual(decodeBusinessJoinedLog(log), {
    merchantNode: MERCHANT_NODE,
    owner: OWNER,
    label: "freshcuts",
    payout: OWNER,
    terminalsNode: TERMINALS_NODE,
    firstTerminalNode: CHAIR1_NODE,
    badgeTokenId: 7n,
  });
});
test("decodeBusinessJoinedLog refuses a log with the wrong number of topics", () => {
  assert.equal(decodeBusinessJoinedLog({ topics: [topicOf(BUSINESS_JOINED_SIGNATURE)], data: "0x" }), null);
});
test("decodeSubnameRegisteredLog reads label and owner from a log built with cast abi-encode", () => {
  const data = "0x000000000000000000000000000000000000000000000000000000000000004000000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8000000000000000000000000000000000000000000000000000000000000000763686169722d3100000000000000000000000000000000000000000000000000"; // cast abi-encode vector
  assert.deepEqual(decodeSubnameRegisteredLog({ topics: [topicOf(SUBNAME_REGISTERED_SIGNATURE), TERMINALS_NODE, CHAIR1_NODE], data }), {
    parent: TERMINALS_NODE,
    node: CHAIR1_NODE,
    label: "chair-1",
    owner: OWNER,
  });
});

// ---- name math, against cast namehash and cast keccak --------------------------------------------

test("childNode reproduces cast namehash down the freshcuts tree", () => {
  assert.equal(childNode(UNICA_NODE, "freshcuts"), MERCHANT_NODE);
  assert.equal(childNode(MERCHANT_NODE, "terminals"), TERMINALS_NODE);
  assert.equal(childNode(TERMINALS_NODE, "chair-1"), CHAIR1_NODE);
});
test("childNode control: a different label gives a different node", () => {
  assert.notEqual(childNode(TERMINALS_NODE, "chair-2"), CHAIR1_NODE);
});
test("textResource reproduces keccak256(abi.encode(node, keccak256(key)))", () => {
  assert.equal(textResource(CHAIR1_NODE, KEY), "0xaccf62cee3215ebe65ddf053bf192040643f8517b34c995625c477de1d94c0ff"); // cast keccak vector
});

// ---- label rules and the words a person types ---------------------------------------------------------

test("isValidLabelLocal accepts the interface's character class and lengths", () => {
  for (const ok of ["abc", "freshcuts", "register-1", "a-b-c", "x".repeat(32), "123"]) assert.equal(isValidLabelLocal(ok), true, ok);
});
test("isValidLabelLocal refuses what IMerchantOnboarding names as invalid", () => {
  for (const bad of ["ab", "x".repeat(33), "-abc", "abc-", "a--b", "Fresh", "fresh cuts", "fresh.cuts", "", null, "café"]) assert.equal(isValidLabelLocal(bad), false, String(bad));
});
test("slugify turns a typed register name into its label", () => {
  assert.equal(slugify("Register 1"), "register-1");
  assert.equal(slugify("  Front Counter!! "), "front-counter");
  assert.equal(slugify("Chair #2 (window)"), "chair-2-window");
  assert.equal(slugify("---"), "");
});
test("payNameFor and shortId read as a person expects", () => {
  assert.equal(payNameFor("freshcuts", "unica.eth"), "freshcuts.unica.eth");
  assert.equal(payNameFor("freshcuts"), "freshcuts.unica.eth");
  assert.equal(shortId(MERCHANT_NODE), "0xf20516…bb12");
  assert.equal(shortId("0x1234"), "0x1234");
});
test("isAddress accepts a full 20-byte address only", () => {
  assert.equal(isAddress(OWNER), true);
  assert.equal(isAddress("0x1234"), false);
  assert.equal(isAddress(""), false);
});
test("registerStatusText maps the chain's words to a person's words", () => {
  assert.equal(registerStatusText("active"), "Active");
  assert.equal(registerStatusText("revoked"), "Revoked");
  assert.equal(registerStatusText(""), "Not switched on yet");
});
test("parseTokenUri decodes the badge's data URI and refuses anything else", () => {
  const image = "data:image/svg+xml;base64," + Buffer.from("<svg/>").toString("base64");
  const uri = "data:application/json;base64," + Buffer.from(JSON.stringify({ name: "freshcuts.unica.eth", image })).toString("base64");
  assert.deepEqual(parseTokenUri(uri), { name: "freshcuts.unica.eth", image, description: null });
  assert.equal(parseTokenUri("https://example.invalid/1.json"), null);
  assert.equal(parseTokenUri("data:application/json;base64," + Buffer.from('{"image":"javascript:1"}').toString("base64")), null);
});

// ---- the readiness rule: the first unmet step, in reading order ------------------------------------

const READY = { onboardingPresent: true, connected: true, alreadyJoined: false, labelValid: true, labelChecked: true, labelTaken: false, payoutValid: true, payoutAssetChosen: true, acceptedCount: 1, registerValid: true, limitValid: true };
test("joinReadiness is ready only when every step is met", () => {
  assert.deepEqual(joinReadiness(READY), { ready: true, sentence: "Ready. Your wallet will ask you to confirm one transaction." });
});
test("joinReadiness names the missing onboarding contract before anything else", () => {
  assert.match(joinReadiness({ ...READY, onboardingPresent: false, connected: false }).sentence, /business sign-up/);
});
test("joinReadiness asks for a wallet, then refuses a second business, then the name rules", () => {
  assert.match(joinReadiness({ ...READY, connected: false }).sentence, /Connect a wallet first/);
  assert.match(joinReadiness({ ...READY, alreadyJoined: true }).sentence, /already owns a business/);
  assert.equal(joinReadiness({ ...READY, labelValid: false }).sentence, LABEL_RULE_SENTENCE);
  assert.match(joinReadiness({ ...READY, labelChecked: false }).sentence, /Checking whether/);
  assert.match(joinReadiness({ ...READY, labelTaken: true }).sentence, /already taken/);
  assert.match(joinReadiness({ ...READY, payoutValid: false }).sentence, /payout wallet/);
  assert.match(joinReadiness({ ...READY, payoutAssetChosen: false }).sentence, /asset you want to receive/);
  assert.match(joinReadiness({ ...READY, acceptedCount: 0 }).sentence, /at least one asset/);
  assert.match(joinReadiness({ ...READY, registerValid: false }).sentence, /first register/);
  assert.match(joinReadiness({ ...READY, limitValid: false }).sentence, /transaction limit must be digits/);
});
test("joinReadiness sentences never show hex or a contract word", () => {
  for (const s of Object.keys(READY).map((k) => joinReadiness({ ...READY, [k]: !READY[k] }).sentence)) {
    assert.doesNotMatch(s, /0x[0-9a-f]{4}|hook|executor|registry|calldata|hex/i, s);
  }
});

// ---- role folding ---------------------------------------------------------------------------------

const acct = (a) => "0x" + a.slice(2).padStart(64, "0");
test("foldRoleEvents keeps an account granted and not since revoked, in chain order", () => {
  const A = "0x1111111111111111111111111111111111111111";
  const B = "0x2222222222222222222222222222222222222222";
  const events = [
    { kind: "revoked", blockNumber: "0x5", logIndex: "0x0", topics: ["0x", "0x", acct(A)] },
    { kind: "granted", blockNumber: "0x2", logIndex: "0x0", topics: ["0x", "0x", acct(A)] },
    { kind: "granted", blockNumber: "0x3", logIndex: "0x1", topics: ["0x", "0x", acct(B)] },
    { kind: "granted", blockNumber: "0x6", logIndex: "0x0", topics: ["0x", "0x", acct(A)] },
  ];
  assert.deepEqual(foldRoleEvents(events).sort(), [A, B].sort());
  assert.deepEqual(foldRoleEvents(events.slice(0, 3)), [B]);
});

// ---- chain readers against a fake session ---------------------------------------------------------

function fakeSession(answers) {
  const calls = [];
  return {
    calls,
    address: OWNER,
    async call(tx) {
      calls.push({ kind: "call", tx });
      const selector = tx.data.slice(0, 10);
      const a = answers.call?.[selector];
      return typeof a === "function" ? a(tx) : a ?? "0x";
    },
    async request(method, params) {
      calls.push({ kind: method, params });
      const a = answers[method];
      return typeof a === "function" ? a(params) : a ?? [];
    },
  };
}
const ONE = "0x0000000000000000000000000000000000000000000000000000000000000001"; // bool true vector
const ZERO32 = "0x" + "0".repeat(64); // zero bytes32 vector

test("readLabelStatus: valid and free", async () => {
  const s = fakeSession({ call: { "0x25719540": ONE, "0xfbff18df": ZERO32 } });
  assert.deepEqual(await readLabelStatus(s, ZERO, "freshcuts"), { valid: true, taken: false, node: ZERO32 });
});
test("readLabelStatus: valid but taken", async () => {
  const s = fakeSession({ call: { "0x25719540": ONE, "0xfbff18df": MERCHANT_NODE } });
  const r = await readLabelStatus(s, ZERO, "freshcuts");
  assert.equal(r.taken, true);
});
test("readLabelStatus: invalid never asks nodeOf", async () => {
  const s = fakeSession({ call: { "0x25719540": ZERO32 } });
  assert.deepEqual(await readLabelStatus(s, ZERO, "Bad Name"), { valid: false, taken: false });
  assert.equal(s.calls.length, 1);
});
test("readBusinessJoined filters logs by the owner topic and returns the latest decoded record", async () => {
  const data = "0x00000000000000000000000000000000000000000000000000000000000000a000000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8ae578a6fd5e5ee92c72a07935abbaf26c95c178cb81849718943b5417192d140782b05e4c83262070602527c08c2d159cc29720f120ccd7dd0a57fbb0f72a1cf000000000000000000000000000000000000000000000000000000000000000700000000000000000000000000000000000000000000000000000000000000096672657368637574730000000000000000000000000000000000000000000000"; // cast abi-encode vector
  const s = fakeSession({ eth_getLogs: (params) => {
    assert.equal(params[0].topics[0], topicOf(BUSINESS_JOINED_SIGNATURE));
    assert.equal(params[0].topics[2], acct(OWNER));
    return [{ topics: [topicOf(BUSINESS_JOINED_SIGNATURE), MERCHANT_NODE, acct(OWNER)], data }];
  } });
  const r = await readBusinessJoined(s, ZERO, OWNER);
  assert.equal(r.label, "freshcuts");
  assert.equal(r.badgeTokenId, 7n);
});
test("readBusinessJoined returns null, not a fabricated business, when there is no log", async () => {
  assert.equal(await readBusinessJoined(fakeSession({ eth_getLogs: [] }), ZERO, OWNER), null);
});
test("listRegisters reads each register's status and its current operators", async () => {
  const subnameData = "0x000000000000000000000000000000000000000000000000000000000000004000000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8000000000000000000000000000000000000000000000000000000000000000763686169722d3100000000000000000000000000000000000000000000000000"; // cast abi-encode vector
  const activeReturn = "0x" + "0".repeat(62) + "20" + "0".repeat(62) + "06" + Buffer.from("active").toString("hex").padEnd(64, "0"); // string return vector
  const resource = textResource(CHAIR1_NODE, KEY);
  const s = fakeSession({
    call: { "0x59d1d43c": activeReturn },
    eth_getLogs: (params) => {
      const [topic0, topic1] = params[0].topics;
      if (topic0 === topicOf(SUBNAME_REGISTERED_SIGNATURE)) return [{ topics: [topic0, TERMINALS_NODE, CHAIR1_NODE], data: subnameData }];
      if (topic0 === topicOf(ROLES_GRANTED_SIGNATURE)) {
        assert.equal(topic1, resource);
        return [{ blockNumber: "0x1", logIndex: "0x0", topics: [topic0, resource, acct(OWNER)], data: "0x" }];
      }
      if (topic0 === topicOf(ROLES_REVOKED_SIGNATURE)) return [];
      throw new Error("unexpected topic");
    },
  });
  const registers = await listRegisters(s, ZERO, TERMINALS_NODE, KEY);
  assert.deepEqual(registers, [{ node: CHAIR1_NODE, label: "chair-1", status: "active", operators: [OWNER] }]);
});


test("when no fixture ever wrote the registers, listRegisters asks the companion and returns what the chain says", async () => {
  const session = { request: async () => [], call: async () => "0x" };
  const terminals = "0x" + "ae".repeat(32);
  const fetchImpl = async (url) => { assert.match(String(url), /\/local\/registers\?terminals=0x/); return { ok: true, json: async () => ({ registers: [{ node: "0x" + "78".repeat(32), label: "chair-1", status: "active" }, { node: "0x" + "01".repeat(32), label: "lost-tablet", status: "revoked" }] }) }; };
  const rows = await listRegisters(session, "0x" + "b3".repeat(20), terminals, "com.unica.terminal-status", fetchImpl);
  assert.deepEqual(rows.map((r) => [r.label, r.status, r.operators.length]), [["chair-1", "active", 0], ["lost-tablet", "revoked", 0]]);
  const refused = { request: async () => { throw new Error("range too large"); }, call: async () => "0x" };
  const none = await listRegisters(refused, "0x" + "b3".repeat(20), terminals, "com.unica.terminal-status", async () => ({ ok: false }));
  assert.deepEqual(none, []);
});
