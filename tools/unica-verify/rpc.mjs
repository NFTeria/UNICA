// A read-only JSON-RPC client, with the read-only part enforced rather than promised.
//
// The verifier's online mode exists to CHECK a chain, never to change one. So the method name is
// matched against a fixed list before the request is built: anything that could sign, send, unlock,
// impersonate or mine is refused here, in one place, instead of relying on nobody ever adding such
// a call later. `eth_call` is on the list because a static call is a read; `eth_sendTransaction`
// and every `anvil_*`/`hardhat_*` cheat are not on it, and cannot be.
//
// IT NEVER PRINTS THE ENDPOINT. An RPC URL routinely carries a key in its path or query, so the
// URL is redacted on the way into every error message. A verifier that leaks the operator's
// endpoint in a stack trace has failed at something more important than verification.

const READ_ONLY_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getCode",
  "eth_getLogs",
  "eth_call",
]);

/// Everything that could identify the operator or carry a key: userinfo, the query string, and the
/// path. What survives is the scheme, the host and the port, which is all an error needs to say.
export function redactUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname && u.pathname !== "/" ? "/…" : "";
    return `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}${path}`;
  } catch {
    return "<an endpoint that is not a URL>";
  }
}

/// Scrubs an endpoint out of any text before it is shown. Errors thrown by `fetch` embed the URL
/// they were given, so redacting only the messages this file writes is not enough.
export function scrub(text, url) {
  const asText = String(text ?? "");
  if (!url) return asText;
  const safe = redactUrl(url);
  let out = asText.split(url).join(safe);
  try {
    const u = new URL(url);
    if (u.password || u.username) out = out.split(`${u.username}:${u.password}`).join("…");
    out = out.split(u.origin + u.pathname).join(safe);
  } catch {
    /* a URL we could not parse has already been replaced wholesale above */
  }
  return out;
}

export class ReadOnlyRpc {
  constructor(url, {timeoutMs = 20000} = {}) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.calls = 0;
  }

  get endpoint() {
    return redactUrl(this.url);
  }

  async send(method, params = []) {
    if (!READ_ONLY_METHODS.has(method)) {
      throw new Error(`refusing to call ${method}: this client is read-only by construction`);
    }
    this.calls++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await fetch(this.url, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({jsonrpc: "2.0", id: this.calls, method, params}),
        signal: controller.signal,
      });
    } catch (e) {
      throw new Error(`${method} could not reach ${this.endpoint}: ${scrub(e.message, this.url)}`);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`${method} at ${this.endpoint} answered HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`${method} at ${this.endpoint} returned an error: ${body.error.message}`);
    return body.result;
  }

  chainId = () => this.send("eth_chainId");
  code = (address, block = "latest") => this.send("eth_getCode", [address, block]);
  receipt = (txHash) => this.send("eth_getTransactionReceipt", [txHash]);
  transaction = (txHash) => this.send("eth_getTransactionByHash", [txHash]);
  blockByNumber = (numberHex, full = false) => this.send("eth_getBlockByNumber", [numberHex, full]);
  blockNumber = () => this.send("eth_blockNumber");
  logs = (filter) => this.send("eth_getLogs", [filter]);
  call = (to, data, block = "latest") => this.send("eth_call", [{to, data}, block]);
}
