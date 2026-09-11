# Accessibility — UNICA v5 POS

Engineering record. Scope: the accessibility specification for the theme system in
`docs/unica-v5/pos/THEMES.md` — contrast, focus, semantics, motion and transparency
preferences, color-blind-safe status design, touch targets, and platform cues — with
every contrast ratio computed by a script actually run, never asserted. **UNICA v5** is
the PROPOSED future dashboard/POS release; nothing here is **UNICA v4** (the deployed
contract release) or **"Uniswap v4"** (the AMM). No statement here authorizes starting,
building, scheduling, or announcing UNICA v5.

Statement classes used throughout: **VERIFIED** (an official source is cited and was
read), **PROPOSED** (a UNICA product-design choice), **UNKNOWN** (neither confirmed nor
safely inferred). Every external claim carries its source URL and "accessed
2026-09-11". A source that did not load after one retry is marked **UNREAD**, and
nothing is inferred from its content.

This file assumes `THEMES.md` §1–§5 (theme overview and design tokens) as given; token
names below match that file exactly.

## Contents

1. Purpose and method
2. Contrast computation methodology
3. Color tokens under test
4. Contrast ratio tables — text
5. Non-text contrast (SC 1.4.11) — neumorphic surface boundaries
6. Focus states and keyboard navigation
7. Screen-reader semantics and labels
8. Reduced motion, reduced transparency, forced colors, prefers-contrast
9. Color-blind-safe status design
10. Touch target sizes
11. Haptic and audio cues — platform support
12. WCAG 2.2 checklist
13. Sources
14. Uncertainties

## 1. Purpose and method

This file exists so no contrast, focus, or platform-support claim in `THEMES.md` is
taken on faith. Every ratio in §4–§5 was produced by the script in §2, run 2026-09-11
against the token values `THEMES.md` §5 defines — not estimated, not rounded
up from a plausible-looking hex pair, and not carried over from a different design
system. Every platform-preference and assistive-technology claim in §8 and §11 is
either an official source read, accessed 2026-09-11 (§13), or explicitly marked UNKNOWN/
UNREAD (§14) — this file follows the same discipline `THEMES.md` §1 states for the
UNICA v4 facts it must respect.

## 2. Contrast computation methodology

Relative luminance and contrast ratio, computed exactly as WCAG 2.x defines them: for
each sRGB channel, linearize with the standard piecewise transform, combine with the
ITU-R BT.709 coefficients (0.2126 R + 0.7152 G + 0.0722 B) to get relative luminance
`L`, then for two colors `L1 >= L2`, contrast ratio = `(L1 + 0.05) / (L2 + 0.05)`. The
script, run 2026-09-11:

```python
def srgb_to_lin(c):
    c = c / 255.0
    return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055) ** 2.4

def rel_lum(hexcolor):
    hexcolor = hexcolor.lstrip('#')
    r, g, b = (int(hexcolor[i:i+2], 16) for i in (0, 2, 4))
    R, G, B = srgb_to_lin(r), srgb_to_lin(g), srgb_to_lin(b)
    return 0.2126*R + 0.7152*G + 0.0722*B

def contrast(hex1, hex2):
    L1, L2 = rel_lum(hex1), rel_lum(hex2)
    lighter, darker = max(L1, L2), min(L1, L2)
    return (lighter + 0.05) / (darker + 0.05)
```

Run with `python3` against every token pair in §3, twice — once to find the first-draft
palette, and again after §4/§5 found two failures and the tokens were iterated
until they cleared their floor (the dark-mode `--accent-fill` label color, and the
`--border-strong` tokens) — so the tables below are the **second**, corrected run, not
the first. The first run's two failing rows are kept in §4/§5 as a record of what did
not work and why, so that "the rule that fixes them" is shown as well,
not only the passing result.

