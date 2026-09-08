// The live Graph client. This is the ONLY way settlement data enters the copilot on the live path.
//
// WHAT IT IS FOR. UNICA's treasury view is not computed from a local file; it is computed from
// whatever the subgraph has actually indexed. That makes The Graph load-bearing rather than
// decorative: if the index is behind, or has errors, or the endpoint answers something other than
// what was asked for, this module REFUSES and the copilot has nothing to reason over. There is no
// degraded mode in which a stale answer is presented as a fresh one.
//
// WHAT IT DELIBERATELY DOES NOT DO.
//   * It never falls back to fixture data. It does not import ./samples.mjs, it names no file, and
//     it reads nothing from disk — so there is no code path from a failed live query to a sample
//     row. `provider-test.mjs` asserts that absence structurally as well as behaviourally, because
//     "we would never do that" is not a property a reader can check.
//   * It never prints, returns, or embeds a credential. `UNICA_SUBGRAPH_URL` may carry the API key
//     inside its path — the gateway's older form does — so every rendered form of the endpoint goes
//     through `redactSecrets` first, and the suite plants a key-shaped string and asserts it never
//     appears in any output.
//   * It never decides freshness from the server that is reporting its own progress. `_meta` says
//     which block the index reached; the chain head comes from an INDEPENDENT source and is passed
//     in. With no head there is no staleness measurement, and with no staleness measurement this
//     module refuses rather than assuming the index is current.
//   * It reads no clock in any path a test asserts on. The timeout is a parameter, `fetch` is a
//     parameter, and the chain head is a parameter.
//
// Run nothing here directly; `live-proof.mjs` is the command.

/// Every way a live read can fail, named. There is no generic catch-all: a caller switching on
/// these can tell "the gateway is down" from "the index is behind" from "the answer was not the
/// shape we asked for", and those three want three different responses from a human.
export const FAILURE = Object.freeze({
  /// UNICA_SUBGRAPH_URL is unset or empty. Nothing was attempted.
  NO_ENDPOINT: "NO_ENDPOINT",
  /// The endpoint is not https. An API key in a cleartext request is a leaked API key.
  ENDPOINT_NOT_HTTPS: "ENDPOINT_NOT_HTTPS",
  /// The URL carries the `[api-key]` placeholder and GRAPH_API_KEY is unset, so it cannot be filled.
  NO_API_KEY: "NO_API_KEY",
  /// No chain head was supplied, so "how far behind is the index" has no answer.
  NO_CHAIN_HEAD: "NO_CHAIN_HEAD",
  /// The head RPC could not be read at all.
  HEAD_UNAVAILABLE: "HEAD_UNAVAILABLE",
  /// The head RPC is a different chain from the one the subgraph indexes. A staleness margin
  /// measured against the wrong chain's head is a number that means nothing and looks fine.
  HEAD_WRONG_CHAIN: "HEAD_WRONG_CHAIN",
  /// The index claims a block far AHEAD of the head. One of the two sources is wrong about which
  /// chain it is on; neither can be trusted to say whether the data is current.
  HEAD_INCONSISTENT: "HEAD_INCONSISTENT",
  /// fetch itself threw: DNS, TLS, connection refused, timeout.
  TRANSPORT_ERROR: "TRANSPORT_ERROR",
  /// A response arrived with a non-200 status.
  HTTP_ERROR: "HTTP_ERROR",
  /// The body is not JSON.
  MALFORMED_JSON: "MALFORMED_JSON",
  /// The body is JSON but is neither a GraphQL result nor a GraphQL error.
  MALFORMED_PAYLOAD: "MALFORMED_PAYLOAD",
  /// A GraphQL `errors` array with no data.
  GRAPHQL_ERRORS: "GRAPHQL_ERRORS",
  /// Data AND errors. Some of the answer is missing and the server said so; a partial treasury view
  /// is a wrong treasury view, so it is refused rather than trimmed.
  PARTIAL_DATA: "PARTIAL_DATA",
  /// `_meta` is absent. Without it there is no indexed block and no indexing-error flag.
  META_MISSING: "META_MISSING",
  /// `_meta.hasIndexingErrors` is true. The rows that exist may be wrong and the ones that should
  /// exist may be missing.
  INDEXING_ERRORS: "INDEXING_ERRORS",
  /// The index is further behind the head than the threshold allows.
  STALE_INDEX: "STALE_INDEX",
  /// The staleness threshold itself is not a number. `Number("twenty-five")` is NaN, and every
  /// comparison against NaN is false — so an unparseable threshold does not loosen the staleness
  /// check, it DELETES it, silently, while the banner still says a threshold is in force. The
  /// threshold is refused rather than defaulted: a caller who asked for a specific margin and got
  /// a different one is owed an error, not a quiet substitution.
  BAD_THRESHOLD: "BAD_THRESHOLD",
  /// A row is missing a field, or a numeric field is not a non-negative integer.
  SHAPE_MISMATCH: "SHAPE_MISMATCH",
});

