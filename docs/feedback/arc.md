# Arc

> Requirement quotes on this page were read from the published prize page on 2026-09-05; that day's saved copy is kept privately with its hash. Where an older fetch is carried forward, the file says so.


**Touches UNICA today:** yes, as of 2026-09-08. `integrations/arc-treasury/` is an Arc-native
USDC treasury: a bounded policy over a merchant's position (reserve floor, per-action cap,
cooldown, approved counterparties), a read-only Arc client, a frontend and backend, and a
transaction preview that stops in front of the signature. **No swap path**, because Uniswap is not
deployed on Arc and inventing one would be a fake. Arc mainnet is still not live (testnet chain id
5042002 re-observed via `eth_chainId` → `0x4cef52`).

**Published requirement** (Best DeFi/Onchain Finance Application,
ethglobal.com/events/ethonline2026/prizes, retrieved 2026-09-05): "Build stablecoin-native DeFi
on Arc." The published sentence after it, separate from that one, is "Build lending, borrowing,
swaps, liquidity, FX, yield, payments, treasury or fintech infrastructure using Arc and USDC."
Re-fetched 2026-09-05; this file previously ran the two together inside one pair of quotation
marks.

**What was built, and what is still owed:** the frontend, the backend and the bounded policy
exist and are tested; funding an account and broadcasting are owner actions, and until a
transaction hash exists the honest status line is that none has been broadcast. Robinhood testnet
is a separate investigation, unrelated to Arc, noted only so the two are not confused.

**What we'd ask Arc to change, with evidence (fetched 2026-09-04, not re-verified since):** the
published contract-addresses page lists stablecoins, CCTP contracts, and common Ethereum
contracts, with no AMM of any kind, while App Kit advertises a Swap capability without naming
what it routes through — we'd ask for either an address or a plain statement that none is
deployed yet.

**The decimal ask, now with the measurement behind it (observed 2026-09-08).** The page's
6-versus-18-decimal USDC warning has no accompanying conversion example, and the reason that
matters is sharper than it looks. Both representations are live on Arc at the same instant:

| Interface | Call | Raw | Scale |
|---|---|---|---|
| native gas asset | `eth_getBalance(0x0)` | `865034306417121744253729820` | **18** |
| ERC-20 contract | `balanceOf(0x0)` on `0x3600…0000` | `865034306417121` | **6** |

Same account, same block, mirroring exactly through 10¹². Both readings are correct, and neither
converts to the other without knowing which interface produced it — so a builder who takes the
warning as "USDC is 18 on Arc" corrupts every ERC-20 amount by a factor of 10¹², silently. We would
ask for one worked helper that reads `decimals()` from the contract rather than assuming either
constant, and for the warning to say plainly that the scale is a property of the interface, not of
the chain. Ours is `integrations/arc-treasury/units.mjs`, where the two representations are types
that refuse to meet; it is offered as the example if it is useful.

Status: `READY_FOR_ARC_DEPLOYMENT_ACTION`. No transaction has been broadcast and no UNICA contract
runs on Arc.
