# Adaptive Layout — UNICA v5 POS

Engineering record. Scope: how a UNICA v5 point-of-sale web client adapts across iPad,
responsive, dual-screen, and foldable form factors. This document designs by
**capability signal and viewport behaviour**, never by a guessed device name. UNICA v5
is the PROPOSED future dashboard/POS release; nothing here is UNICA v4 (the deployed
contract release) or "Uniswap v4" (the AMM). No statement here authorizes, schedules,
or announces a UNICA v5 build.

Statement classes used throughout: **VERIFIED** (an official source is cited and was
read), **PROPOSED** (a UNICA product-design choice, not sourced to any vendor),
**UNKNOWN** (neither confirmed nor safely inferred).

Every external claim below carries its source URL and the access date. A source that
did not load after one retry is marked **UNREAD**, and nothing is inferred from its
content.

---

## 1. Sources and method

Research window: 2026-09-11. **No Apple URL is cited here; none was supplied.** Every
Apple source cited below was located independently through web search and direct fetch;
nothing here assumes a pre-selected Apple reference, and no Apple product is described
as released unless an official Apple source is cited saying so.

Priority sources actually consulted: Apple Newsroom, Apple Developer documentation and
Tech Talks, Apple Support, the WebKit standards-positions repository and the (now
retired) WebKit feature-status index, W3C/CSSWG specifications, MDN's own compatibility
prose (used only where MDN states something in its own words — not for data tables the
fetch tool could not retrieve), and Android Developers documentation as the named
comparison platform for released, official foldable/large-screen guidance.

**Fetch limitation, stated plainly rather than smoothed over:** two Apple Developer
pages render their body text client-side in JavaScript, and the fetch tool available
here retrieved only the page `<title>` for both, on the first attempt and again
on a retry:

- `developer.apple.com/design/human-interface-guidelines/layout` — **UNREAD**
- `developer.apple.com/documentation/uikit/multitasking-on-ipad` — **UNREAD**

No content is attributed to either page anywhere in this document. Where a claim about
Apple's own adaptive-layout thinking was still needed, it is grounded instead in pages
that did return real body text: an Apple Developer Tech Talk (server-rendered
transcript), an archived Apple Developer conceptual document, and an Apple Support
consumer page — all cited by name in §2 and §5–§6.

