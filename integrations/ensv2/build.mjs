// From a validated resolution to a merchant configuration, and to nothing else.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE: a configuration's recipient comes from a RESOLUTION,
// never from a parameter. There is no argument here that can carry an address, so "resolve, then
// quietly pay somebody else" is not a mistake a caller can make — it is not expressible. The same
// goes for the payout currency, which is chosen from a compiled per-chain set rather than accepted.
//
// WHY A SEPARATE MODULE. `resolve.mjs` answers "which address does this name point at" and stops
// there, on purpose. Deciding whether that answer may become an invoice is a different question
// with different failure modes — a stale reading, a payout token nobody supports, a chain that is
// not the settlement chain — and mixing the two produces a resolver that sometimes refuses for
// commercial reasons and a builder that sometimes guesses at addresses.
//
// NOTHING HERE TOUCHES A CHAIN. It takes a resolution someone else performed, and returns a
// commitment. No RPC, no key, no clock: the block and its timestamp are inputs, because a builder
// that read the wall clock could not be tested against a fixture without lying about when it ran.

import {merchantConfigHash, isFresh} from "./config.mjs";

/// The configuration schema version this builder emits. Bumping it changes every commitment, which
/// is the point: an old signature must not fit a new schema.
export const CONFIG_VERSION = 1;

/// Ethereum's slot time. Not a guess and not a measurement — it is the protocol's fixed spacing,
/// and it is the reason a block window can bound a timestamp at all. See `expiryTimestamp` below
/// for why the conversion is safe in only one direction.
export const SECONDS_PER_BLOCK = 12;

/// The payout currencies a settlement can actually pay, per chain. COMPILED IN rather than
/// accepted, because "which tokens may a merchant be paid in" is a policy decision and a parameter
/// is not a policy. An unlisted token is refused by name instead of being carried into a quote
/// that would then fail somewhere less legible.
export const PAYOUT_CURRENCIES = {
  11155111: {
    "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238": {symbol: "USDC", decimals: 6},
  },
};

export const BUILD_STATUS = {
  BUILT: "BUILT",
  NOT_A_RESOLUTION: "NOT_A_RESOLUTION",
  RESOLUTION_REFUSED: "RESOLUTION_REFUSED",
  ZERO_RECIPIENT: "ZERO_RECIPIENT",
  NO_RESOLUTION_BLOCK: "NO_RESOLUTION_BLOCK",
  WRONG_CHAIN: "WRONG_CHAIN",
  UNSUPPORTED_PAYOUT_TOKEN: "UNSUPPORTED_PAYOUT_TOKEN",
  INVALID_VALIDITY_POLICY: "INVALID_VALIDITY_POLICY",
  STALE_RESOLUTION: "STALE_RESOLUTION",
  RECIPIENT_OVERRIDE_REFUSED: "RECIPIENT_OVERRIDE_REFUSED",
};

export const BUILD_EXPLAIN = {
  BUILT: "Built.",
  NOT_A_RESOLUTION: "That is not the shape a resolution has; nothing was built.",
  RESOLUTION_REFUSED: "The name did not resolve, so there is no merchant to configure.",
  ZERO_RECIPIENT: "The resolution carried no address; there is nobody to pay.",
  NO_RESOLUTION_BLOCK: "The resolution did not record which block it was read at, so its age cannot be judged.",
  WRONG_CHAIN: "The name was resolved on a different chain from the one being settled on.",
  UNSUPPORTED_PAYOUT_TOKEN: "That payout currency is not one this deployment can settle.",
  INVALID_VALIDITY_POLICY: "The validity window is not a usable number of blocks.",
  STALE_RESOLUTION: "That reading has expired. Resolve the name again.",
  RECIPIENT_OVERRIDE_REFUSED: "A recipient cannot be supplied; it comes from the resolution or not at all.",
};

const ZERO = "0x0000000000000000000000000000000000000000";
const isAddress = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
const refuse = (status, extra = {}) => ({ok: false, status, explain: BUILD_EXPLAIN[status], ...extra});

/// The last timestamp at which a reading may still be relied on.
///
/// The schema measures validity in BLOCKS and a quote's deadline is a TIMESTAMP, so one has to be
/// converted into the other. The conversion is sound in exactly one direction and that is why this
/// rule is safe: Ethereum slots are 12 seconds and an EMPTY slot produces no block, so
/// `validForBlocks` blocks always take AT LEAST `12 * validForBlocks` seconds. Bounding the quote
/// at that lower estimate therefore expires it no later than the configuration expires, never
/// after — the error is conservative by construction rather than by luck.
export function expiryTimestamp(config, resolvedAtTimestamp) {
  return BigInt(resolvedAtTimestamp) + BigInt(config.validForBlocks) * BigInt(SECONDS_PER_BLOCK);
}

