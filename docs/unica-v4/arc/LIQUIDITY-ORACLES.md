# Arc — Liquidity, Pricing, Oracles

Scope: USDC/USDC (no swap), EURC/USDC, and a confirmed BTC asset/USDC on Arc
(Circle's L1). Read-only research for UNICA v4. Retrieval date for every web
source below: **2026-09-11**. On-chain reads were taken the same day against
Arc's own public testnet RPC.

**Bottom line up front:** as of the retrieval date, Arc **mainnet has not
launched** (public launch is dated 2026-09-16 by Circle's own materials — five
days after 2026-09-11). No authenticated Chainlink route on Arc has a
published, Arc-specific contract address or feed id. No Uniswap v4 pool on
Arc could be confirmed live on-chain. Per the governing rule: **without an
authenticated oracle and adequate liquidity, the EURC/USDC and BTC-asset/USDC
markets fail closed and stay disabled.** USDC/USDC needs no swap and is the
only pair with a non-speculative, safe-today answer.

## Method and source tiers

1. **On-chain reads** — via the keyless public RPC named in Arc's own docs
   (`https://rpc.testnet.arc.io`, from `docs.arc.io/arc/references/connect-to-arc`).
   Each states chain id, address, method, and raw result.
2. **Primary-source docs/announcements** — Circle (`circle.com`, `arc.io`,
   `developers.circle.com`), Chainlink (`docs.chain.link`, `chain.link` blog,
   its own X account), Uniswap (`developers.uniswap.org`, the `Uniswap` GitHub
   org), each with URL and a short quote.

Third-party trackers, news aggregators, and community projects are cited only
to show *what they claim*, never as confirmation on their own — several
directly disagree with each other below. Where sources conflict, both are
shown; the conflict is itself a finding.

## Network status (why every answer below is conditional)

- Arc **testnet**: chain id `5042002`. Confirmed two ways — Circle's own doc
  (`docs.arc.io/arc/references/connect-to-arc`, "Chain ID: 5042002") and a
  direct `eth_chainId` read against `https://rpc.testnet.arc.io` returning
  `0x4cef52` = 5,042,002 decimal. Match.
- Arc **mainnet**: chain id `5042`. Source: Circle's own `circlefin/arc-node`
  repo, `BREAKING_CHANGES.md` — "The CL on mainnet (chain id `5042`)
  advertises Arc-branded libp2p protocol IDs." This resolves a conflict from
  aggregator sites (`pad.chaingpt.org/arc` and a ChainList mirror claim
  mainnet id `1243`); the Circle-repo value is treated as authoritative, and
  one Arc-community source (`@the_smart_ape` on X) warned that a "spoofed
  chain 5042" and a fake "archie chain" at 1243/1244 were both circulating —
  **both numbers have been used by scammers**, so any integration must pin
  the id from `circlefin/arc-node` or `docs.arc.io` directly, never from a
  chain-list aggregator.
- Public **mainnet launch date**: 2026-09-16, per Circle's own pressroom
  framing. As of 2026-09-11, mainnet is **not yet public** —
  the same community source states Circle "had not published an official Arc
  mainnet RPC endpoint or block explorer" as of 2026-09-06, and warns not to
  trust any RPC/explorer claiming otherwise. There is therefore no
  mainnet on-chain read anywhere below — there is no official mainnet RPC to
  read from yet.
- Consequence: every "is X deployed on Arc" question below has two possible
  answers — testnet (checkable now, no economic stakes) and mainnet (not yet
  checkable, since it isn't public). Both are reported separately; neither
  stands in for the other.

## Pair 1 — USDC/USDC: no swap needed

On Arc, USDC exists in two representations of **one asset**, not two assets:
the **native gas token** (18-decimal precision, protocol-level balances/fees)
and an **ERC-20 interface predeploy** at
`0x3600000000000000000000000000000000000000` (6-decimal precision, for
existing ERC-20 tooling).

Confirmed on-chain against Arc testnet (chain id `5042002`,
`https://rpc.testnet.arc.io`, retrieved 2026-09-11):

| Read | Target | Result |
|---|---|---|
| `eth_getCode` | `0x3600…0000` | non-empty (proxy-pattern bytecode — see the Uniswap/pools section for the selector evidence, identical pattern to EURC below) |
| `eth_call decimals()` (`0x313ce567`) | `0x3600…0000` | `6` |
| `eth_call symbol()` (`0x95d89b41`) | `0x3600…0000` | `"USDC"` |

Circle's own `docs.arc.io/arc/references/contract-addresses` page confirms
this split directly: "the native USDC gas token uses 18 decimals of
precision, while the USDC ERC-20 interface uses 6 decimals," warning
integrators to treat it as "same balance, two precisions — never mix the
representations" (repeated near-verbatim in Uniswap's own `UniswapX` playbook
Arc notes, which calls the mismatch "the primary integration risk").

**There is no USDC/USDC market to price.** A payer paying in the ERC-20
interface and a merchant settling in the same interface never cross an AMM,
never need a quote, and never need an oracle — one token moves from one
address to another. The only care needed is what Circle and Uniswap both
flag: never compare or sum the 18-decimal native balance against the
6-decimal ERC-20 balance as if commensurable. **A same-asset USDC payment
must never be routed through a swap, pool, or oracle-priced path** — that
only adds fee leakage, slippage exposure, and an oracle dependency for zero
benefit.

## Pair 2 — EURC/USDC

### Identity, on-chain

EURC on Arc **testnet**: `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`, per
`docs.arc.io/arc/references/contract-addresses`. Confirmed independently
against chain id `5042002`, `https://rpc.testnet.arc.io`, 2026-09-11:

| Read | Target | Result |
|---|---|---|
| `eth_getCode` | EURC address | non-empty; bytecode carries selectors `5c60da1b` (`implementation()`), `8f283970` (`upgradeToAndCall`/`changeAdmin`-style), `f851a440` (`admin()`) — same three selectors as the USDC ERC-20 predeploy, consistent with both being **upgradeable proxies**, not immutable tokens. Issuer control over the implementation should be assumed on both. |
| `eth_call decimals()` (`0x313ce567`) | EURC address | `6` |
| `eth_call symbol()` (`0x95d89b41`) | EURC address | `"EURC"` |

Circle documents EURC as 6 decimals too (`docs.arc.io` contract-addresses
page), matching the on-chain read.

### Is a swap needed, and by what path?

Yes — EURC and USDC are distinct fiat-backed stablecoins (euro vs. dollar
claims), a genuine FX conversion, not a representation change like Pair 1.
The load-bearing question is *which* path: an AMM priced by an oracle, or an
issuer-side RFQ/PvP settlement.

Circle operates **StableFX**, per its own site (`circle.com/stablefx`,
`circle.com/blog/introducing-circle-stablefx-and-circle-partner-stablecoins`):
"an institutional-grade stablecoin FX engine that combines Request-for-Quote
(RFQ) execution with onchain settlement," explicitly supporting USDC↔EURC on
Arc. Arc's own blog (`arc.io/blog/how-arc-can-support-247-onchain-fx`)
describes the mechanism: "offchain price discovery meets sub-second onchain
settlement finality," via "an offchain RFQ process familiar to professional
desks," with "both legs settling at the same time through PvP [payment-
versus-payment] settlement." **No Chainlink feed, and no oracle of any kind,
is named anywhere in Circle's or Arc's StableFX material** as the rate source
— the rate comes from competing quotes among vetted market makers, not an
onchain price feed. Arc's contract-address page lists an `FxEscrow` contract
(`0xd68256f4D69C6BbEcB873D8588AE0Dc6B8E22E10` on testnet) as "the escrow
contract used by both makers and takers to settle stablecoin swaps" — the PvP
settlement leg of this RFQ system, not an AMM pool and not an oracle consumer.

StableFX is Circle's own product, gated to onboarded institutional
makers/takers; it is **not** a permissionless pool UNICA's hook can route a
retail swap through, and UNICA has no confirmed integration surface into it.
It is the honest answer to "how does Circle itself convert EURC↔USDC on
Arc" — by RFQ/PvP, not AMM, not oracle-priced — and a reason UNICA should not
assume a Chainlink-fed EURC/USDC AMM pool is the natural or only path once
mainnet opens.

If UNICA still wants a same-hook AMM path instead, that pool needs its own
authenticated price reference distinct from StableFX's private RFQ rate, to
detect a manipulated or stale pool price. Per the Chainlink section below,
**no such feed has a published Arc-specific address**, so this path is
currently unimplementable under the fail-closed rule.

### Can EURC/USDC be safely offered today?

**No.** Three reasons converge: (1) no authenticated onchain price reference
for EURC/USD or USDC/EUR has a confirmed Arc address; (2) no AMM pool for the
pair could be confirmed to exist with real liquidity on either Arc network —
a pool with an oracle but no depth is exactly the "low-liquidity
manipulation" failure mode this brief warns against; (3) Arc mainnet itself
is not yet public, so no real-value pool can exist there at all today.
Circle's own StableFX is the economically sound route once it exists in a
form UNICA can call; until then, EURC/USDC stays disabled rather than
substitute a typed-in or low-liquidity AMM rate.

## Pair 3 — a confirmed BTC asset / USDC

### Identifying the asset

Per the governing rule, "cirBTC" starts UNKNOWN; it is now resolved (2026-09-11): Circle publishes its Arc testnet address `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` (see TOKENS.md §Correction). Research found exactly one
BTC-denominated asset Circle itself names in connection with Arc: **cirBTC**
(Circle Wrapped Bitcoin). Coinbase's **cbBTC**
(`0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` on Ethereum/Base, per
Etherscan/BaseScan) is a separate brand with nothing found tying it to Arc —
named here only to rule out same-name confusion.

**Issuer:** `circle.com/cirbtc` states the issuer is "Circle International
Bermuda Limited, a Class F Digital Asset Business licensed and regulated by
the Bermuda Monetary Authority." Circle's developer docs
(`developers.circle.com/assets/what-is-cirbtc`) instead say cirBTC "is a 1:1
BTC-backed token issued by Circle on Ethereum," without naming the Bermuda
entity — a real, unresolved inconsistency between two of Circle's own pages;
the Bermuda-entity framing is treated as authoritative for the legal issuer.

**Custody:** both Circle pages agree BTC backing cirBTC is held at **Circle
National Trust Bank**, "a federally chartered trust bank and qualified
custodian," reserves "segregated from Circle's corporate assets" and "held
for the exclusive benefit of cirBTC holders." Secondary coverage (BigGo
Finance, Odaily — cited only for corroboration) adds the OCC granted the
trust bank's charter in July 2026. This is a **custodial, centralized-issuer
model**, not a decentralized or merkle-proof bridge — redeemability rests on
Circle/Circle National Trust Bank honoring 1:1 redemption, exactly like
USDC's own risk model transplanted to BTC.

