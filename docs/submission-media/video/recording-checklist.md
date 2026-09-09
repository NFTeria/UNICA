# Recording checklist

Work top to bottom. Nothing here is optional, and the pre-flight is not a formality — **two commands
in this repository's own README were already broken when they were tested for this package**
(`timeline.md` §*Two commands that did not work*). Assume the next one is too until you have watched
it pass this morning.

---

## A. The event's own rules — read these first, they reject uploads automatically

| Rule | What it means here |
|---|---|
| **Under 2:00 or over 4:00 is auto-rejected on upload** | the script measures **3:00** at 140 wpm. If you deliver slowly you have 60 s of headroom; if you rush you have 60 s the other way. Time a full take before the real one. |
| **Below 720p fails to upload** | record and export at **1920×1080**. The title, end and thumbnail cards are authored at that frame exactly. |
| **No text-to-speech, no AI voiceover** | the narration is read aloud by the owner, in the owner's voice, live. There is no path in this package that generates audio, and there must not be. |
| **No music-plus-on-screen-text instead of talking** | every beat is spoken. |
| **Do not speed the video up to fit** | if it is long, cut a sentence. `script.md` records what was already cut and why; cut in the same spirit. |
| **Not recorded on a phone** | screen recording software on the machine. |
| **Editing out dead time is explicitly allowed** | use it. Cut the 84 s `verify-live.sh` wait, cut typing, cut page loads. Never speed them up. |

> Re-read the event's video requirements page the morning of the recording. The table above was
> transcribed from the published rules and this file cannot detect it if they change.

---

## B. Pre-flight — run this block, watch every line, then record

```sh
cd ~/Desktop/unica && export RPC=https://ethereum-sepolia-rpc.publicnode.com && \
node --version && bun --version && cast --version | head -1 && \
cast receipt 0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83 status --rpc-url $RPC && \
node tools/unica-verify/cli.mjs --input tools/unica-verify/fixtures/fork-settlement.json | grep -E 'checks passed' && \
node integrations/arc-treasury/test.mjs | tail -1 && \
node integrations/ensv2/permissioned-test.mjs | tail -1 && \
(node integrations/graph-v2/live-proof.mjs >/dev/null 2>&1; echo "graph live-proof exit $? (1 is correct)") && \
head -3 docs/v2/RELEASE-CANDIDATE-FREEZE.md && \
bash docs/proof/verify-day1.sh | tail -1 && \
bash docs/proof/verify-live.sh | tail -2
```

**Expected, and every one of these was the real result on 2026-09-08:**

| Line | Must read |
|---|---|
| `bun --version` | **≥ 1.2.21** — see §C, this is the one that was wrong |
| `cast receipt … status` | `1 (success)` |
| verifier | `37 of 37 checks passed` |
| Arc treasury | `checks run: 177, passed: 177, failed: 0` |
| ENSv2 permissioned | `checks run: 278, passed: 278, failed: 0` |
| Graph live-proof | `exit 1 (1 is correct)` — a SKIP that exits non-zero is the correct state |
| RC freeze | the `⛔ THIS CANDIDATE MUST NOT BE DEPLOYED` banner |
| day-1 proof | `checks run: 14, passed: 14, failed: 0, unreachable: 0` |
| live proof | `checks run: 31, passed: 31, failed: 0` |

**If any line differs, stop and find out why before recording.** A number that moved is either a real
change in the world or a broken command, and both of those change what you are allowed to say.

The block takes about **two minutes**, nearly all of it in `verify-live.sh`.

---

## C. The one thing that is currently broken — fix it before shot 5

`bun --version` on this machine reported **1.2.5**. The Chainlink CRE SDK declares
`"engines": { "bun": ">=1.2.21" }`, nothing checks it, and an older bun fails
`cre workflow simulate` with a bare `wasm unreachable` trap that names neither bun nor the workflow.
**Shot 5 will fail on camera** in exactly that way.

```sh
curl -fsSL https://bun.sh/install | bash && exec $SHELL -l && bun --version
```

Then confirm the shot itself works, all the way to `exit 0`:

