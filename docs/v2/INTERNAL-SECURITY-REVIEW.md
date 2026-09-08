# UNICA V2 — internal security review and audit-readiness package

**This is not an audit.** No third party has reviewed this code. It is an internal review, carried
out by the people who wrote the thing being reviewed, and it should be read with the discount that
deserves. Its purpose is to make an external audit cheap and fast: everything an auditor would
otherwise have to reconstruct — scope, boundaries, assumptions, what is proven and by which named
test, and what is known to be wrong — is written down here.

| | |
|---|---|
| **Reviewed at** | commit `083d2d2` on `main`, 2026-09-08. This package lands in the commit immediately after. |
| **Subject** | `src/v2/` — the V2 quote-settlement core, frozen as `v2.0.0-rc1` |
| **Deployment status** | **Nothing is deployed.** No V2 contract exists on any chain, testnet included. |
| **Verdict** | **DO NOT DEPLOY `v2.0.0-rc1`.** One Critical finding is open and reproduced. See [Findings](#findings). |

---

## 1. Scope

**In scope** — the frozen core, five files:

| File | Blob at `083d2d2` |
|---|---|
| `src/v2/QuoteSettlementHook.sol` | `c955c6f7649d13dbfa66068fe904f3bba6ec0b7f` |
| `src/v2/QuoteSettlementExecutor.sol` | `8284e7eb84b0dee5be1b4e366a92c579171b3473` |
| `src/v2/MerchantConfig.sol` | `8cb14dfdce66e6ee9c9de780280d60bda5b1616f` |
| `src/v2/interfaces/IQuoteSettlement.sol` | `df8405af9581bd5f7fb30252c9858d1322eb726e` |
| `src/v2/interfaces/IPermit2Transfer.sol` | `c8b740d44d091ad64b18581a293602505ade909a` |

These five have been byte-identical since the freeze; the hashes above are the check. Nothing in
this review changed any of them.

**Also reviewed, outside the freeze:** `tools/unica-verify` (the read-only receipt verifier) and the
verification harness itself — the gate, the tool ledger, the fixtures — because a verifier that lies
and a gate that reports a failure as a skip are security problems of their own, and the second one
turned out to be true.

**Out of scope:** V1 (`src/V4SettlementHook.sol`, `src/SettlementExecutor.sol`) — a separate,
deployed codebase with no Permit2 path and no merchant-signed quote, byte-identical since the
`live-green` tag and unaffected by everything below. Uniswap's PoolManager, Permit2, and the
OpenZeppelin and v4-periphery libraries are dependencies, trusted as such and not audited here.
`integrations/` is out of scope by construction: those modules sit outside the core and cannot
weaken it.

## 2. Architecture, in one paragraph

Two contracts. `QuoteSettlementExecutor` is a payment terminal: it takes a merchant-signed EIP-712
quote and a payer-signed Permit2 authorisation, validates every field of the quote against itself
and against the pool it names, then opens a PoolManager unlock, runs one exact-output swap, has
Permit2 move the payer's token **from the payer straight to the PoolManager** (never through the
executor), settles, and `take`s the output **straight to the merchant**. `QuoteSettlementHook` runs
inside the PoolManager on that pool and decides whether the swap it is watching is the settlement
the executor declared: it checks the swapper, the pool, the direction, that the swap is exact-output,
and that the delivered amount meets the quote's floor, then marks the quote consumed and lets the
receipt be emitted. Neither contract holds a balance at rest, and the two are bound to each other at
construction in both directions.

The hook's own summary of what it proves, returned by `whatThisHookProves()`:

> the swap discharged an admitted invoice in full; not that the merchant was paid

That distinction is the architecture. The hook proves the swap; the executor proves the payment;
the transaction's atomicity is what makes the pair mean something.

## 3. Privilege map

**There is no privileged role.** This is the strongest structural property in the design and it is
worth stating precisely, because "no admin" is often claimed and rarely true.

