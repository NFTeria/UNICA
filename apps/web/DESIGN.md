# The UNICA design system

Everything a screen in this product is allowed to look like. Read it before writing a page; the next
Shopify-shaped admin, Coinbase-Commerce-shaped checkout and counter register are all meant to be
built out of what is on this page **without touching `assets/unica.css`**. If a screen needs
something that is not here, add it here first, with its class and its example, and the test in
`tests/design.test.mjs` will start requiring the stylesheet to carry it.

Patterns are welcome; trade dress is not. Nothing in this file copies a logo, a palette or a layout
from Stripe, Shopify or Coinbase. What is borrowed is the idea that an admin has a persistent left
menu, that a checkout is one centred card, and that a register is a big number over a keypad — ideas
nobody owns.

---

## The two rules that outrank taste

**1. No machine words on the business or the join screens.** On every route under `business/` and on
`join/`, the visible text must not contain **hook, executor, registry, pool, tick, feed, calldata or
hex** — singular or plural. `tests/parity.test.mjs` strips the tags and scans what a person actually
reads, and it fails the build's owner, not the customer. The one exception is the
`advancedVerification()` disclosure, which is closed until somebody opens it. A component never
prints one of those words itself: it takes its label from its caller.

**2. The no-value banner is on every page, and it is not yours to remove.** `src/shell.mjs` puts
`TESTNET / NO VALUE` above all three layouts, and `build.mjs` refuses to emit a document without it
unless the build was told `UNICA_BUILD_ENVIRONMENT=PUBLIC_MAINNET` — in which case it refuses to emit
one *with* it. The customer-facing wording of the same fact is
`Testnet. No real money.`, from `assets/wallet.js`. Do not write either sentence into a page
by hand; both have exactly one source.

And the rule under both of them: **nothing is invented**. A component given no data renders an empty
state that says so. Never a sample price, never an example customer, never a zero standing in for a
number nobody has read.

---

## The brand: four fields and one rule

`assets/unica.css` opens with them, and everything else is derived:

| Token | Light | What it is |
|---|---|---|
| `--paper` | `#fbfbfa` | the ground |
| `--ink` | `#14161a` | the neutral that carries nearly all of the colour |
| `--accent` | `#0b6e4f` | ONE colour, spent twice per screen at most |
| `--radius` | `8px` | one corner, everywhere |
| `--space` | `4px` | the rule: every gap and pad is a multiple, through `--s1`…`--s12` |

`--muted`, `--line`, `--surface` and `--accent-quiet` are mixed from the ground and the ink, so the
dark scheme swaps the same four fields and everything else follows. `--on-accent` is the one value
that cannot be mixed: it is **computed**. Near-white reaches 5.95:1 on the light accent (near-black
manages 2.89), and on the dark accent the answer flips — near-black reaches 7.43 where near-white
manages 2.51. `tests/design.test.mjs` recomputes both ratios from the hex in the stylesheet and fails
below 4.5:1.

Body text is 16px. Font weights are **400, 500 and 700** and nothing else. The font stack is the
system's; there is no web font, and no `http`/`https` URL of any kind may appear in the stylesheet —
also a test.

**Where the accent is allowed:** the primary action, and the current item in the left menu. That is
the whole list. A second green button on a screen means one of them is not the primary action.

---

## The three layouts

`src/shell.mjs` chooses by route path and stamps `data-layout` on `<body>`. A page does not choose.

| Layout | Routes | Frame |
|---|---|---|
| `marketing` | `/`, the explanation pages, `legal/*`, `support/`, 404 | top nav, hero band, footer, one roomy measure |
| `app` | `business/*`, `join/` | left menu, top bar with the business name and wallet chip, content column opening with the page title and its actions |
| `checkout` | `pay/`, `receipt/` | one centred column, business identity above the card, the least navigation that still lets someone leave |

The left menu is fixed at six items — Overview, Products, Orders, Customers, Registers, Settings —
and every one of them points at a route this build emits. `build.mjs` fails on a menu link that
resolves to no file, and `tests/design.test.mjs` asks the same question of the list directly.

---

## The blocks

Each is a function in `src/components.mjs`. The HTML beside it is what it renders.

