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

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--demo") out.demo = argv[++i];
    else throw new Error(`unrecognised argument: ${argv[i]}`);
  }
  if (!out.demo) throw new Error("--demo path/to/demo-record.json is required");
  return out;
}

function main() {
  const {demo} = parseArgs(process.argv.slice(2));
  const record = JSON.parse(readFileSync(resolve(demo), "utf8"));
  const state = buildState(record);

  console.log("==== Merchant view ".padEnd(60, "="));
  console.log(renderMerchantView(state));
  console.log();
  console.log("==== Customer view ".padEnd(60, "="));
  console.log(renderCustomerView(state));
  console.log();
  console.log("==== Summary (compact JSON) ".padEnd(60, "="));
  console.log(JSON.stringify(buildSummary(record), null, 2));
}

main();