WCAG floors applied: 4.5:1 for normal text (SC 1.4.3), 3:1 for large-scale text — 18pt/
24px normal or 14pt/~18.5px bold — and for non-text UI components and meaningful
graphical objects (SC 1.4.3 and SC 1.4.11; both VERIFIED against the W3C Understanding
documents, §13). Ratios are compared unrounded, per the Understanding document for SC
1.4.11's own note that a computed 2.999:1 does not meet a 3:1 requirement — no ratio
below is rounded up across its floor.

## 3. Color tokens under test

Exactly `THEMES.md` §5's token table. Restated here with the specific hex values this
file's script consumed, so a later reviewer can re-run the script without cross-
referencing the other file:

| Token | Light | Dark |
|---|---|---|
| `--bg-canvas` | `#F4F5F7` | `#14161D` |
| `--surface-flat` | `#FFFFFF` | `#1E212C` |
| `--surface-tactile` | `#ECEEF2` | `#23262F` |
| `--text-primary` | `#1B1E2B` | `#F0F1F5` |
| `--text-secondary` | `#545B6E` | `#B3B8C7` |
| `--border-hairline` | `#D3D6DE` | `#33374A` |
| `--border-strong` | `#7B8093` | `#6B7190` |
| `--focus-ring` | `#3730A3` | `#A5B4FC` |
| `--accent-indigo-text` | `#4338CA` | `#A5B4FC` |
| `--accent-fill` | `#4F46E5` | `#818CF8` |
| `--accent-fill-text` | `#FFFFFF` | `#0B0B14` |
| `--status-success` | `#157F3C` | `#4ADE80` |
| `--status-warning` | `#92400E` | `#FBBF24` |
| `--status-danger` | `#B91C1C` | `#F87171` |

Rejected during iteration, kept as a record: dark-mode `--accent-fill` candidate
`#6366F1` (indigo-500) — see §4's first two rows.

## 4. Contrast ratio tables — text

All ratios below were computed 2026-09-11 by the §2 script against the §3 values.
"Floor" is 4.5:1 unless the pairing is large-scale text per §2, in which case 3:1
applies and is noted.

### 4a. Light theme

| Pairing | Ratio | Floor | Result |
|---|---|---|---|
| `--text-primary` on `--bg-canvas` | 15.19:1 | 4.5:1 | PASS |
| `--text-secondary` on `--bg-canvas` | 6.21:1 | 4.5:1 | PASS |
| `--text-primary` on `--surface-flat` | 16.57:1 | 4.5:1 | PASS |
| `--text-secondary` on `--surface-flat` | 6.78:1 | 4.5:1 | PASS |
| `--accent-fill-text` (white) on `--accent-fill` (button label) | 6.29:1 | 4.5:1 | PASS |
| `--accent-indigo-text` on `--bg-canvas` | 7.24:1 | 4.5:1 | PASS |
| `--status-success` text on `--bg-canvas` | 4.66:1 | 4.5:1 | PASS (narrowest margin in light mode) |
| `--status-warning` text on `--bg-canvas` | 6.50:1 | 4.5:1 | PASS |
| `--status-danger` text on `--bg-canvas` | 5.93:1 | 4.5:1 | PASS |

### 4b. Dark theme

| Pairing | Ratio | Floor | Result |
|---|---|---|---|
| `--text-primary` on `--bg-canvas` | 16.01:1 | 4.5:1 | PASS |
| `--text-secondary` on `--bg-canvas` | 9.12:1 | 4.5:1 | PASS |
| `--text-primary` on `--surface-flat` | 14.21:1 | 4.5:1 | PASS |
| `--text-secondary` on `--surface-flat` | 8.10:1 | 4.5:1 | PASS |
| `--accent-indigo-text` on `--bg-canvas` | 9.06:1 | 4.5:1 | PASS |
| `--status-success` text on `--bg-canvas` | 10.37:1 | 4.5:1 | PASS |
| `--status-warning` text on `--bg-canvas` | 10.82:1 | 4.5:1 | PASS |
| `--status-danger` text on `--bg-canvas` | 6.53:1 | 4.5:1 | PASS |

