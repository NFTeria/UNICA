// The ENSv2 Sepolia deployment, pinned to what the chain said — not to what the documentation says.
//
// WHY THIS FILE EXISTS. Everything UNICA plans to do with ENSv2 — register a merchant name, grant an
// agent the narrowest possible record-edit authority, and later revoke it — depends on two numbers
// being exactly right: the RESOURCE a permission is scoped to, and the ROLE BITMAP that names the
// permission. Get either wrong and the planner emits a transaction that either does nothing or grants
// far more than it meant to. The published documentation and the deployed contracts do not agree about
// the first one, and that disagreement is not visible from reading either alone. So this file records
// what a live Sepolia read returned, labels each row with HOW it was observed, and refuses to launder
// a documented claim into an observed one.
//
// THE LABELS ARE THE POINT. Every fact carries an `observed` field:
//
//   REVERT_NAMED_IT          the deployed contract refused a simulated call and its own revert data
//                            carried this exact resource / role bitmap / account. This is the strongest
//                            evidence obtainable without a wallet, because the contract is quoting
//                            itself rather than answering a question we shaped.
//   DECODED                  a live eth_call returned a value that decoded to this.
//   ACCEPTED_IN_SIMULATION   a simulated write returned without reverting, from a `from` address whose
//                            authority was read first. An accepted setter returns `0x`, so this is only
//                            meaningful next to a refusal of the same shape — every ACCEPTED row below
//                            has a matching refusal recorded beside it.
//   PUSH4_IN_RUNTIME         the selector appears as a PUSH4 dispatch constant in the downloaded
//                            runtime. Proves the function exists. Proves nothing about what it does,
//                            and — see NOTE ON PUSH4 SCANNING — its ABSENCE proves nothing either.
//   DOCUMENTED_NOT_OBSERVED  read from ENS documentation, never confirmed against this deployment.
//
// NOTE ON PUSH4 SCANNING, because it bit this survey. `EACUnauthorizedAccountRoles` was observed in
// live revert data from BOTH the registry and the resolver, and its selector does NOT appear as a
// PUSH4 constant in either runtime — solc emits a revert selector as the top four bytes of a PUSH32
// word instead. A scan that treats "not found as PUSH4" as "not implemented" is therefore wrong in the
// direction that matters, so no row below is marked absent on the strength of a PUSH4 miss.
//
// PROVENANCE. Addresses were taken from https://docs.ens.domains/learn/deployments (ENS documentation
// is CC0-1.0) and then every one of them was read back from Sepolia — code size and runtime code hash —
// before being written here. Signatures came from
// https://docs.ens.domains/ensv2/permissioned-registry and
// https://docs.ens.domains/ensv2/enhanced-access-control, and every selector in this file is DERIVED
// from its signature string by `selectorFor`, never typed. No ENS implementation source is copied.
//
// Retrieved and read back 2026-09-09 at Sepolia block 11666085.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {utf8, wordBytes32, wordUint, concat} from "../permit2/digest.mjs";
import {selectorFor} from "./permissioned.mjs";

export const CHAIN_ID = 11155111;
export const CHAIN_NAME = "Ethereum Sepolia";
export const RETRIEVED = "2026-09-09";
export const PIN_BLOCK = 11666085;

export const SOURCES = {
  deployments: "https://docs.ens.domains/learn/deployments",
  permissionedRegistry: "https://docs.ens.domains/ensv2/permissioned-registry",
  permissionedResolver: "https://docs.ens.domains/ensv2/permissioned-resolver",
  enhancedAccessControl: "https://docs.ens.domains/ensv2/enhanced-access-control",
  universalResolver: "https://docs.ens.domains/ensv2/universal-resolver-v2",
};

export const OBSERVED = {
  REVERT_NAMED_IT: "REVERT_NAMED_IT",
  DECODED: "DECODED",
  ACCEPTED_IN_SIMULATION: "ACCEPTED_IN_SIMULATION",
  // A state-changing call actually EXECUTED against the deployed bytecode on a pinned fork of
  // Sepolia, and the state it wrote read back. Stronger than ACCEPTED_IN_SIMULATION, which only
  // says a call did not revert: this label means the write landed and was found again afterwards.
  // Weaker than a canonical-history observation, because the block is a local fork — so it is a
  // separate word rather than being folded into DECODED, and anything relying on it says so.
  FORK_EXECUTED: "FORK_EXECUTED",
  PUSH4_IN_RUNTIME: "PUSH4_IN_RUNTIME",
  DOCUMENTED_NOT_OBSERVED: "DOCUMENTED_NOT_OBSERVED",
};

/// The fork the delegation evidence was taken on. Recorded so anyone can reproduce it, and so a
/// FORK_EXECUTED row can never be mistaken for something read out of canonical history.
export const DELEGATION_FORK = Object.freeze({
  chainId: 11155111,
  forkBlock: 11666400,
  name: "raffy.eth",
  node: "0x9c8b7ac505c9f0161bbbd04437fce8c630a0886e1ffea00078e298f063a8a5df",  // namehash("raffy.eth")
  resolver: "0xc00E9189fe499b5F541932Ee57DA56B85Ac35eeE",
  method: "anvil fork, owner impersonated; every RPC was 127.0.0.1 and nothing was broadcast",
});

// ── the deployment ────────────────────────────────────────────────────────────────────────────
//
// `codeSize` and `codeHash` were read with eth_getCode and eth_getCodeHash at PIN_BLOCK. A live
// re-read that disagrees with either means ENS redeployed and every derivation below is suspect
// until someone re-runs the survey — which is exactly what `verifyProfile` is for.

