/**
 * The product rules, as pure functions: what a business may accept, which settlement path a
 * payment takes, what a person is allowed to read on screen, and which network label is honest.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE SCREENS. Every rule below decides something a business
 * owner or a customer acts on: whether an asset can be paid with, whether "Paid" may appear,
 * whether the page may call a chain a real one. A rule that only exists inside a click handler
 * cannot be tested without a browser, and a rule that cannot be tested is a rumour. Everything
 * here takes plain values and returns plain values, so apps/web/tests/product.test.mjs exercises
 * the real rule rather than a paraphrase of it.
 *
 * NOTHING HERE READS A NETWORK, A FILE OR A CLOCK IT WAS NOT GIVEN. Time is always an argument.
 * The active deployment always arrives as the configuration object the local server answers with,
 * never as a literal address written into this file.
 *
 * THE PAID RULE IS NOT REWRITTEN HERE. `paymentStatus` is imported from
 * tools/unica-pos-cli/render.mjs, the one place UNICA states that a payment is paid only when the
 * evidence decision is VERIFIED, and re-exported so a screen has exactly one place to import it
 * from. Any second implementation of that rule would be a second answer to the only question that
 * matters at a counter.
 */
import { canAuthorizePayment, canInitiateSale, paymentStatus } from "../../../tools/unica-pos-cli/render.mjs";

export { canAuthorizePayment, canInitiateSale, paymentStatus };

// ---- the words on screen ------------------------------------------------------------------------

/**
 * The protocol phrase a person must never read, and the sentence they read instead. This is the
 * whole map, in one place, so a screen cannot invent a friendlier synonym for one of them and
 * quietly diverge from the rest of the product.
 */
export const LANGUAGE = Object.freeze({
  "Create market": "Enable payment option",
  "Execute swap": "Process payment",
  "Market active": "Payment option available",
  "No route": "This payment asset is temporarily unavailable",
  "Insufficient liquidity": "This amount cannot currently be converted safely",
  "Admission gate": "Authorized terminal",
  "Settlement evidence": "Payment verification",
  "Output token": "Payout asset",
});

/** The phrase a person reads. An unmapped phrase comes back untouched, never blanked. */
export function inBusinessWords(phrase) {
  return Object.prototype.hasOwnProperty.call(LANGUAGE, phrase) ? LANGUAGE[phrase] : phrase;
}

/**
 * Words that belong to the machinery, not to a person paying for a haircut. They are allowed
 * inside the "Advanced verification" disclosure and nowhere else, which is why this function
 * reports the offenders rather than answering a bare yes or no: a caller has to be able to say
 * WHICH word leaked.
 */
export const MACHINE_WORDS = Object.freeze([
  "hook",
  "executor",
  "registry",
  "pool",
  "tick",
  "feed",
  "calldata",
]);

export function machineWordsIn(text) {
  const found = [];
  for (const word of MACHINE_WORDS) {
    if (new RegExp(`\\b${word}s?\\b`, "i").test(String(text ?? ""))) found.push(word);
  }
  return found;
}

// ---- the environment label ------------------------------------------------------------------------

/** The one manifest value that permits the word "mainnet" anywhere on a screen. */
export const MAINNET_ENVIRONMENT = "PUBLIC_MAINNET";

/** Chains this product is built and tested on. Neither carries value. */
export const LOCAL_CHAIN_ID = 31337;
export const SEPOLIA_CHAIN_ID = 11155111;

export const NO_VALUE_BANNER = "Testnet · no real money";

/**
 * Decide what this build may call the chain it is pointed at.
 *
 * The rule is deliberately asymmetric. A testnet label costs nothing if it is wrong; a mainnet
 * label on a local testnet invites somebody to send real money to a fixture. So "mainnet" is
 * granted only when the manifest itself declares the environment PUBLIC_MAINNET, and a build on
 * 31337 or 11155111 shows the no-value banner no matter what any other field claims.
 *
 * Returns { mainnet, banner, networkName, reason } where `banner` is null only for a real mainnet.
 */
