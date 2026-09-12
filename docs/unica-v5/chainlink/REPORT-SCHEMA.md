# UNICA v5 Chainlink — the settlement admission report schema

Status: DRAFT, specification only. Nothing here is committed to a workflow, compiled, deployed, or
sent to any chain. No CRE CLI command has been run to produce this document; no key is signed or
broadcast; no receiver contract exists yet anywhere in this repository.

Labels: **VERIFIED** (read live, or read verbatim from a pinned primary source), **PROPOSED** (this
document's own design choice, not yet reviewed or built), **UNKNOWN** (no permitted source settles
it). A claim without one of these three labels next to it is a defect in this file, not a fact.

This document specifies the report payload UNICA's own workflow logic would place inside a
Chainlink CRE report — the bytes a receiver contract's `onReport(bytes metadata, bytes report)`
would decode as `report` — for the one purpose this stream is scoped to: an **optional admission
gate that runs before order creation**, never a payment-validity check. `docs/unica-v5/chainlink/
RECEIVER.md` specifies the contract that would decode and check this struct; `docs/unica-v5/
chainlink/SIMULATION-VS-DON.md` specifies which of the six execution rungs between "compiles
locally" and "a live DON delivers this to that receiver" this repository has actually climbed
(none above the first, and even the first only partially — see that file).

## 1. Sources

| # | Source | Author/org | Kind | Retrieved | Used for |
|---|---|---|---|---|---|
| C1 | `github.com/smartcontractkit/chainlink-evm` `contracts/cre/src/v1/KeystoneForwarder.sol`, commit `92897847daa3ba26ac2796ef284f57e6f3d1ca2a` — full source fetched and read verbatim in this session | Chainlink Labs / smartcontractkit | OFFICIAL | 2026-09-11 | The exact byte layout of `rawReport`, the `_getMetadata` offsets, `METADATA_LENGTH` (109) and `FORWARDER_METADATA_LENGTH` (45), the signature scheme (`ecrecover` over `keccak256(keccak256(rawReport) \|\| reportContext)`), and that the entire `rawReport` — envelope and business payload together — is what gets signed |
| C2 | same repo, `contracts/cre/src/v1/interfaces/IReceiver.sol`, same commit — fetched and read verbatim | Chainlink Labs / smartcontractkit | OFFICIAL | 2026-09-11 | `onReport(bytes metadata, bytes report)`'s exact signature; the NatSpec: "If this function call reverts, it can be retried with a higher gas limit. The receiver is responsible for discarding stale reports." |
| C3 | `docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts` | Chainlink Labs | OFFICIAL | 2026-09-11 | The 64-byte metadata layout (`workflowId`, `workflowName`, `workflowOwner`, `reportId`); the explicit warning that cross-chain replay is the consumer's own responsibility ("Embed a `chainSelector` field... and reject mismatches") and that workflow-name validation without owner validation is a collision risk. Retrieved through an automated fetch-and-summarize pass; quoted fragments below are presented by that pass as verbatim page text, unquoted paraphrase is this document's characterization of the rest |
| C4 | `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` §4a, §4b (this repository, committed) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The two forwarder addresses live on Robinhood Chain Testnet (46630); the exact sentence this document builds on: "Whether the forwarder's signed data binds the receiver is UNCONFIRMED in the evidence" |
| C5 | `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` §9 (this repository, uncommitted spec) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | `ChainlinkCREAdapter`'s own `onReport` design for **price**, not admission — a different problem than this document's, cited so the two are not confused; the same UNCONFIRMED gap C4 states, repeated there as the reason its report embeds `chainId` and `receiver` itself rather than trusting the metadata alone |
| C6 | `docs/v2/SECURITY-ADVISORY-001.md` (this repository, committed) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The exact failure mode this schema is built to structurally exclude: fields left outside a signed witness let a submitter substitute them for free. Its fix (bind the complete digest, not a subset of named fields) is this schema's organizing principle |
| C7 | `integrations/chainlink-cre-robinhood/README.md` (this repository, committed) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The one design rule this document inherits without restating the argument: "CRE may decide whether to attempt a payment. Only the hook and executor decide whether a payment is valid on chain." Also its public/private data-boundary table, source of the `policyVersionHash` / `privateInputCommitment` design below |
| C8 | `docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` §4.1 (sibling stream, cited, not edited) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | `ProtocolRelease`: "a human-supplied release tag copied from the off-chain deployment manifest (never inferred)" — the existing concept this schema's `unicaRelease` field reuses rather than duplicates |
| C9 | `docs/unica-v5/ens/POS-TERMINALS.md` §3 (sibling stream, cited, not edited) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The terminal-identity node value (`node = namehash(name)`) this schema's `terminalNode` field reuses |
| C10 | `docs/unica-v5/ens/IDENTITY-NFT.md` §4.2, §5 item 5 (sibling stream, cited, not edited) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | States the ENSv2 deployment identifier is an axis that document has not yet fixed a concrete encoding for — carried forward here as UNKNOWN rather than pre-empted |
| C11 | `docs.chain.link/cre/reference/cli/workflow` | Chainlink Labs | OFFICIAL | 2026-09-11 | `cre workflow hash`: binary hash, config hash, and "workflow hash (= workflow id)" — the existing Chainlink concept this schema's `workflowId`/`workflowVersion` fields are checked against rather than duplicated |
| C12 | Computed in this session from C2's pinned function signature | this document (derivation, not a citation) | — | 2026-09-11 | `bytes4(keccak256("onReport(bytes,bytes)"))`, cross-checked two ways (Foundry `cast sig`, and an independent keccak-256 computation) — used in `RECEIVER.md`, not this file, recorded here once since it derives from C2 |

