// apps/web/tests/wallet.test.mjs: the provider layer, tested with fake provider objects. No DOM,
// no network, no chain, no real wallet. `node --test apps/web/tests/`.
//
// The chooser is a pure function and gets the four rows the task names plus its controls. The
// connect flow, the switch flow and send() routing are exercised against EIP-1193 doubles that
// record every request they receive, so the test can assert which method went where.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { test } from "node:test";

import {
  LOCAL_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  chooseProvider,
  connectInjected,
  connectWallet,
  discoverProviders,
  fromHexChainId,
  isPracticeNetwork,
  makeSession,
  networkName,
  pickProvider,
  switchChain,
  toHexChainId,
  waitForReceipt,
} from "../assets/wallet.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OWNER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const LOCAL_ACCOUNT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

/** An EIP-1193 double: answers from a script, records every request. */
function fakeProvider({ chainId = SEPOLIA_CHAIN_ID, accounts = [OWNER], switchError = null, switchTo = null } = {}) {
  const calls = [];
  let current = chainId;
  return {
    calls,
    request: async ({ method, params }) => {
      calls.push({ method, params });
      switch (method) {
        case "eth_chainId": return toHexChainId(current);
        case "eth_requestAccounts": return accounts;
        case "wallet_switchEthereumChain":
          if (switchError) throw switchError;
          current = switchTo ?? fromHexChainId(params[0].chainId);
          return null;
        case "eth_sendTransaction": return "0x" + "ab".repeat(32); // a fake tx hash, a vector
        case "eth_call": return "0x" + "00".repeat(32); // a fake read, a vector
        default: throw new Error(`fake provider: unexpected ${method}`);
      }
    },
  };
}

/** A fetch double for the configured RPC: answers eth_accounts and records eth_sendTransaction. */
function fakeFetch(script = {}) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, method: body.method, params: body.params });
    const answer = script[body.method];
    const result = typeof answer === "function" ? answer(body.params) : answer;
    return { json: async () => ({ jsonrpc: "2.0", id: body.id, result: result ?? null }) };
  };
  fn.calls = calls;
  return fn;
}

// ---- the pure chooser: the four rows, then the controls -----------------------------------------

test("chooser: injected wallet on the configured chain -> injected", () => {
  assert.deepEqual(chooseProvider({ injected: true, injectedChainId: SEPOLIA_CHAIN_ID, configuredChainId: SEPOLIA_CHAIN_ID }), { kind: "injected" });
});
test("chooser: injected wallet on the wrong chain -> switch requested, with a blocking sentence", () => {
  const v = chooseProvider({ injected: true, injectedChainId: 1, configuredChainId: SEPOLIA_CHAIN_ID });
  assert.equal(v.kind, "switch");
  assert.equal(v.from, 1);
  assert.equal(v.to, SEPOLIA_CHAIN_ID);
  assert.match(v.sentence, /Sepolia test network/);
  assert.match(v.sentence, /nothing is sent from the wrong network/i);
});
test("chooser: no wallet, local practice network -> the local unlocked account", () => {
  const v = chooseProvider({ injected: false, injectedChainId: null, configuredChainId: LOCAL_CHAIN_ID });
  assert.equal(v.kind, "local");
  assert.match(v.sentence, /Nothing here has value/);
});
test("chooser: no wallet, Sepolia -> blocked with a plain sentence", () => {
  const v = chooseProvider({ injected: false, injectedChainId: null, configuredChainId: SEPOLIA_CHAIN_ID });
  assert.equal(v.kind, "blocked");
  assert.equal(v.sentence, "No wallet was found in this browser. Install a browser wallet, open it on Sepolia test network, and reload this page.");
});
test("chooser control: an injected wallet on the local chain is injected, never the unlocked account", () => {
  assert.deepEqual(chooseProvider({ injected: true, injectedChainId: LOCAL_CHAIN_ID, configuredChainId: LOCAL_CHAIN_ID }), { kind: "injected" });
});
test("chooser control: an injected wallet whose chain is unknown is asked to switch, not trusted", () => {
  assert.equal(chooseProvider({ injected: true, injectedChainId: null, configuredChainId: LOCAL_CHAIN_ID }).kind, "switch");
});
test("chooser control: no configured chain at all is blocked, never local", () => {
  const v = chooseProvider({ injected: false });
  assert.equal(v.kind, "blocked");
  assert.match(v.sentence, /not been told which network/);
});
test("chooser: the sentences never contain hex, a chain id, or a contract word", () => {
  for (const s of [
    chooseProvider({ injected: true, injectedChainId: 1, configuredChainId: SEPOLIA_CHAIN_ID }).sentence,
    chooseProvider({ injected: false, configuredChainId: LOCAL_CHAIN_ID }).sentence,
    chooseProvider({ injected: false, configuredChainId: SEPOLIA_CHAIN_ID }).sentence,
  ]) {
    assert.doesNotMatch(s, /0x|31337|11155111|hook|executor|registry|calldata/i, s);
  }
});

