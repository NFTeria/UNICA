// Encode/decode the fixed set of event signatures this evidence layer authenticates against, and
// nothing more: the UNICA v4 market events, the two identity/policy events, the shared PoolManager
// `Swap`, and the UNICA v5 same-asset settlement and product-catalogue events.
//
// WHY A GENERIC WORD CODEC. Every field in every event this file knows about is a single 32-byte
// ABI word (address, boolN/uintN/intN, bytes32, or a short fixed bytesN) — none of them carry a
// dynamic `bytes`/`string` member. That means one {encode, decode} pair per Solidity type, driven
// by a declarative event table, covers every signature in the table without hand-writing offsets for
// each one — the same trade `tools/unica-verify/receipt.mjs` made for the single V2 receipt shape,
// generalized here because this layer has sixteen shapes to decode, not one.
//
// REUSED, NOT REIMPLEMENTED. `keccak256`/`toHex` come from `web/ensv2/keccak.mjs`; the word-level
// codecs (`wordAddress`, `wordUint`, `wordInt`, `readAddress`, `readUint`, `readInt`, `readBytes32`,
// `readBool`, `bytesFromHex`, `concat`) come from `tools/unica-sign/abi.mjs`. topic0 is computed the
// same way `tools/unica-sign/abi.mjs#selectorOf` computes a 4-byte selector: keccak256 of the
// canonical signature text, this file only takes the full 32 bytes instead of the first four.
//
// FAILS LOUD ON A LOG THAT ISN'T THE SHAPE IT CLAIMS. `decodeLog` checks topic0, topic count and
// data length before reading a single field — a short or padded log is a different event, or a
// forgery, and is refused rather than zero-filled.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {
  bytesFromHex,
  concat,
  readAddress,
  readBool,
  readBytes32,
  readInt,
  readUint,
  wordAddress,
  wordBool,
  wordBytes32,
  wordInt,
  wordUint,
} from "../unica-sign/abi.mjs";

const ZERO_WORD = new Uint8Array(32);

export function topic0For(signature) {
  return toHex(keccak256(new TextEncoder().encode(signature)));
}

function wordFor(type, value) {
  if (type === "address") return wordAddress(value);
  if (type === "bytes32") return wordBytes32(value);
  if (type === "bool") return wordBool(value);
  const bytesN = /^bytes(\d+)$/.exec(type);
  if (bytesN) {
    const n = Number(bytesN[1]);
    if (n === 32) return wordBytes32(value);
    const b = bytesFromHex(value);
    if (b.length !== n) throw new Error(`not ${n} bytes: ${value}`);
    // Fixed bytesN < 32 is right-padded, whether indexed (a topic) or in the data section —
    // ABI §"Formal Specification": "bytes<M>: enc(X) is the sequence of bytes in X padded with
    // trailing zero-bytes to a length of 32 bytes."
    const out = new Uint8Array(32);
    out.set(b, 0);
    return out;
  }
  if (/^uint\d+$/.test(type)) return wordUint(value);
  if (/^int\d+$/.test(type)) return wordInt(value);
  throw new Error(`codec.mjs does not know the type ${type}`);
}

function readFor(type, data, at) {
  if (type === "address") return readAddress(data, at);
  if (type === "bytes32") return readBytes32(data, at);
  if (type === "bool") return readBool(data, at);
  const bytesN = /^bytes(\d+)$/.exec(type);
  if (bytesN) {
    const n = Number(bytesN[1]);
    if (n === 32) return readBytes32(data, at);
    return toHex(data.slice(at, at + n));
  }
  const uintN = /^uint(\d+)$/.exec(type);
  if (uintN) {
    const bits = Number(uintN[1]);
    const v = readUint(data, at);
    return bits <= 48 ? Number(v) : v; // uint48 tops out at 2^48-1, well inside Number.isSafeInteger
  }
  const intN = /^int(\d+)$/.exec(type);
  if (intN) {
    const bits = Number(intN[1]);
    const v = readInt(data, at); // ABI sign-extends any width to a full 256-bit word, so this is exact
    return bits <= 32 ? Number(v) : v;
  }
  throw new Error(`codec.mjs does not know the type ${type}`);
}

