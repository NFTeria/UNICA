// The role planner — the piece that decides what authority a delegated agent is given, and
// refuses to emit anything else.
//
// WHAT THIS IS FOR. UNICA's merchant architecture ends with a delegated agent that publishes its
// own status under `agent.treasury.merchant.<parent>`. This file is the only place in the
// repository allowed to construct the call that gives it that authority.
//
// THE DELEGATION CALL IS `authorizeTextRoles`, AND THIS FILE USED TO HAVE IT WRONG.
//
// Until this revision every constructor here built `grantRoles(resource, bitmap, account)` — the
// EAC call the documentation leads you to. This deployment REFUSES it. Sent from the name owner,
// holding every role at ROOT_RESOURCE, `grantRoles` reverts with `EACCannotGrantRoles`
// (0xd1a3b355), and the revert data names the resource, the bitmap and the account back, so the
// contract is quoting itself. The call it ACCEPTS is
//
//     authorizeTextRoles(bytes dnsName, string key, address account, bool granted)   0xf2d1eb25
//
// and its siblings `authorizeAddrRoles` and `authorizeDataRoles`. This was established by
// executing them against the deployed bytecode on a pinned Sepolia fork, not by reading a
// document — `P.DELEGATION_MECHANISM` carries the rows, each refusal with an accepted control
// beside it. The old code would have produced a transaction the owner signs, pays for and watches
// fail, while everything downstream reported the delegation as done.
//
// PER-KEY SCOPING IS AVAILABLE, AND THIS FILE USED TO DENY IT.
//
// The previous version of this header said, in bold, that "there is no such thing, on this
// deployment, as 'may set only the text key unica:status'" and that "the smallest scope any
// refusal has ever named is one whole name". That was inferred from refusals only, and it is
// WRONG. A refusal of `setText` names the resource the CALLER lacked — the name-level one — which
// says nothing about where an AUTHORIZATION writes. `authorizeTextRoles` grants SET_TEXT at a
// PER-KEY resource:
//
//     resource = keccak256(abi.encode(node, keccak256(bytes(key))))
//
// On the fork, an agent authorized for `unica.treasury.status` wrote that key and was REFUSED
// (`EACUnauthorizedAccountRoles`, 0x4b27a133) on a different key of the same name, which read back
// empty. The scope really is one key. The old claim is left described here rather than deleted,
// because the code that trusted it is what this revision is repairing.
//
// THE SCREEN DID NOT HAVE TO BE WEAKENED TO ACCEPT THE NEW CALL. `authorizeTextRoles` mentions no
// resource and no bitmap in its arguments, so a screen that only read arguments would have nothing
// to look at. Instead `delegationScope` derives the EFFECTIVE triple the chain will have written —
// resource, bitmap, account — and `screenAgentGrant` checks that, in exactly the vocabulary it
// already had. Every refusal that guarded the old path still guards this one.
//
// IT REFUSES RATHER THAN AVOIDS. The repository's law is that a transaction granting the agent
// authority on ROOT_RESOURCE is invalid and must be rejected BY THE PLANNER, not merely left
// unwritten. "We never build that call" is a property of today's code; "the builder refuses that
// call with a named error" is a property that survives the next person editing it. So every
// constructor here runs `screenAgentGrant` on its own output before returning it, and
// `screenPlanForAgentAuthority` re-runs the same screen over a whole assembled plan — a second
// pass over calls this file may not have built. Both have sabotage rows in the suite.
//
// EVERY BITMAP IS DERIVED FROM THE PROFILE, NEVER FROM MEMORY. `profile.mjs` pins what a live
// Sepolia read returned, with each row labelled by HOW it was observed. This file looks roles up
// there by NAME and takes the `bit` field. It never writes `1n << 4n`, and it refuses to grant a
// role whose profile row is not marked as observed on the deployment — a documented-only role bit
// is a guess, and a guessed bit in a grant is a permission nobody chose.
//
// THE RESOURCE IS THE SEPARATION — and it is now a per-KEY resource, not a per-name one.
//
//   ┌─ SUPERSEDED. The paragraph that stood here read: "Phase 1 established that this deployment
//   │  scopes every observed resolver refusal to the NAME-LEVEL resource […] There is therefore no
//   │  such thing, on this deployment, as 'may set only the text key unica:status'. The smallest
//   │  scope any refusal has ever named is one whole name."  It is REFUTED — see the block above
//   └─ for the measurement that refutes it. It is quoted rather than deleted because two files and
//      a test were built on it, and a reader meeting them needs to know what they were built on.
//
// What survives from it, and is still the load-bearing idea: the agent is given authority at the
// resource of a LEAF NAME that carries nothing the merchant relies on, and no authority at any
// resource belonging to the merchant's own names. That defence never depended on the granularity
// question, which is why the wrong claim did not become a wrong grant. Per-key scoping is now a
// second, tighter ring inside it. `DENIAL_MATRIX` states the remaining residual out loud.
//
// NOTHING HERE SIGNS OR BROADCASTS. Calls are built as calldata and returned. No key is read, no
// writing JSON-RPC method is named, and `permissioned-test.mjs` scans this directory and fails if
// either ever becomes untrue.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {utf8, wordAddress, wordUint} from "../permit2/digest.mjs";
import {SELECTOR, SIGNATURES, tailBytes, tailString} from "./permissioned.mjs";
import {namehash} from "../../web/ensv2/resolve.mjs";
import * as P from "./profile.mjs";

