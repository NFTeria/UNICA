// The ENSv2 delegation plan — the ordered set of transactions that gives a merchant an identity
// and an agent the narrowest authority under it, and nothing that could sign one of them.
//
//   node script/ensv2/plan.mjs --parent <name.eth> [--mode subtree|subregistry] [--json]
//   node script/ensv2/plan.mjs --demo            # every input filled with obvious placeholders
//
// WHAT THIS IS FOR. UNICA owns no ENSv2 name. Everything below is therefore parameterised on a
// PARENT the owner chooses and controls; nothing in this file names one, and the plan's first
// output is the list of owner actions that must happen before any of it can run. A planner that
// hard-codes a parent produces a plan for somebody else's namespace.
//
// WHY IT IS OFFLINE. Every name this plan touches is one that does not exist yet, so `eth_estimateGas`
// against it would fail on every row, and a runner that reported those failures as "no estimate" would
// be indistinguishable from one that could not reach the network. Gas estimates are therefore an INPUT:
// they are gathered once the parent exists, handed in, and until then every transaction row says
// NOT_ESTIMATED and the plan is not signable. That is the honest state of the world for a namespace
// nobody has registered.
//
// THE ORDER IS A SAFETY PROPERTY, NOT A CONVENIENCE. Each step names what it depends on, and the
// preview checks the dependency graph rather than trusting it. Granting the agent a role before the
// resolver is attached delegates authority over a name that resolves to nothing; writing the
// merchant's payout record after the delegation exists means the delegation was live over a name
// whose configuration was still moving.
//
// THE ONE-SHOT STEP. Phase 1 established, with a passing control beside the failing row, that admin
// roles on an individual name can ONLY be set in the `roleBitmap` argument of `register()`. There is
// no repair: a merchant name registered without them can never afterwards delegate or revoke, and
// re-registering means losing the name. Step 2 is therefore marked irreversible, it prints the
// documented-but-unobserved bits it is deliberately NOT setting, and the preview refuses to call a
// plan signable if an admin bit shows up anywhere except there.
//
// NOTHING SECRET GOES ON CHAIN. The treasury's policy is published as a COMMITMENT — a keccak over a
// canonical encoding of the values and a salt — and `roles.mjs` computes it without this file ever
// carrying the values further. The suite feeds real threshold, allocation, reserve and salt values in
// and then scans the whole serialised plan for each of them, in decimal and in hex.

import {readFileSync} from "node:fs";
import {resolve as pathResolve} from "node:path";
import {fileURLToPath} from "node:url";

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {utf8, wordAddress, wordUint} from "../../integrations/permit2/digest.mjs";
import {namehash, normalizeName, dnsEncode} from "../../web/ensv2/resolve.mjs";
import {
  SELECTOR, SIGNATURES, encodeSetAddrCall, encodeSetTextCall,
  EAC_ROLES_CHANGED_SIGNATURE, EAC_ROLES_CHANGED_TOPIC,
} from "../../integrations/ensv2/permissioned.mjs";
import {
  AGENT_DEFAULT_ROLES, DENIAL_MATRIX, RECORD_KEYS, ROLE_TABLE,
  agentRoleBitmap, commitPolicy, planAgentGrant, planAgentRevoke, screenPlanForAgentAuthority,
} from "../../integrations/ensv2/roles.mjs";
import {previewPlan, renderPlanPreview, planPreviewIsSignable, REVOKING_METHODS} from "../../integrations/ensv2/plan-preview.mjs";
import * as P from "../../integrations/ensv2/profile.mjs";

const hexBody = (h) => String(h ?? "").replace(/^0x/, "").toLowerCase();
const w = (bytes) => hexBody(toHex(bytes));
const isAddress = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
const lower = (v) => String(v ?? "").toLowerCase();
const asWord = (v) => "0x" + BigInt(v).toString(16).padStart(64, "0");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ── registry calldata, written out for exactly the shapes below ───────────────────────────────
//
// Not generalised, for the reason `permissioned.mjs` gives about its own encoders: a general encoder
// that silently mishandles a type it was never taught produces calldata that decodes to something
// else, and calldata that decodes to something else is a transaction the owner reviewed and did not
// sign. Selectors come from `profile.REGISTRY_SELECTOR`, which derives each one from its signature.

const tailString = (s) => {
  const b = w(utf8(String(s)));
  return w(wordUint(b.length / 2)) + b.padEnd(Math.ceil(b.length / 64) * 64, "0");
};

/// register(string label, address owner, address subregistry, address resolver, uint256 roleBitmap, uint64 expiry)
export const encodeRegisterCall = (label, owner, subregistry, resolver, roleBitmap, expiry) =>
  P.REGISTRY_SELECTOR.register +
  w(wordUint(6 * 32)) +                       // head offset to the string tail: six head words
  w(wordAddress(owner)) + w(wordAddress(subregistry)) + w(wordAddress(resolver)) +
  w(wordUint(roleBitmap)) + w(wordUint(expiry)) +
  tailString(label);

export const encodeSetResolverCall = (tokenId, resolver) =>
  P.REGISTRY_SELECTOR.setResolver + w(wordUint(tokenId)) + w(wordAddress(resolver));

export const encodeSetSubregistryCall = (tokenId, subregistry) =>
  P.REGISTRY_SELECTOR.setSubregistry + w(wordUint(tokenId)) + w(wordAddress(subregistry));

/// multicallWithNodeCheck(bytes32 node, bytes[] calls) — the resolver's own batching entry point.
///
/// It is used only where a batch is explicitly asked for, and never for a role change. The node
/// argument is why it is the right primitive rather than a plain multicall: the batch names the one
/// node every inner call must be for, so a member aimed at a different name cannot hide in it. That
/// property is documented and this deployment has only been observed to DISPATCH the selector, so a
/// plan that uses it carries the weaker evidence label and says so.
export const encodeMulticallWithNodeCheck = (node, calls) => {
  const bodies = calls.map((c) => hexBody(c));
  const heads = [];
  let at = 32 * bodies.length;
  for (const b of bodies) {
    heads.push(w(wordUint(at)));
    at += 32 + Math.ceil(b.length / 64) * 32;
  }
  const tails = bodies.map((b) => w(wordUint(b.length / 2)) + b.padEnd(Math.ceil(b.length / 64) * 64, "0"));
  return P.RESOLVER_EXTRA_SELECTOR.multicallWithNodeCheck +
    hexBody(node) + w(wordUint(0x40)) + w(wordUint(bodies.length)) + heads.join("") + tails.join("");
};

// ── the plan's own vocabulary ─────────────────────────────────────────────────────────────────

export const PLAN_STATUS = {
  PLANNED: "PLANNED",
  BAD_PARENT: "BAD_PARENT",
  BAD_INPUT: "BAD_INPUT",
  PRECONDITION_UNMET: "PRECONDITION_UNMET",
  AGENT_GRANT_REFUSED: "AGENT_GRANT_REFUSED",
  BAD_MODE: "BAD_MODE",
  REGISTRATION_MISSING_ADMIN_ROLES: "REGISTRATION_MISSING_ADMIN_ROLES",
};

export const PLAN_MODE = {
  SUBTREE: "subtree",
  SUBREGISTRY: "subregistry",
};

/// The plan-level status and the underlying reason are two separate fields, not one merged object.
/// Spreading the inner refusal over the outer one let the role planner's own status — say
/// AGENT_HOLDS_ROOT_ROLES — overwrite PLAN_STATUS.AGENT_GRANT_REFUSED, so a caller switching on the
/// plan's status saw a value that is not in PLAN_STATUS at all and fell through every branch. The
/// specific reason is the useful half and it is kept, one level down, where nothing collides.
const refusePlan = (status, refusal = {}) => ({ok: false, status, refusal});

/// The evidence label a step carries, so a reader can tell a step whose mechanism the chain has
/// demonstrated from one whose mechanism is inferred from how the contracts are put together.
export const STEP_EVIDENCE = {
  OBSERVED: "OBSERVED — Phase 1 saw this deployment do exactly this",
  DERIVED: "DERIVED — the calldata is derived from a signature this deployment dispatches; the effect is documented, not observed",
  INFERRED: "INFERRED — the mechanism follows from what was observed but this exact step was never exercised",
};

