# Chainlink availability for TSLA/NFLX — Robinhood Chain

## What this file is

A read-only survey of what Chainlink actually has deployed and usable, today, for
pricing TSLA and NFLX on **Robinhood Chain Testnet (chain id 46630)** — across
Chainlink's four relevant products (Data Feeds, Data Streams, the Chainlink Runtime
Environment / CRE, and CCIP) — plus what exists on **Robinhood Chain Mainnet (chain id
4663)** and on other networks, and the specific semantics a contract must handle if it
ever consumes the one tokenized-equity feed that does exist.

It closes with a section of general validation rules an oracle-consuming adapter
should enforce, written as engineering rules with their rationale rather than as a
description of any particular codebase.

## When and how this was gathered

Retrieved **2026-09-11**. Every Chainlink-product fact below comes from one of:
primary Chainlink documentation (`docs.chain.link`), Chainlink's reference-data-directory
JSON (`reference-data-directory.vercel.app`, the data source the docs site itself
renders), or Chainlink's own GitHub source (`github.com/smartcontractkit/*`) — each
cited with its URL and a short quote or JSON path. Chain-46630 facts are additionally
cross-checked against **live, read-only on-chain reads** (`cast chain-id`, `cast
codesize`, `cast call`) against a chain-46630 RPC endpoint. That endpoint's specific
URL is not reproduced in this file — it was not recorded in the source material this
file was built from — but every on-chain value quoted below is independently
checkable against any RPC node for chain id 46630 using the exact read given next to
it. No transaction was ever signed, funded, subscribed, deployed, or broadcast to
gather any of this.

## What this file does NOT establish

- That Chainlink plans to ship Data Feeds on Robinhood Chain Testnet. Absence today
  does not rule out a future listing; no primary source says either way.
- That a Data Streams report for TSLA or NFLX would actually verify on the 46630
  `VerifierProxy`. No report was fetched — every route to one is paid or needs
  registered credentials, and none were obtained (see §3).
- That any Chainlink CRE organization currently has hosted-DON write access to
  46630. This file only establishes that 46630's CRE forwarder contracts exist
  on-chain and that one of them (the production forwarder) has a signer config set;
  it does not establish that any specific account's deploy request has been
  approved (see §4).
- Any address, feed id, chain selector, or number that is not either read live
  on-chain on 2026-09-11 or drawn directly from a cited primary source. Nothing here
  is invented or inferred beyond what is explicitly flagged **UNCONFIRMED**.
- A small number of facts below (from `agents.chain.link` and
  `api.testnet-dataengine.chain.link`) were reproduced on 2026-09-11 but come from
  Chainlink domains outside this file's primary-source allowlist (`docs.chain.link`,
  `github.com/smartcontractkit`, the reference-data-directory, and the chain itself).
  They are marked **UNCONFIRMED** for that reason even though they were observed.

---

## 1. Chain identity

| Fact | Value | Source |
|---|---|---|
| Robinhood Chain **Testnet** chain id | `46630` | Confirmed live: `cast chain-id` against a chain-46630 RPC returned `46630`. Also: `smartcontractkit/chain-selectors` `selectors.yml` line 654-656 — "`46630: selector: 2032988798112970440 name: "robinhood-testnet"`" — https://github.com/smartcontractkit/chain-selectors/blob/425da86147b75ee0fdd0d95d840a0966b837056b/selectors.yml |
| Robinhood Chain **Mainnet** chain id | `4663` | `smartcontractkit/chain-selectors` `selectors.yml` lines 1164-1166 — name `"robinhood-mainnet"` — same URL as above |
| Testnet CCIP chain selector | `2032988798112970440` | Same source, and independently corroborated by `docs.chain.link/ccip/directory/testnet/chain/robinhood-testnet` (retrieved 2026-09-11) |

**These are two different chains.** Every Chainlink product wired for "Robinhood" on
the mainnet side (chain 4663) has **zero code** deployed at the same address on the
testnet (chain 46630) — confirmed by `cast codesize` returning `0` for all mainnet
Robinhood proxy/aggregator addresses when queried against chain 46630.

---

## 2. Data Feeds (push, `AggregatorV3Interface.latestRoundData()`)

### 2a. On Robinhood Chain Testnet (46630): none

No Chainlink Data Feed of any kind — no TSLA/USD, no NFLX/USD, and no L2 Sequencer
Uptime feed — is listed for chain 46630.

| Check | Result | Source |
|---|---|---|
| Docs' network config (`chains.ts`) lists Robinhood Chain | Exactly **one** network entry, `"Robinhood Chain Mainnet"`, `networkType: "mainnet"`. No testnet entry exists. | `smartcontractkit/documentation` `src/features/data/chains.ts`, lines 624-640 — https://raw.githubusercontent.com/smartcontractkit/documentation/7ad55519bcf72bfd8ff631f48843fe6697917262/src/features/data/chains.ts |
| Reference-data-directory file for a Robinhood testnet | Does not exist. `feeds-robinhood-testnet.json` and two other guessed names all return HTTP 404 (79 bytes). All 66 directory files the docs config actually references were also fetched and grepped for `46630` / `robinhood-testnet`: **zero hits**. | https://reference-data-directory.vercel.app/feeds-robinhood-testnet.json → HTTP 404 |
| Docs' price-feed addresses page | Embeds only the Robinhood **mainnet** directory URL; the string `"Robinhood Chain Testnet"` appears 0 times on the page. | https://docs.chain.link/data-feeds/price-feeds/addresses |
| L2 Sequencer Uptime Feeds page | Lists 11 networks (Arbitrum, BASE, Celo, Mantle, MegaETH, Metis, OP, Scroll, Soneium, X Layer, ZKsync). Robinhood is not one of them, and the Robinhood block in `chains.ts` carries no `l2SequencerFeed` flag at all. | `smartcontractkit/documentation` `src/content/data-feeds/l2-sequencer-feeds.mdx`, headings lines 27-91 — https://raw.githubusercontent.com/smartcontractkit/documentation/7ad55519bcf72bfd8ff631f48843fe6697917262/src/content/data-feeds/l2-sequencer-feeds.mdx |
| Mainnet proxy/aggregator addresses probed against chain 46630 | `cast codesize` = `0` for all of them (the TSLA proxy, its secondary proxy, and its aggregator — see §6). | Live on-chain read, chain 46630, 2026-09-11 |

