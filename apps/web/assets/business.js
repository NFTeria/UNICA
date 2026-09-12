/**
 * The business admin: the overview, the orders list and one order's detail.
 *
 * THE WALLET IS THE WHOLE ANSWER TO "WHOSE SCREEN IS THIS". Every admin route asks the browser
 * whether a wallet has already approved this site, asks the chain what that wallet's business is,
 * and shows that. There is no stored record of a business anywhere in this file, no fixture, and
 * nothing carried over from a previous visit. A wallet nobody recognises sees one line and the
 * sign-in control the header already carries; a wallet with no business yet is sent to set one up;
 * a network where businesses cannot be set up shows that wallet's own holdings and payments and
 * says, in one line, why there is nothing else.
 *
 * IT READS; IT DOES NOT ASSUME. Every figure comes from the companion server's view of the chain.
 * A figure that could not be read is an em dash, never a zero: an unread count and a real zero look
 * identical on a dashboard and mean opposite things to the person reading it.
 *
 * TWO ACTIONS SPEND A WALLET CONFIRMATION, and both say so in one line before they are pressed:
 * switching a register off, and (on the products screen, from this file's helpers) listing or
 * deactivating a product.
 *
 * WHAT IS PURE LIVES AT THE TOP. The arithmetic behind every number on these screens — which
 * payments count as today's, what a decision is called, how a row is shaped, which colour a mark
 * may be — takes plain values and returns plain values, so apps/web/tests/admin.test.mjs exercises
 * the real rule rather than a paraphrase of it.
 */
import { businessAccent, businessStyle, contrastRatio, hexToRgb, hslToHex, INTEGRATIONS, luminance, rgbToHsl, textOn } from "./brand.js";
import { assetMenu, businessDisplayName, formatAmountFor, holdingsRows, isAddress, registerDisplayName, validateEnvironment } from "./product.js";
import { fillAdvanced, loadConfig, say, shortId } from "./local.js";
import { listRegisters, registerStatusText, revokeRegisterOnChain } from "./local-join.js";
import { readBusiness, silentReconnect } from "./session.js";
import { shopPath } from "./shop-resolve.js";
import { rpcRequest } from "./wallet.js";
import { encodeCall } from "./abi.js";

// ---- the day, and the words for a moment in it --------------------------------------------------

const DAY = 86400;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function startOfDay(seconds) {
  return Math.floor(Number(seconds) / DAY) * DAY;
}

/**
 * When a payment landed, as a person reads it. Everything is in UTC on purpose: the chain answers
 * in UTC, the companion counts a day in UTC, and a screen that quietly reformatted into the
 * browser's zone would put a payment on a different day from the number above it.
 */
export function whenText(seconds, nowSeconds) {
  const at = Number(seconds);
  if (!Number.isFinite(at) || at <= 0) return "Not known";
  const d = new Date(at * 1000);
  const clock = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  if (Number.isFinite(Number(nowSeconds)) && startOfDay(at) === startOfDay(nowSeconds)) return `Today, ${clock}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${clock}`;
}

// ---- what a verification decision is called ------------------------------------------------------

/**
 * The only branch on which a business owner reads "Paid". Everything else says what it is: a check
 * that refused, a check that could not run, or a check that has not finished. None of the three is
 * allowed to borrow the word the verified one uses.
 */
export function decisionPill(decision, reasonCodes = []) {
  const d = String(decision ?? "").toUpperCase();
  const why = (Array.isArray(reasonCodes) ? reasonCodes : []).map((c) => String(c).toUpperCase());
  if (d === "VERIFIED") return { status: "verified", label: "Paid" };
  if (d === "REFUSED") return { status: "refused", label: "Refused" };
  // An order still open has not failed anything: the customer has not paid yet. The projection says
  // so by name, and the word for that is the one a person would use — waiting — not "unknown", which
  // is what a check that could not RUN says. Conflating the two turns an ordinary unpaid invoice
  // into something that looks broken.
  if (d === "UNKNOWN" && why.includes("ORDER_OPEN")) return { status: "pending", label: "Waiting" };
  if (d === "UNKNOWN") return { status: "unknown", label: "Not known" };
  return { status: "pending", label: "Checking" };
}

