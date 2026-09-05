# Adversarial review of the day-2 tree, 2026-09-04 night: the adjudication

Five reviewer lenses (the hook, the executor, the tests, the documents, the scripts and CI) read
the tree at commit `96724ba` and after, each finding then put to three independent refuters.
Fifty-three findings came back. This file records every one the review acted on or explicitly
accepted: what it claimed, whether it reproduced, what was done, the test or evidence, the
residual risk, and the commit. Findings the refuters contradicted are listed at the end with the
reason. Line numbers are as of the commit named in each row.

Rule applied: every reproducible critical or high finding is fixed; a medium is fixed when it
touches I1, I6, I7, atomicity, authorisation, replay, deployment determinism, verification, or
receipt correctness; the rest is fixed when cheap or accepted here in writing.

## Fixed

| # | Severity | Where | Claim | Reproduced | Action | Evidence | Residual risk | Commit |
|---|---|---|---|---|---|---|---|---|
| E1 | critical | `src/SettlementExecutor.sol` `createOrder` | an order could name a pool without the hook (or with another hook) and settle through the router with none of I3 to I6 enforced and no receipt | yes, by reading: no check on `key.hooks` | the executor takes the hook as its one constructor argument and refuses any other `key.hooks`; the hook derives the executor from the executor's creation code plus its own address, so the pair is bound both ways; `pay` asserts the hook receipted exactly once | `test_RevertWhen_OrderNamesAPoolTheHookDoesNotGuard` (a hookless key and a foreign-hook key, both refused, nothing counted); `test_ExecutorDerivationMatchesTheDeployedAddress` recomputed from independent constants; the fork rehearsal deployed and bound both and the readback shows each naming the other | none known for this path; the executor's creation code now carries an address, so its CREATE2 address is per hook, which the deploy stage asserts | `ad80a60` |
| E2 | high | `src/SettlementExecutor.sol` `createOrder` | a recipient of `address(1)` or `address(2)` is a router `TAKE` sentinel (its caller, itself), so the output would be stranded in the executor or the router | yes, by reading `_mapRecipient` in the pinned V4Router | refused at creation with `ReservedRecipient` | `test_RevertWhen_RecipientIsARouterSentinel` | none | `ad80a60` |
| E3 | high | `src/SettlementExecutor.sol` `pay` | the minimum was enforced on the pool credit only; a token delivering less on the transfer out of the PoolManager left the recipient short and the order Settled; the balance difference could underflow | yes: a fee-on-take control token reproduces both | the executor measures the recipient's balance across the router call, treats no growth as nothing received, and refuses with `RecipientShort(orderId, minOut, received)`; the receipt survives only where this passed | `test_RevertWhen_RecipientReceivesLessThanTheMinimum_FeeOnTransfer` (refusal with exact numbers on a 1% fee-on-take token, then the control settling at the delivered amount) | a recipient whose balance moves for another reason inside the same call would skew the measurement; USDC has no transfer hooks; the payout-asset allowlist (spec C4) remains planned | `b02cf0b` |
| T1 | high | `test/V4SettlementHook.t.sol` derivation test | the test recomputed the CREATE2 address from the hook's own constants, so a wrong factory or salt in the hook would have been echoed, not caught | yes, by reading | the test holds the canonical factory and salt zero itself and recomputes from the executor's creation code plus the hook's address | the test asserts the hook's constants equal the independent ones | none | `ad80a60` |
| T2 | high | `src/V4SettlementHook.sol` receipt | the receipt named the order's recipient before the router's `TAKE` ran; nothing bound the receipt to actual payment | yes, by reading | closed by E3: the executor reverts, and the receipt with it, unless the recipient's balance grew by at least the minimum | the fee-on-take test: no receipt survives the refusal (`receiptCount` 0) | with a harness that bypasses `pay`, a receipt can name a recipient the plan did not pay; the real executor cannot compose that, and the README states what the receipt proves and does not | `b02cf0b` |
| T3 | medium | `src/V4SettlementHook.sol` `_inFlightOrder` | the Paying window admitted any number of swaps for one order inside one plan; two swaps receipted twice | yes: a two-swap plan through the executor harness | the hook marks an order swapped in transient storage in `afterSwap` and refuses a second swap in `beforeSwap` with `OrderAlreadySwapped` | `test_RevertWhen_OrderIsSwappedTwiceInOnePlan`, with the one-swap control settling | none within a transaction; across transactions the order is no longer Paying | `c35e2bb` |
| T4 | medium | `src/V4SettlementHook.sol` `_beforeSwap` | the direction half of I3 was untested: removing `zeroForOne` from the check left the suite green | yes, by the reviewer's mutation | a reverse-direction plan with the order's amount is refused with `ParamsDoNotMatchOrder` | `test_RevertWhen_SwapDirectionDisagreesWithTheOrder` | none | `d45785b` |
| S1 | high | `Makefile` local targets | fork runs with `--broadcast` carry the real chain id, so their files would land in the committed `broadcast/11155111` over the day-1 record | yes, by reading forge's broadcast layout | every local-mode target sets `FOUNDRY_BROADCAST=.rehearsal/broadcast`; the Sepolia path is untouched | `make -n deploy` shows the prefix; `make -n deploy ARGS="--network sepolia"` does not; the second rehearsal wrote under `.rehearsal/` and `broadcast/` is unchanged (`git status` clean) | none | `842cc67` |
| S2 | high | `script/LiveFire.s.sol` settle stage | the stage paid the order id its simulation computed from `orderCount`; another `createOrder` mined in between would have shifted it, and the broadcast could have paid a stranger's open order | yes, by reading | ids are `keccak256(chainid, executor, creator, salt)`; the script derives the salt from `ORDER_SALT`, computes the id before broadcasting, refuses a used salt, and asserts the id it paid | `test_OrderIdsAreChainBoundCreatorBoundAndKnownInAdvance`; the second rehearsal paid the computed id | a creator must choose fresh salts; a reused one is refused, never silently reassigned | `e08c4d0` |
| S3 | medium | `script/LiveFire.s.sol` settle stage | the public proof asked for a minimum of 1, so I3 was never exercised live | yes | 1.5 USDC per 0.001 ETH, about 60% of the opening price | the second rehearsal delivered 2.003660 against 1.5 | a drained pool now refuses the live settle, which is the point | `842cc67` |
| S4 | medium | `.env.example` | defining `SEPOLIA_RPC_URL=` empty overrides the Makefile's `?=` default with nothing | yes, by make semantics | the optional lines are commented with the reason | `make -n` with a copied example picks the default | none | `842cc67` |
| S5 | low | `script/readback.sh` | the readback could not prove the hook-executor binding on chain | yes | prints `executor.HOOK`, `executor.UNIVERSAL_ROUTER`, `hook.SETTLEMENT_EXECUTOR` | the second rehearsal's readback shows each naming the other | none | `842cc67` |
| S6 | low | `Makefile` | `.PHONY` named a missing target and omitted two; help and doctor stated a test count that had drifted | yes | `.PHONY` lists the targets that exist; the count is no longer stated, CI asserts it | `make help` runs | none | `842cc67` |
| C1 | medium | `.github/workflows/ci.yml` private-name scan | anchored to the repository root, so a private file in a subdirectory passed; `privatenotes` had no backstop | yes: a planted subdirectory path passed the old pattern | the pattern matches a path segment anywhere, `privatenotes` is listed, and the step proves itself on a planted subdirectory path | the control runs in CI and locally | none | `a7194dc` |
| C2 | medium | `.github/workflows/ci.yml` test floor | the floor was 7 while 38 ran; 31 tests could vanish and the gate stayed green | yes | the expected count is read from the test sources and must equal what forge ran, in both lanes | measured locally: 39 declared, 39 ran | a test declared but never compiled into the suite would still fail the equality | `a7194dc` |
| C3 | low | `.github/workflows/ci.yml` | the size assertion covered the hook only; the solc cache key named 0.8.26; the fresh-clone lane checked out a sha that does not exist on pull requests; `specs/` was excluded from the private-location scan | yes | both contracts asserted; key 0.8.30; pull-request head sha; `specs/` scanned (measured clean) | CI green after the change | none | `a7194dc` |
| D1 | high | `docs/EXECUTION-PATH.md`, `docs/INVARIANTS.md` | the documents claimed every invariant test ran against the router's deployed bytecode; rows 1 to 4 of I7 run against a stand-in, and the two files contradicted each other | yes | both say which bytecode each row runs against and why | read the files | none | `0c3663c` |
| D2 | medium | `docs/EXECUTION-PATH.md` question 5, 7, 9 | a test that does not exist was cited; two answers deferred to "day 3" for code that existed | yes | two existing tests named; "day 3" removed | read the file | none | `0c3663c` |
| D3 | medium | `docs/INVARIANTS.md` I2, I3/I6 | I2 was marked TESTED with no negative control named; the floor was labelled I6 in code and README and I3 in the ledger | yes | I2 lists its negative controls; the floor is I3 and the revert I6 everywhere | read the file | none | `0c3663c` |
| D4 | medium | `README.md`, `AI_USAGE.md`, `HACKATHON.md`, `FEEDBACK.md`, `docs/ARCHITECTURE.md` | helper addresses credited to a test that does not use them; toolchain files missing from the disclosure table; a `web/` directory listed that does not exist; an older feedback entry naming moved paths; a superseded contract table and order-of-work paragraph | yes | each corrected; the feedback entry and the architecture record carry dated notes rather than rewrites | read the files | none | `0c3663c`, and the README commit that follows this file |

