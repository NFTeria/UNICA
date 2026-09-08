// The CRE liquidation-protection policy — the suite.
//
// Run: node integrations/chainlink-cre-guardian/test.mjs      (offline, no CRE CLI, no key, no RPC)
//
// THE MODEL IS CHECKED AGAINST THE CONTRACT'S OWN FORMULA, not against itself. Every projected
// health factor is recomputed with `healthFactor` after the action is applied, so a rounding
// direction chosen wrongly shows up as a position one unit short of its target rather than as a
// number this file agreed with because it produced it.
//
// STREAMED, and a throw becomes a NAMED failing row.

import {readFileSync} from "node:fs";
import {chdir} from "node:process";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {
  LIQUIDATION_HF, LIQUI_THRESHOLD, applyAction, depositToReach, healthFactor,
  firstSafePrice, isLiquidatable, liquidationPrice, repayToReach, roomToLiquidationBps,
} from "./policy.mjs";
import {EXAMPLE_POLICY, OUTCOME, REASON, candidateActions, decide, select} from "./strategy.mjs";
import {loanContinuityBps, runScenario, worstPrice} from "./simulate.mjs";

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

const S = () => ({
  collateral: BigInt(F.startingPosition.collateral),
  debt: BigInt(F.startingPosition.debt),
  price: BigInt(F.startingPosition.price),
  freeCollateral: BigInt(F.startingPosition.freeCollateral),
  freeDebtToken: BigInt(F.startingPosition.freeDebtToken),
});
const at = (price, over = {}) => ({...S(), price: BigInt(price), ...over});

// =================================================================================================
console.log("CRE liquidation protection\n— the integer model agrees with the contract —");
eq("the liquidation threshold is the contract's 78", LIQUI_THRESHOLD, 78n);
eq("liquidation happens at hf <= 100, not below it", LIQUIDATION_HF, 100n);
eq("the starting position's health factor", healthFactor(S()), 111n);
check("which is the ~1.11 the README states", healthFactor(S()) === 111n);
// The formula, recomputed here from the transcription rather than called, so a change to policy.mjs
// that quietly altered it would disagree with this row.
{
  const p = S();
  const byHand = (p.collateral * p.price * 78n) / (100n * p.debt);
  eq("the health factor is collateral x price x 78 / (100 x debt), floored", healthFactor(p), byHand);
}
check("a position with no debt has no health factor rather than a huge one",
  healthFactor({...S(), debt: 0n}) === null);

console.log("— the number that decides everything: where the line actually is —");
{
  // The boundary is computed from the SAFE side, because the contract floors: the price at which
  // hf reaches 100 is not the highest price that kills, and the first draft of this model had it
  // one step wrong until this row said so.
  const lp = liquidationPrice(S());
  const safe = firstSafePrice(S());
  eq("the first price at which the untouched position survives", safe, 181283n);
  eq("so the highest fatal price is one unit below it", lp, safe - 1n);
  check("the first safe price really is safe", !isLiquidatable(at(safe)), `hf ${healthFactor(at(safe))}`);
  check("one unit below it is fatal", isLiquidatable(at(lp)), `hf ${healthFactor(at(lp))}`);
  check("and every price below that is fatal too", isLiquidatable(at(lp - 1n)) && isLiquidatable(at(lp - 1000n)));
  check("the room to that line is under ten percent of the starting price",
    roomToLiquidationBps(S()) < 1000n, `${roomToLiquidationBps(S())} bps`);
}

console.log("— the finding that inverts the naive strategy —");
{
  // Every published scenario, walked with NO action at all.
  const dead = [];
  for (const sc of F.scenarios) {
    const anyDead = sc.prices.some((px) => isLiquidatable(at(px)));
    if (anyDead) dead.push(sc.name);
  }
  eq("every published scenario liquidates an untouched position", dead.length, F.scenarios.length);
  check("including the one called 'safe volatility'", dead.includes("safe volatility"), dead.join(", "));
  // The specific reason, because it is a boundary case and boundaries are where models are wrong.
  eq("at 1800.00 the health factor floors to exactly 100", healthFactor(at(180000n)), 100n);
  check("and 100 is liquidatable, so 'do nothing' loses that scenario too", isLiquidatable(at(180000n)));
}

