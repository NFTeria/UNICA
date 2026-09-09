// Live evidence for the UNICA MerchantConfig read path, against real ENSv2 Sepolia.
//
//   node script/ensv2/merchant-config-live.mjs [rpc-url]
//
// WHAT THIS RUNNER CAN AND CANNOT PROVE, said before the first row rather than after the last.
//
// UNICA owns no ENSv2 Sepolia name. There is therefore no merchant on this chain publishing a
// `unica.pay` record, and no live run can show this validator ACCEPTING one. What a live run CAN
// show — and what every row below is — is that the read path reaches the real deployment, that the
// answers it gets are the ones the chain actually gives, and that the validator's refusals are the
// ones a real, correctly-read chain produces. The accept path is exercised offline against a
// described world in `integrations/ensv2/merchant-config-test.mjs`, and that file says it is a
// fixture in its first paragraph.
//
// So this run is honest about being half the evidence. The half it carries is the half that cannot
// be faked by a fixture: a real entry point, a real resolver, real revert data.
//
// READ-ONLY, AND IT CANNOT BE OTHERWISE. Every request is eth_call, eth_getCode, eth_getStorageAt,
// eth_chainId or eth_blockNumber. Nothing signs, nothing broadcasts, no key or keystore path is
// read, and the endpoint is printed through `redactRpc` — only its origin — because this
// repository is public and a provider URL carries its key in the path.
//
// FAILS CLOSED ON THE WRONG CHAIN, first, before anything else. A page of confident rows about
// contracts that are not these ones cannot be spotted afterwards from the output.
//
// A SKIP IS A SKIP. A transport failure is counted apart from passes and failures and is never
// rounded into either.

import {toHex, keccak256} from "../../web/ensv2/keccak.mjs";
import {ENSV2} from "../../web/ensv2/resolve.mjs";
import {ERC1967_IMPLEMENTATION_SLOT, redactRpc} from "../../integrations/ensv2/permissioned.mjs";
import * as PROFILE from "../../integrations/ensv2/profile.mjs";
import * as R from "../../integrations/ensv2/records.mjs";
import {
  createLiveReader, createReaderOverTransport, assertLiveEvidence, EVIDENCE, LIVE_STATUS,
} from "../../integrations/ensv2/read-live.mjs";
import * as MC from "../../integrations/ensv2/merchant-config.mjs";

const RPC = process.argv.slice(2).find((a) => a.startsWith("http")) ||
  process.env.SEPOLIA_TESTNET_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

// The read target. A third-party testnet name, used only as something real to read. Nothing in
// this repository writes to it and nothing depends on it existing — if it changes hands or changes
// its records, the rows about it say so rather than passing quietly.
const SAMPLE = PROFILE.EVIDENCE_SAMPLE.name;
const SAMPLE_RESOLVER = PROFILE.EVIDENCE_SAMPLE.resolverProxy;
const UNREGISTERED_TLD = "definitely-not-registered-9c4f.eth";

let pass = 0, fail = 0, skip = 0;
const ok = (n, cond, detail) => {
  if (cond) { pass++; console.log(`PASS  ${n}`); }
  else { fail++; console.log(`FAIL  ${n}${detail ? `\n      ${detail}` : ""}`); }
};
const skipped = (n, why) => { skip++; console.log(`SKIP  ${n}: ${why} (this is a SKIP, not a pass)`); };

const lower = (s) => String(s ?? "").toLowerCase();

console.log("UNICA ENSv2 MerchantConfig — live read path against Sepolia");
console.log(`rpc ${redactRpc(RPC)}`);
console.log(`entry point ${ENSV2.entryPoint} (pinned by integrations/ensv2/profile.mjs)`);
console.log(`read target ${SAMPLE} — a third-party testnet name, read only`);
console.log("UNICA owns no ENSv2 name, so no row below shows an ACCEPTED merchant configuration.\n");

const reader = createLiveReader({rpcUrl: RPC});

// ── fail closed ───────────────────────────────────────────────────────────────────────────────

let observedChain;
try { observedChain = await reader.chainIdOf(); } catch (e) {
  console.log(`FAIL  the endpoint could not be asked which chain it is: ${e?.message ?? e}`);
  console.log("\nchecks run: 1, passed: 0, failed: 1, skipped: 0");
  process.exit(1);
}
if (observedChain !== ENSV2.chainId) {
  console.log(`FAIL  wrong chain: expected ${ENSV2.chainId}, endpoint answered ${observedChain}`);
  console.log("      nothing below would mean anything, so this run stops here");
  console.log("\nchecks run: 1, passed: 0, failed: 1, skipped: 0");
  process.exit(1);
}
ok(`the endpoint is chain ${ENSV2.chainId} (${ENSV2.chainName})`, true);