### 4c. The button-label fix — first draft failed, second draft passed

| Pairing (dark mode `--accent-fill`) | Ratio | Floor | Result |
|---|---|---|---|
| black-ish label `#0B0B14` on **rejected** fill `#6366F1` | 4.38:1 | 4.5:1 | **fail** |
| white label `#FFFFFF` on **rejected** fill `#6366F1` | 4.47:1 | 4.5:1 | **fail** |
| black-ish label `#0B0B14` on **adopted** fill `#818CF8` | 6.57:1 | 4.5:1 | PASS |
| white label `#FFFFFF` on adopted fill `#818CF8` (checked, not used) | 2.98:1 | 4.5:1 | fail |

Neither label color cleared 4.5:1 against the first indigo-500 fill candidate — both
rows are 0.03–0.12 short, which is exactly the kind of near-miss the SC 1.4.11
Understanding document warns must not be rounded past (§2). The token was iterated one
step lighter to indigo-400 (`#818CF8`); a near-black label on that fill clears the floor
with real margin (6.57:1), while white-on-`#818CF8` was checked and rejected (2.98:1)
rather than assumed to be the safer choice just because it is white. `THEMES.md` §5
therefore specifies `--accent-fill-text` as "always re-derived," not a fixed per-mode
value, precisely because the naive light-mode choice (white-on-fill) does not transfer.

## 5. Non-text contrast (SC 1.4.11) — neumorphic surface boundaries

SC 1.4.11, Level AA (VERIFIED, §13): user interface components and graphical objects
required to understand content need a contrast ratio of at least 3:1 against adjacent
color(s), except inactive components or those whose appearance is user-agent-controlled.
This is the criterion a neumorphic surface is built to fail, because its entire visual
language depends on the surface being the *same* color as what surrounds it, with only a
shadow implying a boundary.

Computed 2026-09-11:

| Pairing | Ratio | Floor | Result |
|---|---|---|---|
| `--surface-tactile` vs `--bg-canvas` (light) | 1.06:1 | 3.0:1 | **fail** |
| `--surface-tactile` vs `--bg-canvas` (dark) | 1.20:1 | 3.0:1 | **fail** |
| `--border-hairline` vs `--bg-canvas` (light, decorative — not the fix) | 1.33:1 | 3.0:1 | fail (by design; never used as a load-bearing boundary) |
| `--border-hairline` vs `--bg-canvas` (dark, decorative) | 1.54:1 | 3.0:1 | fail (by design) |
| An intermediate "slightly stronger hairline" tried and rejected (light, `#9AA0AE`) | 2.40:1 | 3.0:1 | **still fails** — recorded to show that a small nudge is not enough |
| An intermediate "slightly stronger hairline" tried and rejected (dark, `#5B6178`) | 2.95:1 | 3.0:1 | **still fails, by 0.05** — the exact near-miss SC 1.4.11's own note warns against rounding past |
| **`--border-strong` vs `--bg-canvas` (light, adopted)** | **3.60:1** | 3.0:1 | **PASS**, with margin |
| **`--border-strong` vs `--bg-canvas` (dark, adopted)** | **3.78:1** | 3.0:1 | **PASS**, with margin |
| `--focus-ring` vs `--bg-canvas` (light) | 9.11:1 | 3.0:1 | PASS |
| `--focus-ring` vs `--bg-canvas` (dark) | 9.06:1 | 3.0:1 | PASS |

