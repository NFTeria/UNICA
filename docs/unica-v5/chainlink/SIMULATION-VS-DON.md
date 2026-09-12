# UNICA v5 Chainlink — simulation, the mock forwarder, and a live DON

Status: DRAFT, research and specification only. No CRE CLI command has been run in the course of
producing this document; no workflow is compiled; no key is signed or broadcast; nothing is
deployed. This document's job is to name, precisely, which of six distinct things this repository
has and has not done, so that no later document can round "we built a workflow" up from "we
described one."

Labels: **VERIFIED**, **PROPOSED**, **UNKNOWN** — as defined in `docs/unica-v5/chainlink/
REPORT-SCHEMA.md`'s opening section. This document reuses that file's and `RECEIVER.md`'s source
list (C1-C12, D1-D7) by reference; only sources specific to this document get a new letter below.

## 1. Sources (in addition to `REPORT-SCHEMA.md` and `RECEIVER.md`)

| # | Source | Author/org | Kind | Retrieved | Used for |
|---|---|---|---|---|---|
| E1 | `docs.chain.link/cre/guides/operations/simulating-workflows` | Chainlink Labs | OFFICIAL | 2026-09-11 | `cre workflow simulate`'s flags, in particular `--broadcast`; the explicit single-node/no-consensus limitation, quoted directly below; retrieved through an automated fetch-and-summarize pass — quoted fragments are presented by that pass as verbatim, unquoted text is this document's paraphrase |
| E2 | `docs.chain.link/cre/guides/operations/deploying-workflows.md` | Chainlink Labs | OFFICIAL | 2026-09-11 | The approval requirement ("Workflow deployment requires approval. Run `cre account access` to submit a request."), the `deployment-registry` choice (`private` vs `onchain:<network>`), and what deploying accomplishes that simulating does not ("register it with a workflow registry so it can activate and respond to triggers across a DON") |
| E3 | `docs.chain.link/cre/reference/cli/workflow` | Chainlink Labs | OFFICIAL | 2026-09-11 | `cre workflow hash`'s three hash types (binary, config, workflow/id); `cre workflow deploy`'s and `simulate`'s flag sets; that `simulate --target` selects local settings from `workflow.yaml`, never a live registry |
| E4 | `docs.chain.link/cre/release-notes.md` | Chainlink Labs | OFFICIAL | 2026-09-11 | The CLI/SDK version ladder (below, §5); the exact sentence already quoted in `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` §4a: CLI v1.30.0 (Aug 13, 2026) "supports Monad, T-REX, Robinhood, Stable, and Tempo testnets **for local simulation**" |
| E5 | `docs.chain.link/cre/supported-networks-ts.md` | Chainlink Labs | OFFICIAL | 2026-09-11 | Robinhood Chain **Testnet**'s row: CLI v1.30.0+, Go SDK v1.19.0+, TS SDK v1.19.0+ required; Robinhood Chain **Mainnet** absent from this table entirely; the page's own "last updated August 26, 2026" note; the instruction to run `cre workflow supported-chains` (needs a login this research does not perform) to see what is enabled for a specific organization |
| E6 | `docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts.md` | Chainlink Labs | OFFICIAL | 2026-09-11 | "Simulation: Uses `MockKeystoneForwarder` contracts during local testing with `cre workflow simulate --broadcast`. Production: Uses `KeystoneForwarder` contracts for deployed workflows"; the warning to update the pinned forwarder address before a production deployment |
| E7 | `docs.chain.link/cre/concepts/confidential-workflows.md` | Chainlink Labs | OFFICIAL | 2026-09-11 | Cited only to keep this document's simulation-vs-production ladder separate from Confidential Workflows' own, different distinction (enclave attestation vs DON consensus), which `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` and `integrations/chainlink-cre-robinhood/README.md` already own; this document does not repeat their claims |
| E8 | `integrations/chainlink-cre-robinhood/README.md` (this repository, committed) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The exact, already-honest starting point §3 below restates: "All three are offline: no CRE CLI, no account, no key, no RPC" |
| E9 | `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` §4a (this repository, committed) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The two forwarder addresses on Robinhood Chain Testnet (46630), and the tension already on record between E4's "local simulation" wording and the Forwarder Directory's "Production Forwarders" listing for the same chain — restated in §6, not re-derived |
| E10 | `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` §2-§3 (this repository, committed) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | Three recorded `cre workflow simulate` runs, under CRE CLI v1.32.0, against `integrations/chainlink-cre-guardian/`, none with `--broadcast`; run 3 printing "Handler requested TEE Execution" before failing on an unrelated input error — the guardian subject's own Rung 1 evidence, a different subject from the one E8 describes and not covered by E8's own sentence |

