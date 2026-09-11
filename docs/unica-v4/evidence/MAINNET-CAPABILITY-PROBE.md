# Mainnet Capability Probe — Uniswap v4 Beta Chain Candidates

## What this file is

A read-only capability check of five candidate mainnets for a capped UNICA v4 beta:
**Robinhood Chain (4663)**, **Base (8453)**, **Arbitrum One (42161)**, **Unichain
(130)**, and **Ethereum Mainnet (1)**. For each chain it records whether six required
integrations are present — Uniswap v4 core contracts, Chainlink ETH/USD and USDC/USD
price feeds, Circle-issued USDC, Privy wallet support, Safe (deployed singleton +
factory), and explorer contract-verification support — plus supplementary data
(Chainlink L2 sequencer-uptime feeds, Chainlink tokenized-equity feeds for TSLA and
NFLX, The Graph network support, the canonical CREATE2 deployer, and a rough gas-cost
estimate). It ends with a recommendation among the chains that pass.

## When and how this was gathered

Gathered and independently re-verified on **2026-09-11**. Method: each capability claim
was checked against a primary documentation source (Uniswap's own deployments page,
Chainlink's docs and its machine-readable reference-data-directory feed JSON, Circle's
own USDC address table, Privy's own supported-networks docs, the `safe-global/safe-deployments`
GitHub registry, The Graph's supported-networks docs, and each chain's own connection/
explorer docs), then cross-checked on-chain via `cast` against each chain's own
documented, keyless public RPC endpoint (`cast chain-id`, `cast codesize`, `cast call`
for `description()`, `decimals()`, `latestRoundData()`, `poolManager()`, `permit2()`,
`symbol()`, `VERSION()`, `DOMAIN_SEPARATOR()`, and `proxyCreationCode()` as applicable).
A first pass produced an initial capability list per chain; a second, independent pass
re-probed every claim, corrected several address/path errors, downgraded unreproducible
claims to UNCONFIRMED, and produced the verdicts recorded below. Every figure in this
file reflects that corrected, re-verified reading — first-pass values are noted only
where the correction itself is informative (e.g., an address that turned out to be an
SVR variant rather than the plain feed).

## What this file does NOT establish

- **Nothing was signed, funded, deployed, or broadcast.** Every read here is a public,
  keyless on-chain call (`cast call` / `cast codesize` / `cast chain-id` / `cast
  gas-price`) or a fetch of a public documentation page. No transaction was sent.
- **No keyless contract verification was actually attempted on any chain.** Explorer
  "verification support" below means the explorer's verify-contract endpoint responded
  and the chain's own docs describe a verification path — not that UNICA's contracts
  have been verified anywhere.
- **Gas figures are rough, single-snapshot ESTIMATEs**, not quotes. They cover L2/L1
  execution gas at the read price only; several chains (Base, Unichain: OP-Stack;
  Robinhood: Orbit-stack) charge a separate L1 data-availability fee on top that was not
  measured. Ethereum's gas price is noted to have moved materially (see its section).
- **This is a point-in-time snapshot.** Several "NO" verdicts (e.g., NFLX/USD on every
  chain, TSLA/USD on Unichain) reflect the absence of a feed in Chainlink's directory
  as of 2026-09-11, not a permanent guarantee — Chainlink adds feeds incrementally.
- **Two "verified" explorer badges could not be reproduced** on re-check (Robinhood's
  Blockscout API, one Arbiscan contract page) — see the per-chain UNCONFIRMED notes.
- **Q9 — which chain the beta actually deploys to — is the owner's decision, not
  settled by this file.** This file is input to that decision, not the decision itself.

## The six required capabilities

| # | Capability | What counts as YES |
|---|---|---|
| 1 | Uniswap v4 core | PoolManager, PositionManager, StateView and Permit2 all deployed, with PositionManager/StateView independently confirmed wired to the same PoolManager via `poolManager()` |
| 2 | Chainlink price feeds | A live, on-chain ETH/USD **and** USDC/USD `AggregatorV3Interface` proxy, each read via `latestRoundData()` |
| 3 | Circle USDC | A Circle-attributed native or bridged USDC contract listed on Circle's own address table |
| 4 | Privy | The chain's chain ID listed as supported in Privy's own docs |
| 5 | Safe | A canonical Safe singleton (and factory) listed in `safe-global/safe-deployments` and confirmed deployed on-chain |
| 6 | Explorer verification | The chain's own docs/explorer describe a working contract-verification path |

Supplementary items recorded per chain but **not** counted toward the six: Chainlink
L2 sequencer-uptime feeds (not applicable to L1), Chainlink TSLA/USD and NFLX/USD
equity feeds, The Graph network support, the canonical CREATE2 deployer address, and
the gas-cost estimate.

## Summary verdict