export function validateEnvironment(manifest = {}) {
  const chainId = manifest?.chainId === undefined || manifest?.chainId === null ? null : Number(manifest.chainId);
  const environment = manifest?.environment ?? null;
  const known = chainId === LOCAL_CHAIN_ID || chainId === SEPOLIA_CHAIN_ID;

  if (known) {
    return {
      mainnet: false,
      banner: NO_VALUE_BANNER,
      networkName: chainId === LOCAL_CHAIN_ID ? "Local testnet" : "Sepolia test network",
      reason: "This network is a test network. Nothing on it has value.",
    };
  }
  if (environment === MAINNET_ENVIRONMENT) {
    return {
      mainnet: true,
      banner: null,
      networkName: chainId === null ? "Public network" : `Public network ${chainId}`,
      reason: "The active deployment declares a public network.",
    };
  }
  return {
    mainnet: false,
    banner: NO_VALUE_BANNER,
    networkName: chainId === null ? "Unnamed network" : `Network ${chainId}`,
    reason: "The active deployment does not declare a public network, so this is treated as a test network.",
  };
}

// ---- assets -----------------------------------------------------------------------------------------

export const ASSET_STATUS = Object.freeze({
  DIRECT: "DIRECT",
  CONVERSION: "CONVERSION",
  UNAVAILABLE: "UNAVAILABLE",
});

/** The sentence a business owner reads for each status. */
export const ASSET_STATUS_TEXT = Object.freeze({
  DIRECT: "Available for direct payment",
  CONVERSION: "Available with conversion",
  UNAVAILABLE: "Temporarily unavailable",
});

const sameAddress = (a, b) =>
  Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();

/** True when `marketPair` can convert between exactly these two assets, and is open for business. */
export function marketPairCovers(marketPair, fromAddress, toAddress) {
  if (!marketPair || marketPair.active !== true) return false;
  const a = marketPair.currency0;
  const b = marketPair.currency1;
  return (
    (sameAddress(a, fromAddress) && sameAddress(b, toAddress)) ||
    (sameAddress(b, fromAddress) && sameAddress(a, toAddress))
  );
}

/**
 * What a business may tell a customer about one payment asset.
 *
 * `config` is the object the local server answers with: { assets, marketPair, contracts }.
 * A route is claimed ONLY when the active deployment carries the thing that would perform it —
 * the direct settler for a same-asset payment, an open market pair for a converted one. An
 * unbuilt direct settler is therefore "temporarily unavailable" rather than a promise the
 * checkout would later have to break.
 */
export function assetStatusFor(asset, { payoutAsset, marketPair = null, directSettlement = null } = {}) {
  const address = asset?.address ?? asset;
  const payout = payoutAsset?.address ?? payoutAsset;
  if (!address || !payout) {
    return { status: ASSET_STATUS.UNAVAILABLE, text: ASSET_STATUS_TEXT.UNAVAILABLE, why: "This payment asset is temporarily unavailable." };
  }
  // An asset whose own symbol and decimal count could not be read is not offered, whatever route
  // might exist for it. Accepting a payment in an asset this product cannot name or count would
  // mean showing a customer an amount nobody has checked the precision of.
  if (asset?.labelled === false || payoutAsset?.labelled === false) {
    return {
      status: ASSET_STATUS.UNAVAILABLE,
      text: ASSET_STATUS_TEXT.UNAVAILABLE,
      why: "This asset could not be labelled from the network, so it is not offered.",
    };
  }
  if (sameAddress(address, payout)) {
    if (!directSettlement) {
      return {
        status: ASSET_STATUS.UNAVAILABLE,
        text: ASSET_STATUS_TEXT.UNAVAILABLE,
        why: "Taking this asset without converting it is not switched on in this setup yet.",
      };
    }
    return {
      status: ASSET_STATUS.DIRECT,
      text: ASSET_STATUS_TEXT.DIRECT,
      why: "The customer pays the asset you already want, so there is nothing to convert.",
    };
  }
  if (marketPairCovers(marketPair, address, payout)) {
    return {
      status: ASSET_STATUS.CONVERSION,
      text: ASSET_STATUS_TEXT.CONVERSION,
      why: "The customer pays this asset and you receive your payout asset in the same payment.",
    };
  }
  return {
    status: ASSET_STATUS.UNAVAILABLE,
    text: ASSET_STATUS_TEXT.UNAVAILABLE,
    why: LANGUAGE["No route"] + ".",
  };
}

/** Every asset in the active deployment, each with the status a business owner reads. */
export function assetMenu(config = {}) {
  const assets = Array.isArray(config.assets) ? config.assets : [];
  const payoutAsset = assets.find((a) => a.role === "payout") ?? null;
  return assets.map((asset) => ({
    ...asset,
    ...assetStatusFor(asset, {
      payoutAsset,
      marketPair: config.marketPair ?? null,
      directSettlement: config.contracts?.directSettlement ?? null,
    }),
  }));
}

