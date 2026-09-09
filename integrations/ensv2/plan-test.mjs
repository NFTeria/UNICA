// The suite for the delegation planner: the role planner, the owner preview, and the plan builder.
//
//   node integrations/ensv2/plan-test.mjs
//
// WHAT IT IS FOR. `roles.mjs` decides what authority a delegated agent gets. That decision is the
// most dangerous one in this repository — it is the only place where something other than the owner
// is given the ability to write to a name a payer reads. So the suite is built the way the repo
// requires and not the way that is quickest: every guard has a PASSING CONTROL beside its failing
// row, because a refusal from a builder that refuses everything proves nothing, and every claim
// that something is impossible is made by feeding the planner exactly that thing and watching it
// say no with a named reason.
//
// THE CONTROLS ARE NOT DECORATION. Two of them found real defects while this file was being
// written. The first: the assignee-cap check was reading the maxima word right-aligned, so a grant
// of SET_TEXT (nybble 1) was compared against nybble 0's maximum and refused with a full-looking
// 0/0. It was caught by the control that asserts a good grant passes, not by any of the rows that
// assert bad grants fail. The second: the preview named a REGISTRY bitmap using the RESOLVER's role
// table, which printed a confident and entirely wrong list of permissions for the one irreversible
// transaction in the plan.
//
// A NOTE ON TWO STRING LITERALS. `permissioned-test.mjs` scans every .mjs file in this directory
// and fails if one names a writing JSON-RPC method in code position. This file needs those names to
// prove its own scanner fires, so it builds them by concatenation. That is not a way around the
// rule — the rule is that this directory must not CALL them, and a name assembled from two halves
// calls nothing. It is written this way rather than hidden in a comment because a scanner whose
// control lives in a comment has no control.

