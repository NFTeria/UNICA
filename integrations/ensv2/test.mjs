// Tests for the ENSv2 merchant resolution module.
//
//   node integrations/ensv2/test.mjs           offline only — deterministic, no network, CI-safe
//   node integrations/ensv2/test.mjs --live    additionally resolves real names on Sepolia
//
// The offline rows inject a fake rpcCall, which is why the module takes one: every failure shape
// can be reproduced exactly, including the ones a live network will not produce on demand. The
// live rows exist because a mock proves the module handles a shape, never that the shape is real.
//
// Every negative row asserts the same four things, because they are what "fail closed" means
// here: the status is the intended one, no recipient is carried, `ok` is false, and the message
// shown to a payer is not blank.

import {
  resolveMerchant, normalizeName, namehash, dnsEncode,
  encodeResolveCall, decodeResolveReturn, ENSV2, EXPLAIN,
} from "./resolve.mjs";
import { keccak256Hex } from "./keccak.mjs";

const LIVE = process.argv.includes("--live");
let pass = 0, fail = 0;

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`); }
}

/** Every refusal must look the same from outside: classified, empty-handed, and explained. */
async function refuses(label, input, want, rpc, opts) {
  const r = await resolveMerchant(input, rpc ?? (async () => { throw new Error("must not be called"); }), opts);
  const good = r.status === want && r.ok === false && r.recipient == null && !!EXPLAIN[r.status];
  check(label, good, `status=${r.status} want=${want} ok=${r.ok} recipient=${r.recipient} explained=${!!EXPLAIN[r.status]}`);
  return r;
}

const word = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
const addrWord = (a) => word(a.replace(/^0x/, ""));
/** A well-formed (bytes result, address resolver) return carrying `inner`. */
const okReturn = (inner, resolver = "0x00000000000000000000000000000000000000aa") => {
  const body = inner.replace(/^0x/, "");
  return "0x" + word("40") + addrWord(resolver) + word((body.length / 2).toString(16)) +
    body.padEnd(Math.max(64, Math.ceil(body.length / 64) * 64), "0");
};
const reverts = (selector) => async () => { const e = new Error("execution reverted"); e.data = selector + "00".repeat(32); throw e; };

console.log("— input validation, no network reached —");
await refuses("empty input is refused", "", "EMPTY_NAME");
await refuses("whitespace only is refused", "   ", "EMPTY_NAME");
await refuses("a bare label is refused", "notaname", "MALFORMED_NAME");
await refuses("a trailing dot is refused", "merchant.", "MALFORMED_NAME");
await refuses("a double dot is refused", "a..eth", "MALFORMED_NAME");
await refuses("a hyphen-edged label is refused", "-bad.eth", "MALFORMED_NAME");
await refuses("a non-ASCII name is refused, not approximated", "mérchant.eth", "NON_ASCII_NAME");
await refuses("a Cyrillic lookalike is refused", "rаffy.eth", "NON_ASCII_NAME");
await refuses("the wrong chain is refused before any call", "raffy.eth", "WRONG_CHAIN", null, { chainId: 1 });

console.log("\n— revert shapes —");
await refuses("ResolverNotFound is classified", "a.eth", "RESOLVER_NOT_FOUND", reverts("0x77209fe8"));
await refuses("ResolverNotContract is classified", "a.eth", "RESOLVER_NOT_CONTRACT", reverts("0x1e9535f2"));
await refuses("UnsupportedResolverProfile is classified", "a.eth", "UNSUPPORTED_PROFILE", reverts("0x7b1c461b"));
await refuses("OffchainLookup fails closed, it is not followed", "a.eth", "OFFCHAIN_LOOKUP", reverts("0x556f1830"));
await refuses("an unknown revert is an RPC failure, not a resolution", "a.eth", "RPC_FAILURE", reverts("0xdeadbeef"));
await refuses("a network error is an RPC failure", "a.eth", "RPC_FAILURE", async () => { throw new Error("fetch failed"); });

console.log("\n— success-shaped returns that must still be refused —");
await refuses("the zero address is refused", "a.eth", "ZERO_ADDRESS",
  async () => okReturn(addrWord("0x0000000000000000000000000000000000000000")));
await refuses("an empty result is refused", "a.eth", "MALFORMED_INNER_RESULT", async () => okReturn(""));
await refuses("a short result is refused", "a.eth", "MALFORMED_INNER_RESULT", async () => okReturn("aabbcc"));
await refuses("a result with dirty high bytes is refused", "a.eth", "WRONG_LENGTH_ADDRESS",
  async () => okReturn("ff".repeat(12) + "11".repeat(20)));
await refuses("an undecodable outer return is refused", "a.eth", "MALFORMED_OUTER_RETURN", async () => "0x1234");
await refuses("an empty RPC result is refused", "a.eth", "MALFORMED_OUTER_RETURN", async () => "0x");

console.log("\n— the success path —");
{
  const want = "0x51050ec063d393217b436747617ad1c2285aeeee";
  const r = await resolveMerchant("merchant.eth", async () => okReturn(addrWord(want)));
  check("a real address resolves", r.ok === true && r.status === "RESOLVED" && r.recipient === want, JSON.stringify(r));
  check("the resolved name is normalised", r.name === "merchant.eth");
  check("case is normalised", (await resolveMerchant("MERCHANT.eth", async () => okReturn(addrWord(want)))).name === "merchant.eth");
  check("the namehash travels with the answer", r.namehash === namehash("merchant.eth"));
}

console.log("\n— encoding controls —");
check("namehash('eth') is the canonical value",
  namehash("eth") === "0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae");
// Multi-label values pinned as literals, each derived with an INDEPENDENT implementation
// (`cast keccak`, folding right to left) rather than with this module. A single-label control
// cannot catch a folding-order defect, because reversing one label is a no-op — a sabotage run
// that flipped the fold left this suite green until these rows existed.
for (const [n, want] of [
  ["raffy.eth", "0x9c8b7ac505c9f0161bbbd04437fce8c630a0886e1ffea00078e298f063a8a5df"], // namehash
  ["ens.eth",   "0x4e34d3a81dc3a20f71bbdf2160492ddaa17ee7e5523757d47153379c13cb46df"], // namehash
  ["unica.eth", "0xa1666e95e38a3be2115a9a801792914ca6dca4fa6297d21e835f284254337537"], // namehash
]) check(`namehash('${n}') matches an independently derived value`, namehash(n) === want, `got ${namehash(n)}`);
check("label order matters: a.b.eth and b.a.eth differ",
  namehash("a.b.eth") !== namehash("b.a.eth"));
check("distinct names give distinct namehashes",
  new Set(["raffy.eth", "ens.eth", "unica.eth", "merchant.eth"].map(namehash)).size === 4);
check("DNS wire encoding matches the worked example",
  dnsEncode("raffy.eth") === "0x0572616666790365746800");
check("keccak256('') is the published empty-string value",
  keccak256Hex(new Uint8Array()) === "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
check("the call carries the addr selector and the computed node",
  encodeResolveCall(dnsEncode("raffy.eth"), ENSV2.sel.addr + namehash("raffy.eth").slice(2))
    .includes(namehash("raffy.eth").slice(2)));
check("a well-formed return decodes to its address and resolver", (() => {
  const d = decodeResolveReturn(okReturn(addrWord("0x00000000000000000000000000000000000000bb"), "0x00000000000000000000000000000000000000cc"));
  return d && d.resolver.endsWith("cc") && d.result.endsWith("bb");
})());

console.log("\n— no fallback, ever —");
{
  const shapes = [
    ["", null], ["notaname", null], ["mérchant.eth", null],
    ["a.eth", reverts("0x77209fe8")], ["a.eth", reverts("0x556f1830")],
    ["a.eth", async () => okReturn(addrWord("0x0000000000000000000000000000000000000000"))],
    ["a.eth", async () => "0x1234"], ["a.eth", async () => { throw new Error("down"); }],
  ];
  let clean = true;
  for (const [n, rpc] of shapes) {
    const r = await resolveMerchant(n, rpc ?? (async () => { throw new Error("x"); }));
    if (r.ok !== false || r.recipient != null) clean = false;
    const s = JSON.stringify(r);
    if (/0x[0-9a-fA-F]{40}/.test(s.replace(ENSV2.entryPoint, "").replace(/0x0{40}/g, ""))) {
      // a resolver address may legitimately appear; a *recipient* may not
      if (r.recipient != null) clean = false;
    }
  }
  check(`no failure shape carries a recipient (${shapes.length} shapes)`, clean);
}

if (LIVE) {
  console.log("\n— live, against ENSv2 on Sepolia —");
  const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
  const rpc = async (to, data) => {
    const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }) });
    const j = await res.json();
    if (j.error) { const e = new Error(j.error.message); e.data = j.error.data; throw e; }
    return j.result;
  };
  const live = [
    ["raffy.eth", "RESOLVED"],
    ["nonexistent-sub-7f31.raffy.eth", "ZERO_ADDRESS"],
    ["ens.eth", "ZERO_ADDRESS"],
    ["premm.eth", "RESOLVER_NOT_FOUND"],
  ];
  for (const [n, want] of live) {
    const r = await resolveMerchant(n, rpc);
    check(`live ${n} → ${want}`, r.status === want, `got ${r.status}`);
    if (want !== "RESOLVED") check(`live ${n} carries no recipient`, r.recipient == null);
  }
}

console.log(`\nchecks run: ${pass + fail}, passed: ${pass}, failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
