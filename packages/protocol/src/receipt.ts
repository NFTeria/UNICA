/**
 * The settlement receipt — the hook's own record, emitted from inside the swap.
 *
 * Two records exist for one payment and they are not the same thing. The HOOK emits this receipt
 * from inside the PoolManager's unlock, where the pool's own balance delta is authoritative. The
 * EXECUTOR emits `Settled` afterwards, measured at the recipient's actual token balance. The
 * executor refuses to finish unless both agree, so an interface should show the receipt and be
 * able to say which one it came from.
 */

import type { RoutedChainId } from "./chain.js";
import type { OrderId } from "./order.js";

export interface SettlementReceipt {
  readonly orderId: OrderId;
  readonly chainId: RoutedChainId;
  readonly recipient: string;
  readonly payer: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  /** The hook takes nothing. This is zero in every receipt so far, and a view should say so. */
  readonly fee: bigint;
  /**
   * Reserved, always zero. The attachment point for a future policy attestation; it exists so
   * adding one later is not an ABI change. Do not render it as a value — render its absence.
   */
  readonly policyId: string;
  readonly transactionHash: string;
  readonly blockNumber: bigint;
  readonly logIndex: number;
}

export const ZERO_POLICY_ID = "0x" + "0".repeat(64);

export function receiptHasPolicy(receipt: Pick<SettlementReceipt, "policyId">): boolean {
  return receipt.policyId.toLowerCase() !== ZERO_POLICY_ID;
}

/** Whether UNICA took anything. It never has; this is the check, not the assumption. */
export function receiptTookFee(receipt: Pick<SettlementReceipt, "fee">): boolean {
  return receipt.fee > 0n;
}

/**
 * A stable identity for one receipt, independent of the indexer that produced it. Transaction
 * hash plus log index is unique on a chain, which lets a subgraph row and a directly-read log be
 * recognised as the same event instead of rendered twice.
 */
export function receiptKey(receipt: Pick<SettlementReceipt, "transactionHash" | "logIndex">): string {
  return `${receipt.transactionHash.toLowerCase()}#${receipt.logIndex}`;
}
