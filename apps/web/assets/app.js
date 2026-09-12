/**
 * Progressive enhancement only. Small, local, auditable, and it holds no secret.
 *
 * Everything a page MEANS is already in the served HTML: its identity, its disclosures, its status
 * and its navigation. This file may add live reads later, through the adapter boundary. If it never
 * loads, nothing a reader needs disappears — which is why no disclosure is written from here.
 *
 * IT ALSO DRIVES THE WALLET CHIP, ON EVERY PAGE. There is no account and no password: the wallet is
 * the login. A wallet that has already approved this site answers without a prompt, so a returning
 * owner is recognised silently and the chip simply shows who they are and which network they are
 * on. A first press of the button is the wallet's own approval flow. What happens after it is
 * decided by the CHAIN, not by this file: the chain is asked whether this wallet already has a
 * business, and the answer sends the person to their dashboard, to the setup flow, or to a sentence
 * saying this network has no sign-up in this release.
 *
 * WITH NO COMPANION SERVER THERE IS NOTHING TO SIGN IN TO, and the chip says exactly that rather
 * than offering a button that cannot work. The static site is still a correct description of the
 * product; it is just not a business.
 */
import { loadConfig, shortId } from "./local.js";
import {
  LOCAL_CHAIN_ID,
  forgetWallet,
  loginWithWallet,
  practiceAccounts,
  readBusiness,
  silentReconnect,
  whereTo,
} from "./session.js";
import { networkName } from "./wallet.js";

const q = new URLSearchParams(location.search);

/** Validates before it renders. An identifier that does not match is reported, never interpolated. */
export function readParam(name, pattern) {
  const values = q.getAll(name);
  if (values.length === 0) return { ok: false, reason: "missing" };
  if (values.length > 1) return { ok: false, reason: "duplicate" };
  if (!pattern.test(values[0])) return { ok: false, reason: "malformed" };
  return { ok: true, value: values[0] };
}

/** textContent, never innerHTML: a query value can never become markup on this page. */
function say(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

const HASH32 = /^0x[0-9a-fA-F]{64}$/;
const CHAIN = /^[0-9]{1,7}$/;

if (document.getElementById("receipt")) {
  const chain = readParam("chain", CHAIN);
  const tx = readParam("tx", HASH32);
  if (!chain.ok || !tx.ok) {
    const why = !chain.ok ? `chain id ${chain.reason}` : `transaction hash ${tx.reason}`;
    say("receipt", `No receipt can be shown: ${why}. An unrecognised link is never rendered as a settlement.`);
  } else {
    // Evidence is never taken from the URL. A record becomes confirmed only by presenting the full
    // proof to the validator, which no link can do.
    say("receipt", `Reading chain ${chain.value} for that transaction. Until the chain answers and every proof field matches, this record is not confirmed.`);
  }
}
if (document.getElementById("order-detail")) {
  const order = readParam("order", HASH32);
  say("order-detail", order.ok
    ? `Reading order ${order.value.slice(0, 10)}… from the chain.`
    : `No order in this link${order.reason === "missing" ? "" : ` (${order.reason})`}.`);
}

// ── the wallet chip ──────────────────────────────────────────────────────────────────────────────

/** Where a signed-in person goes, relative to whatever depth this page sits at. */
export function destinationFor(business, prefix = "./") {
  const where = whereTo(business);
  if (where === "business") return `${prefix}business/`;
  if (where === "join") return `${prefix}join/`;
  return null; // this network has no sign-up: stay here and say so
}

/** The address as a person reads it aloud. Never the whole thing on the surface. */
export function shortAddress(address) {
  return shortId(String(address ?? ""));
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Replace the chip's contents. textContent everywhere: nothing read from a chain becomes markup. */
function fill(chip, nodes) {
  chip.replaceChildren(...nodes);
}

function line(chip, text) {
  fill(chip, [el("span", "wchip-line", text)]);
}

async function driveChip(chip, { load = loadConfig, reconnect = silentReconnect, login = loginWithWallet, accounts = practiceAccounts, business = readBusiness, go = (href) => location.assign(href) } = {}) {
  const prefix = chip.dataset.prefix || "./";
  const config = await load();
  if (!config) {
    line(chip, "This site is showing the product, not a business. There is nothing to sign in to here.");
    return;
  }

  const signedIn = (session) => {
    const out = el("button", "cta cta-quiet", "Log out");
    out.type = "button";
    out.addEventListener("click", () => {
      forgetWallet();
      location.reload();
    });
    fill(chip, [
      el("span", "wchip-addr", shortAddress(session.address)),
      el("span", "wchip-line", networkName(session.chainId)),
      out,
    ]);
  };

  const known = await reconnect(config);
  if (known?.session) {
    signedIn(known.session);
    const name = document.getElementById("topbar-business");
    if (name) {
      const answer = await business(known.session, config).catch(() => null);
      if (answer?.joined && answer.name) name.textContent = answer.name;
      else if (answer && answer.available === false) name.textContent = "No business on this network";
      else if (answer) name.textContent = "No business set up yet";
    }
    return;
  }

  // Nobody is recognised. Offer the one button, and on the testnet the accounts that
  // network itself unlocks, because there is no browser wallet there to ask.
  const button = el("button", "cta", "Log in with wallet");
  button.type = "button";
  button.id = "wallet-login";
  const note = el("span", "wchip-line", networkName(config.chainId));
  let chooser = null;
  if (Number(config.chainId) === LOCAL_CHAIN_ID) {
    const list = await accounts(config);
    if (list.length) {
      chooser = document.createElement("select");
      chooser.id = "practice-account";
      chooser.setAttribute("aria-label", "Testnet account to sign in as");
      for (const address of list) {
        const option = document.createElement("option");
        option.value = address;
        option.textContent = shortAddress(address);
        chooser.append(option);
      }
    }
  }
  fill(chip, chooser ? [note, chooser, button] : [note, button]);

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Waiting for your wallet…";
    const result = await login(config, { localFrom: chooser ? chooser.value : null }).catch((e) => ({
      blocked: `Your wallet did not answer: ${e?.message ?? "no reason given"}.`,
    }));
    if (result?.blocked || !result?.session) {
      line(chip, result?.blocked ?? "No wallet answered, so nobody is signed in.");
      return;
    }
    signedIn(result.session);
    const answer = await business(result.session, config).catch(() => null);
    if (!answer) {
      const said = el("span", "wchip-line", "You are signed in. Your business could not be read just now.");
      chip.append(said);
      return;
    }
    const href = destinationFor(answer, prefix);
    if (href) go(href);
    else chip.append(el("span", "wchip-line", answer.reason ?? "This network has no business sign-up in this release."));
  });
}

