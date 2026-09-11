# UNICA v5 POS — synthesis

Research draft for owner review. Not committed. Authorizes nothing. UNICA v5 scope; it
does not change or delay the UNICA v4 merge review.

This file synthesizes six sibling documents in this directory. It edits none of them.
Where they disagree, §"Conflicts between the source documents" below states the
disagreement and does not resolve it. Every "owner decision" surfaced by any of the six
is consolidated in `OPEN-QUESTIONS.md`, not answered here.

Statement classes used throughout, matching the six source documents: **VERIFIED**
(an official source or the UNICA v4 contract specification is cited and was read),
**PROPOSED** (a UNICA product-design choice, not fixed by any ledger item), **UNKNOWN**
(neither confirmed nor safely inferred).

## File index

| File | Scope |
|---|---|
| `POS-FLOWS.md` | The merchant/customer countertop workflow — screens, sequencing, the payer-binding confirmation boundary, and failure paths — built on the UNICA v4 contract specification. |
| `THEMES.md` | The three-theme visual design-token system (Tactile POS, Clear modern, Merchant-branded) and the rules that keep a theme from ever changing payment meaning. |
| `ACCESSIBILITY.md` | Every contrast ratio behind `THEMES.md`, computed 2026-09-11 with the WCAG relative-luminance formula; focus/keyboard/screen-reader semantics; platform-preference mapping; the WCAG 2.2 checklist. |
| `ADAPTIVE-LAYOUT.md` | Viewport, breakpoint, safe-area, and foldable/dual-screen mechanics; the "iPhone Duo" investigation; the capability-based responsive matrix. |
| `PRIVY-DEVICE-MODEL.md` | Privy's verified capabilities; the six-concept/six-credential model; the UNICA role/permission matrix; the shared-device threat model; the lost/stolen-device procedure. |
| `HARDWARE-OPTIONS.md` | The four terminal-hardware options (bring-your-own, PWA+Guided Access, UNICA-managed tablet, custom hardware); card-reader certification landscape; the beta recommendation. |

## Synthesis

### 1. Recommended default theme

**Clear modern (Theme B) is the accessibility-first default for every new merchant and
every countertop tablet profile.** Tactile POS and Merchant-branded are opt-in per
merchant, never opt-in per payer — a payer completing a charge never has to learn a
decorative metaphor the merchant chose. Clear modern uses flat fills plus a
`--border-strong` color boundary rather than a shadow illusion, so it has no non-text-
contrast problem by construction, and needs no forced-colors/reduced-transparency
fallback beyond what any bordered flat design already needs.
(`THEMES.md` §3b, §4)

### 2. Tactile POS theme specification

Restrained skeuomorphism/neumorphism — a raised number pad, a recessed amount-display
tray, register-inspired button geometry, a receipt-paper treatment on the
success/receipt screen, status lamps, and a ≤150ms tactile press animation (skipped
under reduced motion) — built on a two-shadow model over a `--surface-tactile` fill
deliberately close in lightness to the page canvas. Because that surface's own
flat-color contrast against the canvas computed to only 1.06:1 (light) / 1.20:1 (dark)
— far under the WCAG 3:1 non-text floor — every interactive or stateful neumorphic
element must also carry a `--border-strong` edge (computed at 3.60:1 / 3.78:1), and the
shadow layer must be dropped entirely under `forced-colors: active`,
`prefers-contrast: more`, or `prefers-reduced-transparency: reduce`.
(`THEMES.md` §3a, §6; `ACCESSIBILITY.md` §5)

### 3. Theme safety boundaries

One shared component contract and one shared token set drive all three themes. A theme
substitutes token values and an elevation model; it never changes what a control does,
what it is allowed to say, or the confirmation an irreversible action requires.
Payment-state colors (success/warning/failure), the testnet/mainnet badge, security
warnings, and every amount/currency/merchant/network/fee/payout string are never
brand-overridable. A Merchant-branded theme may supply only an accent hue for links and
the primary-button fill, re-derived and re-checked by the contrast script before it is
accepted for either light or dark mode.
(`THEMES.md` §3c, §4, §5, §13)