Every "Safari does / does not support X" claim below is grounded in a source's own
prose statement (an MDN compatibility banner, a WebKit standards-positions issue, or
Apple's own developer content) rather than in a browser-by-version data table, because
those tables did not come through the fetch tool as text. That specific gap — a
qualitative signal without a version-numbered grid — is named again in §9 rather than
filled in with an invented number.

UNICA v4 facts cited below (payer binding, the order lifecycle, the no-refund model, the
v5-deferred public-payment-link security review) were re-read from the actual repository
files at the cited paths for this document — `docs/unica-v4/DECISIONS.md`,
`docs/unica-v4/SPEC-CONTRACTS.md`, `docs/unica-v4/V5-DEFERRED.md`, and
`docs/v2/SECURITY-ADVISORY-001.md` — not taken on faith from a prior
summary of them.

## 2. Apple "iPhone Fold" — investigation

### 2a. Officially confirmed

**VERIFIED — the shipping product is named "iPhone Duo," not "iPhone Fold."** Apple's
own announcement is titled "Apple unveils iPhone Duo" and opens: "Apple today introduced
iPhone Duo, the first foldable iPhone." Source: [Apple
Newsroom](https://www.apple.com/newsroom/2026/09/apple-unveils-iphone-duo/), accessed
2026-09-11. "iPhone Fold" was pre-announcement rumor-site terminology; it was never
Apple's own product name (see §2c).

Specifics from the same Newsroom source, accessed 2026-09-11: announced 2026-09-09 at an
Apple Park event; inner display 7.6" (Super Retina XDR, ProMotion, Always-On), outer
display 5.4" ("90 percent of the screen area of iPhone 18 Pro" when closed); A20 Pro
chip; a dual-battery architecture and a custom vapor chamber; starts at $1,999 for
256GB; pre-orders open 2026-10-16, availability 2026-10-23 across 70+ countries and
regions; ships with iOS 27.1. **As of this document's access date the device is
officially announced but not yet shipped** — pre-orders had not yet opened.

**VERIFIED — Apple has published its own adaptive-layout API guidance for this device.**
Source: Apple Developer Tech Talk, "Strike a pose with adaptive layouts on iPhone Duo,"
[developer.apple.com/videos/play/tech-talks/111463/](https://developer.apple.com/videos/play/tech-talks/111463/),
accessed 2026-09-11. Verified content from that source:

- A `ReservedRegions` API (SwiftUI: `GeometryProxy.reservedRegions(kind:)`; UIKit:
  `UIView.reservedRegions(kind:)`) reports hardware features that shape available
  layout space. Apple's own framing: "iPhone Duo has multiple displays, each with its
  own size class, plus hardware features that shape the available space — the hinge and
  the cameras."
- The hinge is modeled as a **division region**: "The fold is backed by a division
  region, because it divides a larger area into smaller ones." It is active only while
  folded and reports zero width when flat; inactive regions remain queryable with
  `options: .includeInactive`.
- An `ArrangementView` (SwiftUI) / `UIArrangementViewController` (UIKit) lays out a
  primary and a secondary view according to a `.split` or `.overlay` arrangement style,
  driven by size class, aspect ratio, and active division-region state.
- Apple's own stated design principle is **capability-driven, not device-driven**:
  query reserved regions, size classes, and layout geometry — the guidance never
  suggests checking for "iPhone Duo" by name.
- **This API surface is native only.** The fetched transcript contains no reference to
  Safari, WebKit, or any web API. §5g and §6e below treat that absence as load-bearing
  for what a UNICA v5 web POS client can and cannot rely on.

### 2b. Current general adaptive-layout guidance (Apple, WebKit, W3C/CSSWG, Android comparison)

- **VERIFIED, Apple consumer-level.** iPadOS 26 introduces "Windowed Apps" —
  resizable, repositionable on-device windows. Split View places two apps side by side
  ("you can drag another app from the Dock, App Library, or Spotlight to the left or
  right edge of the screen to use them side by side"); Slide Over keeps one floating
  window on top of others. Source:
  [support.apple.com/en-us/125309](https://support.apple.com/en-us/125309), accessed
  2026-09-11. **That page does not mention Stage Manager or external displays** — an
  omission this document treats as inconclusive, not as a denial (see §9).

- **VERIFIED, Apple developer-level, archived but the most specific primary text found
  on resize continuity.** "Adopting Multitasking Enhancements on iPad — Slide Over and
  Split View Quick Start" states that dragging the Split View divider is expected to
  preserve app state: "the user expects your app's state and its navigation location
  (including view, selection, scroll position, and so on) to be identical" once the
  divider is released, and that an app "must function correctly at 1/3, 1/2, and 2/3
  screen widths." Source:
  [developer.apple.com/library/archive/documentation/WindowsViews/Conceptual/AdoptingMultitaskingOniPad/QuickStartForSlideOverAndSplitView.html](https://developer.apple.com/library/archive/documentation/WindowsViews/Conceptual/AdoptingMultitaskingOniPad/QuickStartForSlideOverAndSplitView.html),
  accessed 2026-09-11. This is an archived document (its API references predate
  SwiftUI); the state-preservation *intent* is treated here as still-current Apple
  design intent, its specific API calls are not.

- **VERIFIED, W3C — safe areas.** CSS Environment Variables Module Level 1 defines
  `env(safe-area-inset-top|right|bottom|left)` as "four environment variables that
  define a rectangle by its top, right, bottom, and left insets from the edge of the
  viewport." Status: First Public Working Draft, 2025-09-23. Source:
  [w3.org/TR/css-env-1/](https://www.w3.org/TR/css-env-1/), accessed 2026-09-11.
  Safe-area insets originated as a WebKit proposal for iPhone X in 2017 ("Designing
  Websites for iPhone X," [webkit.org/blog/7929/](https://webkit.org/blog/7929/designing-websites-for-iphone-x/))
  and require `viewport-fit=cover` in the viewport meta tag to activate.

- **VERIFIED, W3C — viewport segments (foldable/dual-screen).** The same spec (its
  §2.3, per the fetch) also defines six two-dimensionally-indexed
  `viewport-segment-width|height|top|left|bottom|right` variables — "the position and
  dimensions of a logically separate region of the viewport" — addressable as e.g.
  `env(viewport-segment-width 0 0)`. A companion enumeration API (`Viewport.segments`)
  is tracked separately and, per MDN and corroborating search results, is implemented in
  Chrome/Edge 138+ and **not implemented in Firefox or Safari** as of the access date.
  WebKit's own tracking issue
  ([WebKit/standards-positions#327](https://github.com/WebKit/standards-positions/issues/327),
  accessed 2026-09-11) is open, assigned for review, and carries no stated position —
  WebKit has said neither yes nor no.

- **VERIFIED, W3C — Device Posture API.** Defines exactly two postures — `continuous`
  ("Foldable devices are continuous while they are flat; either fully opened or fully
  closed... Non-foldable devices are considered flat and therefore always continuous")
  and `folded` ("used in a book or laptop posture"). Status: Candidate Recommendation
  Draft. Sources: [w3.org/TR/device-posture/](https://www.w3.org/TR/device-posture/) and
  [developer.mozilla.org/en-US/docs/Web/API/Device_Posture_API](https://developer.mozilla.org/en-US/docs/Web/API/Device_Posture_API),
  accessed 2026-09-11. Corroborating search result: "Implemented in Chromium-based
  browsers. WebKit and Mozilla have not yet published formal positions." WebKit's own
  tracking issue is
  [standards-positions#328](https://github.com/WebKit/standards-positions/issues/328).

- **VERIFIED, W3C — Window Management API.** Defines `window.screen.isExtended`
  (available "without a permission prompt" in a secure context) and
  `window.getScreenDetails()` ("may prompt the user for permission"), for enumerating
  screens and placing content on a specific one. Status: Working Draft, published
  2026-09-08. Source:
  [w3.org/TR/window-management/](https://www.w3.org/TR/window-management/), accessed
  2026-09-11. MDN's own compatibility banner for this feature: "This feature is not
  Baseline because it does not work in some of the most widely-used browsers." No
  source confirms WebKit/Safari support as of 2026-09-11.

- **VERIFIED, W3C — Presentation API.** The standardized route for a web page to
  project content onto a second display ("enable Web content to access presentation
  displays and use them for presenting Web content"), developed by the Second Screen
  Working Group. Source:
  [w3.org/TR/presentation-api/](https://www.w3.org/TR/presentation-api/), accessed
  2026-09-11. MDN carries the same "Limited availability... does not work in some of the
  most widely-used browsers" banner for it; the exact version-by-browser grid could not
  be retrieved as text (see §9).

- **VERIFIED, W3C — dynamic viewport units.** CSS Values and Units Module Level 4,
  §6.1.2.1, defines small (`sv*`), large (`lv*`, and the default `v*`), and dynamic
  (`dv*`) viewport-percentage units, respectively "assuming any UA interfaces... to be
  expanded," "...to be retracted," and "with dynamic consideration of any UA
  interfaces." Status: Working Draft, 2024-03-12. Source:
  [w3.org/TR/css-values-4/#viewport-relative-lengths](https://www.w3.org/TR/css-values-4/#viewport-relative-lengths),
  accessed 2026-09-11. Safari has shipped these units since its 16.x releases and is
  still refining edge cases as of the most recent Safari notes checked: Safari 26.0's
  own release notes include a fix for `lvh`/`vh` sizing inside `SFSafariViewController`.
  Source:
  [webkit.org/blog/17333/webkit-features-in-safari-26-0/](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/),
  accessed 2026-09-11.

- **VERIFIED, WebKit — on-screen keyboard geometry.** WebKit has not adopted the
  VirtualKeyboard API or the `interactive-widget=resizes-content` viewport meta value;
  the relevant WebKit standards-positions tracking issue (#65) carries no committed
  position as of the access date. Practical implication in §6c.

- **VERIFIED, WebKit — pointer/hover media features and a historical caution.**
  `pointer`, `any-pointer`, and `hover` (`none` / `coarse` / `fine`) are the standard way
  to distinguish touch from a fine pointer; on an iPad with a paired trackpad, mouse, or
  Apple Pencil, the primary-input signal can be ambiguous. WebKit has historically had
  bugs in exactly this area — e.g.
  [bugs.webkit.org/show_bug.cgi?id=209292](https://bugs.webkit.org/show_bug.cgi?id=209292),
  "CSS hover and 'pointer: fine' media queries do not evaluate to true with iOS 13.4
  mouse support," accessed 2026-09-11.

- **VERIFIED, comparison platform — Android large-screen/foldable guidance** (a
  released, official first-party source for its own platform, cited only as a named
  comparison, never as a spec for Apple platforms). Android's own developer guidance:
  "adaptive apps... accommodate changes in the posture of foldable devices" and
  "replace layout components" rather than only stretching content; window size classes
  (compact/medium/expanded, plus large/extra-large for desktop-class widths) are
  explicitly "dynamic" and change "throughout the lifetime of your app" from
  orientation, multitasking, and folding; the Jetpack WindowManager library lets an app
  "avoid placing important content in the area of folds or hinges." Sources:
  [developer.android.com/develop/adaptive-apps/guides/get-started-with-adaptive-apps](https://developer.android.com/develop/adaptive-apps/guides/get-started-with-adaptive-apps)
  and
  [developer.android.com/develop/adaptive-apps/guides/foldables/learn-about-foldables](https://developer.android.com/develop/adaptive-apps/guides/foldables/learn-about-foldables),
  accessed 2026-09-11.

### 2c. Third-party reports or rumors (labelled; never treated as spec)

- **RUMOR, superseded.** The name "iPhone Fold" was pre-announcement rumor-site
  terminology, not an Apple name — e.g. MacRumors' "Apple's 2026 iPhone Fold Rumors:
  Crease-Free Design, Price, Launch Date and More" and similar outlets used it for the
  device Apple ultimately announced as "iPhone Duo" (§2a). Nothing in this document
  treats "iPhone Fold" as a real product name or as a design input; every capability
  statement below is keyed to the web platform, not to either name.

- **THIRD-PARTY COMMENTARY, not consulted as fact.** Unofficial developer material
  appeared after the announcement — for example a public GitHub repository packaging
  "agent skills for building iOS apps on iPhone Duo," and independent blog posts
  (dev.to, codiot.com, cmarix.com, iphoneduo.dev) paraphrasing Apple's own Tech Talk.
  None of these is cited for any factual claim in §2a; every native-API claim there is
  sourced only to the directly-fetched Apple Newsroom page and the directly-fetched
  Apple Developer Tech Talk.

- **RUMOR, moot.** Pre-announcement speculation (crease-free-hinge claims, sliding
  release-date guesses, alternate price ladders) is superseded by the official
  specifics in §2a and is not reproduced here — it carries no design obligation either
  way.

### 2d. Unknown

- Whether the native `ReservedRegions` / `ArrangementView` APIs — or any web-facing
  equivalent (a CSS environment variable, a JS API, anything) — will ever be exposed to
  Safari or `WKWebView` content on iPhone Duo or a future iPad. No source addresses this
  as of 2026-09-11; the only content retrieved is explicitly UIKit/SwiftUI-scoped
  (§2a).
- Whether Stage Manager, in the iPadOS version current at the access date, still
  supports extending (as opposed to only mirroring) to an external display. The one
  consumer-facing Apple Support page retrieved for iPadOS windowing
  (support.apple.com/en-us/125309) does not mention external displays at all.
- The exact version-by-browser support grid (not just the qualitative "limited
  availability" statement) for the Window Management API, the Presentation API's
  receiver role, and the VirtualKeyboard API. The data tables on MDN and caniuse could
  not be retrieved as text by the fetch tool used for this document; only their
  surrounding prose warnings came through.
- Whether Apple intends any dual-display "presenter/audience" pattern — of the kind a
  point-of-sale merchant/customer view needs — for iPhone Duo or iPad, at either the OS
  or the web-platform level. No roadmap statement was found either way.
- Whether the two un-fetchable Apple HIG pages (§1) contain guidance that would change
  any recommendation in this document. They are UNREAD by design; their content is
  unknown to this document, not silently assumed.

## 3. Design principle: capability, not device name

Apple's own adaptive-layout guidance for its newest and most layout-disruptive device is
explicit that native apps should query geometry and capability rather than check for a
device by name (§2a). This document adopts the same principle for the web POS client,
for a stronger reason than style: **a web page cannot reliably identify "iPhone Duo,"
"iPad," or any other specific device in the first place.** User-agent strings are
spoofable and every major browser vendor now discourages using them as a design input;
and per §2a, even an accurate device identification would carry no information about
fold state, hinge position, or reserved regions, because none of that native geometry
has a confirmed web equivalent (§2d).

The only inputs a UNICA v5 POS client can trust are the ones the browser itself computes
and re-computes on every layout pass: CSS viewport dimensions and orientation,
media-query capability signals (`pointer`, `hover`, `any-pointer`, `any-hover`,
`prefers-color-scheme`), `env(safe-area-inset-*)`, the small/large/dynamic viewport
units (§2b, §6b) — and, only where a browser actually implements them (currently: not
Safari; §2b, §5g), Device Posture and Viewport Segments.

Every layout rule in §4 and §5 is keyed to a **capability signal**, never to a device, a
screen-size guess, or a marketing name. This also keeps the design honest about the
platform's real ceiling: §5g documents, with sources, that a web app on iPadOS Safari
today cannot address a second physical display as a distinct rendering target — a fact
that would be easy to design around by mistake if the starting question were "what can
iPhone Duo/iPad do" rather than "what does this browser expose to this page."

## 4. Capability-based responsive matrix

All breakpoint values below are **PROPOSED** UNICA product choices, not Apple size-class
numbers — none were retrievable verbatim (§1), and §3 argues against keying to a device
class in the first place. The matrix is keyed to CSS-observable capability, and every
row's "never moves" column points to the enforcement detailed in §7.

| Capability signal (web-observable) | Layout mode | What moves | What never moves |
|---|---|---|---|
| Viewport inline-size below the client's own "compact" threshold | Compact single pane (§5a) | Column count, keypad width, whether secondary detail collapses into "Advanced details," staged-vs-scrolling flow | Order id, payer, amount, currency, merchant identity, paid/settlement state (§7) |
| Inline-size at or above "compact" but below "wide" | Regular single pane (§5b) | Card padding, secondary-info visibility, touch-target sizing | Same as above |
| Inline-size at or above "wide," landscape-ish aspect ratio | Wide two-pane / countertop (§5c, §8a) | Left/right split appears; both panes render simultaneously instead of staged | Same as above, plus: which pane shows the payer-facing content never changes which order it describes |
| `orientation: portrait` ↔ `orientation: landscape` flips, or a `resize` fires without a navigation/reload | Portrait/landscape re-flow (§5d) | Column arrangement, control placement, which breakpoint currently applies | Order id, amount, currency, payer, merchant, in-flight confirmation step, scroll/selection position (Apple's own stated Split View expectation, §2b) |
| Repeated `resize` events in a short window without navigation (Split View divider drag, Stage Manager window drag, on-screen keyboard opening/closing) | Mid-gesture resize (§5e, §6f) | Presentation only: reflow, sticky-element repositioning | Everything in the row above, plus: no submit/confirm call may ever originate from a resize handler (§7) |
| `env(safe-area-inset-*)` non-zero | Safe-area-aware chrome (§6a) | Padding/margin only | Logic, and the effective hit-testing area of controls relative to content |
| Small/large/dynamic viewport unit values diverge (browser chrome shows/hides) | Chrome-safe bottom bar (§6b) | Height of the reserved band holding the primary action button | The button's destination/handler and the order it acts on |
| `pointer: coarse` vs `pointer: fine`, `hover: hover` vs `hover: none` (possibly combined with `any-pointer`/`any-hover` for a paired trackpad or Apple Pencil) (§6d) | Touch- vs pointer-optimized affordances | Hit-target size; presence of a hover-revealed detail (e.g. a quote-breakdown tooltip, always also reachable by tap) | Confirmation requirement — a fine pointer never gets a lighter-weight confirm than touch |
| Visible viewport height drops sharply with no orientation change (on-screen keyboard opens; detected via the `VisualViewport` resize event, §6c) | Keyboard-safe layout | Bottom-fixed action bar repositions above the keyboard | The field's typed value, cursor position, and everything in row 4 |
| No standardized signal exists today, because Safari implements neither Device Posture nor Viewport Segments (§2b, §5g) | No fold/hinge-aware branch is built | — (nothing to move) | The entire mode is simply absent from what ships; if WebKit ever ships either API, the two segments would be a natural candidate for the wide two-pane split, but that is speculative (§9), not built |

## 5. Layout modes in detail

### 5a. Compact single pane

**PROPOSED.** Applies below the client's own compact threshold — an iPhone-class
viewport, a narrow Slide Over window, or one side of an uneven Split View. Single
column, staged flow (§8b): amount entry, confirm, status, receipt render as sequential
full-width steps rather than simultaneous panels. The numeric keypad runs full width;
the primary action button is fixed to the bottom, above the safe area (§6a) and, when
open, above the on-screen keyboard (§6c).

### 5b. Regular single pane

**PROPOSED.** A wider single column — e.g. an iPad in portrait, or a Split View pane
above the compact threshold — still one column, but with room for cards that separate
entry from detail (merchant identity, quote breakdown) without yet affording a
side-by-side split.

### 5c. Wide two-pane (iPad countertop)

**PROPOSED.** At or above the "wide" threshold in a landscape-ish aspect ratio, left and
right panes render simultaneously: left carries entry (number pad, cart/invoice, amount
controls), right carries merchant identity, currency/network, quote and fees, and
customer/payment state through to the receipt. See the full wireframe in §8a. Per §4,
switching into or out of this mode is a pure re-flow — no field in either pane is
re-fetched or reset by the transition.

### 5d. Portrait and landscape

**PROPOSED**, grounded in **VERIFIED** prior art (§2b). An iPad rotation is a live
resize/orientation event inside a running page, not a reload — the same continuity
Apple's own archived Split View guidance describes ("the user expects your app's state
and its navigation location... to be identical") applies here even though that specific
text was written about the Split View divider, not device rotation. The layout may
change column count and control placement; the order it is displaying may not change
identity, amount, currency, payer, or paid state (§7).

### 5e. Split View and Stage Manager

**VERIFIED capability, PROPOSED response.** Split View lets a user drag the POS window
to 1/3, 1/2, or 2/3 of the screen, and Apple's own archived guidance states a
multitasking app "must function correctly" at all three (§2b). Slide Over floats a
compact window above another app. Stage Manager's "Windowed Apps" (iPadOS 26, per
support.apple.com/en-us/125309) let a user freely resize and reposition a window. For a
web page, none of this is something the page itself controls or is even told about by
name — it only ever sees its own CSS viewport change size. The response is therefore
identical to §5d: react only to the viewport signals in §4, preserve everything §7
lists, and never assume the window is, or will remain, full-screen.

### 5f. External display

**VERIFIED, partial.** iPad hardware can mirror or extend its screen over AirPlay or a
wired video adapter — a long-standing, well-documented consumer capability (e.g. Keynote
on iPad presenting "on a separate display," support.apple.com guide, accessed
2026-09-11) — but this operates at the OS level on the device's single rendered output;
it is not a second browsing context a web page can address independently. Whether
Stage Manager in the current iPadOS additionally supports true window *extension* (a
different window on the external screen, not a mirror) to an external display was not
confirmed either way as of 2026-09-11 (§2d, §9). Practically, for a web POS client this
distinction does not matter: **a web page has no reliable, standards-based way to know
an external display is attached at all**, mirrored or extended (§5g elaborates why).

### 5g. Dual-display merchant/customer mode — verified iPadOS Safari capability

**This is the single most consequential capability boundary in this document, and it is
directly verified, not inferred.**

A web app **cannot**, today, open independent content on a second physical display
through iPadOS Safari. The evidence:

- The only standardized way for a web page to enumerate displays and place content on a
  specific one is the W3C Window Management API (`isExtended`, `getScreenDetails()`).
  It is a Working Draft (published 2026-09-08), implemented in Chromium-based browsers;
  MDN's own compatibility banner states the feature "does not work in some of the most
  widely-used browsers" (§2b). No source confirms a WebKit/Safari
  implementation, on iPadOS or otherwise, as of 2026-09-11.
- The only standardized way to *project* separate content to a second screen is the W3C
  Presentation API. It carries the same MDN "Limited availability" banner (§2b), and no
  source found confirms Safari support for either its controller or receiver role. The
  exact version-level grid could not be retrieved as text (§9).
- What **is** verified and available on iPad today is OS-level screen mirroring/output
  extension via AirPlay or a wired adapter (§5f) — but that duplicates or extends the
  single Safari-rendered viewport. The page itself has **no API to detect that mirroring
  is active**, **no API to render different content to the mirrored output**, and — per
  the two points above — **no reliable API to detect that a second screen exists at
  all**.

**Consequence, PROPOSED:** until a source demonstrates otherwise, a UNICA v5
merchant/customer dual-view must be built as either (a) two views of the *same* page and
the *same* single viewport — e.g. a merchant-controlled toggle that swaps which content
is currently foregrounded on the one screen the customer can also see — or (b) a
genuinely separate customer-facing session on a second physical device, reading the same
order through the backend rather than through any same-browser second-display API. It
must not be designed around `getScreenDetails()`, the Presentation API, or any assumption
that the page can tell whether it is being mirrored, because none of those are available
on iPadOS Safari, the platform verified above.

## 6. Platform mechanics

### 6a. Safe areas

**VERIFIED** mechanism (§2b): `env(safe-area-inset-top|right|bottom|left)`, activated by
`viewport-fit=cover` in the viewport meta tag. **PROPOSED** usage: apply the insets as
padding on the outermost layout container in every mode (§5a–§5c), never as a condition
that changes which fields are shown or how many. The countertop wireframe (§8a) reserves
inset-aware gutters on both panes so neither the keypad nor the receipt sits under a
rounded corner or, on iPhone Duo's outer display specifically, its camera cutout —
noting again that on the web this is handled generically via `safe-area-inset`, not via
the native hinge/camera reserved-region geometry described in §2a, because that native
API has no confirmed web equivalent (§2d, §6e).

### 6b. Dynamic viewport units and viewport changes

**VERIFIED** (§2b): `sv*`/`lv*`/`dv*` units, shipped in Safari's 16.x series and still
receiving refinements as of the Safari 26.0 notes checked. **PROPOSED**
implementation: size the outer app shell to `100dvh` with a `min-height: 100svh` floor,
so the layout never exceeds the smallest guaranteed visible height and shrinks
gracefully as browser chrome recedes — never bare `100vh`, which predates these units
and has historically mismatched Safari's real visible height. **PROPOSED** invariant: a
chrome-driven viewport resize must never move the primary action button out of the
visible area, and a brief post-resize dead zone on that button is the mitigation against
an accidental tap when it reappears.

### 6c. On-screen keyboard appearance

**VERIFIED absence** (§2b): WebKit has not adopted the VirtualKeyboard API or
`interactive-widget=resizes-content`; the relevant WebKit standards-positions issue (#65)
carries no committed position as of the access date. **PROPOSED** approach: listen for
the standard `VisualViewport` `resize` event and reposition the fixed bottom action bar
to sit at `visualViewport.height` while the keyboard is open, returning to the
`dvh`/`svh`-based layout on dismissal. This document did not separately re-verify the
exact Safari version in which `VisualViewport` itself became reliable — flagged in §9 as
an implementation risk to test, not a confirmed guarantee. No field may auto-submit on
keyboard dismissal or on the resize event it triggers (§7).

### 6d. Pointer and touch input

**VERIFIED** (§2b): `pointer`/`any-pointer`/`hover`/`any-hover` are the standard
capability signals, and WebKit has had real historical bugs distinguishing "coarse" from
"fine" input when a mouse is paired with a touch device (bugs.webkit.org#209292).
**PROPOSED** product rule, motivated directly by that verified unreliability: every
payment-confirmation step requires the same explicit tap/click regardless of `pointer`
or `hover` values. Pointer type may resize hit targets or reveal a hover affordance; it
may never change how much confirmation a payment needs.

### 6e. Display cutouts, hinges, and occlusion regions

Recap of §2a/§2d: iPhone Duo's hinge and camera cutouts are exposed to **native** apps
as reserved/division regions; no web equivalent has been found as of 2026-09-11. **PROPOSED**:
the web client treats iPhone Duo — and any future device Safari runs on — as an ordinary
rectangle described only by `env(safe-area-inset-*)` (§6a). It does not attempt
hinge-aware content placement, because it has no verified way to detect a hinge at all.
If Safari ever ships Viewport Segments or Device Posture (§2b), that would be additive;
nothing in §4's shipped matrix or §8's wireframes depends on either existing.

### 6f. Window resizing during payment

**VERIFIED prior art** (§2b): Apple's own archived Split View guidance states that a
resize-in-progress must not disturb an app's state or navigation position.
**PROPOSED** enforcement for a web client: order/session state lives in a store outside
the component render tree, keyed by the order id UNICA v4's contracts already assign at
creation — `orderId = keccak256(abi.encode(block.chainid, executor, creator, salt))`,
per `docs/unica-v4/SPEC-CONTRACTS.md`. A resize, orientation-change, or `matchMedia`
handler may only re-read from that store and re-render; it may never write to it, and it
may never call the pay/confirm action. This mirrors — rather than replaces — the
protocol-level guarantee already in place: even if a client bug did fire a second
submission, the `pay(bytes32 orderId)` guard sequence in
`UnicaStockSettlementExecutor.pay` checks the order is `Open` and `msg.sender ==
order.payer` before doing anything else (`WrongPayer(id, payer, caller)` otherwise), per
`docs/unica-v4/SPEC-CONTRACTS.md`. The UI-level rule exists so that a bad call is never
attempted in the first place, not because the contract would fail to reject it.

### 6g. Session continuity across layout changes

**PROPOSED**: the order id is the single stable key across every layout mode in §4/§5. A
*full* reload (as opposed to a resize) re-fetches order state from the same source of
truth rather than trusting anything cached from before the reload — consistent with the
UNICA v4 fact that "'Paid' exists only when the settlement event and receipt are read
back from the chain," which this document re-grounds in `docs/unica-v4/SPEC-CONTRACTS.md`
and `docs/RECEIPT-SCHEMA.md`. No screen, layout mode, or client-side cache may assert
"paid" on its own.

## 7. Transition invariants

Every invariant below is enforced **twice** — once by not building a view-layer code
path that could violate it, and independently by the UNICA v4 contract layer refusing
the violation if the view layer ever attempted it anyway. This document owns only the
first half; the second half is already specified in the cited v4 files and is out of
this document's scope to redesign.

- **Never resets an order.** The order id is assigned once, at creation, to a named
  payer (`docs/unica-v4/DECISIONS.md` Q128) and held in app-level state keyed by that
  id. A layout re-render never re-runs order creation.
- **Never changes amount, currency, merchant, or payer.** These are immutable
  properties of the fetched order record; the view layer has read-only access. UNICA v4
  has no in-protocol amendment path for them at all — an order is "exact-input and
  full-fill only" (`docs/unica-v4/V5-DEFERRED.md` §5, quoting `DECISIONS.md` Rec 41–43:
  "no refunds, subscriptions or partial payments in v4") — so there is no contract-level
  path a layout bug could accidentally trigger even in the worst case.
- **Never triggers payment.** The only call site for the pay/confirm action is a single,
  explicit, user-initiated event handler. Resize, orientation-change, focus,
  `matchMedia`, and visibility-change handlers are structurally forbidden from calling
  it — a code-review rule this document proposes, not yet built into any lint tooling.
- **Never repeats authorization.** The confirm control disables itself on first
  invocation client-side; independently, `pay` checks the order is `Open` and moves it
  to `Paying` before any external call (`docs/unica-v4/SPEC-CONTRACTS.md`, the
  `pay(bytes32 orderId)` sequence), so a duplicate call lands on a non-`Open` order and
  is rejected outright rather than silently re-run.
- **Never duplicates settlement.** Backed by the same guard table
  (`OrderNotOpen`/`OrderAlreadySwapped`/`NoReceipt` in `docs/unica-v4/SPEC-CONTRACTS.md`)
  plus the UI rule in §6g that "paid" is only ever set from a chain read-back — a layout
  change cannot manufacture a paid state locally, and even if it tried, the contract
  layer would not confirm it.

**Note on scope:** UNICA v5's own public-payment-link mode (an order not payer-bound at
creation) is explicitly out of scope for any of the above to be reused as-is. Per
`docs/unica-v4/V5-DEFERRED.md` §8, quoting `DECISIONS.md` Q128: "v4 uses payer-bound
orders only. Public payment links move to v5, behind a separate signed-intent security
review that starts with Advisory 001" (`docs/v2/SECURITY-ADVISORY-001.md`, which found
that a payer's signed witness alone does not bind the merchant's half of a deal — the
recipient, signer, output token, amount, pool, and deadline all fell outside it in the
audited v2 executor). This document's transition invariants assume a payer-bound order
exactly as UNICA v4 defines one; they do not, and cannot yet, extend to a hypothetical
unbound public link until that review exists.

## 8. Text-only wireframes

### 8a. Wide iPad countertop layout

```
┌─────────────────────────────────────────┬─────────────────────────────────────────┐
│ LEFT PANE — entry                        │ RIGHT PANE — identity, quote, status     │
│ safe-area-inset-left applied (§6a)       │ safe-area-inset-right applied (§6a)      │
│                                           │                                           │
│ ┌───────────────────────────────────────┐│ ┌───────────────────────────────────────┐│
│ │ Cart / invoice                         ││ │ Merchant identity                      ││
│ │  - item      qty   price               ││ │  (resolved address shown before        ││
│ │  - item      qty   price               ││ │   payment, per ENS resolution)         ││
│ │  Subtotal                              ││ └───────────────────────────────────────┘│
│ └───────────────────────────────────────┘│ ┌───────────────────────────────────────┐│
│ ┌───────────────────────────────────────┐│ │ Test mode / Mainnet badge              ││
│ │ Amount controls   [ + ] [ - ]  custom  ││ │ (always visible) · chain / network     ││
│ └───────────────────────────────────────┘│ └───────────────────────────────────────┘│
│ ┌───────────────────────────────────────┐│ ┌───────────────────────────────────────┐│
│ │        NUMBER PAD                      ││ │ Payment details (quote transparency)   ││
│ │   1     2     3                        ││ │  quote · fees · minOut                 ││
│ │   4     5     6                        ││ │  ▸ Advanced details (collapsed):       ││
│ │   7     8     9                        ││ │    pool id, hooks, ticks, raw units    ││
│ │   .     0     ⌫                        ││ └───────────────────────────────────────┘│
│ └───────────────────────────────────────┘│ ┌───────────────────────────────────────┐│
│ ┌───────────────────────────────────────┐│ │ Customer / payment state:              ││
│ │ [   CONFIRM / CHARGE   $X.XX          ]││ │  Waiting for payer → Paying → Paid     ││
│ │  single explicit handler only (§7)     ││ │  ("Paid" set only from chain read-back,││
│ └───────────────────────────────────────┘│ │   never set locally — §6g)             ││
│                                           │ └───────────────────────────────────────┘│
│                                           │ ┌───────────────────────────────────────┐│
│                                           │ │ Receipt (explorer-proof style,         ││
│                                           │ │  read-only, appears after settlement)  ││
│                                           │ └───────────────────────────────────────┘│
└─────────────────────────────────────────┴─────────────────────────────────────────┘
     ← never move across a layout transition: order id, amount, currency, merchant,
                          payer, paid/settlement state (§7) →
```

### 8b. Compact staged flow

```
 Stage 1 — Amount              Stage 2 — Confirm              Stage 3 — Status/Receipt
┌───────────────────────┐     ┌───────────────────────┐     ┌───────────────────────┐
│ Merchant identity      │     │ Merchant identity      │     │ Test mode / Mainnet   │
│ Test mode / Mainnet    │ →   │ Test mode / Mainnet    │ →   │ badge                 │
│ badge (always visible) │     │ badge                  │     │                       │
│                        │     │                        │     │ Waiting… / Paying… /  │
│ Cart / invoice summary │     │ Payment details:        │     │ Paid                  │
│                        │     │  quote · fees           │     │ ("Paid" only from     │
│ Amount controls        │     │  ▸ Advanced details     │     │  chain read-back,     │
│ Number pad             │     │    (collapsed)          │     │  §6g)                 │
│                        │     │                        │     │                       │
│ [ Next ]               │     │ [ Confirm / Charge ]   │     │ Receipt               │
│                        │     │  single explicit        │     │                       │
│                        │     │  handler only (§7)      │     │ [ Done / New order ]  │
└───────────────────────┘     └───────────────────────┘     └───────────────────────┘
   Single column, one stage visible at a time. The on-screen keyboard (§6c) only ever
   occupies Stage 1. Moving back or forward between stages re-reads the same order id
   from the store (§6f, §6g) — it never re-creates or re-authorizes the order.
```

## 9. Uncertainties

- **Two Apple HIG pages could not be read.** `developer.apple.com/design/human-interface-guidelines/layout`
  and `developer.apple.com/documentation/uikit/multitasking-on-ipad` render client-side;
  the fetch tool returned only their page titles on both the first attempt and a retry.
  They are marked UNREAD (§1) and nothing here is attributed to them. If they contain
  guidance that contradicts anything above, this document does not yet know it.
- **No exact browser-version compatibility grids.** For the Window Management API, the
  Presentation API, and the VirtualKeyboard API, only qualitative MDN/WebKit statements
  ("limited availability," "no committed position," open tracking issues) could be
  retrieved as text — not the underlying version-by-browser tables on MDN/caniuse. The
  qualitative signal is treated as sufficient to say "not safely usable on iPadOS Safari
  today" (§5g), but not sufficient to name a specific version number either way.
- **Stage Manager + external display, current status, unresolved.** The one consumer
  Apple Support page fetched for iPadOS windowing does not mention external displays;
  that silence is not proof either that the capability was removed or that it persists
  in the current OS version. No dedicated current-year Apple source on this point was
  located as of 2026-09-11.
- **VisualViewport reliability inside Stage Manager windowed mode was not
  separately tested or sourced.** §6c proposes it as the on-screen-keyboard mechanism on
  the strength of its general, long-standing Safari support; this document did not
  verify it specifically inside a resizable Stage Manager window.
- **No Apple URL is cited anywhere in this document.** Every Apple source here was
  independently found via search and direct fetch (§1). If the owner had a specific
  Apple reference in mind, it was not consulted, and none is assumed.
- **The "iPhone Duo" reporting sits at the edge of what can be verified independently
  here.** The Apple Newsroom announcement and the Apple Developer Tech Talk
  were each fetched directly and are corroborated by multiple independent news outlets
  returned in search (CNN, TechCrunch, MacRumors, NBC News, CNBC) reporting the same
  name, specs, event name, and dates. That corroboration reduces, but does not fully
  eliminate, the possibility of an error somewhere upstream of the fetch tool used here.
- **Whether any UNICA v5 dual-display merchant/customer feature is even planned is not
  decided anywhere in the UNICA v4 facts or in owner guidance on record as of
  2026-09-11.** §5g's conclusion is a description of a capability ceiling on the platform, not
  a scoped product commitment, and should not be read as one.
- **The exact PROPOSED pixel/CSS breakpoint values in §4 are placeholders for the
  pattern, not a frozen number.** No verified Apple size-class number could be sourced
  (§1), and §3 argues the client should not key off one even if it could be sourced; the
  actual thresholds are an implementation decision still open to the team building
  against this document.
