// One bounded treasury action, chosen deterministically from an observed position.
//
// THE SHAPE OF THE PROBLEM. A merchant settles into USDC and holds it on Arc. Arc is a USDC-gas L1
// with no Uniswap deployment, so there is no swap to make and no price to fetch — inventing either
// would be the fake integration this project refuses to ship. What is left is the honest problem:
// given a balance, a reserve floor, a per-action cap, a cooldown and a set of approved
// counterparties, decide whether to pay, to top up, or to sit still.
//
// WHY IT IS A PURE FUNCTION. Every input arrives as an argument, including the clock. There is no
// Date.now(), no Math.random(), no network call and no file read in this file, so a scenario is
// reproducible from its inputs alone and a test asserting a branch cannot be flaky. `now` is a
// parameter for the same reason the policy numbers are: a decision procedure that reads a global is
// a decision nobody can re-derive.
//
// WHY THE VOCABULARY IS CLOSED. Exactly one ACTION comes out, always, drawn from a fixed set, and
// every non-action carries a REASON from another fixed set. A caller can branch on it, a test can
// assert the exact member, and a UI can render it without parsing prose. An open-ended string is a
// decision nobody downstream can check.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not swap, quote, price, or route — Uniswap is not on
// Arc and this module models no DEX. It does not sign, build calldata or broadcast; it returns a
// decision and preview.mjs turns that into something the owner may sign. It does not net a token
// balance against a native balance, because the type system in units.mjs forbids it — which is what
// makes the gas branch below correct rather than merely commented.
//
// THE GAS BRANCH IS THE POINT. On Arc, gas is paid in the NATIVE currency at 18 decimals, and the
// merchant's holdings are an ERC-20 at whatever decimals() actually returns — 6, for the USDC
// deployed on Arc. A merchant can therefore hold plenty of USDC and still be unable to send any of
// it, because the native balance that pays for the send is a different quantity. Code that added
// those two together would see a healthy treasury and build a transaction that cannot be included.
// Here the addition is impossible, so the condition has to be checked, and it is.

import {
  UNIT_ERROR, UnitError, gte, isNative, isToken, label, lt, normaliseAddress, sub,
} from "./units.mjs";

/// The closed set of things this policy can decide to do. Four outcomes, one of which is "nothing".
export const ACTION = {
  /// The position is inside policy and there is nothing to do this tick.
  NO_ACTION: "NO_ACTION",
  /// The operating balance is under the reserve floor and an approved replenishment source can
  /// cover the shortfall. Move the shortfall, and no more than the shortfall.
  RESTORE_MINIMUM_RESERVE: "RESTORE_MINIMUM_RESERVE",
  /// A payment to an approved counterparty is within every cap and leaves the reserve intact.
  RELEASE_APPROVED_PAYMENT: "RELEASE_APPROVED_PAYMENT",
  /// Under the floor with no way to restore it. Pay nothing until that changes. This is an active
  /// decision, not an absence of one, which is why it is not NO_ACTION.
  HOLD_BELOW_RESERVE: "HOLD_BELOW_RESERVE",
  /// The inputs do not describe a position this policy can reason about. Never a silent NO_ACTION:
  /// "I decided not to act" and "I could not tell" are different facts.
  REFUSED: "REFUSED",
};

