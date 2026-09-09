# UNICA — submission media

**A merchant's till becomes a portfolio — and the portfolio still spends.**

Exact settlement today. Merchant-controlled treasury automation is being built.

| | |
|---|---|
| **Evidence commit** | `d16ae2f48f54d2e2c30774196d6202b2e8b3c6ab` |
| **Verified on** | 2026-09-08 |
| **Built by** | NFTeria — independent. Not commissioned by, affiliated with, endorsed by or reviewed by Uniswap or any sponsor. |
| **Licence** | MIT |

Every file in this directory was re-verified on the commit above: each SVG parsed and rendered,
each PNG's real pixel size read back, each spoken number re-derived by running the command that
produces it. What that verification found — including two things that will fail on camera — is in
[Claim limitations](#claim-limitations) at the bottom. Read that section before using anything here.

`artifact-manifest.json` carries the sha256, dimensions, MIME type, purpose and evidence
classification of every file listed on this page.

---

## Logo

The mark is three ink bars and one upright accent block: takings arrive in whatever sizes they
arrive in; the block is what the merchant ends up holding. The block has **exactly** the same area
as the three bars combined — verified by counting rendered pixels, not by arithmetic: 67,200 ink to
67,200 accent at 640px.

| Preview | File | Use |
|---|---|---|
| ![mark](logo/unica-mark-512.png) | `logo/unica-mark.svg` | master, light ground |
| | `logo/unica-mark-1024.png` · `logo/unica-mark-512.png` | raster, where SVG is rejected |
| | `logo/unica-mark-transparent.svg` | over an existing ground |
| | `logo/unica-mark-on-dark.svg` | dark ground (#121212) |
| | `logo/unica-mark-mono.svg` | one colour — print, embroidery, `currentColor` |
| | `logo/unica-favicon.svg` | redrawn at 32 units, two bars, for tab size |

Palette is the product's own, taken from `web/index.html` and not reinvented: ink `#14161A`,
paper `#FBFBFA`, accent `#0B6E4F`; dark set `#F2F2EF` / `#121212` / `#35B888`. Full notes and the
contrast table are in [`logo/README.md`](logo/README.md).

## Banner

One accent colour, spent on one thing: a **filled** dot marks the claim that is live, a **hollow
ring** marks the claim that is being built. The form makes the shipped / not-shipped distinction
before the words do.

![banner](banner/unica-banner-1600x900.png)

| File | Size | Ground |
|---|---|---|
| `banner/unica-banner-1600x900.svg` · `.png` | 1600×900 | light |
| `banner/unica-banner-1600x900-dark.svg` · `.png` | 1600×900 | dark |
| `banner/unica-banner-1200x630.svg` · `.png` | 1200×630 | light |
| `banner/unica-banner-1200x630-dark.svg` · `.png` | 1200×630 | dark |
| `banner/safe-area.svg` · `.png` | 1600×1060 | crop-safety overlay |
| `banner/previews-light-dark.png` | 1600×600 | light/dark contact sheet |

Crop safety was measured from the rendered raster, not estimated: 1:1, 4:3 and 1.91:1 all survive
a centre crop. **4:5 portrait clips the artwork** — see [Claim limitations](#claim-limitations).
Notes in [`banner/README.md`](banner/README.md).

## Video

The script, the shot timeline with real captured output, and the three cards.

| File | What it is |
|---|---|
| [`video/script.md`](video/script.md) | the narration — seven beats, 421 spoken words |
| [`video/timeline.md`](video/timeline.md) | shot-by-shot timeline, each command with its actual output |
| [`video/captions.vtt`](video/captions.vtt) | 32 WebVTT cues, ending 00:03:00.400 |
| [`video/recording-checklist.md`](video/recording-checklist.md) | pre-flight before the take |
| [`video/redaction-checklist.md`](video/redaction-checklist.md) | what must not appear on screen |
| `video/title-card.svg` · `title-card-1920x1080.png` | 1920×1080 opening card |
| `video/end-card.svg` · `end-card-1920x1080.png` | 1920×1080 status board |
| `video/thumbnail.svg` · `thumbnail-1280x720.png` | 1280×720 thumbnail |

**Runtime: 3:00 at 140 wpm** (421 words). Inside the 2:00–4:00 bound, and it stays inside for any
delivery from roughly 106 to 210 wpm — the bound is not tight against a slow reading.

### Captions

`video/captions.vtt` is valid WebVTT: 32 cues, monotonic, no overlaps, last cue ends
`00:03:00.400`. **The timings are computed from the word count, not measured from audio** — they
must be re-timed against the recorded track before upload.

## Screenshots

*The orchestrator adds real screenshots here. Placeholders only — nothing below is a file yet.*

| Slot | Shot | Source of truth |
|---|---|---|
| `screenshots/01-checkout.png` | the checkout surface, merchant name resolved to an address before payment | `web/` |
| `screenshots/02-settlement-tx.png` | the settlement transaction, status Success | tx `0x1120af18…ee0ecb83` |
| `screenshots/03-verify-live.png` | `verify-live.sh` at 31 of 31 | `docs/proof/verify-live.sh` |
| `screenshots/04-verifier.png` | `unica-verify` at 37 of 37 | `tools/unica-verify/` |
| `screenshots/05-cre-simulation.png` | the CRE Confidential Workflow simulation | `integrations/chainlink-cre-guardian/` |
| `screenshots/06-graph-skip.png` | The Graph live-proof refusing to pass, exit 1 | `integrations/graph-v2/live-proof.mjs` |

Every screenshot must pass `video/redaction-checklist.md` before it lands here.

## Tech stack

[`tech-stack.md`](tech-stack.md) — the human page. [`stack-manifest.json`](stack-manifest.json) —
the same content as data, with a status vocabulary defined in-file so no reader can upgrade a
status by skimming.

Re-derived on this commit, all green, nothing carried over: **298** Solidity tests (33 suites),
**82** Vyper, **1,612** JavaScript rows across **16** reporting suites, 0 failed anywhere.

> **`02-live-sepolia-evidence.png` is stale.** It was captured from
> `screenshots/evidence-page-source.html` when the gate read 182 / 1,543 across 14 suites. The HTML
> has been re-derived; the PNG has not been re-captured, because capturing it needs a browser. Do
> not ship that image until it is retaken — the numbers on its face are the old ones.

---

## Claim limitations

Stated plainly, because a submission package that hides these is worth less than one that does not.

**What is live.** UNICA V1 is deployed and source-verified on Ethereum Sepolia, with one settlement
receipted. Hook `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0`, executor
`0x044bc8a8773EC7b9B8de2467766636dFFCaC6210`. Re-read on this commit: `receiptCount` 1,
`orderCount` 1, transaction status 1 (success), `make proof` 14/14 + 31/31.

**What is not.**

- **V2 is not shipped.** Frozen at `v2.0.0-rc1` and **blocked** by an open Critical the team found,
  reproduced and published themselves.
- **Nothing has run in a TEE.** The Chainlink Confidential Workflow runs in Chainlink's own
  simulator, which the CLI itself states is not a real TEE. Evidence grade is
  `CRE_CONFIDENTIAL_SIMULATION`. Deploy access is requested and pending review.
- **UNICA owns no ENS name.** The 78 live Sepolia rows read a name somebody else registered.
  Nothing is ever written.
- **The Graph subgraph is not deployed.** No successful live read has ever been observed.
  `live-proof.mjs` fails closed and exits 1 rather than reporting a pass.
- **Nothing has been broadcast on Arc.** No UNICA contract exists there and no swap path does.
  The tool renders the transaction an owner would sign, then stops.
- **No part of UNICA has been audited.**

**Two things that will fail on camera, confirmed by running them on this machine.**

1. **The CRE simulation shot cannot be recorded as this machine stands.** `bun` on PATH is 1.2.5;
   `@chainlink/cre-sdk` declares `bun >=1.2.21`. The workflow compiles, looks fine, and then dies
   with a bare `wasm unreachable` trap naming neither bun nor the workflow. `bun test` passes on
   1.2.5, so a green test row is **not** evidence the shot will run. Install a current bun first.
2. **The README's own proof command is broken on this toolchain.** `cast receipt <hash> --rpc-url
   $RPC --field status` fails — the field is positional. The working form is
   `cast receipt <hash> status --rpc-url $RPC`. This is a repo defect outside this directory, not a
   media defect; it is recorded here so it is not typed live.

**Other things a reader should know.**

- The public Sepolia endpoint is flaky. `cast receipt … blockNumber` failed twice and succeeded on
  the third attempt during this verification; `verify-live.sh` reports its own retry count and still
  reaches 31/31. The chain is stable; the endpoint is not. Rehearse the reads.
- The banner and card SVGs use live text in a generic-terminated font stack, so no font is embedded.
  Every crop-clearance figure was measured with that stack resolving locally. **On a machine with
  different fonts the lines re-flow and those guarantees no longer hold — ship the PNGs and treat
  the SVGs as editable source.**
- A **4:5 portrait centre crop clips the banner artwork** by 45px per side at 1600×900 and 21px at
  1200×630. It is drawn in red on `banner/safe-area.svg` rather than hidden. If a platform demands
  4:5, re-set the type and re-measure — do not scale.
- The ETHGlobal video rules quoted in `video/recording-checklist.md` were transcribed on 2026-08-21
  and have not been re-checked against the published page. Re-read them the morning of the recording.
- The CRE CLI prints a secret-derived value that the filmed frame will contain. It is redacted from
  every file in this directory. See `video/redaction-checklist.md` before publishing any capture.

No credentials, private keys, or deployment procedures appear anywhere in this directory.