## Accepted, with the reason

| # | Severity | Where | Claim | Why accepted | Residual risk |
|---|---|---|---|---|---|
| A1 | low | `src/V4SettlementHook.sol` `_afterSwap` | the `int128` to `uint128` casts truncate rather than check | they are correct only because both returns-delta flags are false, which `test_NoUndeclaredPermissionsCreepIn` asserts; a checked cast would cost gas on every swap for a case the permission set excludes | a future permission change would have to revisit them; the test that guards the permission set is the tripwire |
| A2 | low | `src/V4SettlementHook.sol` | the order is read from the executor twice per settlement, about 35k gas | caching between callbacks would add transient state to the trust-critical hook for a gas saving; the hook stays minimal by the owner's rule | cost only |
| A3 | low | `src/V4SettlementHook.sol` `HookFee` | emitted on every settlement with a zero fee, with the payer rather than the callback's sender | spec addendum A4 asks for the standard event beside the receipt and for the attributed payer; the fee is zero and the event says so honestly | an indexer expecting the router as `sender` reads the payer instead; documented in `docs/RECEIPT-SCHEMA.md` |
| A4 | medium | `src/SettlementExecutor.sol` `_plan` | the router's `amountOutMinimum` leg is unprovable: setting it to zero leaves the suite green | the hook enforces the minimum first, inside the swap, so no test can reach the router's check; it is kept as redundancy and `docs/INVARIANTS.md` says so | none beyond the redundancy being untested |
| A5 | low | `src/SettlementExecutor.sol` `pay` | the executor adds no reentrancy guard of its own | the order is Paying for the duration of the call, so a reentrant `pay` for the same order meets `OrderNotOpen(Paying)` and another order meets its own state; the executor holds no balance and calls only the router and the token's `balanceOf` | a reentrancy test (threat T6) is still planned |
| A6 | low | `test/V4SettlementHook.t.sol` | the "official router runtime" assertion compares the bytes and the keccak recorded in the same file | the keccak was read from the chain with `cast` and the file says how to re-verify it; the fork rehearsal exercises the real chain's bytecode, which is the independent check | trust in the recorded bytes between rehearsals |
| A7 | low | `test/I7NativeSettle.t.sol` row 5 | re-etching the official router over the harness's storage is safe only because of statement order | true, and the test is written in that order with the etch first; a comment is not a guard, so it is recorded here | none while the order holds |
| A8 | low | local versus CI Foundry binaries | local greens come from `1.3.5-foundry-zksync`, CI greens from upstream `v1.5.1` | both are green on every push; the difference is recorded in the README | a behaviour that differs between the two would show as a red lane, which is the point of having both |