| Question | Answer | How it is checked |
|---|---|---|
| Owner, admin, governance? | none | `git grep -E "onlyOwner|Ownable|pause"` over `src/v2` returns nothing |
| Upgradeable? | no | no proxy, no `delegatecall`, no `selfdestruct` anywhere in `src/v2` |
| Pausable? | no | there is no pause and no circuit breaker |
| Mutable configuration? | none | every address is a constructor `immutable`: `POOL_MANAGER`, `PERMIT2` on the executor; `EXECUTOR` on the hook |
| Who may call `settle`? | anyone | and that is the point — a relayer chooses only *whether* to submit, never *what* |
| Who may call `unlockCallback`? | the PoolManager only | `NotThePoolManager` |
| Who may write `consumed`? | the hook, inside `_afterSwap`, reachable only through the PoolManager | |

The full external surface is small. Executor: `settle`, `unlockCallback`, and six view/pure helpers
(`DOMAIN_SEPARATOR`, `activePayer`, `hashQuote`, `paymentWitness`, `hashMerchantConfig`,
`paymentWitnessTypeString`). Hook: `getHookPermissions`, `activeQuote`, `consumed`,
`whatThisHookProves`, and the `BaseHook` callbacks.

Hook permissions are `0x20C0` — `beforeInitialize`, `beforeSwap`, `afterSwap`. **All four
`*ReturnDelta` permissions are false**, so the NoOp/return-delta surface — the one that can take a
swapper's input and give nothing back — is deliberately not claimed. The bits are asserted both
ways in `test/v2/DeploymentRehearsal.t.sol`: the mined address carries exactly these and no others,
and the declared permissions and the address bits agree in both directions.

## 4. Assumptions

These are the things this review takes as given. An auditor should attack them.

1. Uniswap's deployed PoolManager behaves as its source says. Tests use the official **bytecode**
   via `hookmate`, not a mock, and the fork suites use the real deployed contract.
2. Permit2 at `0x000000000022D473030F116dDEE9F6B43aC78BA3` behaves as its source says, including
   its witness composition and its `InvalidSigner` / `InvalidNonce` refusals.
3. OpenZeppelin `ECDSA.recover` (v5.5.0, pinned) rejects malleable and zero-recovering signatures.
4. `solc 0.8.30`, `evm_version = cancun`, `via_ir = false`, `bytecode_hash = none`,
   `cbor_metadata = false`. `via_ir = false` is load-bearing rather than a preference: V1's live
   address was mined under exactly these settings.
5. Transient storage (EIP-1153) behaves per spec, including that `TLOAD` is legal inside a
   `STATICCALL`.
6. The merchant's signing key is not compromised. **The payer's authorisation, however, is assumed
   to be observable** — it travels to a relayer and appears in a pending transaction. Finding
   V2-001 is what happens when that assumption is taken seriously.
7. Payout tokens deliver exact amounts. A fee-on-transfer output token is refused by measurement,
   not by an allowlist.

## 5. Threat model, summarised

The full analysis is [`docs/THREAT-MODEL.md`](../THREAT-MODEL.md), written before the event and
published unedited in [`specs/`](../../specs/README.md). The V2-specific actors:

| Actor | Can do | Must not be able to |
|---|---|---|
| **Relayer** | submit a settlement two other parties already agreed to; choose gas and timing | change any term of it, redirect it, or profit from it |
| **Mempool observer** | see everything the relayer sees, earlier | anything the relayer must not do |
| **Hostile merchant** | sign any quote naming themselves | reach a payer's authorisation, or a pool they do not name |
| **Hostile payer** | sign any authorisation | receive output, or replay a settled quote |
| **Hostile token** | reenter, misreport balances, take fees | break the accounting, or be paid as if it delivered |
| **Hostile pool creator** | initialise a pool carrying this hook | make a settlement reachable through it |

## 6. Invariant matrix

Every row names the enforcement point and a test. All named tests run in `make gate`.

