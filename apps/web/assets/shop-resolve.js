/**
 * A shop is addressed by its pay name.
 *
 * Every business that owns a name under the parent gets a shop page for it, with nothing to set up:
 * the name is resolved on the chain to the business that registered it, and that business's list is
 * the shop. The chain is the only source: the label is asked of the onboarding contract for its node,
 * and the node is asked for the one BusinessJoined record that created it. Nothing here guesses, and
 * an address is accepted too, for a link that already knows who it is for.
 */
import { decodeBusinessJoinedLog, decodeBytes32, encodeCall, isZeroBytes32, topicOf, BUSINESS_JOINED_SIGNATURE } from "./abi.js";
import { isValidLabelLocal, payNameFor } from "./local-join.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The label a person typed or a link carried: "freshcuts", "freshcuts.unica.eth" or "FreshCuts" all mean freshcuts. */
export function shopLabel(input, parentName = null) {
  let s = String(input ?? "").trim().toLowerCase();
  if (!s) return null;
  const parent = parentName ? String(parentName).toLowerCase() : null;
  if (parent && s.endsWith("." + parent)) s = s.slice(0, -(parent.length + 1));
  if (s.includes(".")) return null; // a deeper or foreign name is not a shop under this parent
  return isValidLabelLocal(s) ? s : null;
}

/**
 * The business behind a shop link. Returns
 *   { by: "address", seller }                                          when the link carried an address
 *   { by: "name", seller, payout, label, name, merchantNode, badgeTokenId }  when a name resolved
 *   null                                                               when nothing on the chain answers to it
 */
export async function resolveShop(session, config, nameOrAddress, fetchImpl = globalThis.fetch) {
  const raw = String(nameOrAddress ?? "").trim();
  if (ADDRESS.test(raw)) return { by: "address", seller: raw };
  const onboarding = config?.merchantOnboarding ?? null;
  const label = shopLabel(raw, config?.parentName ?? null);
  if (!label) return null;
  if (!onboarding) {
    // No sign-up contract here: the companion answers from the name authority's lineage and records.
    if (!config?.identity) return null;
    try {
      const res = await fetchImpl(`/local/businesses?label=${encodeURIComponent(label)}`);
      const body = res && res.ok ? await res.json() : null;
      const hit = Array.isArray(body?.businesses) ? body.businesses[0] : null;
      if (!hit || !hit.seller) return null;
      return { by: "name", seller: hit.seller, payout: hit.payout ?? hit.seller, label, name: hit.name ?? payNameFor(label, config?.parentName ?? null), merchantNode: hit.merchantNode ?? null, badgeTokenId: null };
    } catch {
      return null;
    }
  }
  const node = decodeBytes32(await session.call({ to: onboarding, data: encodeCall("nodeOf(string)", [label]) }));
  if (!node || isZeroBytes32(node)) return null;
  const logs = await session.request("eth_getLogs", [{ fromBlock: "0x0", toBlock: "latest", address: onboarding, topics: [topicOf(BUSINESS_JOINED_SIGNATURE), node] }]);
  const joined = (logs ?? []).map(decodeBusinessJoinedLog).filter(Boolean);
  if (!joined.length) return null;
  const record = joined[joined.length - 1];
  return {
    by: "name",
    seller: record.owner,
    payout: record.payout,
    label,
    name: payNameFor(label, config?.parentName ?? null),
    merchantNode: node,
    badgeTokenId: record.badgeTokenId,
  };
}

/** The shop's own link, relative to the site root, for the dashboard, the join success screen and the QR. */
export function shopPath(label) {
  return `shop/?name=${encodeURIComponent(String(label ?? "").toLowerCase())}`;
}
