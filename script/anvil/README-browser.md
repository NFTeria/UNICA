# Browser + local Anvil demo — how to run it

Connects two browser screens from `apps/web/` to the local LOCAL_ANVIL_NO_VALUE demonstration:

- `/pay/` — a customer pays a sale, the same settlement `script/anvil/demo.sh` narrates on the
  command line, from a page instead.
- `/join/` — a business owner adds a business from their own wallet: a pay name, where the money
  goes, a first register and a business badge, in one transaction.

Everything below stays on one machine, on loopback addresses. With a browser wallet installed the
wallet signs; without one, on the local practice network only, Anvil's own public fixture accounts
are used. No key is ever read, held or sent by any page here.

## Run it

```sh
# 1. build the static site once (re-run after any change under apps/web/)
node apps/web/build.mjs

# 2. bring up the local chain and its fixtures — leave this in its own terminal, or run the
#    individual steps if you already have a chain at a different stage:
make anvil-up       # fresh Anvil node, chain id 31337
make anvil-deploy    # the fixture contracts + deployments/31337.local.json
make anvil-seed      # opens the market's pool
make anvil-demo      # runs the barbershop scenario end to end and writes the demo record
#    (or: make anvil-test, which runs up/deploy/seed/demo/attacks and then tears the node down —
#    if you use that instead, run anvil-up again afterwards so a chain is left running for step 3)

# 3. serve the built site plus the small /local/ runtime-configuration API
bash script/anvil/serve.sh
```

`serve.sh` prints the exact URLs to open, for example:

```
UNICA local demo server listening on http://127.0.0.1:8787/
Pay screen:            http://127.0.0.1:8787/pay/
Join screen:           http://127.0.0.1:8787/join/
Pay screen (this order): http://127.0.0.1:8787/pay/?order=<orderId from .rehearsal/anvil/demo-record.json>
  as the wrong payer:    http://127.0.0.1:8787/pay/?order=<orderId from .rehearsal/anvil/demo-record.json>&as=0x0000000000000000000000000000000000000001
```

`serve.sh` refuses to start at all if `deployments/31337.local.json` does not exist — run
`make anvil-up && make anvil-deploy && make anvil-seed` first. It binds `127.0.0.1` only.

## What `/local/config.json` carries

One relative fetch feeds both screens. Besides `rpc`, `chainId`, `manifest` and `record` it now
exposes, read from the manifest on every request:

| field | from | when absent |
|---|---|---|
| `merchantOnboarding` | `contracts.merchantOnboarding.address` | `null`; the join screen says the local setup has no onboarding contract yet and stays static |
| `identity` | `contracts.identityFixture.address` | `null` |
| `identityToken` | `contracts.identityToken.address` | `null`; the badge falls back to the onboarding contract's own `badge()` |
| `parentNode`, `parentName` | `identity.parentNode`, `identity.parentName` | `null`; the screen shows `unica.eth` as the parent name |
| `terminalStatusKey` | `identity.terminalStatusKey` | `null`; the screen reads `TERMINAL_STATUS_KEY()` from the contract |

The function that builds this object is executed by `apps/web/tests/serve-config.test.mjs`
straight out of `serve.sh` (between two marker comments), so the served shape and the tested shape
cannot drift apart.

## The wallet layer (`apps/web/assets/wallet.js`)

Both screens connect through one file. It finds wallets announced by EIP-6963 and the older
`window.ethereum`, asks for accounts with `eth_requestAccounts`, reads `eth_chainId`, and decides
with one pure function (`chooseProvider`, tested in `apps/web/tests/wallet.test.mjs`):

| in this browser | configured network | what happens |
|---|---|---|
| a wallet, on the right network | any | the wallet is used; it signs in its own extension |
| a wallet, on another network | any | `wallet_switchEthereumChain` is requested; if declined, the page blocks with one sentence |
| no wallet | Local practice network (31337) | the chain's own unlocked account is used through the configured RPC (the previous behaviour) |
| no wallet | Sepolia test network | blocked: "No wallet was found in this browser. Install a browser wallet, open it on Sepolia test network, and reload this page." |

`send(tx)` is the same call for both kinds: `provider.request("eth_sendTransaction")` for a wallet,
RPC `eth_sendTransaction` for the local account. Nothing in the file names a private key or a
recovery phrase, and a test asserts the code does not.

## The join flow (`/join/`)

Five steps on one page, in the order a person does them:

1. **Connect wallet.** The wallet becomes the owner of the business; only it can add or revoke
   registers later.
2. **Business name.** Checked live as you type: the page calls the contract's `isValidLabel` and
   then `nodeOf` and says "Your pay name will be `<label>.unica.eth`. It is free." or "... is already
   taken. Try another name." The name rule is stated in one sentence when the label is refused.
3. **Where the money goes.** This wallet by default; a checkbox reveals a field for another address.
4. **Name your first register.** Default "Register 1", saved as `register-1` (the page shows the
   saved form under the field).
5. **Add my business.** One button, disabled until every step above is met, with the first unmet
   step named beside it. The wallet confirms **one** transaction: `join(label, payout, firstLabel)`
   on the onboarding contract, encoded by the dynamic-string ABI encoder in `local-join.js`, which is
   tested against calldata produced independently with `cast calldata`.

