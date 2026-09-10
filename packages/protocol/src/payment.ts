/**
 * The payment phases, as one continuous sequence.
 *
 * A checkout that renders quote, confirmation, pending and receipt as four unrelated screens
 * loses the payer at every seam. These are phases of one thing, and every terminal phase carries
 * what the next view needs — which is why `settled` carries the receipt rather than expecting a
 * reload to go and find it.
 *
 * `submitted` is deliberately distinct from `pending`: a wallet that has accepted a transaction
 * but not yet returned a hash is a real state a payer sits in, and showing "pending" before a
 * hash exists means the interface cannot offer the one thing they want, which is the hash.
 */

import type { SettlementReceipt } from "./receipt.js";

export type PaymentPhase =
  /** No wallet, or the wrong chain. Nothing has been asked of the payer yet. */
  | { readonly kind: "idle" }
  /** A quote is on screen and the pay action is live. */
  | { readonly kind: "ready" }
  /** The wallet is open and the payer has not answered. Every action must be disabled here. */
  | { readonly kind: "awaiting-signature" }
  /** Signed, broadcast, no hash yet. */
  | { readonly kind: "submitted" }
  /** Hash known, not yet mined. */
  | { readonly kind: "pending"; readonly transactionHash: string }
  /** Mined with status 1, and the receipt was decoded from its own logs. */
  | { readonly kind: "settled"; readonly receipt: SettlementReceipt }
  /** Mined with status 0, or reverted before mining. */
  | { readonly kind: "reverted"; readonly transactionHash: string; readonly reason: string | null }
  /** The payer dismissed the wallet. Not an error — offer the action again, say nothing alarming. */
  | { readonly kind: "dismissed" }
  /** Something else failed. `message` is already payer-facing; never render a raw provider error. */
  | { readonly kind: "failed"; readonly message: string };

/** Phases in which a second wallet request must not be sent. */
export function paymentIsInFlight(phase: PaymentPhase): boolean {
  return phase.kind === "awaiting-signature" || phase.kind === "submitted" || phase.kind === "pending";
}

/** Phases from which the payer can try again. */
export function paymentCanRetry(phase: PaymentPhase): boolean {
  return phase.kind === "dismissed" || phase.kind === "failed" || phase.kind === "reverted";
}

export function paymentIsTerminal(phase: PaymentPhase): boolean {
  return phase.kind === "settled";
}
