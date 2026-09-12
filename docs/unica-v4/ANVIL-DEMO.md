# UNICA v4 — the complete local demonstration on Anvil

**LOCAL_ANVIL_NO_VALUE.** One command runs the whole vertical slice on a throwaway local chain: Uniswap v4
settlement through a registered, versioned UNICA market; ENSv2-style merchant and terminal identity with a
revoked terminal; a deterministic identity badge; authenticated pricing through the real Chainlink feed
adapter over fixture feeds; a confidential-policy authorization delivered as a **LOCAL CRE REPORT FIXTURE
— NOT A DON REPORT**; settlement evidence authenticated through the registry; and a POS that says PAID only
when the evidence says VERIFIED. Nothing here touches a public network, holds value, or signs with a key.

```sh
make anvil-test
```

That is `up → deploy → seed → demo → attacks → down`, failing on the first unexpected error and stopping the
node on every exit path. The stages are also individually runnable:

| Command | What it does | Refuses when |
|---|---|---|
| `make anvil-up` | starts a fresh Anvil on `127.0.0.1:8545`, chain id 31337, pinned genesis timestamp, auto-impersonation | — |
| `make anvil-deploy` | the whole fixture stack (below) and `deployments/31337.local.json` | the node's chain id is not 31337; Vyper is not exactly 0.4.3 |
| `make anvil-seed` | initialise the pool at the recorded opening price, add the $5-equivalent **demonstration** seed over the band-width range, prove SEEDED from PoolManager state, ACTIVATE | the market is not PROPOSED (a live market is never reseeded) |
| `make anvil-demo` | the sixteen-step barbershop scenario | any expected refusal stops refusing; the evidence layer does not return VERIFIED |
| `make anvil-attacks` | the adversarial matrix against the live local deployment | any case that must refuse settles, or any UNKNOWN case reads VERIFIED |
| `make anvil-down` | stops the node; leaves `.rehearsal/anvil/` for inspection | — |

Every RPC URL is loopback. Accounts are Anvil's default unlocked accounts — **public fixture keys that must
never be used on any public network** — read from the node with `eth_accounts` and impersonated, so no key,
mnemonic or credential exists in this repository. The forge script that deploys refuses any chain but 31337.

## What `anvil-deploy` lands, in order

1. Uniswap's **official PoolManager bytecode** (hookmate's artifact), owned by the admin account.
2. Two test tokens: `tAST` (18 decimals, the customer's asset) and `uUSD` (6 decimals, the merchant's settlement
   asset). Both no-value.
3. Two **FIXTURE** price feeds (`description()` starts with `FIXTURE `) behind the **real** `ChainlinkFeedAdapter`:
   the adapter code is the production one; only the feeds are stand-ins. `feedIdFor(tAST, uUSD)` is the route id.
4. `UnicaMarketFactory`, which creates `UnicaMarketRegistry` in its constructor (`registry == CREATE(factory, 1)`),
   with `requireOracle = true`.
5. One market: rate 2 uUSD per tAST (a demonstration rate the admin sets, never a market price), fee 3000, spacing
   60, oracle policy `(adapter, feedId, maxAge 300 s, 200 bps)`, caps `$10 / tx`, `$25 / day`, `$5 seed`. The hook
   lands at a mined CREATE2 address whose low 14 bits are `0x20C0`; the executor at `CREATE(hook, 1)`; the
   `(adapter, feedId)` pair is committed into `marketId` and re-checked by the registry at registration.
6. `LocalEnsV2Fixture` with the barbershop tree: `eth` → `unica.eth` (admin) → `freshcuts.unica.eth` (merchant
   owner; `addr` = the payout account) → `terminals.freshcuts.unica.eth` → `chair-1.` and `lost-tablet.`, each
   operator holding `SET_TEXT` at exactly one per-key resource, `com.unica.terminal-status`; plus
   `agent.freshcuts.unica.eth` holding one other key and no admission authority.
7. The identity token, compiled from `vy/src/art/identity_token.vy` with Vyper 0.4.3 and deployed by the same
   script (constructor: minter, authority, registry pointer, ENS deployment id, renderer version
   `unica-identity-svg/1`, verification URL base).
8. `LocalKeystoneForwarderFixture` and `UnicaPolicyReceiver` (forwarder, registry, release tag, workflow id,
   workflow owner, schema version 1).
9. `TerminalAdmission`, allowlisted on the registry as the market's order creator.
10. A **look-alike**: the same `UnicaMarketHook` source deployed by an attacker factory against a spoofed registry
    with the official `marketId` in its immutables. Its receipts match the real ones field for field; only the
    emitter address, checked against the official registry, tells them apart.

The manifest records every address with its code hash and size, the pool key, the market id and version, the
feed id, the accounts by role, the identity nodes, the renderer version and the `TEST_ONLY_NO_VALUE`
designation. Addresses are deterministic for a given commit only because the deployer nonces, the genesis and
the bytecode are pinned; the manifest is the record, not a promise.

## The sixteen steps of `anvil-demo`