| Chain | Chain ID | Passes all six? | Blocking gap(s) |
|---|---|---|---|
| Robinhood Chain Mainnet | 4663 | **NO** | Circle USDC = NO; Privy = UNCONFIRMED |
| Base Mainnet | 8453 | **YES** | — |
| Arbitrum One | 42161 | **YES** | — (recommended, see below) |
| Unichain Mainnet | 130 | **NO** | Privy = UNCONFIRMED |
| Ethereum Mainnet | 1 | **YES** | — (passes, but most expensive) |

---

## Robinhood Chain Mainnet — chain ID 4663

**Verdict: does NOT pass the six-requirement bar.** Circle USDC is a documented NO and
Privy support is UNCONFIRMED.

### The six requirements

1. **Uniswap v4 core — YES.**
   PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951`, PositionManager
   `0x58daec3116aae6D93017bAAea7749052E8a04fA7`, StateView
   `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b`, Permit2
   `0x000000000022D473030F116dDEE9F6B43aC78BA3`.
   Source: https://docs.uniswap.org/contracts/v4/deployments (retrieved 2026-09-11),
   "Robinhood Chain: 4663" table row.
   On-chain: RPC `https://rpc.mainnet.chain.robinhood.com` (documented at
   https://docs.robinhood.com/chain/connecting), `cast chain-id` → 4663; `cast codesize`
   → 24009 / 23877 / 3531 / 9152 bytes respectively (all deployed); PositionManager's
   and StateView's `poolManager()` calls both return the exact PoolManager address above.

2. **Chainlink ETH/USD and USDC/USD — YES**, both are SVR-variant paths (the only
   variant that exists on this network — there is no plain `eth-usd`/`usdc-usd` path
   here).
   ETH/USD proxy `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9`, directory path
   `eth-usd-shared-svr`, heartbeat 86400s. Source:
   https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json (retrieved
   2026-09-11), array entry `$[17]`. On-chain: `description()` = "ETH / USD",
   `decimals()` = 8, `latestRoundData()` answer = 253997190000 (~$2,539.97),
   `updatedAt` = 1789149964 (fresh at probe time).
   USDC/USD proxy `0x9e6f4605992a899eE2999999F3Ec80C41F452546`, path
   `usdc-usd-shared-svr`, heartbeat 86400s, entry `$[39]`. On-chain: `description()` =
   "USDC / USD", `decimals()` = 8, answer = 99987752, `updatedAt` = 1789140898.

3. **Circle USDC — NO.**
   Source: https://developers.circle.com/stablecoins/usdc-contract-addresses (retrieved
   2026-09-11) — Robinhood Chain (4663) is present in **neither** the mainnet nor
   testnet USDC address tables (0 matches for "Robinhood" or "4663" in the page).
   Note: a claim that Robinhood's own bridging docs route USDC-origin transfers to USDG
   (Paxos) instead is **UNCONFIRMED** on re-check — that page,
   https://docs.robinhood.com/chain/bridging/, has zero occurrences of "USDC" or
   "HyperEVM" and only describes USDG as an OFT moved via LayerZero/Stargate. The NO
   verdict for Circle USDC stands on Circle's own table alone, independent of that
   bridging claim.

4. **Privy — UNCONFIRMED.**
   Chain 4663 does not appear in Privy's default-networks table at
   https://docs.privy.io/basics/react/advanced/configuring-evm-networks, and
   https://docs.privy.io/wallets/overview/chains has zero occurrences of "Robinhood."
   The only applicable text is a generic claim that Privy is compatible with any
   EVM-compatible chain via a custom `viem` `defineChain` configuration — not a
   documented, chain-ID-scoped entry for 4663. (A Privy blog post claiming Privy powers
   wallet infrastructure for "Robinhood Earn" is not one of the primary-source domains
   this probe is scoped to and is disregarded.)

5. **Safe deployed — YES.**
   `safe-global/safe-deployments` v1.4.1 (`safe_l2.json`, `safe.json`,
   `safe_proxy_factory.json`, retrieved 2026-09-11 from
   https://github.com/safe-global/safe-deployments) each list
   `networkAddresses["4663"] = "canonical"`. SafeL2 singleton
   `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` — on-chain codesize 24421 bytes,
   `VERSION()` = "1.4.1". SafeProxyFactory
   `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` — codesize 3054 bytes,
   `proxyCreationCode()` returns non-empty bytes.

6. **Explorer verification — YES**, with one sub-claim UNCONFIRMED.
   Source: https://docs.robinhood.com/chain/deploy-smart-contracts (retrieved
   2026-09-11). Quote: "forge verify-contract ... --chain-id 4663 --verifier blockscout
   --verifier-url https://robinhoodchain.blockscout.com/api/" — this documents a
   verification path directly, so the capability itself is YES.
   **UNCONFIRMED**: a claim that Blockscout's API
   (`robinhoodchain.blockscout.com/api/v2/smart-contracts/<addr>`) returns
   `is_verified:true` for the PoolManager/PositionManager/StateView/Permit2/SafeL2
   addresses above could not be reproduced on re-check — the endpoint returned HTTP 403
   with a Cloudflare "Just a moment..." challenge, with and without a browser
   User-Agent header. Whether `forge verify-contract` itself succeeds from a different
   network environment was not tested (out of scope for a read-only probe).