**Verdict: CONFIRMED.** A `latestRoundData()` adapter on 46630 has nothing official
Chainlink-operated to point at today. Any 46630 price source claiming to be an
`AggregatorV3Interface` would have to be self-deployed and must be labeled as such,
never as a Chainlink feed.

### 2b. On Robinhood Chain Mainnet (4663): one feed, TSLA only

| Field | Value |
|---|---|
| Name | `Robinhood TSLA / USD` |
| Proxy address | `0x4A1166a659A55625345e9515b32adECea5547C38` |
| Secondary proxy address | `0xE4479F01738B4e8C428CD8eB72D47AB9BC3c7de6` (role UNCONFIRMED — no source states it explicitly; inferred from the feed's `shared-svr` path, see §6) |
| Underlying aggregator | `0x7A6b81ba7FbCB90104d8C496158Cf383cD7233b1` (integrate via the proxy, not this address) |
| Decimals | `8` |
| Heartbeat | `86400` s |
| Deviation threshold | `0.5%` |
| Feed category | `custom` |
| Market hours tag | `us_equities_24/5` |
| Product type | `primaryTokenizedPrice` |

There is **no NFLX feed of any kind on Robinhood Chain Mainnet**, and no L2 Sequencer
Uptime feed there either (both confirmed by a full-text grep of the mainnet directory
JSON, zero hits for `nflx`, `uptime`, or `sequencer`).

**Source:** `reference-data-directory.vercel.app/feeds-robinhood-mainnet.json`
(57 entries; index `[22]`), retrieved 2026-09-11 —
https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json.
**Verdict: CONFIRMED** (independently re-checked against a second, later fetch of the
same file with identical field values).

### 2c. TSLA/NFLX Data Feeds elsewhere

No **testnet** carries an NFLX push feed anywhere. Exactly one testnet carries a TSLA
push feed. All addresses below are quoted as listed; none was independently probed on
its own chain (only chain 46630 was probed live).

| Network | Chain id | Asset | Proxy address | Notes |
|---|---|---|---|---|
| BNB Chain Mainnet | 56 | TSLA/USD | `0xEEA2ae9c074E87596A85ABE698B2Afebc9B57893` | category `low`, NYSE hours, 8 decimals, 86400s heartbeat |
| BNB Chain Mainnet | 56 | NFLX/USD | `0x1fE6c9Bd9B29e5810c2819f37dDa8559739ebeC9` | **the only NFLX/USD push feed found anywhere**, category `low`, NYSE hours |
| Arbitrum One | 42161 | TSLA/USD | `0x3609baAa0a9b1f0FE4d6CC01884585d0e191C3E3` | category `low`, NYSE hours |
| Polygon Mainnet | 137 | TSLA/USD | `0x567E67f456c7453c583B6eFA6F18452cDee1F5a8` | category `low`, NYSE hours |
| Ethereum Mainnet | 1 | TSLA-USD (24/5) | `0xB204328559E17F84eE7A285036AA0d47124F85D5` | category `new`, `us_equities_24/5` |
| Ethereum Mainnet | 1 | TSLAon/USD (Ondo API, tokenized) | `0x737401E0D1299D8A85b653Fd52823501f4FE0be0` | category `custom` |
| Ethereum Mainnet | 1 | TSLAon-USD (Calculated, tokenized) | `0x89904B6fcF8dAD1e5DA47dFdF69fC38Ad6be0bd5` | category `custom` |
| OP Mainnet | 10 | TSLA-USD (24/5) | `0x5Ce9c0a0Bc15236a110fbC19df547d2b23d3ce3B` | category `new`, `us_equities_24/5` |
| Base Mainnet | 8453 | Coinbase TSLA (tokenized) | `0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4` | category `custom`, `us_equities_24/5` |
| OP Sepolia (testnet) | 11155420 | TSLA/USD | `0xc5Fce42cd84c89518E69AcC534b08CAe6e259514` | **the only testnet TSLA push feed found**; 1200s heartbeat, 0.2% threshold, NYSE hours, no category |

**Sources:** `reference-data-directory.vercel.app/feeds-bsc-mainnet.json`,
`feeds-ethereum-mainnet-arbitrum-1.json`, `feeds-matic-mainnet.json`,
`feeds-mainnet.json`, `feeds-ethereum-mainnet-optimism-1.json`,
`feeds-ethereum-mainnet-base-1.json`, `feeds-ethereum-testnet-sepolia-optimism-1.json`
(all retrieved 2026-09-11). Chain ids other than 42161 (which appears in-file) are
sourced separately from `smartcontractkit/chain-selectors` `selectors.yml`
(commit `425da86`). **Verdict: CONFIRMED** for every row (re-verified by index lookup
in a later independent pass).

A wider check across five of Robinhood-testnet's own CCIP-lane-connected testnets
(Ethereum Sepolia — 75 feeds, Arbitrum Sepolia — 60 feeds, Base Sepolia — 9 feeds, BNB
Chain Testnet — 32 feeds, Monad Testnet — 5 feeds) found **no TSLA or NFLX feed on any
of them** — those networks carry only crypto, forex, and commodity pairs (Ethereum
Sepolia adds a handful of ETF/index products). **Verdict: CONFIRMED.** 0G Galileo
Testnet's directory file could not be located (guessed filename returned 404); HyperEVM
Testnet and Solana Devnet were not checked at all — these three remain unconfirmed
gaps, not confirmed absences.

---

## 3. Data Streams (pull model — a `VerifierProxy` checks report signatures on chain; UNICA has verified no report)

### 3a. On Robinhood Chain Testnet (46630): the verifier exists, nothing else does

| Fact | Value | Source |
|---|---|---|
| VerifierProxy address (testnet) | `0x72790f9eB82db492a7DDb6d2af22A270Dcc3Db64` | `smartcontractkit/documentation` `src/features/feeds/data/StreamsNetworksData.ts`, "`label: "Robinhood Chain Testnet", verifierProxy: "0x72790f9eB82db492a7DDb6d2af22A270Dcc3Db64"`" — https://raw.githubusercontent.com/smartcontractkit/documentation/main/src/features/feeds/data/StreamsNetworksData.ts |
| VerifierProxy address (mainnet, 4663) | `0xcE73c8ad08CBDEaCa6078BF0627C8fe0a9a536E7` | Same file |
| Live on chain 46630? | Yes — `cast codesize` = `7009`; `typeAndVersion()` returns `"VerifierProxy 2.0.0"` | Live on-chain read, 2026-09-11 |
| Fee manager set? | No — `s_feeManager()` returns the zero address, meaning `verify()` takes no on-chain fee | Live on-chain read; confirmed against source: "`if (address(feeManager) != address(0))`" in `VerifierProxy.sol` — https://github.com/smartcontractkit/chainlink-evm/blob/develop/contracts/src/v0.8/llo-feeds/v0.3.0/VerifierProxy.sol |
| Access controller set? | No — `s_accessController()` returns the zero address, meaning any caller may call `verify()` | Live on-chain read; source confirms access is skipped when the controller is unset |
| Owner | `0x63EEE99fff87df3072863dffe2b356D7D6c4b76F` | Live on-chain read. **UNCONFIRMED** whether this is a Chainlink-controlled key — no official source names it. |

Calling `verify()` requires the payload's embedded config digest to already have a
Verifier registered for it on this proxy — otherwise it reverts `VerifierNotFound`.
The one digest that could be tested here (a published December 2024 example testnet
ETH/USD report) is **not registered**: `getVerifier(0x0006f9b5…1578)` (digest,
example only, not TSLA/NFLX) returned the zero address. Whether the actual digest that
signs the TSLA/NFLX **testnet** streams is registered on 46630 is **UNCONFIRMED** — a
real report is needed to test this, and fetching one costs money (see below).

### 3b. TSLA/NFLX Data Streams feed ids

Data Streams feed ids are not chain-specific — the same id identifies a stream
regardless of which chain's `VerifierProxy` ultimately verifies a report for it. Two
schema versions exist for each asset: **v8 "RWA Standard"** and **v11 "RWA Advanced"**
(three time-of-day variants: Regular, Extended, Overnight). Chainlink's docs
"strongly recommend" v11 over v8 for US equities.

Mainnet-DON streams (status **live**, source chain Arbitrum One 42161):

- TSLA/USD v8 — feed id `0x00084edc844a6f88449c59c8cfcdb2225799a2330503472cb0bc4f9369a717fa`
- TSLA/USD v11 Regular — feed id `0x000b2dbed1640ead18d37338b75e4755630a900649261baf4ed79d9a749be13d`
- TSLA/USD v11 Extended — feed id `0x000b9e87f3f1ac8e590e47cce07a3e964d94f2abd5692b2f92f1dbab79874b07`
- TSLA/USD v11 Overnight — feed id `0x000b67554457bf6c7e70d4d599d9634888fc8d79145c534ddd77ba1dae840107`
- NFLX/USD v8 — feed id `0x0008e9aa2aebbb1aa92cfa0494db3e0451859a97ed94edabdcb7a09d384c8a06`
- NFLX/USD v11 Regular — feed id `0x000b826d0a21022b01a51b0b15e3fc173812e78ddc449a5069f13f2c1e652912`
- NFLX/USD v11 Extended — feed id `0x000ba38bc53d30ddf079e88e8302fbe6489c69564fe1c4c537d4c142881149a5`
- NFLX/USD v11 Overnight — feed id `0x000bf4528276ae7c4d7114459a16c4a68d00898bd098bc9a40abc8f2633d09d5`

Testnet-DON streams (status **testing**, source chain Arbitrum Sepolia 421614):

- TSLA/USD v8 — feed id `0x000890039996f52efbfa66e193d077fd4aa6fa12009688f7f6606a64cc0c25ad`
- TSLA/USD v11 Regular — feed id `0x000b08f5e1a8c355e9982cea5707cf7b60be8ef91c42bb8022fd63f1bd71f6ab`
- TSLA/USD v11 Extended — feed id `0x000b4642144cb2e2f0e38ba57cc15a6549fd1522da1e7560f3d9e198b23fbe50`
- TSLA/USD v11 Overnight — feed id `0x000b2729962eb0c3e39d0778279004b52cdce9bc511a79c31c7f14516b2e3652`
- NFLX/USD v8 — feed id `0x0008a024a686a2558a0214497367764f6dddf41076c08ea98234e76a8be18f6e`
- NFLX/USD v11 Regular — feed id `0x000bef8509c0438698f7e41ca236816fc4d6491e724df942d804576978f6e670`
- NFLX/USD v11 Extended — feed id `0x000b835e14e462214ae21ad86e8181f797e690bca07b7ace6a364ddc9b2e44db`
- NFLX/USD v11 Overnight — feed id `0x000b9fd0f7943e31c696e1749381f3e24dc7f7a5c0e3f8071321aa3fd358f8a8`

**Source:** `reference-data-directory.vercel.app/feeds-ethereum-mainnet-arbitrum-1.json`
and `feeds-ethereum-testnet-sepolia-arbitrum-1.json`, retrieved 2026-09-11.
**Verdict: CONFIRMED** for all ids (both files independently re-fetched and re-indexed
in a later verification pass with identical results). Prices carry an 18-decimal
multiplier; the v11 mid-price timestamp field carries a 1e6 multiplier.

**UNCONFIRMED:** Chainlink's own public **Discovery API**
(`api.testnet-dataengine.chain.link` / `api.dataengine.chain.link` — not on this
file's primary allowlist, reproduced here only as a caveat) returns the TSLA v11
streams listed above but returns **no NFLX stream and no v8 stream of any kind**, on
either the testnet or mainnet host. Whether NFLX access and v8-schema access require a
separate entitlement, or are simply not exposed through this particular endpoint, is
unknown.

### 3c. Getting an actual report: paid, and not attempted

Every route to a real Data Streams report needs either money or registered
credentials — neither was obtained, consistent with the read-only scope of this
research.

- **Direct REST API.** Host `https://api.testnet-dataengine.chain.link` (testnet) or
  `https://api.dataengine.chain.link` (mainnet). Needs HMAC-signed headers from a paid
  `app.chain.link` subscription. "*All Data Streams subscriptions are paid. There is
  no free account tier.*" — https://docs.chain.link/data-streams/sign-up
- **`agents.chain.link` gateway** (not on this file's primary allowlist — reproduced
  as a caveat only). Needs EIP-191 request signing, Terms-of-Service
  acceptance/registration, and an x402 payment of `5000` base units (0.005 USDC) on
  Base Mainnet per read. An unsigned, unpaid probe against this endpoint correctly
  returned HTTP 402 with that exact challenge; nothing was paid or signed.
- **Billing model.** "*The pay-per-verification billing model has been
  deprecated*" — https://docs.chain.link/data-streams/billing — access today is
  subscription-based only.

### 3d. On-chain integration shape (once a report is obtained)

`IVerifierProxy.verify(bytes calldata payload, bytes calldata parameterPayload)` is a
state-changing call (it updates internal epoch state and emits an event), not a view
call, so it must run inside the transaction that consumes the price — typically the
same transaction that settles or liquidates against it. With `s_feeManager` and
`s_accessController` both zero on 46630 today, no fee and no allowlist gate the call.
The proxy returns the verified `reportData`; the first two bytes of that data double
as the schema-version tag (`0x0008` = v8, `0x000B` = v11) and adapter code must decode
accordingly, checking `feedId` against a pinned value, `block.timestamp <=
expiresAt`, a freshness bound on the report's own timestamp field, and — critically —
the `marketStatus` field (v8: `0`=unknown, `1`=closed, `2`=open; v11 24/5: `0`=unknown,
`1`=pre-market, `2`=regular, `3`=post-market, `4`=overnight, `5`=closed). Neither
Verifier contract enforces `expiresAt` itself — that check is the consumer's job.
**Source:** https://docs.chain.link/data-streams/tutorials/evm-onchain-report-verification,
https://docs.chain.link/data-streams/reference/report-schema-v8,
https://docs.chain.link/data-streams/reference/report-schema-v11 (all retrieved
2026-09-11). Chainlink's 24/5-equities guide also states `lastTradedPrice` is
deprecated as a production input with removal by **2026-10-12** —
https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide.

---

## 4. Chainlink Runtime Environment (CRE)

### 4a. On Robinhood Chain Testnet (46630): the delivery plumbing exists; no price product does

CRE is an orchestration runtime, not a price feed product — Chainlink publishes no
TSLA/USD or NFLX/USD CRE workflow or schema for any network. What 46630 does have:

| Contract | Address | On-chain, 2026-09-11 | Source |
|---|---|---|---|
| Production `KeystoneForwarder` | `0x8E6E6A1f2B2D4dF503bfd67951CF28F27BF3AF19` | codesize `8591`; `typeAndVersion()` = `"KeystoneForwarder 1.0.0"`; owner `0x2BC32564aF3F6699DaDEb5EFA87736b99E37AFe9` | Listed under "Production Forwarders > Testnets" — `smartcontractkit/documentation` `forwarder-directory-ts.mdx` line 184, commit `536658e0` — https://github.com/smartcontractkit/documentation/blob/536658e0d3b8f14d542b6fcaf36ba1f22cb447ec/src/content/cre/guides/workflow/using-evm-client/forwarder-directory-ts.mdx |
| Simulation `MockKeystoneForwarder` | `0x0b93082D9b3C7C97fAcd250082899BAcf3af3885` | codesize `4579`; `typeAndVersion()` = `"MockKeystoneForwarder 1.0.0"`; **permissionless — checks no signatures at all** | Listed under "Simulation Testnets", same file, line 114. Note: this exact address is also Ethereum Mainnet's *production* forwarder — a different contract lives at the same address on each chain. |

The production forwarder does have a DON signer configuration set: a read-only
simulated call to `report()` for `donId=1, configVersion=1` reverted
`InvalidSignatureCount(4, 0)`, which discloses `f=3` (i.e., 4 valid signatures would
be required). Every other `(donId, configVersion)` pair tried (1-20 × 1-2) reverted
`InvalidConfig`. **This proves a config exists; it does not prove a live DON is
actively signing writes to it, or that it serves any particular tenant.**

Chainlink's own CLI release notes describe Robinhood support (CLI v1.30.0, August 13,
2026) as "*supports Monad, T-REX, Robinhood, Stable, and Tempo testnets **for local
simulation***" — https://docs.chain.link/cre/release-notes.md — while the Forwarder
Directory lists 46630's forwarder under "Production Forwarders." **These two docs are
in tension**; treat hosted (non-simulation) writes to 46630 as unproven either way.

