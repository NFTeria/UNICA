// The Permissioned Resolver / Enhanced Access Control suite — offline, deterministic, no network.
//
//   node integrations/ensv2/permissioned-test.mjs
//
// WHAT MAKES THESE ROWS WORTH ANYTHING. Three things, and they are the reason this file is longer
// than the module it tests:
//
//   1. The selectors are checked against values that came off the DEPLOYED runtime, not against a
//      second copy of the same derivation. Every four-byte value pinned below was found as a PUSH4
//      dispatch constant in PermissionedResolverImpl's 17597-byte runtime on Sepolia. A suite that
//      recomputed keccak and compared it to keccak would agree with itself about a wrong signature.
//   2. The role constants are checked against REVERTS THE CHAIN ACTUALLY PRODUCED. Three captured
//      refusals — one each for setAddr, setText and setContenthash — carry the role bitmap the
//      contract demanded, and those bitmaps are compared to ROLE.SET_ADDR, ROLE.SET_TEXT and
//      ROLE.SET_CONTENTHASH. That is the contract confirming the constant, not the documentation.
//   3. The name-level resource derivation is checked the same way: the captured refusal names the
//      resource it checked, and `nameLevelResource(namehash("raffy.eth"))` must equal it. The
//      text-key and coin-type derivations have NO such confirmation, and the suite asserts that
//      they are still labelled DOCUMENTED_NOT_OBSERVED rather than quietly promoted.
//
// THE SABOTAGE ROW. A preview that carries no authorization evidence must be REFUSED. The negative
// row does not merely omit the field: it builds the complete, valid reading that the control row
// uses, then removes exactly the authorization observation and nothing else. Everything the
// builder could otherwise lean on is still present, so a builder that stopped checking would
// produce a preview and the row would go red.
//
// EVERY CHAIN READ IS A FIXTURE. The wire bytes in `fixtures/permissioned-observations.json` were
// captured from live Sepolia and are replayed by a fake `chain`. No socket is opened here, which is
// why this suite belongs in the gate: a gate that depends on a third party's uptime is a status
// page, not a gate.

import {readFileSync, readdirSync} from "node:fs";
import {chdir} from "node:process";
import {dirname, resolve as pathResolve} from "node:path";
import {fileURLToPath} from "node:url";

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {utf8} from "../permit2/digest.mjs";
import {ENSV2, namehash} from "../../web/ensv2/resolve.mjs";
import {
  AUTHZ_STATUS, EAC_ROLES_CHANGED_SIGNATURE, EAC_ROLES_CHANGED_TOPIC, ERC1967_IMPLEMENTATION_SLOT,
  ERROR_SIGNATURES, INTERFACE, OBSERVATION, PROBE, RESOURCE_DERIVATIONS, ROLE, ROOT_RESOURCE,
  SELECTOR, SIGNATURES, SUBNAME_STATUS, adminRole, coinTypeResource, decodeRevert,
  encodeGetAssigneeCountCall, encodeRoleCountCall, encodeRolesCall, encodeSetAddrCall,
  encodeSetTextCall, managedSubname, nameLevelResource, probe, readAuthorization, roleName,
  redactRpc, selectorFor, textResource, uintAt, unauthorizedProbeAddress,
} from "./permissioned.mjs";
import {CONTRAST, SIM, simulateEdit, simulateFrom} from "./authz-sim.mjs";
import {OWNER_MARKER, PREVIEW_STATUS, buildPreview, previewIsSignable} from "./preview.mjs";

chdir(pathResolve(dirname(fileURLToPath(import.meta.url)), "../.."));
const F = JSON.parse(readFileSync("integrations/ensv2/fixtures/permissioned-observations.json", "utf8"));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) pass++; else { fail++; if (detail !== undefined) console.log(`        ${detail}`); }
}
const eq = (n, a, b) => check(n, a === b, `expected ${b}\n        got      ${a}`);
const NAME = F.addresses.observedName;
const NODE = F.derived.namehashRaffyEth;
const RESOLVER = F.addresses.observedResolverProxy;
const RECORD = F.addresses.observedAddressRecord;
const OUTSIDER = F.addresses.unauthorizedProbe;
const pad = (h) => String(h).replace(/^0x/, "").toLowerCase().padStart(64, "0");

// ── the fake chain ────────────────────────────────────────────────────────────────────────────
//
// It replays the captured bytes and REFUSES anything it was not taught, by throwing a named error.
// A fake that answered "0x" to an unrecognised call would make a typo in a selector look like a
// contract that does not implement the function — the single failure shape this whole module
// exists to keep visible.
function urReturn(resolver, inner) {
  return "0x" + pad("40") + pad(resolver) + pad((inner.length / 2 - 1).toString(16)) +
    inner.replace(/^0x/, "").padEnd(64, "0");
}
const ADDR_WORD = "0x" + pad(RECORD);

