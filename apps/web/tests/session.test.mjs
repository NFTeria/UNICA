// The wallet is the login: remembered address, silent reconnect, prompted login, and where to go next.
// Every chain and wallet here is a double; nothing binds a socket.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  REMEMBERED_KEY,
  forgetWallet,
  loginWithWallet,
  practiceAccounts,
  readBusiness,
  rememberWallet,
  rememberedWallet,
  silentReconnect,
  whereTo,
} from "../assets/session.js";

const A = "0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73";
const B = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
};
const throwingStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
const provider = (accounts, chainHex, info = { name: "Test Wallet", rdns: "test" }) => ({
  info,
  provider: { request: async ({ method }) => (method === "eth_accounts" ? accounts : method === "eth_chainId" ? chainHex : null) },
});
const rpcFetch = (answers) => async (_url, init) => {
  const { method } = JSON.parse(init.body);
  return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: answers[method] }) };
};

test("the remembered wallet is a convenience that never throws and never keeps a malformed value", () => {
  const s = fakeStorage();
  assert.equal(rememberedWallet(s), null);
  assert.equal(rememberWallet(A, s), true);
  assert.equal(rememberedWallet(s), A);
  assert.equal(rememberWallet("not an address", s), false);
  assert.equal(rememberedWallet(s), A);
  s.setItem(REMEMBERED_KEY, "garbage");
  assert.equal(rememberedWallet(s), null);
  forgetWallet(s);
  assert.equal(rememberedWallet(s), null);
  assert.equal(rememberWallet(A, throwingStorage), false);
  assert.equal(rememberedWallet(throwingStorage), null);
  forgetWallet(throwingStorage);
  assert.equal(rememberWallet(A, null), false);
});

test("silent reconnect recognises an approved wallet on the right network without a prompt, and prefers the remembered address", async () => {
  const config = { chainId: 11155111, rpc: "/local/rpc" };
  const s = fakeStorage();
  rememberWallet(B, s);
  const hit = await silentReconnect(config, { storage: s, providers: [provider([A, B], "0xaa36a7")] });
  assert.equal(hit.session.address, B);
  assert.equal(hit.session.kind, "injected");
  assert.equal(hit.wallet.name, "Test Wallet");
  const first = await silentReconnect(config, { storage: fakeStorage(), providers: [provider([A, B], "0xaa36a7")] });
  assert.equal(first.session.address, A);
});

test("silent reconnect returns null for an unapproved wallet, a wallet on another network, or no wallet at all", async () => {
  const config = { chainId: 11155111, rpc: "/local/rpc" };
  assert.equal(await silentReconnect(config, { storage: fakeStorage(), providers: [provider([], "0xaa36a7")] }), null);
  assert.equal(await silentReconnect(config, { storage: fakeStorage(), providers: [provider([A], "0x1")] }), null);
  assert.equal(await silentReconnect(config, { storage: fakeStorage(), providers: [] }), null);
  const broken = { info: { name: "x" }, provider: { request: async () => { throw new Error("locked"); } } };
  assert.equal(await silentReconnect(config, { storage: fakeStorage(), providers: [broken] }), null);
});

test("on the practice chain a remembered practice account reconnects through the chain's own accounts", async () => {
  const config = { chainId: 31337, rpc: "http://127.0.0.1:8545" };
  const fetchImpl = rpcFetch({ eth_accounts: [A, B] });
  const s = fakeStorage();
  rememberWallet(B, s);
  const hit = await silentReconnect(config, { storage: s, providers: [], fetchImpl });
  assert.equal(hit.session.kind, "local");
  assert.equal(hit.session.address, B);
  assert.equal(await silentReconnect(config, { storage: fakeStorage(), providers: [], fetchImpl }), null, "nothing remembered: nothing assumed");
  assert.deepEqual(await practiceAccounts(config, fetchImpl), [A, B]);
  assert.deepEqual(await practiceAccounts({ chainId: 11155111, rpc: "/local/rpc" }, fetchImpl), [], "only the practice chain has unlocked accounts");
});

test("a prompted login remembers the address it connected", async () => {
  const config = { chainId: 31337, rpc: "http://127.0.0.1:8545" };
  const s = fakeStorage();
  const result = await loginWithWallet(config, { storage: s, providers: [], fetchImpl: rpcFetch({ eth_accounts: [A, B] }), localFrom: B });
  assert.equal(result.session.address, B);
  assert.equal(rememberedWallet(s), B);
});

test("where to go next follows the chain, not the browser", async () => {
  assert.equal(whereTo({ available: false, joined: false }), "wallet");
  assert.equal(whereTo({ available: true, joined: false }), "join");
  assert.equal(whereTo({ available: true, joined: true }), "business");
  assert.equal(whereTo(null), "wallet");
  const noSignup = await readBusiness({ address: A }, { merchantOnboarding: null });
  assert.equal(noSignup.available, false);
  assert.match(noSignup.reason, /Ethereum Sepolia/);
  const zero = "0x" + "0".repeat(64);
  const firstTime = await readBusiness({ address: A, call: async () => zero }, { merchantOnboarding: B });
  assert.deepEqual(firstTime, { available: true, joined: false });
});
