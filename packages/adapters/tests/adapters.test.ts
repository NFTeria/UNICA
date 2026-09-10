import { test } from "node:test";
import assert from "node:assert/strict";
import { AdapterError, isAdapterError, fromProviderCode, ManualClock, gateWallet } from "../src/index.js";
import type { WalletAdapter } from "../src/index.js";
import {
  FIXTURE,
  MockWorld,
  SCENARIOS,
  SCENARIO_NAMES,
  mockAdapters,
  deterministicHash,
} from "../src/mock/index.js";
import { OrderStatus, formatFixed, orderBlocker, quoteIsFresh } from "@unica/protocol";

// ── determinism: the property that makes a mock worth having ──────────────────────────────────

test("every scenario builds identically twice", async () => {
  for (const name of SCENARIO_NAMES) {
    const a = SCENARIOS[name]();
    const b = SCENARIOS[name]();
    assert.equal(a.orderId, b.orderId, `${name}: order id differs between builds`);
    assert.deepEqual(
      a.world.receipts.map((r) => `${r.transactionHash}:${r.amountOut}`),
      b.world.receipts.map((r) => `${r.transactionHash}:${r.amountOut}`),
      `${name}: receipts differ between builds`,
    );
  }
});

test("no ambient time: a scenario's clock moves only when told", () => {
  const { world } = SCENARIOS.success();
  const t0 = world.clock.nowSeconds();
  assert.equal(world.clock.nowSeconds(), t0, "reading the clock must not advance it");
  world.clock.advance(45n);
  assert.equal(world.clock.nowSeconds(), t0 + 45n);
  assert.throws(() => world.clock.advance(-1n), /backwards/);
});

test("hashes are derived from a counter, so they are stable and distinct", () => {
  assert.equal(deterministicHash("order", 1), deterministicHash("order", 1));
  assert.notEqual(deterministicHash("order", 1), deterministicHash("order", 2));
  assert.match(deterministicHash("order", 1), /^0x[0-9a-f]{64}$/);
});

// ── the scenarios each reach the state they claim ─────────────────────────────────────────────

test("success: an open order is payable and the quote clears the floor", async () => {
  const { adapters, orderId, world } = SCENARIOS.success();
  const order = await adapters.blockchain.getOrder(orderId);
  assert.equal(order.status, OrderStatus.Open);
  assert.equal(orderBlocker(order, world.clock.nowSeconds()), null);
  const quote = await adapters.quotes.quote(order);
  assert.ok(quote.amountOut >= order.minOut);
  assert.equal(quoteIsFresh(quote, world.clock.nowSeconds()), true);
  // The fixture is a real settlement, so the formatting path is exercised at a real magnitude.
  assert.equal(formatFixed(quote.amountOut, 6, 6), "1.024770");
});

test("expired: the blocker is expired, and it is reached without any wall-clock elapsing", async () => {
  const { adapters, orderId, world } = SCENARIOS.expired();
  const order = await adapters.blockchain.getOrder(orderId);
  assert.equal(orderBlocker(order, world.clock.nowSeconds()), "expired");
});

test("settled and pending report their own blockers, not a generic failure", async () => {
  for (const [name, expected] of [
    ["settled", "already-settled"],
    ["pending", "already-paying"],
  ] as const) {
    const { adapters, orderId, world } = SCENARIOS[name]();
    const order = await adapters.blockchain.getOrder(orderId);
    assert.equal(orderBlocker(order, world.clock.nowSeconds()), expected, name);
  }
});

test("reverted: waitForReceipt raises a reverted error rather than returning status 0 silently", async () => {
  const { adapters } = SCENARIOS.reverted();
  await adapters.wallet.requestAccounts();
  const hash = await adapters.wallet.sendTransaction({
    to: FIXTURE.executor,
    value: FIXTURE.amountIn,
    data: "0x",
  });
  await assert.rejects(
    () => adapters.wallet.waitForReceipt(hash),
    (e: unknown) => isAdapterError(e) && e.kind === "reverted",
  );
});

test("wrongNetwork: sending is refused with wrong-chain, and switching fixes it", async () => {
  const { adapters } = SCENARIOS.wrongNetwork();
  assert.equal(await adapters.wallet.getChainId(), 1);
  await assert.rejects(
    () => adapters.wallet.sendTransaction({ to: FIXTURE.executor, value: 1n, data: "0x" }),
    (e: unknown) => isAdapterError(e) && e.kind === "wrong-chain",
  );
  await adapters.wallet.switchChain(FIXTURE.chainId);
  assert.equal(await adapters.wallet.getChainId(), FIXTURE.chainId);
});

test("noWallet: absence is its own kind, not a generic failure", async () => {
  const { adapters } = SCENARIOS.noWallet();
  assert.equal(adapters.wallet.isPresent(), false);
  await assert.rejects(
    () => adapters.wallet.requestAccounts(),
    (e: unknown) => isAdapterError(e) && e.kind === "wallet-absent",
  );
});

test("rpcUnavailable: a failed read is never reported as zero", async () => {
  const { adapters } = SCENARIOS.rpcUnavailable();
  for (const call of [
    () => adapters.blockchain.getReceiptCount(),
    () => adapters.blockchain.getOrderCount(),
    () => adapters.blockchain.getBlockNumber(),
    () => adapters.identity.resolve(FIXTURE.merchantName),
  ]) {
    await assert.rejects(call, (e: unknown) => isAdapterError(e) && e.kind === "transport-unavailable");
  }
});

