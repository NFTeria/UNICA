// Live re-read of the ENSv2 deployment profile against Sepolia.
//
//   node script/ensv2/profile-live.mjs [rpc-url]
//
// `script/ensv2/profile-check.mjs` proves the profile is internally consistent. It cannot prove the
// profile still describes the chain, because ENS can redeploy and every number in the pin would go
// stale silently. This runner is the other half: it re-reads the code sizes and runtime code
// hashes, re-asks the contracts for their own constants, and re-runs the four probes that the
// interesting claims rest on — the two resource derivations, the admin-role rule, and wildcard
// resolution.
//
// IT IS READ-ONLY AND IT CANNOT BE OTHERWISE. Every call is `eth_call` or `eth_getCode`. Nothing
// here signs, nothing broadcasts, and no key or keystore path is read. The simulated writes are
// simulated: they run at the node and are discarded.
//
// FAILS CLOSED ON THE WRONG CHAIN, before anything else. A run against another chain would print a
// page of confident numbers about contracts that are not these ones, and there is no honest way to
// notice that from the output afterwards.
//
// THE ENDPOINT IS PRINTED REDACTED. Only the origin, through `redactRpc` — a provider URL carries
// its key in the path or the query, this repository is public, and the failure path is the one
// whose output gets pasted into a bug report.
//
// A SKIP IS A SKIP. Anything that could not be observed prints as a SKIP with its reason and is
// counted apart from the passes. Nothing here rounds a missing observation up to a pass.

import {toHex, keccak256} from "../../web/ensv2/keccak.mjs";
import {utf8, wordAddress, wordUint} from "../../integrations/permit2/digest.mjs";
import {dnsEncode, encodeResolveCall, decodeResolveReturn, namehash, ENSV2} from "../../web/ensv2/resolve.mjs";
import {
  decodeRevert, encodeAddrCall, redactRpc, selectorFor, unauthorizedProbeAddress,
} from "../../integrations/ensv2/permissioned.mjs";
import * as P from "../../integrations/ensv2/profile.mjs";

const RPC = process.argv.slice(2).find((a) => a.startsWith("http")) ||
  process.env.SEPOLIA_TESTNET_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

// A run makes on the order of forty sequential requests, and endpoints drop bodies under that.
// MEASURED on 2026-09-09 against a keyed provider: seven of the first run's reads came back with a
// zero-byte body while the rest of the same run succeeded, and every one of them succeeded on a
// later attempt. So transport is retried a bounded number of times, and a transport failure that
// survives the retries is reported as a SKIP — never as a contract failure, and never as a pass.
const RETRIES = 4;
const BACKOFF_MS = 250;
class TransportError extends Error {}

let calls = 0, retried = 0;
async function rpcOnce(method, params) {
  calls++;
  let res;
  try {
    res = await fetch(RPC, {
      method: "POST", headers: {"content-type": "application/json"},
      body: JSON.stringify({jsonrpc: "2.0", id: calls, method, params}),
    });
  } catch (e) {
    throw new TransportError(`the endpoint could not be reached — ${e?.message ?? e}`);
  }
  const text = await res.text();
  let j;
  // A truncated body parsed as JSON throws a SyntaxError that reads like a bug in this file. It is
  // the endpoint, and it is named as the endpoint.
  try { j = JSON.parse(text); } catch {
    throw new TransportError(
      `HTTP ${res.status}, body is not JSON (${text.length} bytes) — transport, not contract`);
  }
  // A JSON-RPC error IS the contract answering (a revert arrives this way), so it is never retried.
  if (j.error) { const e = new Error(j.error.message); e.data = j.error.data; throw e; }
  return j.result;
}

async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try { return await rpcOnce(method, params); } catch (e) {
      if (!(e instanceof TransportError)) throw e;
      last = e;
      if (attempt < RETRIES) { retried++; await new Promise((r) => setTimeout(r, BACKOFF_MS * (attempt + 1))); }
    }
  }
  throw last;
}

const chain = {
  chainId: async () => Number(await rpc("eth_chainId", [])),
  call: (to, data, from) => rpc("eth_call", [from ? {to, data, from} : {to, data}, "latest"]),
  getCode: (a) => rpc("eth_getCode", [a, "latest"]),
};

