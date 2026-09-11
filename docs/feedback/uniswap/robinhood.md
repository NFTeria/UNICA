# Robinhood testnet: an observed encoding incompatibility

**Public status (updated 2026-09-11): UNICA's experimental settlement is deployed on Robinhood testnet, using Robinhood test tokens with no real value (one settlement); broader Robinhood support is under compatibility investigation.** The sentence it replaces, kept so the record shows what was believed when: "Robinhood testnet is under compatibility investigation."

**Public status, the only sentence to be said about this subject: Robinhood testnet is under compatibility investigation.** Nothing here claims support, deployment, or an official stack.

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

### 2026-09-11 — the experiment now exists on 46630, and it raises a provenance question about Uniswap's own listing

**What now exists.** UNICA's experimental stock settlement
(`docs/experimental/STOCK-46630-DEPLOY-PLAN.md`) was deployed and settled on chain 46630,
through the same PoolManager already read above, `0x8366a39CC670B4001A1121B8F6A443A643e40951`.
Eleven transactions landed from the deployer at nonces 79–89, every receipt status 1; the one
settlement paid 0.001 Robinhood test TSLA for 393052 raw uTUSD against a floor of 383149, at a
demonstration rate (395) the deployer chose — not a market price, and there is no oracle. uTUSD
is a token the deployer minted for this and has no value; TSLA is a Robinhood test token, not a
security. This supersedes the statements above that nothing in this project is deployed on
46630; they are left as written, so the record shows what was believed when. Re-read
independently just now:

```
# pay tx 0x9cb16eeab49670283b8c2a36241e89e5239df45523660afdc36491a0453ec300
cast receipt 0x9cb16eeab49670283b8c2a36241e89e5239df45523660afdc36491a0453ec300 --rpc-url robinhood_testnet status
# 1 (success)
```

**Open question for Uniswap — provenance of the 46630 PoolManager.** Uniswap's own deployments
page, <https://developers.uniswap.org/docs/protocols/v4/deployments>, lists this exact PoolManager
address under "Robinhood Chain: 4663" — a mainnet id — and nowhere under testnet 46630 (fetched
2026-09-11; the string `46630` occurs zero times in that page's HTML). Read just now, both
chains, the identical address:

```
# 46630, via robinhood_testnet
cast call 0x8366a39CC670B4001A1121B8F6A443A643e40951 "owner()(address)" --rpc-url robinhood_testnet
# owner 0x9701fb0aDe1E269c8f64Ec0C7b3cfADB31A13A52
cast call 0x8366a39CC670B4001A1121B8F6A443A643e40951 "protocolFeeController()(address)" --rpc-url robinhood_testnet
# protocolFeeController 0x0000000000000000000000000000000000000000

# 4663, keyless https://rpc.mainnet.chain.robinhood.com, same address
cast call 0x8366a39CC670B4001A1121B8F6A443A643e40951 "owner()(address)" --rpc-url https://rpc.mainnet.chain.robinhood.com
# owner 0x2BAD8182C09F50c8318d769245beA52C32Be46CD
cast call 0x8366a39CC670B4001A1121B8F6A443A643e40951 "protocolFeeController()(address)" --rpc-url https://rpc.mainnet.chain.robinhood.com
# protocolFeeController 0x6d0009504D129CF5002Dba61D9Ae8575AA79314c
```

The two chains' PoolManagers, at the identical address, answer `owner()` with two different
accounts, and the testnet side has no protocol fee controller set at all, where the mainnet side
has one. Is the 46630 twin operated by Uniswap, mirrored by Robinhood, or run by neither — and
if it is meant as a testnet
counterpart of the 4663 listing, why does it have a different owner?
