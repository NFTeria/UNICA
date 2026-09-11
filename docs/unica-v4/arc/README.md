# Arc workstream — merged report

Read-only research, simulation and planning only. Nothing referenced below was deployed, signed,
broadcast, funded, or published by this report or the eight files it merges. No wallet balance of
the owner was read anywhere in this workstream. Every fact below is carried by reference from one
of this directory's own files, each independently primary-sourced and dated **2026-09-11**:
[`NETWORK.md`](./NETWORK.md), [`TOKENS.md`](./TOKENS.md), [`COMPATIBILITY.md`](./COMPATIBILITY.md),
[`NANOPAYMENTS.md`](./NANOPAYMENTS.md), [`X402.md`](./X402.md),
[`LIQUIDITY-ORACLES.md`](./LIQUIDITY-ORACLES.md), [`THREAT-MODEL.md`](./THREAT-MODEL.md),
[`PRODUCT-FLOWS.md`](./PRODUCT-FLOWS.md). This file adds no new external fact; it synthesizes and
cross-checks, and where the siblings disagree it says so rather than picking a side.
`THREAT-MODEL.md` is the most recently updated of the eight, and its evidence ledger (`E-01`–`E-48`) is the newest record — where it
corrects an earlier file, this report follows the correction and names it.

**UNICA context (binding, unchanged by this report).** UNICA v4 is the UNICA release; Uniswap v4
is the AMM. Payer-bound orders only, `WrongPayer` preserved. V2 Advisory 001 is a mandatory
regression case. UNICA's own fee is 0 in the beta. No real tokenized equities; no unsupported BTC
token. A same-asset USDC payment is never forced through a swap. No real-value deployment without
a Safe, a pauser, caps, verified contracts, authenticated pricing wherever conversion occurs,
adequate liquidity, simulations, and an independent human review. Compatibility is never described
here as a completed integration. Sponsor order stays 1 Uniswap v4, 2 ENSv2 on Sepolia, 3 The Graph;
Arc, Circle, Chainlink, x402 and Privy are additional workstreams.

## 1. Executive summary

No UNICA contract is deployed on any Arc chain id. This is research plus a read-only treasury
module, not a running system. Arc **testnet** (chain id `5042002`) is live, public, and keyless
(`https://rpc.testnet.arc.io`); Arc **mainnet** (chain id `5042`, per Circle's own `arc-node`
repository) has no public RPC, explorer, or published contract address as of this retrieval, and
Circle's own pressroom targets a public launch on **2026-09-16** — five days after every read in
this workstream. Arc's native gas asset is USDC itself (18-decimal native interface, 6-decimal
ERC-20 interface at `0x3600…0000`, one shared balance) — the single most load-bearing fact for any
UNICA contract touching Arc. USDC, EURC, and cirBTC on Arc testnet are all admin-upgradeable
zOS-proxy stablecoins with live pause and blacklist roles.

No Uniswap v4 `PoolManager` is confirmed live on Arc by any canonical source, on either chain id.
No Chainlink price feed on Arc has a readable on-chain address today (Arc Mainnet feeds exist in
Chainlink's directory but sit behind a login-gated explorer with no public RPC). x402 does not
list Arc on its canonical registry or the Coinbase CDP Facilitator; only Circle's own
Gateway/Nanopayments reaches Arc, testnet-only, Circle-operated. On-chain gas measured directly on
Arc testnet shows a $0.001–$0.01 payment is not economically viable as a single settlement
(break-even ≈ $0.04). UNICA's own logic — payer binding, replay, reentrancy, fee-on-transfer, dust
— is tested and green on a standard EVM (40 Solidity tests, 177 JS checks, all passing), but
**zero** have run on Arc's actual EVM, and V2 Advisory 001 (the payer witness does not bind the
merchant half) is reproduced and still **open**. Every real-value launch gate this project holds
is unmet for Arc today, independent of Arc itself being ready. Net position:
**research-complete, build-not-started, deploy-not-authorized.**

## 2. Verified Arc network facts

Full detail and every source quote: [`NETWORK.md`](./NETWORK.md); mainnet chain id corrected by
[`THREAT-MODEL.md`](./THREAT-MODEL.md) §1.1 (E-48).