import {readFileSync, readdirSync} from "node:fs";

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {utf8} from "../permit2/digest.mjs";
import {namehash, dnsEncode} from "../../web/ensv2/resolve.mjs";
import {SELECTOR, selectorFor, SIGNATURES} from "./permissioned.mjs";
import * as P from "./profile.mjs";
import * as R from "./roles.mjs";
import * as V from "./plan-preview.mjs";
import * as PLAN from "../../script/ensv2/plan.mjs";

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ""}`); }
};
const eq = (label, got, want) => check(label, got === want, `got ${String(got)}, wanted ${String(want)}`);
const refusedWith = (label, result, status) =>
  check(label, result?.ok === false && result?.status === status,
        `got ok=${result?.ok} status=${result?.status}`);

const asWord = (v) => "0x" + BigInt(v).toString(16).padStart(64, "0");
/// Role bitmaps are BigInt, and plain JSON.stringify throws on one. A detail string that throws
/// takes the whole suite down and leaves no summary at all, which is how a red run reads as a
/// pass — so every detail here goes through this.
const j = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x));
const body = (d) => String(d).replace(/^0x/, "");
const argWord = (d, i) => body(d).slice(8 + i * 64, 8 + (i + 1) * 64);
const argUint = (d, i) => BigInt("0x" + argWord(d, i));
const argAddr = (d, i) => {
  const wd = argWord(d, i);
  if (!/^0{24}/.test(wd)) throw new Error("an address word has dirty upper bits");
  return "0x" + wd.slice(24);
};
const argString = (d, i) => {
  const off = Number(argUint(d, i));
  const at = 8 + off * 2;
  const len = parseInt(body(d).slice(at, at + 64), 16);
  const hex = body(d).slice(at + 64, at + 64 + len * 2);
  return new TextDecoder().decode(Uint8Array.from(hex.match(/../g)?.map((h) => parseInt(h, 16)) ?? []));
};
const argBytesArray = (d, byteOffset) => {
  const base = 8 + byteOffset * 2;
  const n = parseInt(body(d).slice(base, base + 64), 16);
  const headBase = base + 64;
  const out = [];
  for (let i = 0; i < n; i++) {
    const off = parseInt(body(d).slice(headBase + i * 64, headBase + (i + 1) * 64), 16);
    const p = headBase + off * 2;
    const len = parseInt(body(d).slice(p, p + 64), 16);
    out.push("0x" + body(d).slice(p + 64, p + 64 + len * 2));
  }
  return out;
};

// ── the fixture, kept together so a row can say which input it changed ────────────────────────
//
// Every address is a repeated nybble so nothing here can be mistaken for a real deployment. The
// policy values are deliberately distinctive strings, because a later section scans the entire
// serialised plan for them and a value like "1" would match everywhere and prove nothing.

const MERCHANT = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";
const RESOLVER = "0x3333333333333333333333333333333333333333";
const PARENT_REGISTRY = "0x4444444444444444444444444444444444444444";
const MERCHANT_SUBREGISTRY = "0x5555555555555555555555555555555555555555";
const TREASURY_SUBREGISTRY = "0x6666666666666666666666666666666666666666";
const RECIPIENT = "0x7777777777777777777777777777777777777777";
const TOKEN = "0x8888888888888888888888888888888888888888";
const EXECUTOR = "0x9999999999999999999999999999999999999999";
const OUTSIDER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const SECRET = {
  thresholdWei: "133731337000000",
  allocationBps: "4242",
  reserveWei: "919191919",
  salt: "salt-value-x9-do-not-publish",
};

const fullReading = (bitmap, count = 0) => {
  let counts = 0n, maxima = 0n;
  for (let n = 0n; n < 64n; n++) {
    if (((BigInt(bitmap) >> (4n * n)) & 0xfn) === 0n) continue;
    counts |= BigInt(count) << (4n * n);
    maxima |= 0xfn << (4n * n);
  }
  return {roleBitmap: asWord(bitmap), counts: asWord(counts), maxima: asWord(maxima)};
};

const SET_TEXT = BigInt(P.RESOLVER_ROLE.SET_TEXT.bit);

const CFG = {
  parent: "owner-chosen-parent.eth",
  merchantOwner: MERCHANT, agentAddress: AGENT, resolver: RESOLVER,
  parentSubregistry: PARENT_REGISTRY,
  merchantSubregistry: MERCHANT_SUBREGISTRY, treasurySubregistry: TREASURY_SUBREGISTRY,
  settlement: {recipient: RECIPIENT, token: TOKEN, executor: EXECUTOR},
  policy: {...SECRET},
  expiry: "2000000000",
  observations: {
    agentRootRolesAtResolver: "0x0", resolverCodeSize: 77, merchantMayGrantAtAgentResource: true,
    assigneeReading: fullReading(SET_TEXT, 0),
  },
};

const AGENT_NODE = namehash("agent.treasury.merchant.owner-chosen-parent.eth");
// The resource a delegation ACTUALLY lands at on this deployment: the per-KEY one, not the
// name-level one. The name-level resource is kept beside it because several rows below exist to
// prove that a grant aimed there is refused — and because a validator reading it sees zero while
// the agent can write, which is the whole of CRITICAL 2.
const AGENT_KEY = R.RECORD_KEYS.agentCapabilities;
const AGENT_RESOURCE = P.resolverScopedResource(AGENT_NODE, P.textScopeHash(AGENT_KEY));
const AGENT_NAME_RESOURCE = P.resolverNameResource(AGENT_NODE);
const AGENT_DNS = dnsEncode("agent.treasury.merchant.owner-chosen-parent.eth");
const PAY_NODE = namehash("pay.merchant.owner-chosen-parent.eth");
const TREASURY_NODE = namehash("treasury.merchant.owner-chosen-parent.eth");
const MERCHANT_NODE = namehash("merchant.owner-chosen-parent.eth");
const PAY_RESOURCE = P.resolverNameResource(PAY_NODE);
const TREASURY_RESOURCE = P.resolverNameResource(TREASURY_NODE);
const MERCHANT_RESOURCE = P.resolverNameResource(MERCHANT_NODE);

const grantOpts = (over = {}) => ({
  resolver: RESOLVER, agentNode: AGENT_NODE, agentDnsName: AGENT_DNS,
  agentAddress: AGENT, merchantAddress: MERCHANT,
  recordKey: AGENT_KEY, roleNames: ["SET_TEXT"],
  protectedResources: [MERCHANT_RESOURCE, PAY_RESOURCE, TREASURY_RESOURCE],
  registryAddresses: [PARENT_REGISTRY, MERCHANT_SUBREGISTRY, TREASURY_SUBREGISTRY],
  agentRootRoles: "0x0",
  assigneeReading: fullReading(SET_TEXT, 0),
  ...over,
});

const screenCtx = (over = {}) => ({
  agentResource: AGENT_RESOURCE, agentAddress: AGENT, merchantAddress: MERCHANT,
  protectedResources: [MERCHANT_RESOURCE, PAY_RESOURCE, TREASURY_RESOURCE],
  registryAddresses: [PARENT_REGISTRY, MERCHANT_SUBREGISTRY, TREASURY_SUBREGISTRY],
  agentRootRoles: "0x0",
  ...over,
});

// The EFFECTIVE triple an authorizeTextRoles delegation writes. The screen is fed this rather
// than the calldata, because the calldata names neither a resource nor a bitmap.
const goodCall = (over = {}) => ({
  method: "authorizeTextRoles", to: RESOLVER, resource: AGENT_RESOURCE,
  roleBitmap: asWord(SET_TEXT), account: AGENT, ...over,
});

try {

console.log("— calldata decodes back to what the row claims it says —");
{
  // A preview is only worth reading if the bytes under it mean what the decoded row says. Each
  // encoder is therefore taken apart again here, by a decoder written independently of it.
  const g = R.encodeGrantRolesCall(AGENT_RESOURCE, SET_TEXT, AGENT);
  eq("grantRoles' selector is derived from its signature", g.slice(0, 10), selectorFor(SIGNATURES.grantRoles));
  eq("... and matches the module's own selector table", g.slice(0, 10), SELECTOR.grantRoles);
  eq("grantRoles argument 0 decodes to the agent's leaf resource", asWord(argUint(g, 0)), AGENT_RESOURCE);
  eq("grantRoles argument 1 decodes to the SET_TEXT bit from the profile", argUint(g, 1), SET_TEXT);
  eq("grantRoles argument 2 decodes to the agent", argAddr(g, 2), AGENT);
  eq("the whole call is a selector and three words", body(g).length, 8 + 3 * 64);

  const rv = R.encodeRevokeRolesCall(AGENT_RESOURCE, SET_TEXT, AGENT);
  eq("revokeRoles' selector is derived from its signature", rv.slice(0, 10), selectorFor(SIGNATURES.revokeRoles));
  check("the grant and the revocation differ ONLY in the selector",
        rv.slice(10) === g.slice(10) && rv.slice(0, 10) !== g.slice(0, 10));

  const reg = PLAN.encodeRegisterCall("merchant", MERCHANT, ZERO_ADDRESS, ZERO_ADDRESS, 0x110000n, 2000000000n);
  eq("register's selector is derived from its signature", reg.slice(0, 10), selectorFor(P.REGISTRY_SIGNATURES.register));
  eq("register's dynamic label decodes back", argString(reg, 0), "merchant");
  eq("register's owner argument decodes back", argAddr(reg, 1), MERCHANT);
  eq("register's roleBitmap argument decodes back", argUint(reg, 4), 0x110000n);
  eq("register's expiry argument decodes back", argUint(reg, 5), 2000000000n);

  const sr = PLAN.encodeSetResolverCall(AGENT_RESOURCE, RESOLVER);
  eq("setResolver's selector is derived from its signature", sr.slice(0, 10), selectorFor(P.REGISTRY_SIGNATURES.setResolver));
  eq("setResolver's resolver argument decodes back", argAddr(sr, 1), RESOLVER);

  const ss = PLAN.encodeSetSubregistryCall(AGENT_RESOURCE, PARENT_REGISTRY);
  eq("setSubregistry's selector is derived from its signature", ss.slice(0, 10), selectorFor(P.REGISTRY_SIGNATURES.setSubregistry));
  eq("setSubregistry's registry argument decodes back", argAddr(ss, 1), PARENT_REGISTRY);

  const inner = [R.encodeGrantRolesCall(AGENT_RESOURCE, SET_TEXT, AGENT), "0xdeadbeef", "0x" + "ab".repeat(97)];
  const mc = PLAN.encodeMulticallWithNodeCheck(AGENT_NODE, inner);
  eq("multicallWithNodeCheck's selector is derived from its signature",
     mc.slice(0, 10), selectorFor(P.RESOLVER_EXTRA_SIGNATURES.multicallWithNodeCheck));
  eq("... its node argument decodes back", "0x" + argWord(mc, 0), AGENT_NODE);
  eq("... its array head points at 0x40", argUint(mc, 1), 0x40n);
  const back = argBytesArray(mc, 0x40);
  check("... and all three members decode back byte for byte, including one of odd length",
        back.length === 3 && back.every((b, i) => b.toLowerCase() === inner[i].toLowerCase()),
        j(back));

  // CONTROL for the decoder itself. If the decoder cannot be made to disagree, none of the rows
  // above mean anything: they would pass against calldata that says something else entirely.
  // Two of the array's element heads are swapped, so members 0 and 1 come back in each other's
  // places. The bytes are all still there and the length is untouched: only a decoder that really
  // follows the heads can notice, which is exactly the property the rows above rely on.
  const headBase = 8 + 0x40 * 2 + 64;
  const corrupted = mc.slice(0, headBase) + mc.slice(headBase + 64, headBase + 128) +
                    mc.slice(headBase, headBase + 64) + mc.slice(headBase + 128);
  let decoderNoticed = false;
  try {
    const bad = argBytesArray(corrupted, 0x40);
    decoderNoticed = bad.length !== 3 || bad.some((b, i) => b.toLowerCase() !== inner[i].toLowerCase());
  } catch { decoderNoticed = true; }
  check("the decoder DISAGREES when two element heads are swapped, so its agreement above is evidence", decoderNoticed);
}

console.log("\n— bitmaps come from the profile, and a role the chain never named is not grantable —");
{
  const b = R.agentRoleBitmap(["SET_TEXT"]);
  check("CONTROL a default agent bitmap is produced", b.ok === true, j(b));
  eq("... and it is exactly the profile's SET_TEXT bit", b.bitmap, SET_TEXT);
  eq("... and it sets no bit in the admin half", b.bitmap >> P.ADMIN_SHIFT, 0n);
  const two = R.agentRoleBitmap(["SET_TEXT", "SET_ADDR"]);
  eq("two allowlisted roles OR together", two.bitmap, SET_TEXT | BigInt(P.RESOLVER_ROLE.SET_ADDR.bit));

  refusedWith("a role outside the allowlist is refused by name",
              R.agentRoleBitmap(["SET_CONTENTHASH"]), R.GRANT_STATUS.ROLE_NOT_ALLOWLISTED);
  refusedWith("a role that does not exist at all is refused",
              R.agentRoleBitmap(["SET_EVERYTHING"]), R.GRANT_STATUS.ROLE_NOT_ALLOWLISTED);
  refusedWith("an empty role list is refused rather than encoded as zero",
              R.agentRoleBitmap([]), R.GRANT_STATUS.EMPTY_BITMAP);

  // SABOTAGE, in memory, restored and re-checked. The rule under test is that an allowlisted role
  // whose profile row is only DOCUMENTED is still refused — the allowlist and the evidence label
  // are two separate gates and both must hold.
  const row = P.RESOLVER_ROLE.SET_ADDR;
  const before = row.observed;
  check("CONTROL SET_ADDR is grantable while its profile row says the chain named it",
        R.agentRoleBitmap(["SET_ADDR"]).ok === true);
  row.observed = P.OBSERVED.DOCUMENTED_NOT_OBSERVED;
  refusedWith("... and is refused the moment its row is downgraded to documented-only",
              R.agentRoleBitmap(["SET_ADDR"]), R.GRANT_STATUS.ROLE_NOT_OBSERVED);
  row.observed = before;
  check("... and the profile row is restored exactly", P.RESOLVER_ROLE.SET_ADDR.observed === before);
  check("... and SET_ADDR is grantable again, so the restore is real and not just asserted",
        R.agentRoleBitmap(["SET_ADDR"]).ok === true);
}

console.log("\n— the registry and the resolver assign different meanings to the same bit —");
{
  // This is not a stylistic point. 1<<24 is SET_RESOLVER on a registry and SET_NAME on a resolver,
  // so a preview that picks the wrong table prints a fluent, readable, wrong list of permissions
  // for the one transaction in the plan that cannot be undone.
  const bit24 = 1n << 24n;
  eq("1<<24 is SET_NAME in the resolver's table", R.describeResolverBitmap(bit24).named.join(), "SET_NAME");
  eq("1<<24 is SET_RESOLVER in the registry's table", R.describeRegistryBitmap(bit24).named.join(), "SET_RESOLVER");
  check("the two tables disagree about this bit, which is the whole reason the caller must choose",
        R.describeResolverBitmap(bit24).named.join() !== R.describeRegistryBitmap(bit24).named.join());
  eq("an admin bit is named as ADMIN(role), not as the role",
     R.describeResolverBitmap(P.adminRole(SET_TEXT)).named.join(), "ADMIN(SET_TEXT)");
  check("an admin bit sets the isAdmin flag", R.describeResolverBitmap(P.adminRole(SET_TEXT)).isAdmin === true);
  // A bit with no name is the most interesting bit in the word, so it is reported rather than
  // dropped out of the list and never mentioned again.
  const odd = 1n << 3n;
  eq("an unrecognised bit is reported as unrecognised", R.describeResolverBitmap(odd).unrecognised, asWord(odd));
  eq("... and a fully-named bitmap reports none", R.describeResolverBitmap(SET_TEXT).unrecognised, null);
  eq("the registry table names its already-shifted CAN_TRANSFER_ADMIN bit",
     R.describeRegistryBitmap(P.REGISTRY_ROLE_CAN_TRANSFER_ADMIN.bit).named.join(), "CAN_TRANSFER_ADMIN");
}

console.log("\n— the screen: the control first, then every way a grant is refused —");
{
  const ok = R.screenAgentGrant(goodCall(), screenCtx());
  check("CONTROL a correctly scoped grant passes the screen", ok.ok === true && ok.status === R.GRANT_STATUS.PLANNED,
        j(ok));

  refusedWith("a grant naming ROOT_RESOURCE is refused",
              R.screenAgentGrant(goodCall({resource: asWord(0n)}), screenCtx()), R.GRANT_STATUS.ROOT_RESOURCE_FORBIDDEN);
  refusedWith("grantRootRoles is refused by method name, whatever its arguments say",
              R.screenAgentGrant(goodCall({method: "grantRootRoles"}), screenCtx()), R.GRANT_STATUS.ROOT_ROLES_METHOD_FORBIDDEN);
  refusedWith("revokeRootRoles is refused too — it is the same contract-wide surface",
              R.screenAgentGrant(goodCall({method: "revokeRootRoles"}), screenCtx()), R.GRANT_STATUS.ROOT_ROLES_METHOD_FORBIDDEN);
  refusedWith("an admin bit anywhere in the upper 128 is refused",
              R.screenAgentGrant(goodCall({roleBitmap: asWord(P.adminRole(SET_TEXT))}), screenCtx()),
              R.GRANT_STATUS.ADMIN_ROLE_FORBIDDEN);
  refusedWith("a regular role ORed with its own admin is still refused",
              R.screenAgentGrant(goodCall({roleBitmap: asWord(SET_TEXT | P.adminRole(SET_TEXT))}), screenCtx()),
              R.GRANT_STATUS.ADMIN_ROLE_FORBIDDEN);
  refusedWith("a bit outside the allowlist is refused even though it is a real resolver role",
              R.screenAgentGrant(goodCall({roleBitmap: asWord(P.RESOLVER_ROLE.CLEAR.bit)}), screenCtx()),
              R.GRANT_STATUS.ROLE_NOT_ALLOWLISTED);
  refusedWith("an empty bitmap is refused",
              R.screenAgentGrant(goodCall({roleBitmap: asWord(0n)}), screenCtx()), R.GRANT_STATUS.EMPTY_BITMAP);
  refusedWith("a grant at the merchant's own name resource is refused as protected",
              R.screenAgentGrant(goodCall({resource: MERCHANT_RESOURCE}), screenCtx()), R.GRANT_STATUS.PROTECTED_RESOURCE);
  refusedWith("a grant at the payment name's resource is refused as protected",
              R.screenAgentGrant(goodCall({resource: PAY_RESOURCE}), screenCtx()), R.GRANT_STATUS.PROTECTED_RESOURCE);
  // The gap this row exists for, found by inspection after the delegation moved to per-key
  // resources: `protectedResources` lists NAME-LEVEL resources, and a per-key resource on a
  // protected name is not one of them. Screening a delegation at the pay name's per-key resource
  // against that list PASSED. The screen now checks the protected NAMES by node, at any scope.
  {
    const payPerKey = P.resolverScopedResource(PAY_NODE, P.textScopeHash(R.RECORD_KEYS.executor));
    refusedWith("a delegation at a PER-KEY resource on the payment name is refused as protected",
                R.screenAgentGrant(
                  goodCall({resource: payPerKey, node: PAY_NODE}),
                  screenCtx({agentResource: payPerKey, protectedNodes: [MERCHANT_NODE, PAY_NODE, TREASURY_NODE]})),
                R.GRANT_STATUS.PROTECTED_RESOURCE);
    check("CONTROL the same shape on the AGENT's own name is accepted, so the row above is about the name",
          R.screenAgentGrant(goodCall({node: AGENT_NODE}),
                             screenCtx({protectedNodes: [MERCHANT_NODE, PAY_NODE, TREASURY_NODE]})).ok === true);
    check("... and the refusal names the NODE, so a reader can tell which name it was",
          R.screenAgentGrant(
            goodCall({resource: payPerKey, node: PAY_NODE}),
            screenCtx({agentResource: payPerKey, protectedNodes: [PAY_NODE]})).node === PAY_NODE);
  }
  refusedWith("a grant at the treasury's resource is refused as protected",
              R.screenAgentGrant(goodCall({resource: TREASURY_RESOURCE}), screenCtx()), R.GRANT_STATUS.PROTECTED_RESOURCE);
  refusedWith("a grant at some other resource entirely is refused as the wrong resource",
              R.screenAgentGrant(goodCall({resource: asWord(0x1234n)}), screenCtx()), R.GRANT_STATUS.WRONG_RESOURCE);
  refusedWith("a grant screened with no agent resource to compare against is refused, not waved through",
              R.screenAgentGrant(goodCall(), screenCtx({agentResource: null})), R.GRANT_STATUS.WRONG_RESOURCE);
  refusedWith("a grant sent to a registry is refused by target",
              R.screenAgentGrant(goodCall({to: PARENT_REGISTRY}), screenCtx()), R.GRANT_STATUS.REGISTRY_TARGET_FORBIDDEN);
  refusedWith("a grant to the zero address is refused",
              R.screenAgentGrant(goodCall({account: ZERO_ADDRESS}), screenCtx()), R.GRANT_STATUS.BAD_ACCOUNT);
  refusedWith("a grant to something that is not an address is refused",
              R.screenAgentGrant(goodCall({account: "not-an-address"}), screenCtx()), R.GRANT_STATUS.BAD_ACCOUNT);
  refusedWith("a grant to a third party who is not this plan's agent is refused",
              R.screenAgentGrant(goodCall({account: OUTSIDER}), screenCtx()), R.GRANT_STATUS.BAD_ACCOUNT);
  refusedWith("a grant to the merchant itself is refused — a delegation to yourself cannot be revoked",
              R.screenAgentGrant(goodCall({account: MERCHANT}), screenCtx({agentAddress: MERCHANT})),
              R.GRANT_STATUS.AGENT_IS_MERCHANT);
  refusedWith("a grant is refused while the agent already holds anything at ROOT_RESOURCE",
              R.screenAgentGrant(goodCall(), screenCtx({agentRootRoles: asWord(1n)})),
              R.GRANT_STATUS.AGENT_HOLDS_ROOT_ROLES);

  // The ordering rule: a call that is wrong in two ways names the one the reader must act on.
  eq("a call that names ROOT_RESOURCE and an admin bit reports the root resource first",
     R.screenAgentGrant(goodCall({resource: asWord(0n), roleBitmap: asWord(P.adminRole(SET_TEXT))}), screenCtx()).status,
     R.GRANT_STATUS.ROOT_RESOURCE_FORBIDDEN);

  // ── the call this deployment REFUSES, refused here too ────────────────────────────────────
  //
  // A perfectly scoped grantRoles — right resource, right bitmap, right account — is still
  // refused, because on this deployment it reverts. Emitting it would produce a transaction the
  // owner signs and pays for and that fails, leaving the agent with no authority while the plan
  // reports success. The CONTROL beside it is the identical call under the accepted method, which
  // is what proves the refusal is about the method and not about the arguments.
  refusedWith("a correctly scoped grantRoles is refused: it is not the delegation path here",
              R.screenAgentGrant(goodCall({method: "grantRoles"}), screenCtx()),
              R.GRANT_STATUS.GRANT_ROLES_NOT_THE_DELEGATION_PATH);
  refusedWith("... and so is revokeRoles, which fails the same way",
              R.screenAgentGrant(goodCall({method: "revokeRoles"}), screenCtx()),
              R.GRANT_STATUS.GRANT_ROLES_NOT_THE_DELEGATION_PATH);
  check("CONTROL the identical call under authorizeTextRoles passes, so it is the METHOD that is refused",
        R.screenAgentGrant(goodCall({method: "authorizeTextRoles"}), screenCtx()).ok === true);
  // The wide sibling: accepted by the chain, and refused here by NAME before any argument is read.
  refusedWith("authorizeNameRoles is refused by name — it writes at the name level",
              R.screenAgentGrant(goodCall({method: "authorizeNameRoles"}), screenCtx()),
              R.GRANT_STATUS.NAME_LEVEL_METHOD_FORBIDDEN);
  // Ordering: a grantRoles that is ALSO dangerous must report the danger, not the method.
  refusedWith("a grantRoles naming ROOT_RESOURCE still reports ROOT_RESOURCE first",
              R.screenAgentGrant(goodCall({method: "grantRoles", resource: asWord(0n)}), screenCtx()),
              R.GRANT_STATUS.ROOT_RESOURCE_FORBIDDEN);
  refusedWith("a grantRoles carrying an admin bit still reports the admin bit first",
              R.screenAgentGrant(goodCall({method: "grantRoles", roleBitmap: asWord(P.adminRole(SET_TEXT))}), screenCtx()),
              R.GRANT_STATUS.ADMIN_ROLE_FORBIDDEN);

  // ── the scope key ─────────────────────────────────────────────────────────────────────────
  refusedWith("a delegation with no record key is refused rather than falling back to the name level",
              R.planAgentGrant({...grantOpts(), recordKey: undefined}), R.GRANT_STATUS.SCOPE_KEY_MISSING);
  refusedWith("a delegation scoped to a key outside the published vocabulary is refused",
              R.planAgentGrant({...grantOpts(), recordKey: "unica:not-a-published-key"}),
              R.GRANT_STATUS.SCOPE_KEY_NOT_ALLOWLISTED);
  refusedWith("a DNS name that does not hash to the agent node is refused",
              R.planAgentGrant({...grantOpts(), agentDnsName: dnsEncode("someone.else.eth")}),
              R.GRANT_STATUS.WRONG_RESOURCE);
  check("CONTROL the matching DNS name and node are accepted, so the row above is not vacuous",
        R.planAgentGrant(grantOpts()).ok === true);
  // The DNS decoder, checked both ways round.
  eq("a DNS-encoded name hashes back to its namehash", R.namehashFromDns(AGENT_DNS), AGENT_NODE);
  eq("trailing rubbish after the DNS terminator is rejected, not ignored",
     R.namehashFromDns(AGENT_DNS + "ff"), null);
  eq("a DNS name with no terminator is rejected", R.namehashFromDns("0x05726166667903657468"), null);

}

console.log("\n— the assignee cap, read from the contract's own second word —");
{
  const okRow = R.checkAssigneeHeadroom(fullReading(SET_TEXT, 0), SET_TEXT);
  check("CONTROL an empty role at this resource has headroom", okRow.ok === true, j(okRow));
  eq("... and the maximum is read out of the reading, not hard-coded", okRow.rows[0].max, 15);
  check("CONTROL fourteen assignees still leaves room", R.checkAssigneeHeadroom(fullReading(SET_TEXT, 14), SET_TEXT).ok === true);
  refusedWith("fifteen assignees is refused", R.checkAssigneeHeadroom(fullReading(SET_TEXT, 15), SET_TEXT),
              R.GRANT_STATUS.ASSIGNEE_CAP_REACHED);
  refusedWith("no reading at all is refused — unchecked is not the same as satisfied",
              R.checkAssigneeHeadroom(null, SET_TEXT), R.GRANT_STATUS.ASSIGNEE_COUNT_UNOBSERVED);
  refusedWith("a reading missing its maxima word is refused",
              R.checkAssigneeHeadroom({roleBitmap: asWord(SET_TEXT), counts: asWord(0n)}, SET_TEXT),
              R.GRANT_STATUS.ASSIGNEE_COUNT_UNOBSERVED);
  refusedWith("a reading taken for a DIFFERENT role does not satisfy this grant",
              R.checkAssigneeHeadroom(fullReading(BigInt(P.RESOLVER_ROLE.SET_ADDR.bit), 0), SET_TEXT),
              R.GRANT_STATUS.ASSIGNEE_COUNT_UNOBSERVED);
  // The positional reading is the whole finding. A right-aligned 0x…0f would have satisfied a
  // SET_TEXT grant while describing SET_ADDR's slot, which is how this check silently passes.
  const rightAligned = {roleBitmap: asWord(SET_TEXT), counts: asWord(0n), maxima: asWord(0xfn)};
  refusedWith("a right-aligned maxima word does NOT satisfy a grant of a role in nybble 1",
              R.checkAssigneeHeadroom(rightAligned, SET_TEXT), R.GRANT_STATUS.ASSIGNEE_CAP_REACHED);
}

console.log("\n— the constructors derive the resource and refuse to be told it —");
{
  const g = R.planAgentGrant(grantOpts());
  check("CONTROL the grant is built", g.ok === true, j(g).slice(0, 300));
  eq("... at the leaf's name-level resource, derived from the namehash", g.call.resource, AGENT_RESOURCE);
  eq("... which is NOT the merchant's resource", g.call.resource === MERCHANT_RESOURCE, false);
  check("... and the row says no admin role and no root resource are involved",
        g.involvesAdminRole === false && g.involvesRootResource === false);

  // A caller-supplied resource is the input that would let a mistake upstream point a
  // correct-looking grant at the merchant's own name. It is ignored, and the row proves it.
  const told = R.planAgentGrant({...grantOpts(), resource: PAY_RESOURCE});
  eq("a caller-supplied resource is ignored; the derivation wins", told.call?.resource, AGENT_RESOURCE);
  // The delegation resource is now derived through `delegationScope`, so the injection a caller
  // would actually reach for is a pre-built scope. Sabotage proved this row was missing: with the
  // derivation replaced by `opts.scope ?? …` the whole suite stayed green.
  const toldScope = R.planAgentGrant({...grantOpts(), scope: {
    resource: PAY_RESOURCE, roleName: "SET_TEXT", scope: "someone else's name", derivation: "handed in",
  }});
  eq("a caller-supplied SCOPE is ignored too; node and key decide the resource",
     toldScope.call?.resource, AGENT_RESOURCE);
  eq("... and the derivation reported is the computed one, not the one handed in",
     toldScope.resourceDerivation, `keccak256(abi.encode(node, keccak256(bytes("${AGENT_KEY}"))))`);

  const rv = R.planAgentRevoke(grantOpts());
  check("CONTROL the revocation is built at the same resource with the same bitmap",
        rv.ok === true && rv.call.resource === g.call.resource && rv.call.roleBitmap === g.call.roleBitmap);
  check("the revocation does NOT require assignee headroom — refusing it would refuse the one call that frees a slot",
        R.planAgentRevoke({...grantOpts(), assigneeReading: fullReading(SET_TEXT, 15)}).ok === true);
  refusedWith("the grant DOES require it",
              R.planAgentGrant({...grantOpts(), assigneeReading: fullReading(SET_TEXT, 15)}),
              R.GRANT_STATUS.ASSIGNEE_CAP_REACHED);
  refusedWith("a grant with no assignee reading is refused",
              R.planAgentGrant({...grantOpts(), assigneeReading: undefined}),
              R.GRANT_STATUS.ASSIGNEE_COUNT_UNOBSERVED);
  refusedWith("a grant whose agent node is not a namehash is refused",
              R.planAgentGrant({...grantOpts(), agentNode: "0x1234"}), R.GRANT_STATUS.WRONG_RESOURCE);
  refusedWith("a grant whose resolver is not an address is refused",
              R.planAgentGrant({...grantOpts(), resolver: "the resolver"}), R.GRANT_STATUS.BAD_ACCOUNT);
}

console.log("\n— every step's DECLARED arguments are the arguments its calldata actually carries —");
{
  // This suite was fully green while the delegation step declared `resource / roleBitmap / account`
  // over calldata for `authorizeTextRoles(bytes,string,address,bool)` — three rows describing
  // arguments the bytes did not contain, in the one transaction that hands an agent authority. The
  // owner reads these rows to decide whether to sign. Nothing compared them to the bytes, so
  // nothing caught it. This block is that comparison.
  const plan = PLAN.buildPlan(CFG);
  check("CONTROL the plan builds", plan.ok === true);

  const withData = plan.steps.filter((s) => s.call?.data && Array.isArray(s.arguments) && s.arguments.length);
  check("there are steps with both calldata and declared arguments to compare", withData.length > 0,
        String(withData.length));

  // The signature is the source of truth for how many arguments there are and what they are called.
  let compared = 0;
  const mismatches = [];
  for (const st of withData) {
    const sig = st.call.signature;
    if (!sig) { mismatches.push(`${st.ordinal}: no signature on the call`); continue; }
    const types = sig.slice(sig.indexOf("(") + 1, sig.lastIndexOf(")"));
    const declared = types.length ? types.split(",") : [];
    compared++;
    if (declared.length !== st.arguments.length) {
      mismatches.push(`${st.ordinal} ${sig}: signature has ${declared.length} argument(s), the row declares ${st.arguments.length}`);
      continue;
    }
    declared.forEach((t, i) => {
      const got = st.arguments[i]?.type;
      // uint256/bytes32 are both rendered as words; the rows say which they mean, and the only
      // thing being checked here is that the row is not describing a DIFFERENT argument.
      const same = t === got || (t === "uint256" && got === "uint256") || (t === "bytes32" && got === "bytes32");
      if (!same) mismatches.push(`${st.ordinal} ${sig}: argument ${i} is ${t} in the signature, "${got}" in the row`);
    });
    // And the selector on the row is the selector of the signature it claims.
    if (st.call.data.slice(0, 10) !== selectorFor(sig)) {
      mismatches.push(`${st.ordinal}: selector ${st.call.data.slice(0, 10)} is not selectorFor("${sig}")`);
    }
  }
  check(`every step's declared arguments match its signature and selector (${compared} compared)`,
        mismatches.length === 0, mismatches.join(" | "));

  // The delegation step specifically, because it is the one that matters and the one that was wrong.
  const del = plan.steps.find((s) => s.call?.method === "authorizeTextRoles");
  eq("the delegation step declares four arguments", del.arguments.length, 4);
  eq("... the first is the DNS name", del.arguments[0].name, "dnsName");
  eq("... the second is the single key it is scoped to", del.arguments[1].value, R.RECORD_KEYS.agentCapabilities);
  eq("... the third is the agent", del.arguments[2].value, AGENT);
  eq("... and the fourth is the granted flag", del.arguments[3].value, "true");
  check("the delegation step reports the PER-KEY resource, not the name-level one",
        del.affects.resource === AGENT_RESOURCE && del.affects.resource !== AGENT_NAME_RESOURCE,
        `${del.affects.resource} vs name-level ${AGENT_NAME_RESOURCE}`);
  check("... and warns that the name-level read will show nothing",
        /invisible/i.test(del.detail?.resourceNote ?? ""), del.detail?.resourceNote);
  check("... and names what the SENDER must hold to send it",
        /adminRole\(SET_TEXT\)|admin/i.test(del.detail?.requiresOfSender?.why ?? ""), j(del.detail?.requiresOfSender));

  // A post-state row that says the name-level resource stays 0 is not a bug report; make sure the
  // plan says so, because otherwise the first person to check it will think the delegation failed.
  const nameLevelRow = del.expectedPostState.find((r) => r.read.includes(AGENT_NAME_RESOURCE));
  check("the plan predicts the name-level read is ZERO and says that is expected",
        nameLevelRow !== undefined && /must not be read as one|not a failure/i.test(nameLevelRow.expect),
        j(nameLevelRow));

  // The revocation is the same call with one word different, and the rows must say so.
  const rev = plan.steps.find((s) => s.kind === "prepared");
  eq("the revocation declares the same four arguments", rev.arguments.length, 4);
  eq("... with granted = false", rev.arguments[3].value, "false");
  eq("... the same key", rev.arguments[1].value, del.arguments[1].value);
  check("... and the same selector as the grant, because it is the same function",
        rev.call.data.slice(0, 10) === del.call.data.slice(0, 10));
  check("... but NOT the same calldata, or it would grant again",
        rev.call.data !== del.call.data);
}

