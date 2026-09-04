# ARCHITECTURE — how the code is laid out, and for whom

Written 2026-09-04, end of day 1, after the owner asked how the code should be organised to
serve the three partners this entry builds on, with Uniswap first, and after the Vyper
toolchain was proven inside this tree. Dated, appended, never rewritten; the tree outranks it.

## The rule that orders everything

**The hook never imports a partner.** Uniswap is the venue and the hook is the contribution
to it; every other partner attaches at a seam outside the hook's trust boundary, is switched
on by configuration, is removable in one commit, and is labelled by the rung it has reached.
The specification (`specs/HOOK-SPEC.md`) is not changed for a partner; if a partner's rules
cannot be met at a seam, the conflict is named and the smallest extension proposed.

## The contracts, and what language each is in

| Contract | Language | Why it exists | Serves |
|---|---|---|---|
| `src/UnicaHook.sol` | Solidity | The v4 hook. Inherits OpenZeppelin `BaseHook`, validates its own address bits, gates `beforeSwap` to the router (I1, I4, I5), verifies the realised output and emits the receipt in `afterSwap` (I2, I3). It also emits the Foundation's standard hook events (`HookSwap`, `HookFee`) so ecosystem tooling reads it without interpretation. | Uniswap. The Graph (its events are what the shared schema indexes). |
| `src/UnicaSettlementRouter.vy` | Vyper | The only contract the hook admits as a swap sender. Unlocks the PoolManager, swaps with the order id as hook data, `take`s the output to the registered recipient, settles native ETH with `sync` immediately before `settle` (I7), refunds by `raw_call`, never holds a balance. | Uniswap: a reference v4 settlement router in Vyper, which the ecosystem does not have. |
| `src/OrderRegistry.vy` | Vyper | The single source of truth the hook and router read: payer, recipient, currencies, minimum output, deadline, fee, consumed flag. Written by an authenticated registrar; `hookData` carries only the order id (spec C1). | Uniswap (the invariants are enforced against it). |
| `src/BenefitLedger.vy` | Vyper | One-time bounded benefits (a discount, a fee waiver, a higher limit) keyed by a nullifier the application derived from an official verification, consumed on settlement, never replayed. The router applies at most one to an order. It stores no identity data. | World, at a seam: "one human, one discounted settlement". |

Vyper is chosen where the estate has depth in it and where a second implementation
language is a contribution in itself: v4 routers in Vyper are rare, and a correct native
settlement in Vyper is a worked example the ecosystem lacks. Solidity stays where the
dependency demands it: the hook must inherit `BaseHook` and use the `Hooks` library.

**Toolchain fact, measured 2026-09-04:** this repository's Foundry build (forge
1.3.5-foundry-zksync) compiles a `.vy` file placed under `src/` with the Vyper 0.4.0 on this
machine, and a Solidity test deploys it with `deployCode("Probe.vy:Probe")` and calls it
(1 passed). CI will install Vyper 0.4.0 exactly, in the commit that adds the first `.vy`
file, and record the version in the log. Source verification of Vyper contracts on the
explorer is not yet exercised; it is verified with the first Vyper deploy on Sepolia, and
its rung is recorded like every other.

## The seams, one directory each, only when wired

```
src/                    the four contracts above; nothing here knows a partner
test/                   Foundry: unit, fuzz, invariant, fork; Vyper contracts under test via deployCode
script/                 deploy, mine, pool bootstrap, live-fire; testnet-only by construction
integrations/graph/     The Graph: the standard hook-event schema any v4 hook can reuse, UNICA's receipt composed on top; deployed to Studio, queried live by web/
integrations/world/     World: the application-side verification flow that mints a benefit nullifier; env-gated; the hook and router never see World data
web/                    the one page, the one action (design/README.md); reads the subgraph; Sentry for its own errors
docs/                   the living records; docs/INTEGRATIONS.md is the per-partner survey, built or not
```

No directory exists before the thing in it works. A partner investigated and not adopted
gets a paragraph in `docs/INTEGRATIONS.md` and a file in `docs/feedback/`, never an empty
folder.

## What each partner keeps after the event

- **Uniswap**: an MIT hook that makes a v4 pool a business settlement venue, a reference
  Vyper settlement router with native-ETH settlement done correctly, the standard hook
  events emitted, and `FEEDBACK.md` with dated, reproducible receipts.
- **The Graph**: a shared hook-event schema, so one query answers for UNICA and for any
  other hook emitting the standard events, with a second hook's events shown answering it.
- **World**: a worked, replay-safe pattern where a verification changes a settlement
  condition on a real rail, plus developer and user feedback in their file.

## Order of work

I1 and I7 land first (the router and the registry, day 2), I2 to I5 next (day 3), the deploy
and live-fire of the gated hook on day 4, the surface on day 5. Every partner seam waits
until the core hook, its surface, and its compliance artifacts are complete; the subgraph
schema and the benefit ledger are day-8 work and are cut before anything on the core path is.

## Open, to settle before depending on it

- Vyper source verification on Etherscan and Sourcify from this Foundry build: exercised
  with the first Vyper contract deployed to Sepolia.
- Vyper interface declarations for `IPoolManager`, `PoolKey`, `SwapParams`, `BalanceDelta`
  packing: written from the pinned v4-core ABI and checked by a Solidity test that
  round-trips a swap through the Vyper router against v4-core's real PoolManager.
- Whether the Trading API can route through a custom-hook pool at all: one API call after
  the pool exists, response recorded verbatim.
