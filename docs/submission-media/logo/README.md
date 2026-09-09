# The UNICA mark

*A merchant's till becomes a portfolio — and the portfolio still spends.*

## What was already decided, and what this adds

This folder invents no new identity. UNICA already had a brand, declared once as a comment at
the top of [`web/index.html`](../../../web/index.html): four colour fields, a radius, and a rule
about where the accent is allowed to appear. No logo, mark, or favicon existed anywhere in the
tree before this folder — the search covered `web/`, `design/`, every `.svg` and `.png` outside
`lib/`, and every mention of the owning studio in the docs. `design/README.md` is a written brief
for the payment page, not a visual identity.

So the mark is an **extension of the existing palette**, not a second identity. Every colour below
is lifted from that declaration unchanged. Nothing was sampled, guessed, or newly mixed.

## The idea

UNICA is Latin for *one of a kind*. The product settles a payment into exactly the asset the
merchant invoiced.

The mark carries that one idea and nothing else: **three bars of unequal length, and one upright
block.**

The three bars are the takings — many, arriving in whatever sizes they arrive in. The block is
what the merchant actually ends up holding: one thing, whole.

The relationship between them is the whole point, and it is exact rather than suggested:

> **The block has precisely the same area as the three bars combined.**

In the master mark, the three bars total 48 units of length at 14 units tall; the block is 14
units wide and 48 tall. It is the same rectangle twice — once distributed, once settled. Nothing
is lost between the two sides, and nothing is added. That is the claim the product makes about a
settlement, drawn rather than written.

This is measurable, not asserted. Rendering the shipped SVG and counting pixels by colour gives
**67,200 ink : 67,200 accent** at 640 px, and **19,800 : 19,800** for the favicon at 320 px —
equal to the pixel, both files.

## The palette

Every value is from the existing declaration in `web/index.html`. Contrast ratios are WCAG 2.1,
computed rather than eyeballed; the two marked ✓ match figures already recorded independently in
that file, which is how the calculation was checked.

### Light

| Role | Token | Hex | Used for | Contrast on ground |
|---|---|---|---|---|
| Ground | `paper` | `#FBFBFA` | the field the mark sits on | — |
| The many | `ink` | `#14161A` | the three bars | 17.49:1 ✓ |
| The one | `accent` | `#0B6E4F` | the upright block | 6.04:1 |

### Dark

| Role | Token | Hex | Used for | Contrast on ground |
|---|---|---|---|---|
| Ground | — | `#121212` | the field | — |
| The many | dark `ink` | `#F2F2EF` | the three bars | 16.70:1 |
| The one | dark `accent` | `#35B888` | the upright block | 7.46:1 |

Both accents clear 4.5:1 comfortably, so the mark is legible to low-vision viewers on either
ground. **The hierarchy never depends on colour alone** — the block is distinguished by being the
only upright form and by carrying a third of the mark's height in one piece, so it survives
greyscale, one-colour print, and every form of colour blindness.

### Two rules inherited from the page

- **Squared corners on every element.** The page sets `--radius: 4px` and calls it "the serious end
  of the scale; this page moves money." The bars and the block are cut square for the same reason:
  the mark is about exactness. Only the outer field is rounded, at 6 units on the 64-unit grid, so
  it behaves as an avatar or app icon.
- **The accent is spent once.** The page's rule is that the accent appears on the settlement action
  and nowhere else. In the mark it is spent on the settled asset — the one element that is the
  result rather than an input. It is never used for decoration.

## The files, and where each one goes

| File | Use it for |
|---|---|
| `unica-mark.svg` | **The master.** 64-unit square grid, `paper` field, rounded. Avatars, app icons, README headers, anywhere a self-contained square is wanted. |
| `unica-mark-1024.png` | Raster master. Submission forms and profile uploads that reject SVG. Transparent outside the rounded field. |
| `unica-mark-512.png` | The same at half size, for upload fields that cap dimensions. |
| `unica-mark-transparent.svg` | No field. Place on a **light** ground of your choosing — a slide, a page header, a light photograph. |
| `unica-mark-on-dark.svg` | The dark-ground preview, using the page's own dark palette. Dark slides, dark READMEs, terminal-themed material. |
| `unica-mark-mono.svg` | One colour, drawn in `currentColor`. Single-colour print, embroidery, stamps, engraving, or inline in HTML where it should inherit text colour. Inherits black if no colour is set. |
| `unica-favicon.svg` | Browser tabs, at 32 and 16 px. |

## Why the favicon is drawn differently

It is a redrawing, not a rescaling, and it changes **three bars to two**.

Halving the master puts its inter-bar gaps at 1.5 device pixels and its smallest bar at 5 — below
the point where either survives a 16 px render. This was checked by rendering both at 16 px and
looking: the three-bar version blurred into a single grey smudge, the two-bar version stayed
crisp. So the favicon is drawn natively on a 32-unit grid with heavier parts and wider gaps.

The idea survives the simplification intact, including the arithmetic: two bars of 9 and 13 at 9
tall are 198 units of area; the block is 9 wide and 22 tall, also 198. Still exact.

The favicon keeps its `paper` field rather than going transparent, so it holds its contrast
against a browser tab of any colour, light theme or dark.

## Constraints this meets

- Hand-written SVG. **No `<script>`, no external `<image>` reference, no web font, no gradient, no
  filter, no embedded raster.** Verified by scanning every file. Nothing to break in print, and
  nothing that can phone out from a document that embeds it.
- **No text in any file**, so there is no tiny lettering to fail at small sizes and no font to go
  missing.
- No sponsor logo, no third-party trademark, no borrowed geometry. Every coordinate was written
  here from the idea.
- Largest SVG is under 700 bytes; the 1024 px PNG is about 11 KB.
- PNGs were produced with `rsvg-convert`, already present on the build machine. To regenerate:

```sh
cd docs/submission-media/logo
rsvg-convert -w 1024 -h 1024 unica-mark.svg -o unica-mark-1024.png
rsvg-convert -w 512  -h 512  unica-mark.svg -o unica-mark-512.png
```

## Saying it in words

If the mark needs a caption, the supporting line is the honest one:

> **Exact settlement today. Merchant-controlled treasury automation is being built.**

UNICA is built by NFTeria, independently. It is not commissioned by, affiliated with, endorsed by,
or reviewed by Uniswap or any other party.
