// The owner preview — what a human sees before they sign, and the gate that decides a plan is not
// ready to be looked at yet.
//
// WHAT THIS IS FOR. `plan.mjs` decides WHICH transactions delegate a narrow authority to an agent.
// This file decides what the owner is TOLD about each one. Those are different jobs and they fail
// differently: a planner bug produces a wrong transaction, and a preview bug produces a right
// transaction the owner could not have checked. The second is worse, because the owner's review is
// the last control before a signature and a preview that omits the interesting field silently
// removes it.
//
// SO EVERY ROW CARRIES THE SAME SEVENTEEN FIELDS, and the ones that would be most convenient to
// leave out are the ones with their own dedicated flags: `involvesAdminRole` and
// `involvesRootResource` are computed from the calldata's own arguments, printed on every row
// including the rows where they are false, and asserted by the suite. A field that only appears
// when it is alarming teaches the reader that its absence means nothing was checked.
//
// A BATCH IS DECODED CALL BY CALL OR IT IS NOT SHOWN. The resolver's runtime dispatches
// `multicallWithNodeCheck(bytes32,bytes[])`, and batching the record writes would cut the
// transaction count. Two rules apply and both are enforced here rather than recommended: every
// inner call is decoded individually into its own row, and no role change may ever ride inside a
// batch. A batch a reader cannot audit is worse than three transactions they can, and a permission
// change hidden in one is the specific thing that is worse still.
//
// GAS IS AN OBSERVATION, NOT A DECORATION. A row with no estimate is marked NOT_ESTIMATED and the
// plan is not signable. `preview.mjs` established that rule for the single-transaction case for the
// same reason: the cost of a transaction the owner is about to sign is not an optional field.
//
// NOTHING HERE SIGNS OR BROADCASTS. It formats. `permissioned-test.mjs` scans this directory and
// fails if that stops being true.

import {SIGNATURES} from "./permissioned.mjs";
import {ROLE_TABLE, describeBitmap} from "./roles.mjs";
import * as P from "./profile.mjs";

const lower = (v) => String(v ?? "").toLowerCase();
const asWord = (v) => "0x" + BigInt(v).toString(16).padStart(64, "0");
const isAddress = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);

export const OWNER_MARKER = "REQUIRES_OWNER_WALLET_CONFIRMATION";

export const GAS_STATUS = {
  ESTIMATED: "ESTIMATED",
  NOT_ESTIMATED: "NOT_ESTIMATED",
  NOT_A_TRANSACTION: "NOT_A_TRANSACTION",
  // The revocation is real calldata for a transaction that cannot be estimated yet, because it
  // undoes a grant that does not exist until the plan has run. Reporting that as NOT_ESTIMATED
  // would put it in the same bucket as "nobody bothered", and the two want different actions.
  NOT_YET_ESTIMABLE: "NOT_YET_ESTIMABLE",
};

/// The step kinds. `prepared` is a transaction in every respect except that it is not sent now.
export const STEP_KIND = {
  TRANSACTION: "transaction",
  PREPARED: "prepared",
  VERIFY: "verify",
  OWNER_ACTION: "owner-action",
};

export const PREVIEW_REFUSAL = {
  BATCH_CARRIES_ROLE_CHANGE: "BATCH_CARRIES_ROLE_CHANGE",
  BATCH_CROSSES_TARGETS: "BATCH_CROSSES_TARGETS",
  UNDECODED_BATCH_MEMBER: "UNDECODED_BATCH_MEMBER",
  MISSING_GAS: "MISSING_GAS",
  NO_ROLLBACK: "NO_ROLLBACK",
  BAD_TARGET: "BAD_TARGET",
  VALUE_MUST_BE_ZERO: "VALUE_MUST_BE_ZERO",
};

export const PREVIEW_REFUSAL_EXPLAIN = {
  BATCH_CARRIES_ROLE_CHANGE: "A permission change may not ride inside a batch. It gets its own transaction so it gets its own review.",
  BATCH_CROSSES_TARGETS: "Every call in a batch must go to the one contract the batch is sent to; a batch that appears to reach two contracts cannot be audited from one row.",
  UNDECODED_BATCH_MEMBER: "A member of the batch could not be decoded into named arguments, so the owner would be signing bytes nobody read.",
  MISSING_GAS: "No gas estimate was observed for this transaction.",
  NO_ROLLBACK: "This step changes state and names no way back. Anything hard to undo must say how it is undone before it is signed.",
  BAD_TARGET: "The target is not a 20-byte address.",
  VALUE_MUST_BE_ZERO: "None of these calls is payable; a preview carrying value is refused.",
};