export const DEPLOYMENT = [
  {
    name: "UpgradableUniversalResolverProxy",
    address: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
    codeSize: 2491,
    codeHash: "0xf7ead24f8e5e731683ed38f7cd5052db9e3e8150fb2b5bc76c1a1bb450af74c5",
    role: "the fixed resolution entry point — the only ENSv2 address UNICA hard-codes",
    observed: OBSERVED.DECODED,
  },
  {
    name: "UniversalResolverProxyMiddle",
    address: "0x6d80f2172cfdec5730fe683860c33d26fc42e6f1",
    codeSize: 2612,
    codeHash: "0xba6ae56546e53515a294152a398155a1094ef337abdb76bc541f2d78744b4b12",
    role: "a SECOND proxy between the entry point and the implementation; holds admin() and upgradeTo(address)",
    observed: OBSERVED.DECODED,
  },
  {
    name: "UniversalResolverV2",
    address: "0x4a1817d13e9cf196f471725176355c1234b63c70",
    codeSize: 18495,
    codeHash: "0x7b2c7040adacb3932de62c3a8d05f4e5c9361d6a3fae7dc3bdee815df44a3ca4",
    role: "the resolution implementation actually reached, two hops down from the entry point",
    observed: OBSERVED.DECODED,
  },
  {
    name: "RootRegistry",
    address: "0x8115186e8f2e0b0281e86ab91f0f48ba90364354",
    codeSize: 14730,
    codeHash: "0x99a6ba74173ac220fd9d7a2000a8142cf52d98c7a17ac6abc6d74fa17d8f086c",
    role: "the root PermissionedRegistry; getSubregistry('eth') returns ETHRegistry",
    observed: OBSERVED.DECODED,
  },
  {
    name: "ETHRegistry",
    address: "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2",
    codeSize: 14730,
    codeHash: "0x99a6ba74173ac220fd9d7a2000a8142cf52d98c7a17ac6abc6d74fa17d8f086c",
    // Not a copy-paste: RootRegistry and ETHRegistry are the SAME runtime deployed twice. One
    // PermissionedRegistry implementation, two instances, distinguished only by their state.
    role: "the .eth PermissionedRegistry — byte-identical runtime to RootRegistry",
    observed: OBSERVED.DECODED,
  },
  {
    name: "PermissionedResolverImpl",
    address: "0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e",
    codeSize: 17597,
    codeHash: "0x7a5bbb7f5a8e46232a4437e8eea6cc6e935266ade1b8b027e4e04fb9ca8efd47",
    role: "the shared implementation behind every per-name Permissioned Resolver proxy",
    observed: OBSERVED.DECODED,
  },
  {
    name: "ETHRegistrar",
    address: "0xa88553f454b77203b0d036a05c894d555eaaa2cc",
    codeSize: 7497,
    codeHash: "0x7ac653f817e6bef6543d25ce97235b232430b1771ab5bcb27b936798fe38af1f",
    role: "holds ROLE_REGISTRAR | ROLE_RENEW at ETHRegistry's ROOT_RESOURCE (observed 0x10001)",
    observed: OBSERVED.DECODED,
  },
  {
    name: "VerifiableFactory",
    address: "0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef",
    codeSize: 1411,
    codeHash: "0x810afc44bd6c35ac974ab80a8cf983cc6e514364b7a214b3a25df2d4e1e7ba60",
    role: "deploys the per-name resolver proxies",
    observed: OBSERVED.DECODED,
  },
  {
    name: "BatchRegistrar",
    address: "0x8b16d15f3e51074d0e06f3cf4a0053f7cb92a7fb",
    codeSize: 2211,
    codeHash: "0x0385d9b59e035bda9e9668a63700d8137f0890a60d3e708002260c3747f43d5e",
    role: "batch registration helper",
    observed: OBSERVED.DECODED,
  },
  {
    name: "ContractNamer",
    address: "0xa48eb920950d7f4963d1d87f15f195624fbfbd6a",
    codeSize: 855,
    codeHash: "0x0959a24babb02d4d6c6ef27aaec9c34e824a2c55d24b13a8b3dae8401138e1c4",
    role: "referenced by isContractNamer(address) on both registry and resolver",
    observed: OBSERVED.DECODED,
  },
  {
    name: "DefaultReverseRegistrarAdapter",
    address: "0x7a84e241f862d73960d73c26d68c3c8f89f0b18f",
    codeSize: 1982,
    codeHash: "0xba4d3b3cf3e048cce40f1c07cca02e906fbd39a527fdccb28d17f1638d79ac9a",
    role: "reverse resolution; UNICA does not use it",
    observed: OBSERVED.DECODED,
  },
  {
    name: "DNSV1MirrorRootBatchRegistrar",
    address: "0xdc5c31f7ea5e31efc6d5c68dd568f4c4a169804b",
    codeSize: 2211,
    codeHash: "0x3c7d6900fd40d62322b68992240d15a63b48c8493d02751807ea604e45de82fa",
    role: "DNS mirror registration; UNICA does not use it",
    observed: OBSERVED.DECODED,
  },
  {
    name: "ENSV1Resolver",
    address: "0xae66c62acae72098bdac57d8e8aed53ef000b2ba",
    codeSize: 10818,
    codeHash: "0xb7fd8ad888469eb5b7ddce51e3b13454ac8899b1dac131ad43efb2338d3f4b2f",
    role: "v1 compatibility resolver",
    observed: OBSERVED.DECODED,
  },
  {
    name: "ENSV2Resolver",
    address: "0x508cb4e4596429ca98a1bb3112d88d18f92456b5",
    codeSize: 11261,
    codeHash: "0x29549daef95803848cb34da0df69ad0d3697eeab8429fb0c73eebf99147a1905",
    role: "v2 resolver used by the mirror path",
    observed: OBSERVED.DECODED,
  },
];

export const byName = (n) => DEPLOYMENT.find((d) => d.name === n) ?? null;

