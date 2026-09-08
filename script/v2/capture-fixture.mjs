// Reads one V2 settlement back off a local fork node and writes the verifier's offline fixture.
//
// CAPTURED, NEVER INVENTED. A fixture written by hand is a verifier tested against somebody's idea
// of a receipt. Everything below comes from `eth_getLogs`, `eth_getTransactionReceipt` and
// `eth_getBlockByNumber` against a node that really executed the settlement, so the offline suite
// is checking the same bytes an RPC client would be handed.
//
// It writes ONLY what a verifier is given in the real world: the receipt as JSON-RPC returns it,
// the quote the merchant signed, the merchant's signature, and the configuration preimage. No key,
// no endpoint, no environment value.

import {writeFileSync, mkdirSync} from "node:fs";
import {dirname} from "node:path";
import {ReadOnlyRpc} from "../../tools/unica-verify/rpc.mjs";
import {QUOTE_SETTLED_TOPIC} from "../../tools/unica-verify/receipt.mjs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const need = (k) => {
  const v = args.get(k);
  if (!v) throw new Error(`--${k} is required`);
  return v;
};

const rpc = new ReadOnlyRpc(need("rpc"));
const executor = need("executor").toLowerCase();

// A narrow window, not "since genesis". A forking node forwards any range it does not hold to its
// upstream, and a public upstream caps the span — so the naive query fails against the very setup
// this script exists to drive. The settlement happened moments ago, in blocks this node minted.
const head = BigInt(await rpc.blockNumber());
const from = head > 64n ? head - 64n : 0n;
const logs = await rpc.logs({
  address: executor,
  topics: [QUOTE_SETTLED_TOPIC],
  fromBlock: "0x" + from.toString(16),
  toBlock: "0x" + head.toString(16),
});
if (logs.length !== 1) throw new Error(`expected exactly one settlement on this node; found ${logs.length}`);

const receipt = await rpc.receipt(logs[0].transactionHash);
const block = await rpc.blockByNumber(receipt.blockNumber, false);
const chainId = await rpc.chainId();

// The whole receipt, as returned. Trimmed of nothing: a verifier that is only ever handed the log
// it wants has never been asked to find one among others, and finding it is half the job.
const fixture = {
  note:
    "A REAL V2 settlement, captured off a local anvil fork of Ethereum Sepolia by " +
    "script/v2/fork-settle.sh. The PoolManager, Permit2, USDC and WETH9 it ran against are the " +
    "live contracts at their live code; the executor and hook exist only inside that node. " +
    "NOTHING HERE WAS BROADCAST TO A PUBLIC CHAIN.",
  capturedFrom: "a local anvil fork of Ethereum Sepolia (chain 11155111)",
  chainId: Number(BigInt(chainId)),
  expected: {
    executor,
    hook: need("hook").toLowerCase(),
    poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    poolId: need("pool-id"),
    quoteDigest: need("quote-digest"),
    merchantSigner: need("merchant-signer").toLowerCase(),
    payer: need("payer").toLowerCase(),
    recipient: need("recipient").toLowerCase(),
    merchantConfigHash: need("config-hash"),
  },
  merchantSignature: need("merchant-signature"),
  merchantConfiguration: {
    version: 1,
    namehash: "0x7825d40d6800e28bd1018984ac9d649c39174be745a90021a4dd67d50d072639",
    name: "fork-merchant.eth",
    recipient: "0xa50802FBcAfc5aF3D0093026d301a82ec341652a",
    payoutCurrency: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    chainId: 11155111,
    resolvedAtBlock: 11656000,
    validForBlocks: 50000,
  },
  quote: {
    version: 1,
    quoteId: "0x666f726b2d310000000000000000000000000000000000000000000000000000",
    merchantSigner: need("merchant-signer"),
    payer: need("payer"),
    recipient: need("recipient"),
    tokenIn: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    maxIn: "1000000000000000000",
    tokenOut: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    amountOut: "100000000",
    pool: {
      currency0: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      currency1: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
      fee: 3000,
      tickSpacing: 60,
      hooks: need("hook"),
    },
    zeroForOne: false,
    deadline: "2000000000",
    hook: need("hook"),
    executor: need("executor"),
    merchantConfigHash: need("config-hash"),
    policyVersion: 1,
  },
  block: {
    number: block.number,
    hash: block.hash,
    timestamp: block.timestamp,
  },
  receipt,
};

const out = need("out");
mkdirSync(dirname(out), {recursive: true});
writeFileSync(out, JSON.stringify(fixture, null, 2) + "\n");
console.log(`captured tx ${receipt.transactionHash} in block ${Number(BigInt(block.number))}`);
