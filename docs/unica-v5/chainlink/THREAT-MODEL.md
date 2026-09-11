# UNICA v5 / Chainlink — threat model

Engineering record, subordinate to `DEMO-PLAN.md` (this stream) — every mitigation below is a
mechanism that document already names; this file adds no new component of its own. Retrieval date
2026-09-11 unless stated otherwise. Labels: VERIFIED (source cited), PROPOSED (UNICA design),
UNKNOWN. Binding sources, never restated in place of citing them:
`docs/unica-v4/SPEC-CONTRACTS.md` (SC §n), `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` (SO §n),
`docs/unica-v4/THREAT-MODEL.md` (TM §n), `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md`
(CA §n), `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` (SIM §n),
`docs/v2/SECURITY-ADVISORY-001.md` (ADV-001). None of those files is modified here. This document
authorizes no deployment, no workflow registration, no contract change, and no form submission.

## 1. Scope, and the six layers this file keeps separate

Per the assignment, every threat below is filed under exactly one of six layers, matching the six
named in the brief:

| Layer | What it covers here | What it is trusted for |
|---|---|---|
| CRE (workflow + TEE) | The confidential policy workflow of `DEMO-PLAN.md` §4.2 beats 2–3 | Computing an admission verdict from private inputs — never authorizing a payment |
| Receiver contract | The `IReceiver`/`onReport` consumer a CRE forwarder would call — `ChainlinkCREAdapter` (SO §9) if this design ever reaches an on-chain price route, or a purpose-built admission receiver if one is ever built | Authenticating that a report came from the pinned forwarder, workflow id and owner — never that the report's content is correct or final |
| UNICA settlement contracts | The unmodified registry, factory, hook and executor (SC, SO) | Every settlement-critical constraint: payer binding, recipient, oracle band, caps, lifecycle |
| Backend policy | The allowlisted order-creator process (SC §4) that consumes a CRE verdict as advisory input | Naming a real payer and recipient before `createOrder` — the same trust SC already assumes of any order creator |
| Indexer evidence | The Graph subgraph (sibling stream, cited not edited) and any Chainlink-side event log (`ReportProcessed`, §5's watcher) | Evidence of what happened at some past block — never the gate that lets an action proceed |
| Interface warning | The payer's client and any merchant/operator dashboard | Showing a fresh, independent state read before every action a person takes — never a cached or assumed one |

Scope is `DEMO-PLAN.md`'s design only: the confidential invoice/policy workflow, the admission
layer in front of `createOrder`, and the CRE-specific parts of the oracle path. It is not a
restatement of `docs/unica-v4/THREAT-MODEL.md`, which already covers the settlement contracts in
full and is cited by row rather than reproduced.

## 2. Assets

| # | Asset | Held where | Why it matters here |
|---|---|---|---|
| A1 | The merchant's private policy (`maxDeviationBps`, `maxQuoteAgeSeconds`, `minMerchantOut`, `preferredVenue`, `supportedChainIds`) | CRE secrets, read only inside the TEE handler | Its exposure would let a payer or observer reverse-engineer a merchant's pricing strategy; the whole point of routing it through a confidential workflow is that it never has to be public for a payment to settle |
| A2 | The workflow's public result (verdict, evidence class, policy commitment, deviation) | The public schema, `workflow-result.public.json` | The only thing any downstream layer may read; a schema violation here is the entire confidentiality boundary failing |
| A3 | The invoice's public terms (asset, amount, chain, merchant, deadline) | `settlement-intent.public.json`; recomputed by the backend before `createOrder` | The commitment §4.4/§4.5 below is built on |
| A4 | CRE deploy access and Confidential Workflows enrollment status | Chainlink's own account systems, not this repository | Neither is granted today (DEMO-PLAN §2); a false claim of either is a claims-check violation |
| A5 | Every asset SC/SO's own threat model already names (payer funds, the seed, receipt integrity, oracle policy integrity, caps, keys) | Unchanged | Out of this file's scope by reference, not by omission — TM §3 owns them |

## 3. Actors

| Actor | Can | Trusted for | Treated as hostile in |
|---|---|---|---|
| The merchant | Sets its own private policy; is the workflow's intended beneficiary | Naming a real, honest policy | T-CH-2 (a merchant lying about its own policy is out of scope — the workflow enforces what it is given, not that the input is truthful) |
| The payer | Submits an invoice request; later calls `pay(orderId)` | Its own approval, exactly as SC §4 already assumes | T-CH-4, T-CH-5 |
| The backend / order creator | Consumes the workflow's verdict; calls `createOrder` | Recomputing the invoice's public terms independently before acting (DEMO-PLAN §4.2 beat 4) | T-CH-1, T-CH-3, T-CH-9 |
| The CRE workflow (TEE handler) | Reads secrets; returns a schema-bound public result | Computing `decide()` correctly over what it is given — never trusted for anything downstream of that return | T-CH-1 through T-CH-6 (its output is always re-checked, never trusted alone) |
| The CRE forwarder / DON | Delivers a report to a receiver contract | Signing what it delivers — never that the receiver accepted it (§4.7 of `DEMO-PLAN.md`) | T-CH-7 |
| A relayer or mempool observer | Reads pending calldata; could attempt to front-run an order creation | Nothing | T-CH-3 |
| An indexer | Reports what it has processed | Nothing beyond its own lag being shown (T-CH-10) | T-CH-10 |
| Chainlink's own infrastructure (a DON, a forwarder, a verifier) | Publishes or delivers signed data | An authenticated value at its own timestamp, re-validated by the receiving contract — never final correctness | §5 (unavailability) |

## 4. Threats, by layer

### 4.1 CRE (workflow + TEE)

| ID | Threat | Mitigation | Layer that enforces it | Status |
|---|---|---|---|---|
| T-CH-1 | **A private policy field leaks into the public result.** A code change, a debug log, or a schema drift lets `maxDeviationBps` or another private field reach `workflow-result.public.json`. | `additionalProperties: false` on the public schema (a new field needs a deliberate schema change beside it); the existing confidentiality test suite already proves the public result, error paths, and calldata never carry a planted canary, with a control proving the same suite WOULD catch one (SIM §3–§4, 18 checks). | CRE (schema + test) | SPECIFIED, already proven for a different subject; not yet exercised for the invoice subject (DEMO-PLAN §7 step 3) |
| T-CH-2 | **The simulator is mistaken for a real TEE**, and a private value is treated as safe to log because "it only appears in the simulator." | The simulator's own printed disclaimer is the design's premise, not an inconvenience: production logs are hidden by the TEE; the simulator shows them for debugging and says so outright. No log statement inside a handler is treated as safe merely because today's run is simulated (SIM §4, quoting Chainlink's own "Don't log in production Confidential Workflows" guidance). | CRE (developer discipline, checked by `script/check-cre-confidentiality.sh`) | SPECIFIED |
| T-CH-3 | **The workflow's PROCEED verdict is treated as sufficient authorization for a payment.** | The one design rule this whole stream inherits: CRE may decide whether to *attempt* a payment; only the hook and executor decide whether a payment is *valid* on chain. A verdict is advisory input to the backend, never a call the backend forwards unchecked (`integrations/chainlink-cre-robinhood/README.md`; DEMO-PLAN §4.1, §4.6). | Backend policy, then UNICA settlement contracts | SPECIFIED |
| T-CH-4 | **A stale settlement quote reaches `decide()`** and produces a PROCEED verdict against a price no longer current. | `quoteIsFresh(quoteAtSeconds, nowSeconds, maxAgeSeconds)`, already built and unit-tested; a stale quote returns `REJECT_STALE_QUOTE` before the deviation check runs (`policy.mjs`). This is the workflow's own advisory floor — the binding staleness check is the hook's `OracleStale` at settlement (SO §4.1 step 7), unaffected by anything the workflow decided earlier. | CRE (advisory) + UNICA settlement contracts (binding) | SPECIFIED (CRE) + SPECIFIED, not deployed (UNICA) |
| T-CH-5 | **A deviation between the reference and settlement quote is missed or miscomputed.** | `deviationBps` is computed and checked against the merchant's private `maxDeviationBps` before any PROCEED (`policy.mjs`); the workflow's own floor check is explicitly commented as advisory, not the protection — the binding floor is the order's `minOut`, enforced by the hook and re-measured by the executor (`policy.mjs`'s own comment, quoted in TM's own vocabulary as belt-and-suspenders, never as the sole guard). | CRE (advisory) + UNICA settlement contracts (binding, SO §4.2, T-OR-6) | SPECIFIED |
| T-CH-6 | **An unsupported chain is silently accepted.** | `policy.supportedChainIds.includes(intent.chainId)` checked first, before any quote logic; failure returns `REJECT_UNSUPPORTED_CHAIN` (`policy.mjs`). | CRE (advisory) | SPECIFIED |