function wordFromHexTopic(hexTopic) {
  const b = bytesFromHex(hexTopic);
  if (b.length !== 32) throw new Error(`a topic must be 32 bytes; got ${b.length}`);
  return b;
}

/// param: {name, type, indexed}
function defineEvent(name, signature, params) {
  return {name, signature, params, topic0: topic0For(signature)};
}

// ---- the fixed catalogue -------------------------------------------------------------------------
// Every signature is copied verbatim from the brief. Field names for the two non-indexed members of
// `OrderAdmitted` and `AdmissionRecorded`, and the one non-indexed member of `ReportProcessed`, are
// not fixed by the brief (only the indexed field names are named there) — this file names them
// plainly and uses those names consistently in its own decoder and its own fixtures; nothing outside
// this evidence layer depends on that choice.
export const EVENT_DEFS = [
  defineEvent(
    "MarketProposed",
    "MarketProposed(bytes32,address,address,uint32,address,address,bytes32,uint24,int24,uint256,uint160,int24,bool)",
    [
      {name: "marketId", type: "bytes32", indexed: true},
      {name: "asset", type: "address", indexed: true},
      {name: "payout", type: "address", indexed: true},
      {name: "version", type: "uint32"},
      {name: "hook", type: "address"},
      {name: "executor", type: "address"},
      {name: "poolId", type: "bytes32"},
      {name: "fee", type: "uint24"},
      {name: "tickSpacing", type: "int24"},
      {name: "rateE18", type: "uint256"},
      {name: "initSqrtPriceX96", type: "uint160"},
      {name: "initTick", type: "int24"},
      {name: "demonstrationOnly", type: "bool"},
    ],
  ),
  defineEvent("MarketStatusChanged", "MarketStatusChanged(bytes32,uint8,uint8)", [
    {name: "marketId", type: "bytes32", indexed: true},
    {name: "from", type: "uint8", indexed: true},
    {name: "to", type: "uint8", indexed: true},
  ]),
  defineEvent("MarketSeeded", "MarketSeeded(bytes32,uint128)", [
    {name: "marketId", type: "bytes32", indexed: true},
    {name: "depthAtOpeningTick", type: "uint128"},
  ]),
  defineEvent("OraclePolicySet", "OraclePolicySet(bytes32,address,bytes32,uint48,uint16,bool)", [
    {name: "marketId", type: "bytes32", indexed: true},
    {name: "adapter", type: "address"},
    {name: "feedId", type: "bytes32"},
    {name: "maxAge", type: "uint48"},
    {name: "maxDeviationBps", type: "uint16"},
    {name: "enabled", type: "bool"},
  ]),
  defineEvent("CapsSet", "CapsSet(bytes32,uint128,uint128,uint128)", [
    {name: "marketId", type: "bytes32", indexed: true},
    {name: "maxPerTx", type: "uint128"},
    {name: "maxPerDay", type: "uint128"},
    {name: "maxSeed", type: "uint128"},
  ]),
  defineEvent("OrderCreatorSet", "OrderCreatorSet(address,bool)", [
    {name: "creator", type: "address", indexed: true},
    {name: "allowed", type: "bool"},
  ]),
  defineEvent(
    "SettlementReceipt",
    "SettlementReceipt(bytes32,address,address,bytes32,address,address,uint128,uint128,uint24,uint24,uint24,uint24,uint256,uint8,uint64,bool)",
    [
      {name: "orderId", type: "bytes32", indexed: true},
      {name: "recipient", type: "address", indexed: true},
      {name: "payer", type: "address", indexed: true},
      {name: "marketId", type: "bytes32"},
      {name: "currencyIn", type: "address"},
      {name: "currencyOut", type: "address"},
      {name: "amountIn", type: "uint128"},
      {name: "amountOut", type: "uint128"},
      {name: "hookFeePips", type: "uint24"},
      {name: "lpFeePips", type: "uint24"},
      {name: "protocolFeePips", type: "uint24"},
      {name: "swapFeePips", type: "uint24"},
      {name: "referencePrice", type: "uint256"},
      {name: "referenceDecimals", type: "uint8"},
      {name: "referenceUpdatedAt", type: "uint64"},
      {name: "demonstrationOnly", type: "bool"},
    ],
  ),
  defineEvent("OrderCreated", "OrderCreated(bytes32,address,address,address,uint128,uint128,uint64)", [
    {name: "orderId", type: "bytes32", indexed: true},
    {name: "recipient", type: "address", indexed: true},
    {name: "creator", type: "address", indexed: true},
    {name: "boundPayer", type: "address"},
    {name: "amountIn", type: "uint128"},
    {name: "minOut", type: "uint128"},
    {name: "deadline", type: "uint64"},
  ]),
  defineEvent("Settled", "Settled(bytes32,address,address,address,address,uint256,uint256)", [
    {name: "orderId", type: "bytes32", indexed: true},
    {name: "payer", type: "address", indexed: true},
    {name: "recipient", type: "address", indexed: true},
    {name: "currencyIn", type: "address"},
    {name: "currencyOut", type: "address"},
    {name: "amountIn", type: "uint256"},
    {name: "amountDelivered", type: "uint256"},
  ]),
  defineEvent(
    "OrderAdmitted",
    "OrderAdmitted(bytes32,bytes32,bytes32,address,address,address,bytes32)",
    [
      {name: "orderId", type: "bytes32", indexed: true},
      {name: "merchantNode", type: "bytes32", indexed: true},
      {name: "terminalNode", type: "bytes32", indexed: true},
      {name: "recipientAtAdmission", type: "address"},
      {name: "terminalAddress", type: "address"},
      {name: "admittedBy", type: "address"},
      {name: "context", type: "bytes32"},
    ],
  ),
  defineEvent("AdmissionRecorded", "AdmissionRecorded(bytes32,bytes32,address,address,bytes32)", [
    {name: "orderNonce", type: "bytes32", indexed: true},
    {name: "marketId", type: "bytes32", indexed: true},
    {name: "payer", type: "address", indexed: true},
    {name: "terminal", type: "address"},
    {name: "reportHash", type: "bytes32"},
  ]),
  defineEvent("ReportProcessed", "ReportProcessed(address,bytes32,bytes2,bool)", [
    {name: "receiver", type: "address", indexed: true},
    {name: "workflowExecutionId", type: "bytes32", indexed: true},
    {name: "reportId", type: "bytes2", indexed: true},
    {name: "success", type: "bool"},
  ]),
  // Uniswap v4 core `PoolManager.Swap`, fixed by the brief to this shape/order.
  defineEvent("Swap", "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)", [
    {name: "id", type: "bytes32", indexed: true},
    {name: "sender", type: "address", indexed: true},
    {name: "amount0", type: "int128"},
    {name: "amount1", type: "int128"},
    {name: "sqrtPriceX96", type: "uint160"},
    {name: "liquidity", type: "uint128"},
    {name: "tick", type: "int24"},
    {name: "fee", type: "uint24"},
  ]),
  // UNICA v5 same-asset settlement (src/unica-v5/IDirectSettlement.sol). No pool, no hook, no
  // executor: the settler that emits this is both, so the ten-link market chain has no analogue
  // for links 3/6/7 here (there is no registry, no separate executor, no pool). What survives is
  // the same shape of question — "did the contract this manifest names actually emit this, for
  // this order, with fields that match its own stored order record" — answered by
  // `authenticateDirectReceipt` in index.mjs instead of `authenticateReceipt`.
  defineEvent(
    "DirectReceipt",
    "DirectReceipt(bytes32,address,address,address,uint256,bytes32,uint64)",
    [
      {name: "orderId", type: "bytes32", indexed: true},
      {name: "recipient", type: "address", indexed: true},
      {name: "payer", type: "address", indexed: true},
      {name: "asset", type: "address"},
      {name: "amount", type: "uint256"},
      {name: "terminalNode", type: "bytes32"},
      {name: "settledAt", type: "uint64"},
    ],
  ),
  // UNICA v5 product catalogue (src/unica-v5/IProductCatalog.sol). A business lists what it sells
  // and a customer pays for it in one transaction; this is the sale. `kind` is a plain `uint8`
  // (0 ONE_OFF, 1 RECURRING, 2 PERMANENT) rather than the Solidity enum, so a reader needs no
  // knowledge of that file to decode it, and `paidThrough` is the date a subscriber's cover now
  // runs to, zero for the two kinds that cover no stretch of time. `ProductListed` is deliberately
  // NOT here: it carries a dynamic `string name`, which this word-level codec does not decode, and
  // nothing in the authentication chain reads it — a sale is authenticated from the sale.
  defineEvent(
    "ProductSold",
    "ProductSold(uint256,address,address,address,address,uint256,uint8,uint64,bytes32)",
    [
      {name: "productId", type: "uint256", indexed: true},
      {name: "buyer", type: "address", indexed: true},
      {name: "seller", type: "address", indexed: true},
      {name: "payout", type: "address"},
      {name: "asset", type: "address"},
      {name: "amount", type: "uint256"},
      {name: "kind", type: "uint8"},
      {name: "paidThrough", type: "uint64"},
      {name: "saleId", type: "bytes32"},
    ],
  ),
  // IDirectSettlement.sol's own `OrderCreated` — a DIFFERENT signature than the market executor's
  // `OrderCreated` above (no separate `creator` topic, no `minOut`: a direct settlement always pays
  // exactly what it asks for). Named `DirectOrderCreated` here only so this file's two `OrderCreated`
  // Solidity events do not collide as JS object keys; `identifyLog` still resolves purely by
  // topic0, so this internal name is never compared against anything on chain.
  defineEvent("DirectOrderCreated", "OrderCreated(bytes32,address,address,uint128,uint64,bytes32)", [
    {name: "orderId", type: "bytes32", indexed: true},
    {name: "recipient", type: "address", indexed: true},
    {name: "payer", type: "address", indexed: true},
    {name: "amount", type: "uint128"},
    {name: "deadline", type: "uint64"},
    {name: "terminalNode", type: "bytes32"},
  ]),
];

