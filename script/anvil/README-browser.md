# The business payment product in a browser, on a local chain — how to run it

This connects the whole customer-facing product in `apps/web/` to the local
LOCAL_ANVIL_NO_VALUE demonstration. It is the shop, not a test page: a business is added, a
register creates a payment, a customer pays it, and both sides get a receipt that is only ever
marked paid after it has been checked.

| screen | route | who is standing at it |
|---|---|---|
| Home | `/` | somebody deciding whether to use this at all |
| Add your business | `/join/` | the owner, once, from their own wallet |
| My business | `/business/` | the owner, between customers |
| Create payment | `/business/payments/new/` | whoever is behind the counter |
| Receipts | `/business/payments/` | the owner, or their accountant |
| Checkout | `/pay/` | the customer, on their own phone |
| Receipt | `/receipt/` | both of them, afterwards |

Everything stays on one machine, on loopback addresses. With a browser wallet installed the wallet
signs; without one, on the local practice network only, Anvil's own public fixture accounts are
used. No key is ever read, held or sent by any page here.

## Run it

```sh
# 1. build the static site once (re-run after any change under apps/web/)
node apps/web/build.mjs

# 2. bring up the local chain and its fixtures — leave this in its own terminal, or run the
#    individual steps if you already have a chain at a different stage:
make anvil-up        # fresh Anvil node, chain id 31337
make anvil-deploy    # the fixture contracts + deployments/31337.local.json
make anvil-seed      # opens the market's pool
make anvil-demo      # runs the barbershop scenario end to end and writes the demo record
#    (or: make anvil-test, which runs up/deploy/seed/demo/attacks and then tears the node down —
#    if you use that instead, run anvil-up again afterwards so a chain is left running for step 3)

# 3. serve the built site plus the small /local/ runtime-configuration API
bash script/anvil/serve.sh
```

`serve.sh` prints the exact URLs to open:

```
UNICA local demo server listening on http://127.0.0.1:8787/
Home:                  http://127.0.0.1:8787/
Add your business:     http://127.0.0.1:8787/join/
Business dashboard:    http://127.0.0.1:8787/business/
Create a payment:      http://127.0.0.1:8787/business/payments/new/
Customer checkout:     http://127.0.0.1:8787/pay/
```

`serve.sh` refuses to start at all if `deployments/31337.local.json` does not exist — run
`make anvil-up && make anvil-deploy && make anvil-seed` first. It binds `127.0.0.1` only.

## The business flow, end to end

1. **Add your business** (`/join/`). Seven questions, then one wallet confirmation: connect the
   wallet that will own the business, choose the name customers pay, say which wallet gets paid,
   choose the asset you want to receive, choose the assets customers may pay with, name your first
   register, and set a transaction limit if you want one. The confirmation is
   `join(label, payout, firstRegisterLabel)` on the onboarding contract, and it is the only
   transaction the screen sends.
2. **My business** (`/business/`). The name, "Ready to accept payments", the payout asset, every
   payment asset with what it can do right now, the active register, and the payments verified
   today. From here: Create payment, Receipts, Revoke register.
3. **Create payment** (`/business/payments/new/`). Type an amount, pick the currency the amount is
   written in, press one button. The register works out the rest and hands over a link and a square
   to scan, then waits for the check.
4. **Checkout** (`/pay/`). The customer reads the business, the amount due, the most they can be
   charged, what the business is guaranteed to receive, the fees, the network and the expiry, then
   confirms once in their own wallet.
5. **Receipt** (`/receipt/`). The same facts for both sides, downloadable and shareable, saying one
   of exactly three things (below).

## What a customer may read, and what only an auditor may

Every screen speaks in a shop's words. The protocol words — hook, executor, registry, pool, tick,
feed, calldata — appear in exactly one place: the **Advanced verification** disclosure, closed by
default, which carries the release, market id, the contract addresses, the pool, the oracle adapter
and feed id, the name lineage, the order hash, the transaction hash and the verification reason
codes. `apps/web/tests/parity.test.mjs` fails the build if one of those words appears on a product
screen outside that disclosure.

The vocabulary is a table in `apps/web/assets/product.js` (`LANGUAGE`) and is unit-tested:

