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

test("only Sepolia carries a verified explorer, and the rest say so", () => {
  assert.equal(hasExplorer(11155111), true);
  assert.equal(chainMetadata(11155111).explorer, "https://sepolia.etherscan.io");
  for (const id of [46630, 1301, 84532, 421614] as const) {
    assert.equal(hasExplorer(id), false, `chain ${id} claims an explorer this repo has not verified`);
  }
});

// ── controls ────────────────────────────────────────────────────────────────────────────────

test("control: an unverified explorer yields null, never a broken href", () => {
  assert.equal(explorerTransactionUrl(84532, "0xabc"), null);
  assert.equal(explorerAddressUrl(46630, "0xabc"), null);
  // ...and the verified one still builds, so the guard is not refusing everything.
  assert.equal(explorerTransactionUrl(11155111, "0xdead"), "https://sepolia.etherscan.io/tx/0xdead");
});

test("control: an unknown chain id is refused rather than partially described", () => {
  assert.equal(isRoutedChainId(1), false, "mainnet must not resolve — the contracts cannot deploy there");
  assert.equal(isSettlementChainId(1), false);
  assert.equal(chainMetadataOrNull(1), null);
  assert.equal(chainMetadataOrNull(0), null);
  assert.equal(chainMetadataOrNull(4663), null, "Robinhood's mainnet id is not a chain UNICA resolves");
});