const BY_NAME = new Map(EVENT_DEFS.map((d) => [d.name, d]));
const BY_TOPIC0 = new Map(EVENT_DEFS.map((d) => [d.topic0.toLowerCase(), d]));

export const TOPIC0 = Object.fromEntries(EVENT_DEFS.map((d) => [d.name, d.topic0]));

/// Which event, if any, a raw log's topic0 names — independent of `log.address`. Deliberately
/// unfiltered by emitter: that is exactly how a look-alike hook or an attacker factory is later
/// caught in `index.mjs`, rather than never being looked at (EVENT-SCHEMA.md §2).
export function identifyLog(log) {
  const topic0 = log?.topics?.[0];
  if (typeof topic0 !== "string") return null;
  const def = BY_TOPIC0.get(topic0.toLowerCase());
  return def ? def.name : null;
}

/// Decode a raw JSON-RPC log into its named fields. Throws, rather than guesses, when the log does
/// not have the exact topic count or data length the named event requires.
export function decodeLog(name, log) {
  const def = BY_NAME.get(name);
  if (!def) throw new Error(`codec.mjs has no event named ${name}`);
  if (!log || typeof log !== "object") throw new Error("a log object is required");
  const topics = Array.isArray(log.topics) ? log.topics : [];
  if (typeof topics[0] !== "string" || topics[0].toLowerCase() !== def.topic0.toLowerCase()) {
    throw new Error(`this log's topic0 is not ${name}'s signature`);
  }
  const indexedParams = def.params.filter((p) => p.indexed);
  const dataParams = def.params.filter((p) => !p.indexed);
  if (topics.length !== indexedParams.length + 1) {
    throw new Error(`${name} has ${indexedParams.length} indexed field(s); this log has ${topics.length - 1}`);
  }
  const data = bytesFromHex(log.data ?? "0x");
  const expectedLen = dataParams.length * 32;
  if (data.length !== expectedLen) {
    throw new Error(`${name} carries ${expectedLen} byte(s) of data; this log has ${data.length}`);
  }

  const out = {};
  indexedParams.forEach((p, i) => {
    out[p.name] = readFor(p.type, wordFromHexTopic(topics[i + 1]), 0);
  });
  dataParams.forEach((p, i) => {
    out[p.name] = readFor(p.type, data, i * 32);
  });
  out.__event = name;
  out.__address = typeof log.address === "string" ? log.address.toLowerCase() : null;
  out.__transactionHash = typeof log.transactionHash === "string" ? log.transactionHash.toLowerCase() : null;
  out.__blockNumber = log.blockNumber ?? null;
  out.__logIndex = log.logIndex ?? null;
  return out;
}