const block = await reader.blockNumber();
console.log(`      at block ${block ?? "(unknown)"}\n`);

// ── 1. the reader is what it says it is ───────────────────────────────────────────────────────

console.log("— the live reader, and the door that is not there —");
ok("this reader stamps its answers LIVE_RPC", reader.evidence === EVIDENCE.LIVE_RPC, reader.evidence);
ok("assertLiveEvidence accepts it", assertLiveEvidence(reader).ok === true, "");
// The control that needs no network, run here so the live output carries it too: a reader over an
// injected transport is refused by name. This is the whole "no fixture fallback" claim, stated
// where a reader of a live log will see it.
const fake = createReaderOverTransport(async () => "0x");
ok("CONTROL — a reader over an injected transport is refused as NOT_LIVE_EVIDENCE",
   assertLiveEvidence(fake).status === "NOT_LIVE_EVIDENCE", assertLiveEvidence(fake).status);
ok("CONTROL — the live door refuses an option that could carry data",
   (() => { try { createLiveReader({rpcUrl: RPC, fixtures: {}}); return false; } catch { return true; } })(),
   "an unknown option was accepted");

// ── 2. the deployment is still the one this repository read first-hand ─────────────────────────

console.log("\n— the pinned deployment, re-read —");
const dep = await MC.verifyDeployment(reader);
if (dep.transportSkipped > 0) {
  skipped(`${dep.transportSkipped} deployment row(s)`, "the endpoint dropped the response");
}
ok(`all ${dep.passed} deployment rows match the pin (code size and runtime code hash, 14 contracts)`,
   dep.failed === 0, `${dep.failed} row(s) moved: ${dep.rows.filter((r) => !r.ok && !r.transport).map((r) => r.name).join(", ")}`);

// ── 3. a real name, read through the real entry point ─────────────────────────────────────────

console.log(`\n— ${SAMPLE}, read live —`);
const addr = await reader.readAddr(SAMPLE);
if (addr.status === LIVE_STATUS.RPC_FAILURE) skipped(`${SAMPLE} address record`, addr.detail);
else {
  ok(`${SAMPLE} resolves to a non-zero address`, addr.ok === true && addr.isZero === false,
     `status ${addr.status}, address ${addr.address ?? "none"} — if this is now zero, the name's records changed`);
  ok(`   and it is served by the resolver the profile recorded`,
     lower(addr.resolver) === lower(SAMPLE_RESOLVER),
     `resolver ${addr.resolver}, profile ${SAMPLE_RESOLVER} — if these differ the name changed hands or changed resolver`);
}

// The record UNICA looks for, on a real ENSv2 name that does not publish it. This is a genuine
// negative observation, not an absence of evidence: the resolver ANSWERED, with a properly encoded
// empty string, which is a different thing from not answering.
const missing = await reader.readText(SAMPLE, R.RECORD_KEY.pay);
if (missing.status === LIVE_STATUS.RPC_FAILURE) skipped(`${SAMPLE} ${R.RECORD_KEY.pay}`, missing.detail);
else {
  ok(`${SAMPLE} publishes no ${R.RECORD_KEY.pay} record — and the resolver said so rather than failing to answer`,
     missing.status === LIVE_STATUS.RECORD_MISSING,
     `status ${missing.status}${missing.why ? ` (${missing.why})` : ""}`);
}

// The resolver's implementation, which is what the validator checks against the profile.
try {
  const slot = await reader.chain.getStorageAt(SAMPLE_RESOLVER, ERC1967_IMPLEMENTATION_SLOT);
  const impl = "0x" + String(slot ?? "").replace(/^0x/, "").padStart(64, "0").slice(24);
  const pinned = PROFILE.byName("PermissionedResolverImpl").address;
  ok("a real per-name resolver proxy runs the PermissionedResolverImpl this repository verified",
     lower(impl) === lower(pinned), `slot says ${impl}, profile pins ${pinned}`);
} catch (e) { skipped("the resolver's ERC-1967 implementation slot", e?.message ?? String(e)); }

// ── 4. the two failure shapes, and only one of them reverts ───────────────────────────────────