### 4b. What would have to be true to use CRE for a price

1. A licensed source for equity prices reachable through CRE's HTTP capability (5
   requests per workflow execution, 100 KB response cap, 10 KB request cap, 10s
   connection timeout — https://docs.chain.link/cre/service-quotas.md), fetched
   independently by each DON node and reconciled by BFT consensus.
2. A consumer contract implementing `IReceiver` (`onReport(bytes metadata, bytes
   report)`), checking `msg.sender == 0x8E6E6A1f2B2D4dF503bfd67951CF28F27BF3AF19`
   (never the mock address), pinning the workflow id and owner out of the 64-byte
   metadata slice, and enforcing its own staleness and replay protection — the
   forwarder's DON timestamp never reaches the receiver at all (it sits at a byte
   offset outside the metadata slice CRE passes through). "*The receiver is
   responsible for discarding stale reports*" —
   https://github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/v1/interfaces/IReceiver.sol
3. **Deploy approval.** "*Workflow deployment requires approval*" —
   https://docs.chain.link/cre/guides/operations/deploying-workflows.md — anyone can
   build and *simulate* a workflow without approval; deploying to a hosted DON needs
   Early Access approval per organization.
4. Confirmation (via `cre workflow supported-chains`, which needs a login this
   research did not perform) that hosted writes to `robinhood-testnet` are actually
   enabled for the relevant organization — chain/forwarder availability is
   tenant-scoped per Chainlink's own docs.