**What this proves, and the rule that fixes it.** `--surface-tactile`'s flat-color
contrast against `--bg-canvas` is 1.06:1 (light) / 1.20:1 (dark) — a box-shadow gradient
is doing all of the perceptual work of separating a raised key or a recessed tray from
the page, and a box-shadow is not a value a contrast formula, a screen reader, or a
forced-colors user agent can register as a boundary at all. Two escalating hairline
attempts (`#D3D6DE`/`#33374A`, then `#9AA0AE`/`#5B6178`) both still failed the 3:1 floor
— the second dark attempt missed by 0.05, the exact scale of error the Understanding
document's no-rounding rule exists to catch. Only a genuinely darker/lighter token
(`--border-strong`, `#7B8093` light / `#6B7190` dark) cleared the floor, and it was
verified with a working margin (3.60:1 / 3.78:1) rather than left at a value that
rounds up to pass.

**The rule, stated once, that every neumorphic surface in `THEMES.md` §6 follows:** a
box-shadow illusion is decoration layered on top of a `--border-strong` edge that
already exists and already passes 3:1 without the shadow. Verified independently: MDN's
own documentation of `forced-colors: active` lists `box-shadow` under "Properties with
Special Behavior" and states it is "forced to `none`" — so a design that relies on the
shadow alone loses its entire boundary the instant a user turns on forced colors (MDN,
`forced-colors`, accessed 2026-09-11; §13). `--border-strong` is unaffected by that
forced-colors rule because a real `border`/outline color is one of the properties the
same specification explicitly still lets an author's declared color (or the forced
system color) render through.

## 6. Focus states and keyboard navigation

- Every interactive control in every theme carries a visible focus indicator using
  `--focus-ring`, which clears the SC 1.4.11 non-text 3:1 floor against `--bg-canvas` by
  a wide margin in both modes (9.11:1 light, 9.06:1 dark — §5), so the indicator itself
  never becomes the accessibility gap even before `--border-strong` is considered.
- SC 2.4.11 Focus Not Obscured (Minimum), Level AA (VERIFIED, §13): "When a user
  interface component receives keyboard focus, the component is not entirely hidden due
  to author-created content." UNICA v5 POS has no sticky header, footer, or non-modal
  overlay in the ten screens `THEMES.md` §11 describes that is allowed to fully cover a
  focused control; the persistent testnet badge and header (`THEMES.md` §11a, §13) are
  positioned so they never overlap the keypad, the confirmation control, or any other
  focusable element.
- Full keyboard operability: the amount keypad (§11a of `THEMES.md`), the confirmation
  control (§11b), and every disclosure ("Advanced details") are reachable and operable
  by keyboard alone, in the same left-to-right, top-to-bottom order the visual layout
  implies, in every theme — a theme swap changes token values (§3) and shadow decoration
  (`THEMES.md` §6), never tab order.
- Destructive/irreversible controls (`THEMES.md` §13) are never the default focused
  element on a screen, and never activate on a single ambiguous key event shared with a
  non-destructive control — consistent with SC 3.3.7/3.3.8-style caution against
  accidental, low-friction destructive submission, applied here to a payment context
  rather than an authentication one.

## 7. Screen-reader semantics and labels

- Every status in `THEMES.md` §10 is exposed to assistive technology as text content (an
  accessible name or a live region announcement), never as a color or icon alone — this
  is the same "never by color alone" rule stated visually in `THEMES.md` §13, restated
  here as the SC 4.1.2 Name, Role, Value (Level A, VERIFIED §13) requirement it actually
  is: every UI component's name, role, and state must be programmatically determinable.
- The amount display, the merchant identity line, the network name, the fee lines, and
  the payout recipient (`THEMES.md` §11b, §13) are each their own labelled text node —
  never concatenated into one unlabelled block a screen reader would read as a single
  run-on string.
- Transient state changes that matter for the payment outcome — "Processing" advancing
  to "Waiting for confirmation" to "Payment confirmed" (`THEMES.md` §11c–§11d) — are
  announced via an `aria-live="polite"` region (or the equivalent for the eventual
  implementation platform), so a screen-reader user is not left re-polling the screen to
  discover a state change a sighted user sees animate.
