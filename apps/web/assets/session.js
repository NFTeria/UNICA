/**
 * The wallet is the login.
 *
 * There is no account to create and no password to forget. A person opens the site, presses one
 * button, and their wallet's own approval flow is the sign-in. Coming back needs no button at all:
 * a wallet that has already approved this site answers `eth_accounts` without asking anything, so
 * the dashboard can recognise its owner silently and read their business from the chain. Nothing
 * about the business is stored in the browser; the only thing remembered is WHICH address to look
 * for first, and that is a convenience, not a record. Clear it and the chain still knows.
 *
 * On the local testnet there is no browser wallet, so the chain's own unlocked accounts
 * stand in: the person picks one, and from then on it behaves like any other login.
 */
import { connectWallet, discoverProviders, fromHexChainId, makeSession, rpcRequest } from "./wallet.js";
import { payNameFor, readBusinessJoined, readMerchantOf } from "./local-join.js";

export const REMEMBERED_KEY = "unica.wallet";
/** Set by Log out, cleared by the next prompted login. A wallet keeps answering eth_accounts for a
 *  site it approved, so forgetting the address alone logs nobody out: the next load would reconnect
 *  silently. Log out is therefore a marker the browser keeps until the person logs in by choice. */
export const LOGGED_OUT_KEY = "unica.wallet.out";
export const LOCAL_CHAIN_ID = 31337;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO32 = /^0x0{64}$/;

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function sameAddress(a, b) {
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
}

/** Remember which address to look for first. Returns false, never throws, when storage is unavailable. */
export function rememberWallet(address, storage = defaultStorage()) {
  if (!ADDRESS.test(String(address ?? ""))) return false;
  try {
    storage?.setItem(REMEMBERED_KEY, String(address));
    storage?.removeItem(LOGGED_OUT_KEY); // a login by choice lifts a log-out
    return Boolean(storage);
  } catch {
    return false;
  }
}

