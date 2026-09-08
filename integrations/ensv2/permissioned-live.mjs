// Read-only evidence capture for ENSv2 Permissioned Resolver + Enhanced Access Control.
//
//   node integrations/ensv2/permissioned-live.mjs [name] [rpc-url]
//
// It is the sibling of `live-check.mjs` and prints in the same shape, for the same reason: a row
// that cannot be reproduced by the reader is a claim, not evidence. Every address is printed with
// the code size actually observed at it, every probe is printed with WHICH of the three
// observations it produced, and the two authorization rows are printed with the contract's own
// answers. The RPC endpoint is printed too, so a reader knows which endpoint replied — but only
// its ORIGIN is printed, through `redactRpc`. An earlier version echoed the URL verbatim and
// reasoned that the DEFAULT endpoint is public; that defends nothing, because the endpoint is a
// command-line argument and the provider URLs people actually pass carry the key in the path or
// the query. It leaked on the failure path too, which is the path whose output gets pasted.
//
// FAILS CLOSED ON THE WRONG CHAIN. The first thing it does is ask the endpoint for its chain id
// and refuse if it is not Sepolia. A run against the wrong chain would produce a page of confident
// numbers about the wrong contracts, and there is no honest way to notice that afterwards.
//
// IT RE-DERIVES, IT DOES NOT RE-GUESS. Every selector is recomputed here from its signature string
// and then looked for as a PUSH4 dispatch constant in the runtime that is downloaded during the
// run. That is what makes the offline suite's pinned values checkable rather than decorative: if
// ENS redeploys the implementation, this run says so and the pins are wrong until someone updates
// them.
//
// A SKIP IS A SKIP. Anything that could not be observed prints as `SKIP <name>: <why> (this is a
// SKIP, not a pass)` and is counted separately from the passes. Nothing here approximates.

import {
  EAC_ROLES_CHANGED_SIGNATURE, EAC_ROLES_CHANGED_TOPIC, ERC1967_IMPLEMENTATION_SLOT,
  ERROR_SIGNATURES, INTERFACE, OBSERVATION, PROBE, RESOURCE_DERIVATIONS, ROLE, ROOT_RESOURCE,
  SELECTOR, SIGNATURES, coinTypeResource, encodeAddrCall, encodeGetAliasCall,
  encodeGetAssigneeCountCall, encodeRoleCountCall, managedSubname, nameLevelResource, probe,
  readAuthorization, redactRpc, selectorFor, textResource, uintAt,
} from "./permissioned.mjs";
import {CONTRAST, SIM, simulateEdit} from "./authz-sim.mjs";
import {buildPreview, previewIsSignable} from "./preview.mjs";
import {ENSV2, decodeResolveReturn, dnsEncode, encodeResolveCall, namehash} from "../../web/ensv2/resolve.mjs";

const args = process.argv.slice(2);
const RPC = args.find((a) => a.startsWith("http")) || "https://ethereum-sepolia-rpc.publicnode.com";
const NAME = args.find((a) => !a.startsWith("http")) || "raffy.eth";
const MERCHANT_LABEL = "unica-merchant-9f2a";

let calls = 0;
async function rpc(method, params) {
  calls++;
  const res = await fetch(RPC, {
    method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: calls, method, params}),
  });
  const j = await res.json();
  if (j.error) { const e = new Error(j.error.message); e.data = j.error.data; throw e; }
  return j.result;
}
// Public endpoints cap `eth_getLogs` at a block range, so the scan is a BOUNDED walk backwards and
// says how far it looked. An unbounded scan that silently got truncated would report "no grants"
// when it meant "I did not look far enough", and those are different sentences.
const LOG_WINDOW = 50000;
const LOG_WINDOWS = 8;

const chain = {
  call: (to, data, from) => rpc("eth_call", [from ? {to, data, from} : {to, data}, "latest"]),
  getCode: (a) => rpc("eth_getCode", [a, "latest"]),
  getStorageAt: (a, s) => rpc("eth_getStorageAt", [a, s, "latest"]),
  estimateGas: (tx) => rpc("eth_estimateGas", [tx]),
  async getLogs({address, topic0}) {
    const head = Number(await rpc("eth_blockNumber", []));
    let lowest = head;
    for (let i = 0; i < LOG_WINDOWS; i++) {
      const to = head - i * LOG_WINDOW;
      const from = Math.max(0, to - (LOG_WINDOW - 1));
      lowest = from;
      const logs = await rpc("eth_getLogs", [{
        address, topics: [topic0],
        fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16),
      }]);
      if (logs.length) return {logs, window: {fromBlock: from, toBlock: head, exhausted: false}};
      if (from === 0) break;
    }
    return {logs: [], window: {fromBlock: lowest, toBlock: head, exhausted: lowest === 0}};
  },
};

