# Repository inventory — what exists, and where it lands in the target tree

Written on branch `unicaV4`, against `main` at `f492bb7`. Every row is a path that exists today.
Nothing here is a plan for code that does not exist; the target column says where the existing
thing goes, and **Move** says whether the migration touches its bytes.

`main` is unchanged and stays that way. The live page, the deployed contracts, the Studio
subgraph and the submission artifact are all reached from `main`, not from this branch.

## The rule this migration runs under

**Never remove the old door until the new one opens.** `web/` keeps working and keeps shipping
until `apps/web` can do everything it does. Both exist on this branch at once, on purpose.

## 1. The surface

| Today                                  | Target                                                              | Move                     | Note                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/index.html` (78 KB, one document) | `apps/web/app/**`, `apps/web/features/**`, `apps/web/components/**` | **Rewritten, not moved** | Its sections become routes; its `CFG` becomes `apps/web/config/`; its `:root` block becomes `apps/web/styles/tokens/`. Stays in place and keeps shipping until the replacement passes the same gate.                                                                        |
| `web/ensv2/resolve.mjs`                | `apps/web/adapters/identity/ens.ts`                                 | Rewritten as an adapter  | Currently imported directly by the page. Becomes one implementation behind `IdentityAdapter`, beside a `mock`.                                                                                                                                                              |
| `web/ensv2/keccak.mjs`                 | `apps/web/adapters/identity/` (internal)                            | Moved                    | A hashing dependency of the above, not a public module.                                                                                                                                                                                                                     |
| `web/README.md`                        | `apps/web/README.md`                                                | Rewritten                | Its four-stops table describes the single page and will not survive routes.                                                                                                                                                                                                 |
| `script/check-surface.sh`              | `scripts/verify-public-build.mjs`                                   | **Rewritten — blocking** | It greps the committed `web/index.html` for exact pins and banned phrases. The moment a build step exists it must read the BUILD OUTPUT instead, or it silently stops checking anything while still reporting green. This is the single highest-risk item in the migration. |
| `.github/workflows/pages.yml`          | `.github/workflows/build.yml` + `release.yml`                       | Rewritten                | Uploads `web/` verbatim today. Must upload the built artifact once one exists — and not before.                                                                                                                                                                             |

## 2. Contracts, indexer, tools

| Today                                                                            | Target                                                       | Move                   | Note                                                                                                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/v3/**` (live generation)                                                    | `packages/contracts/src/`                                    | Path move only         | Byte-identical. The deployed bytecode must stay checkable against its source.                                                                     |
| `src/v2/**` (specified, never deployed)                                          | `packages/contracts/src/`                                    | Path move only         | Already carries its own "not deployed, no audit" banner.                                                                                          |
| `src/V4SettlementHook.sol`, `src/SettlementExecutor.sol` (V1)                    | `packages/contracts/src/`                                    | Path move only         | Superseded but deployed; keep verifiable.                                                                                                         |
| `src/compat/**`, `src/libraries/**`                                              | `packages/contracts/libraries/`                              | Path move only         |                                                                                                                                                   |
| `src/lab/**`                                                                     | `packages/contracts/src/lab/`                                | Path move only         | Probes and studies. Quarantined by directory, labelled as such.                                                                                   |
| `test/**` (58 files)                                                             | `packages/contracts/test/{unit,integration,invariant,fork}/` | Regrouped              | `test/fork/**` and `test/v3/*Fork.t.sol` go to `fork/`; `test/attack/**` to `invariant/`.                                                         |
| `script/*.sol`, `script/v2/`, `script/v3/`                                       | `packages/contracts/script/`                                 | Path move only         |                                                                                                                                                   |
| `broadcast/**`                                                                   | `packages/contracts/deployments/`                            | Path move only         | The day-4 proof artifact. Committed on purpose; never regenerated.                                                                                |
| `foundry.toml`, `remappings.txt`                                                 | `packages/contracts/`                                        | Moved, paths rewritten | Every relative path inside them changes with the move.                                                                                            |
| `integrations/graph/**` (live manifest, V1+V3)                                   | `packages/indexer/`                                          | Path move only         | This is the manifest actually deployed to Studio.                                                                                                 |
| `integrations/graph-v2/**`                                                       | `packages/indexer/` or archived                              | **Decision needed**    | Its configured address is the fork-local V2 executor and V2 is deployed nowhere. Two manifests with one live is a trap for whoever reads it next. |
| `tools/unica-verify/**`, `tools/unica-sign/**`                                   | `packages/protocol` consumers, or `tools/` kept              | Undecided              | Read-only verifier and signer. They already depend on nothing private.                                                                            |
| `integrations/ensv2/**` (28 files)                                               | `packages/identity/` or `apps/web/adapters/identity/`        | **Decision needed**    | Read-only and sabotage-tested. Some is a browser concern, some is an owner-action tool; the split is not obvious.                                 |
| `integrations/{arc-treasury,arc-nanopayments,chainlink-cre-guardian,permit2}/**` | `integrations/` unchanged                                    | **Not moved**          | Exploratory. Moving them into `packages/` would imply they are product.                                                                           |
| `vy/**`                                                                          | `vy/` unchanged                                              | **Not moved**          | Its own README: "a model, not a product… nothing in it ever reaches a network."                                                                   |

## 3. Already correct, no target change

`Makefile` · `docs/**` (106 files) · `specs/**` · `lib/**` (vendored submodules) · `.github/workflows/ci.yml` ·
`script/*.sh` (gates, scans, proofs) · `README.md` · `SECURITY.md` · `LICENSE` · `AI_USAGE.md` ·
`CHANGELOG.md` · `FEEDBACK.md` · `HACKATHON.md` · `CLAUDE.md`

## 4. Absent today — built new, not migrated

`packages/protocol` (**landed**, commit `0487c18`) · `apps/web/**` · `apps/web/adapters/**` ·
`apps/web/mocks/**` · `local/anvil/**` · `local/indexer/**` · `scripts/*.mjs` ·
`.github/CODEOWNERS` · `.github/ISSUE_TEMPLATE/**` · `dependabot.yml` · every legal, support and
social-metadata file in the target tree.

## 5. Not in this repository at all

| Thing                     | Status                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Pulse**                 | Zero occurrences in the tracked tree. Separate repository; nothing here depends on it and nothing here should.                        |
| **AWS**                   | Absent from repository source — recorded with its own evidence commands in `docs/submission-media/tech-stack.md`.                     |
| **`unica.nfteria.click`** | Appears nowhere. `nfteria.click` occurs only as the commit-identity email. No `CNAME`, no DNS artifact.                               |
| **Private NFTeria code**  | Not referenced, not imported, not required. The public build has no private dependency today, and this migration must not create one. |

## 6. Migration order, and why it is this order

1. **Workspace root** — landed, `4d28e89`.
2. **`packages/protocol`** — landed, `0487c18`. Everything else imports it, so it goes first.
3. **`apps/web` shell, styles, foundational UI** — tokens extracted from the real `:root` block.
4. **Adapters and mocks** — before any component, so no component is ever written against a live
   provider and retrofitted later. This is the ordering mistake that is expensive to undo.
5. **Public pages**, then **merchant creation**, then **checkout**, then **receipts**.
6. **`scripts/verify-public-build.mjs`** — must be green before `web/` is retired, never after.
7. **Contracts, indexer, docs regrouped** — last, because moving them changes `foundry.toml`,
   `remappings.txt`, CI paths and the tool ledger all at once, and none of that is reversible
   cheaply while the application is still moving.
