// A read-only Arc client, and the divergences encoded as refusals rather than as warnings.
//
// WHAT THIS IS FOR. Everything this module does is a read: chain id, block number, balance, code,
// call, gas price, gas estimate. It is the evidence-gathering half of the treasury flow, and it is
// deliberately incapable of the other half.
//
// WHAT IT DELIBERATELY DOES NOT DO. It cannot sign, cannot send, and cannot broadcast. There is no
// key material anywhere in this file, no `eth_sendRawTransaction`, no `eth_sendTransaction`, and no
// import that could supply one. The method allow-list below is enforced, not documented: a call to
// anything outside it is refused before a request is built. That is what lets a reviewer conclude
// from this file alone that running it cannot move money.
//
// ARC'S DIVERGENCES, AS CODE. Four things about Arc will produce a wrong number or a silent failure
// in code written for Ethereum. Each is handled here as a named, testable refusal or outcome:
//
//   1. The native currency is USDC and is carried at 18 decimals — which says nothing about any
//      ERC-20's decimals(). That separation lives in units.mjs; this file only ever hands raw wei
//      to nativeFromWei and raw return data to decodeDecimalsReturn, so it cannot leak an
//      assumption between them.
//   2. The mempool enforces a 20 Gwei maxFeePerGas floor. Checked as a PRECONDITION, before a
//      transaction is built, because a fee below the floor is not a slow transaction — it is one
//      the mempool never accepts.
//   3. A send to address(0) reverts. Refused here before the preview is built. Observed live:
//      eth_estimateGas to address(0) with value returns "execution reverted: Zero address not
//      allowed", so this is the chain's behaviour and not an inference from documentation.
//   4. A blocklist revert consumes gas WITHOUT producing a receipt. "No receipt" therefore does not
//      mean "not submitted", and conflating the two is how a settlement double-pays. The two are
//      distinct members of SUBMISSION_OUTCOME below and nothing collapses them.
//
// The transport is injected. Tests pass a recorded transport and run offline and deterministically;
// live-check.mjs passes global fetch. There is no default that silently reaches the network, and no
// fallback to a fixture when the network is absent — a run that cannot verify says so and stops.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {utf8} from "../permit2/digest.mjs";
import {
  DECIMALS_SELECTOR, decodeDecimalsReturn, nativeFromWei, normaliseAddress, tokenAmount,
} from "./units.mjs";

/// Arc testnet, chain id 5042002 = 0x4cef52. Confirmed by eth_chainId against the public RPC; the
/// client refuses to act against anything else.
export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_TESTNET_RPC = "https://rpc.testnet.arc.io";

/// The documented mempool floor, in wei of the native currency. Observed eth_gasPrice sits just
/// above it (20.149 Gwei at the last check), which is consistent with a floor of 20.
export const ARC_MIN_MAX_FEE_PER_GAS_WEI = 20_000_000_000n;

/// Arc's system emitter. Zero bytes of code: it emits USDC Transfer logs and is not a contract to
/// call. Named so a caller can recognise it rather than discovering it through an empty return.
export const ARC_SYSTEM_EMITTER = "0xfffffffffffffffffffffffffffffffffffffffe";

/// The address the burn/zero checks are about.
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/// Every read this client is allowed to make. Enforced in `call()`. Nothing that writes to a chain
/// appears here, and adding one would be a visible change to this list.
export const PERMITTED_METHODS = Object.freeze([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getCode",
  "eth_call",
  "eth_gasPrice",
  "eth_estimateGas",
  "eth_getLogs",
  "eth_getTransactionCount",
]);

export const ARC_ERROR = {
  METHOD_NOT_PERMITTED: "METHOD_NOT_PERMITTED",
  WRONG_CHAIN: "WRONG_CHAIN",
  CHAIN_ID_UNREADABLE: "CHAIN_ID_UNREADABLE",
  RPC_ERROR: "RPC_ERROR",
  TRANSPORT_UNAVAILABLE: "TRANSPORT_UNAVAILABLE",
  MALFORMED_RESPONSE: "MALFORMED_RESPONSE",
  ZERO_ADDRESS_REFUSED: "ZERO_ADDRESS_REFUSED",
  MAX_FEE_BELOW_ARC_FLOOR: "MAX_FEE_BELOW_ARC_FLOOR",
  NO_CODE_AT_ADDRESS: "NO_CODE_AT_ADDRESS",
  /// A balance was asked for at one contract using a scale that was read from a different one.
  /// The two numbers would look identical and mean different things, which is the whole subject of
  /// this module — so the pairing is checked at the read, not only at the encode.
  SCALE_READ_FROM_ANOTHER_TOKEN: "SCALE_READ_FROM_ANOTHER_TOKEN",
};