### 4.2 Receiver contract

| ID | Threat | Mitigation | Layer | Status |
|---|---|---|---|---|
| T-CH-7 | **A forwarder transaction is mined while the receiver's own logic rejected the report** (DEMO-PLAN §4.7 — the verified lead). `KeystoneForwarder.report()` delivers through a low-level call that swallows a revert; the outer transaction does not revert, and the per-report outcome is only visible in the `ReportProcessed` event's own boolean. | No layer above the receiver may treat "the forwarder transaction has status 1" as proof of delivery. The correct check reads the per-report success field of the emitted event, or the receiver's own state for the specific value expected — never the outer transaction alone. This closes the gap SO §9's `ChainlinkCREAdapter` leaves open: its own `onReport` checks are sufficient for the receiver's *own* correctness, but a watcher or backend observing from outside must independently check the per-report field, which SO §9 does not itself state. | Receiver contract (its own checks) + indexer evidence (the watcher reading `ReportProcessed`) | VERIFIED mechanism; no receiver contract exists yet in this design to exhibit it |
| T-CH-8 | **Wrong chain, wrong receiver, wrong workflow, or a replayed/expired report reaches a receiver that accepts it anyway.** | `onReport` checks, unmodified from SO §9: `msg.sender == FORWARDER` (`NotForwarder`); workflow id and owner (`WorkflowMismatch`, `WorkflowOwnerMismatch`); `chainId == block.chainid` (`ReportChainMismatch`); `receiver == address(this)` (`ReportReceiverMismatch`); strictly increasing observation time (`ReportNotNewer`); for the Streams route, `expiresAt >= block.timestamp` (`ReportExpired`, SO §8). | Receiver contract | SPECIFIED, simulation-only (SO §9); not deployed anywhere |
| T-CH-9 | **The simulation forwarder is mistaken for a production one**, because the same address that is one chain's simulation-only forwarder is another chain's real production forwarder (CA §4a: the 46630 simulation forwarder's address is Ethereum mainnet's real one). | The constructor-level refusal is per chain, never global: each chain file names its own simulation forwarder and the adapter refuses it at construction (`ForwarderIsSimulationOnly`, SO §9). | Receiver contract construction + backend policy (which chain file is loaded) | SPECIFIED, not deployed |

