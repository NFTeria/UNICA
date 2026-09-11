# Arc workstream — deployment gates

Read-only research, local simulation and planning. **Nothing in this file deploys, signs,
broadcasts, approves, funds, bridges, swaps, wraps, creates a pool, adds liquidity, pushes or
publishes anything, and nothing here asks anyone to.** It is a gate document: it states what must
be true before each phase opens, cites where that was already established, and lists what still
needs the owner's own decision.

**Scope.** This file governs the Arc workstream only (chain id `5042002` testnet, `5042` mainnet
per `THREAT-MODEL.md` E-48). It does not alter, and is not read as superseding, the primary
release's own gates in `docs/unica-v4/DEPLOYMENT-GATES.md`, whose §10 already gates a different
chain decision (Q9 recommends Arbitrum One, `docs/unica-v4/DECISIONS.md`). Arc remains "an
additional workstream" under the standing sponsor order (THREAT-MODEL.md, binding context). No
UNICA contract is deployed on any Arc chain id as of this writing.

**Binding context**, unchanged from the sibling files in this directory: UNICA v4 is the UNICA
release, Uniswap v4 is the AMM. Payer-bound orders only, `WrongPayer` preserved. Advisory 001
(`docs/v2/SECURITY-ADVISORY-001.md`) is a mandatory regression. The UNICA fee is 0 in the beta. No
real tokenized equities; no unsupported BTC token. A same-asset USDC payment is never forced
through a swap. No real-value deployment without a Safe, a pauser, caps, verified contracts,
authenticated pricing wherever conversion occurs, adequate liquidity, simulations and an
independent human review.

## 0. Evidence and citation convention

This file re-derives nothing. Every Arc fact below is cited to the sibling file that established
it as of 2026-09-11 — `NETWORK.md`, `TOKENS.md`, `COMPATIBILITY.md`, `LIQUIDITY-ORACLES.md`, `X402.md`,
`NANOPAYMENTS.md`, `THREAT-MODEL.md` (evidence ids `E-01`…`E-48`), `PRODUCT-FLOWS.md` — plus the
primary chain's own measured deployment costs in `docs/unica-v4/DEPLOYMENT-GATES.md` §4–§7 and the
standing decisions in `docs/unica-v4/DECISIONS.md`. Where this file computes something new (a gas
budget, a gate id), that arithmetic is shown inline and labeled **ESTIMATE**. Nothing here
contradicts a sibling file; where a number is scaled or converted, the source figure and the
conversion are both shown.

## 1. The four phases, at a glance

| Phase | What it is | Status today (2026-09-11) |
|---|---|---|
| 1 — Read-only verification | Confirm chain id, token identity, contract presence, oracle and rail availability from primary sources and keyless on-chain reads. No code, no tests, no transactions. | **DONE for testnet; NOT DONE and NOT POSSIBLE for mainnet** — §2 |
| 2 — Local tests and simulations | UNICA's own logic proven on a standard EVM (done, elsewhere); Arc-specific semantics proven under `arc-anvil` or a fork of `5042002` (not started). | **PARTIAL** — 0 tests have run on Arc's own EVM (THREAT-MODEL.md §5, §8) — §3 |
| 3 — No-value Arc testnet deployment | Contracts deployed to `5042002` only, funded only by Circle's faucet, value at risk $0 by construction. | **BLOCKED** — 5 named blockers, §4 |
| 4 — Capped private beta | The first deployment carrying any real value, on Arc mainnet, capped, invited-merchant-only. | **NOT OPEN** — every precondition is NOT MET or OPEN, §5 |

