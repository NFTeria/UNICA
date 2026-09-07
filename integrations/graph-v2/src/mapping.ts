import { BigInt, ByteArray, Bytes, crypto, dataSource } from "@graphprotocol/graph-ts";
import { QuoteSettled } from "../generated/QuoteSettlementExecutor/QuoteSettlementExecutor";
import { Deployment, InvoiceSettlement } from "../generated/schema";

/// The receipt schema this mapping understands. A receipt of any other version is NOT indexed:
/// silently decoding an unknown schema under this one's field names would produce rows that look
/// right and mean something else.
const SUPPORTED_SCHEMA_VERSION = 1;

/// The UNICA generation. Stored so a consumer reading two subgraphs cannot mistake a V1 settlement
/// for a V2 one — they have different guarantees and different fields.
const UNICA_VERSION = "v2";

/// Identity of the deployment: which network, and which executor on it.
///
/// Both halves are needed. The same executor bytecode can be deployed to several chains, and a
/// transaction hash is only unique WITHIN a chain — so a subgraph that identified a settlement by
/// transaction alone would collide the moment a second deployment existed.
function deploymentId(executor: Bytes): Bytes {
  let network = ByteArray.fromUTF8(dataSource.network());
  return Bytes.fromByteArray(crypto.keccak256(network)).concat(executor);
}

/// Identity of one settlement.
///
/// keccak(network) [32] ++ executor [20] ++ transactionHash [32] ++ logIndex [4].
///
/// Every component is FIXED WIDTH, which is what makes the concatenation injective: two distinct
/// tuples cannot produce the same bytes, so no two settlements can share an id and no separator is
/// needed. A hash of the same components would also work and would be shorter; this is preferred
/// because it can be read back apart, and an id an auditor can decompose is one they can check.
///
/// The quote digest is deliberately NOT the id. A digest identifies an INVOICE, and an invoice is
/// not an event: it has at most one settlement here today, but making the event's identity depend
/// on that invariant means a reorg or a second deployment turns a duplicate into an overwrite.
/// It is a field instead, indexed for lookup.
function settlementId(executor: Bytes, transactionHash: Bytes, logIndex: BigInt): Bytes {
  let network = ByteArray.fromUTF8(dataSource.network());
  return Bytes.fromByteArray(crypto.keccak256(network))
    .concat(executor)
    .concat(transactionHash)
    .concatI32(logIndex.toI32());
}

export function handleQuoteSettled(event: QuoteSettled): void {
  // A receipt of another schema version is not this schema. Nothing is created.
  if (event.params.schemaVersion != SUPPORTED_SCHEMA_VERSION) {
    return;
  }

  // The log's own address IS the executor. The event carries no executor field, because a field
  // restating the emitter is a field that can disagree with it.
  let executor = event.address;

  let deployment = Deployment.load(deploymentId(executor));
  if (deployment == null) {
    deployment = new Deployment(deploymentId(executor));
    deployment.network = dataSource.network();
    deployment.executor = executor;
    deployment.unicaVersion = UNICA_VERSION;
    deployment.settlementCount = BigInt.zero();
    deployment.firstBlock = event.block.number;
  }
  deployment.lastBlock = event.block.number;

  let id = settlementId(executor, event.transaction.hash, event.logIndex);

  // Delivering the same log twice must leave exactly one entity and must not double the count.
  // An indexer can replay, and an entity that is created twice is a settlement that happened once.
  let existing = InvoiceSettlement.load(id);
  if (existing != null) {
    deployment.save();
    return;
  }

  let settlement = new InvoiceSettlement(id);
  settlement.schemaVersion = event.params.schemaVersion;
  settlement.quoteId = event.params.quoteId;
  settlement.quoteDigest = event.params.quoteDigest;
  settlement.payer = event.params.payer;
  settlement.merchantSigner = event.params.merchantSigner;
  settlement.recipient = event.params.recipient;
  settlement.tokenIn = event.params.tokenIn;
  settlement.actualIn = event.params.actualIn;
  settlement.maxIn = event.params.maxIn;
  settlement.tokenOut = event.params.tokenOut;
  settlement.amountOut = event.params.amountOut;
  settlement.deliveredOut = event.params.deliveredOut;
  // No merchantConfigHash: the frozen receipt does not carry one, and writing the quote digest
  // into a field called "configuration hash" would be a schema that lies. The digest covers the
  // commitment; a verifier holding the quote checks it. docs/v2/COMPATIBILITY-001.md.
  settlement.poolId = event.params.poolId;
  settlement.hook = event.params.hook;
  settlement.executor = executor;
  settlement.policyVersion = event.params.policyVersion;
  settlement.deployment = deployment.id;
  settlement.transactionHash = event.transaction.hash;
  settlement.logIndex = event.logIndex;
  settlement.blockNumber = event.block.number;
  settlement.blockTimestamp = event.block.timestamp;
  settlement.save();

  deployment.settlementCount = deployment.settlementCount.plus(BigInt.fromI32(1));
  deployment.save();
}
