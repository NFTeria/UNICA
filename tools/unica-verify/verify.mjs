// The V2 receipt verifier's engine: given a quote, a signature and a transaction receipt, decide
// whether that receipt records a settlement of THAT quote — and say exactly which claims were
// tested to get there.
//
// IT RECOMPUTES; IT DOES NOT READ AND AGREE. The receipt carries a `quoteDigest`, and reading it
// back out and reporting it would verify nothing at all: the emitter chose that value. So the
// digest is rebuilt from the quote's own fields with the shared encoder in `tools/unica-sign`, the
// merchant's address is recovered from the signature over the REBUILT digest, and only then is the
// result compared with what the log says. The same rule governs the PoolId and the merchant
// configuration commitment. `test.mjs` sabotages each of those into "trust the receipt" and
// requires a named row to go red.
//
// FAIL CLOSED. Every check carries `mandatory`, and a verdict is VERIFIED only when every mandatory
// check passed and nothing threw. A check that could not run because its evidence was not supplied
// is recorded as such and, if it is mandatory, it fails — missing evidence is never silence.
//
// ONE HASHING SCHEMA, NOT TWO. The quote digest comes from `tools/unica-sign/unica.mjs` and the
// merchant configuration commitment from `integrations/ensv2/config.mjs`, which is the same encoder
// the checkout surface and the signing tool use and is compared against `src/v2/MerchantConfig.sol`
// in `test/v2/MerchantConfig.t.sol`. A verifier that invented its own would be checking one of its
// own opinions.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {concat, selectorOf, wordAddress, wordInt, wordUint} from "../unica-sign/abi.mjs";
import {hashQuote, quoteDigest, domainSeparator} from "../unica-sign/unica.mjs";
import {merchantConfigHash, isFresh} from "../../integrations/ensv2/config.mjs";
import {recoverAddress} from "./secp256k1.mjs";
import {decodeSettlementLog, findSettlementLogs, QUOTE_SETTLED_TOPIC} from "./receipt.mjs";

export const RECEIPT_SCHEMA_VERSION = 1;

const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const big = (v) => (typeof v === "bigint" ? v : BigInt(v));
const hexToBig = (v) => (typeof v === "string" ? BigInt(v) : BigInt(v ?? 0));

/// v4's pool identifier: the keccak of the PoolKey struct as it sits in memory, five words. The
/// tick spacing is signed, so it is sign-extended rather than zero-padded — a detail that only
/// shows up as a wrong id, never as an error.
export function computePoolId(pool) {
  return toHex(
    keccak256(
      concat(
        wordAddress(pool.currency0),
        wordAddress(pool.currency1),
        wordUint(pool.fee),
        wordInt(pool.tickSpacing),
        wordAddress(pool.hooks),
      ),
    ),
  );
}

/// The recorder. Rows are appended in the order they are decided, so a report reads as the sequence
/// of things that were actually tested rather than a summary somebody arranged afterwards.
class Verdict {
  constructor(mode) {
    this.mode = mode;
    this.checks = [];
    this.errors = [];
    this.warnings = [];
    this.onRow = null;
  }

  /// @param mandatory a failing mandatory check makes the verdict NOT VERIFIED. There is no path
  ///        that turns one into a warning; the ruling that commissioned this tool forbids it and
  ///        the shape of this function is the enforcement.
  record(name, ok, {mandatory = true, detail = null} = {}) {
    const row = {name, ok: Boolean(ok), mandatory, detail};
    this.checks.push(row);
    if (!row.ok && mandatory) this.errors.push(detail ? `${name}: ${detail}` : name);
    if (!row.ok && !mandatory) this.warnings.push(detail ? `${name}: ${detail}` : name);
    if (this.onRow) this.onRow(row);
    return row.ok;
  }

  equal(name, actual, expected, opts = {}) {
    const ok = typeof actual === "string" && typeof expected === "string"
      ? same(actual, expected)
      : actual === expected;
    return this.record(name, ok, {...opts, detail: ok ? null : `expected ${expected}, receipt says ${actual}`});
  }

  /// A check whose subject can throw. The throw becomes a NAMED failing row, never a stack trace
  /// that takes the report with it — a verifier whose output disappears exactly when something is
  /// wrong is worse than none. `test.mjs` sabotages the decoder to prove this row appears.
  guard(name, fn, opts = {}) {
    try {
      return fn();
    } catch (e) {
      this.record(name, false, {...opts, detail: e.message});
      return undefined;
    }
  }