```sh
cd ~/Desktop/unica/integrations/chainlink-cre-guardian && set -a && . ./workflow/.env && set +a && cre workflow simulate workflow --target staging-settings --non-interactive --trigger-index 0
```

**`bun test` passing is not evidence this will work.** The tests run on any bun; the simulator does
not. Run the simulate command itself.

**Also confirm the account is still logged in** — but see the redaction checklist first, because
`cre whoami` prints the owner's email address on screen. Run it **before** the recording software
is capturing, and clear the terminal afterwards.

---

## D. Pre-record these, they are too slow to run live

Record each once, keep the clip, and cut to its final frame during the edit.

| Clip | Command | Wall clock |
|---|---|---|
| the full live proof | `bash docs/proof/verify-live.sh` | ~84 s |
| ENSv2 live | `node integrations/ensv2/permissioned-live.mjs` | ~40 s |
| the CRE simulation | shot 5's command | ~15 s, but it is the fragile one — have a still too |

Cutting a wait is explicitly permitted. Speeding one up is not.

---

## E. The machine, before you press record

- [ ] **Screen resolution set to 1920×1080.** Not scaled-for-retina; the actual capture must be 1080p.
- [ ] **Terminal font large enough to read on a phone.** 18 pt minimum. Test by shrinking the preview.
- [ ] **Light terminal theme**, to match the cards. A dark terminal is acceptable but pick one and keep it for all seven shots.
- [ ] **Prompt reduced to `unica $`** — see `redaction-checklist.md` §1. This is a redaction step, not a cosmetic one.
- [ ] **Notifications off.** Do Not Disturb, and quit anything that shows a badge: mail, chat, calendar.
- [ ] **One browser window, one tab**, opened fresh. No bookmarks bar, no other profile, no extensions visible.
- [ ] **`export RPC=…` done in the recording shell**, so no command in the timeline has a bare URL in it.
- [ ] **Microphone tested at the volume you will actually speak.** One take of beat 1, played back.
- [ ] **`docs/submission-media/video/` cards open and ready** — `title-card.svg` and `end-card.svg` full-screened in a browser window you can switch to.

---

## F. Shot order, and where the cuts go

Follow `timeline.md`. Seven shots. Record them **out of order if it helps** — the cards and the
pre-recorded terminal clips can be captured any time — but assemble in order and hold the timings:

```
00:00  1  title card                17 s
00:17  2  settlement (browser + terminal)   38 s
00:55  3  the verifier               26 s
01:21  4  Arc treasury               27 s
01:48  5  CRE confidential workflow  36 s
02:24  6  status (three commands)    25 s
02:49  7  end card                   11 s
       ────────────────────────────────────
                                   3:00
```

Cut on the beat boundary, not mid-sentence. Two seconds of held silence at the end before black.

---

## G. Say / do not say — the last read before the take

**Say, verbatim, once, in beat 2:**

> "The specification and threat model were written before the event; every line of code was written
> during it."

**Do not say, in any beat, in any ad-lib, over any frame:**

production-ready · audited · private today · V2 is live · the first · the only · endorsed by
Uniswap · in partnership with Uniswap · DON deployment · TEE attestation · attested · "it runs in a
TEE" · any prize amount · any sponsor endorsement · Tesla or any named equity · any implication that
treasury automation, confidential execution, ENSv2, The Graph, Arc or V2 is shipped.

**Do not improvise a number.** Every figure you are allowed to speak is in `script.md`'s closing
table with the command that produces it. If you find yourself about to say a number that is not in
that table, stop the take.

---

## H. After the take, before upload

- [ ] Watch the whole thing back **with the sound off**, reading only what is on screen. Every frame
      passes `redaction-checklist.md`.
- [ ] Watch it again **with the picture off**, listening only. No banned phrase, no improvised number.
- [ ] Runtime is between 2:00 and 4:00. Check the actual export, not the timeline.
- [ ] Export is 1920×1080 or better.
- [ ] `captions.vtt` re-timed against the recorded audio, not against the 140 wpm estimate.
- [ ] The thumbnail uploaded is `thumbnail-1280x720.png`.
- [ ] No AI voiceover was used at any point, including for a single pick-up line.
