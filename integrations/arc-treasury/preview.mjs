// A transaction the owner may sign, rendered in full, and then nothing.
//
// WHAT THIS IS FOR. A decision from treasury.mjs is an opinion. This turns one into the exact bytes
// a wallet would be asked to sign, decodes every field back out so a human can check the encoder
// against the intent, and stops. The last field in the artifact is REQUIRES_OWNER_SIGNATURE, and it
// is the end of this program's authority.
//
// WHAT IT DELIBERATELY DOES NOT DO — and this is a property of the file, not a promise about it:
//
//   * It never signs. There is no private key, no mnemonic, no secp256k1, no `signTransaction`, and
//     no import that could supply one. The only imports are this repository's keccak, its ABI word
//     encoders, and the two local modules.
//   * It never broadcasts. It performs no network I/O at all: no fetch, no http, no socket. The
//     ArcClient it may be handed for a gas estimate is read-only by its own method allow-list.
//   * It cannot be made to do either by passing a flag. There is no flag.
//
// A reviewer should be able to conclude from this file alone that running it cannot move money, and
// the way to keep that true is to keep the import list at the top exactly as short as it is.
//
// THE VALUE FIELD IS LABELLED. `value` on an EVM transaction is the NATIVE currency, at 18 decimals.
// On Arc that currency is USDC, and the thing being transferred is a *different* USDC — the ERC-20,
// at the decimals its own contract reports. An ERC-20 transfer therefore carries value 0 and moves
// its amount inside `data`. Printing both as "USDC" without saying which is the confusion this
// integration exists to remove, so every rendered amount here names its representation.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {concat, utf8, wordAddress, wordUint} from "../permit2/digest.mjs";
import {
  ARC_TESTNET_CHAIN_ID, ARC_MIN_MAX_FEE_PER_GAS_WEI, requireArcFeeFloor, requireNonZeroRecipient,
} from "./arc.mjs";
import {ACTION, REASON} from "./treasury.mjs";
import {NATIVE_DECIMALS, formatFixed, isNative, isToken, label, nativeFromWei, normaliseAddress} from "./units.mjs";

/// `transfer(address,uint256)` — derived from the signature with this repository's own keccak, not
/// pasted. The whole artifact is only as trustworthy as its selector.
export const TRANSFER_SELECTOR = toHex(keccak256(utf8("transfer(address,uint256)"))).slice(0, 10);
export const TRANSFER_SIGNATURE = "transfer(address,uint256)";

/// The marker that ends this program's authority. Present on every artifact, always true; there is
/// no code path that produces an artifact without it.
export const REQUIRES_OWNER_SIGNATURE = "REQUIRES_OWNER_SIGNATURE";

export const PREVIEW_ERROR = {
  NOT_ACTIONABLE: "NOT_ACTIONABLE",
  MALFORMED_DECISION: "MALFORMED_DECISION",
};

export class PreviewError extends Error {
  constructor(code, detail) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = "PreviewError";
    this.code = code;
  }
}

/// The two decisions that correspond to a transaction. NO_ACTION, HOLD_BELOW_RESERVE and REFUSED do
/// not, and asking for a preview of one is an error rather than an empty artifact — a caller that
/// renders "nothing to sign" and a caller that renders a transaction must take different branches.
const ACTIONABLE = Object.freeze([ACTION.RESTORE_MINIMUM_RESERVE, ACTION.RELEASE_APPROVED_PAYMENT]);

export const isActionable = (decision) => ACTIONABLE.includes(decision?.action);

/// ABI-encode `transfer(to, units)`.
///
/// `units` is taken from the TokenAmount and is already in the token's own smallest unit at the
/// scale READ from its decimals(). No rescaling happens here and none may: an encoder that adjusted
/// decimals would be the single most dangerous line in this integration.
export function encodeTransfer(to, units) {
  const recipient = requireNonZeroRecipient(to);
  const body = concat(wordAddress(recipient), wordUint(units));
  return TRANSFER_SELECTOR + toHex(body).slice(2);
}