// ── the owner actions this plan cannot perform for anyone ─────────────────────────────────────

export function ownerActions(cfg) {
  return [
    {
      what: "choose and control the PARENT name",
      detail: `\`${cfg.parent}\` must be a name the owner holds in a PermissionedRegistry, with ROLE_SET_SUBREGISTRY (0x100000) and ROLE_SET_RESOLVER (0x1000000) at its own name resource.`,
      why: "UNICA owns no ENSv2 Sepolia name. Every node, resource and token id below is computed from this input and from nothing else.",
    },
    {
      what: "confirm the parent's token id from the chain",
      detail: `call findTokenId("${cfg.parentLabel}") on the registry holding the parent and compare it with ${cfg.parentTokenId}.`,
      why: "The token id is derived here as keccak256(label) with its low 32 bits zeroed, which is only equal to the resource while eacVersionId is 0. Phase 1 left the non-zero case unresolved, so it is confirmed rather than assumed.",
    },
    {
      what: "deploy or nominate the PermissionedRegistry that holds labels under the parent",
      detail: `${cfg.parentSubregistry ?? "not supplied"} — and hold ROLE_REGISTRAR (0x1) at its ROOT_RESOURCE, which is what lets register() below succeed.`,
      why: "ENSv2 gives every parent name its own registry contract. Nothing in this repository can deploy one.",
    },
    {
      what: "deploy or nominate the Permissioned Resolver for the merchant",
      detail: `${cfg.resolver ?? "not supplied"} — the merchant must hold every role it needs at that resolver's ROOT_RESOURCE, which is how a per-account resolver is normally set up.`,
      why: "Step 7 grants the agent a role at a resource on this resolver, and granting a role requires holding its ADMIN role. On a per-account resolver the owner holds all of them at ROOT_RESOURCE — Phase 1 decoded exactly that shape on a live one — which is the mechanism this plan depends on.",
    },
    {
      what: "gather gas estimates once the parent exists",
      detail: "run eth_estimateGas for each transaction row and hand the results back in with --gas, or the plan stays unsignable.",
      why: "Every name here is unregistered today, so an estimate taken now would fail for a reason that has nothing to do with the transaction.",
    },
    {
      what: "hold the policy values and the salt off chain",
      detail: "the threshold, allocation and reserve are committed to, never published. Whoever must check them is shown them directly.",
      why: "ENS stores nothing secret. A text record is public forever from the moment it is written.",
    },
  ];
}

// ── the builder ───────────────────────────────────────────────────────────────────────────────

