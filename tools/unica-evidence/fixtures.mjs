// Shared fixture builders for tools/unica-evidence/test/*.test.mjs — deterministic placeholder
// addresses/hashes and a minimal `deployments/31337.local.json`-shaped manifest, so every test
// constructs its logs the same way instead of re-deriving one-off constants.
//
// Not itself a test file (no `.test.mjs` suffix), so `node --test` does not try to run it directly.

import {recomputeMarketId} from "./codec.mjs";

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
    },
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
