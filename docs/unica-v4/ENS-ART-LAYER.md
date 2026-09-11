# UNICA v4 — ENS Art Layer Plan

Planning document only. Nothing described below is implemented — no file exists yet under
`vy/src/art/` or `vy/src/math/`. This expands `docs/unica-v4/DECISIONS.md`, "ENS art layer"
(H1–H12, owner, 2026-09-11); it restates those decisions, it does not amend them.

## 1. Status and scope

- **Status: planned, not implemented.** This document is the plan; the code it describes does
  not exist until the separate commit sequence in §9 executes it.
- **Start condition:** work on this layer begins only after the v4 specification is committed
  (`docs/unica-v4/DECISIONS.md`, "ENS art layer", H12). Until that commit lands, this plan is the
  only artifact.
- **Cut condition:** if the deadline becomes unsafe, this is the first stream cut. v4 tests,
  review gates and security work are never weakened to finish it instead (H12).
- **Path isolation:** the art layer sits entirely outside the settlement path. No hook, executor,
  registry, factory or oracle adapter depends on it, enforced by a dependency-boundary test (H3,
  §5).
- **Scope ceiling:** minimum scope only — namemath, logobackground, their strictly required math
  dependencies, and a new SVG renderer (H2). Loan, credit, tax, tokenomics, pricing and any other
  legacy module are parked and never implied to be part of UNICA v4 (H2).

Sources: `docs/unica-v4/DECISIONS.md`, "ENS art layer" section, H2, H3, H12 (repo file, read
2026-09-11).

## 2. Decisions applied (H1–H12)

One line each; full text is binding in `docs/unica-v4/DECISIONS.md`, "ENS art layer" (owner,
2026-09-11). This plan restates, it does not amend.

- **H1** — New work lives in this public MIT repo under `vy/src/art/` and `vy/src/math/`,
  isolated from settlement, deployment tooling and market configuration; no new repository unless
  licensing/dependency review later forces one.
- **H2** — Minimum scope: namemath, logobackground, their strictly required math, and a new SVG
  renderer only.
- **H3** — Math/SVG stay outside the settlement path; enforced by an import/dependency-boundary
  test.
- **H4** — ERC-721 `tokenURI` returns metadata containing on-chain SVG; the ENS `avatar` record
  points to that NFT in the standard NFT-reference format, verified against current ENS docs
  before implementation.
- **H5** — First implementation on `unica.eth` merchant subnames, ENSv2 Sepolia only; no mainnet
  change.
- **H6** — Same normalized name + same renderer version → same art, forever; a change needs a new
  renderer version, never a mutation of old output.
- **H7** — Descriptive module names (namemath, logobackground, svgrender), no unexplained legacy
  snake names.
- **H8** — One exact pinned stable Vyper version, verified on the implementation date; no
  caret/floating range.
- **H9** — Moccasin unit, property/fuzz, deterministic rendering, and malformed-input tests, plus
  a local Anvil fork of Sepolia for the full flow; nothing broadcast without separate approval.
- **H10** — The Sept 8 legacy copies stay unchanged; the new implementation lives beside them in
  versioned paths; the new renderer imports only the new version.
- **H11** — The art is bound to the normalized name + renderer version and shown beside the
  independently ENS-resolved payout identity at checkout; the image alone is never proof;
  mismatches are warned. ENSv2 on Sepolia stays sponsor #2 in the permanent sponsor order.
- **H12** — Plan and document now; implement only after the v4 spec is committed; first cut if the
  deadline is unsafe.

## 3. Architecture

### 3.1 Layout

New, not yet created:

```
vy/src/math/
  namemath_v2.vy          # planned name — see H7; exact name fixed at implementation
vy/src/art/
  logobackground_v2.vy    # planned name — see H7
  svgrender.vy
  art_token.vy            # the ERC-721
```

Existing, unaffected by this plan (legacy, §8):

```
vy/src/namemath.vy         # Sept 8 copy — unchanged
vy/src/logobackground.vy   # Sept 8 copy — unchanged
```

The names above are illustrative pending H7's constraint (descriptive names, no unexplained
legacy snake names); the binding requirement is the directory split (`vy/src/math/` vs
`vy/src/art/`) and non-import of the legacy files (H1, H10), not the specific filenames shown.

### 3.2 Modules and what each strictly needs