let pass = 0, fail = 0, skip = 0;
const ok = (n, cond, detail) => {
  if (cond) { pass++; console.log(`PASS  ${n}`); }
  else { fail++; console.log(`FAIL  ${n}${detail ? `\n      ${detail}` : ""}`); }
};
const skipped = (n, why) => { skip++; console.log(`SKIP  ${n}: ${why} (this is a SKIP, not a pass)`); };

const hexBody = (h) => String(h ?? "").replace(/^0x/, "").toLowerCase();
const w = (b) => hexBody(toHex(b));
const word = (hex, i) => hexBody(hex).slice(i * 64, (i + 1) * 64);

/// Classify a simulated call into ACCEPTED / REFUSED / TRANSPORT. An accepted setter and a missing
/// dispatch arm both look like `0x`, so ACCEPTED is only ever reported next to a matching REFUSED
/// row of the same shape — the pair is the evidence, never one half of it.
async function simulate(to, data, from) {
  try {
    const raw = await chain.call(to, data, from);
    return {outcome: "ACCEPTED", raw};
  } catch (e) {
    const d = (e && e.data) || (e && e.error && e.error.data) || "";
    if (typeof d === "string" && d.length >= 10) return {outcome: "REFUSED", raw: d, decoded: decodeRevert(d)};
    return {outcome: "TRANSPORT", detail: e?.message ?? String(e)};
  }
}

// ── fail closed ───────────────────────────────────────────────────────────────────────────────

let observedChain;
try {
  observedChain = await chain.chainId();
} catch (e) {
  console.error(`refusing: could not reach ${redactRpc(RPC)} — ${e.message}`);
  console.log("\nchecks run: 1, passed: 0, failed: 1, skipped: 0");
  process.exit(1);
}
if (observedChain !== P.CHAIN_ID) {
  console.error(`refusing: this endpoint reports chain ${observedChain}; the profile pins ${P.CHAIN_ID}`);
  console.log("\nchecks run: 1, passed: 0, failed: 1, skipped: 0");
  process.exit(1);
}
const head = Number(await rpc("eth_blockNumber", []));

console.log("ENSv2 deployment profile — live re-read");
console.log(`chain ${observedChain} (${P.CHAIN_NAME})`);
console.log(`rpc   ${redactRpc(RPC)}`);
console.log(`block ${head}  (profile pinned at ${P.PIN_BLOCK}, retrieved ${P.RETRIEVED})`);
console.log(`docs  ${P.SOURCES.deployments}\n`);

// ── 1. the deployment, byte for byte ──────────────────────────────────────────────────────────

console.log("— every pinned address, its code size and its runtime code hash —");
for (const row of await P.verifyProfile(chain)) {
  if (row.transport) { skipped(`${row.name}: ${row.expected}`, String(row.actual)); continue; }
  ok(`${row.name}: ${row.expected}`, row.ok, `chain says ${row.actual}`);
}

// ── 2. the contracts' own constants ───────────────────────────────────────────────────────────

console.log("\n— ROOT_RESOURCE, asked of each contract rather than assumed —");
const registry = P.byName("ETHRegistry").address;
const resolverImpl = P.byName("PermissionedResolverImpl").address;
for (const [label, addr] of [["ETHRegistry", registry], ["PermissionedResolverImpl", resolverImpl]]) {
  const r = await simulate(addr, selectorFor(P.REGISTRY_SIGNATURES.rootResource), undefined);
  if (r.outcome === "ACCEPTED" && r.raw && r.raw !== "0x") {
    ok(`${label}.ROOT_RESOURCE() == ${P.ROOT_RESOURCE}`, BigInt(r.raw) === P.ROOT_RESOURCE, `returned ${r.raw}`);
  } else {
    skipped(`${label}.ROOT_RESOURCE()`, r.outcome === "ACCEPTED" ? "empty return" : (r.detail ?? r.outcome));
  }
}

// ── 3. the registry resource derivation, from a refusal ───────────────────────────────────────

console.log("\n— the registry's resource: derived here, then named back by the contract —");
const sample = P.EVIDENCE_SAMPLE;
const probeAddr = unauthorizedProbeAddress();
const derivedRegistryResource = P.registryResource(sample.label, 0n);
ok(`the derived registry resource matches the pin (${derivedRegistryResource})`,
   derivedRegistryResource === sample.registryResource, `pinned ${sample.registryResource}`);

