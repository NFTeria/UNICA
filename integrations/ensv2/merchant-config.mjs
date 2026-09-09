// UNICA's MerchantConfig resolver and preflight validator: from a parent name an owner controls to
// a settlement configuration UNICA will accept, or to one named reason why it will not.
//
// THE ARCHITECTURE THIS VALIDATES, and why it has the shape it has:
//
//   <parent>                              the merchant controls ownership, resolver, subregistry
//     <merchant>.<parent>                 merchant identity — never derived from the agent
//       pay.<merchant>.<parent>           canonical PUBLIC settlement config      ← the protected one
//       treasury.<merchant>.<parent>      PUBLIC policy metadata only
//         agent.treasury.<merchant>.<p>   the delegated agent's public capabilities
//
// THE PARENT IS AN OWNER INPUT. UNICA owns no ENSv2 Sepolia name and this module hard-codes none.
// Every function takes the parent; a missing one is a refusal that names it as a required owner
// action, not a default that quietly resolves somebody else's tree.
//
// WHY `pay` IS A SEPARATE NAME FROM `treasury`, WHICH IS STILL THE WHOLE DESIGN.
//
// THIS FILE USED TO SAY, IN BOLD, AND IT WAS WRONG — left here because this repository corrects a
// refuted claim in place rather than deleting it:
//
//   "Nothing observed on this deployment has ever named a per-key or per-coin-type resource. So an
//    agent granted SET_TEXT anywhere may rewrite EVERY text record on that name. There is no
//    permission narrow enough to say 'this agent may write the treasury key and not the pay key'."
//
// WHAT REFUTED IT. A Sepolia fork pinned at block 11666085, against the live resolver proxy
// 0xc00E9189…35eeE. `authorizeTextRoles(dnsName, key, account, true)` emitted EACRolesChanged
// naming keccak256(node ‖ keccak256(key)) — a PER-KEY resource — and granted SET_TEXT there and
// nowhere else. The delegated account then wrote that one key and was REFUSED, with
// EACUnauthorizedAccountRoles (0x4b27a133), on a different key and on `setAddr`. Per-key scoping
// IS available on this deployment. `authorizeAddrRoles` is the same story per coin type;
// `authorizeNameRoles` is the name-level one.
//
// WHAT SURVIVES, AND IT IS THE HALF THAT MATTERS. The blanket exposure is real for a NAME-LEVEL
// grant: an account holding SET_TEXT at keccak256(node ‖ bytes32(0)) wrote `unica.pay`,
// `unica.treasury`, `avatar` and an arbitrary key on the same fork. So "SET_TEXT lets an agent
// rewrite every text record" is true of a name-level grant and false of a per-key one, and the
// original claim's mistake was believing the deployment offered only the former.
//
// The mitigation is still structural rather than permissional, for a reason that did not change:
// per-key scoping protects a key, and the settlement configuration is worth protecting even from
// an agent whose grant is scoped somewhere else entirely. `pay` and `treasury` stay siblings, and
// the check below that matters most is still "does the agent have ANY authority over the name
// carrying the recipient" — asked now at four resources instead of two, because two of them could
// not see the mechanism this deployment actually accepts.
//
// EVERY REFUSAL HAS A CONTROL. `merchant-config-test.mjs` builds one evidence bundle that is
// ACCEPTED, then breaks exactly one thing per row and requires exactly the matching refusal. A
// refusal with no passing control beside it proves nothing: it could be firing for a reason nobody
// has looked at.
//
// ENS IS LOAD-BEARING, AND THAT IS TESTED RATHER THAN ASSERTED. Remove the resolution and this
// module refuses. Remove the Enhanced Access Control read and it refuses. If it still accepted,
// ENS would be decoration and the test would be the thing that says so.
//
// NOTHING HERE WRITES, SIGNS OR BROADCASTS. Every chain touch is an eth_call, eth_getCode or
// eth_getStorageAt through the injected reader.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {concat, utf8, wordAddress, wordBytes32, wordUint} from "../permit2/digest.mjs";
import {ENSV2, normalizeName, namehash} from "../../web/ensv2/resolve.mjs";
import {
  ERC1967_IMPLEMENTATION_SLOT, PROBE, ROOT_RESOURCE, coinTypeResource, encodeHasRolesCall,
  encodeRolesCall, nameLevelResource, probe, roleName, textResource, uintAt, boolAt,
} from "./permissioned.mjs";
import * as PROFILE from "./profile.mjs";
import {PAYOUT_CURRENCIES} from "./build.mjs";
import {RECORD_KEY, SCHEMA_VERSION, commitmentMatches, recordDigest} from "./records.mjs";
import {EVIDENCE, LIVE_STATUS, assertLiveEvidence} from "./read-live.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_WORD = "0x" + "0".repeat(64);
const lower = (s) => String(s ?? "").toLowerCase();

// ── the names ─────────────────────────────────────────────────────────────────────────────────

export const NAME_STATUS = {
  BUILT: "BUILT",
  PARENT_REQUIRED: "PARENT_REQUIRED",
  MERCHANT_LABEL_REQUIRED: "MERCHANT_LABEL_REQUIRED",
  NAME_REFUSED: "NAME_REFUSED",
};

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/// Derive the four names from the parent and the merchant label.
///
/// The parent is REQUIRED and is returned in the result, so anything printing an owner action
/// prints the parent it was actually given rather than one a reader assumes. A caller that omits
/// it gets PARENT_REQUIRED, which is the honest description: UNICA cannot proceed until an owner
/// supplies a name they control.
export function merchantNames({parent, merchant} = {}) {
  if (parent === undefined || parent === null || String(parent).trim() === "") {
    return {ok: false, status: NAME_STATUS.PARENT_REQUIRED,
            ownerAction: "Supply an ENSv2 name you own. UNICA owns none and will not invent one."};
  }
  if (merchant === undefined || merchant === null || String(merchant).trim() === "") {
    return {ok: false, status: NAME_STATUS.MERCHANT_LABEL_REQUIRED};
  }
  const p = normalizeName(parent);
  if (!p.ok) return {ok: false, status: NAME_STATUS.NAME_REFUSED, detail: p.status, which: "parent"};
  const label = lower(merchant);
  if (!LABEL.test(label)) return {ok: false, status: NAME_STATUS.NAME_REFUSED, detail: "MALFORMED_LABEL", which: "merchant"};

  const names = {
    parent: p.name,
    merchant: `${label}.${p.name}`,
    pay: `pay.${label}.${p.name}`,
    treasury: `treasury.${label}.${p.name}`,
    agent: `agent.treasury.${label}.${p.name}`,
  };
  for (const [k, n] of Object.entries(names)) {
    const norm = normalizeName(n);
    if (!norm.ok) return {ok: false, status: NAME_STATUS.NAME_REFUSED, detail: norm.status, which: k};
  }
  const nodes = Object.fromEntries(Object.entries(names).map(([k, n]) => [k, namehash(n)]));
  const resources = Object.fromEntries(Object.entries(nodes).map(([k, n]) => [k, nameLevelResource(n)]));
  return {ok: true, status: NAME_STATUS.BUILT, names, nodes, resources, label, parent: p.name};
}