- The persistent testnet badge (`THEMES.md` §10, §13) has an accessible name that states
  the same "Test mode — no real value" text visually shown, not an icon-only `aria-label`
  abbreviation a screen-reader user would have to decode.
- "Advanced details" (`THEMES.md` §4) is a real disclosure control (exposed
  expanded/collapsed state), not a decorative chevron with no semantic connection to the
  content it reveals.

## 8. Reduced motion, reduced transparency, forced colors, prefers-contrast

Four platform preferences, each VERIFIED from MDN, accessed 2026-09-11 (§13) and each mapped
to a specific rule in `THEMES.md`:

| Preference | Values (VERIFIED) | UNICA v5 POS rule |
|---|---|---|
| `prefers-reduced-motion` | `no-preference` \| `reduce`; Baseline widely available since January 2020, including Safari and iOS Safari per MDN's own compatibility note | Every animated transition (the tactile press-state, any success-state flourish) has a non-animated equivalent and is capped at 150ms or removed outright under `reduce` (`THEMES.md` §9). |
| `prefers-contrast` | `no-preference` \| `more` \| `less` \| `custom`; MDN states Safari/iOS Safari support | Under `more`, all themes render with the high-contrast token set (§9 below; pure black/white text and canvas, `--border-strong`-class borders everywhere shadows would otherwise stand alone). |
| `prefers-reduced-transparency` | `no-preference` \| `reduce`; MDN marks this **not Baseline** ("limited availability") — the full per-browser table did not render on fetch, 2026-09-11, so exact current Safari/iPadOS support is not independently confirmed beyond that general note | Any translucent layer (a modal scrim, a receipt-paper texture overlay) increases to a solid or near-solid fill under `reduce`; nothing UNICA v5 relies on is illegible if the preference is unsupported and never fires, since the default fills already meet §4's floors without transparency. |
| `forced-colors` | `none` \| `active`; Baseline widely available since September 2022 per MDN, "including iOS Safari" | Under `active`, `box-shadow` is forced to `none` (MDN, confirmed §5) and `background-image` is forced to `none` except url-based images — so Tactile POS's shadow decoration disappears and every element must still be legible from its `--border-strong` edge and system-color text/background alone (`THEMES.md` §6 rule 2). |

