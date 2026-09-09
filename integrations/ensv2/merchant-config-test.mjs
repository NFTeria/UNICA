// Offline suite for the UNICA MerchantConfig resolver, its preflight validator, and the binding.
//
//   node integrations/ensv2/merchant-config-test.mjs
//   node integrations/ensv2/merchant-config-test.mjs --self-test
//
// THE FIXTURE IS A FIXTURE AND SAYS SO. Every name, address and record below is invented for this
// file. `unica-demo.eth` is not registered, UNICA owns no ENSv2 name, and nothing here is a claim
// about what any name publishes on any chain. What this suite tests is the VALIDATOR: given a
// described world, does it accept exactly the configurations it should and refuse everything else
// by the right name. Whether the real deployment behaves like the described world is
// `script/ensv2/merchant-config-live.mjs`'s job, and that runner reads the chain.
//
// EVERY REFUSAL HAS A CONTROL. The suite builds one world that is ACCEPTED, asserts that first,
// and then breaks exactly one thing per row. A refusal row is only evidence when the same world
// with that one thing repaired is accepted — otherwise the row could be firing for a reason nobody
// has looked at. The suite also checks that no two refusal rows share a status by accident, since
// two rows that cannot be told apart are one row.
//
// ENS IS LOAD-BEARING, AND THIS IS WHERE THAT IS PROVED. Two rows remove ENS from the evidence —
// one takes away the resolution, one takes away the Enhanced Access Control read — and require
// UNICA to REFUSE. If it still accepted, ENS would be decoration and these rows are the thing that
// would say so.
//
// `--self-test` replaces the validator with broken versions — one that always accepts, one that
// always refuses, a binding whose commitment ignores a field — and requires this suite to go RED
// for each. A suite that stays green while the validator is broken is not testing the validator.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {utf8} from "../permit2/digest.mjs";
import {dnsEncode, encodeResolveCall, namehash, ENSV2} from "../../web/ensv2/resolve.mjs";
import {
  ERC1967_IMPLEMENTATION_SLOT, ROOT_RESOURCE, SELECTOR, nameLevelResource,
} from "./permissioned.mjs";
import * as PROFILE from "./profile.mjs";
import * as R from "./records.mjs";
import {encodeTextCall, createReaderOverTransport, createLiveReader, assertLiveEvidence, EVIDENCE} from "./read-live.mjs";
import * as MC from "./merchant-config.mjs";

const show = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? `${x}n` : x));
const hexBody = (h) => String(h ?? "").replace(/^0x/, "").toLowerCase();
const word = (v) => BigInt(v).toString(16).padStart(64, "0");
const addrWord = (a) => hexBody(a).padStart(64, "0");

// ── the described world ───────────────────────────────────────────────────────────────────────

const PARENT = "unica-demo.eth";
const MERCHANT = "acme";
const RESOLVER = "0x00c0ffee0000000000000000000000000000c0de";
const RECIPIENT = "0xd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1";
const EXECUTOR = "0xe0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0";
const TOKEN = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";   // the payout currency build.mjs compiles in
const AGENT = "0xa9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9";
const ENTRY = PROFILE.byName("UpgradableUniversalResolverProxy").address;
const ENTRY_CODE_SIZE = PROFILE.byName("UpgradableUniversalResolverProxy").codeSize;
const IMPL = PROFILE.byName("PermissionedResolverImpl").address;

const SALT = "0x" + "3e".repeat(32);
const PRIVATE_INPUTS = {payoutThreshold: "1000000000", reserveFloor: "250000000"};
const OPENING = {domain: R.COMMITMENT_DOMAIN.config, salt: SALT, entries: PRIVATE_INPUTS};
const CONFIG_COMMITMENT = R.commitPrivate(OPENING).commitment;

const POLICY_SALT = "0x" + "9b".repeat(32);
const POLICY_COMMITMENT = R.commitPrivate({
  domain: R.COMMITMENT_DOMAIN.policy, salt: POLICY_SALT, entries: {allocationBps: "1500"},
}).commitment;

const NOW = 1_800_000_000;
const EXPIRY = NOW + 86_400;

const PAY_RECORD = {
  chainId: ENSV2.chainId, executor: EXECUTOR, recipient: RECIPIENT, token: TOKEN,
  configCommitment: CONFIG_COMMITMENT, expiry: EXPIRY,
};
const TREASURY_RECORD = {
  workflowVersion: 3, policyCommitment: POLICY_COMMITMENT, actionSchema: "unica.action.v1",
  status: "ACTIVE", expiry: EXPIRY, breaker: "FLOWING",
};
const AGENT_RECORD = {
  agent: AGENT, workflowId: "unica.treasury-agent", workflowVersion: 2,
  allowedKeys: ["unica.treasury"], expiry: EXPIRY, revocation: "ACTIVE",
};

const NAMES = MC.merchantNames({parent: PARENT, merchant: MERCHANT});

