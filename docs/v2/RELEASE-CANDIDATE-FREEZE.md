# UNICA V2 — release-candidate interface freeze (`v2.0.0-rc1`)

Frozen at commit `82c7dcb4`, after the integrated settlement path ran against pinned live Sepolia
dependencies in a read-only fork.

**Nothing here is deployed.** The freeze is what a deployment would be *of*, and it exists before
the deployment on purpose: an interface that is frozen only after it is on chain was never frozen,
it was just abandoned.

## What is frozen

| Surface | Where it lives | How it is checked |
|---|---|---|
| Quote structure and type hash | `src/v2/interfaces/IQuoteSettlement.sol` | `test/v2/InterfaceFreeze.t.sol` reads `executor.QUOTE_TYPE()` |
| Payment witness type string | `src/v2/QuoteSettlementExecutor.sol` | the same, plus `paymentWitnessTypeString()` |
| Merchant configuration type | `src/v2/MerchantConfig.sol` | the same |
| `hookData` format | nowhere — **V2 uses none** | a fork row proves fabricated hookData buys no admission |
| Active-context schema | `activeQuote()` and `activePayer()` | a freeze row reads both outside a settlement |
| Receipt event | `QuoteSettled(...)`, topic `0x1317a113…7b0cbd4` | `script/verify-freeze.mjs` recomputes the topic |
| Custom-error selectors | 35 on the hook, 36 on the executor | the same, from the compiled ABI |
| External function selectors | 15 on each | the same |
| Hook permission flags | `0x20C0` — beforeInitialize, beforeSwap, afterSwap | a freeze row reads `getHookPermissions()` AND the address bits |
| Hook/executor binding | `hook.EXECUTOR()` / the executor asking the hook | the fork suite settles through it and refuses a foreign hook |
| Dependencies | PoolManager, Permit2, deterministic deployer, solc 0.8.30, cancun, no via-IR | `docs/v2/release-candidate.json` |

The machine-readable copy is [`release-candidate.json`](release-candidate.json), and
`script/verify-freeze.mjs` runs in `make gate`.

## Why it is a check and not a promise

Two sabotages, both red, both restored:

- **Rename one error.** `ZeroMaxIn()` became `ZeroCeiling()`; the verifier printed `GONE:
  ZeroMaxIn()` and `ADDED: ZeroCeiling()` for both contracts.
- **Flip one permission bit.** `afterSwapReturnDelta` set to true; the freeze suite went red at
  deployment, because those bits are part of the hook's address and an address mined for `0x20C0`
  cannot hold them.

And a third finding, which is the reason the verifier grew a check it did not start with. The first
rename sabotage **passed**. The build had failed — the tests still referenced the old name — so the
artifacts on disk were yesterday's, and the verifier read them and said the surface was unchanged.
It was reading a stale file with total confidence.

That is the same defect class as the untracked-file blind spot in the copied-source scan: *a check
whose input is not what it thinks it is.* Foundry records the keccak of every source file in each
artifact's metadata, so the verifier now recomputes those from disk first and refuses to report
anything at all if they disagree. Touch a source without rebuilding and it says so by name.

## What a change costs

Any later change to a frozen surface is a compatibility event, and all of these move with it:

1. **A compatibility note** in this file, saying what broke and for whom.
2. **Digest-vector regeneration** — `integrations/permit2/test.mjs`, `integrations/ensv2/test.mjs`
   and the pinned literals in `test/v2/Permit2Witness.t.sol` and `test/v2/MerchantConfig.t.sol`.
3. **A mutation re-run**, local (`make mutants`) and fork (`make fork-mutants`).
4. **A size measurement** — `bash script/size-budget.sh`, warning at 90%.
5. **A receipt and indexer review** — a changed event topic is silent from the chain's point of
   view. The old topic simply stops appearing, with no error anywhere.
6. **A tool-ledger update**, which `make gate` enforces: a commit that changes a tool's code without
   changing `docs/unica-tools.json` fails the build.

## What is deliberately NOT frozen

- The pool the merchant chooses. A quote names one; the executor checks its structure and its hook,
  not its wisdom.
- The set of payout currencies. V2 refuses an output token whose transfer cannot deliver an exact
  amount; which tokens qualify is a policy question, not an interface one.
- Anything under `integrations/`. Sponsor modules sit outside the core by construction and may not
  weaken quote binding, the payer's ceiling, exact output, one-time consumption, recipient binding,
  zero custody, or atomicity.

## Known limitation carried into the release candidate

**Merchant signers are EOAs.** The quote is verified with `ECDSA.recover`; a smart-contract wallet
cannot be a merchant signer. The payer's side goes through Permit2, which *does* support EIP-1271,
so a contract-wallet payer works today. Those are different answers to what sounds like one
question, and both are stated wherever the limitation is. See
[`EIP1271-BACKLOG.md`](EIP1271-BACKLOG.md).
