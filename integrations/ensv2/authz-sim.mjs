// The authorization contrast, simulated live, with no wallet and no gas.
//
// WHAT THIS IS FOR. A merchant name is only an identity if the chain refuses to let the wrong
// party change it. That is a claim, and this file turns it into an observation: the same edit is
// offered to the same contract twice, once as the account the chain says is authorised and once as
// an account that is not, and the two answers are printed side by side. `eth_call` executes the
// contract's real code against real state, so both rows are the deployed contract's own verdict —
// they simply are not mined.
//
//   node integrations/ensv2/authz-sim.mjs [name] [rpc-url]
//
// WHY IT COSTS NOTHING AND CANNOT COST ANYTHING. There is no signer here, no private key is read
// from anywhere, and the only JSON-RPC methods this file names are `eth_call`, `eth_getCode`,
// `eth_getStorageAt`, `eth_chainId`, `eth_blockNumber` and `eth_estimateGas`. Every one of them is
// read-only. `eth_sendRawTransaction` appears nowhere, so there is no path — not even a wrong one —
// from running this to changing anything.
//
// THE EDIT IS A NO-OP BY DEFAULT. The simulated call re-asserts the address record the name
// already has. That is deliberate: the row is evidence about WHO MAY WRITE, not about what should
// be written, and a simulation whose success would have changed something is a simulation somebody
// will eventually run for real by accident.
//
// A ROW THAT CANNOT BE OBTAINED IS A SKIP, AND SAYS SO. If the chain names no authorised account,
// the authorised row prints as a stated SKIP with its reason. It never prints as a pass, and the
// pair is never reported as evidence unless both halves actually ran.

import {
  PROBE, ROLE, ROOT_RESOURCE, decodeRevert, encodeRolesCall, encodeSetAddrCall,
  nameLevelResource, probe, readAuthorization, redactRpc, roleName, uintAt, unauthorizedProbeAddress,
} from "./permissioned.mjs";
import {ENSV2} from "../../web/ensv2/resolve.mjs";
import {resolve as pathResolve} from "node:path";
import {fileURLToPath} from "node:url";

/// Simulated writes get their OWN vocabulary. A setter returns nothing, so an accepted simulation
/// also puts `0x` on the wire — reusing the read vocabulary's EMPTY_RETURN for that would make
/// "the contract let me through" and "there is no such function" the same word.
export const SIM = {
  ACCEPTED: "ACCEPTED",
  REFUSED: "REFUSED",
  UNKNOWN: "UNKNOWN",
  SKIPPED: "SKIPPED",
};

export const CONTRAST = {
  ESTABLISHED: "ESTABLISHED",
  NOT_ESTABLISHED: "NOT_ESTABLISHED",
  INCOMPLETE: "INCOMPLETE",
};

/// Offer one edit from one `from` address and classify the contract's answer.
///
/// The resolver's code size must already have been observed non-zero by `readAuthorization`;
/// without that, ACCEPTED would be indistinguishable from calling an address with no code, which
/// also returns `0x` without reverting. That precondition is asserted, not assumed.
export async function simulateFrom(chain, {resolver, codeSize, data, from}) {
  if (!(Number(codeSize) > 0)) {
    return {sim: SIM.UNKNOWN, from, reason: "the resolver's code size was not observed non-zero"};
  }
  try {
    const raw = await chain.call(resolver, data, from);
    if (raw === "0x" || raw === undefined || raw === null) {
      return {sim: SIM.ACCEPTED, from, raw: "0x",
              note: "a void setter returns nothing; the contract's own checks passed"};
    }
    return {sim: SIM.ACCEPTED, from, raw};
  } catch (e) {
    const d = (e && e.data) || (e && e.error && e.error.data) || "";
    if (typeof d === "string" && d.length >= 10) {
      return {sim: SIM.REFUSED, from, revert: decodeRevert(d), raw: d};
    }
    return {sim: SIM.UNKNOWN, from, reason: e?.message ?? String(e)};
  }
}