function fakeChain(overrides = {}) {
  const base = {
    resolveReturn: urReturn(RESOLVER, ADDR_WORD),
    code: "0x" + "60".repeat(77),
    implSlot: F.returns.implementationSlot,
    roleCountRoot: F.returns.roleCountRoot,
    roleCountName: F.returns.roleCountNameLevel,
    rolesRoot: {[RECORD.toLowerCase()]: F.returns.rolesRootAuthorised, [OUTSIDER.toLowerCase()]: F.returns.rolesRootOutsider},
    rolesName: {},
    setAddrReverts: {[OUTSIDER.toLowerCase()]: F.reverts.setAddrFromOutsider.data},
    ...overrides,
  };
  const seen = [];
  const chain = {
    seen,
    async call(to, data, from) {
      seen.push({to, data, from});
      const sel = data.slice(0, 10);
      if (to.toLowerCase() === ENSV2.entryPoint.toLowerCase()) {
        if (base.resolveThrows) { const e = new Error("reverted"); e.data = base.resolveThrows; throw e; }
        return base.resolveReturn;
      }
      if (sel === SELECTOR.roleCount) {
        const res = "0x" + data.slice(10, 74);
        return BigInt(res) === ROOT_RESOURCE ? base.roleCountRoot : base.roleCountName;
      }
      if (sel === SELECTOR.roles) {
        const res = BigInt("0x" + data.slice(10, 74));
        const who = "0x" + data.slice(74 + 24);
        const table = res === ROOT_RESOURCE ? base.rolesRoot : base.rolesName;
        return table[who.toLowerCase()] ?? "0x" + pad("0");
      }
      if (sel === SELECTOR.setAddr) {
        const rev = base.setAddrReverts[String(from).toLowerCase()];
        if (rev) { const e = new Error("reverted"); e.data = rev; throw e; }
        return "0x";
      }
      throw new Error(`the fake chain was not taught ${sel}; teach it rather than guessing`);
    },
    async getCode() { if (base.codeThrows) throw new Error(base.codeThrows); return base.code; },
    async getStorageAt() { return base.implSlot; },
    async estimateGas() { return F.gas.setAddrFromAuthorised; },
  };
  // Only present when a row asks for it, because `readAuthorization` must behave correctly with no
  // log source at all — that is the shape every other command in this directory hands it.
  if (base.getLogs) chain.getLogs = base.getLogs;
  return chain;
}

// ── selectors, against the deployed runtime ───────────────────────────────────────────────────

