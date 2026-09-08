// Reading a V2 settlement out of a transaction receipt, and refusing everything that is not one.
//
// The frozen `QuoteSettled` event has three indexed fields and twelve in the data, so a receipt
// log is 4 topics and 384 bytes exactly. Anything else is not this event, and the decoder says so
// rather than reading whatever happens to be there — a decoder that tolerates a short payload will
// happily report zeros for the fields that were cut off.
//
// NOTHING HERE IS TRUSTED. Decoding produces values; whether those values mean anything is decided
// in `verify.mjs`, against a quote and a signature. That separation is the point: a field decoded
// out of a log is a CLAIM by whoever emitted it, and the emitter is exactly what is in question.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {bytesFromHex, readAddress, readBytes32, readUint} from "../unica-sign/abi.mjs";

/// The frozen receipt, in the order the event declares it. `schemaVersion`, `quoteDigest`,
/// `merchantSigner`, `hook`, `poolId`, `tokenIn`, `actualIn`, `maxIn`, `tokenOut`, `amountOut`,
/// `deliveredOut`, `policyVersion` — twelve words, because every member is fixed width.
export const QUOTE_SETTLED_SIGNATURE =
  "QuoteSettled(bytes32,address,address,uint16,bytes32,address,address,bytes32,address,uint256,uint256,address,uint256,uint256,uint32)";

export const QUOTE_SETTLED_TOPIC = toHex(keccak256(new TextEncoder().encode(QUOTE_SETTLED_SIGNATURE)));

/// Twelve non-indexed members, one word each.
export const QUOTE_SETTLED_DATA_WORDS = 12;

const lower = (s) => (typeof s === "string" ? s.toLowerCase() : s);

/// An indexed address arrives as a full word. Anything in the upper twelve bytes means the topic is
/// not an address at all, and reading the low twenty bytes anyway is how a verifier reports a
/// plausible-looking payer that nobody ever wrote.
function addressFromTopic(topic, what) {
  const bytes = bytesFromHex(topic);
  if (bytes.length !== 32) throw new Error(`${what} is not a 32-byte topic`);
  for (let i = 0; i < 12; i++) {
    if (bytes[i] !== 0) throw new Error(`${what} has dirty upper bits: it is not an address`);
  }
  return toHex(bytes.slice(12));
}

/// @param log one entry of a transaction receipt's `logs` array, in the shape JSON-RPC returns.
export function decodeSettlementLog(log) {
  if (!log || typeof log !== "object") throw new Error("a log entry is required");
  const topics = log.topics;
  if (!Array.isArray(topics)) throw new Error("this log has no topics array");
  if (topics.length !== 4) {
    throw new Error(`a V2 receipt has 4 topics; this log has ${topics.length}`);
  }
  if (lower(topics[0]) !== QUOTE_SETTLED_TOPIC) {
    throw new Error("this log's topic0 is not the QuoteSettled signature");
  }

  const data = bytesFromHex(log.data ?? "0x");
  const expected = QUOTE_SETTLED_DATA_WORDS * 32;
  if (data.length !== expected) {
    throw new Error(`a V2 receipt carries ${expected} bytes of data; this log has ${data.length}`);
  }
  const at = (n) => n * 32;

  // The three unsigned members that are NOT full words in Solidity — uint16 and two uint32 — are
  // still padded to a word in a log. A value with anything above its declared width is a log this
  // event did not produce, and is refused rather than truncated into something believable.
  const narrow = (offset, bits, what) => {
    const value = readUint(data, offset);
    if (value >= 1n << BigInt(bits)) throw new Error(`${what} does not fit in uint${bits}`);
    return Number(value);
  };

  return {
    emitter: lower(log.address),
    quoteId: lower(readBytes32(bytesFromHex(topics[1]), 0)),
    recipient: addressFromTopic(topics[2], "the recipient topic"),
    payer: addressFromTopic(topics[3], "the payer topic"),
    schemaVersion: narrow(at(0), 16, "schemaVersion"),
    quoteDigest: readBytes32(data, at(1)),
    merchantSigner: readAddress(data, at(2)),
    hook: readAddress(data, at(3)),
    poolId: readBytes32(data, at(4)),
    tokenIn: readAddress(data, at(5)),
    actualIn: readUint(data, at(6)),
    maxIn: readUint(data, at(7)),
    tokenOut: readAddress(data, at(8)),
    amountOut: readUint(data, at(9)),
    deliveredOut: readUint(data, at(10)),
    policyVersion: narrow(at(11), 32, "policyVersion"),
    logIndex: log.logIndex ?? null,
    transactionHash: lower(log.transactionHash ?? null),
    blockNumber: log.blockNumber ?? null,
  };
}

/// Every log in the receipt that CLAIMS to be a V2 settlement, whoever emitted it.
///
/// It deliberately does not filter by emitter. Anyone may emit a log with this topic — that is what
/// a topic is — so gathering them all is what lets the verifier refuse a receipt carrying a
/// settlement from somewhere else, or two settlements where one was expected. Filtering here would
/// hide exactly the case worth catching.
export function findSettlementLogs(receipt) {
  if (!receipt || !Array.isArray(receipt.logs)) throw new Error("this receipt has no logs array");
  const found = [];
  for (const log of receipt.logs) {
    const topics = Array.isArray(log?.topics) ? log.topics : [];
    if (topics.length === 0 || lower(topics[0]) !== QUOTE_SETTLED_TOPIC) continue;
    found.push(log);
  }
  return found;
}