/// Build a raw JSON-RPC-shaped log from named field values — used only to construct fixtures, so a
/// test exercises the real decoder rather than a hand-typed topics/data array. `meta` carries
/// `{address, transactionHash, blockNumber, blockHash, transactionIndex, logIndex}`, all optional.
export function encodeLog(name, values, meta = {}) {
  const def = BY_NAME.get(name);
  if (!def) throw new Error(`codec.mjs has no event named ${name}`);
  const topics = [def.topic0];
  const dataWords = [];
  for (const p of def.params) {
    const value = values[p.name];
    if (value === undefined) throw new Error(`encodeLog(${name}): missing field "${p.name}"`);
    const word = wordFor(p.type, value);
    if (p.indexed) topics.push(toHex(word));
    else dataWords.push(word);
  }
  return {
    address: meta.address ?? "0x0000000000000000000000000000000000000000",
    topics,
    data: dataWords.length ? toHex(concat(...dataWords)) : "0x",
    blockHash: meta.blockHash ?? "0x" + "11".repeat(32),
    blockNumber: meta.blockNumber ?? "0x1",
    transactionHash: meta.transactionHash ?? "0x" + "22".repeat(32),
    transactionIndex: meta.transactionIndex ?? "0x0",
    logIndex: meta.logIndex ?? "0x0",
    removed: false,
  };
}

