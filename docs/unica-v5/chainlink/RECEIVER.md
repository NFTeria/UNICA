# UNICA v5 Chainlink — the settlement admission receiver

Status: DRAFT, specification only. No contract below is written, compiled, or deployed anywhere.
No CRE workflow producing input for it exists. This document names checks and revert conditions
for a contract that does not yet exist in `src/` or anywhere else in this repository.

Labels: **VERIFIED**, **PROPOSED**, **UNKNOWN** — as defined in `docs/unica-v5/chainlink/
REPORT-SCHEMA.md` §0 (its opening paragraph). This document reuses that file's `AdmissionReport`
struct, `admissionDigest`, and source list (C1-C12) by reference rather than repeating them; only
sources specific to this document get a new letter below.

## 1. Sources (in addition to `REPORT-SCHEMA.md`'s C1-C12)

| # | Source | Author/org | Kind | Retrieved | Used for |
|---|---|---|---|---|---|
| D1 | `github.com/smartcontractkit/chainlink-evm` `contracts/cre/src/v1/KeystoneForwarder.sol`, commit `92897847daa3ba26ac2796ef284f57e6f3d1ca2a` — `route()`, lines 129-167 of the fetched file, read verbatim | Chainlink Labs / smartcontractkit | OFFICIAL | 2026-09-11 | The exact mechanics of the claim this document verifies: `report()` never reverts on a receiver failure; the low-level `call()`'s boolean result is stored as `Transmission.success` and echoed in `ReportProcessed`, and that boolean means only "the call did not revert," nothing about what the receiver did internally |
| D2 | same repo, `contracts/cre/src/v1/interfaces/IRouter.sol`, same commit, read verbatim | Chainlink Labs / smartcontractkit | OFFICIAL | 2026-09-11 | `TransmissionState` enum (`NOT_ATTEMPTED, SUCCEEDED, INVALID_RECEIVER, FAILED`), the `AlreadyAttempted` and `UnauthorizedForwarder` errors, `getTransmissionInfo` |
| D3 | same repo, `contracts/cre/src/dev/MockKeystoneForwarder.sol`, same commit, read verbatim | Chainlink Labs / smartcontractkit | OFFICIAL | 2026-09-11 | Confirms the mock reproduces the identical `route()`/`ReportProcessed` isolation semantics as production, differing only in skipping the signature and config checks entirely — so this document's receiver-side design rules apply unchanged whether the counterparty is real or mocked |
| D4 | `cast sig "onReport(bytes,bytes)"` (Foundry, local) and an independent `keccak256` computation over the same string (Python, local), both run in this session | this document (derivation) / Foundry, PaulRBerg et al. | COMMUNITY (tool), applied to an OFFICIAL signature (C2) | 2026-09-11 | `0x805f2132`, agreeing by two independent methods; per Solidity's own interface-id rule (XOR of selectors declared directly in the interface, none inherited), and `IReceiver` (C2) declares exactly one function, this is `type(IReceiver).interfaceId` |
| D5 | `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` §9 (this repository) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The existing pattern this document's constructor-time forwarder check follows: `ChainlinkCREAdapter`'s constructor "refuses the chain's simulation forwarder (`ForwarderIsSimulationOnly`)" |
| D6 | `docs/unica-v4/SPEC-CONTRACTS.md` §6, §9 and `EVENT-SCHEMA.md` §2 (this repository) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The registry's lifecycle codes (PROPOSED/INITIALIZED/SEEDED/ACTIVE/PAUSED/RETIRED) and the error names (`WrongPayer`, `InputNotExact`, `DeliveryNotExact`) this document's admission layer must never be able to bypass |
| D7 | `docs/unica-v5/ens/POS-TERMINALS.md` §4.7 (sibling stream, cited, not edited) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The terminal revocation timeline this document's terminal-snapshot limit (§5 step 9) is bounded against |

## 2. Design boundary, restated as a constraint on this contract specifically

