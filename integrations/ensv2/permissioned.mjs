// ENSv2 Permissioned Resolver and Enhanced Access Control — reading WHO MAY CHANGE a merchant's
// records, live, and refusing to guess.
//
// WHAT THIS IS FOR. `web/ensv2/resolve.mjs` answers one question: which address does this name
// point at right now. That is the reading a payer is shown. It says nothing about who could change
// that reading between one checkout and the next — and for a payment product that is the more
// interesting question, because a merchant name whose address record anyone may rewrite is a
// merchant name that is worth nothing as an identity.
//
// ENSv2 answers it. Every ENSv2 name is served by a per-account Permissioned Resolver proxy, and
// every write on that resolver is gated by Enhanced Access Control: a role bitmap held by an
// account against a RESOURCE. This module reads that state — the resolver, its implementation, the
// role bitmaps, the resource ids — and classifies what it found.
//
// WHAT IT DELIBERATELY DOES NOT DO. It never writes. It holds no key, opens no socket, and has no
// code path that could sign or broadcast: every chain read arrives through an injected `chain`
// object, exactly as `resolveMerchant` takes its `rpcCall`. It does not decide whether a merchant
// is trustworthy; it reports which account the chain says may edit them, and says UNKNOWN when it
// could not tell.
//
// SELECTORS ARE DERIVED, NEVER TYPED. Every four-byte selector below comes from `selectorFor()`
// applied to the signature string beside it, using the repository's own keccak. Two hand-typed
// selectors elsewhere in this repository were both wrong, and a wrong selector fails as an EMPTY
// RETURN rather than as an error — which is the single most dangerous failure shape here, because
// an empty return looks like "no roles" and "no roles" looks like a safe answer.
//
// THE OBSERVATIONS. Probing a function from outside without a wallet gives outcomes that mean
// different things, and `PROBE` gives each one its own word so nothing collapses them: a DECODED
// value; an EMPTY RETURN (the selector reached no dispatch arm, or the contract has no code); a
// REVERT (which carries an error selector); an RPC_FAILURE (the transport, not the contract); and
// UNDECODABLE (bytes came back and the decoder refused them). That last one is a separate word
// because it used to be filed under DECODED, and every reader of a role bitmap then turned a
// failed read into a zero bitmap — which reads as "this account holds nothing" and is safe-looking
// in precisely the direction that matters.
//
// A SECOND, NARROWER VOCABULARY FOR SIMULATED WRITES. A setter returns nothing, so an ACCEPTED
// simulated write also produces `0x` on the wire. Reusing EMPTY_RETURN for it would make "the
// contract let me through" and "the contract has no such function" the same word. Simulated writes
// are therefore classified with `SIM` — ACCEPTED / REFUSED / UNKNOWN — and an ACCEPTED row is only
// meaningful once the resolver's code size has been observed non-zero, which `readAuthorization`
// does first.
//
// PROVENANCE. Signatures, role constants and the resource derivation were read from
// https://docs.ens.domains/ensv2/permissioned-resolver and
// https://docs.ens.domains/ensv2/enhanced-access-control on 2026-09-08 (ENS documentation is
// CC0-1.0). No ENS implementation source is copied. Every signature was then checked against the
// deployed runtime at PermissionedResolverImpl, and the ones that a live probe actually exercised
// are marked as such in `INTERFACE` — a documented signature that no live call confirmed is
// labelled DOCUMENTED_NOT_OBSERVED and stays that way until something observes it.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {concat, utf8, wordAddress, wordBytes32, wordUint} from "../permit2/digest.mjs";
import {ENSV2, dnsEncode, encodeResolveCall, decodeResolveReturn, namehash, normalizeName} from "../../web/ensv2/resolve.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_WORD = "0x" + "0".repeat(64);

/// Derived from the signature string, always. There is no literal selector in this file.
export const selectorFor = (signature) => toHex(keccak256(utf8(signature))).slice(0, 10);