### 4.3 UNICA settlement contracts

Every row in this section is already SC's or SO's own, cited rather than restated; this file adds
no new mitigation to the settlement contracts, only names which of their existing rows this design
depends on.

| ID | Threat | Mitigation (cited) | Status |
|---|---|---|---|
| T-CH-10 | Wrong payer | `WrongPayer` (SC §9.1, T-SET-2) | SPECIFIED, not deployed |
| T-CH-11 | Stale oracle at settlement, regardless of what the workflow decided earlier | `OracleStale` (SO §4.1 step 7, T-OR-1) | SPECIFIED, not deployed |
| T-CH-12 | Paused or retired market accepting an order the admission layer approved | `MarketNotActive` (SC §5, T-LC-1); RETIRED terminal (T-LC-3) | SPECIFIED, not deployed |
| T-CH-13 | Excessive deviation between the CRE-approved reference and the pool's actual execution | The oracle band, `ExecutionBelowOracleBand`/`ExecutionAboveOracleBand` (SO §4.2, T-OR-6) — enforced independently of and after anything CRE decided | SPECIFIED, not deployed |
| T-CH-14 | A signed, relayer-submitted authorization is ever introduced to make the admission layer's decision bindable off-chain | UNICA v4 has no signature primitive anywhere in the order path (TM §7.7, mechanism absence); introducing one is gated behind the signed-intent security review TM §7.7 names, which starts from `ADV-001`'s recommended fix. This design adds none and recommends none. | SPECIFIED (the gate); this design does not open it |

