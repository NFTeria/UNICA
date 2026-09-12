// The UNICA v4 local evidence layer — LAYER 2 of docs/unica-v5/graph/ARCHITECTURE.md: a
// deterministic validator that runs the ten-link receipt-authentication chain
// (docs/unica-v5/graph/SETTLEMENT-SCHEMA.md §5) against a set of already-fetched logs, and never
// reduces its answer to a boolean. UNKNOWN fails closed (ARCHITECTURE.md §4 rule 10): a caller may
// never treat UNKNOWN, or a missing field, as ALLOW.
//
// A CORRECT EVENT SIGNATURE ALONE NEVER CONFERS TRUST. Every check below exists because "anyone can
// deploy the same hook source through their own factory and emit a SettlementReceipt with an
// official marketId" (EVENT-SCHEMA.md §2, quoted SETTLEMENT-SCHEMA.md §5). `identifyLog` in
// `codec.mjs` is deliberately unfiltered by emitter address — this file is what checks the address
// afterwards, which is the only place a look-alike can be caught.
//
// LOCAL EVENT PROJECTION, NOT A GRAPH NODE. `projectEvidence` is a thin `eth_getLogs` /
// `eth_getTransactionReceipt` / `eth_blockNumber` fetcher; `authenticateReceipt` is the pure
// validator and never issues an RPC call itself, so it can be — and is, in test/ — exercised with
// hand-built fixture logs and no network at all. See integrations/graph/unica-v4/README.md for how
// this differs from an actual deployed subgraph.

import {ReadOnlyRpc} from "../unica-verify/rpc.mjs";
import {TOPIC0, decodeLog, identifyLog, recomputeMarketId} from "./codec.mjs";

// ---- small shared helpers -------------------------------------------------------------------------

const lc = (s) => (typeof s === "string" ? s.toLowerCase() : s);
const sameAddr = (a, b) => Boolean(a) && Boolean(b) && lc(a) === lc(b);
const sameHex = (a, b) => Boolean(a) && Boolean(b) && lc(a) === lc(b);

function toBig(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  if (typeof v === "string") return v.startsWith("0x") ? BigInt(v) : BigInt(v);
  throw new Error(`cannot convert ${JSON.stringify(v)} to a block number`);
}

function toBlockTag(v) {
  if (v === undefined || v === null) return "latest";
  if (typeof v === "string" && (v === "latest" || v === "earliest" || v === "pending")) return v;
  return "0x" + toBig(v).toString(16);
}

/// Field name Layer 0 uses for the manifest's per-contract address, tolerant of either
/// `{address: "0x.."}` (the shape given in the deployment manifest) or a bare "0x.." string.
function addressOf(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  if (typeof entry.address === "string") return entry.address;
  return null;
}

// ---- Layer 1a/1b projection: eth_getLogs + eth_getTransactionReceipt + eth_blockNumber ------------

const DEFAULT_LOCAL_RPC = "http://127.0.0.1:8545";

/// Never reaches a non-localhost endpoint unless the caller explicitly hands one in: the CLI's own
/// default is read from `UNICA_LOCAL_RPC`, itself defaulting to localhost (see cli.mjs), so nothing
/// in this module reaches out to a live chain by default.
export function defaultLocalRpcUrl() {
  return process.env.UNICA_LOCAL_RPC || DEFAULT_LOCAL_RPC;
}

function asRpcClient(rpc) {
  if (!rpc) return new ReadOnlyRpc(defaultLocalRpcUrl());
  if (typeof rpc === "string") return new ReadOnlyRpc(rpc);
  if (typeof rpc.logs === "function") return rpc; // already a client (real or a test double)
  throw new Error("rpc must be a URL string, a ReadOnlyRpc, or an object exposing .logs()/.blockNumber()/.receipt()");
}

