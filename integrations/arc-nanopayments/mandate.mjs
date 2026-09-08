// The agent mandate: everything a Gateway authorization does not bind.
//
// A Circle Gateway nanopayment signature covers six fields — payer, recipient, amount, a validity
// window, a nonce, and through its domain the chain and the GatewayWallet. That is a real
// cryptographic commitment and it is the whole of one. It says nothing about WHICH resource was
// bought, what was asked for, what came back, how much the agent may spend in total, or what the
// answer is allowed to cause. Every one of those has to be bound somewhere, and since it cannot be
// bound in the payment, it is bound here.
//
// THE MODEL PROPOSES; THIS DECIDES. A language model's output reaches this module as data and is
// checked against a mandate the owner signed. It cannot raise a ceiling, choose a recipient, add a
// provider or widen a deadline, because none of those is read from it.
//
// EVERY AMOUNT IS AN INTEGER IN USDC BASE UNITS. A price formatted for a screen and parsed back is
// how a rounding difference becomes an accepted overspend.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {concat, wordAddress, wordBytes32, wordUint} from "../../tools/unica-sign/abi.mjs";

const utf8 = (s) => new TextEncoder().encode(s);
const hashOf = (s) => toHex(keccak256(utf8(s)));

export const MANDATE_VERSION = 1;

/// How strongly a piece of evidence is actually held. Recorded per item rather than assumed for
/// the whole record, because a trail that mixes a signature with an API answer and calls the
/// result "verified" is worse than one that claims nothing.
export const EVIDENCE = {
  /// Re-derived here from a preimage and checked. The strongest thing this module can say.
  CRYPTOGRAPHICALLY_VERIFIED: "CRYPTOGRAPHICALLY_VERIFIED",
  /// A valid signature by the party it names, checked locally, but over a statement of intent
  /// rather than of outcome. A Gateway authorization is this.
  PROTOCOL_SIGNED: "PROTOCOL_SIGNED",
  /// Somebody's server said so. Circle's settle response is this: {success, transaction} with no
  /// per-payment proof attached.
  API_REPORTED: "API_REPORTED",
  /// Produced by a fixture in this repository. True of the test, not of any chain.
  LOCALLY_SIMULATED: "LOCALLY_SIMULATED",
  /// Asked for and not obtainable at the pinned upstream revision.
  UNAVAILABLE: "UNAVAILABLE",
};

export const POLICY_STATUS = {
  AUTHORIZED: "AUTHORIZED",
  UNKNOWN_PROVIDER: "UNKNOWN_PROVIDER",
  UNKNOWN_RESOURCE: "UNKNOWN_RESOURCE",
  PRICE_ABOVE_PER_CALL_CEILING: "PRICE_ABOVE_PER_CALL_CEILING",
  SESSION_BUDGET_EXCEEDED: "SESSION_BUDGET_EXCEEDED",
  MANDATE_EXPIRED: "MANDATE_EXPIRED",
  WRONG_CHAIN: "WRONG_CHAIN",
  WRONG_PAYER: "WRONG_PAYER",
  WRONG_RECIPIENT: "WRONG_RECIPIENT",
  REQUEST_MISMATCH: "REQUEST_MISMATCH",
  RESPONSE_MISMATCH: "RESPONSE_MISMATCH",
  STALE_DATA: "STALE_DATA",
  MALFORMED_PROPOSAL: "MALFORMED_PROPOSAL",
  UNPERMITTED_ACTION: "UNPERMITTED_ACTION",
  ACTION_ABOVE_MANDATE: "ACTION_ABOVE_MANDATE",
  PROPOSAL_ALTERED_A_BOUND_FIELD: "PROPOSAL_ALTERED_A_BOUND_FIELD",
};

export const MANDATE_TYPE =
  "AgentMandate(uint8 version,bytes32 sessionId,address agent,uint256 chainId," +
  "bytes32 providersRoot,bytes32 resourcesRoot,uint256 maxPerCall,uint256 sessionBudget," +
  "uint256 maxActionInput,uint256 expiry,uint32 policyVersion)";

/// A set of allowed strings, folded into one word. Sorted first, so the commitment is a property
/// of the SET and not of the order somebody happened to write it in.
export function setRoot(items) {
  const sorted = [...items].map((s) => String(s).toLowerCase()).sort();
  return toHex(keccak256(concat(...sorted.map((s) => wordBytes32(hashOf(s))))));
}

