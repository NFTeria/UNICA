// apps/web/tests/serve-config.test.mjs: the shape GET /local/config.json answers with, executed
// from the exact function script/anvil/serve.sh runs, without binding a socket or needing a chain.
//
// serve.sh keeps its server in a heredoc, so the function is sliced out between two marker comments
// and evaluated here. If the markers move or the function is renamed, this file fails loudly rather
// than testing a copy that drifted.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { test } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const source = readFileSync(join(ROOT, "script", "anvil", "serve.sh"), "utf8");

const begin = source.indexOf("// @runtimeConfig-begin");
const end = source.indexOf("// @runtimeConfig-end");
assert.ok(begin > 0 && end > begin, "serve.sh carries the @runtimeConfig markers");
const slice = source.slice(begin, end);
const runtimeConfig = new Function(`${slice}\nreturn runtimeConfig;`)();

const fullManifest = JSON.parse(readFileSync(join(ROOT, "deployments", "31337.local.json"), "utf8"));

test("the served config still carries rpc, chainId, manifest and record", () => {
  const c = runtimeConfig({ chainId: 31337, contracts: {}, identity: {} }, { order: { id: "x" } }, "REDACTED");
  assert.equal(c.rpc, "REDACTED");
  assert.equal(c.chainId, 31337);
  assert.deepEqual(c.record, { order: { id: "x" } });
  assert.equal(c.manifest.chainId, 31337);
});
test("a manifest without an onboarding contract exposes null for every join field, never a guess", () => {
  const c = runtimeConfig({ chainId: 31337, contracts: { identityFixture: { address: "0x1" }, identityToken: { address: "0x2" } }, identity: { terminalStatusKey: "com.unica.terminal-status" } }, null, "REDACTED");
  assert.equal(c.merchantOnboarding, null);
  assert.equal(c.parentNode, null);
  assert.equal(c.parentName, null);
  assert.equal(c.identity, "0x1");
  assert.equal(c.identityToken, "0x2");
  assert.equal(c.terminalStatusKey, "com.unica.terminal-status");
});
test("a manifest with an onboarding contract exposes all five join fields", () => {
  const c = runtimeConfig({
    chainId: 31337,
    contracts: { merchantOnboarding: { address: "0xaaa" }, identityFixture: { address: "0xbbb" }, identityToken: { address: "0xccc" } },
    identity: { parentNode: "0x" + "1".repeat(64), parentName: "unica.eth", terminalStatusKey: "com.unica.terminal-status" }, // parentNode bytes32 vector
  }, null, "REDACTED");
  assert.equal(c.merchantOnboarding, "0xaaa");
  assert.equal(c.identity, "0xbbb");
  assert.equal(c.identityToken, "0xccc");
  assert.equal(c.parentNode, "0x" + "1".repeat(64)); // bytes32 vector
  assert.equal(c.parentName, "unica.eth");
});
test("the committed local manifest, as it is today, is served without a crash and says what it lacks", () => {
  const c = runtimeConfig(fullManifest, null, "REDACTED");
  assert.equal(c.chainId, 31337);
  assert.equal(c.identity, fullManifest.contracts.identityFixture.address);
  assert.equal(c.identityToken, fullManifest.contracts.identityToken.address);
  // A stated fact about the tree at the time of writing: the local manifest may or may not carry
  // merchantOnboarding yet. Either answer is fine; an exception is not.
  assert.ok(c.merchantOnboarding === null || /^0x[0-9a-fA-F]{40}$/.test(c.merchantOnboarding));
});
test("an empty manifest yields nulls, not a crash", () => {
  const c = runtimeConfig(undefined, null, "REDACTED");
  assert.equal(c.chainId, null);
  assert.equal(c.merchantOnboarding, null);
});

// ---- the business screens' half of the configuration ------------------------------------------

const UUSD = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const TAST = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const LABELS = { [UUSD.toLowerCase()]: { symbol: "uUSD", decimals: 6 }, [TAST.toLowerCase()]: { symbol: "tAST", decimals: 18 } };
const withAssets = {
  chainId: 31337,
  environment: "LOCAL_ANVIL_NO_VALUE",
  contracts: { payoutToken: { address: UUSD }, assetToken: { address: TAST }, executor: { address: "0xexec" } },
  market: { marketId: "0xmarket", poolKey: { currency0: UUSD, currency1: TAST }, poolId: "0xpool", status: 4 },
  identity: {},
};

test("the assets are served with the role, symbol and decimal count each screen needs", () => {
  const c = runtimeConfig(withAssets, null, "REDACTED", LABELS);
  assert.deepEqual(c.assets.map((a) => [a.role, a.symbol, a.decimals, a.labelled]), [
    ["payout", "uUSD", 6, true],
    ["customer", "tAST", 18, true],
  ]);
  assert.equal(c.assets[0].address, UUSD);
});
test("an asset whose label could not be read is served unlabelled, never guessed", () => {
  const c = runtimeConfig(withAssets, null, "REDACTED", {});
  assert.deepEqual(c.assets.map((a) => [a.symbol, a.decimals, a.labelled]), [
    [null, null, false],
    [null, null, false],
  ]);
});
test("the market pair is active only at status 4", () => {
  assert.equal(runtimeConfig(withAssets, null, "REDACTED", LABELS).marketPair.active, true);
  const paused = { ...withAssets, market: { ...withAssets.market, status: 5 } };
  assert.equal(runtimeConfig(paused, null, "REDACTED", LABELS).marketPair.active, false);
  const seeded = { ...withAssets, market: { ...withAssets.market, status: 3 } };
  assert.equal(runtimeConfig(seeded, null, "REDACTED", LABELS).marketPair.active, false);
});
test("a manifest with no market serves no pair at all, rather than an empty one that looks usable", () => {
  const c = runtimeConfig({ chainId: 31337, contracts: {}, identity: {} }, null, "REDACTED", {});
  assert.equal(c.marketPair, null);
});
test("the direct settler is null until the deployment carries one", () => {
  assert.equal(runtimeConfig(withAssets, null, "REDACTED", LABELS).contracts.directSettlement, null);
  const withDirect = { ...withAssets, contracts: { ...withAssets.contracts, directSettlement: { address: "0xdirect" } } };
  assert.equal(runtimeConfig(withDirect, null, "REDACTED", LABELS).contracts.directSettlement, "0xdirect");
});
test("the environment the manifest declares is served verbatim, for the label rule to judge", () => {
  assert.equal(runtimeConfig(withAssets, null, "REDACTED", LABELS).environment, "LOCAL_ANVIL_NO_VALUE");
  assert.equal(runtimeConfig({ chainId: 1, contracts: {}, identity: {} }, null, "REDACTED", {}).environment, null);
});
test("the committed local manifest serves both of its assets and its own market pair", () => {
  const c = runtimeConfig(fullManifest, null, "REDACTED", LABELS);
  assert.equal(c.assets.length, 2);
  assert.equal(c.marketPair.marketId, fullManifest.market.marketId);
  assert.equal(c.marketPair.active, true); // the committed manifest records seed status 4, ACTIVE
  assert.equal(c.contracts.executor, fullManifest.contracts.executor.address);
  assert.equal(c.contracts.directSettlement, null);
});
