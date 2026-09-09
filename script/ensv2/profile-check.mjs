// Offline check of the ENSv2 deployment profile — every derivation reproduced, no network.
//
//   node script/ensv2/profile-check.mjs
//   node script/ensv2/profile-check.mjs --self-test
//
// WHAT IT IS FOR. `integrations/ensv2/profile.mjs` pins a set of numbers that a live Sepolia read
// produced on 2026-09-09. Numbers in a file are claims. This runner turns the claims that can be
// recomputed back into checks: every selector is re-derived from its signature string and compared
// with the four bytes actually seen on the wire, every pinned resource is recomputed from the
// inputs it was supposed to come from, and the packed-nybble reading of `getAssigneeCount` is
// replayed against the three raw words the contract returned.
//
// The rows that CANNOT be checked offline — code sizes, code hashes, who holds what — are the live
// checker's job (`script/ensv2/profile-live.mjs`). This one is deliberately hermetic so it can run
// in a gate on a machine with no RPC and still mean something.
//
// A CHECK THAT HAS NEVER FAILED IS NOT A CHECK. `--self-test` mutates the profile — one field at a
// time, each mutation the kind of mistake this file exists to catch — and requires the suite to go
// RED for each. If a mutation passes, the self-test fails and says which one, because a guard that
// cannot be made to scream is decoration.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {utf8} from "../../integrations/permit2/digest.mjs";
import {namehash} from "../../web/ensv2/resolve.mjs";
import {selectorFor} from "../../integrations/ensv2/permissioned.mjs";
import * as P from "../../integrations/ensv2/profile.mjs";

// The three raw getAssigneeCount returns, transcribed from the wire. Two words each: the counts,
// then the per-role maximum. Kept here rather than in the profile because they are the RAW
// evidence, and the profile's interpretation of them is what is under test.
const ASSIGNEE_RETURNS = [
  {
    contract: "PermissionedResolver proxy (raffy.eth)", resource: "ROOT_RESOURCE", roleBitmap: 1n << 0n,
    counts: "0x0000000000000000000000000000000000000000000000000000000000000002", // bytes32 word returned by eth_call, recorded verbatim
    maxima: "0x000000000000000000000000000000000000000000000000000000000000000f", // bytes32 word returned by eth_call, recorded verbatim
    expectCount: 2, expectMax: 15, expectNybble: 0,
  },
  {
    contract: "PermissionedResolver proxy (raffy.eth)", resource: "ROOT_RESOURCE", roleBitmap: 1n << 4n,
    counts: "0x0000000000000000000000000000000000000000000000000000000000000020", // bytes32 word returned by eth_call, recorded verbatim
    maxima: "0x00000000000000000000000000000000000000000000000000000000000000f0", // bytes32 word returned by eth_call, recorded verbatim
    expectCount: 2, expectMax: 15, expectNybble: 1,
  },
  {
    contract: "ETHRegistry", resource: "ROOT_RESOURCE", roleBitmap: (1n << 0n) | (1n << 24n),
    counts: "0x0000000000000000000000000000000000000000000000000000000000000001", // bytes32 word returned by eth_call, recorded verbatim
    maxima: "0x000000000000000000000000000000000000000000000000000000000f00000f", // bytes32 word returned by eth_call, recorded verbatim
    expectCount: 1, expectMax: 15, expectNybble: 0,
  },
];