console.log("\n— the register() bitmap is one-shot, so a registration without admin bits is refused —");
{
  // The most expensive mistake available anywhere in this plan. Per-name admin roles can ONLY be
  // set in register(); granting one afterwards is refused by the chain — observed, with the
  // matching REGULAR grant from the same owner accepted as the control that makes it decisive. So
  // a registration that omits them produces a name the merchant can never fully administer, and
  // there is no repair short of abandoning the name.
  const good = PLAN.buildPlan(CFG);
  const registerSteps = good.steps.filter((s) => s.call?.method === "register");
  check("CONTROL the ordinary plan is planned, and every registration carries admin bits",
        good.ok === true && registerSteps.length > 0 &&
        registerSteps.every((s) => (BigInt(s.call.roleBitmap) >> P.ADMIN_SHIFT) !== 0n));

  // The three regular bits the plan grants, with the admin half deliberately stripped off.
  const REG = [1n << 16n, 1n << 20n, 1n << 24n];          // RENEW, SET_SUBREGISTRY, SET_RESOLVER
  const regular = REG.reduce((a, b) => a | b, 0n) | BigInt(P.REGISTRY_ROLE_CAN_TRANSFER_ADMIN.bit);

  const stripped = PLAN.buildPlan({...CFG, registryRoleBitmap: asWord(regular)});
  check("a registration bitmap with no admin half is REFUSED",
        stripped.ok === false && stripped.status === PLAN.PLAN_STATUS.REGISTRATION_MISSING_ADMIN_ROLES,
        j(stripped).slice(0, 300));
  check("... and the refusal NAMES which admin roles are missing",
        Array.isArray(stripped.refusal?.missingAdmin) && stripped.refusal.missingAdmin.length === 3,
        j(stripped.refusal?.missingAdmin));
  check("... and says why it cannot be repaired later, naming the observed refusal and its control",
        /EACCannotGrantRoles/.test(stripped.refusal?.why ?? "") && /control/i.test(stripped.refusal?.why ?? ""));
  check("... and names the consequence in terms of the merchant, not of a bitmap",
        /revoke/i.test(stripped.refusal?.consequence ?? ""));

  // A partial admin half is not "mostly fine": one missing bit is still an unrepairable name.
  const onlyOneMissing = regular | P.adminRole(REG[0]) | P.adminRole(REG[1]);
  const partial = PLAN.buildPlan({...CFG, registryRoleBitmap: asWord(onlyOneMissing)});
  check("a registration missing ONE admin role is refused too, and names exactly that one",
        partial.ok === false &&
        partial.status === PLAN.PLAN_STATUS.REGISTRATION_MISSING_ADMIN_ROLES &&
        partial.refusal.missingAdmin.length === 1 && partial.refusal.missingAdmin[0] === "SET_RESOLVER",
        j(partial.refusal?.missingAdmin));

  // And the guard is not simply refusing everything it is handed.
  const full = PLAN.buildPlan({...CFG, registryRoleBitmap: asWord(
    regular | P.adminRole(REG[0]) | P.adminRole(REG[1]) | P.adminRole(REG[2]))});
  check("CONTROL a bitmap WITH every admin bit is accepted, so the guard is not refusing everything",
        full.ok === true, j(full).slice(0, 200));
}