export class ArcError extends Error {
  constructor(code, detail) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = "ArcError";
    this.code = code;
  }
}

const refuse = (code, detail) => {
  throw new ArcError(code, detail);
};

/// How a submission can end on Arc. The two members that matter are the last two: on a chain where
/// a blocklist revert burns gas and yields no receipt, "no receipt" and "never submitted" are
/// different facts with different correct responses, and a client that returns one value for both
/// makes the retry decision unanswerable.
///
/// Nothing in this module produces any of these — it cannot submit. They are the vocabulary the
/// OWNER's submission step reports back in, defined here so the preview and the runbook agree on
/// the words.
export const SUBMISSION_OUTCOME = {
  /// Never left this process. No gas spent, safe to rebuild and retry.
  NOT_SUBMITTED: "NOT_SUBMITTED",
  /// Accepted by the mempool, receipt seen, status 1.
  MINED_SUCCESS: "MINED_SUCCESS",
  /// Accepted, receipt seen, status 0. Gas spent, effect none.
  MINED_REVERTED: "MINED_REVERTED",
  /// Broadcast, and no receipt is obtainable. On Arc a blocklist revert lands here: gas WAS
  /// consumed and the transaction is not repeatable for free. This is NOT a synonym for
  /// NOT_SUBMITTED and must never be retried as though it were.
  BROADCAST_NO_RECEIPT_GAS_CONSUMED: "BROADCAST_NO_RECEIPT_GAS_CONSUMED",
  /// Rejected by the mempool before inclusion — for example a maxFeePerGas under the 20 Gwei
  /// floor. No gas spent.
  REJECTED_BY_MEMPOOL: "REJECTED_BY_MEMPOOL",
};

const HEXQTY = /^0x([0-9a-fA-F]+)$/;

function quantity(value, what) {
  if (typeof value !== "string" || !HEXQTY.test(value)) {
    refuse(ARC_ERROR.MALFORMED_RESPONSE, `${what} is not a 0x quantity: ${String(value)}`);
  }
  return BigInt(value);
}

/// An endpoint rendered safe to print: scheme and host only.
///
/// WHY THIS EXISTS. The endpoint is overridable (live-check.mjs reads ARC_RPC_URL), and the common
/// shape of a private endpoint is a public host with a project id or key in the PATH or QUERY —
/// `https://host/v2/<key>`. Printing the URL verbatim, or embedding it in a TokenScale's `source`
/// string that then travels into a preview artifact, a JSON response and a rendered page, would put
/// that key in front of everyone who sees the output. Only the origin is ever rendered. Userinfo,
/// path, query and fragment are dropped and never reconstructed.
export function publicEndpoint(url) {
  try {
    const u = new URL(String(url));
    return `${u.protocol}//${u.host}`;
  } catch {
    return "(endpoint withheld: not a parseable URL)";
  }
}

/// A read-only JSON-RPC client bound to one URL.
///
/// The request id is a counter seeded by the caller, never a clock and never a random value, so a
/// recorded transcript replays byte-identically. Time and randomness enter as parameters or not at
/// all — this module has neither Date.now nor Math.random in any path.
export class ArcClient {
  #url; #transport; #next;

  /// @param url        the RPC endpoint
  /// @param transport  async ({url, body}) => parsed JSON. Injected; there is no default that
  ///                   reaches the network, so an offline test cannot accidentally become a live one
  ///                   and a live check cannot accidentally fall back to a fixture.
  /// @param firstId    starting JSON-RPC id, so a transcript is reproducible
  constructor({url = ARC_TESTNET_RPC, transport, firstId = 1} = {}) {
    if (typeof transport !== "function") {
      refuse(ARC_ERROR.TRANSPORT_UNAVAILABLE, "ArcClient needs an explicit transport; there is no implicit network default");
    }
    this.#url = url;
    this.#transport = transport;
    this.#next = firstId;
  }

