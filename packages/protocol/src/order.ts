/**
 * The order — the only source of who is paid, by whom, how much, into which pool, and until when.
 *
 * This mirrors `UnicaExecutorV3.Order` field for field and `UnicaExecutorV3.Status` value for
 * value. The numbering is load-bearing: `Status` is read out of a chain word, so `Settled` MUST
 * be 3. A renumbering here silently mislabels every order in the interface.
 *
 * The safety property this file exists to make visible: `recipient` is resolved once, before the
 * order exists, and then stored on chain. Settlement reads only the stored value. A merchant name
 * that changes afterwards cannot redirect an order that already exists — it can only affect the
 * next one. Nothing in this module ever re-resolves a name.
 */

import type { RoutedChainId } from "./chain.js";

/** Matches `UnicaExecutorV3.Status`. The numbers are the contract's, not ours to choose. */
export const OrderStatus = {
  None: 0,
  Open: 1,
  Paying: 2,
  Settled: 3,
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const ORDER_STATUS_LABEL: { readonly [K in OrderStatus]: string } = {
  [OrderStatus.None]: "none",
  [OrderStatus.Open]: "open",
  [OrderStatus.Paying]: "paying",
  [OrderStatus.Settled]: "settled",
};

export function isOrderStatus(value: number): value is OrderStatus {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/** A 32-byte order id, `0x`-prefixed and lower-case. */
export type OrderId = string;

/** The pool an order settles through. Mirrors Uniswap's `PoolKey`. */
export interface PoolKey {
  readonly currency0: string;
  readonly currency1: string;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly hooks: string;
}

export interface Order {
  readonly id: OrderId;
  readonly chainId: RoutedChainId;
  /** Fixed at creation. Never re-resolved, never re-read from a name. */
  readonly recipient: string;
  readonly creator: string;
  /** Zero address until someone pays; any address may pay an open order. */
  readonly payer: string;
  readonly key: PoolKey;
  /** Exact native input the payer must send. Not a minimum and not a maximum. */
  readonly amountIn: bigint;
  /** The floor the recipient's balance must actually rise by, or the payment reverts. */
  readonly minOut: bigint;
  /** Unix seconds. */
  readonly deadline: bigint;
  readonly status: OrderStatus;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function orderHasPayer(order: Pick<Order, "payer">): boolean {
  return order.payer.toLowerCase() !== ZERO_ADDRESS;
}

export function orderIsExpired(order: Pick<Order, "deadline">, nowSeconds: bigint): boolean {
  return order.deadline <= nowSeconds;
}

/**
 * Why an order cannot be paid right now, or `null` if it can.
 *
 * Returns a reason rather than a boolean because every one of these needs a different sentence in
 * front of a payer, and collapsing them to `false` is how a checkout ends up saying "something
 * went wrong". The order of the checks is the order the contract applies them in.
 */
export type OrderBlocker = "unknown" | "already-paying" | "already-settled" | "expired";

export function orderBlocker(order: Order, nowSeconds: bigint): OrderBlocker | null {
  if (order.status === OrderStatus.None) return "unknown";
  if (order.status === OrderStatus.Settled) return "already-settled";
  if (order.status === OrderStatus.Paying) return "already-paying";
  if (orderIsExpired(order, nowSeconds)) return "expired";
  return null;
}

export function orderIsPayable(order: Order, nowSeconds: bigint): boolean {
  return orderBlocker(order, nowSeconds) === null;
}

/** Seconds until the deadline, floored at zero so a view never renders a negative countdown. */
export function secondsUntilDeadline(order: Pick<Order, "deadline">, nowSeconds: bigint): bigint {
  const remaining = order.deadline - nowSeconds;
  return remaining > 0n ? remaining : 0n;
}