// ── the authority mask ────────────────────────────────────────────────────────────────────────
//
// Which role bits count as "this account can edit this name's records".
//
// The four CONFIRMED bits were named back by live refusals from a real per-name resolver proxy.
// The other seven are documented and were never observed on this deployment. They are included in
// the REFUSAL mask anyway, and the asymmetry is deliberate: including an unconfirmed bit can only
// make this module refuse a configuration it might have accepted, and refusing too much is the
// safe direction. It never works the other way — nothing here treats an unconfirmed bit as
// evidence that an agent is harmless.
//
// The admin halves are in the mask too. An account holding the ADMIN of SET_TEXT cannot write a
// record itself, but it can grant SET_TEXT to an account that can, which is the same authority
// with one more transaction in front of it.

const ROLE_BITS = Object.values(PROFILE.RESOLVER_ROLE).map((r) => r.bit);

export const CONFIRMED_EDIT_MASK = Object.entries(PROFILE.RESOLVER_ROLE)
  .filter(([, r]) => r.observed === PROFILE.OBSERVED.REVERT_NAMED_IT)
  .reduce((m, [, r]) => m | r.bit, 0n);

export const ANY_EDIT_MASK = ROLE_BITS.reduce((m, b) => m | b | PROFILE.adminRole(b), 0n);

/// The confirmed bit used for the corroborating `hasRoles` read. SET_TEXT, because a text record
/// is what carries every UNICA record and it is one of the four the chain named back.
export const CORROBORATION_BIT = PROFILE.RESOLVER_ROLE.SET_TEXT.bit;

// ── statuses ──────────────────────────────────────────────────────────────────────────────────

export const PREFLIGHT_STATUS = {
  ACCEPTED: "ACCEPTED",

  // shape of the request
  PARENT_REQUIRED: "PARENT_REQUIRED",
  MERCHANT_LABEL_REQUIRED: "MERCHANT_LABEL_REQUIRED",
  NAME_REFUSED: "NAME_REFUSED",

  // the two removals that must make UNICA refuse, or ENS is decoration
  NO_RESOLUTION: "NO_RESOLUTION",
  NO_AUTHORIZATION_READ: "NO_AUTHORIZATION_READ",

  // transport and network
  NOT_LIVE_EVIDENCE: "NOT_LIVE_EVIDENCE",
  RPC_FAILURE: "RPC_FAILURE",
  WRONG_CHAIN: "WRONG_CHAIN",

  // the deployment must be the one this repository verified
  OFF_PROFILE_ENTRY_POINT: "OFF_PROFILE_ENTRY_POINT",
  DEPLOYMENT_UNVERIFIED: "DEPLOYMENT_UNVERIFIED",
  OFF_PROFILE_REGISTRY: "OFF_PROFILE_REGISTRY",
  OFF_PROFILE_RESOLVER_IMPL: "OFF_PROFILE_RESOLVER_IMPL",
  NO_RESOLVER: "NO_RESOLVER",
  RESOLVER_HAS_NO_CODE: "RESOLVER_HAS_NO_CODE",

  // the records
  WILDCARD_UNREGISTERED: "WILDCARD_UNREGISTERED",
  RECORD_MISSING: "RECORD_MISSING",
  MALFORMED_RECORD: "MALFORMED_RECORD",
  AMBIGUOUS_DUPLICATE_RECORDS: "AMBIGUOUS_DUPLICATE_RECORDS",
  SCHEMA_VERSION_UNSUPPORTED: "SCHEMA_VERSION_UNSUPPORTED",

  // the values in them
  RECORD_CHAIN_MISMATCH: "RECORD_CHAIN_MISMATCH",
  ZERO_EXECUTOR: "ZERO_EXECUTOR",
  ZERO_RECIPIENT: "ZERO_RECIPIENT",
  UNSUPPORTED_TOKEN: "UNSUPPORTED_TOKEN",
  EXPIRED: "EXPIRED",
  COMMITMENT_MISMATCH: "COMMITMENT_MISMATCH",
  AGENT_RECORD_REVOKED: "AGENT_RECORD_REVOKED",

  // who may change them
  AUTHORITY_UNKNOWN: "AUTHORITY_UNKNOWN",
  AUTHORITY_READ_DISAGREES: "AUTHORITY_READ_DISAGREES",
  AGENT_HOLDS_ROOT_RESOURCE: "AGENT_HOLDS_ROOT_RESOURCE",
  PROTECTED_FIELD_UNDER_AGENT_CONTROL: "PROTECTED_FIELD_UNDER_AGENT_CONTROL",
};