// ── whose contract is this, and how well do we know it ────────────────────────────────────────
//
// Three honest answers, not two. An address pinned in the profile was read back from Sepolia and
// carries its role and its observation label. An address DISCOVERED at plan time — the merchant's
// own resolver proxy, a subregistry the owner deployed — is a real contract that this repository
// has never surveyed, and saying "unknown" about it is more useful than inventing a role for it.

export const TARGET_KNOWLEDGE = {
  PINNED: "PINNED",
  DISCOVERED: "DISCOVERED",
  UNKNOWN: "UNKNOWN",
};

export function describeTarget(address, discovered = {}) {
  if (!isAddress(address)) return {knowledge: TARGET_KNOWLEDGE.UNKNOWN, address, name: null, role: null, observed: null};
  const pinned = P.DEPLOYMENT.find((d) => lower(d.address) === lower(address));
  if (pinned) {
    return {
      knowledge: TARGET_KNOWLEDGE.PINNED,
      address, name: pinned.name, role: pinned.role, observed: pinned.observed,
      codeSize: pinned.codeSize, codeHash: pinned.codeHash,
      note: `read back from Sepolia at block ${P.PIN_BLOCK}`,
    };
  }
  const d = discovered[lower(address)];
  if (d) {
    return {
      knowledge: TARGET_KNOWLEDGE.DISCOVERED,
      address, name: d.name ?? null, role: d.role ?? null, observed: d.observed ?? null,
      note: d.note ?? "discovered at plan time; not part of the pinned deployment survey",
    };
  }
  return {
    knowledge: TARGET_KNOWLEDGE.UNKNOWN, address, name: null, role: null, observed: null,
    note: "this address is not in the pinned deployment and was not described by the plan — check it yourself before signing",
  };
}

// ── the two flags that must never be silent ───────────────────────────────────────────────────
//
// Computed from the call's own arguments rather than copied from whatever the step claimed about
// itself. A step that says `involvesAdminRole: false` while carrying an admin bit in its bitmap is
// exactly the failure this recomputation exists to catch, and the suite sabotages a step to prove
// the recomputation wins.

export function roleFlags(call, roleTable = ROLE_TABLE.RESOLVER) {
  const isRoleChange = ["grantRoles", "revokeRoles", "grantRootRoles", "revokeRootRoles"].includes(call?.method);
  const bitmap = call?.roleBitmap === undefined || call?.roleBitmap === null ? null : BigInt(call.roleBitmap);
  const resource = call?.resource === undefined || call?.resource === null ? null : BigInt(call.resource);
  return {
    isRoleChange,
    involvesAdminRole: bitmap === null ? false : (bitmap >> P.ADMIN_SHIFT) !== 0n,
    involvesRootResource:
      call?.method === "grantRootRoles" || call?.method === "revokeRootRoles" ||
      (isRoleChange && resource !== null && resource === BigInt(P.ROOT_RESOURCE)),
    roleBitmap: bitmap === null ? null : asWord(bitmap),
    // Which table the bits are read against is the step's to declare. The two tables assign
    // different meanings to the same bit positions, so a default that guesses would produce a
    // confident, readable, wrong list of permissions.
    roleNames: bitmap === null ? null : describeBitmap(bitmap, roleTable),
  };
}

// ── one row ───────────────────────────────────────────────────────────────────────────────────