**Proof of reserve:** `circle.com/cirbtc` claims "real-time onchain
verification through Chainlink rather than periodic attestations," and shows
a live snapshot: "total supply of 40.03 cirBTC backed by 42.53 BTC across
multiple Bitcoin addresses" (2026-09-10, Ethereum, not independently
re-verified here). No specific Chainlink PoR feed address (Ethereum or Arc)
was found to match this claim against.

**Decimals, exact contract address (any chain):** UNKNOWN. Neither Circle
page published an ERC-20 address in the content retrieved, and Arc's own
`docs.arc.io/arc/references/contract-addresses` page (fetched in full) lists
USDC, EURC, USYC and CCTP/Gateway/FX contracts but **no BTC or cirBTC entry
at all**. No address should be assumed or typed in; it must be re-confirmed
directly from `docs.arc.io` or `developers.circle.com` before any code
references it.

### Is cirBTC live on Arc? Circle's own two pages disagree

- `circle.com/cirbtc` lists "Ethereum" under "currently operational" and Arc
  under "Coming Soon" — explicitly "launching next," i.e. **not yet live**.
- `developers.circle.com/assets/what-is-cirbtc` lists live chains as
  "Ethereum (mainnet and Sepolia testnet)" **and** "Arc (testnet)" — claiming
  cirBTC already exists on Arc testnet.

