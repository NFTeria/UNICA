// The CRE adapter — the suite.
//
// Run: node integrations/chainlink-cre-guardian/adapter-test.mjs   (offline; no CLI, key or RPC)
//
// THE FROZEN POLICY IS THE ORACLE. Every adapter decision is asserted equal to what `strategy.decide`
// returns for the same state, across the whole published price range. An adapter that adjusted an
// amount, or picked a different asset, would be a second policy nobody tested.
//
// EXIT STATUS IS THE VERDICT, not a grep. This file ends by exiting non-zero on any failure, and
// one row deliberately makes a producer throw before printing anything to prove the runner notices.

import {readFileSync} from "node:fs";
import {chdir} from "node:process";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {healthFactor, applyAction} from "./policy.mjs";
import {EXAMPLE_POLICY, OUTCOME, decide} from "./strategy.mjs";
import {ADDRESS_MISMATCH, PROFILES, SELECT_STATUS, selectProfile, validationPlan} from "./profiles.mjs";
import {
  APPROVAL, APPROVAL_MODEL, INTENT, OBSERVATION_STATUS, SELECTOR,
  admitObservation, buildActions, observationCommitment, policyCommitment, step,
} from "./adapter.mjs";
import {EXECUTION_MODE, MODES_THIS_FILE_CANNOT_CLAIM, record, stateCommitment} from "./evidence.mjs";

chdir(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
const F = JSON.parse(readFileSync("integrations/chainlink-cre-guardian/fixtures/scenarios.json", "utf8"));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) pass++; else { fail++; if (detail !== undefined) console.log(`        ${detail}`); }
}
const eq = (n, a, b) => check(n, a === b, `expected ${b}\n        got      ${a}`);
function guard(name, fn) {
  try { return fn(); } catch (e) { check(name, false, `threw: ${e.message}`); return undefined; }
}

const P = () => ({
  collateral: BigInt(F.startingPosition.collateral),
  debt: BigInt(F.startingPosition.debt),
  price: BigInt(F.startingPosition.price),
  freeCollateral: BigInt(F.startingPosition.freeCollateral),
  freeDebtToken: BigInt(F.startingPosition.freeDebtToken),
});
const obs = (over = {}) => ({chainId: 11155111, sequence: 1n, timestamp: 1000n, ...P(), ...over});

// =================================================================================================
console.log("CRE adapter\n— the deployment profiles, chosen and never defaulted —");
eq("naming no profile is refused", selectProfile().status, SELECT_STATUS.NO_PROFILE_NAMED);
eq("an unknown profile is refused", selectProfile("PROD").status, SELECT_STATUS.UNKNOWN_PROFILE);
check("both profiles exist", Object.keys(PROFILES).length === 2
  && !!PROFILES.README_PROFILE && !!PROFILES.STAGING_CONFIG_PROFILE);
for (const name of Object.keys(PROFILES)) {
  const s = selectProfile(name);
  check(`${name} selects, and carries its source`, s.ok && !!s.profile.source && !!s.profile.sourceCommit);
  eq(`${name} is on Ethereum Sepolia`, s.profile.chainId, 11155111);
  eq(`${name} declares two decimals`, s.profile.decimals, 2);
  check(`${name} has a validation plan rather than a live check`,
    validationPlan(s.profile).length >= 6 && validationPlan(s.profile).every((c) => !!c.method));
}
check("the two profiles really do disagree on all three addresses",
  ["lending", "vETH", "vUSD"].every((f) =>
    PROFILES.README_PROFILE[f].toLowerCase() !== PROFILES.STAGING_CONFIG_PROFILE[f].toLowerCase()));
eq("the mismatch is recorded as unresolved", ADDRESS_MISMATCH.status, "UNRESOLVED_MISMATCH");
check("and public deployment is marked blocked because of it",
  /BLOCKED/.test(ADDRESS_MISMATCH.publicDeployment));