console.log("\n— the whole-plan screen catches a step the constructors did not build —");
{
  const plan = PLAN.buildPlan(CFG);
  check("CONTROL the real plan's screen is clean", plan.screen?.ok === true, j(plan.screen));
  eq("... and it actually screened the grant and the revocation, not zero steps", plan.screen.screened, 2);

  const inject = (call) => R.screenPlanForAgentAuthority(
    [...plan.steps, {ordinal: 999, call}], screenCtx());

  refusedWith("a hand-added step granting the agent ROOT_RESOURCE is rejected",
              inject(goodCall({resource: asWord(0n)})), R.PLAN_SCREEN_STATUS.REJECTED);
  refusedWith("a hand-added step granting the agent an admin role is rejected",
              inject(goodCall({roleBitmap: asWord(P.adminRole(SET_TEXT))})), R.PLAN_SCREEN_STATUS.REJECTED);
  refusedWith("a hand-added step granting the agent a role on the payment name is rejected",
              inject(goodCall({resource: PAY_RESOURCE})), R.PLAN_SCREEN_STATUS.REJECTED);
  refusedWith("a hand-added grantRootRoles step is rejected",
              inject(goodCall({method: "grantRootRoles"})), R.PLAN_SCREEN_STATUS.REJECTED);
  refusedWith("a hand-added step REVOKING at the wrong resource is rejected — a revocation that does not revoke is worse than none",
              inject(goodCall({method: "revokeRoles", resource: PAY_RESOURCE})), R.PLAN_SCREEN_STATUS.REJECTED);
  refusedWith("an empty plan is refused rather than declared clean",
              R.screenPlanForAgentAuthority([], screenCtx()), R.PLAN_SCREEN_STATUS.NO_STEPS);

  const rejected = inject(goodCall({resource: asWord(0n)}));
  eq("the rejection names the ordinal of the offending step", rejected.rejected[0].ordinal, 999);
  eq("... and the reason", rejected.rejected[0].status, R.GRANT_STATUS.ROOT_RESOURCE_FORBIDDEN);
}

