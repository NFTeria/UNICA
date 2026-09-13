/**
 * What one wallet has bought, read from the index. A customer has no record here and needs none:
 * their purchases are the ProductSale and Settlement rows the index holds for their address, each
 * pointing at the same receipt the business got. Pure helpers, so the shapes are tested without a
 * document; the one network call takes its fetch as an argument for the same reason.
 */

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The one query: catalogue sales the wallet bought, and settlements it paid, newest first. */
export function purchasesQuery(buyer) {
  if (!ADDRESS.test(String(buyer ?? ""))) return null;
  return {
    query:
      "query Purchases($who: Bytes!) { " +
      "productSales(where: { buyer: $who }, orderBy: settledAt, orderDirection: desc, first: 50) { id productId seller payout asset amount kind paidThrough settledAt transactionHash } " +
      "settlements(where: { payer: $who }, orderBy: settledAt, orderDirection: desc, first: 50) { id orderId recipient asset amount kind settledAt transactionHash } }",
    variables: { who: String(buyer).toLowerCase() },
  };
}

/** Rows out of the index's answer, newest first; null when the index did not answer the question at all. */
export function purchaseRows(body) {
  const data = body?.data ?? null;
  if (!data || !("productSales" in data) || !("settlements" in data)) return null;
  const sales = (Array.isArray(data.productSales) ? data.productSales : []).map((s) => ({
    kind: "product",
    id: String(s.id),
    productId: s.productId === null || s.productId === undefined ? null : String(s.productId),
    seller: s.payout ?? s.seller ?? null,
    asset: s.asset ?? null,
    amount: s.amount === null || s.amount === undefined ? null : String(s.amount),
    settledAt: Number(s.settledAt ?? 0),
    transactionHash: s.transactionHash ?? null,
  }));
  const payments = (Array.isArray(data.settlements) ? data.settlements : []).map((s) => ({
    kind: "payment",
    id: String(s.orderId ?? s.id),
    productId: null,
    seller: s.recipient ?? null,
    asset: s.asset ?? null,
    amount: s.amount === null || s.amount === undefined ? null : String(s.amount),
    settledAt: Number(s.settledAt ?? 0),
    transactionHash: s.transactionHash ?? null,
  }));
  return [...sales, ...payments].sort((a, b) => b.settledAt - a.settledAt);
}

/** The receipt this purchase is: the same link the checkout hands out, with the business on it. */
export function purchaseReceiptHref(prefix, chainId, row) {
  const q = new URLSearchParams({ chain: String(chainId) });
  if (row.kind === "product") q.set("sale", row.id);
  else q.set("order", row.id);
  if (row.transactionHash) q.set("tx", row.transactionHash);
  if (row.seller) q.set("business", row.seller);
  return `${prefix}receipt/?${q.toString()}`;
}

/** How a wallet is written when the chain has a verified name for it, and when it has not. */
export function customerLabel(name, short) {
  return name ? `${name} (${short})` : short;
}

/** Ask the index. Null when there is no index, it did not answer, or it answered something else. */
export async function readPurchases(indexUrl, buyer, fetchImpl = globalThis.fetch) {
  const q = purchasesQuery(buyer);
  if (!indexUrl || !q) return null;
  try {
    const res = await fetchImpl(indexUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(q) });
    if (!res.ok) return null;
    return purchaseRows(await res.json());
  } catch {
    return null;
  }
}