### Supplementary (not counted in the six)

- **Sequencer uptime — NO, structurally**, not a missing-yet gap. Source:
  https://docs.chain.link/data-feeds/l2-sequencer-feeds (retrieved 2026-09-11). Quote:
  "Chainlink is no longer expanding L2 Sequencer Uptime Feeds to additional networks."
  Robinhood Chain is absent from the enumerated list (Arbitrum, BASE, Celo, Mantle,
  MegaETH, Metis, OP, Scroll, Soneium, X Layer, zkSync), and
  `feeds-robinhood-mainnet.json` contains zero "sequencer" entries among its 57 rows.
- **TSLA/USD (supplementary) — YES, but it is Robinhood's own tokenized-equity feed,
  not a generic TSLA/USD reference.** Proxy `0x4A1166a659A55625345e9515b32adECea5547C38`,
  directory entry `$[22]`: name "Robinhood TSLA / USD", decimals 8, heartbeat 86400s.
  On-chain `description()` returns "RHTSLA / USD" — Robinhood's own tokenized-TSLA
  ticker. `latestRoundData()` answer = 36591499999 (~$365.91).
- **NFLX/USD — NO.** Same 57-entry directory file has zero matches for "NFLX,"
  cross-checked against https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood,
  which also does not mention NFLX.
- **The Graph — YES.** Source: https://thegraph.com/docs/en/supported-networks/robinhood/
  (retrieved 2026-09-11). Quote: "Identifier robinhood, Chain ID eip155:4663." Network-
  level capability; no single contract to name.
- **CREATE2 deployer — YES, weak provenance.** Address
  `0x4e59b44847b379578588920cA78FbF26c0B4956C`, on-chain codesize 69 bytes. No
  Robinhood-specific document, and none of the pre-approved source domains, names this
  address for chain 4663 by itself; the read chain-agnostic reference is
  https://github.com/Uniswap/v4-periphery, `test/shared/HookMiner.sol` line 18, which
  names `0x4e59b44847b379578588920cA78FbF26c0B4956C` as "CREATE2 Deployer Proxy" without
  mentioning Robinhood. Identity here rests on an exact on-chain match: CREATE2 deployer
  runtime bytecode (69 bytes, Robinhood Chain) =
  `0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3` (raw bytecode, not a hash),
  byte-for-byte identical to the well-known keyless "Nick's method" deterministic-
  deployment-proxy used at this same address across 100+ EVM chains.
- **Gas — ESTIMATE.** RPC `https://rpc.mainnet.chain.robinhood.com`, `cast gas-price`
  re-read: 108,860,000 wei (~0.109 gwei). For roughly 25 deployments/calls totalling
  ~12,000,000 gas: ~0.00131 ETH ≈ **$3.32** (converted via the live ETH/USD read above).
  ESTIMATE only — this is L2 execution gas alone and excludes any separate Orbit-stack
  L1 data-availability fee.

### Open unknowns

- Whether `PoolManager.owner()` (`0x2BAD8182C09F50c8318d769245beA52C32Be46CD`) is
  Uniswap governance was not checked.
- The Blockscout Cloudflare challenge above may also block `forge --verifier
  blockscout` from some environments; keyless verification was not exercised.

---

## Base Mainnet — chain ID 8453

**Verdict: PASSES all six requirements.**

### The six requirements