console.log("\n— a resolve that succeeds is not evidence a name exists —");
const wildcard = await reader.readAddr(`pay.acme.${SAMPLE}`);
if (wildcard.status === LIVE_STATUS.RPC_FAILURE) skipped("the wildcard row", wildcard.detail);
else {
  ok(`pay.acme.${SAMPLE} is unregistered and STILL RESOLVES — no revert, zero address`,
     wildcard.ok === true && wildcard.isZero === true,
     `status ${wildcard.status}, address ${wildcard.address ?? "none"} — if this is non-zero somebody registered it`);
}
const notFound = await reader.readAddr(UNREGISTERED_TLD);
if (notFound.status === LIVE_STATUS.RPC_FAILURE) skipped("the ResolverNotFound row", notFound.detail);
else {
  ok(`${UNREGISTERED_TLD} has no resolver anywhere and REVERTS — the only one of the two that does`,
     notFound.status === LIVE_STATUS.RESOLVER_NOT_FOUND,
     `status ${notFound.status}, selector ${notFound.revertSelector ?? "none"}`);
}

// ── 5. the validator, end to end, against the live chain ──────────────────────────────────────
//
// The parent is the sample name, which UNICA does not own and which publishes no UNICA records. So
// the expected answer is a REFUSAL, and which refusal it is matters: WILDCARD_UNREGISTERED means
// the validator correctly read a name that resolves, answers, and publishes nothing — the exact
// trap the Phase 1 survey found. Any other status here would mean the read path is wrong.

console.log(`\n— the whole validator, live, with ${SAMPLE} as the parent —`);
const verdict = await MC.resolveMerchantConfig(
  {parent: SAMPLE, merchant: "acme"}, reader,
  {chainId: ENSV2.chainId, atTime: Math.floor(Date.now() / 1000), requireLive: true},
);
ok("UNICA REFUSES a parent that publishes no UNICA settlement configuration",
   verdict.ok === false, `it ACCEPTED something: ${JSON.stringify(verdict.status)}`);
ok(`   and the reason is WILDCARD_UNREGISTERED — the name resolved, answered, and published nothing`,
   verdict.status === MC.PREFLIGHT_STATUS.WILDCARD_UNREGISTERED,
   `got ${verdict.status}: ${verdict.explain ?? ""} ${JSON.stringify(verdict.why ?? verdict.detail ?? "")}`);
ok("   live evidence was accepted as live (the run did not stop at NOT_LIVE_EVIDENCE)",
   verdict.status !== MC.PREFLIGHT_STATUS.NOT_LIVE_EVIDENCE, "");

// The same validator, handed an answer that did not come from a live endpoint: refused by name.
// This is the no-fixture-fallback rule as a live row rather than as a sentence in a comment.
const offlineTransport = async (method) => {
  if (method === "eth_chainId") return "0x" + ENSV2.chainId.toString(16);
  if (method === "eth_blockNumber") return "0x0";
  return "0x";
};
const offlineBundle = await MC.readMerchantEvidence(
  {parent: SAMPLE, merchant: "acme"}, createReaderOverTransport(offlineTransport), {chainId: ENSV2.chainId},
);
const refusedOffline = MC.preflight(offlineBundle, {chainId: ENSV2.chainId, atTime: 1, requireLive: true});
ok("CONTROL — the same validator refuses a non-live answer outright, by name",
   refusedOffline.status === MC.PREFLIGHT_STATUS.NOT_LIVE_EVIDENCE, `got ${refusedOffline.status}`);

// ── 6. no cache ───────────────────────────────────────────────────────────────────────────────

const before = reader.stats().resolves;
await reader.readAddr(SAMPLE);
await reader.readAddr(SAMPLE);
const after = reader.stats().resolves;
ok("two identical reads performed two resolutions — nothing is served from memory",
   after - before === 2, `${after - before} resolution(s) for two reads`);

// ── what this run did not establish ───────────────────────────────────────────────────────────

console.log("\n— what a live run cannot show, stated every run —");
for (const line of [
  "No ACCEPTED merchant configuration. UNICA owns no ENSv2 Sepolia name, so no merchant publishes a unica.pay record and the accept path is exercised offline only.",
  "No proof that a per-key or per-coin-type resolver resource exists. Phase 1 found five setters and three authorize* functions all naming the NAME-LEVEL resource; this validator is built on that and would need rewriting if a finer one ever appeared.",
  "No proof of what happens at the 15-assignee cap, and no write of any kind: nothing here signs or broadcasts.",
]) console.log(`      OPEN  ${line}`);

const stats = reader.stats();
console.log(`\n${stats.calls} request(s), ${stats.resolves} resolution(s), ${stats.retried ?? 0} transport retry/retries`);
console.log(`checks run: ${pass + fail + skip}, passed: ${pass}, failed: ${fail}, skipped: ${skip}`);
process.exit(fail > 0 ? 1 : 0);