| # | Invariant | Enforced at | Proven by | State |
|---|---|---|---|---|
| V1 | Only the executor's own swap is admitted on a guarded pool | hook `_beforeSwap`, swapper check | `test/v2/HookAdmission.t.sol` | **HELD** |
| V2 | The swap is exact-output and meets the quote's floor | hook `_beforeSwap` / `_afterSwap` | `test/v2/InvoiceFill.t.sol`, `ShortFill.t.sol` | **HELD** |
| V3 | Every quote field is inside the merchant's EIP-712 digest | `hashQuote` | `test_Refuse_EverySignedFieldIsInsideTheDigest` (16 fields, one at a time) | **HELD** |
| V4 | A quote settles at most once | hook `consumed[digest]`, read by the executor and written by the hook | `test/v2/SettlementRefusals.t.sol`, fork replay row | **HELD** |
| V5 | The payer is never charged more than the signed ceiling | Permit2 `permitted.amount = q.maxIn`, plus `actualIn <= maxIn` | `test/v2/Permit2Witness.t.sol` | **HELD** |
| V6 | The output reaches the quote's recipient and nobody else | executor `take` to `q.recipient`, then `_proveThePayment` on real balances | `test/v2/Settlement.t.sol` | **HELD, but see V2-001** |
| V7 | Neither contract holds a balance at rest | `ExecutorHeldTheInput` / `ExecutorHeldTheOutput`, measured as deltas | `test/v2/Settlement.t.sol` | **HELD** |
| V8 | The receipt is emitted only after every check passed | receipt emitted after `_proveThePayment` returns | `test/v2/B1Settlement.t.sol` | **HELD** |
| V9 | Hook and executor are bound to each other in both directions | executor asks `hook.EXECUTOR()`; hook's `EXECUTOR` is immutable | `test/v2/SettlementRefusals.t.sol` | **HELD** |
| V10 | The merchant's signature does not replay across chains or deployments | `DOMAIN_SEPARATOR()` recomputed per call, binding `block.chainid` and `address(this)` | `test/v2/SigningVectors.t.sol` | **HELD** |
| **V11** | **The payer's authorisation funds only the quote the merchant signed** | **nowhere** | `test/v2/WitnessBinding.t.sol` | **BROKEN — V2-001** |

V11 is not a new requirement invented by this review. It is the contract's own stated property,
written in its header: *"WHAT A RELAYER MAY CHOOSE: nothing… not the recipient."* The review's
contribution is discovering that nothing enforces it.

## 7. External dependencies

| Dependency | Pin | Trust |
|---|---|---|
| `lib/uniswap-hooks` (v4-core, v4-periphery, OpenZeppelin) | `bd5287c4a9f5c22c2393f7587a9b357662916115` | trusted, not audited here |
| `lib/hookmate` (official deployed bytecode artifacts) | `ef3e9845e0b2bc9cd5810644d7d337b00c47bc75` | used so tests run against real bytecode rather than mocks |
| `lib/forge-std` | `452bdecf8772bf113532f67c5cf3accb71895cd0` | test-only |
| PoolManager (Sepolia) | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | code hash pinned in `tools/unica-verify/fixtures/sepolia-pins.json` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | as above |
| CREATE2 deployer | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | as above |

`ffi = false` and `fs_permissions = []` — the test suite cannot shell out or read the filesystem.

## 8. Test inventory

Measured at `83ecbfc`. Counts reproduce; timings do not, so none is quoted.

| Suite | Count | Runs in |
|---|---|---|
| Solidity, gate scope (`--no-match-path 'test/fork/*'`) | **182 passed, 0 failed**, 21 suites | `make gate` |
| Solidity, including fork | **226 passed, 0 failed**, 27 suites | `forge test` |
| Fork rows alone, at pin 11661031 | 44 | `make fork` |
| Vyper (`mox` / titanoboa) | 81 passed | `make gate` |
| Arc nanopayments proof | 141 rows | `make gate` |
| ENSv2 resolution | 136 rows | `make gate` |
| ENSv2 identity chain | 95 rows — see V2-007; before 2026-09-08 this suite crashed at row 30 and had never run to completion | `make gate` |
| Receipt verifier | **113 rows**, no endpoint needed | `make gate` |
| CRE deterministic policy | 88 rows | `make gate` |
| CRE workflow adapter | 86 rows | `make gate` |
| Signing vectors (offline) | 81 rows | `make gate` |
| Secret and copied-source scans | 17 checks | `make gate` |
| Permit2 digest (second derivation) | 20 rows | `make gate` |
| Tool ledger | 35 tools / 25 checks | `make gate` |

Fuzzing is 10,000 runs, set in `foundry.toml` and identical in CI.

`make gate` exits 0 at this commit, **with no SKIP lines** — every runner was present and every
suite actually ran. That sentence could not have been written before V2-006 was fixed.

## 9. Mutation inventory