// ---- the three figures at the top of the overview -------------------------------------------------

/**
 * Today's takings for one payout wallet, from the payments the companion listed for it.
 *
 * Only a VERIFIED payment is counted, and only one in the payout asset is added to the total: a
 * business that was paid in two different assets today has two totals, and adding them would be
 * arithmetic on unlike things. Payments today in another asset are counted separately so the
 * screen can say they exist rather than lose them.
 *
 * `null` for the total means nothing has been read, which is why an empty list returns a total of
 * "0" ONLY when the list itself was read: the caller passes the payments it actually received.
 */
export function kpiFromPayments(payments, nowSeconds, payoutAssetAddress = null) {
  const list = Array.isArray(payments) ? payments : [];
  const dayStart = startOfDay(nowSeconds);
  const isToday = (p) => {
    const at = Number(p?.settledAt ?? 0);
    return at >= dayStart && at < dayStart + DAY;
  };
  const verified = list.filter((p) => String(p?.decision ?? "").toUpperCase() === "VERIFIED");
  const verifiedToday = verified.filter(isToday);
  const payout = String(payoutAssetAddress ?? "").toLowerCase();
  let total = 0n;
  let inPayoutAsset = 0;
  let otherAssets = 0;
  for (const p of verifiedToday) {
    if (payout && String(p.asset ?? "").toLowerCase() === payout) {
      total += BigInt(p.amount ?? 0);
      inPayoutAsset += 1;
    } else {
      otherAssets += 1;
    }
  }
  const unresolvedToday = list.filter((p) => isToday(p) && String(p?.decision ?? "").toUpperCase() !== "VERIFIED").length;
  const last = [...list].sort((a, b) => Number(b?.blockNumber ?? 0) - Number(a?.blockNumber ?? 0))[0] ?? null;
  return {
    verifiedToday: verifiedToday.length,
    unresolvedToday,
    totalToday: payout ? total.toString() : null,
    countedInTotal: inPayoutAsset,
    otherAssetsToday: otherAssets,
    last,
  };
}

// ---- one order, as a row -------------------------------------------------------------------------

/**
 * The orders table's rows. `names` maps a product id to the name its seller gave it, so a catalogue
 * sale reads as the thing that was bought; every other payment reads as a sale, because that is all
 * the chain says about it. Nothing here invents a description.
 */
export function orderRows(payments, { names = {}, nowSeconds = 0 } = {}) {
  const list = Array.isArray(payments) ? payments : [];
  return list.map((p) => {
    const kind = String(p?.kind ?? "");
    const named = kind === "product" ? names[String(p.productId)] ?? null : null;
    return {
      orderId: p?.orderId ?? null,
      kind,
      when: whenText(p?.settledAt, nowSeconds),
      what: named ?? (kind === "product" ? "Item" : "Sale"),
      amount: p?.amount ?? null,
      asset: p?.asset ?? null,
      payer: p?.payer ?? null,
      from: shortId(String(p?.payer ?? "")),
      transactionHash: p?.transactionHash ?? null,
      ...decisionPill(p?.decision, p?.reasonCodes),
      reasonCodes: Array.isArray(p?.reasonCodes) ? p.reasonCodes : [],
      converted: kind === "market",
    };
  });
}

/**
 * The shop's own address, absolute, because it is handed to somebody else.
 *
 * A business with a pay name is addressed BY THAT NAME, which is the whole point of having one: it
 * survives a new wallet, it is readable down a telephone, and it is what is printed on a card. A
 * business that has no name yet still has a page, addressed by the wallet that sells from it, so
 * the link exists from the first day rather than only after a name is registered. No name and no
 * wallet is no link at all — never a half-built one ending in "undefined".
 */
export function shopUrl(base, { label = null, seller = null } = {}) {
  if (label) return new URL(shopPath(label), base).href;
  if (isAddress(seller)) return new URL(`pay/?business=${encodeURIComponent(seller)}`, base).href;
  return null;
}