/// A fresh world every time, so one row's mutation cannot leak into the next.
///
/// The parent is a parameter because one row is about a parent under a TLD this repository has not
/// surveyed, and that row only means something if the world DESCRIBES those names. A world that
/// simply does not know them makes the transport fail, and the validator then refuses for a
/// transport reason — which would have been a green row proving the wrong thing.
function makeWorld(parent = PARENT) {
  const enc = (schema, rec) => R.encodeRecord(schema, rec).value;
  const N = MC.merchantNames({parent, merchant: MERCHANT});
  return {
    parent,
    namesOf: N,
    chainId: ENSV2.chainId,
    block: 11_666_085,
    entryPoint: ENTRY,
    entryPointCodeSize: ENTRY_CODE_SIZE,
    resolverCodeSize: 77,
    resolverImplementation: IMPL,
    resolverReverts: null,                 // set to a revert selector to make resolution fail
    names: {
      [N.names.merchant]: {resolver: RESOLVER, addr: null, texts: {}},
      [N.names.pay]: {resolver: RESOLVER, addr: RECIPIENT, texts: {[R.RECORD_KEY.pay]: enc("pay", PAY_RECORD)}},
      [N.names.treasury]: {resolver: RESOLVER, addr: null, texts: {[R.RECORD_KEY.treasury]: enc("treasury", TREASURY_RECORD)}},
      [N.names.agent]: {resolver: RESOLVER, addr: null, texts: {[R.RECORD_KEY.agent]: enc("agent", AGENT_RECORD)}},
    },
    eac: {
      rolesAtName: 0n,      // what roles(payResource, agent) returns
      rolesAtRoot: 0n,      // what roles(ROOT_RESOURCE, agent) returns
      hasRoles: null,       // null: derive it honestly from the union. A value forces a disagreement.
      unreadable: false,    // make every EAC read come back empty
    },
    transportThrows: false,
  };
}

// ── the transport that speaks for that world ──────────────────────────────────────────────────
//
// It answers exactly the JSON-RPC methods the reader issues, over exactly the calldata the reader
// builds — the calldata is precomputed here with the SAME encoders the reader uses, so a change to
// either that broke the pairing would show up as a miss rather than as a quiet wrong answer.

function abiString(s) {
  const b = hexBody(toHex(utf8(String(s))));
  return "0x" + word(32) + word(b.length / 2) + b.padEnd(Math.ceil(b.length / 64) * 64, "0");
}
function outer(innerHex, resolver) {
  const inner = hexBody(innerHex);
  return "0x" + word(64) + addrWord(resolver) + word(inner.length / 2) +
    inner.padEnd(Math.ceil(inner.length / 64) * 64, "0");
}

class Reverted extends Error {
  constructor(data) { super("execution reverted"); this.data = data; }
}

function makeTransport(world) {
  const stats = {calls: 0, resolves: 0, byMethod: {}};

  // name + query -> the resolve() calldata the reader will send
  const table = new Map();
  for (const [name, entry] of Object.entries(world.names)) {
    const node = namehash(name);
    const dns = dnsEncode(name);
    table.set(encodeResolveCall(dns, SELECTOR.addr + hexBody(node)),
      () => outer("0x" + addrWord(entry.addr ?? "0x" + "00".repeat(20)), entry.resolver));
    for (const key of Object.values(R.RECORD_KEY)) {
      table.set(encodeResolveCall(dns, encodeTextCall(node, key)), () => {
        const v = entry.texts[key];
        // `null` describes a resolver that answers with zero bytes; absent describes one that
        // answers with a properly encoded empty string. They are different observations and the
        // fixture can produce both, because the reader is required to tell them apart.
        if (v === null) return outer("0x", entry.resolver);
        return outer(abiString(v ?? ""), entry.resolver);
      });
    }
  }

  const payResource = BigInt((world.namesOf ?? NAMES).resources.pay);

  return {
    stats,
    transport: async (method, params) => {
      stats.calls++;
      stats.byMethod[method] = (stats.byMethod[method] ?? 0) + 1;
      if (world.transportThrows) throw new Error("the endpoint could not be reached — fixture");
      if (method === "eth_chainId") return "0x" + world.chainId.toString(16);
      if (method === "eth_blockNumber") return "0x" + world.block.toString(16);
      if (method === "eth_getCode") {
        const a = hexBody(params[0]);
        if (a === hexBody(world.entryPoint)) return "0x" + "00".repeat(world.entryPointCodeSize);
        if (a === hexBody(RESOLVER)) return "0x" + "00".repeat(world.resolverCodeSize);
        return "0x";
      }
      if (method === "eth_getStorageAt") {
        if (hexBody(params[1]) === hexBody(ERC1967_IMPLEMENTATION_SLOT)) {
          return "0x" + addrWord(world.resolverImplementation ?? "0x" + "00".repeat(20));
        }
        return "0x" + "0".repeat(64);
      }
      if (method !== "eth_call") throw new Error(`the fixture was asked ${method}, which the reader should not send`);

      const {to, data} = params[0];
      if (hexBody(to) === hexBody(world.entryPoint)) {
        stats.resolves++;
        if (world.resolverReverts) throw new Reverted(world.resolverReverts);
        const hit = table.get(data);
        if (!hit) throw new Error("the fixture was asked to resolve something it does not describe");
        return hit();
      }
      if (hexBody(to) === hexBody(RESOLVER)) {
        if (world.eac.unreadable) return "0x";
        const sel = "0x" + hexBody(data).slice(0, 8);
        if (sel === SELECTOR.roles) {
          const resource = BigInt("0x" + hexBody(data).slice(8, 72));
          if (resource === ROOT_RESOURCE) return "0x" + word(world.eac.rolesAtRoot);
          if (resource === payResource) return "0x" + word(world.eac.rolesAtName);
          return "0x" + word(0);
        }
        if (sel === SELECTOR.hasRoles) {
          const bitmap = BigInt("0x" + hexBody(data).slice(72, 136));
          const union = world.eac.rolesAtName | world.eac.rolesAtRoot;
          const honest = (union & bitmap) === bitmap;
          return "0x" + word(world.eac.hasRoles === null ? (honest ? 1 : 0) : (world.eac.hasRoles ? 1 : 0));
        }
        return "0x";
      }
      throw new Error(`the fixture was asked to call ${to}, which it does not describe`);
    },
  };
}