1. **Uniswap v4 core — YES.**
   PoolManager `0x498581fF718922c3f8e6A244956aF099B2652b2b`, PositionManager
   `0x7C5f5A4bBd8fD63184577525326123B519429bDc`, StateView
   `0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71`, Permit2
   `0x000000000022D473030F116dDEE9F6B43aC78BA3`.
   Source: https://docs.uniswap.org/contracts/v4/deployments (retrieved 2026-09-11),
   "Base: 8453" table.
   On-chain: RPC `https://mainnet.base.org` (documented at
   https://docs.base.org/get-started/connect-to-base), `cast chain-id` → 8453; `cast
   codesize` → 24009 / 23877 / 3531 / 9152 bytes; PositionManager's and StateView's
   `poolManager()` both return the exact PoolManager address above.

2. **Chainlink ETH/USD and USDC/USD — YES, but the reported addresses are SVR
   variants, not the plain feed.**
   ETH/USD `0x50015f8b17fb2C290Dde41fDc246ed0dcEE93a8b`, path `eth-usd-shared-svr-2`,
   heartbeat 1200s, threshold 0.15%. Base has no plain `eth-usd` path; alternatives that
   also live on-chain are `0xa4250cE1aA15Ff4cb5E5a8655293b65694e436Ed` (path
   `eth-usd-svr`, 8 decimals) and `0x5731Ae06077c79A3B292498940211E0aE7130bd3` (path
   `eth-usd-shared-svr`, 18 decimals). On-chain re-probe of the reported address: answer
   = 254611158975, `updatedAt` = 1789150073.
   USDC/USD reported address `0x458138Fc0D67027E9A6778ef40a6ffC318c69061` is path
   `usdc-usd-svr`, **not** the plain feed. **The plain `usdc-usd` path is
   `0x7e860098F58bBFC8648a4311b374B1D669a2bc6B`** — codesize 9571, `description()` =
   "USDC / USD", `decimals()` = 8, answer = 99984987, `updatedAt` = 1789130477. A hook
   implementation should prefer this plain-path address.
   Source: https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-base-1.json,
   linked from https://docs.chain.link/data-feeds/price-feeds/addresses?network=base
   (retrieved 2026-09-11).

3. **Circle USDC — YES.**
   `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. Source:
   https://developers.circle.com/stablecoins/usdc-contract-addresses, Base row.
   On-chain: codesize 1852 (proxy contract), `symbol()` = "USDC", `decimals()` = 6.

4. **Privy — YES.**
   Source: https://docs.privy.io/basics/react/advanced/configuring-evm-networks.
   Quote: default-networks table row "Base | 8453 | ✅ | ✅".

5. **Safe — YES.**
   SafeL2 `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762`,
   `networkAddresses["8453"] = "canonical"` in `safe_l2.json` v1.4.1
   (https://github.com/safe-global/safe-deployments), codesize 24421, `VERSION()` =
   "1.4.1". SafeProxyFactory `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`, canonical for
   8453, codesize 3054.

6. **Explorer verification — YES.**
   https://basescan.org/verifyContract returns HTTP 200, titled "Verify & Publish
   Contract Source Code | BaseScan." The PoolManager address page shows "Source Code
   Verified Exact Match ... Contract Name PoolManager." https://docs.base.org/get-started/connect-to-base
   names "Block explorer basescan.org" alongside RPC `https://mainnet.base.org`.
   **Unknown**: Etherscan's own supported-chains data marks Base (8453) with a
   free-tier flag of `false`, while Ethereum, Arbitrum and Unichain are marked `true`.
   Whether a free Etherscan API key can submit verification on Base specifically is
   unconfirmed.

### Supplementary (not counted in the six)

- **Sequencer uptime — YES.** `0xBCF85224fc0756B9Fa45aA7892530B47e10b6433`. Source:
  https://docs.chain.link/data-feeds/l2-sequencer-feeds. Quote: "BASE Mainnet:
  0xBCF85224fc0756B9Fa45aA7892530B47e10b6433" (also present in the reference-data-directory
  JSON, name "L2 Sequencer Uptime Status Feed"). On-chain: `description()` = "L2
  Sequencer Uptime Status Feed", `decimals()` = 0, `latestRoundData()` answer = 0
  (0 = sequencer up).
- **TSLA (supplementary) — this is Coinbase's tokenized equity, not a generic TSLA/USD
  feed.** `0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4`, path `cbtsla-usd`, category
  "custom", name "Coinbase TSLA." On-chain `description()` = "Coinbase TSLA," answer =
  36506000000 (~$365.06).
- **NFLX/USD — NO.** Zero matches for "NFLX" or "Netflix" across all 186 Base feed
  entries, including every "custom" tokenized-equity row (TSLA, AMZN, AAPL, MSFT, NVDA,
  META, MSTR, COIN, CRCL, INTC, SNDK, SPCX).
- **The Graph — YES.** https://thegraph.com/docs/en/supported-networks/base/. Quote:
  "Base Chain | Type: mainnet | Protocol: ethereum | Identifier: base | Chain ID:
  eip155:8453."
- **CREATE2 deployer — YES.** `0x4e59b44847b379578588920cA78FbF26c0B4956C`, codesize
  69. Source (chain-agnostic, weaker provenance than a dedicated deployments table):
  https://github.com/Uniswap/v4-periphery, `test/shared/HookMiner.sol`.
- **Gas — ESTIMATE.** RPC `https://mainnet.base.org`, `cast gas-price` re-read:
  6,000,000 wei (~0.006 gwei). For ~12,000,000 gas: ~0.000072 ETH ≈ **$0.18**.
  ESTIMATE — L2 execution gas only; excludes Base's separate L1 data-availability fee,
  which is charged per-transaction on top and was not measured.

### Open unknowns

- Only the v1.4.1 SafeL2 canonical singleton and factory were probed; older Safe
  versions (1.3.0/1.1.1) and the L1-vs-L2 singleton distinction were not.
- Universal Router (both variants) and Quoter are present in the same deployments table
  but were outside this probe's requested capability set, so were not independently
  checked.

---

## Arbitrum One — chain ID 42161

**Verdict: PASSES all six requirements — recommended chain (see Recommendation).**

### The six requirements

1. **Uniswap v4 core — YES.**
   PoolManager `0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32`, PositionManager
   `0xD88F38F930b7952f2Db2432Cb002E7abBF3dD869`, StateView
   `0x76fd297e2D437cd7f76d50F01AfE6160f86e9990`, Permit2
   `0x000000000022D473030F116dDEE9F6B43aC78BA3`.
   Source: https://docs.uniswap.org/contracts/v4/deployments (retrieved 2026-09-11),
   "Arbitrum One: 42161" table.
   On-chain: RPC `https://arb1.arbitrum.io/rpc` (documented at Arbitrum's own
   chain-info page, docs.arbitrum.io, which also lists "Arbiscan, Blockscout" as
   explorers for this RPC), `cast chain-id` → 42161; `cast codesize` → 24009 / 23877 /
   3531 / 9152 bytes; PositionManager's `poolManager()` returns the exact PoolManager
   address above. Permit2 DOMAIN_SEPARATOR (Arbitrum One) = `0x8a6e6e19bdfb3db3409910416b47c2f8fc28b49488d6555c7fceaa4479135bc3` (nonzero, live EIP-712 domain).

2. **Chainlink ETH/USD and USDC/USD — YES, plain paths (not SVR variants).**
   ETH/USD `0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612`, path `eth-usd`, 8 decimals,
   heartbeat **1755s**. Source: https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-arbitrum-1.json
   (retrieved 2026-09-11), entry `[1066]`, also present in
   https://docs.chain.link/data-feeds/price-feeds/addresses?network=arbitrum. On-chain
   re-probe: answer = 254048240357, `updatedAt` = 1789150201.
   USDC/USD `0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3`, path `usdc-usd`, 8 decimals,
   heartbeat **255s**, entry `[1096]`. Re-probe answer = 99987572.

3. **Circle USDC — YES.**
   `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`. Source:
   https://developers.circle.com/stablecoins/usdc-contract-addresses, "Arbitrum" row.
   On-chain: codesize 1852, `symbol()` = "USDC", `decimals()` = 6.

4. **Privy — YES.**
   Source: https://docs.privy.io/basics/react/advanced/configuring-evm-networks.
   Quote: "Arbitrum | 42161 | ✅ | ✅".

5. **Safe — YES.**
   Safe v1.4.1 singleton `0x41675C099F32341bf84BFc5382aF534df5C7461a`,
   `networkAddresses["42161"] = "canonical"` in `safe.json`
   (https://github.com/safe-global/safe-deployments), codesize 23579, `VERSION()` =
   "1.4.1". SafeL2 `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` is also canonical for
   42161 (codesize 24421). SafeProxyFactory `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`,
   codesize 3054.

6. **Explorer verification — YES, with one sub-claim UNCONFIRMED.**
   https://arbiscan.io/verifyContract returns HTTP 200 (with a browser User-Agent),
   titled "Verify & Publish Contract Source Code | Arbitrum One." docs.arbitrum.io's
   chain-info page lists "https://arb1.arbitrum.io/rpc | 42161 | Arbiscan, Blockscout" —
   two available explorers.
   **UNCONFIRMED**: the Arbiscan PoolManager address page itself returned HTTP 403 on
   re-check, so a reproduced "verified" badge on that specific page is not established
   here — only the verify-contract tool page itself was confirmed reachable.

### Supplementary (not counted in the six)

- **Sequencer uptime — YES.** `0xFdB631F5EE196F0ed6FAa767959853A9F217697D`. Source:
  https://docs.chain.link/data-feeds/l2-sequencer-feeds. Quote: "Arbitrum Mainnet:
  0xFdB631F5EE196F0ed6FAa767959853A9F217697D." On-chain: answer = 0 (sequencer up).
- **TSLA/USD — YES, and this is a standard on-chain Data Feed** (unlike Base's
  Coinbase-tokenized equivalent). `0x3609baAa0a9b1f0FE4d6CC01884585d0e191C3E3`, path
  `tsla-usd`, `deliveryChannelCode` = "DF" (on-chain Data Feed). Re-probed answer =
  36543500000, `updatedAt` = 1789136950.
- **NFLX/USD — NO.** All 4 NFLX entries for Arbitrum carry `deliveryChannelCode` =
  "DS" (Data Streams, off-chain) with `proxyAddress: null` — there is no on-chain
  aggregator for NFLX/USD on this chain today.
- **The Graph — YES.** https://thegraph.com/docs/en/supported-networks/arbitrum-one/,
  "eip155:42161." L2GraphToken `0x9623063377AD1B27544C965cCd7342f7EA7e88C7`, codesize
  2284, `symbol()` = "GRT."
- **CREATE2 deployer — YES.** `0x4e59b44847b379578588920cA78FbF26c0B4956C`, codesize
  69. No pre-approved source domain names this address for Arbitrum specifically;
  identity rests on the on-chain bytecode match to the standard keyless deployer (see
  Robinhood section for the full runtime-bytecode value, which is identical across all
  five chains).
- **Gas — ESTIMATE.** RPC `https://arb1.arbitrum.io/rpc`, `cast gas-price` re-read:
  20,024,000 wei (~0.020 gwei). For ~12,000,000 gas: ~0.00024 ETH ≈ **$0.61**.
  ESTIMATE — excludes the separate L1 data-availability component Arbitrum charges on
  top of L2 execution gas.

### Open unknowns

- The reported heartbeats (1755s for ETH/USD, 255s for USDC/USD) are read directly from
  the directory JSON; a hook's staleness bound should be set from these values, and they
  have not been independently stress-tested here.
- Arbitrum One also carries low-latency "svr"/"shared-svr" variants of both ETH/USD and
  USDC/USD (8 vs. 18 decimals); only the canonical `eth-usd`/`usdc-usd` paths were
  probed and reported.
- Only the v1.4.1 Safe singleton and factory were checked; older versions were not.

---

## Unichain Mainnet — chain ID 130

**Verdict: does NOT pass the six-requirement bar.** Privy support is UNCONFIRMED.

### The six requirements

1. **Uniswap v4 core — YES.**
   PoolManager `0x1f98400000000000000000000000000000000004`, PositionManager
   `0x4529a01c7a0410167c5740c487a8de60232617bf`, StateView
   `0x86e8631a016f9068c3f085faf484ee3f5fdee8f2`, Permit2
   `0x000000000022D473030F116dDEE9F6B43aC78BA3`.
   Source: https://developers.uniswap.org/docs/protocols/v4/deployments (retrieved
   2026-09-11) — the page's raw HTML does contain a chain-scoped "Unichain: 130" section
   naming all four addresses (an earlier read had missed this section because the page
   renders via client-side JS; the section is present in the underlying data).
   On-chain: RPC `https://mainnet.unichain.org` (documented at
   https://developers.uniswap.org/docs/unichain, which lists "Unichain Mainnet | 130 |
   https://mainnet.unichain.org | uniscan.xyz"), `cast chain-id` → 130; `cast codesize`
   → 24050 / 23877 / 3531 / 9152 bytes; PositionManager's and StateView's
   `poolManager()` both return `0x1F98400000000000000000000000000000000004`;
   PositionManager's `permit2()` returns the Permit2 address above. Permit2 DOMAIN_SEPARATOR (Unichain) = `0xd25c4cd78f3e192fc330e3aef424e5b4d2a05046941f2c153f12550450acb9b6`.

2. **Chainlink ETH/USD and USDC/USD — YES, both at 18 decimals** (not 8, unlike the
   other four chains).
   ETH/USD `0xBcE70e194940a157f3A80566505a7E96f5238CCa`, path `eth-usd-svr`, 18
   decimals, heartbeat 86400s — the only ETH/USD proxy on Unichain. On-chain re-probe
   answer = 2543966127959737000000 (1e18 scale, ~$2,543.97).
   USDC/USD `0xbd1cD1518eFB92a92100da62D4C488c810dFd75b`, path `usdc-usd`, 18 decimals.
   Re-probe answer = 999831041486193550 (~$0.9998).
   Source: https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-unichain-1.json
   (retrieved 2026-09-11).

3. **Circle USDC — YES.**
   `0x078D782b760474a361dDA0AF3839290b0EF57AD6`. Source:
   https://developers.circle.com/stablecoins/usdc-contract-addresses, "Unichain" row,
   corroborated at https://uniscan.xyz/address/0x078d782b760474a361dda0af3839290b0ef57ad6.
   On-chain: codesize 1798, `symbol()` = "USDC," `decimals()` = 6.

4. **Privy — UNCONFIRMED.**
   Zero occurrences of "Unichain" in either
   https://docs.privy.io/basics/react/advanced/configuring-evm-networks or
   https://docs.privy.io/wallets/overview/chains. Only a generic claim exists ("Includes
   EVM-compatible networks" under the Ethereum tier, plus a `viem` `defineChain`
   custom-chain path) — not a documented, chain-ID-scoped entry for 130.

5. **Safe — YES.**
   SafeL2 `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762`,
   `networkAddresses["130"] = "canonical"` in `safe_l2.json` v1.4.1
   (https://github.com/safe-global/safe-deployments), codesize 24421, `VERSION()` =
   "1.4.1." SafeProxyFactory codesize 3054.

6. **Explorer verification — YES.**
   https://uniscan.xyz/verifyContract returns HTTP 200, titled "Verify & Publish
   Contract Source Code | Uniscan." https://developers.uniswap.org/docs/unichain lists
   "Unichain Mainnet | 130 | https://mainnet.unichain.org | uniscan.xyz." Etherscan's
   own supported-chains data separately lists "Unichain Mainnet, 130" as a free-tier
   chain (unlike Base).

### Supplementary (not counted in the six)

- **Sequencer uptime — YES, but on conflicting documentation.** Reference-directory
  entry `$[5]`, `0x495639D9914e7D270c5dCC641BfB1d807423F813`, plus an on-chain read
  (answer = 0, up). https://docs.chain.link/data-feeds/l2-sequencer-feeds mentions
  "Unichain" zero times, so the prose docs page and the JSON/on-chain evidence disagree.
  Treated as YES on the stronger (JSON + on-chain) evidence; flagged as a documentation
  inconsistency to re-check before relying on it.
- **TSLA/USD — NO.** Zero matches among the 12 entries in Unichain's feed directory.
- **NFLX/USD — NO.** Same file, zero matches.
- **The Graph — YES.** https://thegraph.com/docs/en/supported-networks/unichain/, page
  ID "eip155:130," network slug "unichain."
- **CREATE2 deployer — YES.** `0x4e59b44847b379578588920cA78FbF26c0B4956C`, codesize
  69. Source (chain-agnostic): https://github.com/Uniswap/v4-periphery,
  `test/shared/HookMiner.sol`, plus the on-chain byte-for-byte runtime match on chain
  130.
- **Gas — ESTIMATE.** RPC `https://mainnet.unichain.org`, `cast gas-price` re-read:
  1,500,000 wei (~0.0015 gwei). For ~12,000,000 gas: ~0.000018 ETH ≈ **$0.046**.
  ESTIMATE — excludes Unichain's OP-Stack L1 data-availability fee.

### Open unknowns

- Whether Privy actually onboards Unichain via a custom `defineChain` configuration
  (rather than a documented default) was not exercised — no live SDK test was run.
- Unichain's `SafeL2` bytecode match confirms the expected code is present at the
  canonical address but does not by itself prove Safe's own factory (versus a replay of
  the same init bytecode) performed the deployment.

---

## Ethereum Mainnet — chain ID 1

**Verdict: PASSES all six requirements, but is the most expensive of the three passing
chains and needs no sequencer guard (L1).**

### The six requirements

1. **Uniswap v4 core — YES.**
   PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90`, PositionManager
   `0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e`, StateView
   `0x7ffe42c4a5deea5b0fec41c94c136cf115597227`, Permit2
   `0x000000000022D473030F116dDEE9F6B43aC78BA3`.
   Source: https://docs.uniswap.org/contracts/v4/deployments (retrieved 2026-09-11,
   redirects to https://developers.uniswap.org/docs/protocols/v4/deployments),
   "Ethereum: 1" table.
   On-chain: RPC `https://ethereum.publicnode.com`, `cast chain-id` → 1; `cast codesize`
   → 24009 / 23877 / 3531 / 9152 bytes; PositionManager's and StateView's
   `poolManager()` both return the exact PoolManager address above. Chain ID 1 was
   independently re-confirmed on a second keyless gateway,
   `https://cloudflare-eth.com`, but that gateway rejects `eth_getCode`/`eth_gasPrice`,
   so codesizes and gas price could not be cross-verified against a second RPC.

2. **Chainlink ETH/USD and USDC/USD — YES.**
   ETH/USD `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`, path `eth-usd`, 8 decimals,
   heartbeat 3600s. Re-probe answer = 254449100000.
   USDC/USD `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6`, path `usdc-usd`, heartbeat
   82800s. Re-probe answer = 99983477.
   Source: https://reference-data-directory.vercel.app/feeds-mainnet.json (retrieved
   2026-09-11), entries `[138]` and `[254]`.