| Property | Value | Confidence |
|---|---|---|
| "Arc" | Circle's Layer-1, `docs.arc.io` / `circle.com` | CONFIRMED |
| Testnet chain id | `5042002` (hex `0x4cef52`) | CONFIRMED — doc + live `eth_chainId`, 4 independent keyless RPCs agree (E-01) |
| Testnet RPC (keyless, primary) | `https://rpc.testnet.arc.io` | CONFIRMED, used for every on-chain read in this workstream |
| Testnet explorer | `https://testnet.arcscan.app` (Blockscout) | CONFIRMED |
| Mainnet chain id | `5042` | Stated by Circle's own `circlefin/arc-node` `BREAKING_CHANGES.md` (E-48); consistent with Uniswap `sdk-core`'s `ChainId.ARC` and Safe's registry key; cannot be read back — no public mainnet RPC exists |
| Mainnet RPC / explorer / addresses | Not published | `docs.arc.io`: "Mainnet addresses are not yet available." Mainnet explorer (named by Chainlink's directory) 302-redirects to a `circle.cloudflareaccess.com` login (E-04) |
| Mainnet status | Private mainnet running per Circle's 2026-08-05 pressroom ("100+ institutional builders"); `docs.arc.io`'s own deployment-model page instead lists Private Mainnet "Upcoming" | Unresolved discrepancy between two Circle-controlled sources, not adjudicated |
| Public mainnet launch date | 2026-09-16 (Circle pressroom) | 5 days after this workstream's retrieval date |
| Native gas asset | USDC itself — native interface 18 decimals, ERC-20 interface 6 decimals, one shared balance | CONFIRMED, doc + on-chain (proxy bytecode at `0x3600…0000`) |
| EVM baseline | Targets Ethereum's Osaka fork; CREATE2 (incl. EIP-7610) confirmed identical to Ethereum | CONFIRMED. PUSH0 (EIP-3855) and transient storage (EIP-1153) are inferred from the Osaka-baseline framing, not confirmed by an opcode probe |
| Finality | Deterministic BFT (Malachite/Tendermint), PoA validator set, >2/3 pre-commit; docs state reorgs are structurally impossible, not merely unlikely | CONFIRMED, doc quote |
| Gas floor | 20 Gwei minimum base fee, silently enforced (sub-floor txs never appear in a block); 22 Gwei measured at retrieval | MEASURED, live read |
| Contract verification | Blockscout via `arc-forge verify-contract --verifier blockscout`, or manual upload at `testnet.arcscan.app/contract-verification` | CONFIRMED for testnet; mainnet process UNKNOWN (no mainnet explorer yet) |
| CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C`, live on testnet, codehash byte-identical to this repo's Sepolia `DEPLOYER_CODEHASH` pin | CONFIRMED on-chain (`COMPATIBILITY.md` §2) |

Open items (carried to §15): PUSH0/EIP-1153 confirmation, the private-vs-upcoming mainnet
discrepancy, whether the opt-in Arc Privacy Sector (APS) is live anywhere (E-43).

## 3. Verified token-address table

Full detail: [`TOKENS.md`](./TOKENS.md) §8; cirBTC corrected by [`THREAT-MODEL.md`](./THREAT-MODEL.md)
§1.2 (E-17/E-18). All rows chain id **5042002 (Arc Testnet)**; no Arc mainnet address exists for
any token below.

| Token / contract | Address | Decimals | Notes |
|---|---|---|---|
| USDC (ERC-20 interface over native) | `0x3600000000000000000000000000000000000000` | 6 (native side: 18) | zOS `AdminUpgradeabilityProxy`, not EIP-1967; `paused()` false; pause + blacklist roles live |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | 6 | Same zOS proxy pattern, own separate admin/implementation; EIP-3009 confirmed on-chain (E-14) |
| cirBTC (Circle Wrapped Bitcoin) | `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` | 8 | **Resolved by THREAT-MODEL.md E-17**, correcting `TOKENS.md`'s earlier UNKNOWN: published at `developers.circle.com/assets/cirbtc-contract-addresses`, linked from `faucet.circle.com`. Testnet-only, "not backed by real Bitcoin"; owner = pauser = blacklister = one address; **no Arc mainnet address exists** |
| USYC (tokenized money-market fund) | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` | 6 | Gated: $100,000 minimum, institutions outside the US only |
| USYC Entitlements | `0xCC205224862C7641930c87679E98999d23C26113` | — | Listed, not independently read |
| USYC Teller | `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A` | — | Mint path for allowlisted USYC investors |
| CCTP TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | — | Upgradeable proxy; domain id `26` |
| CCTP MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | — | `localDomain()`→26, `signatureThreshold()`→2, `getNumEnabledAttesters()`→2 |
| CCTP TokenMinterV2 | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` | — | Code confirmed present |
| CCTP MessageV2 | `0xbaC0179bB358A8936169a63408C8481D582390C4` | — | Code confirmed present |
| GatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | — | `isTokenSupported(USDC)` true; **`isTokenSupported(EURC)` false** (E-30 — resolves `NANOPAYMENTS.md`'s open question) |
| GatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | — | Code confirmed present |
| Canonical Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | — | 9,152 bytes; domain binds 5042002 (E-21) |
| x402 canonical `x402ExactPermit2Proxy` | `0x402085c248EeA27D92E8b30b2C58ed07f9E20001` | — | **No code on Arc Testnet** (E-22) — x402's Permit2 route is disabled on Arc |
| Blocklisted test fixture | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | — | Public Foundry/Anvil mnemonic address; blocklist is per-token: blacklisted on USDC, not on EURC or cirBTC (E-16) |
| Safe SafeL2 1.4.1 | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` | — | Codehash-matched on-chain against `safe-deployments` (E-42) |
| Safe SafeProxyFactory 1.4.1 | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` | — | Codehash-matched on-chain (E-42) |

**Never use** any of the four self-labeled "cirBTC" look-alikes on `testnet.arcscan.app` — none is
Circle's; token identity on Arc is the (chain id, address) pair, never a name/symbol lookup.

## 4. Wallet-balance readback

**State: not performed.** No wallet balance of any owner-controlled address was read anywhere in
this workstream — per the hard rule recorded here. Every on-chain read across all eight
sibling files is a **public contract state** read only (`eth_getCode`, `decimals()`, `symbol()`,
`paused()`, `isBlacklisted()`, proxy-slot reads, `localDomain()`, and similar view calls), never a
balance of an address the owner controls. Awaiting **authorized public addresses** from the owner:
once supplied, the same keyless RPC (`https://rpc.testnet.arc.io`) can read `eth_getBalance`
(native, 18 decimals) and `USDC.balanceOf()`/`EURC.balanceOf()` (6 decimals) with no key and no
signature required. This section stays empty until that authorization exists.

## 5. Uniswap v4 availability and provenance

Full detail: [`COMPATIBILITY.md`](./COMPATIBILITY.md) §3, [`LIQUIDITY-ORACLES.md`](./LIQUIDITY-ORACLES.md)
"Uniswap v4 on Arc", [`THREAT-MODEL.md`](./THREAT-MODEL.md) E-05 to E-08.

**Testnet (5042002): no evidence at all, from any source.** Nothing in `docs.arc.io`, Uniswap's
canonical deployments page, or the UniswapX playbook names a `PoolManager` on testnet; a direct
`eth_getCode` on the address claimed for mainnet returns `0x` (no code) when read on testnet.

**Mainnet (5042): claimed by Uniswap-owned sources, confirmed by neither canonically.**
`Uniswap/UniswapX`'s repository (`playbook/chains/arc.md`, dated 2026-06-12) states a v4
`PoolManager` at `0x8366a39cc670b4001a1121b8f6a443a643e40951`, owner
`0x33f26c5d69e2c40956f22c6195b6a499cf4151e8` (a 171-byte proxy, "likely a Safe"), marked its own
claim "verification pending." `THREAT-MODEL.md` (E-05) found the same address in the newer
`Uniswap/sdks` monorepo (`sdk-core/src/chains.ts`, commit 2026-09-01), while `COMPATIBILITY.md`
(§3.3), checking the older standalone `Uniswap/sdk-core` repo, found zero "arc" occurrences — most
plausibly a repo migration, not adjudicated further. **Uniswap's own canonical deployments page
does not list Arc, either chain id (E-06)** — the highest-authority source says: none. No
independent on-chain read of the mainnet address is possible (no public RPC; the explorer
redirects to a Cloudflare login, E-04). An independent tracker (`builtonarc.app`, 2026-09-02):
"announcement only, nothing observed on chain." A community project, "Arc Swap," deployed
Uniswap **V2** (not V4, not Uniswap Labs) on testnet — never to be called an official deployment.

**Verdict: UNCONFIRMED, not fact.** Real enough to plan around, not real enough to hard-code before
an independent on-chain read against an officially-documented mainnet RPC is possible. **No UNICA
text may say "Uniswap v4 on Arc" until Uniswap's canonical deployments page lists Arc and an
on-chain read confirms it** (`THREAT-MODEL.md` §7).

## 6. Chainlink availability

Full detail: [`LIQUIDITY-ORACLES.md`](./LIQUIDITY-ORACLES.md) "Chainlink on Arc",
[`THREAT-MODEL.md`](./THREAT-MODEL.md) E-33/E-34/E-46.

**Partnership confirmed, no readable identifier exists yet.** Chainlink's own account announced
Arc joining Chainlink Scale for CCIP, Data Streams, Data Feeds, and Proof of Reserve — a
subsidized-onboarding commitment, not itself proof feeds are deployed at specific addresses. Arc's
own oracle page (`docs.arc.io/arc/tools/oracles`) links out **generically** to Chainlink's
non-Arc-specific documentation, in contrast to Stork, which gets an Arc-specific address page
linked directly — an asymmetry worth flagging.

**A correction from `THREAT-MODEL.md` (E-33), superseding `LIQUIDITY-ORACLES.md`'s "no Arc entry
found":** Chainlink's own directory (`docs.chain.link/data-feeds/price-feeds/addresses` →
`feeds-arc-mainnet.json`) does list an **"Arc Mainnet"** network with 30 feeds, each with a
24-hour heartbeat and a 0.5% deviation threshold:

