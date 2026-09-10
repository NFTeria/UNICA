/**
 * The decision logic, as a pure module.
 *
 * WHY THIS IS SEPARATE FROM THE CRE HANDLER. Every function here is a pure transformation of its
 * arguments — no clock, no network, no randomness, no runtime. That makes the confidentiality
 * boundary testable without a simulator, a login, or a key, which matters because the simulator
 * CANNOT test confidentiality. Chainlink's own template output says so:
 *
 *   "The simulator is not a real TEE, and is meant to debug. Do not use it for sensitive
 *    information."
 *   "During real execution, user logs for this trigger will not be visible, and will not leave the
 *    TEE. They are presented in the simulator for debugging only."
 *   — https://docs.chain.link/cre-templates/hello-confidential-workflows
 *
 * So a private value appearing in a SIMULATOR log is documented, expected behaviour and is not a
 * leak. The boundary that can be tested — and is, in tests/confidentiality.test.mjs — is whether a
 * private value reaches the PUBLIC RESULT, a serialized artifact, an error message, a stack trace,
 * or calldata. Those are the surfaces that survive into production.
 */

/** What the workflow may return. Nothing else crosses the boundary. */
export const VERDICT = Object.freeze({
  PROCEED: "PROCEED",
  REJECT_STALE_QUOTE: "REJECT_STALE_QUOTE",
  REJECT_DEVIATION: "REJECT_DEVIATION",
  REJECT_BELOW_FLOOR: "REJECT_BELOW_FLOOR",
  REJECT_SIMULATION_FAILED: "REJECT_SIMULATION_FAILED",
  REJECT_UNSUPPORTED_CHAIN: "REJECT_UNSUPPORTED_CHAIN",
});

/**
 * Evidence class. `confirmed` is reserved for a real confirmed target-chain transaction and is
 * never produced by this module — a function that could return it from fixture or simulator data
 * would be the whole defect this vocabulary exists to prevent.
 */
export const EVIDENCE = Object.freeze({
  MOCK: "mock",
  SIMULATED: "simulated",
  CONFIRMED: "confirmed",
});

export const PRODUCIBLE_EVIDENCE = Object.freeze([EVIDENCE.MOCK, EVIDENCE.SIMULATED]);

/** Basis points between two integer quantities, relative to the reference. Null when undefined. */
export function deviationBps(referenceOut, settlementOut) {
  const r = BigInt(referenceOut);
  const s = BigInt(settlementOut);
  if (r <= 0n) return null;
  return Number(((s - r) * 10_000n) / r);
}

export function quoteIsFresh(quoteAtSeconds, nowSeconds, maxAgeSeconds) {
  return BigInt(nowSeconds) - BigInt(quoteAtSeconds) < BigInt(maxAgeSeconds);
}

/**
 * The decision.
 *
 * `intent` is PUBLIC — every field of it must eventually be public for the settlement to exist on
 * chain at all. `policy` is PRIVATE and must not appear in the return value. The return value is
 * the only thing that crosses the enclave boundary, so it is deliberately small: a verdict, a
 * reason code, the evidence class, and a commitment to the policy rather than the policy.
 */
export function decide({ intent, referenceQuote, settlementQuote, policy, nowSeconds, evidence }) {
  if (!PRODUCIBLE_EVIDENCE.includes(evidence)) {
    throw new Error(`evidence must be one of ${PRODUCIBLE_EVIDENCE.join("|")}`);
  }
  if (!policy.supportedChainIds.includes(intent.chainId)) {
    return _result(VERDICT.REJECT_UNSUPPORTED_CHAIN, evidence, policy, null);
  }
  if (!quoteIsFresh(settlementQuote.atSeconds, nowSeconds, policy.maxQuoteAgeSeconds)) {
    return _result(VERDICT.REJECT_STALE_QUOTE, evidence, policy, null);
  }
  const drift = deviationBps(referenceQuote.amountOut, settlementQuote.amountOut);
  if (drift !== null && Math.abs(drift) > policy.maxDeviationBps) {
    return _result(VERDICT.REJECT_DEVIATION, evidence, policy, drift);
  }
  // The workflow's own floor check is ADVISORY. The binding floor is the order's minOut, enforced
  // on chain by the hook and re-measured by the executor. This check exists to avoid submitting a
  // transaction that would revert, not to be the protection.
  if (BigInt(settlementQuote.amountOut) < BigInt(intent.minOut)) {
    return _result(VERDICT.REJECT_BELOW_FLOOR, evidence, policy, drift);
  }
  return _result(VERDICT.PROCEED, evidence, policy, drift);
}

/**
 * A commitment to the policy, not the policy.
 *
 * This is what lets a public result say "decided under policy X" without saying what X is. It is a
 * plain digest of the private values, so an observer who already knows a candidate policy can
 * confirm it and an observer who does not learns nothing beyond its length.
 *
 * IT IS NOT AN ATTESTATION and proves nothing about where the code ran.
 */
export function policyCommitment(policy) {
  const canonical = JSON.stringify([
    policy.maxDeviationBps,
    policy.maxQuoteAgeSeconds,
    policy.minMerchantOut,
    policy.preferredVenue,
    [...policy.supportedChainIds].sort((a, b) => a - b),
  ]);
  // FNV-1a, written here rather than imported: the point is a stable short digest with no
  // dependency, and a cryptographic hash would imply a security property this does not have.
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return "policy-" + h.toString(16).padStart(8, "0");
}

function _result(verdict, evidence, policy, deviation) {
  return Object.freeze({
    verdict,
    evidence,
    policyCommitment: policyCommitment(policy),
    // Included because a deviation figure is derivable from two public quotes anyway, so hiding it
    // buys nothing and showing it makes a rejection explicable.
    deviationBps: deviation,
  });
}
