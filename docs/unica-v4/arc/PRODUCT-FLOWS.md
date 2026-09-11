# Product flows, in plain language, and what a dashboard could show

Read-only research, simulation and planning only. Nothing here was broadcast, signed,
deployed, or published. Retrieved/written **2026-09-11**.

**What this file is.** Five business scenarios, described the way a non-technical reader would
explain them, then checked line by line against what actually exists: this repository's own
contracts (`src/`), this repository's own draft specification for the next release
(`docs/unica-v4/SPEC-CONTRACTS.md` and `docs/unica-v4/DECISIONS.md` — both explicitly **"draft,
not committed"** by their own header lines, never treated here as if they were shipped code), and
the external facts this same directory's sibling files already established about Arc, x402,
Circle's tokens, and oracle/liquidity availability. Sibling files are treated as already-verified
primary-sourced research and are cited by filename rather than re-derived: `NETWORK.md` (Arc
identity and chain parameters), `TOKENS.md` (USDC/EURC/cirBTC/CCTP), `X402.md` (the x402
protocol and its Arc status), `NANOPAYMENTS.md` (the economics of very small payments),
`LIQUIDITY-ORACLES.md` (pricing and pool availability on Arc), `COMPATIBILITY.md` (whether
UNICA's own contracts can even run on Arc).

**Method for the "what exists" claims.** Every claim about UNICA's own code is grounded in a file
read directly on 2026-09-11: `src/SettlementExecutor.sol`, `src/V4SettlementHook.sol`,
`src/experimental/robinhood-testnet/UnicaStockSettlementExecutor.sol`, `README.md`,
`integrations/graph/schema.graphql`, `integrations/graph-v2/schema.graphql`,
`tools/unica-verify/`, `apps/web/src/routes.mjs`, and the two draft files named above. Where a
capability is described only in the draft specification and does not exist in any file under
`src/` today, that is stated plainly and is never presented as shipped.

## Legend — the four buckets, used consistently below

| Bucket | Meaning | Bar to clear |
|---|---|---|
| **WORKING NOW** | Exists in this repository's own code today, and either has settled a real transaction or is proven by a passing test suite against real deployed bytecode. | A file, a function, a test, or a transaction hash, each named. |
| **POSSIBLE, UNIMPLEMENTED** | Designed — in this repository's own draft spec, or as a documented capability of an external product UNICA has not yet wired to — but no UNICA contract or tool does it today. | The design exists on paper; nothing runs it. |
| **BLOCKED BY MISSING INFRASTRUCTURE** | Cannot be built responsibly yet because a fact outside UNICA's control is unconfirmed or absent: no contract address, no oracle feed, no production facilitator, no mainnet. | A named external gap, not a UNICA engineering task. |
| **FUTURE CONCEPT** | Not designed anywhere yet, including in the draft spec. A plausible next step once the blockers above clear, named here so it is not confused with the other three. | No design, no code, no ticket. |

A single flow usually touches more than one bucket at once — e.g., "the on-chain settlement leg
works today; the HTTP paywall in front of it does not exist" — and each flow below says so
explicitly rather than picking one label for the whole flow.

## 0. What UNICA actually is today, grounding every flow below

Four generations of UNICA settlement code exist in this repository, at four different levels of
reality. Nothing below conflates them.

| Generation | Where | Status | Payer binding (`WrongPayer`) | Caps | Multi-asset config |
|---|---|---|---|---|---|
| **V1** (`SettlementExecutor.sol` + `V4SettlementHook.sol`) | `src/` | **Live and verified on Ethereum Sepolia** (chain id 11155111). One real settlement: hook `0x6ff75c0b…9fd6`, executor `0x0a65819d…d828`, both `README.md` line 425. | **No.** `payer` in the `Order` struct is recorded as "the attributed user: the caller of `pay`" (`docs/RECEIPT-SCHEMA.md` row 5) — whoever calls `pay(orderId)` succeeds; there is no `WrongPayer` error anywhere in `src/SettlementExecutor.sol` (confirmed by reading its full error list). | None. No cap field, no allowlist, no pause exists in `src/SettlementExecutor.sol` or `src/V4SettlementHook.sol`. | None. One hardcoded shape: native ETH in, one payout currency out (`src/V4SettlementHook.sol`, `_beforeInitialize`). |
| **Experimental (Robinhood-testnet)** | `src/experimental/robinhood-testnet/` | **Settled once**, chain 46630, then **frozen** under tag `experimental-46630-settled` — never redeployed, never changed. Pay tx `0x9cb16eeab49670283b8c2a36241e89e5239df45523660afdc36491a0453ec300`, block 117535202. | **Yes.** `UnicaStockSettlementExecutor.pay` reverts `E.WrongPayer(orderId, o.boundPayer, msg.sender)` when a non-zero `boundPayer` doesn't match the caller (lines 152–154). | None found by direct search of the file. | None — one asset pair per deployment, fixed at construction. |
| **V2** | `src/v2/` | **"Frozen RC, undeployed"** — `README.md` line 57's own words. No chain has ever run it. | Binds the payer's half of a signed quote only; Advisory 001 (`docs/v2/SECURITY-ADVISORY-001.md`) found the merchant's half is not bound in the same digest — a known, documented gap in undeployed code. | None. | A signed merchant quote names `tokenIn`/`tokenOut`, but this is per-order, not a merchant-wide accepted-assets list. |
| **V4 draft** (`docs/unica-v4/SPEC-CONTRACTS.md`) | not built anywhere | **Draft only** — the file's own header: "Draft for owner review, not committed, authorising nothing." | Yes, by design (`OrderCreated.boundPayer` always non-zero, §9). | Yes, by design: `Caps{maxPerTxPayout, maxPerDayPayout, maxSeedPayout}` per market, checked on every `pay` (§9.2). | Yes, by design: `MarketConfig{asset, payout, ...}`, one registry entry per (asset, payout) pair, so a merchant-facing "accepted assets, one settlement token" policy (`DECISIONS.md` items 38–40) becomes possible once built. |

**None of the four generations reads a Chainlink price, calls an x402 facilitator, or has ever
touched Arc.** Every Arc-specific and x402-specific claim in the five flows below is therefore
about *whether the pieces exist to build the flow*, not about a flow UNICA has already run there.

A fifth, non-contract piece matters for the dashboard section (§6): `apps/web/` is a **static site
generator** producing pages named `status/`, `receipt/`, `merchant/`, `pay/` (`apps/web/src/routes.mjs`).
Its own text is explicit about what it is not: "wired to any chain and cannot become enabled by a
link, a setting, or a wallet" (`apps/web/src/components.mjs` line 66); its status regions read
"Orders have not been read yet," "Not yet read. This page states its pins whether or not script
runs," and "Connect a wallet to register an order." **This is page structure and copy, not a
working dashboard** — no fetch, RPC client, or wallet library appears anywhere in `apps/web/src/`.
Separately, `tools/unica-verify/` is a real, working, read-only CLI that checks one V2 receipt
against a quote and a chain read (`tools/unica-verify/cli.mjs`) — a reconciliation primitive that
exists today, for the one generation (V2) that has never been deployed.

## 1. Flow A — a business charging nano payments per API call

**The plain-language shape.** An API provider wants to charge, say, $0.001 every time a client
calls one endpoint — no subscription, no invoice, no minimum. A client (human-run or a script)
hits the endpoint, gets told a price, pays it in one round trip, and the response comes back.

**How the pieces would have to fit.** `X402.md` §3's twelve-step flow is exactly this shape: the
server returns `402` with a price, the client signs a payment authorization, the server (directly
or via a facilitator) settles it, then serves the response. That protocol carries the
*authorization/collection* leg well; it has no concept of what UNICA would add on top (order
binding, conversion, a receipt with UNICA's own fields) — `X402.md` §11's own conclusion is to let
x402 *front* UNICA settlement for exactly this reason, never replace it.

**Where it breaks today, concretely — the economics.** `NANOPAYMENTS.md` §13 computed the actual
number: at Arc testnet's measured gas price, a single on-chain settlement (the shape both UNICA's
`pay()` calls and x402's `exact`/EIP-3009 scheme use) is only economically sensible above roughly
**$0.04 per payment** (a fee-vs-payment ratio bar of 5%, chosen and labeled as a threshold in that
file, not an official one). A $0.001 charge on a one-payment-per-call design **loses the merchant
money on every single call**, before any facilitator fee — the same file's §4 table shows a
merchant who bears gas nets **negative** dollars on a $0.001 charge. This is not a UNICA-specific
defect; it is the reason Circle itself built batching (`NANOPAYMENTS.md` §5, quoting Circle's own
"1,000% to 5,000% of the total amount" framing for even smaller charges on other chains).

**Bucketed:**

| Piece of the flow | Bucket | Why |
|---|---|---|
| One on-chain settlement per call, above ~$0.04 | **WORKING NOW** | This is exactly what V1's `pay()` already does on Sepolia today — one order, one swap, one receipt (§0). No Arc-specific or x402-specific change needed for a $0.10 or $1.00 per-call charge. |
| One on-chain settlement per call, at $0.001 or $0.01 | **BLOCKED BY MISSING INFRASTRUCTURE**, on economics alone | Not a UNICA code gap — the flat network-fee floor makes it lose money regardless of which chain or contract runs it (`NANOPAYMENTS.md` §13). |
| A `402`-shaped HTTP paywall in front of the API endpoint | **FUTURE CONCEPT** | Nothing in this repository serves a `402` response, parses a `PAYMENT-SIGNATURE` header, or calls a facilitator's `/verify`/`/settle`. This is server-side application code UNICA has not written. |
| Batched settlement (many signed authorizations, one periodic on-chain transaction) to cover the $0.001–$0.01 range | **POSSIBLE, UNIMPLEMENTED** | The mechanism is well-documented (Circle's own Gateway/Nanopayments product, `NANOPAYMENTS.md` §5) and is x402's own `batch-settlement` scheme (`X402.md` §5.3), but no UNICA contract accepts a batch, and no UNICA facilitator exists to run one. |
| Running any of this on Arc specifically, via the standard x402 facilitator ecosystem | **BLOCKED BY MISSING INFRASTRUCTURE** | `X402.md` §9's own verdict: neither the x402 protocol's canonical network registry nor the Coinbase CDP Facilitator lists Arc at all as of this retrieval. Only Circle's own Gateway/Nanopayments product supports Arc, testnet-only, and it is Circle-operated — not something UNICA can point a generic x402 client at today. |
| A UNICA-specific x402 extension that binds a full UNICA quote digest (not just a flat recipient) into the signed authorization, so a relayer cannot substitute a different order | **FUTURE CONCEPT** | Named as a real gap and a real next step in `X402.md` §11, but no such extension exists in any spec version fetched, and UNICA has not begun designing one. |

## 2. Flow B — a creator charging per article, download, or stream

**The plain-language shape.** A creator gates one piece of content (an article, a file, a minute
of streaming) behind a price, named upfront, paid once, per unit — closer to a vending machine
than a subscription: no account required, no recurring charge, and the creator wants to know
*which* piece of content was paid for, not just that some payment arrived.

**Two separable legs, graded separately.** This flow is really two things stacked: (1) an
on-chain settlement that moves the payer's asset to the creator, and (2) an application-layer
gate that decides, from that settlement, whether to serve the specific article/file/stream
segment. Every UNICA generation in §0 only ever built the first leg.

| Piece of the flow | Bucket | Why |
|---|---|---|
| A payer-bound order naming exactly one recipient, settled once, with a receipt | **WORKING NOW**, on the experimental generation only | `UnicaStockSettlementExecutor.createOrder`'s `boundPayer` and `pay`'s `WrongPayer` check (§0) are exactly "this specific payer, this specific recipient, once" — proven by the one real 46630 settlement. **Not** true of the *live* V1 Sepolia deployment, which has no payer binding at all (§0) — on V1 today, any address that knows an `orderId` and holds the input asset can settle it, which is the wrong shape for "only the person who paid gets the content." |
| Resolving the creator's payout address from a human-readable name before payment | **WORKING NOW** | ENSv2 merchant resolution is live on Sepolia — `README.md` line 21, `nfteria.eth` resolved to `0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73` and used in a real settlement (line 369). This is the "who gets paid" half of a creator flow, already proven. |
| An identifier tying one settlement to one specific piece of content (this article, not that one) | **POSSIBLE, UNIMPLEMENTED** | The `orderId` (`keccak256(chainid, executor, count)` in V1; a caller-chosen `salt` in the experimental/draft generations) already gives one unique id per order. Nothing stops a creator from minting one order per content item today — but no code in this repository does that mapping; it would be the creator's own off-chain bookkeeping, one order-creation call per item. |
| The actual paywall — a server that checks "has *this* order been paid" before streaming bytes back | **FUTURE CONCEPT** | No HTTP server, middleware, or gating logic exists anywhere in `src/`, `apps/web/`, or `tools/`. `apps/web/`'s `pay/` and `receipt/` pages are static shells (§0) — they describe what a checkout and a receipt page would look like, not a working content gate. |
| Letting an *unnamed* buyer pay (a public "buy this article for $2" link, no pre-known payer) | **POSSIBLE, UNIMPLEMENTED**, gated by an open decision | `DECISIONS.md` item 111/128: a public payment-link mode is explicitly deferred to "v5... behind a separate signed-intent security review that starts with Advisory 001." It is designed-for, not designed, and not built. |
| Per-play/per-second metering of a stream (rather than one flat per-unit charge) | **FUTURE CONCEPT** | This is x402's `upto` scheme shape (`X402.md` §5.2: pay up to a ceiling, settle the metered actual) — a real, specified mechanism, but nothing in UNICA implements or calls it, and it is not mentioned in the v4 draft spec at all. |

## 3. Flow C — an AI agent paying another service

**The plain-language shape.** No human clicks anything. One piece of software (an "agent," running
on a schedule, in response to another event, or as part of a longer task) needs a second service
— another agent, an API, a data feed — and has to pay for it itself, using its own wallet, without
a person approving the specific charge in the moment.

**What an agent needs, and what UNICA and x402 each supply.** `X402.md` §6 is explicit that this
needs a **programmatic wallet** that can sign EIP-712 typed data without a human in the loop
(`docs.privy.io`, quoted there: "Programmatic wallets... let agents sign EIP-712 payloads without
exposing seed phrases") — not a browser, not a person's private key typed by hand. Privy is
officially confirmed to support x402 this way (`X402.md` §10), but **not on Arc**: Arc is absent
from the network list on Privy's own x402 documentation page, per that same section.

**Whether an agent can pay a UNICA order today.** Mechanically, an agent that already holds a
funded EOA or a smart-account wallet, and has approved the input asset, can call `pay(orderId)` on
V1's live `SettlementExecutor` exactly the way any other caller would — there is nothing
Arc-specific or agent-specific blocking that call once the order exists. The gate is earlier in
the flow: `DECISIONS.md` item 111 restricts *order creation* to "approved merchants or approved
checkout creators" — an agent cannot mint its own order against a merchant it hasn't been
authorized against; it can only pay an order someone with creator status already made. Whether
that named payer is bound (so only *that* agent's key can settle it) again depends on which
generation is running: bound on the experimental generation, unbound on the live V1 deployment
(§0) — an unbound order is a materially weaker guarantee for an unattended agent, since anyone who
learns the `orderId` and holds the asset can settle it first.

| Piece of the flow | Bucket | Why |
|---|---|---|
| An agent calling `pay()` on an existing, already-created UNICA order with its own funded key | **WORKING NOW**, mechanically, on Sepolia | Nothing agent-specific is required; V1's `pay()` takes any caller (§0). This is a narrow claim: it says the call would succeed, not that the surrounding trust model is sound for an unattended agent (previous paragraph). |
| An agent *creating* its own order against an arbitrary merchant | **BLOCKED**, by design, not by missing tech | `DECISIONS.md` item 111's order-creator allowlist is a deliberate access-control decision, already enforced conceptually in the draft spec's `isOrderCreator` check (`SPEC-CONTRACTS.md` §4) — an intentional gate, not a gap to fill. |
| An agent speaking x402's HTTP negotiation (`402`, sign, retry, get the resource) to pay a UNICA-fronted service | **FUTURE CONCEPT** | No resource server, facilitator client, or `PAYMENT-SIGNATURE` handling exists anywhere in this repository. `X402.md` §6's whole point — any HTTP client, no browser needed — is exactly the shape an agent-to-agent flow wants, but UNICA has not built the server or client side of it. |
| Running that x402 leg on Arc, via a production facilitator | **BLOCKED BY MISSING INFRASTRUCTURE** | Same finding as Flow A: no production x402 facilitator lists Arc (`X402.md` §9); only Circle's own Gateway product does, testnet-only, Circle-operated. |
| A programmatic (embedded) wallet for the agent, provisioned through Privy, on Arc specifically | **BLOCKED BY MISSING INFRASTRUCTURE** | `X402.md` §10: Arc is not among the networks Privy's own x402 recipe names. Privy's general Arc account-abstraction support is listed as a third-party provider option in `NETWORK.md` §9(a) (live, but layered on ERC-4337, not x402-specific), a separate and narrower claim than "Privy's x402 flow works on Arc." |
| A spending-policy engine that screens *which* agent-signed authorizations are allowed (recipient allowlists, per-agent caps) | **FUTURE CONCEPT**, with a documented hazard already flagged | `X402.md` §10 quotes Privy's own caution directly: because x402 signs EIP-712 typed data rather than ordinary transactions, "standard transaction policies don't apply" — an embedded-wallet policy engine built for transaction allowlisting will not automatically catch a malicious x402 authorization. No UNICA design addresses this yet. |

## 4. Flow D — a merchant accepts EURC, receives USDC

**The plain-language shape.** A customer pays in euro-stablecoin (EURC); the merchant's payout
settings say "always give me dollar-stablecoin (USDC)," so a conversion happens somewhere between
the customer's payment and the merchant's payout, invisibly to the customer.

**Why this is a real conversion, not a rename.** `LIQUIDITY-ORACLES.md` §"Pair 2" is explicit that
EURC and USDC are "two distinct fiat-backed stablecoins... a genuine FX conversion, not a
representation change" — unlike, say, native-vs-ERC-20 USDC on Arc, which is one asset at two
decimal precisions and needs no conversion at all (`TOKENS.md` §4, `NETWORK.md` §4). A real FX
trade needs either an AMM pool with real depth plus a trustworthy price reference, or an
issuer-side conversion desk.

**What actually exists to convert it, on Arc, today.** Two paths were researched, both come up
short for a live UNICA flow:

1. **An AMM pool (Uniswap v4), priced against a Chainlink feed.** `LIQUIDITY-ORACLES.md`'s
   governing conclusion: no Chainlink Data Feed for EURC/USD (or any pair) has a published,
   Arc-specific contract address; no Uniswap v4 `PoolManager` on Arc is confirmed live by
   Uniswap's own canonical deployments source (`COMPATIBILITY.md` §3.2 independently reaches the
   same verdict for UNICA's own contracts); and even if a pool existed, one UNICA or a partner
   just seeded would have thin, manipulable depth (`LIQUIDITY-ORACLES.md`, "Low-liquidity
   manipulation"). All three gaps must close together before this path is safe.
2. **Circle's own StableFX product**, an RFQ/PvP desk that explicitly supports USDC↔EURC on Arc
   (`LIQUIDITY-ORACLES.md` §"Pair 2": "an institutional-grade stablecoin FX engine"). This is the
   economically sound path *in principle* — but it is gated to onboarded institutional
   makers/takers, and no public, callable integration surface for it was found anywhere in
   Circle's own materials.

**What UNICA's own contracts would need, and don't have.** Every UNICA generation in §0 hardcodes
one settlement shape. V1's hook enforces exactly "native ETH in, this chain's payout currency
out" (`COMPATIBILITY.md` §6.1, citing `src/V4SettlementHook.sol` lines 80–82) — there is no
"accept EURC" branch anywhere in it. The v4 draft's `MarketConfig{asset, payout, ...}` (§0 table)
is the first design that could name EURC as an accepted asset and USDC as the payout token — but
it is unbuilt, and even once built it still needs a real price route to do the conversion, which
is exactly the gap above.

| Piece of the flow | Bucket | Why |
|---|---|---|
| A merchant configuration that names "accepted assets" separately from "payout token" | **POSSIBLE, UNIMPLEMENTED** | Designed in `DECISIONS.md` items 38–40 and `SPEC-CONTRACTS.md`'s `MarketConfig`, not present in any deployed contract (§0). |
| Same-asset settlement (customer pays USDC, merchant receives USDC) | **WORKING NOW**, in shape, not on Arc | This is exactly what V1's live Sepolia settlement already proves as a pattern (pay one asset, deliver it or a swapped asset to a bound recipient) — `LIQUIDITY-ORACLES.md`'s own conclusion is that this specific pair "must never be routed through a swap, pool, or oracle-priced path" regardless of chain, which is the cheapest and safest version of this flow. |
| EURC-in, USDC-out via an AMM + Chainlink oracle on Arc | **BLOCKED BY MISSING INFRASTRUCTURE** | No confirmed Arc-specific Chainlink feed address, no confirmed live Uniswap v4 pool on Arc, no adequate pool depth (`LIQUIDITY-ORACLES.md` summary table, all three rows) — the file's own governing rule: the pair "fails closed and stays disabled" until all three close. |
| EURC-in, USDC-out via Circle's StableFX | **BLOCKED BY MISSING INFRASTRUCTURE** | The mechanism is real and Circle-operated, but not UNICA-callable — no public integration surface confirmed (`LIQUIDITY-ORACLES.md` §"Pair 2"). |
| A UI or merchant setting screen for choosing accepted assets and a payout token | **FUTURE CONCEPT** | `apps/web/`'s `merchant/` route is a static page shell (§0); no settings form, no persistence, no contract call is wired to it. |

## 5. Flow E — a customer pays a confirmed BTC asset, merchant receives USDC

**The plain-language shape.** A customer wants to pay in bitcoin (or a BTC-backed token), and the
merchant, exactly as in Flow D, wants USDC regardless. This is the same "conversion happens
invisibly" shape as EURC/USDC, except the asset in question is not even confirmed to exist at a
known address on Arc.

**Which asset this even is — still open.** Per this project's own standing rule, "cirBTC is
UNKNOWN until its exact contract and issuer are confirmed," and `TOKENS.md` §5 and
`LIQUIDITY-ORACLES.md`'s BTC section both did that confirmation work directly and came back short:

- Circle's own developer docs (`developers.circle.com/assets/what-is-cirbtc`) state cirBTC is
  live on "Arc: testnet"; Circle's own marketing page (`circle.com/cirbtc`) instead lists Arc under
  "Coming Soon." **Two Circle-owned pages disagree with each other**, fetched the same day.
- Arc's own contract-addresses reference page — the same page that lists USDC, EURC, USYC, and
  every CCTP/Gateway contract — **does not list cirBTC at all** (`TOKENS.md` §5).
- Arc's public block explorer returns **four different, mutually inconsistent tokens** that
  self-label as "cirBTC" (`TOKENS.md` §5's table), none confirmed as Circle's — including one
  explicitly named "Mock Circle BTC" and one a third party's "Demo cirBTC." Anyone can deploy an
  ERC-20 on a permissionless testnet and name it this; the explorer's "verified source" badge only
  means the bytecode matches submitted source, never that Circle deployed it.

**No confirmed address means no oracle, and no oracle means fail-closed.** Even setting the
identity question aside, `LIQUIDITY-ORACLES.md`'s Chainlink section found no BTC/USD (or
cirBTC/USD) feed with a published, Arc-specific contract address or feed id — Chainlink's own
canonical `docs.chain.link/data-feeds/price-feeds/addresses` page, searched directly, has zero
occurrences of Arc as a network. `LIQUIDITY-ORACLES.md`'s own governing rule applies without
qualification here: **without an authenticated oracle and adequate liquidity, this market fails
closed and stays disabled.**

| Piece of the flow | Bucket | Why |
|---|---|---|
| Identifying the exact BTC asset in scope | **BLOCKED BY MISSING INFRASTRUCTURE** | Not a UNICA decision to make — it needs Circle to resolve its own two-page contradiction and publish one address, or the owner to mint testnet cirBTC directly through Circle Mint and read the address it actually interacts with (`TOKENS.md` §5, "What the owner must provide"). |
| A confirmed BTC-asset/USDC price reference | **BLOCKED BY MISSING INFRASTRUCTURE** | No Chainlink Arc address; no other authenticated oracle route confirmed (`LIQUIDITY-ORACLES.md`). |
| A pool with real, measured depth for this pair | **BLOCKED BY MISSING INFRASTRUCTURE** | No such pool was found to exist on Arc by any source consulted, official or third-party (`LIQUIDITY-ORACLES.md`, "Existing pools and depth"). |
| A UNICA market configuration that could, once the above clear, name a BTC asset as accepted and USDC as payout | **POSSIBLE, UNIMPLEMENTED** | Same `MarketConfig` mechanism as Flow D — a generic capability the v4 draft designs but does not build (§0). |
| Treating any of the four explorer-found "cirBTC" tokens as the real asset | **NEVER** — not a bucket, a refusal | Per `TOKENS.md` §5's own ruling: "do not treat any of these as 'cirBTC' on Arc." Named here only so this flow is never quietly built against one of them. |
| A denylist or warning UI naming the known-impostor token addresses | **FUTURE CONCEPT** | `TOKENS.md` §5 recommends this ("so UNICA's docs and any denylist can name it explicitly"); nothing implements it yet. |

## 6. What a dashboard could show, field by field

By this project's own naming (`DECISIONS.md`, "Naming"): **"UNICA v4 is the modular
tokenized-asset market release. UNICA v5 is the dashboard."** A dashboard is therefore, by the
project's own plan, not part of this release at all — everything below is graded against that
context: some fields are backed by real, working data sources today even though no dashboard UI
reads them yet; others need a piece of infrastructure (a batching facilitator, an oracle, an Arc
mainnet) that does not exist regardless of who builds the UI.

| Dashboard field | Bucket | What backs it today, or what's missing |
|---|---|---|
| **Amount** (what the payer sent) | **WORKING NOW**, as raw data | `Settlement.amountIn` (`integrations/graph/schema.graphql` line 19) and the equivalent `InvoiceSettlement.actualIn` (`integrations/graph-v2/schema.graphql` line 30) are both real, indexed, on-chain-sourced fields — for whichever generation is actually deployed (today, only V1's schema has anything to index; V2's schema indexes a generation that has never been deployed, §0). |
| **Asset** (what currency moved) | **WORKING NOW** | `Settlement.currencyIn`/`currencyOut` — the same schema, same line range. On Arc specifically, remember the two-interface trap: native USDC (18 decimals) and the ERC-20 USDC interface (6 decimals) are one balance, not two assets (`TOKENS.md` §4) — a dashboard that sums both as if separate would double-count. |
| **Merchant amount** (what the merchant actually received, which can differ from the raw swap output) | **WORKING NOW**, only on the undeployed V2 schema; **collapses to the same number as "amount out" on live V1** | `InvoiceSettlement` deliberately stores both `amountOut` (what was asked for) and `deliveredOut` (what arrived), "so an auditor can check rather than trust" (`integrations/graph-v2/schema.graphql` lines 36–38) — but V2 has never settled anything (§0). On the live V1 generation, full-fill is enforced at the contract level (no partial fills, `RECEIPT-SCHEMA.md` row 10) and there is no separate hook fee skimmed off the recipient's delivery, so "merchant amount" and the receipt's `amountOut` are the same number there — a real answer, just a narrower one than V2's design gives. |
| **Network fee** (gas cost of the settlement transaction) | **POSSIBLE, UNIMPLEMENTED**, as a UNICA-surfaced field; **available generically** | No UNICA receipt schema carries a gas-cost field at all — `gasUsed`/`effectiveGasPrice` live on the transaction receipt itself, readable from any RPC or explorer, but no UNICA subgraph or tool joins that onto a settlement row today. |
| **Conversion fee** (what the swap actually cost in LP/protocol fees) | **POSSIBLE, UNIMPLEMENTED**, and a documented gap, not a guess | The live V1/experimental receipt's `fee` field is a hardcoded literal `0` meaning "the hook's own fee," never the pool's LP fee — `docs/experimental/STOCK-46630-FEE-FIELD.md` documents exactly this on the one real settlement that ran: the receipt said `fee = 0` while the PoolManager's own `Swap` event in the same transaction reported `fee = 3000` (0.3%, paid to liquidity). The true fee *is* on-chain, in a different event, in the same transaction — a dashboard could join the two today, but none does. The v4 draft's four-field breakdown (`hookFeePips`, `lpFeePips`, `protocolFeePips`, `swapFeePips`, `SPEC-CONTRACTS.md` §11) fixes this by design, but is unbuilt. |
| **x402 status** (payment-required sent, verified, settled per a facilitator) | **FUTURE CONCEPT** | No UNICA contract, script, or tool references x402 anywhere in `src/`, `script/`, or `tools/`. This field cannot exist until Flow A/C's HTTP paywall and facilitator integration are built at all (§1, §3) — and, on Arc, until a production facilitator exists to report a status from (`X402.md` §9). |
| **UNICA settlement status** (open, paying, settled) | **WORKING NOW** | The `Status` enum (`None`, `Open`, `Paying`, `Settled`) is real, on-chain, and readable via a `view` call on every deployed generation (`src/SettlementExecutor.sol`'s `Status` enum; the identical shape in the experimental generation and the v4 draft, §0). `Settled` is specifically the success signal, distinct from the hook's own receipt (`SPEC-CONTRACTS.md` §11: "a receipt without `Settled` cannot survive"). |
| **Request/order id** | **WORKING NOW** | `orderId`, a `bytes32` — indexed as `Settlement.orderId` / `InvoiceSettlement.quoteDigest` in both subgraph schemas, and the primary key an indexer, a verifier, or a support request would use to look up one payment. |
| **Tx hash** | **WORKING NOW** | `Settlement.transactionHash` / `InvoiceSettlement.transactionHash`, both schemas, both indexed fields sourced directly from the block the receipt was emitted in. Example, labelled: pay tx `0x9cb16eeab49670283b8c2a36241e89e5239df45523660afdc36491a0453ec300` is the one real settlement this project has run end to end. |
| **Failure reason** (why a payment attempt did not settle) | **POSSIBLE, UNIMPLEMENTED** | The reason exists and is precise — every guard in this codebase reverts with a named, typed error (`WrongPayer`, `OrderExpired`, `OutputBelowMinimum`, `DailyCapExceeded`, and the full list in `SPEC-CONTRACTS.md` §9.3) — but a reverted transaction emits no event, and neither subgraph schema indexes failures at all; both are built from successful `Settlement`/`InvoiceSettlement` logs only. Surfacing a failure reason on a dashboard needs a different data path: a direct RPC trace or simulation of the failed transaction, which no UNICA tool does today. |
| **Daily volume and caps** | **BLOCKED, not by external infrastructure but by the project's own build order** — effectively **POSSIBLE, UNIMPLEMENTED** | `DECISIONS.md` items 5–7 record the beta caps ($100 total, $10 per transaction, $25 per day) as a decision, and say "Enforced on-chain" — but that describes the *intent*, not shipped code: no cap field, `payoutUsedOnDay` accounting, or allowlist exists in the live V1 contracts or the experimental generation (confirmed by direct search of both files, §0). The accounting mechanism is fully designed in the v4 draft (`SPEC-CONTRACTS.md` §9.2: `payoutUsedOnDay[day] + delivered ≤ maxPerDayPayout`, checked on every payment) — a real, specific design, just not yet built anywhere a dashboard could read from. |
| **Reconciliation / export** | **WORKING NOW**, as a CLI primitive; **FUTURE CONCEPT**, as a dashboard feature | `tools/unica-verify/cli.mjs` is a real, working, read-only tool that checks one settlement receipt against a signed quote and (optionally) a live chain read, for V2's receipt shape — reconciliation, not export, and command-line only, for a generation that has never been deployed. Querying either subgraph's GraphQL endpoint for a date range is a real, available way to get settlement rows out today, for whichever generation is actually indexed and live — but no packaged "export to CSV" or scheduled reconciliation report exists anywhere in this repository. |

## Sources

Every external fact above is carried by reference from this directory's own already-verified
files, not re-derived: `NETWORK.md`, `TOKENS.md`, `X402.md`, `NANOPAYMENTS.md`,
`LIQUIDITY-ORACLES.md`, `COMPATIBILITY.md` — each retrieved/verified 2026-09-11, per their own
headers. Every UNICA-code fact above was read directly, on 2026-09-11, from: `src/SettlementExecutor.sol`,
`src/V4SettlementHook.sol`, `src/experimental/robinhood-testnet/UnicaStockSettlementExecutor.sol`,
`README.md`, `docs/RECEIPT-SCHEMA.md`, `docs/experimental/STOCK-46630-FEE-FIELD.md`,
`docs/unica-v4/DECISIONS.md`, `docs/unica-v4/SPEC-CONTRACTS.md`, `integrations/graph/schema.graphql`,
`integrations/graph-v2/schema.graphql`, `tools/unica-verify/cli.mjs`, `tools/unica-verify/receipt.mjs`,
and `apps/web/src/routes.mjs` / `apps/web/src/components.mjs`. `docs/unica-v4/DECISIONS.md` and
`docs/unica-v4/SPEC-CONTRACTS.md` are both explicitly self-labeled drafts, not committed and not
built — used here only to describe the **POSSIBLE, UNIMPLEMENTED** bucket, never the **WORKING
NOW** one.