When the network confirms, the page reads the `BusinessJoined` record back from the receipt (or from
the chain's logs, filtered by the owner) and shows: business name, pay name, first register
**Active**, the business badge (the token's own `tokenURI` image), the practice-mode banner, and two
actions:

- **Take a payment** — a link to `/pay/`.
- **Registers** — the list of registers under this business, each with its status word and, when
  active, a **Revoke** button. Below it, **Add a register**: three wallet confirmations from the
  owner's wallet, each announced as "Step n of 3": `register(terminalsNode, label, owner)` on the
  identity contract, then `authorizeTextRoles(node, statusKey, operator, true)`, then
  `setText(node, statusKey, "active")`. Revoking does `authorizeTextRoles(..., false)` for each
  current operator, then `setText(..., "revoked")`, the same order `script/anvil/demo.sh` uses.

A wallet that already owns a business is told so and shown its details straight away, read from the
chain; the form is not offered twice.

The only hex a business owner sees is a short id (`0xf20516…bb12`) behind a **Details** disclosure,
with a button that copies the full value for a support conversation.

## What each pay-screen state means

- **Sale** fills in from the demo record once `serve.sh` answers, in the dictionary's words:
  Business, Pay name, Register, Amount you pay, They receive (at least ...), Network ("Local
  practice network"), Expires (a countdown), Fees once a receipt exists. Where the money goes, the
  business badge and the sale id sit under **Details**. The "Practice mode, test money only" label
  is always shown once this panel renders.
- **Wallet** — "Connect a wallet" runs the wallet layer above. `?as=0x…` still selects a different
  local account than the sale's bound customer, to see the wrong-customer blocker fire; it applies
  only to the local unlocked-account path.
- **When this page disables everything** — a live list of every blocker currently in force, each
  as one sentence: wrong network (the server's chain, or the connected wallet's chain, disagrees
  with the manifest), a different customer wallet, an expired sale, a revoked register. Every
  blocker in force is listed at once, not just the first one found.
- **Pay** — sends `approve(executor, amountIn)` on the input asset, then `pay(orderId)` on the
  executor, both hand-ABI-encoded in `local-pay.js`, both through `wallet.js`. The status line moves
  "Sent" → "Waiting for the network to confirm..." and only ever reaches **Paid (checked)** once
  `GET /local/evidence?order=` answers with `decision === "VERIFIED"`: the rule lives in
  `tools/unica-pos-cli/render.mjs` and `local-pay.js` only turns its answer into words. A bare
  transaction hash or an unauthenticated receipt reads "Not confirmed yet." and a refused one reads
  "Declined." If the sale was already paid by `make anvil-demo` itself, this page never re-sends it;
  it checks and shows a **Check again** button instead.
- **Payment check** — the decision in dictionary words, with the raw JSON `tools/unica-evidence`
  returned under **Details**.

## Tests

```sh
node --test apps/web/tests/*.test.mjs
```

The glob form is deliberate: with Node 22, `node --test apps/web/tests/` treats the directory as a
single test file and reports one failure whatever the directory holds (checked against a one-test
scratch directory). The six files are `build`, `parity`, `local-pay`, `local-join`, `wallet` and
`serve-config`; `build` and `parity` print their own "checks run" totals, the rest use `node:test`.

## Honest limitations

- **Without a wallet, this is a loopback chain with public fixture accounts.** Every address
  involved is one of Anvil's own well-known, valueless default accounts. `eth_sendTransaction` on an
  `--auto-impersonate` Anvil node executes from any address named as `from`, which is the entire
  point of a LOCAL_ANVIL_NO_VALUE rehearsal and would be a critical vulnerability on any real chain.
  The wallet layer takes this path only when the configured chain is 31337 and no wallet exists.
- **The join screen needs a manifest that names `merchantOnboarding`.** Until the local deployment
  includes that contract, `/local/config.json` answers `null` for it and the page says "This practice
  setup has no onboarding contract yet, so a business cannot be added here." Nothing is sent.
- **The register list is rebuilt from the identity contract's own logs** (`SubnameRegistered` under
  the business's `terminals` node, then `RolesGranted`/`RolesRevoked` at each register's status
  resource). That is right for the local fixture, whose events this repository defines; a different
  identity authority would need a different reader.
- **The expiry countdown compares the sale's deadline against the browser's wall clock**, not the
  local chain's pinned block timestamp. Cosmetic only; it never affects the PAID rule.
- **`/local/evidence` re-derives evidence from the live chain on every call**; if the Anvil node is
  not running it answers `decision: "UNKNOWN"` with `EVIDENCE_ENDPOINT_UNAVAILABLE`, which the page
  shows as "Not confirmed yet."
- **No automated reconnect.** If Anvil is restarted, re-run `make anvil-deploy && make anvil-seed
  && make anvil-demo` and reload; `serve.sh` re-reads the manifest and record on every request.
- **Browser verification of the join flow against a running onboarding contract is NOT RUN in this
  change.** The encoder, decoders, readers and the wallet chooser are unit-tested with `cast`
  vectors and fake providers; the end-to-end press of "Add my business" waits for a manifest that
  carries the contract.
