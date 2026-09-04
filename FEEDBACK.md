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

### 2026-09-04 — `v4-security-foundations` run over the real gate and router: two catches, three misses, one template that does not compile

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

| Question the form asks | Answer, pointing at the entry that proves it |
|---|---|
| What did you build? | |
| Biggest blocker | |
| Time to first successful integration | |
| Documentation helpfulness (1–5) | |
| Support (1–5) | |
| What support was missing | |

If the form has no field for this file's URL, paste it into the free-text fields as
a `github.com` blob URL pinned to a commit SHA, and screenshot the submitted form.

---

## Feedback for other partners

| Partner | File | Status |
|---|---|---|
| The Graph, World, and every other partner investigated | `docs/feedback/<partner>.md` | none yet; files appear when a partner's tooling is actually used or investigated, never before |