const hexBody = (h) => String(h ?? "").replace(/^0x/, "").toLowerCase();
const w = (bytes) => hexBody(toHex(bytes));
const isAddress = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
const isWord = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
const lower = (v) => String(v ?? "").toLowerCase();
const asWord = (v) => "0x" + BigInt(v).toString(16).padStart(64, "0");

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/// Decode a DNS-encoded name back to its namehash, so the two forms of one name can be checked
/// against each other. Returns null on anything malformed rather than throwing, because a caller
/// that passed rubbish should get a refusal it can print, not an exception it has to catch.
export function namehashFromDns(dnsHex) {
  const b = hexBody(dnsHex);
  if (b.length % 2 !== 0) return null;
  const bytes = new Uint8Array(b.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(b.slice(i * 2, i * 2 + 2), 16);
  const labels = [];
  let i = 0;
  while (i < bytes.length) {
    const len = bytes[i];
    if (len === 0) {
      // The terminator must be the LAST byte. Trailing rubbish after it would otherwise be ignored
      // and two different byte strings would hash to the same name.
      if (i !== bytes.length - 1) return null;
      const dec = new TextDecoder("utf-8", {fatal: true});
      try { return namehash(labels.map((l) => dec.decode(l)).join(".")); } catch { return null; }
    }
    if (len > 63 || i + 1 + len > bytes.length) return null;
    labels.push(bytes.slice(i + 1, i + 1 + len));
    i += 1 + len;
  }
  return null;  // ran off the end with no terminator
}

// ── the vocabulary of refusal ─────────────────────────────────────────────────────────────────
//
// Each of these is a distinct reason a grant is invalid, and they are separate words on purpose.
// A single "INVALID" would let two very different mistakes — the wrong resource, and the right
// resource with an admin bit — print the same sentence, and the reader would learn nothing about
// which one happened.

export const GRANT_STATUS = {
  PLANNED: "PLANNED",
  ROOT_RESOURCE_FORBIDDEN: "ROOT_RESOURCE_FORBIDDEN",
  ROOT_ROLES_METHOD_FORBIDDEN: "ROOT_ROLES_METHOD_FORBIDDEN",
  ADMIN_ROLE_FORBIDDEN: "ADMIN_ROLE_FORBIDDEN",
  ROLE_NOT_ALLOWLISTED: "ROLE_NOT_ALLOWLISTED",
  ROLE_NOT_OBSERVED: "ROLE_NOT_OBSERVED",
  EMPTY_BITMAP: "EMPTY_BITMAP",
  WRONG_RESOURCE: "WRONG_RESOURCE",
  PROTECTED_RESOURCE: "PROTECTED_RESOURCE",
  REGISTRY_TARGET_FORBIDDEN: "REGISTRY_TARGET_FORBIDDEN",
  BAD_ACCOUNT: "BAD_ACCOUNT",
  AGENT_IS_MERCHANT: "AGENT_IS_MERCHANT",
  AGENT_HOLDS_ROOT_ROLES: "AGENT_HOLDS_ROOT_ROLES",
  ASSIGNEE_CAP_REACHED: "ASSIGNEE_CAP_REACHED",
  ASSIGNEE_COUNT_UNOBSERVED: "ASSIGNEE_COUNT_UNOBSERVED",
  GRANT_ROLES_NOT_THE_DELEGATION_PATH: "GRANT_ROLES_NOT_THE_DELEGATION_PATH",
  NAME_LEVEL_METHOD_FORBIDDEN: "NAME_LEVEL_METHOD_FORBIDDEN",
  SCOPE_KEY_MISSING: "SCOPE_KEY_MISSING",
  SCOPE_KEY_NOT_ALLOWLISTED: "SCOPE_KEY_NOT_ALLOWLISTED",
};

export const GRANT_EXPLAIN = {
  PLANNED: "The grant is within the allowlist and scoped to the agent's own leaf resource.",
  ROOT_RESOURCE_FORBIDDEN: "ROOT_RESOURCE is contract-wide authority. No agent grant may name it.",
  ROOT_ROLES_METHOD_FORBIDDEN: "grantRootRoles/revokeRootRoles grant contract-wide authority whatever their arguments say.",
  ADMIN_ROLE_FORBIDDEN: "The bitmap sets a bit at or above 128, which is an admin role. An agent that can administer a role can re-grant it.",
  ROLE_NOT_ALLOWLISTED: "That role is not in the agent allowlist. The allowlist is the permission model; a role outside it is not a smaller mistake, it is a different one.",
  ROLE_NOT_OBSERVED: "That role's bit is documented but was never named back by this deployment. A guessed bit in a grant is a permission nobody chose.",
  EMPTY_BITMAP: "A grant of no roles is not a grant; it is a transaction that costs gas and reads as a delegation.",
  WRONG_RESOURCE: "The resource is not the name-level resource of the agent's own leaf name.",
  PROTECTED_RESOURCE: "That resource belongs to a name the merchant relies on. The agent gets nothing there.",
  REGISTRY_TARGET_FORBIDDEN: "The target is a PermissionedRegistry. Registry roles move names, resolvers and subregistries; no agent grant may target one.",
  BAD_ACCOUNT: "The grantee is not a 20-byte address, or is the zero address.",
  AGENT_IS_MERCHANT: "The agent address equals the merchant's. A delegation to yourself is not a delegation and it cannot be revoked meaningfully.",
  AGENT_HOLDS_ROOT_ROLES: "The agent already holds roles at ROOT_RESOURCE on this contract. Narrowing a grant is pointless while a wider one stands.",
  ASSIGNEE_CAP_REACHED: "This role already has the maximum number of assignees at this resource, as the contract itself reports it.",
  ASSIGNEE_COUNT_UNOBSERVED: "No getAssigneeCount reading was supplied, so the 15-account limit could not be checked. Unchecked is not the same as satisfied.",
  GRANT_ROLES_NOT_THE_DELEGATION_PATH:
    "grantRoles is not how a delegation is made on this deployment: it is REFUSED with EACCannotGrantRoles even when the name owner sends it. Use authorizeTextRoles.",
  NAME_LEVEL_METHOD_FORBIDDEN:
    "authorizeNameRoles grants a bitmap at the NAME-LEVEL resource, which carries every record on the name. It is the wide call, and no agent delegation may use it.",
  SCOPE_KEY_MISSING:
    "A scoped delegation needs the exact record key it is scoped to. Without one there is no per-key resource to compute, and the call would have to fall back to the name level.",
  SCOPE_KEY_NOT_ALLOWLISTED:
    "That record key is not in this repository's published key vocabulary. A delegation may only be scoped to a key the plan is allowed to write.",
};

const refuse = (status, extra = {}) => ({ok: false, status, explain: GRANT_EXPLAIN[status], ...extra});

// ── what the agent may ever be given ──────────────────────────────────────────────────────────
//
// An allowlist, by ROLE NAME, resolved against the profile at call time. Two properties matter and
// both are checked below rather than assumed: the name must exist in the profile's resolver role
// table, and its row must be marked as actually observed on this deployment.
//
// SET_TEXT is the whole of the default. The agent publishes its own liveness and capability
// strings on its own leaf; it never needs to publish an address, and giving it SET_ADDR would let
// it point its own leaf at any address — harmless in itself, and one fewer thing to reason about
// if it simply does not have it. SET_ADDR is available as an opt-in because an agent that also
// publishes an operational address is a legitimate configuration; it is never the default and the
// preview says which one was chosen.

export const AGENT_ALLOWLIST = Object.freeze(["SET_TEXT", "SET_ADDR"]);
export const AGENT_DEFAULT_ROLES = Object.freeze(["SET_TEXT"]);

/// The observation labels strong enough to grant on. PUSH4 presence is deliberately NOT here: it
/// proves a selector is dispatched and says nothing about which bit the contract checks.
const GRANTABLE_OBSERVATIONS = new Set([P.OBSERVED.REVERT_NAMED_IT, P.OBSERVED.DECODED]);

/// Resolve role names to a bitmap, out of the profile, refusing anything it cannot stand behind.
///
/// Returns {ok, bitmap, roles} or a refusal. It does not throw: a caller that gets a bitmap back
/// has one it may use, and a caller that gets a refusal has a reason to print.
export function agentRoleBitmap(roleNames) {
  const names = Array.isArray(roleNames) ? roleNames : [roleNames];
  if (names.length === 0) return refuse(GRANT_STATUS.EMPTY_BITMAP, {roleNames: names});
  let bitmap = 0n;
  const roles = [];
  for (const n of names) {
    if (!AGENT_ALLOWLIST.includes(n)) return refuse(GRANT_STATUS.ROLE_NOT_ALLOWLISTED, {role: n, allowlist: [...AGENT_ALLOWLIST]});
    const row = P.RESOLVER_ROLE[n];
    if (!row) return refuse(GRANT_STATUS.ROLE_NOT_ALLOWLISTED, {role: n, detail: "no such role in the profile's resolver table"});
    if (!GRANTABLE_OBSERVATIONS.has(row.observed)) {
      return refuse(GRANT_STATUS.ROLE_NOT_OBSERVED, {role: n, observed: row.observed, evidence: row.evidence});
    }
    bitmap |= BigInt(row.bit);
    roles.push({name: n, bit: asWord(row.bit), observed: row.observed, evidence: row.evidence});
  }
  if (bitmap === 0n) return refuse(GRANT_STATUS.EMPTY_BITMAP, {roleNames: names});
  return {ok: true, bitmap, roles};
}

/// Human-readable names for a resolver bitmap, from the profile table. Used by the preview so a
/// reader never has to decode a hex word by eye. An unrecognised bit is reported as unrecognised,
/// never dropped — a bit with no name is the most interesting bit in the word.
function describeWith(table, extras, bitmap) {
  let b = BigInt(bitmap);
  const named = [];
  for (const [name, row] of Object.entries(table)) {
    const bit = BigInt(row.bit);
    if ((b & bit) === bit) { named.push(name); b &= ~bit; }
    const admin = P.adminRole(bit);
    if ((b & admin) === admin) { named.push(`ADMIN(${name})`); b &= ~admin; }
  }
  for (const [name, row] of Object.entries(extras)) {
    const bit = BigInt(row.bit);
    if ((b & bit) === bit) { named.push(name); b &= ~bit; }
  }
  return {named, unrecognised: b === 0n ? null : asWord(b), isAdmin: (BigInt(bitmap) >> P.ADMIN_SHIFT) !== 0n};
}

export const describeResolverBitmap = (bitmap) => describeWith(P.RESOLVER_ROLE, {}, bitmap);

/// The registry's table is a DIFFERENT table over the same 256 bits. Naming a registry bitmap with
/// resolver names produces a sentence that reads perfectly and is wrong in every word — 1<<24 is
/// SET_RESOLVER on a registry and SET_NAME on a resolver — so the caller says which contract it is
/// looking at and there is no default that guesses.
export const describeRegistryBitmap = (bitmap) => describeWith(
  P.REGISTRY_ROLE,
  {CAN_TRANSFER_ADMIN: P.REGISTRY_ROLE_CAN_TRANSFER_ADMIN, UNNAMED_BIT_32: P.REGISTRY_ROLE_UNNAMED_BIT_32},
  bitmap,
);

export const ROLE_TABLE = {RESOLVER: "resolver", REGISTRY: "registry"};
export const describeBitmap = (bitmap, table = ROLE_TABLE.RESOLVER) =>
  table === ROLE_TABLE.REGISTRY ? describeRegistryBitmap(bitmap) : describeResolverBitmap(bitmap);

// ── the screen ────────────────────────────────────────────────────────────────────────────────
//
// One function, applied to every agent-facing call this repository produces, wherever it was
// built. It takes the call in its decoded form plus the context that says which resource belongs
// to whom, and answers PLANNED or a named refusal.
//
// The order of the checks is chosen so the most dangerous condition is reported first even when a
// call is wrong in several ways at once. A call that names ROOT_RESOURCE *and* an admin bit should
// print ROOT_RESOURCE_FORBIDDEN, because that is the one the reader must act on.

/// @param g   {method, to, resource, roleBitmap, account}
/// @param ctx {agentResource, agentAddress, merchantAddress, protectedResources[],
///             registryAddresses[], agentRootRoles, assigneeReading}
export function screenAgentGrant(g, ctx = {}) {
  const method = String(g?.method ?? "");
  if (method === "grantRootRoles" || method === "revokeRootRoles") {
    return refuse(GRANT_STATUS.ROOT_ROLES_METHOD_FORBIDDEN, {method});
  }

  const resource = BigInt(g?.resource ?? 0n);
  if (resource === BigInt(P.ROOT_RESOURCE)) {
    return refuse(GRANT_STATUS.ROOT_RESOURCE_FORBIDDEN, {resource: asWord(resource)});
  }

  // `authorizeNameRoles` is refused HERE, after ROOT_RESOURCE and before everything else, because
  // it is dangerous by NAME rather than by argument: it takes a bitmap and writes it at the
  // name-level resource, which carries every record on the name. Executed on the fork so this is
  // not theoretical — after authorizeNameRoles(dns, SET_TEXT, agent, true), roles(nameResource,
  // agent) read 0x10 and the agent's setText on a key nobody had authorised was ACCEPTED.
  if (method === "authorizeNameRoles") {
    return refuse(GRANT_STATUS.NAME_LEVEL_METHOD_FORBIDDEN, {method});
  }

  const registries = (ctx.registryAddresses ?? []).map(lower);
  if (registries.includes(lower(g?.to))) {
    return refuse(GRANT_STATUS.REGISTRY_TARGET_FORBIDDEN, {to: g?.to});
  }

  const bitmap = BigInt(g?.roleBitmap ?? 0n);
  if (bitmap === 0n) return refuse(GRANT_STATUS.EMPTY_BITMAP);
  if ((bitmap >> P.ADMIN_SHIFT) !== 0n) {
    return refuse(GRANT_STATUS.ADMIN_ROLE_FORBIDDEN, {roleBitmap: asWord(bitmap), adminHalf: asWord(bitmap >> P.ADMIN_SHIFT)});
  }

  // Every set bit must be an allowlisted, observed role. Reconstructing the allowed bitmap and
  // comparing is what makes an unnamed bit — a bit the profile records as in use but unnamed, for
  // instance — a refusal rather than a silent pass.
  const allowed = agentRoleBitmap([...AGENT_ALLOWLIST]);
  /* c8 ignore next */
  if (!allowed.ok) return allowed;
  if ((bitmap & ~allowed.bitmap) !== 0n) {
    return refuse(GRANT_STATUS.ROLE_NOT_ALLOWLISTED, {
      roleBitmap: asWord(bitmap), outsideAllowlist: asWord(bitmap & ~allowed.bitmap), allowlist: [...AGENT_ALLOWLIST],
    });
  }

  // Protected NAMES are checked by NODE as well as by resource, and the node check has to be here
  // because the resource one is no longer sufficient. `protectedResources` holds NAME-LEVEL
  // resources; a delegation now lands at a PER-KEY resource, and the per-key resource of a
  // protected name is not in that list. Screening a delegation at
  // keccak256(abi.encode(payNode, keccak256("unica:executor"))) against a list containing only
  // keccak256(abi.encode(payNode, 0)) therefore PASSED — measured, not imagined, while reviewing
  // this change. Enumerating every key a protected name might carry cannot be complete; the node
  // is what identifies the name, so the node is what is checked.
  const protectedNodes = new Set((ctx.protectedNodes ?? []).map(lower));
  if (g?.node !== undefined && g?.node !== null && protectedNodes.has(lower(g.node))) {
    return refuse(GRANT_STATUS.PROTECTED_RESOURCE, {
      node: g.node, resource: asWord(resource),
      detail: "the delegation is scoped to a name the merchant relies on, at whatever key",
    });
  }
  const protectedSet = new Set((ctx.protectedResources ?? []).map((r) => lower(asWord(r))));
  if (protectedSet.has(lower(asWord(resource)))) {
    return refuse(GRANT_STATUS.PROTECTED_RESOURCE, {resource: asWord(resource)});
  }
  if (ctx.agentResource === undefined || ctx.agentResource === null) {
    return refuse(GRANT_STATUS.WRONG_RESOURCE, {detail: "no agent resource was supplied to screen against"});
  }
  if (lower(asWord(resource)) !== lower(asWord(ctx.agentResource))) {
    return refuse(GRANT_STATUS.WRONG_RESOURCE, {resource: asWord(resource), expected: asWord(ctx.agentResource)});
  }

  const account = g?.account;
  if (!isAddress(account) || lower(account) === ZERO_ADDRESS) return refuse(GRANT_STATUS.BAD_ACCOUNT, {account});
  if (ctx.agentAddress && lower(account) !== lower(ctx.agentAddress)) {
    return refuse(GRANT_STATUS.BAD_ACCOUNT, {account, expected: ctx.agentAddress, detail: "the grantee is not the agent this plan is for"});
  }
  if (ctx.merchantAddress && lower(account) === lower(ctx.merchantAddress)) {
    return refuse(GRANT_STATUS.AGENT_IS_MERCHANT, {account});
  }

  // The hard precondition on the whole architecture. If the agent already holds anything at
  // ROOT_RESOURCE on this contract, then it already has the authority this grant is trying to
  // limit, and a narrow grant is decoration on top of a wide one.
  if (ctx.agentRootRoles !== undefined && ctx.agentRootRoles !== null && BigInt(ctx.agentRootRoles) !== 0n) {
    return refuse(GRANT_STATUS.AGENT_HOLDS_ROOT_ROLES, {agentRootRoles: asWord(ctx.agentRootRoles)});
  }

  // LAST, and last on purpose. `grantRoles` is refused because it DOES NOT WORK on this
  // deployment — it reverts with EACCannotGrantRoles even when the name owner sends it holding
  // every role at ROOT_RESOURCE. But "you used a call that reverts" is the least urgent thing
  // wrong with a grantRoles call that also names ROOT_RESOURCE or carries an admin bit, so it is
  // checked only once every substantive danger has been ruled out. A call that reaches this line
  // is correctly scoped and correctly limited, and would still fail on chain.
  //
  // The order was found by a failing test, not by reasoning: with this check at the top, three
  // rows that used to print ADMIN_ROLE_FORBIDDEN, PROTECTED_RESOURCE and ROOT_RESOURCE_FORBIDDEN
  // all started printing "wrong method" instead — true, and a strictly worse sentence to hand
  // someone reviewing a transaction.
  if (method === "grantRoles" || method === "revokeRoles") {
    return refuse(GRANT_STATUS.GRANT_ROLES_NOT_THE_DELEGATION_PATH, {
      method,
      observedRefusal: "EACCannotGrantRoles 0xd1a3b355",
      use: "authorizeTextRoles(bytes dnsName, string key, address account, bool granted)",
    });
  }

  return {ok: true, status: GRANT_STATUS.PLANNED, explain: GRANT_EXPLAIN.PLANNED};
}

// ── the 15-account limit, checked against what the contract itself reports ────────────────────
//
// ENSv2 caps assignees per role per resource. Phase 1 established that `getAssigneeCount` returns
// TWO words — the counts, and the per-role MAXIMUM — both packed one nybble per role in the same
// positions as the bitmap that was asked about. So the cap does not have to be hard-coded: the
// deployment states it. `MAX_ASSIGNEES_PER_ROLE` in the profile is the value that was read, and it
// is used only as the fallback when no live reading was supplied — and a missing reading is a
// refusal, not a fallback to "probably fine".

export function checkAssigneeHeadroom(reading, roleBitmap) {
  if (!reading || typeof reading !== "object") {
    return refuse(GRANT_STATUS.ASSIGNEE_COUNT_UNOBSERVED, {cap: Number(P.MAX_ASSIGNEES_PER_ROLE)});
  }
  const {counts, maxima} = reading;
  if (counts === undefined || counts === null || maxima === undefined || maxima === null) {
    return refuse(GRANT_STATUS.ASSIGNEE_COUNT_UNOBSERVED, {reading});
  }
  const asked = BigInt(reading.roleBitmap ?? roleBitmap);
  if ((BigInt(roleBitmap) & ~asked) !== 0n) {
    return refuse(GRANT_STATUS.ASSIGNEE_COUNT_UNOBSERVED, {
      detail: "the reading does not cover every role this grant sets",
      asked: asWord(asked), granting: asWord(roleBitmap),
    });
  }
  const c = P.unpackAssigneeWord(counts, roleBitmap);
  const m = P.unpackAssigneeWord(maxima, roleBitmap);
  const rows = c.map((row, i) => ({
    bit: row.bit, count: row.count, max: m[i]?.count ?? Number(P.MAX_ASSIGNEES_PER_ROLE),
  }));
  const full = rows.filter((r) => r.count >= r.max);
  if (full.length) return refuse(GRANT_STATUS.ASSIGNEE_CAP_REACHED, {rows, full});
  return {ok: true, rows, source: P.MAX_ASSIGNEES_SOURCE};
}

// ── the constructors ──────────────────────────────────────────────────────────────────────────

// The two EAC role calls, kept because the SCREEN and the tests need to be able to build the
// shape they refuse. They are NOT the delegation path on this deployment and nothing here calls
// them to make one: `screenAgentGrant` rejects the method by name. Deleting them would make the
// refusal untestable, which is how a guard stops being a guard.
export const encodeGrantRolesCall = (resource, bitmap, account) =>
  SELECTOR.grantRoles + w(wordUint(resource)) + w(wordUint(bitmap)) + w(wordAddress(account));
export const encodeRevokeRolesCall = (resource, bitmap, account) =>
  SELECTOR.revokeRoles + w(wordUint(resource)) + w(wordUint(bitmap)) + w(wordAddress(account));

/// `authorizeTextRoles(bytes dnsName, string key, address account, bool granted)` — THE delegation.
///
/// Four ABI arguments, two of them dynamic, so the head is four words: an offset to the DNS name,
/// an offset to the key, the account, and the flag. The offsets are computed from the encoded
/// lengths rather than written as constants, because the key is caller-supplied and a hard-coded
/// second offset is correct only for the key it was written against.
export const encodeAuthorizeTextRolesCall = (dnsHex, key, account, granted) => {
  const name = tailBytes(dnsHex);          // length word + padded body
  const k = tailString(key);
  const head = w(wordUint(0x80)) + w(wordUint(0x80 + name.length / 2)) +
    w(wordAddress(account)) + w(wordUint(granted ? 1 : 0));
  return SELECTOR.authorizeTextRoles + head + name + k;
};

/// The addr sibling. Same shape with a coin type in place of the key, and it is here so that a
/// record type the agent legitimately publishes can be delegated without reaching for the name
/// level. It grants SET_ADDR at the per-COIN resource.
export const encodeAuthorizeAddrRolesCall = (dnsHex, coinType, account, granted) => {
  const name = tailBytes(dnsHex);
  const head = w(wordUint(0x80)) + w(wordUint(coinType)) +
    w(wordAddress(account)) + w(wordUint(granted ? 1 : 0));
  return SELECTOR.authorizeAddrRoles + head + name;
};

/// The SCOPE a delegation is made at, and the role it implies, derived the way the contract does.
///
/// This is the function that turns "the agent may write unica.treasury.status" into the three
/// numbers the screen understands — resource, bitmap, account — so a scoped delegation is checked
/// by exactly the same gate that used to check a `grantRoles`. The screen did not have to be
/// weakened to accept the new call; the new call is described in the screen's own vocabulary.
export function delegationScope({node, kind = "text", key, coinType}) {
  if (kind === "text") {
    if (typeof key !== "string" || key.length === 0) return null;
    return {
      resource: P.resolverScopedResource(node, P.textScopeHash(key)),
      roleName: "SET_TEXT",
      scope: `text key "${key}"`,
      derivation: `keccak256(abi.encode(node, keccak256(bytes("${key}"))))`,
    };
  }
  if (kind === "addr") {
    if (coinType === undefined || coinType === null) return null;
    return {
      resource: P.resolverScopedResource(node, P.addrScopeHash(coinType)),
      roleName: "SET_ADDR",
      scope: `addr coinType ${coinType}`,
      derivation: `keccak256(abi.encode(node, keccak256(abi.encode(uint256(${coinType})))))`,
    };
  }
  return null;
}

/// Every text key this repository is willing to scope a delegation to. It is the RECORD_KEYS
/// vocabulary, flattened — a delegation may only be scoped to a key the plan is allowed to write,
/// because a delegation to a key nothing publishes is authority with no purpose, and authority
/// with no purpose is the kind nobody reviews.
export const delegatableTextKeys = () =>
  Object.values(RECORD_KEYS).flatMap((g) => (typeof g === "string" ? [g] : Object.values(g)))
    .filter((v) => typeof v === "string");

function buildTextDelegation(granted, opts) {
  const {resolver, agentNode, agentDnsName, agentAddress, merchantAddress, recordKey,
         protectedResources, registryAddresses, agentRootRoles, assigneeReading} = opts;

  if (!isAddress(resolver)) return refuse(GRANT_STATUS.BAD_ACCOUNT, {detail: "the resolver is not an address", resolver});
  if (!isWord(agentNode)) return refuse(GRANT_STATUS.WRONG_RESOURCE, {detail: "the agent node is not a 32-byte namehash", agentNode});
  if (typeof agentDnsName !== "string" || !/^0x([0-9a-fA-F]{2})+$/.test(agentDnsName)) {
    return refuse(GRANT_STATUS.WRONG_RESOURCE, {detail: "the agent's DNS-encoded name is missing or malformed", agentDnsName});
  }
  if (typeof recordKey !== "string" || recordKey.length === 0) {
    return refuse(GRANT_STATUS.SCOPE_KEY_MISSING, {recordKey: recordKey ?? null});
  }
  if (!delegatableTextKeys().includes(recordKey)) {
    return refuse(GRANT_STATUS.SCOPE_KEY_NOT_ALLOWLISTED, {recordKey, allowed: delegatableTextKeys()});
  }

  const scope = delegationScope({node: agentNode, kind: "text", key: recordKey});
  /* c8 ignore next */
  if (!scope) return refuse(GRANT_STATUS.SCOPE_KEY_MISSING, {recordKey});

  const bits = agentRoleBitmap([scope.roleName]);
  if (!bits.ok) return bits;

  // The DNS name and the namehash are two descriptions of one name, and the contract is handed the
  // first while the screen reasons about the second. If they disagree the owner signs a delegation
  // on a name they did not mean. Checking is one hash, so it is not left to review.
  const fromDns = namehashFromDns(agentDnsName);
  if (fromDns === null || lower(fromDns) !== lower(agentNode)) {
    return refuse(GRANT_STATUS.WRONG_RESOURCE, {
      detail: "the DNS-encoded name does not hash to the agent node this delegation is screened against",
      agentDnsName, agentNode, dnsNamehash: fromDns,
    });
  }

  const call = {
    method: granted ? "authorizeTextRoles" : "authorizeTextRoles:revoke",
    to: resolver,
    // The EFFECTIVE triple: what the chain will have written when this call returns. The screen
    // checks THIS, not the calldata, because the calldata does not mention a resource at all and a
    // screen that only reads arguments would have nothing to look at.
    resource: scope.resource,
    roleBitmap: asWord(bits.bitmap),
    account: agentAddress,
    // Carried so the screen can check the NAME, not only the derived resource. Without it the
    // protected-name guard can only recognise the name-level resource, and a per-key resource on a
    // protected name walks straight through it.
    node: agentNode,
  };

  const ctx = {
    agentResource: scope.resource, agentAddress, merchantAddress,
    protectedResources: protectedResources ?? [], protectedNodes: opts.protectedNodes ?? [],
    registryAddresses: registryAddresses ?? [],
    agentRootRoles,
  };
  const screened = screenAgentGrant(call, ctx);
  if (!screened.ok) return screened;

  // The cap applies to granting only. Revoking frees a slot; refusing a revocation because the
  // resource is full would be refusing the one call that fixes it.
  let headroom = null;
  if (granted) {
    headroom = checkAssigneeHeadroom(assigneeReading, bits.bitmap);
    if (!headroom.ok) return headroom;
  }

  const data = encodeAuthorizeTextRolesCall(agentDnsName, recordKey, agentAddress, granted);

  return {
    ok: true,
    status: GRANT_STATUS.PLANNED,
    explain: GRANT_EXPLAIN.PLANNED,
    call: {...call, data, signature: SIGNATURES.authorizeTextRoles, selector: data.slice(0, 10)},
    roles: bits.roles,
    describe: describeResolverBitmap(bits.bitmap),
    scope: scope.scope,
    recordKey,
    resourceDerivation: scope.derivation,
    // Said out loud because it is the thing a reviewer will otherwise get wrong: this resource is
    // NOT the one `roles(nameResource, agent)` reports on, and a validator that reads the name
    // level will see zero here while the agent can write.
    resourceNote:
      "the PER-KEY resource. roles(nameResource, agent) and roles(ROOT_RESOURCE, agent) both stay 0 " +
      "after this call, so the delegation is INVISIBLE to a validator that reads only those two — it " +
      "will report that the agent has no authority at the moment the agent acquires it, which is a " +
      "failure in the unsafe direction. The authoritative read is roles() or hasRoles() at the " +
      "per-key resource named in resourceDerivation.",
    headroom,
    involvesAdminRole: false,
    involvesRootResource: false,
    // What the OWNER must hold to send this. Not the agent's business, but the plan's: a merchant
    // who did not put this bit in register() cannot delegate at all, and cannot revoke either.
    requiresOfSender: {
      roleName: "SET_TEXT",
      bitmap: asWord(P.adminRole(bits.bitmap)),
      why: "authorizeTextRoles is refused with EACCannotGrantRoles unless the sender holds adminRole(SET_TEXT); " +
           "a holder of the REGULAR SET_TEXT bit was refused while its own setText was accepted",
    },
  };
}

/// Build the one delegation the agent ever receives: SET_TEXT at ONE key's resource.
export const planAgentGrant = (opts) => buildTextDelegation(true, opts);

/// Build its revocation. Same call, opposite flag — and built at the same time as the grant on
/// purpose, so a delegation is never handed over without the undo beside it. On this deployment
/// the undo is the same function, which is a small mercy: there is no second permission to have
/// forgotten to arrange.
export const planAgentRevoke = (opts) => buildTextDelegation(false, opts);

// ── the second pass: screen a whole plan, including calls this file did not build ─────────────
//
// `screenAgentGrant` protects the constructors above. This protects everything else. It walks an
// assembled plan, finds every call that changes roles for the agent's address, and re-runs the
// screen. A step added by hand, a step built by a future module, a step pasted in from somewhere
// — all of them go through the same gate, and a plan with one bad step is refused whole rather
// than emitted with a warning nobody reads.

export const PLAN_SCREEN_STATUS = {
  CLEAN: "CLEAN",
  REJECTED: "REJECTED",
  NO_STEPS: "NO_STEPS",
};

export function screenPlanForAgentAuthority(steps, ctx = {}) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return {ok: false, status: PLAN_SCREEN_STATUS.NO_STEPS,
            explain: "There is nothing to screen. An empty plan is not a safe plan; it is no plan."};
  }
  // Every method that can move authority on either contract — the EAC calls this deployment
  // refuses, AND the authorize* calls it accepts. Leaving the new ones out was the first thing that
  // went wrong when the delegation moved: the plan screen reported "CLEAN" over a plan whose
  // delegation step it had simply not looked at, which is the exact failure shape — a check that
  // passes because it ran over nothing — this repository counts as a lie.
  const ROLE_METHODS = new Set([
    "grantRoles", "revokeRoles", "grantRootRoles", "revokeRootRoles",
    "authorizeTextRoles", "authorizeTextRoles:revoke",
    "authorizeAddrRoles", "authorizeAddrRoles:revoke",
    "authorizeDataRoles", "authorizeDataRoles:revoke",
    "authorizeNameRoles",
  ]);
  const rejected = [];
  let screened = 0;
  for (const s of steps) {
    const c = s?.call;
    if (!c || !ROLE_METHODS.has(c.method)) continue;
    // Revocations are screened too, minus the cap. A revocation aimed at the wrong resource is a
    // revocation that does not revoke, and the owner would sign it believing the agent was cut off.
    if (ctx.agentAddress && lower(c.account) !== lower(ctx.agentAddress)) continue;
    screened++;
    const r = screenAgentGrant(c, ctx);
    if (!r.ok) rejected.push({ordinal: s.ordinal ?? null, method: c.method, status: r.status, explain: r.explain, detail: r});
  }
  if (rejected.length) {
    return {ok: false, status: PLAN_SCREEN_STATUS.REJECTED, screened, rejected,
            explain: `${rejected.length} step(s) would give the agent authority this planner refuses to emit.`};
  }
  return {ok: true, status: PLAN_SCREEN_STATUS.CLEAN, screened,
          explain: `${screened} role-changing step(s) screened, none rejected.`};
}