A direct conflict between two Circle-owned pages, retrieved the same day.
Not resolved by guessing here; flagged **UNKNOWN pending a Circle
clarification or a direct on-chain read** — which could not be completed as
of 2026-09-11, because no cirBTC address is published to read against. Circle's
own launch coverage (`circle.com/blog/cirbtc-is-now-live-on-ethereum`)
confirms only Ethereum and does not mention Arc, which weighs slightly toward
"coming soon on Arc" being the more current reading — an inference, not a
confirmed fact.

### Depeg and bridge risk

- **Depeg risk:** cirBTC's value depends entirely on Circle/Circle National
  Trust Bank holding BTC 1:1 and honoring redemption — an attestation-plus-
  custody model (now Chainlink-PoR-verified per Circle's claim), with no
  market-making backstop or algorithmic peg mechanism described anywhere. A
  custody failure, legal freeze, or Circle insolvency would depeg cirBTC with
  no onchain mechanism to prevent it — a **counterparty risk** no oracle or
  pool design can hedge.
- **Bridge risk:** Circle calls cirBTC "architected for a multichain future"
  and "positioned to become a cornerstone collateral asset" on Arc — the
  intended model reads as Circle **re-issuing** cirBTC natively per chain
  (mint/burn against the same custodied BTC pool), the CCTP pattern Circle
  uses for USDC, rather than a lock-and-mint bridge. If so, bridge risk
  reduces to the same issuer-custody risk above — but this is
  **UNKNOWN/unconfirmed for cirBTC specifically**: `docs.arc.io`'s CCTP stack
  (TokenMessengerV2/MessageTransmitterV2/TokenMinterV2) is documented as
  USDC-specific, with no statement that an equivalent mechanism covers
  cirBTC across chains.

### Can a BTC-asset/USDC market be safely offered today?

**No, on every count the governing rule requires:** cirBTC's Arc availability
is disputed between Circle's own pages, its contract address is unpublished,
no Chainlink (or any) BTC/USD or cirBTC/USD feed has a confirmed Arc address,
and Arc mainnet is not yet public. This must fail closed until, at minimum:
(a) Circle's two pages agree on Arc launch status, (b) a cirBTC address on
Arc is published and independently read on-chain, and (c) an authenticated
price feed for it exists at a confirmed Arc address.

## Chainlink on Arc: partnership confirmed, exact identifiers UNKNOWN

### What is confirmed

Chainlink's own account announced (`x.com/chainlink/status/2071988786368578008`):
"Arc, the L1 chain developed by @circle, officially joins Chainlink Scale to
provide devs access to institutional oracle infra: CCIP, Data Streams, Data
Feeds, Proof of Reserve." Chainlink Scale, per Chainlink's own blog
(`blog.chain.link/chainlink-scale-program/`), "covers operating costs (e.g.
transaction gas fees) of Chainlink oracle networks for a period of time" for
a newly onboarded chain — a **subsidized-onboarding commitment**, not itself
a statement that feeds are already deployed at specific addresses.