// ── the entry point is THREE hops from the implementation, and each hop has an owner ──────────
//
// This matters to a payment product and is not visible from the documentation, which lists
// `UniversalResolverV2` as if it were the address behind the entry point. It is not: the fixed
// entry point delegates to a second proxy, and only that one delegates to the implementation. Each
// proxy exposes its own `admin()`, and an admin can point the whole of ENSv2 resolution at
// different code. UNICA cannot prevent that; it can refuse to pretend the trust assumption is one
// contract when it is three.

export const PROXY_CHAIN = [
  {
    from: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
    to: "0x6d80F2172CFdEc5730fE683860C33d26fC42e6F1",
    via: "implementation()",
    admin: "0x69420f05A11f617B4B74fFe2E04B2D300dFA556F",
    observed: OBSERVED.DECODED,
  },
  {
    from: "0x6d80f2172cfdec5730fe683860c33d26fc42e6f1",
    to: "0x4A1817d13E9cF196f471725176355C1234b63C70",
    via: "implementation() and the ERC-1967 implementation slot, which agree",
    admin: "0xffFffFFfFF52D316B7Bd028358089bc8066b8f80",
    observed: OBSERVED.DECODED,
  },
];

// ── ROOT_RESOURCE, asked of the contracts rather than assumed ─────────────────────────────────
//
// Both the registry and the resolver expose `ROOT_RESOURCE()` as a public constant and both
// returned 0. That is a decoded value, not an inference from the documentation.

export const ROOT_RESOURCE = 0n;
export const ROOT_RESOURCE_OBSERVED = OBSERVED.DECODED;

// ── the two resource derivations, which are NOT the same and NOT interchangeable ──────────────
//
// This is the finding the whole survey existed to settle, and the answer is that the Permissioned
// Registry and the Permissioned Resolver scope permissions to differently-shaped ids that are
// derived from different inputs. Handing one to the other silently addresses a resource nobody
// holds a role at, which reads as "this account has no authority" — safe-looking, and wrong.
//
// REGISTRY: the resource is the label's keccak with its LOW 32 BITS REPLACED by the name's
// `eacVersionId`. It is derived from the LABEL alone — the parent is not an input, because each
// registry instance is already the parent. Confirmed three ways:
//   · `getResource(tokenId)` returned it (DECODED)
//   · three separate refusals named it as the resource (REVERT_NAMED_IT)
//   · `register()` returned the same shape as a fresh token id: keccak256("unica-phase1-probe-4f7c")
//     is 0x4e88…c57f7_800ed76c and register returned 0x4e88…c57f7_00000000
//
// RESOLVER: the resource is keccak256(node ‖ bytes32(0)) — the NAME-LEVEL resource, derived from
// the namehash of the full name. Confirmed by five separate refusals, including the two setters the
// documentation leads you to expect a finer resource for.

export const REGISTRY_EAC_VERSION_BITS = 32n;

/// The registry's resource for a label, at a given eacVersionId (0 for a name never re-registered).
export function registryResource(label, eacVersionId = 0n) {
  const labelhash = BigInt(toHex(keccak256(utf8(String(label)))));
  const mask = (1n << 256n) - 1n - ((1n << REGISTRY_EAC_VERSION_BITS) - 1n);
  const v = BigInt(eacVersionId);
  if (v >= 1n << REGISTRY_EAC_VERSION_BITS) throw new Error("eacVersionId does not fit in 32 bits");
  return "0x" + ((labelhash & mask) | v).toString(16).padStart(64, "0");
}

/// The registry's canonical id: the same value with the version zeroed. Equal to the resource
/// whenever the version is 0, which is the case for every name observed in this survey.
export const registryCanonicalId = (label) => registryResource(label, 0n);

/// The resolver's resource for a name, from that name's namehash. Re-exported here so a caller
/// pins one derivation rather than importing two.
export const resolverNameResource = (node) =>
  toHex(keccak256(concat(wordBytes32(node), wordUint(0))));

/// The resolver's resource, generalised. ONE formula covers every scope this contract has:
///
///     resource = keccak256(abi.encode(node, scopeHash))
///
/// and the scope is entirely decided by `scopeHash`:
///
///     bytes32(0)                             the NAME-LEVEL resource — every record on the name
///     keccak256(bytes(key))                  ONE text key, or one data key
///     keccak256(abi.encode(uint256(coin)))   ONE addr coin type
///
/// `resolverNameResource` is this function at `scopeHash = 0`, and is kept as its own name because
/// that case is the dangerous one: it is the scope that carries everything.
///
/// This was established by executing the authorize* calls on a pinned fork and then finding the
/// granted bit at the resource this formula predicts — see `DELEGATION_MECHANISM` below. It is not
/// read off documentation, and the addr row is here because the obvious guess for it was WRONG:
/// the coin type is hashed as an ABI word, not used as one.
export const resolverScopedResource = (node, scopeHash) =>
  toHex(keccak256(concat(wordBytes32(node), wordBytes32(scopeHash))));

/// The scope hash for one text key (and, on this deployment, one data key: they share the rule).
export const textScopeHash = (key) => toHex(keccak256(utf8(key)));

/// The scope hash for one addr coin type. NOTE the extra hash: `bytes32(coinType)` is NOT the
/// scope, `keccak256(abi.encode(uint256(coinType)))` is. Getting this wrong lands the grant at a
/// resource nobody holds anything at, which reads as "the agent has no authority" — the
/// safe-looking answer and the wrong one. At coinType 0 the wrong formula additionally COLLIDES
/// with the name-level resource, which would silently widen a grant to the whole name; the correct
/// formula does not, and that was checked on the fork rather than reasoned about.
export const addrScopeHash = (coinType) => toHex(keccak256(wordUint(coinType)));

