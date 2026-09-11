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

### 2026-09-11 — USDC, EURC and cirBTC on Arc testnet confirmed against Circle's own contract-address pages

**Confirmed, chain and contract state, same day.** Arc Testnet's chain id is `5042002`, re-confirmed
via `eth_chainId` → `0x4cef52` against `https://rpc.testnet.arc.io`. Three token addresses were
checked byte-for-byte against Circle's own published contract-address pages and against on-chain
reads on that RPC:

| Token | Address | Circle's page (row: "Arc Testnet") | On-chain `decimals()` / `symbol()` / `name()` |
|---|---|---|---|
| USDC | `0x3600000000000000000000000000000000000000` | `developers.circle.com/stablecoins/usdc-contract-addresses` | 6 / `USDC` / `USDC` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | `developers.circle.com/stablecoins/eurc-contract-addresses` | 6 / `EURC` / `EURC` |
| cirBTC | `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` | `developers.circle.com/assets/cirbtc-contract-addresses` | 8 / `cirBTC` / `Circle Wrapped Bitcoin` |

All three rows match. cirBTC's address also carries a Blockscout-verified source on Arc's own
explorer (`testnet.arcscan.app`), named `contracts/v1/FiatTokenProxy.sol`, Apache-2.0, "Copyright
(c) 2023, Circle Internet Financial, LLC" — and the verified deployed bytecode the explorer's own
API returns for it matches this project's own `eth_getCode` read on the same address, byte for
byte (1,496 bytes). Commands: `cast chain-id`, `cast call <address> "decimals()(uint8)"` (likewise
`symbol()(string)` and `name()(string)`) and `cast code <address>`, each with
`--rpc-url https://rpc.testnet.arc.io`; the explorer side is the `deployed_bytecode` field of
`https://testnet.arcscan.app/api/v2/smart-contracts/<address>`.

This resolves an item our own research had left open earlier the same day:
`docs/unica-v4/arc/TOKENS.md` §5 found four mutually-inconsistent, self-labeled "cirBTC" tokens on
that same explorer and could not confirm any of them as Circle's, because neither
`docs.arc.io`'s network-level contract-addresses page nor Circle's `what-is-cirbtc` page named an
address. `developers.circle.com/assets/cirbtc-contract-addresses` is the page that does, and it
names exactly the one of those four candidates that also carries the verified Circle source above.

Circle states plainly, on each of the three pages, that testnet tokens carry no financial value:
the USDC and EURC pages both read "Testnet tokens have no financial value"; the cirBTC page adds
"the cirBTC tokens in circulation on these networks... are not backed by real Bitcoin."

### 2026-09-11 — Arc's contract-addresses page does not list cirBTC, whose Arc Testnet address Circle publishes elsewhere

**Trying to:** find the Arc Testnet cirBTC address on Arc's own contract-addresses page, where
USDC and EURC are listed.

**Blocked by:** https://docs.arc.io/arc/references/contract-addresses.md describes itself as "Arc
Testnet contract addresses for USDC, EURC, USYC, CCTP, Gateway, StableFX", then transaction
extensions and common Ethereum contracts. The string `cirBTC` occurs zero times on it (fetched
2026-09-11). It links to Circle pages for CCTP, Gateway, StableFX and USYC, but not to any Circle
per-asset address page. The address is on Circle's separate page,
https://developers.circle.com/assets/cirbtc-contract-addresses.

**Cost:** not recorded as a duration. `docs/unica-v4/arc/TOKENS.md` §5 recorded cirBTC's Arc address
as UNKNOWN earlier the same day, with four lookalike tokens on the explorer, until Circle's page
was found.

**Would have prevented it:** a cirBTC row on Arc's contract-addresses page, or one link from that
page to Circle's per-asset address pages.

Status: `LIVE READ`. The integration is complete: it reads a live Arc position, reads the ERC-20's
own decimals(), decides one bounded action and emits a signable preview. No transaction has been
broadcast and no UNICA contract runs on Arc — there is no signer in the directory, by design.