Arc's own docs corroborate the partnership: `docs.arc.io/arc/tools/oracles`
names Chainlink Data Feeds and Data Streams as available options, but
**links out generically** to `docs.chain.link/data-feeds` and
`docs.chain.link/data-streams` — the same pages used for every chain — rather
than to any Arc-specific address list or feed-id page.

### What could not be confirmed

- **Data Feeds addresses on Arc:** Chainlink's own canonical list,
  `docs.chain.link/data-feeds/price-feeds/addresses`, was fetched in full
  (16.9 MB HTML) and searched programmatically for "Arc" as a network name.
  **None found** — no Arc entry, no USDC/USD, EURC/USD, or BTC/USD address
  for Arc appears on that page as of retrieval.
- **Data Streams feed ids on Arc:** the general BTC/USD feed id `0x00039d9e45394f473ab1f050a1b963e6b05351e52d71e507509ada0c95ed75b8`
  ("BTC/USD-RefPrice-DS-Premium-Global-003", per
  `data.chain.link/streams/btc-usd-cexprice-streams`) is a **global,
  chain-agnostic** stream identifier in Chainlink's pull-based model —
  nothing ties it, or any other stream id, to Arc specifically or confirms
  Arc has a live Data Streams verifier deployed.
- **CRE on Arc:** `docs.chain.link/cre` describes the Chainlink Runtime
  Environment generally as an orchestration layer where workflows are
  "compiled to WebAssembly and registered with the network" — chain-agnostic
  product documentation. No Arc-specific CRE workflow id, DON name, or Arc
  write-target contract was found anywhere. Arc's own oracle page has **no
  CRE section at all**.
