# PUBLISHING — GitHub Pages for web/

`web/index.html` is the whole surface: no build step, no framework, no backend (`web/README.md`).
`.github/workflows/pages.yml` uploads `web/` exactly as committed, after `script/check-surface.sh`
passes. This document is the owner's checklist for turning that workflow on. Nothing in it changes
what runs — see "What this does not change" at the end.

## One-time setting, owner only

GitHub Pages is off until a repository owner turns it on by hand. The workflow cannot do this
itself, and does not try to:

1. Open **Settings > Pages** on `github.com/NFTeria/UNICA`.
2. Open **Settings > Secrets and variables > Actions > Variables** and add a repository variable named `PAGES_ENABLED` with the value `true`. Until it exists the deploy job is skipped and the workflow stays green; the check job runs on every push regardless.
3. Under **Build and deployment > Source**, choose **GitHub Actions** — not "Deploy from a
   branch". There is no `gh-pages` branch and none should be created; the workflow publishes an
   upload artifact directly, and the directory it uploads is `web/`, not the repository root.
4. Save. No branch, no folder, and no further field is set here — the workflow's own `paths`
   trigger and `path: web` input are what decide what gets published and when.

That save is the only setting this document asks the owner to change. Everything after this
section runs the same whether the owner did it a minute ago or a year ago.

## Before every publish (pre-publication checklist)

Run in order, from the repository root. Every item must be true before a push to `main` under
`web/**` is allowed to reach the public site:

- [ ] `bash script/check-surface.sh` exits 0 locally, and its printed count shows `failed: 0`.
- [ ] CI is green on the exact commit being published — `gh api repos/NFTeria/UNICA/commits/<sha>/status`
      or the Actions tab, not a stale badge.
- [ ] `make readback` (or `bash script/readback.sh`) shows the chain agreeing with every pinned
      value `check-surface.sh` checks — chain id, hook, executor, pool id, deploy block, release
      tag and commit. A disagreement here means the page's own on-load readback panel will say
      "stale configuration" the moment it is opened; fix the pin or the deploy before publishing,
      not after.
- [ ] `bash script/scan.sh` exits 0 — no secret-shaped string, no private file name or path,
      anywhere in the tree being pushed, not only in `web/`.
- [ ] The page states no public claim beyond the one sentence this project is allowed to make:
      *"UNICA demonstrates a live, verified USDC settlement flow on Uniswap v4 Sepolia, with
      order-bound full-fill enforcement and an indexable receipt."* `check-surface.sh` checks this
      mechanically; this line is the human confirmation of the same rule before a push, not a
      second, different one.

If any box is unchecked, do not push to `main` under `web/**` — push to a branch, open a PR, and
let CI and `check-surface.sh` run there first. The workflow's own `check` job repeats the surface
check on every push regardless; this list is what keeps that job from ever being the first place a
problem is seen.

## The URL

GitHub Pages project sites follow one fixed pattern for a public repository under an
organization or user account: `https://<owner>.github.io/<repo>/`. For this repository that
pattern is:

```
https://nfteria.github.io/UNICA/
```

This is the address GitHub Pages will use once **Settings > Pages** is set as above and the
`deploy` job has completed once — it is not configurable from inside this workflow. The owner
confirms the live address after the first successful deploy (Settings > Pages shows it, and the
`deploy` job's own summary prints `steps.deployment.outputs.page_url`); record it below rather
than trusting the pattern alone, since GitHub reserves the right to change Pages' own URL rules.

## Rollback

Publishing here is a GitHub Actions deployment, not a branch push — rolling back does not touch
`main` or any tag:

- **Redeploy an older, known-good commit:** Actions tab > `pages` workflow > **Run workflow**
  (`workflow_dispatch`), choosing the branch or tag to run from, or `gh workflow run pages.yml
  --ref <sha-or-tag>`. This re-runs `check` and `deploy` against that ref and republishes it —
  no revert commit needed on `main`.
- **Take the site down entirely:** **Settings > Pages > Build and deployment > Source**, switch
  it away from GitHub Actions (or remove the environment). The last published artifact stops being
  served; nothing under `web/`, `.github/`, or anywhere else in the repository is touched by this.
- Either way, `docs/proof/` and the chain itself are unaffected — the settlement hook, the
  executor, and the pool keep running exactly as deployed regardless of whether this static page
  is reachable.

## What this does not change

Publishing `web/` to GitHub Pages changes where a static copy of `index.html` can be viewed. It
does not change, and cannot change: the live chain, the deployed hook, the deployed executor, the
pool, or the ABI the page reads against. The page is a read-only view that re-verifies the chain
on every load (`web/README.md`, "What it reads before it enables anything"); publishing it wider
does not grant it, or anyone, any new capability against the contracts.

## Record here, after publishing (owner fills these in)

<!-- Two facts, filled in by the owner after the first successful deploy. No placeholder values —
     leave both lines exactly as below until they are true. -->
- Deploy commit: _not yet published_
- Live URL: _not yet published_