  /// The asynchronous twin of `guard`, for the online rows. Same rule: a rejected promise becomes
  /// a named failing row, never an unhandled rejection that kills the report.
  async guardAsync(name, fn, opts = {}) {
    try {
      return await fn();
    } catch (e) {
      this.record(name, false, {...opts, detail: e.message});
      return undefined;
    }
  }

  /// The chain's copy of a receipt against the caller's. Used only in online mode, where the chain
  /// is the authority and the caller's JSON is a claim about it. The settlement log is compared
  /// field by field rather than by object identity, because that log is the one thing a forger has
  /// a reason to write: matching a real transaction's header while carrying an invented log is
  /// exactly the shape this has to refuse.
  agree(supplied, fetched) {
    const norm = (x) => (x === null || x === undefined ? null : typeof x === "string" ? x.toLowerCase() : String(x));
    const num = (x) => (x === null || x === undefined ? null : String(hexToBig(x)));

    this.equal("the supplied receipt names the transaction the chain returned",
      norm(supplied.transactionHash), norm(fetched.transactionHash));
    this.equal("the supplied receipt names the block the chain returned",
      norm(supplied.blockHash), norm(fetched.blockHash));
    this.equal("the supplied receipt names the block number the chain returned",
      num(supplied.blockNumber), num(fetched.blockNumber));
    this.equal("the supplied receipt names the status the chain returned",
      num(supplied.status), num(fetched.status));

    const flat = (r) => {
      let logs;
      try {
        logs = findSettlementLogs(r);
      } catch {
        return null;
      }
      return logs.map((l) => [norm(l.address), (l.topics ?? []).map(norm).join(","), norm(l.data)].join("|")).join(";;");
    };
    const a = flat(supplied);
    const b = flat(fetched);
    this.record("the supplied receipt carries the chain's settlement log", a !== null && b !== null && a === b, {
      detail: a === b ? null : "the settlement log in the supplied receipt is not the one the chain returned",
    });
  }

  get verified() {
    return this.checks.every((c) => c.ok || !c.mandatory);
  }
}

function normaliseQuote(q) {
  return {
    ...q,
    version: Number(q.version),
    maxIn: big(q.maxIn),
    amountOut: big(q.amountOut),
    deadline: big(q.deadline),
    policyVersion: Number(q.policyVersion),
    pool: {...q.pool, fee: Number(q.pool.fee), tickSpacing: Number(q.pool.tickSpacing)},
  };
}

/// Verify a receipt against a quote. Offline by default; `online` adds the rows that need a chain.
///
/// @param input.quote        every field of the merchant's quote
/// @param input.merchantSignature the merchant's 65-byte ECDSA signature
/// @param input.receipt      a transaction receipt, in the shape JSON-RPC returns it
/// @param input.expected     {chainId, executor, hook, poolManager, permit2}
/// @param input.merchantConfiguration the resolution preimage, when the caller holds it
/// @param input.block        the containing block, when available, for timestamps and freshness
/// @param input.onRow        called with each row as it is decided, so a caller can stream
export function verifyOffline(input) {
  const v = new Verdict("offline");
  v.onRow = input.onRow ?? null;
  const {q, r, poolId} = runChecks(v, input);
  return finish(v, input, q, r, poolId);
}

