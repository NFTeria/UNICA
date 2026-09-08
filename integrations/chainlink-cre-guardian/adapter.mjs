// Between the chain and the frozen policy: read a position, decide, and build the ONE transaction
// that decision permits.
//
// THE POLICY IS NOT RE-IMPLEMENTED HERE. `strategy.decide` is the reference and this module calls
// it, so the adapter cannot drift from the arithmetic that was tested. Every row in the suite
// asserts the adapter's decision equals the direct one for the same state; an adapter that
// adjusted an amount "for safety" would be a second policy nobody tested.
//
// THERE IS NO ARBITRARY CALLDATA. An intent can only become one of two shapes — approve-then-
// deposit on vETH, or approve-then-repay on vUSD — with the targets taken from a selected
// deployment profile and never from an argument. A caller cannot ask this module to call anything
// else, because there is no parameter that would carry the request.
//
// IT OPENS NO SOCKET AND READS NO CLOCK. Observations arrive as data, including their timestamp,
// so every run is reproducible and the suite needs no RPC, no CRE CLI and no secrets.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {concat, selectorOf, wordAddress, wordBytes32, wordUint} from "../../tools/unica-sign/abi.mjs";
import {healthFactor} from "./policy.mjs";
import {OUTCOME, decide} from "./strategy.mjs";
import {selectProfile} from "./profiles.mjs";

const utf8 = (s) => new TextEncoder().encode(s);
const big = (v) => (typeof v === "bigint" ? v : BigInt(v));

/// Derived, never typed. Two hand-written selectors in this repository's verifier were both wrong,
/// and a wrong selector fails as a silent empty return rather than as an error.
export const SELECTOR = {
  approve: selectorOf("approve(address,uint256)"),
  deposit: selectorOf("deposit(uint256)"),
  repay: selectorOf("repay(uint256)"),
};

export const INTENT = {
  NO_ACTION: "NO_ACTION",
  WARNING: "WARNING",
  DEPOSIT_COLLATERAL: "DEPOSIT_COLLATERAL",
  REPAY_DEBT: "REPAY_DEBT",
  REFUSAL: "REFUSAL",
};

export const OBSERVATION_STATUS = {
  ACCEPTED: "ACCEPTED",
  NO_SEQUENCE: "NO_SEQUENCE",
  DUPLICATE_SEQUENCE: "DUPLICATE_SEQUENCE",
  REORDERED_SEQUENCE: "REORDERED_SEQUENCE",
  STALE_OBSERVATION: "STALE_OBSERVATION",
  NO_TIMESTAMP: "NO_TIMESTAMP",
};

/// Approval strategies, named so a choice is visible rather than implied.
///
/// The example workflow approves MAX_UINT256 once and reuses it. That costs one transaction ever
/// instead of one per action, which matters because the challenge scores intervention discipline
/// — but it also leaves an unbounded allowance to the lending contract for the whole scenario.
export const APPROVAL = {
  PRE_APPROVED: "PRE_APPROVED",
  EXACT: "EXACT",
  MAX_ONCE: "MAX_ONCE",
};

/// What each action needs, established from the challenge contracts rather than assumed:
///   deposit(amount) calls vETH.transferFrom(msg.sender, lending, amount)  -> vETH allowance
///   repay(amount)   calls vUSD.burnFrom(msg.sender, amount), and burnFrom
///                   itself calls _spendAllowance(account, msg.sender, ...)  -> vUSD allowance
/// In both cases the SPENDER is the lending contract, and in both cases the allowance is readable.
export const APPROVAL_MODEL = {
  DEPOSIT_COLLATERAL: {token: "vETH", spender: "lending", contractCall: "transferFrom"},
  REPAY_DEBT: {token: "vUSD", spender: "lending", contractCall: "burnFrom (which spends allowance)"},
  observable: "allowance(owner, spender) on either token",
  preparableBeforeStart: true,
  note:
    "vUSD.burnFrom is additionally onlyRole(ADMIN_ROLE), so the lending contract must hold that "
    + "role on the token. That is the organisers' setup, not a participant's.",
};

const MAX_UINT256 = (1n << 256n) - 1n;

/// One observation of the world, as a commitment. Anything that could change the decision is in
/// it, so an evidence record can point at exactly what was seen.
export function observationCommitment(o) {
  return toHex(
    keccak256(
      concat(
        wordBytes32(toHex(keccak256(utf8(String(o.profile))))),
        wordUint(o.sequence),
        wordUint(o.timestamp),
        wordUint(o.collateral),
        wordUint(o.debt),
        wordUint(o.price),
        wordUint(o.freeCollateral),
        wordUint(o.freeDebtToken),
      ),
    ),
  );
}

/// The policy, as a commitment, WITHOUT revealing it. Thresholds live in CRE secrets; this proves
/// afterwards which policy was in force without printing any of its numbers.
export function policyCommitment(policy) {
  const fields = ["triggerHf", "targetHf", "safetyMarginHf", "warningBandHf",
                  "maxDepositUnits", "maxRepayPctBps", "cooldownSeconds"];
  return toHex(
    keccak256(
      concat(
        wordBytes32(toHex(keccak256(utf8("UNICA.guardian.policy.v1")))),
        ...fields.map((f) => wordUint(policy[f] ?? 0n)),
        wordBytes32(toHex(keccak256(utf8(String(policy.prefer ?? "CHEAPER_RELATIVE"))))),
      ),
    ),
  );
}