None of this exists in usable form today for TSLA/NFLX; it is infrastructure a team
would have to build and Chainlink would have to approve, not something to consume
off the shelf.

---

## 5. CCIP (Cross-Chain Interoperability Protocol)

### 5a. On Robinhood Chain Testnet (46630): the router is live and matches the docs exactly

| Fact | Value |
|---|---|
| Router | `0x30D197C6F5bE050D5525dD94d01760FaCdB67e7C` — live: codesize `10761`, `typeAndVersion()` = `"Router 1.2.0"` |
| ARM/RMN proxy | `0x934c1B8f6913070528CC24081E0b78d57D3A97A3` — live: codesize `1637`, `typeAndVersion()` = `"ARMProxy 1.0.0"` |
| LINK token | `0x6a11698F9dA09d1aA0Ee060E949086D50A3c2F70` (listed; not independently probed on-chain) |
| Token Admin Registry | `0xad4c7a1430D140Fc5121C0697B2f7Efc655c0070` (listed; not probed) |
| Token Pool Factory | `0x3e9299b3A6D4B1f5AC9d11A115386845ECc74450` (listed; not probed) |

Every live on-chain value above matched its documented value byte-for-byte, including
a cross-check that the router's `getOnRamp()` for the Ethereum Sepolia lane and its
`getWrappedNative()` value exactly match the docs page. **Source:**
https://docs.chain.link/ccip/directory/testnet/chain/robinhood-testnet, retrieved
2026-09-11 (fetched twice, agreeing both times), plus live on-chain reads this
session.

