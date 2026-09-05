# CHANGELOG

Every released state of UNICA, newest first. Format follows Keep a Changelog; versions follow
semantic versioning over the **on-chain contract generation**, not over the documentation.

Two things this file keeps apart, because conflating them is how a release note becomes a lie:

- the **deployment tag** — the commit whose `src/` produced the bytecode that is live;
- the **documentation HEAD** — whatever commit this file is read at, which is normally later.

A version heading below describes contracts. Documentation, scripts, the web surface and the
indexer move independently and are listed under Unreleased until a contract generation ships.

No tag is created by this file. Creating or pushing a public release tag is an owner action.

## [Unreleased]

Documentation, tooling and specification work on top of the 1.0.0 contract state. `src/` and
`test/` are untouched by everything in this section — verify with
`git diff --stat live-green..HEAD -- src/ test/`, which prints nothing.

### Added

- `docs/INPUT-POLICY-SPEC.md` — the generic ERC-20 payer-input policy, with UNI as the first
  worked example. Specification; not implemented.
- `docs/PAYOUT-POLICY-SPEC.md` — the immutable, chain-specific payout-asset policy and its
  red-test matrix. Specification; not implemented.
- `docs/ABI-MIGRATION-REPORT.md` — what an expected-payout-currency field would cost across the
  struct, the order id, the web surface, the indexer and the deterministic addresses.
- `docs/feedback/` — one file per partner, with Robinhood nested under Uniswap.
- `docs/upstream/` — seven drafted upstream reports, none filed.
- `docs/DEMO.md`, `docs/DEMO-SHOTLIST.md` — the recording sequence and what may be claimed.
- `docs/PUBLISHING.md` and `.github/workflows/pages.yml` — the publish path, prepared and gated
  on a repository variable so it stays skipped until the owner enables it.
- `integrations/graph/STUDIO-PREFLIGHT.md` and `verify-hosted.sh` — pre-deployment checks and a
  hosted-query verifier. No subgraph is deployed.
- `script/tag-green.sh` — a milestone tag is refused unless CI is green for that exact commit,
  the proof passes, and every document that must name the tag does.
- `script/topup-live.sh`, `script/settle-live.sh`, `script/check-surface.sh`.

### Changed

- `web/index.html` reads seven pinned values back from the chain and disables its action if any
  of them disagrees, rather than trusting a configuration file.
- `script/scan.sh` matches secret-shaped strings case-insensitively, with a lowercase control row.
- Public language trimmed to what is demonstrated.

### Fixed

- The settle stage's order deadline is measured from the simulation, not the broadcast: forge
  simulates the whole run before it asks for the keystore password, and a one-hour deadline aged
  out in between. Cause, fork reproduction and fix in `docs/DEPLOYMENT.md`.
- The local end-to-end indexer run forks the live head instead of a pre-deploy block, which a
  public node keeps no state for.

## [1.0.0] — proposed, not yet tagged

**This heading describes a state that exists on chain and in the history; the semantic-version
tag does not exist yet.** Until the owner creates it, refer to this release as `live-green`.

Proposed target: commit `5e1d843`, which is exactly what `live-green` already points at.

Why that commit and not a later one: `src/` and `test/` are byte-identical from `live-green` to
HEAD, and `docs/proof/verify-live.sh` is unchanged, so `live-green` is both the implementation
boundary and the proof boundary. The thirty-one commits after it are documentation, scripts, the
web surface and indexer tooling — none of them changed a contract or a test.

### Added — the first settlement generation

- `V4SettlementHook`, live on Ethereum Sepolia, admitting a swap only from Uniswap's Universal
  Router with the settlement executor behind it, enforcing the order's recipient, minimum and
  full fill, and emitting a versioned settlement receipt.
- `SettlementExecutor`, which registers orders and composes the router's plan so the output is
  taken to the order's recipient. It holds no balance and is not a router.
- Receipt schema version 1, frozen as a conformance suite.
- A subgraph indexing that receipt, as one consumer among any.
- A public surface with one action.
- 54 tests, including an attack suite and the four-row native-settlement drill.

### Known limitations at 1.0.0

Native ETH input only; USDC payout only; Ethereum Sepolia only; testnet only; not audited. See
`docs/versions/V1.md` for the full list.