/// `SETTLEMENT_ID = keccak256(abi.encode("unica-v5/direct", block.chainid, address(this), asset))`,
/// IDirectSettlement.sol's own doc comment / DirectSettlement.sol's constructor — recomputed, never
/// read off a log or trusted from a manifest field alone, matching `recomputeMarketId`'s rule below.
/// `abi.encode` of a leading `string` is DYNAMIC, unlike every other word this codec handles: the
/// head carries a 32-byte offset word (here always `0x80`, four head words) followed by the three
/// static words, and the tail carries the string's own length word plus its bytes, right-padded to
/// a whole number of words (ABI §"Use of Dynamic Types").
export function recomputeSettlementId({chainId, settler, asset}) {
  const label = new TextEncoder().encode("unica-v5/direct");
  const head = concat(wordUint(0x80), wordUint(chainId), wordAddress(settler), wordAddress(asset));
  const padded = new Uint8Array(Math.ceil(label.length / 32) * 32);
  padded.set(label, 0);
  const tail = concat(wordUint(label.length), padded);
  return toHex(keccak256(concat(head, tail)));
}

/// `CATALOG_ID = keccak256(abi.encode(block.chainid, address(this)))`, ProductCatalog.sol's own
/// constructor — recomputed here, never read off a log or believed from a manifest field alone,
/// the same rule `recomputeMarketId` and `recomputeSettlementId` follow. Both members are static
/// words, so unlike `recomputeSettlementId` there is no dynamic head/tail to lay out.
export function recomputeCatalogId({chainId, catalog}) {
  return toHex(keccak256(concat(wordUint(chainId), wordAddress(catalog))));
}

/// `marketId = keccak256(abi.encode(chainId, registry, asset, payout, version, adapter, feedId))`,
/// EVENT-SCHEMA.md §4.1 field 1 / SETTLEMENT-SCHEMA.md §5 link 2 — recomputed, never read off a log,
/// per this project's "it recomputes; it does not read and agree" rule.
export function recomputeMarketId({chainId, registry, asset, payout, version, adapter, feedId}) {
  return toHex(
    keccak256(
      concat(
        wordUint(chainId),
        wordAddress(registry),
        wordAddress(asset),
        wordAddress(payout),
        wordUint(version),
        wordAddress(adapter ?? "0x0000000000000000000000000000000000000000"),
        wordBytes32(feedId ?? toHex(ZERO_WORD)),
      ),
    ),
  );
}