**Documented outbound lanes from Robinhood Chain Testnet:** 0G Galileo Testnet,
Arbitrum Sepolia, Base Sepolia, BNB Chain Testnet, Ethereum Sepolia, HyperEVM Testnet,
Monad Testnet, Solana Devnet (8 lanes). `isChainSupported()` was live-confirmed `true`
for 6 of the 8 (all but HyperEVM Testnet and Solana Devnet, whose chain selectors
could not be resolved from the primary chain-selectors source in the time available).

### 5b. CCIP reachability proves nothing about feed existence

**None of the CCIP-connected testnets checked carries a TSLA/USD or NFLX/USD
Chainlink Data Feed** (see §2c: Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia, BNB
Chain Testnet, Monad Testnet all checked and empty of equity feeds; 0G Galileo,
HyperEVM, and Solana Devnet unconfirmed). The one testnet that does carry a TSLA push
feed, OP Sepolia, is **not one of Robinhood testnet's CCIP lane destinations at all**
— there is no lane connecting them. So a "read a real feed on chain A, relay it over
CCIP to an adapter on 46630" design has no live TSLA source to relay from on any chain
46630's CCIP router can actually reach, and no NFLX source exists on any chain,
testnet or mainnet, that has been checked.

CCIP transit time is also strictly additive on top of whatever staleness the source
feed already carries: Chainlink's own execution-latency documentation cites roughly
12-15 minutes for source-chain finality on an Ethereum-class PoS chain before the
committing DON even relays the message —
https://docs.chain.link/ccip/ccip-execution-latency. For a 24/5 equity price with its
own multi-second-to-minute Streams cadence, or a 86400s-heartbeat push feed, CCIP
transit would be a small addition; the bigger constraint is simply that no equity
price exists to relay from any reachable source chain today.