/// @param cfg {
///   parent, merchantLabel, payLabel, treasuryLabel, agentLabel,
///   merchantOwner, agentAddress, resolver, parentSubregistry,
///   merchantSubregistry, treasurySubregistry,          // subregistry mode only
///   settlement: {recipient, token, executor},
///   policy: {thresholdWei, allocationBps, reserveWei, salt},
///   agentCapabilities, agentRoleNames, expiry, mode, batchRecords,
///   observations: {agentRootRolesAtResolver, assigneeReading, resolverCodeSize,
///                  merchantMayGrantAtAgentResource, parentTokenId},
/// }
export function buildPlan(cfg = {}) {
  const mode = cfg.mode ?? PLAN_MODE.SUBTREE;
  if (mode !== PLAN_MODE.SUBTREE && mode !== PLAN_MODE.SUBREGISTRY) {
    return refusePlan(PLAN_STATUS.BAD_MODE, {mode, modes: Object.values(PLAN_MODE)});
  }

  const norm = normalizeName(cfg.parent);
  if (!norm.ok) return refusePlan(PLAN_STATUS.BAD_PARENT, {parent: cfg.parent, detail: norm.status});
  const parent = norm.name;
  const parentLabel = norm.labels[0];

  const label = (v, d) => String(v ?? d);
  const merchantLabel = label(cfg.merchantLabel, "merchant");
  const payLabel = label(cfg.payLabel, "pay");
  const treasuryLabel = label(cfg.treasuryLabel, "treasury");
  const agentLabel = label(cfg.agentLabel, "agent");
  for (const [k, v] of Object.entries({merchantLabel, payLabel, treasuryLabel, agentLabel})) {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(v) || v.length > 63) {
      return refusePlan(PLAN_STATUS.BAD_INPUT, {field: k, value: v, detail: "not a label this repository will normalise"});
    }
  }

  const merchantName = `${merchantLabel}.${parent}`;
  const payName = `${payLabel}.${merchantName}`;
  const treasuryName = `${treasuryLabel}.${merchantName}`;
  const agentName = `${agentLabel}.${treasuryName}`;

  const node = {
    parent: namehash(parent), merchant: namehash(merchantName),
    pay: namehash(payName), treasury: namehash(treasuryName), agent: namehash(agentName),
  };
  // Two derivations, kept visibly apart. The registry's id comes from the LABEL; the resolver's
  // resource comes from the NAMEHASH. Phase 1 confirmed both and confirmed they are different
  // words, and handing one to the other addresses a resource nobody holds a role at.
  const tokenId = {
    parent: cfg.observations?.parentTokenId ?? P.registryResource(parentLabel),
    merchant: P.registryResource(merchantLabel),
    treasury: P.registryResource(treasuryLabel),
  };
  const resource = {
    merchant: P.resolverNameResource(node.merchant),
    pay: P.resolverNameResource(node.pay),
    treasury: P.resolverNameResource(node.treasury),
    agent: P.resolverNameResource(node.agent),
  };

  // Which registry holds the PARENT's own token. For `<label>.eth` that is ETHRegistry, which the
  // survey read back and pinned. For anything deeper it is some other name's subregistry, and this
  // repository has no way to know which — so a deeper parent must say, rather than have the pinned
  // .eth registry quietly filled in for it. A setSubregistry sent to the wrong registry addresses a
  // token id that registry has never heard of, and the owner would be signing a transaction aimed at
  // a name they do not hold.
  const parentRegistry = cfg.parentRegistry ??
    (norm.labels.length === 2 && norm.labels[1] === "eth" ? P.byName("ETHRegistry").address : null);
  if (!isAddress(parentRegistry)) {
    return refusePlan(PLAN_STATUS.BAD_INPUT, {
      field: "parentRegistry",
      value: cfg.parentRegistry ?? null,
      detail: `\`${parent}\` is not a direct .eth name, so the registry holding its token is one this repository cannot derive. Supply it.`,
    });
  }

  const merchantOwner = cfg.merchantOwner;
  const agentAddress = cfg.agentAddress;
  const resolver = cfg.resolver;
  const parentSubregistry = cfg.parentSubregistry;
  for (const [k, v] of Object.entries({merchantOwner, agentAddress, resolver, parentSubregistry})) {
    if (!isAddress(v)) return refusePlan(PLAN_STATUS.BAD_INPUT, {field: k, value: v ?? null, detail: "not a 20-byte address"});
  }
  if (lower(merchantOwner) === lower(agentAddress)) {
    return refusePlan(PLAN_STATUS.BAD_INPUT, {field: "agentAddress", detail: "the agent and the merchant are the same account; a delegation to yourself cannot be revoked meaningfully"});
  }

  const settlement = cfg.settlement ?? {};
  for (const k of ["recipient", "token", "executor"]) {
    if (!isAddress(settlement[k])) return refusePlan(PLAN_STATUS.BAD_INPUT, {field: `settlement.${k}`, value: settlement[k] ?? null, detail: "not a 20-byte address"});
  }

  const commitment = commitPolicy({
    chainId: P.CHAIN_ID, merchantNode: node.merchant,
    thresholdWei: cfg.policy?.thresholdWei, allocationBps: cfg.policy?.allocationBps,
    reserveWei: cfg.policy?.reserveWei, salt: cfg.policy?.salt,
  });
  if (!commitment.ok) return refusePlan(PLAN_STATUS.BAD_INPUT, {field: "policy", detail: commitment.detail});

  // ── the registry roles the merchant receives at registration, and the ones it does not ──────
  //
  // Only bits this deployment NAMED BACK are set, on the same rule the agent allowlist uses: a
  // documented-only bit is a guess, and a guessed bit in a one-shot argument is permanent. The cost
  // of that rule is real and is printed rather than buried — the omitted bits can never be added.
  const REGISTRY_GRANT = ["RENEW", "SET_SUBREGISTRY", "SET_RESOLVER"];
  let merchantRegistryBitmap = 0n;
  const merchantRegistryRoles = [];
  for (const n of REGISTRY_GRANT) {
    const row = P.REGISTRY_ROLE[n];
    if (row.observed !== P.OBSERVED.REVERT_NAMED_IT && row.observed !== P.OBSERVED.DECODED) {
      return refusePlan(PLAN_STATUS.BAD_INPUT, {field: "registryRoles", detail: `${n} is not observed on this deployment`});
    }
    merchantRegistryBitmap |= BigInt(row.bit) | P.adminRole(BigInt(row.bit));
    merchantRegistryRoles.push({name: n, bit: asWord(row.bit), admin: asWord(P.adminRole(BigInt(row.bit))), observed: row.observed});
  }
  merchantRegistryBitmap |= BigInt(P.REGISTRY_ROLE_CAN_TRANSFER_ADMIN.bit);
  merchantRegistryRoles.push({
    name: "CAN_TRANSFER_ADMIN", bit: asWord(P.REGISTRY_ROLE_CAN_TRANSFER_ADMIN.bit), admin: null,
    observed: P.REGISTRY_ROLE_CAN_TRANSFER_ADMIN.observed,
    note: "already shifted — the chain shows raffy.eth's owner holding bit 156 and not bit 28, so writing it unshifted would be a different permission",
  });
  // An optional caller-supplied bitmap, which exists so the guard below is REACHABLE. A check that
  // can only ever see a value this same function just computed correctly is not a check; the
  // sabotage row feeds a bitmap with the admin half stripped and requires a refusal by name.
  if (cfg.registryRoleBitmap !== undefined && cfg.registryRoleBitmap !== null) {
    merchantRegistryBitmap = BigInt(cfg.registryRoleBitmap);
  }

  // ── THE ONE-SHOT, IRREVERSIBLE CHECK ────────────────────────────────────────────────────────
  //
  // Per-name ADMIN roles can only ever be assigned in the `register()` roleBitmap. Granting an
  // admin role AFTERWARDS is refused: on the fork, `grantRoles(nameResource, adminRole(bit), x)`
  // sent by the name owner reverted with EACCannotGrantRoles (0xd1a3b355), while the SAME owner
  // granting the matching REGULAR bit to the SAME account was ACCEPTED. That accepted control is
  // what makes the refusal decisive rather than a story about a badly-authorised caller.
  //
  // So a registration that omits the admin half is not a smaller registration — it is a name the
  // merchant can never fully administer, with no repair short of losing the name. It fails closed
  // and loudly here rather than being discovered the first time someone tries to revoke an agent.
  const missingAdmin = merchantRegistryRoles
    .filter((r) => r.admin !== null && (merchantRegistryBitmap & BigInt(r.admin)) === 0n)
    .map((r) => r.name);
  if (missingAdmin.length > 0) {
    return refusePlan(PLAN_STATUS.REGISTRATION_MISSING_ADMIN_ROLES, {
      missingAdmin,
      roleBitmap: asWord(merchantRegistryBitmap),
      why: "register() is the ONLY place a per-name admin role can be set. grantRoles(resource, adminRole(bit), account) " +
           "is refused with EACCannotGrantRoles even from the name owner — observed, with the matching regular grant " +
           "accepted as a control. A registration without these bits cannot be repaired.",
      consequence: "the merchant could never revoke a delegated agent, and the name would have to be abandoned",
    });
  }
  if ((merchantRegistryBitmap >> P.ADMIN_SHIFT) === 0n) {
    return refusePlan(PLAN_STATUS.REGISTRATION_MISSING_ADMIN_ROLES, {
      missingAdmin: ["<the entire admin half>"],
      roleBitmap: asWord(merchantRegistryBitmap),
      why: "no bit at or above 128 is set, so this registration assigns no admin role at all",
      consequence: "the merchant could never revoke a delegated agent, and the name would have to be abandoned",
    });
  }

  const permanentOmissions = Object.entries(P.REGISTRY_ROLE)
    .filter(([n, r]) => !REGISTRY_GRANT.includes(n) && r.observed === P.OBSERVED.DOCUMENTED_NOT_OBSERVED)
    .map(([n, r]) => ({name: n, bit: asWord(r.bit)}))
    .concat([{name: "UNNAMED_BIT_32", bit: asWord(P.REGISTRY_ROLE_UNNAMED_BIT_32.bit),
              note: "in use on this deployment and named by no documentation; a bit whose meaning is unknown is never granted"}]);

  const agentRoleNames = cfg.agentRoleNames ?? [...AGENT_DEFAULT_ROLES];
  const agentBits = agentRoleBitmap(agentRoleNames);
  if (!agentBits.ok) return refusePlan(PLAN_STATUS.AGENT_GRANT_REFUSED, agentBits);

  const protectedResources = [resource.merchant, resource.pay, resource.treasury];
  // The same three names, as NODES. The resource list can only name one scope each; the node list
  // covers every scope those names will ever have, including per-key resources nobody has thought
  // of yet.
  const protectedNodes = [node.merchant, node.pay, node.treasury];
  const registryAddresses = [parentSubregistry, cfg.merchantSubregistry, cfg.treasurySubregistry]
    .filter(isAddress);

  // The key the delegation is SCOPED to. On this deployment a delegation is not "SET_TEXT on the
  // agent's leaf" but "SET_TEXT on ONE key of the agent's leaf", so the plan has to name the key,
  // and naming it is what makes the scope reviewable: an owner reading the preview sees the exact
  // string the agent will be able to write, and nothing else.
  const agentRecordKey = cfg.agentRecordKey ?? RECORD_KEYS.agentCapabilities;
  // Where the delegation ACTUALLY lands. `resource.agent` beside it is the NAME-level resource of
  // the same name, and the two are deliberately both present: several steps below are about the
  // name, and exactly one is about the key.
  resource.agentKey = P.resolverScopedResource(node.agent, P.textScopeHash(agentRecordKey));

  const grantOpts = {
    resolver, agentNode: node.agent, agentDnsName: dnsEncode(agentName),
    agentAddress, merchantAddress: merchantOwner,
    recordKey: agentRecordKey,
    roleNames: agentRoleNames, protectedResources, protectedNodes, registryAddresses,
    agentRootRoles: cfg.observations?.agentRootRolesAtResolver,
    assigneeReading: cfg.observations?.assigneeReading,
  };
  const grant = planAgentGrant(grantOpts);
  if (!grant.ok) return refusePlan(PLAN_STATUS.AGENT_GRANT_REFUSED, grant);
  const revoke = planAgentRevoke(grantOpts);
  if (!revoke.ok) return refusePlan(PLAN_STATUS.AGENT_GRANT_REFUSED, revoke);

  // ── the steps ───────────────────────────────────────────────────────────────────────────────

  const steps = [];
  const expiry = BigInt(cfg.expiry ?? 0n);
  const addr = (name, value, meaning) => ({name, type: "address", value, meaning});
  const uint = (name, value, meaning) => ({name, type: "uint256", value: asWord(value), meaning});
  const str = (name, value, meaning) => ({name, type: "string", value: String(value), meaning});

  const recordArgs = (kind, nodeHex, nameStr, key, value) =>
    kind === "addr"
      ? [{name: "node", type: "bytes32", value: nodeHex, meaning: `namehash("${nameStr}")`},
         addr("a", value, "the address this name will publish")]
      : [{name: "node", type: "bytes32", value: nodeHex, meaning: `namehash("${nameStr}")`},
         str("key", key, "the text record key"), str("value", value, "the value, public forever once written")];

  const recordCall = (kind, nodeHex, nameStr, key, value) => {
    const data = kind === "addr" ? encodeSetAddrCall(nodeHex, value) : encodeSetTextCall(nodeHex, key, value);
    return {
      method: kind === "addr" ? "setAddr" : "setText",
      signature: kind === "addr" ? SIGNATURES.setAddr : SIGNATURES.setText,
      to: resolver, data, selector: data.slice(0, 10),
      arguments: recordArgs(kind, nodeHex, nameStr, key, value),
      affects: {name: nameStr, node: nodeHex, resource: P.resolverNameResource(nodeHex), resourceKind: "resolver name-level"},
    };
  };

  // 1 — the parent gets a subregistry, so that a label may exist under it at all.
  steps.push({
    ordinal: 1, kind: "transaction", signer: "owner", dependsOn: [],
    title: `attach a subregistry to ${parent} so labels can exist under it`,
    call: {method: "setSubregistry", signature: P.REGISTRY_SIGNATURES.setSubregistry,
           to: parentRegistry,
           data: encodeSetSubregistryCall(tokenId.parent, parentSubregistry)},
    arguments: [uint("tokenId", tokenId.parent, `the parent's token id — confirm with findTokenId("${parentLabel}")`),
                addr("registry", parentSubregistry, "the PermissionedRegistry that will hold labels under the parent")],
    affects: {name: parent, node: node.parent, resource: asWord(tokenId.parent), resourceKind: "registry (label-derived)"},
    value: "0x0",
    expectedEvent: null,
    expectedPostState: [{read: `getSubregistry("${parentLabel}")`, expect: parentSubregistry}],
    rollback: {how: `setSubregistry(${asWord(tokenId.parent)}, <the previous subregistry, or ${ZERO_ADDRESS}>)`,
               irreversible: false,
               note: "detaching a subregistry does not delete the names inside it; it makes them unreachable through this parent"},
    evidence: {label: STEP_EVIDENCE.OBSERVED,
               detail: "setSubregistry's refusal named ROLE_SET_SUBREGISTRY 0x100000 at the label-derived resource, so both the role and the resource shape are confirmed"},
  });

  // 2 — the one-shot. Ownership and every admin role the merchant will ever hold.
  steps.push({
    ordinal: 2, kind: "transaction", signer: "owner", dependsOn: [1],
    title: `register ${merchantName} to the merchant, WITH the admin roles that can never be added later`,
    call: {method: "register", signature: P.REGISTRY_SIGNATURES.register, to: parentSubregistry,
           data: encodeRegisterCall(merchantLabel, merchantOwner, ZERO_ADDRESS, ZERO_ADDRESS, merchantRegistryBitmap, expiry),
           roleBitmap: asWord(merchantRegistryBitmap)},
    arguments: [
      str("label", merchantLabel, "the label — the registry derives its resource from this and from nothing else"),
      addr("owner", merchantOwner, "the merchant, who holds the name from this moment"),
      addr("subregistry", ZERO_ADDRESS, "left empty on purpose; attached in its own reviewable transaction if subnames are registered"),
      addr("resolver", ZERO_ADDRESS, "left empty on purpose; attached in step 3 so the resolver choice is separately auditable and separately reversible"),
      uint("roleBitmap", merchantRegistryBitmap, "regular roles AND their admin roles — this argument is the only place an admin role can ever be established"),
      {name: "expires", type: "uint64", value: String(expiry), meaning: "the owner's chosen expiry"},
    ],
    affects: {name: merchantName, node: node.merchant, resource: asWord(tokenId.merchant), resourceKind: "registry (label-derived)"},
    roles: {granted: merchantRegistryRoles.map((r) => r.name), revoked: []},
    value: "0x0",
    expectedEvent: null,
    expectedPostState: [
      {read: `ownerOf(${asWord(tokenId.merchant)})`, expect: merchantOwner},
      {read: `roles(${asWord(tokenId.merchant)}, ${merchantOwner})`, expect: asWord(merchantRegistryBitmap)},
    ],
    rollback: {
      how: "none",
      irreversible: true,
      why: "Phase 1 observed, with its passing control, that grantRoles REFUSES an admin bit after registration — EACCannotGrantRoles — because granting an admin role would need the admin of an admin role and no such bit exists in 256 bits. This argument is the only chance.",
      mitigation: "check the bitmap by eye against the table below before signing; the alternative to getting it right is losing the name and registering again",
    },
    detail: {
      rolesGranted: merchantRegistryRoles,
      permanentOmissions,
      why: "only bits this deployment named back are set. A documented-only bit is a guess, and a guessed bit in a one-shot argument is a permanent guess.",
    },
    evidence: {label: STEP_EVIDENCE.OBSERVED,
               detail: "register() with an admin bit in the roleBitmap was ACCEPTED in simulation from ETHRegistrar, and the same call from an account without ROLE_REGISTRAR was REFUSED — the control that makes the acceptance mean something"},
  });

  // 3 — the resolver, in its own transaction.
  steps.push({
    ordinal: 3, kind: "transaction", signer: "merchant", dependsOn: [2],
    title: `attach the Permissioned Resolver to ${merchantName}`,
    call: {method: "setResolver", signature: P.REGISTRY_SIGNATURES.setResolver, to: parentSubregistry,
           data: encodeSetResolverCall(tokenId.merchant, resolver)},
    arguments: [uint("tokenId", tokenId.merchant, "the merchant's token id, derived from the label"),
                addr("resolver", resolver, "the Permissioned Resolver that will answer for this name and, by wildcard, for everything under it")],
    affects: {name: merchantName, node: node.merchant, resource: asWord(tokenId.merchant), resourceKind: "registry (label-derived)"},
    value: "0x0",
    expectedEvent: null,
    expectedPostState: [{read: `getResolver("${merchantLabel}")`, expect: resolver}],
    rollback: {how: `setResolver(${asWord(tokenId.merchant)}, <the previous resolver>)`, irreversible: false},
    evidence: {label: STEP_EVIDENCE.OBSERVED,
               detail: "setResolver's refusal named ROLE_SET_RESOLVER 0x1000000 at the label-derived resource"},
  });

  // 4 — the subnames, or the explicit statement that this mode does not create any.
  if (mode === PLAN_MODE.SUBREGISTRY) {
    if (!isAddress(cfg.merchantSubregistry) || !isAddress(cfg.treasurySubregistry)) {
      return refusePlan(PLAN_STATUS.BAD_INPUT, {
        field: "merchantSubregistry/treasurySubregistry",
        detail: "subregistry mode registers real subnames, and every level of the hierarchy needs its own PermissionedRegistry contract, supplied by the owner",
      });
    }
    const subExpiry = expiry;
    steps.push({
      ordinal: 4, kind: "transaction", signer: "merchant", dependsOn: [2],
      title: `attach a subregistry to ${merchantName} so pay. and treasury. can be registered`,
      call: {method: "setSubregistry", signature: P.REGISTRY_SIGNATURES.setSubregistry, to: parentSubregistry,
             data: encodeSetSubregistryCall(tokenId.merchant, cfg.merchantSubregistry)},
      arguments: [uint("tokenId", tokenId.merchant, "the merchant's token id"),
                  addr("registry", cfg.merchantSubregistry, "the registry that will hold pay. and treasury.")],
      affects: {name: merchantName, node: node.merchant, resource: asWord(tokenId.merchant), resourceKind: "registry (label-derived)"},
      value: "0x0", expectedEvent: null,
      expectedPostState: [{read: `getSubregistry("${merchantLabel}")`, expect: cfg.merchantSubregistry}],
      rollback: {how: `setSubregistry(${asWord(tokenId.merchant)}, ${ZERO_ADDRESS})`, irreversible: false},
      evidence: {label: STEP_EVIDENCE.OBSERVED, detail: "same call and same refusal shape as step 1"},
    });
    let ord = 5;
    for (const [lbl, nm] of [[payLabel, payName], [treasuryLabel, treasuryName]]) {
      steps.push({
        ordinal: ord, kind: "transaction", signer: "merchant", dependsOn: [4],
        title: `register ${nm}`,
        call: {method: "register", signature: P.REGISTRY_SIGNATURES.register, to: cfg.merchantSubregistry,
               data: encodeRegisterCall(lbl, merchantOwner, ZERO_ADDRESS, resolver, merchantRegistryBitmap, subExpiry),
               roleBitmap: asWord(merchantRegistryBitmap)},
        arguments: [str("label", lbl, "the label"), addr("owner", merchantOwner, "the merchant"),
                    addr("subregistry", ZERO_ADDRESS, "none yet"), addr("resolver", resolver, "the same Permissioned Resolver"),
                    uint("roleBitmap", merchantRegistryBitmap, "regular roles and their admin roles — one-shot, as in step 2"),
                    {name: "expires", type: "uint64", value: String(subExpiry), meaning: "the owner's chosen expiry"}],
        affects: {name: nm, node: namehash(nm), resource: asWord(P.registryResource(lbl)), resourceKind: "registry (label-derived)"},
        roles: {granted: merchantRegistryRoles.map((r) => r.name), revoked: []},
        value: "0x0", expectedEvent: null,
        expectedPostState: [{read: `ownerOf(${asWord(P.registryResource(lbl))})`, expect: merchantOwner}],
        rollback: {how: "none", irreversible: true, why: "the roleBitmap is one-shot here for the same reason as step 2",
                   mitigation: "check the bitmap before signing"},
        evidence: {label: STEP_EVIDENCE.OBSERVED, detail: "same call shape as step 2"},
      });
      ord++;
    }
    steps.push({
      ordinal: ord, kind: "transaction", signer: "merchant", dependsOn: [ord - 1],
      title: `attach a subregistry to ${treasuryName} so the agent leaf can be registered`,
      call: {method: "setSubregistry", signature: P.REGISTRY_SIGNATURES.setSubregistry, to: cfg.merchantSubregistry,
             data: encodeSetSubregistryCall(tokenId.treasury, cfg.treasurySubregistry)},
      arguments: [uint("tokenId", tokenId.treasury, "the treasury's token id, derived from its label"),
                  addr("registry", cfg.treasurySubregistry, "the registry that will hold the agent leaf")],
      affects: {name: treasuryName, node: node.treasury, resource: asWord(tokenId.treasury), resourceKind: "registry (label-derived)"},
      value: "0x0", expectedEvent: null,
      expectedPostState: [{read: `getSubregistry("${treasuryLabel}")`, expect: cfg.treasurySubregistry}],
      rollback: {how: `setSubregistry(${asWord(tokenId.treasury)}, ${ZERO_ADDRESS})`, irreversible: false},
      evidence: {label: STEP_EVIDENCE.OBSERVED, detail: "same call and same refusal shape as step 1"},
    });
    ord++;
    steps.push({
      ordinal: ord, kind: "transaction", signer: "merchant", dependsOn: [ord - 1],
      title: `register ${agentName} — the leaf the agent will be allowed to write on`,
      call: {method: "register", signature: P.REGISTRY_SIGNATURES.register, to: cfg.treasurySubregistry,
             data: encodeRegisterCall(agentLabel, merchantOwner, ZERO_ADDRESS, resolver, merchantRegistryBitmap, subExpiry),
             roleBitmap: asWord(merchantRegistryBitmap)},
      arguments: [str("label", agentLabel, "the label"),
                  addr("owner", merchantOwner, "the MERCHANT owns the leaf — the agent never owns a name"),
                  addr("subregistry", ZERO_ADDRESS, "none"), addr("resolver", resolver, "the same Permissioned Resolver"),
                  uint("roleBitmap", merchantRegistryBitmap, "one-shot, as in step 2"),
                  {name: "expires", type: "uint64", value: String(subExpiry), meaning: "the owner's chosen expiry"}],
      affects: {name: agentName, node: node.agent, resource: asWord(P.registryResource(agentLabel)), resourceKind: "registry (label-derived)"},
      roles: {granted: merchantRegistryRoles.map((r) => r.name), revoked: []},
      value: "0x0", expectedEvent: null,
      expectedPostState: [{read: `ownerOf(${asWord(P.registryResource(agentLabel))})`, expect: merchantOwner}],
      rollback: {how: "none", irreversible: true, why: "one-shot roleBitmap", mitigation: "check the bitmap before signing"},
      evidence: {label: STEP_EVIDENCE.OBSERVED, detail: "same call shape as step 2"},
    });
  } else {
    steps.push({
      ordinal: 4, kind: "verify", signer: null, dependsOn: [3],
      title: "confirm the resolver answers for the subnames, and accepts a write at a subname's resource",
      arguments: [],
      affects: {name: agentName, node: node.agent, resource: resource.agent, resourceKind: "resolver name-level"},
      expectedPostState: [
        {read: `resolve("${payName}", addr) through ${P.byName("UpgradableUniversalResolverProxy").address}`, expect: `answered by ${resolver}, no revert`},
        {read: `eth_call setText(${node.agent}, "${RECORD_KEYS.agentCapabilities}", …) from ${merchantOwner}`, expect: "ACCEPTED — returns 0x rather than reverting"},
        {read: `eth_call setText(${node.agent}, …) from an address holding nothing`, expect: `REFUSED with ${P.ERROR_SELECTOR.EACUnauthorizedAccountRoles} naming ${resource.agent}`},
      ],
      rollback: null,
      evidence: {
        label: STEP_EVIDENCE.INFERRED,
        detail:
          "Phase 1 CONFIRMED that an unregistered subname still resolves through its parent's resolver — " +
          "definitely-not-registered-9c4f.raffy.eth answered with addr 0x0 and no revert. It did NOT confirm that " +
          "the resolver ACCEPTS A WRITE at an unregistered subname's name-level resource. This mode depends on that " +
          "and this step is where it is checked, before any delegation exists. If the accepted row does not come " +
          "back accepted, use --mode subregistry and register the subnames.",
      },
    });
  }

  const afterSubnames = steps[steps.length - 1].ordinal;

  // 5 — the merchant's own records. Protected: the agent gets no role at any of these resources.
  const payCalls = [
    recordCall("addr", node.pay, payName, null, settlement.recipient),
    recordCall("text", node.pay, payName, RECORD_KEYS.chainId, String(P.CHAIN_ID)),
    recordCall("text", node.pay, payName, RECORD_KEYS.token, settlement.token),
    recordCall("text", node.pay, payName, RECORD_KEYS.executor, settlement.executor),
    recordCall("text", node.pay, payName, RECORD_KEYS.policyVersion, "1"),
  ];
  const treasuryCalls = [
    recordCall("text", node.treasury, treasuryName, RECORD_KEYS.policyCommitment, commitment.digest),
    recordCall("text", node.treasury, treasuryName, RECORD_KEYS.policyScheme, commitment.scheme),
    recordCall("text", node.treasury, treasuryName, RECORD_KEYS.agentName, agentName),
  ];
  const agentCalls = [
    recordCall("addr", node.agent, agentName, null, agentAddress),
    recordCall("text", node.agent, agentName, RECORD_KEYS.agentCapabilities, String(cfg.agentCapabilities ?? "quote,receipt")),
    recordCall("text", node.agent, agentName, RECORD_KEYS.agentRevocation,
               `revokeRoles(${resource.agent},${asWord(agentBits.bitmap)},${agentAddress}) on ${resolver}`),
  ];

  const recordStep = (ordinal, dependsOn, title, nodeHex, nameStr, calls, note) => {
    const batched = cfg.batchRecords === true;
    const base = {
      ordinal, kind: "transaction", signer: "merchant", dependsOn, title,
      affects: {name: nameStr, node: nodeHex, resource: P.resolverNameResource(nodeHex), resourceKind: "resolver name-level"},
      value: "0x0",
      expectedEvent: null,
      expectedPostState: calls.map((c) => c.method === "setAddr"
        ? {read: `addr(${nodeHex})`, expect: c.arguments[1].value}
        : {read: `text(${nodeHex}, "${c.arguments[1].value}")`, expect: c.arguments[2].value}),
      rollback: {how: `re-send the same setters with the previous values, or clearRecords(${nodeHex}) to empty the name`,
                 irreversible: false,
                 note: "a record's PREVIOUS value stays in the chain's history; rolling back changes what is served, never what was published"},
      evidence: {label: STEP_EVIDENCE.OBSERVED,
                 detail: "setAddr and setText were both refused by a live resolver naming the NAME-LEVEL resource, which is the resource this step writes at"},
      note,
    };
    if (!batched) {
      return calls.map((c, i) => ({
        ...base, ordinal: ordinal + i / 100, call: {method: c.method, signature: c.signature, to: c.to, data: c.data},
        arguments: c.arguments,
        expectedPostState: [base.expectedPostState[i]],
        title: `${title} — ${c.method === "setAddr" ? "addr" : c.arguments[1].value}`,
      }));
    }
    const data = encodeMulticallWithNodeCheck(nodeHex, calls.map((c) => c.data));
    return [{
      ...base,
      call: {method: "multicallWithNodeCheck", signature: P.RESOLVER_EXTRA_SIGNATURES.multicallWithNodeCheck, to: resolver, data},
      arguments: [{name: "node", type: "bytes32", value: nodeHex, meaning: `namehash("${nameStr}") — every inner call must be for this node, which the contract checks`},
                  {name: "calls", type: "bytes[]", value: `${calls.length} calls`, meaning: "each one decoded individually below; a batch a reader cannot audit is worse than three transactions they can"}],
      batch: calls.map((c) => ({signature: c.signature, to: c.to, data: c.data, arguments: c.arguments, affects: c.affects})),
      evidence: {label: STEP_EVIDENCE.DERIVED,
                 detail: "multicallWithNodeCheck's selector is a PUSH4 dispatch constant in the deployed resolver runtime. Presence proves the function exists and nothing about what it does; the unbatched form is the default for that reason."},
    }];
  };

  let ord = afterSubnames + 1;
  const payStepOrdinals = [];
  for (const s of recordStep(ord, [afterSubnames], `write the settlement records on ${payName}`, node.pay, payName, payCalls,
                             "PROTECTED — the agent is granted nothing at this resource, which is what makes the payment recipient, the executor and the chain id un-editable by it")) {
    steps.push(s); payStepOrdinals.push(s.ordinal);
  }
  ord = Math.floor(payStepOrdinals[payStepOrdinals.length - 1]) + 1;
  const treasuryStepOrdinals = [];
  for (const s of recordStep(ord, [payStepOrdinals[payStepOrdinals.length - 1]], `write the policy metadata on ${treasuryName}`, node.treasury, treasuryName, treasuryCalls,
                             "PROTECTED, and PUBLIC — only a commitment to the policy is published, never a value from it")) {
    steps.push(s); treasuryStepOrdinals.push(s.ordinal);
  }

  // 6 — the agent's own metadata, written by the merchant BEFORE the agent has any authority.
  ord = Math.floor(treasuryStepOrdinals[treasuryStepOrdinals.length - 1]) + 1;
  const agentStepOrdinals = [];
  for (const s of recordStep(ord, [treasuryStepOrdinals[treasuryStepOrdinals.length - 1]], `write the agent's metadata on ${agentName}`, node.agent, agentName, agentCalls,
                             "written by the merchant while the agent still holds nothing, so the leaf's initial state is the merchant's and not the agent's")) {
    steps.push(s); agentStepOrdinals.push(s.ordinal);
  }

  // 7 — the delegation itself.
  const grantOrdinal = Math.floor(agentStepOrdinals[agentStepOrdinals.length - 1]) + 1;
  steps.push({
    ordinal: grantOrdinal, kind: "transaction", signer: "merchant", dependsOn: [agentStepOrdinals[agentStepOrdinals.length - 1]],
    title: `authorise the agent to write ONE key — "${agentRecordKey}" on ${agentName} — and nothing else`,
    call: grant.call,
    // The arguments shown to the owner are the arguments the CALLDATA carries. They used to be
    // resource/roleBitmap/account, which were the arguments of a different function: correct-looking
    // rows describing bytes that did not contain them. A preview is only worth reading if the bytes
    // under it mean what the decoded row says.
    arguments: [
      {name: "dnsName", type: "bytes", value: dnsEncode(agentName),
       meaning: `the DNS wire encoding of "${agentName}" — checked to hash to the same namehash this step is screened against`},
      {name: "key", type: "string", value: agentRecordKey,
       meaning: `the ONE text key the agent may write. Any other key on the same name is refused by the resolver.`},
      addr("account", agentAddress, "the agent"),
      {name: "granted", type: "bool", value: "true", meaning: "true grants; the prepared revocation is this same call with false"},
    ],
    affects: {name: agentName, node: node.agent, resource: resource.agentKey, resourceKind: "resolver per-key"},
    roles: {granted: agentRoleNames, revoked: []},
    value: "0x0",
    expectedEvent: {signature: EAC_ROLES_CHANGED_SIGNATURE, topic0: EAC_ROLES_CHANGED_TOPIC,
                    observed: "DERIVED_NOT_OBSERVED — the topic is derived from the signature string; no instance of this event has been decoded from a log"},
    expectedPostState: [
      // The reads that matter, and the three that LOOK like they matter and do not. A validator
      // that checks only the name level or ROOT_RESOURCE sees zero here while the agent can write.
      {read: `roles(${resource.agentKey}, ${agentAddress})`, expect: `${asWord(agentBits.bitmap)} — the per-KEY resource, which is where the grant lands`},
      {read: `hasRoles(${resource.agentKey}, ${asWord(agentBits.bitmap)}, ${agentAddress})`, expect: "true"},
      {read: `roles(${resource.agent}, ${agentAddress})`,
       expect: "0 — the NAME-level resource stays empty. This is not a failure and must not be read as one: the delegation is invisible here."},
      {read: `hasRoles(${resource.pay}, ${asWord(agentBits.bitmap)}, ${agentAddress})`, expect: "false — the agent has nothing on the payment name"},
      {read: `roles(${asWord(P.ROOT_RESOURCE)}, ${agentAddress})`, expect: "0 — unchanged; no root authority was granted"},
    ],
    rollback: {how: `the prepared authorizeTextRoles(..., false) transaction, built at the same time as this grant`, irreversible: false},
    detail: {
      headroom: grant.headroom,
      resourceDerivation: grant.resourceDerivation,
      resourceNote: grant.resourceNote,
      requiresOfSender: grant.requiresOfSender,
      residual: DENIAL_MATRIX.find((d) => d.residual)?.residual ?? null,
    },
    evidence: {label: STEP_EVIDENCE.OBSERVED,
               detail: "authorizeTextRoles was EXECUTED against the deployed resolver bytecode on a pinned Sepolia fork, using the calldata this planner emits: accepted from the name owner, the granted bit found at the per-key resource, the agent's write on that key accepted, and its write on a different key of the same name refused with EACUnauthorizedAccountRoles. A one-byte corruption of the same calldata was rejected, so the acceptance is evidence rather than a call that happened not to revert."},
  });

  // 8 — resolution works.
  steps.push({
    ordinal: grantOrdinal + 1, kind: "verify", signer: null, dependsOn: [grantOrdinal],
    title: "verify resolution — the payer's reading is the one the merchant wrote",
    arguments: [],
    affects: {name: payName, node: node.pay, resource: resource.pay, resourceKind: "resolver name-level"},
    expectedPostState: [
      {read: `resolve("${payName}", addr(${node.pay})) through ${P.byName("UpgradableUniversalResolverProxy").address}`, expect: settlement.recipient},
      {read: `text(${node.pay}, "${RECORD_KEYS.chainId}")`, expect: String(P.CHAIN_ID)},
      {read: `text(${node.treasury}, "${RECORD_KEYS.policyCommitment}")`, expect: commitment.digest},
    ],
    rollback: null,
    evidence: {label: STEP_EVIDENCE.OBSERVED,
               detail: "the resolve path itself is confirmed: raffy.eth answered through the pinned entry point at the pinned block. A non-zero address is the only evidence of anything — Phase 1's wildcard rows show a resolve succeeding for a name nobody registered."},
  });

  // 9 — and the mutation that must fail, actually fails.
  steps.push({
    ordinal: grantOrdinal + 2, kind: "verify", signer: null, dependsOn: [grantOrdinal],
    title: "verify the agent CANNOT move the money — the refusal, from the chain, in its own words",
    arguments: [],
    affects: {name: payName, node: node.pay, resource: resource.pay, resourceKind: "resolver name-level"},
    expectedPostState: [
      {read: `eth_call setAddr(${node.pay}, <any address>) from ${agentAddress}`,
       expect: `REVERT ${P.ERROR_SELECTOR.EACUnauthorizedAccountRoles} EACUnauthorizedAccountRoles(${resource.pay}, ${asWord(P.RESOLVER_ROLE.SET_ADDR.bit)}, ${agentAddress})`},
      {read: `eth_call setText(${node.treasury}, "${RECORD_KEYS.policyCommitment}", …) from ${agentAddress}`,
       expect: `REVERT naming ${resource.treasury}`},
      {read: `eth_call grantRoles(${resource.agent}, ${asWord(agentBits.bitmap)}, <anyone>) from ${agentAddress}`,
       expect: `REVERT ${P.ERROR_SELECTOR.EACCannotGrantRoles} — the agent holds no admin role, so it can pass its authority to nobody`},
      {read: `eth_call setText(${node.agent}, "${RECORD_KEYS.agentCapabilities}", …) from ${agentAddress}`,
       expect: "ACCEPTED — the CONTROL. Without it, three refusals prove only that the agent's address is broken, not that the scoping works."},
    ],
    rollback: null,
    evidence: {label: STEP_EVIDENCE.OBSERVED,
               detail: "this is exactly the probe shape Phase 1 ran against a live resolver: five setters from an unauthorised address, each refusal naming the name-level resource and the role bitmap the setter needs"},
  });

  // 10 — the undo, built now rather than when it is needed.
  steps.push({
    ordinal: grantOrdinal + 3, kind: "prepared", signer: "merchant", dependsOn: [grantOrdinal],
    title: "the revocation — built now, held until needed",
    call: revoke.call,
    arguments: [
      {name: "dnsName", type: "bytes", value: dnsEncode(agentName),
       meaning: `the same name the grant named; a revocation aimed anywhere else does not revoke`},
      {name: "key", type: "string", value: agentRecordKey, meaning: "the same key the grant scoped to"},
      addr("account", agentAddress, "the agent"),
      {name: "granted", type: "bool", value: "false", meaning: "false REVOKES — this is the grant call with one word changed"},
    ],
    affects: {name: agentName, node: node.agent, resource: resource.agentKey, resourceKind: "resolver per-key"},
    roles: {granted: [], revoked: agentRoleNames},
    value: "0x0",
    expectedEvent: {signature: EAC_ROLES_CHANGED_SIGNATURE, topic0: EAC_ROLES_CHANGED_TOPIC,
                    observed: "DERIVED_NOT_OBSERVED"},
    expectedPostState: [
      {read: `roles(${resource.agentKey}, ${agentAddress})`, expect: "0 — the per-key role word is cleared"},
      {read: `hasRoles(${resource.agentKey}, ${asWord(agentBits.bitmap)}, ${agentAddress})`, expect: "false"},
      {read: `text(${node.agent}, "${agentRecordKey}")`, expect: "unchanged — revoking the authority does not remove what was written with it"},
    ],
    rollback: {how: "re-send the grant to delegate again", refersToOrdinal: grantOrdinal, irreversible: false},
    evidence: {label: STEP_EVIDENCE.OBSERVED,
               detail: "the revocation was EXECUTED on a pinned fork using this planner's own calldata: accepted, the per-key role word back to zero, and the agent's next write on that key refused. Revocation is the half that usually goes untested, because nothing breaks when it is missing until the day it is needed."},
  });

  // Ordinals are assigned here, once, after every step exists. They are built above with sortable
  // placeholders because a record step expands into one transaction per record and the count is not
  // known until it does; renumbering at the end keeps the ordinals the owner reads as 1, 2, 3 with
  // no gaps and no decimals, and rewrites every dependency through the same map so the preview's
  // dependency check is checking the numbers that were printed.
  const remap = new Map(steps.map((s, i) => [s.ordinal, i + 1]));
  for (const s of steps) {
    s.dependsOn = (s.dependsOn ?? []).map((d) => remap.get(d) ?? d);
    if (s.rollback?.refersToOrdinal !== undefined) s.rollback.refersToOrdinal = remap.get(s.rollback.refersToOrdinal);
    s.ordinal = remap.get(s.ordinal);
  }

  // Which role table each step's bitmap is read against, decided by the TARGET rather than by a
  // hand-written label on the step. The registry and the resolver give different meanings to the
  // same bit positions — 1<<24 is SET_RESOLVER on one and SET_NAME on the other — so a step that
  // labelled itself could label itself wrongly and the preview would print a confident, readable,
  // entirely incorrect list of permissions.
  const registryTargets = new Set(
    [parentRegistry, ...registryAddresses].map(lower),
  );
  for (const s of steps) {
    if (!s.call?.to) continue;
    s.roleTable = registryTargets.has(lower(s.call.to)) ? ROLE_TABLE.REGISTRY : ROLE_TABLE.RESOLVER;
  }

  // ── the screen, run over the assembled plan rather than trusted from the constructors ────────
  const screen = screenPlanForAgentAuthority(steps, {
    // The PER-KEY resource, because that is where the delegation lands. Passing the name-level
    // one here was caught by this very screen the moment the delegation moved: the plan's second
    // pass rejected its own first pass's step with WRONG_RESOURCE. A screen that can catch the
    // author of the thing it screens is worth the cost of writing it twice.
    agentResource: resource.agentKey, agentAddress, merchantAddress: merchantOwner,
    protectedNodes,
    protectedResources, registryAddresses,
    agentRootRoles: cfg.observations?.agentRootRolesAtResolver,
  });
  if (!screen.ok) return refusePlan(PLAN_STATUS.AGENT_GRANT_REFUSED, {screen});

  // ── preconditions, every one of which must be an OBSERVATION and not an assumption ──────────
  const o = cfg.observations ?? {};
  const preconditions = [
    {
      name: "the agent holds NOTHING at ROOT_RESOURCE on the resolver",
      required: true,
      read: `roles(${asWord(P.ROOT_RESOURCE)}, ${agentAddress}) on ${resolver}`,
      observed: o.agentRootRolesAtResolver === undefined || o.agentRootRolesAtResolver === null ? null : asWord(o.agentRootRolesAtResolver),
      satisfied: o.agentRootRolesAtResolver !== undefined && o.agentRootRolesAtResolver !== null && BigInt(o.agentRootRolesAtResolver) === 0n,
      why: "a ROOT_RESOURCE grant applies to every resource on the contract, so a narrow grant on top of one is decoration. Phase 1 measured this exact trap: roles(nameResource, owner) read 0 while hasRoles(nameResource, …, owner) read true.",
    },
    {
      name: "the resolver has code",
      required: true,
      read: `eth_getCode(${resolver})`,
      observed: o.resolverCodeSize ?? null,
      satisfied: Number(o.resolverCodeSize ?? 0) > 0,
      why: "an eth_call to an address with no code returns 0x, and 0x decodes as 'no roles' — the safest-looking wrong answer in this interface",
    },
    {
      name: "the merchant may actually grant this role at this resource",
      required: true,
      read: `eth_call grantRoles(${resource.agent}, ${asWord(agentBits.bitmap)}, ${agentAddress}) from ${merchantOwner}`,
      observed: o.merchantMayGrantAtAgentResource === undefined ? null : String(o.merchantMayGrantAtAgentResource),
      satisfied: o.merchantMayGrantAtAgentResource === true,
      why: "granting a role requires holding its ADMIN role. On a per-account resolver the owner holds all of them at ROOT_RESOURCE — Phase 1 decoded 0x1111…1111 on a live one — but the ACCEPTANCE of a resolver grant at a name resource was never exercised, so it is simulated before the plan is signable rather than assumed.",
    },
    {
      name: "the role has an assignee slot free at this resource",
      required: true,
      read: `getAssigneeCount(${resource.agent}, ${asWord(agentBits.bitmap)}) on ${resolver}`,
      observed: o.assigneeReading ? {counts: o.assigneeReading.counts, maxima: o.assigneeReading.maxima} : null,
      satisfied: grant.headroom?.ok === true,
      why: `ENSv2 caps assignees per role per resource, and the contract states the cap itself — ${P.MAX_ASSIGNEES_SOURCE}.`,
    },
  ];
  const unmet = preconditions.filter((p) => p.required && !p.satisfied);

  return {
    ok: unmet.length === 0,
    status: unmet.length === 0 ? PLAN_STATUS.PLANNED : PLAN_STATUS.PRECONDITION_UNMET,
    chainId: P.CHAIN_ID,
    chainName: P.CHAIN_NAME,
    mode,
    parent, merchant: merchantName, pay: payName, treasury: treasuryName, agent: agentName,
    names: {parent, merchant: merchantName, pay: payName, treasury: treasuryName, agent: agentName},
    nodes: node,
    resources: {...resource, root: asWord(P.ROOT_RESOURCE)},
    tokenIds: {parent: asWord(tokenId.parent), merchant: asWord(tokenId.merchant), treasury: asWord(tokenId.treasury)},
    protectedResources,
    accounts: {merchantOwner, agentAddress, resolver, parentSubregistry},
    policyCommitment: {digest: commitment.digest, scheme: commitment.scheme, fields: commitment.fields, note: commitment.note},
    agentGrant: {roles: agentRoleNames, bitmap: asWord(agentBits.bitmap), resource: resource.agent},
    merchantRegistryRoles, permanentOmissions,
    steps,
    screen,
    preconditions,
    unmetPreconditions: unmet.map((p) => p.name),
    denialMatrix: DENIAL_MATRIX,
    ownerActions: ownerActions({parent, parentLabel, parentTokenId: asWord(tokenId.parent), parentSubregistry, resolver}),
    broadcast: {byThisTool: false, whoSigns: "the owner and the merchant, each in their own wallet"},
  };
}

