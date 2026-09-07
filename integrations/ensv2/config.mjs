// UNICA — the merchant configuration commitment, derived offline.
//
// A payer types a name. Between that name and a settlement there is a RESOLUTION, and a resolution
// is a reading of mutable state at a moment in time. This module records that reading as one word
// which the merchant signs, so the address a payer was shown is part of what was agreed rather
// than something they had to trust.
//
// It is the second derivation of `src/v2/MerchantConfig.sol`, written from the EIP-712
// specification rather than from that file, and the two are compared against a pinned vector in
// `test/v2/MerchantConfig.t.sol`. The reason is the same one that produced this repository's
// Permit2 module: a digest a wallet computes differently from the contract is rejected in the
// wallet, not in the test suite.
//
// The ABI word encoders are imported rather than rewritten. They were written and validated for
// the Permit2 digest, and two descriptions of one encoding is a mismatch waiting to happen.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {concat, typeHash, utf8, wordAddress, wordBytes32, wordUint} from "../permit2/digest.mjs";

export const CONFIG_TYPE =
  "MerchantConfig(uint8 version,bytes32 namehash,string name,address recipient," +
  "address payoutCurrency,uint256 chainId,uint64 resolvedAtBlock,uint32 validForBlocks)";

/// @param config.name MUST already be normalised. This module does not normalise; `resolve.mjs`
///        does, and it refuses names it cannot normalise rather than approximating.
export function merchantConfigHash(config) {
  const required = [
    "version", "namehash", "name", "recipient", "payoutCurrency", "chainId", "resolvedAtBlock", "validForBlocks",
  ];
  for (const f of required) {
    if (config[f] === undefined || config[f] === null) throw new Error(`merchant config is missing ${f}`);
  }
  return toHex(
    keccak256(
      concat(
        wordBytes32(typeHash(CONFIG_TYPE)),
        wordUint(config.version),
        wordBytes32(config.namehash),
        wordBytes32(toHex(keccak256(utf8(config.name)))),
        wordAddress(config.recipient),
        wordAddress(config.payoutCurrency),
        wordUint(config.chainId),
        wordUint(config.resolvedAtBlock),
        wordUint(config.validForBlocks),
      ),
    ),
  );
}

/// Whether a reading may still be relied on at a given block.
///
/// This is the ONLY place the expiry window is enforced, and saying so plainly matters: the
/// settlement contracts never see this struct, only its hash, so nothing on chain can check the
/// window. What protects a payer on chain is that a fresh resolution produces a DIFFERENT
/// commitment and therefore a different quote digest — an old merchant signature simply does not
/// fit a new reading. The quote's own deadline is the on-chain time bound.
export function isFresh(config, atBlock) {
  const at = BigInt(atBlock);
  const from = BigInt(config.resolvedAtBlock);
  return at >= from && at <= from + BigInt(config.validForBlocks);
}

/// Refuses to build a commitment from a reading that has already expired, so a stale checkout
/// cannot quietly become a signed invoice.
export function commitResolution(config, atBlock) {
  if (!isFresh(config, atBlock)) {
    throw new Error(
      `this resolution was read at block ${config.resolvedAtBlock}, is good for ` +
        `${config.validForBlocks} blocks, and it is now block ${atBlock}: resolve again`,
    );
  }
  return merchantConfigHash(config);
}