Methodology note: E1-E7 were retrieved through an automated fetch-and-summarize pass, the same
method and the same caveat `REPORT-SCHEMA.md` §1 states — quoted fragments are the pass's own
extraction, unquoted paraphrase is this document's characterization of the rest.

## 2. Six distinct things, defined precisely, from least to most real

Each rung below is a materially different claim. Conflating any two of them is exactly the mistake
this document exists to prevent.

### Rung 1 — local simulation, no `--broadcast`

`cre workflow simulate` compiles the workflow to WebAssembly and executes it on the machine running
the command. Per E1: "The simulator makes real calls to public testnets and live HTTP endpoints" —
so external API calls and reads are genuine, not mocked — but onchain writes are not sent: a
prepared transaction is shown with a placeholder (zero) hash rather than broadcast. E1 states the
core limitation directly: "Single-node execution: Simulation runs on a single node (your local
machine) rather than across a DON. There is no actual consensus or quorum, it is simulated." Time-
based triggers fire immediately rather than on schedule (E1). No forwarder of any kind is called.

### Rung 2 — `cre workflow simulate --broadcast`

The same single-node, no-consensus execution as Rung 1, but the prepared transaction is actually
sent to a real network (E1, E3: "`--broadcast`: Actually sends transactions to blockchain (default
is dry-run)"). Per E6, this is explicitly the path that targets `MockKeystoneForwarder`: "Uses
`MockKeystoneForwarder` contracts during local testing with `cre workflow simulate --broadcast`."
This document did not find, in any source it consulted, an explicit statement of exactly which
forwarder address `--broadcast` selects on a chain that (like Robinhood Chain Testnet, per E9)
happens to have **both** a Mock and a Production forwarder live at different addresses — the
inference that "Simulation Testnet" classification (E5) means `--broadcast` there targets the Mock
address specifically is this document's own reading of E6 and E9 together, not a sentence either
source states outright. **PROPOSED reading, not VERIFIED.**

### Rung 3 — `MockKeystoneForwarder` behavior, as a contract

Read directly from source (D3, same commit as D1): `report()` is "permissionless and skips all
validations" (the contract's own comment) — no `f`, no configured `OracleSet`, no `ecrecover`, no
signature count check of any kind. Anyone holding no special key at all may call it with an
arbitrary `rawReport`. It reproduces, byte for byte, the same `route()` isolation semantics as
production — the same `ERC165Checker.supportsInterface` gate, the same raw `call()` into `onReport`
with the same gas-accounting constants, the same `Transmission`/`ReportProcessed` bookkeeping. So a
receiver contract tested against the mock exercises real routing, real dedup, and real gas-
isolation mechanics — everything `RECEIVER.md` §7 relies on for its "delivered" definition except
the one thing the mock explicitly does not check: that the report came from anyone in particular.

### Rung 4 — production `KeystoneForwarder` behavior, as a contract

Read directly from source (D1). `report()` requires exactly `f + 1` valid ECDSA signatures,
recovered via `ecrecover` over `keccak256(abi.encodePacked(keccak256(rawReport), reportContext))`,
against a configured `OracleSet` keyed by `(donId, configVersion)`. This is where authenticity
actually originates, mechanically: a set of node keys, configured on this specific contract by its
owner (`setConfig`, `onlyOwner`, D1), producing a threshold of independent signatures over the
**entire** raw report. `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` §4a already recorded that
the production forwarder on Robinhood Chain Testnet (46630) has such a configuration set (a probed
`InvalidSignatureCount(4, 0)` discloses `f = 3`) — a config existing, not a live signer set
observed to actually sign anything, as that document itself states. Nothing in this repository has
produced signatures this contract would accept, on any chain, for any workflow.

### Rung 5 — deployed workflow execution, on a hosted DON

Per E2: deployment "requires approval" (`cre account access`), and registers the workflow "with a
workflow registry so it can activate and respond to triggers across a DON" — genuinely distributed
execution, independently-run nodes reconciling results by consensus, the opposite of Rung 1-2's
single machine. E2 distinguishes two registry shapes (`private`, Chainlink-hosted and requiring only
a login session; `onchain:<network>`, requiring a linked wallet and gas) — a **control-plane**
choice about who may manage the workflow's lifecycle, explicitly not a statement about how the
workflow executes once deployed (E2: "It does not make workflow execution confidential," said of
the private registry specifically, but the broader point — registry choice governs authorization,
not execution — applies to both). No organization tied to this repository has requested or received
this approval (Q95, `SPEC-ORACLE-AND-CHAINS.md` §1: "NOT PROVIDED").

