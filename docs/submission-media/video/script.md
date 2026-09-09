# UNICA — demo video narration

**This is the final narration.** It is spoken live, in a human voice, first person plural. Nothing
below is a claim this repository cannot back with a command in
[`timeline.md`](timeline.md), and every command in that file was run and its real output pasted.

> **ETHGlobal rule, and it is absolute:** *"DO NOT use a text to speech synthesizer / AI Voiceover."*
> Every word here is read aloud by the owner. If you are tempted to generate this track, the
> submission is rejected. See [`recording-checklist.md`](recording-checklist.md).

---

## Measured runtime

| | |
|---|---|
| Word count, spoken narration only | **421 words** (counted over the seven `SAY` blocks) |
| Delivery rate assumed | 140 words per minute |
| **Resulting runtime** | **421 ÷ 140 = 3.007 min = 3:00** |
| Hard bounds | 2:00 – 4:00 |
| Verdict | **inside, with 60 s of headroom below the ceiling and 60 s above the floor** |

The count is spoken words only. Section headers, stage directions and the on-screen text in
`timeline.md` are not spoken and are not counted.

**What was cut to reach it.** The first draft ran 511 words (3:39). Three things came out, and a
fourth pass trimmed 16 more words of connective tissue (`"and not one of them is a value read back
and agreed with"` → `"and nothing is read back and agreed with"`, and six similar) to land on 3:00
exactly rather than 3:07:

1. **The architecture explainer** — 46 words describing the executor composing the router's plan
   and the hook's `0xC0` permission bits. It is true and it is in the README. On camera it turned a
   demo into a lecture, and nothing later in the video depends on the listener having heard it.
2. **The `make gate` recital** — 28 words reading out 298 Solidity tests, 82 Vyper tests and 1,612
   JavaScript rows across 16 suites. Every number is real (see `timeline.md` shot 7 fallback), but
   a spoken list of counts is the least persuasive thirty seconds available, and the status beat
   already establishes what is proven versus what is not.
3. **The V2 short-fill finding** — 12 words on the periphery checking the input ceiling and never
   comparing delivered output against the request. It is our best Uniswap finding and it belongs in
   the written submission, not here: it needs a diagram to land, and there is no diagram.

The disclosure sentence was **not** cut and must not be. It is quoted policy.

---

## The narration

### 1. PROBLEM — 00:00 → 00:17

> **SAY:**
> A barbershop takes money all day. It lands in a till, in one currency, and sits there — idle
> until somebody moves it by hand. We wanted the till to become a portfolio, and the portfolio to
> still spend.

*39 words · 16.7 s*

### 2. LIVE SETTLEMENT ON SEPOLIA — 00:17 → 00:55

> **SAY:**
> So we built UNICA: a settlement hook for Uniswap v4, live and source-verified on Ethereum
> Sepolia. One disclosure first — the specification and threat model were written before the event;
> every line of code was written during it. Here is the settlement that ran. The payer
> sent one thousandth of an ETH. The merchant received exactly 2.003660 USDC — not about, exactly.
> Uniswap did the conversion: the swap's sender is Uniswap's own Universal Router, and our hook
> admits no other. The order is Settled, and paying it again reverts.

*89 words · 38.1 s*

**The disclosure sentence is quoted, not paraphrased.** It appears identically in `README.md` and
`docs/DEMO.md`. Say it exactly.

### 3. VERIFICATION — 00:55 → 01:21

> **SAY:**
> You do not have to trust that receipt. Our verifier rebuilds it. The quote digest is recomputed
> from the quote's own fields. The merchant's address is recovered from a signature over that
> rebuilt digest. The pool id is rebuilt from the whole pool key. Only then is anything compared
> with the log. Thirty-seven checks, and nothing is read back and agreed with.

*62 words · 26.6 s*

### 4. TREASURY — BEING BUILT — 01:21 → 01:48

> **SAY:**
> The portfolio half is being built. Here is where it stands. On Circle's Arc we read the live
> chain and modelled a merchant treasury: a reserve floor, a per-action cap, one permitted
> transfer. Twenty live reads, a hundred and seventy-seven offline rows. No UNICA contract exists
> on Arc. We broadcast nothing there. The tool renders the transaction an owner would sign, then
> stops.