const BASE_POLICY = {
  chainId: ENSV2.chainId,
  atTime: NOW,
  agent: AGENT,
};

/// Run one case end to end through the INJECTED implementation.
async function runCase(impl, {world = makeWorld(), args = {parent: PARENT, merchant: MERCHANT}, policy = {}, live = false} = {}) {
  const {transport, stats} = makeTransport(world);
  const reader = live
    ? null
    : createReaderOverTransport(transport, {chainId: ENSV2.chainId, entryPoint: world.entryPoint});
  const p = {...BASE_POLICY, ...policy};
  const bundle = await impl.readMerchantEvidence(args, reader, p);
  const verdict = impl.preflight(bundle, p);
  return {verdict, bundle, stats, reader};
}

// ── the suite ─────────────────────────────────────────────────────────────────────────────────

async function runChecks(impl, emit) {
  // ── 0. the master control: the described world is ACCEPTED ──────────────────────────────────
  const good = await runCase(impl);
  emit("CONTROL — the base world is ACCEPTED",
       good.verdict.status === MC.PREFLIGHT_STATUS.ACCEPTED,
       `got ${good.verdict.status} ${show(good.verdict.why ?? good.verdict.detail ?? "")}`);
  emit("   the accepted answer carries the recipient the record published",
       good.verdict.pay?.recipient === RECIPIENT, `got ${good.verdict.pay?.recipient}`);
  emit("   and the resolver the chain named, not one supplied by the caller",
       String(good.verdict.resolver ?? "").toLowerCase() === RESOLVER, `got ${good.verdict.resolver}`);

  // ── 1. no cache: every read resolves again ──────────────────────────────────────────────────
  emit("every record read performed its own resolution through the entry point",
       good.stats.resolves >= 7, `${good.stats.resolves} resolutions for 7 reads — something was answered from memory`);

  // ── 2. every refusal, one broken thing at a time ─────────────────────────────────────────────
  const ROWS = [
    ["no parent supplied — an owner action, not a default",
     {args: {merchant: MERCHANT}}, MC.PREFLIGHT_STATUS.PARENT_REQUIRED],
    ["no merchant label supplied",
     {args: {parent: PARENT}}, MC.PREFLIGHT_STATUS.MERCHANT_LABEL_REQUIRED],
    ["a parent this build will not normalise",
     {args: {parent: "mérchant.eth", merchant: MERCHANT}}, MC.PREFLIGHT_STATUS.NAME_REFUSED],
    ["an answer that did not come from a live endpoint, when a live one was required",
     {policy: {requireLive: true}}, MC.PREFLIGHT_STATUS.NOT_LIVE_EVIDENCE],
    ["the endpoint cannot be reached",
     {world: {transportThrows: true}}, MC.PREFLIGHT_STATUS.RPC_FAILURE],
    ["the endpoint answers for another chain",
     {world: {chainId: 1}}, MC.PREFLIGHT_STATUS.WRONG_CHAIN],
    ["resolution through an entry point this repository has not verified",
     {world: {entryPoint: "0x00000000000000000000000000000000deadbeef"}}, MC.PREFLIGHT_STATUS.OFF_PROFILE_ENTRY_POINT],
    ["the entry point at the verified address is no longer the verified size",
     {world: {entryPointCodeSize: 2490}}, MC.PREFLIGHT_STATUS.OFF_PROFILE_ENTRY_POINT],
    ["a parent under a registry this repository has not verified",
     {parent: "unica-demo.xyz", args: {parent: "unica-demo.xyz", merchant: MERCHANT}},
     MC.PREFLIGHT_STATUS.OFF_PROFILE_REGISTRY],
    ["the merchant's resolver has no code at that address",
     {world: {resolverCodeSize: 0}}, MC.PREFLIGHT_STATUS.RESOLVER_HAS_NO_CODE],
    ["the merchant's resolver runs code this repository has not verified",
     {world: {resolverImplementation: "0x00000000000000000000000000000000c0dec0de"}}, MC.PREFLIGHT_STATUS.OFF_PROFILE_RESOLVER_IMPL],
    ["no resolver answers for the name",
     {world: {resolverReverts: PROFILE.ERROR_SELECTOR_OBSERVED.ResolverNotFound}}, MC.PREFLIGHT_STATUS.NO_RESOLVER],
    ["the name is unregistered and a wildcard parent answered for it — no revert, no record, no address",
     {mutate: (w) => { w.names[NAMES.names.pay].texts = {}; w.names[NAMES.names.pay].addr = null; }},
     MC.PREFLIGHT_STATUS.WILDCARD_UNREGISTERED],
    ["the name is registered and has an address, but publishes no settlement configuration",
     {mutate: (w) => { w.names[NAMES.names.pay].texts = {}; }},
     MC.PREFLIGHT_STATUS.RECORD_MISSING],
    ["the resolver answers the pay key with zero bytes, which is not an empty record",
     {mutate: (w) => { w.names[w.namesOf.names.pay].texts[R.RECORD_KEY.pay] = null; }},
     MC.PREFLIGHT_STATUS.MALFORMED_RECORD],
    ["the name publishes something under the pay key that is not a UNICA record",
     {mutate: (w) => { w.names[NAMES.names.pay].texts[R.RECORD_KEY.pay] = "pay me 100 dollars"; }},
     MC.PREFLIGHT_STATUS.MALFORMED_RECORD],
    ["the scan for a duplicate configuration did not complete, so its absence was never established",
     {mutate: (w) => { w.names[w.namesOf.names.treasury].texts[R.RECORD_KEY.pay] = null; }},
     MC.PREFLIGHT_STATUS.RPC_FAILURE],
    ["a settlement configuration published on a second name as well",
     {mutate: (w) => { w.names[NAMES.names.treasury].texts[R.RECORD_KEY.pay] = w.names[NAMES.names.pay].texts[R.RECORD_KEY.pay]; }},
     MC.PREFLIGHT_STATUS.AMBIGUOUS_DUPLICATE_RECORDS],
    ["a schema version this build does not accept",
     {mutate: (w) => { w.names[NAMES.names.pay].texts[R.RECORD_KEY.pay] =
       w.names[NAMES.names.pay].texts[R.RECORD_KEY.pay].replace("unica.pay|1|", "unica.pay|2|"); }},
     MC.PREFLIGHT_STATUS.SCHEMA_VERSION_UNSUPPORTED],
    ["a configuration that settles on another chain",
     {mutate: (w) => { w.names[NAMES.names.pay].texts[R.RECORD_KEY.pay] =
       R.encodeRecord("pay", {...PAY_RECORD, chainId: 1}).value; }},
     MC.PREFLIGHT_STATUS.RECORD_CHAIN_MISMATCH],
    ["a configuration naming no settlement executor",
     {mutate: (w) => { w.names[NAMES.names.pay].texts[R.RECORD_KEY.pay] =
       R.encodeRecord("pay", {...PAY_RECORD, executor: "0x" + "00".repeat(20)}).value; }},
     MC.PREFLIGHT_STATUS.ZERO_EXECUTOR],
    ["a configuration naming nobody to pay",
     {mutate: (w) => { w.names[NAMES.names.pay].texts[R.RECORD_KEY.pay] =
       R.encodeRecord("pay", {...PAY_RECORD, recipient: "0x" + "00".repeat(20)}).value; }},
     MC.PREFLIGHT_STATUS.ZERO_RECIPIENT],
    ["a settlement token this deployment cannot settle",
     {mutate: (w) => { w.names[NAMES.names.pay].texts[R.RECORD_KEY.pay] =
       R.encodeRecord("pay", {...PAY_RECORD, token: "0x000000000000000000000000000000000000dead"}).value; }},
     MC.PREFLIGHT_STATUS.UNSUPPORTED_TOKEN],
    ["a configuration that has expired",
     {policy: {atTime: EXPIRY + 1}}, MC.PREFLIGHT_STATUS.EXPIRED],
    ["an expiry judged with no time supplied — a guess is not a judgement",
     {policy: {atTime: undefined}}, MC.PREFLIGHT_STATUS.EXPIRED],
    ["a commitment that does not open to the inputs supplied",
     {policy: {opening: {...OPENING, salt: "0x" + "11".repeat(32)}}}, MC.PREFLIGHT_STATUS.COMMITMENT_MISMATCH],
    ["a delegated agent published as revoked",
     {mutate: (w) => { w.names[NAMES.names.agent].texts[R.RECORD_KEY.agent] =
       R.encodeRecord("agent", {...AGENT_RECORD, revocation: "REVOKED"}).value; }},
     MC.PREFLIGHT_STATUS.AGENT_RECORD_REVOKED],
    ["the agent record itself declares the agent may write the pay key",
     {mutate: (w) => { w.names[NAMES.names.agent].texts[R.RECORD_KEY.agent] =
       R.encodeRecord("agent", {...AGENT_RECORD, allowedKeys: [R.RECORD_KEY.pay, R.RECORD_KEY.treasury]}).value; }},
     MC.PREFLIGHT_STATUS.PROTECTED_FIELD_UNDER_AGENT_CONTROL],
    ["the chain says the agent holds an edit role on the pay name",
     {mutate: (w) => { w.eac.rolesAtName = PROFILE.RESOLVER_ROLE.SET_TEXT.bit; }},
     MC.PREFLIGHT_STATUS.PROTECTED_FIELD_UNDER_AGENT_CONTROL],
    ["the chain says the agent holds a role this survey never confirmed, which still counts against it",
     {mutate: (w) => { w.eac.rolesAtName = PROFILE.RESOLVER_ROLE.SET_DATA.bit; }},
     MC.PREFLIGHT_STATUS.PROTECTED_FIELD_UNDER_AGENT_CONTROL],
    ["the chain says the agent holds the ADMIN of an edit role, which is the same authority one step back",
     {mutate: (w) => { w.eac.rolesAtName = PROFILE.adminRole(PROFILE.RESOLVER_ROLE.SET_TEXT.bit); }},
     MC.PREFLIGHT_STATUS.PROTECTED_FIELD_UNDER_AGENT_CONTROL],
    ["the agent holds contract-wide authority at ROOT_RESOURCE",
     {mutate: (w) => { w.eac.rolesAtRoot = PROFILE.RESOLVER_ROLE.SET_ADDR.bit; }},
     MC.PREFLIGHT_STATUS.AGENT_HOLDS_ROOT_RESOURCE],
    ["who may edit the records could not be read at all",
     {mutate: (w) => { w.eac.unreadable = true; }}, MC.PREFLIGHT_STATUS.AUTHORITY_UNKNOWN],
    ["roles() and hasRoles() disagree about the same account",
     {mutate: (w) => { w.eac.hasRoles = true; }}, MC.PREFLIGHT_STATUS.AUTHORITY_READ_DISAGREES],
    ["a verified deployment was required and nobody re-read one",
     {policy: {requireVerifiedDeployment: true}}, MC.PREFLIGHT_STATUS.DEPLOYMENT_UNVERIFIED],
  ];

  const seen = new Map();
  for (const [what, spec, want] of ROWS) {
    const world = makeWorld(spec.parent ?? PARENT);
    if (spec.mutate) spec.mutate(world);
    Object.assign(world, spec.world ?? {});
    const got = await runCase(impl, {world, args: spec.args, policy: spec.policy});
    emit(`refused: ${what} -> ${want}`,
         got.verdict.status === want,
         `got ${got.verdict.status}; ${show(got.verdict.why ?? got.verdict.detail ?? got.verdict.explain ?? "")}`);
    emit(`   and it refused rather than accepting`, got.verdict.ok === false, "it ACCEPTED a world this row says is broken");
    if (!seen.has(what)) seen.set(what, got.verdict.status);
  }

  // A row whose status is shared with a different row for a different reason cannot be told apart
  // from it. Statuses are allowed to repeat deliberately (three shapes of agent authority land on
  // one status because they are one finding); this counts them and states the number rather than
  // pretending each row is unique.
  const distinct = new Set(ROWS.map(([, , want]) => want));
  emit(`the ${ROWS.length} refusal rows land on ${distinct.size} distinct named statuses`,
       distinct.size >= 20, `only ${distinct.size} distinct statuses, so the rows are not discriminating`);
  emit("no refusal row lands on ACCEPTED", !distinct.has(MC.PREFLIGHT_STATUS.ACCEPTED), "");

  // ── 3. the positive controls that are NOT refusals ──────────────────────────────────────────
  const noAgentWorld = makeWorld();
  noAgentWorld.names[NAMES.names.agent].texts = {};
  const noAgent = await runCase(impl, {world: noAgentWorld});
  emit("CONTROL — a merchant who has delegated to nobody is ACCEPTED",
       noAgent.verdict.status === MC.PREFLIGHT_STATUS.ACCEPTED,
       `got ${noAgent.verdict.status} — refusing this would mean UNICA only worked for merchants who had delegated`);

  const noTreasuryWorld = makeWorld();
  noTreasuryWorld.names[NAMES.names.treasury].texts = {};
  const noTreasury = await runCase(impl, {world: noTreasuryWorld});
  emit("CONTROL — a merchant with no treasury metadata is ACCEPTED",
       noTreasury.verdict.status === MC.PREFLIGHT_STATUS.ACCEPTED, `got ${noTreasury.verdict.status}`);

  const opened = await runCase(impl, {policy: {opening: OPENING}});
  emit("CONTROL — a commitment that DOES open to the inputs supplied is ACCEPTED",
       opened.verdict.status === MC.PREFLIGHT_STATUS.ACCEPTED, `got ${opened.verdict.status}`);
  emit("   and the answer says the commitment was actually checked",
       opened.verdict.ok === true && opened.verdict.commitment?.checked === true, show(opened.verdict.commitment));
  emit("   while an answer with no opening says the commitment is UNVERIFIED rather than fine",
       good.verdict.ok === true && good.verdict.commitment?.checked === false &&
         /UNVERIFIED/.test(good.verdict.commitment?.why ?? ""), show(good.verdict.commitment));

  // An agent that exists and holds nothing is the arrangement the architecture is FOR. It must be
  // accepted, or the refusal rows above are just "we refuse every agent".
  const harmlessAgent = await runCase(impl);
  emit("CONTROL — a delegated agent that holds no role on the pay name is ACCEPTED",
       harmlessAgent.verdict.status === MC.PREFLIGHT_STATUS.ACCEPTED &&
       harmlessAgent.verdict.authority?.agentAddress === AGENT.toLowerCase(),
       `got ${harmlessAgent.verdict.status}`);
  emit("   and the authority read was actually performed against the published agent address",
       harmlessAgent.verdict.ok === true &&
       harmlessAgent.verdict.authority?.status === MC.AUTHORITY_STATUS.READ &&
       harmlessAgent.verdict.authority?.mayEditPay === false, show(harmlessAgent.verdict.authority?.status));

  // The address the authority read is ABOUT must come from the published record, not the caller.
  const otherAgentWorld = makeWorld();
  otherAgentWorld.eac.rolesAtName = PROFILE.RESOLVER_ROLE.SET_TEXT.bit;
  const pointedElsewhere = await runCase(impl, {world: otherAgentWorld, policy: {agent: "0x000000000000000000000000000000000000beef"}});
  emit("a caller cannot point the authority check at an address other than the published agent",
       pointedElsewhere.verdict.status === MC.PREFLIGHT_STATUS.PROTECTED_FIELD_UNDER_AGENT_CONTROL,
       `got ${pointedElsewhere.verdict.status} — the caller's address was used instead of the record's`);

  // ── 4. ENS IS LOAD-BEARING ──────────────────────────────────────────────────────────────────
  //
  // Take ENS away and UNICA must refuse. If it accepted, ENS would be decoration and the whole
  // integration would be a story about a lookup nobody depends on.
  const withoutResolution = await (async () => {
    const {transport} = makeTransport(makeWorld());
    const bundle = await impl.readMerchantEvidence({parent: PARENT, merchant: MERCHANT}, null, BASE_POLICY);
    void transport;
    return impl.preflight(bundle, BASE_POLICY);
  })();
  emit("LOAD-BEARING — with ENS resolution removed, UNICA REFUSES",
       withoutResolution.ok === false && withoutResolution.status === MC.PREFLIGHT_STATUS.NO_RESOLUTION,
       `got ${withoutResolution.status} — if this is ACCEPTED, ENS is decoration`);

  const strippedBundle = await (async () => {
    const {transport} = makeTransport(makeWorld());
    const reader = createReaderOverTransport(transport, {chainId: ENSV2.chainId, entryPoint: ENTRY});
    const b = await impl.readMerchantEvidence({parent: PARENT, merchant: MERCHANT}, reader, BASE_POLICY);
    delete b.authority;                       // exactly the Enhanced Access Control half, removed
    return impl.preflight(b, BASE_POLICY);
  })();
  emit("LOAD-BEARING — with the Enhanced Access Control read removed, UNICA REFUSES",
       strippedBundle.ok === false && strippedBundle.status === MC.PREFLIGHT_STATUS.NO_AUTHORIZATION_READ,
       `got ${strippedBundle.status} — if this is ACCEPTED, the EAC check is decoration`);

  const emptyReads = await (async () => {
    const {transport} = makeTransport(makeWorld());
    const reader = createReaderOverTransport(transport, {chainId: ENSV2.chainId, entryPoint: ENTRY});
    const b = await impl.readMerchantEvidence({parent: PARENT, merchant: MERCHANT}, reader, BASE_POLICY);
    b.reads = {};                             // the records, removed
    return impl.preflight(b, BASE_POLICY);
  })();
  emit("LOAD-BEARING — with the record reads removed, UNICA REFUSES",
       emptyReads.ok === false && emptyReads.status === MC.PREFLIGHT_STATUS.NO_RESOLUTION,
       `got ${emptyReads.status}`);

  // ── 5. the binding, field by field ──────────────────────────────────────────────────────────
  const binding = impl.bindConfiguration(good.verdict);
  emit("a binding is produced over an accepted configuration", binding.ok === true, show(binding.status));
  emit("a binding is REFUSED over anything that was not accepted",
       impl.bindConfiguration({status: MC.PREFLIGHT_STATUS.EXPIRED}).ok === false, "");
  emit("the binding is deterministic",
       impl.bindConfiguration(good.verdict).resolutionCommitment === binding.resolutionCommitment, "");
  emit("the binding carries every field the architecture says it must",
       ["name", "namehash", "chainId", "registry", "resolver", "blockNumber", "resolutionCommitment"]
         .every((k) => binding[k] !== undefined && binding[k] !== null),
       show(Object.keys(binding)));

  // Every named input must move the word. A field that is in the binding but not in the hash is
  // the exact defect this walk exists to find: it reads as bound and is not.
  const ALT = {
    name: "pay.other.unica-demo.eth",
    namehash: "0x" + "77".repeat(32),
    chainId: 1n,
    registry: "0x000000000000000000000000000000000000aaaa",
    resolver: "0x000000000000000000000000000000000000bbbb",
    resolverImplementation: "0x000000000000000000000000000000000000cccc",
    entryPoint: "0x000000000000000000000000000000000000dddd",
    payResource: "0x" + "01".repeat(32),
    treasuryResource: "0x" + "02".repeat(32),
    agentResource: "0x" + "03".repeat(32),
    recipient: "0x000000000000000000000000000000000000eeee",
    executor: "0x000000000000000000000000000000000000ffff",
    token: "0x0000000000000000000000000000000000001111",
    configCommitment: "0x" + "04".repeat(32),
    expiry: 999n,
    blockNumber: 42n,
    payRecordDigest: "0x" + "05".repeat(32),
    treasuryRecordDigest: "0x" + "06".repeat(32),
    agentRecordDigest: "0x" + "07".repeat(32),
    agentAddress: "0x0000000000000000000000000000000000002222",
  };
  const canonical = {
    name: binding.name, namehash: binding.namehash, chainId: BigInt(binding.chainId),
    registry: binding.registry, resolver: binding.resolver,
    resolverImplementation: binding.resolverImplementation, entryPoint: binding.entryPoint,
    payResource: binding.payResource, treasuryResource: binding.treasuryResource,
    agentResource: binding.agentResource, recipient: binding.recipient, executor: binding.executor,
    token: binding.token, configCommitment: binding.configCommitment,
    expiry: BigInt(binding.expiry), blockNumber: BigInt(binding.blockNumber),
    payRecordDigest: binding.payRecordDigest, treasuryRecordDigest: binding.treasuryRecordDigest,
    agentRecordDigest: binding.agentRecordDigest, agentAddress: binding.agentAddress,
  };
  const baseWord = impl.resolutionCommitment(canonical);
  emit("the commitment over the binding's own fields reproduces the binding's word",
       baseWord === binding.resolutionCommitment, `${baseWord} vs ${binding.resolutionCommitment}`);
  emit(`the binding names ${MC.BOUND_FIELDS.length} fields and the walk below moves every one`,
       MC.BOUND_FIELDS.length === Object.keys(ALT).length,
       `${MC.BOUND_FIELDS.length} declared, ${Object.keys(ALT).length} alternatives written`);
  for (const field of MC.BOUND_FIELDS) {
    const moved = impl.resolutionCommitment({...canonical, [field]: ALT[field]});
    emit(`binding: changing ${field} changes the resolution commitment`,
         moved !== baseWord, "the word did not move, so this field is not in the commitment");
  }

  // And the whole way round: a different world must produce a different binding.
  const otherWorld = makeWorld();
  otherWorld.names[NAMES.names.pay].texts[R.RECORD_KEY.pay] =
    R.encodeRecord("pay", {...PAY_RECORD, recipient: "0x0000000000000000000000000000000000009999"}).value;
  const otherRun = await runCase(impl, {world: otherWorld});
  emit("a different published recipient produces a different binding, end to end",
       otherRun.verdict.ok && impl.bindConfiguration(otherRun.verdict).resolutionCommitment !== binding.resolutionCommitment,
       "two different merchant configurations bound to the same word");
}