// ---- network names ----------------------------------------------------------------------------------

test("networkName reads as a business owner would", () => {
  assert.equal(networkName(LOCAL_CHAIN_ID), "Local practice network");
  assert.equal(networkName(SEPOLIA_CHAIN_ID), "Sepolia test network");
  assert.equal(networkName("0x7a69"), "Local practice network"); // a hex chain id reads the same
  assert.equal(networkName(fromHexChainId("0x7a69")), "Local practice network");
  assert.equal(networkName(undefined), "Unknown network");
  assert.equal(networkName("not a chain"), "Unknown network");
  assert.equal(networkName(46630), "Network 46630");
});
test("every network this site runs on is a practice network; mainnet is not", () => {
  assert.equal(isPracticeNetwork(LOCAL_CHAIN_ID), true);
  assert.equal(isPracticeNetwork(SEPOLIA_CHAIN_ID), true);
  assert.equal(isPracticeNetwork(1), false);
});
test("chain ids round-trip through hex", () => {
  assert.equal(toHexChainId(SEPOLIA_CHAIN_ID), "0xaa36a7");
  assert.equal(fromHexChainId("0xaa36a7"), SEPOLIA_CHAIN_ID);
  assert.equal(fromHexChainId(null), null);
});

// ---- discovery with a fake window ------------------------------------------------------------------

function fakeWindow({ announced = [], ethereum = null } = {}) {
  const listeners = new Map();
  return {
    ethereum,
    Event: class { constructor(type) { this.type = type; } },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    dispatchEvent(ev) {
      if (ev.type !== "eip6963:requestProvider") return;
      const fn = listeners.get("eip6963:announceProvider");
      for (const entry of announced) fn?.({ detail: entry });
    },
  };
}

test("discoverProviders finds every EIP-6963 announced wallet plus window.ethereum, once each", async () => {
  const a = fakeProvider();
  const b = fakeProvider();
  const win = fakeWindow({ announced: [{ info: { name: "Wallet A", rdns: "a.example" }, provider: a }, { info: { name: "Wallet B", rdns: "b.example" }, provider: b }], ethereum: a });
  const found = await discoverProviders(win, { timeoutMs: 1 });
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((f) => f.info.rdns), ["a.example", "b.example"]);
});
test("discoverProviders falls back to window.ethereum when nothing announces itself", async () => {
  const only = fakeProvider();
  const found = await discoverProviders(fakeWindow({ ethereum: only }), { timeoutMs: 1 });
  assert.equal(found.length, 1);
  assert.equal(found[0].provider, only);
});
test("discoverProviders returns an empty list, not a crash, with no wallet at all", async () => {
  assert.deepEqual(await discoverProviders(fakeWindow(), { timeoutMs: 1 }), []);
  assert.deepEqual(await discoverProviders(undefined, { timeoutMs: 1 }), []);
});
test("pickProvider prefers the remembered wallet and otherwise takes the first", () => {
  const list = [{ info: { rdns: "a" }, provider: 1 }, { info: { rdns: "b" }, provider: 2 }];
  assert.equal(pickProvider(list, "b").provider, 2);
  assert.equal(pickProvider(list).provider, 1);
  assert.equal(pickProvider([]), null);
});

// ---- connect, switch, and send routing with fakes ----------------------------------------------------

