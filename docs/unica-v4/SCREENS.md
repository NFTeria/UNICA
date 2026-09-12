# Every screen, at every size, and the fold

What the product must look like on the hardware people actually hold, what was measured to
establish that, and what could not be established. Read it with `apps/web/assets/fold.css`, which is
the executable half; this file is the evidence and the reasoning behind the numbers in it.

Nothing here was invented. Every figure in the table has a source URL and a quoted line, and every
figure that no source publishes says **UNCONFIRMED** in the cell rather than a plausible number.

---

## The finding that decides the whole approach

**A device list cannot be the contract.** On Android the CSS viewport is the panel's pixel width
divided by a display density that the owner of the phone can change in Settings, so "the viewport of
a Galaxy Z Fold6" is not a property of the Fold6. The table below contains a worked example of
exactly that: two reputable sources describe the same Fold6 cover screen, from the same published
panel of 968 × 2376 physical pixels, as **323 × 792 CSS px at density 3.0** and as **412 × 968 CSS px
at density 2.625**. Neither is wrong. They are two density settings.

So the device table is used for one thing only: to prove that the breakpoint set covers the widths
real hardware produces. The breakpoints are the contract; the devices are the evidence.

The second finding is the one the fold rules are built on:

**The web platform exposes posture and segments, not a hinge angle.** `device-posture` resolves to
`folded` or `continuous` and to nothing in between, and the viewport-segment features report where
the pieces of a window are, not how far open the hinge is. There is no per-degree signal of any
kind. The glass treatment in `fold.css` is therefore a **transition between two states when the
posture changes** — 240ms, and none at all under `prefers-reduced-motion` — and it is not, and
cannot be, an animation driven by the angle of the hinge. If somebody asks for the per-degree
version later, this paragraph is the answer.

---

## The measured viewports

CSS px is the unit the stylesheet works in: it is the panel's physical pixel count divided by the
device pixel ratio. Portrait unless the cell says otherwise. "Cover" is the outer screen of a
folding device; a device with one screen has no cover cell.

