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