export const RESOURCE_DERIVATIONS = [
  {
    contract: "PermissionedRegistry",
    formula: "(keccak256(bytes(label)) & ~uint256(type(uint32).max)) | eacVersionId",
    inputs: "the LABEL only — never the namehash, never the parent",
    observed: OBSERVED.REVERT_NAMED_IT,
    evidence: "EACUnauthorizedAccountRoles named 0xcb0c…37b8_00000000 for label 'raffy'; getResource() returned the same word",
  },
  {
    contract: "PermissionedResolver",
    formula: "keccak256(abi.encode(node, bytes32(0)))",
    inputs: "the NAMEHASH of the full name",
    observed: OBSERVED.REVERT_NAMED_IT,
    evidence: "five setters on raffy.eth's resolver all named 0x0bfd…5e61",
  },
  {
    contract: "PermissionedResolver",
    formula: "keccak256(abi.encode(node, keccak256(bytes(key))))",
    inputs: "namehash and text key",
    observed: OBSERVED.FORK_EXECUTED,
    // CORRECTED IN PLACE. This row previously read DOCUMENTED_NOT_OBSERVED, with the note "setText
    // and authorizeTextRoles BOTH named the name-level resource instead. Nothing observed on this
    // deployment has ever named a per-key resource." That was drawn from refusals only — a refusal
    // of setText names the resource the CALLER lacked, which is the name-level one, and says
    // nothing about where an authorization writes. Executing the authorization settles it.
    evidence:
      "authorizeTextRoles(dns('raffy.eth'), 'unica.treasury.status', agent, true) executed on the fork; " +
      "roles(keccak256(abi.encode(node, keccak256('unica.treasury.status'))), agent) went 0 -> 0x10 (SET_TEXT), " +
      "while roles(nameResource, agent) stayed 0 and a second key's resource stayed 0. Reproduced on a third key.",
  },
  {
    contract: "PermissionedResolver",
    formula: "keccak256(abi.encode(node, keccak256(abi.encode(coinType))))",
    inputs: "namehash and coin type",
    observed: OBSERVED.FORK_EXECUTED,
    // CORRECTED IN PLACE, and the correction cost a wrong guess first: the obvious derivation
    // keccak256(abi.encode(node, bytes32(coinType))) was tried, found the grant NOWHERE, and was
    // refuted by the functional test — the agent could setAddr afterwards, so the grant had landed
    // somewhere the guess did not predict. The extra keccak is the difference.
    evidence:
      "authorizeAddrRoles(dns('raffy.eth'), 60, agent, true) executed on the fork; " +
      "roles(keccak256(abi.encode(node, keccak256(abi.encode(uint256(60))))), agent) = 0x1 (SET_ADDR), " +
      "and the agent's subsequent setAddr(node, 60, 0x..dEaD) was accepted and read back",
  },
];

// ── how a delegation is actually made on this deployment ──────────────────────────────────────
//
// The single most expensive thing this survey got wrong before, and the reason this block exists
// in the machine-readable profile rather than only in prose: the delegation call is NOT
// `grantRoles`. This deployment REFUSES `grantRoles` for the shape a delegation needs, and the
// refusal is not a permission problem that a better-authorised caller could avoid — the name owner
// itself, holding every role at ROOT_RESOURCE, is refused.
//
// Each row below was executed against the deployed bytecode on the fork named in
// `DELEGATION_FORK`, and each REFUSED row has an ACCEPTED control beside it so the refusal cannot
// be explained away as "that account could not do anything".

export const DELEGATION_MECHANISM = Object.freeze({
  call: "authorizeTextRoles(bytes dnsName, string key, address account, bool granted)",
  selector: "0xf2d1eb25",
  grants: "RESOLVER_ROLE.SET_TEXT at the per-key resource, and nothing else",
  requires: "adminRole(SET_TEXT) — the REGULAR SET_TEXT bit is not enough, and that was checked both ways",
  observed: OBSERVED.FORK_EXECUTED,
  rows: [
    {call: "grantRoles(nameResource, SET_TEXT, agent) from the NAME OWNER",
     result: "REFUSED — EACCannotGrantRoles(0x0bfd…5e61, 0x10, 0x…a6e17)", accepted: false,
     note: "the revert data names the resource, the bitmap and the account, so the contract is quoting itself"},
    {call: "authorizeTextRoles(dns, 'unica.treasury.status', agent, true) from the NAME OWNER",
     result: "ACCEPTED, gasUsed 89316", accepted: true},
    {call: "setText(node, 'unica.treasury.status', 'unica-ok') from the AGENT",
     result: "ACCEPTED, and the value read back", accepted: true, note: "the control that proves the agent is not simply powerless"},
    {call: "setText(node, 'unica.treasury.other', …) from the AGENT",
     result: "REFUSED — EACUnauthorizedAccountRoles 0x4b27a133, and the key read back empty", accepted: false,
     note: "THE per-key scoping result: one authorized key does not carry another"},
    {call: "authorizeTextRoles(dns, key, agent, false) from the NAME OWNER",
     result: "ACCEPTED, gasUsed 41658; the agent's next setText on that key was refused", accepted: true},
    {call: "authorizeTextRoles(…) from a holder of the REGULAR SET_TEXT bit at ROOT",
     result: "REFUSED — EACCannotGrantRoles", accepted: false,
     note: "control: the same account's own setText WAS accepted, so it is the admin bit that is missing, not authority in general"},
    {call: "authorizeTextRoles(…) from a holder of adminRole(SET_TEXT) at ROOT",
     result: "ACCEPTED, and its revocation was accepted too", accepted: true},
    {call: "authorizeTextRoles(dns, <another key>, agent, true) from the AGENT ITSELF",
     result: "REFUSED — EACCannotGrantRoles", accepted: false,
     note: "the agent cannot use the very mechanism that empowered it to broaden itself"},
  ],
});

