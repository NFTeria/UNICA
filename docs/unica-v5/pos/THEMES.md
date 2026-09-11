# Themes — UNICA v5 POS

Engineering record. Scope: a skeuomorphic/neumorphic-capable theme system for a UNICA
v5 point-of-sale surface, and the rules that keep three visual themes from ever
changing payment meaning. **UNICA v5** is the PROPOSED future dashboard/POS release
named in `docs/unica-v4/DECISIONS.md`'s standing owner ruling; nothing here is **UNICA
v4** (the deployed contract release specified in `docs/unica-v4/SPEC-CONTRACTS.md`) or
**"Uniswap v4"** (the AMM). No statement in this file authorizes starting, building,
scheduling, or announcing UNICA v5.

Statement classes used throughout: **VERIFIED** (an official source is cited and was
read), **PROPOSED** (a UNICA product-design choice, not sourced to any vendor),
**UNKNOWN** (neither confirmed nor safely inferred). Every external claim carries its
source URL and "accessed 2026-09-11". A source that did not load after one retry is
marked **UNREAD**, and nothing is inferred from its content.

Every token, screen, and rule below applies equally to whatever is settled on Robinhood
Chain testnet (46630) today: Robinhood test tokens (no real value) settled into uTUSD, a
test payout token (no real value). No screen in this file ever implies these tokens
carry a live tradable value, a backing guarantee, or represent an actual company share
— see §2 and §11j.

## Contents

1. Purpose and method
2. UNICA v4 facts this design must respect
3. Theme system overview — A, B, C
4. Shared information architecture and invariant behaviour
5. Design tokens (semantic, theme-swappable)
6. Elevation and shadow rules — light and dark
7. Typography scale
8. Touch targets and interaction geometry
9. Motion, haptic, and audio cues
10. States: loading, success, warning, failure, paused, expired, testnet
11. Restrained mock descriptions (text only)
12. Contrast findings summary
13. Critical rules encoded
14. Sources
15. Uncertainties

## 1. Purpose and method

This file specifies the visual theme system for a PROPOSED UNICA v5 point-of-sale (POS)
surface: three swappable themes (Tactile POS, Clear modern, Merchant-branded) built on
one shared token set, one shared information architecture, and one shared set of
payment semantics. It does not specify a merchant dashboard, an API, or a contract
change — those are out of scope for this file and, per `docs/unica-v4/V5-DEFERRED.md`
§1, out of scope for UNICA v4 entirely.

Method: every UNICA v4 fact cited below was read from the named repository file, not
recalled from memory, and is quoted or paraphrased without full addresses or 32-byte
identifiers. Every external accessibility or platform claim was checked, accessed
2026-09-11, against an official source (§14) or explicitly marked UNKNOWN/UNREAD where
it was not. Every contrast ratio anywhere in this file and in `ACCESSIBILITY.md` was
computed 2026-09-11 by a Python script implementing the WCAG relative-luminance
formula — none is asserted from memory (`ACCESSIBILITY.md` §2 has the method and the
full tables; §12 below carries only the headline results).

## 2. UNICA v4 facts this design must respect

These are read from the cited files, not designed here. A UNICA v5 POS screen that
contradicts any line below is a defect in the screen, not a reason to change the fact.

- **Orders are payer-bound, not link-based.** Every order names its payer at creation;
  `executor.pay(orderId)` reverts `WrongPayer(id, payer, caller)` for anyone else.
  (`docs/unica-v4/DECISIONS.md` Corrections #111; `docs/unica-v4/SPEC-CONTRACTS.md` §5,
  §9.1, error list.) A UNICA v5 POS screen therefore never presents a bare "pay me"
  link as if it settles today's contracts — see the next point.