/// Decode calldata this module produced, from the bytes, so the artifact's "decoded" section is a
/// genuine round-trip rather than a copy of the inputs.
///
/// This is the part that would catch an encoder bug. Rendering the intent back to the operator
/// would agree with itself no matter what the encoder did; decoding the actual bytes does not.
export function decodeTransfer(data) {
  if (typeof data !== "string" || !data.startsWith(TRANSFER_SELECTOR)) {
    throw new PreviewError(PREVIEW_ERROR.MALFORMED_DECISION, `not a ${TRANSFER_SIGNATURE} call: ${String(data).slice(0, 12)}…`);
  }
  const body = data.slice(TRANSFER_SELECTOR.length);
  if (body.length !== 128) {
    throw new PreviewError(PREVIEW_ERROR.MALFORMED_DECISION, `expected two words, got ${body.length / 2} bytes`);
  }
  const toWord = body.slice(0, 64);
  if (!/^0{24}/.test(toWord)) {
    throw new PreviewError(PREVIEW_ERROR.MALFORMED_DECISION, "address word has dirty upper bytes");
  }
  return {
    selector: TRANSFER_SELECTOR,
    signature: TRANSFER_SIGNATURE,
    to: "0x" + toWord.slice(24),
    units: BigInt("0x" + body.slice(64)),
  };
}

/// Build the artifact.
///
/// Every input is explicit, including the nonce and the fee — this module never asks a chain what
/// the nonce should be, because a preview built from a nonce nobody stated is a preview whose
/// meaning changes between being written and being signed.
///
/// @param decision   from treasury.mjs
/// @param context {
///   token          : the ERC-20 being moved (its address; the scale rides on the amount)
///   from           : the account that would sign
///   chainId        : asserted against Arc's, so a preview cannot be built for the wrong chain
///   nonce          : stated by the caller
///   maxFeePerGas   : wei; checked against Arc's 20 Gwei mempool floor
///   maxPriorityFeePerGas : wei
///   gasLimit       : units of gas, stated or estimated by the caller
///   gasEstimate    : optional {units, source} — where the gas number came from, recorded so an
///                    operator can tell an estimate from a guess
/// }
export function buildPreview(decision, context = {}) {
  if (decision === null || typeof decision !== "object" || !decision.action) {
    throw new PreviewError(PREVIEW_ERROR.MALFORMED_DECISION, "not a decision");
  }
  if (!isActionable(decision)) {
    throw new PreviewError(
      PREVIEW_ERROR.NOT_ACTIONABLE,
      `${decision.action} (${decision.reason}) corresponds to no transaction. ` +
      "Render the decision and its reason instead; there is nothing here for a wallet to sign.",
    );
  }
  const {
    token, from, chainId = ARC_TESTNET_CHAIN_ID, nonce, maxFeePerGas, maxPriorityFeePerGas = 0n,
    gasLimit, gasEstimate = null,
  } = context;

  if (chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new PreviewError(PREVIEW_ERROR.MALFORMED_DECISION, `this module builds Arc testnet (${ARC_TESTNET_CHAIN_ID}) transactions only, not ${chainId}`);
  }
  const amount = decision.amount;
  if (!isToken(amount)) {
    throw new PreviewError(PREVIEW_ERROR.MALFORMED_DECISION, "the decision carries no TokenAmount to move");
  }
  const tokenAddress = normaliseAddress(token ?? amount.token);
  if (tokenAddress !== amount.token) {
    throw new PreviewError(
      PREVIEW_ERROR.MALFORMED_DECISION,
      `the amount's scale was read from ${amount.token} but the transaction targets ${tokenAddress}` +
      " — a scale read from one contract must never be used to encode a call to another",
    );
  }
  const recipient = requireNonZeroRecipient(decision.recipient);
  const fee = requireArcFeeFloor(maxFeePerGas);
  const data = encodeTransfer(recipient, amount.units);
  const decoded = decodeTransfer(data);

  // The fee cap, expressed as native currency, so the operator sees what the ceiling actually costs
  // in the 18-decimal representation rather than in gwei arithmetic they have to do themselves.
  const gas = BigInt(gasLimit);
  const maxFeeNative = nativeFromWei(gas * fee);

  return Object.freeze({
    kind: "ARC_TREASURY_TRANSACTION_PREVIEW",
    /// What this preview came from, so it can be re-derived.
    decision: {action: decision.action, reason: decision.reason, explanation: decision.explanation},

    /// The transaction, exactly as it would be signed.
    transaction: Object.freeze({
      chainId,
      type: 2,
      from: from === undefined ? null : normaliseAddress(from),
      /// An ERC-20 transfer is a call to the TOKEN, not to the recipient. The recipient lives in
      /// the calldata, which is why the decoded section below matters.
      to: tokenAddress,
      /// NATIVE currency moved by this transaction. Zero: an ERC-20 transfer moves nothing native.
      /// It is labelled rather than printed bare, because on Arc the native currency is also called
      /// USDC and an unlabelled 0 next to an amount of 100 invites exactly the wrong reading.
      value: "0x0",
      valueRepresentation: `native, ${NATIVE_DECIMALS}dp (Arc's gas currency; NOT the ERC-20 being transferred)`,
      data,
      /// `== null` on purpose: it catches undefined AND null. `Number(null)` is 0, so testing only
      /// for undefined turned "the caller did not state a nonce" into "the nonce is 0" — a stated
      /// value standing in for one nobody supplied, which is the defect this file's header forbids.
      nonce: nonce == null ? null : Number(nonce),
      gas: gas.toString(),
      maxFeePerGas: fee.toString(),
      maxPriorityFeePerGas: BigInt(maxPriorityFeePerGas).toString(),
    }),

    /// The same transaction read back out of its own bytes.
    decoded: Object.freeze({
      signature: decoded.signature,
      selector: decoded.selector,
      recipient: decoded.to,
      units: decoded.units.toString(),
      /// The scale, and the evidence for it. This is the field that distinguishes this artifact
      /// from one that assumed a number.
      tokenDecimals: amount.decimals,
      tokenDecimalsSource: amount.scale.source,
      tokenDecimalsReadAtBlock: amount.scale.blockNumber,
      tokenDecimalsRawReturn: amount.scale.raw,
      humanAmount: formatFixed(decoded.units, amount.decimals),
      humanLabel: label(amount),
      token: tokenAddress,
    }),

    /// What the send is expected to cost, in the native representation.
    gasEstimate: Object.freeze({
      units: gas.toString(),
      source: gasEstimate?.source ?? "STATED_BY_CALLER",
      maxFeePerGasWei: fee.toString(),
      arcMempoolFloorWei: ARC_MIN_MAX_FEE_PER_GAS_WEI.toString(),
      maxCostNative: maxFeeNative.toJSON(),
      note: "Gas is paid in Arc's NATIVE currency at 18 decimals. It is not payable from the ERC-20 balance above, and this module cannot net one against the other.",
    }),

    /// The end of this program's authority.
    [REQUIRES_OWNER_SIGNATURE]: true,
    ownerAction:
      "This artifact is unsigned and has not been broadcast. Nothing in this repository can sign or " +
      "send it. To execute it the owner must review every decoded field above, then sign and " +
      "broadcast from their own wallet — see integrations/arc-treasury/OWNER-ACTION.md.",
  });
}