- **namemath (new, under `vy/src/math/`).** The legacy copy models seeded planar polynomial
  automorphisms with a small on-chain seed registry, self-contained with no imports
  (`vy/src/namemath.vy`, read 2026-09-11). The new version reuses that model's math, not its bytes
  (never copy — CLAUDE.md), and is the renderer's only dependency for coordinate generation.
- **logobackground (new, under `vy/src/art/`).** The legacy copy derives a deterministic 4-step
  transform, per-cell colour and 5-colour palette purely from `keccak256(name)`, likewise
  self-contained with no imports (`vy/src/logobackground.vy`, read 2026-09-11). The new version
  supplies palette and cell colour to svgrender.
- **svgrender (new).** Consumes namemath's coordinates and logobackground's palette/colour output;
  assembles the SVG document and, per the common on-chain-metadata pattern, a
  `data:application/json;base64,...` JSON with an embedded `data:image/svg+xml;base64,...` image
  field. This base64-JSON wrapping is a widely used community convention, not a requirement of
  EIP-721 or ENSIP-12 themselves, which require only that `tokenURI` return a URI and that the
  resolved image be jpeg/png/svg+xml (facts, retrieved 2026-09-11). Vyper's fixed-size
  `String[N]`/`Bytes[N]` types mean svgrender and the token's `tokenURI` must declare bounds sized
  for the actual SVG this renderer produces — reference implementations sized for far smaller
  output (e.g. `String[512]`, 1024 bytes in / 1368 chars out) are not adequate defaults here (fact,
  derived from snekmate v0.1.2, retrieved 2026-09-11); exact bounds are an implementation-time
  sizing task, not fixed by this plan.
- **the ERC-721 art token (new).** Holds `tokenURI`, mint/ownership bookkeeping, and calls
  svgrender. Whether its ERC-721/base64 machinery is vendored or written from scratch is open
  (§7, §10).

Neither namemath nor logobackground nor svgrender nor the art token is imported by any settlement
contract, script or test (H3, §5).

### 3.3 Determinism rule

`output = f(normalized_ens_name, renderer_version)` — never a function of mutable data such as a
payout address, merchant configuration, or on-chain state that can change after mint (H6, H11). A
renderer change is a new `renderer_version`, never a mutation of prior output (H6).

### 3.4 ENS name normalization

**UNKNOWN.** ENSIP-15 is the current ENS name-normalization standard by name, but its text had not
been verified as of 2026-09-11 — normalizing per an unverified recollection would violate the
primary-sources-only rule. Before implementation, fetch and cite
`docs.ens.domains/ensip/15` (or its canonical `raw.githubusercontent.com/ensdomains/ensips`
source) directly, record the retrieval date, and add the resulting normalization rule as a
decision line (see §10, open question).

Sources: `vy/src/namemath.vy`, `vy/src/logobackground.vy` (repo files, read 2026-09-11); snekmate
v0.1.2 `erc721.vy`/`utils/base64.vy` (github.com/pcaversaccio/snekmate, retrieved 2026-09-11);
EIP-721 and ENSIP-12 (facts, retrieved 2026-09-11).

## 4. ENS avatar flow

### 4.1 NFT-reference format

Per ENSIP-12 (Final, 2022-01-18), the `avatar` text record for an NFT-backed avatar uses the
CAIP-22/CAIP-29 format:

```
eip155:<chainId>/erc721:<contractAddress>/<tokenId>
```

ENSIP-12 requires clients to support at least ERC721 and ERC1155 (docs.ens.domains/ensip/12,
retrieved 2026-09-11). CAIP-22 defines the `erc721` reference as the contract address "in the
current chain_id" under the `eip155` namespace, which is chain-agnostic — it is not restricted to
chain id 1 (raw.githubusercontent.com/ChainAgnostic/CAIPs, CAIP-22, retrieved 2026-09-11). Neither
spec's text excludes testnets; ENSIP-12's own worked example happens to use `eip155:1`, but that
is an example, not a restriction (fact, retrieved 2026-09-11). For H5 (ENSv2 Sepolia first), the
value is `eip155:11155111/erc721:<art_token_address>/<tokenId>`, using the chain id this repo's
own ENSv2 Sepolia measurements already record (`integrations/ensv2/ENS-OWNER-ACTION.md` and
`README.md`, chain id 11155111, block 11663994, repo files, read 2026-09-11).