export function mandateDigest(m) {
  const need = ["sessionId", "agent", "chainId", "providers", "resources", "maxPerCall",
                "sessionBudget", "maxActionInput", "expiry", "policyVersion"];
  for (const f of need) {
    if (m[f] === undefined || m[f] === null) throw new Error(`mandate is missing ${f}`);
  }
  return toHex(
    keccak256(
      concat(
        wordBytes32(hashOf(MANDATE_TYPE)),
        wordUint(MANDATE_VERSION),
        wordBytes32(m.sessionId),
        wordAddress(m.agent),
        wordUint(m.chainId),
        wordBytes32(setRoot(m.providers)),
        wordBytes32(setRoot(m.resources)),
        wordUint(m.maxPerCall),
        wordUint(m.sessionBudget),
        wordUint(m.maxActionInput),
        wordUint(m.expiry),
        wordUint(m.policyVersion),
      ),
    ),
  );
}

/// The digest of one request, so the answer can be tied to the question.
export function requestDigest({resource, params, nonce}) {
  return toHex(keccak256(utf8(JSON.stringify({resource, params, nonce}))));
}

/// The digest of one response. Computed over the canonical body the provider returned, so a
/// provider that answered a different question is caught by comparison rather than by trust.
export function responseDigest(body) {
  return toHex(keccak256(utf8(JSON.stringify(body))));
}

/// A session's spend, held so that a decision and its accounting cannot come apart.
///
/// THE UPSTREAM DEMO CANNOT DO THIS. Its agent fires payments on a timer and adds the amount to
/// `totalSpent` inside the promise's `.then`, so the ceiling is compared AFTER settlement while
/// other payments are still in flight — its own log prints the in-flight count. Reserving before
/// the spend and releasing after is the difference between a budget and a running total.
export class SessionBudget {
  constructor(limit) {
    this.limit = BigInt(limit);
    this.committed = 0n;
    this.reserved = 0n;
  }

  get available() {
    return this.limit - this.committed - this.reserved;
  }

  /// Take the amount out of the budget BEFORE the payment is made. Two concurrent requests cannot
  /// both see the same remaining balance, because the first one has already removed it.
  reserve(amount) {
    const a = BigInt(amount);
    if (a > this.available) return false;
    this.reserved += a;
    return true;
  }

  settle(amount) {
    const a = BigInt(amount);
    this.reserved -= a;
    this.committed += a;
  }

  release(amount) {
    this.reserved -= BigInt(amount);
  }
}

const lower = (s) => String(s ?? "").toLowerCase();
const refuse = (status, detail) => ({ok: false, status, detail, actionMandate: null, calldata: null});