`make gate` answers "do the tests pass". The mutation suite answers the question that actually
matters: **would the tests notice if the code were wrong?** Every guard is validated by deletion,
and a mutation counts as killed only when *the row that names it* goes red. A mutation that turns
some *other* row red is recorded as MISATTRIBUTED — a finding, not a pass.

| Campaign | Result | Command |
|---|---|---|
| Local mutations | **30 run, 30 killed by their own declared row, 0 misattributed.** Control: 127 rows green before any mutation, and green again after the tree was restored. Re-measured 2026-09-08. | `make mutants` |
| Fork mutations | 18 of 18 killed, last measured 2026-09-07. **Not re-run at this commit.** | `make fork-mutants` |

The suite exists because this repository has twice measured a guard whose deletion left every row
green.

## 10. Fork evidence

The fork suites run against Ethereum Sepolia pinned at block **11661031**, using the real deployed
PoolManager, the real Permit2, and the canonical CREATE2 deployer. The endpoint falls back to a
public node, so no credential is required to reproduce them.

What the fork suites establish that local suites cannot: the hook address is mined and deployed
through the canonical deployer against real code; a merchant is paid exactly through the official
stack; a replay changes nothing; a hostile input token and a hostile output token are both refused;
and the dependency code hashes are what the pins say.

**Nothing was broadcast.** The V2 hook and executor exist only inside the fork.

## 11. Deployment rehearsal

`test/v2/DeploymentRehearsal.t.sol` — 9 rows, and it is a `forge test`, which structurally cannot
broadcast. It proves: the mined address carries exactly the declared permission bits and no others;
permissions and bits agree in both directions, with all four return-delta permissions asserted
false; the salt search is deterministic; the CREATE2 prediction is reproduced by hand; the
executor's address follows from deployer and nonce; the deployment order is forced by the binding;
and both contracts fit EIP-170 and EIP-3860.

`docs/v2/release-manifest.json` records the inputs a deployment would use. The executor's deployed
code is 18,369 bytes with 6,207 of headroom; the hook's is 8,317 with 16,259.

A correction worth recording, because the first cost estimate for fixing V2-001 got it wrong: **a
change to the executor's source does not move the mined hook address.** The executor is deployed by
plain `CREATE`, so its address is `keccak(rlp(deployer, nonce))`, independent of its bytecode; the
hook's creation code embeds the executor's *address*, not its code hash.

## 12. Findings

Severity: Critical / High / Medium / Low / Informational.

| # | Severity | Subject | Status |
|---|---|---|---|
| V2-001 | **Critical** | the payer's witness does not bind the merchant's half of the quote | **OPEN — blocks the release** |
| V2-002 | High | the verifier's online mode never fetched the receipt | fixed `daec8f6` |
| V2-006 | High | the gate reported failing suites as a missing runner | fixed `bc34099` |
| V2-007 | Medium | the ENS identity suite had never run past a third of its rows | fixed `9cd92e2` |
| V2-003 | Low | a malformed code-hash pin was skipped in silence | fixed `daec8f6` |
| V2-008 | Low | three ledger measurements were not true of the tree | fixed `eaa2ee9` |
| V2-004 | Informational | two declared errors are never raised | accepted |
| V2-005 | Informational | `InputIsNotADebit` is unreachable and untested | accepted |

Four of the eight are in the **verification harness**, not in the contracts. That ratio is itself a
finding: this repository's confidence rests on its gate, and the gate was the least examined thing
in it.

### V2-001 — Critical — OPEN

**The payer's Permit2 witness does not bind the merchant's half of the quote.** Two quotes differing
only in `merchantSigner` and `recipient` produce a byte-identical payer signing digest, so one payer
authorisation funds either. A relayer, or anyone watching `settle` in the mempool, can rebuild the
quote naming themselves, sign it with their own key, present the payer's authorisation unchanged,
and take delivery. The honest settlement then fails on the spent nonce.

Reproduced end to end in `test/v2/WitnessBinding.t.sol`. Full analysis, the exploit trace, the fix,
and its blast radius: [`SECURITY-ADVISORY-001.md`](SECURITY-ADVISORY-001.md).

**Remediation status: not fixed.** The defect is in a frozen file and the fix moves the payer's
EIP-712 signing digest, which is an rc2 and an owner decision. The exploit is kept executable and
named in the suite rather than described in prose, so no fix can land without breaking it.