### 4.2 Resolution steps a client performs (ENSIP-12)

1. Retrieve the metadata URI for the token (the art token's `tokenURI`).
2. Resolve it and fetch ERC721 metadata.
3. Extract the `image` field.
4. Resolve and use that as the avatar.

A client SHOULD additionally call `addr()` on the same resolver/name (or use the reverse-resolved
address) and verify that address owns the referenced NFT; if not, the avatar URI is treated as
invalid (docs.ens.domains/ensip/12, retrieved 2026-09-11).

**Open risk, not yet resolved:** whether any ENSIP-12-compliant off-the-shelf client actually
performs this resolution for a Sepolia (non-mainnet) NFT reference in practice is unconfirmed by
any test run as of 2026-09-11 (fact) — see §10.

### 4.3 Checkout display and the mismatch warning

At checkout, the application shows the art beside the **independently resolved** payout identity —
it does not read the identity back out of the NFT image. Concretely:

- The checkout resolves the merchant's payout address the same way settlement does (via the
  existing ENSv2 resolution path), independent of the avatar NFT.
- It separately resolves the avatar per §4.2 and performs the same ownership cross-check ENSIP-12
  describes.
- If the two disagree — the avatar's apparent owner does not match the independently resolved
  payout address — the checkout shows a clear warning. **The image alone is never treated as proof
  of payout identity** (H11).
- The module that performs the checkout's live ENS resolution (`web/ensv2/resolve.mjs`, per
  `integrations/ensv2/README.md`'s own description of where it lives) was not read as of
  2026-09-11, so its exact constants are not re-verified here (fact) — the implementation step must
  read it directly rather than relying on this plan's description.

### 4.4 Write-path caution

No live call in this repository has yet exercised `setText` (the write that would set an `avatar`
record) or the role grants that would authorize it; the repo's own `ENS-OWNER-ACTION.md` marks
registration and `setAddr` as owner-wallet steps not yet done (repo file, read 2026-09-11).
Separately, whether the Permissioned Resolver's access control scopes `setText` to a per-key
resource (e.g. specifically the `avatar` key) or only to the whole name is labelled
`DOCUMENTED_NOT_OBSERVED` in this repo's own provenance notes — every refusal actually observed
named the name-level resource (`integrations/ensv2/permissioned.mjs` and `README.md`, repo files,
read 2026-09-11). Setting a real `avatar` record is therefore an owner-wallet, separately-approved
action, not something this plan's tests perform live (§6, §9).

## 5. Dependency-boundary test

**Claim to prove:** no settlement contract, script or test imports the art or math layer (H3).

**Mechanism:** a single test (run as part of the existing `mox test` gate) that:

1. Enumerates every `.vy` file under `vy/src/` **outside** `vy/src/art/` and `vy/src/math/` — i.e.
   `bushmaster.vy`, `constrictor.vy`, `egg_eater.vy`, `rattler.vy`, `sidewinder.vy`, the two legacy
   files, and everything under `vy/src/unica/`.
2. Scans each for an `import` statement (or moccasin-style module path) referencing `art` or
   `math`.
3. Asserts zero matches; the test fails loudly if any settlement-side file starts depending on the
   art layer.
4. Separately enumerates any non-`.vy` script/test that deploys or calls settlement contracts (the
   `script/` and `vy/tests/test_*.py` files that are not `test_namemath.py` /
   `test_logobackground.py` / their future art-layer successors) and asserts none of them import a
   module path under `vy/src/art/` or `vy/src/math/`.

This test is written before the first art-layer module lands (§9, commit 2) so it starts green on
an empty layer and stays the gate as modules are added — a boundary test that only exists after
the boundary could already be crossed proves nothing.

Source for the rule being enforced: `docs/unica-v4/DECISIONS.md`, "ENS art layer", H3 (repo file,
read 2026-09-11).

## 6. Test plan

Following this workspace's existing pattern (`vy/tests/conftest.py`: session-scoped fixtures for
pure/stateless contracts, function-scoped fixtures for stateful ones, because state from one test
must not leak into the next — repo file, read 2026-09-11):

- **Moccasin unit tests** for namemath (new), logobackground (new), svgrender and the art token,
  mirroring the existing shape of `vy/tests/test_namemath.py` and `test_logobackground.py`
  (same-seed-same-output, different-seed-different-output, one-character-name-change-changes-
  everything, palette/colour is a computed invariant — repo files, read 2026-09-11).