/// A plain-text rendering for a terminal or a handoff. Display only; nothing parses this back.
export function renderPreview(preview) {
  const t = preview.transaction, d = preview.decoded, g = preview.gasEstimate;
  return [
    `ARC TREASURY — TRANSACTION PREVIEW (unsigned, not broadcast)`,
    ``,
    `  decision      ${preview.decision.action}  (${preview.decision.reason})`,
    `  ${preview.decision.explanation}`,
    ``,
    `  chainId       ${t.chainId}   (Arc testnet)`,
    `  from          ${t.from ?? "(owner's wallet)"}`,
    `  to            ${t.to}   <- the ERC-20 contract, not the recipient`,
    `  value         ${t.value}   ${t.valueRepresentation}`,
    `  data          ${t.data}`,
    `  nonce         ${t.nonce ?? "(owner to supply)"}`,
    `  gas           ${t.gas}`,
    `  maxFeePerGas  ${t.maxFeePerGas} wei   (Arc floor ${g.arcMempoolFloorWei} wei)`,
    ``,
    `  DECODED FROM THE CALLDATA ABOVE`,
    `    ${d.signature}`,
    `    recipient   ${d.recipient}`,
    `    units       ${d.units}  (raw, in the token's smallest unit)`,
    `    decimals    ${d.tokenDecimals}   read from ${d.token}`,
    `                source: ${d.tokenDecimalsSource}`,
    `                raw return: ${d.tokenDecimalsRawReturn}`,
    `    amount      ${d.humanAmount}  ERC-20 (${d.tokenDecimals}dp as read from the contract)`,
    ``,
    `  MAX GAS COST  ${g.maxCostNative.display} native, 18dp`,
    `                ${g.note}`,
    ``,
    `  ${REQUIRES_OWNER_SIGNATURE}: true`,
    `  ${preview.ownerAction}`,
  ].join("\n");
}