/// The whole offline judgement, against a verdict the caller owns — so online mode can add its own
/// rows to the SAME verdict rather than reaching into a finished result and recomputing whether it
/// passed. One definition of "verified", in `Verdict`, and nothing else may decide it.
function runChecks(v, input) {
  const expected = input.expected ?? {};
  const q = normaliseQuote(input.quote ?? {});

  // ---- the transaction itself ----------------------------------------------------------------
  const receipt = input.receipt;
  if (!receipt || typeof receipt !== "object") {
    v.record("a transaction receipt was supplied", false, {detail: "no receipt"});
    return {q, r: null, poolId: null};
  }
  v.record("a transaction receipt was supplied", true);
  v.record("the transaction succeeded", hexToBig(receipt.status ?? "0x0") === 1n, {
    detail: `status ${receipt.status}`,
  });

  const chainIdOk = expected.chainId !== undefined && input.chainId !== undefined
    ? Number(input.chainId) === Number(expected.chainId)
    : expected.chainId !== undefined;
  v.record("the chain is the one the quote was signed for", chainIdOk, {
    detail: expected.chainId === undefined ? "no expected chain id was supplied" : null,
  });

  // ---- finding the settlement, and refusing zero or two ----------------------------------------
  const candidates = v.guard("the receipt's logs are readable", () => findSettlementLogs(receipt)) ?? [];
  v.record("the receipt carries exactly one V2 settlement log", candidates.length === 1, {
    detail: `found ${candidates.length} logs carrying the QuoteSettled topic`,
  });
  if (candidates.length !== 1) return {q, r: null, poolId: null};

  const log = candidates[0];
  v.equal("the settlement was emitted by the expected executor", log.address, expected.executor ?? "");
  v.equal("the log's topic0 is the frozen QuoteSettled signature", log.topics?.[0] ?? "", QUOTE_SETTLED_TOPIC);

  const r = v.guard("the log decodes to the canonical receipt shape", () => decodeSettlementLog(log));
  if (!r) return {q, r: null, poolId: null};
  v.record("the log decodes to the canonical receipt shape", true);
  v.equal("the receipt schema is the one this verifier understands", r.schemaVersion, RECEIPT_SCHEMA_VERSION);

  // ---- the digest, RECOMPUTED --------------------------------------------------------------------
  const recomputed = v.guard("the quote digest recomputes from the quote's own fields", () =>
    quoteDigest(q, {chainId: Number(expected.chainId)}));
  if (recomputed) {
    v.record("the quote digest recomputes from the quote's own fields", true, {detail: recomputed});
    v.equal("the recomputed digest is the digest the receipt records", recomputed, r.quoteDigest);
  }

  // ---- the merchant, RECOVERED ---------------------------------------------------------------------
  let signer;
  if (recomputed) {
    signer = v.guard("the merchant signature satisfies the V2 EOA policy", () =>
      recoverAddress(recomputed, input.merchantSignature ?? "0x"));
    if (signer) {
      v.record("the merchant signature satisfies the V2 EOA policy", true);
      v.equal("the recovered signer is the merchant the quote names", signer, q.merchantSigner);
      v.equal("the recovered signer is the merchant the receipt names", signer, r.merchantSigner);
    }
  }

  // ---- every field the receipt restates ---------------------------------------------------------
  v.equal("quoteId", q.quoteId, r.quoteId);
  v.equal("payer", q.payer, r.payer);
  v.equal("recipient", q.recipient, r.recipient);
  v.equal("tokenIn", q.tokenIn, r.tokenIn);
  v.equal("tokenOut", q.tokenOut, r.tokenOut);
  v.equal("maxIn (base units)", q.maxIn.toString(), r.maxIn.toString());
  v.equal("amountOut (base units)", q.amountOut.toString(), r.amountOut.toString());
  v.equal("hook, as the quote names it", q.hook, r.hook);
  v.equal("policyVersion", q.policyVersion, r.policyVersion);
  if (expected.hook) v.equal("hook, as the caller expected it", r.hook, expected.hook);
  if (expected.executor) v.equal("executor, as the quote names it", q.executor, expected.executor);

  // Base units throughout. Comparing a formatted decimal would make 100.0 and 100.000000 equal and
  // 1e18 and 1000000000000000000 different, which is precisely backwards.
  v.record("the merchant was delivered exactly the invoice", r.deliveredOut === q.amountOut, {
    detail: `invoice ${q.amountOut}, delivered ${r.deliveredOut}`,
  });
  v.record("the payer's signed ceiling was not exceeded", r.actualIn <= q.maxIn, {
    detail: `ceiling ${q.maxIn}, actually spent ${r.actualIn}`,
  });

  const poolId = v.guard("the PoolId recomputes from the complete pool key", () => computePoolId(q.pool));
  if (poolId) {
    v.record("the PoolId recomputes from the complete pool key", true, {detail: poolId});
    v.equal("the recomputed PoolId is the pool the receipt records", poolId, r.poolId);
    v.equal("the pool key's hooks member is the quote's hook", q.pool.hooks, q.hook);
  }

  // ---- the merchant configuration ------------------------------------------------------------------
  verifyMerchantConfiguration(v, input, q, r);

  // ---- time ------------------------------------------------------------------------------------------
  const ts = input.block?.timestamp !== undefined ? hexToBig(input.block.timestamp) : null;
  if (ts !== null) {
    v.record("the settlement happened before the quote's deadline", ts <= q.deadline, {
      detail: `block timestamp ${ts}, deadline ${q.deadline}`,
    });
  } else {
    v.record("the settlement happened before the quote's deadline", false, {
      mandatory: false,
      detail: "no block was supplied, so the deadline could not be placed in time",
    });
  }

  return {q, r, poolId: poolId ?? null};
}