/**
 * The one line an admin screen says on a network where a business cannot be set up. It is the
 * reason the chain itself gives, passed through, because a screen that paraphrases a reason is a
 * screen that can be wrong about it.
 */
export function noSignupLine(business) {
  if (!business || business.available !== false) return null;
  return business.reason ?? "Business sign-up is not available on this network in this release.";
}

/** A receipt's own address, which reloads to the same receipt because the state is all in the link. */
export function receiptHref(prefix, chainId, transactionHash) {
  const chain = Number(chainId);
  // A missing chain id must NOT become 0: `Number(null)` is 0 and 0 is finite, so a link built from
  // an unread network would look exactly like a link to chain zero and the receipt screen would
  // refuse it with a reason nobody could act on. No chain, no link.
  if (!transactionHash || !Number.isInteger(chain) || chain <= 0) return null;
  return `${prefix}receipt/?chain=${chain}&tx=${transactionHash}`;
}

// ---- colour: one integration's mark, and only where that integration is the thing on screen -------

/**
 * The page grounds, copied from the two `--paper` values in assets/unica.css. A copy is a drift
 * risk, so apps/web/tests/admin.test.mjs reads both tokens out of the stylesheet and fails if they
 * have moved without this pair moving with them.
 */
export const MARK_GROUND = Object.freeze({ light: "#fbfbfa", dark: "#101215" });

/** A mark is a border and a dot, not text, so the floor is the 3:1 one for a non-text boundary. */
export const MARK_FLOOR = 3;

/**
 * An integration's colour for one scheme.
 *
 * The brand hex is used verbatim wherever it can actually be seen against the page. Two of the five
 * cannot: measured against the light ground, ENS blue reaches 2.78:1 and Robinhood green 2.19:1, so
 * a 3px rule in either is a rule nobody sees. The HUE and the SATURATION are kept and only the
 * LIGHTNESS is moved, one step at a time, until the mark clears the floor — the same discipline
 * `--on-accent` and the business accent already follow: the value is computed, not picked.
 */
export function integrationMark(key, scheme = "light") {
  const integration = INTEGRATIONS[key];
  if (!integration) return null;
  const ground = MARK_GROUND[scheme === "dark" ? "dark" : "light"];
  return { key, name: integration.name, brand: integration.colour, colour: settleMark(integration.colour, ground) };
}

function settleMark(colour, ground) {
  if (contrastRatio(colour, ground) >= MARK_FLOOR) return colour;
  const [hue, saturation, start] = rgbToHsl(hexToRgb(colour));
  const lighten = luminance(ground) < 0.5;
  let l = start;
  for (let i = 0; i < 100; i += 1) {
    l += lighten ? 0.01 : -0.01;
    if (l <= 0 || l >= 1) break;
    const candidate = hslToHex([hue, saturation, l]);
    if (contrastRatio(candidate, ground) >= MARK_FLOOR) return candidate;
  }
  return textOn(ground); // a hue that cannot be seen at all gives way to one that can
}

/**
 * Whether the orders list may show The Graph's mark.
 *
 * The colour rule allows ONE integration in a view. A converted payment earns Uniswap's mark on its
 * own row, and that decides the view. The Graph's mark is therefore shown only when the companion
 * actually names an index AND no row in the list converted anything — so the screen can never carry
 * two integration colours at once, and can never claim a receipt is indexed on a setup that names
 * no index.
 */
export function graphMarkAllowed(config, rows = []) {
  if (!config?.graph?.url) return false;
  return !rows.some((r) => r.converted);
}

// ---- reading the companion ------------------------------------------------------------------------

/** Every payment one wallet has received, or null when the read failed. Never a partial guess. */
export async function fetchPayments(wallet, fetchImpl = globalThis.fetch) {
  if (!isAddress(wallet)) return null;
  try {
    const res = await fetchImpl(`/local/payments?wallet=${encodeURIComponent(wallet)}`);
    const body = await res.json();
    if (!res.ok || !Array.isArray(body?.payments)) return null;
    return body;
  } catch {
    return null;
  }
}