/// A plan is signable only if it is a plan, its preconditions were OBSERVED and hold, its screen is
/// clean, and its preview renders every row. Asked of both objects on purpose: the plan is what was
/// decided, the preview is what the human saw, and they are allowed to disagree exactly once — here.
export function planIsSignable(plan, preview) {
  return Boolean(
    plan && plan.ok === true && plan.status === PLAN_STATUS.PLANNED &&
    plan.screen?.ok === true && plan.unmetPreconditions.length === 0 &&
    plan.steps.some((s) => s.kind === "prepared" && REVOKING_METHODS.has(String(s.call?.method ?? ""))) &&
    planPreviewIsSignable(preview),
  );
}

// ── the command ───────────────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === pathResolve(process.argv[1]);

if (isMain) {
  const args = process.argv.slice(2);
  const flag = (n, d = null) => {
    const i = args.indexOf(`--${n}`);
    if (i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
    const eq = args.find((a) => a.startsWith(`--${n}=`));
    return eq ? eq.slice(n.length + 3) : d;
  };
  const has = (n) => args.includes(`--${n}`);

  let cfg;
  const configPath = flag("config");
  if (configPath) {
    cfg = JSON.parse(readFileSync(configPath, "utf8"));
  } else if (has("demo")) {
    // Obvious placeholders, so nothing here can be mistaken for a real deployment. Every address is
    // a repeated nybble; the parent is a name that says what it is.
    cfg = {
      parent: flag("parent", "owner-chosen-parent.eth"),
      merchantOwner: "0x1111111111111111111111111111111111111111",
      agentAddress: "0x2222222222222222222222222222222222222222",
      resolver: "0x3333333333333333333333333333333333333333",
      parentSubregistry: "0x4444444444444444444444444444444444444444",
      merchantSubregistry: "0x5555555555555555555555555555555555555555",
      treasurySubregistry: "0x6666666666666666666666666666666666666666",
      settlement: {recipient: "0x7777777777777777777777777777777777777777",
                   token: "0x8888888888888888888888888888888888888888",
                   executor: "0x9999999999999999999999999999999999999999"},
      policy: {thresholdWei: "1000000", allocationBps: "2500", reserveWei: "500000", salt: "demo-salt-not-a-real-one"},
      expiry: "2000000000",
      observations: {
        agentRootRolesAtResolver: "0x0", resolverCodeSize: 77, merchantMayGrantAtAgentResource: true,
        // The shape getAssigneeCount returns: counts and maxima packed one nybble per role, in the
        // same nybble positions as the bitmap asked about. The maxima word is built from the bitmap
        // rather than typed, because a right-aligned 0x…0f is exactly the mistake Phase 1 had to
        // move the question three times to rule out.
        assigneeReading: (() => {
          const b = agentRoleBitmap([...AGENT_DEFAULT_ROLES]).bitmap;
          let maxima = 0n;
          for (let n = 0n; n < 64n; n++) if (((b >> (4n * n)) & 0xfn) !== 0n) maxima |= 0xfn << (4n * n);
          return {roleBitmap: asWord(b), counts: asWord(0n), maxima: asWord(maxima)};
        })(),
      },
    };
  } else {
    cfg = {parent: flag("parent")};
  }
  if (flag("mode")) cfg.mode = flag("mode");
  if (has("batch")) cfg.batchRecords = true;

  const plan = buildPlan(cfg);
  if (!plan.steps) {
    console.error(`REFUSED  ${plan.status}`);
    console.error(JSON.stringify(plan, null, 2));
    console.error("\nrun with --demo to see a complete plan with placeholder inputs, or --config <file.json> with your own");
    process.exit(1);
  }

  // Estimates come in as `--gas 1=52000,2=190000`, one per transaction ordinal. There is
  // deliberately no flag that fills them all in with a plausible number: a fabricated estimate is
  // worse than a missing one, because a missing one says so on every row it is missing from.
  const gas = {};
  for (const pair of String(flag("gas", "")).split(",").filter(Boolean)) {
    const [o, v] = pair.split("=");
    if (o && v) gas[Number(o)] = v;
  }

  const preview = previewPlan(plan, {gas, discovered: {
    [lower(plan.accounts.resolver)]: {name: "the merchant's Permissioned Resolver", role: "serves this name and, by wildcard, everything under it",
                                      note: "supplied by the owner; not part of the pinned deployment survey"},
    [lower(plan.accounts.parentSubregistry)]: {name: "the parent's PermissionedRegistry", role: "holds the labels registered under the parent",
                                               note: "supplied by the owner; not part of the pinned deployment survey"},
  }});

  if (has("json")) {
    console.log(JSON.stringify({plan, preview, signable: planIsSignable(plan, preview)}, null, 2));
  } else {
    console.log(renderPlanPreview(preview));
    console.log("\n— owner actions this tool cannot perform —");
    for (const a of plan.ownerActions) console.log(`  · ${a.what}\n      ${a.detail}\n      why: ${a.why}`);
    console.log("\n— preconditions —");
    for (const p of plan.preconditions) {
      console.log(`  [${p.satisfied ? "ok " : "   "}] ${p.name}\n      read: ${p.read}\n      observed: ${JSON.stringify(p.observed)}`);
    }
    console.log(`\nplan status: ${plan.status}   screen: ${plan.screen.status} (${plan.screen.screened} role-changing step(s))`);
    console.log(`signable: ${planIsSignable(plan, preview)}`);
    if (!planIsSignable(plan, preview)) {
      console.log("  — gas estimates are an input to this tool and none were supplied, so no plan built here is signable until they are.");
    }
  }
  process.exit(plan.steps ? 0 : 1);
}