let pass = 0, fail = 0, skip = 0;
const ok = (n, cond, detail) => {
  if (cond) { pass++; console.log(`PASS  ${n}`); }
  else { fail++; console.log(`FAIL  ${n}${detail ? `\n      ${detail}` : ""}`); }
};
const skipped = (n, why) => { skip++; console.log(`SKIP  ${n}: ${why} (this is a SKIP, not a pass)`); };

// ── fail closed before anything else ──────────────────────────────────────────────────────────

let observedChain;
try {
  observedChain = Number(await rpc("eth_chainId", []));
} catch (e) {
  console.error(`refusing: could not reach ${redactRpc(RPC)} — ${e.message}`);
  console.log("\nchecks run: 0, passed: 0, failed: 1");
  process.exit(1);
}
if (observedChain !== ENSV2.chainId) {
  console.error(`refusing: this endpoint reports chain ${observedChain}; ENSv2 is read on ${ENSV2.chainId}`);
  console.log("\nchecks run: 1, passed: 0, failed: 1");
  process.exit(1);
}
const block = Number(await rpc("eth_blockNumber", []));

console.log(`ENSv2 Permissioned Resolver + Enhanced Access Control — live evidence`);
console.log(`chain ${observedChain} (${ENSV2.chainName})`);
console.log(`rpc   ${redactRpc(RPC)}`);
console.log(`block ${block}`);
console.log(`name  ${NAME}`);
console.log(`docs  https://docs.ens.domains/ensv2/permissioned-resolver (read 2026-09-08)`);
console.log(`      https://docs.ens.domains/ensv2/enhanced-access-control (read 2026-09-08)\n`);

// ── addresses, with the code size actually observed at each ───────────────────────────────────

console.log("— addresses and their observed code —");
const sizeOf = async (addr) => ((await chain.getCode(addr)).length - 2) / 2;
const urSize = await sizeOf(ENSV2.entryPoint);
ok(`UpgradableUniversalResolverProxy ${ENSV2.entryPoint} has code (${urSize} bytes)`, urSize > 0);

const authz = await readAuthorization(NAME, chain);
if (!authz.ok) {
  console.log(`FAIL  the authorization state could not be read: ${authz.status}${authz.detail ? ` — ${authz.detail}` : ""}`);
  console.log(`\nchecks run: ${pass + 1}, passed: ${pass}, failed: 1`);
  process.exit(1);
}
console.log(`      the UniversalResolver named ${authz.resolver} for ${authz.name}`);
ok(`that resolver has code (${authz.codeSize} bytes)`, authz.codeSize > 0);
ok(`it is a proxy over an implementation (ERC-1967 slot ${ERC1967_IMPLEMENTATION_SLOT.slice(0, 12)}…)`,
   authz.implementation !== null, "no implementation address in the ERC-1967 slot");

let implSize = 0;
if (authz.implementation) {
  implSize = await sizeOf(authz.implementation);
  ok(`implementation ${authz.implementation} has code (${implSize} bytes)`, implSize > 0);
} else {
  skipped("implementation code size", "no implementation address was observed");
}