**Verdict on all of the above: CONFIRMED** (Router and ARMProxy re-verified live
on-chain against a fresh docs fetch in a later, independent pass; the "no TSLA/NFLX
on 5 lane-destination testnets" finding was likewise independently re-confirmed for
Ethereum Sepolia and BNB Chain Testnet in that same later pass).

---

## 6. Tokenized-equity feed semantics

These are the mechanics of the *one* Chainlink Data Feed that exists for a
Robinhood-issued equity token (the Robinhood Chain **Mainnet** TSLA/USD feed, §2b).
Any future TSLA/NFLX feed on 46630 should be assumed to behave the same way unless
proven otherwise, because it is the only documented example of this feed family.
**Source for every quote in this section:**
`smartcontractkit/documentation` `src/content/data-feeds/tokenized-equity-feeds/robinhood.mdx`
and `.../tokenized-equity-feeds/index.mdx`, commit `7ad55519` (byte-identical at the
current docs HEAD), retrieved 2026-09-11 —
https://raw.githubusercontent.com/smartcontractkit/documentation/7ad55519bcf72bfd8ff631f48843fe6697917262/src/content/data-feeds/tokenized-equity-feeds/robinhood.mdx

| Behavior | What the docs say |
|---|---|
| **What the number means** | This is a **total-return value**, not the raw share price: "*Token Price = Underlying Equity Market Price × Multiplier*". The multiplier comes from the issuer token's own `uiMultiplier()`. An adapter reading this feed is reading the *token's* value, not TSLA's or NFLX's quoted market price. |
| **Off-hours behavior** | "*These feeds do not have heartbeats during off-hours*" — and more strongly, tokenized-equity feeds "*do not publish updates, including heartbeat updates, while markets are closed*". A long gap in `updatedAt` during a weekend or holiday is expected behavior, not staleness. |
| **`oraclePaused` hold** | "*The feed stops publishing new prices and holds the last known good value*" whenever the issuer token's `oraclePaused()` flag is true (e.g., during a corporate action). The feed does not revert or zero out — it freezes, silently, at the proxy level. |
| **SVR (Smart Value Recapture)** | "*Robinhood feeds have SVR enabled*." The feed's directory `path` field is `robinhood-tsla-usd-shared-svr`, and the feed carries a `secondaryProxyAddress` distinct from its primary proxy — inferred (**UNCONFIRMED**, not stated explicitly by any source read) to be the SVR-related proxy. |
| **Feed category** | `custom` — "*[custom feeds] can differ materially from standard market price feeds*." |
| **Market-hours tag** | `us_equities_24/5`, defined as running "*18:00 ET Sunday to 17:00 ET Friday*" — i.e., it does not update on weekends or U.S. market holidays even within that window. |
| **No market-status field** | `latestRoundData()` returns only the five standard fields (`roundId, answer, startedAt, updatedAt, answeredInRound`). There is **no on-chain flag distinguishing "market closed" from "stale."** An adapter needs its own exchange calendar, or must read the issuer token's `oraclePaused()` itself, to tell the two apart. (Chainlink's separate Data Streams product, §3, does carry an explicit `marketStatus` field — push Data Feeds do not.) |
| **No sequencer gate** | Robinhood Chain publishes no L2 Sequencer Uptime feed at all (§2a), so the standard sequencer-down / grace-period check cannot be implemented against Chainlink for this chain today, on either the testnet or the mainnet side. |
| **Standard checks still apply** | `answer > 0`, `updatedAt != 0`, `answeredInRound >= roundId` — ordinary `AggregatorV3Interface` hygiene, unrelated to the tokenized-equity-specific behaviors above. |

---

## 7. What is actually on Robinhood Chain Testnet 46630 today (not Chainlink-issued)

For orientation only — these are **not** Chainlink products and carry no oracle
behavior. Robinhood's own public testnet faucet issues five ERC-20 "stock tokens"
(ticker-styled symbols) on chain 46630:

- TSLA token: `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E` — `symbol()` = `TSLA`,
  `decimals()` = `18`, `uiMultiplier()` = `1000000000000000000` (1e18)
- NFLX token: `0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93` — same shape, `symbol()` =
  `NFLX`
- Both revert (empty return data) on `oraclePaused()` and on `latestRoundData()` —
  they do not implement `AggregatorV3Interface` and are not wired to any Chainlink
  feed. (Calling them "not wired to Chainlink" is an inference from these two
  reverts, not something any Chainlink source states directly — **UNCONFIRMED** in
  the strict sense, though no permitted read contradicts it.)
- Minting tx `0xc1564a9b19307b6823c55b50adee224b3e16a2f2d1476c869b683ddd63892ec8`
  observed at status `1`, block `117005259`.

These are plain tokens with ticker-like names, nothing more — never infer an oracle
from a token's symbol (see §8, rule 6).

---

## 8. Validation rules an adapter must enforce

General rules, with the reasoning behind each one. None of these is specific to
Chainlink's Robinhood feed, and none names or borrows code from any other codebase —
they are the standard discipline any contract consuming a price oracle needs,
sharpened by the specific gaps this survey found (no sequencer feed, no market-status
field on a push feed, and a chain with no live equity feed at all today).

1. **Read `decimals()` live, every time — never hardcode it.** A feed's own decimals
   can differ from what's documented or assumed, and a revert from `decimals()`
   should be treated as "unpriceable," the same as a missing feed, not surfaced as an
   unrelated error.
2. **Fail closed on any of: `answer <= 0`, `updatedAt == 0`, or a carried-over round
   (`answeredInRound < roundId`).** Treat all three identically to a stale price —
   revert, never substitute a fallback, clamp to a bound, or silently zero the value.
   A carried-over round is a documented Chainlink edge case, not a hypothetical.
