/**
 * A quote: what the pool would pay out right now for an order's fixed input.
 *
 * A quote is an OBSERVATION, never a commitment. The order's `minOut` is the commitment, it is
 * fixed on chain at creation, and the settlement reverts below it. So a stale quote can only
 * mislead a person, never a payment — which is exactly why it carries the block it was read at
 * and an explicit freshness test rather than being cached silently.
 */

export interface Quote {
  /** The order's fixed native input, in wei. */
  readonly amountIn: bigint;
  /** What the pool would credit, in the payout token's smallest unit. */
  readonly amountOut: bigint;
  readonly payoutDecimals: number;
  /** The block this was read at. A quote with no provenance is a rumour. */
  readonly atBlock: bigint;
  /** Unix seconds when the read happened, for the human-facing "as of" line. */
  readonly readAtSeconds: bigint;
}

/** Quotes older than this are shown as stale rather than silently refreshed under the reader. */
export const QUOTE_STALE_AFTER_SECONDS = 30n;

export function quoteIsFresh(
  quote: Pick<Quote, "readAtSeconds">,
  nowSeconds: bigint,
  staleAfter: bigint = QUOTE_STALE_AFTER_SECONDS,
): boolean {
  return nowSeconds - quote.readAtSeconds < staleAfter;
}

/**
 * Whether this quote clears the order's floor. `false` does NOT mean the payment will fail — the
 * pool may move before the transaction lands — it means a payer should be warned before signing.
 */
export function quoteClearsMinimum(quote: Pick<Quote, "amountOut">, minOut: bigint): boolean {
  return quote.amountOut >= minOut;
}

/**
 * How far above the floor the quote sits, in basis points of the floor. Returns `null` when the
 * floor is zero, because a headroom ratio against zero is not a number anyone should render.
 */
export function headroomBasisPoints(quote: Pick<Quote, "amountOut">, minOut: bigint): bigint | null {
  if (minOut <= 0n) return null;
  return ((quote.amountOut - minOut) * 10_000n) / minOut;
}
