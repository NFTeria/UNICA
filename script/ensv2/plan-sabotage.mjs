// Break every guard in the delegation planner, one at a time, and require the suite to notice.
//
//   node script/ensv2/plan-sabotage.mjs
//
// WHY THIS IS A COMMITTED FILE AND NOT A SHELL SESSION. `integrations/ensv2/plan-test.mjs` says the
// planner refuses to grant an agent root authority, refuses an admin bit, refuses a grant on the
// merchant's own name, and publishes no policy value. Those are claims about what the code does
// when it is WRONG, and the only way to hold a claim like that is to make the code wrong on purpose
// and watch the suite go red. Done once by hand, that evidence expires the moment somebody edits a
// file. Done here, it is a command anyone can re-run.
//
// HOW IT WORKS, AND WHAT IT IS CAREFUL ABOUT. Each row rewrites ONE exact string in one source file,
// runs the suite in a child process, and requires a non-zero exit. Three things make the result
// trustworthy rather than merely green:
//
//   · A mutation whose search string does not match is a FAILURE OF THIS RUNNER, not a "not caught".
//     A find-and-replace that quietly matches nothing produces a file that still passes, and
//     recording that as "the suite did not catch it" would be exactly backwards.
//   · The originals are copied out before anything is touched and restored in a `finally`, and the
//     run ends by re-hashing every file against the hash taken before the first mutation. A restore
//     that is asserted rather than verified is not a restore.
//   · The child process is the real suite, invoked the same way a person would invoke it. Nothing is
//     re-implemented here, so this runner cannot pass by agreeing with itself.
//
// It writes to the working tree while it runs. If it is killed mid-row, the backups are in the
// directory it names on its first line and the file it was editing is the one row printed last.