| the machinery's phrase | what a person reads |
|---|---|
| Create market | Enable payment option |
| Execute swap | Process payment |
| Market active | Payment option available |
| No route | This payment asset is temporarily unavailable |
| Insufficient liquidity | This amount cannot currently be converted safely |
| Admission gate | Authorized terminal |
| Settlement evidence | Payment verification |
| Output token | Payout asset |

## Which payment assets are offered, and why

For each asset the deployment names, one of three answers, computed in `assetStatusFor`:

| answer | when |
|---|---|
| Available for direct payment | the asset IS the payout asset **and** the deployment carries a direct settler |
| Available with conversion | the deployment's market pair covers this asset and the payout asset, and its status is 4 (ACTIVE) |
| Temporarily unavailable | anything else, including an asset whose own symbol and decimal count could not be read from the network |

Two of those deserve saying plainly:

- **The direct settler is not part of the local deployment yet.** `contracts.directSettlement` is
  `null`, so a same-asset payment reads "Temporarily unavailable". The interface for that contract
  is `src/unica-v5/IDirectSettlement.sol`; when a deployment carries it, the same screens offer the
  direct route with no other change.
- **An asset that could not be labelled is not offered at all.** A manifest records addresses;
  symbols and decimal counts are read from the tokens themselves. If the chain is not answering,
  the screens say the asset is temporarily unavailable rather than show an amount at a guessed
  precision.

The cashier never chooses between the two settlement paths. `chooseSettlementRoute` picks the
direct settler when the assets match and the market path when they do not, and refuses before an
order exists if the deployment cannot do either. The customer reads only "No conversion needed" or
"Conversion included".

## What `/local/config.json` carries

One fetch feeds every screen. Besides `rpc`, `chainId`, `environment`, `manifest` and `record`:

| field | from | when absent |
|---|---|---|
| `assets[]` | `contracts.payoutToken` and `contracts.assetToken`, each with `role`, `address`, and the `symbol`/`decimals` read from the token itself | `symbol` and `decimals` are `null` and `labelled` is `false`; every screen shows that asset as temporarily unavailable |
| `marketPair` | `market.marketId`, `market.poolKey`, `market.poolId`, and `active` only at status 4 | `null` when the manifest names no market; nothing is offered as convertible |
| `contracts.directSettlement` | `contracts.directSettlement.address` | `null`; a same-asset payment is temporarily unavailable |
| `contracts.executor`, `.hook`, `.registry`, `.oracleAdapter` | the manifest's own addresses | `null` |
| `merchantOnboarding` | `contracts.merchantOnboarding.address` | `null`; the join screen says the local setup has no onboarding contract yet and stays static |
| `identity` | `contracts.identityFixture.address` | `null` |
| `identityToken` | `contracts.identityToken.address` | `null`; the badge falls back to the onboarding contract's own `badge()` |
| `parentNode`, `parentName` | `identity.parentNode`, `identity.parentName` | `null`; the screen shows `unica.eth` as the parent name |
| `terminalStatusKey` | `identity.terminalStatusKey` | `null`; the screen reads `TERMINAL_STATUS_KEY()` from the contract |

The function that builds this object is executed by `apps/web/tests/serve-config.test.mjs` straight
out of `serve.sh` (between two marker comments), so the served shape and the tested shape cannot
drift apart.

## The network label

Every screen carries **TESTNET / NO VALUE** above everything else. That label is not optional
decoration and it is enforced twice:

- **At build time.** `apps/web/build.mjs` refuses to emit a document that lacks it, unless the build
  was told `UNICA_BUILD_ENVIRONMENT=PUBLIC_MAINNET` — and in that case it refuses to emit one that
  still carries it. `apps/web/tests/build.test.mjs` runs the build both ways and checks both.
- **At run time.** `validateEnvironment` re-decides from the manifest the page is actually reading.
  Chain 31337 and chain 11155111 are always a test network whatever any field claims, and the word
  mainnet is only permitted when the manifest itself says `environment: "PUBLIC_MAINNET"`.

## The wallet layer (`apps/web/assets/wallet.js`)

Every screen connects through one file. It finds wallets announced by EIP-6963 and the older
`window.ethereum`, asks for accounts with `eth_requestAccounts`, reads `eth_chainId`, and decides
with one pure function (`chooseProvider`, tested in `apps/web/tests/wallet.test.mjs`):