/// Build the configuration a merchant will sign a quote against.
///
/// @param resolution the object `resolveMerchant` returned. Its `ok`, `status`, `recipient`,
///        `name`, `namehash`, `chainId` and `resolvedAt` are read; ITS RECIPIENT IS THE ONLY
///        SOURCE OF ONE.
/// @param policy    {payoutCurrency, validForBlocks, settlementChainId, atBlock}. `atBlock` is the
///        block the caller is building AT, so staleness is judged against a supplied number rather
///        than a clock this module reads for itself.
export function buildMerchantConfig(resolution, policy = {}) {
  if (!resolution || typeof resolution !== "object" || typeof resolution.status !== "string") {
    return refuse(BUILD_STATUS.NOT_A_RESOLUTION);
  }
  // A recipient may not arrive by any door but the resolution's. Refused loudly rather than
  // ignored, because a caller who passed one believes it is being used.
  if ("recipient" in policy) return refuse(BUILD_STATUS.RECIPIENT_OVERRIDE_REFUSED);

  if (resolution.ok !== true || resolution.status !== "RESOLVED") {
    return refuse(BUILD_STATUS.RESOLUTION_REFUSED, {resolutionStatus: resolution.status});
  }
  const recipient = resolution.recipient;
  if (!isAddress(recipient) || recipient.toLowerCase() === ZERO) {
    return refuse(BUILD_STATUS.ZERO_RECIPIENT);
  }

  const chainId = Number(policy.settlementChainId ?? resolution.chainId);
  if (!Number.isInteger(chainId) || chainId !== Number(resolution.chainId)) {
    return refuse(BUILD_STATUS.WRONG_CHAIN, {resolvedOn: resolution.chainId, settlingOn: chainId});
  }

  // The listed entry is CAPTURED here, not looked up again later. An earlier version read the
  // allowlist a second time when filling in diagnostics, which meant the explicit check below was
  // quietly load-bearing for something other than the refusal: remove it and the builder threw a
  // raw TypeError instead of refusing by name. Measured by sabotage.
  const payoutCurrency = policy.payoutCurrency;
  const allowed = PAYOUT_CURRENCIES[chainId] ?? {};
  const listed = isAddress(payoutCurrency) ? allowed[payoutCurrency.toLowerCase()] : undefined;
  if (listed === undefined) {
    return refuse(BUILD_STATUS.UNSUPPORTED_PAYOUT_TOKEN, {supported: Object.keys(allowed)});
  }

  const resolvedAtBlock = resolution.resolvedAt;
  if (resolvedAtBlock === null || resolvedAtBlock === undefined) {
    return refuse(BUILD_STATUS.NO_RESOLUTION_BLOCK);
  }

  const validForBlocks = policy.validForBlocks;
  if (!Number.isInteger(validForBlocks) || validForBlocks <= 0 || validForBlocks > 0xffffffff) {
    return refuse(BUILD_STATUS.INVALID_VALIDITY_POLICY);
  }

  const config = {
    version: CONFIG_VERSION,
    namehash: resolution.namehash,
    name: resolution.name,
    recipient,
    payoutCurrency,
    chainId,
    resolvedAtBlock: Number(resolvedAtBlock),
    validForBlocks,
  };

  // Staleness is judged against a block the CALLER supplies. A builder that read the head for
  // itself would need a network to be tested and would answer differently on every run.
  const atBlock = policy.atBlock ?? config.resolvedAtBlock;
  if (!isFresh(config, atBlock)) {
    return refuse(BUILD_STATUS.STALE_RESOLUTION, {
      resolvedAtBlock: config.resolvedAtBlock,
      validForBlocks,
      atBlock: Number(atBlock),
    });
  }

  return {
    ok: true,
    status: BUILD_STATUS.BUILT,
    explain: BUILD_EXPLAIN.BUILT,
    config,
    merchantConfigHash: merchantConfigHash(config),
    // OUTSIDE THE COMMITMENT, and named as such. These are useful for a receipt, a support ticket
    // or a screen; none of them is signed, so none of them may change the hash. There is a row
    // that proves changing every one of them at once leaves the commitment where it was.
    diagnostics: {
      input: resolution.input,
      dns: resolution.dns,
      resolver: resolution.resolver,
      entryPoint: resolution.entryPoint,
      payoutSymbol: listed.symbol,
      payoutDecimals: listed.decimals,
      builtAtBlock: Number(atBlock),
    },
  };
}