/** One seller's catalogue, or one product. `null` when the read failed; `[]` is a real empty list. */
export async function fetchCatalog(params, fetchImpl = globalThis.fetch) {
  const query = new URLSearchParams(params).toString();
  try {
    const res = await fetchImpl(`/local/catalog?${query}`);
    const body = await res.json();
    if (!res.ok && res.status !== 404) return null;
    return body ?? null;
  } catch {
    return null;
  }
}

// ---- the frame every admin screen opens with --------------------------------------------------------

/** A read-only view of the chain: the two reads the helpers need, and no way at all to send. */
export function readOnlySession(config, fetchImpl = globalThis.fetch) {
  const rpc = config?.rpc;
  return {
    address: null,
    chainId: Number(config?.chainId),
    call: (tx) => rpcRequest(rpc, "eth_call", [tx, "latest"], fetchImpl),
    request: (method, params = []) => rpcRequest(rpc, method, params, fetchImpl),
  };
}

/**
 * Which scheme the colours here are computed for.
 *
 * A PICK OUTRANKS A PREFERENCE, exactly as the stylesheet has it. `assets/app.js` stamps
 * `data-theme` on the document when a person chooses light or dark, and the stylesheet's
 * `:root[data-theme="…"]` blocks beat its media query. Anything computed in script has to obey the
 * same order, or a business accent settled against the dark ground gets painted on a light page
 * the reader deliberately asked for.
 */