try {

console.log("— every selector, derived from its signature, pinned to the deployed dispatch table —");
{
  // Found as PUSH4 constants in PermissionedResolverImpl's runtime at Sepolia block
  // 11663892 (17597 bytes). If ENS redeploys the implementation these must be re-derived, which
  // is what `permissioned-live.mjs` does on every run.
  const PINNED = {
    roles: "0x5adf4724", hasRoles: "0xd3bf89b1", hasRootRoles: "0x781ef8db", roleCount: "0x2f27fa24",
    hasAssignees: "0x11b8e00a", getAssigneeCount: "0x3634f911", grantRoles: "0x7c300586",
    revokeRoles: "0xdfa70d8b", grantRootRoles: "0x072d5d77", revokeRootRoles: "0xce156e82",
    addr: "0x3b3b57de", addrCoin: "0xf1cb7e06", text: "0x59d1d43c", hasAddr: "0x32f111d7",
    getAlias: "0xc80ef4e0", recordVersions: "0xd700ff33", resolve: "0x9061b923",
    setAddr: "0xd5fa2b00", setAddrCoin: "0x8b95dd71", setText: "0x10f13a8c",
    setContenthash: "0x304e6ade", setAlias: "0x291770ae", clearRecords: "0x3603d758",
    authorizeNameRoles: "0xbbd9abb5", authorizeTextRoles: "0xf2d1eb25", authorizeAddrRoles: "0x587eefd1",
  };
  for (const [key, want] of Object.entries(PINNED)) {
    eq(`${SIGNATURES[key]} -> ${want}`, SELECTOR[key], want);
  }
  eq("every signature in the table has a selector", Object.keys(SELECTOR).length, Object.keys(SIGNATURES).length);
  check("no two signatures collide", new Set(Object.values(SELECTOR)).size === Object.keys(SELECTOR).length);
  // The instrument itself: a signature that differs by one character must give a different answer.
  check("a one-character change moves the selector",
    selectorFor("setAddr(bytes32,address)") !== selectorFor("setAddr(bytes32,address2)"));
  eq("resolve(bytes,bytes) matches the one resolve.mjs already pinned", SELECTOR.resolve, ENSV2.sel.resolve);
  eq("addr(bytes32) matches the one resolve.mjs already pinned", SELECTOR.addr, ENSV2.sel.addr);
}

console.log("— error selectors, and the one the live chain actually returned —");
{
  eq("EACUnauthorizedAccountRoles", selectorFor(ERROR_SIGNATURES.EACUnauthorizedAccountRoles), "0x4b27a133");
  eq("EACInvalidRoleBitmap", selectorFor(ERROR_SIGNATURES.EACInvalidRoleBitmap), "0x2a7b2d20");
  eq("UnsupportedResolverProfile", selectorFor(ERROR_SIGNATURES.UnsupportedResolverProfile), "0x7b1c461b");
  eq("Panic", selectorFor(ERROR_SIGNATURES.Panic), "0x4e487b71");
  eq("EACRolesChanged topic", EAC_ROLES_CHANGED_TOPIC, F.derived.eacRolesChangedTopic);
  eq("... derived from the event signature", EAC_ROLES_CHANGED_TOPIC,
    toHex(keccak256(utf8(EAC_ROLES_CHANGED_SIGNATURE))));
  eq("the ERC-1967 implementation slot", ERC1967_IMPLEMENTATION_SLOT, F.derived.erc1967ImplementationSlot);
}

console.log("— role constants, confirmed by refusals the deployed contract produced —");
{
  // Each of these three is a real revert captured from Sepolia. The role bitmap inside it is the
  // contract stating which role it demanded, which is the strongest confirmation of a constant
  // that can be had without a wallet.
  const a = decodeRevert(F.reverts.setAddrFromOutsider.data);
  const t = decodeRevert(F.reverts.setTextFromOutsider.data);
  const c = decodeRevert(F.reverts.setContenthashFromOutsider.data);
  eq("setAddr demanded ROLE_SET_ADDR", a.roleBitmap, ROLE.SET_ADDR);
  eq("setText demanded ROLE_SET_TEXT", t.roleBitmap, ROLE.SET_TEXT);
  eq("setContenthash demanded ROLE_SET_CONTENTHASH", c.roleBitmap, ROLE.SET_CONTENTHASH);
  eq("... and all three named the same account", a.account, OUTSIDER);
  eq("... and all three named the same error", a.error, "EACUnauthorizedAccountRoles");
  check("the three roles are three different bits",
    new Set([ROLE.SET_ADDR, ROLE.SET_TEXT, ROLE.SET_CONTENTHASH].map(String)).size === 3);
  eq("roles are spaced four bits apart", ROLE.SET_TEXT / ROLE.SET_ADDR, 16n);
  eq("an admin role sits 128 bits above its role", adminRole(ROLE.SET_ADDR), 1n << 128n);
  eq("roleName reads a bitmap back", roleName(ROLE.SET_ADDR | ROLE.SET_TEXT), "SET_ADDR|SET_TEXT");
  eq("roleName of nothing is null, not an empty string", roleName(0n), null);
}

console.log("— resource derivation: what the chain confirmed, and what it did not —");
{
  const a = decodeRevert(F.reverts.setAddrFromOutsider.data);
  eq("the refusal named the name-level resource", a.resource, F.derived.nameLevelResource);
  eq("nameLevelResource() reproduces it", nameLevelResource(NODE), a.resource);
  eq("namehash agrees with the capture", namehash(NAME), NODE);
  // All three setters named the SAME resource, which is a fact about the deployment and not about
  // the documentation. Recorded as observed rather than explained away.
  eq("setText named the name-level resource too", decodeRevert(F.reverts.setTextFromOutsider.data).resource, a.resource);
  eq("setContenthash named it too", decodeRevert(F.reverts.setContenthashFromOutsider.data).resource, a.resource);
  // The finer derivations are DIFFERENT values, and nothing on chain has confirmed either.
  check("the text-key resource is a different value", textResource(NODE, "unica.payout") !== a.resource);
  check("the coin-type resource is a different value", coinTypeResource(NODE, 0) !== a.resource);
  eq("... and the text-key derivation is labelled unconfirmed",
    RESOURCE_DERIVATIONS.find((r) => r.part === "TEXT_KEY").observed, OBSERVATION.DOCUMENTED_NOT_OBSERVED);
  eq("... and the coin-type derivation is labelled unconfirmed",
    RESOURCE_DERIVATIONS.find((r) => r.part === "COIN_TYPE").observed, OBSERVATION.DOCUMENTED_NOT_OBSERVED);
  eq("... while the name-level one is labelled by the refusal that named it",
    RESOURCE_DERIVATIONS.find((r) => r.part === "NAME_LEVEL").observed, OBSERVATION.REVERT_NAMED_IT);
  eq("a different key gives a different text resource",
    textResource(NODE, "a") === textResource(NODE, "b"), false);
  eq("a different coin type gives a different resource",
    coinTypeResource(NODE, 60) === coinTypeResource(NODE, 0), false);
}

console.log("— decodeRevert classifies every shape, and never returns nothing —");
{
  eq("a known EAC refusal", decodeRevert(F.reverts.setAddrFromOutsider.data).error, "EACUnauthorizedAccountRoles");
  const bitmapErr = decodeRevert(F.reverts.getAssigneeCountWithMultiRoleBitmap.data);
  eq("EACInvalidRoleBitmap is named", bitmapErr.error, "EACInvalidRoleBitmap");
  eq("... and carries the whole-word bitmap it objected to", bitmapErr.roleBitmap, (1n << 256n) - 1n);
  eq("an unknown selector is UNKNOWN_REVERT", decodeRevert("0xdeadbeef").error, "UNKNOWN_REVERT");
  eq("... and keeps the raw selector", decodeRevert("0xdeadbeef").selector, "0xdeadbeef");
  eq("empty revert data is its own thing", decodeRevert("0x").error, "REVERT_WITHOUT_DATA");
  eq("truncated arguments are reported, not decoded",
    decodeRevert("0x4b27a133" + "00".repeat(32)).malformed !== undefined, true);
  check("no shape returns null", ["0x", "0xdeadbeef", "0x4b27a133", F.reverts.setAddrFromOutsider.data]
    .every((d) => decodeRevert(d) !== null && typeof decodeRevert(d).error === "string"));
}

console.log("— the three observations stay three —");
{
  const decoded = await probe({call: async () => F.returns.rolesRootAuthorised}, RESOLVER, "0x00", (h) => uintAt(h, 0));
  eq("a value decodes", decoded.observation, PROBE.DECODED);
  eq("... and is read", decoded.value, BigInt(F.returns.rolesRootAuthorised));
  const empty = await probe({call: async () => "0x"}, RESOLVER, "0x00");
  eq("an empty return is EMPTY_RETURN, not zero", empty.observation, PROBE.EMPTY_RETURN);
  check("... and carries no value", empty.value === undefined);
  const reverted = await probe({call: async () => { const e = new Error("x"); e.data = F.reverts.setAddrFromOutsider.data; throw e; }}, RESOLVER, "0x00");
  eq("a revert is REVERT", reverted.observation, PROBE.REVERT);
  eq("... and is decoded", reverted.revert.error, "EACUnauthorizedAccountRoles");
  const broken = await probe({call: async () => { throw new Error("connection reset"); }}, RESOLVER, "0x00");
  eq("a transport failure is not a revert", broken.observation, PROBE.RPC_FAILURE);
  const undec = await probe({call: async () => "0x1234"}, RESOLVER, "0x00", (h) => uintAt(h, 0));
  eq("a return that will not decode says so", undec.undecodable !== undefined, true);
  // The row above only ever asserted that a FIELD was present, which a consumer that never reads
  // that field satisfies for free. What matters is the OBSERVATION, because every consumer gates
  // on `observation === PROBE.DECODED`. Asserted directly, and asserted to be a different word.
  eq("... and is UNDECODABLE, not DECODED", undec.observation, PROBE.UNDECODABLE);
  check("... so it fails the gate a decoded value passes", undec.observation !== PROBE.DECODED);
  check("... and carries no value to be read as zero", undec.value === undefined);
  check("the five observations are five distinct words", new Set(Object.values(PROBE)).size === 5);
}

console.log("— an unreadable role bitmap is never read as an empty one —");
{
  // The failure this pair exists to keep out: roles() answers with bytes that will not decode, and
  // the machinery downstream reports "the account holds nothing" instead of "I could not tell".
  // CONTROL first — an honest zero must still produce a REFUSED row and ESTABLISH the contrast,
  // otherwise the negative row below would go red for the wrong reason.
  const control = await simulateEdit(NAME, fakeChain());
  const cu = control.rows.find((r) => r.role === "UNAUTHORIZED");
  eq("CONTROL a real 0x0 bitmap runs the unauthorised row", cu.sim, SIM.REFUSED);
  eq("CONTROL ... and the contrast is established", control.contrast, CONTRAST.ESTABLISHED);

  const blind = await simulateEdit(NAME, fakeChain({
    rolesRoot: {[RECORD.toLowerCase()]: F.returns.rolesRootAuthorised, [OUTSIDER.toLowerCase()]: "0xdeadbeef"},
  }));
  const bu = blind.rows.find((r) => r.role === "UNAUTHORIZED");
  eq("an undecodable bitmap makes the unauthorised row a SKIP", bu.sim, SIM.SKIPPED);
  check("... and the SKIP says the roles could not be read", /could not read/.test(bu.reason ?? ""));
  eq("... so the contrast is INCOMPLETE, not ESTABLISHED", blind.contrast, CONTRAST.INCOMPLETE);

  // The same collapse one level up: "is this even a permissioned resolver?" is answered by
  // roleCount(ROOT_RESOURCE), and any non-empty garbage used to satisfy it.
  const notEAC = await readAuthorization(NAME, fakeChain({roleCountRoot: "0xdeadbeef"}));
  eq("an undecodable roleCount is not a permissioned resolver",
     notEAC.status, AUTHZ_STATUS.NOT_A_PERMISSIONED_RESOLVER);
}

console.log("— calldata encoders —");
{
  const d = encodeSetAddrCall(NODE, RECORD);
  eq("setAddr calldata is 4 + 64 bytes", d.length, 2 + 8 + 128);
  eq("... starts with the derived selector", d.slice(0, 10), SELECTOR.setAddr);
  eq("... carries the node", "0x" + d.slice(10, 74), NODE);
  eq("... and the address, left-padded", d.slice(74), pad(RECORD));
  const r = encodeRolesCall(ROOT_RESOURCE, OUTSIDER);
  eq("roles calldata is 4 + 64 bytes", r.length, 2 + 8 + 128);
  eq("... with the resource first", r.slice(10, 74), pad("0"));
  const t = encodeSetTextCall(NODE, "unica.payout", "hello");
  eq("setText head offsets point past the head", t.slice(74, 138), pad("60"));
  eq("... and the value offset clears the key", t.slice(138, 202), pad((0x60 + 0x40).toString(16)));
  check("setText calldata is a whole number of words", (t.length - 10) % 64 === 0);
  const g = encodeGetAssigneeCountCall(ROOT_RESOURCE, ROLE.SET_ADDR);
  eq("getAssigneeCount carries the bitmap", g.slice(74), pad("1"));
  eq("roleCount takes one word", encodeRoleCountCall(ROOT_RESOURCE).length, 2 + 8 + 64);
}

console.log("— managed merchant subnames —");
{
  const s = managedSubname("unica.eth", "acme");
  eq("a subname is derived", s.status, SUBNAME_STATUS.DERIVED);
  eq("... with the expected name", s.name, "acme.unica.eth");
  eq("... and the namehash of that name", s.node, namehash("acme.unica.eth"));
  eq("... and its parent's namehash", s.parentNode, namehash("unica.eth"));
  check("... and a DNS encoding", /^0x04616[0-9a-f]+00$/.test(s.dns));
  check("two merchants get two different nodes",
    managedSubname("unica.eth", "acme").node !== managedSubname("unica.eth", "beta").node);
  check("the same label under two parents differs",
    managedSubname("unica.eth", "acme").node !== managedSubname("other.eth", "acme").node);
  eq("an uppercase label is refused, not lowercased", managedSubname("unica.eth", "ACME").status, SUBNAME_STATUS.BAD_LABEL);
  eq("a dotted label is refused", managedSubname("unica.eth", "a.b").status, SUBNAME_STATUS.BAD_LABEL);
  eq("an empty label is refused", managedSubname("unica.eth", "").status, SUBNAME_STATUS.BAD_LABEL);
  eq("a leading hyphen is refused", managedSubname("unica.eth", "-acme").status, SUBNAME_STATUS.BAD_LABEL);
  eq("a non-ASCII label is refused", managedSubname("unica.eth", "acmé").status, SUBNAME_STATUS.BAD_LABEL);
  eq("a bad parent is refused as a parent", managedSubname("notaname", "acme").status, SUBNAME_STATUS.BAD_PARENT);
  check("a refusal carries no node", managedSubname("unica.eth", "ACME").node === undefined);
}

console.log("— readAuthorization: every branch, including the unknown one —");
{
  const good = await readAuthorization(NAME, fakeChain());
  eq("the happy path reads", good.status, AUTHZ_STATUS.READ);
  eq("... and finds the resolver the UniversalResolver named", good.resolver.toLowerCase(), RESOLVER);
  eq("... and the implementation behind it", good.implementation.toLowerCase(), F.addresses.permissionedResolverImpl);
  eq("... and one authorised account", good.authorized.length, 1);
  eq("... discovered from the chain, not supplied", good.authorized[0].source, "ADDRESS_RECORD");
  eq("... holding SET_ADDR", good.authorized[0].maySetAddr, true);
  eq("... with the root role bitmap the chain returned", good.authorized[0].rootRoles,
     "0x" + BigInt(F.returns.rolesRootAuthorised).toString(16));
  eq("... and the name-level resource", good.nameResource, F.derived.nameLevelResource);

  eq("a wrong chain refuses", (await readAuthorization(NAME, fakeChain(), {chainId: 1})).status, AUTHZ_STATUS.WRONG_CHAIN);
  eq("a name that cannot be normalised refuses",
    (await readAuthorization("notaname", fakeChain())).status, AUTHZ_STATUS.NAME_REFUSED);
  eq("a non-ASCII name refuses",
    (await readAuthorization("mérchant.eth", fakeChain())).status, AUTHZ_STATUS.NAME_REFUSED);
  eq("a resolver-not-found revert is NO_RESOLVER",
    (await readAuthorization(NAME, fakeChain({resolveThrows: "0x77209fe8" + "00".repeat(32)}))).status,
    AUTHZ_STATUS.NO_RESOLVER);
  eq("a zero resolver is NO_RESOLVER",
    (await readAuthorization(NAME, fakeChain({resolveReturn: urReturn("0x" + "0".repeat(40), ADDR_WORD)}))).status,
    AUTHZ_STATUS.NO_RESOLVER);
  eq("a resolver with no code is its own status",
    (await readAuthorization(NAME, fakeChain({code: "0x"}))).status, AUTHZ_STATUS.RESOLVER_HAS_NO_CODE);
  eq("a resolver that does not answer roleCount is NOT a permissioned resolver",
    (await readAuthorization(NAME, fakeChain({roleCountRoot: "0x"}))).status,
    AUTHZ_STATUS.NOT_A_PERMISSIONED_RESOLVER);
  eq("a getCode failure is RPC_FAILURE, not a missing contract",
    (await readAuthorization(NAME, fakeChain({codeThrows: "connection reset"}))).status, AUTHZ_STATUS.RPC_FAILURE);

  // The unknown branch: everything read cleanly and nobody holds the role. This must NOT be READ,
  // and it must NOT be a silent zero.
  const unknown = await readAuthorization(NAME, fakeChain({rolesRoot: {}}));
  eq("nobody authorised is AUTHORITY_UNKNOWN", unknown.status, AUTHZ_STATUS.AUTHORITY_UNKNOWN);
  eq("... and the read still succeeded", unknown.ok, true);
  eq("... with an empty authorised list, not a guess", unknown.authorized.length, 0);
  check("... while the candidate is still reported with its zero bitmap",
    unknown.candidates.length === 1 && unknown.candidates[0].rootRoles === "0x0");
  check("every status is a distinct word", new Set(Object.values(AUTHZ_STATUS)).size === Object.keys(AUTHZ_STATUS).length);
}

console.log("— role holders discovered from EACRolesChanged logs —");
{
  // A second root assignee, named only by a log. On live Sepolia this is how the account that is
  // NOT the address record gets found; the fixture reproduces that shape offline.
  const SECOND = "0xda263b55a67187b6042691b762988b00a69b0af8";
  const withLogs = await readAuthorization(NAME, fakeChain({
    rolesRoot: {
      [RECORD.toLowerCase()]: F.returns.rolesRootAuthorised,
      [SECOND]: F.returns.rolesRootAuthorised,
      [OUTSIDER.toLowerCase()]: F.returns.rolesRootOutsider,
    },
    getLogs: async ({address, topic0}) => ({
      logs: [{blockNumber: "0xaf1234", topics: [topic0, "0x" + pad("0"), "0x" + pad(SECOND)]}],
      window: {fromBlock: 11464008, toBlock: 11664007, exhausted: false},
    }),
  }));
  eq("a log-named account becomes a candidate", withLogs.candidates.length, 2);
  eq("... labelled by where it came from", withLogs.candidates[1].source, "EAC_ROLES_CHANGED_LOG");
  eq("... and it is the account the log named", withLogs.candidates[1].address, SECOND);
  eq("... and it is authorised too", withLogs.authorized.length, 2);
  eq("the window that was scanned is reported", withLogs.logWindow.toBlock, 11664007);
  check("... and says whether it reached genesis", withLogs.logWindow.exhausted === false);

  // A log source that fails must NOT look like a log source that found nothing.
  const brokenLogs = await readAuthorization(NAME, fakeChain({
    getLogs: async () => { throw new Error("exceed maximum block range: 50000"); },
  }));
  check("a failing log scan is reported as an error, not as an empty result",
    typeof brokenLogs.logWindow?.error === "string");
  eq("... and the address-record candidate is still found", brokenLogs.candidates.length, 1);

  // With no log source at all, the field is null — distinguishable from both of the above.
  const noLogs = await readAuthorization(NAME, fakeChain());
  eq("no log source gives a null window, not an empty one", noLogs.logWindow, null);
  eq("... and the read still succeeds", noLogs.status, AUTHZ_STATUS.READ);
}

console.log("— the simulation: two rows, and a contrast that can fail —");
{
  const out = await simulateEdit(NAME, fakeChain());
  eq("both rows ran", out.rows.length, 2);
  eq("the authorised row is accepted", out.rows[0].sim, SIM.ACCEPTED);
  eq("the unauthorised row is refused", out.rows[1].sim, SIM.REFUSED);
  eq("... by name", out.rows[1].revert.error, "EACUnauthorizedAccountRoles");
  eq("... naming the resource it checked", out.rows[1].revert.resource, F.derived.nameLevelResource);
  eq("the contrast is established", out.contrast, CONTRAST.ESTABLISHED);
  eq("the probe address is derived, not written down", out.rows[1].from, unauthorizedProbeAddress());
  eq("... and matches the address the live chain refused", out.rows[1].from, OUTSIDER);
  eq("the simulated edit is a no-op", out.edit.isNoOp, true);

  // The instrument, validated by sabotage. If the resolver stopped refusing the outsider, the
  // contrast must go to NOT_ESTABLISHED — a pair that cannot report a failure is decoration.
  const permissive = await simulateEdit(NAME, fakeChain({setAddrReverts: {}}));
  eq("a resolver that refuses nobody breaks the contrast", permissive.contrast, CONTRAST.NOT_ESTABLISHED);
  eq("... and both rows read as accepted", permissive.rows.map((r) => r.sim).join(","),
     `${SIM.ACCEPTED},${SIM.ACCEPTED}`);

  // And the other direction: no authority found means the authorised row is a stated SKIP.
  const noAuthority = await simulateEdit(NAME, fakeChain({rolesRoot: {}}));
  eq("no authority makes the authorised row a SKIP", noAuthority.rows[0].sim, SIM.SKIPPED);
  check("... whose reason says it is a SKIP", /this is a SKIP, not a pass/.test(noAuthority.rows[0].reason));
  eq("... and the contrast is INCOMPLETE, never ESTABLISHED", noAuthority.contrast, CONTRAST.INCOMPLETE);

  // A probe account that turns out to hold roles proves nothing, and must not be counted.
  const compromised = await simulateEdit(NAME, fakeChain({
    rolesRoot: {[RECORD.toLowerCase()]: F.returns.rolesRootAuthorised, [OUTSIDER.toLowerCase()]: F.returns.rolesRootAuthorised},
  }));
  eq("an unauthorised row from an authorised account is a SKIP", compromised.rows[1].sim, SIM.SKIPPED);
  eq("... and the contrast is INCOMPLETE", compromised.contrast, CONTRAST.INCOMPLETE);

  // simulateFrom's precondition: without an observed code size, ACCEPTED is indistinguishable from
  // calling an empty address.
  const noCode = await simulateFrom({call: async () => "0x"}, {resolver: RESOLVER, codeSize: 0, data: "0x00", from: RECORD});
  eq("a zero code size makes acceptance UNKNOWN, not ACCEPTED", noCode.sim, SIM.UNKNOWN);
}

console.log("— the preview: the control first, then the sabotage —");
{
  const read = await readAuthorization(NAME, fakeChain());

  // THE CONTROL. Built before the negative row, because a negative row that has never been shown
  // to pass on good input is not evidence of anything.
  const ok = buildPreview(read, {target: RECORD, gas: F.gas.setAddrFromAuthorised, atBlock: F.capturedAt.blockNumber});
  eq("a well-formed preview is produced", ok.status, PREVIEW_STATUS.READY);
  eq("... and is signable", previewIsSignable(ok), true);
  eq("... and carries the marker", ok.marker, OWNER_MARKER);
  eq("... on Sepolia", ok.transaction.chainId, ENSV2.chainId);
  eq("... to the resolver the reading found", ok.transaction.to.toLowerCase(), RESOLVER);
  eq("... from the account the reading found", ok.transaction.from.toLowerCase(), RECORD);
  eq("... with zero value", ok.transaction.value, "0x0");
  eq("... and calldata that is exactly the setAddr encoding", ok.transaction.data, encodeSetAddrCall(NODE, RECORD));
  eq("... decoded back to its signature", ok.decoded.signature, SIGNATURES.setAddr);
  eq("... with two named arguments", ok.decoded.arguments.length, 2);
  eq("... the gas estimate the chain gave", ok.gas.estimateDecimal, Number(BigInt(F.gas.setAddrFromAuthorised)));
  eq("... the role the edit needs", ok.authorization.requiredRoleBitmap, "0x" + ROLE.SET_ADDR.toString(16));
  eq("... the resource it is checked against", ok.authorization.resource, F.derived.nameLevelResource);
  eq("... and the observation that it holds", ok.authorization.holds, true);
  eq("the preview says it cannot broadcast", ok.broadcast.byThisTool, false);

  // THE SABOTAGE. Same reading, same everything, with ONLY the authorization observation removed.
  // The precondition is reproduced rather than the defence omitted: `resolver`, `node`, `chainId`,
  // `addrRecord` and the candidate list are all still there, so a builder that stopped checking
  // would happily produce a preview.
  const stripped = {...read, authorized: []};
  const bad = buildPreview(stripped, {target: RECORD, gas: F.gas.setAddrFromAuthorised});
  eq("a preview with no authorization check is REFUSED", bad.status, PREVIEW_STATUS.NO_AUTHORIZATION_CHECK);
  check("... and produces no transaction", bad.transaction === undefined);
  eq("... and is not signable", previewIsSignable(bad), false);
  check("... and is explained", typeof bad.explain === "string" && bad.explain.length > 0);
  // Prove the sabotage was the only difference: everything else the builder needs is still present.
  check("the sabotaged reading still has its resolver, node and record",
    stripped.resolver === read.resolver && stripped.node === read.node && stripped.addrRecord === read.addrRecord);

  // The neighbouring refusals.
  const wrongAccount = buildPreview(read, {target: RECORD, gas: "0x1", from: OUTSIDER});
  eq("an account the chain did not show holding the role is refused",
     wrongAccount.status, PREVIEW_STATUS.AUTHORIZATION_UNPROVEN);
  eq("a non-zero value is refused", buildPreview(read, {target: RECORD, gas: "0x1", value: "0x1"}).status,
     PREVIEW_STATUS.VALUE_MUST_BE_ZERO);
  eq("no gas estimate is refused", buildPreview(read, {target: RECORD}).status, PREVIEW_STATUS.NO_GAS_ESTIMATE);
  eq("no target is refused", buildPreview({...read, addrRecord: null}, {gas: "0x1"}).status, PREVIEW_STATUS.MISSING_TARGET);
  eq("a wrong chain is refused", buildPreview({...read, chainId: 1}, {target: RECORD, gas: "0x1"}).status,
     PREVIEW_STATUS.WRONG_CHAIN);
  eq("a failed reading is not a preview", buildPreview({ok: false, status: "X"}, {gas: "0x1"}).status,
     PREVIEW_STATUS.NOT_A_READING);
  for (const f of ["resolver", "node", "authorized", "candidates"]) {
    eq(`supplying '${f}' through options is refused`,
       buildPreview(read, {target: RECORD, gas: "0x1", [f]: "0x" + "11".repeat(20)}).status,
       PREVIEW_STATUS.NOT_A_READING);
  }
  check("previewIsSignable rejects a bare object", previewIsSignable({ok: true, status: "READY"}) === false);
  check("previewIsSignable rejects undefined", previewIsSignable(undefined) === false);
}

console.log("— the interface ledger is honest about its own evidence —");
{
  for (const row of INTERFACE) {
    check(`${SIGNATURES[row.key]} has a signature and an observation`,
      typeof SIGNATURES[row.key] === "string" && Object.values(OBSERVATION).includes(row.observed));
  }
  check("every setter that was confirmed by a refusal says REVERT_NAMED_IT",
    ["setAddr", "setText", "setContenthash", "setAddrCoin"]
      .every((k) => INTERFACE.find((r) => r.key === k).observed === OBSERVATION.REVERT_NAMED_IT));
  check("nothing in the ledger claims an observation it does not have a word for",
    INTERFACE.every((r) => OBSERVATION[r.observed] === r.observed));
  eq("the ledger covers every signature", INTERFACE.length, Object.keys(SIGNATURES).length);
}

console.log("— this directory cannot broadcast, and the check that says so can fail —");
{
  // Comments are stripped before scanning, so a file may DESCRIBE the methods it refuses to use.
  // A guard that fires on its own documentation gets ignored, and an ignored guard protects nothing.
  const WRITING = /["'](eth_sendRawTransaction|eth_sendTransaction|eth_signTransaction|personal_sign|eth_sign)["']/;
  const stripComments = (src) => src.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  // This suite is the one file excluded, and the exclusion is named rather than pattern-matched:
  // it is where the known-bad inputs live, so scanning it would be the guard firing on its own
  // test fixture. The exclusion is asserted to be exactly one file, so it cannot quietly widen.
  const SELF = "permissioned-test.mjs";
  const all = readdirSync("integrations/ensv2").filter((f) => f.endsWith(".mjs"));
  const files = all.filter((f) => f !== SELF);
  check("there are files to scan", files.length >= 5, `found ${files.length}`);
  eq("exactly one file is excluded, and it is this one", all.length - files.length, 1);
  for (const f of files) {
    const src = stripComments(readFileSync(`integrations/ensv2/${f}`, "utf8"));
    check(`${f} names no writing JSON-RPC method in code`, !WRITING.test(src));
    check(`${f} reads no private key`, !/PRIVATE_KEY|privateKey|mnemonic|seedPhrase/i.test(src));
  }
  // Validate the instrument by sabotage, both ways.
  check("the scanner fires on a writing method in code position",
    WRITING.test(stripComments('const m = "eth_sendRawTransaction";')));
  check("the scanner does NOT fire on the same name inside a comment",
    !WRITING.test(stripComments('// we never call "eth_sendRawTransaction" here')));
  check("the scanner does not fire on eth_call", !WRITING.test('const m = "eth_call";'));
}

console.log("— an endpoint is a credential, so only its origin is ever printed —");
{
  // An RPC URL routinely carries the key in the path, the query or userinfo. Every command here
  // echoes its endpoint, and the failure path echoes it too — which is the output that gets pasted
  // into a bug report. CONTROL first: a bare public endpoint must survive intact, otherwise the
  // rows below would pass simply because the function mangles everything.
  eq("CONTROL a plain endpoint is printed unchanged",
     redactRpc("https://ethereum-sepolia-rpc.publicnode.com"), "https://ethereum-sepolia-rpc.publicnode.com");

  const KEY = "sk_live_thisIsTheSecretPart";
  for (const [shape, url] of [
    ["a key in the path", `https://eth-sepolia.g.example.com/v2/${KEY}`],
    ["a key in the query", `https://rpc.example.com/?apikey=${KEY}`],
    ["a key in userinfo", `https://user:${KEY}@rpc.example.com`],
  ]) {
    const out = redactRpc(url);
    check(`${shape} does not survive redaction`, !out.includes(KEY), out);
    check(`... and the host is still named, so the row stays useful`, out.includes("example.com"), out);
    check(`... and the reader is told something was removed`, /redacted/.test(out), out);
  }
  // A URL that will not parse must refuse, not fall through to the raw string.
  check("an unparseable endpoint is redacted rather than echoed",
    !redactRpc(`not-a-url-${KEY}`).includes(KEY), redactRpc(`not-a-url-${KEY}`));

  // And the guard that matters most: no entry point may interpolate the raw endpoint into output.
  // Scanned in code position, comments stripped, exactly like the broadcast scanner above.
  const RAW_RPC_ECHO = /(?:console\.(?:log|error|warn)|process\.std(?:out|err)\.write)\([^\n]*\$\{\s*RPC\s*\}/;
  const strip = (src) => src.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const scanned = readdirSync("integrations/ensv2")
    .filter((x) => x.endsWith(".mjs") && x !== "permissioned-test.mjs");
  check("there are files to scan for a raw endpoint echo", scanned.length >= 5, `found ${scanned.length}`);
  for (const f of scanned) {
    const src = strip(readFileSync(`integrations/ensv2/${f}`, "utf8"));
    check(`${f} never prints the raw endpoint`, !RAW_RPC_ECHO.test(src));
  }
  check("the endpoint scanner fires on a raw echo",
    RAW_RPC_ECHO.test('console.log(`rpc ${RPC}`);'));
  check("the endpoint scanner does NOT fire on a redacted echo",
    !RAW_RPC_ECHO.test('console.log(`rpc ${redactRpc(RPC)}`);'));
}

} catch (e) {
  // A throw is a failure with a reason, not a crash. Without this, one bad call takes the summary
  // and the exit status down with it and a piped run reads as a pass — measured while sabotaging
  // the preview's authorization guard, which turned a classified refusal into a raw TypeError and
  // left this suite printing no verdict at all.
  check("the suite ran to the end", false, `threw: ${e.stack ?? e.message}`);
}

console.log(`\nchecks run: ${pass + fail}, passed: ${pass}, failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
