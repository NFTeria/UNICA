import { assert, beforeEach, clearStore, describe, newMockEvent, test } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { SettlementReceipt } from "../generated/UnicaMarketHook/UnicaMarketHook";
import { handleSettlementReceipt } from "../src/market";

// A PLANTED event, not a log read from a chain. The hook address is the one this manifest pins on
// Sepolia (deployments/unica-v4/11155111.json), and the two currencies are that deployment's WETH
// and USDC, so the fixture is the shape the live market emits; the order id, the amounts and the
// transaction are this test's own. What it proves is only what a handler can be proven to do
// offline: every field of the row comes from the event, and the ones a market receipt cannot carry
// are left unset.
const HOOK = Address.fromString("0x2570a593e0D24ede29eC926e0c5a88B427b9A0c0");
const ORDER_ID = Bytes.fromHexString("0x2570000000000000000000000000000000000000000000000000000000000001");
const MARKET_ID = Bytes.fromHexString("0x99f138caff24fe5dbe437093bac3bf66b2605e7940887fa648e5409dddaefb93");
const RECIPIENT = Address.fromString("0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73");
const PAYER = Address.fromString("0x01CA95Ba9a19e6F88A90082367c285D179275De4");
const WETH = Address.fromString("0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14");
const USDC = Address.fromString("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
const AMOUNT_IN = BigInt.fromString("1000000000000000");
const AMOUNT_OUT = BigInt.fromString("2003660");

function plantedReceipt(logIndex: i32): SettlementReceipt {
  const mock = newMockEvent();
  const e = new SettlementReceipt(
    HOOK, // the emitter: the handler must never read the address from anywhere else
    mock.logIndex,
    mock.transactionLogIndex,
    mock.logType,
    mock.block,
    mock.transaction,
    new Array<ethereum.EventParam>(),
    mock.receipt,
  );
  e.logIndex = BigInt.fromI32(logIndex);
  // In the order the ABI declares them: the generated getters read by position, not by name.
  e.parameters.push(new ethereum.EventParam("orderId", ethereum.Value.fromFixedBytes(ORDER_ID)));
  e.parameters.push(new ethereum.EventParam("recipient", ethereum.Value.fromAddress(RECIPIENT)));
  e.parameters.push(new ethereum.EventParam("payer", ethereum.Value.fromAddress(PAYER)));
  e.parameters.push(new ethereum.EventParam("marketId", ethereum.Value.fromFixedBytes(MARKET_ID)));
  e.parameters.push(new ethereum.EventParam("currencyIn", ethereum.Value.fromAddress(WETH)));
  e.parameters.push(new ethereum.EventParam("currencyOut", ethereum.Value.fromAddress(USDC)));
  e.parameters.push(new ethereum.EventParam("amountIn", ethereum.Value.fromUnsignedBigInt(AMOUNT_IN)));
  e.parameters.push(new ethereum.EventParam("amountOut", ethereum.Value.fromUnsignedBigInt(AMOUNT_OUT)));
  e.parameters.push(new ethereum.EventParam("hookFeePips", ethereum.Value.fromI32(0)));
  e.parameters.push(new ethereum.EventParam("lpFeePips", ethereum.Value.fromI32(3000)));
  e.parameters.push(new ethereum.EventParam("protocolFeePips", ethereum.Value.fromI32(0)));
  e.parameters.push(new ethereum.EventParam("swapFeePips", ethereum.Value.fromI32(3000)));
  e.parameters.push(new ethereum.EventParam("referencePrice", ethereum.Value.fromUnsignedBigInt(BigInt.zero())));
  e.parameters.push(new ethereum.EventParam("referenceDecimals", ethereum.Value.fromI32(0)));
  e.parameters.push(new ethereum.EventParam("referenceUpdatedAt", ethereum.Value.fromUnsignedBigInt(BigInt.zero())));
  e.parameters.push(new ethereum.EventParam("demonstrationOnly", ethereum.Value.fromBoolean(true)));
  return e;
}

function idOf(e: SettlementReceipt): string {
  return e.transaction.hash.concatI32(e.logIndex.toI32()).toHexString();
}

describe("handleSettlementReceipt", () => {
  beforeEach(() => {
    clearStore();
  });

  test("one market receipt becomes one Settlement carrying the merchant's side of the swap", () => {
    const e = plantedReceipt(11);
    handleSettlementReceipt(e);
    assert.entityCount("Settlement", 1);
    const id = idOf(e);
    assert.fieldEquals("Settlement", id, "orderId", ORDER_ID.toHexString());
    assert.fieldEquals("Settlement", id, "recipient", RECIPIENT.toHexString());
    assert.fieldEquals("Settlement", id, "payer", PAYER.toHexString());
    // The receipt page asks for `asset` and `amount`: on this path they are the OUT leg, what the
    // merchant actually received, never the leg the payer sent.
    assert.fieldEquals("Settlement", id, "asset", USDC.toHexString());
    assert.fieldEquals("Settlement", id, "amount", AMOUNT_OUT.toString());
    assert.fieldEquals("Settlement", id, "kind", "market");
    assert.fieldEquals("Settlement", id, "settledAt", e.block.timestamp.toString());
    assert.fieldEquals("Settlement", id, "transactionHash", e.transaction.hash.toHexString());
    assert.fieldEquals("Settlement", id, "blockNumber", e.block.number.toString());
    assert.fieldEquals("Settlement", id, "marketId", MARKET_ID.toHexString());
    assert.fieldEquals("Settlement", id, "amountIn", AMOUNT_IN.toString());
    assert.fieldEquals("Settlement", id, "currencyIn", WETH.toHexString());
    assert.fieldEquals("Settlement", id, "demonstrationOnly", "true");
  });

  test("the same log delivered twice is still one row, and two logs in one transaction are two", () => {
    const a = plantedReceipt(11);
    handleSettlementReceipt(a);
    handleSettlementReceipt(a); // a re-delivery: same transaction, same log index, so the same id
    assert.entityCount("Settlement", 1);
    handleSettlementReceipt(plantedReceipt(12));
    assert.entityCount("Settlement", 2);
  });
});
