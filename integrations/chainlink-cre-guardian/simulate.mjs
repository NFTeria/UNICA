// Run a price path against the policy and report what it cost.
//
// WHAT A TICK IS. The workflow is driven by a CRE cron trigger, so it sees the position at
// intervals rather than at every price change. The simulation therefore models an OBSERVATION at
// each price update, which is the most favourable schedule a cron can have; a slower cron sees
// fewer of them. That assumption is stated here rather than buried, because a strategy tested
// against a schedule it will not get is a strategy that has not been tested.
//
// WHAT IT DOES NOT MODEL. Gas, transaction failure, the DON's own latency, and the race between a
// price update and the organiser's liquidation sweep. The last one matters most: `checkAllHF` is
// an admin call, so surviving depends on acting inside a window whose length nobody has told us.
// Every number below assumes the action lands. That is an assumption, and it is labelled.

import {LIQUIDATION_HF, healthFactor, isLiquidatable, applyAction} from "./policy.mjs";
import {OUTCOME, decide} from "./strategy.mjs";

const big = (v) => (typeof v === "bigint" ? v : BigInt(v));

/// Loan continuity, as the README defines it:
///   sum(debt during interval x duration) / (initial debt x total duration)
/// Returned in basis points, floored, so it is an integer like every other number here.
export function loanContinuityBps(intervals, initialDebt, totalDuration) {
  const d0 = big(initialDebt), total = big(totalDuration);
  if (d0 === 0n || total === 0n) return null;
  let weighted = 0n;
  for (const {debt, duration} of intervals) weighted += big(debt) * big(duration);
  return (weighted * 10000n) / (d0 * total);
}

/// Run one scenario. Returns the tick-by-tick record and the totals a score would be built from.
export function runScenario({prices, startingPosition, policy, secondsPerUpdate = 300, state = {}}) {
  let position = {
    collateral: big(startingPosition.collateral),
    debt: big(startingPosition.debt),
    price: big(startingPosition.price),
    freeCollateral: big(startingPosition.freeCollateral),
    freeDebtToken: big(startingPosition.freeDebtToken),
  };
  const initialDebt = position.debt;
  const openingCollateral = position.freeCollateral;
  const openingDebtToken = position.freeDebtToken;

  const ticks = [];
  const intervals = [];
  let liquidated = false;
  let interventions = 0;
  let now = 0n;
  let lastActionAt;

  for (let i = 0; i < prices.length; i++) {
    position = {...position, price: big(prices[i])};

    // The organiser's sweep would liquidate here if the position is under water when it runs. The
    // workflow's chance to act is the window between the two, so the record keeps both readings.
    const hfBefore = healthFactor(position);
    const atRiskOnArrival = isLiquidatable(position);

    const d = decide(position, policy, {...state, now, lastActionAt});
    let applied = null;
    if (d.outcome === OUTCOME.DEPOSIT_COLLATERAL || d.outcome === OUTCOME.REPAY_DEBT) {
      position = applyAction(position, {asset: d.asset, amount: d.amount});
      applied = {asset: d.asset, amount: d.amount};
      interventions++;
      lastActionAt = now;
    }
    const hfAfter = healthFactor(position);
    // Survival is judged AFTER the tick: if the workflow could not lift it back above the line,
    // the sweep takes it.
    if (isLiquidatable(position)) liquidated = true;

    ticks.push({
      index: i,
      price: position.price,
      hfBefore,
      atRiskOnArrival,
      outcome: d.outcome,
      reason: d.reason,
      applied,
      hfAfter,
      survived: !isLiquidatable(position),
    });

    if (i < prices.length - 1) {
      intervals.push({debt: position.debt, duration: big(secondsPerUpdate)});
      now += big(secondsPerUpdate);
    }
  }

  const totalDuration = big(secondsPerUpdate) * BigInt(Math.max(prices.length - 1, 1));
  return {
    ticks,
    liquidated,
    interventions,
    survivedEveryTick: ticks.every((t) => t.survived),
    collateralUsed: openingCollateral - position.freeCollateral,
    debtTokenUsed: openingDebtToken - position.freeDebtToken,
    collateralUsedBps: openingCollateral === 0n
      ? null : ((openingCollateral - position.freeCollateral) * 10000n) / openingCollateral,
    debtTokenUsedBps: openingDebtToken === 0n
      ? null : ((openingDebtToken - position.freeDebtToken) * 10000n) / openingDebtToken,
    debtClosedBps: ((initialDebt - position.debt) * 10000n) / initialDebt,
    loanContinuityBps: loanContinuityBps(intervals, initialDebt, totalDuration),
    finalPosition: position,
    assumptions: [
      "one observation per price update, which is the most favourable cron schedule available",
      "every action lands before the organiser's liquidation sweep runs",
      "no gas cost, no transaction failure and no DON latency",
    ],
  };
}

/// What a position would need to survive a whole path WITHOUT reacting to each step — the number
/// that says whether a single pre-emptive action beats a sequence of reactive ones.
export function worstPrice(prices) {
  return prices.map(big).reduce((a, b) => (b < a ? b : a));
}