/// Accept or refuse an observation before it can influence anything.
export function admitObservation(observation, memory = {}) {
  if (observation?.sequence === undefined || observation.sequence === null) {
    return {ok: false, status: OBSERVATION_STATUS.NO_SEQUENCE};
  }
  if (observation?.timestamp === undefined || observation.timestamp === null) {
    return {ok: false, status: OBSERVATION_STATUS.NO_TIMESTAMP};
  }
  const seq = big(observation.sequence);
  const last = memory.lastSequence === undefined ? null : big(memory.lastSequence);
  if (last !== null) {
    if (seq === last) return {ok: false, status: OBSERVATION_STATUS.DUPLICATE_SEQUENCE, detail: String(seq)};
    if (seq < last) return {ok: false, status: OBSERVATION_STATUS.REORDERED_SEQUENCE,
                            detail: `${seq} after ${last}`};
  }
  if (memory.maxObservationAge !== undefined && memory.now !== undefined) {
    const age = big(memory.now) - big(observation.timestamp);
    if (age > big(memory.maxObservationAge) || age < 0n) {
      return {ok: false, status: OBSERVATION_STATUS.STALE_OBSERVATION, detail: `age ${age}`};
    }
  }
  return {ok: true, status: OBSERVATION_STATUS.ACCEPTED};
}

/// The whole adapter step: admit, decide, and build at most one action.
export function step({profileName, observation, policy, memory = {}, approval = APPROVAL.MAX_ONCE}) {
  const selected = selectProfile(profileName, {expectedChainId: observation?.chainId});
  if (!selected.ok) {
    return refusal(`profile: ${selected.status}`, selected.detail);
  }
  const profile = selected.profile;

  const admitted = admitObservation(observation, memory);
  if (!admitted.ok) return refusal(`observation: ${admitted.status}`, admitted.detail);

  const position = {
    collateral: big(observation.collateral),
    debt: big(observation.debt),
    price: big(observation.price),
    freeCollateral: big(observation.freeCollateral),
    freeDebtToken: big(observation.freeDebtToken),
  };

  // THE REFERENCE. Not re-derived here, so the adapter cannot disagree with what was tested.
  const decision = decide(position, policy, {
    pending: memory.pending,
    lastActionAt: memory.lastActionAt,
    now: observation.timestamp,
  });

  const intent = toIntent(decision.outcome);
  const base = {
    intent,
    decision,
    profile: profile.name,
    sequence: big(observation.sequence),
    observationCommitment: observationCommitment({...observation, profile: profile.name}),
    policyCommitment: policyCommitment(policy ?? {}),
    transactions: [],
  };

  if (intent !== INTENT.DEPOSIT_COLLATERAL && intent !== INTENT.REPAY_DEBT) {
    // A warning, a no-action, a pending tick and an insufficient-capital verdict all produce the
    // same thing: nothing to send. Asserted by rows rather than left to a reader.
    return base;
  }

  return {...base, transactions: buildActions(profile, intent, decision.amount, approval, memory)};
}

function refusal(reason, detail) {
  return {intent: INTENT.REFUSAL, reason, detail: detail ?? null, transactions: [], decision: null};
}

function toIntent(outcome) {
  if (outcome === OUTCOME.DEPOSIT_COLLATERAL) return INTENT.DEPOSIT_COLLATERAL;
  if (outcome === OUTCOME.REPAY_DEBT) return INTENT.REPAY_DEBT;
  if (outcome === OUTCOME.WARNING) return INTENT.WARNING;
  if (outcome === OUTCOME.NO_ACTION) return INTENT.NO_ACTION;
  return INTENT.REFUSAL;
}

/// The only two transaction shapes this module can produce.
///
/// Both the `to` and the spender come from the SELECTED PROFILE. There is no argument that could
/// redirect either, which is what makes "no arbitrary calldata" a property of the code rather than
/// a promise about how it is called.
export function buildActions(profile, intent, amount, approval, memory = {}) {
  const value = big(amount);
  if (value <= 0n) throw new Error("an action with no amount is not an action");

  const token = intent === INTENT.DEPOSIT_COLLATERAL ? profile.vETH : profile.vUSD;
  const method = intent === INTENT.DEPOSIT_COLLATERAL ? "deposit" : "repay";

  const out = [];
  const allowance = memory.allowance === undefined ? 0n : big(memory.allowance);
  if (approval !== APPROVAL.PRE_APPROVED && allowance < value) {
    const approveAmount = approval === APPROVAL.EXACT ? value : MAX_UINT256;
    out.push({
      purpose: "APPROVE",
      to: token,
      data: toHex(concat(bytesOf(SELECTOR.approve), wordAddress(profile.lending), wordUint(approveAmount))),
      decoded: {method: "approve", spender: profile.lending, amount: approveAmount.toString()},
    });
  }
  out.push({
    purpose: "ACTION",
    to: profile.lending,
    data: toHex(concat(bytesOf(SELECTOR[method]), wordUint(value))),
    decoded: {method, amount: value.toString()},
  });
  return out;
}

function bytesOf(hex) {
  const body = hex.slice(2);
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return out;
}