- **Proof of Reserve for cirBTC:** Circle's claim of "Chainlink Proof of
  Reserve" (see Pair 3) was not matched to any specific feed address, on
  Ethereum or Arc, in material retrieved.

### Conclusion

**No authenticated Chainlink route on Arc has an exact, confirmed
identifier** (address, feed id, or CRE workflow id) as of 2026-09-11. The
Chainlink–Arc relationship is real and confirmed at the partnership level,
but every concrete integration detail this brief asks for is **UNKNOWN**.
Per the governing rule, any pricing path depending on a Chainlink Arc feed is
unavailable until a specific address is published and independently read
on-chain, the same way the USDC/EURC addresses above were confirmed.

Arc's oracle page also names **Chronicle**, **Pyth**, and **RedStone**, and
**Stork** — of these, Stork is the only one with an Arc-specific address page
linked directly from Arc's docs (`docs.stork.network/resources/contract-addresses/evm#arc`).
Not evaluated further — this document's scope is Chainlink — but the
asymmetry is worth recording: **Stork has a published Arc-specific address;
Chainlink, as integrated on Arc's own oracle page, currently does not.**

## Uniswap v4 on Arc: does a pool exist, and does UNICA need to seed one?

The most conflicted question in this document; per the rule to describe
third-party or self-deployed PoolManagers exactly as such, the conflict is
shown rather than smoothed over.

### The claim that a v4 PoolManager is deployed

Uniswap's own GitHub org (`github.com/Uniswap/UniswapX`,
`playbook/chains/arc.md`) states, for **"Arc (chainId 5042)"** — mainnet —
that "Contracts deployed 2026-06-12" and lists, among other addresses,
**PoolManager (v4): `0x8366a39cc670b4001a1121b8f6a443a643e40951`**, owner
`0x33f26c5d69e2c40956f22c6195b6a499cf4151e8`, alongside Permit2 at its
canonical cross-chain address. The same file explicitly caveats: **"Explorer
verification and SDK/service integration remain pending."** This file is an
internal integration/ops playbook in Uniswap's org, not
`developers.uniswap.org`'s public deployments page — materially less
authoritative than Uniswap's canonical docs.

### What Uniswap's canonical sources say, and what an independent tracker says

Two canonical Uniswap sources were checked directly and **neither lists
Arc**: `developers.uniswap.org/docs/protocols/v4/deployments` (covers
"Ethereum, Optimism, Base, Arbitrum, Polygon, and others," per the fetched
content) and `v4-address.uniswap.org` (Uniswap's own "v4 Address Challenge"
page).

`builtonarc.app/project/uniswap` — self-described as "an independent
directory," "not affiliated with, endorsed by, or sponsored by Circle
Internet Group or Arc" (a third party, cited only for its own claim) —
states, as of **2026-09-02**: "Named in Circle's Arc mainnet press release;
announcement only, nothing observed on chain," with "On-chain addresses: No
Arc addresses on file," "Liquidity: Not observed," "Verified contracts: Not
observed."

### Verified directly on-chain, 2026-09-11

Chain id `5042002` (Arc **testnet**), `https://rpc.testnet.arc.io`,
2026-09-11:

| Read | Target | Result |
|---|---|---|
| `eth_getCode` | `0x8366a39cc670b4001a1121b8f6a443a643e40951` (the address the UniswapX playbook names as v4 PoolManager on **mainnet**, chain `5042`) | **`0x` — no code.** Unused on Arc testnet. |

This does **not** contradict the playbook, since its claim is about chain
`5042` (mainnet), which has no public RPC yet — there was no way to
check chain `5042` directly as of 2026-09-11. It does mean the claim is **entirely unverified
as of 2026-09-11**, and it sits alongside the independent tracker's "nothing
observed on chain" reading, which does not specify which chain it checked.

### Conclusion

