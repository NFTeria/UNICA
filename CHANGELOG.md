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

### Added — 2026-09-08

- **Chainlink CRE liquidation-protection policy** (`integrations/chainlink-cre-guardian/`). The
  challenge contract's integer health-factor model, transcribed from `ChallengeLending.calcHF`
  rather than described, with every rounding direction chosen toward safety and checked from both
  ends. 88 rows, nine mutations killed.
- **CRE workflow adapter** — deployment profiles with no default, an action builder with no
  parameter that could redirect a call, observation admission (stale, duplicate, reordered), and
  local evidence records that carry `LOCAL_SIMULATION` in a field nothing can change. 86 rows, ten
  mutations killed.
- **Circle Arc nanopayment modules** (`integrations/arc-nanopayments/`) — an independent verifier
  for a Gateway authorization, and a mandate binding the resource, request, response and budget
  that authorization does not cover. 141 rows.
- **ENSv2 configuration builder** (`integrations/ensv2/build.mjs`) — ten classified refusals and no
  argument that can carry a recipient.
- **V2 receipt verifier** (`tools/unica-verify/`) — recomputes the quote digest, recovers the
  merchant signer and rebuilds the PoolId rather than reading them back. 100 rows offline.
- **Vyper prior art landed and tested**: `merchant_policy.vy` (13 rows) and `payany_router.vy`
  (14 rows), plus the NameMath art contracts (20 rows). The Vyper workspace joined `make gate`.
- `docs/PRIOR-ART.md`, separating work authored here from work carried in.

### Changed

- The V2 fork quotes now commit to a **real** `MerchantConfig` preimage instead of a hash of a
  phrase, which is what let `tools/unica-verify` close `docs/v2/COMPATIBILITY-001.md` without
  touching the frozen receipt.
- The secret scan gained two narrow label words and a captured-artifact exclusion, each with its
  own control.
- README's status block replaced with a component table recomputed from `make gate`.

### Discovered

- **The challenge contract's liquidation boundary is higher than its threshold suggests.**
  `calcHF` floors and `checkAllHF` liquidates at `hf <= 100`, so an untouched starting position is
  liquidatable at any price at or below 1812.82 — and every published scenario, including the one
  named "safe volatility", liquidates a position that does nothing.
- **Circle Gateway batching is operational accounting, not a per-payment commitment.** No merkle
  root, batch id, inclusion proof or indexable event exists in the SDK; `settle` returns a batch
  transaction shared by every payment in it.
- `namemath.vy` had never compiled in any Vyper 0.4.x.

### Not claimed

No component added in this section is deployed. The CRE workflow is **not** deployed and `join()`
has not been called; the Circle modules have settled nothing; the Graph indexer is not on Studio.

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
