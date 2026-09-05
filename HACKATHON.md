# HACKATHON.md — what was built when, and by whom

UNICA is an ETHOnline 2026 entry in the Classic (from-scratch) track, built by NFTeria.
This file separates three things a judge needs to tell apart, and states what is not claimed.

**The specification and threat model were written before the event; every line of code was
written during it.**

## 1. Disclosed pre-event material

`specs/HOOK-SPEC.md` and `specs/THREAT-MODEL.md`, both stamped 2026-08-21, published unedited
with their SHA-256 in `specs/README.md`. They are the design; they are not code. The toolchain
configuration (`foundry.toml`, `remappings.txt`, the CI workflow) was drafted as starter-kit
configuration before the window and re-verified file by file against the vendored tree in
the first hours; it contains no project logic. `AI_USAGE.md` lists every pre-existing artifact
by name.

## 2. Upstream open-source code, used as dependencies

Everything under `lib/` arrives as a git submodule under its own licence: `forge-std`,
OpenZeppelin `uniswap-hooks` v1.1.1, `hookmate`, and through them Uniswap `v4-core`
(BUSL-1.1 with its stated change date; not relicensed), `v4-periphery`, `permit2`, `solmate`,
`openzeppelin-contracts`. The dependency set and remapping layout follow the public
`Uniswap/v4-template` (MIT), which was used as a starter kit and not cloned, so this history
contains only this project's commits.

## 3. Project-specific implementation, written during the event

`src/`, `test/`, `script/`, `docs/`, `design/`, and every commit in this repository.
The remote was created empty at 2026-09-04 16:06 UTC; the first commit is later. A judge can
confirm the bright line with:

```sh
git log --reverse --format='%cI %s' | head -3
```

## Prior art, cited and not copied

An earlier settlement-receipt hook by the same author exists on Ethereum Sepolia and is named
in `specs/HOOK-SPEC.md` section 0. It is prior art in the ordinary sense: it informed the
design, and nothing from it, no file, no test, no helper, was brought into this repository.
This one is written from the specification against the pinned interfaces.

## The intended integrator

NFTeria's private `.click` product is the integrator this hook is designed for: a business that
settles customer payments and wants a payer to pay in one asset while the business receives
another, atomically, with a receipt. That relationship is why the hook exists and is stated
here in prose only. The private product never enters this repository: no source,
configuration, credentials, customer data, or private links.

## What is not claimed

- Testnet only. No mainnet deployment of any kind.
- A deployed contract is not a verified one, and a verified one is not a live-fired one.
  The README's proof rows say which rung each address has reached and carry the command
  that re-proves it. Anything not deployed, verified, and live-fired is cut, not claimed.
- No prize, placement, or finalist status at any event is claimed anywhere in this tree.
- AI tooling assisted the build; `AI_USAGE.md` says exactly where. No commit carries an AI
  co-author, because tooling is not authorship.