3. **Circle USDC — YES.**
   `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`. Source:
   https://developers.circle.com/stablecoins/usdc-contract-addresses, "Ethereum" row.
   On-chain: codesize 2186, `symbol()` = "USDC."

4. **Privy — YES.**
   Source: https://docs.privy.io/basics/react/advanced/configuring-evm-networks. Quote:
   "Ethereum | 1 | ✅ | ✅"; "Embedded wallets will initialize on Ethereum mainnet ...
   when no explicit configuration is provided."

5. **Safe — YES.**
   Safe v1.4.1 singleton `0x41675C099F32341bf84BFc5382aF534df5C7461a`,
   `networkAddresses["1"] = "canonical"` in `safe.json`
   (https://github.com/safe-global/safe-deployments), codesize 23579, `VERSION()` =
   "1.4.1." SafeProxyFactory `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`, codesize
   3054.

6. **Explorer verification — YES, but not keyless.**
   Source: https://docs.etherscan.io/contract-verification/verify-with-foundry. Quote:
   "Most chains with an Etherscan explorer are supported using the --chain flag." Its
   own worked verification examples pass `--etherscan-api-key`, so, unlike the
   Blockscout-based chains above, Ethereum verification requires an API key. The
   Etherscan PoolManager page shows "Exact Match."

### Supplementary (not counted in the six)

- **Sequencer uptime — NO, not applicable on L1.** Source:
  https://docs.chain.link/data-feeds/l2-sequencer-feeds — Ethereum L1 is not and cannot
  be a subject chain for this feed type. A re-check found exactly one "sequencer"-adjacent
  match in `feeds-mainnet.json` among 290 entries: `[192]` "Arbitrum Healthcheck"
  `0x32EaFC72772821936BCc9b8A32dC394fEFcDBfD9` — this is a bridge health-check feed for
  a different chain, not an L1 sequencer-uptime feed, so NO stands.
- **TSLA/USD — YES (supplementary, standard on-chain feed).**
  `0xB204328559E17F84eE7A285036AA0d47124F85D5`, name "TSLA-USD (24/5)," path
  `tsla-usd-kalman-24-5`, category "new," heartbeat 86400s — the directory's own docs
  block describes this as a 24/5-market "calculated price" methodology rather than a
  continuous feed. Re-probe answer = 36551225000.
- **NFLX/USD — NO.** Zero matches among all 290 mainnet feed entries.
- **The Graph — YES.** https://thegraph.com/docs/en/supported-networks/mainnet/,
  "eip155:1."
- **CREATE2 deployer — YES, outside the pre-approved source list.**
  `0x4e59b44847b379578588920ca78fbf26c0b4956C`, codesize 69. The reference used
  (`github.com/Arachnid/deterministic-deployment-proxy`) is outside this file's
  pre-approved domain allowlist; the equivalent chain-agnostic mention in
  https://github.com/Uniswap/v4-periphery `test/shared/HookMiner.sol` (used for the
  other four chains) applies here too, plus the on-chain byte-for-byte runtime match.
