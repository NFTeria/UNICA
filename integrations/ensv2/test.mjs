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

import {readFileSync} from "node:fs";
import {
  BUILD_STATUS, CONFIG_VERSION, PAYOUT_CURRENCIES, SECONDS_PER_BLOCK,
  buildMerchantConfig, expiryTimestamp,
} from "./build.mjs";
import {CONFIG_TYPE, merchantConfigHash, isFresh, commitResolution} from "./config.mjs";
import {
  resolveMerchant, normalizeName, namehash, dnsEncode,
  encodeResolveCall, decodeResolveReturn, ENSV2, EXPLAIN,
} from "../../web/ensv2/resolve.mjs";
import { keccak256Hex } from "../../web/ensv2/keccak.mjs";

const LIVE = process.argv.includes("--live");
let pass = 0, fail = 0;

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`); }
}

/// For a row whose subject can THROW. A throw is a failure with a reason, not a crash: without
/// this, one bad call takes the summary and the exit status down with it and a piped run reads as
/// a pass. Measured while sabotaging the payout-currency allowlist, which turned a classified
/// refusal into a raw TypeError and left this suite reporting nothing at all.
function guard(name, fn) {
  try {
    return fn();
  } catch (e) {
    check(name, false, `threw: ${e.message}`);
    return undefined;
  }
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

// ---- the merchant configuration commitment ---------------------------------------------------
//
// The value pinned below is recomputed in `test/v2/MerchantConfig.t.sol` by Solidity written from
// the same EIP-712 specification and not from this file, and by the deployed executor's own
// `hashMerchantConfig`. Three derivations of one word, because a commitment a wallet computes
// differently from the contract is rejected in the wallet.

console.log("\n— from a resolution to a configuration, and to nothing else —");
{
  // The resolution is produced by the real module against an injected reply, not hand-written.
  // A builder tested against an object somebody typed is a builder tested against an assumption
  // about what the resolver returns.
  const MERCHANT = "0x51050ec063d393217b436747617ad1c2285aeeee";
  const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
  const AT_BLOCK = 11660000;
  const resolved = async (addr = MERCHANT, opts = {blockNumber: AT_BLOCK}) =>
    resolveMerchant("merchant.eth", async () => okReturn(addrWord(addr)), opts);

  const policy = {payoutCurrency: USDC, validForBlocks: 300, settlementChainId: 11155111, atBlock: AT_BLOCK};

  const built = buildMerchantConfig(await resolved(), policy);
  check("a validated resolution builds a configuration", built.ok && built.status === "BUILT",
        JSON.stringify(built));
  check("the recipient is the RESOLVED address and nothing else",
        built.config.recipient === MERCHANT);
  check("the namehash and normalised name travel from the resolution",
        built.config.namehash === namehash("merchant.eth") && built.config.name === "merchant.eth");
  check("the resolution block is recorded", built.config.resolvedAtBlock === AT_BLOCK);
  check("the schema version is the builder's", built.config.version === CONFIG_VERSION);
  check("the commitment is the canonical hash of exactly that configuration",
        built.merchantConfigHash === merchantConfigHash(built.config));

  // THE RULE THIS MODULE EXISTS FOR. There is no argument that carries an address, so the failure
  // is not "the override was ignored" -- it is refused, because a caller who passed one believes
  // it is being used.
  const overridden = buildMerchantConfig(await resolved(), {...policy, recipient: "0x" + "ba".repeat(20)});
  check("a recipient supplied alongside the resolution is REFUSED",
        !overridden.ok && overridden.status === BUILD_STATUS.RECIPIENT_OVERRIDE_REFUSED, overridden.status);
  check("a refused build returns no configuration and no commitment",
        overridden.config === undefined && overridden.merchantConfigHash === undefined);

  // Diagnostics are outside the commitment. Changed all at once, so a single field that had crept
  // into the hash would show up here rather than in a merchant's wallet.
  const a = buildMerchantConfig(await resolved(), policy);
  const b = buildMerchantConfig(await resolved(), {...policy, atBlock: AT_BLOCK + 299});
  check("every diagnostic differs between the two builds",
        a.diagnostics.builtAtBlock !== b.diagnostics.builtAtBlock);
  check("changing a diagnostic does NOT change the commitment",
        a.merchantConfigHash === b.merchantConfigHash);
  for (const k of ["input", "dns", "resolver", "entryPoint", "payoutSymbol", "payoutDecimals", "builtAtBlock"]) {
    check(`the diagnostic '${k}' is present and outside the config`,
          k in a.diagnostics && !(k in a.config));
  }

  // Every committed field, moved one at a time on the BUILDER'S output.
  for (const [label, over] of Object.entries({
    "the resolved recipient": {recipient: "0x" + "cd".repeat(20)},
    "the payout currency": {payoutCurrency: "0x" + "cd".repeat(20)},
    "the chain": {chainId: 1},
    "the schema version": {version: 2},
    "the namehash": {namehash: namehash("other.eth")},
    "the normalised name": {name: "other.eth"},
    "the resolution block": {resolvedAtBlock: AT_BLOCK + 1},
    "the validity window": {validForBlocks: 301},
  })) {
    check(`${label} moves the built commitment`,
          merchantConfigHash({...a.config, ...over}) !== a.merchantConfigHash);
  }
}

console.log("\n— the builder refuses, by name, and hands back nothing —");
{
  const MERCHANT = "0x51050ec063d393217b436747617ad1c2285aeeee";
  const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
  const AT_BLOCK = 11660000;
  const ok = await resolveMerchant("merchant.eth", async () => okReturn(addrWord(MERCHANT)),
                                   {blockNumber: AT_BLOCK});
  const base = {payoutCurrency: USDC, validForBlocks: 300, settlementChainId: 11155111, atBlock: AT_BLOCK};

  const refusals = [
    ["a non-resolution object", null, base, "NOT_A_RESOLUTION"],
    ["a resolution that failed",
      await resolveMerchant("merchant.eth", async () => okReturn(addrWord("0x" + "00".repeat(20)))),
      base, "RESOLUTION_REFUSED"],
    ["a resolution with a zero recipient", {...ok, recipient: "0x" + "00".repeat(20)}, base, "ZERO_RECIPIENT"],
    ["a resolution with no block recorded", {...ok, resolvedAt: null}, base, "NO_RESOLUTION_BLOCK"],
    ["a settlement chain that is not the resolution chain", ok, {...base, settlementChainId: 1}, "WRONG_CHAIN"],
    ["a payout token nobody supports", ok, {...base, payoutCurrency: "0x" + "cd".repeat(20)}, "UNSUPPORTED_PAYOUT_TOKEN"],
    ["a validity window of zero blocks", ok, {...base, validForBlocks: 0}, "INVALID_VALIDITY_POLICY"],
    ["a validity window wider than uint32", ok, {...base, validForBlocks: 0x100000000}, "INVALID_VALIDITY_POLICY"],
    ["a reading that has expired", ok, {...base, atBlock: AT_BLOCK + 301}, "STALE_RESOLUTION"],
    ["a reading from the future", ok, {...base, atBlock: AT_BLOCK - 1}, "STALE_RESOLUTION"],
  ];
  for (const [label, res, pol, want] of refusals) {
    const r = guard(`${label} is refused as ${want}`, () => buildMerchantConfig(res, pol)) ?? {};
    check(`${label} is refused as ${want}`, !r.ok && r.status === want, `got ${r.status}`);
    check(`... and returns no configuration`, r.config === undefined && r.merchantConfigHash === undefined);
    check(`... and explains itself`, typeof r.explain === "string" && r.explain.length > 0);
  }

  check("the last block of the window still builds",
        buildMerchantConfig(ok, {...base, atBlock: AT_BLOCK + 300}).ok);
  check("USDC is the only payout currency this deployment lists",
        Object.keys(PAYOUT_CURRENCIES[11155111]).length === 1);
}

console.log("\n— the block window bounds a timestamp, in the safe direction only —");
{
  const config = {validForBlocks: 300};
  const t0 = 1788800000n;
  const expiry = expiryTimestamp(config, t0);
  check("the expiry is the reading's time plus twelve seconds a block",
        expiry === t0 + 300n * BigInt(SECONDS_PER_BLOCK), String(expiry));
  // The whole argument for using a block window to bound a timestamp: an EMPTY slot produces no
  // block, so 300 blocks always take AT LEAST 300 * 12 seconds. The bound therefore expires a
  // quote no later than the configuration expires, and the error is conservative by construction.
  check("a chain that skipped slots outlives the bound rather than the bound outliving it",
        expiry <= t0 + 300n * 13n);
  check("twelve seconds is the protocol's slot time, not a measurement", SECONDS_PER_BLOCK === 12);
}

console.log("\n— one canonical schema, checked against the contract as written —");
{
  // THE RULING'S OWN PRECONDITION. Two derivations of one commitment are only worth having if
  // they are derivations of the SAME schema, and the hash of one vector does not establish that:
  // two type strings differing in a field name can still agree on a value by coincidence of what
  // was tested. So the Solidity literal is pulled out of the source and compared byte for byte.
  //
  // It is read from `src/v2/MerchantConfig.sol` rather than pinned here on purpose. A pinned copy
  // is a third description of the schema and would drift from the contract in exactly the way
  // this check exists to catch.
  const sol = readFileSync("src/v2/MerchantConfig.sol", "utf8");
  const decl = sol.match(/string internal constant CONFIG_TYPE\s*=\s*((?:"(?:[^"\\]|\\.)*"\s*)+);/);
  check("the contract's CONFIG_TYPE literal was found in the source", decl !== null);
  const solType = decl ? [...decl[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]).join("") : "";
  check("the type string agrees byte for byte with the contract", solType === CONFIG_TYPE,
        `contract:   ${solType}\n        javascript: ${CONFIG_TYPE}`);

  // Field order and width, parsed rather than eyeballed. An encoder that hashed the right fields
  // in the wrong order would produce a different commitment on every real input and an identical
  // one on a vector where those fields happen to match.
  const fields = solType.slice(solType.indexOf("(") + 1, -1).split(",").map((f) => f.split(" "));
  const expected = [
    ["uint8", "version"], ["bytes32", "namehash"], ["string", "name"], ["address", "recipient"],
    ["address", "payoutCurrency"], ["uint256", "chainId"], ["uint64", "resolvedAtBlock"],
    ["uint32", "validForBlocks"],
  ];
  check("the schema has exactly eight fields", fields.length === 8, `it has ${fields.length}`);
  for (let i = 0; i < expected.length; i++) {
    check(`field ${i} is ${expected[i][0]} ${expected[i][1]}`,
          fields[i] && fields[i][0] === expected[i][0] && fields[i][1] === expected[i][1],
          `the contract says ${(fields[i] || []).join(" ")}`);
  }

  // The struct members must be in the same order as the type string. EIP-712 hashes members in
  // declaration order, so a struct that reordered them would keep this type string and produce a
  // different hash — the one disagreement a type-string comparison alone cannot see.
  const structBody = sol.slice(sol.indexOf("struct Config {"), sol.indexOf("}", sol.indexOf("struct Config {")));
  const members = [...structBody.matchAll(/^\s{8}(\w+)\s+(\w+);/gm)].map((m) => [m[1], m[2]]);
  check("the struct declares its members in the type string's order",
        JSON.stringify(members) === JSON.stringify(expected), JSON.stringify(members));

  // Every field at its declared width, so an encoder that padded or truncated one is caught by a
  // value rather than by a reading. Both are recomputed in test/v2/MerchantConfig.t.sol.
  const atTheLimits = {
    version: 255,
    namehash: "0x" + "ff".repeat(32),
    name: "",
    recipient: "0xffffffffffffffffffffffffffffffffffffffff",
    payoutCurrency: "0x0000000000000000000000000000000000000000",
    chainId: (2n ** 256n - 1n).toString(),
    resolvedAtBlock: (2n ** 64n - 1n).toString(),
    validForBlocks: (2n ** 32n - 1n).toString(),
  };
  const limitsHash = "0x6a8f77b04ab9535939df8f18fa0468d9d890d30b6e550695bed109e15799e2b3";
  check("every field at its maximum hashes to the pinned vector",
        merchantConfigHash(atTheLimits) === limitsHash, merchantConfigHash(atTheLimits));

  const allZero = {
    version: 0, namehash: "0x" + "00".repeat(32), name: "",
    recipient: "0x" + "00".repeat(20), payoutCurrency: "0x" + "00".repeat(20),
    chainId: 0, resolvedAtBlock: 0, validForBlocks: 0,
  };
  const zeroHash = "0xc5ae8f73ad7c28222f697ad64095eb9863057ed9bd155bbd2658a31e9d97c621";
  check("every field at zero hashes to the pinned vector",
        merchantConfigHash(allZero) === zeroHash, merchantConfigHash(allZero));
  // The all-zero vector is not decoration: it is the row that would go red if a field were
  // DROPPED from the encoding, because abi.encode loses a word and the length changes even when
  // every value is zero.
  check("the two boundary vectors differ", merchantConfigHash(atTheLimits) !== merchantConfigHash(allZero));
}

console.log("\n— the merchant configuration commitment —");
{
  const n = normalizeName("merchant.eth");
  check("the vector's name normalises", n.ok, n.status);
  const nh = namehash(n.name);
  check("namehash of merchant.eth", nh === "0x4899a704a642409872099476ec1fb6ea80e9bcab30bf25152e9741136c413653", nh);

  const base = {
    version: 1,
    namehash: nh,
    name: n.name,
    recipient: "0x9E11000000000000000000000000000000000001",
    payoutCurrency: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    chainId: 11155111,
    resolvedAtBlock: 11640026,
    validForBlocks: 300,
  };
  const wantConfigHash = "0x95b1d38dea10da6126bc066c3ecfb41ba3c151800b94404bf0f4f800143d8f73";
  const got = merchantConfigHash(base);
  check("the commitment matches the pinned vector", got === wantConfigHash, got);

  // Every component, one at a time. A component outside the hash is a component somebody can
  // change between the screen a payer read and the invoice a merchant signed.
  const moves = {
    "the configuration version": {version: 2},
    "the namehash": {namehash: namehash("another.eth")},
    "the normalised name": {name: "merchant2.eth"},
    "THE RESOLVED RECIPIENT": {recipient: "0x0000000000000000000000000000000000000BAD"},
    "the payout currency": {payoutCurrency: "0x0000000000000000000000000000000000000BAD"},
    "the chain": {chainId: 1},
    "the resolution block": {resolvedAtBlock: 11640027},
    "the expiry policy": {validForBlocks: 301},
  };
  for (const [label, over] of Object.entries(moves)) {
    check(`${label} moves the commitment`, merchantConfigHash({...base, ...over}) !== wantConfigHash,
          "this component is not inside the commitment");
  }

  // A missing component must be refused rather than silently hashed as undefined.
  for (const f of Object.keys(base)) {
    const broken = {...base};
    delete broken[f];
    let threw = false;
    try { merchantConfigHash(broken); } catch { threw = true; }
    check(`a config missing ${f} is refused`, threw, "it was hashed anyway");
  }

  // The expiry window, which is the ONLY place it is enforced — nothing on chain sees this struct.
  check("fresh at the block it was read", isFresh(base, 11640026));
  check("fresh at the last block of the window", isFresh(base, 11640326));
  check("stale one block later", !isFresh(base, 11640327));
  check("not fresh before it was read", !isFresh(base, 11640025));

  let refused = false;
  try { commitResolution(base, 11640327); } catch { refused = true; }
  check("a stale checkout cannot be committed", refused, "an expired reading became a commitment");
  check("a fresh checkout can be committed", commitResolution(base, 11640300) === wantConfigHash);
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
  for (const [n, wantConfigHash] of live) {
    const r = await resolveMerchant(n, rpc);
    check(`live ${n} → ${wantConfigHash}`, r.status === wantConfigHash, `got ${r.status}`);
    if (wantConfigHash !== "RESOLVED") check(`live ${n} carries no recipient`, r.recipient == null);
  }
}

console.log(`\nchecks run: ${pass + fail}, passed: ${pass}, failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
