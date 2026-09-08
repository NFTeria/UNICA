# integrations/ensv2 — ENSv2 resolution, authorization, and the evidence for both

Two things live here. **Resolution** answers "which address does this merchant name point at", and
**authorization** answers "who may change that answer". The second is the one that makes a name an
identity rather than a lookup, and it is where ENSv2's Permissioned Resolver and Enhanced Access
Control do the work.

The resolution module itself is **not here**. It lives at [`web/ensv2/`](../../web/ensv2/), because
the checkout surface publishes `web/` exactly as committed — no install, no build, no transform — so
the page has to be able to import it directly. Keeping one copy under `web/` and testing it from
here beats keeping two copies in step. Everything in this directory imports it read-only.

## Files

| file | what it is |
|---|---|
| `test.mjs` | resolution: 136 offline rows. `node integrations/ensv2/test.mjs`, add `--live` for Sepolia |
| `live-check.mjs` | resolution evidence: one success and every failure shape, with the wire encoding, namehash, resolver and classification printed |
| `config.mjs` · `build.mjs` · `merchant-id.mjs` · `policy.mjs` · `identity.mjs` | the chain from a resolved name to a signable V2 quote |
| `identity-test.mjs` · `demo.mjs` | that chain's suite, and the one-command walk through it |
| **`permissioned.mjs`** | **the ENSv2 authorization layer: selectors derived from signatures, role constants, resource ids, and a live read of who may edit a name** |
| **`authz-sim.mjs`** | **the two-row authorization contrast, simulated with `eth_call` — no wallet, no gas, no key** |
| **`preview.mjs`** | **the transaction the owner would sign, and the wall in front of it** |
| **`permissioned-test.mjs`** | **278 offline rows, deterministic, replaying wire bytes captured from live Sepolia** |
| **`permissioned-live.mjs`** | **78 live rows: addresses with observed code sizes, every probe labelled with which observation it produced, and the two authorization rows** |
| `ENS-OWNER-ACTION.md` | the ordered list of what needs the owner's wallet, what it costs, and how to prove it afterwards |
| `fixtures/` | policy wire bytes, and the ENSv2 observations the offline suite replays |

## Commands

Every count below is the number the command's own summary line prints. If they disagree, the
command is right and this table is stale — check it rather than quoting it.


```sh
node integrations/ensv2/test.mjs                    # resolution, offline       136 rows
node integrations/ensv2/test.mjs --live             # …plus real names on Sepolia
node integrations/ensv2/identity-test.mjs           # name → policy → quote      offline
node integrations/ensv2/demo.mjs                    # the whole chain, one command
node integrations/ensv2/permissioned-test.mjs       # authorization, offline    278 rows
node integrations/ensv2/permissioned-live.mjs       # authorization, live        78 rows
node integrations/ensv2/authz-sim.mjs [name]        # just the two rows
node integrations/ensv2/preview.mjs [name] [addr]   # the owner's transaction, as JSON
node integrations/ensv2/live-check.mjs              # resolution evidence
```

`make gate` runs the offline suites. `make gate-live` adds the ones that touch Sepolia.

## What is live, and what is prepared

This section exists because the difference matters more than the feature list.

**Live, today, reproducible by anyone with a public Sepolia endpoint and no wallet:**

- ENSv2 resolution through `UpgradableUniversalResolverProxy`, with every failure shape classified.
- The per-name **Permissioned Resolver** discovered from the chain: the UniversalResolver names it,
  its code size is read, and its ERC-1967 implementation slot is read back and confirmed to point at
  `PermissionedResolverImpl`.
- **Enhanced Access Control read live**: `roles`, `roleCount`, `hasRootRoles`, `hasAssignees` and
  `getAssigneeCount` all decode against the deployed resolver.
- **The authorization contrast**: the same `setAddr` calldata, offered to the same contract in the
  same block, is ACCEPTED from the account the chain says holds `ROLE_SET_ADDR` and REFUSED from a
  derived probe address, with `EACUnauthorizedAccountRoles` naming the resource and the role.
- **Wildcard resolution**: an unregistered subname is answered by the same resolver as its parent —
  which is what makes `<merchant>.<parent>` possible without a transaction per merchant.
- A live `eth_estimateGas` for the edit, and the complete preview object for it.

**Prepared, and honestly labelled as not yet observed:**

- `grantRoles` and the `authorize*Roles` family. Their selectors are present as PUSH4 dispatch
  constants in the deployed runtime, but **no live call has reached them**, so `permissioned.mjs`'s
  ledger marks them `PUSH4_IN_RUNTIME` and this repository builds no calldata for them.
- The **per-text-key** and **per-coin-type** resource derivations. Both are derived here from the
  documentation; neither has been named back by the chain. Every live refusal observed so far —
  including refusals of `setText` and `setAddr(bytes32,uint256,bytes)`, where the documentation
  would lead you to expect the finer resource — named the **name-level** resource
  `keccak256(node ‖ bytes32(0))`. Recorded as `DOCUMENTED_NOT_OBSERVED`, and the offline suite
  fails if anyone promotes them without a measurement.
- **Record aliasing.** `getAlias` answers on the deployed resolver, so the feature is implemented.
  No alias is configured on any name this repository reads, so aliasing is *available*, not
  *demonstrated*.
- A name **UNICA itself owns**. Every live row above is read from a name somebody else registered.
  Registering one is step 1 of [`ENS-OWNER-ACTION.md`](ENS-OWNER-ACTION.md).

**Two things measured that a reader should know:**

- `getAssigneeCount(uint256,uint256)` is documented as returning one `uint256`. The deployed
  contract returns **two words**. The run prints what it got and does not interpret the second one.
- A bounded `eth_getLogs` scan for `EACRolesChanged` over a **load-balanced public endpoint** is
  **not deterministic**: three consecutive runs over the same block range returned one matching log,
  then none, then one. So the log scan only ever *adds* names to the holder list. The authority on
  how many holders exist is the contract's own `roleCount`, and `permissioned-live.mjs` prints that
  number beside the number it could name, on every run, whether or not they agree.

## Why the tests inject the caller

`resolveMerchant` takes an `rpcCall`; `readAuthorization` takes a `chain`. That is not indirection
for its own sake: a live network will not produce a malformed return, a truncated address or a
resolver with no code on demand, and those are exactly the shapes that must be refused. The offline
rows synthesise them; the live rows exist because a mock proves the module handles a shape, never
that the shape is real.

The fake chain in `permissioned-test.mjs` **throws on any call it was not taught**, rather than
answering `0x`. A fake that returned an empty value for an unrecognised selector would make a typo
in a signature look like a contract that does not implement the function — and an empty return
reading as "no roles", and "no roles" reading as safe, is the exact failure this module exists to
keep visible.

## Nothing here can broadcast

No signer is imported, no key is read from any environment variable or file, and no writing
JSON-RPC method is named in code anywhere in this directory. `permissioned-test.mjs` scans every
`.mjs` file here on every gate run and fails if that stops being true — and it validates itself by
sabotage on every run, catching a known-bad line and passing a known-good one, so a guard that has
never fired is not mistaken for a guard that works.

## Provenance

Signatures, role constants and resource derivations were read from
<https://docs.ens.domains/ensv2/permissioned-resolver> and
<https://docs.ens.domains/ensv2/enhanced-access-control> on 2026-09-08 (ENS documentation is
CC0-1.0), then checked against the deployed runtime. No ENS implementation source is copied:
`ensdomains/contracts-v2` publishes no licence, so only documented signatures are used, and every
selector in this directory is *derived* from its signature string rather than transcribed.
