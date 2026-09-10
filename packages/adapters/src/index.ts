/**
 * `@unica/adapters` — the contracts between the application and everything outside it.
 *
 * Not connected to any surface. Nothing in this package imports a framework, a wallet library, a
 * bundler or a network client, and nothing in the currently published `web/` imports this package.
 */

export * from "./contracts.js";
export * from "./errors.js";
export * from "./clock.js";
export * from "./wallet-gate.js";