// getResource() is the contract stating its own answer, which is the cleanest confirmation there is.
const getResource = await simulate(
  registry, selectorFor(P.REGISTRY_SIGNATURES.getResource) + w(wordUint(BigInt(derivedRegistryResource))), undefined);
if (getResource.outcome === "ACCEPTED" && getResource.raw !== "0x") {
  ok("ETHRegistry.getResource(tokenId) returns the same word this file derives",
     "0x" + word(getResource.raw, 0) === derivedRegistryResource.toLowerCase(),
     `contract returned 0x${word(getResource.raw, 0)}`);
} else {
  skipped("ETHRegistry.getResource(tokenId)", getResource.detail ?? getResource.outcome);
}

const setResolverRefusal = await simulate(
  registry,
  selectorFor(P.REGISTRY_SIGNATURES.setResolver) + w(wordUint(BigInt(derivedRegistryResource))) +
    w(wordAddress("0x000000000000000000000000000000000000dEaD")),
  probeAddr,
);
if (setResolverRefusal.outcome === "REFUSED") {
  const d = setResolverRefusal.decoded;
  ok("an unauthorised setResolver is refused with EACUnauthorizedAccountRoles",
     d.selector === P.ERROR_SELECTOR_OBSERVED.EACUnauthorizedAccountRoles, `selector ${d.selector}`);
  ok("   … and the refusal names the derived registry resource",
     String(d.resource).toLowerCase() === derivedRegistryResource.toLowerCase(),
     `contract named ${d.resource}, this file derives ${derivedRegistryResource}`);
  ok(`   … and it names ROLE_SET_RESOLVER (1<<24)`,
     d.roleBitmap === P.REGISTRY_ROLE.SET_RESOLVER.bit, `contract named 0x${(d.roleBitmap ?? 0n).toString(16)}`);
} else if (setResolverRefusal.outcome === "TRANSPORT") {
  skipped("an unauthorised setResolver is refused", setResolverRefusal.detail);
} else {
  // An ACCEPTED here would mean the probe address is authorised, which would make every "refused"
  // row in this survey meaningless. It is a FAIL, never a skip.
  ok("an unauthorised setResolver is refused", false,
     "outcome was ACCEPTED — the unauthorized probe address may no longer be unauthorised");
}

// ── 4. the resolver resource derivation, from a refusal ───────────────────────────────────────

console.log("\n— the resolver's resource: the docs imply a finer one, the chain names the name-level one —");
const node = namehash(sample.name);
const derivedResolverResource = P.resolverNameResource(node);
ok(`the derived resolver resource matches the pin (${derivedResolverResource})`,
   derivedResolverResource === sample.resolverNameResource, `pinned ${sample.resolverNameResource}`);

const getResolver = await simulate(
  registry, selectorFor(P.REGISTRY_SIGNATURES.getResolver) + w(wordUint(0x20)) +
    w(wordUint(sample.label.length)) + hexBody(toHex(utf8(sample.label))).padEnd(64, "0"), undefined);