console.log("\n— every capability the agent must not have, fed to the planner as a call —");
{
  // The law lists thirteen. Each row below constructs the transaction that would confer the
  // capability and requires a NAMED refusal. A matrix entry with no row here would be a promise.
  const rows = [
    ["transfer the name", goodCall({to: PARENT_REGISTRY, roleBitmap: asWord(P.REGISTRY_ROLE_CAN_TRANSFER_ADMIN.bit)}), R.GRANT_STATUS.REGISTRY_TARGET_FORBIDDEN],
    ["change owner", goodCall({to: MERCHANT_SUBREGISTRY}), R.GRANT_STATUS.REGISTRY_TARGET_FORBIDDEN],
    ["set resolver", goodCall({to: PARENT_REGISTRY, roleBitmap: asWord(P.REGISTRY_ROLE.SET_RESOLVER.bit)}), R.GRANT_STATUS.REGISTRY_TARGET_FORBIDDEN],
    ["set subregistry", goodCall({to: PARENT_REGISTRY, roleBitmap: asWord(P.REGISTRY_ROLE.SET_SUBREGISTRY.bit)}), R.GRANT_STATUS.REGISTRY_TARGET_FORBIDDEN],
    ["register siblings", goodCall({to: MERCHANT_SUBREGISTRY, resource: asWord(0n), roleBitmap: asWord(P.REGISTRY_ROLE.REGISTRAR.bit)}), R.GRANT_STATUS.ROOT_RESOURCE_FORBIDDEN],
    ["renew or unregister", goodCall({to: PARENT_REGISTRY, roleBitmap: asWord(P.REGISTRY_ROLE.RENEW.bit)}), R.GRANT_STATUS.REGISTRY_TARGET_FORBIDDEN],
    ["change the payment recipient", goodCall({resource: PAY_RESOURCE, roleBitmap: asWord(P.RESOLVER_ROLE.SET_ADDR.bit)}), R.GRANT_STATUS.PROTECTED_RESOURCE],
    ["change the executor", goodCall({resource: PAY_RESOURCE}), R.GRANT_STATUS.PROTECTED_RESOURCE],
    ["change the chain id", goodCall({resource: PAY_RESOURCE}), R.GRANT_STATUS.PROTECTED_RESOURCE],
    ["administer roles", goodCall({roleBitmap: asWord(P.adminRole(SET_TEXT))}), R.GRANT_STATUS.ADMIN_ROLE_FORBIDDEN],
    ["grant roles to itself or to anyone", goodCall({roleBitmap: asWord(P.adminRole(SET_TEXT) | SET_TEXT)}), R.GRANT_STATUS.ADMIN_ROLE_FORBIDDEN],
    ["write arbitrary text keys on a name the merchant relies on", goodCall({resource: TREASURY_RESOURCE}), R.GRANT_STATUS.PROTECTED_RESOURCE],
    ["obtain root roles", goodCall({method: "grantRootRoles"}), R.GRANT_STATUS.ROOT_ROLES_METHOD_FORBIDDEN],
  ];
  eq("there is one row here for every entry in the denial matrix", rows.length, R.DENIAL_MATRIX.length);
  for (const [capability, call, status] of rows) {
    refusedWith(`the agent cannot ${capability}`, R.screenAgentGrant(call, screenCtx()), status);
  }
  for (const d of R.DENIAL_MATRIX) {
    check(`the matrix row for "${d.capability}" names a real refusal status`,
          Object.values(R.GRANT_STATUS).includes(d.screen), d.screen);
    check(`... and a denial mechanism this repository has a word for`,
          Object.values(R.DENIAL).includes(d.denial), d.denial);
  }

  // The honest half — CORRECTED, together with the claim it used to pin.
  //
  // These rows used to require the residual to say "the agent may write any text key on its own
  // leaf", and to require the profile to record the per-key derivation as DOCUMENTED_NOT_OBSERVED.
  // Both are refuted: executing authorizeTextRoles on a pinned fork showed the grant landing at the
  // per-KEY resource, and the agent being refused on a second key of the same name. A test that
  // pins a refuted claim is worse than no test, because it makes the claim expensive to correct —
  // so the test moved with the finding rather than holding it in place.
  //
  // What is still pinned, and matters more: the residual must not be EMPTIED. The denial is now
  // narrower but it is not total, and the row below fails if anyone quietly turns it into null.
  const residuals = R.DENIAL_MATRIX.filter((d) => d.residual);
  eq("exactly one denial carries a residual, and it is the text-key one", residuals.length, 1);
  // Read through `?? ""` so that an emptied residual fails THIS row rather than throwing and
  // taking every row after it down with the summary. Measured while sabotaging exactly that.
  const residualText = residuals[0]?.residual ?? "";
  check("... and the residual names the WIDE call that per-key scoping does not protect against",
        /authorizeNameRoles/i.test(residualText), residualText);
  check("... and says the denial there is this planner's doing, not the chain's",
        /planner refuses/i.test(residualText) && /NAME_LEVEL_METHOD_FORBIDDEN/.test(residualText), residualText);
  // And the claim it rests on is checked against the profile rather than restated from memory.
  const perKey = P.RESOURCE_DERIVATIONS.find((d) => /keccak256\(bytes\(key\)\)/.test(d.formula));
  eq("the profile records the per-key derivation as EXECUTED, which is what the narrower denial rests on",
     perKey.observed, P.OBSERVED.FORK_EXECUTED);
  check("... and the text-key denial is the chain's, not merely structural",
        residuals[0].denial === R.DENIAL.CHAIN_ENFORCED, residuals[0].denial);
}