/// Checks about the SHAPE of the live reader. These are not about the validator, so they run once
/// and are not part of the injected-implementation walk.
function structuralChecks(emit) {
  emit("the live reader refuses an option it does not recognise, rather than ignoring it", (() => {
    try { createLiveReader({rpcUrl: "https://example.invalid", fixtures: {}}); return false; } catch { return true; }
  })(), "an unknown option was accepted, which is how a safety switch ends up quietly off");

  for (const door of ["records", "fixture", "fixtures", "stub", "fallback", "transport", "evidence"]) {
    emit(`   and there is no \`${door}\` door into the live reader`, (() => {
      try { createLiveReader({rpcUrl: "https://example.invalid", [door]: {}}); return false; } catch { return true; }
    })(), "");
  }

  const live = createLiveReader({rpcUrl: "https://example.invalid"});
  emit("a live reader stamps its answers LIVE_RPC", live.evidence === EVIDENCE.LIVE_RPC, live.evidence);
  emit("an injected-transport reader stamps its answers INJECTED_TRANSPORT",
       createReaderOverTransport(async () => "0x").evidence === EVIDENCE.INJECTED_TRANSPORT, "");
  emit("assertLiveEvidence passes a live reader", assertLiveEvidence(live).ok === true, "");
  emit("assertLiveEvidence refuses an injected-transport reader, by name",
       assertLiveEvidence(createReaderOverTransport(async () => "0x")).status === "NOT_LIVE_EVIDENCE", "");
  emit("assertLiveEvidence refuses a hand-made object pretending to be a reader",
       assertLiveEvidence({kind: "ENSV2_RECORD_READER", evidence: "LIVE_RPC"}).ok === true &&
       assertLiveEvidence({evidence: "LIVE_RPC"}).status === "NOT_A_READER",
       "the shape check does not distinguish a reader from an object claiming to be one");
  emit("the live reader's endpoint is never printed whole",
       !/example\.invalid\/secret/.test(createLiveReader({rpcUrl: "https://example.invalid/secret/key"}).endpointLabel()),
       createLiveReader({rpcUrl: "https://example.invalid/secret/key"}).endpointLabel());

  // The structural claim, checked structurally: nothing the live path imports, at any depth, lives
  // under a fixtures directory. This is the reason the "no fixture fallback" sentence is a fact
  // about the code rather than a promise about behaviour.
  const closure = importClosure(new URL("./read-live.mjs", import.meta.url).pathname);
  emit(`the live reader's import closure is ${closure.length} files and none of them is a fixture`,
       closure.every((f) => !/\/fixtures?\//.test(f)),
       show(closure.filter((f) => /\/fixtures?\//.test(f))));
  emit("   and that closure scanner would notice one if it were there",
       importClosure(new URL("./read-live.mjs", import.meta.url).pathname, {pretend: "./fixtures/x.mjs"})
         .some((f) => /\/fixtures\//.test(f)),
       "the scanner cannot see a fixture import, so the row above proves nothing");
}

/// Follow relative imports from a file and return every path reached. Used to make "the live path
/// cannot reach a fixture" a checkable statement instead of a claim.
function importClosure(entry, opts = {}) {
  const fs = nodeFs();
  const seen = new Set();
  const stack = [entry];
  let first = true;
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let src;
    try { src = fs.readFileSync(file, "utf8"); } catch { continue; }
    const specs = [...src.matchAll(/^\s*import\s[^;]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1]);
    if (first && opts.pretend) { specs.push(opts.pretend); first = false; }
    for (const spec of specs) {
      if (!spec.startsWith(".")) continue;
      stack.push(new URL(spec, "file://" + file).pathname);
    }
  }
  return [...seen];
}

let FS = null;
function nodeFs() {
  if (!FS) FS = globalThis.__unicaFs;
  return FS;
}

// ── the runner ────────────────────────────────────────────────────────────────────────────────

const REAL = {
  readMerchantEvidence: MC.readMerchantEvidence,
  preflight: MC.preflight,
  bindConfiguration: MC.bindConfiguration,
  resolutionCommitment: MC.resolutionCommitment,
};

async function suite(impl, {structural = false} = {}) {
  let pass = 0, fail = 0;
  const lines = [];
  const emit = (name, ok, detail) => {
    if (ok) { pass++; lines.push(`PASS  ${name}`); }
    else { fail++; lines.push(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`); }
  };
  if (structural) structuralChecks(emit);
  // A suite that THROWS has not passed. Under sabotage a broken validator often crashes a row
  // rather than answering it wrongly, and a crash that escaped this function would kill the whole
  // run and print a stack trace where a verdict belongs. It is caught here and counted as the
  // failure it is, with the row that could not finish named.
  try {
    await runChecks(impl, emit);
  } catch (e) {
    fail++;
    lines.push(`FAIL  the suite could not finish: ${e?.message ?? e}`);
  }
  return {pass, fail, lines};
}

const SABOTAGE = [
  {
    what: "the preflight accepts everything",
    impl: () => ({...REAL, preflight: () => ({ok: true, status: MC.PREFLIGHT_STATUS.ACCEPTED})}),
  },
  {
    what: "the preflight refuses everything",
    impl: () => ({...REAL, preflight: () => ({ok: false, status: MC.PREFLIGHT_STATUS.RPC_FAILURE})}),
  },
  {
    what: "the preflight treats unreadable authority as acceptable",
    impl: () => ({...REAL, preflight: (b, p) => {
      const v = MC.preflight(b, p);
      return v.status === MC.PREFLIGHT_STATUS.AUTHORITY_UNKNOWN ? {ok: true, status: MC.PREFLIGHT_STATUS.ACCEPTED} : v;
    }}),
  },
  {
    what: "the preflight ignores a ROOT_RESOURCE grant to the agent",
    impl: () => ({...REAL, preflight: (b, p) => {
      const patched = b && b.authority ? {...b, authority: {...b.authority, holdsRoot: false}} : b;
      return MC.preflight(patched, p);
    }}),
  },
  {
    what: "the preflight ignores the agent's roles on the pay name",
    impl: () => ({...REAL, preflight: (b, p) => {
      const patched = b && b.authority ? {...b, authority: {...b.authority, mayEditPay: false}} : b;
      return MC.preflight(patched, p);
    }}),
  },
  {
    what: "the evidence reader skips the Enhanced Access Control read entirely",
    impl: () => ({...REAL, readMerchantEvidence: async (a, r, o) => {
      const b = await MC.readMerchantEvidence(a, r, o);
      if (b && b.authority) b.authority = {status: MC.AUTHORITY_STATUS.READ, mayEditPay: false, holdsRoot: false, agentAddress: null};
      return b;
    }}),
  },
  {
    what: "the binding's commitment ignores the recipient",
    impl: () => ({...REAL, resolutionCommitment: (v) => MC.resolutionCommitment({...v, recipient: "0x" + "00".repeat(20)})}),
  },
  {
    what: "the binding's commitment ignores the block it was read at",
    impl: () => ({...REAL, resolutionCommitment: (v) => MC.resolutionCommitment({...v, blockNumber: 0n})}),
  },
  {
    what: "the binding's commitment is a constant",
    impl: () => ({...REAL, resolutionCommitment: () => "0x" + "00".repeat(32)}),
  },
  {
    what: "the binding is made over configurations that were never accepted",
    impl: () => ({...REAL, bindConfiguration: (a) => ({...MC.bindConfiguration(a), ok: true, status: "BOUND"})}),
  },
];

globalThis.__unicaFs = await import("node:fs");

const selfTest = process.argv.includes("--self-test");

console.log("UNICA ENSv2 MerchantConfig — offline preflight, binding and the load-bearing rows");
console.log(`fixture parent ${PARENT} (INVENTED — not registered, and UNICA owns no ENSv2 name)`);
console.log(`entry point pinned by the profile: ${ENTRY}`);
console.log("no network is used by this suite\n");

const base = await suite(REAL, {structural: true});
for (const l of base.lines) console.log(l);

let extraRun = 0, extraPass = 0, extraFail = 0;
if (selfTest) {
  console.log("\n— sabotage: each broken validator must turn this suite RED —");
  for (const s of SABOTAGE) {
    extraRun++;
    const r = await suite(s.impl());
    if (r.fail > 0) { extraPass++; console.log(`PASS  caught: ${s.what} (${r.fail} row(s) went red)`); }
    else { extraFail++; console.log(`FAIL  NOT caught: ${s.what} — the suite stayed green, so it does not check this`); }
  }
  const after = await suite(REAL, {structural: true});
  extraRun++;
  if (after.pass === base.pass && after.fail === base.fail) {
    extraPass++;
    console.log(`PASS  the modules are unchanged after sabotage (${after.pass} passed, ${after.fail} failed, same as before)`);
  } else {
    extraFail++;
    console.log(`FAIL  the modules changed during sabotage: was ${base.pass}/${base.fail}, now ${after.pass}/${after.fail}`);
  }
}

const run = base.pass + base.fail + extraRun;
console.log(`\nchecks run: ${run}, passed: ${base.pass + extraPass}, failed: ${base.fail + extraFail}`);
if (!selfTest) console.log("run with --self-test to prove these checks can fail");
process.exit(base.fail + extraFail > 0 ? 1 : 0);
