# UNICA v4 — decision ledger

Draft, not committed. Each line records a decision and where it came from: an owner ruling, the
evidence, or an accepted recommendation. The v4 specification is written from this ledger. A
decision marked **OPEN** blocks the specification. "UNICA v4" is a UNICA release; "Uniswap v4" is the
AMM.

## Standing owner rulings, 2026-09-11

- **Naming.** UNICA v4 is the modular tokenized-asset market release. UNICA v5 is the dashboard. The
  frozen experimental deployment (tag `experimental-46630-settled`) is not v4.
- **Sponsor order, permanent.** 1 Uniswap v4, 2 ENSv2 on Sepolia, 3 The Graph. Chainlink and Privy
  are additional planned integrations. Replacing any of the three is a separate decision.
- **Oracle.** A generic `IUnicaPriceOracle` with interchangeable adapters. Each market has its own
  policy (adapter, feed, maxAge, maxDeviationBps, enabled). Settlement fails closed; there is no
  demonstration-rate fallback. A mock oracle is only for local and fork tests. No feed address is
  ever invented.
- **Chain-generic.** The contracts carry no chain constants. There is one settings file per chain,
  and a chain helper identifies the chain by the chain id the RPC reports. Scripts refuse any chain
  without an enabled settings file; this release enables 46630 only.
- **Track.** From Scratch, confirmed by the owner on 2026-09-11. Earlier drafts naming Continuity are wrong.
- **Mainnet before submission** is a product goal, not permission to bypass a security gate.
- **UX direction.** Stripe information architecture, Coinbase Commerce checkout, and Privy, Shopify,
  Uniswap, Safe, explorer and Linear patterns. Interaction patterns are borrowed; brand identity
  never is.
- **NFTeria.github.io.** Remove the names, testimonials, LinkedIn links and portraits.

## UX answers (owner, confirmed)

| # | Decision |
| --- | --- |
| 122 | The prototype lives in `prototype/unica-v4-ux/`, which the Pages workflow never publishes. |
| 123 | Fixtures come only from the real 46630 settlement, labelled "Testnet demonstration — no-value tokens". No invented USDC, ETH, Base, oracle or mainnet activity. |
| 124 | UNICA has its own identity: indigo/electric blue, neutral grounds, green for success, amber for oracle or quote warnings, red for failure. It may say "by NFTeria" but does not reuse NFTeria's visual identity. It follows Stripe-like information architecture and Coinbase-Commerce-like checkout patterns, without copying branding, code, exact layouts or wording. |
| 125 | Chainlink is shown as "planned" until authenticated pricing is active in deployed contracts. If it is only fork-tested, the label is exactly "Chainlink integration demonstrated on a fork", with a link to the evidence. Never "Chainlink secured" on planned code or mock data. |
| 126 | The public-site outline applies to `nfteria.github.io/UNICA/`. The NFTeria root stays a separate company overview that links to UNICA. |
| 127 | The five-screen static prototype is built after the specification checkpoint, with frozen fixtures. Live contract integration waits until the event schema and deployment manifest are frozen. |

## Corrections (owner, confirmed; these supersede the recommendations)

| # | Decision |
| --- | --- |
| 2 | "Mainnet success" means contracts deployed, source verified, independently read back, and one capped real-value settlement, only if every launch gate passes. Never force a value-moving transaction to meet the deadline. |
| 10 | A value-moving mainnet launch needs every required capability. A missing capability cancels the mainnet settlement, not the submission. |
| 25 | Maximum age is capped independently per market and never derived from the feed heartbeat alone. Crypto: at most 5 minutes initially. Equities: only during supported market hours, at the strictest freshness the authenticated product safely supports. A 24-hour-old equity price is never acceptable for payment. |
| 30 | For the preserved 46630 experiment: label it, and prove the oracle on a fork. Oracle-disabled markets are demonstration-only and are never described as market-priced or production-ready. Mainnet settlement fails closed unless an authenticated oracle route is operational for that market. |
| 86 | `nfteria.github.io/UNICA/` holds the static prototype and the public evidence page. It is not called a production hosted checkout if a flow needs server sessions, secrets, APIs or webhooks. A later production checkout gets a dedicated domain and backend hosting. |
| 90 | Direct RPC reads for current state and immediate confirmation. The Graph serves indexed history wherever the chosen chain is supported; otherwise a bounded event indexer, or a clearly limited beta history view. The Graph stays in the permanent top three. |
| 111 | Order creation is restricted to approved merchants or approved checkout creators. Every order binds an explicitly named payer, unless a separately designed public payment-link mode exists with its own caps and replay protections. Only the bound payer may settle a payer-bound order. `WrongPayer` is preserved. |
| 112 | States are PROPOSED, INITIALIZED, SEEDED, ACTIVE, PAUSED and RETIRED. RETIRED is terminal and cannot be reactivated. A pair may later get a new versioned market id; the retired record and its history stay discoverable. |
| 120 | If mainnet gates fail, the submission is the independently verified testnet result plus the fork oracle evidence, never represented as mainnet or oracle-live. |