/// The two rows, from one live reading.
///
/// @param chain {call, getCode, getStorageAt, getLogs?, estimateGas?}
/// @param opts.target the address the edit would write. Defaults to the record already there, so
///        a signed version of this call would change nothing.
export async function simulateEdit(name, chain, opts = {}) {
  const read = await readAuthorization(name, chain, opts);
  if (!read.ok) {
    return {ok: false, status: read.status, read, rows: [], contrast: CONTRAST.INCOMPLETE};
  }

  const target = opts.target ?? read.addrRecord;
  if (!target) {
    return {
      ok: false, status: "NO_TARGET_ADDRESS", read, rows: [], contrast: CONTRAST.INCOMPLETE,
      detail: "the name publishes no address record, so there is no no-op edit to simulate",
    };
  }
  const data = encodeSetAddrCall(read.node, target);
  const rows = [];

  // ── the authorised row ──────────────────────────────────────────────────────────────────────
  const authority = read.authorized[0] ?? null;
  if (!authority) {
    rows.push({
      role: "AUTHORIZED", sim: SIM.SKIPPED, from: null,
      reason: `the chain named no account holding ROLE_SET_ADDR for ${read.name} ` +
              `(status ${read.status}); this is a SKIP, not a pass`,
    });
  } else {
    const r = await simulateFrom(chain, {resolver: read.resolver, codeSize: read.codeSize, data, from: authority.address});
    let gas = null;
    if (chain.estimateGas) {
      try { gas = await chain.estimateGas({to: read.resolver, data, from: authority.address}); }
      catch (e) { gas = {error: e?.message ?? String(e)}; }
    }
    rows.push({role: "AUTHORIZED", ...r, discoveredVia: authority.source,
               rootRoles: authority.rootRoles, rootRoleNames: authority.rootRoleNames, gas});
  }

  // ── the unauthorised row ────────────────────────────────────────────────────────────────────
  //
  // The address is derived, and its lack of roles is CHECKED before the row is allowed to mean
  // anything. A refusal from an account that turned out to hold roles would be evidence of
  // something else entirely, and a test that cannot fail is not a test.
  const outsider = opts.unauthorized ?? unauthorizedProbeAddress();
  const rootRoles = await probe(chain, read.resolver, encodeRolesCall(ROOT_RESOURCE, outsider), (h) => uintAt(h, 0));
  const nameRoles = await probe(chain, read.resolver,
    encodeRolesCall(BigInt(nameLevelResource(read.node)), outsider), (h) => uintAt(h, 0));
  const held = (rootRoles.value ?? 0n) | (nameRoles.value ?? 0n);

  if (rootRoles.observation !== PROBE.DECODED || nameRoles.observation !== PROBE.DECODED) {
    rows.push({role: "UNAUTHORIZED", sim: SIM.SKIPPED, from: outsider,
               reason: `could not read the probe account's roles (${rootRoles.observation}/${nameRoles.observation}); ` +
                       "this is a SKIP, not a pass"});
  } else if (held !== 0n) {
    rows.push({role: "UNAUTHORIZED", sim: SIM.SKIPPED, from: outsider,
               reason: `the probe account unexpectedly holds roles 0x${held.toString(16)} ` +
                       `(${roleName(held)}), so a refusal would prove nothing; this is a SKIP, not a pass`});
  } else {
    const r = await simulateFrom(chain, {resolver: read.resolver, codeSize: read.codeSize, data, from: outsider});
    rows.push({role: "UNAUTHORIZED", ...r, heldRoles: "0x0",
               derivedFrom: "keccak256 over a fixed domain string — nobody's wallet"});
  }

  const a = rows.find((r) => r.role === "AUTHORIZED");
  const u = rows.find((r) => r.role === "UNAUTHORIZED");
  const contrast =
    a.sim === SIM.SKIPPED || u.sim === SIM.SKIPPED ? CONTRAST.INCOMPLETE
    : a.sim === SIM.ACCEPTED && u.sim === SIM.REFUSED ? CONTRAST.ESTABLISHED
    : CONTRAST.NOT_ESTABLISHED;

  return {
    ok: true,
    status: read.status,
    read,
    edit: {
      what: "setAddr(bytes32,address)",
      resolver: read.resolver,
      node: read.node,
      target,
      isNoOp: read.addrRecord !== null && target.toLowerCase() === String(read.addrRecord).toLowerCase(),
      data,
      requiredRole: "ROLE_SET_ADDR",
      requiredRoleBitmap: "0x" + ROLE.SET_ADDR.toString(16),
      resourceChecked: nameLevelResource(read.node),
    },
    rows,
    contrast,
  };
}

// ── the command ───────────────────────────────────────────────────────────────────────────────