### 4. Merchant and customer workflows

Fifteen states from merchant sign-in through shift-close reconciliation, built around
two separate signatures: an allowlisted **order creator** signs order creation (state-
changing, gas-paying, but moves no funds), while only the exact address named `payer`
at creation may sign `pay(orderId)` — every other caller reverts `WrongPayer`. Because
`payer` cannot be supplied or changed after creation, the original 15-step
numbering is corrected: address capture (7a, no signature) is resequenced ahead of
order creation (6), with a full signing session (7b) established afterward if not
already open.
(`POS-FLOWS.md` §3, §4, §7)

### 5. iPad countertop layout

A wide, landscape two-pane layout — left pane for entry (number pad, cart/invoice,
amount controls), right pane for merchant identity, currency/network badges, the live
quote under "Payment details," and customer/payment state through to the receipt —
borrows Stripe Dashboard's left-navigation/content-pane split and Uniswap's
"you pay / minimum received / advanced details" quote-transparency pattern as
interaction references only, never their branding or exact composition. Switching into
or out of this mode is a pure re-flow: no field in either pane is re-fetched or reset
by the transition.
(`POS-FLOWS.md` §5; `ADAPTIVE-LAYOUT.md` §5c, §8a)

### 6. Compact and two-pane layouts

Layout mode is keyed to CSS-observable capability signals — viewport inline-size,
orientation, `pointer`/`hover`/`any-pointer`/`any-hover` — never to a device name or a
guessed screen size, because a web page cannot reliably identify a specific device and
no native fold/hinge geometry has a confirmed web equivalent. A narrower device stages
the same content as a single column, top-to-bottom, in the wide layout's own
left-to-right-then-top-to-bottom reading order, so a merchant moving between an iPad
and a phone never loses context. The specific breakpoint pixel values are PROPOSED
placeholders for the pattern, not sourced Apple size-class numbers.
(`ADAPTIVE-LAYOUT.md` §3, §4, §5a–§5b, §8b)

### 7. Foldable/dual-screen capability model

The single most consequential platform finding in this synthesis: **iPadOS Safari has
no standards-based way to enumerate a second display or address it as a distinct
rendering target today.** The Window Management API and the Presentation API are both
unimplemented in WebKit (per MDN's own "limited availability" banners and open WebKit
tracking issues); OS-level screen mirroring/extension exists at the hardware level, but
a web page has no API to detect it, let alone render different content to it. A future
dual merchant/customer view must therefore be built as either one page toggling what is
shown on one shared screen, or a genuinely separate customer-facing session on a second
physical device reading the same order through the backend.
(`ADAPTIVE-LAYOUT.md` §5g)

### 8. Official-versus-rumored Apple findings

The shipping foldable device is Apple's own **"iPhone Duo"** (Apple Newsroom, announced
2026-09-09; inner display 7.6", outer 5.4"; A20 Pro; starts at $1,999; pre-orders open
2026-10-16; availability 2026-10-23) — **not** "iPhone Fold," which was pre-announcement
rumor-site terminology never used by Apple. As of the access date the device is
officially announced but **not yet shipped**. Apple has published its own adaptive-
layout API for it (`ReservedRegions`, `ArrangementView` / `UIArrangementViewController`)
— verified from an Apple Developer Tech Talk transcript — but that API surface is
**native-only**: the fetched transcript contains no reference to Safari, WebKit, or any
web API, and no source found extends it to the web platform.
(`ADAPTIVE-LAYOUT.md` §2a, §2c, §2d)

### 9. Privy authentication and terminal model

Privy remains conditional for UNICA: no account, app id, or server secret exists today.
Six distinct concepts each carry their own credential and blast radius (dashboard
sign-in, operating a terminal, creating an order, customer payment authorization,
administering settlement contracts, controlling the payout wallet). Only concept 4 —
the payer's own payment authorization — is the Privy-relevant, wallet-holding action,
and it belongs to the customer alone, never to staff. "Operating a terminal" is
proposed as a plain UNICA staff-account concept with no wallet attached, deliberately
separate from any Privy embedded-wallet identity, so that none of Privy's key-custody,
export, or recovery surface ever needs to apply to a countertop device.
(`PRIVY-DEVICE-MODEL.md` §1, §2, §3.15)