/// The exact signature strings. These, not the selectors, are the interface: a selector is a
/// derivation of a signature and is only ever as right as the text it came from, so the text is
/// what gets reviewed and the number is what gets computed.
export const SIGNATURES = {
  // Enhanced Access Control — reads
  roles: "roles(uint256,address)",
  hasRoles: "hasRoles(uint256,uint256,address)",
  hasRootRoles: "hasRootRoles(uint256,address)",
  roleCount: "roleCount(uint256)",
  hasAssignees: "hasAssignees(uint256,uint256)",
  getAssigneeCount: "getAssigneeCount(uint256,uint256)",
  // Enhanced Access Control — writes (never called here; present so a preview can decode one)
  grantRoles: "grantRoles(uint256,uint256,address)",
  revokeRoles: "revokeRoles(uint256,uint256,address)",
  grantRootRoles: "grantRootRoles(uint256,address)",
  revokeRootRoles: "revokeRootRoles(uint256,address)",
  // Permissioned Resolver — reads
  addr: "addr(bytes32)",
  addrCoin: "addr(bytes32,uint256)",
  text: "text(bytes32,string)",
  hasAddr: "hasAddr(bytes32,uint256)",
  getAlias: "getAlias(bytes)",
  recordVersions: "recordVersions(bytes32)",
  resolve: "resolve(bytes,bytes)",
  // Permissioned Resolver — writes
  setAddr: "setAddr(bytes32,address)",
  setAddrCoin: "setAddr(bytes32,uint256,bytes)",
  setText: "setText(bytes32,string,string)",
  setContenthash: "setContenthash(bytes32,bytes)",
  setAlias: "setAlias(bytes,bytes)",
  clearRecords: "clearRecords(bytes32)",
  authorizeNameRoles: "authorizeNameRoles(bytes,uint256,address,bool)",
  authorizeTextRoles: "authorizeTextRoles(bytes,string,address,bool)",
  authorizeAddrRoles: "authorizeAddrRoles(bytes,uint256,address,bool)",
};

export const SELECTOR = Object.fromEntries(
  Object.entries(SIGNATURES).map(([k, sig]) => [k, selectorFor(sig)]),
);

/// Errors this module can name. A revert whose selector is not in here is reported as
/// UNKNOWN_REVERT with its raw selector, never silently swallowed — an unrecognised refusal is
/// still a refusal and must not read as a pass.
export const ERROR_SIGNATURES = {
  EACUnauthorizedAccountRoles: "EACUnauthorizedAccountRoles(uint256,uint256,address)",
  EACInvalidRoleBitmap: "EACInvalidRoleBitmap(uint256)",
  UnsupportedResolverProfile: "UnsupportedResolverProfile(bytes4)",
  InvalidInitialization: "InvalidInitialization()",
  Panic: "Panic(uint256)",
};

export const ERROR_SELECTOR = Object.fromEntries(
  Object.entries(ERROR_SIGNATURES).map(([k, sig]) => [selectorFor(sig), k]),
);

/// The role bitmap constants, from the Permissioned Resolver documentation. Roles are spaced four
/// bits apart, which is why `roleCount` packs a per-role counter into one word.
///
/// CONFIRMED means a live refusal named exactly this bitmap for the matching setter. The rest are
/// documented and were not exercised, and saying which is which is the whole point of the field.
export const ROLE = {
  SET_ADDR: 1n << 0n,
  SET_TEXT: 1n << 4n,
  SET_CONTENTHASH: 1n << 8n,
  SET_PUBKEY: 1n << 12n,
  SET_ABI: 1n << 16n,
  SET_INTERFACE: 1n << 20n,
  SET_NAME: 1n << 24n,
  SET_ALIAS: 1n << 28n,
  CLEAR: 1n << 32n,
  SET_DATA: 1n << 36n,
  UPGRADE: 1n << 124n,
};

/// An admin role sits 128 bits above the role it administers.
export const ADMIN_SHIFT = 128n;
export const adminRole = (role) => BigInt(role) << ADMIN_SHIFT;