/// Stamped onto every record this module returns. `samples.mjs` stamps a different value, and the
/// copilot refuses a set whose records do not all carry the same one — so an offline run cannot
/// render as a live one even by accident.
export const LIVE_SOURCE = "LIVE_SUBGRAPH";

export const DEFAULTS = Object.freeze({
  /// Sepolia blocks are ~12s, so 25 blocks is ~5 minutes. A merchant deciding what to hold in
  /// reserve does not need the last block; they do need to know the answer is not from last week.
  maxLagBlocks: 25,
  /// How far the index may be AHEAD of the supplied head before the two sources are treated as
  /// describing different chains. A head RPC being a block or two behind a gateway is ordinary.
  maxHeadDriftBlocks: 5,
  /// Rows per request. The Graph's own page ceiling is 1000.
  pageSize: 200,
  timeoutMs: 15000,
});

/// The fields a settlement row must carry. Every one is checked against schema.graphql by
/// `check.mjs`, so a schema rename fails the gate instead of failing a live demo.
export const SETTLEMENT_FIELDS = Object.freeze([
  "id",
  "quoteId",
  "quoteDigest",
  "payer",
  "merchantSigner",
  "recipient",
  "tokenIn",
  "actualIn",
  "maxIn",
  "tokenOut",
  "amountOut",
  "deliveredOut",
  "executor",
  "policyVersion",
  "transactionHash",
  "logIndex",
  "blockNumber",
  "blockTimestamp",
]);

/// Which of those must parse as a non-negative integer. A string where a number belongs is the
/// failure that silently turns into `NaN` three layers later.
export const NUMERIC_FIELDS = Object.freeze([
  "actualIn",
  "maxIn",
  "amountOut",
  "deliveredOut",
  "policyVersion",
  "logIndex",
  "blockNumber",
  "blockTimestamp",
]);

/// Asked in the SAME request as the rows, deliberately. Two round trips would let the index move
/// between the freshness check and the read, which is the exact race the check exists to close.
export const META_SELECTION = "_meta { deployment hasIndexingErrors block { number hash timestamp } }";

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DIGITS = /^(0|[1-9][0-9]*)$/;

// ---- credentials: read, never rendered --------------------------------------------------------