## Settled by evidence

- **Deadline:** Sunday 13 September 2026, 12:00 pm EDT (16:00 UTC).
  `ethglobal.com/events/ethonline2026/info/details`, retrieved 2026-09-11T17:43:39Z. The same page
  allows up to 3 Partner Prizes.
- **Chainlink on 46630:** no Data Feeds for TSLA or NFLX, and no sequencer-uptime feed.
  - The Data Streams VerifierProxy is live, but reports are paid-only, and whether a TSLA/NFLX
    report verifies there is UNCONFIRMED.
  - The CRE forwarder is live, but hosted writes are unproven and our deploy access is not enabled.
  - CCIP is live, but no connected testnet carries a TSLA or NFLX feed.
- **Robinhood Chain mainnet (4663):** "Robinhood TSLA / USD" proxy
  `0x4A1166a659A55625345e9515b32adECea5547C38`. It reports the token's total-return value, publishes
  nothing off-hours, and holds its last value while the token's `oraclePaused()` is set. There is no
  NFLX feed. Uniswap v4, USDC and Privy on 4663 are UNKNOWN until the capability probe runs.
- **Mainnet capability probe** (2026-09-11 about 18:10 UTC, read-only, keyless public RPCs, every
  YES re-checked independently). Chains that pass all six (Uniswap v4, Chainlink ETH/USD and
  USDC/USD, Circle USDC, Privy, Safe, explorer verification): **Arbitrum One 42161**, Base 8453,
  Ethereum 1.
  - **Robinhood Chain 4663 fails:** no Circle USDC (bridged USDC arrives as USDG), Privy
    unconfirmed, no sequencer-uptime feed.
  - **Unichain 130 fails:** Privy unconfirmed.
  - **Recommended for Q9: Arbitrum One.**
    - Standard `eth-usd` feed `0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612` (8 decimals, heartbeat 1755 s).
    - Standard `usdc-usd` feed `0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3` (heartbeat 255 s).
    - Sequencer-uptime feed `0xFdB631F5EE196F0ed6FAa767959853A9F217697D`.
    - Native USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`.
    - Uniswap v4 PoolManager `0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32`.
    - Gas for about 12M gas is about $0.61 (ESTIMATE, excluding the L1 data fee).
  - **Semantic limit:** a 1755 s heartbeat means a correct price can be older than Q25's 5-minute
    crypto cap in a calm market. maxAge must be set from the feed's measured update cadence,
    failing closed.
  - **Q9 itself stays OPEN** for the owner to confirm.
- **The testnet experiment stays** (tag `experimental-46630-settled`, e5a0185). Published tags are
  never moved.
- **Merging unicaV4 into main** would be a fast-forward (29 ahead, 0 behind) and touches no file
  under `web/`. **Corrected 2026-09-11** (`UPGRADEABILITY-AND-HOOKS-REVIEW.md`): the range DOES
  change `.github/workflows/pages.yml` itself (commit 7eacf49) and `ci.yml`. `pages.yml` is one of
  its own trigger paths, so a push of `main` would START the Pages workflow. Its check job always
  runs, and its deploy job runs only if the repository variable `PAGES_ENABLED` is set. The range
  is also not documentation-only: it changes experimental source, tests, scripts and application
  code. See `UPGRADEABILITY-AND-HOOKS-REVIEW.md` §12.

## Recommendations the owner accepted with the corrected block

Confirmed by the owner: "ACCEPTED RECS: yes, including Q128–Q130."

- 3: deploy mainnet by 12 Sep 16:00 UTC; keep the last 12 h for the video and submission.
- 4: guarded beta with caps and an allowlist.
- 12: one chain first.
- 13: USDC if it is Circle-native on the chosen chain.
- 15: crypto assets at the mainnet launch; test stock tokens stay on testnet; equities are listed as future support.
- 21: equities described as future support until legal support exists.
- 24: fail closed, and mark the market STALE_ORACLE.
- 26: 200 bps default deviation, set per market.
- 27: equities settle only while the market is open.
- 28: the pool executes; the hook enforces the oracle bound.
- 29: markets pause independently.
- 31: invitation-only merchants during the beta.
- 32: business profile off-chain; merchant id and payout configuration on-chain.
- 36: integration ranking: hosted checkout, React component, REST API, contract interface, button, plugins.
- 37: the default merchant flow (with the correction from 111).
- 38 and 39: the merchant sets accepted assets and receives one stablecoin.
- 40: v4 settings are accepted assets, settlement token, min/max payment and expiry.
- 41 to 43: no refunds, subscriptions or partial payments in v4.
- 44: the receipt fields.
- 45: no webhooks before mainnet.
- 46: ENS names are optional metadata.
- 47 to 52 and 54: Privy defaults.
- 55: no UNICA fee in the beta.
- 58: fees disclosed and recorded apart from LP fees.
- 60: capped fee changes behind a timelock, if fees ever exist.
- 62 and 63: a Safe owns administration.
- 65: separate PAUSER (pause only) and ADMIN (Safe) roles.
- 66: nothing upgradeable.
- 68: isolated markets.
- 72 to 75: safety gates and launch-abort conditions.
- 76: merge unicaV4 into main after review.
- 78: publish the site after the repo and explorer links are ready.
- 81: "capped mainnet beta" only if tier 2 passes.
- 87 to 89: no API, database or webhooks in v4 unless tier 2 ships.
- 93: platform secret storage.
- 94: the v4 surfaces collect nothing themselves.
- 100: Privy only if its credentials are ready by 12 Sep 12:00 UTC.
- 103: source verification is mandatory.
- 105 to 107: payout-wallet signature, hashed API keys and HMAC webhooks, if those ship.
- 109: required disclaimers.
- 113 to 118: reuse uTUSD; the `unica-v4` directory names; activation after readback; the verification labels; the beacon pin; the fork protocol-fee test.
- 121: the three-scope cut line.

## Owner answers, second round (2026-09-11)

The owner confirmed "ACCEPTED RECS: yes, including Q128–Q130." A bracketed template placeholder left
unfilled is recorded as **NOT PROVIDED** and handled the way the owner's own notes direct.

| # | Decision |
| --- | --- |
| 5 / 6 / 7 | Beta caps: $100 total at risk, $10 per transaction, $25 per day. Enforced on-chain. |
| 9 | Chosen after the capability probe. A real-value launch only if every required capability is confirmed. |
| 11 | Robinhood Chain mainnet is preferred, not mandatory. |
| 14 | Liquidity from a founder-controlled Safe, $100 maximum. |
| 16 | No authorized equity issuer. |
| 17 | Transfer restrictions unknown until an issuer is selected. |
| 18 / 19 | Jurisdictions and US persons are not determined and require counsel. |
| 20 | **NO CONFIRMED REVIEW.** Blocks legal claims and any real tokenized-equity scope. |
| 23 | No licensed equity data contract. |
| 33 | Beta business fields: business name, country, website, business email, verified payout wallet. |
| 34 | No KYB provider. |
| 35 | Founder-controlled or specifically invited test merchants only. |
| 53 | Privy-supported recovery. UNICA never requests or handles seed phrases. |
| 56 / 57 / 59 / 61 | No fee: fee payer n/a, launch fee 0, fee recipient n/a, free beta. |
| 64 | **NOT READY.** No mainnet value movement until the Safe's chain, address, signers, threshold and hardware-wallet control are verified, and a test transaction has executed. |
| 69 | Incident procedure: pause, publish a notice, preserve evidence, investigate, redeploy if necessary. |
| 70 | **NOT READY.** The rule stands: the pauser may pause but never unpause, and the Safe unpauses. |
| 71 | **NOT READY.** A mainnet launch blocker under the accepted gates. |
| 79 | Remove all listed personal and unsupported NFTeria content. |
| 80 | Keep the current LICENSE for now, pending a separate licensing decision. |
| 82 | The owner approves non-legal product claims. Claims about securities, compliance or legal availability require counsel. |
| 91 | **NOT SELECTED** (primary and fallback RPC). |
| 92 | Monitoring: an event watcher and explorer alerts. |
| 95 | **NOT PROVIDED** (account ownership and payment for Privy, RPC, Chainlink, hosting). |
| 96 / 97 / 98 | **UNKNOWN/NOT PROVIDED** for the Privy account, app ID and server secret. Only whether the secret is configured is ever recorded; the secret itself is never requested or recorded. |
| 99 | `nfteria.github.io` is proposed; production configuration is **NOT CONFIRMED**. |
| 101 | A fresh mainnet EOA funded only for deployment gas. Administration transfers to the Safe. |
| 102 | Gas budget set after simulation on the selected chain. |
| 108 | **NOT READY** (merchant terms), so no public merchant beta. |
| 110 | TSLA demonstration rate 395; seed 100 uTUSD per market; payment 0.001 token; merchant 0x19E56831a10d43CfF5d77f886c799C6b916da7Ae (whether the owner controls it: UNKNOWN/NOT PROVIDED). **NFLX rate NOT SELECTED:** NFLX is removed from the current rehearsal unless the owner later approves a documented demonstration rate. Configuration-only onboarding is proven in local and fork tests, not by a live NFLX market. |
| 119 | **UNKNOWN/NOT PROVIDED** (final video). |
| 128 | v4 uses payer-bound orders only. Public payment links move to v5, behind a separate signed-intent security review that starts with Advisory 001. |
| 129 | The NFTeria root home page is reordered company-first. |
| 130 | The three obsolete SVG snippet URLs may return 404. |
| 131 | **NO AUTHORIZATION.** Do not push, trigger Pages, or publish. Publishing will need two separate approvals: push the reviewed changes; then trigger the Pages rebuild after the generated site has been checked. |

## Upgradeability (owner, 2026-09-11; supersedes nothing: it confirms Q66 and bounds it)

| # | Decision |
| --- | --- |
| U1 | A market hook is never upgradeable. New rules require retiring the old market and deploying a new version. |
| U2 | The executor is never upgradeable, because it controls payer binding and the movement of funds. |
| U3 | The registry is not proxy-upgradeable. Only explicitly bounded registry data may change, through defined roles. |
| U4 | The factory is not upgradeable. A new factory ships as a separately identified UNICA release with a new manifest. |
| U5 | Oracle adapters are not proxy-upgradeable. Tightening an existing safety parameter is permitted only where the contract explicitly bounds it. Replacing an adapter or changing oracle semantics requires retiring the market and creating a new version. |
| U6 | No contract upgrades are authorized, so there is no upgrade role and no upgrade timelock. Bounded administrative changes go through the Safe and emit events. Any future proposal to introduce upgradeability needs a new owner decision, a threat model, an independent review and a public notice policy. |
| U7 | The implementation behind every supported external proxy or beacon is pinned in reviewed chain configuration. Implementation changes are monitored and alert the operator automatically. After a detected mismatch the emergency pauser must pause the affected markets. Reopening requires Safe review and a new, independently verified configuration. |
| U8 | The emergency controls are: instant PAUSE by the pauser, Safe-controlled unpause after review, and terminal RETIRE by the Safe. No hot-patching. |
| U9 | Off-chain components may change through reviewed commits. They must never alter the immutable identity or settlement rules of an existing on-chain market. |

## Specification choices (owner, 2026-09-11)

| # | Decision |
| --- | --- |
| S1 | Only the (fee, tickSpacing) pairs (500, 10), (3000, 60) and (10000, 200) are allowed; the factory rejects every other pair. Each market configuration and deployment manifest records the selected fee and tick spacing. No deployment is assumed to use 0.3%. |
| S2 | Both ADMIN and PAUSER may pause. PAUSER may never unpause or retire. Only ADMIN, controlled by the Safe, may unpause or permanently retire. RETIRED is terminal. Every lifecycle change emits an event. |
| S3 | Live-market caps are tighten-only. Raising any per-transaction, daily, seed or total market cap requires RETIRE and a new version. Tightening stays bounded, emits an event, and never alters an already settled receipt. |
| S4 | The on-chain `MAX_ORACLE_AGE` ceiling is **300 seconds** for this release, and a market may configure a stricter value. A safety limit the contract can represent is never left to a script alone. `MAX_DEVIATION_BPS` = 300 is the hard ceiling; each market may configure a lower value. Equities and other market-hours-sensitive assets need a separately authenticated policy and never become real-value markets under this generic crypto limit. |
| S5 | The per-market seed cap is enforced on-chain. The $100 cross-market total is a deployment-script and manifest refusal for the private beta, documented as an operational deployment gate, not an on-chain invariant; no registry-wide accounting in this release. Every deployment independently reads back all registered markets and computes the aggregate seed before proceeding. Any inability to enumerate or verify the complete market set fails closed. |
| S6 | Oracle markets use narrow, explicitly recorded liquidity ranges. When the price leaves the range or the configured seed capacity is exhausted, the market is paused and replaced by a new version after review. Never silently reseed, widen or recenter a live market. Exact boundary behaviour and tests make settlement fail closed before unsafe execution. |
| S7 | Accepted conditionally. Constructor arguments may grow to 288 bytes only if both token decimals are immutable AND read from each token by the factory or constructor, rejecting missing, malformed or mismatched values, within an explicitly bounded decimal range. Configuration-provided decimals alone are never trusted. After the change, re-measure creation and runtime bytecode, deployment gas, constructor decoding, CREATE2 address mining and explorer verification. If mining or size limits become unsafe, use immutable deployment parameters through a reviewed factory design, never an upgradeable proxy. |
| S8 | **Rejected as stated.** Off-chain readback alone is insufficient where `policy.feedId` decides whether real-value settlement is authenticated. The deployed market is cryptographically bound to an immutable adapter and an immutable route identifier, and settlement obtains authenticated data for that exact route. If the adapter fixes a single route internally, that immutable route is recorded and verified on-chain. If one adapter serves several routes, the market's feedId is passed into and checked by the adapter on every validation. Off-chain pre-flight and post-deployment readback remain additional evidence, never the sole enforcement. |

## ENS art layer (owner, 2026-09-11)

A separate layer beside settlement, never inside it. Planned and documented now, built only after the
v4 specification is committed.

| # | Decision |
| --- | --- |
| H1 | New work lives in the public MIT UNICA repository under `vy/` as a clearly separate layer (`vy/src/art/`, `vy/src/math/`), isolated from settlement contracts, deployment tooling and market configuration. No new repository unless licensing or dependency review later requires it. |
| H2 | Minimum scope only: namemath, logobackground, their strictly required math dependencies, and a new SVG renderer. Loan, credit, tax, tokenomics, pricing and unrelated legacy modules are parked and never implied to be part of UNICA v4. |
| H3 | The math and SVG layers stay completely outside the settlement path. Hooks, executors, registries, factories, oracle adapters and payment correctness never depend on them. An import and dependency-boundary test enforces it. |
| H4 | An ERC-721 whose `tokenURI` returns metadata containing the on-chain SVG; the ENS `avatar` record points to that NFT in the standard NFT-reference format. The exact avatar URI format and resolver compatibility are verified from current authoritative ENS documentation before implementation. No mainnet broadcast. |
| H5 | First implementation: `unica.eth` merchant subnames on ENSv2 Sepolia only. No ENS mainnet change. Ownership and control, resolver support and the exact ENSv2 Sepolia contracts are confirmed before any future broadcast. |
| H6 | The same normalized name and renderer version produce the same art forever. Art changes need a new renderer version, never a mutation of old output. Inputs, normalization rules, palette rules, renderer code and metadata behaviour are pinned. The art derives from the normalized ENS name plus an explicit renderer version, never from mutable merchant data such as a payout address. |
| H7 | Descriptive module names: namemath, logobackground, svgrender, following repository conventions where they do not reduce clarity. No unexplained legacy snake names. |
| H8 | One exact stable Vyper version, verified on the implementation date (exactly 0.4.3 if that is still the latest approved stable), no caret or floating ranges. The compiler version and build hash are recorded in generated evidence. |
| H9 | Moccasin unit tests, property and fuzz tests, deterministic rendering tests, malformed-input tests, and a local Anvil fork of Sepolia simulating the complete ENS avatar and NFT-resolution flow. Nothing is broadcast without separate approval. |
| H10 | The Sept 8 public copies (`vy/src/namemath.vy`, `vy/src/logobackground.vy`) stay unchanged for provenance. The new implementation goes beside them in versioned descriptive paths; the old copies are marked legacy in documentation, not altered or deleted during the deadline work, and the new renderer imports only the new version. Removal or replacement after the deadline is a separate reviewed cleanup. One-idea commits. |
| H11 | ENS identity is functional, not decorative. The art is bound to the normalized merchant ENS name and renderer version and shown beside the ENS-resolved payout identity at checkout. The application independently resolves and verifies the name-to-address relationship; the image alone is never proof. A resolution mismatch is clearly warned. ENSv2 on Sepolia stays sponsor #2. |
| H12 | Plan and document now; implement only after the v4 specification is committed, isolated so it cannot delay or destabilize settlement. It is the first stream cut if the deadline becomes unsafe. v4 tests, review gates and security work are never weakened to finish it. |

"Not upgradeable" does not mean "nothing is configurable". The boundary is defined field by field in
`UPGRADEABILITY-AND-HOOKS-REVIEW.md` §8.

## What the missing answers mean (owner, 2026-09-11)

1. Fable does not start yet.
2. No public merchant beta is authorized.
3. No website publication is authorized.
4. No real-value mainnet settlement is authorized.
5. Privy stays conditional or deferred.
6. NFLX is excluded from the immediate rehearsal.

The read-only capability probe may finish and report. The specification is then written with these
items marked as blockers, shown as an uncommitted diff, and held for owner confirmation. Nothing is
committed, deployed, signed, funded, pushed or published.

## OPEN

- 20, 64, 70, 71, 91, 95, 96 to 99, 108, the NFLX rate and merchant control in 110, 119, 131, as above.
- 132: whether any no-value mainnet infrastructure is deployed if the Safe and the reviewer are
  not ready. Unanswered, so nothing is deployed on mainnet.
- 9 waits for the capability probe.

## Recommended, not confirmed (2026-09-11)

Reconciling the specification set raised twelve points that need an owner ruling. The specification
text applies the recommended form of each so that it reads as one coherent design; a different
ruling changes the cited sections. **None of these is an owner decision yet.**

| # | Point | Recommended form applied in the text | Changes if ruled otherwise |
| --- | --- | --- | --- |
| V1 | S8 route binding | `(adapter, feedId)` committed into `marketId`, with `feedIdFor` checked at `register` and on every settlement | SPEC-CONTRACTS §3, README, EVENT-SCHEMA §4.1, TEST-MATRIX R7 |
| V2 | S6 enforcement | An operational rule: tools refuse, the watcher alerts | An on-chain rule needs a `beforeAddLiquidity` flag, changing the flag set and the mined address |
| V3 | S5 scope | The $100 aggregate is per registry and chain, summing on-chain seed caps | THREAT-MODEL, DEPLOYMENT-GATES, TEST-MATRIX |
| V4 | Q6 daily cap | Enforced per market on-chain; a retire-and-relist mid-day restarts that market's daily usage at zero | SPEC-CONTRACTS §9.2 |
| V5 | S2 on 46630 | The rehearsal runs with the deployer as ADMIN and no PAUSER, for a no-value chain only | DEPLOYMENT-GATES §11 |
| V6 | Q110, NFLX | A test-only fixture rate may back the fork proof of configuration-only onboarding | TEST-MATRIX V1, README |
| V7 | B15 | Gate G1 checks the pinned hash of the post-tag frozen diff; the tag is never moved | DEPLOYMENT-GATES G1 |
| V8 | S7 fallback | If 288-byte hook arguments measure unsafe, immutable parameters through a reviewed factory, never a proxy | IMPLEMENTATION-PLAN, TEST-MATRIX F22, F23 |
| V9 | `vy/src/unica/calculator.vy`, `flash_liquidator.vy` | Left untracked and untested; rewritten fresh if adopted | — |
| V10 | `merchant_policy.vy`, `payany_router.vy` | Left as committed, treated as legacy | — |
| V11 | Committing this set | Committed as one-idea commits on `unicaV4` | — |
| V12 | The sixteen POS product questions | Held until v4 ships; they are listed in `../unica-v5/pos/OPEN-QUESTIONS.md` | — |
