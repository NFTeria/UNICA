import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROUTED_CHAIN_IDS,
  SETTLEMENT_CHAIN_IDS,
  chainMetadata,
  chainMetadataOrNull,
  explorerAddressUrl,
  explorerTransactionUrl,
  hasExplorer,
  isRoutedChainId,
  isSettlementChainId,
  toChainIdHex,
} from "../src/chain.js";

/**
 * These assertions mirror `UnicaDeploymentsV3`. If the contract's table changes, these fail — which
 * is the point: the table is compiled into the creation code of both the hook and the executor, so
 * a change there is a new generation at new addresses, and the interface must not quietly follow.
 */

test("routing resolves five chains, settlement only four", () => {
  assert.deepEqual([...ROUTED_CHAIN_IDS], [46630, 11155111, 1301, 84532, 421614]);
  assert.deepEqual([...SETTLEMENT_CHAIN_IDS], [11155111, 1301, 84532, 421614]);
});

test("chain 46630 routes but cannot settle — two facts, kept apart", () => {
  // UnicaDeploymentsV3.payoutCurrency() reverts PayoutCurrencyNotVerified here, distinctly from
  // UnsupportedChainId. Collapsing the two is how a merchant gets offered a chain that cannot pay.
  assert.equal(isRoutedChainId(46630), true);
  assert.equal(isSettlementChainId(46630), false);
  assert.equal(chainMetadata(46630).canSettle, false);
});

test("every settlement chain is marked as able to settle, and no other is", () => {
  for (const id of ROUTED_CHAIN_IDS) {
    assert.equal(
      chainMetadata(id).canSettle,
      (SETTLEMENT_CHAIN_IDS as readonly number[]).includes(id),
      `canSettle disagrees with SETTLEMENT_CHAIN_IDS for ${id}`,
    );
  }
});

test("every chain is labelled a testnet, because every one of them is", () => {
  for (const id of ROUTED_CHAIN_IDS) assert.equal(chainMetadata(id).isTestnet, true);
});

test("toChainIdHex matches the value the shipped page pins for Sepolia", () => {
  assert.equal(toChainIdHex(11155111), "0xaa36a7");
  assert.equal(toChainIdHex(1301), "0x515");
});

test("an explorer is recorded only where this repository verified one", () => {
  // Two verified, three not. Each verified entry was proved by a control that distinguishes a real
  // record from a fabricated one; the rest stay null rather than being filled in from general
  // knowledge, because a proof link that 404s is worse than an absent one.
  assert.equal(hasExplorer(11155111), true);
  assert.equal(chainMetadata(11155111).explorer, "https://sepolia.etherscan.io");
  assert.equal(hasExplorer(46630), true);
  assert.equal(chainMetadata(46630).explorer, "https://explorer.testnet.chain.robinhood.com");
  for (const id of [1301, 84532, 421614] as const) {
    assert.equal(hasExplorer(id), false, `chain ${id} claims an explorer this repo has not verified`);
  }
});

test("no explorer base URL carries a trailing slash or a path", () => {
  // The builders concatenate `/tx/...` onto these. A trailing slash produces `//tx/`, and a path
  // segment produces a URL that resolves to nothing — both of which render as a working link.
  for (const id of ROUTED_CHAIN_IDS) {
    const base = chainMetadata(id).explorer;
    if (base === null) continue;
    assert.ok(base.startsWith("https://"), `${id}: explorer must be https`);
    assert.ok(!base.endsWith("/"), `${id}: explorer must not end in a slash`);
    assert.equal(new URL(base).pathname, "/", `${id}: explorer must be an origin, not a path`);
  }
});

// ── the Robinhood claims this repository must never make again ────────────────────────────────
// docs/chains/ROBINHOOD.md section 0 records what was read on 2026-09-10. These rows hold the
// code-expressible half of that correction; script/check-robinhood-claims.sh holds the prose half.

test("chain 46630 is not deployable and not settleable, whatever tokens exist on it", () => {
  // Faucet-issued testnet stock-token contracts now exist there. That changed exactly nothing
  // about settlement: `payoutCurrency(46630)` still reverts, both constructors call it, and so
  // V3 cannot be constructed on that chain. Token existence is not a payout path.
  assert.equal(isSettlementChainId(46630), false, "46630 must never be offered as a settlement chain");
  assert.equal(
    chainMetadata(46630).canSettle,
    false,
    "no verified payout token has been established on 46630",
  );
  assert.equal(
    (SETTLEMENT_CHAIN_IDS as readonly number[]).includes(46630),
    false,
    "46630 must not appear in the settlement list",
  );
});

test("Robinhood's mainnet chain id is not a chain UNICA resolves at all", () => {
  // 4663 is where the 194 canonical stock-token deployments live. UNICA is testnet-only and must
  // not acquire a mainnet branch by accident.
  assert.equal(isRoutedChainId(4663), false);
  assert.equal(isSettlementChainId(4663), false);
  assert.equal(chainMetadataOrNull(4663), null);
});

// ── controls ────────────────────────────────────────────────────────────────────────────────

test("control: an unverified explorer yields null, never a broken href", () => {
  // 84532 and 1301 have no verified explorer. 46630 used to be in this row and was moved out when
  // one was verified on 2026-09-10 — this row failing at that moment is the check working.
  assert.equal(explorerTransactionUrl(84532, "0xabc"), null);
  assert.equal(explorerAddressUrl(1301, "0xabc"), null);
  // ...and both verified ones still build, so the guard is not simply refusing everything.
  assert.equal(explorerTransactionUrl(11155111, "0xdead"), "https://sepolia.etherscan.io/tx/0xdead");
  assert.equal(
    explorerTransactionUrl(46630, "0xc1564a9b"),
    "https://explorer.testnet.chain.robinhood.com/tx/0xc1564a9b",
  );
});

test("control: an unknown chain id is refused rather than partially described", () => {
  assert.equal(isRoutedChainId(1), false, "mainnet must not resolve — the contracts cannot deploy there");
  assert.equal(isSettlementChainId(1), false);
  assert.equal(chainMetadataOrNull(1), null);
  assert.equal(chainMetadataOrNull(0), null);
  assert.equal(chainMetadataOrNull(4663), null, "Robinhood's mainnet id is not a chain UNICA resolves");
});