3. **Size the staleness window to the feed's own heartbeat plus margin, per feed —
   never one global default.** Get this wrong in the tight direction and a
   legitimately slow-heartbeat feed becomes unusable most of the day; get it wrong in
   the loose direction and the staleness check stops meaning anything. For a feed
   that is documented to not update at all outside market hours (§6), staleness
   alone cannot distinguish "market closed" from "oracle broken" — pair it with an
   exchange calendar or the issuer's own pause signal.
4. **Layer an L2 Sequencer Uptime check on top of staleness wherever Chainlink
   publishes one for that chain, with a grace period after restart.** A feed can be
   fresh by `updatedAt` while sitting behind a sequencer that just came back online.
   Where no sequencer feed exists for a chain — the case for Robinhood Chain today —
   that guard genuinely cannot be built from Chainlink data, and an adapter's
   documentation should say so plainly rather than silently omitting the check.
5. **Reject a reported timestamp that is suspiciously exactly "now."** A source that
   reports `block.timestamp` (or its own receipt time) instead of the upstream
   price's real publish time makes every price look zero-age and defeats every
   staleness check built on top of it. This is the single most dangerous failure
   mode for a naive adapter because every other check still appears to pass.
6. **Never infer an oracle from a token's name or symbol.** A same-named ERC-20 (see
   §7) proves nothing about a price feed; only a specifically documented feed address
   that answers the expected interface (`latestRoundData`, a verifier's `verify`,
   etc.) counts as a price source.
7. **A push feed's five-field return has no market-open/closed flag — do not
   improvise one.** Where a market-status field is actually published (Chainlink's
   Data Streams reports carry one, §3d), use it; otherwise the adapter needs its own
   exchange-calendar source, not a heuristic based on price movement or wall-clock
   time zones.
8. **A cross-chain-relayed price must be re-validated independently of the
   transport's own authentication.** CCIP (or any messaging layer) proves who sent a
   message, not that its payload is a correct or current price. At minimum: check
   the (source-chain-selector, sender) pair against an allowlist keyed by selector,
   not sender address alone (identical contract addresses across chains via
   CREATE2/CREATE3 are routine, so a sender-only check is not a chain check); pin the
   source's own decimals; require the source's own timestamp to strictly increase
   between deliveries (blocks replay and out-of-order redelivery, since exactly-once
   delivery is not the same as in-order delivery); and bound both the report's age
   and the value itself.
9. **Relay the source's own original timestamp, never the arrival time.** Reporting
   the moment a cross-chain message arrived, instead of the moment the underlying
   price was actually published, launders transit latency into apparent freshness
   and defeats the destination's own staleness guard.
10. **Round in the direction that protects whichever party would otherwise be
    shorted** (e.g., ceiling a USD amount converted into tokens owed to a
    counterparty) using full-precision arithmetic, not a division that silently
    truncates toward the house's benefit.
11. **Any non-decentralized fallback price source must declare itself as such
    on-chain**, bound its answers to an immutable band fixed at deploy time, and make
    its own refresh path structurally incapable of posting a number that was not
    actually read from something real. The sharpest failure mode for such a source
    is not going silent — a silent source is caught by ordinary staleness checks. It
    is an *attended* feed whose operator keeps reposting a stale or unmeasured
    number: the timestamp stays fresh, the value stays in-band and positive, every
    ordinary guard passes, and the price is simply wrong.
12. **An unconfigured or unpriceable asset must be a hard, typed revert — never a
    placeholder, a zero, or a mock value quietly substituted in production.** Given
    everything in §2 through §5, that revert path is exactly the state a
    46630-targeting adapter should be in for TSLA/NFLX today, on any of the three
    live Chainlink paths (Feeds, Streams, CRE), until one of the UNCONFIRMED items in
    §9 is actually resolved.
13. **Never wire a test mock or placeholder aggregator into anything that can move
    real value, even temporarily.** An unguarded mock's write function is
    functionally an open door to whatever price a payment settles against.
14. **Live-probe any hardcoded or cached address before trusting it.** A documented
    address is not proof of what is deployed there today — call `typeAndVersion()`
    (or the equivalent identifying call) on chain and compare it to what the
    directory or docs claim, the same discipline this file applied throughout (§2-§5).

---

## 9. Unconfirmed items carried forward

These are explicitly **UNCONFIRMED** — flagged as such by the research that produced
this file, not resolved here, and should not be treated as either true or false by
anything reading this document:

- Whether the 46630 `VerifierProxy` currently has a Verifier registered for the
  specific config digest that signs the TSLA/NFLX **testnet**-DON streams (only an
  unrelated example digest was tested, and it returned unregistered).
- Which DON (mainnet or testnet) the `agents.chain.link` gateway proxies reports
  from, and therefore whether a report obtained through it would even verify on the
  46630 testnet proxy.
- Whether NFLX Data Streams access, and v8-schema access generally, require a
  separate entitlement beyond what the public Discovery API exposes (Discovery
  returns TSLA v11 only).
- Whether a hosted CRE write DON currently serves `robinhood-testnet` for any given
  organization's tenant (`cre workflow supported-chains` was not run; the CLI release
  notes and the Forwarder Directory are in tension with each other on this point).
- Whether the 46630 CRE production forwarder's DON signer configuration is presently
  live and actively signing, versus merely configured (a config existing is confirmed;
  a DON actively using it is not).
