// Reading a merchant's settlement policy, and refusing to guess when the read fails.
//
// THE RULE THIS MODULE EXISTS FOR: a failed read is NOT an empty policy. An RPC timeout, a wrong
// address, a reverted call and a merchant who was never registered are four different things, and
// three of them must not look like "this merchant takes 0% to the bank". Every one gets its own
// status, and none of them produces a policy object.
//
// IT OPENS NO SOCKET. `call(to, data) -> hex` is injected, exactly as `resolveMerchant` takes its
// `rpcCall`, so the default tests run against bytes captured from the real Vyper contract and no
// network is involved anywhere.
//
// THE OPERATOR IS A KEY, NOT AN IDENTITY. `owner_of[id]` authorises changes to a policy; it is not
// the merchant. A caller asking "is this operator allowed to act for this merchant" gets an answer;
// a caller trying to derive the merchant FROM the operator is doing something this repository's
// merchant-id module refuses outright.

import {
  bytesFromHex, readAddress, readBool, readBytes32, readUint, selectorOf, wordUint,
} from "../../tools/unica-sign/abi.mjs";
import {toHex} from "../../web/ensv2/keccak.mjs";

/// Derived from their signatures. Two hand-typed selectors elsewhere in this repository were both
/// wrong, and a wrong selector fails as an empty return rather than as an error.
export const POLICY_SELECTOR = {
  policy: selectorOf("policy(uint256)"),
  ownerOf: selectorOf("owner_of(uint256)"),
  platform: selectorOf("platform()"),
  split: selectorOf("split(uint256,uint256)"),
};

/// The policy schema this reader understands. Bumping it is a breaking change for every caller.
export const SUPPORTED_POLICY_VERSION = 1;
export const BPS = 10000n;
export const MAX_HOLD = 4;

export const POLICY_STATUS = {
  READ: "READ",
  READ_FAILED: "READ_FAILED",
  MALFORMED_RETURN: "MALFORMED_RETURN",
  NOT_REGISTERED: "NOT_REGISTERED",
  INACTIVE: "INACTIVE",
  SHARES_DO_NOT_SUM: "SHARES_DO_NOT_SUM",
  TOO_MANY_HOLDS: "TOO_MANY_HOLDS",
  BANK_WITHOUT_PAYOUT_REF: "BANK_WITHOUT_PAYOUT_REF",
  UNSUPPORTED_VERSION: "UNSUPPORTED_VERSION",
  OPERATOR_NOT_AUTHORISED: "OPERATOR_NOT_AUTHORISED",
  NO_OPERATOR: "NO_OPERATOR",
};

const ZERO = "0x0000000000000000000000000000000000000000";
const refuse = (status, detail) => ({ok: false, status, detail: detail ?? null, policy: undefined});

/// `policy(uint256)` returns one dynamic tuple, so the return is an offset to it:
///     head:   0x20
///     tuple:  bank_bps | offset(holds) | payout_ref | active
///     holds:  length | (address, uint256) x length
/// Decoded by hand rather than with a library, for the same reason everything else in this
/// repository is: a second implementation that shares its decoder cannot disagree with the first.
export function decodePolicyReturn(hex) {
  const data = bytesFromHex(hex);
  if (data.length === 0) throw new Error("empty return: the call reached no code");
  if (data.length < 0x20 * 5) throw new Error(`return is ${data.length} bytes, too short for a policy`);

  const outer = Number(readUint(data, 0));
  if (outer !== 0x20) throw new Error(`unexpected head offset ${outer}`);
  const t = outer;

  const bankBps = readUint(data, t);
  const holdsAt = t + Number(readUint(data, t + 0x20));
  const payoutRef = readBytes32(data, t + 0x40);
  const active = readBool(data, t + 0x60);

  if (holdsAt + 0x20 > data.length) throw new Error("the holds offset runs past the end");
  const n = Number(readUint(data, holdsAt));
  if (n > MAX_HOLD) throw new Error(`${n} hold legs, more than the contract's maximum of ${MAX_HOLD}`);
  if (holdsAt + 0x20 + n * 0x40 > data.length) throw new Error("the holds array runs past the end");

  const holds = [];
  for (let i = 0; i < n; i++) {
    const at = holdsAt + 0x20 + i * 0x40;
    holds.push({token: readAddress(data, at), shareBps: readUint(data, at + 0x20)});
  }
  return {bankBps, holds, payoutRef, active};
}

