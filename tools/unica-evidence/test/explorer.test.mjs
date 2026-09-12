import assert from "node:assert/strict";
import {test} from "node:test";
import {ExplorerLogs, explorerBlock, explorerLogToRpcLog, explorerQuery} from "../explorer.mjs";

test("block tags become the explorer's decimals, and latest stays latest", () => {
  assert.equal(explorerBlock("0x70c3dc2"), "118242754");
  assert.equal(explorerBlock(118242754), "118242754");
  assert.equal(explorerBlock("latest"), "latest");
  assert.equal(explorerBlock(undefined), "latest");
  assert.throws(() => explorerBlock("soon"));
});

test("a JSON-RPC filter becomes the explorer's query: address, topics by position, AND between them", () => {
  const q = explorerQuery({address: "0xabc", topics: ["0x11", null, ["0x33", "0x44"]], fromBlock: "0x10", toBlock: "latest"});
  assert.equal(q.get("module"), "logs");
  assert.equal(q.get("action"), "getLogs");
  assert.equal(q.get("address"), "0xabc");
  assert.equal(q.get("fromBlock"), "16");
  assert.equal(q.get("toBlock"), "latest");
  assert.equal(q.get("topic0"), "0x11");
  assert.equal(q.get("topic1"), null);
  assert.equal(q.get("topic2"), "0x33");
  assert.equal(q.get("topic0_2_opr"), "and");
  assert.equal(explorerQuery({topics: ["0x11"]}).get("address"), null, "a topic-only filter carries no address");
});

test("an explorer log is reshaped so the codec cannot tell it from a node's", () => {
  const log = explorerLogToRpcLog({address: "0xA", topics: ["0x1", "0x2", "", null], data: "0x00", blockNumber: "0x70c3dc2", logIndex: "0x0", transactionHash: "0xT", transactionIndex: "0x1", timeStamp: "0x66"});
  assert.deepEqual(log.topics, ["0x1", "0x2"]);
  assert.equal(log.blockNumber, "0x70c3dc2");
  assert.equal(log.logIndex, "0x0");
  assert.equal(log.removed, false);
  assert.equal(explorerLogToRpcLog({blockNumber: "118242754"}).blockNumber, "0x70c3dc2", "a decimal block number is normalised to hex");
});

test("the client pages until a short page or a repeated page, dedupes, and leaves node reads to the node", async () => {
  const page = (rows) => ({ok: true, json: async () => ({status: rows.length ? "1" : "0", message: rows.length ? "OK" : "No logs found", result: rows})});
  const row = (b, i) => ({address: "0xA", topics: ["0x1"], data: "0x", blockNumber: "0x" + b.toString(16), logIndex: "0x" + i.toString(16), transactionHash: "0xT" + b, transactionIndex: "0x0"});
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const p = Number(new URL(url).searchParams.get("page"));
    if (p === 1) return page([row(1, 0), row(2, 0)]);
    if (p === 2) return page([row(1, 0), row(2, 0)]); // an explorer that ignores paging repeats itself
    return page([]);
  };
  const node = {blockNumber: async () => "0x10", receipt: async (h) => ({transactionHash: h}), call: async () => "0x", send: async () => null};
  const client = new ExplorerLogs({api: "https://explorer.example/api/", rpc: node, fetchImpl, pageSize: 2});
  const logs = await client.logs({address: "0xA", fromBlock: 0, toBlock: "latest"});
  assert.equal(logs.length, 2, "the repeated page adds nothing and stops the walk");
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^https:\/\/explorer\.example\/api\?module=logs/);
  assert.equal(await client.blockNumber(), "0x10");
  assert.deepEqual(await client.receipt("0xT1"), {transactionHash: "0xT1"});
  const short = new ExplorerLogs({api: "https://x/api", rpc: node, fetchImpl: async () => page([row(1, 0)]), pageSize: 2});
  assert.equal((await short.logs({})).length, 1);
  const failing = new ExplorerLogs({api: "https://x/api", rpc: node, fetchImpl: async () => ({ok: false, status: 503})});
  await assert.rejects(() => failing.logs({}), /HTTP 503/);
});
