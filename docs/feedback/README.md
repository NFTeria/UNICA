# Partner feedback — index

Convention for this pass, matching the shape `docs/feedback/README.md` already sets:

- Root `FEEDBACK.md` is the primary partner's file: Uniswap. Its rules — captured the hour it
  happens, four parts per entry, no prizes or strategy — bind every file below too.
- `docs/feedback/uniswap/` holds items nested under Uniswap that are not sponsors in their own
  right: chains and tooling inside the Uniswap ecosystem. This pass adds two files there.
- `docs/feedback/<partner>.md` — one file per other partner named on the ETHOnline 2026 prize
  page. A partner whose tools were investigated but not used still gets a file, saying exactly
  that, because a stated negative is useful and an absent file is not.

## Index

| File | One line |
|---|---|
| `uniswap/README.md` | Inventory in three tables: fixed in our tree, wanted with no code change, needs their code change |
| `uniswap/robinhood.md` | An observed testnet's router refuses our shipped encoding; the facts, the cause, and a design question |
| `the-graph.md` | Real usage exists (`integrations/graph/`); the open item is a hosted deployment, not a build |
| `world.md` | No integration; the one seam considered is beta-gated and its endpoint is undocumented |
| `ens.md` | No integration; no ENSv2 defect was established this pass |
| `privy.md` | No integration; two wallet seams were designed, neither was built |
| `chainlink.md` | No integration; a price-feed seam exists only as an idea |
| `ledger.md` | No integration; a related signing-registry gap is documented but credited to no track |
| `arc.md` | No integration; Arc mainnet is not live; two documentation gaps noted |
| `hedera.md` | No integration; the only fit found is a pivot away from the settlement core |
| `1inch.md` | No integration; the sponsor's own template licence blocks copying code into this repository |
| `bazantic.md` | Not previously researched; requirement quoted fresh, nothing built |

## The rule

Nothing in this index, or in any file it points to, is a claim of qualification for any prize,
track, or sponsor bar. Each file states what exists, what does not, and the evidence for the
difference. Every partner file ends with an explicit status line.