/// ROOT_RESOURCE is the resolver-instance-wide resource. An account holding a role here holds it
/// for every name the resolver serves, which is what "each account gets its own resolver" means in
/// practice: the account's authority lives at the root of its own instance.
export const ROOT_RESOURCE = 0n;

export const roleName = (bitmap) => {
  const b = BigInt(bitmap);
  const hits = Object.entries(ROLE).filter(([, v]) => (b & v) === v && v !== 0n).map(([k]) => k);
  return hits.length ? hits.join("|") : null;
};

// ── resource derivation ───────────────────────────────────────────────────────────────────────
//
// The resolver computes an EAC resource as keccak256(node ‖ part), where `part` selects how
// granular the permission is. All three shapes are derived here; only the name-level one has been
// observed in a live refusal, and `INTERFACE` says so.

export const nameLevelResource = (node) => toHex(keccak256(concat(wordBytes32(node), wordUint(0))));
export const textResource = (node, key) =>
  toHex(keccak256(concat(wordBytes32(node), wordBytes32(toHex(keccak256(utf8(String(key))))))));
export const dataResource = textResource;
export const coinTypeResource = (node, coinType) =>
  toHex(keccak256(concat(wordBytes32(node), wordBytes32(toHex(keccak256(wordUint(coinType)))))));

// ── managed merchant subnames ─────────────────────────────────────────────────────────────────

export const SUBNAME_STATUS = {
  DERIVED: "DERIVED",
  BAD_PARENT: "BAD_PARENT",
  BAD_LABEL: "BAD_LABEL",
};

/// `<merchant>.<parent>` — the shape an operator hands out to merchants it manages.
///
/// The label is held to the same conservative subset `normalizeName` enforces, and for the same
/// reason: a label this repository cannot normalise correctly is a label that could be a lookalike
/// of somebody else's merchant, and a payment surface must not resolve one of those.
export function managedSubname(parent, label) {
  const p = normalizeName(parent);
  if (!p.ok) return {ok: false, status: SUBNAME_STATUS.BAD_PARENT, detail: p.status};
  const l = String(label ?? "").toLowerCase();
  if (!l.length || l.length > 63 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(l) || l !== String(label ?? "")) {
    return {ok: false, status: SUBNAME_STATUS.BAD_LABEL};
  }
  const name = `${l}.${p.name}`;
  return {
    ok: true,
    status: SUBNAME_STATUS.DERIVED,
    name,
    label: l,
    parent: p.name,
    node: namehash(name),
    parentNode: namehash(p.name),
    dns: dnsEncode(name),
  };
}

// ── tiny ABI helpers, for exactly the shapes below ────────────────────────────────────────────
//
// Written out rather than generalised. A general encoder that silently mishandles a type it was
// never taught produces calldata that decodes to something else, and this file's whole job is to
// be exact about what it asked the chain.

const hexBody = (h) => String(h ?? "").replace(/^0x/, "").toLowerCase();
const w = (bytes) => hexBody(toHex(bytes));
export const tailBytes = (hex) => {
  const b = hexBody(hex);
  return w(wordUint(b.length / 2)) + b.padEnd(Math.ceil(b.length / 64) * 64, "0");
};
export const tailString = (s) => tailBytes(toHex(utf8(String(s))));

export const encodeRolesCall = (resource, account) =>
  SELECTOR.roles + w(wordUint(resource)) + w(wordAddress(account));
export const encodeHasRolesCall = (resource, bitmap, account) =>
  SELECTOR.hasRoles + w(wordUint(resource)) + w(wordUint(bitmap)) + w(wordAddress(account));
export const encodeHasRootRolesCall = (bitmap, account) =>
  SELECTOR.hasRootRoles + w(wordUint(bitmap)) + w(wordAddress(account));
export const encodeRoleCountCall = (resource) => SELECTOR.roleCount + w(wordUint(resource));
export const encodeGetAssigneeCountCall = (resource, bitmap) =>
  SELECTOR.getAssigneeCount + w(wordUint(resource)) + w(wordUint(bitmap));