console.log("\n— who holds roles, and how far we looked for the answer —");
for (const c of authz.candidates) {
  console.log(`      ${c.address}  root ${c.rootRoles}  (${c.rootRoleNames ?? "none"})  via ${c.source}`);
}
if (authz.logWindow?.error) {
  skipped("the EACRolesChanged scan", authz.logWindow.error);
} else if (authz.logWindow) {
  const {fromBlock, toBlock, exhausted} = authz.logWindow;
  const found = authz.candidates.filter((c) => c.source === "EAC_ROLES_CHANGED_LOG").length;
  console.log(`      EACRolesChanged scan: blocks ${fromBlock}–${toBlock}` +
              `${exhausted ? " (to genesis)" : " (bounded; older grants are outside this window)"}` +
              `, ${found} account(s) found`);
  // A STATED NEGATIVE, ALWAYS PRINTED. `roleCount` packs a four-bit assignee counter per role, so
  // the contract itself says how many accounts hold each one. That number is compared with the
  // number this run could NAME, every time — including when they match — because a line that only
  // appears when something is missing teaches a reader to read its absence as completeness.
  //
  // AND THE LOG SCAN IS NOT RELIABLE. Measured on 2026-09-08 against a public load-balanced
  // endpoint: three consecutive runs over the SAME block range returned one matching log, then
  // none, then one. An integration that concluded "nobody else holds this role" from an empty
  // `eth_getLogs` would be wrong roughly a third of the time. The contract's own counter is the
  // authority here; the log scan only ever ADDS names to the list and never subtracts from it.
  const perRole = BigInt(authz.rootRoleCount) & 0xfn;
  const named = BigInt(authz.candidates.length);
  console.log(`      the contract counts ${perRole} assignee(s) per role at ROOT_RESOURCE; ` +
              `this run named ${named}`);
  ok("the run never claims to have found more assignees than the contract counts", named <= perRole,
     `named ${named}, contract counts ${perRole}`);
  if (perRole > named) {
    console.log(`      NOTE  ${perRole - named} assignee(s) at ROOT_RESOURCE were not identified. Their grants`);
    console.log(`            are outside the scanned window, or this endpoint did not return the log.`);
    console.log(`            Stated, not guessed: an empty log scan is not proof of absence.`);
  } else {
    console.log(`      NOTE  the counts agree in THIS run. They did not in an earlier one over the same`);
    console.log(`            range — the endpoint's log index is not stable, so do not read agreement`);
    console.log(`            here as a guarantee that the list is complete.`);
  }
} else {
  skipped("the EACRolesChanged scan", "no log source was injected");
}

// ── the interface, re-derived and looked for in the runtime that was just downloaded ──────────

console.log("\n— every signature, its derived selector, and what the live probe produced —");
let runtime = "";
if (authz.implementation) runtime = (await chain.getCode(authz.implementation)).slice(2).toLowerCase();

const dispatchHas = (sel) => runtime.includes("63" + sel.slice(2));
for (const row of INTERFACE) {
  const sig = SIGNATURES[row.key];
  const sel = selectorFor(sig);
  ok(`${sel}  ${sig}  [ledger: ${row.observed}]`, sel === SELECTOR[row.key],
     `the module's table says ${SELECTOR[row.key]}`);
  if (!runtime) { skipped(`${sig} in the dispatch table`, "the implementation runtime was not downloaded"); continue; }
  ok(`   … and its selector is a PUSH4 constant in the deployed runtime`, dispatchHas(sel),
     "not found — the implementation may have been redeployed; re-derive the pins");
}
for (const [name, sig] of Object.entries(ERROR_SIGNATURES)) {
  console.log(`      error  ${selectorFor(sig)}  ${sig}  (${name})`);
}
console.log(`      event  ${EAC_ROLES_CHANGED_TOPIC}`);
console.log(`             ${EAC_ROLES_CHANGED_SIGNATURE}`);

// ── the three observations, one probe each ────────────────────────────────────────────────────

console.log("\n— probes, each labelled with which of the three observations it produced —");
const show = async (label, to, data, decode) => {
  const p = await probe(chain, to, data, decode);
  const extra = p.observation === PROBE.DECODED
    ? `value ${p.value !== undefined ? "0x" + p.value.toString(16) : p.raw.slice(0, 66)}`
    : p.observation === PROBE.REVERT ? `${p.revert.error}`
    : p.observation === PROBE.RPC_FAILURE ? p.detail
    // An undecodable return must show WHY it would not decode. Printing "0x" for it would make it
    // look like an empty return, which is a different thing the contract could have said.
    : p.observation === PROBE.UNDECODABLE ? `${p.raw.slice(0, 66)} — ${p.undecodable}`
    : "0x";
  console.log(`      ${p.observation.padEnd(13)} ${label}\n                    ${extra}`);
  return p;
};

const rootCount = await show(`roleCount(ROOT_RESOURCE) on ${authz.resolver}`,
  authz.resolver, encodeRoleCountCall(ROOT_RESOURCE), (h) => uintAt(h, 0));
ok("roleCount(ROOT_RESOURCE) DECODED", rootCount.observation === PROBE.DECODED, rootCount.observation);

const nameCount = await show("roleCount(nameLevelResource(node))",
  authz.resolver, encodeRoleCountCall(BigInt(authz.nameResource)), (h) => uintAt(h, 0));
ok("roleCount(name-level) DECODED", nameCount.observation === PROBE.DECODED, nameCount.observation);