Methodology note, C3/C11 and equivalents in the sibling documents: retrieved through an automated
fetch-and-summarize pass rather than a byte-for-byte page capture. Text in quotation marks is
presented by that pass as an extracted quotation; unquoted text is this document's paraphrase of
the pass's own summary and carries correspondingly less certainty. C1, C2, C4 (`.sol` files) were
instead downloaded and read in full as raw source, so figures drawn from them (byte offsets,
constant values) are exact, not paraphrased.

## 2. Scope: what this schema is for, and what it is explicitly not

**Not a price report.** `SPEC-ORACLE-AND-CHAINS.md` §9 already specifies `ChainlinkCREAdapter`, a
`view`-only oracle adapter whose `onReport` stores a `(price, decimals, observedAt)` triple for a
single asset/quote pair (C5). That adapter is unbuilt, unstated to exist anywhere, and simulation-
only per that document's own text. This schema solves a different problem: not "what is the
price," but "should an order for this payer, this merchant, this market be allowed to be created at
all." The two never share a contract, a struct, or a digest.

**Not a settlement-validity check.** Per C7's one design rule, nothing this schema authenticates is
ever permitted to move funds, mark an order settled, or substitute for any check `UnicaMarketHook`
or `UnicaMarketExecutor` already makes. An accepted `AdmissionReport` can only ever *permit* a call
to create an order to proceed; it cannot make `pay()` skip `WrongPayer`, `InputNotExact`, or
`DeliveryNotExact` (`docs/unica-v4/SPEC-CONTRACTS.md` §9, §6.2 of `EVENT-SCHEMA.md`), and it cannot
make the hook skip any check of `SPEC-ORACLE-AND-CHAINS.md` §4.1. If every field below validates and
the market is later PAUSED before `createOrder` is called, `createOrder` still fails on the
market's own state, independent of anything this report claims (`RECEIVER.md` §2 restates this as a
design constraint on the receiver contract itself, not merely an intention).