### Rung 6 — on-chain receiver acceptance

Meaningful only once Rungs 4 and 5 both hold for real: a live, correctly configured DON (Rung 5)
delivering a genuinely `f+1`-signed report (Rung 4) to a receiver contract that then runs its own
checks (`RECEIVER.md` §5-§7). No receiver contract exists anywhere in this repository (`RECEIVER.md`
§8); nothing has reached this rung, or could have, absent a contract to reach.

## 3. What this repository has actually done — stated plainly, against all six rungs

**Rung 0 is where the Robinhood-subject work in this repository sits today; the guardian subject has
separately reached Rung 1.** The two subjects are named apart in this section deliberately —
collapsing them into one repository-wide verdict is exactly the rounding-up this document exists to
prevent.

`integrations/chainlink-cre-robinhood/` runs hand-written Node.js test scripts
(`tests/policy.test.mjs`, `tests/confidentiality.test.mjs`) reimplementing its own policy and
confidentiality logic, checked against itself, entirely outside Chainlink's own tooling. E8 states
this precisely, for this subject alone: "All three are offline: no CRE CLI, no account, no key, no
RPC." **The CRE CLI's own local simulator (Rung 1) has not been run by this repository on this
subject.** What exists for it is one level further removed than Rung 1: a repository-local
reimplementation of the logic a workflow would contain, never compiled to WASM, never handed to
`cre workflow simulate`, and never checked against Chainlink's own execution semantics (single-node
consensus-free execution, real external calls, E1) at all. E8's sentence is about this subject's
three offline test commands specifically; it says nothing about any other subject in this
repository, and this document does not generalize it to one.

`integrations/chainlink-cre-guardian/` is a different subject and has reached one rung further:
three recorded `cre workflow simulate` runs under CRE CLI v1.32.0, none with `--broadcast`, against
this tree — the second reaching a `wasm trap: unreachable` engine failure traced to an outdated
`bun` version, the third completing past that failure and printing the simulator's own "Handler
requested TEE Execution" banner before ending on an unrelated malformed-input error (E10). No
`--broadcast` flag was passed on any of the three runs, so no forwarder of any kind was called —
this is Rung 1 exactly, by §2's own definition above: local, single-node, no consensus, no
broadcast. It is reached for the guardian subject only, not for the Robinhood one, and not any rung
above 1 for either subject: none of the three runs exercised `--broadcast`, the
`MockKeystoneForwarder` (D3), or a production forwarder's signature check.

| Rung | Description | Status for this repository |
|---|---|---|
| 0 | Hand-written offline Node.js tests of workflow-shaped logic | **Done for the settlement-quote-policy subject** — `integrations/chainlink-cre-robinhood/` — the only rung that subject has reached |
| 1 | `cre workflow simulate`, no broadcast | **Done for the guardian subject** (`integrations/chainlink-cre-guardian/`), three runs under CRE CLI v1.32.0, run 3 reaching "Handler requested TEE Execution" (E10) — not done for the Robinhood subject; no CRE CLI session has ever been run against it |
| 2 | `cre workflow simulate --broadcast` | Not done, either subject |
| 3 | A receiver tested against `MockKeystoneForwarder` | Not done — no receiver contract exists (`RECEIVER.md` §8) |
| 4 | A receiver tested against a production `KeystoneForwarder`'s real signature check | Not done |
| 5 | A workflow deployed to a hosted DON | Not done; deploy approval is not obtained (Q95, `SPEC-ORACLE-AND-CHAINS.md` §1) |
| 6 | A receiver accepting a DON-delivered report on chain | Not done; not reachable without 4 and 5 |

**No claim in this document, `REPORT-SCHEMA.md`, or `RECEIVER.md` should be read as evidence that
any rung above 0 has been exercised for the Robinhood subject, or above 1 for the guardian subject.**
Where those documents describe mechanics of Rungs 1-6, the description is drawn from Chainlink's own
published source and documentation (C1-C12, D1-D7, E1-E10), never from either subject's own
execution of them beyond what this section states.

## 4. Pin table — versions, addresses, and what remains unpinned