test("indexerDelayed and indexerUnavailable are DIFFERENT answers", async () => {
  const delayed = SCENARIOS.indexerDelayed();
  await assert.rejects(
    () => delayed.adapters.indexer.getLatest(5),
    (e: unknown) => isAdapterError(e) && e.kind === "indexer-behind",
  );
  assert.equal(await delayed.adapters.indexer.getLagBlocks(), 12n);

  const down = SCENARIOS.indexerUnavailable();
  await assert.rejects(
    () => down.adapters.indexer.getLatest(5),
    (e: unknown) => isAdapterError(e) && e.kind === "transport-unavailable",
  );
  assert.equal(
    await down.adapters.indexer.getLagBlocks(),
    null,
    "an unreachable index reports null, not zero lag",
  );
});

test("the chain stays readable when the index does not — the fallback the page already relies on", async () => {
  const { adapters } = SCENARIOS.indexerUnavailable();
  assert.equal(await adapters.blockchain.getReceiptCount(), 5n);
  assert.equal(await adapters.blockchain.getCodeSize(FIXTURE.hook), 10_634);
});

// ── the wallet gate: the -32002 defect, prevented structurally ────────────────────────────────

function countingWallet(): { wallet: WalletAdapter; calls: () => number; release: () => void } {
  let calls = 0;
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const inner: WalletAdapter = {
    isPresent: () => true,
    getAccounts: async () => [],
    getChainId: async () => FIXTURE.chainId,
    requestAccounts: async () => {
      calls++;
      await held;
      return [FIXTURE.payer];
    },
    switchChain: async () => {
      calls++;
      await held;
    },
    sendTransaction: async () => {
      calls++;
      await held;
      return "0x0";
    },
    waitForReceipt: async () => ({ status: 1 as const, blockNumber: 1n, logs: [] }),
  };
  return { wallet: inner, calls: () => calls, release };
}

test("control (sabotage): WITHOUT the gate, a second request reaches the wallet", async () => {
  const { wallet, calls, release } = countingWallet();
  const first = wallet.requestAccounts();
  const second = wallet.requestAccounts();
  release();
  await Promise.all([first, second]);
  assert.equal(calls(), 2, "the ungated control must reproduce the two-prompt precondition");
});

test("with the gate, the second request never reaches the wallet and says what to do", async () => {
  const { wallet, calls, release } = countingWallet();
  const gated = gateWallet(wallet);
  const first = gated.requestAccounts();
  await assert.rejects(
    () => gated.requestAccounts(),
    (e: unknown) => isAdapterError(e) && e.kind === "wallet-busy" && /wallet window/.test(e.display),
  );
  release();
  await first;
  assert.equal(calls(), 1, "exactly one request may reach the wallet");
});

test("the gate reopens after the first request settles, in both directions", async () => {
  const { wallet, release } = countingWallet();
  const gated = gateWallet(wallet);
  const first = gated.requestAccounts();
  release();
  await first;
  await gated.switchChain(FIXTURE.chainId); // would throw wallet-busy if the gate leaked
});

test("the gate spans DIFFERENT prompting methods, which is how the real defect happened", async () => {
  const { wallet, release } = countingWallet();
  const gated = gateWallet(wallet);
  const first = gated.requestAccounts();
  await assert.rejects(
    () => gated.sendTransaction({ to: FIXTURE.executor, value: 1n, data: "0x" }),
    (e: unknown) => isAdapterError(e) && e.kind === "wallet-busy",
  );
  release();
  await first;
});

test("non-prompting reads stay OUTSIDE the gate, so a slow prompt cannot block them", async () => {
  const { wallet, release } = countingWallet();
  const gated = gateWallet(wallet);
  const first = gated.requestAccounts();
  assert.equal(gated.isPresent(), true);
  assert.deepEqual(await gated.getAccounts(), []);
  assert.equal(await gated.getChainId(), FIXTURE.chainId);
  release();
  await first;
});

// ── errors are a closed vocabulary ────────────────────────────────────────────────────────────

test("provider codes map to the sentence each one deserves", () => {
  assert.equal(fromProviderCode(4001).kind, "wallet-dismissed");
  assert.equal(fromProviderCode(4902).kind, "unknown-chain");
  assert.equal(fromProviderCode(-32002).kind, "wallet-busy");
  assert.equal(fromProviderCode(12345).kind, "transport-error");
  for (const code of [4001, 4902, -32002, 12345]) {
    const e = fromProviderCode(code);
    assert.ok(
      e.display.length > 0 && !/-?\d{4,}/.test(e.display),
      "a display string must not leak a raw code",
    );
  }
});

test("an AdapterError always carries something renderable", () => {
  const e = new AdapterError("not-found", "No order with that id exists on this chain.");
  assert.equal(isAdapterError(e), true);
  assert.ok(e.display.length > 0);
});

// ── the isolation this batch promises ─────────────────────────────────────────────────────────

test("a mock world reaches every scenario without a network or a timer", async () => {
  const world = new MockWorld();
  const adapters = mockAdapters(world);
  assert.equal(await adapters.blockchain.getReceiptCount(), 0n);
  world.makeReceipt();
  assert.equal(await adapters.blockchain.getReceiptCount(), 1n);
  assert.equal((await adapters.indexer.getLatest(10)).length, 1);
});
