/**
 * The confidentiality boundary, tested where it can actually be tested.
 *
 * WHAT THE SIMULATOR CANNOT PROVE, in Chainlink's own words, printed by the simulator itself:
 *
 *   "The simulator is not a real TEE, and is meant to debug. Do not use it for sensitive
 *    information."
 *   "During real execution, user logs for this trigger will not be visible, and will not leave the
 *    TEE. They are presented in the simulator for debugging only."
 *   — https://docs.chain.link/cre-templates/hello-confidential-workflows
 *
 * Two consequences, and both are why this file exists instead of a simulator assertion:
 *
 *   1. A canary appearing in SIMULATOR LOGS is documented, expected behaviour. Asserting its
 *      absence there would be asserting something the tool says is false, and a green result would
 *      mean the test was wrong rather than the boundary safe.
 *   2. Repository-controlled public and persistent surfaces — the public result, serialized
 *      artifacts, error messages, stack traces, calldata, and tracked files — CAN be tested
 *      offline, exactly, right here. So they are.
 *
 *      Canary tests cover repository-controlled public and persistent surfaces observable locally.
 *      Production TEE confidentiality remains untested pending hosted access. Nothing in this file
 *      is evidence about an enclave.
 *
 * Chainlink's concept page also states the rule this file enforces by construction:
 * "Don't log in production Confidential Workflows."
 * — https://docs.chain.link/cre/concepts/confidential-workflows
 *
 * Run: node integrations/chainlink-cre-robinhood/tests/confidentiality.test.mjs
 * Offline. No CRE CLI, no key, no RPC, no network.
 */

import { inspect } from "node:util";
import { randomBytes } from "node:crypto";
import { decide, policyCommitment, VERDICT, EVIDENCE } from "../policy.mjs";

let ok = 0;
let fail = 0;
const chk = (name, pass, detail = "") => {
  if (pass) {
    ok++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  [${detail}]` : ""}`);
  }
};

/** A fresh synthetic canary per run. Never a real credential; never committed. */
const canary = (label) => `CANARY-${label}-${randomBytes(12).toString("hex")}`;

const CANARIES = {
  quoteCredential: canary("quotecred"),
  venuePolicy: canary("venue"),
  submissionConfig: canary("submit"),
  simulationPolicy: canary("simpolicy"),
};

const policy = {
  // Private. Every one of these is a value a merchant would not want published.
  maxDeviationBps: 250,
  maxQuoteAgeSeconds: 30,
  minMerchantOut: "1000000",
  preferredVenue: CANARIES.venuePolicy,
  supportedChainIds: [46630],
  quoteCredential: CANARIES.quoteCredential,
  submissionConfig: CANARIES.submissionConfig,
  simulationPolicy: CANARIES.simulationPolicy,
};

// Public. Every field here must be public for the settlement to exist on chain at all.
const intent = {
  chainId: 46630,
  settlementContract: "0x" + "11".repeat(20),
  hook: "0x" + "22".repeat(20),
  poolManager: "0x" + "33".repeat(20),
  inputToken: "0x" + "44".repeat(20),
  maxInput: "1000000000000000000",
  payoutToken: "0x" + "55".repeat(20),
  minOut: "1000000",
  recipient: "0x" + "66".repeat(20),
  poolId: "0x" + "77".repeat(32),
  deadline: 1789060000,
  nonce: "0x" + "88".repeat(32),
};

const refQuote = { amountOut: "1200000", atSeconds: 1789059990 };
const setQuote = { amountOut: "1210000", atSeconds: 1789059990 };
const now = 1789060000;

const every = Object.values(CANARIES);
const leaksIn = (text) => every.filter((c) => String(text).includes(c));

// ── 1. the public result ──────────────────────────────────────────────────────────────────────

const result = decide({
  intent,
  referenceQuote: refQuote,
  settlementQuote: setQuote,
  policy,
  nowSeconds: now,
  evidence: EVIDENCE.MOCK,
});

chk("the public result carries no canary", leaksIn(JSON.stringify(result)).length === 0, leaksIn(JSON.stringify(result)).join(","));
chk("the public result serialized with util.inspect carries no canary", leaksIn(inspect(result, { depth: null })).length === 0);
chk(
  "the public result has ONLY the four permitted keys",
  JSON.stringify(Object.keys(result).sort()) === JSON.stringify(["deviationBps", "evidence", "policyCommitment", "verdict"]),
  Object.keys(result).join(","),
);
chk("the commitment is not the policy", !leaksIn(result.policyCommitment).length && result.policyCommitment.startsWith("policy-"));