export function currentScheme(win = globalThis, root = globalThis.document?.documentElement ?? null) {
  const picked = root?.getAttribute?.("data-theme");
  if (picked === "light" || picked === "dark") return picked;
  try {
    return win.matchMedia && win.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** The business's own colour on the app frame, repainted when the reader's scheme changes. */
function paintBusinessAccent(node) {
  const root = document.querySelector(".appframe") ?? document.body;
  if (!root) return;
  const paint = () => {
    root.setAttribute("style", businessStyle(businessAccent(node, currentScheme())));
    for (const mark of document.querySelectorAll(".adm-mark[data-integration]")) {
      const settled = integrationMark(mark.dataset.integration, currentScheme());
      if (settled) mark.style.setProperty("--int", settled.colour);
    }
  };
  paint();
  // Two ways the scheme can move: the machine's preference changes, or the person picks one in the
  // header. Both repaint, because a colour computed against the wrong ground is the one kind of
  // colour fault a reader cannot work around.
  try {
    globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", paint);
    new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  } catch {
    // a browser that can report neither keeps the colour it was painted with
  }
}

function gate(sentence) {
  const line = document.getElementById("gate-line");
  const block = document.getElementById("admin-gate");
  const body = document.getElementById("admin-body");
  if (line) line.textContent = sentence;
  if (block) block.hidden = false;
  if (body) body.hidden = true;
}

/**
 * Everything an admin screen needs before it may show anything, or null when it may show nothing.
 * The one login control is the wallet chip in the header; this never builds a second one.
 */
export async function openAdmin(prefix) {
  const config = await loadConfig();
  if (!config) {
    gate("This site is showing the product, not a business. There is nothing to sign in to here.");
    return null;
  }
  const environment = validateEnvironment(config.manifest ?? config);
  const banner = document.getElementById("env-banner");
  if (banner && environment.banner) banner.textContent = `${environment.banner} · ${environment.networkName}`;

  const known = await silentReconnect(config).catch(() => null);
  if (!known?.session) {
    gate("Sign in with the wallet control at the top of this page.");
    return null;
  }
  const business = await readBusiness(known.session, config).catch(() => null);
  if (!business) {
    gate("You are signed in. Your business could not be read just now — reload to try again.");
    return null;
  }
  if (business.available && !business.joined) {
    location.assign(`${prefix}join/`);
    return null;
  }
  paintBusinessAccent(business.merchantNode ?? null);
  const body = document.getElementById("admin-body");
  if (body) body.hidden = false;
  const block = document.getElementById("admin-gate");
  if (block) block.hidden = true;
  return { config, session: known.session, business, wallet: payoutWalletFor(business, known.session) };
}

/** Which wallet the money arrives at: the business's payout wallet, or this wallet on its own. */
export function payoutWalletFor(business, session) {
  if (business?.joined && isAddress(business.payout)) return business.payout;
  return session?.address ?? null;
}

/** An integration's mark as an element. The word carries the meaning; the colour only agrees. */
export function markElement(key) {
  const mark = integrationMark(key, currentScheme());
  if (!mark) return null;
  const el = document.createElement("span");
  el.className = "adm-mark";
  el.dataset.integration = key; // so a change of scheme can re-settle its colour without a reload
  el.style.setProperty("--int", mark.colour);
  el.textContent = mark.name;
  return el;
}

/** The two ways to pass a link on, beside the link itself, which stays selectable either way. */
export function wireShare(root, link, saidId) {
  const copy = root.querySelector("[data-copy]");
  const share = root.querySelector("[data-share]");
  if (copy) {
    copy.addEventListener("click", () => {
      navigator.clipboard?.writeText(link).then(
        () => say(saidId, "Link copied."),
        () => say(saidId, "Could not copy. Select the link and copy it by hand."),
      ) ?? say(saidId, "Select the link and copy it by hand.");
    });
  }
  if (share) {
    if (typeof navigator !== "undefined" && navigator.share) {
      share.addEventListener("click", () => navigator.share({ url: link }).catch(() => say(saidId, "Sharing was cancelled.")));
    } else {
      share.remove();
    }
  }
}

/** The code for a link, drawn beside it. A code that cannot be drawn says so and the link stays. */
export async function drawQr(target, link, { loader = null } = {}) {
  if (!target) return false;
  try {
    const { loadQr, qrSvg } = await import("./qr.js");
    const qr = await (loader ? loader() : loadQr());
    target.innerHTML = qrSvg(qr, link).svg;
    return true;
  } catch {
    target.remove();
    return false;
  }
}

// ---- DOM wiring; never runs under `node --test`, where there is no document -----------------------

if (typeof document !== "undefined" && (document.getElementById("business-summary") || document.getElementById("payment-list") || document.getElementById("order-detail"))) {
  main().catch((e) => say("business-status", `This page could not finish loading: ${e.message}`));
}

async function main() {
  const prefix = document.getElementById("business-summary") ? "../" : "../../";
  const open = await openAdmin(prefix);
  if (!open) return;
  const { config, session, business, wallet } = open;

  if (document.getElementById("business-summary")) await overview(config, session, business, wallet, prefix);
  if (document.getElementById("payment-list")) await orders(config, business, wallet);
  if (document.getElementById("order-detail")) await orderDetail(config, wallet);
}

// ---- the overview ------------------------------------------------------------------------------------

async function overview(config, session, business, wallet, prefix) {
  const payout = assetMenu(config).find((a) => a.role === "payout") ?? null;
  say("payout-asset", payout?.symbol ?? "Not known yet");
  say("business-title", business.joined ? businessDisplayName(String(business.label ?? "")) : "This wallet");
  say("set-payout", wallet ? shortId(wallet) : "Not known yet");

  if (business.joined && business.name) {
    say("business-payname", `Customers pay ${business.name}`);
    say("set-payname", business.name);
    const mark = markElement("ens");
    const slot = document.getElementById("payname-mark");
    if (mark && slot) slot.replaceChildren(mark);
  } else if (business.available === false) {
    say("business-payname", business.reason ?? "This network cannot set up a business in this release.");
    say("set-payname", "None on this network");
  } else {
    say("business-payname", "This business has no pay name yet.");
    say("set-payname", "Not set");
  }

  const accent = businessAccent(business.merchantNode ?? null, currentScheme());
  say("set-accent", accent ? `Hue ${accent.hue}` : "None yet");

  await renderShopShare(business, session, prefix);
  await renderKpis(config, wallet, payout);
  await renderHoldings(config, readOnlySession(config), wallet);
  wireLookup(config, wallet);
  wireLogout();
  const registers = await renderRegisters(config, business);
  wireRevoke(config, session, registers);
  fillAdvanced(config, {});
}

/** The business's own page, its code, and the two ways to hand either on. */
async function renderShopShare(business, session, prefix) {
  const box = document.getElementById("shop-link");
  const wrapper = document.getElementById("shop-share");
  if (!box || !wrapper) return;
  const link = shopUrl(new URL(prefix, location.href).href, { label: business?.label ?? null, seller: session?.address ?? null });
  if (!link) {
    say("shop-said", "Your shop gets its link once this screen has read your business.");
    wrapper.hidden = true;
    return;
  }
  box.textContent = link;
  say("shop-said", business?.label ? "Anyone with this link sees everything you have for sale." : "Your shop is addressed by your wallet until you have a pay name.");
  wireShare(wrapper, link, "shop-said");
  await drawQr(document.getElementById("shop-qr"), link);
}

async function renderKpis(config, wallet, payout) {
  if (!wallet) {
    say("business-status", "No wallet to read payments for.");
    return;
  }
  const answered = await fetchPayments(wallet);
  if (!answered) {
    say("business-status", "Payments could not be read just now, so today's figures are not shown.");
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const k = kpiFromPayments(answered.payments, now, payout?.address ?? null);
  say("today-count", String(k.verifiedToday));
  say("today-total", k.totalToday === null ? "Not known yet" : formatAmountFor(k.totalToday, payout?.address ?? null, config));
  say("last-payment", k.last ? `${whenText(k.last.settledAt, now)} · ${decisionPill(k.last.decision, k.last.reasonCodes).label}` : "None yet");
  const extra = k.otherAssetsToday ? ` ${k.otherAssetsToday} more today arrived in another asset and are not added in.` : "";
  const waiting = k.unresolvedToday ? ` ${k.unresolvedToday} today ${k.unresolvedToday === 1 ? "is" : "are"} not checked yet and ${k.unresolvedToday === 1 ? "is" : "are"} not counted.` : "";
  say("business-status", `${answered.payments.length} payment${answered.payments.length === 1 ? "" : "s"} read for ${shortId(wallet)}.${extra}${waiting}`);
}

// What the wallet holds: one read per asset this deployment knows. A read that fails leaves that
// asset "not read yet" rather than showing zero, and nothing here sends anything.
let holdingsRun = 0;
async function renderHoldings(config, session, owner) {
  const list = document.getElementById("holdings-list");
  if (!list) return;
  const run = ++holdingsRun; // a slower earlier read must never overwrite a newer one
  const stale = () => run !== holdingsRun;
  const holdings = Array.isArray(config.holdings) ? config.holdings : [];
  if (!owner) {
    say("holdings-said", "No wallet to read. Look one up below.");
    return;
  }
  say("holdings-said", `Reading ${holdings.length} asset${holdings.length === 1 ? "" : "s"} for ${shortId(owner)}…`);
  const balances = {};
  for (const asset of holdings) {
    try {
      const answer = await session.call({ to: asset.address, data: encodeCall("balanceOf(address)", [owner]) });
      balances[String(asset.address).toLowerCase()] = BigInt(answer).toString();
    } catch {
      // left unread: the row says "Not read yet" instead of a guessed zero
    }
    if (stale()) return;
  }
  if (stale()) return;
  const rows = holdingsRows(config, balances);
  list.replaceChildren();
  for (const r of rows) {
    const li = document.createElement("li");
    const sym = document.createElement("span");
    sym.className = "sym";
    sym.textContent = r.symbol ?? "Unnamed asset";
    const amount = document.createElement("span");
    amount.className = "availability";
    // The stylesheet's own vocabulary: an amount nobody could read is the dotted, muted state, and
    // a read amount carries no state at all — it is a number, not a verdict.
    if (r.amount === null) amount.dataset.status = "UNAVAILABLE";
    amount.textContent = r.text;
    li.append(sym, amount);
    list.appendChild(li);
  }
  const read = rows.filter((r) => r.amount !== null).length;
  say("holdings-said", `${read} of ${rows.length} read for ${shortId(owner)}.`);
}

function wireLookup(config, mine) {
  const button = document.getElementById("holdings-read");
  const box = document.getElementById("holdings-address");
  const connect = document.getElementById("holdings-connect");
  if (button && box) {
    const go = async () => {
      const typed = String(box.value ?? "").trim();
      if (!isAddress(typed)) {
        say("holdings-address-error", "A wallet address is 0x followed by forty letters or digits.");
        return;
      }
      say("holdings-address-error", "");
      button.disabled = true;
      try {
        await renderHoldings(config, readOnlySession(config), typed);
      } finally {
        button.disabled = false;
      }
    };
    button.addEventListener("click", go);
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        go();
      }
    });
  }
  // "Read my wallet" goes back to the wallet this screen is ALREADY signed in as. It deliberately
  // asks nothing: a second approval prompt on a page whose whole subject is the signed-in wallet is
  // a second sign-in, and this product has exactly one — the control in the header.
  if (connect) {
    connect.addEventListener("click", async () => {
      if (!isAddress(mine)) {
        say("holdings-said", "This screen has not read your wallet yet.");
        return;
      }
      connect.disabled = true;
      try {
        if (box) box.value = mine;
        await renderHoldings(config, readOnlySession(config), mine);
      } catch (e) {
        say("holdings-said", `Could not read that wallet: ${e.message}`);
      } finally {
        connect.disabled = false;
      }
    });
  }
}