- **Gas — ESTIMATE, and it moved between the two reads.** RPC
  `https://ethereum.publicnode.com`. First read: 182,901,530 wei (~0.183 gwei),
  cross-checked against the same RPC's latest-block `baseFeePerGas` of 192,829,593 wei
  (consistent). Re-read at verification time: **279,344,335 wei (~0.279 gwei)** — a
  material move. For ~12,000,000 gas at the re-read price: ~0.00335 ETH ≈ **$8.53**.
  Flagged explicitly as volatile.

### Open unknowns

- Whether a fully keyless Etherscan verification path exists for any chain was not
  confirmed — Ethereum specifically requires an API key per its own docs.
- Privy's and The Graph's feature depth beyond "network is supported" (session-key /
  gas-sponsorship specifics on Ethereum, or Graph Network query costs at the beta's
  expected volume) was not checked.
- Codesize probes on Ethereum used only `https://ethereum.publicnode.com`; a second
  gateway confirmed chain ID 1 but rejects `eth_getCode`/`eth_gasPrice`, so no
  independent second-RPC codesize cross-check exists for this chain.

---

## Recommendation

Only three of the five candidates pass all six requirements: **Base, Arbitrum One, and
Ethereum.** Robinhood Chain fails on Circle USDC (a documented NO) and Privy
(UNCONFIRMED); Unichain fails on Privy (UNCONFIRMED).

