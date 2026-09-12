# UNICA v4 — first-party security review record

**What this is.** A first-party review of the UNICA v4 contracts, the identity and policy layers and the
Vyper identity token, performed on 2026-09-12 by one independent reviewer context over the committed
specification (`SPEC-CONTRACTS.md`, `THREAT-MODEL.md`) and the owner's rulings (`DECISIONS.md`), followed by
the fixes and tests recorded below. **It is not a third-party audit** and it claims no completeness. It is
published so a reader can see exactly what was examined, what was found, what was changed, and what remains,
and so a future audit starts from a record rather than from nothing. We all start somewhere; this is where.

**Method.** Read-only adversarial review in a fresh context against eight lenses: Uniswap v4 hook safety;
order and settlement invariants; market identity and provenance; oracle arithmetic and timing; identity and
admission; the policy receiver; the identity token; repository law. Every finding carries a failure scenario,
a severity and a file location. The reviewer also confirmed properties positively (with the test row or code
path as evidence), named the design-accepted residuals with their ruling, and reasoned through three mutants
to see which test would catch each. Test evidence at review time: `test/unica-v4/*` 99 rows, `test/identity`
and `test/policy` 63 rows, all green. The scope excludes the frozen experimental generation and the v2/v3
generations, which have their own records.

## Findings and dispositions

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | High | Six executor guards (`ExecutorResidualInput/Payout`, `Reentered`, `SettlementDidNotClose`, `DeliveryNotExact`, `NotPoolManager`) had no test that could go red; rows X9a–d, X12, X14, X16, X17, H5c, H13, H14, O26 absent; no mutation suite | **Fixed.** `test/unica-v4/hook/Guards.t.sol` with hostile tokens (`test/unica-v4/fixtures/HostileTokens.sol`) covers each guard beside its control; `make mutants-unica-v4` (`script/mutation-unica-v4.sh`) applies one mutant at a time and requires its named row to go red. Results in the table below. |
| 2 | Medium | `TerminalAdmission.requestOrder` accepted a caller-supplied executor without checking the registry, so an admission record could describe a stub | **Fixed.** Constructor takes the registry; `ExecutorNotRegistered` unless `marketIdOfExecutor(executor) != 0`. Row `test_UnregisteredExecutor_Refused`. |
| 3 | Medium | No recipient binding at admission: a record changed between quote and admission would pay the new address | **Fixed.** `expectedRecipient` parameter; `RecipientMismatch` when the record resolves elsewhere. Row `test_RecipientChangedBetweenQuoteAndAdmission_Refused`. |
| 4 | Medium | `svgrender.token_uri_json` clamped token ids above 999 and diverged from `identity_token.vy` | **Fixed** in the Vyper layer (full decimal in both; golden vector at id 1000). |
| 5 | Medium | Truncation fallback dropped the merchant label for long two-label names | **Fixed.** The final two labels are always kept whole; the SVG text carries `textLength` so any length fits; golden vectors updated. |
| 6 | Medium (uncertain) | `tokenURI` string assembly was O(n²) and might exceed common `eth_call` gas caps | **Measured and bounded** by a Moccasin row asserting the gas of a 60-character name under a pinned ceiling; assembly rewritten where needed. Number recorded in the Vyper suite. |
| 7 | Medium | Renderer version and URL base entered SVG and JSON unescaped | **Fixed.** Escaped at every entry point; the constructor refuses unsafe characters in either. |
| 8 | Low | A recipient debited during the unlock reverted by bare panic | **Fixed.** `DeliveryNotExact` by name. |
| 9 | Low | The admission's ENS deployment id check is a configuration pin, not provenance | **Documented** as such in the NatSpec. |
| 10 | Low | Policy receiver constructor accepted zero addresses and a code-less registry | **Fixed.** `ZeroAddress`, `RegistryHasNoCode` at deployment. |
| 11 | Low | `markSeeded` read depth at the current tick and called it the opening tick | **Fixed.** Asserts `slot0.tick == initTick` first (`OpeningTickMismatch`). |
| 12 | Low | Adapter arithmetic could panic on absurd answers or a future sequencer start | **Fixed.** Answers bounded before multiplication (`FeedAnswerOutOfRange`); a future start is `SequencerStatusUnknown`. |
| 13 | Low | `oracleCondition()` said OK for a market that cannot settle | **Fixed.** Any non-ACTIVE status is `MARKET_CLOSED`. |
| 14 | Info | NatSpec claiming more than the code does (transient namespace, unused `HOOK_ARGS_BYTES`, spec/catalogue disagreement on `AmountTooLarge`) | **Recorded.** Comments to be tightened; no behaviour change. |
| 15 | Info | Zero-return (USDT-shaped) tokens are refused by `TransferFailed` rather than at configuration | **Recorded** as a configuration-gate item for the public deployment checklist. |

