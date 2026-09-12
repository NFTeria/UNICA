/**
 * The wallet layer for every browser screen under apps/web: one place that finds a wallet, connects
 * it, checks its network, and sends a transaction. The pay screen and the join screen both import
 * this file and neither talks to a provider directly.
 *
 * WHAT IT DISCOVERS. Wallets announced through EIP-6963 (`eip6963:announceProvider` events, so
 * several installed wallets can coexist without fighting over one global) and the older single
 * `window.ethereum` object (EIP-1193). Any wallet that speaks EIP-1193 connects: no wallet is named
 * or special-cased here.
 *
 * WHAT IT NEVER DOES. It never asks for, reads, stores, or forwards a private key or a recovery
 * phrase. An injected wallet signs inside its own extension; the local fallback signs nothing at
 * all, because the loopback chain's own already-unlocked account executes `eth_sendTransaction`
 * from a `from` address with no key anywhere in the page. There is no code path in this file that
 * accepts secret material, and apps/web/tests/wallet.test.mjs asserts that the words for such
 * material do not appear in this source.
 *
 * WHY THE CHOOSER IS A PURE FUNCTION. Which path a screen takes (injected wallet, ask to switch
 * network, local unlocked account, or blocked with a sentence) is a decision that must be right
 * before a person sees a button, and a decision that depends on the DOM cannot be tested without
 * a browser. `chooseProvider(state)` takes plain facts and returns a plain verdict; the DOM code
 * around it only gathers the facts and shows the verdict.
 */

// ---- chain names, in the words a business owner reads -------------------------------------------

export const LOCAL_CHAIN_ID = 31337;
export const SEPOLIA_CHAIN_ID = 11155111;

/** The network as a person sees it. No chain id is shown outside a "details" disclosure. */
export function networkName(chainId) {
  const id = Number(chainId);
  if (id === LOCAL_CHAIN_ID) return "Local practice network";
  if (id === SEPOLIA_CHAIN_ID) return "Sepolia test network";
  if (id === 84532) return "Base Sepolia test network";
  if (id === 421614) return "Arbitrum Sepolia test network";
  if (id === 1301) return "Unichain Sepolia test network";
  if (id === 46630) return "Robinhood Chain test network";
  if (Number.isFinite(id)) return `Network ${id}`;
  return "Unknown network";
}

/** True for every network this site may run on: none of them carries real value. */
export function isPracticeNetwork(chainId) {
  return Number(chainId) !== 1;
}

export const PRACTICE_MODE_LABEL = "Practice mode, test money only";

export function toHexChainId(chainId) {
  return "0x" + Number(chainId).toString(16);
}

export function fromHexChainId(hex) {
  if (hex === undefined || hex === null) return null;
  return typeof hex === "string" ? Number(BigInt(hex)) : Number(hex);
}

// ---- the pure chooser -----------------------------------------------------------------------------

/**
 * Decide which provider a screen uses.
 *
 * `state`:
 *   injected          boolean, an EIP-1193 provider was found in this browser
 *   injectedChainId   number or null, the chain that provider reports
 *   configuredChainId number, the chain this page's runtime configuration names
 *
 * Returns one of:
 *   { kind: "injected" }                          use the wallet as is
 *   { kind: "switch", from, to, sentence }        ask the wallet to switch; `sentence` is what the
 *                                                 screen says if the wallet declines
 *   { kind: "local", sentence }                   no wallet, local practice network: use the
 *                                                 chain's own unlocked account
 *   { kind: "blocked", sentence }                 nothing can send; `sentence` says why in plain words
 */
