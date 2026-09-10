/**
 * Amounts, in exact integer arithmetic.
 *
 * Every amount UNICA touches is an integer of a token's smallest unit: wei for the 18-decimal
 * native input, and USDC's 6-decimal unit for the payout. Nothing here converts to `number`, ever.
 * A float cannot hold 10^18 without loss, and a payment interface that displays a number it
 * cannot honour is worse than one that displays nothing.
 *
 * Two decisions worth their reasons, because both are ways to be wrong quietly:
 *
 * 1. `formatFixed` TRUNCATES toward zero; it never rounds up. Rounding 1.4522449 up to 1.45225
 *    shows the payer a number larger than the one the chain will deliver. Showing slightly less
 *    than arrives is a disappointment; showing more is a false promise.
 * 2. `parseUnits` REFUSES more fraction digits than the token has, rather than silently dropping
 *    them. A merchant who types 1.0000005 USDC means something, and quietly settling for 1.000000
 *    is the class of bug that only surfaces in someone's accounts.
 */

export interface TokenMeta {
  readonly symbol: string;
  readonly decimals: number;
  readonly name: string;
}

/** An amount bound to the decimals it is denominated in, so the two cannot drift apart. */
export interface TokenAmount {
  readonly value: bigint;
  readonly decimals: number;
}

export class AmountFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountFormatError";
  }
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new AmountFormatError(`decimals must be an integer in 0..36, received ${decimals}`);
  }
}

/**
 * Smallest-unit integer to a decimal string, with trailing zeros removed.
 * `formatUnits(2216294n, 6)` is `"2.216294"`; `formatUnits(1000000n, 6)` is `"1"`.
 */
export function formatUnits(value: bigint, decimals: number): string {
  assertDecimals(decimals);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const base = pow10(decimals);
  const whole = magnitude / base;
  const fraction = magnitude % base;
  const sign = negative ? "-" : "";
  if (fraction === 0n) return `${sign}${whole}`;
  const digits = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${sign}${whole}.${digits}`;
}

/**
 * Smallest-unit integer to a decimal string with EXACTLY `places` fraction digits — padded when
 * the value is short, truncated toward zero when it is long.
 *
 * The padding half is not cosmetic. A column of payouts reading 1.45224, 2.216294, 1.21068 is
 * three different precisions pretending to be one measurement; 1.452240, 2.216294, 1.210685 is a
 * ledger. The truncating half is the promise-keeping rule at the top of this file.
 */
export function formatFixed(value: bigint, decimals: number, places: number): string {
  assertDecimals(decimals);
  if (!Number.isInteger(places) || places < 0 || places > decimals) {
    throw new AmountFormatError(`places must be an integer in 0..${decimals}, received ${places}`);
  }
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const base = pow10(decimals);
  const whole = magnitude / base;
  const fraction = magnitude % base;
  const sign = negative ? "-" : "";
  if (places === 0) return `${sign}${whole}`;
  const padded = fraction.toString().padStart(decimals, "0");
  return `${sign}${whole}.${padded.slice(0, places)}`;
}

/**
 * A decimal string to a smallest-unit integer. Refuses anything it cannot represent exactly.
 * Accepts an optional leading `-`, digits, and at most one `.`; rejects blanks, exponents,
 * thousands separators, and more fraction digits than the token has.
 */
export function parseUnits(text: string, decimals: number): bigint {
  assertDecimals(decimals);
  const trimmed = text.trim();
  if (trimmed === "") throw new AmountFormatError("an empty amount is not zero, it is unspecified");
  if (!/^-?\d*\.?\d*$/.test(trimmed) || !/\d/.test(trimmed)) {
    throw new AmountFormatError(`"${text}" is not a plain decimal amount`);
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [wholeText = "", fractionText = ""] = unsigned.split(".");
  if (fractionText.length > decimals) {
    throw new AmountFormatError(
      `"${text}" carries ${fractionText.length} fraction digits, but this token has only ${decimals}. ` +
        `Rounding it here would settle a different amount than the one that was typed.`,
    );
  }
  const whole = wholeText === "" ? 0n : BigInt(wholeText);
  const fraction = fractionText === "" ? 0n : BigInt(fractionText.padEnd(decimals, "0"));
  const magnitude = whole * pow10(decimals) + fraction;
  return negative ? -magnitude : magnitude;
}

export function tokenAmount(value: bigint, decimals: number): TokenAmount {
  assertDecimals(decimals);
  return { value, decimals };
}

/** Formats an amount with its symbol, at full precision. */
export function formatTokenAmount(amount: TokenAmount, symbol: string): string {
  return `${formatUnits(amount.value, amount.decimals)} ${symbol}`;
}

/**
 * Adds two amounts, refusing a mismatch rather than coercing one. Two amounts in different
 * decimals are not two numbers; adding them is always a bug, and it is a bug that produces a
 * plausible-looking total.
 */
export function addAmounts(a: TokenAmount, b: TokenAmount): TokenAmount {
  if (a.decimals !== b.decimals) {
    throw new AmountFormatError(
      `cannot add an amount in ${a.decimals} decimals to one in ${b.decimals} — they are different units`,
    );
  }
  return { value: a.value + b.value, decimals: a.decimals };
}
