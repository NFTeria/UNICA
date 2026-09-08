// The merchant's split, derived a second time.
//
// `vy/src/unica/merchant_policy.vy` divides a merchant's takings between the bank leg and the
// coins they chose to hold. That Vyper is what would run on chain, so it is the TRUTH; this file
// is a SECOND derivation of the same arithmetic, so an Arc treasury console can show a merchant
// where their money is about to go without standing up a node.
//
// Two descriptions of one arithmetic is a mismatch waiting to happen. That is why nothing here is
// trusted on its own: `fixtures/split-vectors.json` carries 78 rows of what the real contract
// actually computed, captured by `vy/tests/test_arc_split_parity.py`, and `test.mjs` checks every
// one of them against this file. It is the same discipline the Permit2 digest and the ENS policy
// decoder already use in this repository, for the same reason — a number a wallet computes
// differently from the contract is rejected in the wallet, not in the test suite.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO. It does not move money, choose a policy, or decide
// whether a split should happen; `treasury.mjs` owns that. It does not read a chain. And it never
// invents a decimals value: it splits a TokenAmount and returns TokenAmounts carrying the SAME
// scale, so a 6-decimal reading cannot become an 18-decimal one by passing through arithmetic.
//
// THE ROUNDING IS THE WHOLE POINT. Every leg but the last truncates, and the LAST hold leg is
// `amount - everything_already_allocated`, so it absorbs whatever the truncations lost and the
// parts sum EXACTLY. A port that computes every leg the same way is short by the remainder and
// nothing complains, because each individual leg looks correct on its own. Captured vector:
// three equal thirds of 33333 come back as 9999, 9999, 10002 — not 9999, 9999, 9999.

import {isToken, tokenAmount} from "./units.mjs";

export const BPS = 10000n;
export const MAX_HOLD = 4;

export const SPLIT_ERROR = {
  SHARES_NOT_TOTAL: "SHARES_NOT_TOTAL",
  TOO_MANY_HOLDS: "TOO_MANY_HOLDS",
  NOT_A_TOKEN_AMOUNT: "NOT_A_TOKEN_AMOUNT",
  MALFORMED_BPS: "MALFORMED_BPS",
};

export class SplitError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SplitError";
    this.code = code;
  }
}

const refuse = (code, message) => {
  throw new SplitError(code, message);
};

const bps = (v, what) => {
  if (typeof v === "bigint") { if (v >= 0n) return v; }
  else if (Number.isInteger(v) && v >= 0) return BigInt(v);
  refuse(SPLIT_ERROR.MALFORMED_BPS, `${what} must be a non-negative whole number of basis points, got ${String(v)}`);
};

/// Validate a policy the way the contract does, and refuse the same shapes it refuses.
///
/// The contract asserts `total == BPS` — so "no bank and no holds" is not a policy it will accept,
/// and neither is one that totals 9999 or 10001. Refusing here rather than silently normalising
/// matters: a policy that does not total 10000 has no correct interpretation, and picking one for
/// the merchant is how a console shows a number nobody agreed to.
export function policy({bankBps, holdBps = []}) {
  const bank = bps(bankBps, "bankBps");
  if (holdBps.length > MAX_HOLD) {
    refuse(SPLIT_ERROR.TOO_MANY_HOLDS, `the contract holds at most ${MAX_HOLD} legs, got ${holdBps.length}`);
  }
  const holds = holdBps.map((h, i) => bps(h, `holdBps[${i}]`));
  const total = holds.reduce((a, h) => a + h, bank);
  if (total !== BPS) {
    refuse(
      SPLIT_ERROR.SHARES_NOT_TOTAL,
      `shares must total exactly ${BPS} basis points; bank ${bank} plus holds ` +
      `[${holds.join(", ")}] totals ${total}`,
    );
  }
  return {bankBps: bank, holdBps: holds};
}

/// Split a TokenAmount, reproducing `merchant_policy.split()` exactly.
///
/// Returns TokenAmounts carrying the input's own scale — never bare integers, and never a scale
/// this function chose. `bank` plus every part equals the input, by construction rather than by
/// assertion, because the last leg is computed as the remainder.
export function split(amount, pol) {
  if (!isToken(amount)) {
    refuse(
      SPLIT_ERROR.NOT_A_TOKEN_AMOUNT,
      "split operates on a TokenAmount whose scale was read from the token's own decimals(). " +
      `Got ${amount == null ? String(amount) : amount.constructor?.name ?? typeof amount}. ` +
      "A native amount is 18-decimal by the chain's convention and is not a merchant's payout.",
    );
  }
  const {bankBps, holdBps} = policy(pol);
  const scale = amount.scale;
  const total = amount.units;

  let bank = (total * bankBps) / BPS;   // BigInt division truncates, as Vyper's `//` does
  const parts = [];
  let acc = bank;
  const n = holdBps.length;
  for (let i = 0; i < n; i++) {
    if (i + 1 === n) {
      parts.push(total - acc);          // the last leg absorbs the rounding
    } else {
      const x = (total * holdBps[i]) / BPS;
      parts.push(x);
      acc += x;
    }
  }
  if (n === 0) bank = total;            // the contract's own empty-holds branch

  return {
    bank: tokenAmount(bank, scale),
    parts: parts.map((p) => tokenAmount(p, scale)),
  };
}