// ── what the agent is provably unable to do, and what it can still do ─────────────────────────
//
// The repository's law lists thirteen capabilities the agent must not have. Each row below names
// the capability, the MECHANISM that denies it — an actual property of the emitted plan, not a
// promise — and, where one exists, the RESIDUAL: the part the mechanism does not cover.
//
// CORRECTED IN PLACE, and the correction is the interesting part. This block used to read:
//
//     "Phase 1 found that every refusal this deployment has ever produced named the NAME-LEVEL
//      resource, including setText's. There is no observed per-key scope. So an agent holding
//      SET_TEXT at its leaf's resource may write ANY text key on that leaf. […] Claiming the finer
//      denial would be claiming a granularity the chain has never shown."
//
// It was careful, it was well-evidenced, and it was WRONG — in the direction that costs the most,
// because it understated a protection and so nobody went looking for it. The error was reading
// refusals as if they described authorizations. `setText`'s refusal names the resource the CALLER
// lacked, which is the name-level one; where an AUTHORIZATION writes is a different question, and
// it was never asked until the authorize* calls were actually executed.
//
// They were, on a pinned fork, and per-key scoping IS available here: an agent authorized for
// `unica.treasury.status` was REFUSED on a different key of the same name. The residual below is
// therefore much smaller than it was — but it is not empty, and the remaining half matters:
// per-key scoping only holds if the delegation was made with `authorizeTextRoles`. The wide calls
// still exist. `authorizeNameRoles(dns, bitmap, account, true)` writes at the name level and, once
// it has, the agent can write any key — that was executed too. So the denial is now enforced by
// the PLANNER refusing the wide call by name, and by the chain refusing the narrow agent, and a
// test below fails if any residual is ever quietly emptied.