export const encodeAddrCall = (node) => SELECTOR.addr + hexBody(node);
export const encodeGetAliasCall = (dnsHex) => SELECTOR.getAlias + w(wordUint(0x20)) + tailBytes(dnsHex);

/// The edit UNICA actually cares about: point a merchant name at a settlement recipient.
export const encodeSetAddrCall = (node, address) =>
  SELECTOR.setAddr + hexBody(node) + w(wordAddress(address));

/// The edit an operator makes when it publishes a merchant's payout policy as a text record.
export const encodeSetTextCall = (node, key, value) => {
  const k = tailString(key);
  return SELECTOR.setText + hexBody(node) + w(wordUint(0x60)) +
    w(wordUint(0x60 + k.length / 2)) + k + tailString(value);
};

const wordAt = (hex, i) => {
  const b = hexBody(hex);
  if ((i + 1) * 64 > b.length) throw new Error(`word ${i} runs past a ${b.length / 2}-byte return`);
  return b.slice(i * 64, (i + 1) * 64);
};
export const uintAt = (hex, i) => BigInt("0x" + wordAt(hex, i));
export const addressAt = (hex, i) => {
  const word = wordAt(hex, i);
  if (!/^0{24}/.test(word)) throw new Error("an address word has dirty upper bits");
  return "0x" + word.slice(24);
};
export const boolAt = (hex, i) => {
  const v = uintAt(hex, i);
  if (v > 1n) throw new Error("a bool word is neither 0 nor 1");
  return v === 1n;
};

// ── the three observations ────────────────────────────────────────────────────────────────────

export const PROBE = {
  DECODED: "DECODED",
  EMPTY_RETURN: "EMPTY_RETURN",
  REVERT: "REVERT",
  RPC_FAILURE: "RPC_FAILURE",
  // A non-empty return that the decoder refused. It is NOT a decoded value and it must not share a
  // word with one: every consumer below gates on `observation === PROBE.DECODED` and then reads
  // `value ?? 0n`, so classifying an undecodable return as DECODED turned "I could not read this"
  // into "the account holds no roles" — the exact collapse this file's header says it prevents.
  // Found by sabotage: with roles() answering four bytes of garbage, the unauthorized probe row
  // still reported heldRoles 0x0 and the contrast still read ESTABLISHED.
  UNDECODABLE: "UNDECODABLE",
};

/// The endpoint, safe to print.
///
/// An RPC URL is routinely a credential. The provider shapes in circulation carry the key in the
/// path (`/v2/<key>`), in the query (`?apikey=<key>`) or in userinfo (`https://user:pass@host`),
/// and every command in this directory echoes the endpoint it read so a reader can tell which
/// chain answered. Echoing it verbatim publishes the key into stdout, into a gate log, and into
/// whatever anyone pastes that log to — and it does so on the FAILURE path too, which is the one
/// most likely to be pasted into a bug report.
///
/// So only the origin is ever printed. The host is the part that answers the question "which
/// endpoint replied"; the path and query never do. When something was removed the caller is told
/// that it was, because silently truncating an endpoint would make two different URLs look the
/// same. Kept here, exported, so there is ONE description of this rule rather than one per script.
export function redactRpc(url) {
  let u;
  try { u = new URL(String(url)); } catch { return "(an endpoint that is not a parseable URL — redacted)"; }
  const hidden = u.username || u.password || u.search || (u.pathname && u.pathname !== "/");
  return u.origin + (hidden ? " (path, query and credentials redacted)" : "");
}

