import { assert, describe, test, clearStore, beforeEach, newMockEvent } from "matchstick-as/assembly/index";
import { Address, BigInt, ByteArray, Bytes, crypto, ethereum } from "@graphprotocol/graph-ts";
import { QuoteSettled } from "../generated/QuoteSettlementExecutor/QuoteSettlementExecutor";
import { handleQuoteSettled } from "../src/mapping";

// THE FIXTURE IS A CAPTURED RECEIPT, not an invented one. Every value below was printed by
// test/fork/CaptureReceipt.t.sol from a real settlement against the pinned Sepolia fork at block
// 11656449 — the official PoolManager, the official Permit2, Circle's USDC and canonical WETH9.
// A subgraph tested against somebody's idea of a receipt is a subgraph tested against nothing.
const EXECUTOR = Address.fromString("0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f");
const QUOTE_ID = Bytes.fromHexString("0x666f726b2d310000000000000000000000000000000000000000000000000000");
const QUOTE_DIGEST = Bytes.fromHexString("0x6306d518eab0421741e32412670005319fd41da1437e9ee3d1ea60d4387e5a88");
const RECIPIENT = Address.fromString("0xa50802FBcAfc5aF3D0093026d301a82ec341652a");
const PAYER = Address.fromString("0x14aa1c8aEB544A744624a5B9956F3318b468dC94");
const MERCHANT = Address.fromString("0xd1948520eCC70CFD26c23D2528272c017dAAA256");
const HOOK = Address.fromString("0xdD1FD0c33FEF7434443df2031f1E5e2e80dA60c0");
const POOL_ID = Bytes.fromHexString("0xcbd47b7c61e0448059b6422d6fd362a5b45eb1799e2d3acf91b23dc948a3a12b");
const WETH = Address.fromString("0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14");
const USDC = Address.fromString("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
const ACTUAL_IN = BigInt.fromString("41792042795051823");
const MAX_IN = BigInt.fromString("1000000000000000000");
const AMOUNT_OUT = BigInt.fromString("100000000");

// 2^256 - 1. Present because a subgraph that quietly loses precision on a large amount is a
// subgraph that under-reports a payment, and BigInt is exactly where that happens.
const HUGE = BigInt.fromString(
  "115792089237316195423570985008687907853269984665640564039457584007913129639935"
);

function settled(
  emitter: Address,
  version: i32,
  quoteId: Bytes,
  logIndex: i32,
  actualIn: BigInt,
  amountOut: BigInt,
  deliveredOut: BigInt
): QuoteSettled {
  const mock = newMockEvent();
  const e = new QuoteSettled(
    emitter, // the emitter IS the executor; the handler must take it from here and never a constant
    mock.logIndex,
    mock.transactionLogIndex,
    mock.logType,
    mock.block,
    mock.transaction,
    new Array<ethereum.EventParam>(),
    mock.receipt
  );
  e.logIndex = BigInt.fromI32(logIndex);
  e.parameters.push(new ethereum.EventParam("quoteId", ethereum.Value.fromFixedBytes(quoteId)));
  e.parameters.push(new ethereum.EventParam("recipient", ethereum.Value.fromAddress(RECIPIENT)));
  e.parameters.push(new ethereum.EventParam("payer", ethereum.Value.fromAddress(PAYER)));
  e.parameters.push(new ethereum.EventParam("schemaVersion", ethereum.Value.fromI32(version)));
  e.parameters.push(new ethereum.EventParam("quoteDigest", ethereum.Value.fromFixedBytes(QUOTE_DIGEST)));
  e.parameters.push(new ethereum.EventParam("merchantSigner", ethereum.Value.fromAddress(MERCHANT)));
  e.parameters.push(new ethereum.EventParam("hook", ethereum.Value.fromAddress(HOOK)));
  e.parameters.push(new ethereum.EventParam("poolId", ethereum.Value.fromFixedBytes(POOL_ID)));
  e.parameters.push(new ethereum.EventParam("tokenIn", ethereum.Value.fromAddress(WETH)));
  e.parameters.push(new ethereum.EventParam("actualIn", ethereum.Value.fromUnsignedBigInt(actualIn)));
  e.parameters.push(new ethereum.EventParam("maxIn", ethereum.Value.fromUnsignedBigInt(MAX_IN)));
  e.parameters.push(new ethereum.EventParam("tokenOut", ethereum.Value.fromAddress(USDC)));
  e.parameters.push(new ethereum.EventParam("amountOut", ethereum.Value.fromUnsignedBigInt(amountOut)));
  e.parameters.push(new ethereum.EventParam("deliveredOut", ethereum.Value.fromUnsignedBigInt(deliveredOut)));
  e.parameters.push(new ethereum.EventParam("policyVersion", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
  return e;
}

function receipt(logIndex: i32): QuoteSettled {
  return settled(EXECUTOR, 1, QUOTE_ID, logIndex, ACTUAL_IN, AMOUNT_OUT, AMOUNT_OUT);
}

/// The id the mapping builds, recomputed here from the specification rather than imported from the
/// mapping. Two descriptions that must agree; asking the code for the answer and comparing it with
/// itself would prove nothing.
function idOf(e: QuoteSettled): string {
  const network = Bytes.fromByteArray(crypto.keccak256(ByteArray.fromUTF8("mainnet")));
  return network
    .concat(e.address)
    .concat(e.transaction.hash)
    .concatI32(e.logIndex.toI32())
    .toHexString();
}

function deploymentIdOf(executor: Address): string {
  const network = Bytes.fromByteArray(crypto.keccak256(ByteArray.fromUTF8("mainnet")));
  return network.concat(executor).toHexString();
}

describe("handleQuoteSettled — one receipt, one settlement", () => {
  beforeEach(() => {
    clearStore();
  });

  // Before any event, nothing exists. This is also the honest test of "a reverted settlement
  // creates no entity": a reverted transaction's logs never reach an indexer at all, so there is
  // no input to hand a handler. The EVM fact is the guarantee; this is the boundary next to it.
  test("an indexer that has seen nothing holds nothing", () => {
    assert.entityCount("InvoiceSettlement", 0);
    assert.entityCount("Deployment", 0);
  });

  test("one receipt becomes exactly one settlement, every field as emitted", () => {
    const e = receipt(7);
    handleQuoteSettled(e);

    assert.entityCount("InvoiceSettlement", 1);
    const id = idOf(e);
    assert.fieldEquals("InvoiceSettlement", id, "schemaVersion", "1");
    assert.fieldEquals("InvoiceSettlement", id, "quoteId", QUOTE_ID.toHexString());
    assert.fieldEquals("InvoiceSettlement", id, "quoteDigest", QUOTE_DIGEST.toHexString());
    assert.fieldEquals("InvoiceSettlement", id, "payer", PAYER.toHexString());
    assert.fieldEquals("InvoiceSettlement", id, "merchantSigner", MERCHANT.toHexString());
    assert.fieldEquals("InvoiceSettlement", id, "recipient", RECIPIENT.toHexString());
    assert.fieldEquals("InvoiceSettlement", id, "tokenIn", WETH.toHexString());
    assert.fieldEquals("InvoiceSettlement", id, "actualIn", ACTUAL_IN.toString());
    assert.fieldEquals("InvoiceSettlement", id, "maxIn", MAX_IN.toString());
    assert.fieldEquals("InvoiceSettlement", id, "tokenOut", USDC.toHexString());
    assert.fieldEquals("InvoiceSettlement", id, "amountOut", AMOUNT_OUT.toString());
    assert.fieldEquals("InvoiceSettlement", id, "deliveredOut", AMOUNT_OUT.toString());
    assert.fieldEquals("InvoiceSettlement", id, "poolId", POOL_ID.toHexString());
    assert.fieldEquals("InvoiceSettlement", id, "hook", HOOK.toHexString());
    assert.fieldEquals("InvoiceSettlement", id, "executor", EXECUTOR.toHexString());
    assert.fieldEquals("InvoiceSettlement", id, "policyVersion", "1");
    assert.fieldEquals("InvoiceSettlement", id, "logIndex", "7");
    assert.fieldEquals("InvoiceSettlement", id, "transactionHash", e.transaction.hash.toHexString());
  });

  // The executor comes from the LOG, not from a constant. A handler that hard-coded it would keep
  // working against a second deployment and attribute its settlements to the wrong contract.
  test("the executor is read from the emitter, not assumed", () => {
    const other = Address.fromString("0x00000000000000000000000000000000000000E2");
    const e = settled(other, 1, QUOTE_ID, 1, ACTUAL_IN, AMOUNT_OUT, AMOUNT_OUT);
    handleQuoteSettled(e);
    assert.fieldEquals("InvoiceSettlement", idOf(e), "executor", other.toHexString());
  });

  test("a receipt of another schema version creates nothing", () => {
    handleQuoteSettled(settled(EXECUTOR, 2, QUOTE_ID, 3, ACTUAL_IN, AMOUNT_OUT, AMOUNT_OUT));
    assert.entityCount("InvoiceSettlement", 0);
    assert.entityCount("Deployment", 0);
  });

  test("the largest representable amounts survive intact", () => {
    const e = settled(EXECUTOR, 1, QUOTE_ID, 4, HUGE, HUGE, HUGE);
    handleQuoteSettled(e);
    const id = idOf(e);
    assert.fieldEquals("InvoiceSettlement", id, "actualIn", HUGE.toString());
    assert.fieldEquals("InvoiceSettlement", id, "amountOut", HUGE.toString());
    assert.fieldEquals("InvoiceSettlement", id, "deliveredOut", HUGE.toString());
  });

  // amountOut is what was ASKED FOR and deliveredOut is what was MEASURED. The executor requires
  // them equal, and both are stored so an auditor can check rather than trust — which means the
  // mapping must never quietly copy one into the other.
  test("requested and delivered are stored separately", () => {
    const e = settled(EXECUTOR, 1, QUOTE_ID, 5, ACTUAL_IN, AMOUNT_OUT, AMOUNT_OUT.minus(BigInt.fromI32(1)));
    handleQuoteSettled(e);
    const id = idOf(e);
    assert.fieldEquals("InvoiceSettlement", id, "amountOut", AMOUNT_OUT.toString());
    assert.fieldEquals("InvoiceSettlement", id, "deliveredOut", AMOUNT_OUT.minus(BigInt.fromI32(1)).toString());
  });
});

describe("identity — what may and may not share an id", () => {
  beforeEach(() => {
    clearStore();
  });

  test("two logs in one transaction are two settlements", () => {
    const a = receipt(0);
    const b = receipt(1);
    handleQuoteSettled(a);
    handleQuoteSettled(b);
    assert.entityCount("InvoiceSettlement", 2);
    assert.assertTrue(idOf(a) != idOf(b));
  });

  // The reason the id carries the deployment. A transaction hash is unique WITHIN a chain, so an
  // id built from the transaction alone collides the moment a second deployment exists — and the
  // collision would look like an update, not an error.
  test("the same transaction and log on another deployment cannot collide", () => {
    const other = Address.fromString("0x00000000000000000000000000000000000000E2");
    const a = receipt(9);
    const b = settled(other, 1, QUOTE_ID, 9, ACTUAL_IN, AMOUNT_OUT, AMOUNT_OUT);
    b.transaction.hash = a.transaction.hash;

    handleQuoteSettled(a);
    handleQuoteSettled(b);
    assert.entityCount("InvoiceSettlement", 2);
    assert.entityCount("Deployment", 2);
    assert.assertTrue(idOf(a) != idOf(b));
  });

  // Delivering the same log twice is something an indexer does. It must leave one entity, and the
  // deployment's count must not move — a settlement that happened once, counted once.
  test("delivering the identical log twice leaves exactly one settlement and one count", () => {
    const e = receipt(2);
    handleQuoteSettled(e);
    handleQuoteSettled(e);
    assert.entityCount("InvoiceSettlement", 1);
    assert.fieldEquals("Deployment", deploymentIdOf(EXECUTOR), "settlementCount", "1");
  });

  // Address casing is presentation. Two spellings of one address are one address, and an id that
  // depended on the spelling would split a deployment in two.
  test("address casing does not change identity", () => {
    const lower = Address.fromString("0x5615deb798bb3e4dfa0139dfa1b3d433cc23b72f");
    const e1 = receipt(11);
    const e2 = settled(lower, 1, QUOTE_ID, 11, ACTUAL_IN, AMOUNT_OUT, AMOUNT_OUT);
    e2.transaction.hash = e1.transaction.hash;
    handleQuoteSettled(e1);
    handleQuoteSettled(e2);
    assert.entityCount("InvoiceSettlement", 1);
    assert.entityCount("Deployment", 1);
  });

  // V1 ids are transactionHash ++ logIndex. V2 PREFIXES keccak(network) ++ executor, which is what
  // makes the two namespaces disjoint by construction rather than by convention: no V1 id can begin
  // with this network hash unless keccak collides.
  //
  // An earlier version of this row asserted exact hex lengths and failed — matchstick's mock
  // transaction hash is not the 32 bytes a real one is, so the arithmetic was about the harness
  // rather than about the id. The structural claim is the one worth making.
  test("a V2 id cannot be mistaken for a V1 id", () => {
    const e = receipt(3);
    const v2 = idOf(e);
    const v1 = e.transaction.hash.concatI32(3).toHexString();
    const networkPrefix = Bytes.fromByteArray(crypto.keccak256(ByteArray.fromUTF8("mainnet"))).toHexString();

    assert.assertTrue(v2 != v1);
    assert.assertTrue(v2.startsWith(networkPrefix));
    assert.assertTrue(!v1.startsWith(networkPrefix));
    assert.assertTrue(v2.length > v1.length);
  });
});

describe("deployment accounting", () => {
  beforeEach(() => {
    clearStore();
  });

  test("a deployment counts its settlements and tracks its block range", () => {
    const a = receipt(0);
    a.block.number = BigInt.fromI32(100);
    const b = receipt(1);
    b.block.number = BigInt.fromI32(140);
    handleQuoteSettled(a);
    handleQuoteSettled(b);

    const id = deploymentIdOf(EXECUTOR);
    assert.fieldEquals("Deployment", id, "settlementCount", "2");
    assert.fieldEquals("Deployment", id, "firstBlock", "100");
    assert.fieldEquals("Deployment", id, "lastBlock", "140");
    assert.fieldEquals("Deployment", id, "executor", EXECUTOR.toHexString());
    assert.fieldEquals("Deployment", id, "unicaVersion", "v2");
  });

  test("a settlement points at its deployment", () => {
    const e = receipt(6);
    handleQuoteSettled(e);
    assert.fieldEquals("InvoiceSettlement", idOf(e), "deployment", deploymentIdOf(EXECUTOR));
  });
});