/// What a delegation costs, measured on the fork rather than estimated. Gas moves with the LENGTH
/// of the text key, because the key travels as calldata, so a single number would be a lie for any
/// key but the one it was measured on — the spread is published instead of an average.
export const DELEGATION_GAS = Object.freeze({
  observed: OBSERVED.FORK_EXECUTED,
  basis: "raffy.eth on the pinned fork; a cold per-key slot for the grant, an existing one for the rest",
  authorizeTextRoles_new_21charKey: 89316,
  authorizeTextRoles_new_53charKey: 90123,
  authorizeTextRoles_already_granted: 42748,
  authorizeTextRoles_revoke: 41658,
  authorizeAddrRoles_new: 87313,
  // The two that matter most, because they were measured by executing the calldata THIS
  // REPOSITORY's own encoder produced — not a hand-written cast invocation of the same function.
  // The encoder was also compared byte-for-byte against `cast calldata` first, and a one-byte
  // corruption of the offset word was REJECTED by the contract, so the acceptance is evidence
  // rather than a call that happened not to revert.
  repoEncodedGrant_key_unica_capabilities: 89280,
  repoEncodedRevoke_key_unica_capabilities: 41622,
  note:
    "An earlier internal estimate of 45181 for the grant and 53965 for the revocation is REFUTED by " +
    "these measurements and is not used anywhere. The grant is roughly twice the estimate because it " +
    "writes a cold role word and a cold assignee-count word; the revocation is cheaper than the " +
    "estimate because clearing them earns a refund.",
});

// ── role constants ────────────────────────────────────────────────────────────────────────────
//
// Roles are one NYBBLE apart, not one bit, because the parallel `_roleCount` word stores a 0–15
// assignee counter in the same nybble position. The admin of a role sits 128 bits above it. Both
// facts are confirmed below rather than taken on trust.

export const ADMIN_SHIFT = 128n;
export const adminRole = (role) => BigInt(role) << ADMIN_SHIFT;

/// Registry roles. Every CONFIRMED row was named back to us inside revert data from
/// 0xbdc8…f0e2, which is the contract quoting its own constant.
export const REGISTRY_ROLE = {
  REGISTRAR: {bit: 1n << 0n, observed: OBSERVED.REVERT_NAMED_IT,
    evidence: "register() from an unauthorised caller: EACUnauthorizedAccountRoles(ROOT_RESOURCE, 0x1, caller)"},
  REGISTER_RESERVED: {bit: 1n << 4n, observed: OBSERVED.DOCUMENTED_NOT_OBSERVED, evidence: null},
  SET_PARENT: {bit: 1n << 8n, observed: OBSERVED.DOCUMENTED_NOT_OBSERVED, evidence: null},
  UNREGISTER: {bit: 1n << 12n, observed: OBSERVED.DOCUMENTED_NOT_OBSERVED, evidence: null},
  RENEW: {bit: 1n << 16n, observed: OBSERVED.REVERT_NAMED_IT,
    evidence: "renew() refusal named 0x10000; ETHRegistrar's root bitmap 0x10001 carries the same bit"},
  SET_SUBREGISTRY: {bit: 1n << 20n, observed: OBSERVED.REVERT_NAMED_IT,
    evidence: "setSubregistry() refusal named 0x100000"},
  SET_RESOLVER: {bit: 1n << 24n, observed: OBSERVED.REVERT_NAMED_IT,
    evidence: "setResolver() refusal named 0x1000000"},
  SET_URI: {bit: 1n << 36n, observed: OBSERVED.DOCUMENTED_NOT_OBSERVED, evidence: null},
  UPGRADE: {bit: 1n << 124n, observed: OBSERVED.DOCUMENTED_NOT_OBSERVED, evidence: null},
};

/// The documentation gives this one already shifted, as `(1 << 28) << 128`. It is recorded here in
/// the shifted form the chain uses, because the name owner of raffy.eth holds exactly that bit and
/// does NOT hold the unshifted 1<<28 — so writing it unshifted would be a different permission.
export const REGISTRY_ROLE_CAN_TRANSFER_ADMIN = {
  bit: adminRole(1n << 28n),
  observed: OBSERVED.DECODED,
  evidence: "roles(nameResource, owner) on ETHRegistry returned bit 156 set and bit 28 clear",
};

/// A bit the chain shows in use that the documentation table does not name. It is recorded as
/// unnamed rather than guessed at, because a wrong name here becomes a wrong grant later.
export const REGISTRY_ROLE_UNNAMED_BIT_32 = {
  bit: 1n << 32n,
  observed: OBSERVED.DECODED,
  evidence: "held by raffy.eth's owner at its name resource; absent from the documented role table",
};

/// Resolver roles. Four of these were named back by refusals from a live per-name resolver proxy.
export const RESOLVER_ROLE = {
  SET_ADDR: {bit: 1n << 0n, observed: OBSERVED.REVERT_NAMED_IT,
    evidence: "setAddr(bytes32,address) AND setAddr(bytes32,uint256,bytes) both named 0x1"},
  SET_TEXT: {bit: 1n << 4n, observed: OBSERVED.REVERT_NAMED_IT, evidence: "setText() named 0x10"},
  SET_CONTENTHASH: {bit: 1n << 8n, observed: OBSERVED.REVERT_NAMED_IT,
    evidence: "setContenthash() named 0x100"},
  SET_PUBKEY: {bit: 1n << 12n, observed: OBSERVED.DOCUMENTED_NOT_OBSERVED, evidence: null},
  SET_ABI: {bit: 1n << 16n, observed: OBSERVED.DOCUMENTED_NOT_OBSERVED, evidence: null},
  SET_INTERFACE: {bit: 1n << 20n, observed: OBSERVED.DOCUMENTED_NOT_OBSERVED, evidence: null},
  SET_NAME: {bit: 1n << 24n, observed: OBSERVED.DOCUMENTED_NOT_OBSERVED, evidence: null},
  SET_ALIAS: {bit: 1n << 28n, observed: OBSERVED.DOCUMENTED_NOT_OBSERVED, evidence: null},
  CLEAR: {bit: 1n << 32n, observed: OBSERVED.REVERT_NAMED_IT,
    evidence: "clearRecords() named 0x100000000"},
  SET_DATA: {bit: 1n << 36n, observed: OBSERVED.FORK_EXECUTED,
    evidence: "authorizeDataRoles(dns,'unica.blob',agent,true) on the fork left roles(perKeyResource,agent) = 0x1000000000 = 1<<36"},
  UPGRADE: {bit: 1n << 124n, observed: OBSERVED.DOCUMENTED_NOT_OBSERVED, evidence: null},
};