- **Public payment links are UNICA v5 scope, gated on a security review that does not
  exist yet.** `DECISIONS.md` Q128: "v4 uses payer-bound orders only. Public payment
  links move to v5, behind a separate signed-intent security review that starts with
  Advisory 001." `docs/v2/SECURITY-ADVISORY-001.md` found that a payer's signed
  authorization which does not cryptographically bind the merchant's half of the deal —
  recipient, signer, output token and amount, pool, deadline — lets whoever submits the
  transaction redirect the entire payment to themselves, while the payer is debited in
  full and receives nothing (`SECURITY-ADVISORY-001.md`, "The defect", "What is not
  claimed here"). `docs/unica-v4/V5-DEFERRED.md` §8 restates this as the precondition:
  the review, "with its own caps and replay protections," must exist and be reviewed
  "before any link ships." **Consequence for this theme system:** every screen in §11
  below is drawn for a payer-bound order (a specific payer already named), never for an
  open-ended public link; no mock in this file shows a "send to anyone" checkout.
- **An order settles completely or not at all.** No refunds, subscriptions, or partial
  payments in v4 (`DECISIONS.md` Rec 41–43; `V5-DEFERRED.md` §5, §6). A UNICA v5 POS
  therefore never offers a "partial payment" or "save and resume" control on an order in
  flight, and never implies a refund button exists.
- **Market lifecycle is PROPOSED → INITIALIZED → SEEDED → ACTIVE → PAUSED → RETIRED**,
  stored as a `uint8` (`SPEC-CONTRACTS.md` §5, `DECISIONS.md` Corrections #112).
  `STALE_ORACLE` and `MARKET_CLOSED` are **computed** `OracleCondition` view results, not
  stored states, returned by `oracleCondition()`; `PAUSED` and `RETIRED` override any
  oracle condition (`SPEC-CONTRACTS.md` §9, the `OracleCondition` enum and the
  `registry.statusOf` precedence rule). RETIRED is terminal — a retired market cannot be
  reactivated. The PAUSER role may pause but never unpause; only the ADMIN (a Safe) may
  unpause or retire (`SPEC-CONTRACTS.md` §5 role table; S2). **Consequence:** the "market
  paused" mock (§11f) never shows a merchant-facing "resume" control, because no POS
  session holds the ADMIN role, and the "oracle stale" mock (§11g) is drawn as a
  read-only computed condition, never a toggle.
- **Settlement fails closed.** There is no demonstration-rate fallback if the oracle
  condition is not OK (`DECISIONS.md` standing ruling; Corrections #30; #45=Rec 45 is
  separate — webhooks). A screen never shows a settled amount computed from a stale or
  demonstration price.
- **"Paid" exists only when the settlement event and receipt are read back from the
  chain.** No screen, role, or override may mark an order paid client-side. The
  `SettlementReceipt` is emitted by the hook inside the swap that settled the order, and
  there is exactly one receipt per order, ever (`docs/RECEIPT-SCHEMA.md`, "the
  requirements, frozen", "Uniqueness key"). **Consequence:** the "processing" mock
  (§11c) never resolves to "success" on submission alone — it resolves only after a
  readback confirms the receipt, and the "success and receipt" mock (§11d) is drawn
  around exactly the fields `RECEIPT-SCHEMA.md` defines (recipient, payer, currencies
  in/out, amounts in/out, no fee in the beta, policy id reserved).
- **No UNICA fee in the beta; the LP fee is disclosed separately, never folded into "no
  fee."** (`DECISIONS.md` Rec 55, Rec 58.) The "customer confirmation" mock (§11b) states
  both facts as separate lines, never one merged line.
- **UNICA never requests or handles seed phrases; v4 surfaces collect nothing
  themselves.** (`DECISIONS.md` Q53, Rec 94.) No mock in this file includes a seed-phrase
  field, and no v5 POS screen is designed to collect wallet secrets directly — wallet
  interaction is delegated to the connected wallet's own UI, never re-implemented here.
- **No webhooks before mainnet.** (`DECISIONS.md` Rec 45.) No mock implies a live
  webhook-driven "order paid" push notification; "processing" (§11c) polls or subscribes
  to on-chain state, described generically, never as a webhook.
- **Beta caps exist; only two of the three are on-chain.** $10 per transaction and $25
  per day are enforced on-chain, per market (`DECISIONS.md` Q5–7; `POS-FLOWS.md` F11).
  The $100 total at risk **across markets** is a deployment-script and manifest refusal
  — an operational gate, not an on-chain invariant (same sources). Founder-controlled or
  specifically invited test merchants only (Q35). A UNICA v5 POS mock never shows an
  amount above the per-transaction or per-day cap being accepted for a beta-labelled
  market, and never implies the $100 cross-market total is checked by the contract
  itself.
- **The one existing settlement is an experimental, testnet-only fixture**, not UNICA
  v4: Robinhood Chain testnet (46630); Robinhood test TSLA (no real value) settled into
  uTUSD, a 6-decimal test payout token (no real value); the one experimental settlement
  delivered 0.393052 uTUSD to the merchant. This is always labelled "Testnet
  demonstration — no real value" wherever it appears, and it is never UNICA v4 itself.

## 3. Theme system overview — A, B, C

One shared component contract, three visual skins. Every theme renders the same
screens (§11), the same states (§10), the same copy for amount/currency/merchant/
network/fee/payout (§4, §13), and the same confirmation and security behaviour. A
theme is a token substitution plus an elevation-model switch (§5, §6, §13) — never a
change to what a control does or what it is allowed to say.

### 3a. Theme A — Tactile POS

Restrained skeuomorphism plus neumorphism, evoking a physical register without
imitating one exactly: a raised number pad, a recessed amount-display "window," register-
inspired button geometry, a receipt-paper treatment for the success/receipt screen,
status lamps for lifecycle state, and a short tactile confirmation animation on a
successful charge (motion-respecting; see §9). Depth comes from paired highlight/shadow
box-shadows (§6) on a near-monochrome surface, never from photographic textures, wood-
grain, brushed-metal, or skeuomorphic chrome — "restrained" means the metaphor is
legible at a glance and disappears the instant `forced-colors`, `prefers-contrast:
more`, or `prefers-reduced-transparency: reduce` is active (§6, `ACCESSIBILITY.md` §5,
§8).

### 3b. Theme B — Clear modern

Flat, high-contrast, minimal decoration, built for fast scanning and accessible by
default. Surfaces are flat fills separated by a real color boundary (a `border-strong`
token, computed ≥3:1 in §12) rather than a shadow illusion. This is the **default**
theme (§4) — a merchant is never required to opt into Tactile POS or a brand skin to get
an accessible register.

### 3c. Theme C — Merchant-branded

Clear modern's structure with the merchant's logo, a merchant accent hue (checked at
publish time against every payment-state color role, §5, §13), and merchant typography
substituted only where §5's tokens name a brand-overridable slot. Payment-state colors
(success/warning/failure), the testnet/mainnet badge, security warnings, and every
network/asset/amount/fee/payout string are **never** brand-overridable — a merchant
cannot recolor a failure red, hide the testnet badge behind their logo, or substitute
their own copy for a security warning. This is enforced the same way `SPEC-CONTRACTS.md`
enforces oracle policy tightening: a bounded, explicit allowlist of overridable slots,
never an open style sheet.

## 4. Shared information architecture and invariant behaviour

All three themes share:

- The same ten screens (§11) in the same order, reachable by the same events.
- The same status vocabulary: loading, success, warning, failure, paused, expired,
  testnet (§10), plus the market lifecycle and oracle-condition vocabulary of §2.
- The same rule that amount, currency, merchant identity, network, fees, and final
  payout are always rendered as text, in every theme and every state — never implied by
  color, icon, or shadow alone (§13, and see `ACCESSIBILITY.md` §9 for the color-blind-
  safe pattern this requires).
- The same "Advanced details" disclosure boundary: pool ids, hooks, ticks, raw units,
  and the receipt's indexed topic fields sit behind one shared disclosure control,
  collapsed by default, in every theme (owner UX direction; mirrors Safe's human-
  readable-then-raw review pattern and Uniswap's quote-detail disclosure — interaction
  pattern only, never its layout or trade dress).
- The same confirmation requirements for an irreversible action (§13) and the same
  focus order, keyboard reachability, and screen-reader labels (`ACCESSIBILITY.md` §6,
  §7) — a theme swap never removes a semantic control, it only restyles it.
- **Clear modern is the accessibility-first default** for every new merchant and every
  countertop tablet profile; Tactile POS and Merchant-branded are opt-in per merchant,
  never opt-in per payer — a payer completing a charge never has to learn a new
  metaphor because the merchant chose a decorative theme.

## 5. Design tokens (semantic, theme-swappable)

Tokens are named by role, not by hue, so a theme swap or a brand override changes only
the token's value. Every numeric value below is a PROPOSED UNICA design choice; every
contrast ratio next to a token was computed 2026-09-11 (`ACCESSIBILITY.md` §2–§4;
full pair list there). Two roles are split out on purpose: `border-hairline` is
decorative only and is never load-bearing for a boundary a user must perceive;
`border-strong` is the one token every theme must place on every neumorphic edge, every
focus ring, and every disabled/enabled boundary that carries meaning, because it is the
token computed to clear the AA non-text floor (§12; `ACCESSIBILITY.md` §5).

| Token | Role | Light value | Dark value | Brand-overridable? |
|---|---|---|---|---|
| `--bg-canvas` | page background | `#F4F5F7` | `#14161D` | no |
| `--surface-flat` | Clear modern card/panel fill | `#FFFFFF` | `#1E212C` | no |
| `--surface-tactile` | Tactile POS raised/recessed base fill | `#ECEEF2` | `#23262F` | no |
| `--text-primary` | body and label text | `#1B1E2B` | `#F0F1F5` | no |
| `--text-secondary` | meta, timestamps, secondary labels | `#545B6E` | `#B3B8C7` | no |
| `--border-hairline` | decorative divider only, not a boundary a user must perceive | `#D3D6DE` | `#33374A` | no |
| `--border-strong` | load-bearing boundary: neumorphic edges, disabled/enabled state, non-focus non-text UI | `#7B8093` | `#6B7190` | no |
| `--focus-ring` | keyboard/assistive focus indicator | `#3730A3` | `#A5B4FC` | no |
| `--accent-indigo-text` | links, selected-tab text, icons | `#4338CA` | `#A5B4FC` | merchant accent hue only, never the semantic roles below |
| `--accent-fill` | primary button fill | `#4F46E5` | `#818CF8` | merchant accent hue only |
| `--accent-fill-text` | text/icon on `--accent-fill` | `#FFFFFF` | `#0B0B14` | no — always re-derived to clear 4.5:1 against whatever `--accent-fill` resolves to (§12) |
| `--status-success` | success text, icon, lamp | `#157F3C` | `#4ADE80` | no |
| `--status-warning` | oracle/quote warning text, icon, lamp | `#92400E` | `#FBBF24` | no |
| `--status-danger` | failure text, icon, lamp | `#B91C1C` | `#F87171` | no |
| `--badge-testnet-bg` / `--badge-testnet-text` | the persistent Test mode badge (§10, §11j, §13) | `#92400E` / `#FFFFFF` | `#FBBF24` / `#1B1E2B` | no |

A Merchant-branded theme (3c) may supply exactly `--accent-indigo-text` and
`--accent-fill`'s **hue**, and only after the publish-time check re-derives
`--accent-fill-text` and re-runs the contrast script (`ACCESSIBILITY.md` §2) against
that hue in both light and dark; a merchant hue that cannot clear 4.5:1 with either
black or white text in a mode is rejected for that mode, matching the search this file
ran for the dark-theme `--accent-fill` value itself (§12).

## 6. Elevation and shadow rules — light and dark

**Clear modern and Merchant-branded** use one elevation model: flat fills plus
`--border-strong` (or, for a resting card with no adjacent element, a single soft drop
shadow used only as decoration alongside — never instead of — the border). This model
has no non-text-contrast problem because the boundary is a real color edge, not a
shadow illusion.

**Tactile POS** uses a two-shadow neumorphic model on `--surface-tactile`, which is
deliberately close in lightness to `--bg-canvas` (their flat-color contrast computes to
1.06:1 in light mode and 1.20:1 in dark mode — see `ACCESSIBILITY.md` §5 for the full
computation) so that a raised or recessed element reads as "grown out of" the same
surface rather than as a pasted-on card:

- **Raised** (resting numeric key, resting button): a light-source highlight shadow
  offset toward the upper-left and a shadow-toned shadow offset toward the lower-right,
  both on `--surface-tactile`. Light: highlight `rgba(255,255,255,.7)`, shadow
  `rgba(23,25,35,.14)`. Dark: highlight `rgba(255,255,255,.04)`, shadow
  `rgba(0,0,0,.55)`.
- **Recessed** (the amount-display window, an input tray, a pressed key): the same two
  shadows, `inset`, so the surface reads as pressed into the canvas rather than lifted
  off it.
- **Tactile confirmation**: on press, a raised key transitions to its recessed shadow
  state for the duration of the touch, then returns — a depth cue, not a color change,
  paired with the motion and haptic rules in §9.

**The one rule every Tactile POS element must follow, because of the finding in
`ACCESSIBILITY.md` §5:** a box-shadow is not a color boundary a contrast formula (or a
screen reader, or Windows/Safari forced-colors mode) can see. MDN's own worked example
for `forced-colors: active` shows exactly this failure mode — a box-shadow button
boundary that must be replaced with a real `border` once forced colors are active,
because forced-colors mode sets `box-shadow` to `none` outright (MDN, `forced-colors`,
"Properties with Special Behavior" — accessed 2026-09-11, full citation in §14). So:

1. Every neumorphic element that is interactive or carries state (a key, a toggle, a
   status lamp housing, the amount-display tray) **also** carries a `--border-strong`
   edge, at the contrast this file computed to clear the AA 3:1 non-text floor (§12).
   The shadow is decoration on top of a boundary that already exists without it.
2. Under `forced-colors: active`, `prefers-contrast: more`, or
   `prefers-reduced-transparency: reduce`, Tactile POS drops the dual box-shadow
   entirely and renders with Clear modern's flat-fill-plus-border model (§3a, §6). No
   theme's decorative layer is allowed to be the only thing standing between a payer and
   a legible control.
3. No neumorphic surface is ever used for the testnet badge, a security warning, an
   irreversible-action control, or any text conveying amount/currency/merchant/network/
   fee/payout — those always sit on a flat, bordered surface in every theme (§13).

## 7. Typography scale

A PROPOSED type ramp (CSS px, 1x = iPadOS points). "Large text" below the 24px/18.5px-
bold line is the WCAG threshold this file uses to decide which text may rely on the 3:1
large-text contrast floor instead of the full 4.5:1 floor — verified from the W3C
Understanding document for SC 1.4.3, which states the 18-point/14-point-bold thresholds
convert to approximately 24px/18.5px (`w3.org/WAI/WCAG22/Understanding/contrast-
minimum.html`, accessed 2026-09-11; full citation §14).

| Role | Size | Weight | WCAG large-text? |
|---|---|---|---|
| Amount entry display | 64px | 700 | yes (≥24px) |
| Receipt total | 40px | 700 | yes |
| Screen title (H1) | 28px | 600 | yes |
| Section header (H2) | 20px | 600 | yes (≥18.5px bold) |
| Body | 17px | 400 | **no** — needs the full 4.5:1 floor |
| Secondary / meta | 15px | 400 | no |
| Advanced-details / hex / pool id (monospace) | 13px | 400 | no |
| Status pill label | 14px | 600 | no (14px bold ≈ 18.5px only at 14-**point**-bold, not 14px-bold; treated as small text here to stay safely inside the 4.5:1 floor) |

iOS/iPadOS's own documented body-text size and Dynamic Type behaviour would refine this
ramp further, but the two Apple Human Interface Guidelines pages this file attempted to
read for it (Typography, Layout) are client-rendered pages that returned only a page
title with no body text as of 2026-09-11, on the retry as well; they are marked **UNREAD**
(§14, §15) rather than guessed from general knowledge. The 17px body size above is a
PROPOSED value chosen to be legible at typical countertop viewing distance, not a value
copied from an unread Apple source.

## 8. Touch targets and interaction geometry

The binding, sourced floor is WCAG 2.2 SC 2.5.8 Target Size (Minimum), Level AA: a
pointer target is at least 24×24 CSS pixels, or has an equivalent 24px spacing
allowance, with named exceptions for inline, user-agent-controlled, equivalent, and
essential targets (`w3.org/WAI/WCAG22/Understanding/target-size-minimum.html`, accessed
2026-09-11; full citation §14, quoted fully in `ACCESSIBILITY.md` §10).

UNICA v5 POS sets its own floor well above that minimum, because a countertop tablet is
used at arm's length, sometimes with gloves, and sometimes under glare:

| Element | Size | Notes |
|---|---|---|
| Numeric keypad key (Tactile POS) | 72×64px | exceeds the WCAG 24×24 floor with a wide margin |
| Numeric keypad key (Clear modern) | 64×56px | same rationale, flatter geometry |
| Standard button (Confirm, Cancel, etc.) | ≥48×48px | |
| Destructive/irreversible action control | ≥48×48px, distinct shape and label (§13) | never sized or shaped like an ordinary POS button |
| Minimum gutter between adjacent targets | 8px | kept even where each target already clears 24×24 alone, so the WCAG spacing fallback is never the only thing standing between two targets |

Apple's commonly reported 44×44-point minimum tappable area is widely cited across
secondary sources, but every attempt, as of 2026-09-11, to read it from an Apple-owned
page returned either a client-rendered page with no body text or a 404 (§14, §15); it is
therefore treated here as **UNKNOWN, not independently verified by direct read**, and is
not the basis for any number in the table above — the WCAG 24×24 floor is. The sizes
chosen (48–72px) comfortably clear the widely reported Apple figure regardless of
whether it is confirmed, so no design decision here depends on resolving the
uncertainty.

## 9. Motion, haptic, and audio cues

**Motion.** Every state transition in §10 has a non-animated equivalent: a status
change, a lifecycle change, and the tactile-confirmation press-state in §6 all also
communicate through an immediate, static text/icon/color change (§13), so
`prefers-reduced-motion: reduce` never removes information, only movement (MDN,
`prefers-reduced-motion`, accessed 2026-09-11; §14). The tactile confirmation animation
in §6 is capped at 150ms and is skipped entirely under `prefers-reduced-motion: reduce`.

**Haptic feedback (`navigator.vibrate()`).** Checked 2026-09-11 before being proposed
below. MDN documents the Vibration API as **not Baseline**, stating it "does
not work in some of the most widely-used browsers," and historical compatibility data
lists Safari (macOS and iOS) as unsupported (`developer.mozilla.org/.../Vibration_API`
and `.../Navigator/vibrate`, both accessed 2026-09-11; §14). An open, unresolved
`mdn/browser-compat-data` issue (#29166, accessed 2026-09-11) reports that
`navigator.vibrate()` appeared to work on a recent iOS Safari build under "sticky user
activation," with a further community report that Apple tightened the gesture
requirement again in iOS 18.4 — but this is a single unconfirmed bug-tracker report, not
an official WebKit or Apple statement, and the issue was still open and untriaged at
access time. **Design consequence:** haptic feedback on a charge confirmation is
PROPOSED as an unconditionally feature-detected, best-effort enhancement —
`if ('vibrate' in navigator) navigator.vibrate(...)` — and no state in §10 is ever
communicated by haptic feedback alone; every haptic cue duplicates a cue already given
by text, icon, and color (§13). On countertop iPadOS Safari specifically, haptic
feedback should be assumed **absent** until re-verified against the current OS release
at implementation time.

**Audio cues.** WebKit's own documentation of iOS video policy states that a media
element with an audio track cannot autoplay, and playback pauses again if a track
"gains an audio track or becomes un-muted without a user gesture" (`webkit.org/blog/
6784/new-video-policies-for-ios/`, accessed 2026-09-11; §14 — this post documents
`<video>` specifically; extending the same user-gesture requirement to a standalone
`<audio>` element or the Web Audio API is this file's own PROPOSED reading of a
well-documented and consistently reported WebKit autoplay policy, not itself a line
quoted from an audio-specific WebKit source). **Design consequence:** any success or
failure chime is triggered only inside a handler for a gesture already in the flow (the
payer's own confirmation tap, §11b) — never by an unprompted background timer or a
webhook-style push — and the first such gesture in a session is also used to "unlock"
audio playback for any cue that must fire later without a fresh tap (e.g., a receipt
chime after an awaited on-chain readback). Audio, like haptics, never carries a state
alone (§13) and is muted by default with a persistent, discoverable mute control,
consistent with WCAG SC 1.4.2 Audio Control.

## 10. States: loading, success, warning, failure, paused, expired, testnet

Every state below is rendered with all three of icon, text, and color together, never
any one alone (`ACCESSIBILITY.md` §9 has the color-blind-safe pairing rationale and the
computed contrast for each color role, §12).

| State | Icon | Color role | Text | Notes |
|---|---|---|---|---|
| Loading | indeterminate spinner or pulse | `--text-secondary` | "Waiting for the network to confirm…" | never implies success before a receipt is read back (§2) |
| Success | check mark | `--status-success` | "Payment confirmed" + receipt fields | only reachable after `SettlementReceipt` readback (§2, §11d) |
| Warning (oracle/quote) | triangle | `--status-warning` | names the specific condition (`STALE_ORACLE`, a quote about to expire, etc.) | never a generic "something's off" |
| Failure | cross/x | `--status-danger` | names the specific reverted reason where one exists (`WrongPayer`, `MarketNotActive`, expired order, etc.) | never a bare "error" |
| Paused | pause glyph | `--status-warning` | "This market is paused" | read-only; no merchant-facing resume control (§2) |
| Expired | clock-with-slash | `--status-danger` | "This order has expired" | a new order must be created; the expired one is not resumable |
| Testnet | a persistent badge, not a transient toast | `--badge-testnet-*` | "Test mode — no real value" | always visible, on every screen, in every theme (§13) |

## 11. Restrained mock descriptions (text only)

Ten screens, described in prose, not image. Each is drawn once, at the shared
information-architecture level (§4); a theme changes only the decorative layer named in
brackets.

### 11a. Amount entry

A single large numeric display at the top (§7 "Amount entry display" role), backed by a
recessed tray in Tactile POS or a bordered flat panel in Clear modern, showing the
amount as it is typed and the settlement currency's symbol beside it — never the symbol
alone. Below it, a numeric keypad (§8 sizes). A persistent header carries the merchant
name, the network name, and the Test mode / Mainnet badge (§10, §13) — present here and
on every other screen in this list, not repeated below. A "Charge" button is disabled
until the amount is non-zero and within the market's configured caps (§2); if the
amount would exceed a beta cap, an inline warning names the cap, not a generic "too
large" message.

### 11b. Customer confirmation

Shows, as separate text lines, never merged: the amount and settlement currency; the
merchant's resolved identity; the network (with the testnet/mainnet badge repeated at
this decision point); the LP fee, disclosed on its own line, separate from a
"No UNICA fee (beta)" line (§2, per Rec 55/58 — never one combined "no fee" line); the
resolved payout recipient; and, under "Advanced details" (collapsed by default, §4), the
pool id, hook address, and raw unit amounts. The payer confirms by a single explicit tap
on a clearly labelled "Confirm and pay" control sized per §8 — this is the point where
the payer's own wallet/UI takes over for the signature; this screen never collects a
seed phrase or private key itself (§2).

### 11c. Processing

A loading state (§10) with the specific step named ("Submitting…", "Waiting for
confirmation…", "Reading back the receipt…") rather than a single spinner with no label,
so a payer is never left guessing whether their tap registered. No success state is
reachable from here without a readback (§2, §10).

### 11d. Success and receipt

A success state (§10) followed immediately by the receipt, laid out from
`docs/RECEIPT-SCHEMA.md`'s own fields: recipient, payer, currency in/out, amount in/out,
fee (stated as zero in the beta, not omitted), and, under "Advanced details," the pool
id, the schema version, and the policy id (reserved, shown as unset unless one exists).
In Tactile POS, this screen carries the receipt-paper visual treatment named in §3a — a
decorative border/texture only, never a change to which fields are shown or how they are
labelled.

### 11e. Failure

A failure state (§10) naming the specific reason. Distinct copy for each named UNICA v4
refusal recorded in §2: `WrongPayer` ("This order is bound to a different
payer"), `MarketNotActive` ("This market isn't open for payment right now"), an expired
order (§11j below is the paused/expired sibling), a short/partial fill refusal ("The
pool couldn't fill this order — nothing moved," reflecting that a partial fill is
refused rather than partially executed, `RECEIPT-SCHEMA.md`, "Refused or reverted
settlements"). No generic "transaction failed" copy where a specific reason is known.

### 11f. Market paused

A paused state (§10): "This market is paused" plus, where known, whether it was PAUSER-
or ADMIN-paused is not shown (both look identical to a payer, since only the ADMIN Safe
may unpause either way, §2) — the payer-facing copy is the same regardless, and there is
no resume control anywhere in this surface (§2).

### 11g. Oracle stale

A warning state (§10) for the computed `STALE_ORACLE` condition: "Pricing for this
market is stale — payment is temporarily unavailable," with the specific condition named
under "Advanced details" (the adapter's reported staleness) rather than a rate computed
from a stale price ever being shown as if current (§2, "settlement fails closed").

### 11h. Wrong network

A warning/failure state (§10) shown before an amount is even entered if the connected
wallet's chain does not match the market's configured chain: "Switch to <network name>
to pay this merchant," with a network-switch action if the wallet exposes one, and no
amount-entry control enabled until the network matches.

### 11i. Wrong payer

A failure state (§10) reached only after a connected wallet attempts `pay()` for an
order it is not named on: "This order is bound to a different payer," with the bound
payer shown as a shortened, non-full form (e.g. a truncated address) — never printing a
complete address or a raw 32-byte value on this screen, consistent with the truncation
convention stated in §1.

### 11j. Testnet demonstration

Every screen above, when pointed at the 46630 fixture, additionally carries: "Testnet
demonstration — no real value" as persistent body text (not only the header badge),
naming Robinhood test TSLA (no real value) as the input and uTUSD, a test payout token
(no real value), as the settlement currency, and never describing either as
carrying a live tradable value, a backing guarantee, or representing an actual company
share (owner naming rules; §2).

## 12. Contrast findings summary

Full pairs, method, and every computed number are in `ACCESSIBILITY.md` §2–§5. Headline
results from the contrast script, run 2026-09-11:

- Every `--text-primary` / `--text-secondary` pairing against `--bg-canvas` and
  `--surface-flat`, in both light and dark, clears the 4.5:1 AA text floor — the
  tightest among these eight pairings is `--text-secondary` on light `--bg-canvas` at
  6.21:1, not the dark-mode pairing.
- `--status-success`, `--status-warning`, and `--status-danger` all clear 4.5:1 as text
  against `--bg-canvas` in both modes (light success is the tightest at 4.66:1 — the
  tightest pairing in the entire light-theme table, not merely among the status colors;
  dark danger is the tightest at 6.53:1).
- The **first** dark-mode `--accent-fill` candidate tried (`#6366F1`, an indigo-500)
  **failed** 4.5:1 against both black-ish and white label text (4.38:1 and 4.47:1). The
  token was iterated to `#818CF8` (indigo-400) paired with a near-black label
  (`#0B0B14`), which clears at 6.57:1 — this is why `--accent-fill-text` in §5 is
  specified as "always re-derived," not a fixed light/dark pair.
- `--surface-tactile` against `--bg-canvas` — the neumorphic surface's own flat-color
  contrast — is **1.06:1 in light mode and 1.20:1 in dark mode**: nowhere near the 3:1
  AA non-text floor, confirming that a neumorphic shadow illusion cannot be the sole
  boundary cue (§6, `ACCESSIBILITY.md` §5).
- `--border-hairline` (decorative) also fails the 3:1 floor by design (1.33:1 light,
  1.54:1 dark) — it is explicitly not the token used for a boundary that must be
  perceived. `--border-strong` was iterated until it cleared 3:1 with a working margin:
  `#7B8093` at 3.60:1 (light) and `#6B7190` at 3.78:1 (dark) — both comfortably above the
  floor rather than rounded up against it.
- `--focus-ring` clears the non-text 3:1 floor by a wide margin in both modes (9.11:1
  light, 9.06:1 dark), so the focus indicator remains visible even before the
  `border-strong` fix is considered.

## 13. Critical rules encoded

- **Never state by shadow alone.** Every Tactile POS boundary that carries meaning also
  carries a `--border-strong` edge (§6), and the shadow layer is dropped entirely under
  `forced-colors`, `prefers-contrast: more`, and `prefers-reduced-transparency: reduce`
  (§6, `ACCESSIBILITY.md` §5, §8).
- **Never by color alone.** Every state in §10 pairs icon, color, and text; no status is
  ever communicated by a lamp color or a fill color with no accompanying label.
- **Amount, currency, merchant, network, fees, and final payout are always textual**, in
  every screen in §11, in every theme — an icon or color may accompany them, never
  replace them.
- **Testnet/no-value status is persistent and unmistakable.** The badge in §10/§13 is
  present on every screen, in every theme, cannot be dismissed, and is not one of the
  brand-overridable slots in §3c/§5.
- **Destructive and irreversible controls do not resemble ordinary POS buttons.** Sized
  per §8 but shaped and labelled distinctly, and gated behind the same explicit
  confirmation step this repository's own contracts require before an irreversible
  on-chain action (mirrors `SPEC-CONTRACTS.md`'s own pattern of readback-before-send for
  `activate`, S2/U8's pause-then-Safe-review-then-unpause sequence — an interaction
  pattern borrowed, never the contract's own admin surface exposed to a POS).
- **No theme imitates a system dialog, a wallet-approval sheet, Apple Pay, or another
  provider's checkout chrome.** The confirmation screen (§11b) is deliberately built from
  UNICA's own token set (§5) and never reproduces the exact button shape, wordmark, or
  layout of a native OS payment sheet or another payment provider's UI (owner UX
  direction: patterns borrowed, never trade dress).
- **Avoid low-contrast soft UI.** Tactile POS is opt-in, restrained, and structurally
  backed by `--border-strong` everywhere it matters (§6); Clear modern — flat, bordered,
  no shadow illusions — is the accessibility-first default every new merchant starts on
  (§3b, §4).
- **Meet current WCAG AA contrast and interaction requirements**, and **support reduced
  transparency and increased contrast where available** — see `ACCESSIBILITY.md` in
  full, especially §4–§5 (contrast), §8 (the four platform media features), and §12 (the
  SC-by-SC checklist).

## 14. Sources

Internal (read 2026-09-11):

- `docs/unica-v4/DECISIONS.md`
- `docs/unica-v4/V5-DEFERRED.md`
- `docs/unica-v4/SPEC-CONTRACTS.md`
- `docs/RECEIPT-SCHEMA.md`
- `docs/v2/SECURITY-ADVISORY-001.md`

External, VERIFIED (fetched and read, accessed 2026-09-11):

- W3C, *Web Content Accessibility Guidelines (WCAG) 2.2* — https://www.w3.org/TR/WCAG22/
- W3C WAI, *Understanding SC 1.4.11: Non-text Contrast* —
  https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- W3C WAI, *Understanding SC 1.4.3: Contrast (Minimum)* —
  https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- W3C WAI, *Understanding SC 2.5.8: Target Size (Minimum)* —
  https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- W3C WAI, *Understanding SC 2.4.11: Focus Not Obscured (Minimum)* —
  https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- MDN, *`prefers-contrast`* —
  https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-contrast
- MDN, *`prefers-reduced-transparency`* —
  https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency
- MDN, *`forced-colors`* —
  https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/forced-colors
- MDN, *`prefers-reduced-motion`* —
  https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
- MDN, *Vibration API* — https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API
- MDN, *`Navigator.vibrate()`* —
  https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate
- WebKit, *New \<video\> Policies for iOS* —
  https://webkit.org/blog/6784/new-video-policies-for-ios/
- `mdn/browser-compat-data` issue #29166 (community report, unresolved/untriaged at
  access time, not authoritative) —
  https://github.com/mdn/browser-compat-data/issues/29166
- Apple, *Sufficient Contrast evaluation criteria* (App Store Connect Help) —
  https://developer.apple.com/help/app-store-connect/manage-app-accessibility/sufficient-contrast-evaluation-criteria/

External, **UNREAD** (attempted, no usable body text after retry — nothing inferred
from these):

- Apple, Human Interface Guidelines, *Color* —
  https://developer.apple.com/design/human-interface-guidelines/color (client-rendered;
  only a page title returned on fetch)
- Apple, Human Interface Guidelines, *Typography* —
  https://developer.apple.com/design/human-interface-guidelines/typography (same)
- Apple, Human Interface Guidelines, *Layout* —
  https://developer.apple.com/design/human-interface-guidelines/layout (same)
- Apple, Human Interface Guidelines, *Color and Contrast* (older path) —
  https://developer.apple.com/design/human-interface-guidelines/accessibility/overview/color-and-contrast/
  (404)
- A Wayback Machine snapshot of the Layout page — fetch blocked by tooling policy as of
  2026-09-11, not attempted a second way

## 15. Uncertainties

- **Apple HIG Typography, Layout, and Color pages could not be read directly as of
  2026-09-11.** All three are client-rendered (JavaScript) pages; the fetch tool returned
  only a `<title>` with no body content on every attempt, and one older path 404'd. The
  widely reported "44×44pt minimum tappable area" and any Apple-specific type-scale or
  Dynamic Type numbers are therefore **UNKNOWN, not independently verified by direct
  read** in this file, and no number in §7 or §8 depends on them — §8 uses the
  W3C-verified 24×24 CSS-pixel floor instead and sets UNICA's own targets well above it.
  A follow-up fetch with JS-capable tooling (or a direct copy of the rendered HIG text)
  should re-attempt this and correct §7/§8 if Apple's own numbers differ meaningfully.
- **Whether `navigator.vibrate()` works on the current iPadOS Safari release is
  unresolved by official sources.** MDN's compatibility data says no; one open,
  untriaged community bug-tracker report says it worked under stricter conditions on a
  recent build, and a further unconfirmed report says Apple tightened it again in iOS
  18.4. §9 treats haptic feedback as absent-until-reverified and never load-bearing,
  which is safe under either outcome, but the underlying platform fact itself is not
  settled.
- **The WebKit source verified for audio autoplay policy (`webkit.org/blog/6784`)
  documents `<video>`, not a standalone `<audio>` element or the Web Audio API by
  name.** §9's extension of the same user-gesture requirement to audio cues is this
  file's own reasoned inference from a consistently reported general WebKit autoplay
  policy, not a line quoted from an audio-specific source — flagged as PROPOSED
  reasoning, not VERIFIED fact, in §9 itself.
- **`prefers-reduced-transparency` browser support is described by MDN itself as "not
  Baseline"** and the full per-browser compatibility table did not render in the
  2026-09-11 fetch (only the qualitative "limited availability" note came through). §6
  and `ACCESSIBILITY.md` §8 treat it as a preference to honor when present and degrade
  gracefully in its absence, but the exact current Safari/iPadOS support level is not
  independently confirmed here beyond MDN's general availability note.
- **No live UNICA v5 screen exists to check any of this against.** Every mock in §11 is
  a text description of an intended design, not a build; nothing here has been rendered,
  tested with a screen reader, or tested on an actual countertop tablet. `ACCESSIBILITY.md`
  §14 restates this as its own uncertainty for the checklist specifically.
- **The exact merchant-brand accent-hue rejection procedure in §5/§3c (re-running the
  contrast script at publish time) is a PROPOSED process, not an implemented tool.** No
  script or CI check enforcing it exists yet in this repository; this file specifies the
  rule a future implementation must satisfy, not a control that runs today.