- **Property/fuzz tests**: the injective-map and unimodular-Jacobian style properties already
  proven for the legacy modules (`test_the_map_is_injective_on_the_grid`,
  `test_every_generated_affine_is_unimodular` — repo file, read 2026-09-11), re-proven for the new
  versioned implementation, not assumed to carry over from the legacy files.
- **Deterministic rendering golden tests**: for a fixed set of normalized names and a fixed
  renderer version, pin the expected `tokenURI` output (or its hash) as a golden value; any diff
  without a `renderer_version` bump fails the test (enforces H6 directly).
- **Malformed-input tests**: names that fail ENS normalization, empty names, oversized names, and
  any input the legacy modules already show "fails closed beyond the declared grid" for
  (`test_evaluation_is_total_on_the_declared_grid_and_fails_closed_beyond_it`, repo file, read
  2026-09-11) re-proven for the new implementation.
- **Local Anvil fork of Sepolia** simulating the complete avatar + NFT-resolution flow end to end:
  fork Sepolia at a pinned block, deploy the art token locally on the fork, simulate (not
  broadcast) setting an `avatar` text record, then run the ENSIP-12 four-step resolution (§4.2)
  against the fork and assert it recovers the expected image and passes the ownership cross-check.
  **Nothing is broadcast** — this is a fork simulation, per H9 and the standing operating rule
  against any anvil broadcast.

## 7. Toolchain

- **Compiler pin: Vyper 0.4.3 exactly**, no caret or floating range (H8). This is the latest
  stable release as of 2026-09-11 (published 2025-06-18); the 0.5.0 line is still pre-release
  (0.5.0a1 through b1) and not eligible under H8's "latest approved stable" test (fact,
  GitHub/PyPI release APIs, retrieved 2026-09-11). If a newer stable ships before the actual
  implementation date, H8 requires re-verifying "latest approved stable" then, not assuming 0.4.3
  forever.
- **Evidence**: the exact compiler version and build hash are recorded as generated evidence (H8),
  following this repo's existing pattern of committing generated evidence rather than asserting a
  version in prose alone.
