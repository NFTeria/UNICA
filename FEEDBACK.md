# FEEDBACK.md

Developer feedback for the partner whose tools this project is built on. Written for
the engineers who maintain those tools, so they can act on it without asking a
follow-up question.

This file sits at the repository root because at least one partner's eligibility
rules require a file of exactly this name, here. It is also the index: feedback for
each additional partner lives in `docs/feedback/<partner>.md`, one file per partner,
and is linked from the table at the bottom.

## How this file is written

**Captured the hour it happens, never reconstructed at the end.** A friction log
written on submit day reads exactly like one. What has value to a maintainer is
specific, dated, and slightly uncomfortable: the literal error string, the exact doc
URL, the exact function, the honest time it cost, and the precise change that would
have prevented it.

Every entry has four parts. If one is missing, the entry is not finished.

```
### <date> — <one-line title>

**Trying to:** one sentence.
**Blocked by:** the literal error, the exact function or package and version, the
exact documentation URL. Never "the docs were unclear."
**Cost:** honest time, e.g. 40 minutes.
**Would have prevented it:** the specific fix — a missing example, a wrong type in a
signature, a stale page, an unstated version pin.
```

The test for every entry: could a maintainer open a corrective PR from it without
asking anything?

Tone is blunt and specific, not hostile. Praise is welcome only when it is as
specific as the friction — "the `X` helper saved an hour because it did `Y`" — never
"great docs".

## What does NOT go here

- Anything about prizes, tracks, judging, or strategy.
- Anything about other partners, by comparison or otherwise.
- Anything private to the author's other projects.
- Reconstructed timelines. If the hour it happened was not captured, say so.

---

## Entries

<!-- newest first -->

### 2026-09-08 — `permitWitnessTransferFrom` lets a witness bind one side of a two-party agreement, and nothing says that is a total-loss bug

**Context, because it decides whether this is actionable:** the integration is business payments.
A merchant issues an invoice, a customer pays in whatever token they hold, and Uniswap v4 is what
turns one into the other. The merchant is paid the exact amount they invoiced, in the currency they
asked for, and neither party runs a swap UI. That shape — a business getting Uniswap's liquidity
and execution without becoming a trading venue — is the whole reason this project exists, and it is
why the payer's and the merchant's halves of the deal are signed by two different people.

**Trying to:** have the customer authorise exactly one payment against exactly one merchant-signed
invoice, using `permitWitnessTransferFrom` so the authorisation carries the invoice with it.

**Blocked by:** nothing refused, which is the problem.

`permitWitnessTransferFrom(PermitTransferFrom, SignatureTransferDetails, address owner, bytes32
witness, string witnessTypeString, bytes signature)` composes the caller's witness onto Permit2's
own stub. Permit2's half hashes the token permissions, the spender (`msg.sender`), the nonce and
the deadline. Everything else about the agreement has to come from the witness, and the witness is
whatever the integrator decides to put in it.

The witness we wrote covered six fields — `quoteId`, `payer`, `tokenIn`, `maxIn`, the destination,
and the executor. Every one of them is the payer's own half of the deal: which invoice, who is
paying, in what token, up to how much, into which venue. It reads complete. It is not: the
merchant's half — `recipient`, `merchantSigner`, `tokenOut`, `amountOut`, and the pool — is outside
it, and Permit2's own fields do not separate them either, because the spender is the same executor
for every caller.

So two invoices differing **only** in `merchantSigner` and `recipient` produce a byte-identical
payer signing digest, and one customer signature is valid for both. Anyone holding the
authorisation — the relayer it was handed to, or anyone watching the pending transaction — can
rebuild the invoice naming themselves as merchant and recipient, sign that with their own key, and
present the customer's authorisation completely unchanged. Reproduced end to end against the
official PoolManager bytecode in `test/v2/WitnessBinding.t.sol`:

```
actualIn pulled from payer:  1003010032
thief tokenOut:              1000000000
honest recipient tokenOut:            0
```

The customer is debited in full, the merchant is paid nothing, and the honest transaction then
reverts on the spent nonce — so it is a theft rather than a duplicate payment.

**This is the second face of one trap, and we only caught the first.** `SignatureTransferDetails.to`
is chosen by the caller at spend time and is not covered by the payer's signature. We found that
one, measured it in `test/v2/Permit2Witness.t.sol` where a transfer to an attacker was accepted and
the payer's signature did not object, and wrote it into
`src/v2/interfaces/IPermit2Transfer.sol:26` — the executor now writes `to = address(POOL_MANAGER)`
as a literal and never reads it from calldata. Having caught the destination hole, we assumed the
witness was the part that was safe by construction. It is the same hole one level up.

The docs page for this function is
<https://developers.uniswap.org/docs/protocols/permit2/concepts/signature-transfer> — fetched
2026-09-08. It documents `permitWitnessTransferFrom` and both witness parameters, and it contains
**no** guidance on what a witness should contain and **no** warning about omitting fields from one.
Its "Security Considerations" section covers caller-context validation for signatures generally and
does not reach witness content. Two redirects also stand between the URL that is still widely
linked and the page that answers: `docs.uniswap.org/contracts/permit2/reference/signature-transfer`
301s to `developers.uniswap.org/contracts/permit2/...`, which 303s to the `docs/protocols/...` path
above.

**Cost:** not recorded as a duration, per this file's rule against reconstructed timelines — the
hour it happened was an internal security review, not a debugging session, and quoting minutes
afterwards would be inventing them. What is recordable: three of five independent review dimensions
reached it separately; the first attempt to reproduce it failed for an unrelated Solidity reason
(`Quote memory forged = q` aliases rather than copies, so both digests came out equal and the
exploit looked refuted); and the real cost is that it reached a frozen release candidate, which is
now blocked and cannot ship. The fix moves the payer's EIP-712 signing digest, so it is a new
release candidate rather than a patch.

**Would have prevented it:** one sentence on the signature-transfer page, in the witness section,
saying what a witness is for:

> The witness must commit to **every** term of the agreement, including the terms the other party
> chose. Permit2 verifies only that the owner signed *something*; it cannot know which fields of
> your application's agreement matter. A witness that omits a counterparty's fields lets one
> signature authorise any agreement that shares the fields you did include.

A worked two-party example beside the existing single-party one would do it even better, because
every published witness example we could find has one signer, and with one signer this class of bug
cannot occur. The trap is invisible until the second signer appears, and by then the witness type
string is in production and moving it is a breaking change for every wallet that signed one.

**Specific praise, since it is the same integration:** v4's unlock/`take` accounting is why this
product can exist at all for a business. The customer's token goes from the customer straight to
the PoolManager via Permit2, and the output goes from the PoolManager straight to the merchant via
`take` — the settlement contract never holds either leg, and we assert that on real balance deltas
rather than claiming it in a diagram (`ExecutorHeldTheInput` / `ExecutorHeldTheOutput`, in
`test/v2/Settlement.t.sol`). A payments integrator gets non-custodial settlement as a property of
the venue instead of as something they have to build, audit and insure. That is a genuinely large
thing to be handed for free, and it is worth saying plainly next to the complaint above.


### 2026-09-05 — a Universal Router built from a newer v4-periphery refuses the listed single-swap encoding with an empty revert, and nothing on chain says which build it is

**Trying to:** run this repository's exact settlement plan (command `0x10`; `SWAP_EXACT_IN_SINGLE`, `SETTLE`, `TAKE`; `OPEN_DELTA`; `hookData` = one `bytes32`) against a Universal Router observed on another testnet, on a fork, read-only, to learn whether the hook's admission path is portable.