A phase does not open until the one before it is DONE. Phase 4 additionally needs a **separate,
explicit owner approval** beyond every gate closing — the same pattern `docs/unica-v4/DECISIONS.md`
item 132 already applies to any no-value mainnet infrastructure ("Unanswered, so nothing is
deployed on mainnet").

## 2. Phase 1 — read-only verification

**Exit criteria, testnet (`5042002`).** All met, as of 2026-09-11:

- Chain id confirmed by a keyless RPC read (`eth_chainId` = `5042002`, agreeing across four
  docs-listed endpoints, THREAT-MODEL.md E-01).
- Token identity pinned to (chain id, address), never a ticker: USDC ERC-20 interface
  `0x3600000000000000000000000000000000000000` (address, THREAT-MODEL.md E-09), EURC
  `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` (address, E-11), cirBTC
  `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` (address, E-17) — each read on-chain for `decimals()`,
  `symbol()`, pause and blocklist state (E-13, E-16, E-18).
- Uniswap v4 PoolManager status established: **none found on testnet, from any source**
  (COMPATIBILITY.md §3.4); a mainnet address is claimed only by a non-canonical Uniswap-owned
  playbook document and is unconfirmed (THREAT-MODEL.md E-05, E-08).
- Oracle status established: no Chainlink feed on testnet (E-34); an "Arc Mainnet" directory entry
  with 30 feeds exists but none is on-chain readable yet, no public mainnet RPC existing (E-33,
  E-04).
- Safe deployability confirmed on testnet by codehash match against `safe-deployments` (E-42).
- x402 and Circle Nanopayments surfaces checked: the canonical x402 Permit2 proxy has no code on
  Arc testnet (E-22); Nanopayments' own GatewayWallet, MessageTransmitterV2 and CCTP domain id 26
  are all live (E-30, E-31).
- Faucet confirmed live and Arc-aware for USDC and EURC (`https://faucet.circle.com`, NETWORK.md
  §5, §8).

**Exit criteria, mainnet (`5042`).** **Not met, and not meetable today.** `docs.arc.io` itself
states mainnet addresses and endpoints "are not yet available" (THREAT-MODEL.md E-02); Circle's own
pressroom gives a public-launch target of 2026-09-16 (E-03) — five days after the 2026-09-11 retrieval
date; the mainnet explorer redirects to a Circle-internal login (E-04). No fact about mainnet in
any sibling file was read from the chain; every mainnet number (chain id 5042, a claimed
PoolManager, the Chainlink feed list) is asserted by a document, not confirmed by a keyless RPC read
(E-48, E-05, E-33). Phase 1 for mainnet reopens only when `docs.arc.io` itself publishes a mainnet
RPC and address list.

**Standing re-check rule.** Every testnet contract read in Phase 1 is admin-upgradeable (USDC,
EURC and cirBTC all sit behind legacy zOS proxies with live pause and blocklist roles — E-12, E-13,
E-18; GatewayWallet and MessageTransmitterV2 are EIP-1967 proxies — E-30, E-31). A Phase 1 read is a
snapshot, not a permanent fact. Before Phase 3 opens, and again before Phase 4 opens, the
implementation and admin slots of every token and rail contract in use are re-read and compared
against the values recorded here; a mismatch pauses that gate until a human re-admits the token
(mirrors THREAT-MODEL.md T05).

## 3. Phase 2 — local tests and simulations

**What is already DONE, on a standard EVM, not Arc's.** 40 Solidity tests and 177 JavaScript checks
covering payer binding, replay, reentrancy, fee-on-transfer, dust, caps mechanics and Advisory 001's
characterization rows ran locally on 2026-09-11 with no RPC and no fork, all passing
(THREAT-MODEL.md §5). This proves UNICA's own logic. It proves nothing about Arc, because Arc's own
documentation states plain local EVMs "can't reproduce Arc-specific behavior" (E-41) — a plain
`anvil` run is not evidence for this phase.

**What Phase 2 actually requires and has not started.** Zero tests have run on Arc's own EVM
(THREAT-MODEL.md §8, "Tests that run on Arc's EVM today | 0"). Every row below runs under
`arc-anvil --network arc` or a pinned read-only fork of `5042002` — never plain `anvil` — per
COMPATIBILITY.md §19's own fork/simulation plan:

| # | Test file (new) | Proves | Source of the requirement |
|---|---|---|---|
| 1 | `test/fork/ArcForkPin.sol` | Pins chain id `5042002` and a block; asserts the CREATE2 factory's codehash `0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989` (label: CREATE2 factory codehash) and `decimals()==6` for USDC and EURC | COMPATIBILITY.md §19.1 |
| 2 | `test/compat/ArcSettlementShapeCompat.t.sol` | The rewritten no-native-asset settlement-shape check (§4 item 3 below) accepts a USDC/EURC pool and rejects everything else | COMPATIBILITY.md §19.2 |
| 3 | `test/arc/TokenAdmission.t.sol` | Refuses the look-alike cirBTC tokens named in THREAT-MODEL.md E-20 while admitting Circle's own address; refuses any BTC-market flag while off | THREAT-MODEL.md T01 |
| 4 | `test/arc/TokenPin.t.sol` | Reads both the zOS slots and the (empty) EIP-1967 slots; classifies USDC, EURC and cirBTC upgradeable; a simulated implementation change refuses admission | THREAT-MODEL.md T05 |
| 5 | Blocklist-revert fork row, using Arc's own seeded test address `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` (label: blocklisted test address) as payer, then as recipient | Settlement refuses before any transfer; resolves whether a receipt exists when the blocklist reverts (E-38 vs E-39 disagree) | THREAT-MODEL.md T06 |
| 6 | Reentrancy suite (4 existing rows) re-run unmodified | The same reentrancy guards hold under Arc's EVM | THREAT-MODEL.md T18 |
| 7 | Ethereum-assumption suite: value to `address(0)`, `SELFDESTRUCT`, `PREVRANDAO`, non-strict timestamps; plus a grep gate failing on `PREVRANDAO`/`block.difficulty`/`selfdestruct` in any Arc source | Arc's documented EVM deviations are handled, not assumed away | THREAT-MODEL.md T19, E-38 |
| 8 | Fee-floor / silent-drop relayer test | A transaction under the 20 Gwei floor lands in UNKNOWN, never in failed-and-retried | THREAT-MODEL.md T20, E-36 |
| 9 | Dual-RPC comparator | Refuses on a mismatched block hash between two independent Arc RPC providers | THREAT-MODEL.md T22 |
| 10 | CCTP finality-threshold receiver test | Refuses to credit an inbound message below `finalityThresholdExecuted` 2000 | THREAT-MODEL.md T23, T24, E-32 |
| 11 | Pause drill on an Arc fork | Pauser pauses; pauser cannot unpause; only the Safe unpauses | THREAT-MODEL.md T25 |

**Explicitly BLOCKED, not merely PROPOSED.** Any test against a live Uniswap v4 PoolManager address
on Arc — COMPATIBILITY.md §19.3 refuses this by name, because no source lets this repository target
a PoolManager address on Arc with confidence (§3.4 there). The substitute is hookmate's official
PoolManager *bytecode* deployed inside the fork (§19.4), never a guessed live address; if the owner
later supplies a better-sourced address, it is pinned by codehash like every other dependency in
`ForkPin.sol`, not hard-coded as a bare constant.

**Exit criteria.** Every row in the table above exists as a file, runs green under `arc-anvil` or a
`5042002` fork, and — per this repository's own instrument-validation rule — was first proven to
fail against a sabotaged input before its green is trusted. A row that has never been made to fail
is not a passing test; it is an unvalidated instrument. Phase 2 is not exited while any row above
stays a plan on paper rather than a file that ran.

## 4. Phase 3 — no-value Arc testnet deployment

**Preconditions.** Phase 1 DONE for testnet (§2) and Phase 2's full fork suite green with zero
skips (§3). Neither is true today.

**Hard blockers, from COMPATIBILITY.md §21, reproduced here because this file gates on them:**

1. No confirmed Uniswap v4 PoolManager on Arc testnet, from any source — a hard blocker for any
   settlement that requires a real swap.
2. `UniswapDeployments.sol` (this repo) and `hookmate`'s pinned `AddressConstants.sol` both
   `revert UnsupportedChainId(chainId)` for `5042002` today — a compilation-level blocker,
   independent of (1).
3. The live settlement-shape check assumes `currency0 == address(0)` means native ETH. Arc has no
   native ETH: its native gas asset is USDC itself, at 18 decimals, sharing one balance with the
   6-decimal ERC-20 view (E-10). Deploying the check unrewritten would silently define a
   nonsensical native-USDC-vs-ERC20-USDC pool shape (THREAT-MODEL.md T02).
4. No Arc-specific fork test exists yet to catch (1)–(3) before a real transaction — this is
   exactly Phase 2's unstarted work (§3).
5. No merchant allowlist, caps, or pause/RETIRED machinery exists in any deployed UNICA generation
   today (PRODUCT-FLOWS.md §0) — independent of Arc, but binding on any deploy per
   `docs/unica-v4/DECISIONS.md` items 5–7, 31, 65.

**Two tracks, not one.** The binding context rule that "a same-asset USDC payment is never forced
through a swap" means a testnet deployment does not strictly need blockers (1)–(2) resolved if it
only ever settles USDC for USDC. But no deployed UNICA generation has a no-swap settlement path
today — every generation in `PRODUCT-FLOWS.md` §0 hardcodes one asset pair through one pool; the
no-swap `MarketConfig` design exists only in the unbuilt v4 draft (`docs/unica-v4/SPEC-CONTRACTS.md`
§9.2, self-labeled "draft… not committed, authorising nothing"). This file therefore names two
tracks rather than assuming Track S is free:

| Track | Shape | Blocked on |
|---|---|---|
| **S — same-asset USDC, no swap** | A payer-bound order paid and settled in USDC only, no PoolManager involved | Writing the no-swap settlement path itself (currently unbuilt in any generation) — an engineering task, not an Arc-fact gap |
| **W — any real swap** (e.g. USDC/EURC) | A payer-bound order that converts through a pool | Blockers (1)–(3) above, **and** `LIQUIDITY-ORACLES.md`'s own rule that EURC/USDC and any BTC-asset/USDC market "fail closed and stay disabled" for lack of a confirmed oracle and adequate liquidity |

Track W does not open on testnet until a PoolManager is confirmed by an independent on-chain read
**and** an oracle route is proven on a fork **and** liquidity depth is measured immediately before
quoting (THREAT-MODEL.md T14–T16) — the same discipline the primary chain's own mainnet gate M11
already applies (`docs/unica-v4/DEPLOYMENT-GATES.md` §10.1).

**Required code changes before either track compiles for Arc** (COMPATIBILITY.md §17):

1. Add `5042002` (and, once confirmed, `5042`) branches to `UniswapDeployments.sol`'s
   `universalRouter()` and `payoutCurrency()`.
2. Resolve the `hookmate` `AddressConstants` gap by reading the PoolManager address from this
   repo's own `config/chains/` file rather than routing Arc through the pinned submodule — safer
   than waiting on an upstream release against a deadline (COMPATIBILITY.md §17 item 2).
3. Write the no-native-asset settlement-shape check (blocker 3 above), proven by test #2 in §3.

**Deployment sequence, once Track S compiles and Phase 2 is green.** Same stage shape as the
primary chain's own plan — infra (factory + registry), one demonstration market, seed only if a
pool is used, one payer-bound settlement, source verification, broadcast records committed
(`docs/unica-v4/DEPLOYMENT-GATES.md` §4–§9) — with three Arc-specific additions ahead of every SEND:
the chain-id assertion (`5042002`), the zOS-slot admission re-check (§2's standing re-check rule),
and the blocklist check on payer, recipient and executor (THREAT-MODEL.md T06). Source verification
uses `--verifier blockscout` against `testnet.arcscan.app`, not an Etherscan-style key
(COMPATIBILITY.md §13). No Track W transaction — no real swap — is proposed by this file on testnet,
matching COMPATIBILITY.md §22's own conclusion.

**Value at risk: $0, by construction, through the whole of Phase 3.** Every token used is
faucet-issued Arc Testnet USDC, EURC or (if the BTC-market flag is ever exercised for a test, never
for a real market) cirBTC — testnet cirBTC is stated by Circle itself to be "not backed by real
Bitcoin" (E-17), and testnet USDC/EURC carry no real value on a public testnet by nature. Funding
comes only from `https://faucet.circle.com` (confirmed Arc-aware, NETWORK.md §5, §8). No mainnet
address, RPC, key or contract is touched anywhere in Phase 3.

## 5. Phase 4 — capped private beta

**Phase 4 does not open on Phase 3 completion alone.** It additionally needs a separate, explicit
owner approval naming Arc specifically, distinct from any approval already given for the primary
chain's own Q9 decision. As of retrieval, `docs/unica-v4/DECISIONS.md` item 132 records this exact
class of question as unanswered for mainnet infrastructure generally; nothing below changes that.

**Gates, every one required, modeled on the primary chain's own §10.1 gate table
(`docs/unica-v4/DEPLOYMENT-GATES.md`):**

| Gate | Evidence that closes it | State today |
|---|---|---|
| G-ARC1 Arc mainnet actually public | `docs.arc.io` itself publishes a mainnet RPC and contract-address page, replacing "not yet available" | NOT MET, BLOCKER. Targeted 2026-09-16 (E-03); Circle's own pages disagree on whether private mainnet is already running (THREAT-MODEL.md section 6 correction) |
| G-ARC2 Mainnet chain id read back | `eth_chainId` against an official mainnet RPC returns 5042 | NOT MET, BLOCKER. 5042 is stated only by Circle's own `arc-node` repository (E-48); no public RPC exists to confirm it |
| G-ARC3 Uniswap v4 PoolManager confirmed | `developers.uniswap.org`'s canonical deployments page, not a playbook document, lists Arc, and `eth_getCode` against the address it names returns nonzero code | NOT MET, BLOCKER. Today's only claim is an unconfirmed Uniswap-owned GitHub playbook naming PoolManager address `0x8366a39cc670b4001a1121b8f6a443a643e40951` (E-05, E-08); the canonical page lists no Arc chain at all (E-06) |
| G-ARC4 Safe on mainnet verified | Chain, address, signers, threshold and hardware-wallet control verified; one test transaction executed | NOT READY, BLOCKER (`docs/unica-v4/DECISIONS.md` item 64). Testnet half passes by codehash match (COMPATIBILITY.md section 12, E-42); mainnet half is unverifiable without G-ARC2 |
| G-ARC5 Pauser wired | Separate PAUSER role assigned; pause rehearsed on a fork; only the Safe unpauses | NOT READY, BLOCKER (`DECISIONS.md` item 70) |
| G-ARC6 Legal review | Counsel's review of jurisdiction and asset scope for this beta | NO CONFIRMED REVIEW, BLOCKER (`DECISIONS.md` item 20); crypto assets only, no tokenized equities (recs 15, 21) |
| G-ARC7 Merchant terms and allowlist | Terms ready; invited or founder-controlled merchants only | NOT READY, BLOCKER for terms (`DECISIONS.md` item 108); allowlist-only is already the standing rule (items 31, 35) |
| G-ARC8 Oracle route, only if any non-USDC leg is ever offered | A Chainlink Arc Mainnet feed proxy (E-33) read on-chain: `answer` above zero, `updatedAt` within the market's `maxAge`, and the market's slippage band set above the feed's own 0.5% deviation threshold | NOT MET. No feed has been read on-chain; the explorer that would let anyone check is login-gated (E-04) |
| G-ARC9 Liquidity depth, only if any swap is ever offered | Measured immediately before quoting, from a pool that is not itself UNICA-seeded | NOT MET, no verifiable Arc pool exists for any non-USDC-USDC pair (`LIQUIDITY-ORACLES.md`) |
| G-ARC10 Caps decided for Arc specifically | A per-transaction, per-day and total-at-risk figure set for this workstream by the owner | OPEN. The $10 / $25 / $100 pattern in `DECISIONS.md` items 5 to 7 was set for the Q9 chain decision (Arbitrum candidate), not for Arc; reusing those numbers here is a separate decision, not yet made |
| G-ARC11 Phase 3 complete | Full deploy-seed-settle cycle done on testnet, every readback row 0 failed | NOT MET, Phase 3 has not opened (section 4) |
| G-ARC12 Separate Arc approval | The owner's written go-ahead naming Arc, distinct from any approval already given elsewhere | NOT GIVEN |

**State snapshot.** Every gate above is NOT MET or OPEN as of 2026-09-11. None is closed. Only
same-asset USDC settlement is even conceivable once G-ARC1 through G-ARC7 and G-ARC10 through
G-ARC12 close; G-ARC8 and G-ARC9 gate any additional asset and stay closed until an oracle and a
pool are independently confirmed — which today means EURC/USDC and any BTC-asset/USDC market are
excluded from Phase 4 by construction, not by a temporary gap (`LIQUIDITY-ORACLES.md`'s own
fail-closed conclusion).

**If every gate above eventually closes**, the sequence mirrors the primary chain's own section
10.2: `requireOracle` true only for a market that clears G-ARC8, `transferAdmin` to the verified
Safe before any market leaves SEEDED, the Safe, never an automated signer, signing every value-moving step,
and one capped real-value settlement sent only if every gate is still green at the moment of that
SEND. The same launch-abort conditions apply unchanged
(`docs/unica-v4/DEPLOYMENT-GATES.md` section 10.3): a gate not green at SEND time, an RPC reporting
an unexpected chain id or missing code, a failed readback row, a stale or unavailable oracle read,
a deviation outside the market's band, a changed implementation behind any pinned proxy, a Safe
that cannot execute, gas exceeding budget, or a public claim that would outrun its evidence.

## 6. Gas and liquidity budget

All figures below are **ESTIMATE**, never a live-broadcast measurement — this workstream is
read-only. Each ESTIMATE states the number it was scaled from and the conversion applied, so the
arithmetic can be checked or corrected without re-deriving it from nothing.

**Phase 3 gas budget (testnet, no-value).** Arc's own gas token is USDC itself, at a fixed
1:1 USD peg (E-10), so a gas cost converts to a USD figure directly with no separate price oracle
(NANOPAYMENTS.md). This repository has not yet deployed anything on Arc, so no Arc-measured
deployment-gas number exists; the basis instead is this repository's *own* measured deployment of
the same shape of contracts (factory, registry, hook, executor) on the primary chain's testnet
(46630), scaled the same way `docs/unica-v4/DEPLOYMENT-GATES.md` §4–§7 already scales it for its
own larger build, converted at Arc's measured gas price:

| Stage | Gas, ESTIMATE (scaled from `docs/unica-v4/DEPLOYMENT-GATES.md`) | Cost at Arc's 20 Gwei floor | Cost at Arc's measured 22 Gwei |
|---|---|---|---|
| A — factory + registry (CREATE2) | 7.8M–8.8M (§4 there; prototype measured 6,090,352 plus 12,773 CREATE2 overhead, scaled for this build's larger contracts) | $0.156–$0.176 | $0.172–$0.194 |
| B — one demonstration market (hook + executor CREATE2) | 7.3M–8.1M (§5 there; prototype measured 6,194,189, scaled the same way) | $0.146–$0.162 | $0.161–$0.178 |
| C — initialize, seed, activate (up to 7 tx) | 0.8M–0.9M (§6 there, as measured) | $0.016–$0.018 | $0.018–$0.020 |
| D — one payer-bound settlement (3 tx) | 0.7M–0.8M (§7 there, as measured: 254,497 + 68,294 + 353,792 = 676,583 raw) | $0.014–$0.016 | $0.015–$0.018 |
| **Total, one full A+B+C+D cycle** | **16.6M–18.6M** | **$0.33–$0.37** | **$0.37–$0.41** |

One conversion applied to every row above: cost in USD equals gas units times the gas price in
Gwei times 1e-9 — the same identity THREAT-MODEL.md E-37 uses (49,097 gas at the 20 Gwei floor =
$0.000982, matching this formula exactly). **One difference from the source figures**: the primary
chain's own stages separately book an L1 data fee on top of "L2 gas," because 46630 sits on a
rollup stack; Arc is confirmed a standalone Layer-1 (NETWORK.md keyFindings), so no analogous
second fee layer applies here, and this table's totals do not add one. **What could move this
number**: the actual Arc-targeted contracts will differ in size once the code changes in §4 are
written (a new settlement-shape check, new chain branches) — this table is a planning budget, not
a quote, and is replaced by the deploy script's own simulated figure before any real SEND, exactly
as the primary chain's own plan already requires (`docs/unica-v4/DEPLOYMENT-GATES.md` §3).

**Per-payment settlement cost, Arc-measured directly (not scaled).** A bare ERC-20 USDC transfer on
Arc testnet costs 49,097 gas, measured live by `eth_estimateGas` (THREAT-MODEL.md E-37) — $0.00098
at the 20 Gwei floor, $0.00108 at 22 Gwei. A full EIP-3009 `transferWithAuthorization` call is
ESTIMATE 80,000–100,000 gas, midpoint 90,000 (NANOPAYMENTS.md §4) — $0.0018 at the floor, $0.00198
at 22 Gwei. UNICA's own `pay()` call is closer to stage D's measured 353,792 gas, because it also
updates order state and (once built) caps accounting, not a bare transfer. **Nanopayment economics
consequence, already established and not re-derived here**: below roughly $0.04 per payment, an
on-chain settlement's gas cost exceeds a 5% fee bar (NANOPAYMENTS.md §13); a merchant bearing gas on
a $0.001 payment loses money on every single one. This is why Phase 4, if it ever offers per-call
micropayments rather than ordinary checkout amounts, needs a batching design (Circle Nanopayments,
or an equivalent), not per-payment Model A settlement — a decision this file does not make.

**Liquidity budget, Phase 3.** $0. Track S needs no pool. Track W is not open on testnet (§4).

**Liquidity budget, Phase 4.** Not decided for Arc. The only existing UNICA precedent is
`docs/unica-v4/DECISIONS.md` item 14 — "Liquidity from a founder-controlled Safe, $100 maximum" —
set for the Q9 chain decision, not Arc. If Phase 4 ever offers only same-asset USDC, no pool and no
liquidity budget applies at all (no swap, no LP). If Phase 4 ever offers a conversion leg
(EURC/USDC or a BTC asset), G-ARC8 and G-ARC9 must both close first, and only then does a liquidity
figure become decidable — the amount itself is an owner decision this file does not set, both
because no confirmed pool exists to size against and because DECISIONS.md's own liquidity precedent
was never written for Arc specifically.

## 7. Exact list of actions requiring the owner's approval

Nothing in this list is performed by this file, by the research that produced it, or by any
sibling document in this directory. Every row is an action a human — the owner — takes, or
explicitly authorizes in writing, before it happens.

1. **Opening Phase 3 at all** — the first transaction sent to Arc testnet, even though value at
   risk is $0 by construction (§4). This repository's own convention (`docs/experimental/STOCK-46630-DEPLOY-PLAN.md`;
   `docs/unica-v4/DEPLOYMENT-GATES.md` §2.2) is that a human runs every SEND through the committed
   wrapper after reviewing its printed plan block — nothing automated broadcasts on the owner's behalf.
2. **Funding any Arc testnet deployer address**, even with faucet-issued, no-value testnet USDC —
   claiming faucet tokens is itself an account action at `https://faucet.circle.com`.
3. **Selecting and paying for an Arc RPC provider**, if the keyless public endpoint proves
   insufficient for Phase 3 or Phase 4 (mirrors the primary chain's own unresolved gate M6/M7,
   `docs/unica-v4/DEPLOYMENT-GATES.md` §10.1).
4. **Adopting Arc-specific caps** (G-ARC10) — whether to reuse the $10/$25/$100 pattern from
   `DECISIONS.md` items 5–7 or set different figures for this workstream.
5. **Deploying or designating a Safe on Arc mainnet** as ADMIN, and verifying its chain, address,
   signers, threshold and hardware-wallet control (G-ARC4).
6. **Assigning a PAUSER address on Arc**, separate from the Safe, and rehearsing the pause-only /
   Safe-unpauses rule (G-ARC5).
7. **Commissioning and confirming a legal review** of the beta's jurisdiction and asset scope
   before any Arc mainnet activity (G-ARC6).
8. **Approving merchant terms and the specific invited-merchant allowlist** for an Arc beta
   (G-ARC7).
9. **Deciding whether to offer any non-USDC leg at all** (EURC/USDC or a BTC-asset/USDC market) on
   Arc, which starts the separate oracle- and liquidity-confirmation work in G-ARC8/G-ARC9 —
   `LIQUIDITY-ORACLES.md`'s own recommendation is that both stay disabled today.
10. **Setting any liquidity figure**, once a conversion leg is approved and its oracle and pool are
    independently confirmed (§6).
11. **The separate, explicit "yes" for Arc specifically** (G-ARC12) — Phase 4 does not open on
    gate closure alone (§5).
12. **Re-checking and re-authorizing this whole plan after 2026-09-16** — the date Circle's own
    pressroom names for Arc's public mainnet launch (E-03) — before treating any fact in this file
    or its siblings as still current, because every testnet contract read here is itself
    admin-upgradeable (§2's standing re-check rule).
13. Everything the standing operating rules already name as never performed automatically,
    regardless of instruction: deploying, broadcasting, signing, approving, transferring,
    swapping, bridging, wrapping, funding, creating a pool, adding liquidity, pushing, merging, or
    publishing.

## 8. What this file does not do

It does not re-derive any Arc fact — every citation above points to the sibling file or the
primary chain's own gate document that established it. It does not propose a Track W testnet
transaction (COMPATIBILITY.md §22 already closes that door until a PoolManager is independently
confirmed). It does not set Arc-specific caps or a liquidity figure — those are owner decisions
listed in §7, not findings. It does not treat the Robinhood-testnet gas figures in §6 as an Arc
measurement — they are a scaled planning budget, explicitly labeled, replaced by the deploy
script's own simulation before any real transaction. It does not open Phase 4 on any basis short of
every gate in §5 closing and a separate, explicit approval naming Arc.

## 9. Summary

| | |
|---|---|
| Phase 1 (read-only verification) | DONE for testnet; not done and not currently possible for mainnet |
| Phase 2 (local tests, simulations) | UNICA's own logic proven (40 Solidity + 177 JS, elsewhere); 0 tests run on Arc's own EVM; 11 named rows to write (§3) |
| Phase 3 (no-value testnet deployment) | BLOCKED on 5 named items (§4); Track S (same-asset USDC) blocked on an unbuilt no-swap settlement path; Track W (any swap) blocked on PoolManager confirmation, oracle and liquidity |
| Phase 4 (capped private beta) | 12 gates, every one NOT MET or OPEN (§5); needs a separate owner approval beyond gate closure |
| Gas budget, Phase 3 | ESTIMATE $0.33–$0.41 for one full deploy-seed-settle cycle, scaled from this repo's own measured figures, in faucet-issued testnet USDC |
| Liquidity budget, Phase 3 | $0 |
| Liquidity budget, Phase 4 | Not decided for Arc; contingent on G-ARC8/G-ARC9 closing first |
| Owner-approval actions | 13, listed in §7, none yet given |

**Net position.** The Arc workstream has completed its read-only pass and has a real, if unstarted,
plan for local Arc-specific testing. It has not written a single line of Arc-targeting Solidity, run
a single test on Arc's own EVM, or sent a single transaction to any Arc chain. Every number in this
file that looks like a cost is a scaled estimate from a different chain, labeled as such. Every gate
that looks close to closing is not: mainnet itself is not yet public, a PoolManager is unconfirmed,
an oracle is unread, and no liquidity is measured. Nothing here authorizes moving past that.