/// The gate between what an agent was told and what it may do.
///
/// It returns an ACTION MANDATE or a named refusal, and never anything in between: a refused
/// decision carries no mandate, no calldata, and nothing a caller could mistake for authorisation.
///
/// @param mandate  what the owner signed
/// @param evidence {authorization, resource, requestDigest, responseDigest, observedAt, price}
/// @param proposal the model's structured output. DATA, not instruction.
/// @param ctx      {now, budget, chainId}
export function authorizeAction(mandate, evidence, proposal, ctx) {
  const now = BigInt(ctx.now);
  if (now > BigInt(mandate.expiry)) return refuse(POLICY_STATUS.MANDATE_EXPIRED, `expired at ${mandate.expiry}`);
  if (Number(ctx.chainId) !== Number(mandate.chainId)) return refuse(POLICY_STATUS.WRONG_CHAIN);

  // ---- what was bought -------------------------------------------------------------------
  const providers = mandate.providers.map(lower);
  const resources = mandate.resources.map(lower);
  if (!providers.includes(lower(evidence.authorization?.to))) {
    return refuse(POLICY_STATUS.UNKNOWN_PROVIDER, lower(evidence.authorization?.to));
  }
  if (!resources.includes(lower(evidence.resource))) {
    return refuse(POLICY_STATUS.UNKNOWN_RESOURCE, evidence.resource);
  }
  if (lower(evidence.authorization?.from) !== lower(mandate.agent)) {
    return refuse(POLICY_STATUS.WRONG_PAYER, evidence.authorization?.from);
  }

  const price = BigInt(evidence.price);
  if (BigInt(evidence.authorization.value) !== price) {
    return refuse(POLICY_STATUS.WRONG_RECIPIENT, "the signed amount is not the quoted price");
  }
  if (price > BigInt(mandate.maxPerCall)) {
    return refuse(POLICY_STATUS.PRICE_ABOVE_PER_CALL_CEILING, `${price} > ${mandate.maxPerCall}`);
  }
  if (ctx.budget && BigInt(ctx.budget.committed) > BigInt(mandate.sessionBudget)) {
    return refuse(POLICY_STATUS.SESSION_BUDGET_EXCEEDED);
  }

  // ---- the answer belongs to the question ---------------------------------------------------
  if (evidence.requestDigest !== proposal.requestDigest) {
    return refuse(POLICY_STATUS.REQUEST_MISMATCH);
  }
  if (evidence.responseDigest !== proposal.responseDigest) {
    return refuse(POLICY_STATUS.RESPONSE_MISMATCH);
  }
  const age = now - BigInt(evidence.observedAt);
  if (age < 0n || age > BigInt(mandate.maxDataAge ?? 0)) {
    return refuse(POLICY_STATUS.STALE_DATA, `observed ${evidence.observedAt}, now ${now}`);
  }

  // ---- the proposal, as data ------------------------------------------------------------------
  for (const f of ["action", "tokenIn", "tokenOut", "maximumInput", "minimumOutput", "reasonCode"]) {
    if (proposal[f] === undefined || proposal[f] === null) {
      return refuse(POLICY_STATUS.MALFORMED_PROPOSAL, `missing ${f}`);
    }
  }
  if (!mandate.actions.includes(proposal.action)) {
    return refuse(POLICY_STATUS.UNPERMITTED_ACTION, proposal.action);
  }
  // The model may not name an asset the mandate does not list, and may not move the recipient.
  if (!mandate.assets.map(lower).includes(lower(proposal.tokenIn))
      || !mandate.assets.map(lower).includes(lower(proposal.tokenOut))) {
    return refuse(POLICY_STATUS.PROPOSAL_ALTERED_A_BOUND_FIELD, "asset outside the mandate");
  }
  if (proposal.recipient !== undefined && lower(proposal.recipient) !== lower(mandate.recipient)) {
    return refuse(POLICY_STATUS.PROPOSAL_ALTERED_A_BOUND_FIELD, "recipient");
  }
  if (BigInt(proposal.maximumInput) > BigInt(mandate.maxActionInput)) {
    return refuse(POLICY_STATUS.ACTION_ABOVE_MANDATE, `${proposal.maximumInput} > ${mandate.maxActionInput}`);
  }

  return {
    ok: true,
    status: POLICY_STATUS.AUTHORIZED,
    actionMandate: {
      version: MANDATE_VERSION,
      sessionId: mandate.sessionId,
      agent: mandate.agent,
      mandateDigest: mandateDigest(mandate),
      evidenceDigest: evidenceDigest(evidence),
      recipient: mandate.recipient,
      tokenIn: proposal.tokenIn,
      tokenOut: proposal.tokenOut,
      maximumInput: BigInt(proposal.maximumInput).toString(),
      minimumOutput: BigInt(proposal.minimumOutput).toString(),
      action: proposal.action,
      reasonCode: proposal.reasonCode,
      deadline: Number(mandate.expiry),
      chainId: Number(mandate.chainId),
      policyVersion: Number(mandate.policyVersion),
    },
    // Deliberately null. Building calldata is a later slice's job and is not something a policy
    // decision should hand back by accident.
    calldata: null,
  };
}

/// One word over everything the agent paid for and was told, so an action can point at its cause.
export function evidenceDigest(e) {
  return toHex(
    keccak256(
      concat(
        wordBytes32(hashOf(String(e.resource))),
        wordAddress(e.authorization.from),
        wordAddress(e.authorization.to),
        wordUint(e.authorization.value),
        wordBytes32(e.authorization.nonce),
        wordBytes32(e.requestDigest),
        wordBytes32(e.responseDigest),
        wordUint(e.observedAt),
      ),
    ),
  );
}

/// What each part of the trail is actually worth, at the pinned upstream revision.
export const EVIDENCE_GRADE = {
  payerAgreedToPay: EVIDENCE.PROTOCOL_SIGNED,
  recipientOfPayment: EVIDENCE.PROTOCOL_SIGNED,
  amountOfPayment: EVIDENCE.PROTOCOL_SIGNED,
  paymentWindow: EVIDENCE.PROTOCOL_SIGNED,
  paymentNonce: EVIDENCE.PROTOCOL_SIGNED,
  paymentSettled: EVIDENCE.API_REPORTED,
  settlementTransaction: EVIDENCE.API_REPORTED,
  positionWithinBatch: EVIDENCE.UNAVAILABLE,
  batchCommitment: EVIDENCE.UNAVAILABLE,
  resourcePurchased: EVIDENCE.UNAVAILABLE,
  requestContent: EVIDENCE.UNAVAILABLE,
  responseContent: EVIDENCE.UNAVAILABLE,
  agentMandate: EVIDENCE.CRYPTOGRAPHICALLY_VERIFIED,
  requestResponseBinding: EVIDENCE.CRYPTOGRAPHICALLY_VERIFIED,
};