/// Closes `docs/v2/COMPATIBILITY-001.md` without touching the frozen receipt.
///
/// The receipt has no configuration field — deliberately, because adding one changes the event
/// topic and every existing indexer would silently see nothing. What it DOES carry is the quote
/// digest, and the configuration commitment is inside that digest. So the proof runs the other way:
/// rebuild the commitment from the preimage, put it into the quote, rebuild the digest, and require
/// that digest to be the one the receipt records. If it is, the settlement committed to exactly
/// this resolution and to no other.
function verifyMerchantConfiguration(v, input, q, r) {
  const config = input.merchantConfiguration;
  if (!config) {
    v.record("the merchant configuration preimage was supplied", false, {
      mandatory: false,
      detail:
        "without it the receipt still proves WHICH digest was settled, but not which resolution " +
        "that digest committed to",
    });
    return;
  }
  v.record("the merchant configuration preimage was supplied", true);

  const commitment = v.guard("the configuration commitment recomputes from its preimage", () =>
    merchantConfigHash(config));
  if (!commitment) return;
  v.record("the configuration commitment recomputes from its preimage", true, {detail: commitment});
  v.equal("the recomputed commitment is the one the quote carries", commitment, q.merchantConfigHash);

  // Coherence between the resolution and the invoice it produced. A configuration that resolved to
  // one address while the quote pays another is a configuration that was not used.
  v.equal("the configuration resolved to the quote's recipient", config.recipient, q.recipient);
  v.equal("the configuration's payout currency is the quote's tokenOut", config.payoutCurrency, q.tokenOut);
  v.equal("the configuration names the settlement chain", Number(config.chainId), Number(input.expected?.chainId));

  const blockNumber = input.block?.number !== undefined
    ? hexToBig(input.block.number)
    : r?.blockNumber !== undefined && r?.blockNumber !== null
      ? hexToBig(r.blockNumber)
      : null;
  if (blockNumber === null) {
    v.record("the resolution had not expired when the settlement landed", false, {
      mandatory: false,
      detail: "no block number was available to place the settlement against the resolution window",
    });
  } else {
    v.record("the resolution had not expired when the settlement landed", isFresh(config, blockNumber), {
      detail:
        `read at block ${config.resolvedAtBlock}, good for ${config.validForBlocks} blocks, ` +
        `settled at ${blockNumber}`,
    });
  }
}

function finish(v, input, q, r, poolId) {
  const expected = input.expected ?? {};
  return {
    verified: v.verified,
    mode: v.mode,
    checks: v.checks,
    errors: v.errors,
    warnings: v.warnings,
    receipt: r
      ? {
          transactionHash: input.receipt?.transactionHash ?? null,
          blockNumber: input.block?.number ?? input.receipt?.blockNumber ?? null,
          blockTimestamp: input.block?.timestamp ?? null,
          emitter: r.emitter,
          schemaVersion: r.schemaVersion,
          quoteId: r.quoteId,
          quoteDigest: r.quoteDigest,
          merchantSigner: r.merchantSigner,
          recipient: r.recipient,
          payer: r.payer,
          hook: r.hook,
          poolId: r.poolId,
          tokenIn: r.tokenIn,
          actualIn: r.actualIn.toString(),
          maxIn: r.maxIn.toString(),
          tokenOut: r.tokenOut,
          amountOut: r.amountOut.toString(),
          deliveredOut: r.deliveredOut.toString(),
          policyVersion: r.policyVersion,
          matchingReceiptCount: 1,
        }
      : {matchingReceiptCount: countMatching(input.receipt)},
    quote: {
      quoteId: q.quoteId ?? null,
      recomputedDigest: safe(() => quoteDigest(q, {chainId: Number(expected.chainId)})),
      recomputedStructHash: safe(() => hashQuote(q)),
      recomputedPoolId: poolId,
      domainSeparator: safe(() => domainSeparator({chainId: Number(expected.chainId), executor: q.executor})),
      // Never the signature. It is not a secret, but printing it invites a reader to compare
      // signatures rather than digests, which is the mistake this tool exists to prevent.
    },
    merchantConfiguration: input.merchantConfiguration
      ? {
          supplied: true,
          name: input.merchantConfiguration.name,
          namehash: input.merchantConfiguration.namehash,
          recomputedCommitment: safe(() => merchantConfigHash(input.merchantConfiguration)),
          quoteCommitment: q.merchantConfigHash ?? null,
        }
      : {supplied: false, quoteCommitment: q.merchantConfigHash ?? null},
    dependencies: {
      chainId: expected.chainId ?? null,
      executor: expected.executor ?? null,
      hook: expected.hook ?? null,
      poolManager: expected.poolManager ?? null,
      permit2: expected.permit2 ?? null,
    },
    evidence: {
      source: input.source ?? "supplied receipt JSON",
      rpcCalls: 0,
      limitations: LIMITATIONS,
    },
  };
}