console.log("— address mixing is refused by name —");
for (const field of ["lending", "vETH", "vUSD"]) {
  const s = selectProfile("README_PROFILE", {overrides: {[field]: PROFILES.STAGING_CONFIG_PROFILE[field]}});
  check(`a ${field} from the other profile is refused`, !s.ok && s.status === SELECT_STATUS.MIXED_PROFILES, s.detail);
  check(`... and the refusal names which profile it came from`, /STAGING_CONFIG_PROFILE/.test(s.detail));
}
check("an address in neither profile is refused",
  selectProfile("README_PROFILE", {overrides: {lending: "0x" + "ab".repeat(20)}}).status === SELECT_STATUS.MIXED_PROFILES);
check("a malformed address is refused",
  selectProfile("README_PROFILE", {overrides: {lending: "0xnope"}}).status === SELECT_STATUS.MALFORMED_ADDRESS);
eq("the wrong chain is refused", selectProfile("README_PROFILE", {expectedChainId: 1}).status, SELECT_STATUS.WRONG_CHAIN);
eq("an observation on the wrong chain refuses the whole step",
  step({profileName: "README_PROFILE", observation: obs({chainId: 1}), policy: EXAMPLE_POLICY}).intent, INTENT.REFUSAL);

// =================================================================================================
console.log("— the adapter agrees with the frozen policy, everywhere —");
{
  let compared = 0, disagreed = 0;
  for (let price = 130000n; price <= 220000n; price += 500n) {
    for (const free of [[500n, 300000n], [0n, 300000n], [500n, 0n], [0n, 0n], [130n, 3000000n]]) {
      const o = obs({price, freeCollateral: free[0], freeDebtToken: free[1]});
      const direct = decide({...P(), price, freeCollateral: free[0], freeDebtToken: free[1]},
                            EXAMPLE_POLICY, {now: o.timestamp});
      const viaAdapter = step({profileName: "README_PROFILE", observation: o, policy: EXAMPLE_POLICY});
      compared++;
      if (viaAdapter.decision.outcome !== direct.outcome
          || viaAdapter.decision.amount !== direct.amount
          || viaAdapter.decision.asset !== direct.asset) disagreed++;
    }
  }
  check(`the adapter's decision equals the direct one in every case (${compared})`,
    disagreed === 0 && compared > 900, `${disagreed} disagreements of ${compared}`);
}

console.log("— an intent becomes exactly one shape, or nothing —");
{
  const dep = step({profileName: "README_PROFILE", observation: obs({price: 175000n}), policy: EXAMPLE_POLICY});
  eq("a falling price produces DEPOSIT_COLLATERAL", dep.intent, INTENT.DEPOSIT_COLLATERAL);
  eq("... which builds an approve and a deposit", dep.transactions.length, 2);
  eq("... approving on vETH", dep.transactions[0].to, PROFILES.README_PROFILE.vETH);
  eq("... to the lending contract and nothing else", dep.transactions[0].decoded.spender, PROFILES.README_PROFILE.lending);
  eq("... and calling the lending contract", dep.transactions[1].to, PROFILES.README_PROFILE.lending);
  eq("... with deposit(uint256)", dep.transactions[1].data.slice(0, 10), SELECTOR.deposit);
  eq("... for exactly the policy's amount", dep.transactions[1].decoded.amount, dep.decision.amount.toString());
  check("... and never calls repay", !dep.transactions.some((t) => t.data.startsWith(SELECTOR.repay)));

  // Collateral scarce, debt token abundant, and the caps widened so the choice is made on cost
  // rather than on a cap. Under the tighter example caps the repayment is excluded outright, which
  // is itself correct and is covered by the D3 suite.
  const scarce = obs({price: 175000n, freeCollateral: 130n, freeDebtToken: 3000000n});
  const openCaps = {...EXAMPLE_POLICY, maxDepositUnits: 100000n, maxRepayPctBps: 10000n};
  const rep = step({profileName: "README_PROFILE", observation: scarce, policy: openCaps});
  eq("a position where repaying is cheaper produces REPAY_DEBT", rep.intent, INTENT.REPAY_DEBT);
  eq("... approving on vUSD", rep.transactions[0].to, PROFILES.README_PROFILE.vUSD);
  eq("... with repay(uint256)", rep.transactions[1].data.slice(0, 10), SELECTOR.repay);
  check("... and never calls deposit", !rep.transactions.some((t) => t.data.startsWith(SELECTOR.deposit)));

  for (const [label, o] of [
    ["a healthy position", obs({price: 220000n})],
    ["a warning", obs({price: 200000n})],
  ]) {
    const r = step({profileName: "README_PROFILE", observation: o, policy: EXAMPLE_POLICY});
    check(`${label} emits no transaction`, r.transactions.length === 0, `${r.intent} produced ${r.transactions.length}`);
  }
  const broke = step({profileName: "README_PROFILE",
    observation: obs({price: 150000n, freeCollateral: 0n, freeDebtToken: 0n}), policy: EXAMPLE_POLICY});
  check("insufficient capital emits no transaction", broke.transactions.length === 0);
  eq("... and is not a deposit or a repay intent", broke.intent, INTENT.REFUSAL);
}