test("connectInjected asks for accounts and the chain, in that order", async () => {
  const p = fakeProvider({ chainId: LOCAL_CHAIN_ID });
  const r = await connectInjected(p);
  assert.deepEqual(r, { address: OWNER, chainId: LOCAL_CHAIN_ID });
  assert.deepEqual(p.calls.map((c) => c.method), ["eth_requestAccounts", "eth_chainId"]);
});
test("switchChain succeeds when the wallet lands on the requested chain", async () => {
  const p = fakeProvider({ chainId: 1 });
  assert.deepEqual(await switchChain(p, SEPOLIA_CHAIN_ID), { ok: true });
  assert.equal(p.calls[0].method, "wallet_switchEthereumChain");
  assert.equal(p.calls[0].params[0].chainId, "0xaa36a7");
});
test("switchChain says so in plain words when the wallet declines (4001)", async () => {
  const p = fakeProvider({ chainId: 1, switchError: Object.assign(new Error("User rejected"), { code: 4001 }) });
  const r = await switchChain(p, SEPOLIA_CHAIN_ID);
  assert.equal(r.ok, false);
  assert.match(r.sentence, /declined the network switch/);
});
test("switchChain says the chain must be added when the wallet does not know it (4902)", async () => {
  const p = fakeProvider({ chainId: 1, switchError: Object.assign(new Error("Unrecognized"), { code: 4902 }) });
  assert.match((await switchChain(p, LOCAL_CHAIN_ID)).sentence, /does not know Local practice network yet/);
});
test("switchChain control: a wallet that claims success but stays put is not trusted", async () => {
  const p = fakeProvider({ chainId: 1, switchTo: 1 });
  const r = await switchChain(p, SEPOLIA_CHAIN_ID);
  assert.equal(r.ok, false);
  assert.match(r.sentence, /still on/);
});

test("connectWallet: injected wallet on the right chain -> an injected session whose send() goes to the wallet", async () => {
  const p = fakeProvider({ chainId: SEPOLIA_CHAIN_ID });
  const fetchImpl = fakeFetch();
  const r = await connectWallet({ config: { rpc: "REDACTED", chainId: SEPOLIA_CHAIN_ID }, providers: [{ info: { name: "W", rdns: "w" }, provider: p }], fetchImpl });
  assert.ok(r.session, r.blocked);
  assert.equal(r.session.kind, "injected");
  assert.equal(r.session.address, OWNER);
  await r.session.send({ to: OWNER, data: "0x" });
  const sent = p.calls.find((c) => c.method === "eth_sendTransaction");
  assert.ok(sent, "the wallet received eth_sendTransaction");
  assert.equal(sent.params[0].from, OWNER);
  assert.equal(fetchImpl.calls.filter((c) => c.method === "eth_sendTransaction").length, 0, "the RPC never received a send");
});
test("connectWallet: injected wallet on the wrong chain is switched, then connected", async () => {
  const p = fakeProvider({ chainId: 1 });
  const r = await connectWallet({ config: { rpc: null, chainId: SEPOLIA_CHAIN_ID }, providers: [{ info: { name: "W", rdns: "w" }, provider: p }], fetchImpl: fakeFetch() });
  assert.ok(r.session, r.blocked);
  assert.ok(p.calls.some((c) => c.method === "wallet_switchEthereumChain"));
  assert.equal(r.session.chainId, SEPOLIA_CHAIN_ID);
});
test("connectWallet: injected wallet on the wrong chain that declines the switch is blocked, and nothing is requested", async () => {
  const p = fakeProvider({ chainId: 1, switchError: Object.assign(new Error("no"), { code: 4001 }) });
  const r = await connectWallet({ config: { rpc: null, chainId: SEPOLIA_CHAIN_ID }, providers: [{ info: { name: "W", rdns: "w" }, provider: p }], fetchImpl: fakeFetch() });
  assert.equal(r.session, undefined);
  assert.match(r.blocked, /declined/);
  assert.equal(p.calls.filter((c) => c.method === "eth_requestAccounts").length, 0);
});
test("connectWallet: no wallet, local chain -> a local session whose send() goes to the RPC as eth_sendTransaction", async () => {
  const fetchImpl = fakeFetch({ eth_accounts: [LOCAL_ACCOUNT], eth_sendTransaction: "0x" + "cd".repeat(32) }); // fake hash vector
  const r = await connectWallet({ config: { rpc: "REDACTED", chainId: LOCAL_CHAIN_ID }, providers: [], fetchImpl });
  assert.ok(r.session, r.blocked);
  assert.equal(r.session.kind, "local");
  assert.equal(r.session.address, LOCAL_ACCOUNT);
  assert.match(r.note, /own test account/);
  await r.session.send({ to: OWNER, data: "0x" });
  const sent = fetchImpl.calls.find((c) => c.method === "eth_sendTransaction");
  assert.equal(sent.params[0].from, LOCAL_ACCOUNT);
});
test("connectWallet: no wallet, local chain, with a named local account (?as=) uses that account", async () => {
  const fetchImpl = fakeFetch({ eth_accounts: [LOCAL_ACCOUNT] });
  const r = await connectWallet({ config: { rpc: "REDACTED", chainId: LOCAL_CHAIN_ID }, providers: [], localFrom: OWNER, fetchImpl });
  assert.equal(r.session.address, OWNER);
});
test("connectWallet: no wallet, Sepolia -> blocked, and the RPC is never asked for accounts", async () => {
  const fetchImpl = fakeFetch({ eth_accounts: [LOCAL_ACCOUNT] });
  const r = await connectWallet({ config: { rpc: "REDACTED", chainId: SEPOLIA_CHAIN_ID }, providers: [], fetchImpl });
  assert.equal(r.session, undefined);
  assert.match(r.blocked, /No wallet was found/);
  assert.equal(fetchImpl.calls.length, 0);
});
test("connectWallet: a wallet that connects with no account is blocked in plain words", async () => {
  const p = fakeProvider({ chainId: LOCAL_CHAIN_ID, accounts: [] });
  const r = await connectWallet({ config: { rpc: "REDACTED", chainId: LOCAL_CHAIN_ID }, providers: [{ info: {}, provider: p }], fetchImpl: fakeFetch() });
  assert.match(r.blocked, /shared no account/);
});

