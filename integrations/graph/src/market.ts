import { SettlementReceipt } from "../generated/UnicaMarketHook/UnicaMarketHook";
import { Settlement } from "../generated/schema";

// The market path: a swap through the Uniswap v4 hook whose output was delivered to the merchant.
// One receipt, one immutable row, every field copied from the log or from the block it sat in. The
// merchant's side of the trade is what a receipt is about, so `asset`/`amount` are the OUT leg;
// `currencyIn`/`amountIn` keep the payer's side, and are null on the other path, which has no swap.
export function handleSettlementReceipt(event: SettlementReceipt): void {
  const s = new Settlement(event.transaction.hash.concatI32(event.logIndex.toI32()));
  s.orderId = event.params.orderId;
  s.recipient = event.params.recipient;
  s.payer = event.params.payer;
  s.asset = event.params.currencyOut;
  s.amount = event.params.amountOut;
  s.kind = "market";
  // The hook's receipt carries no time of its own, so the block's is the settlement time.
  s.settledAt = event.block.timestamp;
  s.transactionHash = event.transaction.hash;
  s.blockNumber = event.block.number;
  s.marketId = event.params.marketId;
  s.amountIn = event.params.amountIn;
  s.currencyIn = event.params.currencyIn;
  s.demonstrationOnly = event.params.demonstrationOnly;
  s.save();
}