*63 words · 27.0 s*

**Mark it as unbuilt out loud.** "Being built", "modelled", "nothing broadcast" are the load-bearing
words in this beat. Do not let delivery turn them into background noise.

### 5. CONFIDENTIAL STRATEGY — 01:48 → 02:24

> **SAY:**
> The strategy above it is confidential. This is a Chainlink CRE Confidential Workflow,
> registered with handlerInTee. Five private policy values load inside the handler. What leaves it
> is a policy commitment, an action class and a reason category — no threshold reaches any
> published field. That run just happened: exit zero, "Handler requested TEE Execution", evidence
> grade CRE underscore CONFIDENTIAL underscore SIMULATION. Chainlink's own CLI says plainly that
> this simulator is not a real TEE. Nothing here has run in an enclave.

*82 words · 35.1 s*

**Pronunciation.** `handlerInTee` is said "handler in tee". The evidence grade is read out as
"C-R-E confidential simulation" — the underscores are written above only so the reader does not
smooth them away; do not say the word "underscore" on camera.

**Never say, in this beat or anywhere:** "DON deployment", "TEE attestation", "attested",
"runs in a TEE", "private today".

### 6. STATUS — 02:24 → 02:49

> **SAY:**
> Where each piece stands. Uniswap: live, one settlement receipted. Chainlink: simulated,
> deploy access pending review. ENSv2: seventy-eight live Sepolia reads — and we own no ENS name.
> The Graph: written, never deployed; no live read has ever been observed. Arc: nothing broadcast.
> And V2 is frozen at release candidate one, and blocked, by a Critical we found and published
> ourselves.

*60 words · 25.7 s*

### 7. CLOSE — 02:49 → 03:00

> **SAY:**
> A merchant's till becomes a portfolio — and the portfolio still spends. Exact settlement today.
> Merchant-controlled treasury automation is being built. UNICA, by NFTeria: independent,
> MIT-licensed.

*26 words · 11.1 s*

---

## The banned list, restated where the reader is

Not in narration, not on screen, not in a caption, not in a file name:

prize amounts · sponsor logos · any sponsor endorsement wording · "production-ready" · "audited" ·
"private today" · "V2 live" · Tesla or any named equity · fabricated transaction hashes ·
fabricated dashboard values · any implication that treasury automation, confidential execution,
ENSv2, The Graph, Arc or V2 is shipped · "first" · "only" · "endorsed by Uniswap" · a successful
fresh swap while the live pool is thin.

## Every spoken number, and what backs it

| Spoken | Value | Backed by |
|---|---|---|
| "one thousandth of an ETH" | `amountIn` 1000000000000000 | `bash docs/proof/verify-live.sh` |
| "exactly 2.003660 USDC" | `amountOut` 2003660 | same, row *"the recipient's USDC transfer in the settle transaction equals the receipted amountOut"* |
| "Uniswap's own Universal Router" | `0x3A9D…F98b` as the PoolManager `Swap` event sender | same, row *"the settle transaction's swap was sent by the Universal Router"* |
| "Settled now, and paying it again reverts" | order status 3; `eth_call` on `pay` reverts | same, two rows |
| "thirty-seven checks" | 37 of 37 | `node tools/unica-verify/cli.mjs --input tools/unica-verify/fixtures/fork-settlement.json` |
| "twenty live reads" | 20 of 20 | `node integrations/arc-treasury/live-check.mjs` |
| "a hundred and seventy-seven offline rows" | 177 of 177 | `node integrations/arc-treasury/test.mjs` |
| "exit zero … Handler requested TEE Execution … CRE_CONFIDENTIAL_SIMULATION" | verbatim CLI output | `cre workflow simulate` — shot 6 in `timeline.md`, run 2026-09-08 |
| "seventy-eight live Sepolia reads" | 78 of 78, 49 read-only RPC calls | `node integrations/ensv2/permissioned-live.mjs` |
| "no live read has ever been observed" | `live-proof.mjs` SKIPs and exits 1 | `node integrations/graph-v2/live-proof.mjs` |
| "frozen at release candidate one, and blocked" | `v2.0.0-rc1`, ⛔ banner | `docs/v2/RELEASE-CANDIDATE-FREEZE.md`, `docs/v2/SECURITY-ADVISORY-001.md` |