let liveResolver = null;
if (getResolver.outcome === "ACCEPTED" && getResolver.raw !== "0x") {
  liveResolver = "0x" + word(getResolver.raw, 0).slice(24);
}
if (!liveResolver || /^0x0+$/.test(liveResolver)) {
  skipped("the resolver-side probes", `ETHRegistry.getResolver('${sample.label}') returned no resolver`);
} else {
  ok(`ETHRegistry.getResolver('${sample.label}') still points at the sampled proxy`,
     liveResolver.toLowerCase() === sample.resolverProxy.toLowerCase(),
     `chain says ${liveResolver}, profile sampled ${sample.resolverProxy}`);

  // setText is the interesting one: the documentation leads you to expect a per-key resource here.
  const setTextData = (() => {
    const k = hexBody(toHex(utf8("url"))), v = hexBody(toHex(utf8("https://example.invalid")));
    const kTail = w(wordUint(k.length / 2)) + k.padEnd(64, "0");
    return selectorFor("setText(bytes32,string,string)") + hexBody(node) + w(wordUint(0x60)) +
      w(wordUint(0x60 + kTail.length / 2)) + kTail + w(wordUint(v.length / 2)) + v.padEnd(64, "0");
  })();
  for (const [label, data, expectRole] of [
    ["setAddr(bytes32,address)",
      selectorFor("setAddr(bytes32,address)") + hexBody(node) + w(wordAddress("0x000000000000000000000000000000000000dEaD")),
      P.RESOLVER_ROLE.SET_ADDR.bit],
    ["setText(bytes32,string,string)", setTextData, P.RESOLVER_ROLE.SET_TEXT.bit],
  ]) {
    const r = await simulate(liveResolver, data, probeAddr);
    // TRANSPORT and ACCEPTED are different failures and must not share a line. TRANSPORT means the
    // endpoint did not answer, which proves nothing either way. ACCEPTED means the resolver let an
    // unauthorised write through, which would be the story rather than a failing test row.
    if (r.outcome === "TRANSPORT") { skipped(`an unauthorised ${label}`, r.detail); continue; }
    if (r.outcome !== "REFUSED") {
      ok(`an unauthorised ${label} is refused`, false,
         `outcome was ACCEPTED — a resolver that accepts an unauthorised write is the story, not this test`);
      continue;
    }
    const d = r.decoded;
    ok(`${label} is refused, and the refusal names the NAME-LEVEL resource, not a finer one`,
       String(d.resource).toLowerCase() === derivedResolverResource.toLowerCase(),
       `contract named ${d.resource}, name-level is ${derivedResolverResource}`);
    ok(`   … and it names the expected role bitmap 0x${expectRole.toString(16)}`,
       d.roleBitmap === expectRole, `contract named 0x${(d.roleBitmap ?? 0n).toString(16)}`);
  }

  // roles() vs hasRoles(): the read that is safe-looking and wrong, re-proved each run.
  const owner = sample.owner;
  const rolesAtName = await simulate(
    liveResolver, selectorFor("roles(uint256,address)") + w(wordUint(BigInt(derivedResolverResource))) + w(wordAddress(owner)), undefined);
  const hasAtName = await simulate(
    liveResolver, selectorFor("hasRoles(uint256,uint256,address)") + w(wordUint(BigInt(derivedResolverResource))) +
      w(wordUint(P.RESOLVER_ROLE.SET_ADDR.bit)) + w(wordAddress(owner)), undefined);
  if (rolesAtName.outcome === "ACCEPTED" && hasAtName.outcome === "ACCEPTED" &&
      rolesAtName.raw !== "0x" && hasAtName.raw !== "0x") {
    const rolesWord = BigInt(rolesAtName.raw), hasWord = BigInt(hasAtName.raw);
    ok("roles(nameResource, owner) is 0 while hasRoles(nameResource, SET_ADDR, owner) is true — " +
       "the two reads do not answer the same question",
       rolesWord === 0n && hasWord === 1n,
       `roles=0x${rolesWord.toString(16)}, hasRoles=${hasWord} — if these now agree, the ROOT_RESOURCE grant moved`);
  } else {
    skipped("the roles() vs hasRoles() contrast", "one of the two reads did not return");
  }

  // getAssigneeCount's two words, and the claim about the second one.
  const gac = await simulate(
    liveResolver, selectorFor("getAssigneeCount(uint256,uint256)") + w(wordUint(0)) + w(wordUint(1n << 4n)), undefined);
  if (gac.outcome === "ACCEPTED" && hexBody(gac.raw).length >= 128) {
    const maxima = P.unpackAssigneeWord("0x" + word(gac.raw, 1), 1n << 4n);
    ok(`getAssigneeCount returns TWO words and the second is the per-role maximum ${P.MAX_ASSIGNEES_PER_ROLE} at nybble 1`,
       maxima.length === 1 && maxima[0].nybble === 1 && BigInt(maxima[0].count) === P.MAX_ASSIGNEES_PER_ROLE,
       `second word 0x${word(gac.raw, 1)}`);
  } else {
    skipped("getAssigneeCount's second word", gac.outcome === "ACCEPTED" ? "fewer than two words returned" : gac.outcome);
  }
}

// ── 5. the admin-role rule, control and row together ──────────────────────────────────────────

console.log("\n— admin roles on a name: settable at registration, never after —");
const ownerOfSample = sample.owner;
const grant = (resource, bitmap, from) => simulate(
  registry,
  selectorFor("grantRoles(uint256,uint256,address)") + w(wordUint(BigInt(resource))) + w(wordUint(bitmap)) +
    w(wordAddress("0x000000000000000000000000000000000000dEaD")),
  from,
);
const controlRegular = await grant(derivedRegistryResource, P.REGISTRY_ROLE.SET_RESOLVER.bit, ownerOfSample);
const rowAdmin = await grant(derivedRegistryResource, P.adminRole(P.REGISTRY_ROLE.SET_RESOLVER.bit), ownerOfSample);
const controlUnauth = await grant(derivedRegistryResource, P.REGISTRY_ROLE.SET_RESOLVER.bit, probeAddr);