// ── the assignee limit, which the contract will tell you itself ───────────────────────────────
//
// `getAssigneeCount(uint256 resource, uint256 roleBitmap)` returns TWO uint256 words, and an earlier
// pass in this repository printed the second one without interpreting it. It is the per-role
// MAXIMUM, packed in the same nybble positions as the bitmap that was asked about — so the deployed
// contract states its own cap and there is no need to hard-code 15 anywhere.
//
// Demonstrated by moving the question and watching BOTH words move with it:
//   (ROOT, 1<<0)          -> counts 0x…02              max 0x…0f          nybble 0
//   (ROOT, 1<<4)          -> counts 0x…20              max 0x…f0          nybble 1
//   (ROOT, 1<<0 | 1<<24)  -> counts 0x…01              max 0x…0f00000f    nybbles 0 and 6
// A right-aligned scalar could not have produced the second and third rows.

export const MAX_ASSIGNEES_PER_ROLE = 15n;
export const MAX_ASSIGNEES_OBSERVED = OBSERVED.DECODED;
export const MAX_ASSIGNEES_SOURCE = "the second return word of getAssigneeCount(resource, roleBitmap)";

/// Unpack either return word of getAssigneeCount into per-nybble counts for the roles asked about.
export function unpackAssigneeWord(word, roleBitmap) {
  const w = BigInt(word), b = BigInt(roleBitmap), out = [];
  for (let n = 0n; n < 64n; n++) {
    if (((b >> (4n * n)) & 0xfn) === 0n) continue;
    out.push({nybble: Number(n), bit: Number(4n * n), count: Number((w >> (4n * n)) & 0xfn)});
  }
  return out;
}

// ── the admin-role rule, which decides whether the whole architecture is possible ─────────────
//
// The Permissioned Registry restricts WHICH roles a holder may grant. Regular roles can be granted
// after registration by whoever holds the matching admin role. Admin roles CANNOT be granted after
// registration by anybody, because granting an admin role would require the admin OF an admin role
// and no such bit exists in a 256-bit map. The only place an admin role can be established is the
// `roleBitmap` argument of `register()`.
//
// For UNICA this is load-bearing: if a merchant name is registered without the admin bits, the
// merchant can never afterwards delegate to an agent and never afterwards revoke one — and there is
// no repair, because re-registering means losing the name. The observation is therefore recorded
// with its passing control beside its failing row, and neither is reported without the other.

export const ADMIN_ROLE_RULE = {
  statement:
    "Admin roles on an individual name are settable ONLY in the roleBitmap argument of register(). " +
    "After registration the holder of an admin role may grant the matching REGULAR role and nothing more.",
  rows: [
    {
      label: "CONTROL — the name owner grants a REGULAR role after registration",
      call: "grantRoles(nameResource, 1<<24, grantee) from raffy.eth's owner",
      result: "ACCEPTED, returned true",
      observed: OBSERVED.ACCEPTED_IN_SIMULATION,
    },
    {
      label: "ROW — the same owner grants the ADMIN role after registration",
      call: "grantRoles(nameResource, (1<<24)<<128, grantee) from raffy.eth's owner",
      result: "REFUSED: EACCannotGrantRoles(nameResource, 0x…01<<152, owner)",
      observed: OBSERVED.REVERT_NAMED_IT,
    },
    {
      label: "CONTROL — an unauthorised account attempts the accepted call",
      call: "grantRoles(nameResource, 1<<24, grantee) from the unauthorized probe address",
      result: "REFUSED: EACCannotGrantRoles(nameResource, 0x1000000, probe)",
      observed: OBSERVED.REVERT_NAMED_IT,
    },
    {
      label: "ROW — registration WITH an admin bit in the roleBitmap",
      call: "register('unica-phase1-probe-4f7c', owner, 0, 0, (1<<24)|((1<<24)<<128), expiry) from ETHRegistrar",
      result: "ACCEPTED, returned the new token id 0x4e88…c57f7_00000000",
      observed: OBSERVED.ACCEPTED_IN_SIMULATION,
    },
    {
      label: "CONTROL — the same registration from an account without ROLE_REGISTRAR",
      call: "the identical register() from the unauthorized probe address",
      result: "REFUSED: EACUnauthorizedAccountRoles(ROOT_RESOURCE, 0x1, probe)",
      observed: OBSERVED.REVERT_NAMED_IT,
    },
    {
      label: "CONTROL — registering a label that is already taken",
      call: "register('raffy', …) from ETHRegistrar",
      result: "REFUSED: LabelAlreadyRegistered('raffy')",
      observed: OBSERVED.REVERT_NAMED_IT,
    },
  ],
};

// ── roles() and hasRoles() do not answer the same question ────────────────────────────────────
//
// The single most dangerous read in this interface. On raffy.eth's resolver:
//
//   roles(nameResource, owner)              -> 0
//   roleCount(nameResource)                 -> 0
//   hasRoles(nameResource, 1<<0, owner)     -> TRUE
//
// Nobody holds anything AT the name resource, and the owner may still write every record, because
// authority granted at ROOT_RESOURCE applies to every resource on that contract and `hasRoles`
// folds it in while `roles` does not. An integration that reads `roles(nameResource, account)` and
// finds zero concludes "this account cannot edit the merchant's records". That conclusion is false
// and it fails in the unsafe direction. `hasRoles` — or `roles` at BOTH the name resource and
// ROOT_RESOURCE — is the only honest read.