/// Read and validate one merchant's policy.
///
/// @param call injected `(to, data) -> hex`. It MUST throw on transport failure rather than
///        returning empty, because those two outcomes mean different things and only one of them
///        is "this merchant has no policy".
export async function readPolicy(merchantId, {registry, call, operator, policyVersion} = {}) {
  if (policyVersion !== undefined && Number(policyVersion) !== SUPPORTED_POLICY_VERSION) {
    return refuse(POLICY_STATUS.UNSUPPORTED_VERSION, `this reader understands version ${SUPPORTED_POLICY_VERSION}`);
  }

  let raw;
  try {
    raw = await call(registry, POLICY_SELECTOR.policy + toHex(wordUint(merchantId)).slice(2));
  } catch (e) {
    // NOT an empty policy. A transport failure that became a default would let an outage decide
    // where a merchant's money goes.
    return refuse(POLICY_STATUS.READ_FAILED, e?.message ?? String(e));
  }

  let decoded;
  try {
    decoded = decodePolicyReturn(raw);
  } catch (e) {
    return refuse(POLICY_STATUS.MALFORMED_RETURN, e.message);
  }

  // The contract reverts on an unregistered merchant, so an all-zero decode means the registry
  // answered with something that is not a policy. Refused by name rather than treated as empty.
  if (!decoded.active) {
    const empty = decoded.bankBps === 0n && decoded.holds.length === 0;
    return refuse(empty ? POLICY_STATUS.NOT_REGISTERED : POLICY_STATUS.INACTIVE);
  }

  const total = decoded.bankBps + decoded.holds.reduce((a, h) => a + h.shareBps, 0n);
  if (total !== BPS) return refuse(POLICY_STATUS.SHARES_DO_NOT_SUM, `${total} basis points`);
  if (decoded.holds.length > MAX_HOLD) return refuse(POLICY_STATUS.TOO_MANY_HOLDS);
  if (decoded.bankBps > 0n && /^0x0+$/.test(decoded.payoutRef)) {
    return refuse(POLICY_STATUS.BANK_WITHOUT_PAYOUT_REF);
  }

  let authorisedOperator = null;
  if (operator !== undefined) {
    let ownerRaw;
    try {
      ownerRaw = await call(registry, POLICY_SELECTOR.ownerOf + toHex(wordUint(merchantId)).slice(2));
    } catch (e) {
      return refuse(POLICY_STATUS.READ_FAILED, e?.message ?? String(e));
    }
    let owner;
    try {
      owner = readAddress(bytesFromHex(ownerRaw), 0);
    } catch (e) {
      return refuse(POLICY_STATUS.MALFORMED_RETURN, e.message);
    }
    if (owner.toLowerCase() === ZERO) return refuse(POLICY_STATUS.NO_OPERATOR);
    if (owner.toLowerCase() !== String(operator).toLowerCase()) {
      return refuse(POLICY_STATUS.OPERATOR_NOT_AUTHORISED, `registry says ${owner}`);
    }
    authorisedOperator = owner;
  }

  return {
    ok: true,
    status: POLICY_STATUS.READ,
    policy: {
      merchantId: BigInt(merchantId),
      bankBps: decoded.bankBps,
      holds: decoded.holds,
      payoutRef: decoded.payoutRef,
      active: true,
      version: SUPPORTED_POLICY_VERSION,
    },
    authorisedOperator,
  };
}