export const PREFLIGHT_EXPLAIN = {
  ACCEPTED: "Accepted.",
  PARENT_REQUIRED: "No parent name was supplied. UNICA owns no ENSv2 name; an owner must name one.",
  MERCHANT_LABEL_REQUIRED: "No merchant label was supplied.",
  NAME_REFUSED: "One of the derived names is not one this build will resolve.",
  NO_RESOLUTION: "There is no ENS resolution in this evidence, so there is no merchant to configure.",
  NO_AUTHORIZATION_READ: "Nobody read who may edit these records, so the configuration cannot be trusted.",
  NOT_LIVE_EVIDENCE: "This answer did not come from a live endpoint, and a live answer was required.",
  RPC_FAILURE: "The network could not be reached, so nothing was established.",
  WRONG_CHAIN: "The endpoint answered for a different chain.",
  OFF_PROFILE_ENTRY_POINT: "Resolution went through an entry point this repository has not verified.",
  DEPLOYMENT_UNVERIFIED: "Nobody re-read the ENSv2 deployment this run, and a deployment that was not checked is not a verified one.",
  OFF_PROFILE_REGISTRY: "This name is not under a registry this repository has verified.",
  OFF_PROFILE_RESOLVER_IMPL: "The merchant's resolver runs code this repository has not verified.",
  NO_RESOLVER: "No resolver answers for that name.",
  RESOLVER_HAS_NO_CODE: "The resolver named for that name has no code at that address.",
  WILDCARD_UNREGISTERED: "That name answers through a wildcard parent and publishes nothing of its own — it is not registered.",
  RECORD_MISSING: "The merchant publishes no settlement configuration.",
  MALFORMED_RECORD: "The merchant publishes something under that key that is not a UNICA record.",
  AMBIGUOUS_DUPLICATE_RECORDS: "A settlement configuration appears on more than one name, and there is no rule for which one wins.",
  SCHEMA_VERSION_UNSUPPORTED: "That record uses a schema version this build does not accept.",
  RECORD_CHAIN_MISMATCH: "The published configuration settles on a different chain from this one.",
  ZERO_EXECUTOR: "The published configuration names no settlement executor.",
  ZERO_RECIPIENT: "The published configuration names nobody to pay.",
  UNSUPPORTED_TOKEN: "That settlement token is not one this deployment can settle.",
  EXPIRED: "That configuration has expired. The merchant must republish it.",
  COMMITMENT_MISMATCH: "The published commitment does not match the configuration inputs supplied.",
  AGENT_RECORD_REVOKED: "The delegated agent is published as revoked.",
  AUTHORITY_UNKNOWN: "Who may edit these records could not be read, and unknown authority is not acceptable authority.",
  AUTHORITY_READ_DISAGREES: "Two authority reads disagreed about the same account, so neither can be relied on.",
  AGENT_HOLDS_ROOT_RESOURCE: "The agent holds contract-wide authority. That is never a valid UNICA delegation.",
  PROTECTED_FIELD_UNDER_AGENT_CONTROL: "The agent can rewrite the settlement configuration. A payout address under agent control is not a merchant's payout address.",
};

const refuse = (status, extra = {}) => ({ok: false, status, explain: PREFLIGHT_EXPLAIN[status], ...extra});

// ── reading the evidence ──────────────────────────────────────────────────────────────────────

/// Gather everything the preflight judges, in one pass, from one endpoint.
///
/// @param reader a reader from `read-live.mjs`. Its `evidence` stamp travels into the bundle so
///        the preflight can refuse a non-live answer without having to ask the caller what kind of
///        reader they used.
/// @param opts.agent  the agent address to test authority for. When the agent RECORD decodes, the
///        address in the record is used instead and this one is only a fallback — an agent that
///        can choose which address gets checked is not being checked.
export async function readMerchantEvidence({parent, merchant}, reader, opts = {}) {
  const named = merchantNames({parent, merchant});
  if (!named.ok) return {ok: false, stage: "NAMES", named};

  if (!reader || reader.kind !== "ENSV2_RECORD_READER") {
    return {ok: false, stage: "READER", named, reader: null, evidence: null};
  }

  const bundle = {
    ok: true, stage: "READ", named,
    evidence: reader.evidence, chainId: reader.chainId, entryPoint: reader.entryPoint,
    block: null, reads: {}, duplicates: {}, resolvers: {}, authority: null, errors: [],
  };

  bundle.block = await reader.blockNumber();
  bundle.observedChainId = await reader.chainIdOf();

  // The three records, each on its own name.
  for (const schema of ["pay", "treasury", "agent"]) {
    bundle.reads[schema] = await reader.readRecord(schema, named.names[schema]);
  }
  // The wildcard trap: an unregistered subname under a wildcard parent RESOLVES and returns zero
  // without reverting. A successful resolve is not evidence a name exists, so the address is read
  // and kept as one input to that judgement rather than as a result.
  bundle.reads.payAddr = await reader.readAddr(named.names.pay);

  // The duplicate scan. A settlement configuration published on a second name is not a redundancy,
  // it is an ambiguity: two answers and no rule for which wins.
  for (const where of ["merchant", "treasury", "agent"]) {
    bundle.duplicates[where] = await reader.readText(named.names[where], RECORD_KEY.pay);
  }

  // The resolver behind the pay name, and the code it actually runs.
  const payResolver = bundle.reads.pay.resolver ?? bundle.reads.payAddr.resolver ?? null;
  bundle.resolvers.pay = {address: payResolver, codeSize: null, implementation: null};
  if (payResolver && reader.chain) {
    try {
      const code = await reader.chain.getCode(payResolver);
      bundle.resolvers.pay.codeSize = String(code ?? "").replace(/^0x/, "").length / 2;
    } catch (e) { bundle.errors.push({what: "getCode(payResolver)", detail: e?.message ?? String(e)}); }
    try {
      const slot = await reader.chain.getStorageAt(payResolver, ERC1967_IMPLEMENTATION_SLOT);
      const word = String(slot ?? "").replace(/^0x/, "").padStart(64, "0");
      const impl = "0x" + word.slice(24);
      bundle.resolvers.pay.implementation = impl.toLowerCase() === ZERO_ADDRESS ? null : impl.toLowerCase();
    } catch (e) { bundle.errors.push({what: "getStorageAt(payResolver)", detail: e?.message ?? String(e)}); }
  }
  // The fixed entry point's own code, so "the deployment is the verified one" is a re-read rather
  // than a claim carried from a file.
  if (reader.chain) {
    try {
      const code = await reader.chain.getCode(reader.entryPoint);
      bundle.entryPointCodeSize = String(code ?? "").replace(/^0x/, "").length / 2;
    } catch (e) { bundle.errors.push({what: "getCode(entryPoint)", detail: e?.message ?? String(e)}); }
  }

  // The heavy deployment re-read, when the caller asked for it.
  if (opts.verifyDeployment && reader.chain) {
    bundle.deployment = await verifyDeployment(reader);
  }

  // Enhanced Access Control. This is the half that says whether the records above mean anything.
  bundle.authority = await readAgentAuthority({
    reader, resolver: payResolver,
    payResource: named.resources.pay,
    payNode: named.nodes.pay,
    agentAddress: agentAddressFrom(bundle, opts),
  });

  return bundle;
}

/// Which address the authority read is about.
///
/// The published agent record is the source when it decodes. `opts.agent` is only a fallback for
/// the case where the merchant has published no agent record at all — because if UNICA let the
/// caller name the address, an agent could point the check at an innocent one.
export function agentAddressFrom(bundle, opts = {}) {
  const rec = bundle?.reads?.agent;
  if (rec && rec.ok && rec.record && rec.record.agent) return lower(rec.record.agent);
  return opts.agent ? lower(opts.agent) : null;
}

