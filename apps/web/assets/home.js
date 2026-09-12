/**
 * The landing page's four controls. Everything it does is an enhancement of markup that is already
 * correct without it: the three links work with script switched off, and the one button is served
 * DISABLED with a reason beside it, so a visitor never presses something that cannot answer.
 *
 * IT DOES NOT KNOW HOW TO LOG IN, AND THAT IS THE POINT. The header chip owns signing in — the
 * wallet prompt, the testnet account chooser, the read of whether this wallet already has a
 * business, and the routing that follows from it. The hero's button finds that control and presses
 * it. A second copy of the login here would be a second answer to "who is signed in", and the copy
 * is always the one that goes stale.
 *
 * THE SWAP LINK IS ONLY AS SPECIFIC AS THE PAGE CAN HONESTLY BE. With no companion answering, the
 * page has no chain and no assets to name, so the link stays the bare swap page rather than
 * guessing a pair. With a configuration in hand it names the chain the deployment reports, the
 * asset a customer holds, and the asset the business receives — read from the configuration, never
 * written down here.
 */
import { loadConfig } from "./local.js";
import { readBusiness, silentReconnect, whereTo } from "./session.js";

export const SWAP_URL = "https://app.uniswap.org/swap";

/** The chip's login button, once assets/app.js has rendered it. Null if it never appears. */
export function awaitChipLogin(timeout = 8000, { doc = globalThis.document } = {}) {
  const found = doc?.getElementById("wallet-login");
  if (found) return Promise.resolve(found);
  if (!doc || typeof MutationObserver !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = (value) => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    };
    const observer = new MutationObserver(() => {
      const el = doc.getElementById("wallet-login");
      if (el) done(el);
    });
    const timer = setTimeout(() => done(null), timeout);
    observer.observe(doc.documentElement, { childList: true, subtree: true });
  });
}

/**
 * The swap destination. `chain`, `inputCurrency` and `outputCurrency` are the parameters the swap
 * page reads; the values are the deployment's own chain id, the asset a customer spends, and the
 * asset the business is paid in. A configuration missing either side yields the bare URL rather
 * than half a pair, because a link that pre-selects the wrong token is worse than one that
 * pre-selects nothing.
 */
export function swapHref(config) {
  if (!config) return SWAP_URL;
  const assets = Array.isArray(config.assets) ? config.assets : [];
  const payout = assets.find((a) => a?.role === "payout")?.address;
  const spend = assets.find((a) => a?.role === "customer")?.address;
  const chainId = Number(config.chainId);
  if (!payout || !spend || !Number.isFinite(chainId)) return SWAP_URL;
  const q = new URLSearchParams({ chain: String(chainId), inputCurrency: spend, outputCurrency: payout });
  return `${SWAP_URL}?${q.toString()}`;
}

/** Where a signed-in owner belongs, from the chain's answer. Null when this network has no sign-up. */
export function destinationFor(business) {
  const where = whereTo(business);
  if (where === "business") return "business/";
  if (where === "join") return "join/";
  return null;
}

export async function driveHero(
  root,
  {
    load = loadConfig,
    reconnect = silentReconnect,
    business = readBusiness,
    chipLogin = awaitChipLogin,
    go = (href) => location.assign(href),
  } = {},
) {
  const button = root.getElementById("hero-login");
  const swap = root.getElementById("hero-swap");
  if (!button && !swap) return null;

  const config = await load().catch(() => null);
  if (swap) swap.href = swapHref(config);
  if (!button) return config;

  // No companion means nothing to sign in to. The button stays disabled and its reason stays true;
  // the header chip is the one place that explains the situation, and it already does.
  if (!config) return config;

  const known = await reconnect(config).catch(() => null);
  if (known?.session) {
    const answer = await business(known.session, config).catch(() => null);
    const href = destinationFor(answer);
    if (href) {
      button.textContent = whereTo(answer) === "join" ? "Add your business" : "Open my business";
      button.disabled = false;
      button.addEventListener("click", () => go(href));
      return config;
    }
    return config;
  }

  button.disabled = false;
  button.addEventListener("click", async () => {
    const chip = await chipLogin();
    if (!chip) return;
    chip.scrollIntoView({ block: "nearest" });
    chip.click();
  });
  return config;
}

if (typeof document !== "undefined" && document.getElementById("hero-login")) {
  driveHero(document).catch(() => {
    /* the served page is already correct: the button stays disabled and says why */
  });
}