export const AUTHORITY_READ_RULE = {
  authoritative: "hasRoles(resource, roleBitmap, account)",
  insufficient: "roles(resource, account)",
  why: "roles() reports the bitmap stored at that resource only; ROOT_RESOURCE grants apply everywhere and do not appear in it",
  observed: OBSERVED.DECODED,
  evidence: "raffy.eth resolver: roles(nameResource,owner)=0, roleCount(nameResource)=0, hasRoles(nameResource,1<<0,owner)=true, roles(ROOT,owner)=0x1111…1111",
};

// ── wildcard resolution ───────────────────────────────────────────────────────────────────────
//
// Confirmed again at PIN_BLOCK, because the architecture depends on it: the agent's name lives
// three labels under a parent the merchant controls, and it must resolve before anybody registers
// it. It does — and it resolves to the ZERO ADDRESS without reverting, which is the failure shape
// that looks like a success.

export const WILDCARD = {
  supported: true,
  observed: OBSERVED.DECODED,
  rows: [
    {name: "raffy.eth", result: "resolver 0xc00E9189…, addr 0x51050ec0…", meaning: "registered, has an address record"},
    {name: "definitely-not-registered-9c4f.raffy.eth", result: "resolver 0xc00E9189…, addr 0x0",
      meaning: "UNREGISTERED and it still RESOLVED — the parent's resolver answered with zero, no revert"},
    {name: "definitely-not-registered-9c4f.eth", result: "revert ResolverNotFound(bytes)",
      meaning: "no resolver anywhere up the chain — the only one of the three that reverts"},
  ],
  rule: "A successful resolve is not evidence that a name is registered. Only a non-zero address is evidence of anything.",
};

// ── errors, every selector derived from its signature ─────────────────────────────────────────
//
// Each of these was seen in live revert data from this deployment and then re-derived here. The
// name is only trustworthy because the derivation reproduces the observed four bytes; a name
// looked up in a signature directory and not re-derived would be a guess wearing a label.

export const ERROR_SIGNATURES = {
  EACUnauthorizedAccountRoles: "EACUnauthorizedAccountRoles(uint256,uint256,address)",
  EACCannotGrantRoles: "EACCannotGrantRoles(uint256,uint256,address)",
  LabelAlreadyRegistered: "LabelAlreadyRegistered(string)",
  ResolverNotFound: "ResolverNotFound(bytes)",
};

export const ERROR_SELECTOR = Object.fromEntries(
  Object.entries(ERROR_SIGNATURES).map(([k, sig]) => [k, selectorFor(sig)]),
);

/// The four bytes actually observed on the wire, kept separately so the derivation above can be
/// checked against them instead of being trusted.
export const ERROR_SELECTOR_OBSERVED = {
  EACUnauthorizedAccountRoles: "0x4b27a133",
  EACCannotGrantRoles: "0xd1a3b355",
  LabelAlreadyRegistered: "0xdef545a4",
  ResolverNotFound: "0x77209fe8",
};

// ── the registry interface, as the runtime dispatches it ──────────────────────────────────────

export const REGISTRY_SIGNATURES = {
  register: "register(string,address,address,address,uint256,uint64)",
  setResolver: "setResolver(uint256,address)",
  setSubregistry: "setSubregistry(uint256,address)",
  renew: "renew(uint256,uint64)",
  unregister: "unregister(uint256)",
  getResolver: "getResolver(string)",
  getSubregistry: "getSubregistry(string)",
  getResource: "getResource(uint256)",
  getTokenId: "getTokenId(uint256)",
  getExpiry: "getExpiry(uint256)",
  getState: "getState(uint256)",
  getStatus: "getStatus(uint256)",
  getParent: "getParent()",
  findTokenId: "findTokenId(string)",
  findOwner: "findOwner(string)",
  findExpiry: "findExpiry(string)",
  ownerOf: "ownerOf(uint256)",
  latestOwnerOf: "latestOwnerOf(uint256)",
  rootResource: "ROOT_RESOURCE()",
};

export const REGISTRY_SELECTOR = Object.fromEntries(
  Object.entries(REGISTRY_SIGNATURES).map(([k, sig]) => [k, selectorFor(sig)]),
);

/// Resolver functions this survey found in the runtime that the existing module does not list.
/// Named here so a later planner does not rediscover them, and marked for what they are: present,
/// and not exercised.
export const RESOLVER_EXTRA_SIGNATURES = {
  multicallWithNodeCheck: "multicallWithNodeCheck(bytes32,bytes[])",
  authorizeDataRoles: "authorizeDataRoles(bytes,string,address,bool)",
  setData: "setData(bytes32,string,bytes)",
  data: "data(bytes32,string)",
  supportsFeature: "supportsFeature(bytes4)",
  canUpgradeFrom: "canUpgradeFrom(address)",
  rootResource: "ROOT_RESOURCE()",
};

export const RESOLVER_EXTRA_SELECTOR = Object.fromEntries(
  Object.entries(RESOLVER_EXTRA_SIGNATURES).map(([k, sig]) => [k, selectorFor(sig)]),
);

// ── the sample the survey was taken against ───────────────────────────────────────────────────
//
// Kept so every claim above can be reproduced. It is a third-party name on a testnet, used only as
// a read target: nothing in this repository writes to it and nothing depends on it continuing to
// exist. If it stops existing, the live checker says so rather than quietly passing.

