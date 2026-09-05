# Robinhood testnet: an observed encoding incompatibility

Public sentence for this subject, verbatim: **Robinhood testnet is under compatibility
investigation.**

## Observed on chain (chain id 46630)

`PoolManager`, `StateView`, `Permit2`, and the CREATE2 factory read back as the same builds as
the listed Sepolia deployments, modulo immutables. The Universal Router is a different, larger
build. Read with `cast` against the public RPC, 2026-09-05, cross-checked against a saved copy
of Uniswap's own deployments page, which lists this same set of five addresses once, under a
mainnet chain id rather than among its four listed testnets.

## Observed on a fork (real bytecode, nothing broadcast)

Our settlement executor's shipped swap encoding — the layout our pinned v4-periphery (commit
`7ebd04b`) defines for `ExactInputSingleParams`, one static `hookData` word — is refused by
that router with an empty revert from inside its own `unlockCallback`, before any call reaches
the pool manager. The identical call with **empty** `hookData` succeeds. The same `hookData`
**is** delivered once the struct carries one extra static word ahead of it: `minHopPriceX36`, a
field v4-periphery added at commit `03b2d09` (2026-03-17). The unmodified nine-word encoding
passes against the listed Sepolia router on a real Sepolia fork, which pins the cause to the
struct layout rather than to anything else about the chain.

## Documented, not independently observed

Whether the testnet's router bytecode is identical to the mainnet build Uniswap's page lists
under that address was not checked; no mainnet call was made in this pass.

## Why this reaches beyond one chain

The refusal follows from the router's build, not from this chain specifically: any Universal
Router compiled from v4-periphery at or after that commit will refuse the older five-field call
whenever hook data is present — and hook data is how every UNICA settlement carries its order
id. Nothing in the router lets an integrator tell which layout a given deployment expects
before signing and sending a transaction. See `uniswap/README.md`, table (c).

## What UNICA would have to change

Not a data change. `src/SettlementExecutor.sol`'s plan-building would need to encode the extra
field, and the pinned periphery interface — or a hand-rolled struct — would need to move past
the commit that added it. That is a source change plus a toolchain pin change. It was tested on
a research branch, not merged, and stays out of scope for this event's frozen build.

## A question for Uniswap, not a claim

A chain built around tokenized real-world assets sits close to what order-bound,
full-fill-enforced settlement is for: a buyer's minimum and deadline held outside the pool, one
canonical receipt per fill, no partial fill silently accepted as a success. Whether v4
settlement in this shape has a place on such a chain is an open design question here, not a
plan. Nothing in this project is deployed there, requested there, or claimed compatible with
it.