**Whether an official Uniswap v4 PoolManager is live on Arc, on any chain
id, could not be confirmed as of 2026-09-11.** The one address claimed for it
appears only in an internal playbook file, explicitly "verification
pending," for a mainnet not yet public; an independent tracker says nothing
is observed on-chain; a direct on-chain check (testnet, the only
network with a public RPC) found no code at that address. Per the UNICA
context rule, **this must not be described as "Uniswap v4 on Arc" as a
completed integration** anywhere until a canonical Uniswap source lists Arc,
or an on-chain read against a public mainnet RPC confirms non-empty code at
a Uniswap-attributed address.

### Existing pools and depth

**No EURC/USDC or BTC-asset/USDC Uniswap v4 pool on Arc could be confirmed
to exist, testnet or mainnet.** One thing was found and must be called out
precisely so it is never mistaken for an official Uniswap pool: a GitHub
ecosystem submission (`circlefin/arc-node` issue #160) describes a community
project called **"Arc Swap"** — in its own words, "We deployed the full
Uniswap V2 protocol from scratch on Arc Testnet — all four contracts,"
calling itself the "first Uniswap V2 deployment on Arc Testnet." This is **an
independent third party re-deploying Uniswap's open-source V2 code**, not
Uniswap Labs, not V4, not audited beyond reading the
submission text — it must be described exactly as "a third-party,
community-built Uniswap V2 clone on Arc testnet," never as "Uniswap on Arc."
Its testnet liquidity, if any, carries no value and is not a depth signal.

### Does pool creation need UNICA's own liquidity?

Likely yes, if UNICA wants a v4 USDC/EURC or USDC/BTC-asset pool on Arc
mainnet at launch — no confirmed, canonical, audited pool for these pairs
exists yet from any party that could be verified as of 2026-09-11. Initializing a v4 pool
with zero starting liquidity is cheap and permissionless, but a pool with
negligible depth is actively dangerous to offer real users (see below). This
is the same fail-closed conclusion as the pricing question: **do not offer a
pair whose only pool is one UNICA itself just created thinly seeded** — its
price becomes trivially manipulable before an oracle is even considered.

## Operational risk parameters — design guidance, not sourced facts

No primary source specifies a fee tier, max pool-vs-oracle deviation,
freshness limit, or slippage bound for UNICA on Arc — these are UNICA's own
risk-policy choices, not facts to cite, and the rule against a "typed-in rate
for real value" applies equally to typed-in risk thresholds dressed up as
externally verified. Recorded here as **design guidance**, explicitly not
sourced:

- **Fee tier:** prefer the **highest** standard v4 tier for a non-correlated
  pair (v4 supports dynamic fees via hooks; standard tiers elsewhere run
  0.05% / 0.30% / 1.00%). A low, stable-pair tier is wrong here — EURC/USD
  and BTC/USD are not pegged to USDC — a higher fee compensates LPs for real
  price risk and narrows the window for manipulate-then-arbitrage. UNICA's
  own protocol fee stays 0 in the beta per the binding context; a pool's LP
  fee is a separate parameter, unaffected by that constraint.
- **Max pool-vs-oracle deviation / freshness limit:** cannot be set to a
  number today — there is no confirmed Arc oracle to deviate from or take a
  heartbeat from. Once a real Arc-specific Chainlink feed exists, its own
  on-chain `deviationThreshold` and heartbeat should drive both parameters,
  with a reject-or-pause rule if pool spot price diverges from the oracle
  beyond that band, or if `updatedAt` is older than the heartbeat — not
  values invented independently of the feed.
- **Slippage at nano sizes:** even a "tiny" swap suffers unbounded percentage
  slippage against negligible depth — a property of constant-function AMMs,
  not something a source needs to confirm. A trade of size `x` against
  reserve `R` moves price by an amount scaling with `x / R`; for a
  freshly-seeded pool, `R` is exactly what UNICA or a partner chose to seed,
  meaning UNICA sets its own worst-case slippage by how much it seeds, not
  the market. Any quoted price should carry the reserve it was computed
  from; reject a swap whose computed slippage exceeds a conservative bound
  (single-digit basis points for a same-value-class pair) without an
  explicit, logged exception.
- **Low-liquidity manipulation:** thin reserves are trivially moved by one
  large (or flash-loan-funded) trade immediately before a victim trade at
  the manipulated price — the classic AMM sandwich pattern. Defenses once a
  pool exists: never treat pool spot price as the sole reference — cross-
  check the oracle within the deviation band above; never accept a price
  from a pool whose depth wasn't measured moments before use; prefer a
  time-weighted or oracle price for any UNICA-side conversion math. None of
  this substitutes for simply not offering the pair while no authenticated
  oracle and no adequate-depth pool exist — the current state for both
  EURC/USDC and BTC-asset/USDC on Arc.

## CCTP and issuer conversion — where they are actually relevant

- **CCTP is relevant to cross-chain USDC movement, not to EURC/USDC or
  BTC-asset/USDC pricing.** Arc's contract-addresses page lists a full CCTP
  v2 stack — `TokenMessengerV2`, `MessageTransmitterV2`, `TokenMinterV2`,
  `MessageV2` — plus `GatewayWallet`/`GatewayMinter`, all under Circle's
  "Domain 26" for Arc; Gateway provides "chain-abstracted USDC balances for
  seamless liquidity movement." This matters if a payer's USDC originates
  off Arc and must arrive before settlement — a bridging step, not a pricing
  one — orthogonal to the EURC or BTC-asset questions here.
- **Issuer conversion is relevant, specifically for EURC/USDC**, via
  Circle's StableFX RFQ/PvP product (Pair 2 above) — the one place in this
  research where "ask the issuer to convert it" is a real, named mechanism
  rather than a hypothetical. Not currently UNICA-callable (no public
  integration surface confirmed), but the correct answer to "who else could
  price this besides an AMM+oracle," revisit if Circle documents a callable
  API/contract.
- **Issuer conversion for BTC-asset/USDC** has no equivalent named
  mechanism: cirBTC's own redemption path (Circle Mint, currency code
  `CIRBTC`) converts cirBTC to/from actual BTC, not to/from USDC, so it does
  not substitute for a BTC-asset/USDC price reference.