### 4.4 Backend policy

| ID | Threat | Mitigation | Status |
|---|---|---|---|
| T-CH-15 | **A CRE-approved invoice's merchant, amount, or asset is substituted between the workflow's verdict and the `createOrder` call** — the admission-layer analogue of `ADV-001`'s class. | The backend recomputes the invoice's public terms independently (a fresh ENS resolution for the merchant, the payer-displayed amount and asset) and refuses to call `createOrder` unless they match what the workflow's public result committed to (DEMO-PLAN §4.2 beat 4, §4.4). PROPOSED reason: `InvoiceCommitmentMismatch` — no on-chain mechanism exists for this check; it is an admission-layer refusal, and its absence is exactly what would make this class reachable. | PROPOSED; not built |
| T-CH-16 | **A revoked terminal is treated as still authorized to create orders** because its ENS `com.unica.terminal-status` record has not yet been written to `revoked`. | The ENS record is discovery-only and never gates order creation by itself; the backend/device role-table disable is what actually stops it, and a terminal's on-chain order-creator allowlist entry (`NotOrderCreator`, SC §9.1) is a second, independent gate. A revoked ENS record alone, with neither of the other two also revoked, leaves the terminal capable of nothing UNICA_ONCHAIN or BACKEND_POLICY actually gates — it can still write a stale status text field, which is a display residual, not a payment risk (`docs/unica-v5/ens/POS-TERMINALS.md` §5, sibling stream, cited not edited). | Backend policy (primary) + ENS (secondary, display-only) | DESIGNED (sibling stream) |
| T-CH-17 | **The backend treats "the CRE CLI simulation ran without error" as equivalent to "this workflow is trustworthy in production."** | The simulator's own disclaimer is the standing counter-evidence: it is explicitly not a real TEE and shows what production hides (SIM §4). No claim in this design or in `DEMO-PLAN.md` describes a simulated run as production-equivalent; the demo format both tracks accept names CLI simulation as sufficient *evidence for a hackathon submission*, which is a narrower claim than "sufficient for a production trust decision," and this design does not conflate the two. | Backend policy (documentation discipline) | SPECIFIED |

### 4.5 Indexer evidence

| ID | Threat | Mitigation | Status |
|---|---|---|---|
| T-CH-18 | **A `ReportProcessed` failure (success = false) is missed because a watcher only checks the forwarder transaction's own status**, restated from T-CH-7 at the evidence layer specifically. | Any watcher or indexer this design ever builds must read the per-report success field of `ReportProcessed`, keyed by receiver and report id, not merely whether a transaction to the forwarder address exists. | PROPOSED; no watcher exists yet |
| T-CH-19 | **A settlement or a CRE delivery is treated as final before it actually is** ("missing finality," DEMO-PLAN §5 row 14). | No receipt, report, or delivery is shown as authoritative before the chain's own finality point; an indexer's lag is a displayed fact, never a hidden one — the same convention `docs/unica-v4/EVENT-SCHEMA.md` §2 and `docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` §4.0 (sibling stream, cited not edited) already state for UNICA settlement events, extended here to any CRE-sourced event this design consumes. | PROPOSED for this design; the convention it reuses is already stated elsewhere |