// ---- which settlement path a payment takes ------------------------------------------------------

/**
 * The cashier never chooses this and the customer is never asked. Same asset in and out goes to
 * the direct settler; different assets go to the market path; anything the deployment cannot do
 * is refused here, before an order exists, rather than reverting after a customer has pressed pay.
 *
 * Returns { kind: "direct"|"conversion"|"none", contract, marketId, label, why }.
 */
export function chooseSettlementRoute({ customerAsset, payoutAsset, marketPair = null, contracts = {} } = {}) {
  const from = customerAsset?.address ?? customerAsset;
  const to = payoutAsset?.address ?? payoutAsset;
  if (!from || !to) {
    return { kind: "none", contract: null, marketId: null, label: LANGUAGE["No route"], why: "This payment needs both an asset to spend and a payout asset." };
  }
  if (sameAddress(from, to)) {
    const contract = contracts.directSettlement ?? null;
    if (!contract) {
      return { kind: "none", contract: null, marketId: null, label: LANGUAGE["No route"], why: "Taking this asset without converting it is not switched on in this setup yet." };
    }
    return { kind: "direct", contract, marketId: null, label: "No conversion needed", why: "The customer pays the asset you want to receive." };
  }
  if (marketPairCovers(marketPair, from, to)) {
    const contract = contracts.executor ?? null;
    if (!contract) {
      return { kind: "none", contract: null, marketId: null, label: LANGUAGE["No route"], why: "This setup cannot process a converted payment yet." };
    }
    return { kind: "conversion", contract, marketId: marketPair.marketId ?? null, label: "Conversion included", why: "The customer pays one asset and you receive another in the same payment." };
  }
  return { kind: "none", contract: null, marketId: null, label: LANGUAGE["No route"], why: LANGUAGE["No route"] + "." };
}

/** The two route labels a customer may read at checkout, and nothing else. */
export function routeLabel(route) {
  if (route?.kind === "direct") return "No conversion needed";
  if (route?.kind === "conversion") return "Conversion included";
  return LANGUAGE["No route"];
}

// ---- amounts -----------------------------------------------------------------------------------------

/** "12.34" with 6 decimals -> 12340000n. Refuses more decimal places than the asset has. */
export function toBaseUnits(amountText, decimals) {
  const text = String(amountText ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error("Enter an amount as digits, for example 12.50");
  const places = Number(decimals);
  if (!Number.isInteger(places) || places < 0 || places > 36) throw new Error("This asset does not say how many decimal places it has.");
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > places) throw new Error(`This asset holds ${places} decimal places; ${fraction.length} were entered.`);
  return BigInt(whole + fraction.padEnd(places, "0"));
}

