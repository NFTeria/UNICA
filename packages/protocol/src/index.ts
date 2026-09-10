/**
 * `@unica/protocol` — the shared domain model.
 *
 * No I/O, no dependencies, no framework. Everything here is either a type that mirrors a contract
 * or a pure function over one. Anything that talks to a chain, a wallet, a name service or an
 * indexer belongs behind an adapter, never in here.
 */

export * from "./chain.js";
export * from "./token.js";
export * from "./order.js";
export * from "./quote.js";
export * from "./receipt.js";
export * from "./payment.js";