export function chooseProvider(state = {}) {
  const configured = Number(state.configuredChainId);
  if (!Number.isFinite(configured)) {
    return { kind: "blocked", sentence: "This page has not been told which network to use, so nothing can be sent." };
  }
  if (state.injected) {
    const walletChain = state.injectedChainId === null || state.injectedChainId === undefined ? null : Number(state.injectedChainId);
    if (walletChain === configured) return { kind: "injected" };
    return {
      kind: "switch",
      from: walletChain,
      to: configured,
      sentence: `Your wallet is on ${networkName(walletChain)}. This page works on ${networkName(configured)}. Switch your wallet to continue; nothing is sent from the wrong network.`,
    };
  }
  if (configured === LOCAL_CHAIN_ID) {
    return {
      kind: "local",
      sentence: "No wallet was found in this browser, so the local practice network's own test account will be used. Nothing here has value.",
    };
  }
  return {
    kind: "blocked",
    sentence: `No wallet was found in this browser. Install a browser wallet, open it on ${networkName(configured)}, and reload this page.`,
  };
}

// ---- discovery ------------------------------------------------------------------------------------

/**
 * Find every EIP-1193 provider in this browser. `win` is the window (or a test double with
 * addEventListener / removeEventListener / dispatchEvent and an optional `ethereum`). Resolves
 * after `timeoutMs`, because EIP-6963 wallets announce themselves asynchronously and there is no
 * "done" signal.
 */
export function discoverProviders(win, { timeoutMs = 300, setTimeoutImpl = setTimeout } = {}) {
  return new Promise((resolve) => {
    const found = [];
    const seen = new Set();
    const add = (info, provider) => {
      if (!provider || seen.has(provider)) return;
      seen.add(provider);
      found.push({ info: info ?? { name: "Browser wallet", rdns: "" }, provider });
    };
    const onAnnounce = (event) => {
      const detail = event?.detail;
      if (detail?.provider) add(detail.info, detail.provider);
    };
    if (win && typeof win.addEventListener === "function") {
      win.addEventListener("eip6963:announceProvider", onAnnounce);
      try {
        const EventCtor = win.Event ?? (typeof Event !== "undefined" ? Event : null);
        if (EventCtor) win.dispatchEvent(new EventCtor("eip6963:requestProvider"));
      } catch {
        // A wallet that cannot be asked will still be found through window.ethereum below.
      }
    }
    setTimeoutImpl(() => {
      if (win && typeof win.removeEventListener === "function") win.removeEventListener("eip6963:announceProvider", onAnnounce);
      if (win?.ethereum) add({ name: "Browser wallet", rdns: "" }, win.ethereum);
      resolve(found);
    }, timeoutMs);
  });
}

/** Pick one provider from the discovered list: the remembered one if present, else the first. */
export function pickProvider(list, preferredRdns = null) {
  if (!Array.isArray(list) || list.length === 0) return null;
  if (preferredRdns) {
    const match = list.find((p) => p.info?.rdns === preferredRdns);
    if (match) return match;
  }
  return list[0];
}

// ---- JSON-RPC over fetch, to the configured endpoint --------------------------------------------