console.log("\n— the plan: parameterised on the parent, never on a name this repository owns —");
{
  const plan = PLAN.buildPlan(CFG);
  check("CONTROL a complete configuration produces a plan", plan.ok === true && plan.status === PLAN.PLAN_STATUS.PLANNED,
        j({ok: plan.ok, status: plan.status, unmet: plan.unmetPreconditions}));

  refusedWith("no parent at all is refused", PLAN.buildPlan({}), PLAN.PLAN_STATUS.BAD_PARENT);
  refusedWith("a single-label parent is refused", PLAN.buildPlan({...CFG, parent: "eth"}), PLAN.PLAN_STATUS.BAD_PARENT);
  refusedWith("a parent this repository cannot normalise is refused rather than guessed at",
              PLAN.buildPlan({...CFG, parent: "mérchant.eth"}), PLAN.PLAN_STATUS.BAD_PARENT);
  refusedWith("an unknown mode is refused", PLAN.buildPlan({...CFG, mode: "whatever"}), PLAN.PLAN_STATUS.BAD_MODE);
  refusedWith("a missing settlement recipient is refused", PLAN.buildPlan({...CFG, settlement: {...CFG.settlement, recipient: null}}), PLAN.PLAN_STATUS.BAD_INPUT);
  refusedWith("an agent that is the merchant is refused before anything is built",
              PLAN.buildPlan({...CFG, agentAddress: MERCHANT}), PLAN.PLAN_STATUS.BAD_INPUT);
  refusedWith("subregistry mode without the extra registries is refused, with the reason",
              PLAN.buildPlan({...CFG, mode: "subregistry", merchantSubregistry: null}), PLAN.PLAN_STATUS.BAD_INPUT);

  // Which registry holds the PARENT's own token is derivable for `<label>.eth` and for nothing
  // deeper. Filling in the pinned .eth registry for a deeper parent would aim setSubregistry at a
  // registry that has never heard of that token id.
  const deep = PLAN.buildPlan({...CFG, parent: "deep.sub.eth", parentRegistry: undefined});
  refusedWith("a parent deeper than one label under .eth must name the registry holding it", deep, PLAN.PLAN_STATUS.BAD_INPUT);
  eq("... and the refusal names the field the owner must supply", deep.refusal?.field, "parentRegistry");
  check("CONTROL the same deep parent WITH a registry supplied is planned",
        PLAN.buildPlan({...CFG, parent: "deep.sub.eth", parentRegistry: PARENT_REGISTRY}).ok === true);
  eq("a direct .eth parent defaults to the pinned ETHRegistry and needs no input",
     plan.steps[0].call.to.toLowerCase(), P.byName("ETHRegistry").address.toLowerCase());

  // Two different parents must produce two entirely different namespaces. A planner with a
  // hard-coded name would produce overlapping nodes and this row would go red.
  const other = PLAN.buildPlan({...CFG, parent: "a-completely-different-parent.eth"});
  const overlap = Object.keys(plan.nodes).filter((k) => plan.nodes[k] === other.nodes[k]);
  eq("changing the parent changes every node in the plan", overlap.length, 0);
  const shared = Object.keys(plan.resources).filter((k) => k !== "root" && plan.resources[k] === other.resources[k]);
  eq("... and every resolver resource", shared.length, 0);
  check("no resource in the plan is the survey's sample name's resource",
        !Object.values(plan.resources).includes(P.EVIDENCE_SAMPLE.resolverNameResource));
  check("the parent is returned as a required owner action", plan.ownerActions.some((a) => /PARENT/.test(a.what)));
  check("... and the owner actions say UNICA owns no ENSv2 name",
        plan.ownerActions.some((a) => /owns no ENSv2/i.test(a.why)));

  // Ordering. The dependency graph is the safety property, so it is checked rather than trusted.
  const ordinals = plan.steps.map((s) => s.ordinal);
  check("ordinals are 1..N with no gaps and no decimals",
        ordinals.every((o, i) => o === i + 1), ordinals.join(","));
  const backwards = plan.steps.flatMap((s) => (s.dependsOn ?? []).filter((d) => d >= s.ordinal).map((d) => `${s.ordinal}<-${d}`));
  eq("every dependency points at an earlier step", backwards.length, 0);
  // The delegation step is now authorizeTextRoles. Found by method rather than by ordinal so that
  // adding a step above it does not silently point this ordering check at the wrong transaction.
  const grantStep = plan.steps.find((s) => s.call?.method === "authorizeTextRoles");
  check("the plan contains exactly one delegation step, and it is authorizeTextRoles",
        plan.steps.filter((s) => s.call?.method === "authorizeTextRoles").length === 1 && grantStep !== undefined);
  check("and the plan contains NO grantRoles step — the call this deployment refuses",
        plan.steps.every((s) => s.call?.method !== "grantRoles"));
  const agentRecordSteps = plan.steps.filter((s) => s.affects?.resource === plan.resources.agent && s.call?.method?.startsWith("set"));
  check("the agent's records are written BEFORE the agent is given any authority",
        agentRecordSteps.length > 0 && agentRecordSteps.every((s) => s.ordinal < grantStep.ordinal));
  const payStep = plan.steps.find((s) => s.affects?.resource === plan.resources.pay && s.call?.method === "setAddr");
  check("the payment record is written before the delegation exists", payStep.ordinal < grantStep.ordinal);

  // The one-shot step, and the fact that it is the only one carrying an admin bit.
  const registerSteps = plan.steps.filter((s) => s.call?.method === "register");
  check("every register step is marked irreversible with a reason and a mitigation",
        registerSteps.length > 0 && registerSteps.every((s) => s.rollback?.irreversible === true && s.rollback.why && s.rollback.mitigation));
  check("the register bitmap carries admin bits — the only place they can ever be set",
        registerSteps.every((s) => (BigInt(s.call.roleBitmap) >> P.ADMIN_SHIFT) !== 0n));
  // Not "some admin bit somewhere". Each granted regular role must carry ITS OWN admin, because the
  // admin of a role is what lets the merchant grant that role later and there is no second chance.
  // Asserting only that the upper half is non-zero passed while every per-role admin was missing —
  // CAN_TRANSFER_ADMIN alone kept the word non-zero. Found by the sabotage runner.
  for (const roleName of ["RENEW", "SET_SUBREGISTRY", "SET_RESOLVER"]) {
    const admin = P.adminRole(BigInt(P.REGISTRY_ROLE[roleName].bit));
    check(`the register bitmap carries ADMIN(${roleName}) specifically, not merely some admin bit`,
          registerSteps.every((s) => (BigInt(s.call.roleBitmap) & admin) === admin), asWord(admin));
    check(`... and the regular ${roleName} bit beside it`,
          registerSteps.every((s) => (BigInt(s.call.roleBitmap) & BigInt(P.REGISTRY_ROLE[roleName].bit)) !== 0n));
  }
  check("the register bitmap also carries the already-shifted CAN_TRANSFER_ADMIN bit",
        registerSteps.every((s) => (BigInt(s.call.roleBitmap) & BigInt(P.REGISTRY_ROLE_CAN_TRANSFER_ADMIN.bit)) !== 0n));
  check("the register step prints the documented bits it is permanently NOT setting",
        plan.permanentOmissions.length > 0 && plan.permanentOmissions.some((o) => o.name === "UNREGISTER"));
  check("... including the bit the chain uses that no documentation names",
        plan.permanentOmissions.some((o) => o.name === "UNNAMED_BIT_32"));
  const withAdmin = plan.steps.filter((s) => s.call?.roleBitmap && (BigInt(s.call.roleBitmap) >> P.ADMIN_SHIFT) !== 0n);
  check("no step other than register carries an admin bit",
        withAdmin.every((s) => s.call.method === "register"), withAdmin.map((s) => s.ordinal).join(","));

  check("every transaction step names a way back", plan.steps.filter((s) => s.kind === "transaction").every((s) => s.rollback));
  check("every step carries an evidence label", plan.steps.every((s) => s.evidence || s.kind === "transaction"));
  // The undo is the SAME function with the flag flipped, so it is matched on the revoking
  // vocabulary rather than on a second method name that no longer exists.
  check("the plan ends with a prepared revocation",
        plan.steps.some((s) => s.kind === "prepared" && V.REVOKING_METHODS.has(s.call.method)));
  check("... and the revocation is the same call as the grant, with granted=false",
        plan.steps.some((s) => s.kind === "prepared" && s.call.method === "authorizeTextRoles:revoke" &&
                               s.call.selector === grantStep.call.selector));
  const preparedStep = plan.steps.find((s) => s.kind === "prepared");
  check("the prepared revocation names the same resource and bitmap as the grant",
        preparedStep?.call?.resource === grantStep.call.resource &&
        preparedStep?.call?.roleBitmap === grantStep.call.roleBitmap);
  check("a verification of the agent's INABILITY is in the plan, with an ACCEPTED control beside the refusals",
        plan.steps.some((s) => s.kind === "verify" &&
          s.expectedPostState.some((p) => /REVERT/.test(p.expect)) &&
          s.expectedPostState.some((p) => /ACCEPTED/.test(p.expect) && /CONTROL/.test(p.expect))));

  // Preconditions.
  const noRootReading = PLAN.buildPlan({...CFG, observations: {...CFG.observations, agentRootRolesAtResolver: undefined}});
  check("a plan built with no ROOT_RESOURCE reading for the agent is NOT ok",
        noRootReading.ok === false && noRootReading.status === PLAN.PLAN_STATUS.PRECONDITION_UNMET,
        j({ok: noRootReading.ok, status: noRootReading.status}));
  check("... and it names which precondition is unmet",
        noRootReading.unmetPreconditions.some((n) => /ROOT_RESOURCE/.test(n)), j(noRootReading.unmetPreconditions));
  const holdsRoot = PLAN.buildPlan({...CFG, observations: {...CFG.observations, agentRootRolesAtResolver: "0x10"}});
  refusedWith("an agent that already holds root roles is refused outright, not merely warned about",
              holdsRoot, PLAN.PLAN_STATUS.AGENT_GRANT_REFUSED);
  // The plan-level status and the underlying reason are separate fields. Merged into one, the role
  // planner's status overwrote the plan's and a caller switching on PLAN_STATUS matched nothing.
  eq("... and the underlying reason survives one level down, where it cannot collide",
     holdsRoot.refusal?.status, R.GRANT_STATUS.AGENT_HOLDS_ROOT_ROLES);
  eq("a refused plan carries no steps, so it cannot be mistaken for a thin one",
     PLAN.buildPlan({}).steps, undefined);
  check("a resolver with no code fails its precondition",
        PLAN.buildPlan({...CFG, observations: {...CFG.observations, resolverCodeSize: 0}}).ok === false);
  check("an unsimulated merchant grant fails its precondition",
        PLAN.buildPlan({...CFG, observations: {...CFG.observations, merchantMayGrantAtAgentResource: undefined}}).ok === false);
  check("every precondition is a READ against the chain, not an assumption",
        plan.preconditions.every((p) => typeof p.read === "string" && p.read.length > 0 && p.why));
}