### Card

```html
<section class="card" id="today">
  <h2>Today</h2>
  <p>Four payments, all checked.</p>
  <p class="ctas"><a class="cta" href="payments/new/">Create payment</a></p>
</section>
```

### KPI grid

```html
<dl class="kpis">
  <div class="kpi"><dt>You receive</dt><dd id="payout-asset">—</dd></div>
  <div class="kpi"><dt>Active register</dt><dd id="active-register">—</dd></div>
  <div class="kpi"><dt>Verified payments today</dt><dd id="today-count">—</dd></div>
</dl>
```

A figure nobody has read yet is an em dash. Never `0`: an unread count and a count of zero are
different facts, and a screen that shows one as the other is lying quietly.

### Data table, with a status pill

The wrapper scrolls sideways so the page never does.

```html
<div class="table-wrap">
  <table class="dtable">
    <caption>Payments today</caption>
    <thead><tr><th scope="col">Reference</th><th scope="col">Amount</th><th scope="col">State</th></tr></thead>
    <tbody>
      <tr><td>Order 4821</td><td>12.50</td><td><span class="pill" data-status="verified">Verified</span></td></tr>
      <tr><td class="sub" colspan="3">Nothing has been read yet.</td></tr>
    </tbody>
  </table>
</div>
```

**A cell is escaped unless it is a rendered block.** `h` escapes every interpolation, which is the
property that stops a business name from becoming markup. So a cell that should hold a pill takes
the value `pill("verified")` returns — not that value turned into a string. Pass a string and you
will see the tags on screen, which is the escaping working, not failing. The same holds for the
product list and anywhere else a block nests inside a block.

### Pill

Six states. The mark and the word carry the meaning; the colour only agrees with them.

```html
<span class="pill" data-status="verified">Verified</span>
<span class="pill" data-status="pending">Waiting</span>
<span class="pill" data-status="refused">Refused</span>
<span class="pill" data-status="unknown">Not known</span>
<span class="pill" data-status="active">Active</span>
<span class="pill" data-status="revoked">Switched off</span>
```

`unknown` is neither a pass nor a fail. A check that could not run says so; it never borrows
`refused`, and it never borrows `verified`.

### Buttons

```html
<button type="button" class="cta">Charge</button>
<button type="button" class="cta cta-quiet">Cancel</button>
<button type="button" class="cta cta-danger">Switch this register off</button>
<button type="button" class="cta" disabled aria-describedby="pay-why">Pay</button>
<p class="sub" id="pay-why">Disabled until this payment has been read and a wallet is connected on the right network.</p>
```

`button()` throws if you disable one without a reason, and `tests/build.test.mjs` fails any document
carrying a disabled control with no `aria-describedby`. A grey button that will not say why is the
commonest way a screen wastes somebody's afternoon.

### Form field

```html
<p class="formfield">
  <label for="amount">Amount to charge</label>
  <input class="field" id="amount" type="text" inputmode="decimal" aria-describedby="amount-help">
  <span class="help" id="amount-help">Digits and one decimal point.</span>
  <span class="error" id="amount-error" role="status" aria-live="polite"></span>
</p>
```

The error element is present and empty, not absent. It is a live region, so filling it announces.

### Select

```html
<p class="formfield">
  <label for="currency">Invoice in</label>
  <select class="field" id="currency"><option value="usd">US dollars</option></select>
  <span class="help" id="currency-help">You still receive your payout asset.</span>
</p>
```

### Empty state

```html
<div class="empty">
  <p class="empty-t">Nothing is listed here yet</p>
  <p class="sub">Your catalog is read from your business when this screen is built.</p>
  <p class="ctas"><a class="cta cta-quiet" href="../">Back to my business</a></p>
</div>
```

### Sidebar navigation

```html
<nav class="sidebar" aria-label="Primary">
  <ul class="sidenav">
    <li><a href="../business/" aria-current="page">Overview</a></li>
    <li><a href="../business/products/">Products</a></li>
  </ul>
</nav>
```

### Top bar

```html
<header class="topbar">
  <a class="mark" href="../">UNICA</a>
  <span class="topbar-business" id="topbar-business">Not signed in yet</span>
</header>
```