export async function rpcRequest(rpcUrl, method, params = [], fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method} refused: ${body.error.message}`);
  return body.result;
}

// ---- injected wallet actions --------------------------------------------------------------------

export async function connectInjected(provider) {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const chainHex = await provider.request({ method: "eth_chainId" });
  return { address: accounts?.[0] ?? null, chainId: fromHexChainId(chainHex) };
}

/**
 * Ask the wallet to switch. Resolves `{ ok: true }` or `{ ok: false, sentence }`; never throws,
 * because a declined switch is an ordinary outcome the screen must say in one sentence.
 */
export async function switchChain(provider, chainId) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHexChainId(chainId) }] });
    const now = fromHexChainId(await provider.request({ method: "eth_chainId" }));
    if (now === Number(chainId)) return { ok: true };
    return { ok: false, sentence: `Your wallet is still on ${networkName(now)}. Switch it to ${networkName(chainId)} to continue.` };
  } catch (e) {
    const code = e?.code;
    if (code === 4902) {
      return { ok: false, sentence: `Your wallet does not know ${networkName(chainId)} yet. Add it in the wallet, then reload this page.` };
    }
    if (code === 4001) {
      return { ok: false, sentence: `You declined the network switch. Nothing was sent. Switch to ${networkName(chainId)} when you are ready.` };
    }
    return { ok: false, sentence: `Your wallet could not switch to ${networkName(chainId)}: ${e?.message ?? "unknown reason"}.` };
  }
}

// ---- the session a screen holds -----------------------------------------------------------------

/**
 * Build a session object from a chosen path. Both kinds expose the same three calls so a screen
 * never branches on where the signature comes from:
 *   send(tx)  -> transaction hash. `tx` is {to, data, value?}; `from` is added here.
 *   call(tx)  -> eth_call result (hex), read through the configured RPC when one is named.
 *   request(method, params) -> raw JSON-RPC, through the configured RPC when one is named.
 */
export function makeSession({ kind, address, chainId, provider = null, rpc = null, fetchImpl = globalThis.fetch }) {
  const viaRpc = (method, params) => rpcRequest(rpc, method, params, fetchImpl);
  const viaWallet = (method, params) => provider.request({ method, params });
  const read = rpc ? viaRpc : viaWallet;
  return {
    kind,
    address,
    chainId: Number(chainId),
    networkName: networkName(chainId),
    async send(tx) {
      const payload = { ...tx, from: address };
      if (kind === "injected") return viaWallet("eth_sendTransaction", [payload]);
      if (kind === "local") return viaRpc("eth_sendTransaction", [payload]);
      throw new Error("This session cannot send: no wallet is connected.");
    },
    call(tx) {
      return read("eth_call", [tx, "latest"]);
    },
    request(method, params = []) {
      return read(method, params);
    },
  };
}

/**
 * Wait for a receipt. Returns null after `timeoutMs`; the caller says "not confirmed yet" rather
 * than guessing, because an unmined transaction and a failed one look identical until the chain
 * answers.
 */
export async function waitForReceipt(session, hash, { intervalMs = 500, timeoutMs = 60000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const receipt = await session.request("eth_getTransactionReceipt", [hash]);
    if (receipt) return receipt;
    await sleep(intervalMs);
  }
  return null;
}

/**
 * The whole connect flow, from discovered providers to a session or a sentence.
 *
 *   config    { rpc, chainId }  from /local/config.json
 *   providers the list `discoverProviders` returned
 *   localFrom the address to use on the local practice network (the demo record's payer, or ?as=)
 *
 * Resolves { session } or { blocked: sentence }. Every branch that stops says why.
 */
export async function connectWallet({ config, providers, localFrom = null, preferredRdns = null, fetchImpl = globalThis.fetch }) {
  const picked = pickProvider(providers, preferredRdns);
  let injectedChainId = null;
  if (picked) {
    try {
      injectedChainId = fromHexChainId(await picked.provider.request({ method: "eth_chainId" }));
    } catch {
      injectedChainId = null;
    }
  }
  let verdict = chooseProvider({ injected: Boolean(picked), injectedChainId, configuredChainId: config?.chainId });

  if (verdict.kind === "switch") {
    const switched = await switchChain(picked.provider, config.chainId);
    if (!switched.ok) return { blocked: switched.sentence };
    verdict = { kind: "injected" };
  }
  if (verdict.kind === "blocked") return { blocked: verdict.sentence };

  if (verdict.kind === "injected") {
    const { address, chainId } = await connectInjected(picked.provider);
    if (!address) return { blocked: "The wallet connected but shared no account. Unlock it and try again." };
    if (chainId !== Number(config.chainId)) {
      return { blocked: `Your wallet moved to ${networkName(chainId)} while connecting. Switch it back to ${networkName(config.chainId)} and try again.` };
    }
    return { session: makeSession({ kind: "injected", address, chainId, provider: picked.provider, rpc: config.rpc ?? null, fetchImpl }), wallet: picked.info };
  }

  // Local practice network, no wallet: the chain's own unlocked accounts.
  const accounts = await rpcRequest(config.rpc, "eth_accounts", [], fetchImpl);
  const address = localFrom ?? accounts?.[0] ?? null;
  if (!address) return { blocked: "The local practice network reported no account to use." };
  return { session: makeSession({ kind: "local", address, chainId: config.chainId, rpc: config.rpc, fetchImpl }), wallet: { name: "Local practice account", rdns: "" }, note: verdict.sentence };
}
