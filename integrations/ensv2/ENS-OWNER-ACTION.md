# ENSv2 — what needs the owner's wallet

Everything in this directory is read-only. Every number below was produced by `eth_call`,
`eth_getCode`, `eth_getStorageAt`, `eth_getLogs` or `eth_estimateGas` against live Ethereum
Sepolia, and nothing in this repository can sign or broadcast a transaction. The steps that change
state are listed here because they are the owner's to take, in the owner's own wallet.

Re-derive anything on this page rather than trusting it:

```sh
node integrations/ensv2/permissioned-live.mjs            # the whole evidence capture
node integrations/ensv2/authz-sim.mjs                    # the two authorization rows
node integrations/ensv2/preview.mjs <name> <address>     # the exact transaction to sign
```

**No key, no seed phrase and no owner-controlled address appears anywhere in this repository.**
Where a step needs one, it says "the account you control" and the command discovers it from the
chain. If a command ever asks you to paste a private key, that command is not from this repository.

---

## What is already true, with no owner action at all

Measured on Sepolia at block 11663994, chain id `11155111`:

| observed | value |
|---|---|
| `UpgradableUniversalResolverProxy` | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`, 2491 bytes |
| `PermissionedResolverImpl` | `0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e`, 17597 bytes |
| a live ENSv2 name's own resolver | a 77-byte proxy whose ERC-1967 slot points at the implementation above |
| the authorization contrast | the deployed resolver **accepted** the authorised account and **refused** an unauthorised one, in the same block, for the same calldata, with `EACUnauthorizedAccountRoles` |
| wildcard resolution | an unregistered subname is answered by the **same** resolver as its parent |

That contrast is the evidence the ENSv2 track asks for and it costs nothing, needs no wallet, and
is reproducible by anyone with a public Sepolia endpoint. **Nothing below is required for it to
hold.** The steps below are what it takes for UNICA to own a merchant name rather than to observe
somebody else's.

---

## Step 1 — register a name on Sepolia ENSv2, from an account you control

**Why:** UNICA's merchant identity is an ENSv2 name. Until the owner controls one, every live row
this repository prints is about a name somebody else registered.

**How:** the ENS beta app for the Sepolia ENSv2 deployment. Register a `.eth` name — `unica.eth` if
it is free on that testnet, otherwise any label you will keep.

**What it costs:** Sepolia test ETH for the registration plus gas. Test ETH is free from a faucet;
there is no real money on this path at any point.

**Do not** register from an account whose key is used for anything else in this repository's
deployments. The ENS name's controller is a long-lived identity; a deploy key is not.

**What becomes true:** the registration deploys *your own* Permissioned Resolver proxy and grants
your account roles at that resolver's `ROOT_RESOURCE`.

**How to prove it:**

```sh
node integrations/ensv2/permissioned-live.mjs <your-name>.eth
```

The run must report the resolver's code size, an ERC-1967 implementation of
`0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e`, and **not** `NOT_A_PERMISSIONED_RESOLVER`. That last
status is what a name still served by the ENSv1 mirror returns — `vitalik.eth` on Sepolia returns
exactly that today, which is how you can see the check is real before you have a name of your own.

---

## Step 2 — point the name at UNICA's settlement recipient

**Why:** this is the record the checkout reads. `web/ensv2/resolve.mjs` resolves the name, the
payer is shown the address, and `integrations/ensv2/config.mjs` commits that reading into the
merchant's signed configuration. Until this record is set, the name resolves to nothing and the
checkout refuses with `ZERO_ADDRESS` — which is the correct behaviour and not a bug.

**The exact transaction to sign:**

```sh
node integrations/ensv2/preview.mjs <your-name>.eth <the settlement recipient address>
```

It prints a JSON object carrying `REQUIRES_OWNER_WALLET_CONFIRMATION` and every field a wallet
needs: `chainId`, `to`, `from`, `value`, `data`, the decoded call, the live `eth_estimateGas`
result, and the authorization check that must hold. It refuses to print anything at all if the
chain does not show your account holding `ROLE_SET_ADDR` — a preview that cannot say who may sign
it is not a preview.

**What it costs:** the measured estimate for `setAddr(bytes32,address)` against a live Permissioned
Resolver is **44,339 gas**. At the Sepolia gas price observed on 2026-09-08 (1.07 gwei) that is
about **0.000047 Sepolia ETH** — test ETH, so it costs nothing real. Gas price moves; re-read it
with `eth_gasPrice` before you sign rather than trusting this line.

**What becomes true:** `addr(namehash("<your-name>.eth"))` returns the settlement recipient, and
the UNICA checkout resolves the name to that address with status `RESOLVED`.

**How to prove it:**

```sh
node integrations/ensv2/live-check.mjs          # the resolution path, classified
node integrations/ensv2/permissioned-live.mjs <your-name>.eth
```

The second run's authorised row must print `ACCEPTED` from your account and `REFUSED` from the
derived probe address, and the preview section must print your recipient as the target.

---

## Step 3 — delegate the record to an operator, without giving away the name

**Why:** this is the feature the ENSv2 track is actually about, and it is the one UNICA needs
operationally. A merchant should be able to let an operator rotate the payout address without
handing over the name, and Enhanced Access Control is exactly that: a role bitmap granted to an
account against one resource.

**What this repository can and cannot tell you here — read this before you sign anything:**

- `grantRoles(uint256,uint256,address)` → `0x7c300586` and
  `authorizeAddrRoles(bytes,uint256,address,bool)` → `0x587eefd1` are both present as PUSH4
  dispatch constants in the deployed implementation's runtime. That is strong evidence they exist.
- **Neither has been exercised.** No live call in this repository has reached either one, so their
  argument order and semantics are `DOCUMENTED_NOT_OBSERVED` in `permissioned.mjs`'s ledger and
  this repository does **not** build a preview for them.
- The per-text-key and per-coin-type resource derivations are in the same position: derived from
  the documentation, never named back by the chain. Every live refusal observed so far named the
  **name-level** resource `keccak256(node ‖ bytes32(0))` — including refusals of `setText` and
  `setAddr(bytes32,uint256,bytes)`, which the documentation would have you expect to check the
  finer resource.

**So the honest instruction is:** make this grant through the ENS app's own interface, not from
calldata this repository built. Then come back and prove it from the chain:

```sh
node integrations/ensv2/permissioned-live.mjs <your-name>.eth
```

The operator account will appear in the run's candidate list with a non-zero role bitmap, and
`authz-sim.mjs` will accept a `setAddr` simulated from it. At that point the interface ledger can
be promoted from `DOCUMENTED_NOT_OBSERVED` — by measurement, not by assumption.

**What it costs:** one transaction in Sepolia test ETH. The estimate is not stated here because
this repository has not built the calldata and will not guess at a gas figure for a call it has
never made.

---

## Step 4 — managed merchant subnames (optional, and it needs no transaction per merchant)

**Why:** an operator that hands out `<merchant>.<parent>` gives every merchant a name without a
registration for each one. This already works and is already proven: the live run shows an
unregistered subname resolved by the **same** Permissioned Resolver as its parent — that is ENSv2
wildcard resolution.

**What needs the owner:** nothing, to demonstrate it. Setting a *record* on a specific subname is
one transaction, the same shape as Step 2, and `preview.mjs` will build it once
`managedSubname(parent, label)` is used to derive the node.

**What is deliberately NOT claimed:** a subname resolving through the parent's resolver returns the
zero address until a record is set. `web/ensv2/resolve.mjs` classifies that as `ZERO_ADDRESS` and
refuses to hand it to a checkout, and that refusal is the entire reason that classification exists.

---

## The order, and what blocks what

| # | action | needs a wallet | blocks |
|---|---|---|---|
| 0 | run the live evidence capture | no | nothing — do this first |
| 1 | register a Sepolia ENSv2 name | yes | steps 2 and 3 |
| 2 | `setAddr` to the settlement recipient | yes | a live checkout against your own name |
| 3 | grant an operator a role | yes | promoting the ledger rows to observed |
| 4 | set a record on a managed subname | yes | per-merchant demonstration |

Steps 0 and 4's *resolution* half are done and evidenced. Steps 1–3 are the owner's.

## What must never appear in this repository

No private key, no seed phrase, no keystore path, no RPC URL carrying a token, and no address that
could only have come from a wallet the owner has not published. `permissioned-test.mjs` scans every
`.mjs` file in this directory on every gate run and fails if any of them names a writing JSON-RPC
method in code, or reads anything that looks like a key. That check is validated by sabotage on
every run: it is fed a known-bad line and must catch it, and a known-good line and must pass it.