/// Re-read every pinned ENSv2 contract and count how it went.
///
/// The comparison itself lives in `profile.mjs` — one description of what the deployment is, used
/// by the Phase 1 live checker and by this validator, rather than two that can drift apart. A
/// TRANSPORT row is counted as a SKIP and never as a pass: a rate-limited node dropping a body is
/// not evidence that a code hash is intact.
export async function verifyDeployment(reader) {
  let rows;
  try { rows = await PROFILE.verifyProfile(reader.chain); } catch (e) {
    return {ok: false, rows: [], failed: 0, passed: 0, transportSkipped: 1, detail: e?.message ?? String(e)};
  }
  const transportSkipped = rows.filter((r) => r.transport).length;
  const failed = rows.filter((r) => !r.ok && !r.transport).length;
  const passed = rows.filter((r) => r.ok).length;
  return {ok: failed === 0 && transportSkipped === 0, rows, failed, passed, transportSkipped};
}

export const AUTHORITY_STATUS = {
  READ: "READ",
  NO_RESOLVER: "NO_RESOLVER",
  NO_AGENT: "NO_AGENT",
  NO_PAY_NODE: "NO_PAY_NODE",
  UNREADABLE: "UNREADABLE",
  DISAGREES: "DISAGREES",
};

/// The four resources an account could hold authority over the settlement configuration at.
///
/// This deployment derives an EAC resource from the namehash and a second word that selects the
/// GRANULARITY, and all three shapes are live. Reading only the name-level one is what CRITICAL 2
/// was: a delegation made with `authorizeTextRoles` lands at a resource the name-level read cannot
/// see, so the reader reported "no agent authority" about an agent that could write.
export const AUTHORITY_SCOPE = {
  NAME: "NAME",                    // nameLevelResource(payNode)  — blanket over that whole name
  ROOT: "ROOT",                    // ROOT_RESOURCE               — blanket over every name
  PAY_TEXT_KEY: "PAY_TEXT_KEY",    // textResource(payNode, RECORD_KEY.pay)
  PAY_ADDR_COIN: "PAY_ADDR_COIN",  // coinTypeResource(payNode, ADDR_COIN_TYPE)
};

/// The coin type behind `addr(bytes32)`. `readAddr` asks the resolver for exactly this record, so
/// this is the coin type an agent would have to be delegated on to move the address UNICA read.
export const ADDR_COIN_TYPE = 60n;

/// Read what the agent may do to the merchant's SETTLEMENT CONFIGURATION.
///
/// FOUR SCOPES, BECAUSE THREE OF THEM WERE INVISIBLE BEFORE AND ONE OF THOSE IS THE MECHANISM THIS
/// DEPLOYMENT ACTUALLY ACCEPTS. Measured on a Sepolia fork pinned at block 11666085, against the
/// live resolver proxy 0xc00E9189…35eeE:
///
///   authorizeTextRoles(dnsName, key, account, true)   -> EACRolesChanged names
///                                                        keccak256(node ‖ keccak256(key))
///   authorizeAddrRoles(dnsName, coinType, …)          -> keccak256(node ‖ keccak256(uint256 coin))
///   authorizeNameRoles(dnsName, bitmap, …)            -> keccak256(node ‖ bytes32(0))
///
/// The implementation's dispatch table carries NO read dedicated to an `authorize*` grant — the
/// only role reads it exposes are roles/hasRoles/hasRootRoles/roleCount/hasAssignees/
/// getAssigneeCount. So the read that sees a per-key delegation is the ordinary `roles(uint256,
/// address)`, asked at the DERIVED resource. That is what this function now does.
///
/// TWO READS PER SCOPE, AND THE DIFFERENCE BETWEEN THEM IS STILL THE POINT. Phase 1 found that
/// `roles(resource, account)` and `hasRoles(resource, bitmap, account)` do not answer the same
/// question, and that the difference fails unsafe: `roles` at a name resource returns 0 for an
/// account that holds everything at ROOT_RESOURCE. So every scope is asked both ways, and if any
/// `hasRoles` says yes about a bit that scope's `roles` says is clear, NEITHER read is relied on.
///
/// IT FAILS CLOSED, DELIBERATELY AND AT EVERY EXIT. A missing chain view, a missing resolver, a
/// missing pay node, a probe that reverts, an endpoint that drops the body, a return the decoder
/// refuses — each is a NAMED status the preflight turns into a refusal. None of them returns a
/// zero bitmap, because a comfortable zero is exactly how CRITICAL 2 read as safe.
///
/// WHAT IT DOES NOT CLAIM. A per-key grant on some OTHER text key, or a per-coin grant on some
/// other coin type, is not read here and cannot be: this deployment offers no way to enumerate the
/// resources an account holds roles at. It is not an omission — such a grant is authority over a
/// record UNICA does not settle against. The result says so in `exhaustive: false` rather than
/// letting a reader assume the four scopes are all the scopes there are.
export async function readAgentAuthority({reader, resolver, payResource, payNode, agentAddress}) {
  if (!reader || !reader.chain) return {status: AUTHORITY_STATUS.UNREADABLE, why: "no chain view on the reader"};
  if (!resolver) return {status: AUTHORITY_STATUS.NO_RESOLVER};
  if (!agentAddress) return {status: AUTHORITY_STATUS.NO_AGENT};
  // No pay node means the per-key and per-coin resources cannot be derived, and this function
  // would silently degrade to the two reads that missed the delegation in the first place. That is
  // a refusal, not a fallback.
  if (!payNode) {
    return {status: AUTHORITY_STATUS.NO_PAY_NODE, agentAddress, resolver,
            why: "the pay name's node is required to derive the per-key and per-coin-type resources"};
  }

  const chain = reader.chain;
  const scopes = [
    {scope: AUTHORITY_SCOPE.NAME, resource: BigInt(nameLevelResource(payNode)),
     what: "every record on the pay name"},
    {scope: AUTHORITY_SCOPE.ROOT, resource: ROOT_RESOURCE,
     what: "every record on every name this resolver serves"},
    {scope: AUTHORITY_SCOPE.PAY_TEXT_KEY, resource: BigInt(textResource(payNode, RECORD_KEY.pay)),
     what: `the text key ${RECORD_KEY.pay}, which carries the settlement configuration`},
    {scope: AUTHORITY_SCOPE.PAY_ADDR_COIN, resource: BigInt(coinTypeResource(payNode, ADDR_COIN_TYPE)),
     what: `the addr record at coin type ${ADDR_COIN_TYPE}`},
  ];

  // A resource is a 32-byte WORD. `toString(16)` drops leading zeroes, which printed the pinned
  // name-level resource 0x0bfd…5e61 as 0xbfd…5e61 — a value that no longer matches the constant a
  // reader would compare it against. Padded, so a printed resource is a comparable resource.
  const asWord = (v) => "0x" + v.toString(16).padStart(64, "0");
  const read = {};
  let union = 0n;
  for (const s of scopes) {
    const r = await probe(chain, resolver, encodeRolesCall(s.resource, agentAddress), (h) => uintAt(h, 0));
    if (r.observation !== PROBE.DECODED) {
      return {
        status: AUTHORITY_STATUS.UNREADABLE, agentAddress, resolver,
        failedScope: s.scope, failedResource: asWord(s.resource),
        probes: {[s.scope]: r.observation},
        why: `roles() at the ${s.scope} resource could not be read, and unread authority is not absent authority`,
      };
    }
    const bits = r.value ?? 0n;
    read[s.scope] = {resource: asWord(s.resource), roles: "0x" + bits.toString(16),
                     roleNames: roleName(bits), covers: s.what};
    union |= bits;
  }

  // The corroborating read, once per scope. A scope whose two reads disagree poisons the whole
  // answer: the union is then known to be incomplete and no part of it may be trusted.
  //
  // WHAT `hasRoles` ACTUALLY CONSULTS, measured on the fork rather than assumed. For the account
  // holding roles at ROOT_RESOURCE, `roles(textResource)` returned 0 while
  // `hasRoles(textResource, SET_TEXT)` returned TRUE — at all four resources. So `hasRoles` answers
  // about `roles(resource) | roles(ROOT_RESOURCE)`, and the honest comparison is against that
  // union and not against the scope's own bitmap. Comparing against the scope alone would have
  // reported DISAGREES for every root-holding account, which is a true refusal reached by a false
  // reason — and it would have masked AGENT_HOLDS_ROOT_RESOURCE, the precise one.
  const rootBits = BigInt(read[AUTHORITY_SCOPE.ROOT].roles);
  for (const s of scopes) {
    const c = await probe(
      chain, resolver, encodeHasRolesCall(s.resource, CORROBORATION_BIT, agentAddress), (h) => boolAt(h, 0),
    );
    if (c.observation !== PROBE.DECODED) {
      return {
        status: AUTHORITY_STATUS.UNREADABLE, agentAddress, resolver,
        failedScope: s.scope, probes: {[`corroborate:${s.scope}`]: c.observation},
        why: `hasRoles() at the ${s.scope} resource could not be read`,
      };
    }
    const effective = BigInt(read[s.scope].roles) | rootBits;
    const rolesSaysYes = (effective & CORROBORATION_BIT) === CORROBORATION_BIT;
    if (c.value !== rolesSaysYes) {
      return {
        status: AUTHORITY_STATUS.DISAGREES, agentAddress, resolver,
        scope: s.scope, hasRoles: c.value, unionSaysYes: rolesSaysYes,
        rolesAtScope: read[s.scope].roles,
        nameRoles: read[AUTHORITY_SCOPE.NAME].roles, rootRoles: read[AUTHORITY_SCOPE.ROOT].roles,
      };
    }
  }

  const rootRoles = BigInt(read[AUTHORITY_SCOPE.ROOT].roles);
  const editingScopes = scopes
    .map((s) => s.scope)
    .filter((k) => (BigInt(read[k].roles) & ANY_EDIT_MASK) !== 0n);

  return {
    status: AUTHORITY_STATUS.READ, agentAddress, resolver,
    scopes: read,
    // Kept under their original names so every existing reader of this result still works, and
    // still means exactly what it used to mean: the name-level and root bitmaps alone.
    nameRoles: read[AUTHORITY_SCOPE.NAME].roles,
    rootRoles: read[AUTHORITY_SCOPE.ROOT].roles,
    payTextKeyRoles: read[AUTHORITY_SCOPE.PAY_TEXT_KEY].roles,
    payAddrCoinRoles: read[AUTHORITY_SCOPE.PAY_ADDR_COIN].roles,
    union: "0x" + union.toString(16),
    unionNames: roleName(union),
    holdsRoot: rootRoles !== 0n,
    mayEditPay: (union & ANY_EDIT_MASK) !== 0n,
    mayEditPayVia: editingScopes,
    confirmedEditBits: "0x" + (union & CONFIRMED_EDIT_MASK).toString(16),
    // Said out loud so no reader mistakes four scopes for all of them.
    exhaustive: false,
    enumeratedKeys: [RECORD_KEY.pay],
    enumeratedCoinTypes: [Number(ADDR_COIN_TYPE)],
    notEnumerable: "a per-key or per-coin grant on a record UNICA does not settle against is not read here and cannot be enumerated on this deployment",
  };
}


