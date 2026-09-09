# Project banner

Hand-written SVG plus rendered PNG. No build step, no dependency, no web font, no external
reference — every file opens on its own in a browser or any editor.

## Files

| File | What it is |
|---|---|
| `unica-banner-1600x900.svg` / `.png` | The banner. 16:9. **Light — the default identity.** Editable source. |
| `unica-banner-1600x900-dark.svg` / `.png` | Same geometry, dark palette. |
| `unica-banner-1200x630.svg` / `.png` | Social / Open Graph card, 1.91:1. Laid out natively, not scaled. |
| `unica-banner-1200x630-dark.svg` / `.png` | Same, dark palette. |
| `safe-area.svg` / `.png` | Crop guide for the 1600×900. Which centre crops survive, and which do not. |
| `previews-light-dark.png` | Light and dark side by side, for choosing one. |

## The copy, which is the whole point

```
UNICA
A merchant's till becomes a portfolio — and the portfolio still spends.
Exact settlement through Uniswap v4 is live on Ethereum Sepolia.
Treasury automation and confidential execution are being built.
```

The brand line is set as two lines, breaking at the em dash, so it survives a square centre crop.
Joined with a single space it is the sanctioned line, character for character.

Two claims, two different marks, and the difference is the point:

- **Filled accent dot** — shipped. Exact settlement is live on Sepolia.
- **Hollow muted ring** — not shipped. Treasury automation and confidential execution are being built.

Nothing on the banner says V2 is live, that anything is audited or production-ready, or that any
sponsor endorses this. The footer states the opposite in words: independent, not affiliated.

## Palette — the product's, not a new one

Both palettes are lifted from `web/index.html` and were not reinvented. Contrast measured, not assumed:

| | ink | paper | accent | muted | line |
|---|---|---|---|---|---|
| Light | `#14161A` 17.49:1 | `#FBFBFA` | `#0B6E4F` 6.04:1 | `#5B6169` 6.04:1 | `#E4E4E1` |
| Dark | `#F2F2EF` 16.70:1 | `#121212` | `#35B888` 7.46:1 | `#9AA0A6` 7.09:1 | `#2A2C30` |

All text pairings pass WCAG AA. The accent is the product's one colour and is spent on one thing:
the claim that is actually live.

## Safe area

Measured from the rendered PNG, not estimated. Content occupies **x 395–1203, y 172–852**.

| Centre crop | Verdict |
|---|---|
| 1:1 square (x 350–1250) | survives, 45px clearance per side |
| 4:3 (x 200–1400) | survives, 48px |
| 1.91:1 (y 31–869) | survives, 17px |
| **4:5 portrait (x 440–1160)** | **clips — the brand line overhangs by 45px per side** |

If a 4:5 crop is ever required, re-set the brand line at 39px or smaller and the two status rows at
21px or smaller, then re-measure. See `safe-area.svg`.

## Regenerate the PNGs

```sh
cd docs/submission-media/banner
rsvg-convert unica-banner-1600x900.svg      -o unica-banner-1600x900.png
rsvg-convert unica-banner-1600x900-dark.svg -o unica-banner-1600x900-dark.png
rsvg-convert unica-banner-1200x630.svg      -o unica-banner-1200x630.png
rsvg-convert unica-banner-1200x630-dark.svg -o unica-banner-1200x630-dark.png
rsvg-convert safe-area.svg                  -o safe-area.png
```

If `rsvg-convert` is not installed: `brew install librsvg`.

## Type

The SVGs carry the product's own font stack and terminate in `sans-serif`; no font is embedded or
fetched. On this machine the stack resolves to Helvetica Neue, which is what the committed PNGs
show. On a machine without those faces the SVG will re-flow to whatever `sans-serif` resolves to —
line widths change, and the safe-area clearances above are no longer guaranteed. **The PNGs are the
fixed artifact; the SVGs are the editable source.** Ship the PNGs.
