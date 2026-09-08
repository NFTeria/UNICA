// The whole chain, in one place: a name a person typed, to a quote a merchant can sign.
//
//   ENS name -> classified resolution -> canonical MerchantConfig -> numeric merchant id
//            -> policy lookup -> consistency checks -> V2 quote
//
// WHAT THIS MODULE MAY NOT DO, and every one of these has a mutation:
//
//   * derive merchant identity from an operator address;
//   * let a POLICY overwrite the recipient a RESOLUTION produced;
//   * let a RESOLUTION overwrite a deployment-fixed hook, executor or chain;
//   * accept an address through any argument.
//
// The last one is inherited from `build.mjs` and extended here: there is no parameter on any
// exported function that carries a recipient or a payout token. Both come from the resolution and
// the deployment, or the chain does not build.
//
// FIELD AUTHORITY. Every field of the final quote has exactly one source, and where two could
// disagree there is an equality check rather than a precedence rule:
//
//   ENS-derived      recipient, name, namehash
//   policy-derived   nothing that reaches the quote — the policy governs what happens AFTER
//                    settlement, and is bound into the chain as evidence
//   deployment-fixed hook, executor, chainId, pool, payout currency
//   merchant-signed  the whole quote, once assembled
//   payer-selected   tokenIn, maxIn, the input side only
//   computed         merchantConfigHash, merchantId, every digest
//
// NOTHING HERE SIGNS OR SENDS. Digests in, digests out.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {concat, wordAddress, wordBytes32, wordUint} from "../../tools/unica-sign/abi.mjs";
import {merchantConfigHash} from "./config.mjs";
import {BUILD_STATUS, buildMerchantConfig} from "./build.mjs";
import {ID_STATUS, deriveMerchantId} from "./merchant-id.mjs";
import {POLICY_STATUS, readPolicy} from "./policy.mjs";

const utf8 = (s) => new TextEncoder().encode(s);
const hashOf = (s) => toHex(keccak256(utf8(s)));
const lower = (s) => String(s ?? "").toLowerCase();

export const CHAIN_STATUS = {
  BOUND: "BOUND",
  RESOLUTION_REFUSED: "RESOLUTION_REFUSED",
  CONFIG_REFUSED: "CONFIG_REFUSED",
  ID_REFUSED: "ID_REFUSED",
  POLICY_REFUSED: "POLICY_REFUSED",
  NAME_DISAGREES: "NAME_DISAGREES",
  RECIPIENT_DISAGREES: "RECIPIENT_DISAGREES",
  PAYOUT_DISAGREES: "PAYOUT_DISAGREES",
  CHAIN_DISAGREES: "CHAIN_DISAGREES",
  ADDRESS_ARGUMENT_REFUSED: "ADDRESS_ARGUMENT_REFUSED",
};

/// How strongly each stage is actually held, reported per run so a screen cannot round it up.
export const EVIDENCE = {
  LOCAL_FIXTURE: "LOCAL_FIXTURE",
  LOCALLY_VERIFIED: "LOCALLY_VERIFIED",
  FORK_VERIFIED: "FORK_VERIFIED",
  LIVE_VERIFIED: "LIVE_VERIFIED",
  UNAVAILABLE: "UNAVAILABLE",
};

const ADDRESS_FIELDS = ["recipient", "payoutCurrency", "operatorOverride", "merchant", "payTo"];

/// One word over the resolution a payer was shown, so a quote can point at it.
export function resolutionDigest(resolution) {
  return toHex(
    keccak256(
      concat(
        wordBytes32(hashOf("UNICA.resolution.v1")),
        wordBytes32(hashOf(String(resolution.name))),
        wordBytes32(resolution.namehash),
        wordAddress(resolution.recipient),
        wordUint(resolution.chainId),
        wordUint(resolution.resolvedAt ?? 0),
      ),
    ),
  );
}

/// One word over the policy that was read, so the chain records WHICH policy it saw without the
/// quote having to carry it. The policy governs post-settlement routing; it is evidence here.
export function policyDigest(policy) {
  return toHex(
    keccak256(
      concat(
        wordBytes32(hashOf("UNICA.merchantpolicy.v1")),
        wordUint(policy.merchantId),
        wordUint(policy.bankBps),
        wordUint(policy.holds.length),
        ...policy.holds.flatMap((h) => [wordAddress(h.token), wordUint(h.shareBps)]),
        wordBytes32(policy.payoutRef),
        wordUint(policy.version),
      ),
    ),
  );
}

