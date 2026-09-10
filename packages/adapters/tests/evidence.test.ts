import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyConfirmed, fromUntrusted, mayRenderAsSettled, evidenceLabel } from "../src/evidence.js";
import type { ConfirmedProof } from "../src/evidence.js";

const H = "0x" + "ab".repeat(32);
const B = "0x" + "cd".repeat(32);
const EXEC = "0x015692C9E43ca19a2504F79368D1156A56680517";
const HOOK = "0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0";

const full = (): ConfirmedProof => ({
  chainId: 11155111,
  transactionHash: H,
  receiptStatus: 1,
  blockNumber: 11_675_187n,
  blockHash: B,
  expectedContracts: { executor: EXEC, hook: HOOK },
  observedContracts: { executor: EXEC, hook: HOOK },
  merchantDelta: 2_216_294n,
  committedMinimum: 500_000n,
  settlementEventFound: true,
});

test("a complete proof is the only thing that reaches confirmed", () => {
  const r = classifyConfirmed(full());
  assert.equal(r.evidence, "confirmed");
  assert.deepEqual([...r.missing], []);
});

// ── every field is load-bearing: removing any one must drop the class ──────────────────────────
test("control: each missing or wrong field alone prevents confirmed", () => {
  const mutations: Array<[string, Partial<ConfirmedProof>]> = [
    ["chainId", { chainId: 0 }],
    ["transactionHash", { transactionHash: "0xnope" }],
    ["receiptStatus", { receiptStatus: 0 }],
    ["blockNumber", { blockNumber: 0n }],
    ["blockHash", { blockHash: "nope" }],
    ["contract mismatch", { observedContracts: { executor: HOOK, hook: EXEC } }],
    ["delta below minimum", { merchantDelta: 1n }],
    ["settlement event", { settlementEventFound: false }],
  ];
  for (const [label, over] of mutations) {
    const r = classifyConfirmed({ ...full(), ...over });
    assert.equal(r.evidence, "simulated", `${label} still reached confirmed`);
    assert.ok(r.missing.length > 0, `${label} produced no reason`);
  }
});

test("no proof at all is not confirmed, and says why", () => {
  for (const bad of [null, undefined, {}]) {
    const r = classifyConfirmed(bad as never);
    assert.equal(r.evidence, "simulated");
    assert.ok(r.missing.length > 0);
  }
});

// ── promotion from untrusted input is impossible ───────────────────────────────────────────────
test("control: untrusted input can never say confirmed", () => {
  for (const attempt of [
    "confirmed",
    "CONFIRMED",
    " confirmed ",
    true,
    1,
    { evidence: "confirmed" },
    ["confirmed"],
  ]) {
    assert.notEqual(fromUntrusted(attempt), "confirmed", `${JSON.stringify(attempt)} was promoted`);
  }
  // ...and the permitted values still pass, so the guard is not simply refusing everything.
  assert.equal(fromUntrusted("simulated"), "simulated");
  assert.equal(fromUntrusted("mock"), "mock");
  assert.equal(fromUntrusted("nonsense"), "mock");
});

test("only confirmed may be rendered as settled", () => {
  assert.equal(mayRenderAsSettled("confirmed"), true);
  assert.equal(mayRenderAsSettled("simulated"), false);
  assert.equal(mayRenderAsSettled("mock"), false);
});

test("every class has a visible label, so an unlabelled state cannot read as confirmed", () => {
  for (const c of ["mock", "simulated", "confirmed"] as const) {
    assert.ok(evidenceLabel(c).length > 0);
  }
  assert.notEqual(evidenceLabel("simulated"), evidenceLabel("confirmed"));
});

test("no current Robinhood record can satisfy the confirmed requirement", () => {
  // Chain 46630 has no deployed executor or hook, so the expected contracts cannot be named.
  const r = classifyConfirmed({
    chainId: 46630,
    transactionHash: H,
    receiptStatus: 1,
    blockNumber: 1n,
    blockHash: B,
  });
  assert.equal(r.evidence, "simulated");
  assert.ok(r.missing.includes("expectedContracts"));
});
