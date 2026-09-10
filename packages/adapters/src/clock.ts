/**
 * Time, injected.
 *
 * `Date.now()` is the single largest source of a test that passes on a Tuesday. Every adapter that
 * needs the time takes a `Clock`, so a mock can run a whole checkout — quote issued, quote stale,
 * order expired — without any wall-clock elapsing and without a sleep anywhere.
 *
 * Determinism is not a property a mock can claim; it is a property of having no ambient inputs.
 * This is the file that removes the last one.
 */
export interface Clock {
  /** Unix seconds. */
  nowSeconds(): bigint;
}

export const systemClock: Clock = {
  nowSeconds: () => BigInt(Math.floor(Date.now() / 1000)),
};

/** A clock that moves only when told to. */
export class ManualClock implements Clock {
  #seconds: bigint;
  constructor(startSeconds: bigint) {
    this.#seconds = startSeconds;
  }
  nowSeconds(): bigint {
    return this.#seconds;
  }
  advance(seconds: bigint): void {
    if (seconds < 0n) throw new Error("a clock that runs backwards is not a clock");
    this.#seconds += seconds;
  }
  set(seconds: bigint): void {
    this.#seconds = seconds;
  }
}