### Wallet chip

The served text is true without script. `assets/app.js` replaces it with the short address, the
network's name, and a way in or out.

```html
<div class="wchip" id="wallet-chip" data-prefix="../">
  <span class="wchip-line" id="wallet-chip-text">Your wallet is your sign-in. No account, no password.</span>
  <span class="wchip-addr">0x1234…5678</span>
</div>
```

### Status region and toast

```html
<p class="status" id="create-status" role="status" aria-live="polite">Nothing has been created yet.</p>
<p class="toast" id="saved" role="status" aria-live="polite" hidden></p>
```

`statusRegion()` is the one already used across the product; keep using it. The toast is for a
message that arrives after load, and it is empty in the served HTML — a toast with words already in
it was written by a page, not by an event.

### Product card and product list

```html
<ul class="product-list" id="product-list">
  <li class="product">
    <span class="product-name">Haircut</span>
    <span class="product-price">18.00</span>
    <span class="pill" data-status="active">Active</span>
  </li>
</ul>
```

### Order row

```html
<li class="order-row">
  <span class="order-ref"><a href="details/">Order 4821</a></span>
  <span class="order-when">Today, 14:02</span>
  <span class="order-amount">12.50</span>
  <span class="pill" data-status="pending">Waiting</span>
</li>
```

### Register keypad

Twelve real buttons, so it works from a keyboard and reads correctly aloud. The display is an
`<output>` live region big enough to read across a counter.

```html
<div class="register">
  <output class="amount-display" id="amount-display" aria-live="polite">0.00</output>
  <div class="keypad" id="keypad">
    <button type="button" class="key" data-key="1">1</button>
    <button type="button" class="key" data-key="00">00</button>
    <button type="button" class="key" data-key="backspace" aria-label="Delete the last digit">⌫</button>
  </div>
  <button type="button" class="cta charge" id="charge" disabled aria-describedby="charge-why">Charge</button>
  <p class="sub" id="charge-why">Disabled until an amount above zero has been entered.</p>
</div>
```

### Checkout card

Business identity, the lines, one total, one choice, one button, one status line. The status line is
the only thing on the page that may ever say a payment succeeded, and only after it has been checked.

```html
<section class="checkout" id="checkout">
  <div class="checkout-head">
    <p class="checkout-business" id="checkout-business">This business</p>
    <p class="sub" id="checkout-payname">—</p>
  </div>
  <div class="checkout-lines">
    <div class="checkout-line"><span>Haircut</span><span>18.00</span></div>
  </div>
  <div class="checkout-total"><span>Total</span><span id="checkout-total">18.00</span></div>
  <div class="asset-choice">
    <label for="checkout-asset">Pay with</label>
    <select class="field" id="checkout-asset"></select>
  </div>
  <button type="button" class="cta charge" id="checkout-pay" disabled aria-describedby="checkout-why">Pay</button>
  <p class="sub" id="checkout-why">Disabled until this payment has been read.</p>
  <p class="checkout-status" id="checkout-status" role="status" aria-live="polite">Waiting.</p>
</section>
```

### Stepper

```html
<ol class="stepper">
  <li data-state="done"><span class="step-mark">✓</span> Connect your wallet</li>
  <li data-state="current" aria-current="step"><span class="step-mark">2</span> Business name</li>
  <li data-state="todo"><span class="step-mark">3</span> Payout wallet</li>
</ol>
```

---

## What the tests hold you to

`tests/design.test.mjs`, run by `node --test apps/web/tests/*.test.mjs`:

1. the five brand tokens are on `:root`, `--radius` is `8px`, `--space` is `4px`, body text is 16px;
2. the contrast of `--on-accent` against `--accent` is recomputed from the hex, in both schemes, and
   must clear 4.5:1 — with a control proving the ratio function fails a pair that should fail;
3. `/`, `business/` and `pay/` emit the marketing, app and checkout layouts respectively;
4. every class named in THIS file exists in the stylesheet;
5. no `http`/`https` URL appears in the stylesheet;
6. every link in the left menu resolves to a document the build emitted;
7. only 400, 500 and 700 appear as font weights.