| Feed | Proxy address | Notes |
|---|---|---|
| EURC / USD | `0x361b95c10b76Ca3f35C686d423e43A951755Bf23` | `docs.attributeType` = `"dex_state_price"` — this feed is itself derived from DEX state, so it cannot independently validate a DEX price |
| USDC / USD | `0x84EA90AC252Dc437031461836DB5164219147905` | — |
| cirBTC Reserves | `0xEB0884a871ea1f6483B5FC10fd3D7dC5806411fc` | `docs.productType` = `"Proof of Reserve"` |

**None of these can be read on-chain today** — Arc mainnet has no public RPC and its explorer is
login-gated (E-04). **Zero Arc Testnet feeds exist** in the same directory (E-34). No Chainlink
Data Streams feed id, verifier contract, or CRE workflow id/DON name is published for Arc
specifically; Arc's own oracle page has no CRE section at all (E-46).

**Conclusion.** No authenticated Chainlink route on Arc has an exact, confirmed, *readable*
identifier as of 2026-09-11 — a mainnet RPC is the precondition for all 30 listed feeds, not just
an address lookup.

## 7. x402 support and architecture

Full detail: [`X402.md`](./X402.md), corrected by [`THREAT-MODEL.md`](./THREAT-MODEL.md) E-22.

**What x402 is.** An HTTP-native payment-negotiation protocol (`402 Payment Required`), canonical
under `x402-foundation/x402` (`coinbase/x402` is a development fork). It standardizes *how* a
price is stated and *how* payment is proved; it never moves money itself and carries no arbitrary
calldata — every settlement path (`eip3009`, `permit2`, `ERC-7710`) performs a flat token transfer
to one address, nothing else.

