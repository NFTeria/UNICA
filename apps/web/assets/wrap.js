/**
 * Paying a price that is named in the wrapped native asset out of the plain ETH a wallet holds.
 *
 * WHY THIS EXISTS. A UNICA market converts one asset into another, and on the public test network
 * the asset a customer spends is WETH. Almost nobody holds WETH. They hold ETH, which is the same
 * value behind a one-to-one contract, and a checkout that refuses them is refusing the asset most
 * wallets actually carry. The wrapped asset's own contract turns ETH into it — one call, no route,
 * no rate, no counterparty — so the checkout can make good the difference before it pays.
 *
 * WHY THE DECISION IS A PURE FUNCTION AND NOT A BRANCH IN A CLICK HANDLER. `wrapPlan` decides
 * whether a customer's money moves, and how much of it. A rule that only exists inside an event
 * listener cannot be tested without a browser, and the case that matters most — a wallet with
 * exactly enough ETH for the shortfall and nothing left for the fee — is the one a person would
 * never reproduce by hand. Everything here takes plain values and returns plain values.
 *
 * THE MARGIN IS A FLOOR, NOT AN ESTIMATE. This file does not read a gas price and does not pretend
 * to know what the network will charge. `GAS_MARGIN_WEI` is an amount of ETH the plan refuses to
 * spend, so that a wallet drained to the last wei by the wrap is not then unable to pay the two
 * transactions that follow it. A wallet whose fee turns out to cost more than the margin still has
 * its own refusal; this only stops the app from proposing a sequence it can already see will end
 * with a customer holding WETH they cannot spend.
 *
 * NOTHING HERE NAMES AN ADDRESS. Which asset is wrapped native is decided from the symbol and the
 * decimal count the chain itself answered with, carried in on the configuration object, never from
 * a literal written into this file.
 */
import { fromBaseUnits } from "./product.js";

/** The name a person reads for the chain's own asset — the one their wallet shows a balance of. */
export const NATIVE_SYMBOL = "ETH";

/** The symbol a chain's wrapped native asset answers `symbol()` with. */
export const WRAPPED_NATIVE_SYMBOL = "WETH";

/** The wrapped native asset is one-to-one with the chain's asset, so it carries the same 18 places. */
export const NATIVE_DECIMALS = 18;

/**
 * ETH the plan will not spend on wrapping: 0.001, left behind for the approval and the payment that
 * follow. See the file header — a floor, deliberately, rather than a gas estimate this file is in no
 * position to make.
 */
export const GAS_MARGIN_WEI = 10n ** 15n;

/**
 * Is this the asset the chain's own ETH wraps into?
 *
 * Both halves are required. The symbol alone is a label anybody may choose, and an asset that calls
 * itself WETH while holding a different number of decimal places is not the one-to-one contract this
 * step assumes: sending it ETH would buy an amount nobody here computed. An asset whose label could
 * not be read at all (`symbol: null`, the shape the companion uses for an unread token) is never
 * wrapped, because guessing is how a customer's ETH ends up in a contract that was never identified.
 */
export function isWrappedNative(asset) {
  const symbol = String(asset?.symbol ?? "").trim();
  if (symbol.toUpperCase() !== WRAPPED_NATIVE_SYMBOL) return false;
  return Number(asset?.decimals) === NATIVE_DECIMALS;
}

/** A bigint, or null when the value is missing or is not a whole number of base units. */
function units(value) {
  if (value === null || value === undefined || value === "") return null;
  try {
    const v = typeof value === "bigint" ? value : BigInt(value);
    return v < 0n ? null : v;
  } catch {
    return null;
  }
}

/**
 * How much ETH this payment has to wrap before it can be made, if any.
 *
 * Three answers, kept apart because they are three different facts about a wallet:
 *
 *   { ok: true,  wrap: 0n }        it already holds enough of the wrapped asset; nothing is sent.
 *   { ok: true,  wrap: shortfall } it is short, and its ETH covers the shortfall AND the margin.
 *   { ok: false, wrap: 0n }        it is short in both, and nothing at all may be sent.
 *
 * The wrapped amount is the shortfall EXACTLY. Rounding it up to something convenient would spend
 * a customer's ETH on an asset they did not ask for and cannot spend anywhere else in this product.
 *
 * A balance that could not be read arrives as null and is refused rather than read as zero: an
 * unread balance and an empty one look the same on a screen and mean opposite things here.
 */
export function wrapPlan({ need, wethBalance, ethBalance, gasMargin = GAS_MARGIN_WEI } = {}) {
  const required = units(need);
  const held = units(wethBalance);
  const native = units(ethBalance);
  const margin = units(gasMargin) ?? 0n;
  if (required === null || held === null || native === null) {
    return { ok: false, wrap: 0n, shortfall: 0n, why: "What this wallet holds could not be read, so nothing was sent." };
  }
  if (held >= required) {
    return { ok: true, wrap: 0n, shortfall: 0n, why: "This wallet already holds enough to pay, so nothing is wrapped." };
  }
  const shortfall = required - held;
  if (native < shortfall + margin) {
    return {
      ok: false,
      wrap: 0n,
      shortfall,
      why: "This wallet does not hold enough to pay, and its ETH does not cover the difference and the network fee. Nothing was sent.",
    };
  }
  return { ok: true, wrap: shortfall, shortfall, why: "This wallet's ETH covers the difference, so that much is wrapped first." };
}

/** `0x…`, the hex quantity a transaction's `value` is given as. Never negative, never padded. */
export function weiHex(amount) {
  const v = units(amount);
  if (v === null) throw new Error("a transaction value must be a whole number of wei, and not negative");
  return "0x" + v.toString(16);
}

/** "Wrapping 0.01 ETH to WETH…" — the amount, at the asset's own decimal places, and its own symbol. */
export function wrappingText(amount, asset = {}) {
  const symbol = asset?.symbol ?? WRAPPED_NATIVE_SYMBOL;
  return `Wrapping ${fromBaseUnits(amount ?? 0n, asset?.decimals ?? NATIVE_DECIMALS)} ${NATIVE_SYMBOL} to ${symbol}…`;
}

/**
 * What a customer reads when neither balance is enough. It says the shortfall, says the ETH does not
 * cover it, and says that nothing was sent — because a checkout that goes quiet after a press leaves
 * a person wondering whether they have just paid.
 */
export function shortEthText(shortfall, asset = {}) {
  const symbol = asset?.symbol ?? WRAPPED_NATIVE_SYMBOL;
  const short = fromBaseUnits(shortfall ?? 0n, asset?.decimals ?? NATIVE_DECIMALS);
  return `This payment needs ${short} ${symbol} more than this wallet holds, and its ${NATIVE_SYMBOL} does not cover the difference and the network fee. Nothing was sent.`;
}