/// Replace every occurrence of every secret with a marker, then structurally redact anything that
/// SITS where a gateway key sits, so a key nobody told us about is still not printed.
///
/// The second half matters more than the first. If the operator puts the key only in the URL and
/// never sets GRAPH_API_KEY, there is no secret to search for — but the path segment after `/api/`
/// is still a credential. A long opaque segment there is redacted on shape alone.
export function redactSecrets(text, secrets = []) {
  let out = String(text ?? "");
  for (const s of secrets) {
    if (typeof s === "string" && s.length >= 8) out = out.split(s).join("[redacted]");
  }
  // gateway.thegraph.com/api/<key>/subgraphs/... — a long opaque segment right after /api/.
  out = out.replace(/\/api\/[A-Za-z0-9_-]{16,}/g, "/api/[redacted]");
  // Anything still shaped like a bare 32+ character hex or base58 blob adjacent to a key name.
  out = out.replace(/(api[_-]?key["'=: ]+)[A-Za-z0-9_-]{16,}/gi, "$1[redacted]");
  return out;
}

/// The endpoint in a form that is safe to print. Never returns the raw URL.
export function endpointLabel(url, secrets = []) {
  if (typeof url !== "string" || url.length === 0) return "(unset)";
  let shown;
  try {
    const u = new URL(url);
    shown = `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    shown = url;
  }
  return redactSecrets(shown, secrets);
}

/// A head-RPC url in a form that is safe to print.
///
/// SEPARATE from `endpointLabel` on purpose. A subgraph endpoint carries its credential in one
/// known place — the segment after `/api/` — and its other long segments are public deployment ids
/// that a reader needs to see. A node provider's url carries its credential as an ORDINARY path
/// segment and has no public long segments at all: Alchemy puts it after `/v2/`, Infura after
/// `/v3/`, QuickNode and Ankr somewhere else again. So here every long opaque segment is redacted
/// on shape, and the host — which is the part that makes the proof checkable — is kept.
///
/// This exists because the head RPC is PRINTED. A proof whose independent source is secret proves
/// nothing, so the host must be visible; that is not a licence to print the key attached to it.
export function rpcLabel(url, secrets = []) {
  if (typeof url !== "string" || url.length === 0) return "(unset)";
  let shown;
  try {
    const u = new URL(url);
    const path = u.pathname
      .split("/")
      .map((seg) => (/^[A-Za-z0-9_-]{16,}$/.test(seg) ? "[redacted]" : seg))
      .join("/");
    shown = `${u.protocol}//${u.host}${path}`;
  } catch {
    // An unparseable url is exactly where a mistyped key ends up, so nothing of it is shown.
    return "(unparseable url, withheld)";
  }
  return redactSecrets(shown, secrets);
}

/// Resolve the endpoint from the environment. Returns the URL and key for USE, and a label for
/// DISPLAY. A caller that prints `.url` instead of `.label` is the bug this split exists to make
/// obvious in review.
export function resolveEndpoint(env = {}) {
  const raw = typeof env.UNICA_SUBGRAPH_URL === "string" ? env.UNICA_SUBGRAPH_URL.trim() : "";
  const key = typeof env.GRAPH_API_KEY === "string" ? env.GRAPH_API_KEY.trim() : "";
  if (raw.length === 0) {
    return {
      ok: false,
      failure: FAILURE.NO_ENDPOINT,
      reason: "UNICA_SUBGRAPH_URL is not set",
      variable: "UNICA_SUBGRAPH_URL",
    };
  }
  const carriesPlaceholder = raw.includes("[api-key]") || raw.includes("{api-key}");
  if (carriesPlaceholder && key.length === 0) {
    return {
      ok: false,
      failure: FAILURE.NO_API_KEY,
      reason: "UNICA_SUBGRAPH_URL carries the [api-key] placeholder and GRAPH_API_KEY is not set",
      variable: "GRAPH_API_KEY",
    };
  }
  const url = carriesPlaceholder ? raw.split("[api-key]").join(key).split("{api-key}").join(key) : raw;
  if (!url.startsWith("https://")) {
    return {
      ok: false,
      failure: FAILURE.ENDPOINT_NOT_HTTPS,
      reason: "the endpoint is not https; a key sent in cleartext is a disclosed key",
      // Deliberately NOT the URL: a malformed endpoint is exactly where a pasted key ends up.
      label: endpointLabel(url, [key]),
    };
  }
  const secrets = key.length > 0 ? [key] : [];
  return {ok: true, url, key, secrets, label: endpointLabel(url, secrets)};
}

// ---- the query --------------------------------------------------------------------------------

/// Built from SETTLEMENT_FIELDS rather than typed out, so the fields the provider asks for and the
/// fields it validates cannot drift apart. `check.mjs` resolves every one against the schema.
export function buildSettlementQuery({byRecipient = true} = {}) {
  const selection = SETTLEMENT_FIELDS.map((f) => `    ${f}`).join("\n");
  const args = byRecipient
    ? "where: { recipient: $recipient }, orderBy: blockNumber, orderDirection: asc, first: $first, skip: $skip"
    : "orderBy: blockNumber, orderDirection: asc, first: $first, skip: $skip";
  const params = byRecipient
    ? "($recipient: Bytes!, $first: Int!, $skip: Int!)"
    : "($first: Int!, $skip: Int!)";
  return `query UnicaTreasury${params} {
  ${META_SELECTION}
  invoiceSettlements(${args}) {
${selection}
  }
}`;
}

// ---- the read ---------------------------------------------------------------------------------

function fail(failure, reason, extra = {}) {
  return {ok: false, source: null, failure, reason, ...extra};
}

/// One request. Separated from the paging loop so every failure below has exactly one place it can
/// come from, and so the suite can drive each one with a stubbed fetch.
async function once({url, key, secrets, query, variables, fetchImpl, timeoutMs, label}) {
  let response;
  try {
    const headers = {"content-type": "application/json", accept: "application/json"};
    if (key) headers.authorization = `Bearer ${key}`;
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify({query, variables}),
      signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch (e) {
    return fail(FAILURE.TRANSPORT_ERROR, redactSecrets(e?.message ?? String(e), secrets), {endpoint: label});
  }

  const status = typeof response?.status === "number" ? response.status : 0;
  let body;
  try {
    body = await response.text();
  } catch (e) {
    return fail(FAILURE.TRANSPORT_ERROR, redactSecrets(`the body could not be read: ${e?.message ?? e}`, secrets), {
      endpoint: label,
    });
  }

  if (status !== 200) {
    return fail(FAILURE.HTTP_ERROR, `the endpoint answered HTTP ${status}`, {
      status,
      endpoint: label,
      // The body can echo the request, and the request can carry the key.
      detail: redactSecrets(body.slice(0, 400), secrets),
    });
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return fail(FAILURE.MALFORMED_JSON, "the endpoint answered HTTP 200 with a body that is not JSON", {
      endpoint: label,
      detail: redactSecrets(body.slice(0, 200), secrets),
    });
  }

  const hasErrors = Array.isArray(payload?.errors) && payload.errors.length > 0;
  const hasData = payload?.data !== undefined && payload?.data !== null && typeof payload.data === "object";

  if (!hasErrors && !hasData) {
    return fail(FAILURE.MALFORMED_PAYLOAD, "the body is JSON but carries neither `data` nor `errors`", {
      endpoint: label,
      detail: redactSecrets(JSON.stringify(payload).slice(0, 200), secrets),
    });
  }
  if (hasErrors && hasData) {
    return fail(FAILURE.PARTIAL_DATA, "the endpoint returned data AND errors; a partial treasury view is a wrong one", {
      endpoint: label,
      detail: redactSecrets(payload.errors.map((e) => e?.message ?? String(e)).join("; ").slice(0, 400), secrets),
    });
  }
  if (hasErrors) {
    return fail(FAILURE.GRAPHQL_ERRORS, "the endpoint returned a GraphQL errors array", {
      endpoint: label,
      detail: redactSecrets(payload.errors.map((e) => e?.message ?? String(e)).join("; ").slice(0, 400), secrets),
    });
  }
  return {ok: true, data: payload.data};
}

/// `_meta` is judged BEFORE a single row is looked at. A fresh-looking row from a stale index is
/// the failure this whole module exists to prevent, so the freshness verdict cannot be reached
/// after the rows have already been handed to a caller.
export function judgeMeta(meta, {chainHead, maxLagBlocks, maxHeadDriftBlocks, endpoint}) {
  if (meta === undefined || meta === null || typeof meta !== "object") {
    return fail(FAILURE.META_MISSING, "the response carries no `_meta`, so the index's position is unknown", {endpoint});
  }
  if (meta.hasIndexingErrors === true) {
    return fail(FAILURE.INDEXING_ERRORS, "`_meta.hasIndexingErrors` is true; rows may be wrong and rows may be missing", {
      endpoint,
      deployment: meta.deployment ?? null,
    });
  }
  const indexed = meta?.block?.number;
  if (typeof indexed !== "number" || !Number.isInteger(indexed) || indexed < 0) {
    return fail(FAILURE.META_MISSING, "`_meta.block.number` is absent or not an integer", {endpoint});
  }
  if (chainHead === undefined || chainHead === null) {
    return fail(FAILURE.NO_CHAIN_HEAD, "no chain head was supplied, so staleness cannot be measured", {endpoint});
  }
  const head = Number(chainHead);
  if (!Number.isInteger(head) || head < 0) {
    return fail(FAILURE.NO_CHAIN_HEAD, "the supplied chain head is not a block number", {endpoint});
  }
  // The thresholds are checked BEFORE they are used, because the way they fail is invisible.
  // `Number("abc")` is NaN and `lag > NaN` is false, so an unparseable threshold turns the
  // staleness refusal below into a line of code that can never fire while the banner above still
  // claims a margin is being enforced. That is the exact shape of defect this module exists to
  // refuse: a check that looks present and is not.
  for (const [name, value] of [["maxLagBlocks", maxLagBlocks], ["maxHeadDriftBlocks", maxHeadDriftBlocks]]) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      return fail(
        FAILURE.BAD_THRESHOLD,
        `\`${name}\` is ${String(value)}, which is not a non-negative whole number of blocks; `
          + "a threshold that cannot be compared against is not a threshold",
        {endpoint, threshold: name},
      );
    }
  }
  const lag = head - indexed;
  if (lag < -maxHeadDriftBlocks) {
    return fail(
      FAILURE.HEAD_INCONSISTENT,
      `the index reports block ${indexed}, which is ${-lag} blocks AHEAD of the supplied head ${head}`,
      {endpoint, indexedBlock: indexed, chainHead: head, lagBlocks: lag},
    );
  }
  if (lag > maxLagBlocks) {
    return fail(
      FAILURE.STALE_INDEX,
      `the index is ${lag} blocks behind head ${head}; the threshold is ${maxLagBlocks}`,
      {endpoint, indexedBlock: indexed, chainHead: head, lagBlocks: lag, maxLagBlocks},
    );
  }
  return {
    ok: true,
    meta: {
      deployment: meta.deployment ?? null,
      indexedBlock: indexed,
      indexedHash: meta?.block?.hash ?? null,
      indexedTimestamp: meta?.block?.timestamp ?? null,
      chainHead: head,
      lagBlocks: lag,
      maxLagBlocks,
    },
  };
}

/// Every row, every field, checked. A row that fails is not dropped — the whole read is refused,
/// because a treasury total computed from "the rows that happened to parse" is a wrong total that
/// looks like a right one.
export function validateRows(rows, {endpoint}) {
  if (!Array.isArray(rows)) {
    return fail(FAILURE.SHAPE_MISMATCH, "`invoiceSettlements` is not an array", {endpoint});
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row === null || typeof row !== "object") {
      return fail(FAILURE.SHAPE_MISMATCH, `row ${i} is not an object`, {endpoint, rowIndex: i});
    }
    for (const f of SETTLEMENT_FIELDS) {
      if (row[f] === undefined || row[f] === null) {
        return fail(FAILURE.SHAPE_MISMATCH, `row ${i} is missing the field \`${f}\``, {endpoint, rowIndex: i, field: f});
      }
    }
    for (const f of NUMERIC_FIELDS) {
      if (!DIGITS.test(String(row[f]))) {
        return fail(FAILURE.SHAPE_MISMATCH, `row ${i} field \`${f}\` is not a non-negative integer`, {
          endpoint,
          rowIndex: i,
          field: f,
        });
      }
    }
    for (const f of ["payer", "recipient", "tokenIn", "tokenOut", "executor", "merchantSigner"]) {
      if (!HEX_ADDRESS.test(String(row[f]))) {
        return fail(FAILURE.SHAPE_MISMATCH, `row ${i} field \`${f}\` is not a 20-byte address`, {
          endpoint,
          rowIndex: i,
          field: f,
        });
      }
    }
  }
  return {ok: true, rows};
}

/// Read a merchant's settlements from the live subgraph.
///
/// `chainHead` is REQUIRED and comes from somewhere other than this endpoint. `fetchImpl` is a
/// parameter so the suite can drive every failure above without a network, and so this file has no
/// hidden dependency on a global.
export async function fetchSettlements({
  env = {},
  chainHead = null,
  recipient = null,
  fetchImpl = globalThis.fetch,
  maxLagBlocks = DEFAULTS.maxLagBlocks,
  maxHeadDriftBlocks = DEFAULTS.maxHeadDriftBlocks,
  pageSize = DEFAULTS.pageSize,
  maxPages = 25,
  timeoutMs = DEFAULTS.timeoutMs,
} = {}) {
  const endpoint = resolveEndpoint(env);
  // `label` is the printable form and `endpoint` is what renderFailure looks for; a refusal that
  // could not say WHICH endpoint it was talking about would be the least useful kind.
  if (!endpoint.ok) return {...endpoint, endpoint: endpoint.label ?? "(unset)", source: null};
  if (typeof fetchImpl !== "function") {
    return fail(FAILURE.TRANSPORT_ERROR, "no fetch implementation is available", {endpoint: endpoint.label});
  }
  if (chainHead === undefined || chainHead === null) {
    return fail(FAILURE.NO_CHAIN_HEAD, "no chain head was supplied, so staleness cannot be measured", {
      endpoint: endpoint.label,
    });
  }

  const byRecipient = typeof recipient === "string" && recipient.length > 0;
  const query = buildSettlementQuery({byRecipient});
  const all = [];
  let meta = null;

  for (let page = 0; page < maxPages; page++) {
    const variables = byRecipient
      ? {recipient: recipient.toLowerCase(), first: pageSize, skip: page * pageSize}
      : {first: pageSize, skip: page * pageSize};

    const res = await once({
      url: endpoint.url,
      key: endpoint.key,
      secrets: endpoint.secrets,
      query,
      variables,
      fetchImpl,
      timeoutMs,
      label: endpoint.label,
    });
    if (!res.ok) return {...res, source: null};

    // Freshness first, on every page. A page fetched after the index moved backwards through a
    // reorg is not a page that should be silently appended to the previous one.
    const judged = judgeMeta(res.data?._meta, {
      chainHead,
      maxLagBlocks,
      maxHeadDriftBlocks,
      endpoint: endpoint.label,
    });
    if (!judged.ok) return {...judged, source: null};
    if (meta !== null && judged.meta.indexedBlock !== meta.indexedBlock) {
      return fail(
        FAILURE.PARTIAL_DATA,
        `the index moved from block ${meta.indexedBlock} to ${judged.meta.indexedBlock} mid-read; the pages are not one snapshot`,
        {endpoint: endpoint.label},
      );
    }
    meta = judged.meta;

    const valid = validateRows(res.data?.invoiceSettlements, {endpoint: endpoint.label});
    if (!valid.ok) return {...valid, source: null};

    for (const row of valid.rows) all.push({...row, source: LIVE_SOURCE});
    if (valid.rows.length < pageSize) {
      return {
        ok: true,
        source: LIVE_SOURCE,
        endpoint: endpoint.label,
        meta,
        settlements: all,
        pages: page + 1,
      };
    }
  }
  return fail(FAILURE.PARTIAL_DATA, `more than ${maxPages * pageSize} rows; the read was not completed`, {
    endpoint: endpoint.label,
  });
}

// ---- the chain head, from somewhere other than the gateway --------------------------------------

/// Chain ids for the networks a UNICA subgraph may name. Used to prove the head being compared
/// against is the head of the chain the subgraph indexes.
export const NETWORK_CHAIN_ID = Object.freeze({
  mainnet: 1,
  sepolia: 11155111,
});

/// Read the head block from an ordinary JSON-RPC endpoint, and prove it is the right chain first.
/// Read-only: eth_chainId and eth_blockNumber, nothing else.
export async function fetchChainHead({
  rpcUrl,
  expectedChainId = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULTS.timeoutMs,
} = {}) {
  if (typeof rpcUrl !== "string" || rpcUrl.length === 0) {
    return fail(FAILURE.HEAD_UNAVAILABLE, "no head RPC url was supplied");
  }
  if (typeof fetchImpl !== "function") {
    return fail(FAILURE.HEAD_UNAVAILABLE, "no fetch implementation is available");
  }
  const call = async (method) => {
    const r = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params: []}),
      signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    if (r.status !== 200) throw new Error(`${method} answered HTTP ${r.status}`);
    const j = JSON.parse(await r.text());
    if (j?.error) throw new Error(`${method}: ${j.error?.message ?? "error"}`);
    if (typeof j?.result !== "string") throw new Error(`${method} returned no result`);
    return j.result;
  };

  let chainIdHex;
  let headHex;
  try {
    chainIdHex = await call("eth_chainId");
    headHex = await call("eth_blockNumber");
  } catch (e) {
    return fail(FAILURE.HEAD_UNAVAILABLE, redactSecrets(String(e?.message ?? e)), {rpc: rpcLabel(rpcUrl)});
  }
  const chainId = Number.parseInt(chainIdHex, 16);
  const head = Number.parseInt(headHex, 16);
  if (!Number.isInteger(chainId) || !Number.isInteger(head)) {
    return fail(FAILURE.HEAD_UNAVAILABLE, "the head RPC returned values that are not numbers", {rpc: rpcLabel(rpcUrl)});
  }
  if (expectedChainId !== null && chainId !== expectedChainId) {
    return fail(
      FAILURE.HEAD_WRONG_CHAIN,
      `the head RPC is chain ${chainId}; the subgraph indexes chain ${expectedChainId}`,
      {rpc: rpcLabel(rpcUrl), chainId, expectedChainId},
    );
  }
  return {ok: true, chainId, blockNumber: head, rpc: rpcLabel(rpcUrl)};
}

/// One line per failure, safe to print. Every rendered path goes through `redactSecrets`, and the
/// suite proves it by planting a key-shaped string and asserting it never comes back out.
export function renderFailure(result, secrets = []) {
  const parts = [`REFUSED  ${result.failure}`, `         ${result.reason}`];
  if (result.endpoint) parts.push(`         endpoint ${result.endpoint}`);
  if (result.indexedBlock !== undefined) {
    parts.push(`         indexed block ${result.indexedBlock}, head ${result.chainHead}, lag ${result.lagBlocks}`);
  }
  if (result.detail) parts.push(`         ${result.detail}`);
  if (result.variable) parts.push(`         missing variable: ${result.variable}`);
  return redactSecrets(parts.join("\n"), secrets);
}
