# PLAN.md — the build plan, dated, appended never rewritten

The plan this repository is built against, in the open. Entries are dated and appended; an
earlier entry is never edited to look like it predicted what happened. Where the plan and the
tree disagree, the tree is the truth and the next entry says what changed and why.

The scope is fixed by `specs/HOOK-SPEC.md`: a router-gated settlement hook, six invariants
plus native-settlement integrity, the documented threats mitigated, a receipt event, one hook
address on several v4 testnets. Nothing in this plan widens that scope.

## 2026-09-04 — day 1, written at the start of the window

**The rule for every day:** a real artifact by the end of it, with its proof beside it, or
the day is not done. Small commits, one idea each, pushed within minutes. A check that has
never been seen to fail is not a check.

| Day | Date (UTC) | The artifact that must exist by the end of the day |
|---|---|---|
| 1 | 2026-09-04 | Repository public with the disclosed design in `specs/`. Toolchain vendored and pinned. The hook frame (`afterSwap` only) with the permission-bit guard seen red then green. A real swap through v4-core's PoolManager locally. The live-fire sequence simulated against Sepolia state, then broadcast by the key holder: deploy, initialise the native-ETH / USDC pool, seed, swap; recorded with hashes and re-verify commands; the swap screenshotted at status 1. |
| 2 | 2026-09-05 | I1 (the router is the sole path; the recipient is the registered payout address) and I7 (native settlement: `sync` before `settle{value:}`, refund by `call`). Each function's test lands beside it. The I7 negative test fails without the sync and passes with it. |
| 3 | 2026-09-06 | I2, the settlement receipt event carrying order id, net, fee, and recipient id, alongside the standard hook events; the order registry as the sole quote source; I4 and I5 (deadline, replay). Fuzz at 10,000 runs green. |
| 4 | 2026-09-07 | Deploy, verify source, and live-fire the gated hook on Ethereum Sepolia in one day. README proof rows with chain, address, verified, transaction hash, block, status, and the one-line command that re-proves each. |
| 5 | 2026-09-08 | The public surface: one page, one action, one public URL, driven against the deployed hook. A stranger completes a settlement and sees the receipt. |
| 6 | 2026-09-09 | Half a day of red-team: attack proofs committed red then green (flag mismatch, unauthorised callback, hostile hook data). `SECURITY.md`. `FEEDBACK.md` complete. Every README claim carries its re-verify command. |
| 7 | 2026-09-10 | The demo video, product action first, explorer proof second, the disclosure sentence spoken. |
| 8 | 2026-09-11 | Chains 2 to 4 at the same address: deployed, verified, live-fired, or cut. Re-record slot if needed. Integration seams only once the video is final, each removable in one commit, each labelled by the rung it reached. |
| 9 | 2026-09-12 | Submit, with every qualification artifact linked from the README. |

**Cut line.** I3 (slippage floor) and I6 (never strand) are tested with I1 to I5 on days 2
and 3 because the money-path law outranks the others; if the calendar slips, the surface,
the video, and the submission are never what gets cut. Chains 2 to 4 and every integration
seam are.

**Day-1 sequence as executed.** Identity set locally before the first commit. Commits in
this order: licence and ignore list and README stub; `CLAUDE.md`; `AI_USAGE.md`; Foundry
configuration; submodules pinned with the tag staged before the recursive update; the hook
frame; the tests with the guard's sabotage run recorded in the commit message; CI with a
provenance job; the living invariants and threat records; `specs/` and `HACKATHON.md`; the
fuzz count; the feedback files; the design brief; the live-fire scripts and Makefile; this
plan; the README. Then the anvil-fork rehearsal, then the handoff of the broadcast to the
key holder.

**What is deliberately not in this plan.** More than one page of surface. Any change to the
pinned toolchain. Any partner integration before the core hook, its surface, and its
compliance artifacts are complete. Mainnet, of any kind.
