/**
 * The one way every screen reaches the companion server, and the handful of DOM helpers they all
 * share.
 *
 * WHY ONE ABSOLUTE PATH AND NOT A RELATIVE ONE. The static site is deliberately built with
 * relative links so it works at a domain root, under a project path, or behind a content hash.
 * These endpoints are different: they exist only while script/anvil/serve.sh is running, and that
 * server publishes them at exactly /local/ regardless of which page asks. A relative specifier
 * would resolve differently from /pay/ than from /business/payments/new/, so a screen three levels
 * deep would quietly fetch nothing and show a page with no data and no error. One absolute path
 * fails the same way everywhere, which is the only kind of failure worth having.
 *
 * NOTHING HERE THROWS AT A PERSON. A missing companion server is an ordinary state — the static
 * page is still a correct description of the product — so `loadConfig` answers null and each
 * screen says what it cannot show, rather than blanking.
 */

export const CONFIG_URL = "/local/config.json";
export const EVIDENCE_URL = "/local/evidence";

/** The active deployment, or null when no companion server is answering. */
export async function loadConfig(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(CONFIG_URL);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * The payment-verification verdict for one order. Always resolves to an object with a `decision`,
 * so a caller never has to distinguish "the check said unknown" from "the check could not run" by
 * inspecting an exception.
 */
export async function loadEvidence(orderId, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`${EVIDENCE_URL}?order=${encodeURIComponent(orderId)}`);
    const body = await res.json();
    return body ?? { decision: "UNKNOWN", reasonCodes: ["EMPTY_ANSWER"], receipt: null };
  } catch (e) {
    return { decision: "UNKNOWN", reasonCodes: ["VERIFICATION_UNREACHABLE"], receipt: null, error: String(e?.message ?? e) };
  }
}

// ---- DOM helpers. Each is a no-op when the element is absent, so one screen's markup change ------
// ---- cannot take another screen down with a null dereference. ------------------------------------

export function say(id, text) {
  const el = typeof document === "undefined" ? null : document.getElementById(id);
  if (el) el.textContent = text;
}

export function show(id) {
  const el = typeof document === "undefined" ? null : document.getElementById(id);
  if (el) el.hidden = false;
}

export function hide(id) {
  const el = typeof document === "undefined" ? null : document.getElementById(id);
  if (el) el.hidden = true;
}

/** A short id a person can read aloud or paste into a support message. Never the whole value. */
export function shortId(value) {
  const s = String(value ?? "");
  if (s.length <= 14) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

/**
 * Fill the "Advanced verification" disclosure from whatever the active deployment and this payment
 * actually carry. A field that has no value is left as an em dash and never as "0x0" or "none",
 * because a zero-looking identifier reads as a real one to somebody checking a payment.
 */
export function fillAdvanced(config, { prefix = "adv", order = null, tx = null, reasons = null } = {}) {
  const manifest = config?.manifest ?? {};
  const market = manifest.market ?? {};
  const contracts = manifest.contracts ?? {};
  const identity = manifest.identity ?? {};
  const rows = {
    release: manifest.releaseId ?? null,
    market: market.marketId ?? null,
    hook: contracts.hook?.address ?? null,
    executor: contracts.executor?.address ?? null,
    pool: market.poolId ?? null,
    adapter: market.adapter ?? contracts.oracleAdapter?.address ?? null,
    feed: market.feedId ?? null,
    ens: identity.merchantName ?? identity.parentName ?? null,
    order,
    tx,
    reasons: Array.isArray(reasons) ? (reasons.length ? reasons.join(", ") : "none reported") : reasons,
  };
  for (const [key, value] of Object.entries(rows)) {
    if (value === null || value === undefined || value === "") continue;
    say(`${prefix}-${key}`, String(value));
  }
}