console.log("— rounding is conservative in both directions —");
{
  // A deposit must round UP: the contract floors when it recomputes, so rounding down lands one
  // unit short of the target. Checked across a range rather than at one convenient point.
  let checkedD = 0, shortD = 0;
  for (let px = 140000n; px <= 200000n; px += 1000n) {
    for (const target of [101n, 105n, 110n, 118n, 125n]) {
      const p = at(px);
      const need = depositToReach(p, target);
      if (need === 0n) continue;
      checkedD++;
      const after = healthFactor(applyAction({...p, freeCollateral: need}, {asset: "COLLATERAL", amount: need}));
      if (after < target) shortD++;
      // And it must be MINIMAL: one unit less must miss.
      if (need > 0n) {
        const less = healthFactor({...p, collateral: p.collateral + need - 1n});
        if (less >= target) shortD++;
      }
    }
  }
  check(`a deposit always reaches its target and never overshoots by a whole unit (${checkedD} cases)`,
    shortD === 0 && checkedD > 100, `${shortD} bad of ${checkedD}`);

  let checkedR = 0, shortR = 0;
  for (let px = 140000n; px <= 200000n; px += 1000n) {
    for (const target of [101n, 105n, 110n, 118n, 125n]) {
      const p = at(px);
      const need = repayToReach(p, target);
      if (need === 0n || need > p.debt) continue;
      checkedR++;
      const after = healthFactor({...p, debt: p.debt - need});
      if (after < target) shortR++;
      const less = healthFactor({...p, debt: p.debt - need + 1n});
      if (less >= target) shortR++;
    }
  }
  check(`a repayment always reaches its target and is minimal (${checkedR} cases)`,
    shortR === 0 && checkedR > 100, `${shortR} bad of ${checkedR}`);
}

console.log("— the thresholds, one unit either side of every one —");
{
  const policy = {...EXAMPLE_POLICY, triggerHf: 108n, warningBandHf: 6n};
  // hf > trigger + band -> nothing; inside the band -> warn; at or below trigger -> act.
  const atHf = (hf) => {
    // Build a position whose floored hf is exactly `hf` by choosing the debt.
    const p = S();
    const debt = (p.collateral * p.price * 78n) / (100n * hf);
    return {...p, debt};
  };
  for (const [hf, want] of [[120n, OUTCOME.NO_ACTION], [115n, OUTCOME.NO_ACTION],
                            [114n, OUTCOME.WARNING], [109n, OUTCOME.WARNING],
                            [108n, OUTCOME.DEPOSIT_COLLATERAL], [107n, OUTCOME.DEPOSIT_COLLATERAL]]) {
    const p = atHf(hf);
    const d = decide(p, policy);
    check(`hf ${hf} -> ${want}`, d.outcome === want && healthFactor(p) === hf,
      `got ${d.outcome} at hf ${healthFactor(p)}`);
  }
  check("a warning transacts nothing", decide(atHf(110n), policy).amount === 0n);
  check("and names no asset", decide(atHf(110n), policy).asset === null);
}