## Confirmed properties (positive scope)

- Only the market's executor can swap through its hook; a router and a raw unlock are refused.
- One pool per hook, initialised only by the factory; the permission set is exactly `0x20C0` and is enforced
  three times (mining, factory prediction, BaseHook constructor).
- Payer binding, three shapes of replay refusal, minimum output checked twice, exact input, full fill.
- The recipient is written once and never changes; `take` pays it only.
- Neither ADMIN nor PAUSER can move funds: no token call in the registry or factory, one `transferFrom` from
  the payer inside `pay`, no sweep, no `receive`.
- Policy and caps only tighten; the seed cap has no setter; no raise path exists.
- The `(adapter, feedId)` route is committed into `marketId`, verified at registration and re-verified on
  every swap.
- Reverse maps are write-once; a look-alike hook built from the same source behind a spoofed registry is
  disowned by all three.
- RETIRED is terminal across all forty-nine status pairs.
- The oracle band is inclusive on both bounds, rounded against acceptance, with range checks before any
  multiplication; the adapter composes the cross price on the older timestamp and enforces round
  completeness and sequencer grace.
- The receipt's four fee fields are correct in both token orderings against the official PoolManager
  bytecode (`(0,3000,500,3499)` and `(0,3000,1000,3997)` re-measured).
- Terminal operators cannot escalate in any of the seven ways tried; revocation is effective for future
  admissions; only ADMIN adds an order creator.
- The policy receiver performs every RECEIVER.md §5 step in order, never returns without storing, refuses
  trailing bytes, compares literally, and treats a zero payer as never a wildcard; the forwarder fixture's
  raw-call semantics make "forwarder succeeded, receiver rejected" a state tests reach.
- The identity token is non-transferable on every ERC-721 path, mints only to the namespace controller,
  binds `namehash(name) == node`, and reads only immutable data in `tokenURI`.
- No address or chain-id literal in `src/unica-v4/` or `src/identity/`; no secret; no copied block.

## Design-accepted residuals (with the ruling)

- Calendar-day cap window: up to 2× the daily cap either side of midnight (SPEC-CONTRACTS §9.2).
- Retire-and-relist restarts a market's daily counter (ruling V4); tooling refuses deliberate evasion.
- The $100 cross-market seed total is an operator rule enforced by the deployment script (ruling S5).
- Post-SEEDED liquidity is ungated and the seed cap is point-in-time (ruling S6).
- A look-alike pool on the same pair is always possible; only the registry separates it (SPEC §3).
- No on-chain merchant record or minimum payment in this release (SPEC §9.2, open scope conflict).
- The feed adapter cannot prove a feed describes its asset; the chain configuration carries that claim.
- A revoked terminal cannot invalidate an order already admitted (by design; `TerminalAdmission` header).
- The local ENS fixture lets the owner extend an admin bit after registration where the hosted deployment
  refuses (declared in the fixture header); `hasRoles` folds `ROOT_RESOURCE`, inert locally.
- `getMarkets` returns ids only (SPEC §12 size cut).
- Chainlink is planned on public chains; the local run proves the adapter over fixture feeds only.

## Sabotage checks

| Mutant | Caught by |
|---|---|
| Read `delta.amount0()` as the input leg regardless of token ordering | `test_X1b_settlesInTheMirroredOrdering`, `test_H12c_assetIsCurrency1_takesTheHighTwelveBits` |
| Drop `adapter` and `feedId` from the recomputed `marketId` | `test_R7_marketIdDiffersAcrossChainVersionAdapterAndFeed` |
| Delete both residual comparisons in `_verifyAndAccount` | nothing at review time → `Guards.t.sol` X14 rows and mutants M-res-1/2 now |

The full mutation table and its verdicts live in `script/mutation-unica-v4.sh` and are reproduced by
`make mutants-unica-v4`; the run's output is the evidence, not this paragraph.

## Process incident, recorded

While the mutation runner was being built it operated on the working tree, applying one mutant at a
time and restoring the file afterwards. A formatting commit was staged in that window and shipped the
hook without its `_markSwapped` line; no test went red, which is exactly the gap finding 1 describes. The
next diff exposed it and the line was restored in the following commit. Two rules follow and are now in
force: the runner works on a copy of the tree, never the working tree; and files are staged by name,
never by directory, while any tool that rewrites sources is running. The incident is left in the history
on purpose: a review record that hid its own slip would be worth less than one that shows it.

## What a third-party audit should start from

The finding list above, the mutation table, `docs/unica-v4/THREAT-MODEL.md`, the enforcement-layer matrix,
and the local acceptance run (`make anvil-test`). The parts that decide where money goes are the parts that
held up best under adversarial reading; the parts that were changed were at the edges (admission, renderer,
diagnostics). No production deployment should rely on this record alone.
