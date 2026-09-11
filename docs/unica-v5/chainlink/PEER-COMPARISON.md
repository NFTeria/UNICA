# UNICA v5 — Chainlink: peer comparison

Engineering record. Retrieval date for every source below is 2026-09-11 unless a row states
otherwise. Track: FROM SCRATCH (owner-confirmed 2026-09-11; `docs/PROVENANCE-LEDGER.md`). Labels:
VERIFIED (source cited), PROPOSED (UNICA design choice, not a claim about the sponsor),
DOCUMENTED_NOT_OBSERVED, UNKNOWN.

## 0. No channel transcript was supplied

No Chainlink channel discussion transcript, and no named peer project, reached this document.
Nothing below attributes an idea, a claim, a workflow shape, or a line of code to any such
discussion or to any other team's project. Per the standing instruction governing this stream,
every reference in the originating brief to a channel discussion or a named peer is treated as an
**UNVERIFIED LEAD** and is not repeated as fact. Instead, this document compares UNICA's Chainlink
work against **Chainlink's own published CRE template catalogue and concept documentation** —
`github.com/smartcontractkit/cre-templates` and `docs.chain.link/cre` — which is the closest thing
to an official reference implementation a judge would hold any Confidential Workflow submission
against. No template's code is copied, read for reuse, or reproduced beyond short quoted
descriptions from the templates hub page; every UNICA mechanism described below traces to this
repository's own files, cited by path.

## 1. Scope and current status

Chainlink is **not one of the three integrations UNICA has submitted.** Per
`docs/SPONSOR-ELIGIBILITY.md` (correction dated 2026-09-09, TEAM GUIDANCE, first-party): "Chainlink
is **not one of the three submitted integrations** and is **not part of the submitted integration**
set... The workflow runs in Chainlink's own simulator and has never executed in a TEE, and a track
claim needs execution evidence a judge can see. The three submitted integrations are **Uniswap v4,
ENSv2 on Sepolia and The Graph**." This document does not reverse, edit, or contradict that status.
It is research toward a possible future reconsideration, addressed directly in
`docs/unica-v5/chainlink/PRIZE-FIT.md` §11, and changes nothing in `docs/SPONSOR-ELIGIBILITY.md`.

What exists in this repository today, read in full for this comparison:

| Path | What it is | Runs a CRE handler? |
|---|---|---|
| `integrations/chainlink-cre-guardian/workflow/` | A complete CRE workflow: `main.ts`, `guardian.ts`, `workflow.yaml`, `config.staging.json`, `secret-names.yaml`, `main.test.ts`. Depends on `@chainlink/cre-sdk` `1.18.0` (`package.json`). | **Yes.** `guardian.ts` imports `handlerInTee` from `@chainlink/cre-sdk` and calls it (line 472, confirmed by direct read). |
| `integrations/chainlink-cre-robinhood/` | `policy.mjs` (pure decision logic), two JSON Schemas (`schemas/`), `secret-names.yaml`, `fixtures/quotes.json`, two test files. `git ls-files` for this directory lists no `workflow.yaml` and no workflow entry file. | **No.** A `workflow/` directory exists on disk but is empty and untracked — `git ls-files integrations/chainlink-cre-robinhood/` returns nine files, none under `workflow/`. This is a decision-logic and confidentiality-boundary module, not a runnable CRE workflow, as of this reading. |
| `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` | The written record of three `cre workflow simulate` runs against `integrations/chainlink-cre-guardian/`, a toolchain finding (bun version), and the 18-check/12-check confidentiality evidence. | N/A — a record, not code. |
| `script/check-cre-confidentiality.sh` | A repository scanner (12 checks, five controls) refusing committed canaries, populated secrets, key-shaped material, tracked credential files, private field names in fixtures, and the two claim shapes this document must also avoid (§6, below). | N/A — a gate, not a workflow. |