`prefers-contrast: more` is treated in this specification as the trigger for a **high-
contrast token set**, distinct from `forced-colors: active` (which hands color choice to
the user agent entirely via system color keywords, not to UNICA's own tokens):

| Token role | High-contrast light | High-contrast dark | Computed ratio |
|---|---|---|---|
| Canvas / primary text | `#FFFFFF` / `#000000` | `#000000` / `#FFFFFF` | 21.00:1 (both directions — the maximum possible under this formula) |
| Borders replacing all shadow-only edges | solid 2px `#000000` | solid 2px `#FFFFFF` | 21.00:1 against their respective canvas |

These are the maximum-contrast values the relative-luminance formula in §2 can produce
(pure black against pure white), computed and confirmed rather than assumed to be
"obviously fine."

## 9. Color-blind-safe status design

Every status role in `THEMES.md` §5/§10 (`--status-success`, `--status-warning`,
`--status-danger`) is paired with a distinct icon shape (check, triangle, cross —
`THEMES.md` §10's table) and a distinct text label, so a payer who cannot distinguish
green from red, or amber from either, still identifies the state from shape and text
alone. This directly implements SC 1.4.1 Use of Color, Level A (VERIFIED §13: color is
not used as the only visual means of conveying information), and follows the owner's
UX-direction rule that green is reserved for success, amber for oracle/quote warnings,
and red only for failure — no other UI role borrows those three hues, so a payer who
does perceive color still gets a consistent signal from hue alone as a secondary,
non-load-bearing cue.

Apple's own stated color guidance for avoiding "difficult to distinguish blue from
orange, or red from green" as the sole state differentiator was reported by a search
summary rather than read directly from an official Apple page, accessed 2026-09-11 (the HIG
Color page returned no body text, §14 of `THEMES.md`); it is not relied upon here as a
VERIFIED citation — the binding requirement used is SC 1.4.1 itself, which this file did
verify directly.

## 10. Touch target sizes

SC 2.5.8 Target Size (Minimum), Level AA (VERIFIED §13): a pointer target is at least
24×24 CSS pixels, except where one of five conditions holds — spacing (a 24px-diameter
circle centered on the target does not overlap another target's own circle), an
equivalent same-page control already meets the minimum, the target sits inline in text,
the user agent (not the author) controls the size, or the size is essential to the
information conveyed (map pins, legally mandated layouts). Quoted and paraphrased in
full in `THEMES.md` §8, which is not repeated here; the binding numbers UNICA v5 POS
actually ships (72×64 / 64×56 keypad keys, ≥48×48 standard buttons, 8px minimum gutter)
are in that file's table and were chosen to clear this floor with a wide margin rather
than to the floor itself.

## 11. Haptic and audio cues — platform support

Restated from `THEMES.md` §9 at the level of detail this file's checklist needs:

- **`navigator.vibrate()`**: MDN documents the Vibration API as not Baseline, historically
  listing Safari (macOS and iOS) as unsupported (VERIFIED, §13). One open, untriaged
  `mdn/browser-compat-data` community report (#29166, accessed 2026-09-11) claims
  `navigator.vibrate()` worked on a recent iOS Safari build under "sticky user
  activation," with a further unconfirmed report that Apple tightened the requirement
  again in iOS 18.4 — neither is an official WebKit/Apple statement, and the issue was
  still open at access time. **Rule: haptic feedback is feature-detected, best-effort,
  and never the sole carrier of any state in `THEMES.md` §10.**
- **Audio cues**: WebKit's documented iOS `<video>` autoplay policy (VERIFIED, §13)
  establishes that a media element with an audio track cannot autoplay and pauses again
  if it "gains an audio track or becomes un-muted without a user gesture." Extending
  this specific rule to a standalone `<audio>` element is this file's own reasoned
  inference (PROPOSED), not a line quoted from an audio-specific WebKit source (flagged
  in `THEMES.md` §15). **Rule: an audio cue is only triggered inside a handler for a
  gesture already in the payment flow, is unlocked by that same early gesture for any
  cue that must fire later without a fresh tap, is muted by default, and — per SC 1.4.2
  Audio Control, Level A, VERIFIED via the WCAG 2.2 success-criteria list itself, §13 —
  has a persistent, discoverable mute control.**

## 12. WCAG 2.2 checklist

Mapped to the success-criteria list and levels this file verified directly from
`w3.org/TR/WCAG22/` (§13). Each row states the SC number, name, level, and where in
`THEMES.md`/this file it is addressed.

| SC | Name | Level | Addressed |
|---|---|---|---|
| 1.4.1 | Use of Color | A | §9 (status icon+text+color); `THEMES.md` §10, §13 |
| 1.4.2 | Audio Control | A | §11 (persistent mute control on any audio cue) |
| 1.4.3 | Contrast (Minimum) | AA | §4 (full computed tables); `THEMES.md` §7 (large-text threshold) |
| 1.4.4 | Resize Text | AA | PROPOSED: relative units (rem/em) throughout the type scale in `THEMES.md` §7 — not yet implemented or tested against 200% zoom; recorded as an uncertainty (§14) |
| 1.4.10 | Reflow | AA | PROPOSED: single-column layout at countertop tablet widths; not yet built or tested (§14) |
| 1.4.11 | Non-text Contrast | AA | §5 (the neumorphic-boundary finding and fix); `THEMES.md` §6 |
| 1.4.12 | Text Spacing | AA | PROPOSED: no token in `THEMES.md` §5/§7 hard-codes line-height/letter-spacing in a way that blocks a user style override; not yet tested (§14) |
| 1.4.13 | Content on Hover or Focus | AA | PROPOSED: "Advanced details" (§7 of `THEMES.md`) is click/tap-to-expand, not hover-triggered, avoiding this SC's failure mode by construction; not yet built (§14) |
| 2.1.1 | Keyboard | A | §6 (full keyboard operability of keypad, confirmation, disclosures) |
| 2.4.7 | Focus Visible | AA | §6 (`--focus-ring` token, computed margin over the 3:1 floor) |
| 2.4.11 | Focus Not Obscured (Minimum) | AA | §6 (header/badge layout never covers a focused control) |
| 2.5.8 | Target Size (Minimum) | AA | §10; `THEMES.md` §8 (sizes chosen well above the 24×24 floor) |
| 3.3.7 | Redundant Entry | A | Not directly applicable to the ten single-pass screens in `THEMES.md` §11 as described; no multi-step re-entry of the same data exists in this design. Recorded as N/A-by-design, not evaluated against a build. |
| 3.3.8 | Accessible Authentication (Minimum) | AA | Out of scope here — wallet authentication is delegated to the connected wallet's own UI (`THEMES.md` §2, §11b), never re-implemented by UNICA. |
| 4.1.2 | Name, Role, Value | A | §7 (labelled text nodes, live regions, real disclosure semantics) |

Success criteria the WCAG 2.2 list also contains but that this file did not evaluate
because no build exists to test them against (e.g. 1.3.1 Info and Relationships, 2.4.3
Focus Order, 3.2.x Predictable, most of the AAA tier) are left off this table rather than
marked PASS by assumption — see §14.

## 13. Sources

External, VERIFIED (fetched and read, accessed 2026-09-11):

- W3C, *Web Content Accessibility Guidelines (WCAG) 2.2* — https://www.w3.org/TR/WCAG22/
  — success-criteria numbers, names, and levels quoted in §12.
- W3C WAI, *Understanding SC 1.4.11: Non-text Contrast* —
  https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html — the 3:1 floor,
  scope, exceptions, and the no-rounding rule used in §5.
- W3C WAI, *Understanding SC 1.4.3: Contrast (Minimum)* —
  https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html — the 4.5:1/3:1
  floors and the 18pt/14pt-bold ≈ 24px/18.5px large-text conversion used in §2 and
  `THEMES.md` §7.
- W3C WAI, *Understanding SC 2.5.8: Target Size (Minimum)* —
  https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html — the 24×24
  CSS-pixel floor and its five exceptions, used in §10.
- W3C WAI, *Understanding SC 2.4.11: Focus Not Obscured (Minimum)* —
  https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html — used in
  §6.
- MDN, *`prefers-contrast`* —
  https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-contrast
  — values and Safari/iOS Safari support, used in §8.
- MDN, *`prefers-reduced-transparency`* —
  https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency
  — values and the "not Baseline" support note, used in §8.
- MDN, *`forced-colors`* —
  https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/forced-colors
  — the `box-shadow` → `none` and `background-image` → `none` (except url) rules central
  to §5's finding, and Safari/iOS Safari support, used in §8.
- MDN, *`prefers-reduced-motion`* —
  https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
  — values and Safari/iOS Safari support, used in §8.
- MDN, *Vibration API* — https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API
  — "not Baseline" status, used in §11.
- MDN, *`Navigator.vibrate()`* —
  https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate — sticky-
  user-activation requirement, used in §11.
- WebKit, *New \<video\> Policies for iOS* —
  https://webkit.org/blog/6784/new-video-policies-for-ios/ — the audio-track/user-
  gesture autoplay rule, used in §11.
- `mdn/browser-compat-data` issue #29166 (community report, unresolved/untriaged at
  access time, not authoritative) —
  https://github.com/mdn/browser-compat-data/issues/29166 — used in §11 as an
  unconfirmed counter-report, not as settled fact.
- Apple, *Sufficient Contrast evaluation criteria* (App Store Connect Help) —
  https://developer.apple.com/help/app-store-connect/manage-app-accessibility/sufficient-contrast-evaluation-criteria/
  — the only Apple-owned page that returned real body text, accessed 2026-09-11 (4.5:1 text /
  3:1 non-text ratios, tested against Bold Text / Increase Contrast / Reduce
  Transparency); cited for corroboration, not as the primary source for any WCAG number,
  since the WCAG documents above were read directly.

External, **UNREAD** (attempted, no usable body text after retry — nothing inferred
from these; see `THEMES.md` §14 for the identical list, repeated here because this
file's §9 and §10 both reference the gap):

- Apple, Human Interface Guidelines, *Color* —
  https://developer.apple.com/design/human-interface-guidelines/color
- Apple, Human Interface Guidelines, *Typography* —
  https://developer.apple.com/design/human-interface-guidelines/typography
- Apple, Human Interface Guidelines, *Layout* —
  https://developer.apple.com/design/human-interface-guidelines/layout
- Apple, Human Interface Guidelines, *Color and Contrast* (older path, 404) —
  https://developer.apple.com/design/human-interface-guidelines/accessibility/overview/color-and-contrast/

Internal: `docs/unica-v5/pos/THEMES.md` (this file's companion; token values in §3 are
copied from its §5).

## 14. Uncertainties

- **No build exists.** Every ratio in §4–§5 is computed against the token *values*
  `THEMES.md` §5 specifies; none has been screenshotted, rendered, or tested with an
  actual screen reader, an actual countertop tablet, or an actual `forced-colors`/
  `prefers-contrast` toggle. §12's checklist marks several SCs "PROPOSED... not yet
  implemented or tested" for exactly this reason, and this is the single largest
  uncertainty in the whole file.
- **SC 1.4.4 Resize Text, 1.4.10 Reflow, and 1.4.12 Text Spacing are asserted only as
  intentions** (relative units, single-column layout, no hard-coded spacing overrides),
  not as measured outcomes — no zoom test, no reflow test at 320 CSS px, and no
  text-spacing-override test has been run, because there is nothing to run it against
  yet.
- **Apple's own contrast, typography, and layout guidance could not be read directly**
  (`THEMES.md` §14/§15 has the full list of attempted URLs and why each failed). The one
  Apple page that did load (App Store Connect's Sufficient Contrast criteria) broadly
  corroborates the WCAG 4.5:1/3:1 floors this file already uses from a primary WCAG
  source, but it is a secondary confirmation, not the basis for any number here.
- **The Vibration API's actual behavior on the current iPadOS Safari release is
  unresolved**, per conflicting official-vs-community signals in §11 — treated as
  absent-until-reverified, which is safe but not certain.
- **The audio-autoplay rule verified here is documented for `<video>`; its extension to
  `<audio>`/Web Audio is this file's own inference**, not a directly quoted rule for
  those APIs specifically (§11, and `THEMES.md` §15).
- **`prefers-reduced-transparency`'s exact current per-browser support table did not
  render on fetch, 2026-09-11** — MDN's qualitative "limited availability" note was
  read, but the row-by-row table (which would confirm the current iPadOS Safari
  behavior specifically) was not.
- **3.3.7 Redundant Entry and 3.3.8 Accessible Authentication are marked N/A-by-design
  or out-of-scope** based on this file's reading of the ten screens in `THEMES.md` §11 as
  described in prose; a future build could introduce a multi-step flow or an in-surface
  authentication step that brings one or both back into scope, and this file's
  N/A judgment would need to be re-checked against that build, not assumed to still
  hold.
- **The merchant-brand accent-hue contrast re-check described in `THEMES.md` §3c/§5 is
  a specification for a future control, not a control that exists.** No script in this
  repository currently runs it; the script in §2 of this file was run manually, once,
  2026-09-11.