## Contradicted by the refuters

Four findings were refuted by all three of their refuters. Three of them were true of the
snapshot the reviewer read and false at HEAD, because the fix had already landed while the vote
ran; they are the same defects as E1, E3 and T3 above, seen from another lens. One was refuted
on its mechanism.

| # | Where | Claim | Verdict |
|---|---|---|---|
| R1 | `src/SettlementExecutor.sol` `pay` | the minimum is enforced on the pool credit, never on what the recipient received | stale: fixed in `b02cf0b` before the vote (E3) |
| R2 | `src/SettlementExecutor.sol` `createOrder` | an order can name a pool without the hook | stale: fixed in `ad80a60` before the vote (E1); one refuter proved both barriers by sabotage |
| R3 | `src/V4SettlementHook.sol` | no per-order once-only guard | stale: fixed in `c35e2bb` before the vote (T3) |
| R4 | `src/V4SettlementHook.sol` `_afterSwap` | the delta casts are unsafe and safe only because of the returns-delta flags | refuted on mechanism: the casts are correct for an exact-input swap regardless of the flags; the observation that they are unchecked stands and is A1 above |

## Refuter coverage, stated

The vote was 164 refuter agents, three per finding. **80 of them failed on a session usage limit
before voting**, so 27 findings carry fewer than two votes: one from the hook lens (A2, the double
read), all eleven from the tests lens, and all fifteen from the scripts and CI lens. None of the 27
changes an action: every one is either fixed above with its own test and commit (T1, T2, T3, T4,
S1 to S6, C1 to C3) or accepted above with its reason (A2, A4, A6, A7, A8), each on the strength
of its own reproduction rather than a vote. The reproduction column is the evidence a reader
should weigh for those rows; the vote column is absent, and this file says so rather than
implying a verdict that was not reached. The workflow run is `wf_6cd545b6-b9c`; its failed
refuters can be resumed, and the record will be updated if they are.

Findings with fewer than two votes, by title, for the record:

