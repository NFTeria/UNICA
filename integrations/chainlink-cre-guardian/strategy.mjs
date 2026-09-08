// Choosing one action, deterministically, from a position and a policy.
//
// THE POLICY VALUES ARE NOT IN THIS FILE. Trigger, target, safety margin and capital caps arrive
// as arguments, because in the real workflow they live in CRE secrets and never touch public code
// or a log. What is public here is the DECISION PROCEDURE; what stays private is the numbers it is
// given. That split is deliberate — it is also what lets this be tested without knowing them.
//
// SCORING WEIGHTS ARE NOT BAKED IN EITHER. The challenge scores liquidation protection, loan
// continuity, capital efficiency, confidentiality and intervention discipline against each other,
// and the organisers have not said how continuity and capital efficiency interact. So this module
// computes BOTH candidate actions and their consequences, and a configurable `prefer` selects
// between them. Guessing the weights and hiding the guess inside the safety engine would make the
// engine wrong in a way no test could later find.
//
// One decision per observation. Exactly one outcome, always.

import {
  LIQUIDATION_HF, applyAction, depositToReach, healthFactor, isLiquidatable,
  liquidationPrice, repayToReach, roomToLiquidationBps,
} from "./policy.mjs";

export const OUTCOME = {
  NO_ACTION: "NO_ACTION",
  WARNING: "WARNING",
  DEPOSIT_COLLATERAL: "DEPOSIT_COLLATERAL",
  REPAY_DEBT: "REPAY_DEBT",
  INSUFFICIENT_CAPITAL: "INSUFFICIENT_CAPITAL",
  PENDING_ACTION: "PENDING_ACTION",
  INVALID_STATE: "INVALID_STATE",
};

export const REASON = {
  ABOVE_WARNING: "ABOVE_WARNING",
  IN_WARNING_BAND: "IN_WARNING_BAND",
  AT_OR_BELOW_TRIGGER: "AT_OR_BELOW_TRIGGER",
  ALREADY_LIQUIDATABLE: "ALREADY_LIQUIDATABLE",
  NEITHER_ASSET_SUFFICES: "NEITHER_ASSET_SUFFICES",
  ACTION_ALREADY_IN_FLIGHT: "ACTION_ALREADY_IN_FLIGHT",
  COOLDOWN_NOT_ELAPSED: "COOLDOWN_NOT_ELAPSED",
  NO_DEBT: "NO_DEBT",
  NO_PRICE: "NO_PRICE",
  NO_COLLATERAL: "NO_COLLATERAL",
  MALFORMED_POSITION: "MALFORMED_POSITION",
};

const big = (v) => (typeof v === "bigint" ? v : BigInt(v));

/// The default policy shape. Every value is overridable, and in deployment every value comes from
/// a secret. The numbers here are the README's own illustrative example, chosen precisely BECAUSE
/// they are published — a default nobody would confuse for a strategy.
export const EXAMPLE_POLICY = {
  triggerHf: 108n,
  targetHf: 118n,
  safetyMarginHf: 0n,
  maxDepositUnits: 300n,
  maxRepayPctBps: 1500n,
  cooldownSeconds: 0n,
  prefer: "CHEAPER_RELATIVE",
};

function normalise(position) {
  const need = ["collateral", "debt", "price", "freeCollateral", "freeDebtToken"];
  for (const f of need) {
    if (position?.[f] === undefined || position[f] === null) return null;
  }
  try {
    const p = Object.fromEntries(need.map((f) => [f, big(position[f])]));
    if (Object.values(p).some((v) => v < 0n)) return null;
    return p;
  } catch {
    return null;
  }
}

const verdict = (outcome, reason, extra = {}) => ({
  outcome, reason, amount: 0n, asset: null, ...extra,
});