**Blocked by:** the router at `0x8876789976decbfcbbbe364623c63652db8c0904` on chain 46630 reverts inside its own `unlockCallback` with empty revert data before the PoolManager is called; the same plan with empty `hookData` swaps, and the same `bytes32` `hookData` is delivered once `ExactInputSingleParams` is encoded with one extra static word before `hookData`. That word is `uint256 minHopPriceX36`, added in `Uniswap/v4-periphery` commit `03b2d09` ("feat: add per-hop slippage to single swaps and flip to output/input ratio (#516)", 2026-03-17, <https://github.com/Uniswap/v4-periphery/commit/03b2d09>). The periphery this repository pins (`7ebd04b`) and the Sepolia router on the deployments page (<https://developers.uniswap.org/contracts/v4/deployments>, read 2026-09-05) predate it, and the same instrument passes against that Sepolia router on a fork. The router exposes no version or ABI discriminator: `poolManager()` and `msgSender()` answer identically on both builds.

**Cost:** one afternoon on 2026-09-05 building a fork probe with a positive control before the cause was isolated to the struct layout; recorded on the branch `research/robinhood-readiness` under `test/fork/`.

**Would have prevented it:** a version getter on the Universal Router, or a per-deployment note on the deployments page naming the periphery commit each router was built from; and a published runtime artifact per router deployment, which is the same request as the 2026-09-04 entry below. An integrator pinned to the listed periphery cannot detect the mismatch before broadcasting, and the failure mode is an empty revert.

### 2026-09-05 — v4-core's exact `PoolManager` pragma really does split a downstream build across two compiler versions

**Trying to:** confirm, before writing anything upstream, whether leaving `solc_version`
unset in a downstream Foundry project that imports `PoolManager` actually produces two
different compiler runs inside one `forge build` — the mechanism `docs/INTEGRATIONS.md`
rank 7 raised and explicitly flagged as "not re-created in a fresh minimal project" as of
2026-09-04.

**Blocked by:** nothing — it reproduced cleanly once the remapping was right. In a scratch
project outside this repository, remapped into this repository's own pinned `v4-core`
commit (`d153b048868a60c2403a3ef5b2301bb247884d46`, the commit `lib/uniswap-hooks/lib/v4-core`
is pinned at), with no `solc_version` set in `foundry.toml`, one sibling contract at
`pragma solidity ^0.8.28;` next to a second contract that imports `PoolManager`
(`pragma solidity 0.8.26;`, exact, `src/PoolManager.sol:2`) makes `forge build` print, in
the same invocation:
```
Compiling 46 files with Solc 0.8.26
Compiling 1 files with Solc 0.8.30
Solc 0.8.30 finished in 45.45ms
Solc 0.8.26 finished in 339.73ms
Compiler run successful!
```
The two resulting artifacts confirm it by their own metadata:
`out/MyContract.sol/MyContract.json` → `metadata.compiler.version` = `0.8.30+commit.73712a01`;
`out/PoolManager.sol/PoolManager.json` → `metadata.compiler.version` = `0.8.26+commit.8a97fa7a`.
Toolchain: `forge 1.3.5-foundry-zksync-v0.1.9`. The first attempt, with the sibling contract
at `pragma solidity ^0.8.24;`, did **not** split — forge folded all 47 files into one
`Compiling 47 files with Solc 0.8.26` run, because 0.8.26 satisfies `^0.8.24` too. The split
only appears once a sibling file's floor version excludes 0.8.26 (e.g. `^0.8.28`), which is
an ordinary pragma choice for a project written against newer Solidity features.

**Cost:** about 20 minutes: 5 to scaffold the scratch project and remappings, 5 lost to a
wrong `solmate/=…/lib/solmate/src/` remapping (should be `solmate/=…/lib/solmate/`, since
the import inside `ProtocolFees.sol` is `solmate/src/auth/Owned.sol`), and 10 to find that
`^0.8.24` does not trigger the split and `^0.8.28` does.

**Would have prevented it:** nothing needed preventing here — this is the confirmation
itself, not a blocker. What it changes: the two-compiler split moves from "undocumented,
not to be filed upstream" (`docs/INTEGRATIONS.md`, Demoted section, 2026-09-04) to
reproduced-today, so an upstream question to `Uniswap/v4-core` — is the exact pragma on
`PoolManager.sol` intended to be load-bearing for every downstream compilation unit that
reaches it, and should the test-facing surface instead carry a caret range — can now be
asked with a fresh, minimal, timestamped repro rather than resting on the day-1 on-chain
verification incident alone. Draft at `upstream/04-two-compiler-split-poolmanager.md`.

---

### 2026-09-04 — the Universal Router as the execution path for a settlement hook: what it carries, what it cannot express, and one shape the interface does not describe

**What happened.** The owner ruled that settlement must go through Uniswap's official execution
path where it supports the custom-hook pool, keeping only the smallest supporting contract. Ten
verification questions were answered from the pinned v4-periphery sources, the
`Uniswap/universal-router` repository on `main`, and the two deployed Sepolia routers read with
`cast` (`docs/EXECUTION-PATH.md`). Then the tree was reworked onto it the same night: the hook
admits only the Universal Router driven by a `SettlementExecutor`, and every test runs against
the router's deployed runtime etched at its Sepolia address.

**Credit first, because it is earned.** `IMsgSender.msgSender()` works exactly as the
accessing-msg.sender guide says: the hook confirms `sender == UniversalRouter`, then asks it who
drove the call, and the answer is the executor (`test_RevertWhen_OfficialRouterIsDrivenByAStranger`
names a stranger through the same path). `DeltaResolver._settle` syncs before every settle, native
included; invariant I7's fifth row runs the deployed router bytecode with an ERC-20 settle leg
before the native one in the same unlock and it survives
(`test_I7_OfficialRouter_ForeignSettleBeforeNative_Survives`). That is the defence this hook
relies on, and it is Uniswap's.

**What the router cannot express, with the line that says so.** Two settlement invariants have
no home in the router. The `TAKE` recipient is caller-encoded
(`v4-periphery/src/V4Router.sol`, the `TAKE` branch of `_handleAction`, `_mapRecipient`), so
nothing binds it to an authenticated order; and `V4Router` never compares consumed input to
requested input, so an exact-input swap that hits the price limit is a partial fill the router
settles as a success. Both are reasonable for a general router. For a settlement, they are the
whole point. This is why one thin executor exists in this tree, and it is the only reason.

**The shape the interface does not describe.** `IUniversalRouter` declares
`error ExecutionFailed(uint256 commandIndex, bytes message)` for "a required command that has
failed". A `V4_SWAP` command that fails does not produce it: the `Dispatcher` runs V4 actions as
an internal call with no try, so the low-level `(success, output)` pattern that feeds
`ExecutionFailed` applies to the Permit2 and position-manager commands and not to `V4_SWAP`. A
hook's revert comes out of `execute` raw, as the PoolManager's
`WrappedError(hook, selector, reason, HookCallFailed)`. Reproduce:
`test_RevertWhen_OfficialRouterIsDrivenByAStranger` asserts the raw wrapped bytes and passes
against the deployed runtime; an integrator catching `ExecutionFailed` around a v4 swap would
catch nothing. One sentence in the interface's NatSpec would save that integrator an hour.

**A tooling gap.** hookmate ships the PoolManager's initcode as an artifact so a test can deploy
the official bytecode; nothing equivalent exists for the Universal Router. This repository
embeds the deployed Sepolia runtime as a 19,540-byte library with its keccak recorded
(`test/utils/artifacts/UniversalRouterV2Sepolia.sol`), which is the honest way to test against
the real router today and a clumsy one. A published runtime artifact per chain would remove it.

### 2026-09-04 — `v4-security-foundations` run over the real gate and router

> Paths in this entry are as they were that evening: `src/UnicaHook.sol` is now `src/V4SettlementHook.sol` and `src/UnicaSettlementRouter.sol` was replaced by `src/SettlementExecutor.sol` the same night. The entry is not rewritten; the findings stand as recorded.: two catches, three misses, one template that does not compile

**Trying to:** apply the `v4-security-foundations` skill (uniswap-ai plugin `uniswap-hooks`
1.6.0, the tool the track links) to the code that exists tonight: `src/UnicaHook.sol` (the
router-only `beforeSwap` gate, mask 0xC0) and `src/UnicaSettlementRouter.sol` (native
settlement through `unlock`), as its own text says to do before deploying.

**What it caught, honest credit.** Row 6, fee-on-transfer tokens: not handled yet (the
payout-asset allowlist of our spec's C4 is planned, not built). Row 13, invariant testing:
none yet, only unit and fuzz. Both are true and both are now on our list. Its framing that
`sender` is the router and never the user is exactly what our design is built on, and its
NoOp warning matches the returns-delta flags we assert off in a test.

**What it missed, with the evidence from tonight (22:02 UTC):**
- The template it hands out does not compile on the current stack. It imports
  `v4-periphery/src/base/hooks/BaseHook.sol` and uses `IPoolManager.SwapParams`. In the
  v4-periphery commit pinned by OpenZeppelin `uniswap-hooks` v1.1.1 (`7ebd04b`) the file is at
  `src/utils/BaseHook.sol`, and `src/base/hooks/BaseHook.sol` returns HTTP 404 on `main`
  (`gh api repos/Uniswap/v4-periphery/contents/src/base/hooks/BaseHook.sol`). In v4-core
  `d153b04`, `SwapParams` is declared in `src/types/PoolOperation.sol` and does not exist
  inside `IPoolManager` (`grep -c 'struct SwapParams' src/interfaces/IPoolManager.sol` = 0).
- "Forgetting sync: Settlement fails without sync" is not true for native currency. Row 2 of
  `test/I7NativeSettle.t.sol` removes the sync and the native settlement succeeds; it fails only
  when an earlier leg of the same unlock left an ERC-20 synced (row 3, `NonzeroNativeValue`).
  A reader who trusts the sentence writes the wrong negative test and ships without the
  defence. `PoolManager.sol` line 348 has the accurate wording.
- The silent failure mode of a missing permission bit (callback implemented, bit absent: the
  callback is never called and nothing reverts) appears nowhere in the skill; the word
  "silent" does not occur. It is the failure our T5 guard exists for and the one a checklist
  reader is least likely to test for, because nothing goes red.

**A review observation, labelled as one:** the "Production Hook References" table lists
Bunni as a security exemplar with no mention of its 2025 exploit (1 mention, 0 caveats). That
is commentary, not friction, but a security guide's exemplars carry weight.

**Cost:** about 25 minutes to apply the checklist and re-verify each claim above against the
pinned tree and upstream.

**Would have prevented it:** pin the template's imports to the paths that exist at a named
v4-periphery commit (or point at OpenZeppelin `BaseHook`, which the canonical `v4-template`
uses); rewrite the sync sentence to say when native settlement fails and why; add one row to
the threat table for the permission-bit silent no-op with the numeric guard as the mitigation;
and either caveat or drop the Bunni row.


### 2026-09-04 — the `v4-hook-generator` skill in `uniswap-ai` calls an MCP tool the plugin does not ship

**Trying to:** scaffold the day-1 hook with the tool the prize page links
(`github.com/Uniswap/uniswap-ai`, installed as the `uniswap-hooks` plugin, v1.6.0), before
hand-writing it, as the skill itself suggests.
**Blocked by:** the skill's step 4 says to "call the OpenZeppelin Contracts Wizard MCP tool"
named `generate_hook` with a JSON document it specifies. No such tool is installed with the
plugin, and the skill names no MCP server to add. A search of every tool available in the
session for `generate_hook` / `wizard` returned nothing (20:03 UTC). The skill's own text also
tells the reader to "use `HookMiner` (from `v4-periphery`)"; `src/utils/HookMiner.sol` returns
HTTP 404 on `Uniswap/v4-periphery` `main` (checked 20:05 UTC with the GitHub contents API) and
exists only in older trees such as the one OpenZeppelin `uniswap-hooks` v1.1.1 pins
(`7ebd04b`, 2025-10-23).
**Cost:** 4 minutes to load, read, search, and abandon. Small because the fallback was already
decided; a first-time hook author would spend the time looking for the missing server.
**Would have prevented it:** the skill's frontmatter or first section naming the MCP server it
depends on and how to install it, plus a stated fallback ("if the tool is absent, start from
this template") so the skill degrades to something useful instead of to nothing. For the
`HookMiner` sentence, cite the pinned path that exists (`v4-periphery` at the
`uniswap-hooks` pin) or point at `hookmate`, since `main` no longer has the file.


---

## Summary for the feedback form

Filled in at submission, from the entries above, never from memory.

| Question the form asks | Draft answer, pointing at the entry that proves it |
|---|---|
| What did you build? | **A way for a business to be paid through Uniswap without becoming a trading venue.** A merchant issues an invoice; a customer pays in whatever token they hold; Uniswap v4 turns one into the other, and the merchant receives the exact amount invoiced in the currency they asked for. Neither party touches a swap UI, and neither party's funds touch our contracts — Permit2 moves the customer's token straight to the PoolManager and `take` moves the output straight to the merchant. Concretely that is a v4 hook enforcing order-bound, full-fill settlement, executed only through the official Universal Router and a thin admitted executor, with an indexable receipt. Architecture: the 2026-09-04 entry "the Universal Router as the execution path for a settlement hook". Why the venue is what makes it possible: the praise paragraph in the 2026-09-08 entry. |
| Biggest blocker | Permit2's witness parameter has no documented contract about what it must contain, and a witness that binds only the signer's own half of a two-party agreement is a total-loss bug that nothing refuses. It reached our frozen release candidate and blocked it. See the 2026-09-08 entry — the reproduction, the two-redirect docs URL, and the one sentence that would have prevented it are all in there. Second, and earlier: the template `uniswap-ai`'s `v4-security-foundations` skill hands out does not compile against the current public `v4-periphery`/`v4-core` — a stale `BaseHook` import with no working replacement path, and a `SwapParams` reference to a type `IPoolManager` no longer declares. See the 2026-09-04 entry and its upstream draft. |
| Time to first successful integration | Not reconstructable honestly from memory; the entries record specific costs (4 minutes to find the missing MCP tool and abandon it; about 25 minutes to run the security checklist and re-verify each of its claims; about 20 minutes today to isolate the two-compiler split) rather than one end-to-end figure. Leave blank rather than estimate, per this file's own rule against reconstructed timelines. |
| Documentation helpfulness (1–5) | Draft: 2. The guides that were followed (the first-hook guide's import, the deployment guide's `HookMiner` import) point at paths that do not exist in the current repository, and the troubleshooting and concepts pages stop at a selector or a partial failure-mode list exactly where a reader most needs cause and fix — see the 2026-09-04 and 2026-09-05 upstream drafts under `docs/upstream/`. |
| Support (1–5) | Not answerable from this project's own experience — no support channel was used. Leave blank rather than guess. |
| What support was missing | A stated fallback in `uniswap-ai`'s skills for when a named dependency (the MCP tool, a working import path) is absent, rather than the skill running to its final step and failing silently there. See the 2026-09-04 entry "the `v4-hook-generator` skill in `uniswap-ai` calls an MCP tool the plugin does not ship." |

The owner should treat the blanks as blanks, not fill them with a guess — the file's own
rule is that a reconstructed number is worse than an honest gap.

If the form has no field for this file's URL, paste it into the free-text fields as
a `github.com` blob URL pinned to a commit SHA, and screenshot the submitted form.

---

## Feedback for other partners

| Partner | File | Status |
|---|---|---|
| The Graph, World, and every other partner investigated | `docs/feedback/<partner>.md` | none yet; files appear when a partner's tooling is actually used or investigated, never before |

---

## Chainlink CRE — OPEN QUESTIONS, 2026-09-08

**These are questions asked of the organisers, not feedback received.** Nobody has answered them.
They are recorded as OPEN so that a later reader does not mistake our own deductions for a partner
statement. Repository read at `solangegueiros/cf-liquidation-protection-challenge@58b24604`.

| # | Question | Why it changes what we build |
|---|---|---|
| 1 | Which address set is authoritative — the README's, or `config.staging.json`'s? | They disagree on all three contracts. A workflow run against the wrong one protects a position nobody is scoring. **This blocks deployment.** |
| 2 | How often will `updatevETHPrice` be called, and how long is a scenario? | The example cron is every five minutes. In the crash path the first update is already fatal, and we measured that observing every second update loses it. |
| 3 | Is a cron faster than five minutes permitted by the DON? | Decides whether reaction speed is a lever at all. |
| 4 | Is Early Access still being granted, and what is the last date to apply and still deploy? | Stated turnaround is 24h; the deadline is fixed. |
| 5 | What exactly is submitted — a deployed workflow, a repository, or both? | Decides whether a repository alone is scoreable. |
| 6 | How is the confidentiality score assessed against a **public** repository? | Our thresholds live in secrets, but our policy code is readable. We do not know whether that costs points. |
| 7 | What form does "confidential execution evidence" take — a TEE attestation, a workflow execution id, or something we emit? | Three of the fifteen confidentiality points. |
| 8 | What counts as an "unnecessary or repeated" intervention? | Ten points, and it decides whether an approval transaction is charged against us. |
| 9 | How do loan continuity and capital efficiency trade off? | Twenty points against fifteen. Until answered, our selector stays configurable rather than tuned. |
| 10 | Must the workflow perform the token approval, or is it prepared once beforehand? | `deposit` needs a vETH allowance and `repay` needs a vUSD allowance; both to the lending contract. |
| 11 | If a workflow errors on one cron tick, does the DON retry, skip, or void the run? | Decides whether a single failure is recoverable. |
| 12 | Does joining early rather than late change `cumulativeDebtTime` or the continuity score? | `start()` sets a shared clock, but we have not confirmed the interaction. |
| 13 | `liquidateUser` is **partial** — it restores to MAX_LTV rather than closing. Does "the position survives" mean zero liquidations, or is one partial event partially credited? | Changes how much buffer is worth carrying. |
| 14 | Does composing with another protocol — for us, Uniswap v4 — earn any credit? | We see no scoring line it could earn, and we will not add a swap the flow does not need. |
| 15 | Is any part of the Day 1 bootcamp material required to appear in a submission? | Decides scope. |

## Circle — OPEN QUESTIONS, 2026-09-08

Read from `circlefin/arc-nanopayments@a29f920e` and `@circle-fin/x402-batching@2.0.4`. Again:
asked, not answered.

1. What is the maximum batching delay before a settled authorization reaches a chain?
2. Who carries credit risk between authorization and batch settlement — the seller, or Circle?
3. Is there any way for a seller to obtain an inclusion proof for one payment within a batch?
4. Are Circle Agent Wallet policy controls — destination restrictions, per-call and cumulative
   limits, session keys — available on Arc testnet today? The sample uses a plain private key.
5. Is the marketplace reachable on Arc testnet, and if not, does a team's own x402 seller endpoint
   demonstrate the same thing for judging?
