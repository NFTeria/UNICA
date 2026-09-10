# The rollback boundary

What is published, what is merely committed, and how to get back to a known-good published state at
every stage of the `apps/web` migration. Written on branch `unicaV4`; `main` is unchanged.

## 1. What ships today

| Fact | Value |
|---|---|
| Publishing workflow | `.github/workflows/pages.yml` |
| Upload step | `actions/upload-pages-artifact` |
| **Upload path, before this batch** | **`web`** |
| **Upload path, after this batch** | **`web` — unchanged** |
| Build step | none. The directory is uploaded exactly as committed |
| Deploy condition | `vars.PAGES_ENABLED == 'true'`, plus the `check` job passing |
| Files served | `index.html`, `README.md`, `ensv2/resolve.mjs`, `ensv2/keccak.mjs` |

The artifact **is** the source. That is why `script/check-surface.sh` can read `web/index.html` by
name and still be a gate on the published bytes.

## 2. What is on this branch and is NOT published

Nothing added on `unicaV4` reaches the site. `packages/protocol`, `packages/adapters` and
`scripts/` are not inside the uploaded directory, are not imported by anything inside it, and add
no build step in front of it. The verifier proves the first of those on every run: it reports the
directory it resolved, and that directory is `web`.

Confirm it in one command:

```bash
node scripts/verify-public-build.mjs | head -1
```

## 3. The two gates, and why both run

| Gate | Reads | Correct while |
|---|---|---|
| `script/check-surface.sh` | `web/index.html`, by name | the artifact is the source |
| `scripts/verify-public-build.mjs` | the `path:` resolved from `pages.yml` | always |

They run side by side on purpose. A drift row inside the verifier asserts that **every pin it holds
is also asserted by `check-surface.sh`**, so the two cannot quietly disagree about which deployment
the page names. That row is what makes redundancy safe rather than merely duplicated.

## 4. Rolling back

**A change on `unicaV4` broke something.** Nothing is published from this branch, so there is
nothing to roll back. `main` is the published lineage.

```bash
git checkout main && git rev-parse --short HEAD   # the lineage Pages publishes from
```

**A published page is wrong.** Revert the commit that changed `web/` and let the workflow run
again. The upload path never moved, so the previous commit's `web/` is a complete, working artifact
on its own — no build, no install, no lockfile, no toolchain.

```bash
git revert <sha> && git push        # pages.yml re-runs on any push to main touching web/**
```

**Publishing must stop immediately.** Set the repository variable `PAGES_ENABLED` to anything other
than `true`. The `deploy` job is skipped, not failed, and the previously deployed artifact stays up.

**The verifier itself is suspect.** It is not on the critical path yet: `check-surface.sh` is still
the incumbent, and removing the two new steps from `pages.yml` restores the previous gate exactly.
Before trusting it either way, run its own controls — a verifier that has never failed is not one:

```bash
node scripts/verify-public-build.mjs --self-test
```

## 5. When `web/` may be retired — the boundary, not yet crossed

`web/` stays the publishable artifact and the rollback target until **all** of the following are
true. None of them is true today.

1. `scripts/verify-public-build.mjs` passes against a **built** output directory, not a source one.
2. `pages.yml` uploads that built directory, and the verifier's resolution follows it there — proven
   by its own self-test, which repoints a throwaway copy of the workflow and requires the resolution
   to move.
3. The built output passes every family the current directory passes: pins, routes, claims,
   external tags, assets, metadata.
4. The built output is reproducible from a clean clone with a pinned lockfile, and the produced
   bytes are recorded.
5. A published preview of the built output has been opened and a payment completed through it.
6. `check-surface.sh` has been retargeted or retired **deliberately**, with its replacement green
   first. Never the other way around: replacement precedes removal.
7. The owner has approved the transition, having seen the before-and-after upload path in writing.

Until every one of those holds, the migration is additive only. A compiled application may exist in
the tree; it may not be what Pages uploads.

## 6. Proposed `apps/web` boundary — for approval, not implemented

The transition itself, when it is proposed, should be exactly one commit that changes exactly one
line, so that it is trivially revertible:

```diff
-          path: web
+          path: apps/web/out
```

Everything else — the framework, the routes, the components, the build script — lands **before**
that line changes, verified against the built directory by running the verifier with the workflow
temporarily repointed in a working copy. The rollback for the transition is reverting that one line,
which restores a directory that is still committed, still complete, and still passing both gates.