- Whether Robinhood testnet's HyperEVM Testnet and Solana Devnet CCIP lanes are
  actually live (chain selectors could not be resolved to test them), and whether 0G
  Galileo Testnet, HyperEVM Testnet, or Solana Devnet carry a TSLA/NFLX Data Feed
  (0G's directory file 404'd; the other two were not checked).
- The exact role of the Robinhood-mainnet TSLA feed's `secondaryProxyAddress` — very
  likely SVR-related given the feed's `shared-svr` path, but no source states this
  outright.
- Whether Chainlink has any plan to list Data Feeds on Robinhood Chain **Testnet**
  specifically — absence today is not evidence of intent either way.

## 10. Corrections made during verification

The research that produced this file included an explicit verification pass, which
caught and corrected two claims from the first-pass research:

1. An initial claim that "the only Chainlink contract an official source lists for
   Robinhood Chain Testnet is the Data Streams VerifierProxy" was **REFUTED**. Two
   CRE forwarder contracts (§4a) and a CCIP router plus ARM proxy (§5a) are also
   officially listed and live on 46630 — none of them is a price feed, but the
   original claim was too narrow.
2. An initial claim that Robinhood Chain Mainnet's chain id was unconfirmed was
   **resolved**: it is `4663`, sourced from Chainlink's own `chain-selectors`
   registry (§1) rather than left as a guess.

---

## Sources referenced

- https://docs.chain.link/data-feeds/price-feeds/addresses
- https://raw.githubusercontent.com/smartcontractkit/documentation/7ad55519bcf72bfd8ff631f48843fe6697917262/src/features/data/chains.ts
- https://raw.githubusercontent.com/smartcontractkit/documentation/7ad55519bcf72bfd8ff631f48843fe6697917262/src/content/data-feeds/l2-sequencer-feeds.mdx
- https://raw.githubusercontent.com/smartcontractkit/documentation/7ad55519bcf72bfd8ff631f48843fe6697917262/src/content/data-feeds/tokenized-equity-feeds/robinhood.mdx
- https://raw.githubusercontent.com/smartcontractkit/documentation/7ad55519bcf72bfd8ff631f48843fe6697917262/src/content/data-feeds/tokenized-equity-feeds/index.mdx
- https://raw.githubusercontent.com/smartcontractkit/documentation/7ad55519bcf72bfd8ff631f48843fe6697917262/src/content/data-feeds/selecting-data-feeds.mdx
- https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json
- https://reference-data-directory.vercel.app/feeds-robinhood-testnet.json (404)
- https://reference-data-directory.vercel.app/feeds-bsc-mainnet.json
- https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-arbitrum-1.json
- https://reference-data-directory.vercel.app/feeds-ethereum-testnet-sepolia-arbitrum-1.json
- https://reference-data-directory.vercel.app/feeds-matic-mainnet.json
- https://reference-data-directory.vercel.app/feeds-mainnet.json
- https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-optimism-1.json
- https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-base-1.json
- https://reference-data-directory.vercel.app/feeds-ethereum-testnet-sepolia-optimism-1.json
- https://reference-data-directory.vercel.app/feeds-ethereum-testnet-sepolia.json
- https://reference-data-directory.vercel.app/feeds-bsc-testnet.json
- https://raw.githubusercontent.com/smartcontractkit/documentation/main/src/features/feeds/data/StreamsNetworksData.ts
- https://docs.chain.link/data-streams/supported-networks
- https://docs.chain.link/data-streams/billing
- https://docs.chain.link/data-streams/sign-up
- https://docs.chain.link/data-streams/tutorials/evm-onchain-report-verification
- https://docs.chain.link/data-streams/reference/report-schema-v8
- https://docs.chain.link/data-streams/reference/report-schema-v11
- https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide
- https://docs.chain.link/data-streams/rwa-streams
- https://github.com/smartcontractkit/chainlink-evm/blob/develop/contracts/src/v0.8/llo-feeds/v0.3.0/VerifierProxy.sol
- https://github.com/smartcontractkit/chainlink-evm/blob/develop/contracts/src/v0.8/llo-feeds/v0.3.0/Verifier.sol
- https://docs.chain.link/cre/supported-networks-ts.md
- https://docs.chain.link/cre/release-notes.md
- https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts.md
- https://github.com/smartcontractkit/documentation/blob/536658e0d3b8f14d542b6fcaf36ba1f22cb447ec/src/content/cre/guides/workflow/using-evm-client/forwarder-directory-ts.mdx
- https://github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/dev/MockKeystoneForwarder.sol
- https://github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/v1/interfaces/IReceiver.sol
- https://github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/v1/KeystoneForwarder.sol
- https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts.md
- https://docs.chain.link/cre/capabilities/http.md
- https://docs.chain.link/cre/capabilities/confidential-http-ts.md
- https://docs.chain.link/cre/service-quotas.md
- https://docs.chain.link/cre.md
- https://docs.chain.link/cre/concepts/confidential-workflows.md
- https://docs.chain.link/cre/guides/operations/deploying-workflows.md
- https://docs.chain.link/cre/guides/operations/monitoring-workflows
- https://docs.chain.link/cre/guides/operations/simulating-workflows
- https://docs.chain.link/ccip/directory/testnet/chain/robinhood-testnet
- https://docs.chain.link/ccip/ccip-execution-latency
- https://github.com/smartcontractkit/chain-selectors/blob/425da86147b75ee0fdd0d95d840a0966b837056b/selectors.yml
- Live on-chain reads (`cast chain-id`, `cast codesize`, `cast call`) against a
  chain-46630 RPC endpoint, 2026-09-11.
- This repository's own `docs/chains/ROBINHOOD.md` (faucet token addresses and the
  observed mint transaction, §7).