// ── the preflight ─────────────────────────────────────────────────────────────────────────────

/// Judge a gathered bundle. Ordered so that no check ever runs on input an earlier check has not
/// established, and so the FIRST refusal is the most fundamental one — a reader told "expired"
/// about a name that is not even registered has been told something misleading.
///
/// @param policy.chainId          the settlement chain UNICA is on
/// @param policy.atTime           unix seconds, SUPPLIED. This module reads no clock: a validator
///                                that read the wall clock could not be tested against a fixture
///                                without lying about when it ran.
/// @param policy.requireLive      refuse anything that is not a live endpoint answer
/// @param policy.opening          {salt, entries} — the private inputs behind the published
///                                commitment. Optional: when absent the commitment is reported as
///                                UNVERIFIED rather than treated as verified.
export function preflight(bundle, policy = {}) {
  const chainId = policy.chainId ?? ENSV2.chainId;
  const atTime = policy.atTime;

  // ── the request itself ──
  if (!bundle || typeof bundle !== "object") return refuse(PREFLIGHT_STATUS.NO_RESOLUTION, {why: "no evidence bundle"});
  if (bundle.stage === "NAMES") {
    const s = bundle.named?.status;
    if (s === NAME_STATUS.PARENT_REQUIRED) return refuse(PREFLIGHT_STATUS.PARENT_REQUIRED, {ownerAction: bundle.named.ownerAction});
    if (s === NAME_STATUS.MERCHANT_LABEL_REQUIRED) return refuse(PREFLIGHT_STATUS.MERCHANT_LABEL_REQUIRED);
    return refuse(PREFLIGHT_STATUS.NAME_REFUSED, {detail: bundle.named?.detail, which: bundle.named?.which});
  }

  // ── ENS RESOLUTION MUST BE PRESENT. This is the load-bearing check: with the resolution stage
  //    removed there is no merchant, and UNICA must refuse rather than fall through to defaults.
  if (bundle.stage === "READER" || !bundle.named?.ok || !bundle.reads || !bundle.reads.pay) {
    return refuse(PREFLIGHT_STATUS.NO_RESOLUTION, {stage: bundle.stage ?? null});
  }
  const {named, reads} = bundle;

  // ── live evidence, when a live answer was required ──
  if (policy.requireLive && bundle.evidence !== EVIDENCE.LIVE_RPC) {
    return refuse(PREFLIGHT_STATUS.NOT_LIVE_EVIDENCE, {evidence: bundle.evidence ?? null});
  }

  // ── transport and chain ──
  const allReads = [...Object.values(reads), ...Object.values(bundle.duplicates ?? {})];
  const anyRpcFailure = allReads.find((r) => r && r.status === LIVE_STATUS.RPC_FAILURE);
  if (anyRpcFailure) return refuse(PREFLIGHT_STATUS.RPC_FAILURE, {detail: anyRpcFailure.detail ?? null});
  const wrongChain = allReads.find((r) => r && r.status === LIVE_STATUS.WRONG_CHAIN);
  if (wrongChain) return refuse(PREFLIGHT_STATUS.WRONG_CHAIN, {expected: wrongChain.expected, observed: wrongChain.observed});
  if (bundle.observedChainId !== null && bundle.observedChainId !== undefined && Number(bundle.observedChainId) !== chainId) {
    return refuse(PREFLIGHT_STATUS.WRONG_CHAIN, {expected: chainId, observed: Number(bundle.observedChainId)});
  }

  // ── the deployment must be the one this repository read first-hand ──
  const pinnedEntry = PROFILE.byName("UpgradableUniversalResolverProxy");
  if (lower(bundle.entryPoint) !== lower(pinnedEntry.address)) {
    return refuse(PREFLIGHT_STATUS.OFF_PROFILE_ENTRY_POINT, {used: bundle.entryPoint, verified: pinnedEntry.address});
  }
  if (bundle.entryPointCodeSize !== undefined && bundle.entryPointCodeSize !== null &&
      bundle.entryPointCodeSize !== pinnedEntry.codeSize) {
    return refuse(PREFLIGHT_STATUS.OFF_PROFILE_ENTRY_POINT,
                  {codeSize: bundle.entryPointCodeSize, verified: pinnedEntry.codeSize,
                   why: "the entry point at that address is not the runtime this repository verified"});
  }
  // THE CODE HASHES ARE A SEPARATE, HEAVIER CHECK, AND IT IS OPT-IN RATHER THAN IMPLIED.
  //
  // Address and code size are cheap and are checked on every run above. The runtime CODE HASH of
  // all fourteen pinned contracts is what actually catches "same address, different code" — which
  // matters here more than usual, because the resolution entry point is an upgradable proxy whose
  // admin can point it at other code. That check costs fourteen more reads, so a caller asks for
  // it, and this refuses when a caller asks for a verified deployment and did not run one. What it
  // will not do is let "we did not look" read the same as "we looked and it was fine".
  if (policy.requireVerifiedDeployment) {
    const dep = bundle.deployment;
    if (!dep) return refuse(PREFLIGHT_STATUS.DEPLOYMENT_UNVERIFIED, {why: "no deployment verification was run this pass"});
    if (dep.failed > 0) {
      return refuse(PREFLIGHT_STATUS.OFF_PROFILE_ENTRY_POINT,
                    {failedRows: dep.rows.filter((r) => !r.ok && !r.transport).map((r) => r.name),
                     why: "a pinned ENSv2 contract no longer matches the runtime this repository read"});
    }
    if (dep.transportSkipped > 0) {
      return refuse(PREFLIGHT_STATUS.DEPLOYMENT_UNVERIFIED,
                    {transportSkipped: dep.transportSkipped,
                     why: "some pinned contracts could not be read; an unread row is a SKIP, and a SKIP is not a pass"});
    }
  }

  // The registry. Only `.eth` was surveyed, so only `.eth` can be matched against the profile; a
  // parent under any other TLD is refused rather than waved through on the assumption that some
  // other registry behaves the same way.
  if (!/\.eth$/.test(named.names.parent)) {
    return refuse(PREFLIGHT_STATUS.OFF_PROFILE_REGISTRY,
                  {parent: named.names.parent,
                   why: "this repository has verified the .eth PermissionedRegistry and no other"});
  }

  // ── the resolver ──
  const payRead = reads.pay;
  if (payRead.status === LIVE_STATUS.RESOLVER_NOT_FOUND) return refuse(PREFLIGHT_STATUS.NO_RESOLVER, {name: named.names.pay});
  const resolver = bundle.resolvers?.pay?.address ?? null;
  if (!resolver || lower(resolver) === ZERO_ADDRESS) return refuse(PREFLIGHT_STATUS.NO_RESOLVER, {name: named.names.pay});
  if (bundle.resolvers.pay.codeSize === 0) {
    return refuse(PREFLIGHT_STATUS.RESOLVER_HAS_NO_CODE, {resolver});
  }
  const pinnedImpl = PROFILE.byName("PermissionedResolverImpl");
  const impl = bundle.resolvers.pay.implementation;
  if (impl === null || lower(impl) !== lower(pinnedImpl.address)) {
    return refuse(PREFLIGHT_STATUS.OFF_PROFILE_RESOLVER_IMPL,
                  {resolver, implementation: impl, verified: pinnedImpl.address});
  }

  // ── is this name actually registered, or is a wildcard parent answering for it? ──
  //
  // The Phase 1 survey confirmed this on chain: an unregistered subname under a wildcard parent
  // resolves, does not revert, and returns the zero address. So "it resolved" proves nothing. What
  // proves the merchant published something is a record, and the absence of both a record and an
  // address is the signature of a name nobody has registered.
  const payMissing = payRead.status === LIVE_STATUS.RECORD_MISSING;
  const addrZero = reads.payAddr?.ok ? reads.payAddr.isZero : true;
  if (payMissing && addrZero) {
    return refuse(PREFLIGHT_STATUS.WILDCARD_UNREGISTERED,
                  {name: named.names.pay, resolver,
                   why: "the resolution succeeded, returned nothing, and did not revert — which is what an unregistered subname looks like"});
  }
  if (payMissing) return refuse(PREFLIGHT_STATUS.RECORD_MISSING, {name: named.names.pay, key: RECORD_KEY.pay});
  if (payRead.status === LIVE_STATUS.MALFORMED_TEXT_RETURN) {
    return refuse(PREFLIGHT_STATUS.MALFORMED_RECORD, {name: named.names.pay, why: payRead.why});
  }

  // ── duplicates, before the record is interpreted ──
  //
  // A duplicate scan that did not complete is not an absence of duplicates. Every other name must
  // have ANSWERED and answered with nothing — RECORD_MISSING is the only clean result. A read that
  // came back malformed, or did not come back, leaves the ambiguity unestablished, and an
  // unestablished ambiguity is refused rather than assumed away.
  const dupeReads = Object.entries(bundle.duplicates ?? {});
  const unestablished = dupeReads.filter(([, r]) => !r || (r.status !== LIVE_STATUS.RECORD_MISSING && !(r.ok && r.value)));
  if (dupeReads.length === 0 || unestablished.length) {
    return refuse(PREFLIGHT_STATUS.RPC_FAILURE, {
      why: "the scan for a duplicate settlement configuration did not complete, so its absence was never established",
      names: unestablished.map(([where]) => named.names[where] ?? where),
      statuses: unestablished.map(([, r]) => r?.status ?? "NOT_READ"),
    });
  }
  const dupes = dupeReads.filter(([, r]) => r && r.ok && r.value);
  if (dupes.length) {
    return refuse(PREFLIGHT_STATUS.AMBIGUOUS_DUPLICATE_RECORDS, {
      canonical: named.names.pay,
      alsoOn: dupes.map(([where]) => named.names[where]),
      why: "a settlement configuration must live on exactly one name; there is no precedence rule and inventing one here would be a guess",
    });
  }

  // ── the record decodes, at a version this build accepts ──
  const decode = payRead.decode;
  if (!decode || !decode.ok) {
    if (decode?.status === "UNSUPPORTED_SCHEMA_VERSION") {
      return refuse(PREFLIGHT_STATUS.SCHEMA_VERSION_UNSUPPORTED, {found: decode.version, supported: SCHEMA_VERSION});
    }
    return refuse(PREFLIGHT_STATUS.MALFORMED_RECORD, {name: named.names.pay, detail: decode?.status ?? null, field: decode?.field ?? null});
  }
  const pay = decode.record;

  // ── the values ──
  if (Number(pay.chainId) !== chainId) {
    return refuse(PREFLIGHT_STATUS.RECORD_CHAIN_MISMATCH, {recordChainId: Number(pay.chainId), settlementChainId: chainId});
  }
  if (lower(pay.executor) === ZERO_ADDRESS) return refuse(PREFLIGHT_STATUS.ZERO_EXECUTOR);
  if (lower(pay.recipient) === ZERO_ADDRESS) return refuse(PREFLIGHT_STATUS.ZERO_RECIPIENT);

  const supported = PAYOUT_CURRENCIES[chainId] ?? {};
  if (!supported[lower(pay.token)]) {
    return refuse(PREFLIGHT_STATUS.UNSUPPORTED_TOKEN,
                  {token: pay.token, supported: Object.keys(supported)});
  }
  if (atTime === undefined || atTime === null) {
    // Not a clock read and not a default. A validator asked to judge an expiry without being told
    // the time is being asked to guess, and it says so.
    return refuse(PREFLIGHT_STATUS.EXPIRED, {why: "no `atTime` was supplied, so freshness could not be judged"});
  }
  if (BigInt(pay.expiry) <= BigInt(atTime)) {
    return refuse(PREFLIGHT_STATUS.EXPIRED, {expiry: String(pay.expiry), atTime: String(atTime)});
  }

  // ── the commitment, when its opening was supplied ──
  let commitment = {checked: false, matches: null, why: "no opening supplied — the commitment is UNVERIFIED"};
  if (policy.opening) {
    const m = commitmentMatches(pay.configCommitment, {
      domain: policy.opening.domain, salt: policy.opening.salt, entries: policy.opening.entries,
    });
    if (!m.ok || !m.matches) {
      return refuse(PREFLIGHT_STATUS.COMMITMENT_MISMATCH,
                    {published: pay.configCommitment, derived: m.commitment ?? null, detail: m.status});
    }
    commitment = {checked: true, matches: true, derived: m.commitment};
  }

  // ── the delegated agent ──
  const agentRead = reads.agent;
  const agent = agentRead?.ok ? agentRead.record : null;
  if (agent && agent.revocation === "REVOKED") {
    return refuse(PREFLIGHT_STATUS.AGENT_RECORD_REVOKED, {agent: agent.agent});
  }
  // The declaration-level half of the protected-field rule. A merchant who lists `unica.pay` among
  // the keys the agent may write has declared exactly the arrangement this module exists to
  // prevent, and no chain read is needed to see it.
  if (agent && Array.isArray(agent.allowedKeys) && agent.allowedKeys.includes(RECORD_KEY.pay)) {
    return refuse(PREFLIGHT_STATUS.PROTECTED_FIELD_UNDER_AGENT_CONTROL,
                  {agent: agent.agent, allowedKeys: agent.allowedKeys, source: "THE PUBLISHED AGENT RECORD",
                   why: "the agent record itself declares the agent may write the settlement configuration"});
  }

  // ── ENHANCED ACCESS CONTROL MUST HAVE BEEN READ. The second load-bearing check: with the EAC
  //    read removed, UNICA does not know who can rewrite the recipient, and not knowing is a
  //    refusal rather than a shrug.
  const auth = bundle.authority;
  if (!auth || auth.status === undefined) return refuse(PREFLIGHT_STATUS.NO_AUTHORIZATION_READ);
  if (auth.status === AUTHORITY_STATUS.UNREADABLE) {
    return refuse(PREFLIGHT_STATUS.AUTHORITY_UNKNOWN, {probes: auth.probes ?? null, resolver});
  }
  if (auth.status === AUTHORITY_STATUS.DISAGREES) {
    return refuse(PREFLIGHT_STATUS.AUTHORITY_READ_DISAGREES,
                  {hasRoles: auth.hasRoles, unionSaysYes: auth.unionSaysYes,
                   why: "roles() and hasRoles() answered differently about the same account; the safe reading is that neither is complete"});
  }
  if (auth.status === AUTHORITY_STATUS.NO_RESOLVER) return refuse(PREFLIGHT_STATUS.NO_RESOLVER);
  // A missing pay node means the per-key and per-coin-type scopes were never asked about. That is
  // the CRITICAL 2 blindness itself, so it refuses rather than accepting a partial read.
  if (auth.status === AUTHORITY_STATUS.NO_PAY_NODE) {
    return refuse(PREFLIGHT_STATUS.AUTHORITY_UNKNOWN, {why: auth.why, resolver});
  }
  // NO_AGENT is not a refusal. A merchant with no delegated agent is the simplest valid case, and
  // refusing it would mean UNICA only worked for merchants who had delegated.
  if (auth.status === AUTHORITY_STATUS.READ) {
    if (auth.holdsRoot) {
      return refuse(PREFLIGHT_STATUS.AGENT_HOLDS_ROOT_RESOURCE,
                    {agent: auth.agentAddress, rootRoles: auth.rootRoles,
                     why: "ROOT_RESOURCE is contract-wide authority; no UNICA delegation may include it"});
    }
    if (auth.mayEditPay) {
      return refuse(PREFLIGHT_STATUS.PROTECTED_FIELD_UNDER_AGENT_CONTROL,
                    {agent: auth.agentAddress, union: auth.union, roles: auth.unionNames,
                     via: auth.mayEditPayVia ?? null, scopes: auth.scopes ?? null,
                     source: "THE CHAIN",
                     why: "the agent holds an edit role at a resource that carries the settlement configuration — " +
                          "the whole pay name, the whole resolver, the pay text key, or the pay addr record"});
    }
  }

  return {
    ok: true,
    status: PREFLIGHT_STATUS.ACCEPTED,
    explain: PREFLIGHT_EXPLAIN.ACCEPTED,
    names: named.names,
    nodes: named.nodes,
    resources: named.resources,
    chainId,
    entryPoint: bundle.entryPoint,
    registry: PROFILE.byName("ETHRegistry").address,
    resolver,
    resolverImplementation: impl,
    block: bundle.block,
    pay,
    payRecordValue: payRead.value,
    treasury: reads.treasury?.ok ? reads.treasury.record : null,
    treasuryRecordValue: reads.treasury?.ok ? reads.treasury.value : null,
    agent,
    agentRecordValue: agentRead?.ok ? agentRead.value : null,
    authority: auth,
    commitment,
    evidence: bundle.evidence,
  };
}