  get url() { return this.#url; }

  async call(method, params = []) {
    if (!PERMITTED_METHODS.includes(method)) {
      refuse(
        ARC_ERROR.METHOD_NOT_PERMITTED,
        `${method} is not a read. This client is read-only by construction: permitted methods are ${PERMITTED_METHODS.join(", ")}`,
      );
    }
    const body = {jsonrpc: "2.0", id: this.#next++, method, params};
    let res;
    try {
      res = await this.#transport({url: this.#url, body});
    } catch (e) {
      refuse(ARC_ERROR.TRANSPORT_UNAVAILABLE, `${method}: ${e.message}`);
    }
    if (res === null || typeof res !== "object") {
      refuse(ARC_ERROR.MALFORMED_RESPONSE, `${method} returned ${String(res)}`);
    }
    if (res.error) {
      const err = new ArcError(ARC_ERROR.RPC_ERROR, `${method}: ${res.error.message ?? JSON.stringify(res.error)}`);
      err.rpcCode = res.error.code;
      err.rpcMessage = res.error.message ?? "";
      throw err;
    }
    if (!("result" in res)) refuse(ARC_ERROR.MALFORMED_RESPONSE, `${method} returned neither result nor error`);
    return res.result;
  }

  // ---- the reads ---------------------------------------------------------------------------

  async chainId() {
    let v;
    try {
      v = await this.call("eth_chainId");
    } catch (e) {
      refuse(ARC_ERROR.CHAIN_ID_UNREADABLE, e.message);
    }
    return Number(quantity(v, "eth_chainId"));
  }

  /// The gate. Every path that could produce an artifact for the owner to sign runs this first.
  ///
  /// It fails CLOSED: an unreadable chain id is a refusal, not a shrug. A treasury tool that
  /// proceeds when it cannot tell which chain it is on is the exact defect this project publishes
  /// advisories about.
  async requireArc() {
    const id = await this.chainId();
    if (id !== ARC_TESTNET_CHAIN_ID) {
      refuse(ARC_ERROR.WRONG_CHAIN, `expected Arc testnet ${ARC_TESTNET_CHAIN_ID}, endpoint reports ${id}`);
    }
    return id;
  }

  async blockNumber() {
    return quantity(await this.call("eth_blockNumber"), "eth_blockNumber");
  }

  /// The NATIVE balance, returned as a NativeAmount and never as a bare integer. The type is the
  /// whole point: it cannot be added to an ERC-20 balance further up.
  async nativeBalance(address, block = "latest") {
    const a = normaliseAddress(address);
    return nativeFromWei(await this.call("eth_getBalance", [a, block]));
  }

  async getCode(address, block = "latest") {
    return this.call("eth_getCode", [normaliseAddress(address), block]);
  }

  async hasCode(address, block = "latest") {
    const code = await this.getCode(address, block);
    return typeof code === "string" && code.length > 2;
  }

  async ethCall(to, data, block = "latest") {
    return this.call("eth_call", [{to: normaliseAddress(to), data}, block]);
  }

  async gasPrice() {
    return quantity(await this.call("eth_gasPrice"), "eth_gasPrice");
  }

  async estimateGas(tx) {
    return quantity(await this.call("eth_estimateGas", [tx]), "eth_estimateGas");
  }

  /// Read one ERC-20's decimals from the contract itself and return a TokenScale carrying the
  /// evidence — the raw word, the address, the block it was read at.
  ///
  /// It checks for code FIRST, so the Arc case gets its own name. An address with no code answers
  /// every eth_call with "0x", and a client that decoded that as zero, or that shrugged and used a
  /// chain-wide default, would produce a scale nobody ever read. Both are refused: NO_CODE_AT_ADDRESS
  /// here, DECIMALS_EMPTY_RETURN in units.mjs if the call somehow returns empty anyway.
  async readTokenScale(token, block = "latest") {
    const address = normaliseAddress(token);
    const code = await this.getCode(address, block);
    if (typeof code !== "string" || code.length <= 2) {
      refuse(
        ARC_ERROR.NO_CODE_AT_ADDRESS,
        `${address} holds zero bytes of code, so it has no decimals() to read. ` +
        "On Arc the system emitter 0xffff…fffe is exactly this: it emits USDC Transfer logs and is " +
        "not a token contract. There is no chain-wide default and this client will not supply one.",
      );
    }
    const at = block === "latest" ? Number(await this.blockNumber()) : block;
    const returned = await this.ethCall(address, DECIMALS_SELECTOR, block);
    return decodeDecimalsReturn(returned, {
      token: address,
      // Origin only — never the full URL, which may carry a key in its path or query.
      source: `eth_call decimals() @ ${publicEndpoint(this.#url)}`,
      blockNumber: at,
    });
  }

  /// An ERC-20 balance, at the scale read from that same contract. The scale is required, so the
  /// only way to get a balance is to have read the decimals first.
  async tokenBalance(token, holder, scale, block = "latest") {
    const address = normaliseAddress(token);
    // The scale must have been read from THIS contract. A scale from another token would label the
    // returned integer with a decimals count nobody read for it — the same 10^12 error the module
    // exists to prevent, arriving through the read rather than through the encoder. preview.mjs
    // checks the same pairing before encoding; this is the earlier of the two doors.
    if (!scale || typeof scale !== "object" || scale.token !== address) {
      refuse(
        ARC_ERROR.SCALE_READ_FROM_ANOTHER_TOKEN,
        `balanceOf targets ${address} but the scale was read from ${scale?.token ?? String(scale)}`,
      );
    }
    const data = BALANCE_OF_SELECTOR + normaliseAddress(holder).slice(2).padStart(64, "0");
    const returned = await this.ethCall(address, data, block);
    if (typeof returned !== "string" || returned.length !== 66) {
      refuse(ARC_ERROR.MALFORMED_RESPONSE, `balanceOf returned ${String(returned)}`);
    }
    return tokenAmount(BigInt(returned), scale);
  }
}

/// `balanceOf(address)`, derived rather than pasted for the same reason as the decimals selector.
export const BALANCE_OF_SELECTOR = toHex(keccak256(utf8("balanceOf(address)"))).slice(0, 10);

// ---- the preconditions, checked before anything is built ------------------------------------

/// Arc reverts a send to address(0). Refused here, at build time, rather than discovered at
/// broadcast time — because on Arc discovering it at broadcast time can cost gas and yield no
/// receipt, which is the worst of both.
export function requireNonZeroRecipient(to) {
  const a = normaliseAddress(to);
  if (a === ZERO_ADDRESS) {
    refuse(
      ARC_ERROR.ZERO_ADDRESS_REFUSED,
      "Arc reverts transfers to address(0) — observed: eth_estimateGas returns " +
      '"execution reverted: Zero address not allowed". Refused before the transaction is built.',
    );
  }
  return a;
}

/// The 20 Gwei floor, as a precondition on a fee the owner would sign.
///
/// A fee below the floor is not a slow transaction; the mempool declines it. Stating it here means
/// the failure is a refusal with a number in it, not a transaction that appears to vanish.
export function requireArcFeeFloor(maxFeePerGasWei) {
  const v = BigInt(maxFeePerGasWei);
  if (v < ARC_MIN_MAX_FEE_PER_GAS_WEI) {
    refuse(
      ARC_ERROR.MAX_FEE_BELOW_ARC_FLOOR,
      `maxFeePerGas ${v} wei is below Arc's mempool floor of ${ARC_MIN_MAX_FEE_PER_GAS_WEI} wei (20 Gwei). ` +
      `The mempool would decline it: that is ${SUBMISSION_OUTCOME.REJECTED_BY_MEMPOOL}, not a slow send.`,
    );
  }
  return v;
}

/// The transport used by live-check.mjs. Kept out of ArcClient's default so that constructing a
/// client can never, by omission, reach the network.
export function fetchTransport(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    refuse(ARC_ERROR.TRANSPORT_UNAVAILABLE, "no fetch available in this runtime");
  }
  return async ({url, body}) => {
    const r = await fetchImpl(url, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(body),
    });
    if (!r.ok) refuse(ARC_ERROR.RPC_ERROR, `HTTP ${r.status}`);
    return r.json();
  };
}

/// A transport that replays a recorded transcript, keyed by method and params. Used by the offline
/// suite. It THROWS on a request it has no recording for rather than inventing an answer — an
/// offline run must be unable to impersonate a live one, which is the whole reason the transport is
/// injected in the first place.
export function recordedTransport(recordings) {
  const key = (body) => `${body.method}(${JSON.stringify(body.params)})`;
  return async ({body}) => {
    const k = key(body);
    if (!(k in recordings)) {
      refuse(ARC_ERROR.TRANSPORT_UNAVAILABLE, `no recording for ${k} — this transport refuses to invent one`);
    }
    const rec = recordings[k];
    return rec && typeof rec === "object" && ("result" in rec || "error" in rec)
      ? {jsonrpc: "2.0", id: body.id, ...rec}
      : {jsonrpc: "2.0", id: body.id, result: rec};
  };
}
