// A read-only backend for the treasury page. Node's own http, no framework, no dependency.
//
// WHAT THIS IS FOR. The page needs three things it cannot compute in a browser: the observed
// position from Arc, the policy's decision about it, and the preview that decision implies. This
// serves those three as JSON and serves the page itself. That is the whole surface.
//
// WHAT IT DELIBERATELY DOES NOT DO. There is no route that writes anything. There is no signer, no
// key, no broadcast, and no POST handler — a request that is not a GET is refused before it is
// routed, so a write endpoint cannot be reached even by mistake. The ArcClient it uses is read-only
// by its own method allow-list, so even the reads it can make are bounded.
//
// IT BINDS 127.0.0.1 ONLY. Not 0.0.0.0. A treasury console that answers from the network is a
// treasury console someone else can read, and the position it displays is a merchant's balance.
//
// IT FAILS CLOSED. If the chain id is not Arc's, if the RPC is unreachable, or if the token's
// decimals cannot be read, the endpoint returns an error with a NAMED code and the page renders
// that error. It never falls back to a fixture, and it never substitutes a default scale — an
// offline console that looks like a live one is the exact defect this project publishes advisories
// about, and it would be especially rich to ship it in the module about not assuming numbers.
//
// NO SECRETS. The only configuration is an RPC URL and a set of addresses, all public. Nothing is
// read from the environment except the listen port, and no value is ever logged. The RPC URL is
// operator-editable in DEMO_CONFIG, so every place it is rendered goes through publicEndpoint():
// origin only, never a path or query that could carry a project key.

import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {ARC_TESTNET_RPC, ArcClient, fetchTransport, publicEndpoint} from "./arc.mjs";
import {ACTION, decide} from "./treasury.mjs";
import {buildPreview, isActionable} from "./preview.mjs";
import {label, nativeFromWei, tokenFromWhole} from "./units.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/// The demonstration merchant. Public addresses and public policy numbers — there is nothing here
/// worth hiding, and a console whose configuration had to be secret could not be committed.
///
/// `merchant` is the account whose position is displayed. It is read, never signed for.
export const DEMO_CONFIG = {
  rpc: ARC_TESTNET_RPC,
  token: "0x3600000000000000000000000000000000000000",
  merchant: "0x0000000000000000000000000000000000000000",
  counterparty: "0x2222222222222222222222222222222222222222",
  reserveFloorWhole: 250,
  perActionCapWhole: 500,
  paymentWhole: 400,
  cooldownSeconds: 3600n,
  gasLimit: 65000n,
};

/// Gather the position from the chain. Every number here is a read; the scale comes from the
/// token's own decimals() and from nowhere else.
async function observe(config) {
  const client = new ArcClient({url: config.rpc, transport: fetchTransport()});
  await client.requireArc();                       // fails closed on the wrong chain
  const blockNumber = await client.blockNumber();
  const gasPrice = await client.gasPrice();
  const scale = await client.readTokenScale(config.token);   // refuses if there is no code
  const operatingBalance = await client.tokenBalance(config.token, config.merchant, scale);
  const nativeBalance = await client.nativeBalance(config.merchant);
  return {client, blockNumber, gasPrice, scale, operatingBalance, nativeBalance};
}