/// Decode an EAC refusal. Returns the named error and its arguments, or UNKNOWN_REVERT with the
/// raw selector — never null, because a caller that gets null tends to treat it as "nothing
/// happened".
export function decodeRevert(data) {
  const b = hexBody(data);
  if (!b.length) return {error: "REVERT_WITHOUT_DATA", selector: null};
  const sel = "0x" + b.slice(0, 8);
  const name = ERROR_SELECTOR[sel];
  const args = "0x" + b.slice(8);
  if (name === "EACUnauthorizedAccountRoles") {
    let resource, roleBitmap, account;
    try {
      resource = "0x" + wordAt(args, 0);
      roleBitmap = uintAt(args, 1);
      account = addressAt(args, 2);
    } catch (e) {
      return {error: name, selector: sel, malformed: e.message};
    }
    return {error: name, selector: sel, resource, roleBitmap, roles: roleName(roleBitmap), account};
  }
  if (name === "EACInvalidRoleBitmap") {
    let roleBitmap;
    try { roleBitmap = uintAt(args, 0); } catch (e) { return {error: name, selector: sel, malformed: e.message}; }
    return {error: name, selector: sel, roleBitmap};
  }
  if (name) return {error: name, selector: sel, args};
  return {error: "UNKNOWN_REVERT", selector: sel, args};
}

/// Run one read-only probe and classify it into exactly one of the three observations.
///
/// @param chain.call injected `(to, data, from?) -> hex`, throwing on revert with `.data` set.
export async function probe(chain, to, data, decode) {
  let raw;
  try {
    raw = await chain.call(to, data);
  } catch (e) {
    const d = (e && e.data) || (e && e.error && e.error.data) || "";
    if (typeof d === "string" && d.length >= 10) {
      return {observation: PROBE.REVERT, revert: decodeRevert(d), raw: d};
    }
    return {observation: PROBE.RPC_FAILURE, detail: e?.message ?? String(e)};
  }
  if (!raw || raw === "0x") return {observation: PROBE.EMPTY_RETURN, raw: "0x"};
  if (!decode) return {observation: PROBE.DECODED, raw};
  try {
    return {observation: PROBE.DECODED, raw, value: decode(raw)};
  } catch (e) {
    // A return that will not decode is NOT a decoded value. Reported as its own observation rather
    // than rounded into either neighbour — carrying `undecodable` on a DECODED row was not enough,
    // because nothing downstream read that field.
    return {observation: PROBE.UNDECODABLE, raw, undecodable: e.message};
  }
}

// ── reading the live authorization state ──────────────────────────────────────────────────────

export const AUTHZ_STATUS = {
  READ: "READ",
  NAME_REFUSED: "NAME_REFUSED",
  NO_RESOLVER: "NO_RESOLVER",
  RESOLVER_HAS_NO_CODE: "RESOLVER_HAS_NO_CODE",
  NOT_A_PERMISSIONED_RESOLVER: "NOT_A_PERMISSIONED_RESOLVER",
  AUTHORITY_UNKNOWN: "AUTHORITY_UNKNOWN",
  WRONG_CHAIN: "WRONG_CHAIN",
  RPC_FAILURE: "RPC_FAILURE",
};

/// The ERC-1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1. Derived here
/// rather than pasted, so the constant cannot be a typo that reads as "not a proxy".
export const ERC1967_IMPLEMENTATION_SLOT = toHex(
  wordUint(BigInt(toHex(keccak256(utf8("eip1967.proxy.implementation")))) - 1n),
);

/// A deterministic address that is nobody's wallet, for the unauthorized half of a simulation.
///
/// It is the low 20 bytes of a keccak over a fixed domain string, so it is reproducible from this
/// file alone and could only be spent from by whoever finds a preimage of a keccak digest. It is
/// never a hard-coded literal, and `simulateEdit` verifies it holds no roles before it is used to
/// claim anything — a "refused" row from an account that turned out to be authorised would prove
/// the opposite of what it says.
export const UNAUTHORIZED_PROBE_DOMAIN = "UNICA.ensv2.unauthorized.probe.v1";
export const unauthorizedProbeAddress = () =>
  "0x" + hexBody(toHex(keccak256(utf8(UNAUTHORIZED_PROBE_DOMAIN)))).slice(24);

