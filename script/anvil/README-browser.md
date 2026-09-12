# Browser + local Anvil demo — how to run it

Connects the smallest existing browser screen (`/pay/`, from `apps/web/`) to the local
LOCAL_ANVIL_NO_VALUE demonstration, so a reader can watch the same settlement `script/anvil/demo.sh`
narrates on the command line happen from a page in a browser instead. Everything below stays on one
machine, on loopback addresses, with Anvil's own public fixture accounts. No wallet, no key, no real
value, ever.

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

`serve.sh` prints the exact URL to open, for example:

```
UNICA local demo server listening on http://127.0.0.1:8787/
Pay screen:            http://127.0.0.1:8787/pay/
Pay screen (this order): http://127.0.0.1:8787/pay/?order=0x784dfac9a852886bbdd22e0391d099059ccc01d7a30b4c8e9962599774f66539
  as the wrong payer:    http://127.0.0.1:8787/pay/?order=0x784dfac9a852886bbdd22e0391d099059ccc01d7a30b4c8e9962599774f66539&as=0x0000000000000000000000000000000000000001
```

Open the "Pay screen (this order)" URL. If `make anvil-demo` has not been run yet, the page still
loads (it always builds and serves as a plain static site); the "Payment terms" panel will say no
demo order has been recorded yet.

`serve.sh` refuses to start at all if `deployments/31337.local.json` does not exist — run
`make anvil-up && make anvil-deploy && make anvil-seed` first. It binds `127.0.0.1` only.

## Query forms

- `/pay/` — the plain static page. With no companion server running (or `serve.sh` not started),
  it stays exactly the document `apps/web/build.mjs` produced: no script on this page can make it
  claim anything the served HTML does not already say.
- `/pay/?order=0x…` — the only query form the page itself reads by name. Once `serve.sh`'s
  `/local/config.json` answers, the order shown is always the one demo.sh recorded — the query
  parameter is accepted for shape but the page renders from the local demo record, not from
  whatever is typed in the link, the same "never trust the link alone" discipline the built `/pay/`
  and `/receipt/` routes already document.
- `/pay/?order=0x…&as=0x…` — `as` selects a different connected address than the order's bound
  payer, to see the `WRONG_PAYER` blocker fire. Use one of Anvil's own unlocked accounts (or any
  address at all — the check is a plain string comparison, not an allowlist) other than the
  payer `script/anvil/demo.sh` used (Anvil account index 3).

## What each state means

- **Payment terms** fills in from the demo record once `serve.sh` answers: merchant name and full
  address, the identity-art provenance line (token contract:id and renderer version — explicitly
  labelled "not proof of address ownership"), the exact input amount and the guaranteed minimum
  output, the network name and chain id, an expiry countdown, and the settlement fees once a
  receipt exists. The `[TEST MODE]` / "no real value" labels are always shown once this panel
  renders.
- **Wallet** — "Connect a wallet" reads the local chain's unlocked accounts (`eth_accounts`) and
  treats the connected payer as the demo record's own bound payer, or the `?as=` override. No
  private key is ever read, held, or sent; every transaction is `eth_sendTransaction({from})`
  against an already-unlocked Anvil account (the same impersonation `script/anvil/lib.sh`'s
  `send_as` uses from the shell).
- **When this page disables everything** — a live list of every blocker currently in force:
  `WRONG_NETWORK` (the demo server's own `chainId` disagrees with its manifest),
  `WRONG_PAYER` (`?as=` names a different address than the order's bound payer),
  `ORDER_EXPIRED` (past the order's on-chain deadline), `TERMINAL_REVOKED` (the terminal that
  admitted this order is not recorded `ACTIVE`). Every blocker in force is listed at once, not
  just the first one found.
- **Pay** — sends `approve(executor, amountIn)` on the input asset, then `pay(orderId)` on the
  executor, both hand-ABI-encoded in `apps/web/assets/local-pay.js`, both sent as plain
  `eth_sendTransaction` calls with no signature. The status line moves
  `Submitted → Waiting for network confirmation (hash) → …` and only ever reaches **Paid** once
  `GET /local/evidence?order=` answers with `decision === "VERIFIED"` — a bare transaction hash or
  a mined-but-unauthenticated receipt is never shown as Paid. If the order the demo record names
  was already settled by `make anvil-demo` itself, this page never re-sends it: it goes straight to
  checking evidence and shows a **Verify again** button instead, which only ever re-reads evidence,
  never resubmits a transaction.
- **Verified receipt** — the raw JSON `tools/unica-evidence` returned, with its `decision` and
  `reasonCodes` restated in a line above it, exactly as `/receipt/`'s own evidence key already
  promises elsewhere on this site.

## Honest limitations

- **This is a loopback chain with public fixture accounts, not a wallet.** Every address involved
  is one of Anvil's own well-known, unfunded-of-real-value default accounts. There is no seed
  phrase anywhere in this flow because there is no real key at all — `eth_sendTransaction` on an
  `--auto-impersonate` Anvil node executes from any address named as `from`, which is the entire
  point of a LOCAL_ANVIL_NO_VALUE rehearsal and would be a critical vulnerability on any real chain.
- **The expiry countdown compares the order's on-chain deadline against the browser's real
  wall-clock time**, not the local chain's own (pinned, and frequently rewound) block timestamp. A
  chain seeded at a past or future pinned genesis will therefore show a countdown that does not
  match "when `make anvil-demo` actually ran" — cosmetic only; it never affects the PAID rule, which
  reads only `evidence.decision`.
- **`/local/evidence` re-derives evidence from the live chain on every call** (it re-runs
  `tools/unica-evidence`'s `projectEvidence` + `authenticateReceipt`, the same two functions
  `tools/unica-evidence/cli.mjs` and `script/anvil/demo.sh` already use), so if the Anvil node is not
  running, this endpoint answers `200` with `{"decision":"UNKNOWN","reasonCodes":["EVIDENCE_ENDPOINT_UNAVAILABLE"]}`
  rather than failing the whole page — verified by hand by stopping Anvil mid-session and reloading.
- **No automated reconnect.** If Anvil is restarted (a fresh chain has a fresh set of contract
  addresses), re-run `make anvil-deploy && make anvil-seed && make anvil-demo` and reload the page;
  `serve.sh` itself does not need restarting, since it re-reads the manifest and record from disk on
  every request.