| Device | Cover viewport (CSS px) | Inner viewport (CSS px) | Panel pixels, and how the CSS px follows | Source |
|---|---|---|---|---|
| iPhone 15 | — | 393 × 852 | 1179 × 2556 at scale factor 3 | [ios-resolution.com](https://www.ios-resolution.com/) — "Logical Width:393 Logical Height:852 … Width:1179 Height:2556 PPI:460 Scale Factor:3"; corroborated by [Chromium DevTools](https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/front_end/models/emulation/EmulatedDevices.ts) — "'title': 'iPhone 15' … 'device-pixel-ratio': 3, 'vertical': { 'width': 393, 'height': 852 }" |
| iPhone 16 | — | 393 × 852 | 1179 × 2556 at scale factor 3 | [ios-resolution.com](https://www.ios-resolution.com/) — "Logical Width:393 Logical Height:852 … Width:1179 Height:2556 … Scale Factor:3"; corroborated by [Chromium DevTools](https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/front_end/models/emulation/EmulatedDevices.ts) — "'title': 'iPhone 16' … 'vertical': { 'width': 393, 'height': 852 }" |
| iPhone 16 Pro Max | — | 440 × 956 | 1320 × 2868 at scale factor 3 | [ios-resolution.com](https://www.ios-resolution.com/) — "Logical Width:440 Logical Height:956 … Width:1320 Height:2868 … Scale Factor:3"; corroborated by [Chromium DevTools](https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/front_end/models/emulation/EmulatedDevices.ts) — "'title': 'iPhone 16 Pro Max' … 'vertical': { 'width': 440, 'height': 956 }" |
| iPad (10th generation) | — | 820 × 1180 | 1640 × 2360 at scale factor 2 | [ios-resolution.com](https://www.ios-resolution.com/) — "Logical Width:820 Logical Height:1180 … Width:1640 Height:2360 PPI:264 Scale Factor:2"; corroborated by [screensizechecker](https://screensizechecker.com/devices/ipad-viewport-sizes) — "iPad 10th Gen \| 820 × 1180 \| 1640 × 2360 \| 2.0 \| 2022" |
| iPad Air 11-inch (M2 / M3) | — | 820 × 1180 | 1640 × 2360 at scale factor 2 | [ios-resolution.com](https://www.ios-resolution.com/) — "Logical Width:820 Logical Height:1180 … Width:1640 Height:2360 PPI:264 Scale Factor:2"; corroborated by [screensizechecker](https://screensizechecker.com/devices/ipad-viewport-sizes) — "iPad Air 11\" (M3) \| 820 × 1180 \| 1640 × 2360 \| 2.0 \| 2025" |
| Samsung Galaxy S24 | — | 360 × 780 | 1080 × 2340 at density 3 | [webmobilefirst](https://www.webmobilefirst.com/en/devices/samsung-galaxy-s24-2024/) — "CSS Viewport: 360 x 780 px … Pixel Density: 3x … Manufacturer Resolution: 1080 x 2340 px"; corroborated by [screensizechecker](https://screensizechecker.com/devices/android-viewport-sizes) — "Samsung Galaxy S24 \| 360 × 780 \| 1080 × 2340 \| 3.0 \| 2024" |
| Samsung Galaxy S25 | — | 360 × 780 | 1080 × 2340 at density 3 | Panel from the manufacturer, [Samsung Developer](https://developer.samsung.com/galaxy/emulator-skin/s) — "Galaxy S25 Display 6.2 inches … Resolution 1080 x 2340 pixels (~416 ppi density)"; CSS px from [screensizechecker](https://screensizechecker.com/devices/android-viewport-sizes) — "Samsung Galaxy S25 \| 360 × 780 \| 1080 × 2340 \| 3.0 \| 2025" |
| Samsung Galaxy Z Fold6 | 323 × 792 **or** 412 × 968 — the sources disagree, see the note below | 619 × 720 **or** 744 × 860 spanned — likewise | Cover 968 × 2376, main 2160 × 1856 | Panels from the manufacturer, [Samsung Global Newsroom](https://news.samsung.com/global/samsung-galaxy-z-fold-6-and-z-flip-6-elevate-galaxy-ai-to-new-heights) — "Main Screen 7.6-inch QXGA+ … (2160 x 1856, 20.9:18), 374ppi … Cover Screen 6.3-inch HD+ … (2376 x 968, 22.1:9), 410ppi". CSS px, reading 1: [screensizechecker](https://screensizechecker.com/devices/android-viewport-sizes) — "Samsung Galaxy Z Fold6 (Cover / Main) \| 323 × 792 / 619 × 720 \| 968 × 2376 / 1856 × 2160 \| 3.0 \| 2024". CSS px, reading 2: [Chromium DevTools](https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/front_end/models/emulation/EmulatedDevices.ts) — "'title': 'Galaxy Z Fold 6' … 'device-pixel-ratio': 2.625, 'vertical': {'width': 412, 'height': 968}, 'vertical-spanned': { 'width': 744, 'height': 860, 'hinge': { 'width': 0, 'height': 860, 'x': 372, 'y': 0 } }" |
| Samsung Galaxy Z Fold7 | **UNCONFIRMED** — panel is 2520 × 1080 | **UNCONFIRMED** — panel is 2184 × 1968 | Manufacturer publishes the panel, nobody found publishes a CSS viewport | [Samsung Global Newsroom](https://news.samsung.com/global/samsung-galaxy-z-fold7-raising-the-bar-for-smartphones) — "Main Screen 8.0-inch QXGA+ … (2184 x 1968), 368ppi … Cover Screen 6.5-inch FHD+ … (2520 x 1080, 21:9), 422ppi" |
| Samsung Galaxy Z Flip6 | **UNCONFIRMED** — panel is 720 × 748 | 393 × 960 | Main 1080 × 2640 at density 2.75 | Panels from the manufacturer, [Samsung Global Newsroom](https://news.samsung.com/global/samsung-galaxy-z-fold-6-and-z-flip-6-elevate-galaxy-ai-to-new-heights) — "Main Screen 6.7-inch FHD+ … Infinity Flex Display (2640 x 1080, 22:9) … Cover Screen 3.4-inch Super AMOLED 60Hz Display* 720 x 748". Main CSS px from [screensizechecker](https://screensizechecker.com/devices/android-viewport-sizes) — "Samsung Galaxy Z Flip6 \| 393 × 960 \| 1080 × 2640 \| 2.75 \| 2024" |
| Samsung Galaxy Z Flip7 | **UNCONFIRMED** — panel is 1048 × 948 | **UNCONFIRMED** — panel is 2520 × 1080 | Manufacturer publishes the panels, nobody found publishes a CSS viewport | [Samsung Global Newsroom](https://news.samsung.com/global/samsung-galaxy-z-flip7-a-pocket-sized-ai-powerhouse-with-a-new-edge-to-edge-flexwindow) — "Main Screen 6.9-inch FHD+ Dynamic AMOLED 2X 120Hz Adaptive refresh rate (1~120Hz) 2520 x 1080 (21:9) … Cover Screen 4.1-inch Super AMOLED* 1048 x 948, 60/120Hz refresh rate" |
| Google Pixel 9 Pro Fold | 412 × 922 | 836 × 842 spanned, hinge at x = 418 | Cover 1080 × 2424, inner 2076 × 2152 | Panels from the manufacturer, [Google support](https://support.google.com/pixelphone/answer/7158570?hl=en) — "External cover 6.3-inch (160 mm) Actua display … 1080 x 2424 OLED at 422 PPI" and "Internal folding 8-inch (204 mm) Super Actua Flex display … 2076 x 2152 OLED at 372 PPI". CSS px from [Chromium DevTools](https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/front_end/models/emulation/EmulatedDevices.ts) — "'title': 'Pixel 9 Pro Fold' … 'device-pixel-ratio': 2.625, 'vertical': {'width': 412, 'height': 922}, 'vertical-spanned': { 'width': 836, 'height': 842, 'hinge': { 'width': 0, 'height': 842, 'x': 418, 'y': 0 } }" |
| Apple iPhone Duo (the foldable iPhone) | 466 × 678 | 626 × 890 portrait, listed as 890 × 626 | Outer 1398 × 2034, inner 1878 × 2670, both at scale factor 3 | Panels from the manufacturer, [Apple](https://www.apple.com/iphone-duo/specs/) — "Inner display Super Retina XDR display 7.6-inch (diagonal) all-screen OLED folding display 1878-by-2670-pixel resolution at 430 ppi … Outer display Super Retina XDR display 5.4-inch (diagonal) all-screen OLED display 1398-by-2034-pixel resolution at 460 ppi". CSS px from [webmobilefirst, folded](https://www.webmobilefirst.com/en/devices/apple-iphone-duo-folded-2026/) — "Apple iPhone Duo folded: CSS viewport of 466 × 678 px" and [unfolded](https://www.webmobilefirst.com/en/devices/apple-iphone-duo-unfolded-2026/) — "Apple iPhone Duo unfolded: CSS viewport of 890 × 626 px" |

Sources were retrieved on 2026-09-12. The Chromium DevTools file is cited at `main`; a later commit
may move the numbers, which is a reason to re-read it rather than to trust this copy.

### The two notes the table needs

**Galaxy Z Fold6 — a worked disagreement, not a mistake.** Both readings start from Samsung's own
968 × 2376 cover panel. `968 ÷ 3.0 = 322.7 ≈ 323` and `2376 ÷ 3.0 = 792`, which is internally
consistent. Chromium's preset says 412 × 968 at density 2.625, and `412 × 2.625 = 1081.5`, which is
not 968 — so that preset's width and its density do not describe one device. It is a testing
profile, useful as a width to check against and not a measurement. **Both numbers are inside the
range the breakpoints already handle**, which is the point: 323 sits above the 320 floor and 412
sits in the phone band, and the layout is identical either way.

**Apple published pixels, not points.** Apple's specification page gives the iPhone Duo's two
displays in physical pixels and never states a CSS viewport. Dividing by iPhone's scale factor of 3
gives 466 × 678 and 626 × 890 — and those are exactly the two figures webmobilefirst publishes
independently. The agreement of two methods is why this row is not marked UNCONFIRMED; the
derivation is recorded so a reader can reject it if they disagree with the scale factor.

---

## What the breakpoints have to survive

Every width below was checked against `apps/web/assets/unica.css` and `apps/web/assets/fold.css` by
reading the rules that apply at it. The four claims checked at each are: **no horizontal scroll on
the document**, **44px touch targets on a coarse pointer**, **the checkout card capped at 28rem and
centred**, and **the app frame's sidebar in the right state**.

| CSS px | Which hardware in the table lands near it | Frame at that width |
|---|---|---|
| 320 | the floor; nearest real width is the Fold6 cover at 323 | one column, 12px gutters, sidebar is a scrolling top row, keypad full width |
| 360 | Galaxy S24, Galaxy S25 | as above |
| 390 | iPhone 15 / 16 at 393, Galaxy Z Flip6 main at 393 | as above |
| 430 | iPhone 16 Pro Max at 440, iPhone Duo folded at 466 | as above, up to 30rem = 480 |
| 744 | Fold6 inner at 619–744, Pixel 9 Pro Fold inner at 836 | still one column: 744 is below the 52rem = 832 collapse boundary |
| 820 | iPad and iPad Air portrait, iPhone Duo unfolded landscape at 890 | one column at 820; two columns from 832 |
| 1024 | iPad landscape, small laptop | sidebar 14rem + content, content measure 58rem |
| 1280 | laptop | as above, frame centred from 80rem = 1280 |
| 1440 | desk | as above; the measure stops growing and the extra width becomes margin |

The sidebar collapse boundary is **52rem**. It was already correct in `assets/unica.css` — the
`.appframe` grid is `minmax(0, 1fr)` by default and becomes `14rem minmax(0, 1fr)` inside
`@media (min-width: 52rem)`. `fold.css` does not move it; it makes the collapsed state behave like a
row (one line, scrolling sideways inside itself, sticky to the top) instead of a block of wrapped
links that pushes the page down. The one real defect found and fixed in `fold.css` was **three
controls under 44px**: the wallet chip's inline button and its network select at 32px, and a
disclosure summary at 32px. They grow to 44 only under `@media (pointer: coarse)`, so the desk
layout is untouched.

---

## The fold, in three standard features

### Two segments side by side

`@media (horizontal-viewport-segments: 2)` fires when the window is reported in two pieces on the
inline axis. The gap between them is read, never guessed:

```
--seg-a-end:   env(viewport-segment-right 0 0, 50%)   the right edge of the left segment
--seg-b-start: env(viewport-segment-left  1 0, 50%)   the left edge of the right segment
--hinge:       calc(var(--seg-b-start) - var(--seg-a-end))
```

The app frame becomes two panes with `--hinge` as the column gap, so the sidebar occupies the left
segment, the content occupies the right, and the seam holds nothing. The checkout and marketing
frames are constrained to one segment: a total and the button under it must never sit on opposite
sides of a seam, and no line of body text should be cut in half by one.

The assumption, stated so it can be checked: `.appframe` spans the viewport's inline axis from its
origin, so segment (0,0)'s right edge is also the left pane's width. `<body>` carries only the
safe-area insets, which are zero on the segmented layouts above.

### Two segments stacked

`@media (vertical-viewport-segments: 2)` does the same on the block axis, with the gap taken from
`env(viewport-segment-bottom 0 0)` and `env(viewport-segment-top 0 1)`. The frame stacks and the
seam becomes the row gap. `scroll-padding-block-end` keeps a control the customer is reaching for
from being scrolled to rest underneath the seam.

### Posture

`@media (device-posture: folded)` is the standard route, and `assets/fold.js` writes the same fact
to `<html data-posture>` from `navigator.devicePosture` for browsers that ship the object before the
media feature. `fold.css` carries both selectors, so either one is enough and neither is required.

When the posture becomes `folded`, the frame's panels — the top bar, cards, the checkout card, empty
states, the environment banner and status regions — go to 62% opacity and, where
`backdrop-filter` is supported, blur what is behind them. The transition is **240ms ease**, and
`@media (prefers-reduced-motion: reduce)` removes it entirely: the state still changes, the change
is just not animated. `continuous` is written down as an explicit solid state rather than left to
the absence of the folded rule, so a posture that arrives late still puts the frame back.

**The contrast was computed, not eyeballed.** At 62% the panel composites over whatever page surface
is behind it. Recomputing from the hex in `assets/unica.css`, the worst pairing in either scheme is
body `--ink` over a panel sitting on `--line`: **14.69:1** in the dark scheme and **15.74:1** in the
light one. The quietest text, `--muted`, bottoms out at **5.15:1** (light, over `--line`).
`apps/web/tests/fold.test.mjs` recomputes all of it and fails below 4.5:1, with a control that
proves the arithmetic can fail.

**What `fold.js` does not do.** It exports nothing. It reads no user-agent string, names no device,
stores nothing, and never touches a payment. With `navigator.devicePosture` absent it does nothing
at all and leaves the attribute unset, so the solid single-pane frame stands. It does not report an
unknown posture as `continuous`: "the device is open" and "nobody asked the device" are different
facts.

---

## How the shell includes it

`fold.css` and `fold.js` are emitted into `out/assets/` by the build, because `apps/web/build.mjs`
copies the whole `assets/` directory. Emitting them is not the same as loading them: the two tags are
placed by `apps/web/src/shell.mjs`, and **the order is not negotiable** — `fold.css` after
`unica.css` and after `assets/screens/`, or its overrides lose to the files they are meant to
override. As emitted today, on every one of the twenty-two documents:

```html
<link rel="stylesheet" href="./assets/unica.css">
<link rel="stylesheet" href="./assets/screens/theme.css">
<link rel="stylesheet" href="./assets/fold.css">
```

One rule depends on that order and would fail silently without it. `screens/theme.css` gives the
colour-scheme select a 36px minimum height, which is right for a mouse and wrong for a finger;
`fold.css` raises it to 44px under `@media (pointer: coarse)` with **exactly the same specificity**,
so it wins on link order alone. `apps/web/tests/fold.test.mjs` asserts both halves of that — the
36px rule is still there to override, and `fold.css` is still loaded after it — because a target
that quietly shrinks back to 36px is not a failure anybody would see.

A route's own stylesheet is included from its body and therefore loads *after* `fold.css`, which is
deliberate: a screen may override the global layer, and the global layer may not override a screen.

---

## What was not verified, and how

**No browser was opened for this work.** There is no rendering engine in the environment that
produced these files, so nothing below the line of "the stylesheet says so" was observed:

- The rules were verified by **reading the emitted stylesheet** — `apps/web/tests/fold.test.mjs`
  builds the artifact and asserts against `out/assets/fold.css`, not against the source file, so a
  build that failed to copy it fails the test.
- The layout claims were verified by a **pure check over both stylesheets**: no declaration sets a
  fixed width larger than the narrowest content box (320 px minus the gutters) without capping it
  at `max-width: 100%`. That is the mechanical cause of a page that scrolls sideways, and the check
  carries a control that proves it can fail.
- The contrast claims were verified by **recomputing the WCAG ratio** from the hex values and the
  alpha, in both schemes, with a control.
- **Nothing was verified by rendering**: not the hinge gap on a real dual-segment device, not the
  blur, not the 240ms transition, not the coarse-pointer target growth. Those need hardware or an
  emulator with a display, and both are outside what produced this file. They are listed here so
  the gap is visible rather than assumed closed.

### Some of what these rules style is not on a screen yet

Counted across the twenty-two documents the build emits. **This table is checked by machine.**
`apps/web/tests/fold.test.mjs` re-counts every row against the emitted artifact and fails when a
number here is wrong, because prose counts do not survive a branch that moves: this table has
already been wrong twice in one afternoon — once when the checkout and counter screens landed under
it, and once when `.card` was written as 5 and `.checkout` as 2 by a count that had folded the
shipped `.co-card` into the contract's `.checkout` and a page's `.co-card`/`.shop-item` into
`.card`. The count below is by **class token**, the thing a CSS selector actually matches, never by
`id` and never by a name that merely looks similar.

| Block the rules target | Documents that render it |
|---|---|
| `.theme-pick` | 22 — every page |
| `.wchip` | 22 — every page |
| `.appframe` | 7 |
| `.sidebar` | 7 |
| `.hex` | 7 |
| `.card` | 3 |
| `.co-card` | 2 — `pay/` and `receipt/` |
| `.co` | 2 |
| `.keypad` | 1 — `business/payments/new/` |
| `.pos` | 1 |
| `.checkout` | **0** |
| `.register` | **0** |
| `.empty` | **0** |

### The contract name and the shipped name are not the same name

`apps/web/DESIGN.md` names the checkout card `.checkout` and the counter `.register`. **No document
emits either class.** The screens that exist render `.co-card` inside `.lay-checkout` and `.pos`
inside `.lay-app` — the same two things under other names. `pay/` does carry `id="checkout"`, which
is what makes the mistake above easy to make and is exactly why the count is by class token.

This is not a naming quibble. "The checkout card is capped at 28rem" was true of `.checkout` and
therefore true of nothing a customer could see. `fold.css` § 7 bridges the two and is kept as one
separable section so it can be deleted whole on the day the screens are rebuilt on the contract
names. So the rules written against `.checkout`, `.register` and `.empty` are **correct with respect
to the design system and unexercised by the product**; the rules written against `.co-card`, `.pos`,
`.keypad`, `.card`, `.appframe` and `.hex` are the ones on screen today. Those are different claims
and the table is where the difference is recorded rather than glossed.

### The cascade order is load-bearing, and it fails silently

`assets/fold.css` is linked in `<head>`. A route's own `assets/screens/*.css` is linked **inside
`<main>`** — later in document order — so **at equal specificity the route stylesheet wins**.
`screens/checkout.css` already declares `.co { max-width: 34rem }` and
`.co-card { background: var(--paper) }` at specificity (0,1,0).

That is the right way round for a route's own composition, and it is why the rules in this file stay
layout-shaped. Where § 7 must reach past it, every selector is prefixed with its layout class to
reach (0,2,0) — and the prefix earns its place differently in the two cases:

- **The folded glass needs it today.** `background` is a shorthand that sets `background-color`, so
  an unprefixed `.co-card { background-color: … }` in `fold.css` is overwritten and the see-through
  treatment does nothing on the only checkout that exists. Removing the prefix was tried; the test
  goes red, and it did not before the scanner was taught about shorthands.
- **The 28rem cap does not need it today.** `checkout.css` caps `.co`, not `.co-card`. The prefix is
  defensive: `.co-card` is that file's own block and a width is exactly what it would be entitled to
  add next.

Drop a prefix and the rule stops applying **in silence** — nothing turns red, the page simply keeps
the other file's value. Three tests hold the mechanism down: one compares every rule in `fold.css`
against all three route stylesheets with shorthands expanded and fails on any rule that would be
beaten; one asserts the two deliberate exceptions are still genuinely beaten, so the excuse list
cannot outlive its reasons; and one asserts the link order that makes the 44px override of
`.theme-pick > select` work at all.

**Where that scanner is blind, since a check's limits belong next to its result.** It compares the
classes of the key compound, so a collision on a selector whose key compound is a bare element —
`.theme-pick > select`, the one order-dependent override here — is invisible to it and is covered by
that separate named test instead. Its shorthand table is the ten these four stylesheets use, not the
whole specification, and nothing here uses `!important`.
