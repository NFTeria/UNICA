import { DirectReceipt } from "../generated/DirectSettlement/DirectSettlement";
import { Settlement } from "../generated/schema";

// The direct path: one asset in, the same asset out, no pool and no price. It lands in the same
// entity as a market settlement so the receipt page reads one shape, and it is told apart by
// `kind`, which this handler writes because of WHICH data source's log this is — never from
// anything inside the log.
//
// `settledAt` is the receipt's own, not the block's: this event carries the time the settler
// recorded, and a row that has the emitted time should not quietly show a different one.
export function handleDirectReceipt(event: DirectReceipt): void {
  const s = new Settlement(event.transaction.hash.concatI32(event.logIndex.toI32()));
  s.orderId = event.params.orderId;
  s.recipient = event.params.recipient;
  s.payer = event.params.payer;
  s.asset = event.params.asset;
  s.amount = event.params.amount;
  s.kind = "direct";
  s.settledAt = event.params.settledAt;
  s.transactionHash = event.transaction.hash;
  s.blockNumber = event.block.number;
  // marketId, amountIn, currencyIn and demonstrationOnly stay null: a direct settlement has no
  // market, no second currency and no oracle to be bound to, and a zero here would read as one.
  s.save();
}