// ── binding ───────────────────────────────────────────────────────────────────────────────────

export const RESOLUTION_DOMAIN = "UNICA.ensv2.merchant-resolution.v1";

/// The ordered list of everything a binding commits to. Kept as data, in this order, because the
/// commitment is a positional hash and a field added in the middle would silently change every
/// previous binding's meaning. The test walks this list and requires each entry to move the word.
export const BOUND_FIELDS = [
  "name", "namehash", "chainId", "registry", "resolver", "resolverImplementation", "entryPoint",
  "payResource", "treasuryResource", "agentResource",
  "recipient", "executor", "token", "configCommitment", "expiry",
  "blockNumber", "payRecordDigest", "treasuryRecordDigest", "agentRecordDigest", "agentAddress",
];

const hashOf = (s) => toHex(keccak256(utf8(String(s))));

/// Bind an ACCEPTED configuration to the exact reading that produced it.
///
/// WHAT A BINDING IS FOR. Everything above is a judgement about mutable state at a block. The
/// binding is the record of which state that was: the name, its namehash, the chain, the registry
/// and resolver that served it, the resources permissions are scoped to, the values read, the
/// block, and one word over all of it. A quote carries the word. If any of those inputs was
/// different, the word is different and the quote does not fit — which is what makes "the address
/// you were shown" part of what was agreed rather than something the payer had to trust.
export function bindConfiguration(accepted) {
  if (!accepted || accepted.status !== PREFLIGHT_STATUS.ACCEPTED) {
    return {ok: false, status: "NOT_ACCEPTED", why: "a binding is only made over an accepted configuration"};
  }
  const values = {
    name: accepted.names.pay,
    namehash: accepted.nodes.pay,
    chainId: BigInt(accepted.chainId),
    registry: lower(accepted.registry),
    resolver: lower(accepted.resolver),
    resolverImplementation: lower(accepted.resolverImplementation),
    entryPoint: lower(accepted.entryPoint),
    payResource: accepted.resources.pay,
    treasuryResource: accepted.resources.treasury,
    agentResource: accepted.resources.agent,
    recipient: lower(accepted.pay.recipient),
    executor: lower(accepted.pay.executor),
    token: lower(accepted.pay.token),
    configCommitment: accepted.pay.configCommitment,
    expiry: BigInt(accepted.pay.expiry),
    blockNumber: BigInt(accepted.block ?? 0),
    payRecordDigest: recordDigest({node: accepted.nodes.pay, key: RECORD_KEY.pay, value: accepted.payRecordValue}),
    treasuryRecordDigest: accepted.treasuryRecordValue === null || accepted.treasuryRecordValue === undefined
      ? ZERO_WORD
      : recordDigest({node: accepted.nodes.treasury, key: RECORD_KEY.treasury, value: accepted.treasuryRecordValue}),
    agentRecordDigest: accepted.agentRecordValue === null || accepted.agentRecordValue === undefined
      ? ZERO_WORD
      : recordDigest({node: accepted.nodes.agent, key: RECORD_KEY.agent, value: accepted.agentRecordValue}),
    agentAddress: accepted.agent ? lower(accepted.agent.agent) : ZERO_ADDRESS,
  };
  return {
    ok: true, status: "BOUND",
    ...values,
    chainId: Number(values.chainId),
    expiry: String(values.expiry),
    blockNumber: Number(values.blockNumber),
    resolutionCommitment: resolutionCommitment(values),
    fields: BOUND_FIELDS,
  };
}