console.log("— capital: what happens when there is not enough —");
{
  const policy = {...EXAMPLE_POLICY, maxDepositUnits: 100000n, maxRepayPctBps: 10000n};
  const broke = at(150000n, {freeCollateral: 0n, freeDebtToken: 0n});
  const d = decide(broke, policy);
  eq("no capital at all is INSUFFICIENT_CAPITAL", d.outcome, OUTCOME.INSUFFICIENT_CAPITAL);
  eq("... with a reason naming both assets", d.reason, REASON.NEITHER_ASSET_SUFFICES);
  check("... and it still reports what it would have needed",
    d.candidates.length === 2 && d.candidates.every((c) => c.amount > 0n));

  const onlyVusd = at(150000n, {freeCollateral: 0n});
  eq("only the debt token available -> repay", decide(onlyVusd, policy).outcome, OUTCOME.REPAY_DEBT);
  const onlyVeth = at(150000n, {freeDebtToken: 0n});
  eq("only collateral available -> deposit", decide(onlyVeth, policy).outcome, OUTCOME.DEPOSIT_COLLATERAL);

  // A cap can make an otherwise affordable action unaffordable, which is the point of a cap. This
  // is the ONLY thing the availability check in candidateActions decides on its own: running out
  // of an asset is caught a second time by applyAction, so that guard is defence in depth rather
  // than the load-bearing one. Both are asserted, separately, so neither is mistaken for the other.
  const capped = decide(at(150000n), {...EXAMPLE_POLICY, maxDepositUnits: 1n, maxRepayPctBps: 1n});
  eq("caps that exclude both candidates are INSUFFICIENT_CAPITAL", capped.outcome, OUTCOME.INSUFFICIENT_CAPITAL);
  eq("a cap on one asset alone pushes the choice to the other",
    decide(at(150000n), {...EXAMPLE_POLICY, maxDepositUnits: 1n, maxRepayPctBps: 10000n}).outcome,
    OUTCOME.REPAY_DEBT);
}

console.log("— choosing between two possible actions —");
{
  const p = at(175000n);
  const cands = candidateActions(p, {...EXAMPLE_POLICY, maxDepositUnits: 100000n, maxRepayPctBps: 10000n}, 118n);
  check("both candidates are computed every time, not just the chosen one", cands.length === 2);
  check("both are affordable in this position", cands.every((c) => c.affordable));
  const dep = cands.find((c) => c.asset === "COLLATERAL");
  const rep = cands.find((c) => c.asset === "DEBT_TOKEN");
  // Not ">= target" — that would accept any large number, and a mutation that simply asserted
  // one survived this row until it was written as an EQUALITY against the model.
  check("the deposit's projection is recomputed, not asserted",
    dep.projectedHf === healthFactor(applyAction(p, {asset: "COLLATERAL", amount: dep.amount})),
    `${dep.projectedHf} vs recomputed`);
  check("the repayment's projection is recomputed, not asserted",
    rep.projectedHf === healthFactor(applyAction(p, {asset: "DEBT_TOKEN", amount: rep.amount})),
    `${rep.projectedHf} vs recomputed`);
  check("the deposit reaches the target", dep.projectedHf >= 118n, String(dep.projectedHf));
  check("the repayment reaches the target", rep.projectedHf >= 118n, String(rep.projectedHf));
  check("only the repayment costs loan continuity",
    dep.continuityImpactBps === 0n && rep.continuityImpactBps > 0n);
  eq("CHEAPER_RELATIVE picks the smaller share of its own asset",
    select(cands, "CHEAPER_RELATIVE").asset, dep.capitalUsedBps <= rep.capitalUsedBps ? "COLLATERAL" : "DEBT_TOKEN");
  eq("PRESERVE_CONTINUITY always picks collateral", select(cands, "PRESERVE_CONTINUITY").asset, "COLLATERAL");
  // A position where the two policies genuinely disagree: collateral is scarce relative to what
  // is needed, so the repayment is the cheaper SHARE while the deposit is the one that keeps the
  // loan open. If no such position existed the selector would be decoration.
  const scarce = at(175000n, {freeCollateral: 130n, freeDebtToken: 3000000n});
  const c2 = candidateActions(scarce, {...EXAMPLE_POLICY, maxDepositUnits: 100000n, maxRepayPctBps: 10000n}, 118n);
  const d2 = c2.find((c) => c.asset === "COLLATERAL");
  const r2 = c2.find((c) => c.asset === "DEBT_TOKEN");
  check("a position exists where the cheaper share and the continuity-preserving choice differ",
    d2.affordable && r2.affordable && r2.capitalUsedBps < d2.capitalUsedBps,
    `deposit ${d2.capitalUsedBps} bps vs repay ${r2.capitalUsedBps} bps`);
  eq("CHEAPER_RELATIVE takes the repayment there", select(c2, "CHEAPER_RELATIVE").asset, "DEBT_TOKEN");
  eq("PRESERVE_CONTINUITY still takes the deposit", select(c2, "PRESERVE_CONTINUITY").asset, "COLLATERAL");
  check("so the selector changes the answer and is not decoration",
    select(c2, "CHEAPER_RELATIVE").asset !== select(c2, "PRESERVE_CONTINUITY").asset);
}

