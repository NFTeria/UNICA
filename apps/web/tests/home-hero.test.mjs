// The home page's primary button, driven with a fake document: every recognised wallet gets somewhere
// to go, and the served page's disabled button (with its reason) is what remains only when nothing
// answers. Pure functions and a fake root; no browser, no chain.
import test from "node:test";
import assert from "node:assert/strict";
import { driveHero } from "../assets/home.js";

function fakeRoot() {
  const button = { disabled: true, textContent: "Log in with wallet", handlers: [], addEventListener(_, fn) { this.handlers.push(fn); } };
  const swap = { href: "" };
  return { button, swap, root: { getElementById: (id) => (id === "hero-login" ? button : id === "hero-swap" ? swap : null) } };
}

const CONFIG = { chainId: 11155111, assets: [] };

async function drive({ session = { address: "0x19e5" }, answer = null, config = CONFIG } = {}) {
  const { button, root } = fakeRoot();
  const gone = [];
  await driveHero(root, {
    load: async () => config,
    reconnect: async () => (session ? { session } : null),
    business: async () => answer,
    chipLogin: async () => null,
    go: (href) => gone.push(href),
  });
  for (const fn of button.handlers) await fn();
  return { button, gone };
}

test("a wallet with a business opens that business", async () => {
  const { button, gone } = await drive({ answer: { available: true, joined: true, name: "freshcuts.unica.eth" } });
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Open my business");
  assert.deepEqual(gone, ["business/"]);
});

test("a wallet on a network with sign-up, not yet joined, is sent to join", async () => {
  const { button, gone } = await drive({ answer: { available: true, joined: false } });
  assert.equal(button.textContent, "Add your business");
  assert.deepEqual(gone, ["join/"]);
});

test("a recognised wallet with no business here opens the dashboard, which lists its purchases", async () => {
  const { button, gone } = await drive({ answer: { available: false, joined: false, reason: "No business is registered to this wallet on this network yet." } });
  assert.equal(button.disabled, false, "the button stayed disabled beside a chip that says who the wallet is");
  assert.equal(button.textContent, "Open my dashboard");
  assert.deepEqual(gone, ["business/"]);
});

test("a business read that fails still gives the wallet the dashboard", async () => {
  const { button, root } = fakeRoot();
  await driveHero(root, { load: async () => CONFIG, reconnect: async () => ({ session: { address: "0x19e5" } }), business: async () => { throw new Error("node away"); }, chipLogin: async () => null, go: () => {} });
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Open my dashboard");
});

test("control: with no companion answering, the served button stays disabled and keeps its reason", async () => {
  const { button } = await drive({ config: null });
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "Log in with wallet");
});

test("control: no recognised wallet, the button enables and reaches for the header chip's login", async () => {
  const { button } = await drive({ session: null });
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Log in with wallet");
});