function wireLogout() {
  const out = document.getElementById("admin-logout");
  if (!out) return;
  out.addEventListener("click", async () => {
    const { forgetWallet } = await import("./session.js");
    forgetWallet();
    location.reload();
  });
}

async function renderRegisters(config, business) {
  const list = document.getElementById("register-list");
  const terminalsNode = business?.terminalsNode ?? config.manifest?.identity?.terminalsNode ?? null;
  const identity = config.identity ?? null;
  const statusKey = config.terminalStatusKey ?? "com.unica.terminal-status";
  if (!list) return [];
  if (!identity || !terminalsNode) {
    say("registers-said", "This setup does not say where registers live, so none can be read.");
    say("active-register", "Not known yet");
    return [];
  }
  say("registers-said", "Reading your registers…");
  try {
    const registers = await listRegisters(readOnlySession(config), identity, terminalsNode, statusKey);
    list.replaceChildren();
    for (const r of registers) {
      const li = document.createElement("li");
      const name = document.createElement("strong");
      name.textContent = registerDisplayName(r.label);
      li.append(name, document.createTextNode(`: ${registerStatusText(r.status)}`));
      list.appendChild(li);
    }
    const active = registers.find((r) => String(r.status).toLowerCase() === "active") ?? null;
    say("active-register", active ? registerDisplayName(active.label) : "None active");
    say("registers-said", registers.length === 0 ? "No registers were found for this business." : `${registers.length} register${registers.length === 1 ? "" : "s"} read.`);
    return registers;
  } catch (e) {
    say("registers-said", `The registers could not be read: ${e.message}`);
    return [];
  }
}