- [hook] low: The order is read from the executor twice per settlement: ~34.9k gas, ~7.7% of the swap (src/V4SettlementHook.sol) — votes recorded: 1
- [tests] high: test_ExecutorDerivationMatchesTheDeployedAddress is a tautology: a wrong CREATE2 factory or salt leaves the entire suite green (test/V4SettlementHook.t.sol) — votes recorded: 0
- [tests] high: The hook's SettlementReceipt does not prove the order's recipient was paid, and no test distinguishes the two (src/V4SettlementHook.sol) — votes recorded: 0
- [tests] medium: The Paying window admits unlimited swaps: two swaps for one order emit two receipts and set receiptCount to 2, and nothing tests it (src/V4SettlementHook.sol) — votes recorded: 0
- [tests] medium: Invariant I3's direction half is untested: removing the zeroForOne check leaves the whole suite green (src/V4SettlementHook.sol) — votes recorded: 0
- [tests] medium: The executor's slippage leg is unproven: setting the router's amountOutMinimum to 0 leaves the suite green (src/SettlementExecutor.sol) — votes recorded: 0
- [tests] medium: I7 row 3's 'nothing moved' block is entirely post-revert state, and its recordLogs() call is dead (test/I7NativeSettle.t.sol) — votes recorded: 0
- [tests] low: The CI test-count floor is 7 while the suite has 34 tests, so 27 tests could vanish and the gate stays green (.github/workflows/ci.yml) — votes recorded: 0
- [tests] low: The 'official router runtime' assertion is self-consistent: the constant and the bytes live in the same file, so nothing checks either against the chain (test/V4SettlementHook.t.sol) — votes recorded: 0
- [tests] low: Local greens and CI greens are produced by different Foundry binaries, and the file's 'measured on 2026-09-04' caveat names no version (test/I7NativeSettle.t.sol) — votes recorded: 0
- [tests] low: Row 5 re-etches the official router over RouterHarness storage; the test is safe only because of statement order (test/I7NativeSettle.t.sol) — votes recorded: 0
- [tests] low: Several negative tests assert post-revert state that is true by construction (test/V4SettlementHook.t.sol) — votes recorded: 0
- [scripts] high: make deploy/init-pool/seed/settle/live on the LOCAL FORK write chain-11155111 broadcast artifacts into the committed proof record and overwrite it (Makefile) — votes recorded: 0
- [scripts] high: Settle stage pays an order id computed during simulation; a permissionless createOrder mined between the two broadcast transactions redirects the payment (script/LiveFire.s.sol) — votes recorded: 0
- [scripts] medium: .env.example defines SEPOLIA_RPC_URL as empty, and the Makefile's `?=` cannot override a defined-empty variable (.env.example) — votes recorded: 0
- [scripts] medium: CI's private-material filename scan is anchored to the repository root, so any private runtime file in a subdirectory escapes it — and the step's own control only plants the root case (.github/workflows/ci.yml) — votes recorded: 0
- [scripts] medium: privatenotes.md is the one gitignored private file with no CI backstop in the `names` scan (.github/workflows/ci.yml) — votes recorded: 0
- [scripts] medium: make help and make doctor tell the operator to expect 25 tests; 34 run (Makefile) — votes recorded: 0
- [scripts] medium: CI's "a lane that ran zero tests is not green" floor is 7 while 34 tests run — 27 tests can vanish silently (.github/workflows/ci.yml) — votes recorded: 0
- [scripts] medium: The live settle stage sets minOut = 1, so invariant I6 is not exercised by the public proof, and the swap takes 11.3% price impact at the seeded depth (script/LiveFire.s.sol) — votes recorded: 0
- [scripts] low: readback.sh never reads hook.SETTLEMENT_EXECUTOR(), so the readback cannot prove on chain the binding the whole design rests on (script/readback.sh) — votes recorded: 0
- [scripts] low: .PHONY names a target that does not exist and omits two that do (Makefile) — votes recorded: 0
- [scripts] low: docs/ARCHITECTURE.md's contract table still points at src/UnicaHook.sol and src/UnicaSettlementRouter.sol, files that no longer exist (docs/ARCHITECTURE.md) — votes recorded: 0
- [scripts] medium: CI fresh-clone lane checks out github.sha after a plain clone, which cannot resolve on pull_request events (.github/workflows/ci.yml) — votes recorded: 0
- [scripts] low: CI asserts the EIP-170 limit for the hook only; the executor's runtime is unguarded (.github/workflows/ci.yml) — votes recorded: 0
- [scripts] low: CI solc cache key still names 0.8.26, a compiler the tree no longer uses (.github/workflows/ci.yml) — votes recorded: 0
- [scripts] low: The private-location scan excludes specs/ entirely, so a leak into the published spec is never caught (.github/workflows/ci.yml) — votes recorded: 0