/// Read who may edit a name's records, from the chain and from nothing else.
///
/// Every address in the answer is discovered: the resolver comes from the UniversalResolver's own
/// reply, the implementation from the resolver's ERC-1967 slot, and the candidate authorities from
/// chain reads. Nothing about a particular name is compiled into this function.
///
/// @param chain {call, getCode, getStorageAt, getLogs?} — injected. `getLogs` is optional; when it
///        is absent the log-derived candidates are simply absent and the result says so.
export async function readAuthorization(name, chain, opts = {}) {
  const chainId = opts.chainId ?? ENSV2.chainId;
  const entryPoint = opts.entryPoint ?? ENSV2.entryPoint;
  const base = {name: String(name ?? ""), chainId, entryPoint, docs: ENSV2.docs};

  if (chainId !== ENSV2.chainId) return {ok: false, status: AUTHZ_STATUS.WRONG_CHAIN, ...base};

  const norm = normalizeName(name);
  if (!norm.ok) return {ok: false, status: AUTHZ_STATUS.NAME_REFUSED, detail: norm.status, ...base};

  const node = namehash(norm.name);
  const dns = dnsEncode(norm.name);
  const meta = {...base, name: norm.name, node, dns};

  // 1. Which resolver answers for this name? Asked of the UniversalResolver, not assumed.
  let resolver = null, addrRecord = null, resolveRaw = null;
  try {
    resolveRaw = await chain.call(entryPoint, encodeResolveCall(dns, encodeAddrCall(node)));
  } catch (e) {
    const d = (e && e.data) || "";
    return {...meta, ok: false, status: AUTHZ_STATUS.NO_RESOLVER,
            detail: typeof d === "string" && d.length >= 10 ? decodeRevert(d).error : (e?.message ?? String(e))};
  }
  const decoded = decodeResolveReturn(resolveRaw);
  if (!decoded || !/^0x[0-9a-fA-F]{40}$/.test(decoded.resolver) || decoded.resolver.toLowerCase() === ZERO_ADDRESS) {
    return {...meta, ok: false, status: AUTHZ_STATUS.NO_RESOLVER, raw: resolveRaw};
  }
  resolver = decoded.resolver;
  if (decoded.resultLen === 32 && /^0x0{24}[0-9a-fA-F]{40}$/.test(decoded.result)) {
    const a = "0x" + decoded.result.slice(26);
    addrRecord = a.toLowerCase() === ZERO_ADDRESS ? null : a;
  }

  // 2. Does that resolver have code, and is it a proxy over an implementation?
  let code;
  try { code = await chain.getCode(resolver); } catch (e) {
    return {...meta, ok: false, status: AUTHZ_STATUS.RPC_FAILURE, resolver, detail: e?.message ?? String(e)};
  }
  const codeSize = (hexBody(code).length) / 2;
  if (codeSize === 0) return {...meta, ok: false, status: AUTHZ_STATUS.RESOLVER_HAS_NO_CODE, resolver, codeSize};

  let implementation = null;
  if (chain.getStorageAt) {
    try {
      const slot = await chain.getStorageAt(resolver, ERC1967_IMPLEMENTATION_SLOT);
      const word = hexBody(slot).padStart(64, "0");
      const a = "0x" + word.slice(24);
      implementation = a.toLowerCase() === ZERO_ADDRESS ? null : a;
    } catch { implementation = null; }
  }

  // 3. Does it speak Enhanced Access Control? `roleCount(ROOT_RESOURCE)` is the cheapest question
  //    that distinguishes a permissioned resolver from any other resolver, because a resolver that
  //    does not implement EAC has no such dispatch arm and answers with an EMPTY RETURN.
  const rootCount = await probe(chain, resolver, encodeRoleCountCall(ROOT_RESOURCE), (h) => uintAt(h, 0));
  if (rootCount.observation !== PROBE.DECODED) {
    return {...meta, ok: false, status: AUTHZ_STATUS.NOT_A_PERMISSIONED_RESOLVER,
            resolver, codeSize, implementation, rootRoleCount: rootCount};
  }

  const nameResource = nameLevelResource(node);
  const nameCount = await probe(chain, resolver, encodeRoleCountCall(BigInt(nameResource)), (h) => uintAt(h, 0));

  // 4. Candidate authorities, every one of them discovered rather than supplied.
  //    (a) the address the name itself publishes — an operator that pays itself is the common case;
  //    (b) accounts named by EACRolesChanged events, when a log source was injected.
  const candidates = [];
  if (addrRecord) candidates.push({address: addrRecord, source: "ADDRESS_RECORD"});
  let logWindow = null;
  if (chain.getLogs) {
    try {
      const found = await chain.getLogs({address: resolver, topic0: EAC_ROLES_CHANGED_TOPIC});
      logWindow = found?.window ?? null;
      for (const l of found?.logs ?? []) {
        const acct = "0x" + hexBody(l.topics?.[2] ?? "").slice(24);
        if (/^0x[0-9a-f]{40}$/.test(acct) && !candidates.some((c) => c.address.toLowerCase() === acct)) {
          candidates.push({address: acct, source: "EAC_ROLES_CHANGED_LOG", block: l.blockNumber});
        }
      }
    } catch (e) {
      logWindow = {error: e?.message ?? String(e)};
    }
  }

  const authorities = [];
  for (const c of candidates) {
    const root = await probe(chain, resolver, encodeRolesCall(ROOT_RESOURCE, c.address), (h) => uintAt(h, 0));
    const perName = await probe(chain, resolver, encodeRolesCall(BigInt(nameResource), c.address), (h) => uintAt(h, 0));
    const rootBitmap = root.observation === PROBE.DECODED ? (root.value ?? 0n) : null;
    const nameBitmap = perName.observation === PROBE.DECODED ? (perName.value ?? 0n) : null;
    authorities.push({
      ...c,
      rootRoles: rootBitmap === null ? null : "0x" + rootBitmap.toString(16),
      rootRoleNames: rootBitmap === null ? null : roleName(rootBitmap),
      nameRoles: nameBitmap === null ? null : "0x" + nameBitmap.toString(16),
      nameRoleNames: nameBitmap === null ? null : roleName(nameBitmap),
      maySetAddr: rootBitmap === null && nameBitmap === null
        ? null
        : ((rootBitmap ?? 0n) & ROLE.SET_ADDR) === ROLE.SET_ADDR ||
          ((nameBitmap ?? 0n) & ROLE.SET_ADDR) === ROLE.SET_ADDR,
      probes: {rootRoles: root.observation, nameRoles: perName.observation},
    });
  }

  const authorized = authorities.filter((a) => a.maySetAddr === true);

  return {
    ...meta,
    ok: true,
    // READ means the authorization state was read. Whether anybody was found is a separate field:
    // "we looked and nobody holds SET_ADDR" and "we could not look" must not share a status.
    status: authorized.length ? AUTHZ_STATUS.READ : AUTHZ_STATUS.AUTHORITY_UNKNOWN,
    resolver,
    codeSize,
    implementation,
    addrRecord,
    mechanism: "ENSv2 Enhanced Access Control (role bitmap per resource)",
    rootResource: ZERO_WORD,
    nameResource,
    rootRoleCount: "0x" + (rootCount.value ?? 0n).toString(16),
    nameRoleCount: nameCount.observation === PROBE.DECODED ? "0x" + (nameCount.value ?? 0n).toString(16) : null,
    nameRoleCountObservation: nameCount.observation,
    candidates: authorities,
    authorized,
    logWindow,
  };
}