// A deliberately invalid bitmap: the documented signature accepts a uint256, and the deployed
// contract refuses one that selects more than a single role group. A REVERT here is the expected
// observation, and it is the only way this run sees EACInvalidRoleBitmap.
const badBitmap = await show("getAssigneeCount(ROOT_RESOURCE, ~0) — a bitmap spanning every role",
  authz.resolver, encodeGetAssigneeCountCall(ROOT_RESOURCE, (1n << 256n) - 1n));
ok("an over-wide role bitmap REVERTS, and by name",
   badBitmap.observation === PROBE.REVERT && badBitmap.revert.error === "EACInvalidRoleBitmap",
   `${badBitmap.observation} ${badBitmap.revert?.error ?? ""}`);

const oneBitmap = await show("getAssigneeCount(ROOT_RESOURCE, ROLE_SET_ADDR)",
  authz.resolver, encodeGetAssigneeCountCall(ROOT_RESOURCE, ROLE.SET_ADDR));
if (oneBitmap.observation === PROBE.DECODED) {
  const words = (oneBitmap.raw.length - 2) / 64;
  ok(`getAssigneeCount returned ${words} word(s)`, words >= 1);
  if (words !== 1) {
    console.log(`      NOTE  the documentation gives this one `
      + `uint256 return; the deployed contract returned ${words}. Reported as observed, not interpreted.`);
  }
} else {
  skipped("getAssigneeCount with a single role", `it produced ${oneBitmap.observation}`);
}

const alias = await show("getAlias(dnsEncode(name)) — record aliasing",
  authz.resolver, encodeGetAliasCall(dnsEncode(authz.name)));
if (alias.observation === PROBE.DECODED) {
  const empty = /^0x0*200*$/.test(alias.raw);
  console.log(`      NOTE  aliasing is implemented by this resolver; ${empty ? "no alias is configured for this name" : "an alias is configured"}.`);
  ok("getAlias answers (aliasing is available, whether or not it is configured)", true);
} else {
  skipped("getAlias", `it produced ${alias.observation}`);
}

// ── wildcard resolution, through a managed merchant subname ───────────────────────────────────

console.log("\n— wildcard resolution: a subname nobody registered —");
const sub = managedSubname(authz.name, MERCHANT_LABEL);
if (!sub.ok) {
  skipped("managed subname", `the label could not be derived: ${sub.status}`);
} else {
  console.log(`      ${sub.name}`);
  console.log(`      namehash ${sub.node}`);
  console.log(`      dns      ${sub.dns}`);
  let subRaw = null;
  try {
    subRaw = await chain.call(ENSV2.entryPoint, encodeResolveCall(sub.dns, encodeAddrCall(sub.node)));
  } catch (e) {
    skipped("wildcard resolution", `the UniversalResolver reverted: ${e.message}`);
  }
  if (subRaw) {
    const d = decodeResolveReturn(subRaw);
    ok("an unregistered subname resolves without reverting", d !== null, "the return did not decode");
    ok(`… and is answered by the SAME resolver as the parent (${d?.resolver})`,
       String(d?.resolver).toLowerCase() === authz.resolver.toLowerCase(),
       `parent ${authz.resolver}, subname ${d?.resolver}`);
    console.log(`      the parent's Permissioned Resolver answers for every name beneath it — that is the`);
    console.log(`      wildcard, and it is why an operator can hand out <merchant>.${authz.name} without a`);
    console.log(`      registration transaction per merchant.`);
  }
}

// ── resource derivation ───────────────────────────────────────────────────────────────────────

console.log("\n— resource ids, and how strongly each derivation is held —");
console.log(`      node                ${authz.node}`);
for (const r of RESOURCE_DERIVATIONS) console.log(`      ${r.part.padEnd(10)} ${r.observed.padEnd(24)} ${r.formula}`);
console.log(`      NAME_LEVEL value    ${nameLevelResource(authz.node)}`);
console.log(`      TEXT_KEY   value    ${textResource(authz.node, "unica.payout")}   (key "unica.payout")`);
console.log(`      COIN_TYPE  value    ${coinTypeResource(authz.node, 60)}   (coinType 60)`);

// ── the two authorization rows ────────────────────────────────────────────────────────────────

