import { assert, beforeEach, clearStore, describe, newMockEvent, test } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { ProductSold } from "../generated/ProductCatalog/ProductCatalog";
import { handleProductSold } from "../src/product";

// A PLANTED event, not a log read from a chain. The catalogue address is the one this manifest
// pins on Sepolia (deployments/unica-v4/11155111.json) and the asset is that deployment's USDC;
// the sale id, the product and the amounts are this test's own.
const CATALOG = Address.fromString("0xEf837110e2A60B4940E57570E5AD05f39d8C398A");
const SALE_ID = Bytes.fromHexString("0xef83000000000000000000000000000000000000000000000000000000000001");
const BUYER = Address.fromString("0x01CA95Ba9a19e6F88A90082367c285D179275De4");
const SELLER = Address.fromString("0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73");
const PAYOUT = Address.fromString("0x00655EA989254C13e93C5a1F74C4636b5B9926B5");
const USDC = Address.fromString("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
const PRODUCT_ID = BigInt.fromI32(7);
const AMOUNT = BigInt.fromString("1200000");
const RECURRING = 1; // IProductCatalog.Kind: 0 ONE_OFF, 1 RECURRING, 2 PERMANENT
const PAID_THROUGH = BigInt.fromString("1791846000");

function plantedSale(saleId: Bytes, kind: i32, paidThrough: BigInt): ProductSold {
  const mock = newMockEvent();
  const e = new ProductSold(
    CATALOG,
    mock.logIndex,
    mock.transactionLogIndex,
    mock.logType,
    mock.block,
    mock.transaction,
    new Array<ethereum.EventParam>(),
    mock.receipt,
  );
  // In the order the ABI declares them: the generated getters read by position, not by name.
  e.parameters.push(new ethereum.EventParam("productId", ethereum.Value.fromUnsignedBigInt(PRODUCT_ID)));
  e.parameters.push(new ethereum.EventParam("buyer", ethereum.Value.fromAddress(BUYER)));
  e.parameters.push(new ethereum.EventParam("seller", ethereum.Value.fromAddress(SELLER)));
  e.parameters.push(new ethereum.EventParam("payout", ethereum.Value.fromAddress(PAYOUT)));
  e.parameters.push(new ethereum.EventParam("asset", ethereum.Value.fromAddress(USDC)));
  e.parameters.push(new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(AMOUNT)));
  e.parameters.push(new ethereum.EventParam("kind", ethereum.Value.fromI32(kind)));
  e.parameters.push(new ethereum.EventParam("paidThrough", ethereum.Value.fromUnsignedBigInt(paidThrough)));
  e.parameters.push(new ethereum.EventParam("saleId", ethereum.Value.fromFixedBytes(saleId)));
  return e;
}

describe("handleProductSold", () => {
  beforeEach(() => {
    clearStore();
  });

  test("one sale becomes one ProductSale, keyed by the catalogue's own sale id", () => {
    const e = plantedSale(SALE_ID, RECURRING, PAID_THROUGH);
    handleProductSold(e);
    assert.entityCount("ProductSale", 1);
    const id = SALE_ID.toHexString();
    assert.fieldEquals("ProductSale", id, "productId", PRODUCT_ID.toString());
    assert.fieldEquals("ProductSale", id, "buyer", BUYER.toHexString());
    assert.fieldEquals("ProductSale", id, "seller", SELLER.toHexString());
    assert.fieldEquals("ProductSale", id, "payout", PAYOUT.toHexString());
    assert.fieldEquals("ProductSale", id, "asset", USDC.toHexString());
    assert.fieldEquals("ProductSale", id, "amount", AMOUNT.toString());
    assert.fieldEquals("ProductSale", id, "kind", "1");
    assert.fieldEquals("ProductSale", id, "paidThrough", PAID_THROUGH.toString());
    assert.fieldEquals("ProductSale", id, "settledAt", e.block.timestamp.toString());
    assert.fieldEquals("ProductSale", id, "transactionHash", e.transaction.hash.toHexString());
    assert.fieldEquals("ProductSale", id, "blockNumber", e.block.number.toString());
  });

  test("the same buyer buying a permanent product twice is two rows, because the sale ids differ", () => {
    const first = Bytes.fromHexString("0xef83000000000000000000000000000000000000000000000000000000000002");
    const second = Bytes.fromHexString("0xef83000000000000000000000000000000000000000000000000000000000003");
    handleProductSold(plantedSale(first, 2, BigInt.zero()));
    handleProductSold(plantedSale(second, 2, BigInt.zero()));
    assert.entityCount("ProductSale", 2);
    // A PERMANENT product covers no time, so the catalogue emits zero here and the row says zero.
    assert.fieldEquals("ProductSale", first.toHexString(), "paidThrough", "0");
  });
});
