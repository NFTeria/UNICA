// Offline sample settlements. NOT LIVE DATA, and structurally incapable of pretending to be.
//
// WHAT THIS IS FOR. The copilot's arithmetic has to be testable without a network and without a
// deployed subgraph, and a demo of the rendering has to be runnable by a reviewer who has no API
// key. That is the whole purpose.
//
// WHAT IT DELIBERATELY DOES NOT DO. It is not reachable from the live path. `provider.mjs` does
// not import this file, names no file, and reads nothing from disk — so there is no sequence of
// failures that ends with a sample row being returned as a live one. `provider-test.mjs` asserts
// that as a property of the source text as well as of the behaviour.
//
// Every record leaves here stamped `source: OFFLINE_SOURCE`. The copilot reads that stamp, puts it
// at the top of the report, and refuses a set whose records do not all agree on it. So the visible
// difference between an offline run and a live one is not a convention someone has to remember —
// it is a field, and it is checked.
//
// NOTHING HERE IS A RECEIPT OF A SETTLEMENT THAT HAPPENED. The addresses and tokens are the ones
// from the captured fork settlement so the shapes are realistic; the amounts, timestamps, blocks,
// digests and ids are CONSTRUCTED to exercise named rules, and are derived from labels by keccak so
// they are deterministic and obviously synthetic.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";

export const OFFLINE_SOURCE = "OFFLINE_FIXTURE";

/// Said out loud in every rendering, so a screenshot of an offline run cannot be mistaken for a
/// screenshot of a live one.
export const OFFLINE_BANNER =
  "OFFLINE SAMPLE DATA — constructed, not indexed. No subgraph was queried and nothing here is a receipt.";

const utf8 = (s) => new TextEncoder().encode(s);
const label = (s) => toHex(keccak256(utf8(`unica.v2.offline-sample.${s}`)));

// The parties and tokens from the captured fork settlement, so the shapes are the real shapes.
// Sepolia USDC and WETH9, and the fork's merchant/payer addresses.
const RECIPIENT = "0xa50802fbcafc5af3d0093026d301a82ec341652a";
const MERCHANT_SIGNER = "0xd1948520ecc70cfd26c23d2528272c017daaa256";
const EXECUTOR = "0x5615deb798bb3e4dfa0139dfa1b3d433cc23b72f";
const USDC = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";
const WETH = "0xfff9976782d46cc05630d1f6ebab18b2324d6b14";

const PAYERS = [
  "0x14aa1c8aeb544a744624a5b9956f3318b468dc94",
  "0x00000000000000000000000000000000000000a1",
  "0x00000000000000000000000000000000000000b2",
];

/// (payer index, USDC amount in 6 decimals, seconds after the first settlement).
/// Chosen so the offline demo shows a real, nameable shape: one payer well over half the volume,
/// a steady weekly cadence with one long gap, and one receipt far outside the merchant's history.
const ROWS = [
  [0, 1_000_000n, 0],
  [1, 1_200_000n, 86_400],
  [0, 950_000n, 172_800],
  [2, 1_100_000n, 259_200],
  [0, 1_050_000n, 345_600],
  [0, 25_000_000n, 432_000],
  [1, 1_000_000n, 950_400],
];

const FIRST_BLOCK = 11_656_955;
const FIRST_TIMESTAMP = 1_770_000_000;
/// Sepolia's target block time. Blocks here are derived from the offsets rather than invented
/// independently, so block order and timestamp order can never disagree.
const SECONDS_PER_BLOCK = 12;

/// The offline set, built the same way every time. No clock, no randomness: two calls return
/// byte-identical arrays and the suite asserts that.
export function offlineSettlements() {
  return ROWS.map(([payerIndex, amount, offset], i) => ({
    id: label(`id.${i}`),
    quoteId: label(`quote-id.${i}`),
    quoteDigest: label(`quote-digest.${i}`),
    payer: PAYERS[payerIndex],
    merchantSigner: MERCHANT_SIGNER,
    recipient: RECIPIENT,
    tokenIn: WETH,
    // What the swap cost the payer, in WETH. Not summed with the payout token anywhere.
    actualIn: String((amount * 400_000_000_000n) / 1_000_000n),
    maxIn: "1000000000000000000",
    tokenOut: USDC,
    amountOut: String(amount),
    // The executor requires these equal. They are equal here; `copilot-test.mjs` builds the
    // unequal case separately rather than putting a receipt that cannot exist into the samples.
    deliveredOut: String(amount),
    executor: EXECUTOR,
    policyVersion: "1",
    transactionHash: label(`tx.${i}`),
    logIndex: "0",
    blockNumber: String(FIRST_BLOCK + Math.floor(offset / SECONDS_PER_BLOCK)),
    blockTimestamp: String(FIRST_TIMESTAMP + offset),
    source: OFFLINE_SOURCE,
  }));
}

/// The merchant the sample set is about, so a demo does not have to guess.
export const OFFLINE_RECIPIENT = RECIPIENT;

/// A timestamp to analyse the sample set "as of". A clock is an input everywhere in this module;
/// this is the value the offline demo and the suite both use, so both are reproducible.
export const OFFLINE_AS_OF = String(FIRST_TIMESTAMP + 1_036_800);
