// The numeric merchant identity, derived once and from the name alone.
//
// WHY THIS FILE HAD TO BE WRITTEN. `merchant_policy.vy` takes `merchant_id` as an ARGUMENT — it
// derives nothing. Whoever calls `register` chooses the number. That is fine for a contract whose
// job is bookkeeping, and it is not fine for an identity: two callers can pick the same number, one
// caller can pick a number belonging to somebody else, and nothing on chain would notice.
//
// So the derivation lives here, and it binds exactly what identity should depend on:
//
//     merchantId = keccak256(domain, namehash, keccak(normalized name), chainId, policyVersion)
//
// NOT THE OPERATOR. The operator is a key, and a key is rotated. Deriving identity from it would
// mean a merchant who changed keys became a different merchant, losing their policy, their history
// and any receipt that pointed at them. `merchant_policy.vy` already separates the two — the id is
// the merchant, `owner_of[id]` is the key — and this preserves that separation rather than
// quietly collapsing it. There is a mutation for it.
//
// THE NAME MUST BE NORMALISED FIRST. `Merchant.eth` and `merchant.eth` are the same merchant and
// must produce the same id; a name this repository cannot normalise produces no id at all rather
// than an approximate one, which is the rule `web/ensv2/resolve.mjs` already enforces.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {concat, wordBytes32, wordUint} from "../../tools/unica-sign/abi.mjs";
import {namehash, normalizeName} from "../../web/ensv2/resolve.mjs";

const utf8 = (s) => new TextEncoder().encode(s);
const hashOf = (s) => toHex(keccak256(utf8(s)));

/// Bumping this changes every merchant's id, which is why it is a constant and not an argument.
export const MERCHANT_ID_VERSION = 1;
export const MERCHANT_ID_DOMAIN = "UNICA.merchant.id.v1";

export const ID_STATUS = {
  DERIVED: "DERIVED",
  NAME_NOT_NORMALISABLE: "NAME_NOT_NORMALISABLE",
  NO_CHAIN: "NO_CHAIN",
};

/// @param name a merchant's ENS name, in whatever case the user typed it
/// @param chainId the chain the policy and settlement live on
export function deriveMerchantId(name, {chainId, policyVersion = MERCHANT_ID_VERSION} = {}) {
  if (chainId === undefined || chainId === null || !Number.isInteger(Number(chainId))) {
    return {ok: false, status: ID_STATUS.NO_CHAIN};
  }
  const norm = normalizeName(name);
  if (!norm.ok) return {ok: false, status: ID_STATUS.NAME_NOT_NORMALISABLE, detail: norm.status};

  const node = namehash(norm.name);
  const word = toHex(
    keccak256(
      concat(
        wordBytes32(hashOf(MERCHANT_ID_DOMAIN)),
        wordBytes32(node),
        // The normalised name itself as well as its namehash. The namehash is a function of the
        // name, so this adds nothing cryptographically — what it adds is that a caller cannot
        // supply a namehash computed from some OTHER spelling and have it accepted.
        wordBytes32(hashOf(norm.name)),
        wordUint(chainId),
        wordUint(policyVersion),
      ),
    ),
  );
  return {
    ok: true,
    status: ID_STATUS.DERIVED,
    merchantId: BigInt(word),
    normalizedName: norm.name,
    namehash: node,
    chainId: Number(chainId),
    policyVersion: Number(policyVersion),
  };
}