### V2-002 — High — FIXED at `daec8f6`

**`tools/unica-verify` online mode never fetched the receipt when the caller supplied one** — which
the CLI always does. The one thing online mode exists to establish, that the transaction is in a
chain at all, was never established, and the row recorded PASS with the detail "supplied by the
caller". A fabricated receipt for a transaction in no chain verified clean unless the opt-in
`--check-consumed` was passed. Online mode now always looks the receipt up by hash and compares the
caller's copy field by field, including the settlement log.

### V2-003 — Low — FIXED at `daec8f6`

**A malformed code-hash pin was skipped in silence.** A pins file that lost four of five `codeHash`
values produced one comparison row and a report indistinguishable from one where all five were
compared. Malformed entries now get their own failing row, and the number of pin rows always equals
the number of entries.

### V2-006 — High — FIXED at `bc34099`

**The gate reported failing suites as a missing runner.** Every external-tool row was written as

```sh
command -v node >/dev/null 2>&1 && node X || echo "SKIP  ...: node is not installed"
```

In `sh` that returns 0 whenever `X` **fails**. A broken suite printed "node is not installed" and
the gate went green — and the message was worse than silence, because it named a cause that was
false. Node was installed the whole time. Thirteen rows carried the defect and three suites were
sitting behind it (V2-007, V2-008, and the ENS identity demo, which exited 1).

This is the most serious finding in the package after V2-001, because it is the finding that makes
every other green result in this repository conditional. Every claim of the form "N rows pass, in
the gate" made before `bc34099` was true only of the suites that happened not to be broken.

The rows now go through one `if/then/else` helper, which returns the command's own status: a
missing runner is a skip and says so; a failing tool fails the build. Validated in the only order
that counts — the fix was written first and the gate went red, naming the real cause, before
anything was repaired.

### V2-007 — Medium — FIXED at `9cd92e2`

**The ENS identity suite had never run past a third of its rows.** `identity-test.mjs` reads
`F.returnVectors.policyReturnVector`; the fixture has never had a `returnVectors` key, in any
commit. The suite crashed there every time, so the policy decoder, the fail-closed read, and the
entire identity-to-quote binding had never been exercised. The "95 rows" figure in the ledger was
the intended count, not a measured one.

The generator wrote decoded Python values only, while its own note claimed the JavaScript decoder
was checked against "Vyper's actual output rather than against an assumption". It now captures the
raw ABI return data out of the in-process EVM, which is what that sentence always claimed. 95 rows,
95 passed.

### V2-008 — Low — FIXED at `eaa2ee9`

**Three ledger measurements were not true of the tree.** The Vyper workspace was recorded at 33
tests and runs 81; the identity chain's 95 rows had never run (V2-007); and its decoder was
described as checked against `cast abi-encode` output rather than against Vyper's own bytes. All
three came from carrying numbers forward instead of re-measuring.

Separately, the ledger's staleness rule could only fire *after* an offending commit existed, so it
guaranteed a red gate on a commit that was already written and sometimes already pushed. It now
asks the same question of the working tree, where the fix is still free (`083d2d2`).

### V2-004 — Informational — OPEN, accepted

**Two declared errors are never raised in V2.** `NotTheQuotedPayer` and `UnknownHookDataVersion` are
declared in `src/v2/interfaces/IQuoteSettlement.sol` and raised nowhere — dead ABI selectors. They
are inside the interface freeze, so removing them is an rc2 change for no security benefit.

### V2-005 — Informational — OPEN, accepted

**`InputIsNotADebit` is raised at `QuoteSettlementExecutor.sol:392` and has no test.** With the
official PoolManager under exact output the input leg is always a debit, so the branch is
unreachable. It is recorded here rather than covered, because the only way to reach it is a
permissive PoolManager-shaped mock, and a test whose evidence is a mock that does what no real
PoolManager does is worse than a stated gap.

### Candidates raised and dismissed

Four further candidates were raised during the review and dismissed under adversarial verification.
They are recorded because a dismissal an auditor can re-check is worth more than a finding list with
the near-misses deleted.