/// @param step  a plan step, as `plan.mjs` builds them
/// @param opts  {gas: {<ordinal>: <estimate>}, discovered: {<address>: {...}}}
export function previewStep(step, opts = {}) {
  const gasMap = opts.gas ?? {};
  const call = step?.call ?? null;
  const flags = call ? roleFlags(call, step?.roleTable ?? ROLE_TABLE.RESOLVER)
                     : {isRoleChange: false, involvesAdminRole: false, involvesRootResource: false, roleBitmap: null, roleNames: null};

  const refusals = [];
  const refuse = (code, detail) => refusals.push({code, explain: PREVIEW_REFUSAL_EXPLAIN[code], detail});

  const isTransaction = step?.kind === STEP_KIND.TRANSACTION;
  const isPrepared = step?.kind === STEP_KIND.PREPARED;
  // A prepared transaction is held rather than sent, and it is checked exactly as hard: same
  // target, same zero value, same named way back. The only thing it is excused is the estimate,
  // and it is excused with its own word rather than by being left blank.
  const isSignedEventually = isTransaction || isPrepared;

  if (isSignedEventually) {
    if (!isAddress(call?.to)) refuse(PREVIEW_REFUSAL.BAD_TARGET, call?.to ?? null);
    if (BigInt(step.value ?? "0x0") !== 0n) refuse(PREVIEW_REFUSAL.VALUE_MUST_BE_ZERO, step.value);
    if (!step.rollback) refuse(PREVIEW_REFUSAL.NO_ROLLBACK, null);
  }

  // The batch rules, enforced before anything is rendered.
  const batch = Array.isArray(step?.batch) ? step.batch : null;
  const batchRows = [];
  if (batch) {
    for (const inner of batch) {
      if (["grantRoles", "revokeRoles", "grantRootRoles", "revokeRootRoles"].includes(inner?.method)) {
        refuse(PREVIEW_REFUSAL.BATCH_CARRIES_ROLE_CHANGE, inner.method);
      }
      if (inner?.to !== undefined && lower(inner.to) !== lower(call?.to)) {
        refuse(PREVIEW_REFUSAL.BATCH_CROSSES_TARGETS, {inner: inner.to, batch: call?.to});
      }
      if (!Array.isArray(inner?.arguments) || inner.arguments.length === 0) {
        refuse(PREVIEW_REFUSAL.UNDECODED_BATCH_MEMBER, inner?.signature ?? inner?.selector ?? null);
      }
      batchRows.push({
        signature: inner?.signature ?? null,
        selector: inner?.data ? String(inner.data).slice(0, 10) : (inner?.selector ?? null),
        arguments: inner?.arguments ?? [],
        affects: inner?.affects ?? null,
        data: inner?.data ?? null,
      });
    }
  }

  const gasGiven = gasMap[step?.ordinal];
  const gas = isPrepared && (gasGiven === undefined || gasGiven === null)
    ? {status: GAS_STATUS.NOT_YET_ESTIMABLE, estimate: null, estimateDecimal: null,
       note: "this transaction undoes a grant that does not exist yet; estimate it after the grant lands, before it is needed"}
    : !isSignedEventually
    ? {status: GAS_STATUS.NOT_A_TRANSACTION, estimate: null, estimateDecimal: null,
       note: "this step is not a transaction — nothing is signed and nothing is spent"}
    : (gasGiven === undefined || gasGiven === null
        ? {status: GAS_STATUS.NOT_ESTIMATED, estimate: null, estimateDecimal: null,
           note: "no eth_estimateGas reading was supplied; the cost of this transaction is unknown"}
        : {status: GAS_STATUS.ESTIMATED,
           estimate: typeof gasGiven === "string" ? gasGiven : "0x" + BigInt(gasGiven).toString(16),
           estimateDecimal: Number(BigInt(gasGiven)),
           source: "eth_estimateGas",
           note: "an estimate is a simulation at one block; it is not a promise about the block this lands in"});
  if (isTransaction && gas.status === GAS_STATUS.NOT_ESTIMATED) refuse(PREVIEW_REFUSAL.MISSING_GAS, null);

  return {
    ordinal: step?.ordinal ?? null,
    kind: step?.kind ?? null,
    title: step?.title ?? null,
    dependsOn: step?.dependsOn ?? [],
    signer: step?.signer ?? null,
    chainId: P.CHAIN_ID,
    chainName: P.CHAIN_NAME,
    target: describeTarget(call?.to, opts.discovered ?? {}),
    method: call?.method ?? null,
    signature: call?.signature ?? (call?.method ? SIGNATURES[call.method] ?? null : null),
    selector: call?.data ? String(call.data).slice(0, 10) : (call?.selector ?? null),
    arguments: step?.arguments ?? [],
    affects: step?.affects ?? null,
    roles: {
      granted: step?.roles?.granted ?? (call?.method === "grantRoles" ? flags.roleNames?.named ?? [] : []),
      revoked: step?.roles?.revoked ?? (call?.method === "revokeRoles" ? flags.roleNames?.named ?? [] : []),
      bitmap: flags.roleBitmap,
      table: step?.roleTable ?? ROLE_TABLE.RESOLVER,
      // A bit with no name is the most interesting bit in the word, so it gets its own field
      // rather than being dropped out of the `named` list and never mentioned again.
      unrecognisedBits: flags.roleNames?.unrecognised ?? null,
    },
    involvesAdminRole: flags.involvesAdminRole,
    involvesRootResource: flags.involvesRootResource,
    value: step?.value ?? (isSignedEventually ? "0x0" : null),
    gas,
    batch: batch ? {method: call?.method ?? null, count: batchRows.length, calls: batchRows} : null,
    expectedEvent: step?.expectedEvent ?? null,
    expectedPostState: step?.expectedPostState ?? [],
    rollback: step?.rollback ?? null,
    evidence: step?.evidence ?? null,
    detail: step?.detail ?? null,
    note: step?.note ?? null,
    data: call?.data ?? null,
    marker: isSignedEventually ? OWNER_MARKER : null,
    refusals,
    ok: refusals.length === 0,
  };
}

