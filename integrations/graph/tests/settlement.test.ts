import { assert, describe, test, clearStore, beforeEach, newMockEvent } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { SettlementReceipt } from "../generated/V4SettlementHook/V4SettlementHook";
import { handleSettlementReceipt } from "../src/mapping";

// The fixture is a real local receipt: the one emitted by the repository's own conformance test
// test_Schema_OneReceiptWhoseAmountsAreTheDeltasAndTheBalanceChange (forge, 2026-09-04), copied
// field by field from the trace. amountIn is the PoolManager's amount0 and amountOut its amount1
// for that swap, which the Solidity test asserts; here the same numbers prove the handler copies
// what the hook emitted without arithmetic of its own.
const HOOK = Address.fromString("0x44440000000000000000000000000000000000C0");
const ORDER_ID = Bytes.fromHexString("0x76fd18b450277c9c9628d5e700f5a03707db88ff4125401741f6ab87df36b7bb");
const POOL_ID = Bytes.fromHexString("0xd90f537a3370eb2e122e948736d28ea8e0d1c520398c1c6167998b8bde91758b");
const RECIPIENT = Address.fromString("0x00655EA989254C13e93C5a1F74C4636b5B9926B5");
const PAYER = Address.fromString("0x01CA95Ba9a19e6F88A90082367c285D179275De4");
const EXECUTOR = Address.fromString("0xF623BA7F8a0Ec5A5808d03c91B3Be64Ec010DCe5");
const NATIVE = Address.fromString("0x0000000000000000000000000000000000000000");
const USDC = Address.fromString("0xF62849F9A0B5Bf2913b396098F7c7019b51A820a");
const AMOUNT_IN = BigInt.fromString("1000000000000000");
const AMOUNT_OUT = BigInt.fromString("996006981039903");
const ZERO32 = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000");

function receipt(version: i32, orderId: Bytes, logIndex: i32): SettlementReceipt {
  const mock = newMockEvent();
  const e = new SettlementReceipt(
    HOOK, // the emitter is the hook; the handler must take it from here, never from a constant
    mock.logIndex,
    mock.transactionLogIndex,
    mock.logType,
    mock.block,
    mock.transaction,
    new Array<ethereum.EventParam>(),
    mock.receipt
  );
  e.logIndex = BigInt.fromI32(logIndex);
  e.parameters.push(new ethereum.EventParam("orderId", ethereum.Value.fromFixedBytes(orderId)));
  e.parameters.push(new ethereum.EventParam("poolId", ethereum.Value.fromFixedBytes(POOL_ID)));
  e.parameters.push(new ethereum.EventParam("recipient", ethereum.Value.fromAddress(RECIPIENT)));
  e.parameters.push(new ethereum.EventParam("schemaVersion", ethereum.Value.fromI32(version)));
  e.parameters.push(new ethereum.EventParam("payer", ethereum.Value.fromAddress(PAYER)));
  e.parameters.push(new ethereum.EventParam("executor", ethereum.Value.fromAddress(EXECUTOR)));
  e.parameters.push(new ethereum.EventParam("currencyIn", ethereum.Value.fromAddress(NATIVE)));
  e.parameters.push(new ethereum.EventParam("currencyOut", ethereum.Value.fromAddress(USDC)));
  e.parameters.push(new ethereum.EventParam("amountIn", ethereum.Value.fromUnsignedBigInt(AMOUNT_IN)));
  e.parameters.push(new ethereum.EventParam("amountOut", ethereum.Value.fromUnsignedBigInt(AMOUNT_OUT)));
  e.parameters.push(new ethereum.EventParam("fee", ethereum.Value.fromUnsignedBigInt(BigInt.zero())));
  e.parameters.push(new ethereum.EventParam("policyId", ethereum.Value.fromFixedBytes(ZERO32)));
  return e;
}

function idOf(e: SettlementReceipt): string {
  return e.transaction.hash.concatI32(e.logIndex.toI32()).toHexString();
}

describe("handleSettlementReceipt, schema v1", () => {
  beforeEach(() => {
    clearStore();
  });

  test("one receipt becomes one immutable Settlement with every field as emitted", () => {
    const e = receipt(1, ORDER_ID, 7);
    handleSettlementReceipt(e);
    assert.entityCount("Settlement", 1);
    const id = idOf(e);
    assert.fieldEquals("Settlement", id, "schemaVersion", "1");
    assert.fieldEquals("Settlement", id, "orderId", ORDER_ID.toHexString());
    assert.fieldEquals("Settlement", id, "poolId", POOL_ID.toHexString());
    assert.fieldEquals("Settlement", id, "payer", PAYER.toHexString());
    assert.fieldEquals("Settlement", id, "recipient", RECIPIENT.toHexString());
    assert.fieldEquals("Settlement", id, "currencyIn", NATIVE.toHexString());
    assert.fieldEquals("Settlement", id, "currencyOut", USDC.toHexString());
    assert.fieldEquals("Settlement", id, "amountIn", AMOUNT_IN.toString());
    assert.fieldEquals("Settlement", id, "amountOut", AMOUNT_OUT.toString());
    assert.fieldEquals("Settlement", id, "fee", "0");
    assert.fieldEquals("Settlement", id, "policyId", ZERO32.toHexString());
    assert.fieldEquals("Settlement", id, "executor", EXECUTOR.toHexString());
    assert.fieldEquals("Settlement", id, "hook", HOOK.toHexString());
    assert.fieldEquals("Settlement", id, "transactionHash", e.transaction.hash.toHexString());
    assert.fieldEquals("Settlement", id, "logIndex", "7");
    assert.fieldEquals("Settlement", id, "blockNumber", e.block.number.toString());
    assert.fieldEquals("Settlement", id, "blockTimestamp", e.block.timestamp.toString());
  });

  test("a receipt of another schema version creates nothing", () => {
    handleSettlementReceipt(receipt(2, ORDER_ID, 7));
    assert.entityCount("Settlement", 0);
  });

  test("two receipts in one transaction are two entities with distinct ids", () => {
    const a = receipt(1, ORDER_ID, 7);
    const b = receipt(1, Bytes.fromHexString("0x" + "11".repeat(32)), 9);
    handleSettlementReceipt(a);
    handleSettlementReceipt(b);
    assert.entityCount("Settlement", 2);
    assert.assertTrue(idOf(a) != idOf(b));
  });
});
