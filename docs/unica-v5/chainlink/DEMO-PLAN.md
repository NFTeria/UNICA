# UNICA v5 / Chainlink — demo plan

Engineering record. Track: **From Scratch** (owner ruling, 2026-09-11). Retrieval date 2026-09-11
unless a claim states otherwise. Labels: VERIFIED (source cited), PROPOSED (UNICA design),
UNKNOWN. Reads against `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` (cited CA §n),
`docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` (cited SIM §n), `integrations/chainlink-cre-robinhood/`
and `integrations/chainlink-cre-guardian/` (this repository's existing, simulator-only Chainlink
work), `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` (cited SO §n) and `docs/unica-v4/THREAT-MODEL.md`
(cited TM §n). Nothing in this document modifies any of those files, any v4 contract, or any
application code; nothing here is deployed, requested, signed, or broadcast. Cites, without
editing, `docs/unica-v5/graph/` and `docs/unica-v5/ens/` (sibling streams).

No transcript of any Chainlink channel discussion reached this document. One item repeated in the
assignment brief — that a CRE write can report success while the receiver-level result is false —
is treated as an unverified lead and checked against Chainlink's own source below (§4.7); it is
not assumed true or false from the brief alone.

## 1. Purpose

Design "Private Invoice, Publicly Verifiable Payment": a merchant-terminal checkout in which a
Chainlink Confidential Workflow computes a private eligibility/pricing decision over a payer's
invoice request, an authenticated oracle prices the settlement, and Uniswap v4 settles atomically
against UNICA's own payer-bound order — then judge that design honestly against what this
repository can actually run today, and recommend the build sequence, with its cut line, that
follows from the judgment.

## 2. What exists today (recap; the cited files hold the detail)

| Fact | Status | Source |
|---|---|---|
| A pure policy-decision module (`decide()`): verdict, evidence class, a policy commitment, a deviation figure — never the policy itself | BUILT, unit-tested offline | `integrations/chainlink-cre-robinhood/policy.mjs`, `tests/policy.test.mjs` |
| The same subject's schemas (`workflow-result.public.json`, `settlement-intent.public.json`) and its secret-name mapping | BUILT | `integrations/chainlink-cre-robinhood/schemas/`, `secret-names.yaml` |
| No workflow entry (`workflow/main.ts`) wired to the CRE CLI for this subject | NOT BUILT | `integrations/chainlink-cre-robinhood/` file listing, this session |
| A different subject (treasury reserve policy) actually run through the real CRE CLI, with a TEE handler reached and secrets loaded inside it | RUN — simulator only, never a live DON | `integrations/chainlink-cre-guardian/`, SIM §2–§3, `docs/feedback/chainlink.md` |
| Repository scan refusing seven confidentiality and claim defects, 12 checks including controls | BUILT, passing | `script/check-cre-confidentiality.sh`, SIM §5 |
| `cre account access` (generic hosted-DON deploy access) submitted, awaiting review | SUBMITTED, not granted | `docs/feedback/chainlink.md` |
| Confidential Workflows enrollment (a separate, invite-only private-beta form) | NOT SUBMITTED | `MENTOR-QUESTIONS.md` Q7, §7 below |
| UNICA v4 registry/factory/hook/executor and its three Chainlink oracle adapters | SPECIFIED, **not built** | `docs/unica-v4/SPEC-CONTRACTS.md`, SO throughout |
| ChainlinkFeedAdapter demonstrated against real Chainlink contracts | Fork-only (Arbitrum One, OF1–OF8), not deployed | SO §7, §15 |
| ChainlinkCREAdapter | SPECIFIED, simulation-only, not deployable (CRE hosted writes to any chain UNCONFIRMED; deploy approval not enabled) | SO §9, CA §4 |
| ENS merchant root and a terminal-identity design (ENS discovery only, no financial authority) | DESIGNED, not deployed | `docs/unica-v5/ens/NAMESPACE.md` §2, `POS-TERMINALS.md` (sibling stream, cited not edited) |

## 3. Prize tracks, read fresh today

Fetched 2026-09-11 from the general prizes page and the dedicated Chainlink subpage, and re-fetched
a second time the same day to resolve an earlier misreading of this section (below); both pages are
quoted, and they agree on every figure in the table below — there is no conflict between them.

