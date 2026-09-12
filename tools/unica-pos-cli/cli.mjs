#!/usr/bin/env node
// node tools/unica-pos-cli/cli.mjs --demo path/to/demo-record.json
//
// Reads a demo record (manifest + order + oracle + policy + settlement + evidence, in the shape
// documented in the header comment below) and prints the merchant view, the customer view, and a
// compact JSON summary. No network access of its own: everything it prints comes from the record
// file and, ultimately, from `tools/unica-evidence`'s own recomputation, never re-decided here.

import {readFileSync} from "node:fs";
import {resolve} from "node:path";

import {renderCustomerView, renderMerchantView} from "./render.mjs";

/// Demo record shape (the caller assembles this from a real local settlement or a fixture):
/// {
///   manifest,                      // deployments/31337.local.json shape
///   order: {id, payer, marketId, inputAmount, minimumOutput, expiry, terminalName, terminalStatusAtAdmission},
///   oracle: {adapter, feedId, fixture, fresh},
///   policy: {decision, source, reportHash},
///   settlement: {transactionHash, merchantBalanceBefore, merchantBalanceAfter, outputDelivered, atomic},
///   evidence: { ... the object tools/unica-evidence's authenticateReceipt returns },
/// }
export function buildState(record) {
  const manifest = record.manifest ?? {};
  const order = record.order ?? {};
  const evidence = record.evidence ?? null;
  const receipt = evidence?.receipt ?? null;
  const terminals = manifest.identity?.terminals ?? [];
  const terminalRecord = terminals.find((t) => t.name === order.terminalName) ?? null;

  return {
    manifest,
    chainId: manifest.chainId,
    connectedAddress: order.payer ?? null,
    merchant: {
      name: manifest.identity?.merchantName,
      address: manifest.accounts?.merchantPayout,
      identityToken: identityTokenOf(manifest),
      rendererVersion: manifest.identity?.rendererVersion,
    },
    terminal: {
      name: order.terminalName,
      statusAtAdmission: order.terminalStatusAtAdmission ?? terminalRecord?.status ?? null,
    },
    order: {
      id: order.id,
      boundPayer: order.payer,
      recipientAtAdmission: order.recipientAtAdmission ?? manifest.accounts?.merchantPayout,
      amountIn: order.inputAmount,
      minOut: order.minimumOutput,
      deadline: order.expiry,
      inputAsset: {symbol: order.inputSymbol ?? "ASSET"},
      outputAsset: {symbol: order.outputSymbol ?? "PAYOUT"},
    },
    fees: receipt
      ? {
          hookFeePips: receipt.hookFeePips,
          lpFeePips: receipt.lpFeePips,
          protocolFeePips: receipt.protocolFeePips,
          swapFeePips: receipt.swapFeePips,
        }
      : {},
    now: record.now,
    txSubmitted: Boolean(record.settlement?.transactionHash) || Boolean(record.settlement?.txSubmitted),
    txHash: record.settlement?.transactionHash ?? null,
    txReceipt: record.settlement?.txReceipt ?? null,
    evidence,
  };
}

function identityTokenOf(manifest) {
  const address = manifest.contracts?.identityToken?.address;
  const tokenId = manifest.identity?.tokenId;
  if (!address && !tokenId) return undefined;
  return `${address ?? "0x.."}:${tokenId ?? "?"}`;
}