test("a session with no kind cannot send", async () => {
  const s = makeSession({ kind: "none", address: OWNER, chainId: LOCAL_CHAIN_ID, rpc: "REDACTED", fetchImpl: fakeFetch() });
  await assert.rejects(() => s.send({ to: OWNER }), /cannot send/);
});
test("reads go through the configured RPC even for an injected wallet, when one is named", async () => {
  const p = fakeProvider();
  const fetchImpl = fakeFetch({ eth_call: "0x01" });
  const s = makeSession({ kind: "injected", address: OWNER, chainId: SEPOLIA_CHAIN_ID, provider: p, rpc: "REDACTED", fetchImpl });
  assert.equal(await s.call({ to: OWNER, data: "0x" }), "0x01");
  assert.equal(p.calls.length, 0);
});
test("waitForReceipt returns null, never a guess, when the chain does not answer in time", async () => {
  const s = makeSession({ kind: "local", address: OWNER, chainId: LOCAL_CHAIN_ID, rpc: "REDACTED", fetchImpl: fakeFetch({ eth_getTransactionReceipt: null }) });
  assert.equal(await waitForReceipt(s, "0x", { intervalMs: 0, timeoutMs: 5, sleep: async () => {} }), null);
});
test("waitForReceipt returns the receipt once the chain has one", async () => {
  let n = 0;
  const s = makeSession({ kind: "local", address: OWNER, chainId: LOCAL_CHAIN_ID, rpc: "REDACTED", fetchImpl: fakeFetch({ eth_getTransactionReceipt: () => (++n < 3 ? null : { status: "0x1" }) }) });
  assert.deepEqual(await waitForReceipt(s, "0x", { intervalMs: 0, timeoutMs: 1000, sleep: async () => {} }), { status: "0x1" });
});

// ---- the negative that matters: no key material is ever handled ----------------------------------

test("wallet.js contains no code that names a private key or a recovery phrase", () => {
  const src = readFileSync(join(HERE, "..", "assets", "wallet.js"), "utf8");
  // The banner comment says what the file never does; the code below the banner must not even
  // mention it. Strip block comments first so the rule bites on code, not prose.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /privateKey|private_key|mnemonic|seedPhrase|seed_phrase|eth_sign\b|personal_sign|wallet_exportKey/i);
});
test("control: the key-material rule would catch a violation", () => {
  assert.match("const k = req.body.privateKey;", /privateKey|private_key|mnemonic|seedPhrase|seed_phrase/i);
});