export const DENIAL = {
  STRUCTURAL: "STRUCTURAL",           // the emitted plan contains no call that could do it
  SCREENED: "SCREENED",               // the planner refuses to build such a call, with a named error
  CHAIN_ENFORCED: "CHAIN_ENFORCED",   // the contract refuses it, and a refusal has been observed
};

export const DENIAL_MATRIX = [
  {
    capability: "transfer the name",
    denial: DENIAL.STRUCTURAL,
    mechanism: "the agent receives no role at any PermissionedRegistry; ROLE_CAN_TRANSFER_ADMIN is an admin bit and the screen rejects the whole upper 128 bits",
    screen: GRANT_STATUS.REGISTRY_TARGET_FORBIDDEN,
    residual: null,
  },
  {
    capability: "change owner",
    denial: DENIAL.STRUCTURAL,
    mechanism: "ownership lives in the registry's token, which no emitted call touches for the agent",
    screen: GRANT_STATUS.REGISTRY_TARGET_FORBIDDEN,
    residual: null,
  },
  {
    capability: "set resolver",
    denial: DENIAL.STRUCTURAL,
    mechanism: "ROLE_SET_RESOLVER (1<<24) is a REGISTRY role; it is not in the resolver allowlist and the target screen rejects a registry",
    screen: GRANT_STATUS.REGISTRY_TARGET_FORBIDDEN,
    residual: null,
  },
  {
    capability: "set subregistry",
    denial: DENIAL.STRUCTURAL,
    mechanism: "ROLE_SET_SUBREGISTRY (1<<20) is a REGISTRY role, same rejection",
    screen: GRANT_STATUS.REGISTRY_TARGET_FORBIDDEN,
    residual: null,
  },
  {
    capability: "register siblings",
    denial: DENIAL.STRUCTURAL,
    mechanism: "ROLE_REGISTRAR (1<<0) is held at the registry's ROOT_RESOURCE; no agent grant may name ROOT_RESOURCE or a registry",
    screen: GRANT_STATUS.ROOT_RESOURCE_FORBIDDEN,
    residual: null,
  },
  {
    capability: "renew or unregister",
    denial: DENIAL.STRUCTURAL,
    mechanism: "ROLE_RENEW (1<<16) and ROLE_UNREGISTER (1<<12) are registry roles, same rejection",
    screen: GRANT_STATUS.REGISTRY_TARGET_FORBIDDEN,
    residual: null,
  },
  {
    capability: "change the payment recipient",
    denial: DENIAL.STRUCTURAL,
    mechanism: "the recipient is addr() on pay.<merchant>, whose name-level resource is in protectedResources and is refused by the screen",
    screen: GRANT_STATUS.PROTECTED_RESOURCE,
    residual: null,
  },
  {
    capability: "change the executor",
    denial: DENIAL.STRUCTURAL,
    mechanism: "the executor is a text record on pay.<merchant>, same protected resource",
    screen: GRANT_STATUS.PROTECTED_RESOURCE,
    residual: null,
  },
  {
    capability: "change the chain id",
    denial: DENIAL.STRUCTURAL,
    mechanism: "the chain id is a text record on pay.<merchant>, same protected resource",
    screen: GRANT_STATUS.PROTECTED_RESOURCE,
    residual: null,
  },
  {
    capability: "administer roles",
    denial: DENIAL.SCREENED,
    mechanism: "any bit at or above 128 is an admin role and the screen refuses the grant outright",
    screen: GRANT_STATUS.ADMIN_ROLE_FORBIDDEN,
    residual: null,
  },
  {
    capability: "grant roles to itself or to anyone",
    denial: DENIAL.CHAIN_ENFORCED,
    mechanism: "granting a role requires holding its ADMIN role; the agent holds none, and Phase 1 observed EACCannotGrantRoles refusing exactly this shape",
    screen: GRANT_STATUS.ADMIN_ROLE_FORBIDDEN,
    residual: null,
  },
  {
    capability: "write arbitrary text keys on a name the merchant relies on",
    denial: DENIAL.CHAIN_ENFORCED,
    mechanism:
      "the delegation is authorizeTextRoles, which grants SET_TEXT at the PER-KEY resource " +
      "keccak256(abi.encode(node, keccak256(bytes(key)))) — so the agent's authority does not " +
      "extend to a second key even on its own leaf, and merchant., pay. and treasury. resources " +
      "are additionally in protectedResources",
    screen: GRANT_STATUS.PROTECTED_RESOURCE,
    observed:
      "on the fork the agent wrote its authorized key and was refused on another key of the same " +
      "name with EACUnauthorizedAccountRoles 0x4b27a133; the other key read back empty",
    residual:
      "Per-key scoping holds only for a delegation made with authorizeTextRoles. authorizeNameRoles " +
      "writes at the NAME-LEVEL resource, and an agent given SET_TEXT there was observed writing a " +
      "key nobody authorised. The planner refuses that method by name (NAME_LEVEL_METHOD_FORBIDDEN), " +
      "which is a property of this code rather than of the chain — a delegation made by some other " +
      "tool is outside what this file can deny.",
  },
  {
    capability: "obtain root roles",
    denial: DENIAL.SCREENED,
    mechanism: "grantRootRoles is refused by method name, ROOT_RESOURCE is refused by value, and a non-zero agentRootRoles reading refuses the whole plan",
    screen: GRANT_STATUS.ROOT_RESOURCE_FORBIDDEN,
    residual: null,
  },
];