/// The compact JSON, exactly in the brief's shape: environment, merchant, terminal, order, oracle,
/// policy, settlement, and a NARROWED evidence view (decision plus the five boolean links only —
/// never the boolean-reducing kind of narrowing, since `decision` itself stays the three-way
/// VERIFIED/REFUSED/UNKNOWN value, not collapsed to true/false).
export function buildSummary(record) {
  const manifest = record.manifest ?? {};
  const evidence = record.evidence ?? {};
  return {
    environment: manifest.environment ?? null,
    // Who this business is, and who put it here. `businessJoinedBy` is the wallet that ran the
    // join itself: it is in the summary so that "a business set itself up" is a checkable claim
    // and not a sentence in a slide. `payName` is the name a customer types, spelled out once.
    payName: manifest.identity?.merchantName ?? null,
    businessJoinedBy: manifest.identity?.joinedBy ?? null,
    merchant: {
      name: manifest.identity?.merchantName ?? null,
      address: manifest.accounts?.merchantPayout ?? null,
      identityToken: identityTokenOf(manifest) ?? null,
      rendererVersion: manifest.identity?.rendererVersion ?? null,
    },
    terminal: {
      name: record.order?.terminalName ?? null,
      statusAtAdmission: record.order?.terminalStatusAtAdmission ?? null,
    },
    order: record.order ?? null,
    oracle: record.oracle ?? null,
    policy: record.policy ?? null,
    settlement: record.settlement ?? null,
    evidence: {
      decision: evidence.decision ?? "UNKNOWN",
      registryAuthenticated: Boolean(evidence.registryAuthenticated),
      marketAuthenticated: Boolean(evidence.marketAuthenticated),
      hookMatched: Boolean(evidence.hookMatched),
      executorMatched: Boolean(evidence.executorMatched),
      poolMatched: Boolean(evidence.poolMatched),
    },
  };
}

/// Identity-art provenance is a pointer check, nothing more (rulings N1, N6): the client accepts
/// the identity contract the deployment manifest names and refuses every other contract, however
/// perfect its bytecode. A match proves the pointer, never current ENS control or merchant status.
export function identityProvenance(manifest, contractAddress, tokenId) {
  const expected = manifest.contracts?.identityToken?.address;
  const reasonCodes = [];
  if (!expected) reasonCodes.push("MANIFEST_HAS_NO_IDENTITY_CONTRACT");
  else if (String(contractAddress).toLowerCase() !== String(expected).toLowerCase()) reasonCodes.push("IDENTITY_CONTRACT_MISMATCH");
  const expectedId = manifest.identity?.tokenId ? String(manifest.identity.tokenId).split(" ")[0] : null;
  if (expectedId && String(tokenId) !== expectedId) reasonCodes.push("TOKEN_ID_MISMATCH");
  return {
    case: "COUNTERFEIT_IDENTITY_NFT",
    decision: reasonCodes.length === 0 ? "POINTER_MATCHES" : "REFUSED",
    reasonCodes,
    proves: "identity-art provenance pointer only; never current ENS control, address ownership, merchant status, payment or endorsement",
    expected: expected ?? null,
    presented: `${contractAddress}:${tokenId}`,
  };
}

function parseArgs(argv) {
  const out = {jsonOnly: false};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--demo") out.demo = argv[++i];
    else if (argv[i] === "--json-only") out.jsonOnly = true;
    else if (argv[i] === "--provenance-check") {
      out.provenance = {manifest: argv[++i], contractAddress: argv[++i], tokenId: argv[++i]};
    } else throw new Error(`unrecognised argument: ${argv[i]}`);
  }
  if (!out.demo && !out.provenance) throw new Error("--demo path/to/demo-record.json or --provenance-check <manifest> <address> <tokenId> is required");
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.provenance) {
    const manifest = JSON.parse(readFileSync(resolve(args.provenance.manifest), "utf8"));
    console.log(JSON.stringify(identityProvenance(manifest, args.provenance.contractAddress, args.provenance.tokenId)));
    return;
  }
  const record = JSON.parse(readFileSync(resolve(args.demo), "utf8"));
  const state = buildState(record);
  if (args.jsonOnly) {
    console.log(JSON.stringify(buildSummary(record), null, 2));
    return;
  }

  console.log("==== Business view ".padEnd(60, "="));
  console.log(renderMerchantView(state));
  console.log();
  console.log("==== Customer view ".padEnd(60, "="));
  console.log(renderCustomerView(state));
  console.log();
  console.log("==== Summary (compact JSON) ".padEnd(60, "="));
  console.log(JSON.stringify(buildSummary(record), null, 2));
}

main();