console.log("\n— nothing secret reaches the chain, and the scanner that says so can fire —");
{
  const plan = PLAN.buildPlan(CFG);
  const preview = V.previewPlan(plan, {gas: {}});
  const haystack = j(plan) + j(preview) + V.renderPlanPreview(preview);

  const needles = Object.entries(SECRET).flatMap(([k, v]) => [
    [`${k} in decimal`, String(v)],
    [`${k} in hex`, "0x" + (/^\d+$/.test(String(v)) ? BigInt(v).toString(16) : Buffer.from(String(v)).toString("hex"))],
  ]);
  // CONTROL first: the scanner must be able to find something. Without this row, a scanner with a
  // broken haystack would report every value absent and read as a clean pass.
  check("CONTROL the scanner finds a value that IS present",
        haystack.includes(plan.policyCommitment.digest));
  for (const [what, needle] of needles) {
    check(`the plan and its preview contain no trace of the ${what}`, !haystack.includes(needle), needle);
  }
  check("CONTROL the scanner fires on an object that does leak the threshold",
        j({leaked: SECRET.thresholdWei}).includes(String(SECRET.thresholdWei)));

  // What IS published is the commitment, and it must actually bind.
  const c1 = R.commitPolicy({chainId: 1, merchantNode: asWord(1n), ...SECRET});
  const c2 = R.commitPolicy({chainId: 1, merchantNode: asWord(1n), ...SECRET, salt: SECRET.salt + "x"});
  const c3 = R.commitPolicy({chainId: 1, merchantNode: asWord(1n), ...SECRET, thresholdWei: "133731337000001"});
  check("CONTROL the same inputs commit to the same digest",
        c1.digest === R.commitPolicy({chainId: 1, merchantNode: asWord(1n), ...SECRET}).digest);
  check("a different salt commits to a different digest", c1.digest !== c2.digest);
  check("a different threshold commits to a different digest", c1.digest !== c3.digest);
  eq("the digest is a 32-byte word", c1.digest.length, 66);
  eq("the commitment is a keccak over the canonical string and nothing else", c1.digest,
     toHex(keccak256(utf8(["UNICA:ensv2-policy:v1", "1", asWord(1n), SECRET.thresholdWei, SECRET.allocationBps, SECRET.reserveWei, SECRET.salt].join("|")))));
  check("a commitment over a missing field is refused rather than computed",
        R.commitPolicy({chainId: 1, merchantNode: asWord(1n), ...SECRET, salt: undefined}).ok === false);
  check("the scheme is published beside the digest, so a checker knows how to reproduce it",
        plan.steps.some((s) => s.arguments?.some((a) => a.value === R.RECORD_KEYS.policyScheme)));

  // Every published record key comes from the closed vocabulary.
  const writtenKeys = plan.steps.filter((s) => s.call?.method === "setText").map((s) => s.arguments[1].value);
  const vocabulary = new Set(Object.values(R.RECORD_KEYS));
  check("every text key written by the plan is in the closed vocabulary",
        writtenKeys.every((k) => vocabulary.has(k)), writtenKeys.filter((k) => !vocabulary.has(k)).join(","));
  check("there are keys to check", writtenKeys.length >= 8, `found ${writtenKeys.length}`);
}