// Run as a command, or imported by the suite? Compared as resolved paths, because an `endsWith`
// on the basename matches any file whose name is a suffix of another one.
const isMain = process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === pathResolve(process.argv[1]);
if (isMain) {
  const NAME = process.argv[2] && !process.argv[2].startsWith("http") ? process.argv[2] : "raffy.eth";
  const RPC = process.argv.find((a) => a.startsWith("http")) || "https://ethereum-sepolia-rpc.publicnode.com";

  let id = 0;
  const rpc = async (method, params) => {
    const res = await fetch(RPC, {
      method: "POST", headers: {"content-type": "application/json"},
      body: JSON.stringify({jsonrpc: "2.0", id: ++id, method, params}),
    });
    const j = await res.json();
    if (j.error) { const e = new Error(j.error.message); e.data = j.error.data; throw e; }
    return j.result;
  };
  const chain = {
    call: (to, data, from) => rpc("eth_call", [from ? {to, data, from} : {to, data}, "latest"]),
    getCode: (a) => rpc("eth_getCode", [a, "latest"]),
    getStorageAt: (a, s) => rpc("eth_getStorageAt", [a, s, "latest"]),
    estimateGas: (tx) => rpc("eth_estimateGas", [tx]),
  };

  const observed = Number(await rpc("eth_chainId", []));
  if (observed !== ENSV2.chainId) {
    console.error(`refusing: this endpoint is chain ${observed}, ENSv2 is read on ${ENSV2.chainId}`);
    process.exit(1);
  }
  const block = Number(await rpc("eth_blockNumber", []));

  const out = await simulateEdit(NAME, chain);
  console.log(`ENSv2 authorization simulation — chain ${ENSV2.chainId} (${ENSV2.chainName}), block ${block}`);
  console.log(`rpc  ${redactRpc(RPC)}`);
  console.log(`name ${NAME}\n`);

  if (!out.ok) {
    console.log(`REFUSED  ${out.status}${out.detail ? ` — ${out.detail}` : ""}`);
    console.log("\nchecks run: 1, passed: 0, failed: 1");
    process.exit(1);
  }

  console.log(`resolver        ${out.read.resolver}  (${out.read.codeSize} bytes)`);
  console.log(`implementation  ${out.read.implementation ?? "(no ERC-1967 slot observed)"}`);
  console.log(`mechanism       ${out.read.mechanism}`);
  console.log(`root resource   ${out.read.rootResource}   roleCount ${out.read.rootRoleCount}`);
  console.log(`name resource   ${out.read.nameResource}   roleCount ${out.read.nameRoleCount}`);
  console.log(`\nthe edit        ${out.edit.what} -> ${out.edit.target}${out.edit.isNoOp ? "  (a no-op: this is the record already there)" : ""}`);
  console.log(`calldata        ${out.edit.data}`);
  console.log(`needs           ${out.edit.requiredRole} (${out.edit.requiredRoleBitmap}) on ${out.edit.resourceChecked}\n`);

  for (const r of out.rows) {
    console.log(`${r.sim.padEnd(9)} ${r.role}`);
    console.log(`          from      ${r.from ?? "(none)"}`);
    if (r.discoveredVia) console.log(`          found by  ${r.discoveredVia}`);
    if (r.rootRoles) console.log(`          roles     ${r.rootRoles} (${r.rootRoleNames})`);
    if (r.heldRoles) console.log(`          roles     ${r.heldRoles} — holds nothing, checked before this row was run`);
    if (r.gas && !r.gas.error) console.log(`          gas       ${r.gas} (${Number(r.gas)})`);
    if (r.revert) console.log(`          revert    ${r.revert.error}${r.revert.roles ? ` roles=${r.revert.roles}` : ""}` +
                              `${r.revert.resource ? `\n          resource  ${r.revert.resource}` : ""}`);
    if (r.reason) console.log(`          why       ${r.reason}`);
    console.log();
  }

  const ran = out.rows.filter((r) => r.sim !== SIM.SKIPPED).length;
  const skipped = out.rows.length - ran;
  const passed = out.contrast === CONTRAST.ESTABLISHED ? ran : 0;
  console.log(`contrast: ${out.contrast}`);
  if (out.contrast === CONTRAST.ESTABLISHED) {
    console.log("the deployed resolver accepted the authorised account and refused the other one, " +
                "by name, in the same block, for the same calldata.");
  }
  for (const r of out.rows.filter((x) => x.sim === SIM.SKIPPED)) {
    console.log(`SKIP  ${r.role}: ${r.reason}`);
  }
  console.log(`\nchecks run: ${ran}, passed: ${passed}, failed: ${ran - passed}` +
              (skipped ? `, skipped: ${skipped} (a SKIP is not a pass)` : ""));
  process.exit(ran - passed === 0 && ran > 0 ? 0 : 1);
}