| Track | Prize (as read) | Pool restriction | Core requirement (quoted) | Demo format (quoted) |
|---|---|---|---|---|
| Best Confidential Workflow | **$2,000 total, up to 2 teams at $1,000 each** — stated identically on the general prizes page and the dedicated Chainlink page. A separate **$3,000** figure also appears on the dedicated page: it is that page's own stated total Chainlink sponsorship across all three tracks ($2,000 + $500 + $500), not a competing amount for this one track. An earlier version of this table read the $3,000 pool total as a second, conflicting figure for this track specifically; `PRIZE-FIT.md` §2 (this stream's companion file, two independent fetches) already carried the corrected reading, and this row now matches it | **None stated** — no "Continuity Track only" language on either page | "Build a CRE Workflow that uses the Confidential Workflows to execute a meaningful part of the application," must "register and use a confidential TEE handler," must "process at least one sensitive input" | "Demonstrate a successful execution through either: A Confidential Workflow simulation using the CRE CLI or a live deployment on the CRE network" |
| Best Chainlink-Powered Upgrade | $500 | **"This prize is only available to Continuity Track participants"** — closes it to this repository's From Scratch entry | "Integrate at least one Chainlink service directly within smart contract logic or onchain workflows... must contribute to a state change on a blockchain" | not applicable — pool-closed |
| Automated Liquidation Protection Challenge | $500 | Join via a fixed smart-contract challenge before the submission deadline; **"not constrained to either pool"** | Protect a virtual ETH-collateral/debt position with a Confidential Workflow during simulated market movements | via the challenge's own contract, not this design |

**What this table does and does not establish.** It establishes, with a citation, that the Upgrade
track is Continuity-only (matching and reconfirming `docs/feedback/chainlink.md`'s 2026-09-05
reading) and that the Confidential Workflow track states no such restriction. It does **not**
establish that UNICA qualifies for anything — that a track's page states no pool restriction is a
fact about the page, not a ruling on this repository's submission; see MENTOR-QUESTIONS.md Q1 for
what still needs a Chainlink team member's written word. `docs/SPONSOR-ELIGIBILITY.md` §2
(2026-09-09, SUPERSEDED note) separately declined to select Chainlink because "the workflow runs
in Chainlink's own simulator and has never executed in a TEE, and a track claim needs execution
evidence a judge can see" — that reasoning predates today's fetch of the track's own accepted demo
format, which names CLI simulation as one of exactly two sufficient forms of evidence (this table,
column 5). This document flags the tension; it does not reopen or overrule that ledger entry,
which belongs to the owner (MENTOR-QUESTIONS.md Q1).

The Liquidation Protection Challenge is a fixed subject already explored by
`integrations/chainlink-cre-guardian/` and `docs/feedback/chainlink.md` (a different subject —
treasury/collateral protection, not payment settlement) and is not this design's target; it is
recorded here only so the three tracks are not confused with one another.

## 4. The full design — "Private Invoice, Publicly Verifiable Payment"

### 4.1 Layers, kept separate (reused vocabulary from the ENS sibling stream, adapted)

| Layer | What it is here | Trusted for |
|---|---|---|
| ENS (merchant/terminal discovery) | Resolves the merchant's payout identity and reads a terminal's `com.unica.terminal-status` before an order exists | Discovery only — never re-read after order creation (`docs/unica-v5/ens/PAYMENT-BINDING.md` §2, §3, sibling stream) |
| CRE confidential workflow | A TEE handler that reads a merchant's **private** policy (from CRE secrets, the mechanism already built, `secret-names.yaml`) and a public settlement quote, and returns a public verdict, evidence class, policy commitment and deviation (the existing `decide()` shape) | Computing an admission decision — never authorizing a payment |
| Receiver / CRE adapter | The on-chain contract a CRE forwarder would call (`onReport`), or, in the buildable-today path, nothing at all — the verdict is consumed off-chain by the backend | Authenticating that a report came from the pinned forwarder and workflow — never that the report is correct or final (§4.7) |
| Backend / order-creator (BACKEND_POLICY) | An allowlisted order creator (SC §4, §9.1) that takes the workflow's PROCEED verdict as advisory input and calls `createOrder` with terms it independently recomputes | Naming a real payer and recipient — SC's own trust boundary, unchanged |
| UNICA settlement contracts (UNICA_ONCHAIN) | The unmodified, SPECIFIED-NOT-BUILT registry/hook/executor of `docs/unica-v4/` | Every settlement-critical constraint: payer binding, recipient, amount, oracle band, caps, lifecycle |
| Oracle adapter | One of the three SO adapters, unmodified | An authenticated price at its own timestamp, re-validated by the hook |
| Indexer (GRAPH_EVIDENCE) | The Graph subgraph, sibling stream | Evidence, never the gate that lets an action proceed |
| Interface (CLIENT_VERIFICATION) | The payer's review screen | A fresh, independent read before every payer action — never a cached resolution |