## Summary table

| Question | Answer |
|---|---|
| USDC/USDC — swap needed? | No — same asset, two representations; route natively, never through a pool. |
| EURC/USDC — swap needed? | Yes, genuine FX; Circle's RFQ/PvP path (StableFX) exists but is not UNICA-callable today; no AMM+oracle path is confirmed available. |
| BTC-asset/USDC — which asset? | cirBTC (Circle Wrapped Bitcoin), Arc testnet `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF`, published by Circle on developers.circle.com/assets/cirbtc-contract-addresses (corrected 2026-09-11; an earlier draft said no address was published). Testnet only, no financial value; no authenticated BTC/USD price route on Arc is established here. |
| Chainlink Data Feeds/Streams/CRE on Arc — exact identifiers? | UNKNOWN for all three; partnership (Chainlink Scale) confirmed, no Arc-specific address, feed id, or workflow id published as of 2026-09-11. |
| Uniswap v4 pools on Arc — confirmed live? | Not confirmed by canonical Uniswap sources or by a direct on-chain testnet read; one internal Uniswap playbook file names a mainnet address, marked verification-pending, for a mainnet with no public RPC yet. |
| Existing pools/depth for these pairs? | None confirmed. One unrelated third-party Uniswap-V2-clone project ("Arc Swap") exists on testnet and must never be described as an official Uniswap deployment. |
| Does pool creation need UNICA's own liquidity? | Very likely yes, if UNICA wants one — itself a reason to stay disabled, not a reason to proceed thinly seeded. |
| Can EURC/USDC be safely offered? | No, not yet. |
| Can a BTC-asset/USDC market be safely offered? | No, not yet. |

## Governing conclusion

Every thread here terminates the same way: **Arc mainnet is not yet public,
no authenticated Chainlink price route on Arc has a published exact
identifier, and no adequately deep, verifiable pool exists for EURC/USDC or
any BTC-asset/USDC pair.** Per the rule recorded for this workstream, the market
for both non-USDC/USDC pairs **fails closed and stays disabled** in UNICA
until those specific, named gaps — a public Arc mainnet RPC, a Chainlink (or
equivalent authenticated) feed address confirmed on Arc, and a pool with
measured, adequate depth — are each independently closed and re-verified the
same way the facts in this document were: primary source plus, where
possible, a direct on-chain read.