| Item | Value | VERIFIED / UNKNOWN | Source |
|---|---|---|---|
| Latest CRE CLI version found | v1.32.0 (Sep 3, 2026) | VERIFIED (as "latest at time of retrieval," not as "the version any workflow in this repository used" — none has run) | E4 |
| CLI version required for Robinhood Testnet | v1.30.0+ | VERIFIED | E4, E5 |
| Go SDK version required for Robinhood Testnet | v1.19.0+ | VERIFIED | E5 |
| TS SDK version required for Robinhood Testnet | v1.19.0+ (a later v1.19.1 exists per E4, changelog: "Updated viem dependency") | VERIFIED | E4, E5 |
| Production Forwarder, chain 46630 | `0x8E6E6A1f2B2D4dF503bfd67951CF28F27BF3AF19`, `typeAndVersion()` = `"KeystoneForwarder 1.0.0"` | VERIFIED, matches the pinned source (D1) exactly | `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` §4a (live on-chain read) |
| Simulation Forwarder, chain 46630 | `0x0b93082D9b3C7C97fAcd250082899BAcf3af3885`, `typeAndVersion()` read on-chain as `"MockKeystoneForwarder 1.0.0"` | See §5 below — a discrepancy, not a clean VERIFIED |
| Chain selector, Robinhood Chain Testnet | `2032988798112970440` | VERIFIED, `smartcontractkit/chain-selectors` `selectors.yml`, already recorded in `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` §1 | cited there |
| `IReceiver` interface id | `0x805f2132` | VERIFIED (computed, D4) | `RECEIVER.md` §1, D4 |
| Receiver interface | `onReport(bytes metadata, bytes report) external`, ERC-165 required | VERIFIED, C2 | `REPORT-SCHEMA.md` §1 |
| Workflow configuration (`workflow.yaml`) fields governing forwarder selection under `--broadcast` | UNKNOWN | UNKNOWN — not found stated in E1, E3, or E6 | §2 Rung 2 |
| Binary hash, config hash, workflow hash (= workflow id) | Concepts VERIFIED to exist (`cre workflow hash`, E3); no concrete value exists for this repository, since no workflow has been hashed | Concept VERIFIED, value UNKNOWN (nothing to hash yet) | E3 |
| A "report schema hash" as a Chainlink protocol concept | UNKNOWN / does not appear to exist | Chainlink does not version or hash the business-payload shape (`report`, past byte 109 of `rawReport`) at the protocol level — that shape is entirely workflow-defined (C1, confirmed by reading `_getMetadata`'s fixed offsets, which stop at the envelope); a "report schema hash" as such would be a UNICA-side invention (`REPORT-SCHEMA.md` §8 item 5 proposes a schema-version tag byte instead) | C1, D1 |
| Finality / confirmation count for chain 46630 | UNKNOWN | Not found in any source this document or `RECEIVER.md` consulted | `RECEIVER.md` §7 point 5, §9 item 2 |
| `cre workflow supported-chains` output for any organization tied to this repository | UNKNOWN | Requires a login session this research does not perform | E5; also `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` §9 |

## 5. A discrepancy worth stating plainly, not smoothing over

The exact source file for `MockKeystoneForwarder` at the pinned commit (D3, same commit as C1/C2)
declares `string public constant override typeAndVersion = "MockKeystoneForwarder 1.0.0-dev";` —
with a `-dev` suffix. `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` §4a records a **live**
on-chain read of the address at `0x0b93082D9b3C7C97fAcd250082899BAcf3af3885` on chain 46630
returning `typeAndVersion()` = `"MockKeystoneForwarder 1.0.0"` — no `-dev` suffix. The production
forwarder's string matches its pinned source exactly (`"KeystoneForwarder 1.0.0"`, both places); only
the mock's string differs. This means one of: the bytecode actually deployed at that address predates
or postdates commit `92897847daa3ba26ac2796ef284f57e6f3d1ca2a` and carries a different literal string than that commit's source;
or the live-read value was transcribed without the suffix. Neither this document nor the evidence
file it draws from re-derived the deployed bytecode's exact source to settle which. **UNKNOWN**,
flagged rather than resolved, and a concrete instance of §8 item 14 of `CHAINLINK-AVAILABILITY.md`'s
own validation rules ("Live-probe any hardcoded or cached address before trusting it... call
`typeAndVersion()`... and compare it to what the directory or docs claim") applied one level deeper:
even a live-probed value can disagree with a specific pinned commit's source, and that disagreement
is itself worth recording rather than silently picking the more convenient reading.

## 6. The tension already on record, restated without re-deriving new certainty

`docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` §4a already states this exactly and this
document does not attempt to resolve it further: Chainlink's CLI release notes (E4) describe
Robinhood testnet support as "for **local simulation**," while the Forwarder Directory (E6, and the
underlying page `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` §4a cites) lists chain 46630's
`KeystoneForwarder` address under "Production Forwarders," not under "Simulation Testnets." Both
statements are true simultaneously once §2's Rung 3/Rung 4 distinction is applied: **the chain
carries two separate contracts**, a Mock at one address (what "local simulation" support most
plausibly refers to, feeding Rung 2's `--broadcast` path) and a Production forwarder at a different
address (configured with a real signer set per `CHAINLINK-AVAILABILITY.md` §4a, but not observed to
be actively used by any live DON). This document's own contribution beyond the existing evidence
file is naming this as the mechanical resolution of the apparent contradiction, labelled explicitly
as this document's own reading rather than a sentence either Chainlink source states in so many
words: **PROPOSED explanation, not VERIFIED.** Whether a hosted DON is presently writing to the
Production address for any organization remains exactly as unconfirmed as `CHAINLINK-AVAILABILITY.md`
§9 already states.

## 7. What must never be claimed from this document

- That any simulation run by this repository, at any rung, has exercised the production write path
  (Rung 4-6). None has been run at all (§3).
- That `cre workflow simulate --broadcast` against a "Simulation Testnet"-classified chain proves
  anything about a production `KeystoneForwarder`'s behavior on the same chain — Rung 2 and Rung 4
  are mechanically different code paths (D1 vs D3), and passing one says nothing about the other.
- That the Robinhood subject's local test suite (Rung 0, what that subject actually has) constitutes
  running Chainlink's own simulator (Rung 1) for that subject — it does not; it is a separate,
  repository-authored reimplementation, checked only against itself. This is a claim about the
  Robinhood subject specifically; the guardian subject's own three simulator runs (§3, E10) are not
  this class of substitution and are not what this bullet forbids.
- That the `MockKeystoneForwarder`/`KeystoneForwarder` version-string discrepancy (§5) is resolved.
  It is not; it is flagged.
- That the Forwarder-Directory/release-notes tension for chain 46630 (§6) is resolved beyond the
  mechanical hypothesis this document proposes. It is a proposed reading, not a confirmed one.

## 8. Open questions

1. Whether `--broadcast` (Rung 2) can even be pointed at a "Production Forwarders"-listed chain like
   46630's real `KeystoneForwarder`, given the CLI classifies the chain for "local simulation" only
   (E4) — UNKNOWN, and if it can, whether it would simply revert on the missing signatures (Rung 4's
   own mechanics, D1) rather than succeed.
2. The actual bytecode deployed at `0x0b93082D9b3C7C97fAcd250082899BAcf3af3885` on chain 46630, to
   settle the version-string discrepancy of §5 — not re-derived here.
3. Whether any organization tied to this repository could obtain Rung 5's deploy approval (`cre
   account access`, E2) at all, and under what registry choice (`private` vs `onchain:<network>`,
   E2) — not requested, not evaluated.
4. A confirmation/finality count for chain 46630, needed by `RECEIVER.md` §7 point 5 and not found
   in any source this document consulted.
5. Whether Chainlink's SDK-level `runtime.report()` / `GenerateReport()` primitives (mentioned by
   `docs.chain.link/cre.md` without a schema example this document could inspect) impose any
   additional envelope beyond the byte layout C1's source shows — not verified, since no CRE SDK
   session has been run.

## Sources referenced

- https://docs.chain.link/cre/guides/operations/simulating-workflows
- https://docs.chain.link/cre/guides/operations/deploying-workflows.md
- https://docs.chain.link/cre/reference/cli/workflow
- https://docs.chain.link/cre/release-notes.md
- https://docs.chain.link/cre/supported-networks-ts.md
- https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts.md
- https://docs.chain.link/cre/concepts/confidential-workflows.md
- https://github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/dev/MockKeystoneForwarder.sol
- docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md (this repository)
- docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md (this repository)
- integrations/chainlink-cre-robinhood/README.md (this repository)
- docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md (this repository)
- docs/unica-v5/chainlink/REPORT-SCHEMA.md (this stream, companion document)
- docs/unica-v5/chainlink/RECEIVER.md (this stream, companion document)
