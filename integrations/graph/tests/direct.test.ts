import { assert, beforeEach, clearStore, describe, newMockEvent, test } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { DirectReceipt } from "../generated/DirectSettlement/DirectSettlement";
import { Settlement } from "../generated/schema";
import { handleDirectReceipt } from "../src/direct";

// A PLANTED event, not a log read from a chain. The settler address is the one this manifest pins
// on Sepolia (deployments/unica-v4/11155111.json) and the asset is that deployment's USDC; the
// order id, the amount and the transaction are this test's own.
const SETTLER = Address.fromString("0x14a95db5463d27a97DF464001ec65d5DADffC88e");
const ORDER_ID = Bytes.fromHexString("0x14a9000000000000000000000000000000000000000000000000000000000001");
const TERMINAL_NODE = Bytes.fromHexString("0x67790000000000000000000000000000000000000000000000000000000000aa");
const RECIPIENT = Address.fromString("0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73");
const PAYER = Address.fromString("0x01CA95Ba9a19e6F88A90082367c285D179275De4");
const USDC = Address.fromString("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
const AMOUNT = BigInt.fromString("2500000");
// The settler's own recorded time, deliberately different from the mock block's, so the assertion
// below can only pass if the handler took this one rather than the block's.
const SETTLED_AT = BigInt.fromString("1789254000");

function plantedReceipt(logIndex: i32): DirectReceipt {
  const mock = newMockEvent();
  const e = new DirectReceipt(
    SETTLER,
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
  e.parameters.push(new ethereum.EventParam("asset", ethereum.Value.fromAddress(USDC)));
  e.parameters.push(new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(AMOUNT)));
  e.parameters.push(new ethereum.EventParam("terminalNode", ethereum.Value.fromFixedBytes(TERMINAL_NODE)));
  e.parameters.push(new ethereum.EventParam("settledAt", ethereum.Value.fromUnsignedBigInt(SETTLED_AT)));
  return e;
}

describe("handleDirectReceipt", () => {
  beforeEach(() => {
    clearStore();
  });

  test("one direct receipt becomes one Settlement, timed by the receipt and not by the block", () => {
    const e = plantedReceipt(4);
    handleDirectReceipt(e);
    assert.entityCount("Settlement", 1);
    const id = e.transaction.hash.concatI32(4).toHexString();
    assert.fieldEquals("Settlement", id, "orderId", ORDER_ID.toHexString());
    assert.fieldEquals("Settlement", id, "recipient", RECIPIENT.toHexString());
    assert.fieldEquals("Settlement", id, "payer", PAYER.toHexString());
    assert.fieldEquals("Settlement", id, "asset", USDC.toHexString());
    assert.fieldEquals("Settlement", id, "amount", AMOUNT.toString());
    assert.fieldEquals("Settlement", id, "kind", "direct");
    assert.fieldEquals("Settlement", id, "settledAt", SETTLED_AT.toString());
    assert.assertTrue(SETTLED_AT != e.block.timestamp); // the two really are different
    assert.fieldEquals("Settlement", id, "transactionHash", e.transaction.hash.toHexString());
    assert.fieldEquals("Settlement", id, "blockNumber", e.block.number.toString());
  });

  test("a direct settlement leaves the four market-only fields unset, never zeroed", () => {
    const e = plantedReceipt(4);
    handleDirectReceipt(e);
    const row = Settlement.load(e.transaction.hash.concatI32(4));
    assert.assertTrue(row != null, "the row this test is about was not written");
    const s = row!;
    // A zero market id, a zero amountIn or a `false` demonstrationOnly would each read as an
    // answer about a market this settlement never had. Unset is the only honest value.
    //
    // Read through `get`, not through the generated accessors: AssemblyScript has no nullable
    // boolean, so `s.demonstrationOnly` answers `false` for a field that was never written. What
    // is stored is what the query layer serves, and for all four of these it is absent.
    assert.assertTrue(s.get("marketId") == null, "marketId should be unset on a direct settlement");
    assert.assertTrue(s.get("amountIn") == null, "amountIn should be unset on a direct settlement");
    assert.assertTrue(s.get("currencyIn") == null, "currencyIn should be unset on a direct settlement");
    assert.assertTrue(s.get("demonstrationOnly") == null, "demonstrationOnly should be unset on a direct settlement");
  });
});
