# Prior art carried into this repository

This file exists so that nothing here has to be guessed at later. It names work that was written
**before** this repository's build window and brought in, as distinct from work authored during it.

Carrying prior work in is permitted. Presenting it as newly authored is not, and the difference is
this file. The rule the estate follows is the one the hackathon rulebook states directly:
**disclosure is the sanctioned remedy; hiding is the offence.** Every penalty attaches to
undisclosed work, so the cost of writing this down is nothing and the cost of not writing it down
is the entry.

## Vyper contracts — `vy/src/unica/`

A library of Vyper contracts predating this repository, pasted in by the owner on **2026-09-08**
and integrated here. The integration — the moccasin wiring, every test, the tool-ledger entries and
the repairs listed below — was written in this repository. The contract sources were not.

| Contract | Carried in | Written here |
|---|---|---|
| `merchant_policy.vy` | the source | tests, ledger entry, compiler pin |
| `payany_router.vy` | the source | as above |
| `flash_liquidator.vy` | the source | as above |
| `calculator.vy` | the source | as above |
| `namemath.vy`, `logobackground.vy` | the source | tests, ledger entry, and the one-line fix that made `namemath.vy` compile for the first time |

Repairs made here, and named so nobody mistakes them for authorship:

- `namemath.vy` had **never compiled** in any Vyper 0.4.x — `convert(block.prevrandao, bytes32)` is
  a type error, because `prevrandao` is already `bytes32`.
- Every carried contract declared `#pragma version ^0.4.0`, a RANGE. The syntax needs 0.4.1 or
  later, so a 0.4.0 toolchain rejects them. Each is now pinned exactly, as its siblings are.
- Three files arrived with markdown escaping and indentation damage from the paste and are not
  yet repaired; they are listed in the ledger as such rather than committed broken.

## Specification and threat model

The pre-event specification and threat model are disclosed in `specs/` and named in the README, in
the submission description, and on camera. They were written before the window; every line of
contract code under `src/` was written during it.

## What is NOT prior art

Everything under `src/`, `test/`, `integrations/`, `tools/` and `script/` was written in this
repository. Where a second implementation of a public standard exists here — EIP-712 digests,
Permit2's type strings, secp256k1 recovery, an ABI codec — it was written from the specification
rather than copied, which is the rule `CLAUDE.md` states and `script/no-copied-source.sh` enforces
against 1,963 vendored statements on every run.
