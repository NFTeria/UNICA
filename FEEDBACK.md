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
| | `docs/feedback/<partner>.md` | |