/// Resolve, configure, identify, look up, and check the four things that could disagree.
///
/// @param resolution the object `resolveMerchant` returned. The ONLY source of a recipient.
/// @param deployment {chainId, payoutCurrency, hook, executor, registry}. Fixed by the deployment,
///        never by a caller's convenience.
/// @param options    {validForBlocks, atBlock, operator, call}
export async function bindIdentity(resolution, deployment, options = {}) {
  // No address may arrive through an option. Refused by name rather than ignored, because a caller
  // who passed one believes it is being used.
  for (const f of ADDRESS_FIELDS) {
    if (f in options) return {ok: false, status: CHAIN_STATUS.ADDRESS_ARGUMENT_REFUSED, detail: f};
  }

  if (resolution?.ok !== true) {
    return {ok: false, status: CHAIN_STATUS.RESOLUTION_REFUSED, detail: resolution?.status ?? "none"};
  }

  const built = buildMerchantConfig(resolution, {
    payoutCurrency: deployment.payoutCurrency,
    validForBlocks: options.validForBlocks,
    settlementChainId: deployment.chainId,
    atBlock: options.atBlock,
  });
  if (!built.ok) return {ok: false, status: CHAIN_STATUS.CONFIG_REFUSED, detail: built.status};

  const id = deriveMerchantId(resolution.input ?? resolution.name, {chainId: deployment.chainId});
  if (!id.ok) return {ok: false, status: CHAIN_STATUS.ID_REFUSED, detail: id.status};

  // The equality checks. Two sources CAN set each of these, so neither is given precedence.
  if (id.normalizedName !== built.config.name || id.namehash !== built.config.namehash) {
    return {ok: false, status: CHAIN_STATUS.NAME_DISAGREES,
            detail: `id says ${id.normalizedName}, config says ${built.config.name}`};
  }
  if (lower(built.config.recipient) !== lower(resolution.recipient)) {
    return {ok: false, status: CHAIN_STATUS.RECIPIENT_DISAGREES};
  }
  if (Number(built.config.chainId) !== Number(deployment.chainId)) {
    return {ok: false, status: CHAIN_STATUS.CHAIN_DISAGREES};
  }

  const read = await readPolicy(id.merchantId, {
    registry: deployment.registry,
    call: options.call,
    operator: options.operator,
  });
  if (!read.ok) return {ok: false, status: CHAIN_STATUS.POLICY_REFUSED, detail: read.status};

  // A policy routes the payout AFTER settlement, so the currency it splits must be the currency
  // the settlement pays. It does not get to change that currency — this is an equality, not a
  // substitution.
  const known = new Set([lower(deployment.payoutCurrency), ...read.policy.holds.map((h) => lower(h.token))]);
  if (!known.has(lower(built.config.payoutCurrency))) {
    return {ok: false, status: CHAIN_STATUS.PAYOUT_DISAGREES};
  }

  return {
    ok: true,
    status: CHAIN_STATUS.BOUND,
    name: {typed: resolution.input, normalized: built.config.name, namehash: built.config.namehash},
    merchantId: id.merchantId,
    resolution: {
      recipient: resolution.recipient,
      resolver: resolution.resolver,
      resolvedAt: resolution.resolvedAt,
      digest: resolutionDigest({...resolution, name: built.config.name, namehash: built.config.namehash}),
    },
    config: built.config,
    merchantConfigHash: built.merchantConfigHash,
    policy: read.policy,
    policyDigest: policyDigest(read.policy),
    authorisedOperator: read.authorisedOperator,
    // Quote-ready and IMMUTABLE from here: a caller may choose the input side and nothing else.
    immutable: {
      recipient: built.config.recipient,
      tokenOut: built.config.payoutCurrency,
      merchantConfigHash: built.merchantConfigHash,
      chainId: Number(deployment.chainId),
      hook: deployment.hook,
      executor: deployment.executor,
    },
    diagnostics: built.diagnostics,
  };
}

export const QUOTE_STATUS = {
  READY: "READY",
  NOT_BOUND: "NOT_BOUND",
  IMMUTABLE_FIELD_SUPPLIED: "IMMUTABLE_FIELD_SUPPLIED",
  MISSING_TERM: "MISSING_TERM",
  DEADLINE_BEYOND_CONFIG: "DEADLINE_BEYOND_CONFIG",
};

/// The fields a payer or a merchant's checkout may choose. Everything else comes from the binding.
const PAYER_TERMS = ["quoteId", "merchantSigner", "payer", "tokenIn", "maxIn", "amountOut",
                     "deadline", "pool", "zeroForOne", "version", "policyVersion"];

/// Assemble a V2 quote from a binding plus the terms a caller is allowed to set.
///
/// It adds NO field to the frozen `Quote` struct. The resolution the payer saw is bound through
/// `merchantConfigHash`, which V2 already carries and already puts inside the merchant's signature.
export function buildQuote(binding, terms = {}) {
  if (!binding?.ok) return {ok: false, status: QUOTE_STATUS.NOT_BOUND};
  for (const f of ["recipient", "tokenOut", "merchantConfigHash", "hook", "executor", "chainId"]) {
    if (f in terms) return {ok: false, status: QUOTE_STATUS.IMMUTABLE_FIELD_SUPPLIED, detail: f};
  }
  for (const f of PAYER_TERMS) {
    if (terms[f] === undefined || terms[f] === null) {
      return {ok: false, status: QUOTE_STATUS.MISSING_TERM, detail: f};
    }
  }
  return {
    ok: true,
    status: QUOTE_STATUS.READY,
    quote: {
      version: Number(terms.version),
      quoteId: terms.quoteId,
      merchantSigner: terms.merchantSigner,
      payer: terms.payer,
      recipient: binding.immutable.recipient,
      tokenIn: terms.tokenIn,
      maxIn: BigInt(terms.maxIn),
      tokenOut: binding.immutable.tokenOut,
      amountOut: BigInt(terms.amountOut),
      pool: {...terms.pool},
      zeroForOne: Boolean(terms.zeroForOne),
      deadline: BigInt(terms.deadline),
      hook: binding.immutable.hook,
      executor: binding.immutable.executor,
      merchantConfigHash: binding.immutable.merchantConfigHash,
      policyVersion: Number(terms.policyVersion),
    },
  };
}