| in this browser | configured network | what happens |
|---|---|---|
| a wallet, on the right network | any | the wallet is used; it signs in its own extension |
| a wallet, on another network | any | `wallet_switchEthereumChain` is requested; if declined, the page blocks with one sentence |
| no wallet | Local practice network (31337) | the chain's own unlocked account is used through the configured RPC |
| no wallet | Sepolia test network | blocked, with the sentence that says to install a wallet and reload |

`send(tx)` is the same call for both kinds. Nothing in the file names a private key or a recovery
phrase, and a test asserts the source does not.

## The one rule that may say Paid

`paymentStatus` in `tools/unica-pos-cli/render.mjs` is the only place a payment becomes PAID, and it
does so only when the payment verification answers `decision === "VERIFIED"`. Every screen imports
that function rather than restating the rule. A receipt therefore says exactly one of three things:

- **Paid (checked)** — verified against the network.
- **Declined** — "This transaction is not recognized as a valid UNICA payment."
- **Not confirmed yet** — "Payment sent; verification is still processing. Do not pay again."

A transaction hash, a mined receipt, a token, a resolved name and an indexer answer are all
insufficient on their own, and `apps/web/tests/product.test.mjs` checks each of those cases.

## Tests

```sh
node apps/web/build.mjs
node --test apps/web/tests/*.test.mjs
```

The glob form is deliberate: with Node 22, `node --test apps/web/tests/` treats the directory as a
single test file and reports one failure whatever the directory holds. The seven files are `build`,
`parity`, `product`, `local-pay`, `local-join`, `wallet` and `serve-config`; `build` and `parity`
print their own "checks run" totals, the rest use `node:test`.

## Honest limitations

- **Without a wallet, this is a loopback chain with public fixture accounts.** Every address
  involved is one of Anvil's own well-known, valueless default accounts. `eth_sendTransaction` on an
  `--auto-impersonate` Anvil node executes from any address named as `from`, which is the entire
  point of a LOCAL_ANVIL_NO_VALUE rehearsal and would be a critical vulnerability on any real chain.
  The wallet layer takes this path only when the configured chain is 31337 and no wallet exists.
- **A payment is bound to one customer wallet before it exists.** The settlement contracts refuse an
  order with no payer, so the register creates each payment for a named customer wallet: the one the
  demonstration record carries, or `?customer=0x…`. A scan-then-bind flow, where the customer's
  wallet is learned at the moment they scan, is NOT built.
- **The register prices a converted payment from the deployment's own oracle**, read at the moment
  the payment is created, and refuses to create one if that read fails. The allowed slippage is a
  single product constant (2.5%); there is no per-business setting for it.
- **The payout asset, the accepted assets and the transaction limit are register settings this
  browser keeps.** The onboarding call this release sends takes a name, a payout wallet and a first
  register, and nothing else. The join screen says so under the button rather than implying those
  three answers were written to a chain.
- **The square a customer scans is drawn by a QR library fetched from a public CDN.** With no
  internet the square is not drawn, the screen says so, and the link — which is the whole payment —
  is still there.
- **The dashboard counts "today" by the network's own clock** when the record carries one, because a
  practice chain's time can sit years from the browser's. The screen says which clock it used.
- **The register list is rebuilt from the identity contract's own logs.** That is right for the
  local fixture, whose events this repository defines; a different identity authority would need a
  different reader.
- **`/local/evidence` re-derives evidence from the live chain on every call**; if the Anvil node is
  not running it answers `decision: "UNKNOWN"`, which every screen shows as "Not confirmed yet".
- **No automated reconnect.** If Anvil is restarted, re-run `make anvil-deploy && make anvil-seed &&
  make anvil-demo` and reload; `serve.sh` re-reads the manifest and record on every request.
- **The end-to-end press of "Create payment" against a running chain is NOT RUN in this change.**
  Every screen was loaded in a browser against `serve.sh` with the chain down, and each one degrades
  to a stated refusal rather than a blank or a guess; the pricing, route choice, asset status,
  language, environment and PAID rules are unit-tested; but no order has been created from the
  register through a wallet in this pass.