/** True between Log out and the next prompted login; false when storage cannot be read. */
export function loggedOut(storage = defaultStorage()) {
  try {
    return storage?.getItem(LOGGED_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

/** The remembered address, or null when there is none, it is malformed, or storage cannot be read. */
export function rememberedWallet(storage = defaultStorage()) {
  try {
    const v = storage?.getItem(REMEMBERED_KEY);
    return typeof v === "string" && ADDRESS.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function forgetWallet(storage = defaultStorage()) {
  try {
    storage?.removeItem(REMEMBERED_KEY);
    storage?.setItem(LOGGED_OUT_KEY, "1");
  } catch {
    // nothing to forget, or nowhere it could have been kept
  }
}

/** The accounts the local local testnet itself unlocks; an empty list on any other network. */
export async function practiceAccounts(config, fetchImpl = globalThis.fetch) {
  if (Number(config?.chainId) !== LOCAL_CHAIN_ID || !config?.rpc) return [];
  try {
    const accounts = await rpcRequest(config.rpc, "eth_accounts", [], fetchImpl);
    return Array.isArray(accounts) ? accounts.filter((a) => ADDRESS.test(String(a))) : [];
  } catch {
    return [];
  }
}

/**
 * Recognise a returning owner without a prompt. Every wallet in the browser is asked `eth_accounts`,
 * which a wallet answers only for a site it has already approved; the remembered address wins when
 * it is among the answers, otherwise the first account does. A wallet on another network is
 * skipped, never switched from here. On the local testnet a remembered testnet account is
 * reconnected the same way. Returns { session, wallet } or null; it never throws.
 */
export async function silentReconnect(config, { win = globalThis.window, storage = defaultStorage(), fetchImpl = globalThis.fetch, providers = null } = {}) {
  if (loggedOut(storage)) return null; // the person pressed Log out; no wallet is asked until they log in again
  const wanted = rememberedWallet(storage);
  let list = providers;
  if (!list) {
    try {
      list = win ? await discoverProviders(win) : [];
    } catch {
      list = [];
    }
  }
  for (const entry of list ?? []) {
    const provider = entry?.provider;
    if (!provider) continue;
    try {
      const accounts = await provider.request({ method: "eth_accounts" });
      if (!Array.isArray(accounts) || accounts.length === 0) continue;
      const address = accounts.find((a) => wanted && sameAddress(a, wanted)) ?? accounts[0];
      const chainId = fromHexChainId(await provider.request({ method: "eth_chainId" }));
      if (chainId !== Number(config?.chainId)) continue;
      return { session: makeSession({ kind: "injected", address, chainId, provider, rpc: config?.rpc ?? null, fetchImpl }), wallet: entry.info ?? { name: "Wallet", rdns: "" } };
    } catch {
      // this wallet declined to answer; the next one may not
    }
  }
  if (Number(config?.chainId) === LOCAL_CHAIN_ID && wanted) {
    const accounts = await practiceAccounts(config, fetchImpl);
    const hit = accounts.find((a) => sameAddress(a, wanted));
    if (hit) {
      return { session: makeSession({ kind: "local", address: hit, chainId: LOCAL_CHAIN_ID, rpc: config.rpc, fetchImpl }), wallet: { name: "Testnet account", rdns: "" } };
    }
  }
  return null;
}

/**
 * Log in with a prompt: the wallet's own approval flow, or on the local testnet the account the
 * person chose. The address is remembered so the next visit needs no button. Returns the same
 * shape as connectWallet: { session, wallet, note } or { blocked }.
 */
export async function loginWithWallet(config, { win = globalThis.window, storage = defaultStorage(), fetchImpl = globalThis.fetch, providers = null, localFrom = null } = {}) {
  let list = providers;
  if (!list) {
    try {
      list = win ? await discoverProviders(win) : [];
    } catch {
      list = [];
    }
  }
  const result = await connectWallet({ config, providers: list ?? [], localFrom, fetchImpl });
  if (result?.session?.address) rememberWallet(result.session.address, storage);
  return result;
}

/**
 * What the chain says about this wallet's business.
 *   { available: false, joined: false, reason }  this network has no business sign-up in this release
 *   { available: true,  joined: false }           first time here: the join flow is next
 *   { available: true,  joined: true, name, label, payout, merchantNode, terminalsNode, firstTerminalNode, badgeTokenId }
 * Read live every time; nothing is cached, so a business added from another device shows up on reload.
 */
export async function readBusiness(session, config, fetchImpl = globalThis.fetch) {
  const onboarding = config?.merchantOnboarding ?? null;
  if (!onboarding) {
    // A network with a name authority but no self-serve sign-up: the companion reads the authority's
    // own lineage and resolver records and answers which business pays out to this wallet.
    if (config?.identity && config?.parentName && session?.address) {
      try {
        const res = await fetchImpl(`/local/businesses?wallet=${encodeURIComponent(session.address)}`);
        const body = res && res.ok ? await res.json() : null;
        const first = Array.isArray(body?.businesses) ? body.businesses[0] : null;
        if (first) {
          return {
            available: true,
            joined: true,
            merchantNode: first.merchantNode,
            label: first.label,
            name: first.name,
            payout: first.payout ?? null,
            terminalsNode: first.terminalsNode ?? null,
            firstTerminalNode: first.registers?.[0]?.node ?? null,
            badgeTokenId: null,
            registers: first.registers ?? [],
            controller: Boolean(body?.controller),
          };
        }
      } catch {
        // the companion did not answer: fall through to the honest negative
      }
      return { available: false, joined: false, reason: "No business is registered to this wallet on this network yet." };
    }
    return { available: false, joined: false, reason: "Business sign-up is not available on this network in this release: pay names are set up on Ethereum Sepolia. This wallet can still be read here." };
  }
  const node = await readMerchantOf(session, onboarding, session.address);
  if (!node || ZERO32.test(String(node))) return { available: true, joined: false };
  const joined = await readBusinessJoined(session, onboarding, session.address);
  const label = joined?.label ?? null;
  return {
    available: true,
    joined: true,
    merchantNode: node,
    label,
    name: label ? payNameFor(label, config?.parentName ?? null) : null,
    payout: joined?.payout ?? null,
    terminalsNode: joined?.terminalsNode ?? null,
    firstTerminalNode: joined?.firstTerminalNode ?? null,
    badgeTokenId: joined?.badgeTokenId ?? null,
  };
}

/** Where a person goes after logging in: "join" the first time, "business" when they already own one, "wallet" where sign-up does not exist. */
export function whereTo(business) {
  if (!business?.available) return "wallet";
  return business.joined ? "business" : "join";
}