import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {copyFileSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";

const ROLES = "integrations/ensv2/roles.mjs";
const PREVIEW = "integrations/ensv2/plan-preview.mjs";
const PLAN = "script/ensv2/plan.mjs";
const SUITE = "integrations/ensv2/plan-test.mjs";
const FILES = [ROLES, PREVIEW, PLAN];

const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");

/// One row per guard. `find` is an exact substring of the file as it stands; `replace` is the
/// broken version. Exact substrings rather than patterns, so a row that stops matching says so
/// instead of matching something adjacent and testing the wrong thing.
///
/// A row may carry `edits: [{file, find, replace}, …]` instead, for a guard that is deliberately
/// enforced in two places. Breaking one half of a redundant guard proves nothing about the suite,
/// because the other half still catches it — so the row breaks both and says that is what it is
/// doing, rather than quietly reporting "not caught" against a suite that is working correctly.
///
/// A row may also carry `expectCaught: false`. That is not an excuse; it is a claim about the code
/// that this runner then checks. It means the guard is a SECOND pass over something a first pass
/// already refuses, so no reachable input can distinguish the broken version — and if a later edit
/// ever makes it reachable, the row flips to caught and this runner fails and says so.
const SABOTAGE = [
  {
    what: "the ROOT_RESOURCE check is deleted from the screen",
    file: ROLES,
    find: "  if (resource === BigInt(P.ROOT_RESOURCE)) {",
    replace: "  if (false) {",
  },
  {
    what: "the admin-bit check is deleted from the screen",
    file: ROLES,
    find: "  if ((bitmap >> P.ADMIN_SHIFT) !== 0n) {",
    replace: "  if (false) {",
  },
  {
    what: "the allowlist check is deleted, so any resolver role may be granted",
    file: ROLES,
    find: "  if ((bitmap & ~allowed.bitmap) !== 0n) {",
    replace: "  if (false) {",
  },
  {
    what: "the delegation resource is taken from the caller instead of derived from node and key",
    file: ROLES,
    find: "  const scope = delegationScope({node: agentNode, kind: \"text\", key: recordKey});",
    replace: "  const scope = opts.scope ?? delegationScope({node: agentNode, kind: \"text\", key: recordKey});",
  },
  {
    what: "the protected-resource list is ignored",
    file: ROLES,
    find: "  const protectedSet = new Set((ctx.protectedResources ?? []).map((r) => lower(asWord(r))));",
    replace: "  const protectedSet = new Set();",
  },
  {
    what: "the agent's existing ROOT_RESOURCE holding stops blocking a grant",
    file: ROLES,
    find: "  if (ctx.agentRootRoles !== undefined && ctx.agentRootRoles !== null && BigInt(ctx.agentRootRoles) !== 0n) {",
    replace: "  if (false) {",
  },
  {
    what: "a missing getAssigneeCount reading is assumed to mean there is room",
    file: ROLES,
    find: "    return refuse(GRANT_STATUS.ASSIGNEE_COUNT_UNOBSERVED, {cap: Number(P.MAX_ASSIGNEES_PER_ROLE)});",
    replace: "    return {ok: true, rows: [], source: \"assumed\"};",
  },
  {
    what: "the assignee counters are read right-aligned instead of per-nybble",
    file: ROLES,
    find: "  const c = P.unpackAssigneeWord(counts, roleBitmap);",
    replace: "  const c = [{bit: 0, count: Number(BigInt(counts) & 0xfn)}];",
  },
  {
    what: "the text-key residual is emptied out of the denial matrix",
    file: ROLES,
    find: "    residual:\n      \"Per-key scoping holds only for a delegation made with authorizeTextRoles.",
    replace: "    residual: null, unusedResidual:\n      \"Per-key scoping holds only for a delegation made with authorizeTextRoles.",
  },
  {
    what: "the preview trusts each step's own admin/root flags instead of recomputing them",
    file: PREVIEW,
    find: "  const flags = call ? roleFlags(call, step?.roleTable ?? ROLE_TABLE.RESOLVER)",
    replace: "  const flags = call ? {isRoleChange: false, involvesAdminRole: step?.involvesAdminRole === true, " +
             "involvesRootResource: step?.involvesRootResource === true, roleBitmap: null, roleNames: null}",
  },
  {
    // Enforced twice on purpose: the row refuses itself, and the signable gate refuses the plan.
    // Breaking either alone leaves the other standing, so both go at once.
    what: "a missing gas estimate stops blocking a signature, in BOTH places it is enforced",
    edits: [
      {file: PREVIEW,
       find: "  if (isTransaction && gas.status === GAS_STATUS.NOT_ESTIMATED) refuse(PREVIEW_REFUSAL.MISSING_GAS, null);",
       replace: ""},
      {file: PREVIEW,
       find: "    if (r.kind === STEP_KIND.TRANSACTION && r.gas.status !== GAS_STATUS.ESTIMATED) return false;",
       replace: ""},
    ],
  },
  {
    what: "a plan with no prepared revocation is allowed to be signable",
    file: PREVIEW,
    find: "  if (!preview.rows.some((r) => r.kind === STEP_KIND.PREPARED && REVOKING_METHODS.has(String(r.method ?? \"\")))) return false;",
    replace: "",
  },
  {
    what: "an admin role is allowed on a step that is not register()",
    file: PREVIEW,
    find: "    if (r.involvesAdminRole && r.method !== \"register\") return false;",
    replace: "",
  },
  {
    what: "a role change is allowed to ride inside a batch",
    file: PREVIEW,
    find: "        refuse(PREVIEW_REFUSAL.BATCH_CARRIES_ROLE_CHANGE, inner.method);",
    replace: "        void inner;",
  },
  {
    what: "every bitmap in the plan is named with the resolver's role table",
    file: PLAN,
    find: "    s.roleTable = registryTargets.has(lower(s.call.to)) ? ROLE_TABLE.REGISTRY : ROLE_TABLE.RESOLVER;",
    replace: "    s.roleTable = ROLE_TABLE.RESOLVER;",
  },
  {
    what: "the raw policy threshold is published as a text record instead of the scheme",
    file: PLAN,
    find: "    recordCall(\"text\", node.treasury, treasuryName, RECORD_KEYS.policyScheme, commitment.scheme),",
    replace: "    recordCall(\"text\", node.treasury, treasuryName, RECORD_KEYS.policyScheme, String(cfg.policy?.thresholdWei)),",
  },
  {
    what: "unmet preconditions stop blocking the plan",
    file: PLAN,
    find: "  const unmet = preconditions.filter((p) => p.required && !p.satisfied);",
    replace: "  const unmet = [];",
  },
  {
    what: "the whole-plan screen's verdict is ignored by the plan builder",
    file: PLAN,
    find: "  if (!screen.ok) return refusePlan(PLAN_STATUS.AGENT_GRANT_REFUSED, {screen});",
    replace: "",
    expectCaught: false,
    why:
      "The plan builder constructs its only two role-changing steps through planAgentGrant and " +
      "planAgentRevoke, and BOTH already run the same screen and refuse before a step exists. So no " +
      "configuration this builder accepts can produce a plan the screen would reject, and deleting " +
      "the second pass changes nothing observable. It is kept because it covers steps this file did " +
      "not build — a step added by hand, or by a later module — and the suite tests it directly by " +
      "injecting exactly those steps. If this row ever flips to caught, the builder has started " +
      "emitting a role change it does not screen at construction, and that is worth knowing.",
  },
  {
    what: "the merchant's registration bitmap loses its admin bits",
    file: PLAN,
    find: "    merchantRegistryBitmap |= BigInt(row.bit) | P.adminRole(BigInt(row.bit));",
    replace: "    merchantRegistryBitmap |= BigInt(row.bit);",
  },
  {
    // The guard that closes the hole per-key resources opened: protectedResources can only ever
    // name ONE scope per protected name, and a delegation now lands at a per-key resource that is
    // not in that list. Before this guard existed, screening a delegation at the pay name's
    // per-key resource was ACCEPTED.
    what: "protected names are checked only by resource, not by node, so a per-key resource slips past",
    file: ROLES,
    find: "  if (g?.node !== undefined && g?.node !== null && protectedNodes.has(lower(g.node))) {",
    replace: "  if (false) {",
  },
  {
    // The bitmap losing its admin bits is caught above by the plan's own rows. THIS row removes the
    // GUARD instead, which is the mutation that matters: a registration missing its admin half is
    // unrepairable, so the check that refuses it has to be the thing that screams, not a downstream
    // assertion about a value that happened to be right.
    what: "the irreversible-registration guard stops refusing a bitmap with no admin half",
    file: PLAN,
    find: "  if (missingAdmin.length > 0) {",
    replace: "  if (false && missingAdmin.length > 0) {",
  },
  {
    what: "the delegation reverts to grantRoles, the call this deployment refuses",
    file: ROLES,
    find: "  if (method === \"grantRoles\" || method === \"revokeRoles\") {",
    replace: "  if (false) {",
  },
  // ── the mode split ─────────────────────────────────────────────────────────────────────────
  //
  // The four rows below break the change that stopped `subtree` mode demanding a PermissionedRegistry
  // the chain never asked it for. Each puts the old defect back in a different way, and the suite has
  // to notice each — otherwise the section that says "subtree mode builds with no registry at all" is
  // a sentence rather than a check.
  {
    what: "subtree mode is made to demand parentSubregistry again — the original defect, restored",
    file: PLAN,
    find: "  if (mode === PLAN_MODE.SUBREGISTRY) required.parentSubregistry = parentSubregistry;",
    replace: "  required.parentSubregistry = parentSubregistry;",
  },
  {
    what: "subtree mode emits the three-transaction registry opening again",
    file: PLAN,
    find: "  if (mode === PLAN_MODE.SUBREGISTRY) {\n  // 1 — the parent gets a subregistry, so that a label may exist under it at all.",
    replace: "  if (true) {\n  // 1 — the parent gets a subregistry, so that a label may exist under it at all.",
  },
  {
    what: "the PARENT's ROLE_SET_RESOLVER reading stops being required, so an unmet plan reads as planned",
    file: PLAN,
    find: "      name: \"the owner holds ROLE_SET_RESOLVER at the PARENT's own resource\",\n      required: true,",
    replace: "      name: \"the owner holds ROLE_SET_RESOLVER at the PARENT's own resource\",\n      required: false,",
  },
  {
    what: "a supplied-but-malformed registry address is silently ignored instead of refused",
    file: PLAN,
    find: "    if (!isAddress(v)) {\n      return refusePlan(PLAN_STATUS.BAD_INPUT, {\n        field: k, value: v,",
    replace: "    if (false) {\n      return refusePlan(PLAN_STATUS.BAD_INPUT, {\n        field: k, value: v,",
  },
];

const backupDir = mkdtempSync(join(tmpdir(), "unica-ensv2-sabotage-"));
console.log("ENSv2 delegation planner — sabotage");
console.log(`originals copied to ${backupDir}`);
for (const f of FILES) copyFileSync(f, join(backupDir, basename(f)));
const before = Object.fromEntries(FILES.map((f) => [f, sha(f)]));
for (const f of FILES) console.log(`  ${before[f]}  ${f}`);

const restore = () => { for (const f of FILES) copyFileSync(join(backupDir, basename(f)), f); };

const suiteExitCode = () => {
  try {
    execFileSync(process.execPath, [SUITE], {stdio: "pipe"});
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
};

let run = 0, caught = 0, missed = 0, broken = 0;

try {
  console.log(`\n— the control: the suite must be GREEN before anything is broken —`);
  run++;
  const baseline = suiteExitCode();
  if (baseline === 0) { caught++; console.log("PASS  the suite passes on the unmodified tree"); }
  else { broken++; console.log(`FAIL  the suite is already red (exit ${baseline}); no row below would mean anything`); }

  if (baseline === 0) {
    console.log(`\n— each mutation must turn the suite RED —`);
    for (const s of SABOTAGE) {
      run++;
      const edits = s.edits ?? [{file: s.file, find: s.find, replace: s.replace}];
      let applied = true;
      for (const e of edits) {
        const src = readFileSync(e.file, "utf8");
        const hits = src.split(e.find).length - 1;
        if (hits !== 1) {
          // The most dangerous outcome this runner can have. A mutation that matched nothing leaves
          // a working file behind, and calling that "not caught" would blame the suite for a defect
          // in this file. It is reported as a broken row instead, and it fails the run.
          applied = false;
          console.log(`FAIL  the mutation did not apply (${hits} matches): ${s.what}`);
          console.log(`      looked for: ${JSON.stringify(e.find.slice(0, 90))} in ${e.file}`);
          break;
        }
        writeFileSync(e.file, src.replace(e.find, e.replace));
      }
      if (!applied) { broken++; restore(); continue; }

      const code = suiteExitCode();
      restore();
      const wasCaught = code !== 0;
      const shouldCatch = s.expectCaught !== false;
      if (wasCaught === shouldCatch) {
        caught++;
        console.log(shouldCatch
          ? `PASS  caught: ${s.what}`
          : `PASS  unreachable as expected: ${s.what}\n      ${s.why}`);
      } else {
        missed++;
        console.log(shouldCatch
          ? `FAIL  NOT caught: ${s.what} — the suite stayed green, so nothing checks this`
          : `FAIL  caught after all: ${s.what} — this guard was recorded as an unreachable second pass and is no longer one`);
      }
    }
  }
} finally {
  restore();
}

console.log(`\n— the files are back, verified by hash and not by assertion —`);
let restored = 0, moved = 0;
for (const f of FILES) {
  run++;
  const after = sha(f);
  if (after === before[f]) { restored++; caught++; console.log(`PASS  ${f} is byte-identical (${after})`); }
  else { moved++; broken++; console.log(`FAIL  ${f} did NOT come back: was ${before[f]}, now ${after} — the original is in ${backupDir}`); }
}

// One more control, because a restore that leaves a broken tree behind would otherwise be invisible
// until somebody else ran the gate.
run++;
const final = suiteExitCode();
if (final === 0) { caught++; console.log("PASS  the suite is green again after every mutation was undone"); }
else { broken++; console.log(`FAIL  the suite is red after restore (exit ${final})`); }

const fail = missed + broken;
console.log(`\nchecks run: ${run}, passed: ${caught}, failed: ${fail}`);
const unreachable = SABOTAGE.filter((s) => s.expectCaught === false).length;
console.log(`mutations: ${SABOTAGE.length}, behaved as expected: ${SABOTAGE.length - missed - broken}, unexpected: ${missed}, ` +
            `rows that failed to apply: ${broken}  (${unreachable} of the mutations are recorded as unreachable second passes)`);
console.log(`files restored: ${restored}, files not restored: ${moved}`);
process.exit(fail > 0 ? 1 : 0);
