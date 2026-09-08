// The lending position, as integers, exactly as the challenge contract computes it.
//
// EVERYTHING HERE IS A WHOLE NUMBER. The challenge's virtual assets carry two decimals and the
// contract divides with floor semantics throughout, so a model that reasoned in floats would
// agree with it almost always and disagree exactly at the boundary that decides a liquidation.
//
// UNITS, stated once and never mixed:
//   collateral  vETH units,  100      = 1.00 vETH
//   debt        vUSD units,  700000   = 7000.00 vUSD
//   price       vUSD units per ONE FULL vETH, 200000 = 2000.00 vUSD/vETH
//   hf          health factor x100,   100 = exactly 1.00 = the liquidation line
//
// THE CONTRACT'S OWN FORMULA, transcribed from ChallengeLending.calcHF:
//
//     hf = collateral * price * LIQUI_THRESHOLD / (100 * debt)          [floor]
//
// and a position is liquidated when `hf <= 100`. Note that is <=, not <: sitting exactly on 100
// is already liquidatable, which is why every margin below is computed to land strictly above it.

/// Read off ChallengeLending.sol. Constants, not parameters: the organiser sets them and a
/// workflow that assumed different ones would be solving a different problem.
export const LIQUI_THRESHOLD = 78n;
export const MAX_LTV = 75n;
/// The contract liquidates at hf <= LIQUIDATION_HF, so survival means strictly greater.
export const LIQUIDATION_HF = 100n;

const big = (v) => (typeof v === "bigint" ? v : BigInt(v));

/// The health factor the contract would compute for this position, floor division included.
/// A debt of zero is unliquidatable; the contract returns uint256 max and this returns null,
/// because "infinity" is not a number any comparison below should be doing arithmetic with.
export function healthFactor({collateral, debt, price}) {
  const c = big(collateral), d = big(debt), p = big(price);
  if (d === 0n) return null;
  return (c * p * LIQUI_THRESHOLD) / (100n * d);
}

/// The smallest repayment that lands the position at or above `targetHf`.
///
/// From hf = C*P*T / (100*D), holding C and P fixed:  D_new = C*P*T / (100*targetHf).
/// The contract FLOORS its own hf, so a debt at exactly that quotient is safe; anything above it
/// is not. The quotient is therefore floored — repaying to a lower debt than strictly necessary
/// is the conservative direction, and rounding the other way would leave the position one unit
/// short of the target it was asked to reach.
export function repayToReach({collateral, debt, price}, targetHf) {
  const c = big(collateral), d = big(debt), p = big(price), t = big(targetHf);
  if (t <= 0n) throw new Error("a target health factor must be positive");
  const survivingDebt = (c * p * LIQUI_THRESHOLD) / (100n * t);
  if (survivingDebt >= d) return 0n;
  return d - survivingDebt;
}

/// The smallest collateral deposit that lands the position at or above `targetHf`.
///
/// From hf = C*P*T / (100*D), holding D and P fixed:  C_new = targetHf*100*D / (P*T).
/// Here the division must round UP: the contract floors when it recomputes, so a collateral value
/// rounded down would compute to one unit below the target. Ceiling division is written as
/// (a + b - 1) / b rather than with any floating helper.
export function depositToReach({collateral, debt, price}, targetHf) {
  const c = big(collateral), d = big(debt), p = big(price), t = big(targetHf);
  if (p <= 0n) throw new Error("a price must be positive");
  const numerator = t * 100n * d;
  const denominator = p * LIQUI_THRESHOLD;
  const needed = (numerator + denominator - 1n) / denominator;
  if (needed <= c) return 0n;
  return needed - c;
}

/// What the position becomes if an action is applied. Used to CHECK a proposed action against the
/// same model the contract uses, rather than trusting the arithmetic that produced it.
export function applyAction(position, action) {
  const p = {
    collateral: big(position.collateral),
    debt: big(position.debt),
    price: big(position.price),
    freeCollateral: big(position.freeCollateral),
    freeDebtToken: big(position.freeDebtToken),
  };
  if (!action || action.amount === undefined || big(action.amount) === 0n) return p;
  const amount = big(action.amount);
  if (action.asset === "COLLATERAL") {
    if (amount > p.freeCollateral) throw new Error("deposit exceeds available collateral");
    return {...p, collateral: p.collateral + amount, freeCollateral: p.freeCollateral - amount};
  }
  if (action.asset === "DEBT_TOKEN") {
    if (amount > p.freeDebtToken) throw new Error("repayment exceeds available debt token");
    if (amount > p.debt) throw new Error("repayment exceeds the debt");
    return {...p, debt: p.debt - amount, freeDebtToken: p.freeDebtToken - amount};
  }
  throw new Error(`unknown asset ${action.asset}`);
}

/// Whether the contract would liquidate this position right now.
export function isLiquidatable(position) {
  const hf = healthFactor(position);
  return hf !== null && hf <= LIQUIDATION_HF;
}

/// The HIGHEST price at which this position is still liquidatable — the number that actually says
/// how much room is left, in the units the scenario moves in.
///
/// The naive form, P = 100*100*D / (C*T), is the price at which hf REACHES 100, and it is wrong
/// here by one step: the contract floors, so prices a little above that quotient still floor to
/// 100 and are still fatal. Measured, and it is why this is computed from the safe side instead.
///
/// Survival needs hf >= 101, that is  C*P*T / (100*D) >= 101, that is  P >= 101*100*D / (C*T),
/// rounded UP. The highest fatal price is one unit below that.
export function firstSafePrice({collateral, debt}) {
  const c = big(collateral), d = big(debt);
  if (c === 0n) return null;
  if (d === 0n) return 0n;
  const numerator = (LIQUIDATION_HF + 1n) * 100n * d;
  const denominator = c * LIQUI_THRESHOLD;
  return (numerator + denominator - 1n) / denominator;
}

export function liquidationPrice(position) {
  const safe = firstSafePrice(position);
  if (safe === null) return null;
  return safe === 0n ? 0n : safe - 1n;
}

/// How far the price may fall before liquidation, in basis points of the current price. Reported
/// rather than acted on: how much room is enough is a strategy decision, not a fact.
export function roomToLiquidationBps({collateral, debt, price}) {
  const p = big(price);
  const at = liquidationPrice({collateral, debt});
  if (at === null || p === 0n) return null;
  if (at >= p) return 0n;
  return ((p - at) * 10000n) / p;
}