// The three rows are one argument and are reported as one: if any leg could not be observed, the
// other two are not evidence of the rule, so the whole thing is skipped rather than half-claimed.
const legs = [controlRegular, rowAdmin, controlUnauth];
if (legs.some((l) => l.outcome === "TRANSPORT")) {
  skipped("the admin-role rule (all three rows)",
          legs.find((l) => l.outcome === "TRANSPORT").detail + " — a control that did not run cannot support the row");
} else {
  ok("CONTROL — the name owner MAY grant the regular role after registration",
     controlRegular.outcome === "ACCEPTED", `outcome ${controlRegular.outcome}`);
  ok("CONTROL — an unauthorised account MAY NOT, so the accepted row above is not an artefact",
     controlUnauth.outcome === "REFUSED" &&
       controlUnauth.decoded?.selector === P.ERROR_SELECTOR_OBSERVED.EACCannotGrantRoles,
     `outcome ${controlUnauth.outcome} ${controlUnauth.decoded?.selector ?? ""}`);
  ok("ROW — the same owner MAY NOT grant the ADMIN role after registration (EACCannotGrantRoles)",
     rowAdmin.outcome === "REFUSED" &&
       rowAdmin.decoded?.selector === P.ERROR_SELECTOR_OBSERVED.EACCannotGrantRoles,
     `outcome ${rowAdmin.outcome} ${rowAdmin.decoded?.selector ?? ""}`);
}

// ── 6. wildcard resolution, and the failure shape that does not revert ────────────────────────

console.log("\n— wildcard resolution: a resolve that succeeds is not evidence a name exists —");
const entry = P.byName("UpgradableUniversalResolverProxy").address;
for (const row of P.WILDCARD.rows) {
  const n = row.name;
  const r = await simulate(entry, encodeResolveCall(dnsEncode(n), encodeAddrCall(namehash(n))), undefined);
  if (r.outcome === "TRANSPORT") { skipped(`wildcard row ${n}`, r.detail); continue; }
  if (r.outcome === "REFUSED") {
    const isNotFound = r.decoded?.selector === P.ERROR_SELECTOR_OBSERVED.ResolverNotFound;
    ok(`${n} -> revert ${isNotFound ? "ResolverNotFound" : r.decoded?.selector}`,
       /revert ResolverNotFound/.test(row.result) === isNotFound,
       `profile expected "${row.result}"`);
    continue;
  }
  const decoded = decodeResolveReturn(r.raw);
  const addr = decoded && decoded.resultLen === 32 ? "0x" + decoded.result.slice(26) : null;
  const isZero = addr !== null && /^0x0+$/.test(addr);
  if (/UNREGISTERED and it still RESOLVED/.test(row.meaning)) {
    ok(`${n} still RESOLVES without reverting, and still to the zero address`,
       decoded !== null && isZero,
       `resolver ${decoded?.resolver ?? "?"}, addr ${addr ?? "undecodable"} — if this is now non-zero somebody registered it`);
  } else {
    ok(`${n} resolves to a non-zero address`, decoded !== null && addr !== null && !isZero,
       `addr ${addr ?? "undecodable"}`);
  }
}

// ── the unresolved list, restated every run ───────────────────────────────────────────────────
//
// Printed whether or not anything failed. A run that only mentions what it could establish teaches
// the reader that silence means completeness, and it does not.

console.log("\n— what this profile still cannot establish —");
for (const u of P.UNRESOLVED) console.log(`      OPEN  ${u.question}`);
console.log(`      ${P.UNRESOLVED.length} open question(s), stated deliberately.`);

// The retry count is printed every run, including when it is zero. It is the honest measure of how
// much this endpoint had to be asked twice, and a run that needed many retries should be read as a
// weaker run even when it is green.
console.log(`\n${calls} request(s), ${retried} transport retry/retries`);
console.log(`checks run: ${pass + fail + skip}, passed: ${pass}, failed: ${fail}, skipped: ${skip}`);
process.exit(fail > 0 ? 1 : 0);