**Arc is not on x402's own network list** — not on `docs.x402.org`'s canonical support page, the
core v2 spec's worked examples, or the Coinbase CDP Facilitator's supported networks (mainnet:
Base, Polygon, Arbitrum, World, Solana; testnet: Base Sepolia, World Sepolia, Solana Devnet).
**What does exist:** Circle's own Gateway/Nanopayments product lists "Arc (testnet only)," and
Circle publishes a sample repo (`circlefin/arc-nanopayments`) demonstrating it — both
Circle-operated, distinct from the open x402 facilitator ecosystem.

**The canonical Permit2 route is disabled on Arc.** `x402ExactPermit2Proxy`
(`0x402085c248EeA27D92E8b30b2C58ed07f9E20001`) has no code on Arc Testnet (E-22) — **EIP-3009 is
the only stock x402 route available on Arc.** EURC's EIP-3009 support is now confirmed directly
on-chain (E-14/E-15), resolving `X402.md`'s open question.

**x402's narrow authorization sharpens Advisory 001.** UNICA's own V2 Permit2 witness binds only
the payer's half of a quote, leaving the merchant's half substitutable (Advisory 001, still open —
§12). x402's `exact`/EIP-3009 authorization is narrower still — six flat fields, no quote digest,
no merchant identity. **Wiring x402's stock `exact` scheme straight into a payer-bound UNICA order
would reproduce Advisory 001's exact failure mode one layer higher in the stack.**

**Recommended shape (`X402.md` §11):** use x402/Gateway as the collection leg only — moving an
exact, named asset to a UNICA-controlled address, gaslessly, over HTTP — and let UNICA own order
binding, conversion, and settlement. A resource server or keeper verifies the x402 receipt and
then invokes UNICA's own `pay(orderId)`; x402 never calls it directly. A public, unbound payment
link is safe in x402's own terms; retrofitting payer-binding onto an x402 authorization after the
fact is not, until a UNICA-authored extension binds the full quote digest.

## 8. Nano-payment economics table

Full detail: [`NANOPAYMENTS.md`](./NANOPAYMENTS.md) §4, §13; gas figures cross-checked against
[`THREAT-MODEL.md`](./THREAT-MODEL.md) E-37. MEASURED = live RPC read; ESTIMATE = standard EVM
opcode cost, not measured with a funded signer.

| Amount | Network fee (ESTIMATE 90k gas EIP-3009, MEASURED 22 Gwei) | Fee as % of payment | Model A economically sensible (5% bar)? |
|---|---|---|---|
| $0.001 | $0.00198 | **198%** | No — loses money before any other fee |
| $0.01 | $0.00198 | **19.8%** | No — nearly 4× over the bar |
| $0.10 | $0.00198 | **1.98%** | Yes, comfortably |
| $1.00 | $0.00198 | **0.198%** | Yes, trivially |

The network fee is flat in gas terms — the same absolute cost at every payment size — because
Arc's native gas asset is USDC at a 1:1 USD peg, so no separate price oracle is needed to convert
gas to dollars. E-37 independently measured a plain USDC ERC-20 `transfer` at **49,097 gas**
(0.000982 USDC at the 20 Gwei floor) and a native send at 21,000 gas (0.00042 USDC), both
consistent with the EIP-3009 ESTIMATE above. **Break-even point at a 5%-of-payment bar: ≈ $0.04**
per on-chain settlement — this sits between the $0.01 and $0.10 amounts priced on 2026-09-11.

| Model | Marginal cost per payment | What it does not eliminate |
|---|---|---|
| **A — every payment on-chain** | Flat, as above | Simplest; the only model where a $0.001–$0.01 charge loses money outright |
| **B — signed off-chain auth, periodic batch settlement** (Circle Nanopayments/Gateway shape) | ≈ $0.00000198 at batch size 1,000 | Facilitator liveness risk; a pending-value window before the batch lands; someone still pays the aggregate gas |
| **C — prepaid/escrowed balance** | $0 per deduction once funded | Makes the operator a custodian of pooled funds — a money-transmitter/e-money fact pattern (compliance question, out of scope here) and a single high-value security target |

**GatewayWallet does not support EURC on Arc testnet** (`isTokenSupported(EURC)` = false, E-30) —
Nanopayments batching is USDC-only on Arc. No official relayer/paymaster premium rate was found.