console.log("— there is no parameter that could redirect a call —");
{
  // The strongest statement available: the builder's signature has no target argument at all, so
  // "arbitrary calldata" is not a thing a caller can ask for.
  check("buildActions takes no target and no calldata parameter",
    !/\b(target|to|calldata|data)\s*[,)]/.test(buildActions.toString().split("{")[0]));
  const built = buildActions(PROFILES.README_PROFILE, INTENT.DEPOSIT_COLLATERAL, 100n, APPROVAL.EXACT);
  check("every target comes from the profile",
    built.every((t) => [PROFILES.README_PROFILE.vETH, PROFILES.README_PROFILE.lending].includes(t.to)));
  check("only three selectors can ever appear",
    built.every((t) => Object.values(SELECTOR).includes(t.data.slice(0, 10))));
  check("an action with no amount is refused", (() => {
    try { buildActions(PROFILES.README_PROFILE, INTENT.REPAY_DEBT, 0n, APPROVAL.EXACT); return false; }
    catch { return true; }
  })());
  const exact = buildActions(PROFILES.README_PROFILE, INTENT.REPAY_DEBT, 250n, APPROVAL.EXACT);
  eq("EXACT approval approves exactly the amount", exact[0].decoded.amount, "250");
  const once = buildActions(PROFILES.README_PROFILE, INTENT.REPAY_DEBT, 250n, APPROVAL.MAX_ONCE);
  check("MAX_ONCE approves the maximum", BigInt(once[0].decoded.amount) === (1n << 256n) - 1n);
  const pre = buildActions(PROFILES.README_PROFILE, INTENT.REPAY_DEBT, 250n, APPROVAL.PRE_APPROVED);
  eq("PRE_APPROVED emits the action alone", pre.length, 1);
  const cached = buildActions(PROFILES.README_PROFILE, INTENT.REPAY_DEBT, 250n, APPROVAL.MAX_ONCE, {allowance: 10n ** 30n});
  eq("an existing allowance skips the approval", cached.length, 1);
}