**Optional.** A market that never wires an admission check into its order-creation path behaves
exactly as `SPEC-CONTRACTS.md` already specifies today: an allowlisted creator (`OrderCreatorSet`)
or ADMIN calls `createOrder` directly, and no CRE report of any kind is ever read. This schema
exists for markets that choose to add one more precondition, never as a replacement for the
existing allowlist.

## 3. Where this payload sits inside a real CRE report, and what actually authenticates it

Per C1's `_getMetadata` and the `report()` function, a raw report delivered to
`KeystoneForwarder.report(receiver, rawReport, reportContext, signatures)` has this byte layout
(offsets counted from byte 0 of `rawReport`, i.e. 32 less than the in-memory offsets C1's comments
give, which include Solidity's leading length word):

| Bytes | Field | Size | Source |
|---|---|---|---|
| 0 | `version` | 1 | C1, `_getMetadata` comment |
| 1-32 | `workflow_execution_id` | 32 | C1; used to compute the forwarder's own `transmissionId`, never passed to the receiver directly |
| 33-36 | `timestamp` | 4 | C1; the DON's own transmission time — **never reaches the receiver**: it lies outside the 64-byte slice `route()` forwards (bytes 45-108 below), confirmed by re-deriving the slice bounds from `FORWARDER_METADATA_LENGTH` (45) and `METADATA_LENGTH` (109), matching C4 §4b's own finding |
| 37-40 | `don_id` | 4 | C1; combined with the next field into the `configId` the forwarder checks its `OracleSet` under |
| 41-44 | `don_config_version` | 4 | C1 |
| 45-76 | `workflow_cid` | 32 | C1; this is the value C3 calls `workflowId` in the receiver-facing metadata |
| 77-86 | `workflow_name` | 10 | C1 = C3's `workflowName` |
| 87-106 | `workflow_owner` | 20 | C1 = C3's `workflowOwner` |
| 107-108 | `report_id` | 2 | C1 = C3's `reportId` |
| 109- | **the business report** | variable | C1; this is exactly the `report` parameter `onReport` receives, and exactly what this document's `AdmissionReport` struct occupies |

Bytes 45-108 (64 bytes: `workflow_cid` + `workflow_name` + `workflow_owner` + `report_id`) are what
`route()` slices off as the `metadata` argument to `onReport` (`rawReport[FORWARDER_METADATA_LENGTH:
METADATA_LENGTH]`, C1) — matching C3's documented 64-byte layout exactly, field for field. This is
a real cross-check, not an assumption: C3's page-level description and C1's byte-level source agree
independently.

**Authenticity, when a production forwarder is live.** `report()`'s signature check
(`completeHash = keccak256(abi.encodePacked(keccak256(rawReport), reportContext))`, `f+1`
`ecrecover` recoveries against a configured `OracleSet`, C1) covers **the entire `rawReport`**,
envelope and business payload together — the hash is computed over the whole byte string before any
slicing happens. So once a report reaches a production `KeystoneForwarder` with a live, correctly
configured signer set, every field this document's `AdmissionReport` struct defines is covered by
that consensus signature, not only the 64-byte metadata slice. Nothing in this repository has
observed that signature check accept a real report for any workflow (see `SIMULATION-VS-DON.md`
§3); this paragraph states the mechanism C1's source shows, not an event this repository has caused.

**What that signature does not do.** It proves the report was assembled and signed by the
configured `OracleSet` for the claimed `(don_id, don_config_version)` pair. It proves nothing about
which chain, which receiver, or which UNICA release the workflow author intended it for — C3 says
so explicitly for cross-chain replay ("a signed report valid on one chain can be replayed on
another... embed a `chainSelector` field... and reject mismatches"), and C4/C5 independently flag
the same gap for the receiver identity specifically ("Whether the forwarder's signed data binds the
receiver is UNCONFIRMED"). Both gaps are addressed the same way below: by putting the missing
binding **inside** the signed business payload, where the DON's own signature — once one exists —
covers it, rather than leaving it to a separate, unsigned channel.

## 4. The `AdmissionReport` struct

Every field the brief for this stream names, with no field left as an appendix. `bytes32` and
`address` fields below are placeholders in this document (no literal value is fabricated); an
implementation fills them from real chain state and real workflow input only.

| # | Field | Type | What it is | Why it must be inside the digest |
|---|---|---|---|---|
| 1 | `chainId` | `uint256` | `block.chainid` of the intended receiving chain | C3's own named defense against cross-chain replay; without it the identical signed bytes accepted on chain A settle on chain B |
| 2 | `verifyingContract` | `address` | the specific receiver contract instance this report is for | mirrors EIP-712's own field of the same name; closes exactly the gap C4/C5 flag as UNCONFIRMED at the forwarder level |
| 3 | `unicaRelease` | `bytes32` or short string | the deployment generation's release tag | reuses `ProtocolRelease`'s existing tag (C8) rather than inventing a second one; binds the report to one factory/registry generation, never a future or past one |
| 4 | `registry` | `address` | the `UnicaMarketRegistry` this admission is scoped to | a report valid for one deployment's registry must not silently validate against a different one on the same chain |
| 5 | `marketId` | `bytes32` | the market this order would be created against | checked against `registry.getMarket(marketId)` by the receiver (`RECEIVER.md` §5); this document does not recompute `marketId`'s own commitment formula, only consumes the value (`SPEC-ORACLE-AND-CHAINS.md` §4.1, `EVENT-SCHEMA.md` §4.1) |
| 6 | `marketVersion` | `uint32` | the market's `version` field at report-generation time | a market can be RETIRED and relisted at a new version (`SPEC-ORACLE-AND-CHAINS.md` §3); an admission computed against version 1 must not admit an order against version 2's re-listed market |
| 7 | `merchant` | `address` | the intended order recipient | the exact field Advisory 001 found **outside** the payer's signed witness (C6) — named recipient substitution is the whole failure mode this document exists to close |
| 8 | `payer` | `address` | the bound payer, or the zero address if the admission does not bind one | UNICA v4 is payer-bound-only in the general case (`Q111`, `Q128`, cited via `SPEC-ORACLE-AND-CHAINS.md` §16); an admission that names no payer must say so explicitly (zero address), never by omitting the field. `RECEIVER.md` §6 item 3 fixes the consumption rule this structural choice depends on: an order's `boundPayer` is compared against this field by literal equality only, so a zero-address `payer` matches no real v4 order (none is ever zero-bound) and is never read as a wildcard authorizing any caller |
| 9 | `inputAsset` | `address` | the asset token the order would pull | one of the two currencies Advisory 001 found substitutable via the untouched merchant half of a forged quote |
| 10 | `outputAsset` | `address` | the payout token the order would deliver | same rationale as #9 |
| 11 | `exactInput` | `bool` | `true`: `inputAmount` is the exact pull, matching v4's `OrderCreated.amountIn` semantics (`EVENT-SCHEMA.md` §6.1). `false`: `inputAmount` is a payer-authorized ceiling | makes explicit which regime applies; a ceiling-only regime is exactly Advisory 001's `maxIn` shape, safe here only because `merchant` (#7) is bound in the same digest, unlike the advisory's witness |
| 12 | `inputAmount` | `uint256` | the exact amount or the ceiling, per #11 | - |
| 13 | `minOutput` | `uint128` | the minimum delivery the admission was computed for | must be checked against the eventual order's own `minOut`; an admission is not license to accept a worse floor later |
| 14 | `orderNonce` | `bytes32` | a workflow-chosen, one-time value distinct from any on-chain `orderId` | the single-use key `RECEIVER.md` §5 consumes; distinct from `orderId` because `orderId` does not exist until `createOrder` runs, which happens strictly after admission |
| 15 | `quoteExpiry` | `uint64` | Unix seconds after which the priced quote itself is stale | short-lived: bounds how long a price-sensitive admission stays usable |
| 16 | `policyExpiry` | `uint64` | Unix seconds after which the policy configuration that produced this admission is considered superseded | longer-lived than #15; a policy rotation invalidates every admission issued under the old policy version, independent of price staleness |
| 17 | `terminalNode` | `bytes32` | the ENS node of the point-of-sale terminal that originated this order, or zero if none | reuses `node = namehash(name)` from `POS-TERMINALS.md` §3 (C9) rather than inventing a parallel identifier |
| 18 | `terminalStatusSnapshot` | `bytes32` | a hash of the terminal-status record the workflow read at report-generation time | terminal status is ENS state, off-chain and revocable (`POS-TERMINALS.md`); the receiver cannot re-resolve ENS itself, so it can only check that a report *carried* a stated snapshot at generation time, bounded by `policyExpiry` (#16) so a stale snapshot cannot be presented indefinitely — this is a documented limit, not a full revocation check (§6 below) |
| 19 | `ensDeploymentId` | UNKNOWN | the ENSv2 deployment axis `IDENTITY-NFT.md` §4.2 names but has not yet fixed a concrete encoding for | left UNKNOWN here deliberately rather than pre-empting that sibling document's own resolution (C10); an implementation must resolve this against whatever `IDENTITY-NFT.md` eventually specifies, not against a type invented in this file |
| 20 | `policyVersionHash` | `bytes32` | a commitment to the merchant/workflow policy version that decided to admit this order | reuses C7's own documented pattern verbatim: "Simulation policy \| policy **commitment** (never the policy)" — the policy's contents stay off-chain and private; only its hash crosses into the report |
| 21 | `privateInputCommitment` | `bytes32` | a single generic commitment to whatever private inputs the workflow's decision depended on | generalizes every row of C7's private-input table (quote-source credential, deviation thresholds, merchant policy thresholds, preferred route, submission configuration) into one field, deliberately, so the schema's own shape never discloses which private inputs existed for a given order |
| 22 | `workflowId` | `bytes32` | the CRE `workflow_cid` value, restated inside the signed payload | defends the exact gap C4 §4b and C5 name: whether the forwarder's own metadata argument binds the receiver is UNCONFIRMED, so this schema does not rely on the metadata argument alone and commits the same value a second time, inside the payload the signature covers end to end (§3 above) |
| 23 | `workflowOwner` | `address` | restated alongside #22, for the same reason and by the same C3 rule ("workflow name validation... requires also validating the owner address to prevent collision attacks") | - |
| 24 | `workflowVersion` | UNKNOWN / PROPOSED | Chainlink's own protocol content-addresses a workflow (`cre workflow hash`, C11) rather than versioning it separately; a changed workflow is a new `workflowId`, exactly the philosophy `EVENT-SCHEMA.md` §12 already applies to UNICA's own non-upgradeable hook and executor | PROPOSED: reuse the `cre workflow hash` config-hash value C11 already produces rather than inventing a second counter; UNKNOWN whether that value is stable/reproducible outside a live CRE CLI session run under this repository's own control (not yet run, `SIMULATION-VS-DON.md` §3) |
| 25 | `receiver` | `address` | the receiver contract, restated | listed separately from `verifyingContract` (#2) because the brief names both terms; in this design the two are the same value by construction — a report naming a different `receiver` than `verifyingContract` is malformed and must be refused (`RECEIVER.md` §5) |
| 26 | `domainSeparator` | `bytes32` | see §5 — not an input field, a computed value carried alongside the struct for the receiver's own audit trail | - |

Fields 1-25 are inputs the workflow assembles; field 26 is derived, never independently supplied
(a report supplying its own `domainSeparator` value would let a submitter pick one that does not
match the struct it is paired with — the receiver always recomputes it, never trusts a supplied
one, `RECEIVER.md` §5).

## 5. The digest and the domain separator

Modelled on the fix C6 recommends for exactly this class of defect ("hash the... digest into the
payer's witness," binding "everything the merchant signed... plus the domain, which already
carries the chain id and the executor address") — restated here for a report rather than a Permit2
witness, and, unlike C6's subject, with every field inside the commitment from the start rather than
added after a defect was found.

```
domainSeparator = hash( "UNICA-ADMISSION-V1", chainId, verifyingContract, unicaRelease, registry )
structHash      = hash( marketId, marketVersion, merchant, payer, inputAsset, outputAsset,
                         exactInput, inputAmount, minOutput, orderNonce, quoteExpiry, policyExpiry,
                         terminalNode, terminalStatusSnapshot, ensDeploymentId, policyVersionHash,
                         privateInputCommitment, workflowId, workflowOwner, workflowVersion,
                         receiver )
admissionDigest = hash( domainSeparator, structHash )
```

`hash(...)` denotes a collision-resistant hash of the ABI-encoded arguments (`keccak256(abi.encode(
...))` in an implementation); no literal digest is fabricated in this document — see the house rule
in §9 on why no example digest is filled in here.

**This is not a second signature.** Once a production forwarder delivers a report for real, the
DON's own `f+1` signatures already cover every byte of `report`, `admissionDigest` included (§3).
`admissionDigest` exists so that (a) changing any single field is a single, auditable value change
rather than nineteen independent comparisons scattered through the receiver, mirroring how UNICA
v4's own `marketId` already commits several fields into one value (`SPEC-ORACLE-AND-CHAINS.md` §3,
`EVENT-SCHEMA.md` §4.1), and (b) the receiver's own emitted event and stored admission record can
carry one value external systems reference, rather than the full 21-field tuple, without weakening
what is bound.

**Every field is inside the hash. None is optional.** This is the one property Advisory 001 (C6)
found violated in a different UNICA contract: ten of sixteen fields sat outside the payer's signed
witness, and two quotes differing only in the omitted fields produced a byte-identical signing
digest. §6 below states this claim as a table, not an assertion.

## 6. Field-by-field check against Advisory 001's failure mode

Advisory 001's defect, restated precisely (C6): the payer's `PermitWitnessTransferFrom` witness
committed six fields; ten more — including `recipient` and `merchantSigner`, the entire merchant
half of the deal — were reachable and substitutable by whoever submitted the transaction, because
they sat outside the signed structure. The table below runs the same test against every field of
`AdmissionReport`: **does changing this field, and only this field, change `admissionDigest`?**

| Field | Inside `structHash`? | Changing it alone changes `admissionDigest`? |
|---|---|---|
| `chainId`, `verifyingContract`, `unicaRelease`, `registry` | inside `domainSeparator` | yes |
| `marketId`, `marketVersion` | yes | yes |
| `merchant` | yes | yes - this is the exact field Advisory 001 found free |
| `payer` | yes | yes |
| `inputAsset`, `outputAsset` | yes | yes |
| `exactInput`, `inputAmount` | yes | yes |
| `minOutput` | yes | yes |
| `orderNonce` | yes | yes |
| `quoteExpiry`, `policyExpiry` | yes | yes |
| `terminalNode`, `terminalStatusSnapshot` | yes | yes |
| `ensDeploymentId` | yes (type UNKNOWN, §4 row 19; still a struct member once resolved) | yes, once the sibling stream fixes its encoding - until then this row is PROPOSED, not VERIFIED |
| `policyVersionHash`, `privateInputCommitment` | yes | yes |
| `workflowId`, `workflowOwner`, `workflowVersion` | yes | yes |
| `receiver` | yes | yes |

Every row reads "yes," by construction: §5 lists all twenty-one input fields inside `structHash` or
`domainSeparator`, with none held back. This is a structural claim about the struct's definition in
this document, not a claim tested against compiled code or a live chain - no contract implementing
this struct exists yet (`RECEIVER.md` has not been built either; it is a companion specification).
The **test** this claim licenses, once code exists, is mechanical: for each field, construct two
otherwise-identical reports differing only in that field, and assert their `admissionDigest` values
differ - the same method C6's own reproduction (`test/v2/WitnessBinding.t.sol`) used, applied here
before any defect is found rather than after.

## 7. What this document does not establish

- That any receiver contract implementing this struct exists. None does (`RECEIVER.md` specifies
  one; it is not built).
- That a CRE workflow producing this exact payload exists, compiles, or has been simulated. None
  does; `SIMULATION-VS-DON.md` states plainly which rungs this repository has and has not climbed.
- That Chainlink's own protocol enforces any of this schema's field-level bindings. It enforces
  none of them: `f+1` signatures authenticate that the configured `OracleSet` produced the bytes,
  nothing about what the bytes mean (§3). Every semantic binding in §4-§6 is UNICA's own addition,
  inside the signed payload, never Chainlink's.
- The concrete encoding of `ensDeploymentId` (§4 row 19) - deliberately deferred to `IDENTITY-NFT.md`.
- Whether `workflowVersion` (§4 row 24) should be `cre workflow hash`'s config hash, a UNICA-side
  monotonic counter, or both - an owner decision, not resolved here.
- Any claim that a Chainlink CRE report has ever been generated, signed, or delivered for this
  schema, on any chain, by any workflow. None has.

## 8. Open questions

1. **Owner:** whether `payer` (field 8) may ever legitimately be the zero address in production, or
   whether every admitted order must name a specific payer, consistent with `SPEC-ORACLE-AND-CHAINS.md`
   §16's "payer-bound only" note - this document allows the zero-address case structurally but does
   not decide whether it should ever be used. Independent of that decision, `RECEIVER.md` §6 item 3
   already fixes the consumption rule so a zero `payer` can never be substituted for a real one: the
   comparison is always literal, never a match for any caller.
2. **Owner, with the ENS stream:** the concrete type and derivation of `ensDeploymentId` (§4 row 19).
3. **Owner:** whether `workflowVersion` reuses Chainlink's own content-addressed hash or a separate
   UNICA counter (§4 row 24, §7).
4. Whether `terminalStatusSnapshot` (field 18) needs a stronger freshness bound than `policyExpiry`
   alone - a terminal can be revoked (`POS-TERMINALS.md` §4.7's revocation timeline) at any point
   after a report is generated but before an order is created from it; this document bounds that
   window by `policyExpiry` and does not propose shortening it further.
5. Whether `AdmissionReport` should be the literal ABI-encoded `report` bytes, or whether an
   implementation should additionally include a schema-version tag byte ahead of it (so a future,
   differently-shaped report cannot be misdecoded as this one) - PROPOSED, not decided: `RECEIVER.md`
   §5's "report schema and version" check assumes some such tag exists, and this document does not
   yet fix its exact position or width.
6. No CRE CLI command was run to validate that a workflow can actually assemble and emit a report
   shaped like §4-§5 through the SDK's own `runtime.report()` / `GenerateReport()` primitives (the
   `cre.md` fetch); this document specifies the target shape without having exercised the
   tooling that would produce it.

## Sources referenced

- https://github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/v1/KeystoneForwarder.sol
- https://github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/v1/interfaces/IReceiver.sol
- https://github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/v1/interfaces/IRouter.sol
- https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts
- https://docs.chain.link/cre/reference/cli/workflow
- https://docs.chain.link/cre.md
- docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md (this repository)
- docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md (this repository)
- docs/unica-v4/EVENT-SCHEMA.md (this repository)
- docs/v2/SECURITY-ADVISORY-001.md (this repository)
- integrations/chainlink-cre-robinhood/README.md (this repository)
- docs/unica-v5/graph/SETTLEMENT-SCHEMA.md (sibling stream, cited, not edited)
- docs/unica-v5/ens/POS-TERMINALS.md (sibling stream, cited, not edited)
- docs/unica-v5/ens/IDENTITY-NFT.md (sibling stream, cited, not edited)