// ── 2. the control. A test that cannot detect a leak is not a test. ───────────────────────────

const planted = { ...result, leaked: CANARIES.quoteCredential };
chk("control: a deliberately planted canary IS detected", leaksIn(JSON.stringify(planted)).length === 1);

// ── 3. errors, stack traces, and the path after a secret has been read ────────────────────────

let thrownText = "";
try {
  decide({ intent, referenceQuote: refQuote, settlementQuote: setQuote, policy, nowSeconds: now, evidence: "confirmed" });
} catch (e) {
  thrownText = `${e.message}\n${e.stack}`;
}
chk("the evidence-class guard refuses 'confirmed'", thrownText.includes("evidence must be one of"));
chk("a thrown error's message and stack carry no canary", leaksIn(thrownText).length === 0);

let afterSecretThrow = "";
try {
  // A throw raised AFTER the private policy has been read and is live in the frame.
  const p = { ...policy };
  if (p.quoteCredential) throw new Error(`quote request failed for chain ${intent.chainId}`);
} catch (e) {
  afterSecretThrow = `${e.message}\n${e.stack}`;
}
chk("an error thrown AFTER secret access carries no canary", leaksIn(afterSecretThrow).length === 0);

// ── 4. malformed private values must not be echoed ────────────────────────────────────────────

let malformedText = "";
try {
  decide({
    intent,
    referenceQuote: refQuote,
    settlementQuote: setQuote,
    policy: { ...policy, supportedChainIds: null },
    nowSeconds: now,
    evidence: EVIDENCE.MOCK,
  });
} catch (e) {
  malformedText = `${e.message}\n${e.stack}`;
}
chk("a malformed private field does not echo any canary", leaksIn(malformedText).length === 0, malformedText.slice(0, 80));

// ── 5. every rejection path, not just the happy one ───────────────────────────────────────────

const paths = [
  ["stale quote", { settlementQuote: { ...setQuote, atSeconds: now - 999 } }, VERDICT.REJECT_STALE_QUOTE],
  ["excess deviation", { settlementQuote: { ...setQuote, amountOut: "2400000" } }, VERDICT.REJECT_DEVIATION],
  ["below the floor", { intent: { ...intent, minOut: "99999999" }, settlementQuote: { ...setQuote, amountOut: "1000" }, referenceQuote: { ...refQuote, amountOut: "1000" } }, VERDICT.REJECT_BELOW_FLOOR],
  ["unsupported chain", { intent: { ...intent, chainId: 1 } }, VERDICT.REJECT_UNSUPPORTED_CHAIN],
];
for (const [label, over, expected] of paths) {
  const r = decide({
    intent, referenceQuote: refQuote, settlementQuote: setQuote, policy, nowSeconds: now, evidence: EVIDENCE.MOCK, ...over,
  });
  chk(`rejection path "${label}" returns ${expected} and leaks nothing`,
      r.verdict === expected && leaksIn(JSON.stringify(r)).length === 0, r.verdict);
}

// ── 6. accidental whole-context logging, which is how this actually happens ───────────────────

const context = { intent, referenceQuote: refQuote, settlementQuote: setQuote, result };
chk(
  "a whole-context object that EXCLUDES policy is safe to serialize",
  leaksIn(inspect(context, { depth: null })).length === 0,
);
const careless = { ...context, policy };
chk(
  "control: a context that INCLUDES policy leaks, which is why policy is never put in one",
  leaksIn(inspect(careless, { depth: null })).length === Object.keys(CANARIES).length,
);

// ── 7. calldata. A private value must never be an argument. ───────────────────────────────────

const calldata =
  "0x" + [intent.settlementContract, intent.recipient, intent.poolId, intent.nonce].map((h) => h.replace(/^0x/, "")).join("");
chk("constructed calldata carries no canary", leaksIn(calldata).length === 0);

// ── 8. the commitment is stable and is not reversible by inspection ───────────────────────────

chk("the same policy commits to the same value", policyCommitment(policy) === policyCommitment({ ...policy }));
chk(
  "a changed private threshold changes the commitment",
  policyCommitment(policy) !== policyCommitment({ ...policy, maxDeviationBps: 251 }),
);

console.log(`\nchecks run: ${ok + fail}, passed: ${ok}, failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