/// Why. Every decision carries exactly one.
export const REASON = {
  ABOVE_RESERVE_NOTHING_REQUESTED: "ABOVE_RESERVE_NOTHING_REQUESTED",
  WITHIN_ALL_LIMITS: "WITHIN_ALL_LIMITS",
  BELOW_RESERVE_SOURCE_AVAILABLE: "BELOW_RESERVE_SOURCE_AVAILABLE",
  BELOW_RESERVE_NO_SOURCE: "BELOW_RESERVE_NO_SOURCE",
  BELOW_RESERVE_SOURCE_INSUFFICIENT: "BELOW_RESERVE_SOURCE_INSUFFICIENT",
  COUNTERPARTY_NOT_APPROVED: "COUNTERPARTY_NOT_APPROVED",
  ABOVE_PER_ACTION_CAP: "ABOVE_PER_ACTION_CAP",
  WOULD_BREACH_RESERVE: "WOULD_BREACH_RESERVE",
  COOLDOWN_NOT_ELAPSED: "COOLDOWN_NOT_ELAPSED",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  /// The Arc-specific one. Holdings are fine; the gas currency is not.
  INSUFFICIENT_NATIVE_FOR_GAS: "INSUFFICIENT_NATIVE_FOR_GAS",
  ZERO_AMOUNT_REQUESTED: "ZERO_AMOUNT_REQUESTED",
  ZERO_ADDRESS_RECIPIENT: "ZERO_ADDRESS_RECIPIENT",
  /// The guard fired: two quantities of different representations met. Surfaced as its own reason
  /// so a misconfiguration is legible instead of arriving as a stack trace.
  UNIT_KIND_MISMATCH: "UNIT_KIND_MISMATCH",
  TOKEN_MISMATCH: "TOKEN_MISMATCH",
  SCALE_MISMATCH: "SCALE_MISMATCH",
  DECIMALS_NEVER_READ: "DECIMALS_NEVER_READ",
  MALFORMED_POSITION: "MALFORMED_POSITION",
  MALFORMED_POLICY: "MALFORMED_POLICY",
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/// The result shape, always the same fields, so a caller never has to test for presence.
function decision(action, reason, extra = {}) {
  return Object.freeze({
    action,
    reason,
    /// The amount to move, as a TokenAmount, or null when nothing moves.
    amount: null,
    /// Where it goes, or null.
    recipient: null,
    /// A human sentence. Display only — nothing branches on this.
    explanation: "",
    ...extra,
  });
}

/// Map a units.mjs refusal onto a policy reason, so the guard firing is a decision rather than a
/// crash. The mapping is total over the codes that can reach here; anything else re-throws, because
/// swallowing an unrecognised error is how a bug becomes a silent NO_ACTION.
function reasonForUnitError(e) {
  if (!(e instanceof UnitError)) return null;
  switch (e.code) {
    case UNIT_ERROR.UNIT_KIND_MISMATCH: return REASON.UNIT_KIND_MISMATCH;
    case UNIT_ERROR.TOKEN_MISMATCH: return REASON.TOKEN_MISMATCH;
    case UNIT_ERROR.SCALE_MISMATCH: return REASON.SCALE_MISMATCH;
    case UNIT_ERROR.DECIMALS_NOT_READ:
    case UNIT_ERROR.DECIMALS_EMPTY_RETURN:
    case UNIT_ERROR.DECIMALS_MALFORMED_RETURN:
    case UNIT_ERROR.DECIMALS_OUT_OF_RANGE: return REASON.DECIMALS_NEVER_READ;
    case UNIT_ERROR.MALFORMED_AMOUNT:
    case UNIT_ERROR.MALFORMED_ADDRESS: return REASON.MALFORMED_POSITION;
    default: return null;
  }
}

/// Decide one action.
///
/// @param position {
///   operatingBalance : TokenAmount — the merchant's ERC-20 USDC on Arc, at the scale READ from
///                      that contract. Never a bare number: the type forbids it.
///   nativeBalance    : NativeAmount — the 18-decimal native currency that pays for gas. A separate
///                      kind, and deliberately not addable to the line above.
///   reserveSource    : TokenAmount | null — an approved account that can top the operating
///                      balance up. null means there is none.
/// }
/// @param policy {
///   reserveFloor        : TokenAmount — never spend below this
///   perActionCap        : TokenAmount — the most one action may move
///   cooldownSeconds     : bigint
///   approvedCounterparties : string[] — the only addresses a payment may go to
///   gasBudget           : NativeAmount — what one send is expected to cost in native currency
/// }
/// @param request {recipient, amount} | null — a payment the merchant wants to make
/// @param state {now, lastActionAt} — the clock, injected, never read from the environment
export function decide(position, policy, request = null, state = {}) {
  try {
    return decideInner(position, policy, request, state);
  } catch (e) {
    const reason = reasonForUnitError(e);
    // An unrecognised throw is a defect in this module and must not be dressed up as a decision.
    if (reason === null) throw e;
    return decision(ACTION.REFUSED, reason, {explanation: e.message});
  }
}

function decideInner(position, policy, request, state) {
  // ---- shape ---------------------------------------------------------------------------------
  if (position === null || typeof position !== "object") {
    return decision(ACTION.REFUSED, REASON.MALFORMED_POSITION, {explanation: "no position given"});
  }
  if (policy === null || typeof policy !== "object") {
    return decision(ACTION.REFUSED, REASON.MALFORMED_POLICY, {explanation: "no policy given"});
  }
  const {operatingBalance, nativeBalance, reserveSource = null} = position;
  const {reserveFloor, perActionCap, cooldownSeconds = 0n, approvedCounterparties = [], gasBudget} = policy;

  // Each of these is checked for KIND, not merely for presence. A native amount where a token
  // amount belongs is the exact confusion this integration exists to make impossible, so it is
  // caught at the boundary and named, rather than being allowed to fail later inside an operator.
  if (!isToken(operatingBalance)) {
    return decision(ACTION.REFUSED, REASON.UNIT_KIND_MISMATCH, {
      explanation: "operatingBalance must be a TokenAmount whose scale was read from the token's decimals()",
    });
  }
  if (!isNative(nativeBalance)) {
    return decision(ACTION.REFUSED, REASON.UNIT_KIND_MISMATCH, {
      explanation: "nativeBalance must be a NativeAmount — on Arc gas is paid in the 18-decimal native currency, not in the ERC-20",
    });
  }
  if (!isToken(reserveFloor) || !isToken(perActionCap)) {
    return decision(ACTION.REFUSED, REASON.MALFORMED_POLICY, {
      explanation: "reserveFloor and perActionCap must be TokenAmounts at the same scale as the balance",
    });
  }
  if (!isNative(gasBudget)) {
    return decision(ACTION.REFUSED, REASON.MALFORMED_POLICY, {
      explanation: "gasBudget must be a NativeAmount — it is paid in the native currency",
    });
  }
  if (reserveSource !== null && !isToken(reserveSource)) {
    return decision(ACTION.REFUSED, REASON.UNIT_KIND_MISMATCH, {explanation: "reserveSource must be a TokenAmount or null"});
  }

  // These comparisons throw if the token or the scale differs, and `decide` maps that to a named
  // refusal. That is the guard doing its job on real inputs rather than only in a test.
  const belowFloor = lt(operatingBalance, reserveFloor);

  const context = {
    operatingBalance,
    nativeBalance,
    reserveFloor,
    perActionCap,
    belowFloor,
    display: {
      operating: label(operatingBalance),
      native: label(nativeBalance),
      floor: label(reserveFloor),
    },
  };

  // ---- gas, before anything else ---------------------------------------------------------------
  // Checked first because it disqualifies every action, including the reserve restore. A merchant
  // with a full USDC balance and no native currency cannot send: the two are different quantities
  // and one cannot pay for the other. This is the branch the type system exists to force.
  const canPayGas = gte(nativeBalance, gasBudget);

  // ---- below the floor -------------------------------------------------------------------------
  if (belowFloor) {
    const shortfall = sub(reserveFloor, operatingBalance);
    if (reserveSource === null) {
      return decision(ACTION.HOLD_BELOW_RESERVE, REASON.BELOW_RESERVE_NO_SOURCE, {
        ...context, shortfall,
        explanation: `Operating balance is below the reserve floor by ${label(shortfall)} and no replenishment source is configured. Releasing a payment now would deepen the breach, so nothing is released.`,
      });
    }
    if (lt(reserveSource, shortfall)) {
      return decision(ACTION.HOLD_BELOW_RESERVE, REASON.BELOW_RESERVE_SOURCE_INSUFFICIENT, {
        ...context, shortfall, reserveSource,
        explanation: `Shortfall is ${label(shortfall)}; the reserve source holds only ${label(reserveSource)}. A partial top-up would not clear the floor, so the position holds.`,
      });
    }
    if (!canPayGas) {
      return decision(ACTION.REFUSED, REASON.INSUFFICIENT_NATIVE_FOR_GAS, {
        ...context, shortfall, gasBudget,
        explanation: `The reserve could be restored, but the native balance is ${label(nativeBalance)} against a gas budget of ${label(gasBudget)}. On Arc gas is paid in the native 18-decimal currency; the ERC-20 holdings cannot pay for it.`,
      });
    }
    // Move exactly the shortfall. Topping up past the floor would be a capital decision this
    // policy has not been given the inputs to make.
    return decision(ACTION.RESTORE_MINIMUM_RESERVE, REASON.BELOW_RESERVE_SOURCE_AVAILABLE, {
      ...context, shortfall, reserveSource,
      amount: shortfall,
      explanation: `Restoring exactly the ${label(shortfall)} shortfall from the reserve source — no more, because topping up beyond the floor is a decision this policy has no input for.`,
    });
  }

  // ---- at or above the floor -------------------------------------------------------------------
  if (request === null || request === undefined) {
    return decision(ACTION.NO_ACTION, REASON.ABOVE_RESERVE_NOTHING_REQUESTED, {
      ...context,
      explanation: `Operating balance ${label(operatingBalance)} is at or above the reserve floor and no payment is requested.`,
    });
  }

  const {recipient, amount} = request;
  if (!isToken(amount)) {
    return decision(ACTION.REFUSED, REASON.UNIT_KIND_MISMATCH, {
      ...context,
      explanation: "the requested amount must be a TokenAmount at the balance's own scale",
    });
  }
  let to;
  try {
    to = normaliseAddress(recipient);
  } catch {
    return decision(ACTION.REFUSED, REASON.MALFORMED_POSITION, {...context, explanation: `recipient is not an address: ${String(recipient)}`});
  }
  if (to === ZERO_ADDRESS) {
    // Arc reverts a send to address(0), and a revert there costs gas. Refused at decision time so
    // it never reaches a preview, let alone a wallet.
    return decision(ACTION.REFUSED, REASON.ZERO_ADDRESS_RECIPIENT, {
      ...context, recipient: to,
      explanation: "Arc reverts transfers to address(0) and consumes gas doing so. Refused before the transaction is built.",
    });
  }
  if (amount.units === 0n) {
    return decision(ACTION.REFUSED, REASON.ZERO_AMOUNT_REQUESTED, {
      ...context, recipient: to,
      explanation: "a zero-value transfer spends gas and moves nothing",
    });
  }

  const approved = approvedCounterparties.map((a) => normaliseAddress(a));
  if (!approved.includes(to)) {
    return decision(ACTION.REFUSED, REASON.COUNTERPARTY_NOT_APPROVED, {
      ...context, recipient: to, amount,
      explanation: `${to} is not in the approved counterparty set (${approved.length} entries). The set is the whole authorisation: an address absent from it is refused, never merely flagged.`,
    });
  }

  // The cap comparison throws on a scale mismatch, which is intended: a cap read at one scale and a
  // request at another is a misconfiguration, not a number to compare.
  if (lt(perActionCap, amount)) {
    return decision(ACTION.REFUSED, REASON.ABOVE_PER_ACTION_CAP, {
      ...context, recipient: to, amount,
      explanation: `Requested ${label(amount)} exceeds the per-action cap of ${label(perActionCap)}.`,
    });
  }

  if (lt(operatingBalance, amount)) {
    return decision(ACTION.REFUSED, REASON.INSUFFICIENT_BALANCE, {
      ...context, recipient: to, amount,
      explanation: `Requested ${label(amount)} exceeds the operating balance of ${label(operatingBalance)}.`,
    });
  }

  const after = sub(operatingBalance, amount);
  if (lt(after, reserveFloor)) {
    return decision(ACTION.REFUSED, REASON.WOULD_BREACH_RESERVE, {
      ...context, recipient: to, amount, balanceAfter: after,
      explanation: `Paying ${label(amount)} would leave ${label(after)}, under the reserve floor of ${label(reserveFloor)}.`,
    });
  }

  // The cooldown is checked after the money questions, so a request that was never going to be
  // allowed reports the substantive reason rather than "try again later".
  const cooldown = BigInt(cooldownSeconds ?? 0n);
  if (cooldown > 0n && state.lastActionAt !== undefined && state.now !== undefined) {
    const elapsed = BigInt(state.now) - BigInt(state.lastActionAt);
    if (elapsed < cooldown) {
      return decision(ACTION.REFUSED, REASON.COOLDOWN_NOT_ELAPSED, {
        ...context, recipient: to, amount, elapsed, cooldown,
        explanation: `${elapsed}s since the last action; the cooldown is ${cooldown}s.`,
      });
    }
  }

  if (!canPayGas) {
    return decision(ACTION.REFUSED, REASON.INSUFFICIENT_NATIVE_FOR_GAS, {
      ...context, recipient: to, amount, gasBudget,
      explanation: `The payment is within every limit, but the native balance is ${label(nativeBalance)} against a gas budget of ${label(gasBudget)}. On Arc gas is paid in the native 18-decimal currency and the ERC-20 holdings cannot be used for it — these are different quantities and this policy cannot net one against the other.`,
    });
  }

  return decision(ACTION.RELEASE_APPROVED_PAYMENT, REASON.WITHIN_ALL_LIMITS, {
    ...context, recipient: to, amount, balanceAfter: after,
    explanation: `Releasing ${label(amount)} to an approved counterparty leaves ${label(after)}, at or above the reserve floor of ${label(reserveFloor)}.`,
  });
}

/// Every member of ACTION and REASON, so a test can prove the suite covers the whole vocabulary
/// rather than the members somebody remembered to write a row for.
export const ALL_ACTIONS = Object.freeze(Object.values(ACTION));
export const ALL_REASONS = Object.freeze(Object.values(REASON));