console.log("\n— the preview: the flags are recomputed from the calldata, not copied from the claim —");
{
  const plan = PLAN.buildPlan(CFG);
  const gasFor = (p) => Object.fromEntries(p.steps.filter((s) => s.kind === "transaction").map((s) => [s.ordinal, "0x" + (50000).toString(16)]));

  const noGas = V.previewPlan(plan, {gas: {}});
  check("CONTROL a preview with no estimates renders every row", noGas.rows.length === plan.steps.length);
  check("... and refuses to be signable", V.planPreviewIsSignable(noGas) === false);
  check("... naming the missing estimate on each transaction row",
        noGas.rows.filter((r) => r.kind === "transaction").every((r) => r.refusals.some((f) => f.code === V.PREVIEW_REFUSAL.MISSING_GAS)));

  const withGas = V.previewPlan(plan, {gas: gasFor(plan)});
  check("CONTROL with every estimate supplied the preview is READY", withGas.ok === true && withGas.status === V.PLAN_PREVIEW_STATUS.READY,
        j(withGas.refused).slice(0, 400));
  check("... and IS signable — the gate can say yes, which is what makes its no worth anything",
        V.planPreviewIsSignable(withGas) === true);
  check("... and the whole plan is signable", PLAN.planIsSignable(plan, withGas) === true);
  eq("... and the summary totals the gas", withGas.summary.totalGasEstimate, withGas.summary.transactions * 50000);

  // One estimate removed must take the whole plan down with it.
  const oneShort = {...gasFor(plan)};
  delete oneShort[plan.steps.find((s) => s.kind === "transaction").ordinal];
  check("dropping ONE estimate makes the plan unsignable",
        V.planPreviewIsSignable(V.previewPlan(plan, {gas: oneShort})) === false);

  // The prepared revocation is excused the estimate, with its own word, and is still checked.
  const prepared = withGas.rows.find((r) => r.kind === "prepared");
  eq("the prepared revocation says it cannot be estimated yet, rather than saying nothing",
     prepared.gas.status, V.GAS_STATUS.NOT_YET_ESTIMABLE);
  check("... and it still carries a target, a zero value and a way back",
        prepared.target.address === RESOLVER && BigInt(prepared.value) === 0n && Boolean(prepared.rollback));

  // An admin role is legitimate in exactly one place — register()'s roleBitmap, the only place one
  // can ever be established on this deployment. Anywhere else it is an escalation wearing an
  // ordinal, and the signable gate must refuse the whole plan over it.
  const withStrayAdmin = {...plan, steps: plan.steps.map((s) =>
    s.call?.method === "setText"
      ? {...s, call: {...s.call, method: "grantRoles", resource: plan.resources.agent, roleBitmap: asWord(P.adminRole(SET_TEXT))}}
      : s)};
  const strayPreview = V.previewPlan(withStrayAdmin, {gas: gasFor(plan)});
  check("CONTROL the stray admin bit is actually visible in the rendered preview",
        strayPreview.summary.rowsInvolvingAdminRoles.length > 1);
  check("an admin role on a step that is not register() makes the plan unsignable",
        V.planPreviewIsSignable(strayPreview) === false);
  check("CONTROL the same plan without the stray bit IS signable, so the row above is not vacuous",
        V.planPreviewIsSignable(withGas) === true);
  eq("in a clean plan only the register rows involve an admin role",
     withGas.summary.rowsInvolvingAdminRoles
       .map((o) => withGas.rows.find((r) => r.ordinal === o).method)
       .filter((m) => m !== "register").length, 0);

  // A plan whose undo has been removed is not signable, however complete the rest of it is.
  const noUndo = {...plan, steps: plan.steps.filter((s) => s.kind !== "prepared")};
  check("removing the prepared revocation makes the plan unsignable",
        V.planPreviewIsSignable(V.previewPlan(noUndo, {gas: gasFor(noUndo)})) === false);

  // The flags are recomputed. A step that lies about itself must not be believed.
  const lying = V.previewStep({
    ordinal: 1, kind: "transaction", title: "a step that lies about itself", dependsOn: [],
    call: {method: "grantRoles", to: RESOLVER, resource: asWord(0n), roleBitmap: asWord(P.adminRole(SET_TEXT)), data: "0x00"},
    arguments: [{name: "x", type: "uint256", value: "0"}], value: "0x0", rollback: {how: "n/a"},
    involvesAdminRole: false, involvesRootResource: false,
  }, {gas: {1: "0x1"}});
  check("a step claiming no admin role is overruled by its own bitmap", lying.involvesAdminRole === true);
  check("a step claiming no root resource is overruled by its own resource", lying.involvesRootResource === true);
  check("CONTROL an honest step is not falsely flagged",
        V.previewStep({ordinal: 1, kind: "transaction", dependsOn: [], call: {method: "grantRoles", to: RESOLVER, resource: AGENT_RESOURCE, roleBitmap: asWord(SET_TEXT)},
                       arguments: [{name: "x", type: "uint256", value: "0"}], value: "0x0", rollback: {how: "n/a"}}, {gas: {1: "0x1"}}).involvesAdminRole === false);

  // Structural refusals.
  const base = {ordinal: 1, kind: "transaction", dependsOn: [], value: "0x0", rollback: {how: "n/a"},
                arguments: [{name: "x", type: "uint256", value: "0"}]};
  check("a transaction with no way back is refused",
        V.previewStep({...base, rollback: null, call: {method: "setAddr", to: RESOLVER}}, {gas: {1: "0x1"}})
          .refusals.some((f) => f.code === V.PREVIEW_REFUSAL.NO_ROLLBACK));
  check("a transaction carrying value is refused",
        V.previewStep({...base, value: "0x1", call: {method: "setAddr", to: RESOLVER}}, {gas: {1: "0x1"}})
          .refusals.some((f) => f.code === V.PREVIEW_REFUSAL.VALUE_MUST_BE_ZERO));
  check("a transaction with no target address is refused",
        V.previewStep({...base, call: {method: "setAddr", to: "nowhere"}}, {gas: {1: "0x1"}})
          .refusals.some((f) => f.code === V.PREVIEW_REFUSAL.BAD_TARGET));

  // The batch rules.
  const batched = PLAN.buildPlan({...CFG, batchRecords: true});
  const bPrev = V.previewPlan(batched, {gas: gasFor(batched)});
  const bRow = bPrev.rows.find((r) => r.batch);
  check("CONTROL a batch renders every inner call with named arguments",
        bRow && bRow.batch.count === 5 && bRow.batch.calls.every((c) => c.arguments.length >= 2), j(bRow?.batch?.count));
  check("... and the batched plan is still signable", V.planPreviewIsSignable(bPrev) === true);
  check("a batch carrying a role change is refused",
        V.previewStep({...base, call: {method: "multicallWithNodeCheck", to: RESOLVER},
                       batch: [{method: "grantRoles", to: RESOLVER, arguments: [{name: "a", type: "uint256", value: "1"}]}]}, {gas: {1: "0x1"}})
          .refusals.some((f) => f.code === V.PREVIEW_REFUSAL.BATCH_CARRIES_ROLE_CHANGE));
  check("a batch member aimed at another contract is refused",
        V.previewStep({...base, call: {method: "multicallWithNodeCheck", to: RESOLVER},
                       batch: [{method: "setAddr", to: PARENT_REGISTRY, arguments: [{name: "a", type: "uint256", value: "1"}]}]}, {gas: {1: "0x1"}})
          .refusals.some((f) => f.code === V.PREVIEW_REFUSAL.BATCH_CROSSES_TARGETS));
  check("a batch member with no decoded arguments is refused",
        V.previewStep({...base, call: {method: "multicallWithNodeCheck", to: RESOLVER},
                       batch: [{method: "setAddr", to: RESOLVER, data: "0xdeadbeef"}]}, {gas: {1: "0x1"}})
          .refusals.some((f) => f.code === V.PREVIEW_REFUSAL.UNDECODED_BATCH_MEMBER));

  // Which role table each row is read against. This section exists because a sabotage that forced
  // every row onto the resolver table was NOT caught by any other row here: the register step's
  // `roles.granted` list is written by the plan and reads correctly either way, so nothing noticed
  // that the bitmap under it was being decoded against the wrong meanings.
  const regRows = withGas.rows.filter((r) => ["register", "setResolver", "setSubregistry"].includes(r.method));
  check("there are registry-targeted rows to check", regRows.length >= 3, `found ${regRows.length}`);
  check("every registry-targeted row is read against the REGISTRY role table",
        regRows.every((r) => r.roles.table === R.ROLE_TABLE.REGISTRY),
        regRows.map((r) => `${r.ordinal}:${r.roles.table}`).join(","));
  const resRows = withGas.rows.filter((r) => ["setAddr", "setText", "grantRoles", "revokeRoles"].includes(r.method));
  check("there are resolver-targeted rows to check", resRows.length >= 5, `found ${resRows.length}`);
  check("every resolver-targeted row is read against the RESOLVER role table",
        resRows.every((r) => r.roles.table === R.ROLE_TABLE.RESOLVER),
        resRows.map((r) => `${r.ordinal}:${r.roles.table}`).join(","));
  const registerRow = withGas.rows.find((r) => r.method === "register");
  check("the register row's bitmap decodes to registry role names",
        R.describeBitmap(registerRow.roles.bitmap, registerRow.roles.table).named.includes("SET_RESOLVER"),
        j(R.describeBitmap(registerRow.roles.bitmap, registerRow.roles.table).named));
  check("... and the resolver table would have named the same bitmap differently, which is the whole risk",
        R.describeResolverBitmap(registerRow.roles.bitmap).named.join() !==
        R.describeRegistryBitmap(registerRow.roles.bitmap).named.join());

  // The target's provenance is three answers, not two.
  eq("a pinned address is named with the role the survey read back",
     V.describeTarget(P.byName("ETHRegistry").address).knowledge, V.TARGET_KNOWLEDGE.PINNED);
  eq("an owner-supplied address is DISCOVERED, not invented a role for",
     V.describeTarget(RESOLVER, {[RESOLVER.toLowerCase()]: {name: "the merchant's resolver"}}).knowledge, V.TARGET_KNOWLEDGE.DISCOVERED);
  eq("an address nobody described is UNKNOWN and says to check it yourself",
     V.describeTarget(OUTSIDER).knowledge, V.TARGET_KNOWLEDGE.UNKNOWN);

  // The dependency graph.
  const scrambled = {...plan, steps: [plan.steps[3], ...plan.steps.slice(0, 3), ...plan.steps.slice(4)]};
  const scrambledPreview = V.previewPlan(scrambled, {gas: gasFor(plan)});
  check("a plan whose steps are out of dependency order is refused",
        scrambledPreview.ok === false && scrambledPreview.brokenOrder.length > 0);
  check("CONTROL the plan in its own order has no broken dependencies", withGas.brokenOrder.length === 0);
  check("something that is not a plan is refused rather than rendered",
        V.previewPlan({steps: []}).ok === false && V.previewPlan(null).ok === false);

  // Every row carries the two flags, including where they are false.
  check("every row prints both flags, including the rows where they are false",
        withGas.rows.every((r) => typeof r.involvesAdminRole === "boolean" && typeof r.involvesRootResource === "boolean"));
  eq("no row in a clean plan involves ROOT_RESOURCE", withGas.summary.rowsInvolvingRootResource.length, 0);
  check("the summary lists the irreversible steps by ordinal",
        withGas.summary.irreversibleSteps.length >= 1);
  check("every transaction row carries decoded arguments",
        withGas.rows.filter((r) => r.kind === "transaction").every((r) => r.arguments.length > 0));
  check("every transaction row names its target's provenance",
        withGas.rows.filter((r) => r.kind === "transaction").every((r) => Object.values(V.TARGET_KNOWLEDGE).includes(r.target.knowledge)));
  check("every transaction row carries the owner-confirmation marker",
        withGas.rows.filter((r) => r.kind === "transaction").every((r) => r.marker === V.OWNER_MARKER));
  check("the preview says who signs, and that it is not this tool",
        withGas.broadcast.byThisTool === false && /wallet/.test(withGas.broadcast.whoSigns));
}

console.log("\n— these files cannot broadcast, and the scanner that says so can fail —");
{
  // Assembled from halves so that `permissioned-test.mjs`'s own scan of this directory does not
  // fire on this file's controls. The rule is that nothing here CALLS a writing method; a name
  // built from two string halves calls nothing.
  const WRITE = ["eth_send" + "RawTransaction", "eth_send" + "Transaction", "personal_" + "sign"];
  const WRITING = new RegExp(`["'](${WRITE.join("|")})["']`);
  // Assembled the same way and for the same reason: the existing suite scans this directory for
  // these words, and a pattern written out in full here would make this file its own violation.
  const KEYISH = new RegExp(["PRIVATE" + "_KEY", "private" + "Key", "mnemo" + "nic", "seed" + "Phrase"].join("|"), "i");
  const strip = (src) => src.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const files = [
    "integrations/ensv2/roles.mjs",
    "integrations/ensv2/plan-preview.mjs",
    "script/ensv2/plan.mjs",
  ];
  eq("there are three new files to scan", files.length, 3);
  for (const f of files) {
    const src = strip(readFileSync(f, "utf8"));
    check(`${f} names no writing JSON-RPC method in code`, !WRITING.test(src));
    check(`${f} reads no key material`, !KEYISH.test(src));
    check(`${f} imports no signing library`, !/\bimport\b[^\n]*\b(ethers|viem|web3|@noble\/secp256k1)\b/.test(src));
  }
  check("the scanner fires on a writing method in code position", WRITING.test(`const m = "${WRITE[0]}";`));
  check("the scanner does NOT fire on the same name inside a comment", !WRITING.test(strip(`// never calls "${WRITE[0]}"`)));
  check("the scanner does not fire on eth_call", !WRITING.test('const m = "eth_call";'));

  // And the script directory is covered too, which the existing suite's scan does not reach.
  const scriptFiles = readdirSync("script/ensv2").filter((f) => f.endsWith(".mjs"));
  check("every file in script/ensv2 is scanned, not just the new one", scriptFiles.length >= 3, scriptFiles.join(","));
  for (const f of scriptFiles) {
    check(`script/ensv2/${f} names no writing JSON-RPC method in code`, !WRITING.test(strip(readFileSync(`script/ensv2/${f}`, "utf8"))));
  }
}

} catch (e) {
  // A throw is a failure with a reason, not a crash. Without this the summary and the exit status
  // vanish with the first bad call, and a piped run reads as a pass.
  check("the suite ran to the end", false, `threw: ${e.stack ?? e.message}`);
}

console.log(`\nchecks run: ${pass + fail}, passed: ${pass}, failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