Of the three that pass, **Arbitrum One (42161)** is the strongest fit on the verified
facts above:

- Its Uniswap v4 deployment is confirmed correctly wired on-chain (PositionManager and
  StateView both independently return the same PoolManager address).
- Its Chainlink feeds are the **plain** `eth-usd`/`usdc-usd` paths, not SVR variants —
  unlike Base, where the addresses initially reported were SVR variants and the plain
  `usdc-usd` feed had to be substituted in.
- It has a standard on-chain Chainlink TSLA/USD Data Feed (`deliveryChannelCode: DF`);
  Base's equivalent is a Coinbase-tokenized-equity feed, a different kind of reference.
- It carries a documented, live sequencer-uptime feed reading "up."
- Native Circle USDC, Privy, and Safe (both singleton and factory) are all confirmed.
- Its explorer setup lists two options (Arbiscan and Blockscout), and Etherscan's own
  data marks it free-tier for verification (unlike Base).
- Gas is an ESTIMATED $0.61 for the beta's full deploy-and-wiring sequence — three
  orders of magnitude cheaper than Ethereum's ESTIMATED $8.53, and higher than Base's
  ESTIMATED $0.18 but with cleaner (plain-path) feed provenance.

**Base** is the cheapest option and passes cleanly, but its reported ETH/USD and
USDC/USD addresses need substitution for the plain-path feeds noted above, and
Etherscan's own data does not mark it free-tier for verification. **Ethereum** passes
everything but costs roughly 14x Arbitrum's ESTIMATE and needs no sequencer guard,
since it is L1.