`REPORT-SCHEMA.md` §2 states the one design rule in prose (C7 there: "CRE may decide whether to
attempt a payment. Only the hook and executor decide whether a payment is valid on chain."). Here
it becomes a constraint on what this contract is allowed to contain:

- **No token transfer.** This contract holds no `transferFrom`, no `approve`, no `call` to any
  token or the executor that moves value. Its only effect is writing an admission record this
  document defines in §6.
- **No override of any hook or executor check.** A wrapper around `createOrder` — never
  `createOrder` itself (§6) — reads this contract's admission record as one *additional*
  precondition; every existing check in `SPEC-CONTRACTS.md` (D6) still runs, unchanged, on every
  call, whether or not admission is configured for a market.
- **Optional per market.** A market that never calls into this contract behaves exactly as
  `SPEC-CONTRACTS.md` already specifies; this contract's admission record is consulted only by a
  market that has opted in, never globally.
- **Fails closed.** Any check below that is not satisfied reverts. There is no code path in which
  `onReport` returns normally without either recording an admission or reverting (§7 explains why
  this specific property is load-bearing, not stylistic).

## 3. Required interfaces

Per C2 (`IReceiver`) and the forwarder's own `route()` check (`ERC165Checker.supportsInterface(
receiver, type(IReceiver).interfaceId)`, C1), this contract must:

1. Implement `onReport(bytes calldata metadata, bytes calldata report) external`.
2. Return `true` from `supportsInterface(bytes4 interfaceId)` for `interfaceId == 0x805f2132` (D4)
   and for ERC-165's own `0x01ffc9a7`, and `false` for `0xffffffff`, per ERC-165's own rule.

**This check runs before `onReport` is ever called, not inside it.** `route()` (C1) checks
`supportsInterface` itself and, on failure, sets `Transmission.invalidReceiver = true` and returns
`false` without calling `onReport` at all — so a receiver failing this check never sees a report,
and the forwarder's own `ReportProcessed` event carries `result = false` for that attempt, non-
retryable (§7 below: `invalidReceiver` and `success` are checked by the same `||` in `route()`'s
`AlreadyAttempted` guard, D1/D2, so an `invalidReceiver` transmission is not retried by the
forwarder either — a genuinely wrong interface declaration is a dead end for that specific
`(receiver, workflowExecutionId, reportId)` triple, not merely a slow one).

## 4. Constructor / immutable configuration

| Immutable | Type | Constraint |
|---|---|---|
| `FORWARDER` | `address` | non-zero; the chain's **production** `KeystoneForwarder`, never its `MockKeystoneForwarder` counterpart. Following D5's existing pattern (`ChainlinkCREAdapter`'s `ForwarderIsSimulationOnly`), the constructor reverts if `FORWARDER` equals a chain file's recorded simulation-forwarder address. On Robinhood Chain Testnet (46630) that means refusing `0x0b93082D9b3C7C97fAcd250082899BAcf3af3885` and accepting only `0x8E6E6A1f2B2D4dF503bfd67951CF28F27BF3AF19` (both addresses per `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` §4a, unchanged here) |
| `REGISTRY` | `address` | the `UnicaMarketRegistry` this receiver is scoped to (`AdmissionReport.registry` must equal this, §5) |
| `CHAIN_ID` | `uint256` | `block.chainid` at construction, re-asserted, never trusted from a report alone |
| `UNICA_RELEASE` | `bytes32` | the release tag this instance serves (matches `AdmissionReport.unicaRelease`, `REPORT-SCHEMA.md` §4 row 3) |
| `WORKFLOW_ID` | `bytes32` | the one workflow this receiver accepts reports from, checked **twice** (§5 step 4: once against the forwarder-supplied `metadata` argument, once against `AdmissionReport.workflowId` inside `report` — the double check is the direct answer to the UNCONFIRMED gap `REPORT-SCHEMA.md` §3 names) |
| `WORKFLOW_OWNER` | `address` | required alongside `WORKFLOW_ID` per C3's own collision warning (name/id validation without owner validation is insufficient); this contract never validates workflow name or id without owner in the same check |
| `REPORT_SCHEMA_VERSION` | `uint8` (or similar) | pinned tag identifying this exact struct layout; a report whose leading tag byte does not match is refused before any further decoding is attempted (§5 step 6, and `REPORT-SCHEMA.md` §8 item 5) |

No immutable above has a setter. A changed forwarder, registry, workflow, or release means a new
receiver instance and a new market-side wiring decision, matching UNICA v4's own no-upgrade
philosophy for the hook and executor (`EVENT-SCHEMA.md` §12).

## 5. `onReport` — the order of checks

Each step names its revert condition. A step that fails reverts the whole call; per §7, there is no
early `return` anywhere in this list — every rejection is a revert.

1. **Caller.** `msg.sender == FORWARDER`, else revert `NotForwarder`. This is the one check that
   stands in for signature verification from this contract's own point of view: `onReport` itself
   never inspects a DON signature (KeystoneForwarder already did, before this call, D1) — everything
   this contract can verify is that the caller *claiming* to be the forwarder is the exact pinned
   address, never a name, an interface match alone, or `tx.origin`.
2. **Metadata length.** `metadata.length == 64`, else revert `MalformedMetadata`. Per C1/C3's byte
   layout (`REPORT-SCHEMA.md` §3), the forwarder always supplies exactly 64 bytes on a real
   `KeystoneForwarder`; a shorter or longer slice means the caller is not delivering a real Keystone
   report, whatever address it presents as `msg.sender`.
3. **Metadata decode.** Split `metadata` into `workflowId` (bytes 0-31), `workflowName` (bytes
   32-41), `workflowOwner` (bytes 42-61), `reportId` (bytes 62-63), exactly as C1/C3 lay it out.
4. **Workflow identity, checked twice.** `workflowId == WORKFLOW_ID` and `workflowOwner ==
   WORKFLOW_OWNER` from the metadata argument (else `WorkflowMismatch` / `WorkflowOwnerMismatch`);
   later, after decoding `report` (step 8), `AdmissionReport.workflowId == WORKFLOW_ID` and
   `AdmissionReport.workflowOwner == WORKFLOW_OWNER` again (else the same errors). The two checks
   read different bytes of the same delivery — one from the forwarder's own argument, one from
   inside the signed business payload — closing the exact gap `REPORT-SCHEMA.md` §3 names
   (UNCONFIRMED whether the forwarder's metadata argument alone binds the receiver): this design
   does not rely on it alone. Workflow *name* (from metadata) is never checked without workflow
   *owner* in the same comparison, per C3's collision warning.
5. **Non-empty, minimum length.** `report.length` at least the fixed-field width of `AdmissionReport`
   (`REPORT-SCHEMA.md` §4, 25 input fields plus the schema tag byte of step 6), else revert
   `EmptyOrShortReport`. A `report` shorter than this cannot be this schema.
6. **Report schema tag.** The leading byte (or fixed-width prefix, `REPORT-SCHEMA.md` §8 item 5)
   equals `REPORT_SCHEMA_VERSION`, else revert `ReportSchemaUnsupported`. This runs before the ABI
   decode in step 7 so a differently-shaped report from a future schema version is refused by a
   single byte comparison rather than misdecoded into plausible-looking garbage.
7. **Decode, exact length.** `abi.decode` the remaining bytes into `AdmissionReport`
   (`REPORT-SCHEMA.md` §4); additionally assert the decoded length, re-encoded, equals the exact
   byte count consumed — i.e. no trailing bytes beyond the struct's fixed and dynamic parts are
   silently ignored. A `report` carrying extra appended bytes past a validly-decodable struct is
   refused (`UnknownTrailingData`), not truncated and accepted: `abi.decode` alone does not enforce
   this by default, so this is an explicit length check this contract adds, answering the brief's
   "rejection of unknown or malformed fields" directly rather than by assuming the decoder handles
   it.
8. **Chain id.** `AdmissionReport.chainId == CHAIN_ID`, else revert `ReportChainMismatch`. This is
   the field-level defense C3 names by name ("embed a `chainSelector` field... and reject
   mismatches") applied with `block.chainid` rather than a CCIP-style chain selector, since this
   check runs on the destination chain itself and has no cross-chain messaging step to authenticate
   separately.
9. **Verifying contract and receiver.** `AdmissionReport.verifyingContract == address(this)` and
   `AdmissionReport.receiver == address(this)`, else revert `ReportReceiverMismatch`. Both fields
   are checked (`REPORT-SCHEMA.md` §4 row 25 requires them to agree by construction); a report
   naming a different receiver than the one processing it is refused even if every other field is
   otherwise valid.
10. **Release and registry.** `AdmissionReport.unicaRelease == UNICA_RELEASE` (else
    `ReleaseMismatch`) and `AdmissionReport.registry == REGISTRY` (else `RegistryMismatch`).
11. **Market registration and status.** `REGISTRY.getMarket(AdmissionReport.marketId)` must exist,
    and its stored `version` must equal `AdmissionReport.marketVersion` (else `MarketVersionStale`
    — the exact defense §4 row 6 names against a RETIRED-and-relisted market, D6's lifecycle codes).
    Status must be ACTIVE (never PROPOSED, INITIALIZED, SEEDED, PAUSED, or RETIRED, else
    `MarketNotActive`) — read live from `REGISTRY` at the moment `onReport` runs, never cached from
    the report itself, since the report's own author cannot see a pause that happens after it was
    generated.
12. **Expiry.** `block.timestamp <= AdmissionReport.quoteExpiry` (else `QuoteExpired`) and
    `block.timestamp <= AdmissionReport.policyExpiry` (else `PolicyExpired`), checked as two
    separate conditions with two separate errors, per the two fields' distinct purposes
    (`REPORT-SCHEMA.md` §4 rows 15-16).
13. **Terminal status snapshot.** If `AdmissionReport.terminalNode != 0`: this contract does not,
    and structurally cannot, re-resolve ENS state itself — it only recorded that the workflow
    *asserted* `terminalStatusSnapshot` as the status it observed. This is the documented limit
    `REPORT-SCHEMA.md` §4 row 18 already states: a terminal revoked (D7's revocation timeline)
    between report generation and this call is not caught here, only bounded by step 12's
    `policyExpiry`. No stronger check is specified in this document (open question, §8).
14. **Single-use nonce.** `!consumed[AdmissionReport.orderNonce]`, else revert `NonceAlreadyUsed`;
    then `consumed[AdmissionReport.orderNonce] = true` before any further state write (checks-
    effects-interactions). This is UNICA-level replay protection, **distinct from and in addition
    to** the forwarder's own `transmissionId` dedup (§7) — the forwarder's dedup keys on
    `(receiver, workflowExecutionId, reportId)`, none of which is `orderNonce`; a second, differently
    -`reportId`'d workflow execution carrying the *same* `orderNonce` would pass the forwarder's own
    dedup cleanly and must be caught here instead.
15. **Compute and store.** Recompute `admissionDigest` from the decoded fields exactly as
    `REPORT-SCHEMA.md` §5 defines (never trust a supplied digest, since none is supplied — field 26
    is derived, not decoded, per that document's §4 note). Write an admission record keyed by
    `AdmissionReport.orderNonce`: `{merchant, payer, inputAsset, outputAsset, exactInput,
    inputAmount, minOutput, marketId, quoteExpiry, policyExpiry, admissionDigest, grantedAt:
    block.timestamp}`. `quoteExpiry` and `policyExpiry` are carried into the stored record, not
    discarded once step 12's check has run: §6 re-checks both again at the moment an order is
    actually created, which is a later and separate moment from report delivery, and the record has
    to hold the bound for that second check to read. Emit an event carrying the same fields and
    `admissionDigest`. This is the only state change `onReport` makes; no further step exists after
    it.

**No step above is a `return`.** Every numbered failure is a `revert`. §7 explains why.

## 6. How order creation consumes an admission record

Not this contract's own function, and never a modification of `createOrder` itself. This section
specifies an external wrapper contract that a market's factory deploys alongside a market opting
into admission — no change to `UnicaMarketHook`, `UnicaMarketExecutor`, `UnicaMarketFactory`, or any
other v4 contract's own source, ever. This is the same boundary `CONFIDENTIAL-COMMERCE.md` §3 states
for the design this receiver serves: "an on-chain gate that makes `createOrder` itself check a CRE
report... is a distinct, larger design this document does not attempt." A market that opts into
admission directs callers to this wrapper instead of calling `createOrder` directly; the wrapper
requires, before forwarding the call to the existing, unmodified `createOrder`:

1. An admission record exists for the caller-supplied `orderNonce` (else refuse — the order is
   simply never created, no different in kind from any other precondition `SPEC-CONTRACTS.md`
   already imposes on `createOrder`).
2. **Freshness at the moment of creation, re-checked, not assumed from delivery time.**
   `block.timestamp <= record.quoteExpiry` and `block.timestamp <= record.policyExpiry` (else
   refuse, `AdmissionExpired`) — read from the two fields §5 step 15 now carries into the stored
   record. `onReport` step 12 already checked both once, against the timestamp the report was
   *delivered*; `createOrder` can be called at any later time the market's own allowlist and
   lifecycle otherwise permit, so an admission computed against a short-lived quote would stay
   consumable indefinitely once merely delivered unless this second, independent check re-applies
   both bounds at the moment that actually matters — order creation, not report delivery
   (`REPORT-SCHEMA.md` §4 rows 15-16).
3. The order's own `recipient`, `boundPayer`, `amountIn`/`minOut` match the admission record's
   `merchant`, `payer`, `inputAmount`/`minOutput` **exactly**, by literal equality — never a wildcard
   — (or, for `exactInput == false`, the order's `amountIn` is at most the admission's `inputAmount`
   ceiling) — else refuse. This is where "exact order binding" in the brief is actually enforced: the
   admission record cannot bind an order that does not yet exist at `onReport` time (§2's "no
   override" rule means `onReport` never creates an order itself), so the binding is a **cross-check
   at order-creation time** against the record `onReport` already wrote, not a check inside
   `onReport`. **The zero address is never read as "any payer."** UNICA v4 is payer-bound only, so no
   order this wrapper is ever asked to forward has a zero `boundPayer` (`Q111`, `Q128`, cited via
   `SPEC-ORACLE-AND-CHAINS.md` §16); consequently an admission record whose `payer` field
   (`REPORT-SCHEMA.md` §4 row 8) is the zero address matches no real order under this literal
   comparison — it is consumption-dead, never a substitutable stand-in for an unbound payer. This
   wrapper must never implement a special case that reads a zero `payer` as "match any caller": that
   is exactly the shape `SECURITY-ADVISORY-001.md` found — an authorization that leaves one party's
   half of the deal free for whoever submits it.
4. Every existing `SPEC-CONTRACTS.md` check on `createOrder` still runs, unchanged, inside the
   `createOrder` call the wrapper forwards to.

This two-step shape (an admission record now, a matching order later) is why `orderNonce` (a
workflow-chosen value, `REPORT-SCHEMA.md` §4 row 14) and `orderId` (a hash `SPEC-CONTRACTS.md`/
`EVENT-SCHEMA.md` §6.1 already define, computed only when `createOrder` actually runs) are two
different values naming two different points in time, deliberately.

## 7. The lead: can a mined, successful-looking write correspond to nothing happening?

The brief for this stream asks this to be verified against official documentation, not assumed.
It is verified here against primary source, D1/D2, read in full in this session.

**What `KeystoneForwarder.report()` actually does on a receiver-side failure (D1, lines 129-167 of
the fetched file).** `route()` calls the receiver via a raw assembly `call()`, not a Solidity
external call with automatic revert propagation: `success := call(remainingGas, receiver, 0,
add(payload, 0x20), mload(payload), 0x0, 0x0)`. If that call reverts, `success` is simply `false` —
`route()` does not re-throw it, does not bubble up the receiver's revert reason, and does not fail
the outer `report()` transaction. `report()` itself then emits `ReportProcessed(receiver,
workflowExecutionId, reportId, success)` unconditionally and returns normally. **A receiver that
reverts on every input, always, produces a mined `report()` transaction with status 1** — the
revert is fully contained inside the isolated `call()`, and only `ReportProcessed`'s own boolean,
`false` in that case, records it.

**So the specific lead — a write can report success while the receiver-level result is false —
is CONFIRMED, with one precise correction.** `ReportProcessed`'s `result` field is not itself "the
receiver's business result"; it is **only** "did the low-level call into `onReport` revert." Chainlink's
own struct comment (D2, `IRouter.TransmissionInfo.success`) says as much directly: "Whether the
transmission attempt was successful. If `false`, the transmission can be retried with an increased
gas limit" — a note about **retry eligibility**, not about what the receiver's storage now holds.
The genuinely dangerous case the lead points at is not `result == false` (that is visible, logged,
and — per D1's `AlreadyAttempted` guard interacting with `invalidReceiver`, §3 above — either
retryable or a documented dead end) — it is a receiver whose `onReport` **returns normally without
reverting on a case it should have rejected**. In that case `ReportProcessed` carries `true`, the
transaction is indistinguishable on its face from a correct acceptance, and the receiver has done
nothing — or worse, something other than what the report's fields describe.

**The design rule this document adopts because of this finding (§2's "fails closed," restated with
its mechanism now shown): `onReport` must never contain a branch that returns normally without
either completing step 15 of §5 or reverting.** Every one of the fifteen checks in §5 is written as
a revert, not an early `return`, specifically so that `ReportProcessed(..., true)` can only ever
correspond to the one accept path (§5 step 15) actually having run. This is a property of this
document's own contract design, not something Chainlink's forwarder enforces or could enforce —
D1's `route()` has no visibility into what a receiver's internal logic decided; it can observe only
whether the call reverted.

**"Delivered" therefore requires all five of the following, not any one of them:**

1. The forwarder's `report()` transaction is mined at status 1.
2. That transaction's logs contain `ReportProcessed(receiver == this contract, workflowExecutionId,
   reportId, result == true)` for the specific `transmissionId` this admission was expected under
   (`getTransmissionId(receiver, workflowExecutionId, reportId)`, D1/D2) — not merely *a*
   `ReportProcessed(true)` log, since more than one receiver could be targeted in principle by
   different reports in the same block.
3. This contract's `onReport` is built so that a `true` result is only reachable through §5 step 15
   (the design rule above) — without this property, step 2 alone proves only "did not revert,"
   never "admitted."
4. A direct read of this contract's own storage, after the transaction, shows the specific admission
   record §5 step 15 writes, with fields matching the report that was supposedly delivered — the
   event and the boolean are a claim; the contract's own state is the check.
5. Finality: enough confirmations have passed on the receiving chain that steps 1-4 are not at risk
   of a reorg unwinding them. This document does not pin a confirmation count for Robinhood Chain
   Testnet (46630) or any other chain — **UNKNOWN**, not found in any source this document consulted
   (§9).

A write status of 1 alone is never delivery. A `ReportProcessed(..., true)` log alone is never
delivery either, absent property 3 above holding in the deployed contract's actual code. Both
statements are now shown from D1's source, not asserted from expectation.

## 8. What this document does not establish

- That this contract has been written, compiled, or deployed. It has not.
- That any of the fifteen `onReport` checks in §5 have been exercised against a real or mocked
  forwarder call. They have not: no test exists for a contract that does not exist.
- A confirmation count for finality on any chain (§7 point 5) — UNKNOWN.
- Whether ERC-165's own `0x01ffc9a7` self-declaration and the `0xffffffff` negative case (§3 item
  2) are exercised correctly by any particular OpenZeppelin `ERC165` base contract version an
  implementation might choose — this document names the requirement, not an implementation.
- A stronger terminal-revocation check than the `policyExpiry` bound (§5 step 13) — open question.
- That Chainlink's `KeystoneForwarder` at address `0x8E6E6A1f2B2D4dF503bfd67951CF28F27BF3AF19` on
  chain 46630 has ever called any contract's `onReport`, for this schema or any other. It has not,
  per `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` §4a's own findings.

## 9. Open questions

1. **Owner:** how strong a terminal-revocation check is worth building beyond the `policyExpiry`
   bound (§5 step 13) — a live ENS read from this contract is possible in principle but adds an
   external call and an availability dependency to an otherwise self-contained accept path; not
   evaluated here.
2. **Owner:** the finality/confirmation count for any chain this receiver might be deployed to
   (§7 point 5) — no source consulted for this document states one for Robinhood Chain Testnet.
3. Whether `consumed[orderNonce]` (§5 step 14) should ever be clearable (e.g., an admission that
   expires unused) or must remain permanently set — this document specifies permanent consumption
   only, the simpler and more conservative choice, and does not evaluate an expiry-driven reclaim.
4. The exact revert-error catalogue in §5 is this document's own naming, not checked against
   `SPEC-CONTRACTS.md`'s existing error catalogue (`docs/unica-v4/SPEC-CONTRACTS.md` §9) for
   collisions or a shared namespace convention — an implementation-time reconciliation, not done
   here.
5. Whether `getTransmissionInfo` (D1/D2) should be called by an off-chain watcher as a second,
   independent read of forwarder-side delivery state, alongside the direct receiver-state read §7
   point 4 requires — PROPOSED as a good practice, not specified as a requirement of this contract.

## Sources referenced

- https://github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/v1/KeystoneForwarder.sol
- https://github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/v1/interfaces/IReceiver.sol
- https://github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/v1/interfaces/IRouter.sol
- https://github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/dev/MockKeystoneForwarder.sol
- docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md (this repository)
- docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md (this repository)
- docs/unica-v4/SPEC-CONTRACTS.md (this repository)
- docs/unica-v4/EVENT-SCHEMA.md (this repository)
- docs/unica-v5/ens/POS-TERMINALS.md (sibling stream, cited, not edited)
- docs/unica-v5/chainlink/REPORT-SCHEMA.md (this stream, companion document)