/// One word over a binding.
///
/// Positional, one 32-byte word per field, in BOUND_FIELDS order. Strings are hashed rather than
/// truncated; addresses are left-padded; numbers are unsigned words. Every field is present in
/// every commitment, including the ones that were absent — an absent record contributes the zero
/// word, which is a different word from the digest of an empty string, so "no treasury record" and
/// "a treasury record that is empty" do not collide.
export function resolutionCommitment(v) {
  const words = [
    wordBytes32(hashOf(RESOLUTION_DOMAIN)),
    wordBytes32(hashOf(v.name)),
    wordBytes32(v.namehash),
    wordUint(v.chainId),
    wordAddress(v.registry),
    wordAddress(v.resolver),
    wordAddress(v.resolverImplementation),
    wordAddress(v.entryPoint),
    wordBytes32(v.payResource),
    wordBytes32(v.treasuryResource),
    wordBytes32(v.agentResource),
    wordAddress(v.recipient),
    wordAddress(v.executor),
    wordAddress(v.token),
    wordBytes32(v.configCommitment),
    wordUint(v.expiry),
    wordUint(v.blockNumber),
    wordBytes32(v.payRecordDigest),
    wordBytes32(v.treasuryRecordDigest),
    wordBytes32(v.agentRecordDigest),
    wordAddress(v.agentAddress),
  ];
  return toHex(keccak256(concat(...words)));
}

/// The whole chain in one call, for a caller that has a reader and a parent.
export async function resolveMerchantConfig({parent, merchant}, reader, policy = {}) {
  const bundle = await readMerchantEvidence({parent, merchant}, reader, policy);
  const verdict = preflight(bundle, policy);
  if (!verdict.ok) return {...verdict, bundle};
  return {...verdict, binding: bindConfiguration(verdict), bundle};
}

export {assertLiveEvidence};