/// The position, the decision and (when there is one) the preview, as one JSON document.
///
/// `now` is a parameter with no default that reads a clock — the caller supplies it — so two runs
/// against the same block produce byte-identical output.
/// `lastActionAt` is undefined by default, meaning NO PRIOR ACTION is on record — which is the
/// truth for a console that keeps no history. The policy skips the cooldown branch in that case
/// rather than treating "unknown" as "just now", because a refusal the operator cannot act on is
/// worse than no refusal at all.
export async function report(config = DEMO_CONFIG, now = 0n, lastActionAt = undefined) {
  const o = await observe(config);
  const position = {
    operatingBalance: o.operatingBalance,
    nativeBalance: o.nativeBalance,
    reserveSource: null,
  };
  const policy = {
    reserveFloor: tokenFromWhole(config.reserveFloorWhole, o.scale),
    perActionCap: tokenFromWhole(config.perActionCapWhole, o.scale),
    cooldownSeconds: config.cooldownSeconds,
    approvedCounterparties: [config.counterparty],
    gasBudget: nativeFromWei(config.gasLimit * o.gasPrice),
  };
  const request = {recipient: config.counterparty, amount: tokenFromWhole(config.paymentWhole, o.scale)};
  const decision = decide(position, policy, request, {now, lastActionAt});

  let preview = null, previewError = null;
  if (isActionable(decision)) {
    try {
      preview = buildPreview(decision, {
        from: config.merchant, chainId: 5042002, nonce: null,
        maxFeePerGas: o.gasPrice, gasLimit: config.gasLimit,
        // Origin only: config.rpc is operator-editable and a keyed endpoint would otherwise
        // be served in this JSON and rendered on the page.
        gasEstimate: {source: `eth_gasPrice @ ${publicEndpoint(config.rpc)}`},
      });
    } catch (e) {
      previewError = {code: e.code ?? "UNKNOWN", message: e.message};
    }
  }

  return {
    chain: {name: "Arc testnet", chainId: 5042002, rpc: publicEndpoint(config.rpc), blockNumber: Number(o.blockNumber)},
    /// Both representations, side by side, each labelled. This pairing is the point of the page.
    position: {
      merchant: config.merchant,
      erc20: {
        ...o.operatingBalance.toJSON(),
        label: label(o.operatingBalance),
        scale: o.scale.toJSON(),
      },
      native: {
        ...o.nativeBalance.toJSON(),
        label: label(o.nativeBalance),
        note: "Arc's gas currency. 18 decimals, like every EVM native currency. This is NOT the ERC-20 above and the two cannot be added.",
      },
    },
    policy: {
      reserveFloor: policy.reserveFloor.toJSON(),
      perActionCap: policy.perActionCap.toJSON(),
      cooldownSeconds: Number(policy.cooldownSeconds),
      approvedCounterparties: policy.approvedCounterparties,
      gasBudget: policy.gasBudget.toJSON(),
      gasPriceWei: o.gasPrice.toString(),
    },
    request: {recipient: request.recipient, amount: request.amount.toJSON()},
    decision: {
      action: decision.action,
      reason: decision.reason,
      explanation: decision.explanation,
      amount: decision.amount ? decision.amount.toJSON() : null,
      recipient: decision.recipient,
    },
    preview,
    previewError,
  };
}

/// BigInt does not survive JSON.stringify, and a console that crashed on a large balance would be
/// worse than useless. Serialised as a decimal string, never as a Number — a balance past 2^53
/// silently loses precision as a float, which is its own version of the mistake this module is about.
const serialise = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

function send(res, status, body, type = "application/json") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    // The page is served from this origin and loads nothing else. Stated rather than assumed.
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

export function createTreasuryServer({config = DEMO_CONFIG, now = 0n} = {}) {
  return createServer(async (req, res) => {
    // Anything that is not a read is refused before routing. There is no write route to reach.
    if (req.method !== "GET") {
      return send(res, 405, serialise({error: "METHOD_NOT_ALLOWED", detail: "this console is read-only; there is no endpoint that writes"}));
    }
    const url = new URL(req.url, "http://127.0.0.1");
    try {
      if (url.pathname === "/" || url.pathname === "/app.html") {
        return send(res, 200, readFileSync(resolve(HERE, "app.html"), "utf8"), "text/html; charset=utf-8");
      }
      if (url.pathname === "/api/report") {
        return send(res, 200, serialise(await report(config, now)));
      }
      if (url.pathname === "/api/health") {
        return send(res, 200, serialise({ok: true, readOnly: true, canSign: false, canBroadcast: false}));
      }
      return send(res, 404, serialise({error: "NOT_FOUND", path: url.pathname}));
    } catch (e) {
      // Named, and never replaced by a fixture. The page renders this as a refusal.
      return send(res, 502, serialise({
        error: e.code ?? "UNAVAILABLE",
        message: e.message,
        detail: "This console failed closed. It does not fall back to recorded data, because a page that cannot tell you it is offline is worse than one that will not load.",
      }));
    }
  });
}

// Started only when run directly, so importing this module for a test never opens a socket.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const port = Number(process.env.ARC_TREASURY_PORT ?? 8788);
  createTreasuryServer().listen(port, "127.0.0.1", () => {
    // 127.0.0.1 explicitly. Never 0.0.0.0: this displays a merchant's balance.
    console.log(`arc-treasury console (read-only) on http://127.0.0.1:${port}`);
    console.log("  GET /              the page");
    console.log("  GET /api/report    position, decision, preview");
    console.log("  GET /api/health    what this server can and cannot do");
  });
}
