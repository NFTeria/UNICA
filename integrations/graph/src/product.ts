import { ProductSold } from "../generated/ProductCatalog/ProductCatalog";
import { ProductSale } from "../generated/schema";

// One catalogue sale. The id is the event's own `saleId`, which the catalogue derives from the
// chain, itself, the product, the buyer and its own sales count, so it is already unique across
// every sale it has ever made — there is nothing here for the handler to invent.
export function handleProductSold(event: ProductSold): void {
  const sale = new ProductSale(event.params.saleId);
  sale.productId = event.params.productId;
  sale.buyer = event.params.buyer;
  sale.seller = event.params.seller;
  sale.payout = event.params.payout;
  sale.asset = event.params.asset;
  sale.amount = event.params.amount;
  // The kind is stored as the number the event emitted, not as a word: a reader that wants the
  // word can look it up, and a row that renames it would be this file's opinion, not the chain's.
  sale.kind = event.params.kind;
  sale.paidThrough = event.params.paidThrough;
  // `ProductSold` carries no time of its own, so the block's is the sale time.
  sale.settledAt = event.block.timestamp;
  sale.transactionHash = event.transaction.hash;
  sale.blockNumber = event.block.number;
  sale.save();
}
