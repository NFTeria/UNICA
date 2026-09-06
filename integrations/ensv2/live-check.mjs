// Read-only evidence capture. Resolves real names against live ENSv2 Sepolia and prints one row
// per case with everything a reader needs to reproduce it. Sends nothing, signs nothing.
//
//   node integrations/ensv2/live-check.mjs [rpc-url]
//
// The RPC defaults to a public endpoint and is printed, so no private URL is ever exposed.

import { resolveMerchant, normalizeName, namehash, dnsEncode, ENSV2, EXPLAIN } from "../../web/ensv2/resolve.mjs";

const RPC = process.argv[2] || "https://ethereum-sepolia-rpc.publicnode.com";
let calls = 0;

async function rpcCall(to, data) {
  calls++;
  const res = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: calls, method: "eth_call", params: [{ to, data }, "latest"] }),
  });
  const j = await res.json();
  if (j.error) { const e = new Error(j.error.message); e.data = j.error.data; throw e; }
  return j.result;
}

async function blockNumber() {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "eth_blockNumber", params: [] }) });
  return parseInt((await res.json()).result, 16);
}

const CASES = [
  ["raffy.eth",                       "RESOLVED",           "a registered ENSv2 name with an address record"],
  ["nonexistent-sub-7f31.raffy.eth",  "ZERO_ADDRESS",       "unregistered subname under a wildcard parent: SUCCEEDS, returns zero"],
  ["ens.eth",                         "ZERO_ADDRESS",       "registered, no address record: SUCCEEDS, returns zero"],
  ["premm.eth",                       "RESOLVER_NOT_FOUND", "no resolver anywhere: reverts"],
  ["",                                "EMPTY_NAME",         "nothing typed"],
  ["notaname",                        "MALFORMED_NAME",     "no label separator"],
  ["mérchant.eth",                    "NON_ASCII_NAME",     "refused rather than approximately normalised"],
];

const block = await blockNumber();
console.log(`ENSv2 live resolution — chain ${ENSV2.chainId} (${ENSV2.chainName})`);
console.log(`entry point ${ENSV2.entryPoint}`);
console.log(`rpc ${RPC}`);
console.log(`block ${block}`);
console.log(`docs ${ENSV2.docs} (retrieved ${ENSV2.retrieved})\n`);

let pass = 0;
for (const [name, want, why] of CASES) {
  const r = await resolveMerchant(name, rpcCall, { blockNumber: block });
  const ok = r.status === want;
  pass += ok ? 1 : 0;
  console.log(`${ok ? "PASS" : "FAIL"}  ${JSON.stringify(name) || '""'}`);
  console.log(`      ${why}`);
  console.log(`      status    ${r.status}${ok ? "" : `   (expected ${want})`}`);
  if (r.name)      console.log(`      normalised ${r.name}`);
  if (r.dns)       console.log(`      dns        ${r.dns}`);
  if (r.namehash)  console.log(`      namehash   ${r.namehash}`);
  if (r.resolver)  console.log(`      resolver   ${r.resolver}`);
  console.log(`      recipient  ${r.recipient ?? "(none — nothing to pay)"}`);
  console.log(`      shown      ${EXPLAIN[r.status] || r.status}`);
  console.log();
}

// Controls that do not need the network.
const nh = namehash("eth") === "0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae";
console.log(`${nh ? "PASS" : "FAIL"}  control: namehash("eth") is the canonical value`);
const distinct = new Set(["raffy.eth", "ens.eth", "unica.eth"].map(namehash)).size === 3;
console.log(`${distinct ? "PASS" : "FAIL"}  control: distinct names give distinct namehashes`);
const dns = dnsEncode("raffy.eth") === "0x0572616666790365746800";
console.log(`${dns ? "PASS" : "FAIL"}  control: DNS wire encoding matches the worked example`);
const noFallback = (await resolveMerchant("premm.eth", rpcCall)).recipient == null;
console.log(`${noFallback ? "PASS" : "FAIL"}  control: a failed resolution carries no recipient`);

const extra = [nh, distinct, dns, noFallback].filter(Boolean).length;
console.log(`\nchecks run: ${CASES.length + 4}, passed: ${pass + extra}, failed: ${CASES.length + 4 - pass - extra}`);
process.exit(pass + extra === CASES.length + 4 ? 0 : 1);