| # | Step | Layer | Instrument |
|---|---|---|---|
| 1 | merchant identity exists | ENSV2 (local fixture) | deploy |
| 2 | the immutable identity badge is minted to the namespace controller | identity NFT | `demoPrepare()` |
| 3 | two terminals exist, both active | ENSV2 | deploy |
| 4 | `lost-tablet` is revoked: its per-key role removed, its status text `revoked` | ENSV2 | `demoPrepare()` |
| 5 | the lost tablet fails to request a new order | admission (BACKEND_POLICY over ENSV2) | `eth_call` → `TerminalNotAuthorized` |
| 6 | `chair-1` admits the exact payer-bound order; the policy record was delivered first | admission + CRE fixture | `demoAdmit()` |
| 7 | the wrong payer fails | UNICA_ONCHAIN | `eth_call` → `WrongPayer` |
| 8 | the bound payer approves exactly the input and pays | UNICA_ONCHAIN | `cast send` (hash recorded) |
| 9 | the route bound into the market equals `feedIdFor`; `oracleCondition()` is OK | UNICA_ONCHAIN + CHAINLINK | `eth_call` |
| 10 | the swap ran through the registered pool | UNISWAP_V4 | the same transaction |
| 11 | the merchant's payout balance grew by the delivered amount, ≥ minOut | UNICA_ONCHAIN | balance delta |
| 12 | hook receipt and executor `Settled` match in one transaction | evidence | `tools/unica-evidence` |
| 13 | the receipt is VERIFIED through registry → market → hook → executor → pool | GRAPH_EVIDENCE | `tools/unica-evidence` |
| 14 | the POS shows PAID, from that decision only | CLIENT_VERIFICATION | `tools/unica-pos-cli` |
| 15 | revoking `chair-1` after settlement changes neither the receipt nor the order; a new request from it is refused | ENSV2 + evidence | `cast send`, re-verify, `eth_call` |
| 16 | the look-alike hook settles on its own pool and its receipt is REFUSED | GRAPH_EVIDENCE | `lookalike()`, `tools/unica-evidence` |

The run prints a compact result block (see `tools/unica-pos-cli/cli.mjs --json-only`) with the environment,
merchant, terminal, order, oracle, policy, settlement and evidence sections, and writes
`.rehearsal/anvil/demo-record.json` for the attack stage.

## What `anvil-attacks` proves

Three instruments over the live local state: `test/anvil/Attacks.t.sol` on a fork of the node (exact revert
selectors, hook reverts unwrapped from the PoolManager's `WrappedError`), `eth_call` probes through an unmodified
client, and the evidence and POS layers' decisions. Every case prints one line:

```json
{"case":"LOOKALIKE_HOOK","decision":"REFUSED","reasonCodes":["UNREGISTERED_EMITTER","HOOK_PROVENANCE_MISMATCH"]}
{"case":"STALE_EVIDENCE","decision":"UNKNOWN","reasonCodes":["INDEX_BEHIND_REQUIRED_BLOCK"]}
```

No failed case is ever represented as a successful payment. The matrix covers the ORDER, MARKET, UNISWAP,
ENS/IDENTITY, CHAINLINK, EVIDENCE and POS/WALLET rows of the sprint brief; the enforcing layer of every row is
named in [`ENFORCEMENT-MATRIX.md`](ENFORCEMENT-MATRIX.md).

## Honest labels

- The price feeds, the CRE report, the forwarder, the ENSv2 registry and resolver are **local fixtures**. The
  adapter, the policy receiver, the admission gate, the market contracts and the identity token are the real
  code. The pinned ENSv2 Sepolia configuration lives in `integrations/ensv2/profile.mjs` and is not what runs here.
- The $5 seed is a **demonstration cap**. A haircut-sized payment that exceeds the configured limits is refused
  (`OrderAboveCap`, `PartialFill`, `OutputBelowMinimum`), which is the point of the row that tries it.
- The daily cap counts per market version: a same-day retire-and-relist restarts it (ruling V4). Tooling, not
  the chain, refuses deliberate evasion.
- The identity badge proves identity-art provenance only: never current name control, address ownership,
  merchant status, payment, receipt count or endorsement (rulings N1–N9).
- A successful forwarder transaction is not delivery. The receiver's own admission record is.
- Nothing in this document describes a public deployment. The Sepolia plan is a separate, owner-run handoff.

## Determinism and evidence

Pinned: Foundry (CI `v1.5.1`; locally the version the run records), solc 0.8.30, Vyper 0.4.3, Node 22, chain id
31337, genesis timestamp 1789084800, Anvil's default account set, deployment order, oracle fixture values,
pool initialisation from the recorded opening price, seed amount, order values, renderer version, report schema
version 1. Each `anvil-test` writes `.rehearsal/anvil/run-evidence.json` with the command, commit, toolchain,
start and end time, manifest hash, order id, settlement transaction, merchant balance delta, identity token,
receipt decision, look-alike decision and the statement that no external network was contacted. That directory
is gitignored; the committed evidence is this document and the CI lane that runs the same command.