const chipEl = typeof document === "undefined" ? null : document.getElementById("wallet-chip");
if (chipEl) {
  driveChip(chipEl).catch(() => {
    line(chipEl, "Signing in is unavailable on this page right now.");
  });
}

export { driveChip };

// ── the colour scheme ────────────────────────────────────────────────────────────────────────────

/**
 * ONE KEY, THREE STATES, AND SYSTEM IS THE ABSENCE OF A CHOICE. "light" and "dark" are the only two
 * values ever written; picking "system" REMOVES the key and the attribute, so a viewer who changes
 * their mind is returned to their machine's preference rather than frozen at whatever it happened
 * to be that afternoon. Anything else found in storage is ignored, because a page must render
 * correctly against a key some other page, or some other version of this one, might have written.
 *
 * EVERY STORAGE ACCESS IS WRAPPED. A private window, cleared site data, or a browser set to block
 * site data can make the getter itself throw, not merely return null. A colour preference is never
 * worth a page that fails to load, so both directions fail quiet and the page falls back to the
 * media query — which is a correct answer, not a degraded one.
 *
 * The attribute is stamped a second time here only because this file may run after a script-driven
 * navigation; the FIRST stamp is the inline script in the head, which is what stops the flash.
 */
export const THEME_KEY = "unica.theme";
export const THEME_STATES = Object.freeze(["system", "light", "dark"]);

function themeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The stored choice, or "system" for no choice, an unreadable store, or a value nobody wrote. */
export function readTheme(storage = themeStorage()) {
  try {
    const found = storage?.getItem(THEME_KEY);
    return found === "light" || found === "dark" ? found : "system";
  } catch {
    return "system";
  }
}

/** Writes a choice, or clears it for "system". Returns what a later read will now answer. */
export function storeTheme(value, storage = themeStorage()) {
  const choice = THEME_STATES.includes(value) ? value : "system";
  try {
    if (choice === "system") storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, choice);
  } catch {
    /* a preference is never worth an exception */
  }
  return choice;
}

/** Stamps the choice on the document element. "system" removes the attribute; it is not a value. */
export function applyTheme(value, root = globalThis.document?.documentElement) {
  if (!root) return "system";
  const choice = THEME_STATES.includes(value) ? value : "system";
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  return choice;
}

export function driveTheme(select, { storage = themeStorage(), root = globalThis.document?.documentElement } = {}) {
  const current = readTheme(storage);
  select.value = current;
  applyTheme(current, root);
  select.addEventListener("change", () => {
    applyTheme(storeTheme(select.value, storage), root);
  });
  return current;
}

const themeEl = typeof document === "undefined" ? null : document.getElementById("theme-choice");
if (themeEl) driveTheme(themeEl);