/// keccak of the EAC event, derived. Exported so a live check can prove the topic it filtered on.
export const EAC_ROLES_CHANGED_SIGNATURE = "EACRolesChanged(uint256,address,uint256,uint256)";
export const EAC_ROLES_CHANGED_TOPIC = toHex(keccak256(utf8(EAC_ROLES_CHANGED_SIGNATURE)));

// ── the interface ledger ──────────────────────────────────────────────────────────────────────
//
// One row per signature: the text, its derived selector, and how strongly the deployed contract
// has been observed to implement it. `permissioned-live.mjs` recomputes the selectors and re-runs
// the probes; this table is what it checks itself against, and it is deliberately conservative.
//
//   PUSH4_IN_RUNTIME       the selector appears as a PUSH4 dispatch constant in the deployed
//                          runtime — strong evidence the function exists, and nothing more
//   DECODED                a live eth_call returned a value that decoded
//   REVERT_NAMED_IT        a live refusal carried this error/role/resource, which is the strongest
//                          confirmation available without a wallet
//   DOCUMENTED_NOT_OBSERVED read from the documentation, present in the runtime, never exercised
export const OBSERVATION = {
  PUSH4_IN_RUNTIME: "PUSH4_IN_RUNTIME",
  DECODED: "DECODED",
  REVERT_NAMED_IT: "REVERT_NAMED_IT",
  DOCUMENTED_NOT_OBSERVED: "DOCUMENTED_NOT_OBSERVED",
};