/** 12340000n with 6 decimals -> "12.34". Trailing zeros are dropped; a whole number keeps none. */
export function fromBaseUnits(units, decimals) {
  const places = Number(decimals);
  if (!Number.isInteger(places) || places < 0) return String(units ?? "");
  const v = typeof units === "bigint" ? units : BigInt(units ?? 0);
  const s = v.toString().padStart(places + 1, "0");
  const whole = s.slice(0, s.length - places);
  const fraction = places === 0 ? "" : s.slice(s.length - places).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** "12.34 uUSD". A missing amount is shown as unknown rather than as zero. */
export function formatAsset(units, asset) {
  if (units === null || units === undefined) return `unknown ${asset?.symbol ?? ""}`.trim();
  return `${fromBaseUnits(units, asset?.decimals ?? 0)} ${asset?.symbol ?? ""}`.trim();
}

// ---- the day's takings ---------------------------------------------------------------------------

const DAY_SECONDS = 86400;

/**
 * The payments this business may count as taken today: verified ones only, on the calendar day
 * of `nowSeconds` in UTC. A payment whose evidence is not VERIFIED is counted separately, because
 * a business owner reading a single number needs to know how many are still unresolved rather
 * than have them silently disappear.
 */
export function todaysPayments(records = [], nowSeconds = Math.floor(Date.now() / 1000)) {
  const list = Array.isArray(records) ? records : records ? [records] : [];
  const dayStart = Math.floor(Number(nowSeconds) / DAY_SECONDS) * DAY_SECONDS;
  const today = list.filter((r) => {
    const at = Number(r?.settledAt ?? r?.now ?? 0);
    return at >= dayStart && at < dayStart + DAY_SECONDS;
  });
  const verified = today.filter((r) => r?.evidence?.decision === "VERIFIED");
  const unresolved = today.filter((r) => r?.evidence?.decision !== "VERIFIED");
  return { verified, unresolved, verifiedCount: verified.length, unresolvedCount: unresolved.length };
}

// ---- what a receipt is allowed to say ---------------------------------------------------------------

/**
 * The three sentences a receipt may carry, and the only branch on which "Paid" appears. The
 * delayed sentence exists so that a customer whose payment is sent but unverified is told not to
 * pay twice, which is the single most expensive mistake this screen can cause.
 */
export function receiptStatement({ txSubmitted = false, txHash = null, txReceipt = null, evidence = null } = {}) {
  const status = paymentStatus({ txSubmitted, txHash, txReceipt, evidence });
  switch (status) {
    case "PAID":
      return { status, heading: "Paid (checked)", sentence: "This payment was checked against the network and is complete." };
    case "FAILED":
      return { status, heading: "Declined", sentence: "This transaction is not recognized as a valid UNICA payment." };
    case "PENDING":
    case "SUBMITTED":
    case "UNKNOWN":
      return { status, heading: "Not confirmed yet", sentence: "Payment sent; verification is still processing. Do not pay again." };
    default:
      return { status, heading: "Waiting for the customer", sentence: "Nothing has been paid yet." };
  }
}

// ---- pricing one payment -----------------------------------------------------------------------

/**
 * The slippage a converted payment is allowed, in hundredths of a percent. It is a property of the
 * PRODUCT, not of a screen: the same number decides what the customer is told they can be charged
 * and what the business is promised it will receive, so it lives here rather than in two handlers
 * that could drift apart.
 */
export const SLIPPAGE_BPS = 250;

const BPS = 10000n;
const pow10 = (n) => 10n ** BigInt(n);

/**
 * Turn "charge 12.50" into the two amounts an order fixes: how much of the customer's asset is
 * taken, and the least the business must receive. Nothing here is a market quote — `price` is the
 * reference price the deployment's own oracle answered with, expressed as quote units per one
 * whole asset scaled by 10**priceDecimals, exactly as IUnicaPriceOracle defines it.
 *
 * Invoicing in the payout asset is the case a shop actually wants: the business names the amount
 * it must end up with, so that amount becomes the floor and the customer's side is padded upward
 * by the allowed slippage. Invoicing in the customer's asset is the mirror: the spend is fixed and
 * the floor is padded downward.
 *
 * Returns { amountIn, minOut } as base units of the customer asset and the payout asset.
 */
export function quoteOrder({
  invoiceUnits,
  invoiceIn = "payout",
  customerAsset,
  payoutAsset,
  price,
  priceDecimals,
  slippageBps = SLIPPAGE_BPS,
} = {}) {
  const units = typeof invoiceUnits === "bigint" ? invoiceUnits : BigInt(invoiceUnits ?? 0);
  if (units <= 0n) throw new Error("Enter an amount greater than zero.");
  const inDec = customerAsset?.decimals;
  const outDec = payoutAsset?.decimals;
  if (!Number.isInteger(inDec) || !Number.isInteger(outDec)) {
    throw new Error("This register does not know how many decimal places these assets have, so it will not price a payment.");
  }
  if (sameAddress(customerAsset?.address, payoutAsset?.address)) {
    return { amountIn: units, minOut: units, converted: false };
  }
  const p = typeof price === "bigint" ? price : BigInt(price ?? 0);
  if (p <= 0n) throw new Error("This register has no usable price for these two assets, so it will not create a payment.");
  const pd = pow10(priceDecimals);
  const slip = BigInt(slippageBps);

  if (invoiceIn === "payout") {
    // The business must end up with `units`. Work back to the spend, rounding UP so integer
    // division can never leave the shop a base unit short, then pad for the allowed slippage.
    const numerator = units * pd * pow10(inDec);
    const denominator = p * pow10(outDec);
    const exactIn = numerator / denominator + (numerator % denominator === 0n ? 0n : 1n);
    const padded = exactIn * (BPS + slip);
    const amountIn = padded / BPS + (padded % BPS === 0n ? 0n : 1n);
    return { amountIn, minOut: units, converted: true };
  }
  // The customer spends `units`. Work forward to the payout, then pad the floor downward.
  const exactOut = (units * p * pow10(outDec)) / (pd * pow10(inDec));
  const minOut = (exactOut * (BPS - slip)) / BPS;
  if (minOut <= 0n) throw new Error("That amount is too small to convert.");
  return { amountIn: units, minOut, converted: true };
}

/**
 * The per-payment ceiling this deployment enforces. A register that lets a cashier create an order
 * the network will refuse wastes a customer's time at the counter, so the same limit is checked
 * before the order exists. `maxPerTxPayout` is in payout base units.
 */
export function withinPaymentLimit(minOut, maxPerTxPayout) {
  if (maxPerTxPayout === null || maxPerTxPayout === undefined || maxPerTxPayout === "") return { ok: true, sentence: "" };
  const cap = typeof maxPerTxPayout === "bigint" ? maxPerTxPayout : BigInt(maxPerTxPayout);
  const out = typeof minOut === "bigint" ? minOut : BigInt(minOut ?? 0);
  if (cap <= 0n) return { ok: true, sentence: "" };
  if (out <= cap) return { ok: true, sentence: "" };
  return { ok: false, sentence: "This setup limits how much a single payment may be, and this amount is above it." };
}

// ---- names a person recognises ----------------------------------------------------------------

/**
 * "freshcuts" and "fresh-cuts" both belong to a shop whose sign says Fresh Cuts. A chain stores
 * the label; a dashboard should greet the owner with something that looks like their own name.
 * Hyphens become spaces and each word is capitalised; a label with no hyphens keeps its single
 * word, because inventing a split ("Fresh Cuts" out of "freshcuts") would be guessing where the
 * owner's own spacing goes.
 */
export function businessDisplayName(label) {
  const text = String(label ?? "").trim();
  if (!text) return "Your business";
  return text
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** "chair-1.terminals.freshcuts.unica.eth" -> "chair-1": the register as its owner named it. */
export function registerDisplayName(name) {
  const first = String(name ?? "").split(".")[0];
  return first || "Unnamed register";
}

/**
 * An on-chain amount in the words a person reads, using the decimal count the deployment actually
 * answered with for that asset. When the asset could not be labelled the amount is shown as the
 * raw count it is, and SAID to be raw — writing "1000000000000000000 tAST" beside the words
 * "amount due" and hoping nobody notices is how a customer is misled by a factor of a billion.
 */
export function formatAmountFor(units, address, config = {}) {
  if (units === null || units === undefined) return "Not known yet";
  const asset = (config.assets ?? []).find(
    (a) => String(a.address).toLowerCase() === String(address ?? "").toLowerCase(),
  );
  if (!asset || asset.labelled === false || !Number.isInteger(asset.decimals)) {
    return `${units} base units (this asset could not be labelled)`;
  }
  return `${fromBaseUnits(units, asset.decimals)} ${asset.symbol}`;
}

/** The short form of an asset for a list: its symbol, or an abbreviated address when it has none. */
export function assetLabel(asset) {
  if (asset?.symbol) return asset.symbol;
  const a = String(asset?.address ?? "");
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a || "Unnamed asset";
}

// ---- what a wallet holds ---------------------------------------------------------------------------

/**
 * One row per asset this deployment knows, with the amount the wallet holds when it was read.
 * `balances` is keyed by lowercase address and holds base units as a decimal string or bigint; an
 * asset with no entry is "not read yet", never zero, because an unread balance and an empty one
 * look the same on a screen and mean different things to a business owner.
 */
export function holdingsRows(config = {}, balances = {}) {
  const list = Array.isArray(config.holdings) ? config.holdings : [];
  return list.map((h) => {
    const key = String(h.address ?? "").toLowerCase();
    const units = balances[key];
    const labelled = Boolean(h.symbol) && h.decimals !== null && h.decimals !== undefined;
    if (!labelled) {
      return { ...h, amount: null, text: "Could not be read", why: "This asset did not answer with its own name and precision, so no amount is shown for it." };
    }
    if (units === undefined || units === null) {
      return { ...h, amount: null, text: "Not read yet", why: "The amount for this asset has not been read from the network." };
    }
    const amount = BigInt(units);
    let why;
    if (amount === 0n) why = "Nothing held right now.";
    else if (h.role === "payout") why = "The asset your business receives.";
    else if (h.role === "customer") why = "An asset your customers can pay with.";
    else why = "Held in this wallet.";
    return { ...h, amount: amount.toString(), text: formatAsset(amount, h), why };
  });
}

/** A wallet address as a person pastes it: 0x and forty hex digits, nothing else. Never resolved, never guessed. */
export function isAddress(s) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(s ?? "").trim());
}