// ── the whole plan ────────────────────────────────────────────────────────────────────────────

export const PLAN_PREVIEW_STATUS = {
  READY: "READY",
  REFUSED: "REFUSED",
  NOT_A_PLAN: "NOT_A_PLAN",
};

export function previewPlan(plan, opts = {}) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    return {ok: false, status: PLAN_PREVIEW_STATUS.NOT_A_PLAN,
            explain: "That is not the shape buildPlan returns, or it carries no steps."};
  }
  const rows = plan.steps.map((s) => previewStep(s, opts));
  const refused = rows.filter((r) => !r.ok);

  // Dependencies are checked here rather than trusted, because the ORDER is the safety property:
  // granting the agent a role before the leaf's records exist, or before the resolver is attached,
  // produces a delegation pointing at a name that means nothing yet.
  const seen = new Set();
  const brokenOrder = [];
  for (const s of plan.steps) {
    for (const d of s.dependsOn ?? []) if (!seen.has(d)) brokenOrder.push({ordinal: s.ordinal, missing: d});
    seen.add(s.ordinal);
  }

  const transactions = rows.filter((r) => r.kind === STEP_KIND.TRANSACTION);
  const summary = {
    steps: rows.length,
    transactions: transactions.length,
    prepared: rows.filter((r) => r.kind === STEP_KIND.PREPARED).length,
    verifications: rows.filter((r) => r.kind === STEP_KIND.VERIFY).length,
    ownerActions: rows.filter((r) => r.kind === STEP_KIND.OWNER_ACTION).length,
    irreversibleSteps: rows.filter((r) => r.rollback?.irreversible === true).map((r) => r.ordinal),
    rowsInvolvingAdminRoles: rows.filter((r) => r.involvesAdminRole).map((r) => r.ordinal),
    rowsInvolvingRootResource: rows.filter((r) => r.involvesRootResource).map((r) => r.ordinal),
    totalGasEstimate: transactions.every((r) => r.gas.status === GAS_STATUS.ESTIMATED)
      ? transactions.reduce((n, r) => n + r.gas.estimateDecimal, 0)
      : null,
  };

  const ok = refused.length === 0 && brokenOrder.length === 0;
  return {
    ok,
    status: ok ? PLAN_PREVIEW_STATUS.READY : PLAN_PREVIEW_STATUS.REFUSED,
    marker: OWNER_MARKER,
    chainId: P.CHAIN_ID,
    chainName: P.CHAIN_NAME,
    plan: {parent: plan.parent, merchant: plan.merchant, agent: plan.agent, mode: plan.mode},
    summary,
    rows,
    refused: refused.map((r) => ({ordinal: r.ordinal, title: r.title, refusals: r.refusals})),
    brokenOrder,
    broadcast: {
      byThisTool: false,
      why: "this directory imports no signer, reads no key, and names no writing JSON-RPC method",
      whoSigns: "the repository owner, and the merchant, each in their own wallet",
      marker: OWNER_MARKER,
    },
  };
}