## 9. Recommended UNICA-on-Arc architecture

Synthesized from [`X402.md`](./X402.md) §11, [`PRODUCT-FLOWS.md`](./PRODUCT-FLOWS.md), and
[`THREAT-MODEL.md`](./THREAT-MODEL.md) §2–§4. Not a build plan authorization — see §17–§18.

1. **Same-asset USDC payments: a direct transfer, never a swap, pool, or oracle.** Native and
   ERC-20 USDC are one balance at two decimal precisions; pairing them in a pool is meaningless.
2. **Collection above the ≈$0.04 floor: EIP-3009 `transferWithAuthorization` directly, or via x402
   as a thin HTTP wrapper around the same call** — x402's Permit2 route stays disabled on Arc (§7).
3. **Collection below the floor: Circle Gateway/Nanopayments batching**, accepting its constraints
   — EOA-only (no Safe, E-28), USDC-only (EURC unsupported, E-30), serve-before-settle.
4. **Order binding stays UNICA's own job, always.** Every settlement, however collected, is
   verified from **chain evidence** (the receipt and the `Transfer` log from the expected emitter,
   de-duplicated per E-47), never a facilitator's self-reported `success`. `WrongPayer` and the
   Advisory 001 fix (full quote-digest binding) are prerequisites for any Arc payer-bound flow.
5. **Cross-currency legs (EURC↔USDC, BTC-asset↔USDC) stay disabled** until both a readable
   authenticated price reference and a measured adequate-depth pool exist for that pair (§6, §15).
   Circle's StableFX is the sound EURC↔USDC path in principle but has no UNICA-callable surface.
6. **Caps, merchant allowlist, and pause/RETIRED gate every market**, per the v4 draft's
   `MarketConfig`/`Caps` design (unbuilt, §10) — independent of Arc, binding on any deploy.
7. **Treat Arc's finality as final-on-inclusion** — no confirmation-count wait — but hold a
   submitted-but-unconfirmed payment as UNKNOWN, never failed, given the fee-floor silent drop
   (E-36) and the disputed blocklist-receipt behavior (E-38 vs. E-39).

## 10. Required contract changes

Full detail and a proposed `config/chains/5042002.json`: [`COMPATIBILITY.md`](./COMPATIBILITY.md)
§17–§18.

1. **`src/libraries/UniswapDeployments.sol`** — add `5042002` (and, once confirmed, `5042`)
   branches to `universalRouter()`/`payoutCurrency()`; today both `revert UnsupportedChainId` for
   any chain but `11155111` — a compilation-level blocker independent of PoolManager provenance.
2. **`lib/hookmate`'s `AddressConstants.getPoolManagerAddress`** — no Arc branch, and a pinned
   submodule this repo does not edit directly; resolve Arc's PoolManager from this repo's own
   `config/chains/` file instead, to avoid trusting an upstream release timeline.
3. **A new settlement-shape check for chains with no native asset.** `V4SettlementHook`'s hard-coded
   `currency0 == address(0)` means "native ETH in" on Ethereum/Sepolia; on Arc it would mean native
   18-decimal USDC, silently redefining the shape into "native USDC vs. ERC-20 USDC" — a nonsensical
   same-asset "swap." Needs a `NotTheSettlementShape` variant or a chain-keyed resolver.