export const EVIDENCE_SAMPLE = {
  name: "raffy.eth",
  label: "raffy",
  namehash: "0x9c8b7ac505c9f0161bbbd04437fce8c630a0886e1ffea00078e298f063a8a5df",
  registryResource: "0xcb0cbc8493baf4a7b1972914ba0be89040e56e4a3c98d60268fe37b800000000",
  resolverNameResource: "0x0bfdc7d18a681d5f09834ebfaa1611fe18af3c4a6f4f1a276c3a0734c4885e61",
  owner: "0x51050ec063d393217B436747617aD1C2285Aeeee",
  resolverProxy: "0xc00E9189fe499b5F541932Ee57DA56B85Ac35eeE",
  resolverProxyCodeSize: 77,
  resolverProxyCodeHash: "0x5219fb365f34c13998f30c716ab43bff12db97d46eedfbd9d0b3f8627aefd7c7",
  ownerRolesAtRegistryNameResource: "0x1110000000000000000000000000000101100000",
  ownerRolesAtResolverRoot: "0x1111111111111111111111111111111111111111111111111111111111111111",  // bytes32 word returned by eth_call, recorded verbatim
  resolverRootRoleCount: "0x2222222222222222222222222222222222222222222222222222222222222222",  // bytes32 word returned by eth_call, recorded verbatim
};

// ── what this survey could NOT establish ──────────────────────────────────────────────────────
//
// Carried in the module, not only in the prose, so anything that consumes the profile can see the
// holes. An empty list here would be the suspicious result.

export const UNRESOLVED = [
  {
    question: "Which second account holds every role at ROOT_RESOURCE on a per-name resolver proxy?",
    why: "roleCount(ROOT) on raffy.eth's resolver is 0x2222…22 — two assignees on all 64 roles. The owner is one. " +
         "roles(ROOT, x) returned 0 for VerifiableFactory, ETHRegistrar, ETHRegistry and BatchRegistrar, and the " +
         "eth_getLogs scan for EACRolesChanged returned a truncated body from the endpoint. The second full-authority " +
         "account on a merchant's own resolver is unidentified, and that is a live question for a payment product.",
    observed: OBSERVED.DOCUMENTED_NOT_OBSERVED,
  },
  {
    question: "What error is raised when a 16th account is granted the same role on the same resource?",
    why: "The cap of 15 is confirmed (getAssigneeCount's second word). Reaching it requires 15 real grants, which " +
         "requires broadcasting, which this work does not do. No candidate error selector appears in either runtime's " +
         "PUSH4 constants, and PUSH4 absence is not evidence — EACUnauthorizedAccountRoles is absent there too and is " +
         "demonstrably implemented. The documentation names no error either.",
    observed: OBSERVED.DOCUMENTED_NOT_OBSERVED,
  },
  {
    question: "Do getResource(tokenId) and getTokenId(tokenId) diverge once eacVersionId is non-zero?",
    why: "Every name reached in this survey has eacVersionId 0, where the two coincide. The divergence is implied by " +
         "the layout and by the existence of two separate accessors, and was not observed.",
    observed: OBSERVED.DOCUMENTED_NOT_OBSERVED,
  },
  {
    question: "Does the resolver ever consult a per-text-key or per-coin-type resource?",
    why: "Five setters and three authorize* functions all named the name-level resource. The finer derivations are " +
         "documented and no observed call has ever named one. They may exist on a path this survey did not reach.",
    observed: OBSERVED.DOCUMENTED_NOT_OBSERVED,
  },
];

// ── verification ──────────────────────────────────────────────────────────────────────────────

/// Re-read the pinned deployment and report one row per claim. Read-only; `chain` is injected the
/// same way `readAuthorization` takes it, so this module opens no socket and holds no endpoint.
///
/// Returns rows of {name, ok, expected, actual, transport}. It deliberately does not throw: a
/// caller that wants to fail on a mismatch should count the rows, because a thrown error hides the
/// rows after the first one and the interesting case is which SET of pins moved.
///
/// `transport: true` marks a row where the ENDPOINT failed, not the contract. The two must not be
/// counted together. A rate-limited node dropping a response body is not evidence that a code hash
/// changed, and reporting it as one produces a red run that says nothing — which is the fastest way
/// to teach a reader to ignore this runner. Callers report a transport row as a SKIP.
export async function verifyProfile(chain) {
  const rows = [];
  const push = (name, ok, expected, actual, transport = false) =>
    rows.push({name, ok, expected, actual, transport});

  const observedChain = Number(await chain.chainId());
  push("chain id", observedChain === CHAIN_ID, CHAIN_ID, observedChain);
  if (observedChain !== CHAIN_ID) return rows;   // fail closed: nothing below means anything

  for (const d of DEPLOYMENT) {
    let code;
    try { code = await chain.getCode(d.address); } catch (e) {
      push(`${d.name} code`, false, `${d.codeSize} bytes`, `read failed: ${e?.message ?? e}`, true);
      continue;
    }
    const size = (String(code).replace(/^0x/, "").length) / 2;
    push(`${d.name} code size`, size === d.codeSize, d.codeSize, size);
    const hash = toHex(keccak256(Uint8Array.from(
      (String(code).replace(/^0x/, "").match(/../g) ?? []).map((h) => parseInt(h, 16)),
    )));
    push(`${d.name} runtime code hash`, hash === d.codeHash, d.codeHash, hash);
  }
  return rows;
}

// ANSWERED 2026-09-12 (test/fork/EnsV2AuthorityFork.t.sol, pinned fork block 11685000, live bytecode of
// unica.eth's own resolver 0x3D2d26801632e7b13B2fa75236a634e75684988c): the resolver DOES consult a per-text-key
// resource. authorizeTextRoles(dns("unica.eth"), "com.unica.terminal-status", account, true) from the recorded
// owner set SET_TEXT (bit 4) at keccak256(abi.encode(node, keccak256(key))) and nowhere else; the name-level and
// ROOT resources stayed zero, a second key stayed clear, revocation cleared it, a stranger was refused
// (EACCannotGrantRoles). The UNRESOLVED question above is closed by that suite; the entry is kept as history.