// ── committing to a policy without publishing it ──────────────────────────────────────────────
//
// ENS stores nothing secret. A threshold, an allocation, a reserve — none of them go on chain, and
// a text record holding one would be public forever the moment it is written. What goes on chain
// is a COMMITMENT: a keccak over a canonical encoding of the values and a salt. Anyone can later
// be shown the values and check them; nobody can read them off the chain.
//
// `commitPolicy` takes the values and returns ONLY the digest and the scheme string. It keeps no
// reference to its input, and the plan builder never carries the input further. The suite feeds it
// real values and then scans the entire serialised plan for every one of them, in decimal and in
// hex — a check that has caught nothing yet and would catch the first person who decides it would
// be convenient to also publish the threshold "for debugging".

export const POLICY_COMMITMENT_SCHEME =
  "keccak256(utf8(\"UNICA:ensv2-policy:v1|\" ‖ chainId ‖ \"|\" ‖ merchantNode ‖ \"|\" ‖ thresholdWei ‖ \"|\" ‖ allocationBps ‖ \"|\" ‖ reserveWei ‖ \"|\" ‖ salt))";

export function commitPolicy({chainId, merchantNode, thresholdWei, allocationBps, reserveWei, salt}) {
  for (const [k, v] of Object.entries({chainId, merchantNode, thresholdWei, allocationBps, reserveWei, salt})) {
    if (v === undefined || v === null || String(v) === "") {
      return {ok: false, status: "INCOMPLETE_POLICY", detail: `${k} is missing; a commitment over a missing field commits to nothing`};
    }
  }
  const canonical = ["UNICA:ensv2-policy:v1", String(chainId), String(merchantNode),
                     String(thresholdWei), String(allocationBps), String(reserveWei), String(salt)].join("|");
  return {
    ok: true,
    digest: toHex(keccak256(utf8(canonical))),
    scheme: POLICY_COMMITMENT_SCHEME,
    fields: ["chainId", "merchantNode", "thresholdWei", "allocationBps", "reserveWei", "salt"],
    note: "the digest is published; the values and the salt are held by the merchant and shown to whoever needs to check",
  };
}

/// The record keys this repository publishes, as a closed vocabulary. A record key not in here is
/// refused by the plan builder — not because an unknown key is dangerous in itself, but because
/// the only way to keep "nothing secret is published" checkable is to keep the set of things that
/// get published small enough to read.
export const RECORD_KEYS = Object.freeze({
  chainId: "unica:chain-id",
  token: "unica:token",
  executor: "unica:executor",
  policyVersion: "unica:policy-version",
  policyCommitment: "unica:policy-commitment",
  policyScheme: "unica:policy-scheme",
  agentName: "unica:agent",
  agentCapabilities: "unica:capabilities",
  agentRevocation: "unica:revocation",
});