/// The last gate. A caller must not be able to mistake a refused preview for a signable one, so
/// this asks for every property that makes a plan safe to hand over — and asks it of the RENDERED
/// preview, which is what the owner actually saw.
export function planPreviewIsSignable(preview) {
  if (!preview || preview.ok !== true || preview.status !== PLAN_PREVIEW_STATUS.READY) return false;
  if (preview.marker !== OWNER_MARKER) return false;
  if (!Array.isArray(preview.rows) || preview.rows.length === 0) return false;
  if (preview.summary.rowsInvolvingRootResource.length !== 0) return false;
  // A delegation handed over without its undo is not a plan, it is a one-way door with a preview
  // attached. The prepared revocation is required by presence, not by hope that someone writes it.
  if (!preview.rows.some((r) => r.kind === STEP_KIND.PREPARED && r.method === "revokeRoles")) return false;
  for (const r of preview.rows) {
    if (!r.ok) return false;
    if (r.kind !== STEP_KIND.TRANSACTION && r.kind !== STEP_KIND.PREPARED) continue;
    if (!isAddress(r.target.address)) return false;
    if (BigInt(r.value) !== 0n) return false;
    if (r.kind === STEP_KIND.TRANSACTION && r.gas.status !== GAS_STATUS.ESTIMATED) return false;
    if (!r.rollback) return false;
    if (!Array.isArray(r.arguments) || r.arguments.length === 0) return false;
    if (r.involvesRootResource) return false;
    // An admin role is legitimate in exactly one place — the `register()` roleBitmap, which is the
    // only place an admin role can EVER be established on this deployment. Anywhere else it is a
    // permission escalation wearing an ordinal.
    if (r.involvesAdminRole && r.method !== "register") return false;
    if (r.batch && r.batch.calls.some((c) => !Array.isArray(c.arguments) || c.arguments.length === 0)) return false;
  }
  return true;
}

// ── rendering, for a human ────────────────────────────────────────────────────────────────────

const pad = (s, n) => String(s).padEnd(n);

export function renderPlanPreview(preview) {
  const out = [];
  if (!preview?.rows) return "not a preview";
  out.push(`ENSv2 delegation plan — chain ${preview.chainId} (${preview.chainName})`);
  out.push(`parent ${preview.plan.parent}  ·  merchant ${preview.plan.merchant}  ·  agent ${preview.plan.agent}`);
  out.push(`mode ${preview.plan.mode}`);
  out.push(`${preview.summary.steps} steps — ${preview.summary.transactions} transactions, ${preview.summary.verifications} verifications, ${preview.summary.ownerActions} owner actions`);
  out.push("");
  for (const r of preview.rows) {
    out.push(`── ${r.ordinal}. ${r.title}  [${r.kind}]`);
    out.push(`   depends on   ${r.dependsOn.length ? r.dependsOn.join(", ") : "nothing"}`);
    if (r.signer) out.push(`   signer       ${r.signer}`);
    if (r.method) {
      out.push(`   target       ${r.target.address}  (${r.target.knowledge}${r.target.name ? ` — ${r.target.name}` : ""})`);
      if (r.target.role) out.push(`   its role     ${r.target.role}`);
      out.push(`   method       ${r.signature ?? r.method}   selector ${r.selector ?? "—"}`);
    }
    for (const a of r.arguments) out.push(`     ${pad(a.name, 14)} ${pad(a.type, 10)} ${a.value}${a.meaning ? `   — ${a.meaning}` : ""}`);
    if (r.affects) out.push(`   affects      ${r.affects.name}\n                node ${r.affects.node}\n                resource ${r.affects.resource} (${r.affects.resourceKind})`);
    if (r.roles.granted.length) out.push(`   grants       ${r.roles.granted.join("|")}  ${r.roles.bitmap}`);
    if (r.roles.revoked.length) out.push(`   revokes      ${r.roles.revoked.join("|")}  ${r.roles.bitmap}`);
    out.push(`   admin role   ${r.involvesAdminRole ? "YES" : "no"}        ROOT_RESOURCE  ${r.involvesRootResource ? "YES" : "no"}`);
    if (r.kind === "transaction") out.push(`   value        ${r.value}        gas  ${r.gas.status === "ESTIMATED" ? r.gas.estimateDecimal : r.gas.status}`);
    if (r.batch) {
      out.push(`   batch        ${r.batch.count} calls, each decoded below`);
      for (const c of r.batch.calls) out.push(`     · ${c.signature}  ${c.arguments.map((a) => `${a.name}=${a.value}`).join(", ")}`);
    }
    if (r.expectedEvent) out.push(`   event        ${r.expectedEvent.signature} (${r.expectedEvent.observed})`);
    for (const ps of r.expectedPostState) out.push(`   then         ${ps.read} -> ${ps.expect}`);
    if (r.rollback) out.push(`   rollback     ${r.rollback.how}`);
    for (const f of r.refusals) out.push(`   REFUSED      ${f.code} — ${f.explain}`);
    out.push("");
  }
  out.push(`signable: ${planPreviewIsSignable(preview)}`);
  return out.join("\n");
}
