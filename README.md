# UNICA

**UNICA is an MIT-licensed settlement hook and modular integration layer for Uniswap v4,
designed for applications and sponsor ecosystems to extend.** A payer pays in one currency, a
recipient receives another, atomically, through Uniswap's official Universal Router, into a pool
whose hook admits a swap only on that path and only for a registered order, with a versioned
receipt event. UNICA composes Uniswap v4 hooks and official execution infrastructure into a
verifiable settlement flow with enforceable order invariants and indexable receipts. Built from
scratch during ETHOnline 2026 by **NFTeria**.

> ### Built on Uniswap v4 · ENSv2 on Sepolia · The Graph
>
> ### Live right now
>
> | | |
> |---|---|
> | **App** | **https://nfteria.github.io/UNICA/** |
> | **V1 settled swap** | [`0x1120af18…cb83`](https://sepolia.etherscan.io/tx/0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83) — 0.001 ETH in, 2.003660 USDC out |
> | **V3 settled swap** | [`0x4f4acbd1…8854`](https://sepolia.etherscan.io/tx/0x4f4acbd1b1ed07eccbcf0d7c6f6fcb23a397b619dd3a1dd7fcf7ed7456768854) — 0.001 ETH in, **2.216294 USDC** out, `receiptCount` 1 |
> | **Subgraph** | `https://api.studio.thegraph.com/query/1755384/unica-settlements/v2-39b6f91` — synced, indexes **both** hooks, returns both receipts |
> | **ENSv2** | `unica.eth` on **Sepolia**, delegation broadcast in 12 transactions, all `status 1` |
> | **The scope, provable** | `node integrations/ensv2/agent.mjs` — 6 rows, 5 of them refusals |
>
> Testnet only. Detail and what is **not** claimed: [What changed on 2026-09-09](#what-changed-on-2026-09-09--appended-not-rewritten).

**The name.** *Unica* is Latin for *one of a kind*. It is the name, and it is meant as one — not
as a claim about the software. Nothing in this repository asserts that UNICA is the first or the
only anything; where prior art exists it is named in [`docs/PRIOR-ART.md`](docs/PRIOR-ART.md) and
in the specification, and every capability below is stated at the rung it has actually reached.

**Who made this, and for whom.** UNICA is built and maintained by **NFTeria** for the Uniswap v4
ecosystem and for the sponsor programmes named below. **The three submitted integrations are
Uniswap v4, ENSv2 on Sepolia and The Graph.** Work touching Chainlink and Circle is in the tree,
labelled at the rung it reached, and is **not part of the submitted integration**. It is offered to those teams and to anyone else as MIT-licensed work they are free to read,
run, fork and extend. **NFTeria is an independent builder: UNICA is not commissioned, affiliated
with, endorsed by, or reviewed by Uniswap or by any sponsor named here.** Where their tools are
used, they are used as published, at pinned versions, and every claim about them is testable from
this repository.

> The specification and threat model were written before the event; every line of code was
> written during it. Both pre-event documents ship unedited in [`specs/`](specs/README.md).
> Some Vyper contracts are carried-in prior art rather than work authored here, and
> [`docs/PRIOR-ART.md`](docs/PRIOR-ART.md) says which.

## UNICA v5 — live on five public test networks (2026-09-13) (every value read from the recorded configs and manifests)

| Network | Market | Market id | Identity (ENSv2) | Shop |
|---|---|---|---|---|
| Ethereum Sepolia (11155111) | ACTIVE, verified | market id `0x99f138caff24fe5dbe437093bac3bf66b2605e7940887fa648e5409dddaefb93` | yes | catalogue `0xEf837110e2A60B4940E57570E5AD05f39d8C398A`, settler `0x14a95db5463d27a97DF464001ec65d5DADffC88e` |
| Base Sepolia (84532) | ACTIVE, verified | market id `0xc620eff48202f9439a04206b2955c6abd26bfb66a5b73f1e0b7d41f4ad03e682` | no | not deployed |
| Arbitrum Sepolia (421614) | ACTIVE, verified | market id `0x347ef2afeff0218f9e4d23f205a3772f063f358e72db69225481753c329acbc7` | no | not deployed |
| Unichain Sepolia (1301) | ACTIVE, verified | market id `0x865fe38970e04183c900768131ccb9ad451b042068695aeb8697478fea7c4ff2` | no | not deployed |
| Robinhood Chain testnet (46630) | ACTIVE, verified | market id `0x4c968c48e90f58a8994e40590df132568f3a7ee5991fbcf84714fa4c4008639a` | no | not deployed |

The product: a business logs in with its wallet (EIP-6963: Coinbase Wallet, MetaMask, any injected wallet), sees its business,
lists what it sells (one-off, recurring, permanent) into an on-chain catalogue, hands out a link and a QR per product and a shop page at
its own name (`/shop/?name=<label>`), charges a walk-in customer from the register, and every payment ends in a receipt that reads
"Paid" only after the evidence rules verified it on chain. Same-asset sales settle directly; a different asset converts on Uniswap v4
through the registered hook. On Ethereum Sepolia the business `freshcuts.unica.eth` is live under ENSv2 (records, registers, lineage)
and the shop contracts are deployed and source-verified. Run it against any network above with `make business-live NET=<alias>`.

Honest limits: self-serve sign-up of a new name runs on the practice chain only (the Sepolia identity adapter is read-only over the
real ENSv2 resolver; a new business's records are written by the unica.eth owner); the receipt's index panel says "Not indexed yet"
until the subgraph is deployed to Studio; every market is a labelled demonstration market until the per-feed heartbeats are validated.

## Sponsors — start here

One row per ecosystem: what we built on your tool, the single command that proves it, and the
honest limit. Every count is from a `make gate` run at this commit.

**Submitting to five from-scratch tracks.** Which track, and what each integration actually does: [`docs/SPONSOR-ELIGIBILITY.md`](docs/SPONSOR-ELIGIBILITY.md). This repository
was created inside the build window — genesis `24989a5`, 2026-09-04 20:00:06 UTC, zero commits
before it — and [`docs/PROVENANCE-LEDGER.md`](docs/PROVENANCE-LEDGER.md) carries the commands that
prove it.

| Ecosystem | What we built on it | Run this | Status | What we found for you |
|---|---|---|---|---|
| **Uniswap** | a v4 settlement hook + executor, **live and verified** on Sepolia, and a frozen V2 that binds a merchant-signed invoice to the swap that discharges it | `make gate` · `make fork` · `make proof` | **live** (V1) · **frozen RC**, undeployed (V2) | under exact output, the official periphery checks the input ceiling and never compares delivered output with the request — so full-fill enforcement lives in a hook or nowhere. Measured in [`test/v2/ShortFill.t.sol`](test/v2/ShortFill.t.sol) |
| **Chainlink** — *not selected; simulator-only* | a **CRE Confidential Workflow** — `handlerInTee` over `@chainlink/cre-sdk@1.18.0` — reading five private policy values inside the handler and publishing a commitment, an action class and a reason category but never a threshold | `cd integrations/chainlink-cre-guardian/workflow && bun test` | **`SIMULATED_IN_CRE`** — it **runs**: `cre workflow simulate` exits 0, the simulator reports "Handler requested TEE Execution", secrets load inside the handler and no threshold reaches any published field. The CLI states its simulator is not a real TEE; nothing here has run in an enclave and deploy access is pending Chainlink's review | your CLI does not check the `engines.bun` requirement your own SDK declares — an older bun fails with a bare `wasm unreachable` trap naming neither bun nor the workflow, and **your own `hello-world-ts` template fails identically**. Plus: the challenge contract's liquidation boundary is higher than its threshold implies — [`docs/feedback/chainlink.md`](docs/feedback/chainlink.md) |
| **Circle / Arc** | an Arc-native USDC treasury — bounded policy, reserve floor, per-action cap, one permitted transfer — plus the unit system that keeps Arc's 18-decimal native gas amount and its 6-decimal ERC-20 amount from ever meeting, and the Gateway authorization verifier | `node integrations/arc-treasury/test.mjs` · `node integrations/arc-treasury/split-test.mjs` | **`LIVE READ`** — reads a live Arc position every run, reads the ERC-20's own `decimals()`, decides one bounded action and emits a signable preview. 177 offline rows, 26 parity rows against the Vyper, 20 live rows. Nothing is broadcast **by design** — there is no signer in the directory. No UNICA contract on Arc and no swap path, because Uniswap is not deployed there | Gateway batching is operational accounting, not a per-payment commitment — and your SDK's server half verifies nothing it could verify locally. [`BACKFEED.md`](BACKFEED.md) |
| **ENS** | ENSv2 merchant resolution with 13 classified failure shapes, **plus the Permissioned Resolver and its access control read live** — who may edit a name, simulated for an authorised account and an outsider with `eth_call`, no wallet needed | `node integrations/ensv2/permissioned-test.mjs` · `make gate-live` | **`LIVE READ`** — 278 offline rows and 78 live rows against Sepolia, three of them real refusals decoded from the deployed contract. UNICA owns no ENS name and does not need one: it resolves the name a *merchant* owns, discovered from the chain | only one of three lookup failures reverts; the other two return the zero address, so a caller who catches reverts alone hands `address(0)` to a payment. [`docs/feedback/ens.md`](docs/feedback/ens.md) |
| **The Graph** | a V2 invoice indexer with deterministic entity ids, **a live provider that fails closed**, and a deterministic treasury analyst on top of it — every finding carries the rule, the figures and the entity ids, so it can be re-derived rather than trusted | `node integrations/graph-v2/provider-test.mjs` · `node integrations/graph-v2/copilot-test.mjs` | **`INDEXED END TO END`** — 40 + 147 + 115 rows, plus a real settlement indexed by a real graph-node and queried back out: `bash integrations/graph/local-e2e.sh` | absence of a row does not prove an invoice is unpaid, and the schema says so where a reader would look |

### Uniswap judges — every pointer, in one place

| What you asked to see | Where it is |
|---|---|
| Order creation, live V1 | [`src/SettlementExecutor.sol:133`](src/SettlementExecutor.sol#L133) |
| Payment entry point, live V1 | [`src/SettlementExecutor.sol:181`](src/SettlementExecutor.sol#L181) |
| The plan built from storage, never from caller data | [`src/SettlementExecutor.sol:215`](src/SettlementExecutor.sol#L215) |
| PoolManager interaction and callback authentication | [`src/V4SettlementHook.sol:167`](src/V4SettlementHook.sol#L167), [`:153`](src/V4SettlementHook.sol#L153) |
| Permission bits `0xC0`, no returns-delta | [`src/V4SettlementHook.sol:126`](src/V4SettlementHook.sol#L126) |
| Exact-output full-fill enforcement | [`src/V4SettlementHook.sol:190`](src/V4SettlementHook.sol#L190), [`test/v2/ShortFill.t.sol`](test/v2/ShortFill.t.sol) |
| Payer-to-merchant flow, no custody | [`src/v2/QuoteSettlementExecutor.sol:429`](src/v2/QuoteSettlementExecutor.sol#L429) |
| V2 frozen source — `settle`, `_validate`, `unlockCallback` | [`:134`](src/v2/QuoteSettlementExecutor.sol#L134), [`:262`](src/v2/QuoteSettlementExecutor.sol#L262), [`:369`](src/v2/QuoteSettlementExecutor.sol#L369) |
| **V2-001, the open Critical** | [`docs/v2/SECURITY-ADVISORY-001.md`](docs/v2/SECURITY-ADVISORY-001.md) · reproduced in [`test/v2/WitnessBinding.t.sol`](test/v2/WitnessBinding.t.sol) · site at [`:436`](src/v2/QuoteSettlementExecutor.sol#L436) |
| Proposed rc2 remediation, and why not an allowlist | the remediation table in the same advisory |
| Internal security review, ten findings with severity | [`docs/v2/INTERNAL-SECURITY-REVIEW.md`](docs/v2/INTERNAL-SECURITY-REVIEW.md) |
| Receipt verifier — recomputes, never trusts the receipt | [`tools/unica-verify/`](tools/unica-verify/) — `node tools/unica-verify/test.mjs` |
| Adversarial tests | [`test/v2/SettlementAdversarial.t.sol`](test/v2/SettlementAdversarial.t.sol), [`test/attack/`](test/attack/) |
| Fork tests against deployed Sepolia contracts | [`test/fork/`](test/fork/) — `make fork` |
| Mutation suite — every guard validated by deletion | `make mutants` — [`script/mutation-suite.sh`](script/mutation-suite.sh) |
| Deployment records and live addresses | [`broadcast/`](broadcast/), and the proof table below |
| Developer feedback | [`FEEDBACK.md`](FEEDBACK.md) |
| Provenance — this is a **from-scratch** entry | [`docs/PROVENANCE-LEDGER.md`](docs/PROVENANCE-LEDGER.md) |
| Which sponsor track, and what each is waiting on | [`docs/SPONSOR-ELIGIBILITY.md`](docs/SPONSOR-ELIGIBILITY.md) |

**V2 is not deployed, not shipped, and not safe to release.** It is frozen as `v2.0.0-rc1` with an
open Critical against it. Nothing in this repository claims otherwise, and the advisory above is
ours — we found it, reproduced it, and blocked our own release rather than shipping.

Newest work first: [`HACKATHON.md`](HACKATHON.md) is the per-track ledger — artifact, evidence,
what is missing, and what may not be claimed. [`FEEDBACK.md`](FEEDBACK.md) holds questions we have
asked and nobody has answered yet; they are labelled OPEN rather than presented as your answers.

**Status, 2026-09-08.** `make gate` exits zero. What follows is recomputed from that run, not
carried forward from an earlier one.

| Component | Status | Evidence | Limitation |
|---|---|---|---|
| V1 hook + executor | **LIVE AND VERIFIED** on Ethereum Sepolia | tag `live-green` = `v1.0.0` = `5e1d8436`, broadcast tree `c15c7cda`, `make proof` | one settlement has run on it; USDC only; no external review |
| V2 hook + executor | **FROZEN RELEASE CANDIDATE** `v2.0.0-rc1` at `82c7dcb4` — **BLOCKED, MUST NOT BE DEPLOYED** | 182 Solidity tests in the gate, 226 including fork, 44 fork rows against pinned live dependencies, 30 of 30 mutations killed, `script/verify-freeze.mjs` 17/17 | a **Critical** unfixed defect: the payer's authorisation does not bind the merchant's half of the quote, so a settlement can be redirected in full by anyone who sees it — [`docs/v2/SECURITY-ADVISORY-001.md`](docs/v2/SECURITY-ADVISORY-001.md). Also: not deployed to any public chain; EOA merchant signers only |
| V2 receipt verifier | locally demonstrated + fork-tested | `tools/unica-verify`, 113 rows with no endpoint at all; 9 more with one | the settlement it verifies exists only inside a local fork |
| V2 signing tool | locally demonstrated | `tools/unica-sign`, 81 rows | builds and reads; never broadcasts |
| ENSv2 identity chain | **locally demonstrated end-to-end** | `integrations/ensv2`, 136 + 95 rows, `node integrations/ensv2/demo.mjs` | every stage is a local fixture or computation; the policy registry is deployed nowhere. The 95-row suite crashed at row 30 and had never run to completion until 2026-09-08 |
| V2 Graph indexer | locally demonstrated | 13 matchstick + 17 manifest checks | **not deployed** — it subscribes to V2's `QuoteSettled` and V2 is deployed nowhere. The **V1** indexer IS deployed and live; see the 2026-09-09 block below |
| Chainlink CRE policy — *not part of the submitted integration* | locally demonstrated | `integrations/chainlink-cre-guardian`, 88 rows, 9 mutations | **LOCAL SIMULATION only**; no workflow deployed |
| Chainlink CRE adapter — *not part of the submitted integration* | locally demonstrated | 86 rows, 10 mutations | **deployment BLOCKED** — see the Chainlink section |
| Circle Arc nanopayments | locally demonstrated | `integrations/arc-nanopayments`, 141 rows | paid tool and agent loop not built; nothing settled |
| `merchant_policy.vy` | **PRIOR ART**, tested here | `vy/tests`, 13 rows | policy only; holds and moves nothing |
| `payany_router.vy` | **PRIOR ART**, partially tested | `vy/tests`, 14 rows | **the swap leg is untested** — it needs a Universal Router |
| `flash_liquidator.vy` | **BLOCKED** | [`docs/v3/FLASH-LIQUIDATOR-GAP.md`](docs/v3/FLASH-LIQUIDATOR-GAP.md) | the lending protocol it liquidates is not in this repository; zero tests |
| `settlement_hook.vy` | **SUPERSEDED PRIOR ART** | `docs/PRIOR-ART.md` | replaced by the frozen V2 hook; not a V3 |
| finance math library | **BLOCKED** | — | three sources arrived damaged; awaiting authoritative copies |
| Vyper settlement model + art | locally demonstrated | 82 rows, `cd vy && mox test` | in-process EVM only |

Totals from that gate run: **298** Solidity tests across 33 suites, **82** Vyper tests, and
**1,612** JavaScript rows across 16 of the gate's 17 node suites — the seventeenth is a demo that
prints no total — plus the 31-row secret scan, the 8-row copied-source scan and the 25 endpoint-free
rows of the V3 proof. The interface freeze (17) and the tool ledger (25) are counted inside the
1,612, not beside it. Re-derive every one of them:

```sh
grep -rhoE 'function test[A-Za-z0-9_]*\(' test/ | wc -l          # 370 declared; the gate runs 298
cd vy && mox test -q                                             # 82 passed
grep -c 'run_row,node' Makefile                                  # 17 node rows in the gate
make gate 2>&1 | grep -E 'tests passed|passed in|run: '          # every total above, from one run
```

**370 declared is not 298 run, and the difference is deliberate.** The gate's `forge test` carries
`--no-match-path '{test/fork/*,test/compat/*,test/v3/DeploymentsV3Fork.t.sol}'`: 44 fork rows, 22
compat rows and 6 V3 deployment-fork rows. 370 − 44 − 22 − 6 = 298, which is exactly what the gate
prints. Those three paths need somebody else's endpoint, and a gate that depends on a third party's
uptime is a status page rather than a gate. Run them with `make fork`.

Those three figures previously read 167, 80 and 669 across eight suites, and then 182, 82 and 1,543
across fourteen. **Both sets went stale, and the second set went stale under a paragraph complaining
that the first had.** A hand-typed aggregate drifts the moment a suite is added; six independent
readers found the first drift in under a minute. That is why the fourth command above now re-derives
every number in this paragraph from a single `make gate` run, instead of asking a human to keep
three numbers in their head. They are the cheapest claim in this repository to check, which is
exactly why they were the worst ones to get wrong.

Frozen object hashes, unchanged: `08479a85` `8a38e9a6` (V1) and `c955c6f7` `8284e7eb` `8cb14dfd`
(V2 rc1).

**Uniswap is UNICA's exclusive DEX integration.** No competing DEX is integrated, quoted, routed
through or recommended. That is not a requirement to swap: direct operations such as a lending
deposit, a debt repayment or a USDC transfer are performed directly and are not forced through a
pool.

Some Vyper contracts in this repository are **carried-in prior art rather than work authored
here**, and which is which is recorded in [`docs/PRIOR-ART.md`](docs/PRIOR-ART.md).

## A payment pool is a closed venue, on purpose

UNICA's v4 pool is not a liquidity pool for the world. The hook admits swaps only from the executor the
registry names for that market, because the hook must know which order a swap settles (payer, amounts,
expiry, terminal) and a public router cannot supply that. So the pool is not routable by third-party
routers, and that is the design: it is a merchant's checkout lane, seeded and capped by the operator, with
an oracle band and a receipt on every settlement. Anyone who wants to trade the same pair publicly uses
any other pool; anyone who wants to be paid with those guarantees uses this one. The Uniswap Foundation's
own guidance during the event, that a hook requiring authorization in `hookData` is only reachable through
the project's own router or interface, describes UNICA exactly, and UNICA states it rather than hiding it.

## The problem

A business that settles customer payments in one asset, and a customer who wants to pay in
another, today need two transactions and a window in which someone holds an asset they did
not ask for. Uniswap v4 can put the exchange inside the settlement boundary, but a passive hook
cannot promise where the output lands: `PoolManager.swap()` has no recipient parameter, output
is credited to the router that called it, and the router chooses the recipient after
`afterSwap` has returned (spec section 2). So UNICA is **one thin executor plus a policy hook on
Uniswap's official router**: the executor composes the router's plan from a registered order, so
the output is taken to the order's recipient; the hook admits a swap only when it arrives from
that router with that executor as the router's caller, verifies every term of the order from
storage, and emits the receipt. That is the trace the tests and the fork rehearsal show:
`SettlementExecutor.pay` calls `UniversalRouter.execute`, the router unlocks the PoolManager, and
the hook sees the router as `sender` and the executor through `msgSender()`. Settlement hooks,
caller allowlisting, hook events, Universal Router execution, partial-fill controls and receipts
are each known concepts or prior art; what this repository offers is their tested composition.
Why the official router and not one of our own is answered question by question, with sources,
in [`docs/EXECUTION-PATH.md`](docs/EXECUTION-PATH.md). The receipt's layout is versioned in
[`docs/RECEIPT-SCHEMA.md`](docs/RECEIPT-SCHEMA.md).

## Architecture and the transaction sequence

```
payer ─► SettlementExecutor.pay(orderId)          the order leaves Open before any external call (I5)
            └─ UniversalRouter.execute(V4_SWAP)     Uniswap's official router; msgSender() is the executor
                 └─ PoolManager.unlock ─► the router's V4 actions
                      ├─ swap(key, params, abi.encode(orderId))
                      │     ├─ V4SettlementHook.beforeSwap   sender is the router, caller is the executor,
                      │     │                                 order in flight, unexpired, params and pool
                      │     │                                 are the order's            (I1, I3, I4, I5)
                      │     └─ V4SettlementHook.afterSwap    whole input consumed, output ≥ minimum,
                      │                                       SettlementReceipt + HookFee   (I2, I6)
                      ├─ settle(native)              the router syncs, then settles     (I7)
                      └─ take(USDC, order.recipient, everything)   the line the executor exists for (I1)
```

The contract layout, and the partner seams built or not, are in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The invariants land one slice at a time,
each with a negative test first; their rungs are in [`docs/INVARIANTS.md`](docs/INVARIANTS.md)
and the threats in [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).

## Where the code is (file and line, checked against this commit)

| What | Where |
|---|---|
| The hook contract | [`src/V4SettlementHook.sol:35`](src/V4SettlementHook.sol#L35) |
| The official router and the executor the hook trusts, both fixed at construction: the router from the chain id, the executor from its creation code plus this hook's address through the canonical CREATE2 factory, so the pair is bound both ways; nothing configurable after deploy | [`src/V4SettlementHook.sol:44`](src/V4SettlementHook.sol#L44), [`:48`](src/V4SettlementHook.sol#L48), [`:117`](src/V4SettlementHook.sol#L117), [`src/libraries/UniswapDeployments.sol:13`](src/libraries/UniswapDeployments.sol#L13), [`src/SettlementExecutor.sol:67`](src/SettlementExecutor.sol#L67) |
| The hook's zero-argument constructor resolving the PoolManager and the router from the chain id (spec section 7d); the executor's one argument, the hook | [`src/V4SettlementHook.sol:104`](src/V4SettlementHook.sol#L104), [`src/SettlementExecutor.sol:121`](src/SettlementExecutor.sol#L121) |
| Declared permissions, `beforeSwap` and `afterSwap`, no returns-delta flag (mask 0xC0) | [`src/V4SettlementHook.sol:126`](src/V4SettlementHook.sol#L126) |
| **Invariant I1's gate**: the sender is the Universal Router, and the router's `msgSender()` is the executor | [`src/V4SettlementHook.sol:167`](src/V4SettlementHook.sol#L167), [`:173`](src/V4SettlementHook.sol#L173), [`:175`](src/V4SettlementHook.sol#L175) |
| **Spec C2 and C4**: a pool carrying this hook is native ETH against the chain's payout currency or it cannot be initialised, so no pool of an attacker's devising can mint a receipt; the executor refuses such an order too, and no settlement may pay a contract on its own path | [`src/V4SettlementHook.sol:153`](src/V4SettlementHook.sol#L153), [`:157`](src/V4SettlementHook.sol#L157), [`src/libraries/UniswapDeployments.sol:24`](src/libraries/UniswapDeployments.sol#L24), [`src/SettlementExecutor.sol:151`](src/SettlementExecutor.sol#L151), [`:147`](src/SettlementExecutor.sol#L147) |
| The day-5 attack review's tests: the hostile pool refused, and every contract on the path refused as a recipient | [`test/attack/HostilePool.t.sol:35`](test/attack/HostilePool.t.sol#L35), [`:64`](test/attack/HostilePool.t.sol#L64), [`:93`](test/attack/HostilePool.t.sol#L93), [`test/SettlementExecutor.t.sol:335`](test/SettlementExecutor.t.sol#L335) |
| The order, read from the executor's storage and never from hook data: exactly one order id or malformed (spec C1), in flight (I5), unexpired (I4), the swap's direction, amount and pool are the order's (I3) | [`src/V4SettlementHook.sol:256`](src/V4SettlementHook.sol#L256), [`:261`](src/V4SettlementHook.sol#L261), [`:264`](src/V4SettlementHook.sol#L264), [`:179`](src/V4SettlementHook.sol#L179), [`:181`](src/V4SettlementHook.sol#L181), [`:183`](src/V4SettlementHook.sol#L183) |
| **Invariant I6** after the swap: the pool consumed the whole input, the output is at least the order's minimum, or the whole payment reverts | [`src/V4SettlementHook.sol:190`](src/V4SettlementHook.sol#L190), [`:198`](src/V4SettlementHook.sol#L198), [`:201`](src/V4SettlementHook.sol#L201) |
| **Invariant I2**: the receipt in schema v1 (order id, pool, recipient, version, payer, executor, currencies, amounts, fee, reserved policy id) and OpenZeppelin's standard `HookFee` beside it; the schema is documented in `docs/RECEIPT-SCHEMA.md` | [`src/V4SettlementHook.sol:232`](src/V4SettlementHook.sol#L232), [`:236`](src/V4SettlementHook.sol#L236), [`:250`](src/V4SettlementHook.sol#L250), [`:65`](src/V4SettlementHook.sol#L65), [`:58`](src/V4SettlementHook.sol#L58) |
| The executor, the one thin contract between an application and the official router: its `Order` (the only source of recipient, amount, minimum, deadline), `createOrder` (ids from creator and salt; only pools the hook guards; never a router sentinel as recipient), and `pay` (the payer's single call; exactly one receipt and the recipient's balance verified afterwards) | [`src/SettlementExecutor.sol:38`](src/SettlementExecutor.sol#L38), [`:53`](src/SettlementExecutor.sol#L53), [`:133`](src/SettlementExecutor.sol#L133), [`:149`](src/SettlementExecutor.sol#L149), [`:147`](src/SettlementExecutor.sol#L147), [`:181`](src/SettlementExecutor.sol#L181), [`:198`](src/SettlementExecutor.sol#L198), [`:205`](src/SettlementExecutor.sol#L205) |
| **Invariant I5** at the executor: the order leaves Open before any external call; at the hook: one swap per order per transaction | [`src/SettlementExecutor.sol:191`](src/SettlementExecutor.sol#L191), [`src/V4SettlementHook.sol:178`](src/V4SettlementHook.sol#L178), [`:223`](src/V4SettlementHook.sol#L223) |
| The plan the executor composes for the official router: swap with only the order id as hook data (spec C1), settle the native input, take the whole output to the order's recipient (I1); then one call to `execute` | [`src/SettlementExecutor.sol:215`](src/SettlementExecutor.sol#L215), [`:229`](src/SettlementExecutor.sol#L229), [`:233`](src/SettlementExecutor.sol#L233), [`:235`](src/SettlementExecutor.sol#L235), [`:196`](src/SettlementExecutor.sol#L196) |
| T5 guard, asserted numerically before any deploy; the day-1 address shape refused; the derived executor address checked against where the executor lands; the router checked against its deployed runtime | [`test/V4SettlementHook.t.sol:33`](test/V4SettlementHook.t.sol#L33), [`:45`](test/V4SettlementHook.t.sol#L45), [`:61`](test/V4SettlementHook.t.sol#L61), [`:67`](test/V4SettlementHook.t.sol#L67), [`:86`](test/V4SettlementHook.t.sol#L86), [`:102`](test/V4SettlementHook.t.sol#L102) |
| I1 negatives: a swap from the official test router is refused before the hook asks anyone anything; the official router driven by a stranger is refused with the stranger named, and the stranger keeps every wei | [`test/V4SettlementHook.t.sol:110`](test/V4SettlementHook.t.sol#L110), [`:125`](test/V4SettlementHook.t.sol#L125) |
| The hook's own order checks, reached through a harness at the executor's address that drives the official router with plans the real executor never composes, including two swaps for one order | [`test/V4SettlementHook.t.sol:155`](test/V4SettlementHook.t.sol#L155), [`:180`](test/V4SettlementHook.t.sol#L180), [`:201`](test/V4SettlementHook.t.sol#L201), [`:233`](test/V4SettlementHook.t.sol#L233), [`:217`](test/V4SettlementHook.t.sol#L217), [`:249`](test/V4SettlementHook.t.sol#L249), [`:270`](test/V4SettlementHook.t.sol#L270) |
| Reading permissions off the real runtime code | [`test/V4SettlementHook.t.sol:400`](test/V4SettlementHook.t.sol#L400) |
| I1 positive through the official router, fuzzed at 10,000; I2 with both events decoded field by field against schema v1; I5, I4, I6 and the partial fill, each asserting nothing moved; the executor's missing door to the PoolManager | [`test/SettlementExecutor.t.sol:42`](test/SettlementExecutor.t.sol#L42), [`:73`](test/SettlementExecutor.t.sol#L73), [`:103`](test/SettlementExecutor.t.sol#L103), [`:130`](test/SettlementExecutor.t.sol#L130), [`:148`](test/SettlementExecutor.t.sol#L148), [`:160`](test/SettlementExecutor.t.sol#L160), [`:184`](test/SettlementExecutor.t.sol#L184), [`:214`](test/SettlementExecutor.t.sol#L214), [`:258`](test/SettlementExecutor.t.sol#L258), [`:335`](test/SettlementExecutor.t.sol#L335), [`:278`](test/SettlementExecutor.t.sol#L278), [`:363`](test/SettlementExecutor.t.sol#L363), [`:348`](test/SettlementExecutor.t.sol#L348) |
| I7 as five rows: the control, the trap, the defect, the invariant, and the official router's own bytecode with a foreign settle leg before the native one | [`test/I7NativeSettle.t.sol:53`](test/I7NativeSettle.t.sol#L53), [`:61`](test/I7NativeSettle.t.sol#L61), [`:69`](test/I7NativeSettle.t.sol#L69), [`:99`](test/I7NativeSettle.t.sol#L99), [`:110`](test/I7NativeSettle.t.sol#L110) |
| The test base: Uniswap's official PoolManager bytecode etched at the canonical address, its 24,009-byte runtime asserted; the official Universal Router's deployed runtime etched at its Sepolia address, its keccak asserted | [`test/utils/SettlementTestBase.sol:78`](test/utils/SettlementTestBase.sol#L78), [`:42`](test/utils/SettlementTestBase.sol#L42), [`:116`](test/utils/SettlementTestBase.sol#L116), [`test/utils/artifacts/UniversalRouterV2Sepolia.sol:12`](test/utils/artifacts/UniversalRouterV2Sepolia.sol#L12) |
| The two harnesses: the executor with its plan made arbitrary, and a stand-in at the router's address with I7's defence switchable | [`test/utils/ExecutorHarness.sol:15`](test/utils/ExecutorHarness.sol#L15), [`test/utils/RouterHarness.sol:53`](test/utils/RouterHarness.sol#L53), [`:78`](test/utils/RouterHarness.sol#L78) |
| Deterministic salt mining and CREATE2 deploy, the executor at its derived address; pool initialisation, seeding, and the settlement stage (the day-1 scaffold's script, reworked for the gated hook before day 4) | [`script/LiveFire.s.sol:73`](script/LiveFire.s.sol#L73), [`:115`](script/LiveFire.s.sol#L115), [`:124`](script/LiveFire.s.sol#L124), [`:153`](script/LiveFire.s.sol#L153), [`:174`](script/LiveFire.s.sol#L174), [`:225`](script/LiveFire.s.sol#L225) |

## Uniswap dependencies

| Dependency | Pin | Used at |
|---|---|---|
| OpenZeppelin `uniswap-hooks` (`BaseHook`, `IHookEvents`) | v1.1.1, `bd5287c` | `src/V4SettlementHook.sol` |
| `v4-core` (through `uniswap-hooks`) | `d153b04` | `Hooks`, `PoolKey`, `Currency`, `BalanceDelta`, the wrapped-error shape the tests assert |
| `v4-periphery` (through `uniswap-hooks`) | `7ebd04b` | `IV4Router`, `Actions`, `ActionConstants` in the executor's plan; `IMsgSender` in the hook's gate; `HookMiner` in the deploy script |
| `hookmate` | `ef3e984` | `AddressConstants.getPoolManagerAddress(chainid)`; the official PoolManager initcode the tests deploy |
| PoolManager, Ethereum Sepolia | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | the constructor, the scripts, the local test topology |
| Universal Router (`UniversalRouterV2`), Ethereum Sepolia | `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` | the only swap sender the hook admits and the executor's one call; its deployed runtime (19,540 bytes) is etched in the tests at this address |
| `PoolSwapTest`, `PoolModifyLiquidityTest`, `StateView`, Sepolia | `0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe`, `0x0C478023803a644c94c4CE1C1e7b9A087e411B0A`, `0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C` | the day-1 seed and swap, the seeding stage, and the readback (the tests deploy their own copies of the two routers) |
| Permit2, Sepolia | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | not yet; the ERC-20 payer path |

All Sepolia addresses were read from the official v4 deployments page and confirmed to hold code
on 2026-09-04 (`cast code <addr> --rpc-url https://ethereum-sepolia-rpc.publicnode.com`).

## UNICA v4 — the local acceptance run (2026-09-12, appended)

The generic-market release, built from `docs/unica-v4/`, runs end to end on a throwaway local chain with one
command and no key anywhere:

```sh
make anvil-test
```

That is: Uniswap's official PoolManager bytecode, a registered and versioned market at a mined `0x20C0` hook,
the real Chainlink feed adapter over fixture feeds, a merchant identity with an active and a revoked
terminal, a non-transferable identity badge, a confidential-policy record delivered through a local forwarder
fixture, one payer-bound settlement, the receipt authenticated through the registry, a POS that says PAID only
from that decision, then the adversarial matrix. Every fixture is labelled a fixture; nothing here has value.
Read [`docs/unica-v4/ANVIL-DEMO.md`](docs/unica-v4/ANVIL-DEMO.md), the enforcement-layer matrix
[`docs/unica-v4/ENFORCEMENT-MATRIX.md`](docs/unica-v4/ENFORCEMENT-MATRIX.md), the first-party review record
[`docs/unica-v4/SECURITY-REVIEW-V4.md`](docs/unica-v4/SECURITY-REVIEW-V4.md) and the public deployment handoff
[`docs/unica-v4/PUBLIC-DEPLOYMENT-HANDOFF.md`](docs/unica-v4/PUBLIC-DEPLOYMENT-HANDOFF.md). No UNICA v4
contract is deployed on any public chain at this commit.

## Setup, test, fuzz

```sh
git clone https://github.com/NFTeria/UNICA.git && cd UNICA
make deps        # fetches the pinned submodules (the v4 toolchain) and asserts the pin
make doctor      # says what is present, what is missing, and how to get it
make gate        # forge build && forge test && forge fmt --check; expect every test passed, 0 failed
forge test -vv   # the fuzz tests print their run count (10,000); CI asserts the count against the tree
make predict     # the hook address and salt this creation code lands on, before any deploy
make help        # every other command: the local fork, the four stages, Sepolia, readback, verify
```

The four stages (deploy the executor and the hook, initialise the pool, seed it, settle an order
through the executor and the official router) each have a `make` target. With no arguments they
run against a local anvil fork of Sepolia started by `make anvil`, impersonating the deployer, so
the real PoolManager, the real Universal Router and the real USDC are exercised without a real
transaction; with `ARGS="--network sepolia"` they sign with a keystore account and broadcast.
`make rehearse` does all four on a throwaway fork in one command with a readback.

Needs Foundry (`forge`, `cast`; `anvil` only for the fork rehearsal) and git. Nothing from
the author's machine is required; CI runs the same commands on a fresh clone of this
repository, without submodules, on every push.

Toolchain on the machine that produced the numbers in this file: forge/cast
`1.3.5-foundry-zksync-v0.1.9`, anvil `1.5.1-stable`. CI pins upstream Foundry v1.5.1.

## Versions

Two things this table keeps apart. The **deployment tag** is the commit whose `src/` produced the
bytecode that is live. The **documentation HEAD** is the commit you are reading this file at, and
is normally later. A claim about what runs on chain belongs to the first; a claim about what is
written down belongs to the second.

`live-green` (`5e1d843`) is the deployment tag. **V1's** source and tests are byte-identical from
it to HEAD, and so is `docs/proof/verify-live.sh`. The command that shows it has to exclude what was
added since, because V2 lives under `src/` and `test/` too:

```sh
git diff --stat live-green..HEAD -- src/ test/ ':(exclude)src/v2' ':(exclude)test/v2' ':(exclude)test/fork'
```

It prints nothing. The older form of this claim named `-- src/ test/` with no exclusions and said it
printed nothing; that stopped being true the day V2 was written, and it is recorded here rather than
quietly corrected. A semantic tag `v1.0.0` is **proposed and does not exist yet**; until it does, the
release is named `live-green` in every claim. Full record: [`docs/versions/V1.md`](docs/versions/V1.md).

**V2 is implemented, frozen as `v2.0.0-rc1`, and deployed nowhere.** Two versions of UNICA are on a
chain: **V1** on Ethereum Sepolia, which has settled a real swap, and **V3**, deployed to four
testnets on 2026-09-09 and bound but **not exercised** — it has settled nothing. Both are below, and
the difference between them is the whole point of keeping the two tables apart. V2 exists as source, tests and a rehearsal, and it carries an open
**Critical** defect that blocks its release — see
[`docs/v2/SECURITY-ADVISORY-001.md`](docs/v2/SECURITY-ADVISORY-001.md) and the
[internal security review](docs/v2/INTERNAL-SECURITY-REVIEW.md). Nothing in this repository should
be read as a V2 capability on any chain.

| | V1 — live |
|---|---|
| Source commit / tag | `5e1d843`, tag `live-green`. `v1.0.0` proposed, not created |
| Chain | Ethereum Sepolia, 11155111. Testnet only |
| Addresses | hook `0x1120…a0C0`, executor `0x044b…6210` |
| Supported input | native ETH only; any other `currency0` is refused at order creation |
| Supported payout | USDC only, compiled in per chain |
| Execution path | Universal Router `V4_SWAP`, actions `SWAP_EXACT_IN_SINGLE`, `SETTLE`, `TAKE`; the hook admits the swap only with the executor behind the router. No Permit2 call |
| Receipt schema | version 1, frozen; one receipt per settlement, emitted inside the swap |
| Proof status | 31 of 31 chain checks, both sources verified, and the 54 tests that existed at `live-green` — the repository has many more now, but these are the ones that produced this bytecode |
| Production status | not production: unaudited, one settlement, thin liquidity |
| Limitations | one input, one payout, one chain, exact-input only, no merchant identity — the full list is in [`docs/versions/V1.md`](docs/versions/V1.md) |

[`CHANGELOG.md`](CHANGELOG.md) records what has landed since the release.

## What changed on 2026-09-09 — appended, not rewritten

Three things below this line went from prepared to live. Everything earlier in this file stays as
written; where it now disagrees with this block, this block is the later reading and the chain is
the arbiter of both.

| | Now |
|---|---|
| **Public surface** | **https://nfteria.github.io/UNICA/** — live, HTTP 200. One page: the flow told in six sections, then the settlement action. Three panels read live chain state — the hook's permission bits (computed from its address, no RPC call), the settled swap (from the subgraph), the agent's four role words (from the ENSv2 resolver) |
| **ENSv2** | `unica.eth` is registered on **Sepolia** to the deployer, and the delegation is **broadcast**: 12 transactions, blocks 11670554–11670579, every one `status 1`. The agent holds `SET_TEXT` at exactly one per-key resource and **0** at the name, the payment name and ROOT_RESOURCE |
| **The Graph** | The V1 subgraph is **deployed and synced** at `https://api.studio.thegraph.com/query/1755384/unica-settlements/v2-39b6f91`, `hasIndexingErrors: false`. It returns one `Settlement`: `amountIn 1000000000000000`, `amountOut 2003660`, `fee 0` — the values decoded from the raw log, and an entity id that is the transaction hash followed by log position `0x6b` = 107 |
| **The agent** | `node integrations/ensv2/agent.mjs` — six rows against the live resolver, **five of them refusals**, control first. It broadcasts nothing: a refused transaction is one that does not exist, so `eth_call` is the only way those rows are observable |

**Still not true, and not claimed:** no mainnet anything; V3 has settled nothing; V2 is deployed
nowhere; the Chainlink workflow has never run in a TEE; the agent's key is not in this project's
keystore, so no agent-signed transaction exists on chain.



## V3 has settled — 2026-09-10, appended

**`receiptCount()` is 1.** V3's first settlement landed on Ethereum Sepolia today. Every claim above
that says V3 has settled nothing was true when written and is now superseded by this block.

| | |
|---|---|
| Pool id | `0xf9b873f83814234224be42592795ec812fb948a300188e0c597796171ab9c57a` — native ETH / USDC, fee 3000, spacing 60, guarded by the V3 hook |
| Open pool | [`0x28f56384…1f65`](https://sepolia.etherscan.io/tx/0x28f56384137fc465a7472891993883d74daa9a9f71aa096f3e18246c33e81f65) · block 11675180 · 56,966 gas |
| Seed liquidity | [`0x1c955980…64f9`](https://sepolia.etherscan.io/tx/0x1c955980f27ca8da9db488ccefbaeef4ec3bd56f49fb0fe9dfcf3af2212864f9) · block 11675182 · 55,437 gas · 0.008 ETH + 20 USDC |
| Register the order | [`0x4514e274…2884`](https://sepolia.etherscan.io/tx/0x4514e274531731441551a7122617ee08a877c447819feeb4b64f8a5402692884) · block 11675185 · 195,334 gas |
| **Settle it** | [**`0x4f4acbd1…8854`**](https://sepolia.etherscan.io/tx/0x4f4acbd1b1ed07eccbcf0d7c6f6fcb23a397b619dd3a1dd7fcf7ed7456768854) · block 11675187 · 264,647 gas |

All four `status 1`. The `SettlementReceipt`, decoded from the log at index 108:

```
amountIn   1000000000000000   = 0.001 ETH
amountOut  2216294            = 2.216294 USDC
fee        0
topic0     0xf9b834e9c2d7d0250251dfdb3c5fdc3f97d829dbe3402f45c89257ab4ec43563
```

**That topic is V1's, unchanged** — the same signature the existing subgraph already indexes, which
is what makes a V3 deployment visible to everything built for V1.

**The number was predicted before it was signed.** `test/v3/LiveFireV3Fork.t.sol` rehearsed the whole
sequence against live Sepolia state and the deployed contracts, and printed `2216294`. The chain
then produced 2216294. Nothing was deployed to achieve it: the hook, the executor, the PoolManager
and the liquidity router were all already there.

**The Graph carries it too.** The subgraph was extended to a second data source at V3's hook and
redeployed — no chain transaction, the same event signature and the same handler, all 6 matchstick
tests still green. It now returns two settlements: V1's `2003660` and V3's `2216294`. The V3 entity
id ends `6c000000` — `0x6c` = 108, the exact log position the receipt was emitted at.

### And a second one, through the published page — same day

`receiptCount()` is **2**. The second settlement did not come from a script: it was made in a
browser, on <https://nfteria.github.io/UNICA/>, through the whole product.

| | |
|---|---|
| Merchant | `nfteria.eth`, resolved live on **ENSv2 Sepolia** to `0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73` |
| Register the order | [`0xe33760b4…12b6`](https://sepolia.etherscan.io/tx/0xe33760b47f2af632b54ac76bc50cb1a3988184a1142d3f03a89d66d6642312b6) · block 11675551 |
| **Settle it** | [**`0x4a4ab260…604c`**](https://sepolia.etherscan.io/tx/0x4a4ab260728b026494da2120f03a627099b6130260a06b8d9172aec394af604c) · block 11675553 |
| Order id | `0xd27a2def27cc56b9ea9e822d6ba6710a5f6051e230543c164b6fed376ea30120` |
| Paid | 0.001 ETH in, **1.774099 USDC** out, fee 0 |

**The page predicted it before it was signed.** The checkout displayed a quote of **1.774099 USDC**,
computed in the browser from the pool's live `sqrtPriceX96` and liquidity. The settlement paid
**1774099** units. Not close — the same integer. The rehearsal did this once against the first
settlement from a Foundry fork; this time the arithmetic ran in a browser tab against live state and
was right again.

**This is the first settlement in which the ENSv2 leg was load-bearing.** The first one named a
recipient address directly. This one started from a name: the resolver was read, the address was
shown to the payer before anything was signed, and that address — the one on screen, not a
re-resolved one — is what the order carries. Identity, enforcement and proof all ran in one pass
through the deployed product.

**Still not claimed:** no *stranger* has completed a payment through the page; both settlements were
made by this project. And V3 is exercised on **Ethereum Sepolia only**. Unichain, Base and Arbitrum
Sepolia carry the same address, are verified, and have settled nothing — `receiptCount()` is 0 on
all three. Deployed and bound is the rung they reach.

## Proof: UNICA V3, one address on four chains (2026-09-09)

> **SUPERSEDED IN ONE RESPECT, 2026-09-10.** Everything in this section about deployment, binding
> and verification still holds and is still re-proved by the script it names. Its headline claim
> that V3 has settled nothing is **no longer true of Ethereum Sepolia** — `receiptCount()` there is
> 1, and the block above titled "V3 has settled" carries the four transaction hashes. It remains
> true of Unichain, Base and Arbitrum Sepolia. The body is left exactly as it was written, because
> the record of what was believed when is worth more than a tidy page.

**V3 is DEPLOYED and BOUND on four testnets, and it has SETTLED NOTHING.** `receiptCount()` on the
hook and `orderCount()` on the executor are **0 on all four chains** — re-read on every run of the
script below, printed as values rather than asserted as a pass. Nothing has been swapped, settled or
paid through V3 on any chain. **V1 on Ethereum Sepolia is the only generation that has settled a
real swap**, and its table is the next section down. A reader who comes away thinking four chains
have settled anything has been misled by this page, not by the chain.

Three rungs, kept apart on purpose: **deployed** (the code is at the address), **verified** (the
source is published and matches), **exercised** (something has actually gone through it). V3 reaches
the first two on four chains and the third on none.

One mined CREATE2 address carries both contracts on every chain: hook
`0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0` (10,634 bytes, flags `0x20C0`), executor
`0x015692C9E43ca19a2504F79368D1156A56680517` (12,953 bytes). `bash script/verify-v3.sh` re-proves
every row below from the chain — **66 checks: 65 passed, 0 failed, 1 skipped** on the run that
produced this table, the one skip being the eight explorer rows saying out loud that they were not
asked for; **73 checks, 0 failed, 0 skipped** with `--etherscan`, which asks for them. `make
proof-v3` and `make proof-v3-etherscan` are those two runs through the Makefile.

| Item | Value | Rung | Re-verify |
|---|---|---|---|
| Hook, all four chains | `0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0`, flags `0x20C0` (beforeInitialize, beforeSwap, afterSwap), 10,634 bytes of runtime code on every chain, zero-argument constructor | DEPLOYED | `cast code 0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0 --rpc-url $RPC \| wc -c` prints 21271 on each of the four |
| Executor, all four chains | `0x015692C9E43ca19a2504F79368D1156A56680517`, 12,953 bytes on every chain, one constructor argument = the hook | DEPLOYED | `cast code 0x015692C9E43ca19a2504F79368D1156A56680517 --rpc-url $RPC \| wc -c` prints 25909 on each of the four |
| Bound both ways, all four chains | `hook.SETTLEMENT_EXECUTOR()` names the executor and `executor.HOOK()` names the hook, on every chain | BOUND | `cast call 0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0 'SETTLEMENT_EXECUTOR()(address)' --rpc-url $RPC`, and `cast call 0x015692C9E43ca19a2504F79368D1156A56680517 'HOOK()(address)' --rpc-url $RPC` |
| Ethereum Sepolia, 11155111 | hook [`0x6ff75c0b…9fd6`](https://sepolia.etherscan.io/tx/0x6ff75c0bb90378642b75359fc188a474a54b6b66017c2cf7d76e20d80e959fd6) 2,664,410 gas; executor [`0x0a65819d…d828`](https://sepolia.etherscan.io/tx/0x0a65819d4cbbdfefd9a77bd4aa79f72516d9c3f22d10551f71445715260fd828) 2,891,954 gas; both in block 11667702. `poolManager()` = `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | DEPLOYED | `cast receipt 0x6ff75c0bb90378642b75359fc188a474a54b6b66017c2cf7d76e20d80e959fd6 --rpc-url $RPC status` prints `1 (success)` |
| Unichain Sepolia, 1301 | hook [`0xe949fcd4…c08e`](https://unichain-sepolia.blockscout.com/tx/0xe949fcd49f95b20217b85b3145827e6998fbc1e298a372bb08d8705c5989c08e) 2,664,479 gas; executor [`0x1304be3b…ed7a`](https://unichain-sepolia.blockscout.com/tx/0x1304be3b6f39588d34790d284dfc77c1abde04d6b79b279c833ef5ed5f26ed7a) 2,892,000 gas; both in block 62101542. `poolManager()` = `0x00B036B58a818B1BC34d502D3fE730Db729e62AC` | DEPLOYED | `cast receipt 0xe949fcd49f95b20217b85b3145827e6998fbc1e298a372bb08d8705c5989c08e --rpc-url $RPC status` prints `1 (success)` |
| Base Sepolia, 84532 | hook [`0xa82e8351…c038`](https://base-sepolia.blockscout.com/tx/0xa82e8351f7dd0c506c00f4bc0e18e69396f859f99d352016987cb38597c4c038) 2,664,548 gas; executor [`0xa4d01c6e…6cc4`](https://base-sepolia.blockscout.com/tx/0xa4d01c6ee5f9fc8003f851f2b39a8bfbbe18ff3e1d028c1ef873d4dd92cf6cc4) 2,892,046 gas; both in block 46592814. `poolManager()` = `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` | DEPLOYED | `cast receipt 0xa82e8351f7dd0c506c00f4bc0e18e69396f859f99d352016987cb38597c4c038 --rpc-url $RPC status` prints `1 (success)` |
| Arbitrum Sepolia, 421614 | hook [`0xe22b2bcf…48d9`](https://arbitrum-sepolia.blockscout.com/tx/0xe22b2bcf652b3e0826ff5f593c022c9e166cef04a30a3eebd8e7d439838a48d9) 2,674,223 gas in block 307058865; executor [`0x6115e9dd…8d8d`](https://arbitrum-sepolia.blockscout.com/tx/0x6115e9dd9119245cbb7dee318a60b9fb88c1b104074f6b9cd35dfa63ce1b8d8d) 2,897,511 gas in block **307058867** — two blocks, not one, unlike the other three chains. `poolManager()` = `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317` | DEPLOYED | `cast receipt 0xe22b2bcf652b3e0826ff5f593c022c9e166cef04a30a3eebd8e7d439838a48d9 --rpc-url $RPC status` prints `1 (success)` |
| Source verification, all eight | Etherscan: verified on all four chains, each explorer reporting the contract's own name. Sourcify: `match` on all four — **Sourcify's PARTIAL tier, not `exact_match`**. The two words are not the same claim; the eight-row table below keeps them in separate columns | VERIFIED — source matches bytecode, which says nothing about the code ever having run | `make proof-v3-etherscan` asserts the Etherscan name on all eight; the per-row curl commands are in the table below |
| **Settlement counters** | **`receiptCount()` = 0 and `orderCount()` = 0 on all four chains.** V3 has never settled a swap, created an order, or emitted a receipt on any chain | **NOT EXERCISED** | `cast call 0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0 'receiptCount()(uint256)' --rpc-url $RPC` prints `0`; `cast call 0x015692C9E43ca19a2504F79368D1156A56680517 'orderCount()(uint256)' --rpc-url $RPC` prints `0` |
| Broadcast records | [`broadcast/DeployV3.s.sol/<chainid>/run-latest.json`](broadcast/DeployV3.s.sol) for each of 11155111, 1301, 84532, 421614: two transactions, two receipts, all status 1 | committed | `bash script/verify-v3.sh` reads each record and compares the recorded block and status against the chain |

#### The eight verifications, one row per contract per chain

A judge can click every link. **Every row is a claim about SOURCE matching BYTECODE and nothing
else** — no row here says the contract has ever been used, and the settlement counters two rows up
are still 0 on all four chains.

| Chain · id | Contract | Explorer (click) | Etherscan | Sourcify tier |
|---|---|---|---|---|
| Ethereum Sepolia · 11155111 | `UnicaHookV3` | [sepolia.etherscan.io/address/0x5d6AdF56…](https://sepolia.etherscan.io/address/0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0#code) | **Verified**, reports ContractName `UnicaHookV3`, solc `v0.8.30+commit.73712a01`, optimizer off, cancun | **`match`** — the partial tier, not `exact_match` |
| Ethereum Sepolia · 11155111 | `UnicaExecutorV3` | [sepolia.etherscan.io/address/0x015692C9…](https://sepolia.etherscan.io/address/0x015692C9E43ca19a2504F79368D1156A56680517#code) | **Verified**, reports ContractName `UnicaExecutorV3`, solc `v0.8.30+commit.73712a01`, optimizer off, cancun | **`match`** — the partial tier, not `exact_match` |
| Unichain Sepolia · 1301 | `UnicaHookV3` | [sepolia.uniscan.xyz/address/0x5d6AdF56…](https://sepolia.uniscan.xyz/address/0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0#code) | **Verified**, reports ContractName `UnicaHookV3`, solc `v0.8.30+commit.73712a01`, optimizer off, cancun | **`match`** — the partial tier, not `exact_match` |
| Unichain Sepolia · 1301 | `UnicaExecutorV3` | [sepolia.uniscan.xyz/address/0x015692C9…](https://sepolia.uniscan.xyz/address/0x015692C9E43ca19a2504F79368D1156A56680517#code) | **Verified**, reports ContractName `UnicaExecutorV3`, solc `v0.8.30+commit.73712a01`, optimizer off, cancun | **`match`** — the partial tier, not `exact_match` |
| Base Sepolia · 84532 | `UnicaHookV3` | [sepolia.basescan.org/address/0x5d6AdF56…](https://sepolia.basescan.org/address/0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0#code) | **Verified**, reports ContractName `UnicaHookV3`, solc `v0.8.30+commit.73712a01`, optimizer off, cancun | **`match`** — the partial tier, not `exact_match` |
| Base Sepolia · 84532 | `UnicaExecutorV3` | [sepolia.basescan.org/address/0x015692C9…](https://sepolia.basescan.org/address/0x015692C9E43ca19a2504F79368D1156A56680517#code) | **Verified**, reports ContractName `UnicaExecutorV3`, solc `v0.8.30+commit.73712a01`, optimizer off, cancun | **`match`** — the partial tier, not `exact_match` |
| Arbitrum Sepolia · 421614 | `UnicaHookV3` | [sepolia.arbiscan.io/address/0x5d6AdF56…](https://sepolia.arbiscan.io/address/0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0#code) | **Verified**, reports ContractName `UnicaHookV3`, solc `v0.8.30+commit.73712a01`, optimizer off, cancun | **`match`** — the partial tier, not `exact_match` |
| Arbitrum Sepolia · 421614 | `UnicaExecutorV3` | [sepolia.arbiscan.io/address/0x015692C9…](https://sepolia.arbiscan.io/address/0x015692C9E43ca19a2504F79368D1156A56680517#code) | **Verified**, reports ContractName `UnicaExecutorV3`, solc `v0.8.30+commit.73712a01`, optimizer off, cancun | **`match`** — the partial tier, not `exact_match` |

Re-run all eight against the explorer in one command — it needs the four endpoints **and**
`ETHERSCAN_API_KEY`, and prints eight loud `SKIP` lines rather than eight silent passes if the key
is unset:

```sh
make proof-v3-etherscan      # 73 checks, 0 failed, 0 skipped on the run that produced this table
```

and the Sourcify tier for any one of the eight, with the address and chain id swapped in:

```sh
curl -s https://sourcify.dev/server/v2/contract/11155111/0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0 \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['match'], d['verifiedAt'])"
```

**"Verified" on Etherscan and `match` on Sourcify are not the same sentence, and this page will
not let them blur.** Etherscan publishes one verdict — the source is published and it compiles to
this bytecode — and all eight have it. Sourcify grades, and all eight sit at `match` rather than
`exact_match`, because `foundry.toml` sets `bytecode_hash = "none"` and `cbor_metadata = false`, so
the deployed code carries no metadata hash for Sourcify to check the metadata against. That setting
is exactly what makes the init-code hash reproducible and lets one mined CREATE2 address land on
four chains. **Full-tier Sourcify and one-address-on-four-chains cannot both be had under this
build; this repository deliberately chose the address.**

**Why the runtime hash differs on every chain, and why that is correct.** The runtime code is *not*
byte-identical across the four. It is the same 10,634 and 12,953 bytes everywhere, but the keccak
differs per chain, because Solidity writes `immutable` values into runtime code at construction and
`UnicaDeploymentsV3` resolves this chain's PoolManager, Universal Router and payout USDC there. The
hook differs in 300 bytes across 15 regions and the executor in 276 across 12; **every one of those
bytes is a chain-specific immutable**, and blanking exactly those regions collapses all four chains
to one hash per contract (`0x8a830c48…7951` for the hook, `0xe63a3038…388e` for the executor).
`script/verify-v3.sh` asserts that masked equality rather than the false claim that the raw hashes
match. What *is* byte-identical everywhere is the **creation** code: the hook's init code is 30,590 bytes
with no constructor arguments appended, the executor's is 15,752 bytes ending in the hook address,
and each is the same on all four chains under the same salt through the standard CREATE2 factory
`0x4e59…956C`. That identity — not the runtime hash — is what makes one mined address land on four
chains. Re-derive it from the records:

```sh
python3 -c "
import json
for n in ('UnicaHookV3','UnicaExecutorV3'):
    s={json.load(open(f'broadcast/DeployV3.s.sol/{c}/run-latest.json'))['transactions'][i]['transaction']['input'][66:]
       for c in (11155111,1301,84532,421614) for i in (0,1)
       if json.load(open(f'broadcast/DeployV3.s.sol/{c}/run-latest.json'))['transactions'][i]['contractName']==n}
    print(n, 'distinct init codes across 4 chains:', len(s), '| bytes:', len(next(iter(s)))//2)"
```

**Why the Sourcify tier is `match` and not `exact_match`.** `foundry.toml` sets
`bytecode_hash = "none"` and `cbor_metadata = false`. Those are what make the CREATE2 init-code hash
reproducible on any machine, which is how one mined address lands on four chains; the price is that
the deployed bytecode carries no metadata hash, so Sourcify cannot confirm the metadata is the exact
one compiled and caps the tier at `match`. Full-tier verification and the identical-address property
cannot both be had under this build, and this repository chose the address. The gap is not a
Sourcify outage, and the control is a one-liner rather than a number to keep in your head — most
recent Sepolia verifications on that server *do* reach `exact_match`, so the tier is plainly
reachable there and these eight did not reach it:

```sh
curl -s 'https://sourcify.dev/server/v2/contracts/11155111?limit=20' \
  | python3 -c "import sys,json,collections;print(collections.Counter(x['match'] for x in json.load(sys.stdin)['results']))"
```

That window moves with every new verification, which is exactly why the ratio is not written down
here as a fixed pair of numbers.

**What has not been checked.** No V3 pool exists, no liquidity has been added, and no swap has been
routed on any of the four chains. The 6 rows in `test/v3/DeploymentsV3Fork.t.sol` exercise the
deployment against a fork, not against these live addresses, and they are outside `make gate` for
the endpoint reason given above. `make proof-v3` needs all four endpoints and is therefore also
outside the gate; the gate runs only the 29 self-test rows and 3 address-arithmetic rows, which need
no network at all. The eight Etherscan rows are outside it twice over — they need an endpoint *and* a
key — so they sit behind the script's own `--etherscan` flag, which neither gate line passes.

## Proof: Ethereum Sepolia (chain id 11155111)

The pool is native ETH against Circle's USDC, a v4-only shape: `currency0 = address(0)`, no
wrapping. Every row names the rung it has reached and carries the command that re-proves it.

### The gated hook, live: 2026-09-05

`V4SettlementHook` and `SettlementExecutor`, the current implementation, deployed from
`deploy-candidate-4` and settled from `deploy-candidate-5` (the settle stage's deadline changed in
between; nothing under `src/` did). Every row is read from the chain; `bash docs/proof/verify-live.sh`
re-proves all of them without trusting this file. `RPC=https://ethereum-sepolia-rpc.publicnode.com`.

Provenance: the tag `live-green` (commit `5e1d843`) identifies the reviewed live-contract state,
the records and the verifier as they were when the chain was read. This table and the evidence
index landed in the two commits after it (`4a67a5c`, `5417a0f`). The tag is not moved; the
documentation HEAD is whatever this file's commit is.

| Item | Value | Rung | Re-verify |
|---|---|---|---|
| Hook | `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0`, salt `0xd76`, flags `0x20C0` (beforeInitialize, beforeSwap, afterSwap), 10,634 bytes of runtime code, zero-argument constructor | LIVE, [explorer](https://sepolia.etherscan.io/address/0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0) | `cast code 0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0 --rpc-url $RPC \| wc -c` prints 21271; `make predict` reproduces the address and salt |
| Executor | `0x044bc8a8773EC7b9B8de2467766636dFFCaC6210`, 11,289 bytes, constructor argument = the hook; the hook derives this address from the executor's creation code and names it, and the executor names the hook | LIVE, [explorer](https://sepolia.etherscan.io/address/0x044bc8a8773EC7b9B8de2467766636dFFCaC6210) | `cast call 0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0 'SETTLEMENT_EXECUTOR()(address)' --rpc-url $RPC` prints the executor; `cast call 0x044bc8a8773EC7b9B8de2467766636dFFCaC6210 'HOOK()(address)' --rpc-url $RPC` prints the hook |
| Deploy transactions | hook [`0xc76bc0a3…a014`](https://sepolia.etherscan.io/tx/0xc76bc0a3ef3cf659fc3c8eb0e76febd2006801b1e0e3fbca4f51bfea4108a014), 2,603,048 gas; executor [`0x8c067692…7ebb`](https://sepolia.etherscan.io/tx/0x8c06769270297e2794593dfc5084a628e31582492c135419535d3ddcb0c57ebb), 2,510,930 gas; both through the CREATE2 factory `0x4e59…956C`, block 11639895 | LIVE | `cast receipt 0xc76bc0a3ef3cf659fc3c8eb0e76febd2006801b1e0e3fbca4f51bfea4108a014 --rpc-url $RPC status` prints `1 (success)`, and the same for the executor's |
| Pool | native ETH / USDC, fee 3000, spacing 60, id `0xff4f4e2438f61817271cbd8399a925f5f99a1482f88c55419a2b69d0768e56db` (keccak of the live key), initialised at 2,500 USDC per ETH (`sqrtPriceX96` `3961408125713216879677197`) | LIVE, tx [`0x8b07ff44…5858`](https://sepolia.etherscan.io/tx/0x8b07ff44f85dcb563255f3bdd03aefd052253e53c8b631a676beb3edb5ba5858), 56,966 gas | `cast call 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C 'getSlot0(bytes32)(uint160,int24,uint24,uint24)' 0xff4f4e2438f61817271cbd8399a925f5f99a1482f88c55419a2b69d0768e56db --rpc-url $RPC` |
| Liquidity | full range, from what the deployer held (about 10 USDC against 0.004 ETH), liquidity `204325880000` | LIVE, approve [`0x5316bc41…1da1`](https://sepolia.etherscan.io/tx/0x5316bc41036e17cf6c2c74e44a6f651aedfdecc2547bb93a952861858f081da1) then seed [`0x7751ed3d…5be4`](https://sepolia.etherscan.io/tx/0x7751ed3d5f38075a7fac3c70c9466335dd2c8a797b0c9d1896ed2e99dd795be4), 259,843 gas | `cast call 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C 'getLiquidity(bytes32)(uint128)' 0xff4f4e2438f61817271cbd8399a925f5f99a1482f88c55419a2b69d0768e56db --rpc-url $RPC` prints 204325880000 |
| The first settlement attempt | createOrder [`0xd4240fbd…c089`](https://sepolia.etherscan.io/tx/0xd4240fbde823a37ca484bbf90272e71fd6456277a7fe173ea4489acfc9cec089) and pay [`0xc78da1e9…4647`](https://sepolia.etherscan.io/tx/0xc78da1e9bcbed8ec6395e4790fcd417ef2242427850af19ad1733be95cd54647) failed in the deploy block: `DeadlineInPast`, a one-hour deadline computed during forge's simulation and aged out at the keystore prompt that follows it. Cause, fork reproduction and fix in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | FAILED, recorded as it happened | `cast receipt 0xd4240fbde823a37ca484bbf90272e71fd6456277a7fe173ea4489acfc9cec089 --rpc-url $RPC status` prints `0 (failed)` |
| **The settlement through the hook** | order `0x72b25a9b…b8e9` for 0.001 ETH with a 1.5 USDC minimum, recipient = the deployer, created by [`0x51b6d094…1cef`](https://sepolia.etherscan.io/tx/0x51b6d094a9c31a99ffefec5e84f52d5c738e99e44b50dcbc64fbda14b9001cef) and paid by [`0x1120af18…cb83`](https://sepolia.etherscan.io/tx/0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83) through Uniswap's Universal Router. The hook's `SettlementReceipt` v1: `amountIn` 1000000000000000, `amountOut` 2003660, `fee` 0, beside OpenZeppelin's `HookFee`; the recipient's USDC grew by exactly 2.003660; `receiptCount` and `orderCount` 0 to 1; the order is Settled and a replay is refused | LIVE, block 11640026, 281,144 gas | `cast receipt 0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83 --rpc-url $RPC status` prints `1 (success)`; `cast call 0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0 'receiptCount()(uint256)' --rpc-url $RPC` prints `1`; `make readback` prints all of the above |
| Broadcast records | deploy [`run-1788605617356.json`](broadcast/LiveFire.s.sol/11155111/run-1788605617356.json): seven transactions, five receipts (the two failures have none); settlement [`run-1788607248915.json`](broadcast/Interactions.s.sol/11155111/run-1788607248915.json): two transactions, two receipts. The labels the tool printed beside the hashes were shuffled in both; the rows above are from the receipts | committed | `bash docs/proof/verify-live.sh` reads both by hash |
| Source verification | Sourcify: `match` for both contracts, compiler v0.8.30+commit.73712a01, 2026-09-05 | VERIFIED | `curl -s https://sourcify.dev/server/v2/contract/11155111/0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0` prints `"match"`, and the same for the executor; `make verify` re-submits |
| Re-verification script | [`docs/proof/verify-live.sh`](docs/proof/verify-live.sh): 31 pure reads, seen to fail on a fork before the settlement and pass after | 31 of 31 | `bash docs/proof/verify-live.sh` prints `checks run: 31, passed: 31, failed: 0` |

### Historical: the day-1 scaffold

> **Historical day-1 observation-only scaffold; not the current gated implementation.** The
> contract in these rows is `UnicaHook`, deployed and source-verified under that name on day 1
> with `afterSwap` only; it observed swaps and gated nothing. Its evidence is not rewritten. The
> current implementation, `V4SettlementHook` in `src/`, has its own rows above.

LIVE means mined on Ethereum Sepolia with status 1, read back from the chain before it was
written here. `RPC=https://ethereum-sepolia-rpc.publicnode.com` in the commands below.

| Item | Value | Rung | Re-verify |
|---|---|---|---|
| Hook | `0x23b46783709E4A94C229612bfA55580a6682c040`, salt `0x93fb`, flags `0x40` (afterSwap only), 6,051 bytes of runtime code | LIVE, [explorer](https://sepolia.etherscan.io/address/0x23b46783709E4A94C229612bfA55580a6682c040) | `cast code 0x23b46783709E4A94C229612bfA55580a6682c040 --rpc-url $RPC \| wc -c` prints 12105; `make predict` reproduces the address and salt |
| Deploy transaction | [`0x0171976a…b8da`](https://sepolia.etherscan.io/tx/0x0171976a8716d2084890d8cfa155924fcf7b315b03263f1015d6794cee34b8da), block 11635908, 1,392,115 gas, through the CREATE2 factory `0x4e59…956C` | LIVE | `cast receipt 0x0171976a8716d2084890d8cfa155924fcf7b315b03263f1015d6794cee34b8da --rpc-url $RPC status` prints `1 (success)` |
| PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` (Uniswap's official Sepolia deployment) | LIVE | `cast call 0x23b46783709E4A94C229612bfA55580a6682c040 'poolManager()(address)' --rpc-url $RPC` prints it |
| Pool | ETH / USDC, fee 3000, spacing 60, id `0xaffd50d25121496e627f2d9574f160fee32829f04a945de1dbfea5af3668fde7`, initialised at 2,500 USDC per ETH ([`sqrtPriceX96`](script/LiveFire.s.sol#L40) `3961408125713216879677197`) | LIVE, tx [`0xe7cc4bbc…f08b`](https://sepolia.etherscan.io/tx/0xe7cc4bbc094938ca3c74857d585f4e53cecc6161ae579e8838e11a32084df08b), 51,982 gas | `cast call 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C 'getSlot0(bytes32)(uint160,int24,uint24,uint24)' 0xaffd50d25121496e627f2d9574f160fee32829f04a945de1dbfea5af3668fde7 --rpc-url $RPC` |
| Liquidity | 0.008 ETH + 19.999999 USDC, full range, liquidity `400000000000` | LIVE, approve [`0x7e56b7ca…3213`](https://sepolia.etherscan.io/tx/0x7e56b7ca63d2ccf0be66f73f2e728bf20de645581a8aba5de7f9e5fc103e3213) then seed [`0xb5356276…baae`](https://sepolia.etherscan.io/tx/0xb535627674e56b751d88335688021aa2cfc2e34dc6d749dc8f4a920da425baae), 257,782 gas | `cast call 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C 'getLiquidity(bytes32)(uint128)' 0xaffd50d25121496e627f2d9574f160fee32829f04a945de1dbfea5af3668fde7 --rpc-url $RPC` prints 400000000000 |
| **The swap through the hook** | 0.001 ETH exact-input to 2.216294 USDC; the receipt carries the PoolManager's `Swap` event and the hook's `AfterSwapObserved(sender, poolId, delta)` with delta `-1000000000000000 / +2216294`; `afterSwapCount` went 0 to 1 | LIVE, tx [`0x6d580aef…06bf`](https://sepolia.etherscan.io/tx/0x6d580aef7b3d8848fcee555ab8cd7c28fa28c1abeb4d538455be349d0a8a06bf), block 11635908, 166,516 gas | `cast receipt 0x6d580aef7b3d8848fcee555ab8cd7c28fa28c1abeb4d538455be349d0a8a06bf --rpc-url $RPC status` prints `1 (success)`; `cast call 0x23b46783709E4A94C229612bfA55580a6682c040 'afterSwapCount()(uint256)' --rpc-url $RPC` prints `1`; `make readback` prints all of the above |
| Broadcast record | [`broadcast/LiveFire.s.sol/11155111/run-1788555540752.json`](broadcast/LiveFire.s.sol/11155111/run-1788555540752.json): five transactions, five receipts, 1,923,832 gas, identical to the fork rehearsal (the timestamped record; `run-latest.json` is rewritten by every later live run) | committed | `python3 -c "import json;r=json.load(open('broadcast/LiveFire.s.sol/11155111/run-1788555540752.json'));print(len(r['receipts']),sorted(set(x['status'] for x in r['receipts'])))"` prints `5 ['0x1']` |
| Source verification | Etherscan: Source Code Verified, Exact Match, compiler v0.8.30+commit.73712a01, optimizer off, cancun. Sourcify: full match on creation and runtime, verified 2026-09-04T21:18:15Z | VERIFIED, [explorer](https://sepolia.etherscan.io/address/0x23b46783709E4A94C229612bfA55580a6682c040#code) | `curl -s https://sourcify.dev/server/v2/contract/11155111/0x23b46783709E4A94C229612bfA55580a6682c040` prints `"match":"match"`; `make verify` re-submits |
| Proof images and the re-verification script | [`docs/proof/`](docs/proof/README.md): the swap at status 1, its Logs tab with the PoolManager's `Swap` and the hook's `AfterSwapObserved`, the verified source page | committed | `bash docs/proof/verify-day1.sh` prints `checks run: 14, passed: 14, failed: 0` |
| Public surface | not yet (day 5) | pending | |
| Demo video | not yet (day 7) | pending | |

The swap's price impact is large on purpose: the seed is sized to what the deployer held,
and the point of the row is that the callback ran on Uniswap's real PoolManager. The
transaction labels the tool prints beside each hash were shuffled; the mapping above is from
the receipts (target address and function selector), which is the only mapping that counts.

One compiler fact worth knowing: on day 1 this tree pinned no solc, so forge compiled the hook
at 0.8.26 in the test unit (which then needed v4-core's exact-pinned PoolManager) and at 0.8.30
in the script unit, and the script is what deployed. The verified source is the 0.8.30 build,
byte-identical to the chain outside the immutable slots. Since day 2 the tree pins 0.8.30 and
the tests deploy the official PoolManager bytecode from hookmate's artifact instead of compiling
it, so one compiler serves tests, scripts, and verification; `script/verify.sh` still picks the
artifact that matches the chain rather than assuming one.

## The receipt, indexed (optional; The Graph as one consumer)

The receipt is versioned and documented in [`docs/RECEIPT-SCHEMA.md`](docs/RECEIPT-SCHEMA.md)
and frozen as a conformance suite in [`test/ReceiptSchema.t.sol`](test/ReceiptSchema.t.sol).
[`integrations/graph/`](integrations/graph/) is one consumer of it: a subgraph whose data source
takes the hook address and start block from a per-network file, a handler that keys on schema
version one, three matchstick tests around a real local receipt, and a local end-to-end run.
Nothing in the settlement path depends on it; a hook whose receipts nobody indexes settles the
same. It claims no priority over other schemas; see `docs/INTEGRATIONS.md` for what was found.

One command reconstructs a settlement from its log, locally, with no credentials and nothing
broadcast (needs Docker, Node 22, and the pinned tooling installed by `npm install` in that
directory):

```sh
DEPLOYER=0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73 bash integrations/graph/local-e2e.sh
```

It forks Sepolia, deploys and seeds through the repository's own stages, brings up a pinned
graph-node against the fork, deploys the subgraph for that hook address, pays one order through
the executor and Uniswap's official router, and queries:

```graphql
{ settlements { orderId recipient amountIn amountOut hook executor schemaVersion transactionHash logIndex } }
```

Measured 2026-09-05: one `Settlement` entity, `amountIn` 1000000000000000, `amountOut` 2003660 in
real USDC, `hook` and `executor` equal to the deployment; then the same order paid again reverts
on chain and the count stays at one. What that proves: the receipt an indexer reads is the one
the hook emitted inside the settling swap, and a refused settlement leaves no entity. What it
does not prove: anything against a hosted Graph provider, which is the published bar for the
sponsor's track and an owner action not yet taken.

## Security limitations, stated

- The hook keeps no state between callbacks: `beforeSwap` and `afterSwap` each read the order
  from the executor, so a reentrant swap inside the unlock meets the same gate. The reentrancy
  test the spec asks for (T6) is not written yet.
- The executor is the security boundary on UNICA's side: no owner, no upgrade path, no
  `receive`, no access to the PoolManager, bound to one hook and accepting orders only for
  pools that hook guards. The Universal Router is Uniswap's deployment and is trusted as
  Uniswap's code, not audited here.
- The pool allowlist (spec C2) and the payout-asset allowlist (C4) are not implemented. An
  order's input is native ETH by construction; its output currency is whatever pool key the
  order names. A token that delivers less than the pool credited cannot settle an order short
  (the executor measures the recipient), but the allowlist remains the stronger answer.
- What the receipt proves: the order it names was paid through the official router by the
  executor, the pool consumed the whole input and credited at least the minimum, and the
  recipient's balance grew by at least the minimum in the same transaction, since the executor
  reverts otherwise. What it does not prove: anything about the recipient after that
  transaction, or the price the payer would have got elsewhere.
- No audit. Security posture will be scored against the Uniswap Foundation's self-directed
  framework in `SECURITY.md` on day 5.

## Provenance

Three things a judge needs to tell apart, in [`HACKATHON.md`](HACKATHON.md): the disclosed
pre-event specification and threat model in `specs/`; upstream open-source dependencies under
`lib/` with their own licences (v4-core arrives under BUSL-1.1 and is not relicensed; the
dependency layout follows the public `Uniswap/v4-template`, MIT, used as a starter kit and not
cloned); and the implementation written during the event. AI tooling assisted the build and
[`AI_USAGE.md`](AI_USAGE.md) says exactly where; no commit carries an AI co-author.

An earlier settlement-receipt hook by the same author, `Access0x1SwapReceiptHook` in the public
`Access0x1/Access0x1` repository (`src/uniswap/Access0x1SwapReceiptHook.sol`, live-fired on
Sepolia on 2026-08-17), is cited as prior art in the spec and was not copied: it observed and
receipted without gating, and UNICA inverts each of those choices. The admission mechanic
itself follows Uniswap's own guide "Access msg.sender Inside a Hook" and Uniswap Labs'
`PermissionedHooks`; the closest third-party works, what is and is not new, and the sweep's blind
spots are in [`docs/PRIOR-ART.md`](docs/PRIOR-ART.md). NFTeria's private `.click` product is the integrator this hook is designed for: it settles customer
payments and wants pay-in-X, receive-in-Y, atomically, with a receipt. The private product
never enters this repository.

Feedback for the Uniswap engineers who maintain the tools this is built on is captured the hour
it happens in [`FEEDBACK.md`](FEEDBACK.md).

## Licence

MIT, see [`LICENSE`](LICENSE). Dependencies keep their own.