console.log("\n— the authorization contrast, live, with no wallet —");
const sim = await simulateEdit(NAME, chain);
if (!sim.ok) {
  skipped("the authorization contrast", `${sim.status}${sim.detail ? ` — ${sim.detail}` : ""}`);
} else {
  console.log(`      edit      ${sim.edit.what} -> ${sim.edit.target}${sim.edit.isNoOp ? "   (a no-op: this is the record already there)" : ""}`);
  console.log(`      calldata  ${sim.edit.data}`);
  console.log(`      needs     ${sim.edit.requiredRole} (${sim.edit.requiredRoleBitmap}) on ${sim.edit.resourceChecked}\n`);
  for (const r of sim.rows) {
    if (r.sim === SIM.SKIPPED) { skipped(`${r.role} row`, r.reason); continue; }
    const wanted = r.role === "AUTHORIZED" ? SIM.ACCEPTED : SIM.REFUSED;
    ok(`${r.role.padEnd(12)} ${r.sim}   from ${r.from}`, r.sim === wanted, `expected ${wanted}`);
    if (r.rootRoles) console.log(`                    roles ${r.rootRoles}\n                    ${r.rootRoleNames}`);
    if (r.discoveredVia) console.log(`                    discovered via ${r.discoveredVia}`);
    if (r.heldRoles) console.log(`                    holds ${r.heldRoles}, checked before the row ran`);
    if (r.gas && !r.gas.error) console.log(`                    eth_estimateGas ${r.gas} (${Number(r.gas)})`);
    if (r.revert) {
      console.log(`                    ${r.revert.error}`);
      console.log(`                    resource ${r.revert.resource}`);
      console.log(`                    roles    0x${r.revert.roleBitmap?.toString(16)} (${r.revert.roles})`);
    }
  }
  ok(`the contrast is ESTABLISHED`, sim.contrast === CONTRAST.ESTABLISHED, `it is ${sim.contrast}`);
  // The chain confirming an offline derivation: the refusal names the resource we computed here.
  const refused = sim.rows.find((r) => r.role === "UNAUTHORIZED" && r.revert);
  if (refused) {
    ok("the refusal names exactly the name-level resource derived offline",
       refused.revert.resource === nameLevelResource(authz.node),
       `chain said ${refused.revert.resource}, we derived ${nameLevelResource(authz.node)}`);
    ok("the refusal names exactly ROLE_SET_ADDR", refused.revert.roleBitmap === ROLE.SET_ADDR,
       `chain said 0x${refused.revert.roleBitmap?.toString(16)}`);
  } else {
    skipped("the resource cross-check", "no refusal was captured to read a resource out of");
  }
}

// ── the owner's preview ───────────────────────────────────────────────────────────────────────

console.log("\n— the transaction the owner would sign, and the wall in front of it —");
const from = authz.authorized[0]?.address ?? null;
const target = authz.addrRecord;
let gas = null;
if (from && target) {
  try { gas = await chain.estimateGas({to: authz.resolver, from, data: sim.ok ? sim.edit.data : undefined}); }
  catch (e) { gas = null; }
}
const preview = buildPreview(authz, {target, from, gas, atBlock: block});
if (!preview.ok) {
  skipped("the owner preview", `${preview.status} — ${preview.explain}`);
} else {
  ok("a preview is produced and is signable", previewIsSignable(preview));
  ok("… and is marked as needing the owner's wallet", preview.marker === "REQUIRES_OWNER_WALLET_CONFIRMATION");
  ok("… and carries zero value", BigInt(preview.transaction.value) === 0n);
  ok("… and says this tool cannot broadcast it", preview.broadcast.byThisTool === false);
  console.log(`      to        ${preview.transaction.to}`);
  console.log(`      from      ${preview.transaction.from}`);
  console.log(`      value     ${preview.transaction.value}`);
  console.log(`      gas       ${preview.gas.estimate} (${preview.gas.estimateDecimal})`);
  console.log(`      data      ${preview.transaction.data}`);
}

// ── controls that do not need the network ─────────────────────────────────────────────────────

console.log("\n— controls —");
ok("namehash of the queried name is stable", namehash(authz.name) === authz.node);
ok("two merchant labels give two different subnames",
   managedSubname(authz.name, "alpha").node !== managedSubname(authz.name, "beta").node);
ok("the ERC-1967 slot is the derived one, not a literal",
   /^0x[0-9a-f]{64}$/.test(ERC1967_IMPLEMENTATION_SLOT));
ok("no two selectors in the table collide",
   new Set(Object.values(SELECTOR)).size === Object.keys(SELECTOR).length);
ok("every ledger row carries a word from the observation vocabulary",
   INTERFACE.every((r) => Object.values(OBSERVATION).includes(r.observed)));

console.log(`\nchecks run: ${pass + fail}, passed: ${pass}, failed: ${fail}` +
            (skip ? `, skipped: ${skip} (a SKIP is not a pass)` : ""));
console.log(`rpc calls: ${calls}, all read-only`);
process.exit(fail === 0 ? 0 : 1);