### Consolidated open items across every chain

- Two "verified" explorer claims could not be reproduced on re-check: Robinhood's
  Blockscout API (HTTP 403, Cloudflare challenge) and one Arbiscan contract address
  page (HTTP 403). No keyless verification was actually attempted anywhere.
- A production hook must pick specific feed addresses and staleness bounds from the
  heartbeats recorded above (e.g., 1755s for Arbitrum ETH/USD, 255s for Arbitrum
  USDC/USD) — these were read from Chainlink's directory, not independently
  stress-tested.
- NFLX/USD has no on-chain feed on any of the five chains checked; TSLA/USD exists in
  varying forms (standard feed on Arbitrum and Ethereum, tokenized-equity feeds on Base
  and Robinhood, absent on Unichain).
- Every gas figure above is a single-snapshot ESTIMATE excluding L1 data-availability
  fees on the L2s; Ethereum's own gas price moved roughly 53% between the two reads
  taken during this exercise, underscoring that these are not commitments.
- **Nothing in this file was signed or broadcast, and no contract has actually been
  deployed or verified on any of these chains as part of gathering it.**

### Q9

**Q9 — which chain the mainnet beta actually deploys to — is the owner's decision.**
This file provides the evidence Arbitrum One is the strongest verified candidate; it
does not settle the choice.