function wireRevoke(config, session, registers) {
  const button = document.getElementById("revoke-register");
  if (!button) return;
  const active = registers.filter((r) => String(r.status).toLowerCase() === "active");
  if (active.length === 0) {
    say("revoke-register-why", "No active register was read, so there is nothing to switch off.");
    return;
  }
  const target = active[0];
  button.disabled = false;
  say("revoke-register-why", `Switches "${registerDisplayName(target.label)}" off. Sales it already started are unaffected. Your wallet will ask you to confirm each step.`);
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      // The session this screen was opened with, not a fresh approval: the wallet already signed in
      // is the wallet that owns this register, and asking again would be a second sign-in.
      await revokeRegisterOnChain({
        session,
        identity: config.identity,
        statusKey: config.terminalStatusKey ?? "com.unica.terminal-status",
        register: target,
        onStep: (_n, _total, sentence) => say("registers-said", sentence),
      });
      say("registers-said", `"${registerDisplayName(target.label)}" is switched off. Reload to see the current list.`);
    } catch (e) {
      say("registers-said", `Could not switch that register off: ${e.message} Steps that already confirmed still stand.`);
    } finally {
      button.disabled = false;
    }
  });
}

// ---- the orders list -----------------------------------------------------------------------------

async function orders(config, business, wallet) {
  const body = document.getElementById("payment-list");
  if (!body) return;
  // On a network with no business sign-up the list is this WALLET's payments, and the screen says
  // why in the same sentence that says how many — appended, never as a line that a later read
  // silently overwrites.
  const reason = noSignupLine(business);
  const withReason = (sentence) => (reason ? `${sentence} ${reason}` : sentence);
  if (!wallet) {
    say("orders", withReason("No wallet to read payments for."));
    return;
  }
  const answered = await fetchPayments(wallet);
  if (!answered) {
    say("orders", withReason("Payments could not be read just now. Nothing is shown rather than a partial list."));
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const names = await productNames(answered.payments, business);
  const rows = orderRows(answered.payments, { names, nowSeconds: now });
  const chainId = answered.chainId ?? config.chainId ?? null;
  body.replaceChildren();
  for (const row of rows) {
    body.appendChild(orderRowElement(row, config, chainId));
  }
  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "sub";
    td.colSpan = 6;
    td.textContent = "No payments yet.";
    tr.appendChild(td);
    body.appendChild(tr);
  }
  const graph = document.getElementById("orders-mark");
  if (graph && graphMarkAllowed(config, rows)) {
    const mark = markElement("graph");
    if (mark) graph.replaceChildren(mark);
  }
  say("orders", withReason(`${rows.length} payment${rows.length === 1 ? "" : "s"} read for ${shortId(wallet)}.`));
}