**Only `integrations/chainlink-cre-guardian/` currently registers and uses a confidential TEE
handler.** `integrations/chainlink-cre-robinhood/` is a policy and schema layer without a workflow
entry point today; any comparison below that credits UNICA with "using `handlerInTee`" is
specifically about the guardian workflow, not the Robinhood-quote policy module, and this
distinction is preserved through every dimension below rather than blended.

## 2. Method

Twelve dimensions, each judged against (a) what Chainlink's own CRE template catalogue and concept
documentation name as the target shape for a Confidential Workflow, and (b) what
`integrations/chainlink-cre-guardian/` and `integrations/chainlink-cre-robinhood/` currently do,
stated plainly where the second falls short of the first. Every dimension ends with an honest
verdict; none is skipped because the honest answer is unflattering. Chainlink's own concept page
states the standard this comparison holds UNICA to as much as any peer: "Your handler's source code
and compiled binary are not confidential just because part of its logic runs inside an enclave" —
`docs.chain.link/cre/concepts/confidential-workflows`, OFFICIAL, retrieved 2026-09-11.

## 3. The twelve dimensions

### 3.1 Meaningful confidential computation

**What Chainlink asks for.** The prize page's own wording: "Build a CRE Workflow that uses the
Confidential Workflows to execute a meaningful part of the application," and separately,
"Integrate meaningfully into core functionality (not placeholder code)" —
`ethglobal.com/events/ethonline2026/prizes/chainlink`, OFFICIAL, ETHGlobal / Chainlink, retrieved
2026-09-11 (fetched twice, agreeing both times on every quoted phrase in this document). Three of
Chainlink's own templates put actual decision logic inside the enclave: **Automated Liquidation
Protection** ("Automatically protect DeFi lending positions by continuously monitoring liquidation
risk and executing collateral management"), **Automated Portfolio Rebalancing** ("continuously
monitoring allocation drift and executing adjustments"), and **AI Smart Contract Audit Firewall**
("Automatically analyze and screen smart contract interactions before execution to detect and
block malicious transactions") — all three listed with capabilities "Confidential Workflows/TEE,
secrets, HTTP" or "Confidential Workflows/TEE, secrets" on `github.com/smartcontractkit/cre-templates`
(via `docs.chain.link/cre-templates`, OFFICIAL, retrieved 2026-09-11).

**What UNICA has.** `integrations/chainlink-cre-guardian/workflow/guardian.ts` runs the treasury
policy decision — a reserve-floor and per-action-cap check against a merchant's read treasury
position — inside the `handlerInTee` call (confirmed at line 472 by direct read), not outside it.
The decision inputs five private policy values loaded as CRE secrets
(`docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` §3, run 2 and 3). This is the same shape as
Chainlink's own liquidation-protection and rebalancing templates: a monitored position, a private
threshold, a bounded action decided inside the enclave.

**Where UNICA is honestly weaker.** Every one of Chainlink's own templates is, in this repository's
own reading, equally unproven beyond the CLI simulator unless its builder has separately obtained
DON access — Chainlink's templates hub does not itself demonstrate a live TEE run any more than
UNICA's does. What UNICA cannot claim, and does not: that the computation has ever executed inside
a real enclave. `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` §3 records the simulator printing
its own disclaimer — "The simulator is not a real TEE" — at the exact point the handler ran.
**Verdict: PARTIAL PARITY.** The computation is meaningful and structurally matches the named
template shapes; the execution environment is DOCUMENTED_NOT_OBSERVED for a real TEE, identically
to any unlaunched template.

### 3.2 Confidential inputs

**What Chainlink asks for.** "Process at least one sensitive input, secret, confidential API
response, private parameter, or intermediate value inside the enclave" —
`ethglobal.com/events/ethonline2026/prizes/chainlink`, OFFICIAL. The concept page names what is
protected by construction: "Secrets the Vault DON releases into the enclave," "sensitive inputs
and intermediate values you don't explicitly share outside the enclave," and "capability calls
made from inside the enclave" — `docs.chain.link/cre/concepts/confidential-workflows`, OFFICIAL,
retrieved 2026-09-11.

**What UNICA has.** Both integrations name their private inputs explicitly rather than leaving the
boundary implicit. `integrations/chainlink-cre-robinhood/README.md`'s data-boundary table lists,
under PRIVATE: quote-source credential, maximum reference/execution deviation, merchant policy
thresholds, preferred route or venue policy, simulation policy, transaction-submission
configuration. `integrations/chainlink-cre-guardian/`'s five CRE secrets (loaded via
`secretsNames` → environment-variable substitution, confirmed by run 1's own failure message in
`docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` §3) are the guardian's policy thresholds. Five
distinct sensitive inputs is more than the "at least one" the rule requires.

**Verdict: MEETS THE NAMED BAR**, for the guardian workflow specifically, at the level the
simulator can show (DOCUMENTED_NOT_OBSERVED for a real enclave, per §3.1).

### 3.3 Minimal public outputs

**What Chainlink asks for.** Nothing on the prize page constrains output size; the concept page's
own warning cuts the other way — outputs are the discipline the *builder* must apply, not one CRE
enforces: "Reports, transaction calldata, and any output you deliver outside the enclave boundary"
are explicitly **not** automatically protected —
`docs.chain.link/cre/concepts/confidential-workflows`, OFFICIAL. Chainlink supplies the boundary;
keeping what crosses it small is the workflow author's job.

**What UNICA has.** `integrations/chainlink-cre-robinhood/schemas/workflow-result.public.json`
enforces this at the schema level, not merely by convention: `additionalProperties: false` with
exactly four required fields — `verdict`, `evidence`, `policyCommitment`, `deviationBps` — and the
schema's own description states the reason: "so a private value cannot be added by accident — a
new field is a deliberate act with a schema change beside it." `policy.mjs`'s `_result()` function
(confirmed by direct read) constructs literally nothing else. `policyCommitment` is a plain,
explicitly-labeled non-cryptographic digest ("**IT IS NOT AN ATTESTATION and proves nothing about
where the code ran**," `policy.mjs` line 94) — a commitment to the policy, never the policy itself.

**Verdict: STRONGER THAN THE NAMED BAR.** A schema-enforced `additionalProperties: false` output
contract is a stricter minimal-output discipline than anything Chainlink's own rule text requires
or than a template's example code demonstrates on the templates hub page as read.

### 3.4 On-chain enforcement

**What Chainlink asks for/documents.** Chainlink's own consumer-contract guide places the
enforcement burden entirely on the receiving contract: "The receiver is responsible for discarding
stale reports" —
`github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/v1/interfaces/IReceiver.sol`,
OFFICIAL, quoted also in `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` §4b. CRE delivers a
report; it does not itself validate the report's content against the receiving contract's own
rules.

**What UNICA has.** The design rule stated in `integrations/chainlink-cre-robinhood/README.md`: "CRE
may decide whether to attempt a payment. Only the hook and executor decide whether a payment is
valid on chain," and "No contract in this repository trusts a workflow result." This is the
correct-shaped discipline Chainlink's own guide asks for, taken to its logical end: rather than
building a receiver contract that must re-validate a CRE report, UNICA currently builds **no**
receiver contract at all, so there is nothing for a CRE report to reach on chain. A direct
repository search for `IReceiver`, `onReport`, or `KeystoneForwarder` across every `.sol` file in
`src/` and `integrations/` returns zero hits outside vendored `node_modules`.

**Verdict: HONEST GAP, NOT A CLAIM.** UNICA's on-chain enforcement principle is correctly stated in
prose and matches Chainlink's own documented consumer-contract discipline, but it is
DOCUMENTED_NOT_OBSERVED as Solidity: there is no `IReceiver`-implementing contract in this
repository to point a judge at, and this document does not pretend otherwise.

### 3.5 Replay protection

**What Chainlink provides.** `KeystoneForwarder.route()` — read directly from source at the same
commit `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` already cites — keys a `Transmission`
struct by a `transmissionId` and guards re-delivery: `if (transmission.success ||
transmission.invalidReceiver) revert AlreadyAttempted(transmissionId);` (line 142,
`contracts/cre/src/v1/KeystoneForwarder.sol`, commit `92897847daa3ba26ac2796ef284f57e6f3d1ca2a`,
`github.com/smartcontractkit/chainlink-evm`, OFFICIAL, retrieved 2026-09-11). This protects the
forwarder-to-receiver leg: the same report cannot be routed to the same receiver twice.

**What UNICA has.** `integrations/chainlink-cre-robinhood/policy.mjs`'s evidence-class guard is a
different kind of replay-adjacent protection: `decide()` throws if asked to produce any evidence
class outside `PRODUCIBLE_EVIDENCE` (`mock`, `simulated`), so a `confirmed` result — the class that
would license real settlement — cannot be manufactured by this workflow under any input, tested by
`tests/confidentiality.test.mjs`'s stated control. This guards against a different attack than
`AlreadyAttempted`: not re-delivery of a genuine report, but a report claiming a confirmation tier
it never earned.

**Verdict: DIFFERENT LAYERS, BOTH NAMED HONESTLY.** Chainlink's forwarder-level replay guard is a
mechanism this repository has read and cited, not one it has built or needs to rebuild — no
`KeystoneForwarder` interaction exists here (§3.4). UNICA's own evidence-class guard solves an
adjacent problem the forwarder's guard does not address at all. Neither substitutes for the other,
and this document does not conflate them.

### 3.6 Economic consequence

**What Chainlink's own tracks ask for, exactly.** Track 1 (Best Confidential Workflow) states no
requirement that the workflow trigger a state change — "Demonstrate successful execution via CRE
CLI simulation or live network deployment with evidence" is satisfied by simulation alone.
Track 2 (Best Chainlink-Powered Upgrade, Continuity-only, not eligible to UNICA per §1) is explicit
where Track 1 is silent: "The Chainlink integration must contribute to a state change on a
blockchain" — `ethglobal.com/events/ethonline2026/prizes/chainlink`, OFFICIAL. Track 3 (Automated
Liquidation Protection Challenge) ties the workflow to real economic stakes by construction: a
joined position is scored against a live scenario the Chainlink team runs, per the same page.

**What UNICA has.** Neither `integrations/chainlink-cre-guardian/` nor
`integrations/chainlink-cre-robinhood/` has ever produced a chain write, broadcast a transaction,
or moved value — nothing here signs or broadcasts, per this document's own standing constraint and
per every existing README in both directories. The guardian workflow's published result carries a
policy commitment and a bounded action class, never executed. The Robinhood-quote policy's
`PROCEED` verdict is advisory: `policy.mjs` line 78's own comment states "The workflow's own floor
check is ADVISORY. The binding floor is the order's `minOut`, enforced on chain by the hook and
re-measured by the executor."

**Verdict: NO ECONOMIC CONSEQUENCE TODAY, BY DESIGN, NOT BY ACCIDENT.** This is the dimension where
UNICA's own house rule (§3.4) and a track's likely preference for demonstrable stakes pull in
opposite directions; `docs/unica-v5/chainlink/PRIZE-FIT.md` §6 carries the resulting tension forward
as a named risk rather than resolving it here.

### 3.7 Oracle integrity

**What Chainlink documents, generally.** Chainlink's own price-feed and data-streams discipline —
decimals read live, staleness bounded to the feed's own heartbeat, a sequencer-uptime check where
one exists, a report's `marketStatus` field checked rather than improvised — is documented at
length in `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` §8, itself built from
`docs.chain.link/data-feeds/*` and `docs.chain.link/data-streams/*`, OFFICIAL. Chainlink's Track 2
(Continuity-only) separately names "Price Feeds, Data Streams, Proof of Reserve" as eligible
technologies for a different, non-CRE prize.

**What UNICA has.** `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` is primary-source,
partly-live-verified research (on-chain reads against a Robinhood Chain testnet RPC, `cast
codesize`, `cast call`) establishing precisely what a TSLA/NFLX-consuming adapter can and cannot
rely on today, and closing with fourteen general validation rules an oracle-consuming adapter must
enforce. This is deeper, independently-checkable oracle-integrity work than a CRE Confidential
Workflow submission requires — it belongs structurally to Chainlink's Data Feeds/Data Streams
surface, not to the CRE track this comparison otherwise evaluates.

**Verdict: STRONG, BUT ORTHOGONAL.** This is a real UNICA strength on general Chainlink engagement
and should not be folded into a CRE Confidential Workflow narrative as if it were the same
evidence — `docs/unica-v5/chainlink/PRIZE-FIT.md` §11 names the risk of that conflation directly.

### 3.8 Receiver verification

**What Chainlink's own forwarder does, read from source.** `KeystoneForwarder.route()` invokes the
receiver with a raw `call`, not a `try/catch`, and the call's boolean outcome does not propagate as
a revert: "`success := call(remainingGas, receiver, 0, add(payload, 0x20), mload(payload), 0x0,
0x0)`" (line 160), after which `if (success) { s_transmissions[transmissionId].success = true; }`
(lines 163–165) — the function then simply `return`s that boolean rather than reverting on `false`.
A separate view function, `getTransmissionInfo`, exposes a `TransmissionState` enum distinguishing
`SUCCEEDED` from `FAILED` (line 194) — a caller who only checks that the **outer** transaction
carrying the `route()` call did not revert **cannot** tell, from that fact alone, whether the
receiver's own `onReport` logic succeeded; that requires reading `getTransmissionInfo` or the
`ReportProcessed` event separately. Source: same file and commit as §3.5,
`contracts/cre/src/v1/KeystoneForwarder.sol`, OFFICIAL, retrieved 2026-09-11 (fetched directly, not
via a search summary). This is the mechanism behind the brief's own flagged concern that a CRE
delivery transaction can complete without the receiver-level outcome being true — confirmed here
against Chainlink's own source rather than assumed from the brief.

**What UNICA has.** No `IReceiver`-implementing contract exists in this repository (§3.4), so there
is no UNICA-authored receiver-verification code to compare against this mechanism today. What
exists instead is the prose design rule ("no contract trusts a workflow result") that would, if a
receiver were ever built, need to check exactly this: a report's delivery status separately from
its content, and its content against the contract's own bounds, never treating "the write did not
revert" as equivalent to "the receiver accepted it."

**Verdict: A REAL FINDING, NOT YET A BUILT DEFENSE.** This document confirms, against Chainlink's
own current source, a receiver-verification hazard any future UNICA CRE-to-contract integration
would have to design around explicitly; it is recorded here as an input to that future design, not
as a defect in anything UNICA has shipped, since nothing here consumes a CRE report on chain yet.

### 3.9 Identity integration

**What Chainlink's own tracks name.** Track 2's eligible technologies list — "CRE (including
Confidential Workflows), Price Feeds, Data Streams, Proof of Reserve, or VRF" — names no identity
product, and no Chainlink CRE template in the catalogue (§3.1) integrates an identity system.
Identity is simply not a dimension either Chainlink track asks a Confidential Workflow submission
to address.

**What UNICA has, and does not have.** This repository has a substantial, separately-documented
ENS agent-identity design (`docs/unica-v5/ens/AGENT-IDENTITY.md`, a sibling stream, cited here and
not edited) describing a delegated agent's ENSv2 leaf identity and its authority scope. **No
connection exists between that work and either Chainlink CRE integration** — the guardian
workflow's treasury-policy decision and the Robinhood-quote policy's verdict carry no ENS-resolved
identity of any kind, and nothing in `integrations/chainlink-cre-guardian/` or
`integrations/chainlink-cre-robinhood/` reads, writes, or references an ENS name.

**Verdict: NOT INTEGRATED, AND NOT REQUIRED.** Recorded honestly as a gap rather than invented as a
cross-stream synergy that does not exist in the code. Chainlink's own tracks do not ask for it, so
this is not scored as a weakness against the prize criteria, only stated as a fact against the
dimension named in this comparison's own brief.

### 3.10 Evidence and indexing

**What Chainlink's own rule accepts as evidence.** "Demonstrate successful execution via CRE CLI
simulation or live network deployment with evidence (demo video, logs, or deployment details)" —
`ethglobal.com/events/ethonline2026/prizes/chainlink`, OFFICIAL. Chainlink names no evidence-tiering
convention of its own; a simulator log is treated, by the page's own wording, as sufficient
evidence in itself.

**What UNICA has.** Two layers beyond a bare log: an evidence-class vocabulary
(`mock`/`simulated`/`confirmed`, with `confirmed` structurally unreachable per §3.5) carried in the
public schema itself, and a repository scanner
(`script/check-cre-confidentiality.sh`, 12 checks / 5 controls) that runs on every gate rather than
being a one-time claim. `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` records **18 of 18**
confidentiality-suite checks passing, including two deliberate controls — a planted canary IS
detected, and a context including the private policy DOES leak — proving the check can fail before
trusting that it passes. No Graph indexing of any CRE output exists in this repository; that
capability, where it exists at all, is built for on-chain settlement receipts
(`integrations/graph/`, a sibling sponsor's integration, not wired to Chainlink CRE in any file
read for this comparison).

**Verdict: STRONGER EVIDENCE DISCIPLINE THAN THE BAR REQUIRES, NO INDEXING.** The gate-run,
control-proven scanner and the schema-enforced evidence vocabulary exceed what a bare simulator log
would show; there is no query-able historical record of CRE decisions anywhere in this repository
today.

### 3.11 Product necessity

**What this asks.** Whether Chainlink CRE is load-bearing for UNICA's product or removable without
loss — the same test ENS's and The Graph's own prize pages state explicitly ("central to the
product, not a cosmetic add-on"; a sponsor's own product page, cited in
`docs/unica-v5/ens/PRIZE-FIT.md` §5 and `docs/unica-v5/graph/PRIZE-FIT.md` §4, TEAM GUIDANCE,
sibling streams). **Chainlink's own CRE prize page does not use this wording** — its bar is lower:
"a meaningful part of the application," "not placeholder code" (§3.1). This is a genuine
asymmetry between sponsors worth stating plainly rather than importing a stricter bar Chainlink's
own page does not set.

**What UNICA has.** By its own stated design rule, Chainlink CRE is explicitly and permanently
**advisory** in UNICA's architecture: "CRE may decide whether to attempt a payment. Only the hook
and executor decide whether a payment is valid on chain"
(`integrations/chainlink-cre-robinhood/README.md`). Removing the CRE workflow entirely would not
change whether any UNICA settlement can occur — it would only remove a pre-flight advisory check
that avoids submitting a transaction that would revert (`policy.mjs` line 78's own comment). This is
the opposite of load-bearing under the ENS/Graph-style test, and is a deliberate security property
(no CRE dependency for settlement correctness), not an oversight.

**Verdict: NOT LOAD-BEARING, BY DESIGN — MEETS THE LOWER BAR, NOT THE STRICTER ONE.** Chainlink's
own Track 1 wording ("meaningful," "not placeholder") is arguably satisfied by the guardian
workflow's real treasury-policy computation; the stricter "central, not cosmetic" standard other
sponsors publish is not, and this document does not blur the two. `PRIZE-FIT.md` §6 carries this
tension into the eligibility discussion rather than resolving it unilaterally here.

### 3.12 Demo clarity

**What Chainlink's own rule permits.** As quoted in §3.10, a CLI simulation with logs is explicitly
named as adequate evidence — a materially lower production bar than a live on-chain demo. The
general ETHGlobal rule still applies: "a 2-4 minute demo video" —
`ethglobal.com/events/ethonline2026/info/details`, OFFICIAL, retrieved 2026-09-11 (fetched twice,
agreeing both times).

**What UNICA could show today, without building anything new.** A recorded `cre workflow simulate`
run against `integrations/chainlink-cre-guardian/`, reproducing the three-run sequence already
performed and written up in `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` §2–§3: the documented
`wasm unreachable` toolchain finding (bun `1.2.5` vs `1.4.2`), the simulator printing "Handler
requested TEE Execution," and the run ending on a distinct, unrelated error
(`invalid BigInt literal`) with zero of five planted canaries appearing in the simulator's own
output. This is a genuinely narratable sequence — a real toolchain bug found and fixed, a real
confidentiality boundary tested by trying to break it — rather than a bare "it compiled" claim.

**Verdict: BUILDABLE WITHOUT NEW WORK.** The clearest, most honestly-narratable demo material
already exists in this repository's own written record; nothing about demo clarity is a blocker
here, unlike §3.4/§3.6/§3.8's honest gaps.

## 4. Summary table

| # | Dimension | UNICA today | Verdict |
|---|---|---|---|
| 1 | Meaningful confidential computation | Real decision logic inside `handlerInTee`, matching Chainlink's own template shapes | Partial parity — real TEE execution DOCUMENTED_NOT_OBSERVED |
| 2 | Confidential inputs | Five named private inputs (guardian secrets; Robinhood-quote policy fields) | Meets the named bar |
| 3 | Minimal public outputs | `additionalProperties: false` schema, four fields, an explicitly-non-attesting commitment | Stronger than the named bar |
| 4 | On-chain enforcement | Correct design principle in prose; no `IReceiver` contract exists | Honest gap |
| 5 | Replay protection | Chainlink's forwarder-level guard cited, not built here; UNICA's own evidence-class guard solves a different problem | Different layers, both named |
| 6 | Economic consequence | Zero chain writes from either integration, by design | No consequence today, by design |
| 7 | Oracle integrity | Deep, live-verified Data Feeds/Data Streams research | Strong, but orthogonal to the CRE track |
| 8 | Receiver verification | A real hazard confirmed in Chainlink's own source; no UNICA defense built (nothing to defend yet) | Finding, not yet a built defense |
| 9 | Identity integration | No connection to the ENS agent-identity stream | Not integrated, not required |
| 10 | Evidence and indexing | 18/18 confidentiality checks with controls; 12/12 gate scan; no CRE indexing | Stronger discipline, no indexing |
| 11 | Product necessity | Explicitly advisory-only by design | Not load-bearing; meets the lower published bar |
| 12 | Demo clarity | A real, already-written three-run toolchain-and-boundary story | Buildable without new work |

## 5. What this document does not claim

No eligibility, ranking, or judging outcome. No claim that a Confidential Workflow has executed
inside a real enclave — every enclave-execution statement above is DOCUMENTED_NOT_OBSERVED or is a
denial. No claim that any Chainlink report has been verified on chain by this repository — no
report has ever been fetched, verified, or consumed here, and no contract in this repository emits
a signal claiming otherwise. No claim about a named peer project's code, wording, or product
concept, because none was supplied to compare against (§0).

## 6. Sources

| Source | URL | Retrieved | Author/org | Kind | Used for |
|---|---|---|---|---|---|
| ETHOnline 2026 Chainlink prize page | https://ethglobal.com/events/ethonline2026/prizes/chainlink | 2026-09-11 (fetched twice, agreeing) | ETHGlobal / Chainlink | OFFICIAL | §1, §3.1, §3.2, §3.6, §3.9, §3.10, §3.11 — track wording, requirements, focus areas |
| ETHOnline 2026 info/details | https://ethglobal.com/events/ethonline2026/info/details | 2026-09-11 (fetched twice, agreeing) | ETHGlobal | OFFICIAL | §3.12 — demo video requirement |
| CRE Templates Hub | https://docs.chain.link/cre-templates | 2026-09-11 | Chainlink | OFFICIAL | §3.1 — full template list, capabilities, descriptions |
| CRE Confidential Workflows concept page | https://docs.chain.link/cre/concepts/confidential-workflows | 2026-09-11 | Chainlink | OFFICIAL | §2, §3.2, §3.3 — protected/unprotected surfaces, named use cases |
| `KeystoneForwarder.sol`, commit `92897847` | https://github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/v1/KeystoneForwarder.sol | 2026-09-11 (raw source fetched directly) | Chainlink (smartcontractkit) | OFFICIAL | §3.5, §3.8 — `route()`, `AlreadyAttempted`, the receiver-call/success-tracking mechanism |
| `IReceiver.sol`, same commit | https://github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/v1/interfaces/IReceiver.sol | 2026-09-11 (also cited in `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md`) | Chainlink (smartcontractkit) | OFFICIAL | §3.4 — receiver's own staleness-discarding responsibility |
| `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` (this repository) | n/a — local file | 2026-09-11 (file date) | UNICA / NFTeria | TEAM GUIDANCE | §3.7 — oracle-integrity research and its fourteen validation rules |
| `docs/SPONSOR-ELIGIBILITY.md` (this repository) | n/a — local file | 2026-09-09 correction (file date) | UNICA / NFTeria | TEAM GUIDANCE | §1 — the current NOT SELECTED status |
| `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` (this repository) | n/a — local file | 2026-09-11 (file date) | UNICA / NFTeria | TEAM GUIDANCE | §3.1, §3.10, §3.12 — the three simulator runs, the 18/12 check counts |
| `integrations/chainlink-cre-guardian/workflow/guardian.ts`, `package.json`, `workflow.yaml` (this repository) | n/a — local files | 2026-09-11 (read directly) | UNICA / NFTeria | TEAM GUIDANCE | §1, §3.1, §3.2 — `handlerInTee` import and call site, SDK version, staging target |
| `integrations/chainlink-cre-robinhood/policy.mjs`, `README.md`, `schemas/workflow-result.public.json` (this repository) | n/a — local files | 2026-09-11 (read directly) | UNICA / NFTeria | TEAM GUIDANCE | §1, §3.2, §3.3, §3.5, §3.6 — the decision function, data boundary, output schema |
| `docs/unica-v5/ens/AGENT-IDENTITY.md` (sibling stream, cited, not edited) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §3.9 — confirming no cross-stream identity linkage exists |
| `docs/unica-v5/ens/PRIZE-FIT.md`, `docs/unica-v5/graph/PRIZE-FIT.md` (sibling streams, cited, not edited) | n/a — local files | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §3.11 — the "central, not cosmetic" bar quoted from other sponsors for contrast |

## 7. Unknowns

- Whether Chainlink judges would treat a CLI-simulation-only submission (§3.1, §3.12) as fully
  satisfying "meaningful part of the application," or would weigh a live TEE run materially higher
  despite the page's own wording appearing to accept either — not stated on the page, carried to
  `PRIZE-FIT.md` §12.
- Whether an explicitly advisory-only (never load-bearing for settlement) Confidential Workflow
  reads as "not placeholder code" to a judge, given §3.11's honest finding that removing it changes
  nothing about whether a UNICA settlement can occur.
- Whether the receiver-verification hazard confirmed in §3.8 against Chainlink's own source has any
  documented mitigation pattern in Chainlink's own consumer-contract guide beyond "the receiver is
  responsible" — the guide was read for that one sentence and not exhaustively for a fuller pattern.
- Whether any Chainlink CRE template in the catalogue (§3.1) itself demonstrates a real, non-simulator
  TEE execution on its own repository page — not checked; this document only read the templates
  hub's summary table, not each template repository's own README.
- Whether `integrations/chainlink-cre-robinhood/`'s empty, untracked `workflow/` directory reflects
  an abandoned plan to give that integration its own CRE entry point, or was simply never needed
  once `chainlink-cre-guardian` existed — no file in this repository states which, and this document
  does not guess.
