// The role planner — the piece that decides what authority a delegated agent is given, and
// refuses to emit anything else.
//
// WHAT THIS IS FOR. UNICA's merchant architecture ends with a delegated agent that publishes its
// own status under `agent.treasury.merchant.<parent>`. Delegation on ENSv2 is a `grantRoles` call:
// a role bitmap, held by an account, against a RESOURCE. Three numbers. Get the resource wrong and
// the grant lands somewhere nobody expected; get the bitmap wrong and the agent can rewrite the
// merchant's payout address; use the wrong one of two nearly identical resource derivations and
// the grant silently addresses a resource nobody holds anything at, which reads as "safe" and is
// not. This file is the only place in the repository allowed to construct such a call.
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
// THE RESOURCE IS THE SEPARATION. Phase 1 established that this deployment scopes every observed
// resolver refusal to the NAME-LEVEL resource, `keccak256(node ‖ bytes32(0))` — including the two
// setters whose documentation implies something finer. There is therefore no such thing, on this
// deployment, as "may set only the text key `unica:status`". The smallest scope any refusal has
// ever named is one whole name. The mitigation is structural: the agent is given a role at the
// resource of a LEAF NAME that carries nothing the merchant relies on, and no role at any resource
// belonging to the merchant's own names. `DENIAL_MATRIX` states that residual out loud rather than
// claiming a granularity the chain has never shown.
//
// NOTHING HERE SIGNS OR BROADCASTS. Calls are built as calldata and returned. No key is read, no
// writing JSON-RPC method is named, and `permissioned-test.mjs` scans this directory and fails if
// either ever becomes untrue.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {utf8, wordAddress, wordUint} from "../permit2/digest.mjs";
import {SELECTOR, SIGNATURES} from "./permissioned.mjs";
import * as P from "./profile.mjs";

const hexBody = (h) => String(h ?? "").replace(/^0x/, "").toLowerCase();
const w = (bytes) => hexBody(toHex(bytes));
const isAddress = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
const isWord = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
const lower = (v) => String(v ?? "").toLowerCase();
const asWord = (v) => "0x" + BigInt(v).toString(16).padStart(64, "0");

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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

  // A registry role is never a record-edit permission. `setResolver`, `setSubregistry`, `renew`
  // and `unregister` all live on a PermissionedRegistry, so a grant that targets one is asking to
  // give the agent control of the NAME rather than of a record on it.
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

export const encodeGrantRolesCall = (resource, bitmap, account) =>
  SELECTOR.grantRoles + w(wordUint(resource)) + w(wordUint(bitmap)) + w(wordAddress(account));
export const encodeRevokeRolesCall = (resource, bitmap, account) =>
  SELECTOR.revokeRoles + w(wordUint(resource)) + w(wordUint(bitmap)) + w(wordAddress(account));

function buildRoleChange(kind, opts) {
  const {resolver, agentNode, agentAddress, merchantAddress, roleNames, protectedResources,
         registryAddresses, agentRootRoles, assigneeReading} = opts;

  if (!isAddress(resolver)) return refuse(GRANT_STATUS.BAD_ACCOUNT, {detail: "the resolver is not an address", resolver});
  if (!isWord(agentNode)) return refuse(GRANT_STATUS.WRONG_RESOURCE, {detail: "the agent node is not a 32-byte namehash", agentNode});

  const bits = agentRoleBitmap(roleNames ?? [...AGENT_DEFAULT_ROLES]);
  if (!bits.ok) return bits;

  // Derived here, from the namehash, using the profile's own derivation. Never accepted from a
  // caller: a caller-supplied resource is exactly the input that would let a mistake upstream
  // point a correct-looking grant at the merchant's own name.
  const resource = P.resolverNameResource(agentNode);

  const call = {
    method: kind,
    to: resolver,
    resource,
    roleBitmap: asWord(bits.bitmap),
    account: agentAddress,
  };

  const ctx = {
    agentResource: resource, agentAddress, merchantAddress,
    protectedResources: protectedResources ?? [], registryAddresses: registryAddresses ?? [],
    agentRootRoles,
  };
  const screened = screenAgentGrant(call, ctx);
  if (!screened.ok) return screened;

  // The cap applies to granting only. Revoking frees a slot; refusing a revocation because the
  // resource is full would be refusing the one call that fixes it.
  let headroom = null;
  if (kind === "grantRoles") {
    headroom = checkAssigneeHeadroom(assigneeReading, bits.bitmap);
    if (!headroom.ok) return headroom;
  }

  const data = kind === "grantRoles"
    ? encodeGrantRolesCall(resource, bits.bitmap, agentAddress)
    : encodeRevokeRolesCall(resource, bits.bitmap, agentAddress);

  return {
    ok: true,
    status: GRANT_STATUS.PLANNED,
    explain: GRANT_EXPLAIN.PLANNED,
    call: {...call, data, signature: SIGNATURES[kind], selector: data.slice(0, 10)},
    roles: bits.roles,
    describe: describeResolverBitmap(bits.bitmap),
    resourceDerivation: "keccak256(abi.encode(node, bytes32(0))) — the name-level resource, the only one this deployment has ever named",
    headroom,
    involvesAdminRole: false,
    involvesRootResource: false,
  };
}

/// Build the one grant the agent ever receives.
export const planAgentGrant = (opts) => buildRoleChange("grantRoles", opts);

/// Build its revocation. Same three numbers, opposite verb — and built at the same time as the
/// grant on purpose, so a delegation is never handed over without the undo beside it.
export const planAgentRevoke = (opts) => buildRoleChange("revokeRoles", opts);

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
  const ROLE_METHODS = new Set(["grantRoles", "revokeRoles", "grantRootRoles", "revokeRootRoles"]);
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
// The residual on `writeArbitraryTextKeys` is the honest half of this file. Phase 1 found that
// every refusal this deployment has ever produced named the NAME-LEVEL resource, including
// `setText`'s. There is no observed per-key scope. So an agent holding SET_TEXT at its leaf's
// resource may write ANY text key on that leaf. What it cannot do is write one on `pay.`,
// `treasury.` or `merchant.` — and the architecture's answer is that the leaf carries nothing
// anyone settles against. Claiming the finer denial would be claiming a granularity the chain has
// never shown, and a test below fails if any residual is ever quietly emptied.

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
    denial: DENIAL.STRUCTURAL,
    mechanism: "the only resource the agent is granted anything at is the leaf's; merchant., pay. and treasury. resources are in protectedResources",
    screen: GRANT_STATUS.PROTECTED_RESOURCE,
    residual:
      "On its OWN leaf the agent may write any text key. This deployment has never named a per-key " +
      "resource — setText's refusal named the name-level resource — so per-key scoping is not " +
      "available here. The mitigation is that the leaf carries no value anyone settles against.",
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
