// Shared fixture builders for tools/unica-evidence/test/*.test.mjs — deterministic placeholder
// addresses/hashes and a minimal `deployments/31337.local.json`-shaped manifest, so every test
// constructs its logs the same way instead of re-deriving one-off constants.
//
// Not itself a test file (no `.test.mjs` suffix), so `node --test` does not try to run it directly.

import {recomputeCatalogId, recomputeMarketId, recomputeSettlementId} from "./codec.mjs";

export const addr = (n) => "0x" + n.toString(16).padStart(40, "0");
export const bytes32 = (n) => "0x" + n.toString(16).padStart(64, "0");

export const REGISTRY = addr(0x1);
export const HOOK = addr(0x2);
export const EXECUTOR = addr(0x3);
export const LOOKALIKE_HOOK = addr(0xbad1);
export const LOOKALIKE_EXECUTOR = addr(0xbad2);
export const ASSET = addr(0x10);
export const PAYOUT = addr(0x11);
export const RECIPIENT = addr(0x20);
export const PAYER = addr(0x21);
export const TERMINAL_ADMISSION = addr(0x30);
export const POLICY_RECEIVER = addr(0x31);
export const POOL_MANAGER = addr(0x40);
export const FACTORY = addr(0x41);
export const DIRECT_SETTLEMENT = addr(0x90);
export const LOOKALIKE_DIRECT_SETTLEMENT = addr(0xbad3);
export const DIRECT_ASSET = addr(0x91);
export const DIRECT_RECIPIENT = addr(0x92);
export const DIRECT_PAYER = addr(0x93);
export const PRODUCT_CATALOG = addr(0xa0);
export const LOOKALIKE_PRODUCT_CATALOG = addr(0xbad4);
export const PRODUCT_ASSET = addr(0xa1);
export const PRODUCT_PAYOUT = addr(0xa2);
export const PRODUCT_SELLER = addr(0xa3);
export const PRODUCT_BUYER = addr(0xa4);
export const SALE_ID = bytes32(0x4000);

export const POOL_ID = bytes32(0x2000);
export const ORDER_ID = bytes32(0x3000);
export const FEED_ID = bytes32(0);
export const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
export const CHAIN_ID = 31337;
export const MARKET_VERSION = 1;

// Recomputed, not chosen — a demonstration market's marketId still commits to (chainId, registry,
// asset, payout, version, adapter, feedId) exactly as EVENT-SCHEMA.md §4.1 field 1 specifies, with
// adapter/feedId zero "for a demonstration market" (S8). Fixtures that need a market-id mismatch
// build their own ad hoc bytes32 instead of this one.
export const MARKET_ID = recomputeMarketId({
  chainId: CHAIN_ID,
  registry: REGISTRY,
  asset: ASSET,
  payout: PAYOUT,
  version: MARKET_VERSION,
  adapter: ZERO_ADDR,
  feedId: FEED_ID,
});

// Recomputed the same way DirectSettlement.sol's own constructor computes it — see the note on
// `MARKET_ID` above: fixtures commit to the real formula, not to a chosen constant, so a codec bug
// in `recomputeSettlementId` would break these fixtures' own construction, not just be missed by it.
export const DIRECT_SETTLEMENT_ID = recomputeSettlementId({
  chainId: CHAIN_ID,
  settler: DIRECT_SETTLEMENT,
  asset: DIRECT_ASSET,
});

// Recomputed the same way ProductCatalog.sol's own constructor computes it, for the same reason
// the two ids above are recomputed rather than chosen.
export const CATALOG_ID = recomputeCatalogId({chainId: CHAIN_ID, catalog: PRODUCT_CATALOG});

export function makeManifest(overrides = {}) {
  const base = {
    environment: "LOCAL_ANVIL_NO_VALUE",
    chainId: CHAIN_ID,
    commit: "0000000000000000000000000000000000000000",
    toolchain: {},
    releaseId: bytes32(1),
    contracts: {
      poolManager: {address: POOL_MANAGER, codeHash: bytes32(0xaa)},
      factory: {address: FACTORY, codeHash: bytes32(0xab)},
      registry: {address: REGISTRY, codeHash: bytes32(0xac)},
      hook: {address: HOOK, codeHash: bytes32(0xad)},
      executor: {address: EXECUTOR, codeHash: bytes32(0xae)},
      oracleAdapter: {address: ZERO_ADDR, codeHash: bytes32(0)},
      fixtureAggregator: {address: ZERO_ADDR, codeHash: bytes32(0)},
      assetToken: {address: ASSET, codeHash: bytes32(0xaf)},
      payoutToken: {address: PAYOUT, codeHash: bytes32(0xb0)},
      identityFixture: {address: ZERO_ADDR, codeHash: bytes32(0)},
      identityToken: {address: ZERO_ADDR, codeHash: bytes32(0)},
      terminalAdmission: {address: TERMINAL_ADMISSION, codeHash: bytes32(0xb1)},
      policyReceiver: {address: POLICY_RECEIVER, codeHash: bytes32(0xb2)},
      forwarderFixture: {address: ZERO_ADDR, codeHash: bytes32(0)},
      lookalikeHook: {address: LOOKALIKE_HOOK, codeHash: bytes32(0xb3)},
      lookalikeExecutor: {address: LOOKALIKE_EXECUTOR, codeHash: bytes32(0xb4)},
      directSettlement: {
        address: DIRECT_SETTLEMENT,
        codeHash: bytes32(0xb5),
        settlementId: DIRECT_SETTLEMENT_ID,
        asset: DIRECT_ASSET,
      },
      lookalikeDirectSettlement: {address: LOOKALIKE_DIRECT_SETTLEMENT, codeHash: bytes32(0xb6)},
      productCatalog: {address: PRODUCT_CATALOG, codeHash: bytes32(0xb7), catalogId: CATALOG_ID},
      lookalikeProductCatalog: {address: LOOKALIKE_PRODUCT_CATALOG, codeHash: bytes32(0xb8)},
    },
    // Symbol/decimals labels for the assets this manifest names, keyed by role — the shape
    // apps/web's own manifest reading expects (role, symbol, decimals, address), trimmed to the one
    // extra asset this fixture set introduces: the direct-settlement asset, which pays and receives
    // the SAME token, unlike a market's asset/payout pair.
    assets: [
      {role: "asset", symbol: "tAST", decimals: 18, address: ASSET},
      {role: "payout", symbol: "uUSD", decimals: 18, address: PAYOUT},
      {role: "direct", symbol: "tAST", decimals: 18, address: DIRECT_ASSET},
    ],
    market: {
      marketId: MARKET_ID,
      version: 1,
      poolKey: {currency0: ASSET, currency1: PAYOUT, fee: 3000, tickSpacing: 60, hooks: HOOK},
      poolId: POOL_ID,
      feedId: FEED_ID,
      adapter: ZERO_ADDR,
    },
    accounts: {
      admin: addr(0x50),
      merchantPayout: RECIPIENT,
      payer: PAYER,
      wrongPayer: addr(0x22),
      terminalChair1: addr(0x60),
      terminalLostTablet: addr(0x61),
    },
    identity: {
      merchantName: "freshcuts.unica.eth",
      merchantNode: bytes32(0x70),
      terminals: [{name: "chair-1", node: bytes32(0x71), status: "ACTIVE"}],
      ensDeploymentId: bytes32(0x72),
      rendererVersion: "unica-identity-svg/1",
      tokenId: "1",
    },
    designation: "TEST_ONLY_NO_VALUE",
  };
  return {...base, ...overrides, contracts: {...base.contracts, ...(overrides.contracts ?? {})}};
}