/// Decide what to do about one observation.
///
/// @param position {collateral, debt, price, freeCollateral, freeDebtToken}
/// @param policy   see EXAMPLE_POLICY; in deployment these come from CRE secrets
/// @param state    {pending, lastActionAt, now} — the workflow's own memory between ticks
export function decide(position, policy = EXAMPLE_POLICY, state = {}) {
  const p = normalise(position);
  if (p === null) return verdict(OUTCOME.INVALID_STATE, REASON.MALFORMED_POSITION);
  if (p.price === 0n) return verdict(OUTCOME.INVALID_STATE, REASON.NO_PRICE);
  if (p.debt === 0n) return verdict(OUTCOME.NO_ACTION, REASON.NO_DEBT);
  if (p.collateral === 0n) return verdict(OUTCOME.INVALID_STATE, REASON.NO_COLLATERAL);

  const hf = healthFactor(p);
  const trigger = big(policy.triggerHf);
  const target = big(policy.targetHf) + big(policy.safetyMarginHf ?? 0n);

  const context = {
    hf,
    liquidationPrice: liquidationPrice(p),
    roomBps: roomToLiquidationBps(p),
    triggerHf: trigger,
    effectiveTargetHf: target,
  };

  // An action already in flight suppresses another. Two deposits for one price move is exactly the
  // "repeated action" the discipline score penalises, and on chain it is also two gas payments for
  // one problem.
  if (state.pending) return verdict(OUTCOME.PENDING_ACTION, REASON.ACTION_ALREADY_IN_FLIGHT, context);

  if (hf > trigger) {
    // Hysteresis: a band between "worth saying something" and "worth spending something", so a
    // position hovering near the line does not transact on every tick.
    const warnAt = trigger + big(policy.warningBandHf ?? 6n);
    if (hf <= warnAt) return verdict(OUTCOME.WARNING, REASON.IN_WARNING_BAND, context);
    return verdict(OUTCOME.NO_ACTION, REASON.ABOVE_WARNING, context);
  }

  if (state.lastActionAt !== undefined && state.now !== undefined
      && big(policy.cooldownSeconds ?? 0n) > 0n) {
    const elapsed = big(state.now) - big(state.lastActionAt);
    if (elapsed < big(policy.cooldownSeconds)) {
      // Never let a cooldown hold a position that is already liquidatable. A quiet period is a
      // discipline preference; being liquidated is the thing the whole workflow exists to prevent.
      if (!isLiquidatable(p)) return verdict(OUTCOME.PENDING_ACTION, REASON.COOLDOWN_NOT_ELAPSED, context);
    }
  }

  const reason = isLiquidatable(p) ? REASON.ALREADY_LIQUIDATABLE : REASON.AT_OR_BELOW_TRIGGER;
  const candidates = candidateActions(p, policy, target);
  const affordable = candidates.filter((c) => c.affordable);
  if (affordable.length === 0) {
    return verdict(OUTCOME.INSUFFICIENT_CAPITAL, REASON.NEITHER_ASSET_SUFFICES, {
      ...context, candidates,
    });
  }

  const chosen = select(affordable, policy.prefer ?? "CHEAPER_RELATIVE");
  return {
    outcome: chosen.asset === "COLLATERAL" ? OUTCOME.DEPOSIT_COLLATERAL : OUTCOME.REPAY_DEBT,
    reason,
    amount: chosen.amount,
    asset: chosen.asset,
    ...context,
    projectedHf: chosen.projectedHf,
    capitalUsedBps: chosen.capitalUsedBps,
    continuityImpactBps: chosen.continuityImpactBps,
    candidates,
  };
}

/// Both ways out, each priced. Computing both every time is what makes the choice a policy rather
/// than an assumption, and what lets a scenario report say why one was taken.
export function candidateActions(position, policy, target) {
  const p = normalise(position);
  const out = [];

  const deposit = depositToReach(p, target);
  const capDeposit = policy.maxDepositUnits === undefined ? null : big(policy.maxDepositUnits);
  const depositAffordable = deposit > 0n && deposit <= p.freeCollateral
    && (capDeposit === null || deposit <= capDeposit);
  out.push(price(p, {asset: "COLLATERAL", amount: deposit}, depositAffordable, capDeposit, p.freeCollateral));

  const repay = repayToReach(p, target);
  const capRepayPct = policy.maxRepayPctBps === undefined ? null : big(policy.maxRepayPctBps);
  const capRepay = capRepayPct === null ? null : (p.debt * capRepayPct) / 10000n;
  const repayAffordable = repay > 0n && repay <= p.freeDebtToken && repay <= p.debt
    && (capRepay === null || repay <= capRepay);
  out.push(price(p, {asset: "DEBT_TOKEN", amount: repay}, repayAffordable, capRepay, p.freeDebtToken));

  return out;
}

/// What an action costs, in the two currencies the scoring actually cares about: emergency capital
/// consumed, and debt closed. Both in basis points so they are comparable across assets.
function price(p, action, affordable, cap, available) {
  let projectedHf = null;
  if (affordable) {
    try {
      projectedHf = healthFactor(applyAction(p, action));
    } catch {
      affordable = false;
    }
  }
  const capitalUsedBps = available === 0n ? null : (action.amount * 10000n) / available;
  const continuityImpactBps = action.asset === "DEBT_TOKEN" && p.debt > 0n
    ? (action.amount * 10000n) / p.debt
    : 0n;
  return {...action, affordable, cap, available, projectedHf, capitalUsedBps, continuityImpactBps};
}

/// The configurable part, and the only place a scoring opinion lives.
///
/// CHEAPER_RELATIVE — spend the smaller share of what is available of that asset.
/// PRESERVE_CONTINUITY — never close debt while adding collateral would do; the challenge scores
///   time-weighted debt kept open, so repaying is the option that costs twice.
/// SMALLEST_ABSOLUTE — the smaller raw number, which is only meaningful within one asset.
export function select(candidates, prefer) {
  if (candidates.length === 1) return candidates[0];
  const byAsset = (a) => candidates.find((c) => c.asset === a);
  if (prefer === "PRESERVE_CONTINUITY") return byAsset("COLLATERAL") ?? candidates[0];
  if (prefer === "SMALLEST_ABSOLUTE") {
    return [...candidates].sort((a, b) => (a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0))[0];
  }
  return [...candidates].sort((a, b) => {
    const x = a.capitalUsedBps ?? 10n ** 9n;
    const y = b.capitalUsedBps ?? 10n ** 9n;
    if (x !== y) return x < y ? -1 : 1;
    // A tie goes to collateral: it leaves the loan open, and the challenge scores that.
    return a.asset === "COLLATERAL" ? -1 : 1;
  })[0];
}

export {LIQUIDATION_HF};