console.log("— the approval model, established from the contracts —");
{
  eq("a deposit needs a vETH allowance to the lending contract", APPROVAL_MODEL.DEPOSIT_COLLATERAL.token, "vETH");
  eq("a repay needs a vUSD allowance to the lending contract", APPROVAL_MODEL.REPAY_DEBT.token, "vUSD");
  check("both name the lending contract as the spender",
    APPROVAL_MODEL.DEPOSIT_COLLATERAL.spender === "lending" && APPROVAL_MODEL.REPAY_DEBT.spender === "lending");
  check("the repay path is recorded as going through burnFrom, which spends allowance",
    /burnFrom/.test(APPROVAL_MODEL.REPAY_DEBT.contractCall));
  check("the allowance is observable rather than assumed", /allowance\(/.test(APPROVAL_MODEL.observable));
  check("approval can be prepared before the scenario starts", APPROVAL_MODEL.preparableBeforeStart === true);
  check("the ADMIN_ROLE requirement on vUSD.burnFrom is recorded", /ADMIN_ROLE/.test(APPROVAL_MODEL.note));
}

console.log("— observations: stale, duplicate, reordered —");
{
  eq("an observation with no sequence is refused",
    admitObservation({timestamp: 1n}).status, OBSERVATION_STATUS.NO_SEQUENCE);
  eq("an observation with no timestamp is refused",
    admitObservation({sequence: 1n}).status, OBSERVATION_STATUS.NO_TIMESTAMP);
  eq("the same sequence twice is refused",
    admitObservation({sequence: 5n, timestamp: 1n}, {lastSequence: 5n}).status, OBSERVATION_STATUS.DUPLICATE_SEQUENCE);
  eq("an earlier sequence after a later one is refused",
    admitObservation({sequence: 4n, timestamp: 1n}, {lastSequence: 5n}).status, OBSERVATION_STATUS.REORDERED_SEQUENCE);
  check("the next sequence is accepted", admitObservation({sequence: 6n, timestamp: 1n}, {lastSequence: 5n}).ok);
  eq("an observation older than the limit is refused",
    admitObservation({sequence: 1n, timestamp: 100n}, {now: 1000n, maxObservationAge: 60n}).status,
    OBSERVATION_STATUS.STALE_OBSERVATION);
  eq("an observation from the future is refused",
    admitObservation({sequence: 1n, timestamp: 2000n}, {now: 1000n, maxObservationAge: 60n}).status,
    OBSERVATION_STATUS.STALE_OBSERVATION);
  check("a fresh observation is accepted",
    admitObservation({sequence: 1n, timestamp: 990n}, {now: 1000n, maxObservationAge: 60n}).ok);
  for (const bad of [{lastSequence: 1n}, {lastSequence: 2n}]) {
    const r = step({profileName: "README_PROFILE", observation: obs({sequence: 1n, price: 150000n}),
                    policy: EXAMPLE_POLICY, memory: bad});
    check(`a rejected observation refuses the whole step (last=${bad.lastSequence})`,
      r.intent === INTENT.REFUSAL && r.transactions.length === 0, r.reason);
  }
}

console.log("— pending, retry, and rereading the state —");
{
  const o = obs({price: 150000n});
  const pending = step({profileName: "README_PROFILE", observation: o, policy: EXAMPLE_POLICY, memory: {pending: true}});
  check("a pending action suppresses a duplicate and sends nothing",
    pending.transactions.length === 0 && pending.decision.outcome === OUTCOME.PENDING_ACTION);
  const retry = step({profileName: "README_PROFILE", observation: obs({price: 150000n, sequence: 2n}),
                      policy: EXAMPLE_POLICY, memory: {pending: false, lastSequence: 1n}});
  check("a cleared pending flag lets the next observation act", retry.transactions.length === 2);

  // After a successful action the state must be REREAD: deciding from the old position would act
  // twice on one problem.
  const after = applyAction({...P(), price: 150000n}, {asset: "COLLATERAL", amount: retry.decision.amount});
  const next = step({profileName: "README_PROFILE",
    observation: obs({...after, price: 150000n, sequence: 3n}), policy: EXAMPLE_POLICY, memory: {lastSequence: 2n}});
  check("rereading the repaired state produces no second action", next.transactions.length === 0, next.intent);
  check("and the repaired position really is above the target",
    healthFactor(after) >= EXAMPLE_POLICY.targetHf, String(healthFactor(after)));
}

console.log("— cadence —");
{
  // The example ships "0 */5 * * * *". A faster cadence sees more of the path; whether the DON
  // permits it is NOT established here and the row says so rather than assuming.
  const path = F.scenarios[1].prices.map(BigInt);          // the sudden crash
  const run = (everyNth) => {
    let pos = P(), seq = 0n, actions = 0, died = false;
    for (let i = 0; i < path.length; i++) {
      pos = {...pos, price: path[i]};
      if (i % everyNth === 0) {
        seq += 1n;
        const r = step({profileName: "README_PROFILE",
          observation: {chainId: 11155111, sequence: seq, timestamp: 1000n * seq, ...pos},
          policy: EXAMPLE_POLICY, memory: {lastSequence: seq - 1n}});
        if (r.transactions.length) {
          pos = applyAction(pos, {asset: r.decision.asset, amount: r.decision.amount});
          actions++;
        }
      }
      if (healthFactor(pos) <= 100n) died = true;
    }
    return {died, actions};
  };
  const every = run(1);
  const everyOther = run(2);
  check("observing every price update survives the sudden crash", !every.died, `${every.actions} actions`);
  // MEASURED, and it is the number that decides the cron schedule: halving the observation rate
  // loses this scenario outright, because the very first update is already below the line and a
  // tick that never happens cannot react to it.
  check("observing every SECOND update loses it", everyOther.died,
    `it survived with ${everyOther.actions} actions, which would contradict the measurement`);
  // Missing an observation entirely is the case that actually loses, and it is worth having a row
  // say so rather than discovering it on the day.
  let pos = P();
  for (const px of path) pos = {...pos, price: px};
  check("skipping every observation loses the crash scenario", healthFactor(pos) <= 100n, String(healthFactor(pos)));
  check("the deployable cadence is NOT claimed here",
    !/deployable|permitted|allowed/i.test(readFileSync("integrations/chainlink-cre-guardian/adapter.mjs", "utf8")
      .match(/five-minute[\s\S]{0,200}/)?.[0] ?? ""));
}

console.log("— local evidence says what it is, and cannot say more —");
{
  const before = {...P(), price: 150000n};
  const s = step({profileName: "README_PROFILE", observation: obs({price: 150000n}), policy: EXAMPLE_POLICY});
  const after = applyAction(before, {asset: s.decision.asset, amount: s.decision.amount});
  const r = record({workflowVersion: "0.1.0", configVersion: "1", profile: "README_PROFILE",
                    step: s, before, after, timestamp: 1000n});
  eq("the mode is a local simulation", r.executionMode, EXECUTION_MODE.LOCAL_SIMULATION);
  check("no record can claim a TEE or DON mode",
    !MODES_THIS_FILE_CANNOT_CLAIM.includes(r.executionMode)
    && !MODES_THIS_FILE_CANNOT_CLAIM.some((m) => JSON.stringify(r).includes(`"${m}"`)));
  check("the disclaimer says so in words too", /NOT a TEE attestation/.test(r.disclaimer));
  eq("there is no transaction reference in local mode", r.transactionReference, null);
  check("both state commitments are present and different",
    r.preStateCommitment !== r.postStateCommitment && !!r.postStateCommitment);
  check("the policy is committed to WITHOUT revealing it",
    !!r.policyCommitment && !JSON.stringify(r).includes(String(EXAMPLE_POLICY.triggerHf) + ","));
  check("the health factor improved and both readings are recorded",
    BigInt(r.healthFactorAfter) > BigInt(r.healthFactorBefore));
  const again = record({workflowVersion: "0.1.0", configVersion: "1", profile: "README_PROFILE",
                        step, before, after, timestamp: 1000n});
  check("the record is deterministic given the same fixture time",
    JSON.stringify(record({workflowVersion: "0.1.0", configVersion: "1", profile: "README_PROFILE",
      step: s, before, after, timestamp: 1000n})) === JSON.stringify(r));
  check("a different policy commits differently",
    policyCommitment({...EXAMPLE_POLICY, triggerHf: 109n}) !== policyCommitment(EXAMPLE_POLICY));
  check("a different observation commits differently",
    observationCommitment({...obs(), profile: "A"}) !== observationCommitment({...obs(), profile: "B"}));
}

console.log("— the runner's own verdict —");
{
  // The regression this repository has now been bitten by four times: a producer that throws before
  // printing anything must still fail. Proved by running one in a child process and reading its
  // EXIT STATUS rather than its output.
  const {execFileSync} = await import("node:child_process");
  let exitCode = 0;
  try {
    execFileSync(process.execPath, ["-e", "throw new Error('died before printing a verdict')"],
      {stdio: "pipe"});
  } catch (e) {
    exitCode = e.status;
  }
  check("a producer that throws before printing exits non-zero", exitCode !== 0, `exit ${exitCode}`);
  check("and this suite reports its own verdict through the exit status, not through its text",
    /process.exit\(fail === 0 \? 0 : 1\)/.test(
      readFileSync("integrations/chainlink-cre-guardian/adapter-test.mjs", "utf8")));
}

console.log(`\nrows run: ${pass + fail}, passed: ${pass}, failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
