/// Logs from a public Blockscout explorer, everything else from the node.
///
/// WHY. A free-tier node caps one eth_getLogs at a handful of blocks, and a fast chain adds hundreds
/// of thousands of blocks a day, so a companion that scans by RPC alone can never catch up. The
/// chain's own explorer indexes every log and answers a whole range at once, keylessly. This client
/// takes the log queries to the explorer and leaves block numbers, receipts and calls with the node,
/// so `projectEvidence` keeps its rule that a transaction receipt is fetched independently of the
/// log that claimed it. The explorer is a SOURCE of logs, never a judge: every log it returns still
/// goes through the same codec and the same authentication as a log the node returned.
import {ReadOnlyRpc} from "../unica-verify/rpc.mjs";

const HEX = /^0x[0-9a-fA-F]+$/;

/// A block tag as the explorer wants it: decimal numbers, or the word latest.
export function explorerBlock(tag) {
  if (tag === undefined || tag === null || tag === "latest") return "latest";
  if (typeof tag === "number") return String(tag);
  if (typeof tag === "bigint") return tag.toString();
  if (typeof tag === "string" && HEX.test(tag)) return BigInt(tag).toString();
  if (typeof tag === "string" && /^[0-9]+$/.test(tag)) return tag;
  throw new Error(`not a block tag: ${String(tag)}`);
}

/// The explorer's query for one JSON-RPC style filter: address and up to four topics, each topic
/// position a single value (an array position is the position's first value; the rest are left to
/// the codec, which checks topic0 exactly anyway).
export function explorerQuery(filter = {}) {
  const q = new URLSearchParams({module: "logs", action: "getLogs", fromBlock: explorerBlock(filter.fromBlock ?? 0), toBlock: explorerBlock(filter.toBlock ?? "latest")});
  if (filter.address) q.set("address", String(filter.address));
  const topics = Array.isArray(filter.topics) ? filter.topics : [];
  topics.forEach((t, i) => {
    const value = Array.isArray(t) ? t[0] : t;
    if (value) q.set(`topic${i}`, String(value));
  });
  // Blockscout wants an operator between two given topics; AND is the only meaning a filter has.
  const given = topics.map((t, i) => ((Array.isArray(t) ? t[0] : t) ? i : null)).filter((i) => i !== null);
  for (let a = 0; a < given.length; a += 1) for (let b = a + 1; b < given.length; b += 1) q.set(`topic${given[a]}_${given[b]}_opr`, "and");
  return q;
}

/// An explorer log in the shape a node would have returned it, so nothing downstream knows the
/// difference. Fields the codec reads are topics and data; ordering reads blockNumber and logIndex.
export function explorerLogToRpcLog(entry = {}) {
  const hex = (v) => (typeof v === "string" && HEX.test(v) ? v : typeof v === "string" && /^[0-9]+$/.test(v) ? "0x" + BigInt(v).toString(16) : v);
  return {
    address: entry.address,
    topics: (Array.isArray(entry.topics) ? entry.topics : []).filter((t) => typeof t === "string" && t.length > 0),
    data: entry.data ?? "0x",
    blockNumber: hex(entry.blockNumber),
    logIndex: hex(entry.logIndex ?? "0x0"),
    transactionHash: entry.transactionHash,
    transactionIndex: hex(entry.transactionIndex ?? "0x0"),
    blockHash: entry.blockHash ?? null,
    removed: false,
  };
}

export class ExplorerLogs {
  /// @param api  the explorer's API base, e.g. https://…/api (public, keyless)
  /// @param rpc  the node URL or a ReadOnlyRpc for everything that is not a log query
  constructor({api, rpc, fetchImpl = globalThis.fetch, pageSize = 1000, timeoutMs = 30000} = {}) {
    if (!api) throw new Error("ExplorerLogs needs the explorer API base");
    this.api = String(api).replace(/\/+$/, "");
    this.node = typeof rpc === "string" ? new ReadOnlyRpc(rpc) : rpc;
    this.fetchImpl = fetchImpl;
    this.pageSize = pageSize;
    this.timeoutMs = timeoutMs;
  }

  async logs(filter = {}) {
    const out = [];
    const seen = new Set();
    for (let page = 1; page <= 1000; page += 1) {
      const q = explorerQuery(filter);
      q.set("page", String(page));
      q.set("offset", String(this.pageSize));
      const res = await this.fetchImpl(`${this.api}?${q.toString()}`, {signal: AbortSignal.timeout(this.timeoutMs)});
      if (!res.ok) throw new Error(`explorer answered HTTP ${res.status} for getLogs`);
      const body = await res.json();
      const rows = Array.isArray(body?.result) ? body.result : [];
      if (!Array.isArray(body?.result) && String(body?.status) !== "0") throw new Error(`explorer getLogs: ${String(body?.message ?? body?.result ?? "unreadable answer")}`);
      let fresh = 0;
      for (const row of rows) {
        const log = explorerLogToRpcLog(row);
        const key = `${log.transactionHash}:${log.logIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(log);
        fresh += 1;
      }
      if (rows.length < this.pageSize || fresh === 0) break; // last page, or an explorer that ignores paging
    }
    return out;
  }

  blockNumber() {
    return this.node.blockNumber();
  }

  receipt(hash) {
    return this.node.receipt(hash);
  }

  call(tx, tag) {
    return this.node.call(tx, tag);
  }

  send(method, params = []) {
    return this.node.send(method, params);
  }
}