/// Fetches everything `authenticateReceipt` needs to decide any order in the scanned range:
/// registry, hook, executor, terminal-admission and policy-receiver logs by address, PLUS a second,
/// address-unfiltered scan for the `SettlementReceipt` topic — so a look-alike hook emitting the
/// right shape from the wrong address is fetched too, not filtered out before it can be judged
/// (EVENT-SCHEMA.md §2's "a log that fails is not a UNICA v4 event, whatever its topics say" cuts
/// both ways: it is still fetched, and still checked, rather than never observed).
export async function projectEvidence({rpc, manifest, fromBlock, toBlock} = {}) {
  const client = asRpcClient(rpc);
  const contracts = manifest?.contracts ?? {};
  const namedAddresses = [
    addressOf(contracts.registry),
    addressOf(contracts.hook),
    addressOf(contracts.executor),
    addressOf(contracts.terminalAdmission),
    addressOf(contracts.policyReceiver),
  ].filter(Boolean);

  const from = toBlockTag(fromBlock ?? 0);
  const to = toBlockTag(toBlock ?? "latest");

  const logBatches = await Promise.all([
    ...namedAddresses.map((address) => client.logs({address, fromBlock: from, toBlock: to})),
    // Address-unfiltered: any emitter of the receipt-shaped topic, registered or not.
    client.logs({topics: [TOPIC0.SettlementReceipt], fromBlock: from, toBlock: to}),
  ]);

  const seen = new Set();
  const logs = [];
  for (const batch of logBatches) {
    for (const log of batch ?? []) {
      const key = `${lc(log.transactionHash)}:${log.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      logs.push(log);
    }
  }
  logs.sort((a, b) => {
    const bn = Number(toBig(a.blockNumber) - toBig(b.blockNumber));
    if (bn !== 0) return bn;
    return Number(toBig(a.logIndex) - toBig(b.logIndex));
  });

  // Every transaction that carries a SettlementReceipt-shaped log, from any address — the readback
  // discipline `tools/unica-verify` already uses: an emitted log is a claim, and the transaction
  // receipt is fetched independently rather than trusted from the log alone.
  const settlementTxHashes = [
    ...new Set(logs.filter((l) => identifyLog(l) === "SettlementReceipt").map((l) => lc(l.transactionHash))),
  ];
  const receiptEntries = await Promise.all(
    settlementTxHashes.map(async (txHash) => [txHash, await client.receipt(txHash)]),
  );
  const receipts = Object.fromEntries(receiptEntries);

  const chainHeadRaw = await client.blockNumber();
  const chainHead = Number(toBig(chainHeadRaw));

  return {logs, receipts, chainHead, fromBlock: from, toBlock: to};
}

// ---- Layer 2: the deterministic validator ----------------------------------------------------------

const STATUS = {NONE: 0, PROPOSED: 1, INITIALIZED: 2, SEEDED: 3, ACTIVE: 4, PAUSED: 5, RETIRED: 6};

/// The ten-link chain of docs/unica-v5/graph/SETTLEMENT-SCHEMA.md §5, run against already-decoded
/// evidence. Never issues an RPC call; never reduces its answer to a boolean.
///
/// @param orderId               the order whose settlement is being authenticated
/// @param logs                  raw JSON-RPC logs (any mix of the events in codec.mjs), from any
///                              address — exactly what `projectEvidence` returns as `.logs`, or a
///                              hand-built fixture array in tests
/// @param manifest               the local deployment manifest (`deployments/31337.local.json` shape)
/// @param chainHead              current block number (or undefined -> EVIDENCE_ENDPOINT_UNAVAILABLE)
/// @param requiredConfirmations  blocks of depth required before a otherwise-good receipt is final
/// @param indexHead              the caller's own "as of block" watermark, if it is reading from an
///                               index rather than direct RPC (INDEX_BEHIND_REQUIRED_BLOCK)
/// @param transactionHash        optional: a specific transaction the caller is asking about, e.g.
///                               from a submitted-but-unconfirmed payment; paired with
///                               `transactionReceipts` this is what lets TRANSACTION_REVERTED fire
///                               even though a reverted transaction has no logs of its own to see
/// @param transactionReceipts    optional list of `{transactionHash, status}` the caller already
///                               fetched (mirrors `projectEvidence`'s `.receipts`, keyed by hash)
export function authenticateReceipt({
  orderId,
  logs = [],
  manifest,
  chainHead,
  requiredConfirmations = 0,
  indexHead,
  transactionHash = null,
  transactionReceipts = [],
} = {}) {
  const reasonCodes = [];
  const result = {
    decision: "REFUSED",
    reasonCodes,
    registryAuthenticated: false,
    marketAuthenticated: false,
    hookMatched: false,
    executorMatched: false,
    poolMatched: false,
    receipt: null,
    marketVersion: null,
    marketStatusAtIndex: null,
    finality: null,
  };
  const refuse = (...codes) => {
    reasonCodes.push(...codes);
    result.decision = "REFUSED";
    return result;
  };
  const unknown = (...codes) => {
    reasonCodes.push(...codes);
    result.decision = "UNKNOWN";
    return result;
  };

  if (!orderId) return unknown("EVIDENCE_ENDPOINT_UNAVAILABLE"); // nothing to authenticate at all

  // ---- link 1: the registry must be named, off-chain, exactly once (SETTLEMENT-SCHEMA §5 link 1) --
  const registryAddr = lc(addressOf(manifest?.contracts?.registry));
  if (!registryAddr) return unknown("REGISTRY_NOT_CONFIGURED");
  result.registryAuthenticated = true;

  // ---- the endpoint must actually answer (link 10's precondition) --------------------------------
  if (chainHead === undefined || chainHead === null || Number.isNaN(Number(chainHead))) {
    return unknown("EVIDENCE_ENDPOINT_UNAVAILABLE");
  }
  const head = toBig(chainHead);

  // ---- a caller asking about a specific, already-known-reverted transaction ----------------------
  if (transactionHash) {
    const known = transactionReceipts.find((r) => sameHex(r.transactionHash, transactionHash));
    if (known && toBig(known.status) === 0n) return refuse("TRANSACTION_REVERTED");
  }

  // ---- decode every log this evidence set carries, keeping every candidate --------------------------
  const decoded = [];
  for (const raw of logs) {
    const name = identifyLog(raw);
    if (!name) continue;
    try {
      decoded.push({name, address: lc(raw.address), raw, log: decodeLog(name, raw)});
    } catch {
      // A log whose topic matches but whose shape does not decode is neither this event nor
      // anything this validator can reason about; it is simply not evidence, not an error.
    }
  }
  const byName = (name) => decoded.filter((d) => d.name === name);

  // ---- link 8/9 precondition: find the receipt itself, from ANY address (link 5 checks WHO next) --
  const receiptCandidates = byName("SettlementReceipt").filter((d) => sameHex(d.log.orderId, orderId));
  if (receiptCandidates.length === 0) return refuse("MISSING_HOOK_RECEIPT");

  const earliestCandidateBlock = receiptCandidates.reduce(
    (min, d) => (min === null ? toBig(d.raw.blockNumber) : minBig(min, toBig(d.raw.blockNumber))),
    null,
  );
  if (indexHead !== undefined && indexHead !== null && toBig(indexHead) < earliestCandidateBlock) {
    return unknown("INDEX_BEHIND_REQUIRED_BLOCK");
  }

  if (receiptCandidates.length > 1) {
    // "the mapping must never overwrite the first-seen row" (SETTLEMENT-SCHEMA §7) — keep the
    // first-seen (lowest block, then lowest logIndex) only for reference; the verdict is REFUSED
    // regardless of which candidate is genuine, because a second receipt for one orderId cannot
    // occur on the honest path at all.
    const sorted = [...receiptCandidates].sort(
      (a, b) =>
        Number(toBig(a.raw.blockNumber) - toBig(b.raw.blockNumber)) || Number(toBig(a.raw.logIndex) - toBig(b.raw.logIndex)),
    );
    result.receipt = receiptView(sorted[0]);
    return refuse("DUPLICATE_ORDER_ID");
  }
  const receiptEntry = receiptCandidates[0];
  const marketId = receiptEntry.log.marketId;

  // ---- link 3: registered market — MarketProposed from link 1's own registry, matching marketId --
  const marketProposedForId = byName("MarketProposed").filter((d) => sameHex(d.log.marketId, marketId));
  const genuineMarket = marketProposedForId.find((d) => sameAddr(d.address, registryAddr));
  const lookalikeMarket = marketProposedForId.filter((d) => !sameAddr(d.address, registryAddr));
  if (lookalikeMarket.length > 0) reasonCodes.push("REGISTRY_MISMATCH");
  if (!genuineMarket) return refuse("MARKET_NOT_REGISTERED");
  result.marketAuthenticated = true;
  result.marketVersion = genuineMarket.log.version;

  // ---- link 2: recompute marketId from MarketProposed + OraclePolicySet, compare ------------------
  const policyForId = byName("OraclePolicySet").find(
    (d) => sameAddr(d.address, registryAddr) && sameHex(d.log.marketId, marketId),
  );
  if (policyForId) {
    const recomputed = recomputeMarketId({
      chainId: manifest.chainId,
      registry: registryAddr,
      asset: genuineMarket.log.asset,
      payout: genuineMarket.log.payout,
      version: genuineMarket.log.version,
      adapter: policyForId.log.adapter,
      feedId: policyForId.log.feedId,
    });
    if (!sameHex(recomputed, marketId)) return refuse("MARKET_ID_MISMATCH");
  }

  // ---- link 5: expected hook — SettlementReceipt accepted only from getMarket(marketId).hook -----
  const registeredHook = lc(genuineMarket.log.hook);
  if (!sameAddr(receiptEntry.address, registeredHook)) {
    return refuse("UNREGISTERED_EMITTER", "HOOK_PROVENANCE_MISMATCH");
  }
  result.hookMatched = true;

  // ---- link 6: expected executor — Settled accepted only from getMarket(marketId).executor -------
  const registeredExecutor = lc(genuineMarket.log.executor);
  const settledForOrder = byName("Settled").filter((d) => sameHex(d.log.orderId, orderId));
  const genuineSettled = settledForOrder.find((d) => sameAddr(d.address, registeredExecutor));
  const wrongExecutorSettled = settledForOrder.filter((d) => !sameAddr(d.address, registeredExecutor));
  if (!genuineSettled) {
    const codes = wrongExecutorSettled.length > 0 ? ["EXECUTOR_MISMATCH", "MISSING_EXECUTOR_SETTLED"] : ["MISSING_EXECUTOR_SETTLED"];
    return refuse(...codes);
  }
  result.executorMatched = true;

  // ---- link 8: matching hook/executor events, same transaction, same order, equal amountIn -------
  if (!sameHex(receiptEntry.raw.transactionHash, genuineSettled.raw.transactionHash)) {
    return refuse("TRANSACTION_MISMATCH");
  }
  if (!sameHex(receiptEntry.log.orderId, genuineSettled.log.orderId)) {
    return refuse("ORDER_ID_MISMATCH");
  }
  if (toBig(genuineSettled.log.amountIn) !== toBig(receiptEntry.log.amountIn)) {
    return refuse("AMOUNT_MISMATCH");
  }
  if (toBig(genuineSettled.log.amountDelivered) !== toBig(receiptEntry.log.amountOut)) {
    return refuse("AMOUNT_MISMATCH");
  }

  // ---- link 7: expected PoolManager and pool key ---------------------------------------------------
  const expectedPoolId = lc(genuineMarket.log.poolId);
  const sameTxSwap = byName("Swap").find((d) => sameHex(d.raw.transactionHash, receiptEntry.raw.transactionHash));
  if (sameTxSwap && !sameHex(sameTxSwap.log.id, expectedPoolId)) {
    return refuse("POOL_MISMATCH");
  }
  if (
    !sameAddr(receiptEntry.log.currencyIn, genuineMarket.log.asset) ||
    !sameAddr(receiptEntry.log.currencyOut, genuineMarket.log.payout)
  ) {
    return refuse("POOL_MISMATCH");
  }
  result.poolMatched = true;

  // ---- context labels: last-indexed market status, pause/retirement, historical version ----------
  const statusChanges = byName("MarketStatusChanged")
    .filter((d) => sameAddr(d.address, registryAddr) && sameHex(d.log.marketId, marketId))
    .sort((a, b) => Number(toBig(a.raw.blockNumber) - toBig(b.raw.blockNumber)));
  const lastStatus = statusChanges.length > 0 ? statusChanges[statusChanges.length - 1] : null;
  result.marketStatusAtIndex = lastStatus ? lastStatus.log.to : STATUS.PROPOSED;

  const receiptBlock = toBig(receiptEntry.raw.blockNumber);
  if (result.marketStatusAtIndex === STATUS.RETIRED) {
    const retirement = statusChanges.find((d) => d.log.to === STATUS.RETIRED);
    const retiredAtBlock = retirement ? toBig(retirement.raw.blockNumber) : null;
    if (retiredAtBlock !== null && receiptBlock >= retiredAtBlock) {
      return refuse("RECEIPT_AFTER_RETIREMENT");
    }
    reasonCodes.push("MARKET_RETIRED_AT_INDEX");
  } else if (result.marketStatusAtIndex === STATUS.PAUSED) {
    reasonCodes.push("MARKET_PAUSED_AT_INDEX");
  }

  const sameParkPair = byName("MarketProposed").filter(
    (d) => sameAddr(d.address, registryAddr) && sameAddr(d.log.asset, genuineMarket.log.asset) && sameAddr(d.log.payout, genuineMarket.log.payout),
  );
  const maxVersion = sameParkPair.reduce((m, d) => (d.log.version > m ? d.log.version : m), genuineMarket.log.version);
  if (maxVersion > genuineMarket.log.version) reasonCodes.push("HISTORICAL_VERSION");

  // ---- link 10: finality — checked last, because everything above it is content, not confirmation --
  const confirmations = Number(head - receiptBlock);
  result.finality = {
    chainHead: Number(head),
    receiptBlockNumber: Number(receiptBlock),
    confirmations,
    requiredConfirmations,
    final: confirmations >= requiredConfirmations,
  };
  result.receipt = receiptView(receiptEntry, genuineSettled);
  if (confirmations < requiredConfirmations) {
    reasonCodes.push("AWAITING_FINALITY");
    result.decision = "UNKNOWN";
    return result;
  }

  result.decision = "VERIFIED";
  return result;
}

function minBig(a, b) {
  return a < b ? a : b;
}

function receiptView(entry, settledEntry) {
  const r = entry.log;
  return {
    orderId: r.orderId,
    marketId: r.marketId,
    recipient: r.recipient,
    payer: r.payer,
    currencyIn: r.currencyIn,
    currencyOut: r.currencyOut,
    amountIn: r.amountIn.toString(),
    amountOut: r.amountOut.toString(),
    amountDelivered: settledEntry ? settledEntry.log.amountDelivered.toString() : null,
    hookFeePips: r.hookFeePips,
    lpFeePips: r.lpFeePips,
    protocolFeePips: r.protocolFeePips,
    swapFeePips: r.swapFeePips,
    referencePrice: r.referencePrice.toString(),
    referenceDecimals: r.referenceDecimals,
    referenceUpdatedAt: r.referenceUpdatedAt.toString(),
    demonstrationOnly: r.demonstrationOnly,
    hook: entry.address,
    executor: settledEntry ? settledEntry.address : null,
    blockNumber: entry.raw.blockNumber,
    transactionHash: entry.raw.transactionHash,
    logIndex: entry.raw.logIndex,
  };
}

// ---- receiptByOrderId: the ReceiptByOrderId shape of docs/unica-v5/graph/QUERIES.graphql ----------

/// Builds the same shape `QUERIES.graphql`'s `ReceiptByOrderId` query returns, from this local
/// projection rather than a deployed subgraph — labelled honestly in every consumer of this module
/// as local evidence, never a Graph Node answer (integrations/graph/unica-v4/README.md).
export function receiptByOrderId({orderId, logs = [], manifest, chainHead, requiredConfirmations = 0, indexHead} = {}) {
  const verdict = authenticateReceipt({orderId, logs, manifest, chainHead, requiredConfirmations, indexHead});

  const decoded = [];
  for (const raw of logs) {
    const name = identifyLog(raw);
    if (!name) continue;
    try {
      decoded.push({name, address: lc(raw.address), raw, log: decodeLog(name, raw)});
    } catch {
      /* not evidence */
    }
  }
  const orderCreated = decoded.find((d) => d.name === "OrderCreated" && sameHex(d.log.orderId, orderId));

  if (verdict.decision === "VERIFIED" || (verdict.receipt && verdict.reasonCodes.some((c) => c === "AWAITING_FINALITY" || c === "MARKET_RETIRED_AT_INDEX" || c === "MARKET_PAUSED_AT_INDEX" || c === "HISTORICAL_VERSION"))) {
    const r = verdict.receipt;
    const settlement = {
      id: orderId,
      market: {
        id: r.marketId,
        status: verdict.marketStatusAtIndex,
        demonstrationOnly: r.demonstrationOnly,
      },
      order: orderCreated
        ? {
            recipient: orderCreated.log.recipient,
            boundPayer: orderCreated.log.boundPayer,
            amountIn: orderCreated.log.amountIn.toString(),
            minOut: orderCreated.log.minOut.toString(),
            deadline: orderCreated.log.deadline.toString(),
          }
        : null,
      merchant: {id: r.recipient},
      payer: {id: r.payer},
      currencyIn: r.currencyIn,
      currencyOut: r.currencyOut,
      amountIn: r.amountIn,
      amountOut: r.amountOut,
      amountDelivered: r.amountDelivered,
      hookFeePips: r.hookFeePips,
      lpFeePips: r.lpFeePips,
      protocolFeePips: r.protocolFeePips,
      swapFeePips: r.swapFeePips,
      referencePrice: r.referencePrice,
      referenceDecimals: r.referenceDecimals,
      referenceUpdatedAt: r.referenceUpdatedAt,
      demonstrationOnly: r.demonstrationOnly,
      hookReceipt: {id: `${r.transactionHash}:${r.logIndex}`, transactionHash: r.transactionHash, logIndex: r.logIndex, blockNumber: r.blockNumber},
      executorReceipt: {id: `${r.transactionHash}:${r.logIndex}`, transactionHash: r.transactionHash, logIndex: r.logIndex},
      blockNumber: r.blockNumber,
      blockTimestamp: null, // not carried by any log this layer decodes; left null rather than guessed
      transactionHash: r.transactionHash,
    };
    return {settlement, order: null, evidence: verdict};
  }

  if (orderCreated) {
    return {
      settlement: null,
      order: {
        recipient: orderCreated.log.recipient,
        boundPayer: orderCreated.log.boundPayer,
        amountIn: orderCreated.log.amountIn.toString(),
        minOut: orderCreated.log.minOut.toString(),
        deadline: orderCreated.log.deadline.toString(),
        settled: verdict.executorMatched,
      },
      evidence: verdict,
    };
  }

  return {settlement: null, order: null, evidence: verdict};
}

export {STATUS};