**The one design rule this whole layer set inherits, unchanged:** "CRE may decide whether to
attempt a payment. Only the hook and executor decide whether a payment is valid on chain."
(`integrations/chainlink-cre-robinhood/README.md`.) The admission layer below adds a decision
point **before** `createOrder`; it adds no trust to anything after it.

### 4.2 The seven beats

1. **ENS merchant and terminal.** The payer's client resolves the merchant's name and reads the
   terminal's status record (`com.unica.terminal-status`, `docs/unica-v5/ens/RECORDS.md` §6.9,
   `POS-TERMINALS.md` §3–§4, sibling stream). Status: DESIGNED, not deployed. Neither record binds
   any payment; both are discovery only (`PAYMENT-BINDING.md` §2).
2. **Confidential invoice request.** The payer's client (or the terminal's backend, on the payer's
   behalf) submits a `SettlementIntent`-shaped request (asset, amount, chain id, merchant, deadline
   — the public half already schema'd in `integrations/chainlink-cre-robinhood/schemas/
   settlement-intent.public.json`) to a CRE workflow.
3. **Policy computation, inside the TEE.** The workflow's `handlerInTee` loads the merchant's
   private policy from CRE secrets (`secret-names.yaml`'s existing mapping) and a settlement quote,
   and calls the existing `decide()` function unmodified. **What crosses the enclave boundary**
   (`workflow-result.public.json`, `additionalProperties: false`): a verdict
   (`PROCEED`/`REJECT_*`), an evidence class (`mock`/`simulated`; `confirmed` is reserved and the
   function throws on it, SIM §6), a policy commitment (a digest, not the policy — never an
   attestation), and a deviation figure. **What never crosses it:** `maxDeviationBps`,
   `maxQuoteAgeSeconds`, `minMerchantOut`, `preferredVenue`, `supportedChainIds` — the private
   policy fields themselves.
4. **An exact order authorization.** Not a payer-signed off-chain message — UNICA v4 has no
   signature primitive anywhere in its order path by design (TM §7.7, `mechanism absence`), and
   this design adds none. "Authorization" here means: the backend (an allowlisted order creator,
   SC §4) recomputes the invoice's public terms independently of the workflow's verdict — merchant
   address (freshly ENS-resolved), asset, amount, chain, deadline — and refuses to call
   `createOrder` unless those terms match what the payer's own client displayed and what the
   workflow's public result committed to (§4.7's reconciliation step; PROPOSED, no on-chain
   mechanism, an admission-layer check only). **This step must never grow into a payer-signed,
   relayer-submitted authorization** — that is exactly the class Advisory 001 breaks
   (`docs/v2/SECURITY-ADVISORY-001.md`), and TM §7.7 gates any signed-intent path behind a security
   review this design does not open.
5. **A payer-bound order.** `createOrder` then `pay(orderId)`, unmodified SC §9.1: `WrongPayer` if
   anyone but the named payer calls `pay`; every term fixed in storage at creation, never re-read
   from ENS or from the workflow after (`PAYMENT-BINDING.md` §2 items 1–4).
6. **The authenticated oracle supplying price.** At settlement, the hook checks price through one
   of SO's three adapters — unmodified, none deployed. The only one with **any** demonstration
   against real Chainlink contracts is `ChainlinkFeedAdapter` on an Arbitrum One fork (SO §7, §15
   OF1–OF8); `ChainlinkCREAdapter` (SO §9) is simulation-only and undeployable today (CA §4,
   deploy approval not enabled). A live version of this beat, if ever built, uses the fork-proven
   feed route — not a live CRE price report.
7. **Uniswap v4 settling atomically, and an authenticated receipt.** The hook's oracle-band check
   (SO §4) and the executor's single-transaction swap-and-deliver (SC §8–§9), then
   `SettlementReceipt`/`Settled` (SC §11) — accepted downstream only from the registry's own
   `getMarket(id).hook`/`.executor` (T-ID-2). **None of this exists as deployed code.** UNICA v4's
   contracts are specified and merged as documentation; they are not built (task brief, "WHAT
   EXISTS TODAY"; SO throughout marks every adapter "not deployed").

### 4.3 What the full design would actually require, stated once

Beat 6 and 7 need UNICA v4's contracts built and, for a CRE-priced route, CRE deploy approval
granted — neither is true today (§2). Beat 3 needs no such thing: it runs entirely inside the CRE
CLI's local simulator, which the track's own accepted demo format allows outright (§3). This gap
between beat 3 and beats 6–7 is the entire honest judgment of §6.

### 4.4 A note on case 2–4: this design adds no signature, so it adds no Advisory-001 surface

Cases 2 through 4 are closed **before** an order exists (an admission-layer recomputation) or by
fields that are write-once **after** one exists (SC §9.1) — never by a payer's signature that a
relayer could rebind to different terms, because no such signature exists anywhere in this design
or in UNICA v4 (TM §7.7). This is stated explicitly because it is the property that makes this
design structurally different from the `v2.0.0-rc1` defect in `docs/v2/SECURITY-ADVISORY-001.md`,
not merely differently tested.

### 4.5 CRE unavailable

Detailed layer-by-layer in `THREAT-MODEL.md` §5; stated once here as a design constraint: no
confidential-policy order is issued while CRE is unreachable, unavailable, or returns anything
outside the schema; every already-created order continues to be governed only by UNICA's own
contract rules; nothing already created is altered; and settlement correctness never depends on a
CRE query succeeding at the moment of `pay()` (CRE's decision, if any, is spent entirely before
`createOrder` — SIM §6's own trust boundary, unchanged: "No contract in this repository trusts a
workflow result").

### 4.6 Trust boundary, restated for this design

No settlement contract in this design would ever treat a CRE verdict, a policy commitment, or an
evidence class as proof that a payment is valid — that determination is, and stays, `docs/unica-v4/
SPEC-CONTRACTS.md` and `SPEC-ORACLE-AND-CHAINS.md`'s alone. This repository's own scanner already
refuses the shape of claim that would say otherwise (`script/check-cre-confidentiality.sh`, SIM
§5). CA §3's own phrasing is reused throughout this document rather than a stronger one: a verifier
checks report signatures on chain, and this design's receiver contract checks a forwarder's signer
configuration on chain. This document confirms neither a signer nor an execution environment for
anything this repository has deployed, because nothing described in §4 has been deployed anywhere.

### 4.7 The verified lead: a CRE write can report transaction success while the receiver's own logic rejected it

**VERIFIED**, `smartcontractkit/chainlink-evm`,
`contracts/cre/src/v1/KeystoneForwarder.sol` (commit `92897847daa3ba26ac2796ef284f57e6f3d1ca2a`,
same file CA §4b already cites for `IReceiver`), retrieved 2026-09-11. The forwarder's `report()`
function delivers a report to the receiver through a low-level call inside inline assembly, which
returns a plain boolean rather than propagating a revert. When that boolean is false, the
forwarder does **not** revert its own transaction: it records the delivery's own success flag as
false and continues, and it emits an event naming the receiver, the workflow execution id, the
report id, and that same boolean, regardless of which value the boolean took. **So a forwarder
transaction with status 1 (mined, not reverted) proves only that the forwarder's own logic ran to
completion — never that the specific receiver's `onReport` logic accepted the report.** A consumer
that checks only "did the forwarder transaction succeed" cannot distinguish a delivered, accepted
report from a delivered, rejected one; the two are told apart only by that per-report success
field in the emitted event, or by the receiver's own state actually changing.

**What this fixes in this design.** No layer above may treat "the forwarder transaction is mined"
as evidence that a price, or any other CRE-delivered value, actually reached this design's
receiver contract. The correct check — stated once, applying to every future receiver this design
or `docs/unica-v4/` ever builds — is: read the per-report success value the forwarder's own event
carries, or read the receiver's own storage for the specific value expected, never the outer
transaction's status alone. This is the same discipline SO §9's `ChainlinkCREAdapter` already
applies by requiring `onReport` to check its own preconditions and revert on failure at the
point of delivery — its remaining gap, closed here, is that a **watcher** or **backend** observing
the chain from outside must check the per-report success field too, not only "a transaction to the
forwarder happened."

## 5. Adversarial cases

Each row names the layer that actually refuses it, the mechanism, and the exact reason code where
one is already specified; a case with no existing on-chain mechanism is marked PROPOSED and states
what would have to be built. "Missing finality" and the receiver-success case are consumer-side
risks, not contract reverts, and are marked as such rather than forced into the revert shape.

| # | Case | Layer | Mechanism | Exact refusal / reason code | Status |
|---|---|---|---|---|---|
| 1 | Wrong payer | UNICA_ONCHAIN | `pay(orderId)` checks `msg.sender == order.payer` | `WrongPayer(id, payer, caller)` | SPECIFIED (SC §9.1, T-SET-2) |
| 2 | Changed merchant | Admission layer (backend) | Recomputed recipient (fresh ENS read) must match the invoice's public commitment before `createOrder`; after creation, `recipient` is write-once (SC §9.1) and the payer's review screen re-reads it from chain, never from cache (T-SET-5 surface rule) | PROPOSED reason: `InvoiceCommitmentMismatch` (no on-chain mechanism; an admission-layer refusal) | PROPOSED |
| 3 | Changed amount | Admission layer, then UNICA_ONCHAIN | Same commitment check pre-creation; `amountIn`/`minOut` write-once after (SC §9.1) | `InvoiceCommitmentMismatch` (pre-creation, PROPOSED); `OutputBelowMinimum`/`RecipientShort` if it reaches settlement anyway (SC §9.3, T-SET-6) | PROPOSED + SPECIFIED |
| 4 | Changed asset | UNICA_ONCHAIN / oracle route | `IUnicaOracleRoute(adapter).feedIdFor` must match `policy.feedId`, checked by STATICCALL before every price read (S8, SO §3) | `OracleFeedMismatch(marketId, expected, actual)` | SPECIFIED (T-OR-3) |
| 5 | Wrong chain | Receiver contract (CRE adapter) | `onReport` checks the report's own `chainId == block.chainid` | `ReportChainMismatch` | SPECIFIED, simulation-only (SO §9) |
| 6 | Wrong receiver | Receiver contract | `onReport` checks `receiver == address(this)` | `ReportReceiverMismatch` | SPECIFIED, simulation-only (SO §9) |
| 7 | Wrong workflow | Receiver contract | Workflow id and owner from the forwarder's metadata checked against pinned immutables | `WorkflowMismatch`, `WorkflowOwnerMismatch` | SPECIFIED, simulation-only (SO §9) |
| 8 | Replayed report | Receiver contract | Strictly-increasing observation/report timestamp | `ReportNotNewer` | SPECIFIED (SO §8, §9, T-OR-10) |
| 9 | Expired report | Receiver contract (Streams route) | `expiresAt >= block.timestamp` | `ReportExpired` | SPECIFIED (SO §8, T-OR-10) |
| 10 | Revoked terminal | ENS (discovery) + BACKEND_POLICY | A revoked `com.unica.terminal-status` record does **not**, by itself, stop order creation — the backend/device role-table disable is what actually does, and a terminal's on-chain order-creator allowlist entry is a second, independent gate | No single reason code — this is a two-layer property, not one revert (`POS-TERMINALS.md` §4.7, §5; `NotOrderCreator` at SC §9.1 if the on-chain allowlist entry was also removed) | SPECIFIED (on-chain half) + DESIGNED (ENS half) |
| 11 | Stale oracle | UNICA_ONCHAIN | `block.timestamp - t <= policy.maxAge` | `OracleStale(marketId, age, maxAge)` | SPECIFIED (SO §4.1 step 7, T-OR-1) |
| 12 | Paused market | UNICA_ONCHAIN | `createOrder`/`pay` require ACTIVE | `MarketNotActive` | SPECIFIED (SC §5, T-LC-1) |
| 13 | Counterfeit receipt | Indexer / any consumer | Emitter authentication: accept `SettlementReceipt` only from `getMarket(id).hook`, `Settled` only from `.executor` | No contract-level error — a consumer-side refusal rule (T-ID-2, SC §3) | SPECIFIED |
| 14 | Missing finality | Indexer / interface | A receipt or a forwarder's report is not treated as authoritative before the chain's own finality point; an indexer's lag is shown, never hidden | No contract-level error — a consumer-side rule (`docs/unica-v4/EVENT-SCHEMA.md` §2; `docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` §4.0's finality-status convention, sibling stream, cited not edited) | PROPOSED for this design; the convention it reuses is already stated elsewhere |
| 15 | A write marked successful whose receiver rejected it | Receiver contract / forwarder | §4.7 above | `ReportProcessed(receiver, workflowExecutionId, reportId, success=false)` — a **separate** event field from the forwarder's own transaction status | VERIFIED mechanism (§4.7); no UNICA contract exists yet to exhibit it |

## 6. Honest judgment: the full design versus a smaller alternative

**The full design above cannot be built this event.** Beats 6 and 7 need UNICA v4 contracts that
do not exist and, for the CRE-priced variant, deploy approval this repository does not hold; even
the fork-demonstrated `ChainlinkFeedAdapter` route needs those same not-yet-built registry, hook
and executor contracts to attach to. Nothing about Chainlink's own infrastructure blocks it — the
blocker is entirely this repository's own v4 contract status (§2), which this stream does not
authorize changing.

**What is actually buildable this event, with existing pieces:** wire
`integrations/chainlink-cre-robinhood/policy.mjs`'s already-tested `decide()` logic into a real
`workflow/main.ts` — the exact thin-entry pattern `integrations/chainlink-cre-guardian/` already
proved runs (`handlerInTee`, the `secret-names.yaml` mapping already written, `bun >= 1.4.2`, SIM
§2) — and run it through `cre workflow simulate`. That satisfies every line of Track 1's own
accepted demo format (§3, column 5: "a Confidential Workflow simulation using the CRE CLI") without
touching a single v4 contract, without CRE deploy access of any kind (confirmed not required for
local simulation, `MENTOR-QUESTIONS.md` Q7), and without any ENS or Uniswap dependency at all.

**Recommendation: ship the smaller alternative.** Beats 1–5 of the full design (ENS discovery,
the confidential invoice request, the policy computation, the admission-layer commitment check,
and the payer-bound order call) describe the **target architecture** this simulated workflow is
the first increment of; beats 6–7 stay documented, not demoed, until UNICA v4 is built. Presenting
the full seven-beat flow as a working demo this event would overstate what runs; presenting the
CLI-simulated policy decision alone, honestly labelled as one buildable slice of a larger design,
does not.

## 7. Minimal build sequence, cut order stated

1. Write `integrations/chainlink-cre-robinhood/workflow/main.ts`, importing the existing
   `policy.mjs` unmodified, following `chainlink-cre-guardian`'s already-proven thin-entry pattern.
2. Wire `secret-names.yaml` (already written) into the workflow's `secretsNames`; run
   `cre workflow simulate` locally against synthetic values, exactly as SIM §2–§3 already
   demonstrates for the guardian subject.
3. Confirm the confidentiality boundary holds for this subject the same way `tests/
   confidentiality.test.mjs` already proves for its own fixtures — the public result never carries
   `maxDeviationBps`, `minMerchantOut`, `preferredVenue`, or `supportedChainIds`.
4. Record the run (exit code, the simulator's own TEE disclaimer, the public result) as this
   stream's own evidence file, in the same shape SIM records its guardian run — not written here,
   since writing it is outside this document's assignment.
5. **Cut here for this event.** Everything past this line — an actual receiver contract, a live
   forwarder delivery, ENS terminal deployment, and any UNICA v4 contract — is the target
   architecture of §4, explicitly not attempted, because each depends on work this stream does not
   own (v4 contracts) or access this repository does not hold (CRE deploy approval, Confidential
   Workflows private-beta enrollment).

## 8. Sources

| Source | URL | Retrieved | Author/org | Kind | Used for |
|---|---|---|---|---|---|
| ETHOnline 2026 prizes page | https://ethglobal.com/events/ethonline2026/prizes | 2026-09-11 | ETHGlobal | OFFICIAL | §3 — pool definitions, general prize amount |
| ETHOnline 2026 Chainlink prize subpage | https://ethglobal.com/events/ethonline2026/prizes/chainlink | 2026-09-11, re-fetched same day | ETHGlobal | OFFICIAL | §3 — per-track requirement text, and the page's own total-pool figure that an earlier reading of this section had misattributed to Track A alone |
| CRE — Confidential Workflows concepts | https://docs.chain.link/cre/concepts/confidential-workflows | 2026-09-11 | Chainlink | OFFICIAL | §4.2, §4.6 — enclave boundary, what leaves it |
| CRE — deploying workflows | https://docs.chain.link/cre/guides/operations/deploying-workflows | 2026-09-11 | Chainlink | OFFICIAL | §2, §6 — deploy-access approval mechanics |
| CRE — requesting Confidential Workflows access | https://docs.chain.link/cre/account/confidential-workflows-access | 2026-09-11 | Chainlink | OFFICIAL | §2, §6 — the separate private-beta form; local simulation needs no approval |
| `smartcontractkit/chainlink-evm`, `KeystoneForwarder.sol` | https://github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/v1/KeystoneForwarder.sol | 2026-09-11 | Chainlink (smartcontractkit) | OFFICIAL | §4.7 — the low-level receiver call and the per-report success event |
| `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` (this repository) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | throughout — feed/Streams/CRE/CCIP availability for 46630 and elsewhere |
| `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` (this repository) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §4.2, §5 — adapter mechanics and error names |
| `docs/unica-v4/THREAT-MODEL.md` (this repository) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §4.4, §5 — T-SIG-1..3, T-OR rows |
| `docs/v2/SECURITY-ADVISORY-001.md` (this repository) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §4.4 — the signed-intent class this design does not reopen |
| `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` (this repository) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §2, §4.6, §7 — simulator run evidence and trust boundary |
| `integrations/chainlink-cre-robinhood/` (this repository) | n/a — local files | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §4.2, §7 — the existing policy module, schemas, secret names |
| `docs/unica-v5/ens/NAMESPACE.md`, `POS-TERMINALS.md`, `PAYMENT-BINDING.md` (sibling stream) | n/a — local files | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §4.1, §4.2, §5 row 10 — merchant/terminal identity and revocation semantics |
| `docs/SPONSOR-ELIGIBILITY.md` (this repository) | n/a — local file | 2026-09-09/10 | UNICA / NFTeria | TEAM GUIDANCE | §3 — the standing SUPERSEDED reasoning this document flags but does not overrule |
| `docs/feedback/chainlink.md` (this repository) | n/a — local file | 2026-09-05/08/11 | UNICA / NFTeria | TEAM GUIDANCE | §2, §3 — prior Upgrade-track finding, deploy-access submission status |

## 9. Unknowns

1. **RESOLVED, not an open unknown — kept at this position rather than deleted.** An earlier version
   of this item asked whether "Best Confidential Workflow" is $2,000 or $3,000 in total, describing
   the general prizes page and the dedicated Chainlink subpage as disagreeing. They do not: both
   state $2,000 total for this track, and $3,000 is the dedicated page's own stated total Chainlink
   pool across all three tracks (§3, corrected). This item is corrected in place, not removed and
   renumbered, because `docs/unica-v5/ens/OPEN-QUESTIONS.md` and `docs/unica-v5/graph/OPEN-QUESTIONS.md`
   each cite one of this list's later items by number (item 2 and item 6 respectively) and this
   document does not shift a sibling stream's citation out from under it.
2. Whether the absence of a stated pool restriction on that track means it is open to this
   repository's From Scratch entry, as a matter of ETHGlobal's own judging practice rather than of
   page text alone — MENTOR-QUESTIONS.md Q1. Needs written confirmation.
3. Whether `docs/SPONSOR-ELIGIBILITY.md`'s 2026-09-09 decision not to select Chainlink should be
   revisited given today's reading of the track's own accepted demo format (§3) — an owner
   decision, not something this document settles or attempts to settle.
4. Whether UNICA v4's contracts will be built before 2026-09-16, which would change whether beats
   6–7 of §4 become reachable this event — an owner/build-sequence decision this stream does not
   make.
5. Whether the receiver-success finding of §4.7 has any analogue in the Data Streams `VerifierProxy`
   path (a `verify()` call reverting versus a caller treating a mined transaction as sufficient) —
   not checked in this document; CA §3d already establishes that `verify()` is state-changing and
   that neither Verifier contract enforces expiry, which is a related but distinct property.
6. Whether a live version of beat 3 (an actual TEE-handler workflow for the invoice subject) would
   surface any of the toolchain traps `docs/feedback/chainlink.md` already found for a different
   workflow (the bun version trap, the `tsconfig.json` scope trap) — not tested for this subject;
   recorded as a build-time risk to expect, not a finding.