export const INTERFACE = [
  {key: "roles", observed: OBSERVATION.DECODED},
  {key: "roleCount", observed: OBSERVATION.DECODED},
  {key: "hasRootRoles", observed: OBSERVATION.DECODED},
  {key: "hasAssignees", observed: OBSERVATION.DECODED},
  {key: "getAssigneeCount", observed: OBSERVATION.DECODED},
  {key: "hasRoles", observed: OBSERVATION.PUSH4_IN_RUNTIME},
  {key: "addr", observed: OBSERVATION.DECODED},
  {key: "getAlias", observed: OBSERVATION.DECODED},
  {key: "recordVersions", observed: OBSERVATION.DECODED},
  {key: "hasAddr", observed: OBSERVATION.DECODED},
  {key: "resolve", observed: OBSERVATION.DECODED},
  {key: "setAddr", observed: OBSERVATION.REVERT_NAMED_IT},
  {key: "setText", observed: OBSERVATION.REVERT_NAMED_IT},
  {key: "setContenthash", observed: OBSERVATION.REVERT_NAMED_IT},
  {key: "setAddrCoin", observed: OBSERVATION.REVERT_NAMED_IT},
  {key: "text", observed: OBSERVATION.PUSH4_IN_RUNTIME},
  {key: "addrCoin", observed: OBSERVATION.PUSH4_IN_RUNTIME},
  {key: "setAlias", observed: OBSERVATION.PUSH4_IN_RUNTIME},
  {key: "clearRecords", observed: OBSERVATION.PUSH4_IN_RUNTIME},
  {key: "authorizeNameRoles", observed: OBSERVATION.PUSH4_IN_RUNTIME},
  {key: "authorizeTextRoles", observed: OBSERVATION.PUSH4_IN_RUNTIME},
  {key: "authorizeAddrRoles", observed: OBSERVATION.PUSH4_IN_RUNTIME},
  {key: "grantRoles", observed: OBSERVATION.PUSH4_IN_RUNTIME},
  {key: "revokeRoles", observed: OBSERVATION.PUSH4_IN_RUNTIME},
  {key: "grantRootRoles", observed: OBSERVATION.PUSH4_IN_RUNTIME},
  {key: "revokeRootRoles", observed: OBSERVATION.PUSH4_IN_RUNTIME},
];

/// The resource shapes, with the same honesty applied. Only the name-level derivation has ever
/// been named back to us by the chain; the other two are derived from the documentation and are
/// unconfirmed, which is a materially weaker claim and is recorded as one.
export const RESOURCE_DERIVATIONS = [
  {part: "NAME_LEVEL", formula: "keccak256(node ‖ bytes32(0))", observed: OBSERVATION.REVERT_NAMED_IT},
  {part: "TEXT_KEY", formula: "keccak256(node ‖ keccak256(bytes(key)))", observed: OBSERVATION.DOCUMENTED_NOT_OBSERVED},
  {part: "COIN_TYPE", formula: "keccak256(node ‖ keccak256(abi.encode(coinType)))", observed: OBSERVATION.DOCUMENTED_NOT_OBSERVED},
];