/// Every check, as data, so the self-test can run the same function over a mutated profile.
function runChecks(p, emit) {
  // Look the deployment rows up in the profile UNDER TEST, never through the module's own
  // `byName`. That helper closes over the real DEPLOYMENT array, so a check written with it reads
  // the pristine module while claiming to check the mutated one — which is how a check ends up
  // unable to fail. The self-test caught exactly that here: the "same runtime deployed twice" row
  // stayed green while the clone's code hash had been zeroed.
  const named = (n) => p.DEPLOYMENT.find((d) => d.name === n) ?? null;

  // ── the two resource derivations reproduce the words the chain named ───────────────────────
  emit(
    "the registry resource for 'raffy' recomputes to the word EACUnauthorizedAccountRoles named",
    p.registryResource(p.EVIDENCE_SAMPLE.label, 0n) === p.EVIDENCE_SAMPLE.registryResource,
    `derived ${p.registryResource(p.EVIDENCE_SAMPLE.label, 0n)}, pinned ${p.EVIDENCE_SAMPLE.registryResource}`,
  );
  const node = namehash(p.EVIDENCE_SAMPLE.name);
  emit(
    "namehash('raffy.eth') recomputes to the pinned node",
    node === p.EVIDENCE_SAMPLE.namehash,
    `derived ${node}, pinned ${p.EVIDENCE_SAMPLE.namehash}`,
  );
  emit(
    "the resolver's name-level resource recomputes to the word five setters named",
    p.resolverNameResource(node) === p.EVIDENCE_SAMPLE.resolverNameResource,
    `derived ${p.resolverNameResource(node)}, pinned ${p.EVIDENCE_SAMPLE.resolverNameResource}`,
  );
  // The whole reason both are pinned: they are different words from different inputs, and an
  // integration that swaps them addresses a resource nobody holds a role at.
  emit(
    "the registry resource and the resolver resource are DIFFERENT words",
    p.EVIDENCE_SAMPLE.registryResource !== p.EVIDENCE_SAMPLE.resolverNameResource,
    "they are equal, which would mean one derivation is wrong",
  );
  // The registry derivation takes the LABEL, not the name. If it took the name it would produce a
  // different word, and this row is what says so out loud.
  emit(
    "the registry resource is derived from the LABEL, not from the full name",
    p.registryResource("raffy.eth", 0n) !== p.EVIDENCE_SAMPLE.registryResource,
    "hashing the full name produced the same word, so this derivation proves nothing about its input",
  );
  // The low 32 bits are the version field; the upper 224 must survive it untouched.
  const v0 = p.registryResource("raffy", 0n), v7 = p.registryResource("raffy", 7n);
  emit(
    "eacVersionId occupies the low 32 bits and leaves the upper 224 alone",
    v0.slice(0, 58) === v7.slice(0, 58) && v0.endsWith("00000000") && v7.endsWith("00000007"),
    `version 0 -> ${v0}, version 7 -> ${v7}`,
  );
  emit(
    "an eacVersionId that does not fit in 32 bits is refused rather than truncated",
    (() => { try { p.registryResource("raffy", 1n << 32n); return false; } catch { return true; } })(),
    "a 33-bit version was accepted and silently wrapped into the labelhash",
  );

  // ── every error selector re-derived and compared with the bytes seen on the wire ───────────
  for (const [name, sig] of Object.entries(p.ERROR_SIGNATURES)) {
    const derived = selectorFor(sig);
    const seen = p.ERROR_SELECTOR_OBSERVED[name];
    emit(
      `${name} derives to the four bytes the chain actually sent (${seen})`,
      derived === seen,
      `derived ${derived} from "${sig}", observed ${seen}`,
    );
  }

  // ── the admin shift, checked against a bit the chain showed held ───────────────────────────
  emit(
    "an admin role sits exactly 128 bits above the role it administers",
    p.adminRole(1n << 24n) === 1n << 152n && p.ADMIN_SHIFT === 128n,
    `adminRole(1<<24) = ${p.adminRole(1n << 24n).toString(16)}`,
  );
  emit(
    "ROLE_CAN_TRANSFER_ADMIN is pinned in its SHIFTED form, as bit 156",
    p.REGISTRY_ROLE_CAN_TRANSFER_ADMIN.bit === 1n << 156n,
    `pinned 0x${p.REGISTRY_ROLE_CAN_TRANSFER_ADMIN.bit.toString(16)}, expected 1<<156`,
  );
  // Roles are a nybble apart because roleCount packs a 0–15 counter into the same nybble. If any
  // two roles shared a nybble, one counter would count two roles.
  const allBits = [
    ...Object.values(p.REGISTRY_ROLE).map((r) => r.bit),
    ...Object.values(p.RESOLVER_ROLE).map((r) => r.bit),
  ];
  emit(
    "every pinned role bit is nybble-aligned and holds exactly one bit",
    allBits.every((b) => b > 0n && (b & (b - 1n)) === 0n && bitIndex(b) % 4 === 0),
    `offenders: ${allBits.filter((b) => !(b > 0n && (b & (b - 1n)) === 0n && bitIndex(b) % 4 === 0)).map((b) => "0x" + b.toString(16)).join(", ")}`,
  );
  emit(
    "no two registry roles share a nybble",
    new Set(Object.values(p.REGISTRY_ROLE).map((r) => bitIndex(r.bit) >> 2)).size ===
      Object.keys(p.REGISTRY_ROLE).length,
    "two registry roles land in one nybble, so one assignee counter would count both",
  );
  emit(
    "no two resolver roles share a nybble",
    new Set(Object.values(p.RESOLVER_ROLE).map((r) => bitIndex(r.bit) >> 2)).size ===
      Object.keys(p.RESOLVER_ROLE).length,
    "two resolver roles land in one nybble",
  );

  // ── the assignee words replayed ────────────────────────────────────────────────────────────
  for (const r of ASSIGNEE_RETURNS) {
    const counts = p.unpackAssigneeWord(r.counts, r.roleBitmap);
    const maxima = p.unpackAssigneeWord(r.maxima, r.roleBitmap);
    const first = counts[0], firstMax = maxima[0];
    emit(
      `getAssigneeCount(${r.resource}, 0x${r.roleBitmap.toString(16)}) on ${r.contract}: the counts word reads back at nybble ${r.expectNybble}`,
      !!first && first.nybble === r.expectNybble && first.count === r.expectCount,
      `read ${JSON.stringify(counts)}, expected nybble ${r.expectNybble} = ${r.expectCount}`,
    );
    emit(
      `   … and its SECOND word is the per-role maximum ${r.expectMax} at the same nybble`,
      !!firstMax && firstMax.nybble === r.expectNybble && firstMax.count === r.expectMax,
      `read ${JSON.stringify(maxima)}, expected nybble ${r.expectNybble} = ${r.expectMax}`,
    );
  }
  // The claim is that the maximum is packed per-nybble, not right-aligned. Rows 1 and 2 differ only
  // in which role was asked about, and both words moved with the question. This is the row that
  // distinguishes the two readings, so it is stated on its own.
  emit(
    "the maximum moves with the role asked about, which a right-aligned scalar could not do",
    ASSIGNEE_RETURNS[0].maxima !== ASSIGNEE_RETURNS[1].maxima &&
      p.unpackAssigneeWord(ASSIGNEE_RETURNS[1].maxima, 1n << 4n)[0].nybble === 1,
    "both queries returned the same maximum word, so the packing claim is not supported",
  );
  emit(
    `the pinned cap is ${p.MAX_ASSIGNEES_PER_ROLE} and it is the largest value a nybble can hold`,
    p.MAX_ASSIGNEES_PER_ROLE === 15n,
    `pinned ${p.MAX_ASSIGNEES_PER_ROLE}`,
  );

  // ── ROOT_RESOURCE ─────────────────────────────────────────────────────────────────────────
  emit("ROOT_RESOURCE is 0, as both contracts' own ROOT_RESOURCE() returned", p.ROOT_RESOURCE === 0n,
       `pinned ${p.ROOT_RESOURCE}`);

  // ── the deployment table's internal consistency ───────────────────────────────────────────
  emit(
    "every pinned address is a well-formed 20-byte address",
    p.DEPLOYMENT.every((d) => /^0x[0-9a-fA-F]{40}$/.test(d.address)),
    p.DEPLOYMENT.filter((d) => !/^0x[0-9a-fA-F]{40}$/.test(d.address)).map((d) => d.name).join(", "),
  );
  emit(
    "every pinned code hash is a 32-byte word",
    p.DEPLOYMENT.every((d) => /^0x[0-9a-f]{64}$/.test(d.codeHash)),
    p.DEPLOYMENT.filter((d) => !/^0x[0-9a-f]{64}$/.test(d.codeHash)).map((d) => d.name).join(", "),
  );
  emit(
    "no address is pinned twice under two names",
    new Set(p.DEPLOYMENT.map((d) => d.address.toLowerCase())).size === p.DEPLOYMENT.length,
    "an address appears under more than one name",
  );
  // Two INSTANCES, one runtime. Stated as a check because if a future re-read splits them, the
  // "one PermissionedRegistry implementation" claim in the prose stops being true.
  emit(
    "RootRegistry and ETHRegistry are the same runtime deployed twice",
    named("RootRegistry").codeHash === named("ETHRegistry").codeHash &&
      named("RootRegistry").codeSize === named("ETHRegistry").codeSize,
    `${named("RootRegistry").codeHash} vs ${named("ETHRegistry").codeHash}`,
  );
  emit(
    "the proxy chain from the entry point ends at the implementation the documentation names",
    p.PROXY_CHAIN.length === 2 &&
      p.PROXY_CHAIN[0].from.toLowerCase() === "0xeeeeeeee14d718c2b47d9923deab1335e144eeee" &&
      p.PROXY_CHAIN[0].to.toLowerCase() === p.PROXY_CHAIN[1].from.toLowerCase() &&
      p.PROXY_CHAIN[1].to.toLowerCase() === named("UniversalResolverV2").address.toLowerCase(),
    "the chain does not link end to end",
  );
  emit(
    "each proxy in the chain has an admin recorded, because an unrecorded admin is an unrecorded trust assumption",
    p.PROXY_CHAIN.every((h) => /^0x[0-9a-fA-F]{40}$/.test(h.admin)),
    "a hop has no admin",
  );

  // ── the honesty fields, which are checks in their own right ────────────────────────────────
  //
  // A profile whose every row said OBSERVED would be the suspicious result, not the good one.
  emit(
    "the admin-role rule carries BOTH an accepted control and a refused row",
    p.ADMIN_ROLE_RULE.rows.some((r) => r.observed === p.OBSERVED.ACCEPTED_IN_SIMULATION) &&
      p.ADMIN_ROLE_RULE.rows.some((r) => r.observed === p.OBSERVED.REVERT_NAMED_IT),
    "one half of the pair is missing, so neither half proves anything",
  );
  emit(
    "the wildcard rows include the unregistered subname that RESOLVED to zero",
    p.WILDCARD.rows.some((r) => /UNREGISTERED and it still RESOLVED/.test(r.meaning)),
    "the non-reverting failure shape is not recorded",
  );
  // CORRECTED IN PLACE. This check used to require the two finer derivations to be marked
  // DOCUMENTED_NOT_OBSERVED, and it was right to, because at the time nothing had ever named a
  // per-key resource. Executing authorizeTextRoles/authorizeAddrRoles on a pinned fork and finding
  // the granted bit at the resource the formula predicts refuted that, so the check now enforces
  // the stronger claim instead of the weaker one. What it must NEVER allow is the derivations
  // being upgraded past the evidence that exists: a fork execution is not revert data.
  emit(
    "the finer resolver resource derivations are marked FORK_EXECUTED and each carries its evidence",
    p.RESOURCE_DERIVATIONS.filter((r) => /keccak256\(bytes\(key\)\)|abi\.encode\(coinType\)/.test(r.formula))
      .every((r) => r.observed === p.OBSERVED.FORK_EXECUTED && typeof r.evidence === "string" && r.evidence.length > 40),
    "a derivation is claimed at a strength its evidence does not carry, or claimed with no evidence at all",
  );
  emit(
    "no derivation claims REVERT_NAMED_IT on the strength of an executed write",
    p.RESOURCE_DERIVATIONS.filter((r) => r.observed === p.OBSERVED.REVERT_NAMED_IT)
      .every((r) => !/executed on the fork/.test(String(r.evidence ?? ""))),
    "a fork execution is being passed off as the contract quoting itself in revert data",
  );
  emit(
    "the delegation mechanism records both the refused grantRoles and an accepted control",
    p.DELEGATION_MECHANISM.rows.some((r) => r.accepted === false && /grantRoles/.test(r.call)) &&
      p.DELEGATION_MECHANISM.rows.some((r) => r.accepted === true && /authorizeTextRoles/.test(r.call)),
    "one half of the pair is missing, so the delegation finding proves nothing",
  );
  emit(
    "the delegation mechanism records the per-key refusal AND the same agent's accepted write",
    p.DELEGATION_MECHANISM.rows.some((r) => r.accepted === true && /setText\(node, 'unica\.treasury\.status'/.test(r.call)) &&
      p.DELEGATION_MECHANISM.rows.some((r) => r.accepted === false && /setText\(node, 'unica\.treasury\.other'/.test(r.call)),
    "per-key scoping is claimed without the control that separates 'scoped' from 'powerless'",
  );
  emit(
    "the refuted gas estimate is named as refuted rather than deleted",
    /REFUTED/.test(String(p.DELEGATION_GAS.note ?? "")) && /45181/.test(String(p.DELEGATION_GAS.note ?? "")),
    "a wrong number was quietly removed instead of being corrected in place",
  );
  emit(
    "the unresolved list is not empty",
    p.UNRESOLVED.length > 0,
    "a survey of a deployment this size that resolved everything has stopped looking",
  );
  emit(
    "every unresolved entry says what was asked and what came back",
    p.UNRESOLVED.every((u) => u.question && u.why && u.why.length > 80),
    "an unresolved entry has no evidence trail",
  );
}

const bitIndex = (b) => { let i = 0, x = BigInt(b); while (x > 1n) { x >>= 1n; i++; } return i; };

// ── running ───────────────────────────────────────────────────────────────────────────────────

function suite(p) {
  let pass = 0, fail = 0;
  const lines = [];
  runChecks(p, (name, ok, detail) => {
    if (ok) { pass++; lines.push(`PASS  ${name}`); }
    else { fail++; lines.push(`FAIL  ${name}\n      ${detail}`); }
  });
  return {pass, fail, lines};
}

/// A shallow clone deep enough to mutate one field without touching the real module. The module's
/// functions are carried across by reference on purpose: a mutation must be caught by the CHECKS,
/// not by the derivation quietly changing along with the pin.
const clone = (p) => ({
  ...p,
  EVIDENCE_SAMPLE: {...p.EVIDENCE_SAMPLE},
  DEPLOYMENT: p.DEPLOYMENT.map((d) => ({...d})),
  ERROR_SELECTOR_OBSERVED: {...p.ERROR_SELECTOR_OBSERVED},
  REGISTRY_ROLE: Object.fromEntries(Object.entries(p.REGISTRY_ROLE).map(([k, v]) => [k, {...v}])),
  RESOLVER_ROLE: Object.fromEntries(Object.entries(p.RESOLVER_ROLE).map(([k, v]) => [k, {...v}])),
  ADMIN_ROLE_RULE: {...p.ADMIN_ROLE_RULE, rows: p.ADMIN_ROLE_RULE.rows.map((r) => ({...r}))},
  RESOURCE_DERIVATIONS: p.RESOURCE_DERIVATIONS.map((r) => ({...r})),
  WILDCARD: {...p.WILDCARD, rows: p.WILDCARD.rows.map((r) => ({...r}))},
  UNRESOLVED: p.UNRESOLVED.map((u) => ({...u})),
});

const SABOTAGE = [
  {
    what: "the resolver's name-level resource is off by one byte",
    apply: (p) => { p.EVIDENCE_SAMPLE.resolverNameResource = "0x0bfdc7d18a681d5f09834ebfaa1611fe18af3c4a6f4f1a276c3a0734c4885e62"; },
  },
  {
    what: "the registry resource is pinned as the raw labelhash, version bits and all",
    apply: (p) => { p.EVIDENCE_SAMPLE.registryResource = "0xcb0cbc8493baf4a7b1972914ba0be89040e56e4a3c98d60268fe37b8c8e546d9"; },
  },
  {
    what: "EACCannotGrantRoles is pinned to the selector of the OTHER refusal",
    apply: (p) => { p.ERROR_SELECTOR_OBSERVED.EACCannotGrantRoles = "0x4b27a133"; },
  },
  {
    what: "ROLE_CAN_TRANSFER_ADMIN is pinned unshifted, as 1<<28",
    apply: (p) => { p.REGISTRY_ROLE_CAN_TRANSFER_ADMIN = {...p.REGISTRY_ROLE_CAN_TRANSFER_ADMIN, bit: 1n << 28n}; },
  },
  {
    what: "two resolver roles are pushed into the same nybble",
    apply: (p) => { p.RESOLVER_ROLE.SET_TEXT = {...p.RESOLVER_ROLE.SET_TEXT, bit: 1n << 2n}; },
  },
  {
    what: "the assignee cap is pinned as 16",
    apply: (p) => { p.MAX_ASSIGNEES_PER_ROLE = 16n; },
  },
  {
    what: "the two registries are pinned with different code hashes",
    apply: (p) => { p.DEPLOYMENT.find((d) => d.name === "RootRegistry").codeHash = "0x" + "0".repeat(64); },
  },
  {
    what: "the proxy chain is cut in the middle",
    apply: (p) => { p.PROXY_CHAIN = [{...p.PROXY_CHAIN[0], to: "0x0000000000000000000000000000000000000001"}, {...p.PROXY_CHAIN[1]}]; },
  },
  {
    what: "a per-text-key resource is upgraded from an executed write to revert data",
    apply: (p) => {
      const r = p.RESOURCE_DERIVATIONS.find((x) => /keccak256\(bytes\(key\)\)/.test(x.formula));
      r.observed = p.OBSERVED.REVERT_NAMED_IT;
    },
  },
  {
    what: "the per-key derivation is claimed observed with its evidence stripped out",
    apply: (p) => {
      const r = p.RESOURCE_DERIVATIONS.find((x) => /keccak256\(bytes\(key\)\)/.test(x.formula));
      r.evidence = "observed";
    },
  },
  {
    what: "the refused grantRoles row is dropped, leaving the delegation looking like a free choice",
    apply: (p) => {
      p.DELEGATION_MECHANISM = {...p.DELEGATION_MECHANISM,
        rows: p.DELEGATION_MECHANISM.rows.filter((r) => !/grantRoles/.test(r.call))};
    },
  },
  {
    what: "the agent's ACCEPTED write is dropped, so 'scoped' cannot be told from 'powerless'",
    apply: (p) => {
      p.DELEGATION_MECHANISM = {...p.DELEGATION_MECHANISM,
        rows: p.DELEGATION_MECHANISM.rows
          .filter((r) => !(r.accepted === true && /setText\(node, 'unica\.treasury\.status'/.test(r.call)))};
    },
  },
  {
    what: "the refuted gas estimate is quietly deleted instead of corrected in place",
    apply: (p) => { p.DELEGATION_GAS = {...p.DELEGATION_GAS, note: "measured on a fork"}; },
  },
  {
    what: "the accepted control is dropped from the admin-role rule, leaving only the refusal",
    apply: (p) => { p.ADMIN_ROLE_RULE.rows = p.ADMIN_ROLE_RULE.rows.filter((r) => r.observed !== p.OBSERVED.ACCEPTED_IN_SIMULATION); },
  },
  {
    what: "the unresolved list is emptied",
    apply: (p) => { p.UNRESOLVED = []; },
  },
  {
    what: "the non-reverting wildcard row is removed",
    apply: (p) => { p.WILDCARD.rows = p.WILDCARD.rows.filter((r) => !/UNREGISTERED and it still RESOLVED/.test(r.meaning)); },
  },
];

const selfTest = process.argv.includes("--self-test");

console.log("ENSv2 deployment profile — offline derivation check");
console.log(`profile pinned at Sepolia block ${P.PIN_BLOCK}, retrieved ${P.RETRIEVED}`);
console.log(`chain ${P.CHAIN_ID} (${P.CHAIN_NAME})`);
console.log("no network is used by this runner\n");

const base = suite(P);
for (const l of base.lines) console.log(l);

let extraRun = 0, extraPass = 0, extraFail = 0;

if (selfTest) {
  console.log("\n— sabotage: each mutation must turn the suite RED —");
  for (const s of SABOTAGE) {
    extraRun++;
    const p = clone(P);
    s.apply(p);
    const r = suite(p);
    if (r.fail > 0) { extraPass++; console.log(`PASS  caught: ${s.what} (${r.fail} row(s) went red)`); }
    else { extraFail++; console.log(`FAIL  NOT caught: ${s.what} — the suite stayed green, so it does not check this`); }
  }
  // Restoring is trivial here because nothing was mutated in place: every sabotage ran against a
  // clone and the real module was never touched. This row states that rather than assuming it.
  const after = suite(P);
  extraRun++;
  if (after.pass === base.pass && after.fail === base.fail) {
    extraPass++; console.log(`PASS  the profile is unchanged after sabotage (${after.pass} passed, ${after.fail} failed, same as before)`);
  } else {
    extraFail++; console.log(`FAIL  the profile changed during sabotage: was ${base.pass}/${base.fail}, now ${after.pass}/${after.fail}`);
  }
}

const run = base.pass + base.fail + extraRun;
const pass = base.pass + extraPass;
const fail = base.fail + extraFail;
console.log(`\nchecks run: ${run}, passed: ${pass}, failed: ${fail}`);
if (!selfTest) console.log("run with --self-test to prove these checks can fail");
process.exit(fail > 0 ? 1 : 0);