function orderRowElement(row, config, chainId) {
  const tr = document.createElement("tr");
  const cell = (text, className) => {
    const td = document.createElement("td");
    if (className) td.className = className;
    if (text !== null && text !== undefined) td.textContent = text;
    return td;
  };
  tr.append(cell(row.when));
  const what = cell(row.what);
  if (row.converted) {
    const mark = markElement("uniswap");
    if (mark) what.append(" ", mark);
  }
  tr.append(what);
  tr.append(cell(formatAmountFor(row.amount, row.asset, config), "adm-num"));
  tr.append(cell(row.from, "adm-who"));

  const state = document.createElement("td");
  const pill = document.createElement("span");
  pill.className = "pill";
  pill.dataset.status = row.status;
  pill.textContent = row.label;
  state.appendChild(pill);
  tr.append(state);

  const receipt = document.createElement("td");
  const href = receiptHref("../../", chainId, row.transactionHash);
  if (href) {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = "Receipt";
    receipt.appendChild(a);
  } else {
    receipt.className = "sub";
    receipt.textContent = "—";
  }
  tr.append(receipt);
  return tr;
}

/** The seller's own names for the products in this list, read once from the catalogue. */
async function productNames(payments, business) {
  const ids = [...new Set((payments ?? []).filter((p) => p.kind === "product" && p.productId).map((p) => String(p.productId)))];
  if (ids.length === 0) return {};
  const names = {};
  for (const id of ids) {
    const answered = await fetchCatalog({ product: id });
    if (answered?.product?.name) names[id] = answered.product.name;
  }
  return names;
}

// ---- one order ----------------------------------------------------------------------------------

async function orderDetail(config, wallet) {
  const asked = new URLSearchParams(location.search).get("order");
  if (!asked) {
    say("order-detail", "No payment in this link. Open one from your orders.");
    return;
  }
  const answered = await fetchPayments(wallet);
  if (!answered) {
    say("order-detail", "This payment could not be read just now.");
    return;
  }
  const hit = answered.payments.find((p) => String(p.orderId).toLowerCase() === asked.toLowerCase()) ?? null;
  if (!hit) {
    say("order-detail", "No payment of yours has that number. It may belong to another business or another network.");
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const verdict = decisionPill(hit.decision, hit.reasonCodes);
  say("order-detail", `${formatAmountFor(hit.amount, hit.asset, config)} from ${shortId(hit.payer)}, ${whenText(hit.settledAt, now).toLowerCase()}. ${verdict.label}.`);
  fillAdvanced(config, { order: hit.orderId, tx: hit.transactionHash, reasons: hit.reasonCodes ?? null });
  const link = document.getElementById("order-receipt");
  const href = receiptHref("../../../", answered.chainId ?? config.chainId, hit.transactionHash);
  if (link && href) {
    link.href = href;
    link.hidden = false;
  }
}