| Candidate | Why it was dismissed |
|---|---|
| Anyone can initialise a pool carrying the hook and mint a receipt naming an arbitrary recipient | The mechanism is real and permissionless, but the receipt it produces is **true in every field**: the attacker's own money paid the named recipient. No false statement is produced, and nothing else is reachable from such a pool. |
| The `afterSwap` comment calls the output "the unspecified currency", backwards under exact output | The wording is wrong and the code is right. The guard on the same line fails closed on the hypothesised mis-edit, and a control row goes red immediately. Filed as a comment defect, not a security finding. |
| The verifier refuses a transaction carrying two settlements, but the executor permits batching | Deliberate, documented on the line above the code, and covered by two tests. The proposed alternative breaks one of them. |
| The chain-identity row compares `evidence.chainId` with itself | False as stated. `test.mjs:212` is verbatim that experiment and asserts the refusal arrives by name on the digest row; sabotage S5 is its control. |

Fifty further hazards were checked and dismissed with a stated reason during the review — permission
bits versus implemented callbacks, delta sign conventions, the sync/settle window, reentrancy
through hostile tokens, nonce and deadline binding, signature malleability, transient-context
staleness, and others.

## 13. Known limitations

- **Merchant signers must be EOAs.** The quote is verified with `ECDSA.recover`; a contract wallet
  cannot be a merchant signer. The payer's side goes through Permit2, which *does* support
  EIP-1271, so a contract-wallet payer works. Two different answers to what sounds like one
  question. See [`EIP1271-BACKLOG.md`](EIP1271-BACKLOG.md).
- **The receipt does not carry `merchantConfigHash`.** It is inside the quote digest, so the
  commitment is covered, but "every settlement for merchant configuration X" is not a query the log
  can answer. Analysed and closed in [`COMPATIBILITY-001.md`](COMPATIBILITY-001.md).
- **Payout-asset policy is not implemented.** V2 refuses an output token that cannot deliver an
  exact amount; which tokens *should* qualify is a policy question with a written specification and
  no code.
- **No formal verification, no fuzzing of the multi-contract composition beyond 10,000 runs per
  test, no Slither or Mythril run recorded in this package.**

## 14. Accepted risks

| Risk | Why it is accepted |
|---|---|
| Anyone may initialise a pool carrying the hook | Permissionless initialisation is v4's model. A hostile pool is unreachable from a settlement because the quote names its pool and the merchant signed it. |
| A relayer can choose not to submit | Censorship by inaction is outside what any on-chain guard can prevent; the payer's authorisation expires. |
| `consumed` grows without bound | One storage slot per settled quote, paid by the settler. |
| Dead ABI selectors (V2-004) | Inside the freeze; removing them costs an rc2 and buys nothing. |

## 15. Method, and what it could not establish

Five review dimensions ran independently — authorization and privilege, quote integrity and replay,
Uniswap v4 mechanics, Permit2 and token behaviour, receipts and rollback — each required to return
both findings and a list of hazards checked and dismissed with reasons. Nine candidates went to
adversarial verification, where each was assigned to a reviewer instructed to refute it. Five
survived; four did not.

**Three of the five dimensions reached V2-001 independently**, which is the strongest signal in the
run. It was then reproduced a fourth time, by hand, against a clean tree, before anything was
written down. A first attempt at the exploit failed on a Solidity detail — `Quote memory forged = q`
aliases rather than copies — and a reviewer who had stopped at that red would have concluded the
finding was wrong.

What this method could not establish:

- **The harness it ran inside was itself broken, and the review only found that by accident** —
  by re-measuring a count instead of copying it forward. Nothing in the five review dimensions was
  pointed at the gate, and nothing would have found V2-006 if a number had simply been trusted.
- **It reviewed a moving tree.** A mutation campaign was running concurrently for part of the
  review, and one reviewer caught `_afterSwap`'s fill check replaced by `if (false)` between two of
  its own reads. The reviewers compensated by reading from `git show HEAD:`, and every finding above
  is against committed source — but the fact that this was necessary is a process defect, and the
  mutation suite must not run beside anything that reads the tree.
- **It is not independent.** Same authors, same assumptions, same blind spots.
- **Absence of findings in a dimension is not evidence of absence.** The dismissed-hazard lists say
  what was looked at; they do not say the list was complete.
- **No live behaviour was observed**, because nothing is deployed. Every claim above is about code
  and about tests, never about a chain.