### 4.6 Interface warning

| ID | Threat | Mitigation | Status |
|---|---|---|---|
| T-CH-20 | **The payer's review screen shows the confidential workflow's verdict as if it were the final settlement outcome**, inviting the payer to treat a PROCEED as a completed payment. | The interface shows the workflow's verdict as one step among several (invoice accepted, order created, payment pending, settled) and never collapses them; this mirrors the existing rule that a dashboard shows what an order was bound to when created, never a cached or assumed later state (`docs/unica-v5/ens/PAYMENT-BINDING.md` §2 item 4, sibling stream). | PROPOSED; no interface exists yet |
| T-CH-21 | **A merchant's dashboard displays a private policy value it should never have received**, because a debugging build or a misconfigured secret mapping exposed it outside the enclave. | The interface layer has no code path that reads CRE secrets directly; it reads only the public schema (`workflow-result.public.json`) and UNICA's own on-chain state. This is a consequence of T-CH-1's mitigation, not a separate one. | Interface (by construction, given T-CH-1 holds) |

## 5. CRE unavailable

Stated once, applying to the whole design, in the same shape `docs/experimental/
CRE-CONFIDENTIAL-SIMULATOR.md` §6 already states for the existing simulator-only integration:

- **No confidential-policy order is issued.** If the workflow cannot be reached, times out, or
  returns anything outside `workflow-result.public.json`'s schema, the backend does not call
  `createOrder` for that invoice. There is no fallback verdict, no cached prior decision reused for
  a new invoice, and no default-to-PROCEED path.
- **Existing valid orders continue under their own contract rules.** An order already created
  before CRE became unavailable is governed entirely by SC §9.1 and SO §4 — `pay(orderId)`,
  the oracle band, caps, and lifecycle checks all run exactly as if CRE had never existed, because
  none of them reads CRE state (TM §7.7's "mechanism absence," restated: the settlement contracts
  have no CRE dependency to lose).
- **Nothing already created is altered.** CRE's unavailability cannot revoke, modify, or replay an
  order, a receipt, or a payment — there is no code path from "the workflow is down" to any write
  against `_orders[orderId]` storage, because the workflow never had one to begin with (DEMO-PLAN
  §4.1: CRE decides whether to *attempt*, never whether something already committed is valid).
- **Settlement correctness depends on no off-chain query.** Every check that actually gates a
  payment — payer binding, recipient, oracle freshness and band, caps, lifecycle state — is
  evaluated from on-chain state alone at the moment of `pay()` (SC, SO throughout). A CRE outage
  degrades this design to "no new confidential-policy invoice can be admitted," never to "an
  existing payment settles incorrectly."