console.log("— the workflow's memory between ticks —");
{
  const p = at(150000n);
  eq("an action already in flight suppresses another",
    decide(p, EXAMPLE_POLICY, {pending: true}).outcome, OUTCOME.PENDING_ACTION);
  eq("... naming the reason", decide(p, EXAMPLE_POLICY, {pending: true}).reason, REASON.ACTION_ALREADY_IN_FLIGHT);
  check("a suppressed tick transacts nothing", decide(p, EXAMPLE_POLICY, {pending: true}).amount === 0n);

  // A failed action clears `pending`, and the next tick must be free to act again.
  eq("a cleared pending flag permits a retry",
    decide(p, EXAMPLE_POLICY, {pending: false}).outcome, OUTCOME.DEPOSIT_COLLATERAL);

  // A repeated tick at the SAME price after a successful action must not act again, because the
  // position has already been repaired — the decision is made on state, not on a counter.
  const repaired = applyAction(p, {asset: "COLLATERAL", amount: depositToReach(p, 118n)});
  eq("a repeated tick after a successful action does nothing",
    decide(repaired, EXAMPLE_POLICY).outcome, OUTCOME.NO_ACTION);

  const cool = {...EXAMPLE_POLICY, cooldownSeconds: 600n};
  eq("a cooldown suppresses a non-critical second action",
    decide(atHfSafe(107n), cool, {lastActionAt: 0n, now: 100n}).outcome, OUTCOME.PENDING_ACTION);
  // But never when the position is already over the line: a quiet period is a preference, and
  // being liquidated is the thing the whole workflow exists to prevent.
  eq("a cooldown NEVER holds a position that is already liquidatable",
    decide(at(150000n), cool, {lastActionAt: 0n, now: 100n}).outcome, OUTCOME.DEPOSIT_COLLATERAL);
}
function atHfSafe(hf) {
  const p = S();
  return {...p, debt: (p.collateral * p.price * 78n) / (100n * hf)};
}

console.log("— degenerate and hostile inputs —");
{
  eq("a zero price is INVALID_STATE", decide(at(0n)).outcome, OUTCOME.INVALID_STATE);
  eq("... with a named reason", decide(at(0n)).reason, REASON.NO_PRICE);
  eq("no debt means nothing to protect", decide({...S(), debt: 0n}).outcome, OUTCOME.NO_ACTION);
  eq("... and it says so", decide({...S(), debt: 0n}).reason, REASON.NO_DEBT);
  eq("no collateral is INVALID_STATE", decide({...S(), collateral: 0n}).outcome, OUTCOME.INVALID_STATE);
  for (const missing of ["collateral", "debt", "price", "freeCollateral", "freeDebtToken"]) {
    const broken = {...S()};
    delete broken[missing];
    eq(`a position missing ${missing} is INVALID_STATE`, decide(broken).outcome, OUTCOME.INVALID_STATE);
  }
  eq("a negative field is INVALID_STATE", decide({...S(), debt: -1n}).outcome, OUTCOME.INVALID_STATE);
  check("a huge but valid position does not overflow",
    guard("a huge but valid position does not overflow",
      () => healthFactor({collateral: 10n ** 30n, debt: 10n ** 30n, price: 10n ** 30n})) !== undefined);
  check("applying more than is available is refused", (() => {
    try { applyAction(S(), {asset: "COLLATERAL", amount: 10n ** 9n}); return false; } catch { return true; }
  })());
  check("repaying more than the debt is refused", (() => {
    try { applyAction({...S(), freeDebtToken: 10n ** 9n}, {asset: "DEBT_TOKEN", amount: 10n ** 9n}); return false; }
    catch { return true; }
  })());
}