- **ERC-721 base — open, not decided by this plan:**
  - *Vendor snekmate*: v0.1.2 (tagged 2025-06-25) pins `pragma version ~=0.4.3`, compatible with
    H8's pin; snekmate's `main` branch does not (`~=0.5.0a4`, alpha-only), so only the tagged
    release is usable under H8. snekmate is AGPL-3.0-only per GitHub's license API, with MIT
    available on request for specific use (facts, retrieved 2026-09-11) — vendoring it means
    accepting AGPL-3.0 terms for that vendored portion of an otherwise-MIT repo unless a separate
    MIT grant is obtained, and it would need disclosure as a vendored dependency (CLAUDE.md,
    "Never copy" section's allowance for disclosed public starter kits/libraries). snekmate's own
    `tokenURI`/base64 bounds (`String[512]`, 1024/1368 bytes) are undersized for on-chain SVG and
    would need widening regardless (fact, retrieved 2026-09-11).
  - *Write from scratch*: matches the MIT repo's stated preference to avoid a dependency's licence
    question entirely, but means writing ERC-721 + base64 encoding from the spec (CLAUDE.md,
    "Never copy" — writing from the description is the required method either way). Vyper has no
    base64 builtin (docs.vyperlang.org built-in-functions reference, retrieved 2026-09-11), so
    this path is pure from-scratch implementation work, not a shortcut.
  - Vyper's own example ERC-721 (`examples/tokens/ERC721.vy`) is explicitly marked "NOT MEANT TO
    BE USED IN PRODUCTION" and has no on-chain SVG/metadata machinery — it is a reference for
    shape only, never a copy source (fact, retrieved 2026-09-11; CLAUDE.md "Never copy").
  - `vy/moccasin.toml` currently has no `[project].dependencies` key and both `vy/lib/pypi` and
    `vy/lib/github` are empty (repo files, read 2026-09-11) — so today, nothing is vendored, and
    this decision has not been made. It is listed as an open question in §10, not resolved here.

## 8. Legacy handling

- `vy/src/namemath.vy` and `vy/src/logobackground.vy` (the Sept 8 public copies) **stay
  unchanged** for provenance (H10). They are not touched, renamed, or deleted during this work.
- Both are already self-contained, with no imports and no ERC-721 dependency (repo files, read
  2026-09-11) — nothing about the new layer requires touching them to build beside them.
- The new renderer imports **only** the new versioned implementation under `vy/src/math/` and
  `vy/src/art/` (§3.1) — never the legacy files (H10, H7).
- The legacy files are marked legacy **in documentation**, not in code comments added to them and
  not by altering the files themselves (H10).
- Removing or replacing the legacy copies is a later, separately reviewed step — explicitly not
  part of this build (H10).

## 9. Commit sequence and stop points

One idea per commit (repo law; H10). Proposed order — each point below is one commit, pushed
within minutes of the last per repo convention, not batched:

1. Scaffold empty `vy/src/math/` and `vy/src/art/` with a short README marking the layer
   planned-not-implemented.
2. Add the dependency-boundary test (§5) so it is green against an empty layer and becomes the
   gate for everything that follows.
3. Record the toolchain decision (§7): the Vyper pin confirmation and, if vendoring, the
   `moccasin.toml` dependency entry plus its licence disclosure — as evidence, not prose alone.
4. New math module (the namemath successor) with its unit and property tests.
5. New art module (the logobackground successor) with its unit and property tests.
6. svgrender module with deterministic golden tests.
7. The ERC-721 art token (`tokenURI` wiring) with malformed-input tests.
8. The local Anvil-fork simulation test of the full avatar + NFT-resolution flow (§6) — simulation
   only.
9. Checkout-side wiring for "art beside independently resolved payout identity" and the mismatch
   warning (§4.3) — application code, separate commit from the contracts.
10. Documentation: mark the legacy files legacy in prose, capture toolchain evidence, close out
    this plan's status line.

**Stop points, all commits:**

- No broadcast to any network, at any step (standing rule; H9).
- No ENS record write (`setText` or equivalent) outside a local fork simulation — a real `avatar`
  record on ENSv2 Sepolia is an owner-wallet action requiring separate approval (§4.4).
- No NFT mint, on any network including testnet, without separate approval beyond this plan.
- v4 tests, review gates and security work are never weakened to hit any of the above (H12).

## 10. Open questions and UNKNOWNs

- **ENSIP-15 normalization** (§3.4): not verified as of 2026-09-11; fetch and cite
  `docs.ens.domains/ensip/15` directly before implementation.
- **Vendor vs. from-scratch ERC-721/base64** (§7): unresolved; carries a real licence choice
  (AGPL-3.0 vendored portion vs. from-scratch MIT) that `docs/unica-v4/DECISIONS.md` H1/H2 does
  not itself settle.
- **Per-key EAC resource scoping for `setText`**: labelled `DOCUMENTED_NOT_OBSERVED` by this
  repo's own notes — only name-level refusals have actually been observed; whether the `avatar`
  key can be scoped separately from the rest of the name's text records is unconfirmed
  (`integrations/ensv2/permissioned.mjs`, read 2026-09-11).
- **Real-world client support for a Sepolia NFT-reference avatar**: ENSIP-12/CAIP-22 do not
  exclude testnets in text, but no client behaviour had been tested as of 2026-09-11 — whether
  wallets/explorers actually resolve a `eip155:11155111` avatar reference in practice is
  unverified.
- **Exact `web/ensv2/resolve.mjs` constants**: not reviewed as of 2026-09-11; the
  checkout integration step (commit 9, §9) must read that file directly rather than relying on
  this plan's description of it.
- **Registration/resolver state of `unica.eth`** (or any UNICA-controlled ENSv2 Sepolia name):
  `ENS-OWNER-ACTION.md` describes registration and `setAddr` as owner-wallet steps and, in its own
  text, treats them as not yet done; no live chain query was run for this plan.
- **On-chain SVG gas cost**: no gas benchmark exists yet for a several-KB on-chain SVG `tokenURI`
  on this toolchain; §7's sizing concerns are structural (fixed-size type bounds), not measured gas
  figures.
- **Vyper 0.5.0 stabilizing before the implementation date**: as of 2026-09-11, 0.4.3 is latest
  stable and 0.5.0 is still beta; H8 requires re-checking "latest approved stable" at
  implementation time rather than assuming 0.4.3 holds.
- **Exact new module file names** (§3.1): illustrative only; H7 fixes the naming convention, not
  this plan.