4. **`script/HookAddressForChain.s.sol` / `script/v3/MineHookV3.s.sol`** — extend chain dispatch to
   `5042002`; a fresh salt mining run is required (`initCodeHash` changes with every chain-keyed
   constructor constant, even though the CREATE2 factory itself is identical to Sepolia's).
5. **Explorer verification** (`script/verify.sh`, `script/verify-v3.sh`) — a Blockscout-flavored
   branch, mirroring the pattern already used for the Robinhood testnet alias.
6. **`test/compat/ArcForkBase.sol`** — following `test/fork/ForkPin.sol`, pin the CREATE2-factory
   codehash and USDC/EURC `decimals()` confirmed on 2026-09-11, failing loudly if they change.
7. **Port `WrongPayer` to whatever Arc executor is written** — chain-independent, but Advisory
   001's regression case (§12) must be re-run against it before any Arc executor holds real value.
8. **Caps, merchant allowlist, pause/`RETIRED`** — not implemented in any live generation; ordinary
   Solidity state and access control, chain-independent to add, binding on any deploy.

## 11. Required frontend/backend changes

Full detail: [`PRODUCT-FLOWS.md`](./PRODUCT-FLOWS.md) §1–§6.

- **No `402`-shaped HTTP paywall exists anywhere.** Nothing serves a `402` response, parses a
  `PAYMENT-SIGNATURE` header, or calls a facilitator's `/verify`/`/settle` — needed for Flow A
  (nano-payment API charges) and Flow C (agent-to-agent payments).
- **`apps/web/` is a static site generator with no RPC or wallet wiring.** Its own copy says it is
  "not wired to any chain"; its `status/`, `receipt/`, `merchant/`, `pay/` pages are structure and
  copy, not a working dashboard.
- **No batching facilitator exists.** Circle's Gateway/Nanopayments or x402's `batch-settlement`
  scheme is well-documented, but no UNICA contract accepts a batch and none runs one — required to
  cover the $0.001–$0.01 range (§8).
- **Dashboard fields unbacked (§6):** network fee (readable from any RPC, not joined to a UNICA
  row); conversion/LP fee (the receipt's `fee` field is a hardcoded `0`, while the PoolManager's
  own `Swap` event in the same tx reports the real fee — joinable, but nothing joins it); x402
  status (no UNICA code references x402); daily volume/caps (no on-chain accounting exists, only
  in the unbuilt v4 draft).
- **Failure reason has no data path.** Every guard reverts with a named error, but neither
  subgraph schema indexes failures — surfacing one needs a direct RPC trace no tool builds today.
- **`tools/unica-verify/cli.mjs`** is a real, working, read-only reconciliation CLI — but only for
  V2's receipt shape, a generation never deployed anywhere, Arc included.

## 12. Threat model summary

Full detail — 29 threat rows, 2 mandatory regressions, 49 evidence entries: [`THREAT-MODEL.md`](./THREAT-MODEL.md).

**Mandatory regressions (bind any Arc-side settlement shape, whatever it turns out to be):**

| | Status |
|---|---|
| **`WrongPayer`** | RAN and passed (`test_B5_refuses_the_wrong_payer_when_bound`) on the experimental generation; not yet in the live V1 executor; must be re-run under `arc-anvil` before any Arc executor holds more than testnet value |
| **Advisory 001** (payer witness does not bind the merchant half) | **OPEN, reproduced, not fixed**, Critical — affects undeployed `v2.0.0-rc1`. x402's `exact` authorization is narrower still and would reproduce the same failure one layer up (§7). Fix: hash the full EIP-712 quote digest into the payer's witness (owner decision, rc2) |

**Highest-severity identity/authorization threats (§3.1–3.2):** fake look-alike tokens (23
addresses share cirBTC's symbol — identity must be the (chain id, address) pair, never
name/symbol); native-sentinel aliasing (native vs. ERC-20 USDC never paired as two assets); wrong
chain/premature mainnet (disabled until a published RPC reads back `5042`); wrong decimals (18
native / 6 USDC-EURC / 8 cirBTC, never assumed); malicious/upgradeable tokens (every Arc token is
admin-upgradeable — admission must re-check both proxy-slot families, not just EIP-1967); issuer
freeze/blocklist (checked per-token, per-address, before quoting and before settling); allowance
theft (EIP-3009 preferred over standing `approve`; x402's Permit2 route is disabled on Arc);
merchant/payer substitution (Advisory 001 and `WrongPayer`, above).

**Pricing/liquidity (§3.3) reduces to one rule:** a same-asset USDC order carries none of these
rows; every conversion-leg market fails closed until a readable oracle and a measured
adequate-depth pool both exist for that pair.

**Economics and privacy (§3.7):** tiny-payment DoS (a $0.001 payment spends ~98% of itself on gas
at the floor — a minimum on-chain settlement amount per market is required); privacy leakage
(every USDC movement emits public `Transfer` logs; the opt-in confidential sector is unassessed,
E-43).

**Actors (§2):** payer, merchant, relayer, facilitator, RPC provider, Arc validators, token
issuer, CCTP attesters/Gateway enclave, and UNICA's Safe/pauser each carry an explicit
trusted-for/never-trusted-for boundary; every threat row is one actor reaching past its own column.

## 13. Test matrix summary

Full detail: [`THREAT-MODEL.md`](./THREAT-MODEL.md) §5, §8.

| Executed 2026-09-11, locally, offline, no RPC, no fork | Result |
|---|---|
| `forge test` — the six Advisory 001 rows (`test/v2/WitnessBinding.t.sol`) | 6 passed, 0 failed |
| `forge test` — WrongPayer, replay, reentrancy, fee-on-transfer, dust, chain id, decimals, Gateway-domain rows (17 names, 7 suites) | 17 passed, 0 failed |
| `forge test` — expiry, consumed-invoice, config binding, ceilings, pool/token mismatch rows (17 more names, 7 suites) | 17 passed, 0 failed |
| `node integrations/arc-treasury/test.mjs` | 177 checks run, 177 passed |
| **Totals** | **40 Solidity tests, 40 passed; 177 JS checks, 177 passed** |

| Status word | Rows | Meaning |
|---|---|---|
| RAN | 15 of 29 threat rows, plus both mandatory regressions | Exists, executed 2026-09-11, passed |
| LAB | 3 rows | Ran, but exercises a laboratory contract (`src/lab/`) nothing depends on |
| No executed test | 13 rows | Each names a PROPOSED or BLOCKED test |
| **Tests that ran on Arc's actual EVM** | **0** | Every run above used a standard local EVM, which Arc's own docs say cannot reproduce Arc-specific behavior — these runs prove UNICA's logic, not Arc compatibility |

**What the green does not show:** the two `KNOWN_DEFECT` Advisory 001 rows pass *because the defect
exists*. No test yet exercises an Arc-specific rule (blocklist reverts, CallFrom sender
preservation, the fee floor, the zOS proxy slots) — every such row is PROPOSED, to run under
`arc-anvil`, never plain `anvil`.

## 14. Deployment gates

Per the binding context (no real-value deployment without all of the following) and
[`COMPATIBILITY.md`](./COMPATIBILITY.md) §21–23, [`THREAT-MODEL.md`](./THREAT-MODEL.md) T25–T26:

| Gate | Status on Arc today |
|---|---|
| **Safe** | Deployable on testnet, confirmed (SafeL2/SafeProxyFactory 1.4.1 codehash-matched on-chain, E-42). Mainnet listing exists in Safe's registry but is not independently on-chain verifiable (no public mainnet RPC). No Safe is yet deployed for UNICA on any Arc chain — BLOCKED on the owner |
| **Pauser** | Not wired — no pause mechanism exists in the live V1 contracts or the experimental generation |
| **Caps** | Not built — no per-tx/per-day/total-at-risk field exists in any deployed contract; designed only in the unbuilt v4 draft (`SPEC-CONTRACTS.md` §9.2) |
| **Verified contracts** | Process confirmed for testnet (Blockscout via `arc-forge verify-contract`); nothing is deployed yet to verify; mainnet verification process UNKNOWN |
| **Authenticated pricing wherever conversion occurs** | No confirmed, on-chain-readable oracle for EURC/USD, cirBTC/USD, or any BTC-asset/USD on Arc (testnet or mainnet) — §6 |
| **Adequate liquidity** | No Uniswap v4 pool confirmed live on Arc, any chain id, any pair (§5) — nothing to measure depth against |
| **Simulations** | 40 Solidity + 177 JS tests green on a standard EVM; **zero** on Arc's actual EVM (§13) |
| **Independent human review** | Not performed for the Arc workstream |

**Every gate above is unmet today.** `UniswapDeployments.sol` and `hookmate`'s `AddressConstants`
both revert on chain `5042002` — a compilation-level blocker independent of any gate above.

## 15. Blockers and unknowns

Consolidated from every sibling file's own "still UNKNOWN" section; `THREAT-MODEL.md` §7 is the
authoritative, most-recent list where it overlaps with an earlier file.

| Unknown | Resolves via |
|---|---|
| Whether chain `5042` (mainnet) is live and what it holds — the claimed PoolManager, Chainlink feed proxies, Safe, any cirBTC (no public mainnet RPC; explorer login-gated) | An Arc-published mainnet RPC, then the same read-only checks already run on testnet |
| Whether "Uniswap v4" can be said of any Arc chain (deployments page omits Arc; a Uniswap repo lists a mainnet address, unconfirmed) | Uniswap's canonical page listing Arc, plus an on-chain read |
| Whether Arc's private mainnet is already running or still "Upcoming" (two Circle sources disagree, §2) | Not adjudicated as of 2026-09-11 |
| PUSH0/EIP-1153 on Arc (inferred from Osaka-baseline framing, no opcode probe run) | Deploy and call a minimal `TSTORE`/`PUSH0` contract on `rpc.testnet.arc.io` |
| Unit of `GatewayWallet.withdrawalDelay()` = 1209600 | Circle's Gateway documentation or verified source |
| Whether a blocklist revert leaves a receipt (Arc's own pages disagree) | An `arc-anvil` run against the seeded blocklisted address |
| Any Arc Testnet oracle for EURC/USD or a BTC asset (Chainlink lists none) | A provider's Arc-specific address page, then an on-chain read |
| cirBTC's Arc **mainnet** existence (no Circle page publishes one; testnet is confirmed, §3) | A Circle announcement plus an on-chain read once mainnet exists |
| USDC ERC-20 proxy's admin identity on testnet (only `eth_getCode`/`admin()` read) | Relevant before any admission logic trusts it |
| Whether any production x402 facilitator adds Arc before/at mainnet launch | A facilitator's own published network-support update |
| Whether the confidential sector (APS) changes the public-data privacy threat (T29) | A separate, dedicated review |
| Per-authorization Nanopayments fee, or any Arc relayer/paymaster premium (Gateway's 0.005% crosschain fee is the only confirmed figure) | Circle's pricing page, or a chosen facilitator's published terms |
| Whether UNICA's Model B/C choice triggers money-transmitter/e-money licensing anywhere | The project's own counsel — explicitly out of every sibling file's technical scope |

## 16. Gas/liquidity budget

Full detail: [`NANOPAYMENTS.md`](./NANOPAYMENTS.md) §2, §13; [`THREAT-MODEL.md`](./THREAT-MODEL.md)
E-37; [`LIQUIDITY-ORACLES.md`](./LIQUIDITY-ORACLES.md) summary table.

**Gas (measured live, 2026-09-11):**

| Item | Value |
|---|---|
| Base fee floor | 20 Gwei, silently enforced (sub-floor txs never appear in a block) |
| Measured `eth_gasPrice` | 22 Gwei (floor + 2 Gwei tip) |
| Native send | 21,000 gas (MEASURED, E-37) ≈ $0.00042 at the floor |
| USDC ERC-20 `transfer` | 49,097 gas (MEASURED, E-37) ≈ $0.000982 at the floor |
| EIP-3009 `transferWithAuthorization` | 80,000–100,000 gas (ESTIMATE — no funded signer used; midpoint 90,000 ≈ $0.0018–0.00198) |
| Break-even for Model A at a 5%-of-payment bar | ≈ **$0.04** per on-chain settlement |

**Liquidity (no funded signer needed — all reads are public):**

| Pair | Pool status | Verdict |
|---|---|---|
| USDC/USDC | No pool needed — one asset, two decimal precisions | Route natively; safe today |
| EURC/USDC | No Uniswap v4 pool confirmed on any Arc chain; Circle's StableFX (RFQ/PvP) exists but is not UNICA-callable | Fails closed |
| Any BTC-asset/USDC | No pool confirmed; asset identity itself unresolved for a market decision (cirBTC testnet-only) | Fails closed |

A v4 pool with zero starting liquidity is cheap to initialize but negligible depth is actively
dangerous — price becomes trivially manipulable before an oracle is even considered. **Do not
offer a pair whose only pool is one UNICA itself just seeded thinly.**

## 17. Phased plan

Each phase's gate must close before the next begins; no phase is started or authorized here.

**Phase 1 — read-only research. Done.** This directory, merged here, is Phase 1's complete output:
30–49 evidence entries per file, primary-sourced or read live from Arc's own keyless RPC, no
wallet balance read, nothing deployed.

**Phase 2 — local tests. Not started.** Write the PROPOSED Arc-fork rows named throughout
`THREAT-MODEL.md` §3 under `arc-anvil --network arc` (never plain `anvil`): `TokenAdmission.t.sol`,
`TokenPin.t.sol`, `ArcForkPin.sol` (pinning the CREATE2-factory codehash and USDC/EURC decimals
confirmed here), and a re-run of the WrongPayer/Advisory-001/replay/reentrancy suite against
Arc-specific addresses and the Arc-specific rules no test exercises today (blocklist reverts,
CallFrom sender preservation, the fee floor, the zOS proxy slots).

**Phase 3 — no-value testnet. Not started**, and explicitly not proposed to include any
transaction against a real Arc PoolManager, since no source lets this repo target one with
confidence (§5). Per `COMPATIBILITY.md` §17/§22: add the `5042002` chain branches, rewrite the
settlement-shape check, re-run hook-address mining, rehearse a full settlement inside an Arc fork
against hookmate's **official PoolManager bytecode** (never a guessed live address), and stop
there. Only once a PoolManager is confirmed on Arc testnet from an official source does the
rehearsal move from bytecode to a codehash-pinned live address.

**Phase 4 — capped private beta, after approval. Blocked** until every gate in §14 closes: Arc
mainnet publicly live with official RPC/explorer/addresses (post-2026-09-16, re-verified); a Safe
the owner controls, deployed and codehash-verified; a pauser able to halt and never unpause; caps
and merchant allowlist enforced on-chain (not merely decided); an authenticated, on-chain-readable
oracle for any conversion leg used; a measured adequate-depth pool for that leg; the full
simulation suite (§13) green under `arc-anvil` on Arc's actual EVM; and an independent human
security review. **No phase here authorizes deployment, signing, broadcast, or spend.**

## 18. Blockers and unknowns requiring owner approval — exact actions

Nothing in this workstream deploys, signs, broadcasts, funds, or publishes; the following are the
specific decisions and inputs only the owner can supply before Phase 2 or later proceeds:

1. **Rule on BTC-market scope.** cirBTC's testnet address is confirmed (§3), but the standing rule
   ("no unsupported BTC token") means it stays out of scope until the owner says otherwise.
2. **Supply or approve a Safe address and threshold for Arc**, testnet first, before any executor
   holds more than dust.
3. **Decide whether to fund a testnet signer** for a real `eth_estimateGas` measurement of
   `transferWithAuthorization`, replacing the current 80,000–100,000-gas ESTIMATE.
4. **Decide the collection-layer strategy**: a UNICA batching facilitator, Circle
   Gateway/Nanopayments (EOA-only, USDC-only, §8), or restrict Arc to payments above ≈$0.04.
5. **Approve or defer wiring x402** as a collection-only front end — no production facilitator
   lists Arc, and its only gasless route needs the Advisory 001 fix first (§7).
6. **Rule on the Advisory 001 fix** (bind the full quote digest into the payer's witness, rc2) and
   its rollout — a prerequisite for any Arc payer-bound flow.
7. **After 2026-09-16**, authorize a fresh verification pass of Arc mainnet's chain id/RPC/explorer
   and of the Uniswap v4 PoolManager address before any config names one.
8. **Authorize a direct question to Circle** to resolve the two Circle-vs-Circle contradictions
   found: private-mainnet status, and cirBTC's mainnet-availability messaging.
9. **Sign off on the Phase 3 no-value testnet plan** (§17) before any testnet transaction, even at
   zero value.
10. **Commission the independent human security review** required before any capped private beta,
    once every other Phase 4 gate in §14 is met.