function countMatching(receipt) {
  try {
    return findSettlementLogs(receipt).length;
  } catch {
    return 0;
  }
}

const safe = (fn) => {
  try {
    return fn();
  } catch {
    return null;
  }
};

/// Said in the output, every time, because a verifier that only reports its successes teaches its
/// reader to over-read them.
export const LIMITATIONS = [
  "This checks that a receipt records a settlement of the quote you supplied. It is not a legal " +
    "statement that a payment is final, irreversible, or owed.",
  "Offline mode believes the receipt JSON it is given. Only online mode establishes that the " +
    "transaction is in a chain at all.",
  "The merchant signature is checked as an EOA ECDSA signature. Contract signers (ERC-1271) are " +
    "not supported by V2 and are not checked here.",
  "A settlement's absence from a receipt proves nothing about whether an invoice was paid " +
    "elsewhere, by another route, or at another time.",
];

// ---- online mode ---------------------------------------------------------------------------------
//
// Read-only, and read-only by construction rather than by intention: `ReadOnlyRpc` refuses any
// method that is not a query, so this half cannot send a transaction even if a future edit asked it
// to. What online mode adds is the one thing offline mode can never establish — that the receipt
// describes something that is actually in a chain.

/// The two views this verifier is allowed to `eth_call`, DERIVED from their signatures rather than
/// written down. The first draft of this file carried two hand-typed selectors and both were wrong
/// — a selector constant is a bug with a plausible number in it, and it fails as a silent empty
/// return rather than as an error.
const CONSUMED_SELECTOR = selectorOf("consumed(bytes32)");
const EXECUTOR_SELECTOR = selectorOf("EXECUTOR()");

