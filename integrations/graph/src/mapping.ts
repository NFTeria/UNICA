import { dataSource } from "@graphprotocol/graph-ts";
import { SettlementReceipt as SettlementReceiptEvent } from "../generated/V4SettlementHook/V4SettlementHook";
import { Settlement } from "../generated/schema";

// One receipt, one immutable entity. The id is the transaction hash concatenated with the log
// index, unique on the network this subgraph indexes; the hook is whatever emitted the log.
export function handleSettlementReceipt(event: SettlementReceiptEvent): void {
  // A later schema version gets its own handler; version 1 fields are never reinterpreted.
  if (event.params.schemaVersion != 1) {
    return;
  }
  const id = event.transaction.hash.concatI32(event.logIndex.toI32());
  const s = new Settlement(id);
  s.network = dataSource.network();
  s.schemaVersion = event.params.schemaVersion;
  s.orderId = event.params.orderId;
  s.poolId = event.params.poolId;
  s.payer = event.params.payer;
  s.recipient = event.params.recipient;
  s.currencyIn = event.params.currencyIn;
  s.currencyOut = event.params.currencyOut;
  s.amountIn = event.params.amountIn;
  s.amountOut = event.params.amountOut;
  s.fee = event.params.fee;
  s.policyId = event.params.policyId;
  s.executor = event.params.executor;
  s.hook = event.address;
  s.blockNumber = event.block.number;
  s.blockTimestamp = event.block.timestamp;
  s.transactionHash = event.transaction.hash;
  s.logIndex = event.logIndex;
  s.save();
}