This is a restatement of the SIM §6 trust boundary ("No contract in this repository trusts a
workflow result... every settlement-critical constraint is enforced by [the settlement contracts]
and holds with CRE absent, stale, unavailable or hostile"), extended to name the specific
consequence for order admission rather than the treasury-guardian subject SIM was written for.

## 6. Residual risks, accepted and stated

Nothing below is prevented; each is bounded as its row says.

1. A merchant can configure a dishonest or self-defeating private policy (T-CH-2's actor table);
   the workflow enforces the policy it is given, never that the policy is wise.
2. A revoked terminal's operating key can still write a stale ENS status field until its own EAC
   grant is separately revoked (T-CH-16; `docs/unica-v5/ens/POS-TERMINALS.md` §5's own residual,
   inherited unchanged).
3. Every residual UNICA v4 already accepts (TM §9) applies unchanged to any order this design's
   admission layer approves — the admission layer adds a check before `createOrder`; it removes
   none of TM's own accepted residuals after it.
4. Until a receiver contract and a watcher actually exist, T-CH-7/T-CH-18's mitigation is a stated
   design requirement, not a proven one — there is nothing yet to mutation-test.
5. This design's CLI-simulated demo slice (DEMO-PLAN §6) proves the confidentiality boundary and
   the policy logic; it proves nothing about a live DON, a live forwarder, or a live receiver,
   because none is exercised by a local simulation.

## 7. Sources

| Source | URL | Retrieved | Author/org | Kind | Used for |
|---|---|---|---|---|---|
| `docs/unica-v5/chainlink/DEMO-PLAN.md` (this stream) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | throughout — the design every mitigation here belongs to |
| `docs/unica-v4/SPEC-CONTRACTS.md`, `SPEC-ORACLE-AND-CHAINS.md`, `THREAT-MODEL.md` (this repository) | n/a — local files | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §4.2–§4.3 — every cited error name and row |
| `docs/v2/SECURITY-ADVISORY-001.md` (this repository) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §4.3 T-CH-14, §4.4 T-CH-15 — the signed-intent class this design does not reopen |
| `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` (this repository) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §5 — the trust-boundary statement this section restates for a new subject |
| `integrations/chainlink-cre-robinhood/policy.mjs`, `schemas/` (this repository) | n/a — local files | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §4.1 — the existing, tested decision logic and public schema |
| `docs/unica-v5/ens/POS-TERMINALS.md`, `PAYMENT-BINDING.md` (sibling stream) | n/a — local files | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §4.4 T-CH-16, §4.6 T-CH-20 — terminal revocation and identity-vs-settlement separation |
| `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` (this repository) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §4.2 T-CH-9 — the shared-address simulation/production forwarder finding |
| `smartcontractkit/chainlink-evm`, `KeystoneForwarder.sol` | https://github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/v1/KeystoneForwarder.sol | 2026-09-11 | Chainlink (smartcontractkit) | OFFICIAL | §4.2 T-CH-7 — the low-level receiver call and per-report event |
| CRE — Confidential Workflows concepts | https://docs.chain.link/cre/concepts/confidential-workflows | 2026-09-11 | Chainlink | OFFICIAL | §4.1 T-CH-2 — the simulator-is-not-a-TEE disclaimer |

## 8. Unknowns

1. Whether the per-report `success` field of `ReportProcessed` (T-CH-7) is exposed anywhere a
   standard indexer (The Graph included) would index by default, or whether a purpose-built watcher
   would need to specifically decode it — not checked in this document.
2. Whether `ChainlinkCREAdapter`'s own `onReport` (SO §9) already reverts loudly enough that T-CH-7
   is moot for UNICA's *own* receiver specifically (as opposed to a third party's), versus still
   needing an external watcher for defense in depth — SO §9 specifies the checks but this document
   does not re-derive whether a revert inside `onReport` is itself swallowed the same way a
   receiver's own internal failure would be; the KeystoneForwarder mechanism (T-CH-7) treats any
   non-reverting-but-unsuccessful outcome and any reverting outcome the same way (both surface only
   as `success=false`), which suggests the answer is that the watcher check is needed regardless of
   how carefully `onReport` itself is written — but this has not been fork-tested for this design.
3. Whether Confidential Workflows access (the private-beta form, `DEMO-PLAN.md` §2) would need to
   be requested before any receiver contract could ever go live, independent of the generic
   `cre account access` request already submitted — MENTOR-QUESTIONS.md §Q7 answers what the docs
   say; whether Chainlink's review process treats the two as sequential or independent is UNKNOWN.
4. Whether a future UNICA v4 build would place the admission-layer commitment check (T-CH-15) in
   the backend alone, or partly on-chain (e.g., a hash the CRE workflow commits to that
   `createOrder` itself checks) — not designed here; `DEMO-PLAN.md` §4.2 beat 4 states only that no
   payer-signed version of it is ever introduced, not which of the two off-chain shapes is chosen.
5. Whether the residual named in item 2 of §6 (a revoked terminal's stale ENS write) is judged
   acceptable by the owner once this design reaches a build phase, or whether the automation named
   as unbuilt in `POS-TERMINALS.md` §6 item 3 would be required first — an owner/product decision,
   not settled here.