### 10. Role and permission matrix

Four roles — business owner, store manager, cashier, read-only accountant — mapped
against the six concepts. The standing rule, restated because it is the one most likely
broken by a convenience shortcut: **the cashier never automatically gains** Safe
ownership, contract administration, withdrawal authority, payout-address changes,
market unpause/retire authority, or wallet export/recovery control. Granting any of
those to a cashier "to cover a shift" collapses the entire separation the design argues
for.
(`PRIVY-DEVICE-MODEL.md` §4)

### 11. Lost/stolen-device procedure

Six steps: (1) disable the affected staff account in UNICA's own backend/role table
first — this is what actually revokes access, independent of the Privy token's own
remaining one-hour validity; (2) trigger MDM/EMM remote lock and wipe if the device is
hardware option C or D; (3) accept a materially weaker recovery path for option A/B,
where no remote-wipe path is documented for either Guided Access or a browser PWA;
(4) there is nothing wallet-side to rotate, because no private key should ever have
been on the device; (5) record the incident (device id, time window, role disabled,
whether an order was created — checkable on-chain); (6) re-provision from a clean
image or fresh browser profile, never from a backup of the lost device.
(`PRIVY-DEVICE-MODEL.md` §6)

### 12. Dedicated hardware comparison

Four options compared on security, device management, updates, support burden, cost,
compliance groundwork, repair, remote wipe, app distribution, and card-reader
certification relevance: (A) bring-your-own iPad in a general browser — weakest,
$0 incremental cost, no remote wipe; (B) the same device with an installed PWA in
Guided Access — modestly better containment, still no MDM and no remote wipe;
(C) a UNICA-procured, supervised, MDM-enrolled tablet — the first option with a real
remote-wipe and audit-trail story; (D) custom POS hardware — potentially strongest in
principle, unevaluated in practice, and not recommended for the initial beta. None of
the PCI PTS/DSS/MPoC or EMVCo card-reader certifications apply to UNICA's current
design, because v4 settles a payer's signed on-chain authorization, not a card swipe.
(`HARDWARE-OPTIONS.md` §2–§3, §7–§9)

### 13. Accessibility checklist

Every contrast ratio behind `THEMES.md` was computed by a script implementing the WCAG
relative-luminance formula, computed 2026-09-11 and run twice — a first draft that failed two token
choices (a dark-mode button-label pairing, and two escalating hairline-border attempts),
and the corrected run that replaced them with values verified to clear their floor with
real margin, not rounded up against it. Fourteen WCAG 2.2 success criteria are mapped
to exactly where each is addressed; several (Resize Text, Reflow, Text Spacing, Content
on Hover or Focus) are marked PROPOSED and explicitly not yet tested, because no build
exists to test them against.
(`ACCESSIBILITY.md` §2, §4, §5, §12)

### 14. Threat model

Privy's own threat-model documentation explicitly does not cover shared or multi-user
physical devices — a correctly configured Privy application is therefore **not, by
itself, evidence that a shared POS tablet is safe**. Ten threat rows cover shoulder-
surfing of a passcode, autofill resuming a prior staff session, unauthorized order
creation on an unattended unlocked terminal, a cashier attempting to intercept the
payer's own authorization (already refused on-chain by `WrongPayer`, independent of
this threat model), clipboard/screen leakage, physical theft, a malicious browser
extension, an accidental wallet-export flow, prior-customer data left on screen, and
session fixation via a crafted deep link.
(`PRIVY-DEVICE-MODEL.md` §5)

### 15. Text-only wireframes (index)

- `POS-FLOWS.md` §7 — fifteen state-by-state ASCII wireframes, sign-in through
  shift-close reconciliation, plus offline/paused/stale-oracle refusal states.
- `THEMES.md` §11 — ten payer-facing screen descriptions at the shared token level
  (amount entry, confirmation, processing, success/receipt, failure, paused, oracle
  stale, wrong network, wrong payer, testnet demonstration).