export async function verifyOnline(input, rpc) {
  const v = new Verdict("online");
  v.onRow = input.onRow ?? null;
  const expected = input.expected ?? {};

  const chainId = await v.guardAsync("the endpoint answered with a chain id", async () =>
    Number(BigInt(await rpc.chainId())));
  if (chainId !== undefined) {
    v.record("the endpoint answered with a chain id", true, {detail: String(chainId)});
    v.equal("the endpoint is the chain the quote was signed for", chainId, Number(expected.chainId));
  }

  // ONLINE MODE ALWAYS FETCHES. An earlier version believed the caller's receipt whenever one was
  // supplied, which is how the CLI always calls it, so `eth_getTransactionReceipt` was never issued
  // and a fabricated receipt for a transaction that is not in any chain verified clean. The row was
  // even named "the transaction receipt was fetched" and recorded PASS with the detail "supplied by
  // the caller" — a green row asserting the opposite of what happened. Online mode's one job is to
  // establish that the transaction is in a chain at all, and it cannot do that from the caller's
  // JSON.
  //
  // The caller's copy is not discarded either: it is COMPARED, and a disagreement is a named
  // mandatory failure. Nothing is silently replaced, which was the concern the old comment raised.
  const supplied = input.receipt ?? null;
  const txHash = input.transactionHash ?? supplied?.transactionHash ?? null;

  let receipt = null;
  if (txHash) {
    receipt = await v.guardAsync("the transaction receipt was fetched from the chain", async () => {
      const got = await rpc.receipt(txHash);
      if (!got) throw new Error("the endpoint knows no such transaction");
      return got;
    });
    if (receipt) v.record("the transaction receipt was fetched from the chain", true, {detail: txHash});
  } else {
    v.record("the transaction receipt was fetched from the chain", false, {
      detail: "no transaction hash was supplied, so nothing could be looked up",
    });
  }

  if (receipt && supplied) v.agree(supplied, receipt);

  let block = input.block ?? null;
  if (receipt && !block) {
    block = await v.guardAsync("the containing block was fetched", async () => {
      const got = await rpc.blockByNumber(receipt.blockNumber, false);
      if (!got) throw new Error("the endpoint knows no such block");
      return got;
    });
    if (block) v.record("the containing block was fetched", true, {detail: block.hash});
  }
  if (receipt && block) {
    v.equal("the receipt's block hash is the block the endpoint returned", receipt.blockHash, block.hash);
  }

  const {q, r, poolId} = runChecks(v, {...input, receipt, block, chainId});

  // ---- the deployment the receipt names ----------------------------------------------------------
  if (expected.executor) {
    const code = await v.guardAsync("the expected executor has code on this chain", async () =>
      rpc.code(expected.executor));
    if (code !== undefined) {
      v.record("the expected executor has code on this chain", code && code !== "0x", {
        detail: code === "0x" ? "there is no contract at that address" : `${(code.length - 2) / 2} bytes`,
      });
    }
  }
  if (expected.hook) {
    const code = await v.guardAsync("the expected hook has code on this chain", async () => rpc.code(expected.hook));
    if (code !== undefined) {
      v.record("the expected hook has code on this chain", code && code !== "0x", {
        detail: code === "0x" ? "there is no contract at that address" : `${(code.length - 2) / 2} bytes`,
      });
    }
    // The half of the mutual binding a verifier can see from outside: the hook must name this
    // executor. A quote naming a hook bound to somebody else is a merchant choosing the venue.
    const boundTo = await v.guardAsync("the hook is bound to the expected executor", async () =>
      "0x" + (await rpc.call(expected.hook, EXECUTOR_SELECTOR)).slice(-40));
    if (boundTo) v.equal("the hook is bound to the expected executor", boundTo, expected.executor);
  }

  // ---- code-hash pins, when the caller supplied them ------------------------------------------------
  const pins = input.pins ?? null;
  if (pins) {
    for (const [label, pin] of Object.entries(pins)) {
      // A malformed entry used to `continue` in silence, so a pins file that lost four of its five
      // code hashes to a bad merge produced one row and a report indistinguishable from one where
      // every dependency was compared. An absent result and a broken reporter must not look alike:
      // the entry gets a named, failing, mandatory row of its own, and the number of pin rows now
      // always equals the number of entries in the file.
      if (!pin || !pin.address || !pin.codeHash) {
        v.record(`${label} matches its pinned code hash`, false, {
          detail: !pin
            ? "the pins file has no entry body for this dependency"
            : `the entry is missing ${!pin.address ? "an address" : "a codeHash"}`,
        });
        continue;
      }
      const code = await v.guardAsync(`${label} matches its pinned code hash`, async () => rpc.code(pin.address));
      if (code === undefined) continue;
      const hash = toHex(keccak256(hexBytes(code)));
      v.equal(`${label} matches its pinned code hash`, hash, pin.codeHash);
    }
  }

  // ---- consumption, if the deployed interface exposes it -------------------------------------------
  if (input.checkConsumed && expected.hook && r?.quoteDigest) {
    const answer = await v.guardAsync("the hook records this quote as consumed", async () =>
      rpc.call(expected.hook, CONSUMED_SELECTOR + r.quoteDigest.slice(2)));
    if (answer !== undefined) {
      v.record("the hook records this quote as consumed", BigInt(answer || "0x0") === 1n, {
        detail: "a settled invoice must be marked consumed by its hook",
      });
    }
  }

  const result = finish(v, {...input, receipt, block}, q, r, poolId);
  result.mode = "online";
  result.evidence.source = `read-only JSON-RPC at ${rpc.endpoint}`;
  result.evidence.rpcCalls = rpc.calls;
  if (receipt && block) {
    const head = await v.guardAsync("confirmations", async () => BigInt(await rpc.blockNumber()));
    if (head !== undefined) {
      const depth = head - BigInt(block.number);
      result.evidence.confirmations = Number(depth);
      // Reported, never asserted. How many confirmations are enough is a policy of whoever is
      // relying on this, and a verifier that picked a number would be making that decision for
      // them under the cover of a green tick.
      result.evidence.confirmationNote =
        `observed ${depth} block(s) after the settlement on this endpoint; this verifier does not ` +
        "declare any depth final";
    }
  }
  return result;
}

function hexBytes(hex) {
  const body = hex.slice(2);
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return out;
}