// =================================================================================================
console.log("— every published scenario, end to end —");
{
  for (const sc of F.scenarios) {
    const r = guard(sc.name, () => runScenario({
      prices: sc.prices, startingPosition: F.startingPosition, secondsPerUpdate: F.secondsPerUpdate,
    }));
    if (!r) continue;
    check(`${sc.name}: survives every tick`, r.survivedEveryTick && !r.liquidated,
      r.ticks.map((t) => `${t.price}:${t.hfAfter}`).join(" "));
    check(`${sc.name}: keeps the whole loan open`, r.loanContinuityBps === 10000n, `${r.loanContinuityBps} bps`);
    console.log(`        ${r.interventions} action(s), ${r.collateralUsed} vETH units, ` +
      `${r.debtTokenUsed} vUSD units, continuity ${r.loanContinuityBps} bps`);
  }
  // The scenario the README expects the LEAST action in must not be the one that spends most.
  const wick = runScenario({prices: F.scenarios[2].prices, startingPosition: F.startingPosition});
  const crash = runScenario({prices: F.scenarios[1].prices, startingPosition: F.startingPosition});
  check("the temporary wick costs less than the sudden crash",
    wick.collateralUsed < crash.collateralUsed, `${wick.collateralUsed} vs ${crash.collateralUsed}`);
  check("no scenario ever repays debt under the example policy",
    F.scenarios.every((sc) => runScenario({prices: sc.prices, startingPosition: F.startingPosition}).debtTokenUsed === 0n));
}

console.log("— loan continuity is the README's formula —");
{
  eq("a loan held whole for the whole time is 10000 bps",
    loanContinuityBps([{debt: 700000n, duration: 300n}, {debt: 700000n, duration: 300n}], 700000n, 600n), 10000n);
  eq("a loan halved for half the time is 7500 bps",
    loanContinuityBps([{debt: 700000n, duration: 300n}, {debt: 350000n, duration: 300n}], 700000n, 600n), 7500n);
  eq("a loan closed immediately is 0 bps",
    loanContinuityBps([{debt: 0n, duration: 600n}], 700000n, 600n), 0n);
  check("a zero initial debt has no continuity rather than a division by zero",
    loanContinuityBps([], 0n, 600n) === null);
  eq("the worst price in the published set is 1450.00", worstPrice(F.scenarios[1].prices), 145000n);
}

console.log("— the policy values are not in the public code —");
{
  const source = ["policy.mjs", "strategy.mjs", "simulate.mjs"]
    .map((f) => readFileSync(`integrations/chainlink-cre-guardian/${f}`, "utf8")).join("\n");
  check("no private key, endpoint or credential name appears",
    !/PRIVATE_KEY|SECRET|API_KEY|0x[0-9a-fA-F]{64}/.test(source));
  check("the only thresholds in the code are the README's published example",
    source.includes("triggerHf: 108n") && source.includes("targetHf: 118n"));
  check("and they are labelled as the published example, not as a strategy",
    /README's own illustrative example/.test(source));
  check("scoring weights are not compiled into the safety engine",
    !/\b(40|20|15|10)\s*\*\s*(score|weight)/i.test(source) && !/scoreWeights/.test(source));
}

console.log(`\nrows run: ${pass + fail}, passed: ${pass}, failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