- `ADAPTIVE-LAYOUT.md` §8 — the wide iPad countertop two-pane layout and the compact
  three-stage flow.

None of these have been rendered, screen-reader-tested, or run on an actual countertop
tablet; all three source files say so directly in their own uncertainty sections.

### 16. Items requiring owner decisions

Sixteen decisions, consolidated with options and a recommended default in
`OPEN-QUESTIONS.md`, blocking ones first. They span: whether `recipient` should ever be
bound to an on-chain merchant record; when (if ever) the UNICA v5 signed-intent
security review should start; whether to ever configure a real Privy application or
enable its server-side wallet-export capability; where the order-creator key should
live; which hardware option to run the beta on and when to move to option C; whether to
pursue option D at all; whether to ratify the proposed role/permission matrix; and
several smaller product-definition and threshold questions. See that file for the full
list — it is not repeated here.

### 17. Implementable now versus dependent on future products or APIs

| Item | Status | Reason |
|---|---|---|
| Clear modern theme, its tokens, and the ten payer-facing screens | NOW | A CSS/HTML token layer already supported in Safari today; no v4 contract or Privy dependency (`THEMES.md` §3b, §5) |
| Tactile POS theme, including its forced-colors/reduced-transparency fallback | NOW | Same — a decorative token/CSS layer only, with a specified (not yet built) fallback rule (`THEMES.md` §3a, §6) |
| Compact / regular / wide two-pane responsive layout | NOW | Keyed to CSS viewport and media-query capability signals already supported by Safari (`ADAPTIVE-LAYOUT.md` §3, §4) |
| Merchant sign-in, device enrollment, store/terminal selection | NEEDS PRIVY ACCOUNT | Off-chain; this design assumes but does not require Privy specifically, and no UNICA Privy account, app id, or server secret exists today (`POS-FLOWS.md` §7 steps 1–3; `PRIVY-DEVICE-MODEL.md` §1) |
| Order creation, the payer-bound `pay(orderId)` flow, the chain-read review screen | NEEDS v4 FROZEN INTERFACES | Depends on a deployed executor's `createOrder`/`pay` ABI and event shape being frozen for a real (non-46630-fixture) market (`POS-FLOWS.md` §7 steps 6–8) |
| Shift-close reconciliation sourced from an indexer | NEEDS v4 FROZEN INTERFACES | Depends on whether The Graph indexes the target chain (UNKNOWN per `EVENT-SCHEMA.md`'s own admission); falls back to a bounded RPC scan, unverified at real order volume (`POS-FLOWS.md` §7 step 14, §12 U2) |
| Staff role/permission enforcement and the lost/stolen-device procedure | NEEDS PRIVY ACCOUNT | The procedure assumes UNICA's own backend maps a verified access token to a role — untestable without an actual Privy app id and server secret (`PRIVY-DEVICE-MODEL.md` §3.11, §6, §10) |
| Public payment links / an unbound-payer checkout | NEEDS v5 SIGNED-INTENT REVIEW | Explicitly gated behind a security review starting from Advisory 001; no screen in any of these six documents designs this flow (`POS-FLOWS.md` §8; `THEMES.md` §2) |
| A dual physical merchant/customer display | NEEDS FUTURE PLATFORM API | iPadOS Safari has no standards-based way to address a second display today (`ADAPTIVE-LAYOUT.md` §5g) |
| Fold/hinge-aware layout branching | NEEDS FUTURE PLATFORM API | Safari implements neither the Device Posture API nor Viewport Segments as of the access date (`ADAPTIVE-LAYOUT.md` §2b, §6e) |
| A managed/supervised tablet fleet (hardware option C) | NEEDS FUTURE PLATFORM API / vendor decision | Requires an MDM/EMM enrollment and a vendor selection not yet made (`HARDWARE-OPTIONS.md` §5, §9, §11) |
| Custom POS hardware (option D) | NEEDS FUTURE PLATFORM API / not recommended | Requires its own PCI PTS and EMVCo certification plus a separate operational, legal, support, and security review; not recommended for the initial beta (`HARDWARE-OPTIONS.md` §6, §9) |

## Recommendation

**Clear modern as the default, accessibility-first theme is well supported by the
evidence gathered.** It needs no shadow-boundary workaround, clears every computed
contrast floor with comfortable margin (`THEMES.md` §12; `ACCESSIBILITY.md` §4), and
needs no `forced-colors`/`prefers-reduced-transparency` fallback beyond what any flat-
fill-plus-border design already requires.

**Tactile POS as an optional, per-merchant, restrained skin is supportable on the same
evidence — provided the one governing rule is actually implemented, not only
specified.** `THEMES.md` §6/§13 and `ACCESSIBILITY.md` §5 are explicit that the
neumorphic surface's own flat-color contrast (1.06:1 light / 1.20:1 dark) fails the
WCAG 3:1 non-text floor by a wide margin on its own; every element that carries meaning
must also carry a `--border-strong` edge, and the shadow layer must be dropped outright
under `forced-colors`, `prefers-contrast: more`, and `prefers-reduced-transparency:
reduce`. This is a specified rule, not yet a built or tested control (`THEMES.md` §15;
`ACCESSIBILITY.md` §14).

**Identical information architecture and security behaviour across all three themes
holds by design.** The same screens, in the same order, reachable by the same events;
the same confirmation requirements for an irreversible action; the same non-brand-
overridable payment-state colors, testnet badge, and security warnings in every theme
(`THEMES.md` §3–§4, §13). No source document proposes any theme-dependent difference in
what a screen is allowed to say or require, and none is proposed here.

The caveat every one of the six source documents states about itself applies equally
here: **none of this has been rendered, screen-reader-tested, or run on an actual
countertop tablet.** The recommendation is sound against the specified token values and
component contract; it is not yet proven against a build.

## Conflicts between the source documents

Two numeric/factual contradictions were found between sibling documents in this
directory. Both are now corrected in the source documents; the history is kept below
rather than deleted.

1. **Which status color has the narrowest contrast margin in light mode — corrected.**
   `THEMES.md` §12 originally stated "light warning is the tightest at 6.50:1," which did
   not match `ACCESSIBILITY.md` §4a's own computed table, where `--status-success` was
   tighter. Independently recomputed 2026-09-11 with the WCAG relative-luminance formula
   (control-validated against black-on-white = 21.00 and identical colours = 1.00): in
   the light theme, `--status-success` on `--bg-canvas` is **4.66:1** — the tightest
   pairing in the entire light-theme table — `--status-warning` is **6.50:1**, and
   `--status-danger` is **5.93:1**. Among text pairings specifically, the tightest is
   `--text-secondary` on light `--bg-canvas` at **6.21:1**. `THEMES.md` §12 and
   `ACCESSIBILITY.md` §4a now agree on this table.

2. **Whether the $100 total-at-risk beta cap is enforced on-chain — corrected.**
   `THEMES.md` §2 originally treated all three beta-cap figures — $10 per transaction, $25
   per day, $100 total at risk — as one on-chain-enforced set, while `POS-FLOWS.md` F11
   drew a distinction `THEMES.md` did not. Both now state the same distinction: **$10 per
   transaction and $25 per day are enforced on-chain, per market; the $100 total at risk
   across markets is a deployment-script and manifest refusal — an operational gate, not
   an on-chain invariant.** `THEMES.md` §2 and `POS-FLOWS.md` F11 now agree.

## Unresolved uncertainties

Merged from each source document's own uncertainties section; not resolved here.

**From `POS-FLOWS.md` §12:** whether chain 46630 has a fallback RPC endpoint for the
offline-state design is UNKNOWN (out of scope here); whether The Graph
indexes chain 46630 is itself UNKNOWN per `EVENT-SCHEMA.md`'s own admission, and the
bounded-RPC-scan fallback's real-world performance at volume was not measured; whether
any wallet will ever clear-sign the specific `pay(bytes32)` call is UNKNOWN (step 8
assumes conservatively that none will); a merchant-name-resolution service for the
review screen is an undesigned open v5 product question; two external sources
(Coinbase Commerce, Safe's own docs page) are UNREAD and no claim depends on them; the
exact countertop deadline window (2–5 minutes proposed) and the definition of "selecting
the requested settlement currency" were not confirmed with the owner; real-device
ergonomics were not verified against any build.

**From `THEMES.md` §15 and `ACCESSIBILITY.md` §14:** no build of any screen exists —
every contrast/focus/screen-reader claim is checked against specified token values, not
a rendered artifact; the Apple HIG Color/Typography/Layout pages were unreadable
(client-rendered) as of 2026-09-11, so the commonly cited 44×44pt touch target and any
Apple-specific Dynamic Type numbers are UNKNOWN by direct read, not assumed; whether
`navigator.vibrate()` works on current iPadOS Safari is unresolved (official MDN data
says no, one open/untriaged community report says conditionally yes); the WebKit
audio-autoplay source verified documents `<video>` specifically, and its extension to a
standalone `<audio>` element is this file's own PROPOSED inference; `prefers-reduced-
transparency`'s exact per-browser support table did not render, only MDN's qualitative
note did; SC 1.4.4/1.4.10/1.4.12 are stated intentions, not measured outcomes; the
merchant-brand accent-hue re-check at publish time is a specified process, not an
implemented control.

**From `ADAPTIVE-LAYOUT.md` §9:** two Apple Developer pages (HIG Layout,
multitasking-on-iPad) could not be read (client-rendered) and nothing here is
attributed to them; exact browser-version compatibility grids for the Window
Management, Presentation, and VirtualKeyboard APIs could not be retrieved as text,
only qualitative statements; whether Stage Manager in the current iPadOS still supports
true external-display window extension (versus only mirroring) was not confirmed
either way; `VisualViewport` reliability specifically inside a resizable Stage Manager
window was not separately tested; the "iPhone Duo" reporting is corroborated by
multiple independent outlets but that reduces rather than eliminates the chance of an
upstream error; whether any UNICA v5 dual-display feature is actually planned is
undecided in any source reviewed as of 2026-09-11; the PROPOSED breakpoint values are
placeholders for the pattern, not a frozen number.

**From `PRIVY-DEVICE-MODEL.md` §10:** the exact key-share count and reconstruction
threshold (2-of-2 versus a described 3-share recovery model) is described
inconsistently across Privy's own pages and is not reconciled; whether Privy's
embedded wallet ever exposes a BIP-39 seed phrase via an optional HD-wallets feature
was not checked; the transaction-confirmation UI's exact content and customizability
was not documented in any page fetched; whether Privy exposes a per-end-user "your
devices" list with individual revocation is unconfirmed; whether the Dashboard exposes
a per-end-user audit log is unconfirmed; whether an administrator can force-revoke one
specific ordinary (non-delegated) browser session remotely is unconfirmed — only the
delegated/server-session `revokeWallets` path was verified, which materially weakens
the lost-device procedure's reliance on "remote logout" unless later confirmed; three
guessed Privy URLs 404'd and the equivalent current pages were sourced via search-index
excerpt rather than a raw fetch for roughly a dozen facts, and should be re-confirmed
against a live session before configuring an actual Privy application; this document
did not check its own role matrix and threat model for consistency against the sibling
POS-FLOWS/THEMES/ACCESSIBILITY/ADAPTIVE-LAYOUT files beyond confirming they were present
and unedited.

**From `HARDWARE-OPTIONS.md` §11:** Apple's own OS-update-deferral mechanism under
supervision/MDM was not independently fetched (only Android's equivalent "freeze OTA"
capability was confirmed directly) — do not assume parity between platforms; all
hardware and MDM/EMM per-device cost figures are unsourced order-of-magnitude
placeholders, not vendor quotes; PCI MPoC's detailed requirement count and EMVCo's
Level 1/Level 2 mechanics were read from third-party payments-industry summaries, not
the PCI Council's or EMVCo's own primary documents beyond one Council overview page; no
specific MDM/EMM vendor and no hardware vendor/BOM/firmware for option D was evaluated;
whether option C's app-distribution mechanism would be Apple's VPP-style distribution
or Android's managed Google Play was not independently verified against either
platform's own current developer docs; Guided Access's exact behavior regarding whether
other apps' stored data remains reachable while active was not stated in the fetched
Apple page.

## Sources

Internal (read in full by one or more of the six source documents; read-only,
unedited):

- `docs/unica-v4/SPEC-CONTRACTS.md`
- `docs/unica-v4/EVENT-SCHEMA.md`
- `docs/unica-v4/DECISIONS.md`
- `docs/unica-v4/V5-DEFERRED.md`
- `docs/RECEIPT-SCHEMA.md`
- `docs/v2/SECURITY-ADVISORY-001.md`

External, READ (deduplicated across all six documents; accessed 2026-09-11 unless the
owning document states otherwise):

- Apple Newsroom, "Apple unveils iPhone Duo" — <https://www.apple.com/newsroom/2026/09/apple-unveils-iphone-duo/>
- Apple Developer Tech Talk, "Strike a pose with adaptive layouts on iPhone Duo" — <https://developer.apple.com/videos/play/tech-talks/111463/>
- Apple Support, iPadOS 26 Windowed Apps — <https://support.apple.com/en-us/125309>
- Apple Developer (archived), "Adopting Multitasking Enhancements on iPad — Slide Over and Split View Quick Start" — <https://developer.apple.com/library/archive/documentation/WindowsViews/Conceptual/AdoptingMultitaskingOniPad/QuickStartForSlideOverAndSplitView.html>
- Apple, App Store Connect Help, "Sufficient Contrast evaluation criteria" — <https://developer.apple.com/help/app-store-connect/manage-app-accessibility/sufficient-contrast-evaluation-criteria/>
- Apple Support, Guided Access — <https://support.apple.com/en-us/111795>
- Apple Support, device supervision — <https://support.apple.com/guide/deployment/about-device-supervision-dep1d89f0bff/web>
- Apple Developer, Autonomous Single App Mode — <https://developer.apple.com/documentation/devicemanagement/autonomoussingleappmode>
- W3C, Web Content Accessibility Guidelines (WCAG) 2.2 — <https://www.w3.org/TR/WCAG22/>
- W3C WAI, Understanding SC 1.4.11 Non-text Contrast — <https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html>
- W3C WAI, Understanding SC 1.4.3 Contrast (Minimum) — <https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html>
- W3C WAI, Understanding SC 2.5.8 Target Size (Minimum) — <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>
- W3C WAI, Understanding SC 2.4.11 Focus Not Obscured (Minimum) — <https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html>
- MDN, `prefers-contrast` — <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-contrast>
- MDN, `prefers-reduced-transparency` — <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency>
- MDN, `forced-colors` — <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/forced-colors>
- MDN, `prefers-reduced-motion` — <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion>
- MDN, Vibration API — <https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API>
- MDN, `Navigator.vibrate()` — <https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate>
- WebKit Blog, "New \<video\> Policies for iOS" — <https://webkit.org/blog/6784/new-video-policies-for-ios/>
- `mdn/browser-compat-data` issue #29166 (community report, unresolved/untriaged, not authoritative) — <https://github.com/mdn/browser-compat-data/issues/29166>
- W3C, CSS Environment Variables Module Level 1 (safe areas, viewport segments) — <https://www.w3.org/TR/css-env-1/>
- WebKit Blog, "Designing Websites for iPhone X" — <https://webkit.org/blog/7929/designing-websites-for-iphone-x/>
- WebKit standards-positions issue #327 (Viewport Segments) — <https://github.com/WebKit/standards-positions/issues/327>
- W3C, Device Posture API — <https://www.w3.org/TR/device-posture/>
- MDN, Device Posture API — <https://developer.mozilla.org/en-US/docs/Web/API/Device_Posture_API>
- WebKit standards-positions issue #328 (Device Posture) — <https://github.com/WebKit/standards-positions/issues/328>
- W3C, Window Management API — <https://www.w3.org/TR/window-management/>
- W3C, Presentation API — <https://www.w3.org/TR/presentation-api/>
- W3C, CSS Values and Units Module Level 4, dynamic viewport units — <https://www.w3.org/TR/css-values-4/#viewport-relative-lengths>
- WebKit Blog, "WebKit Features in Safari 26.0" — <https://webkit.org/blog/17333/webkit-features-in-safari-26-0/>
- WebKit Bugzilla #209292 (pointer/hover ambiguity with a paired mouse) — <https://bugs.webkit.org/show_bug.cgi?id=209292>
- Android Developers, adaptive apps — <https://developer.android.com/develop/adaptive-apps/guides/get-started-with-adaptive-apps>
- Android Developers, foldables — <https://developer.android.com/develop/adaptive-apps/guides/foldables/learn-about-foldables>
- Android Developers, dedicated devices (lock task mode) — <https://developer.android.com/work/dpc/dedicated-devices>
- Stripe, "Web Dashboard" — <https://docs.stripe.com/dashboard>
- Uniswap, "Understanding Swaps" — <https://developers.uniswap.org/docs/get-started/concepts/traders/swaps>
- Ledger, "Signing transactions and messages — design guidelines" — <https://developers.ledger.com/docs/device-app/integration/design-guidelines/transactions>
- Square, "What Is a Customer-Facing Display and Why Do You Need One?" — <https://squareup.com/us/en/the-bottom-line/selling-anywhere/what-is-a-customer-facing-display>
- Bitbond, "Gnosis Safe Multisig Guide for Projects" — <https://www.bitbond.com/resources/gnosis-safe-multisig-guide-for-projects>
- Privy docs (16 distinct pages, several via indexed excerpt rather than a raw fetch — see `PRIVY-DEVICE-MODEL.md` §9 for the per-page detail): embedded wallets overview, MFA overview, access tokens, server-side token verification, wallet policy and controls, logout, security threat models, delegated actions, authentication overview, login-methods configuration, passkey linking, client-side wallet export (two pages), server-side wallet export, cloud recovery, password-based recovery, general recovery, app-clients session duration, allowed domains, session-signer removal, teammate roles, and dashboard users (loaded but inconclusive) — all under `docs.privy.io`
- PCI Security Standards Council, standards overview — <https://www.pcisecuritystandards.org/standards/>
- Third-party PCI MPoC summaries (not the Council's own document): `payfelix.com`, `eazypaytech.com`
- Third-party EMVCo/PCI PTS summary (not EMVCo's or the Council's own document): `spilma.com`

External, UNREAD (attempted, no usable content after one retry; nothing inferred from
these):

- Apple, Human Interface Guidelines, *Color* — <https://developer.apple.com/design/human-interface-guidelines/color>
- Apple, Human Interface Guidelines, *Typography* — <https://developer.apple.com/design/human-interface-guidelines/typography>
- Apple, Human Interface Guidelines, *Layout* — <https://developer.apple.com/design/human-interface-guidelines/layout> (cited as UNREAD by both `THEMES.md`/`ACCESSIBILITY.md` and `ADAPTIVE-LAYOUT.md`)
- Apple, Human Interface Guidelines, *Color and Contrast* (older path, HTTP 404) — <https://developer.apple.com/design/human-interface-guidelines/accessibility/overview/color-and-contrast/>
- A Wayback Machine snapshot of the HIG Layout page — fetch blocked by tooling policy as of 2026-09-11; no URL resolved
- Apple Developer, *multitasking-on-ipad* — <https://developer.apple.com/documentation/uikit/multitasking-on-ipad>
- Privy docs, login-methods overview (HTTP 404, superseded by the authentication-overview URL above) — `docs.privy.io/authentication/user-authentication/login-methods/overview`
- Privy docs, embedded-wallets export (HTTP 404, superseded by the export URLs above) — `docs.privy.io/wallets/embedded-wallets/export`
- Privy docs, allowed-domains under `/security/` (HTTP 404, superseded by the `/guide/react/configuration/` URL above) — `docs.privy.io/security/authentication/allowed-domains`
- Coinbase Commerce (redirected to `coinbase.com/commerce`, HTTP 403) — `commerce.coinbase.com`
- Safe, "What is Safe" (loaded HTTP 200 but carried no field-level UI detail; listed UNREAD by its own citing document because nothing usable was drawn from it) — `docs.safe.global/home/what-is-safe`
