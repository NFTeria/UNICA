# UNICA demo storyboard — one barbershop, one chair, one lost tablet

The story a judge follows in under four minutes. Every frame names the command that produces it, what is
on screen, and the evidence a stranger can re-check. Two environments run the same storyboard: the LOCAL
one (`LOCAL_ANVIL_NO_VALUE`, one command, deterministic) and the public testnet one
(`PUBLIC_TESTNET_NO_VALUE`, Sepolia, the owner's keystore, no value). A frame that only exists in one
environment says so. No frame shows PAID from anything but a VERIFIED receipt.

## Cast

| Role | Name / address | Where it lives |
|---|---|---|
| Merchant | `freshcuts.unica.eth` | ENSv2 subname of `unica.eth`; payout address is its `addr` record |
| Active terminal | `chair-1.terminals.freshcuts.unica.eth` | text `com.unica.terminal-status = active`; its operator key holds SET_TEXT at that key only |
| Revoked terminal | `lost-tablet.terminals.freshcuts.unica.eth` | text `… = revoked`; its operator key had SET_TEXT revoked |
| Identity badge | one non-transferable token per merchant node | Vyper `identity_token.vy`, image and fingerprint deterministic from the name, deployment id and renderer version |
| Market | `tAST → uUSD` locally, `WETH → USDC` on Sepolia | registry-recorded, factory-created hook + executor, real Uniswap v4 PoolManager |
| Price route | adapter + `feedIdFor(asset, payout)` | fixture feeds locally; Chainlink ETH/USD and USDC/USD on Sepolia (demonstration market, see the oracle-age finding) |
| Policy | `LOCAL CRE REPORT FIXTURE — NOT A DON REPORT` | keystone-shaped report through a forwarder fixture; bound to chain, contracts, release, market, merchant, payer, assets, amount, nonce, expiry, terminal, policy and workflow version |

## The one command (local)

```sh
make anvil-test        # up → deploy → seed → demo → attacks → down, from an empty chain
```

or frame by frame: `make anvil-up`, `make anvil-deploy`, `make anvil-seed`, `make anvil-demo`,
`make anvil-attacks`, `make anvil-serve` (the browser pay screen), `make anvil-down`.

## Frames

| # | Frame | What is on screen | Command / evidence |
|---|---|---|---|
| 1 | **A name, not an address** | `freshcuts.unica.eth` resolves through the identity authority to the merchant's payout address; the namespace controller is checked, not just the record | `demo.sh` step 1; `EnsV2ResolverAuthority.isNamespaceController` requires both admin bits at the node |
| 2 | **The badge** | The merchant's identity token renders: name, fingerprint, renderer `unica-identity-svg/1`; the same inputs always draw the same badge | `tokenURI` on the badge; `vy/tests/vectors/identity-golden.json` |
| 3 | **Two terminals** | `chair-1 … ACTIVE`, `lost-tablet … REVOKED`, read from the text records and the per-key roles | `text(node, "com.unica.terminal-status")`, `hasRoles(perKeyResource, SET_TEXT, operator)` |
| 4 | **The lost tablet tries** | Order request from the revoked terminal is refused on chain: `TerminalNotAuthorized` | attacks row `REVOKED_TERMINAL`; `LOST_TERMINAL_NEW_ORDER` |
| 5 | **Chair 1 opens an order** | Exact payer, exact input, minimum output, expiry, terminal node; the order id is derived from the terminal and a salt | `TerminalAdmission.requestOrder` → `OrderCreated`; frame shows `order.id`, `payer`, `marketId` |
| 6 | **The wrong wallet pays** | Reverts with `WrongPayer`; nothing moves | attacks row `WRONG_PAYER` |
| 7 | **The right wallet pays** | Approve exactly the input, `pay(orderId)`; one transaction | `demo.sh` step 8; the transaction hash lands in the record |
| 8 | **Price route checked before the swap** | The market's committed `feedId` equals the adapter's `feedIdFor(asset, payout)`; freshness within `MAX_ORACLE_AGE` (300 s) | `demo.sh` step 9; attacks rows `CHANGED_FEED_ID`, `STALE_ORACLE`, `WRONG_FEED_ID`, `WRONG_ADAPTER` |
| 9 | **The real swap** | Uniswap v4 PoolManager swap through the registered hook; the hook enforces the oracle band and caps | hook bits `0x20C0` in the address; `SETTLEMENT_RECEIPT_TOPIC` log from the hook |
| 10 | **The merchant is paid** | Merchant payout balance before / after / delivered ≥ minimum output, in the same transaction | `demo.sh` steps 10–11: `delivered 1987612 uUSD units` locally |
| 11 | **Evidence, not a screenshot** | registry → market → hook emitter → executor emitter → pool → paired events → finality, each checked; the decision is VERIFIED | `node tools/unica-evidence/cli.mjs --order <id> --manifest <manifest> --rpc <rpc>` exits 0 |
| 12 | **PAID** | The POS prints PAID only now, from the VERIFIED decision; the customer view shows merchant, badge, `TESTNET / NO VALUE`, payer, assets, amount, minimum output, network, expiry, authorization, receipt status | `node tools/unica-pos-cli/cli.mjs --demo .rehearsal/anvil/demo-record.json`; browser: `make anvil-serve` |
| 13 | **Revoke after the fact** | Chair 1 is revoked (role cleared, text `revoked`); the receipt is byte-identical, still VERIFIED, the order unchanged; a NEW order from chair 1 is refused | `demo.sh` step 15; attacks row `REVOKED_TERMINAL_AFTER_SETTLEMENT` |
| 14 | **The impostor** | A look-alike hook emits a receipt with the official market id from an unregistered contract: REFUSED (`UNREGISTERED_EMITTER`, `HOOK_PROVENANCE_MISMATCH`) | attacks row `LOOKALIKE_HOOK`; `COUNTERFEIT_IDENTITY_NFT` for the badge |
| 15 | **Stale evidence** | The index is behind the required block, or the endpoint is unreachable: UNKNOWN, never PAID | attacks rows `STALE_EVIDENCE`, `UNFINALIZED_EVIDENCE`, `EVIDENCE_ENDPOINT_UNAVAILABLE` |
| 16 | **Replay** | Paying the settled order again: `OrderNotOpen` | attacks row `REPLAYED_ORDER` (both instruments) |
| 17 | **The forwarder lies by succeeding** | A malformed, expired, replayed or mis-addressed policy report: the forwarder transaction SUCCEEDS, the receiver rejected, no admission exists | attacks row `FORWARDER_SUCCESS_RECEIVER_REJECTED` (seven sub-cases as the first reason code) |
| 18 | **What it is not** | The policy report is labelled `LOCAL CRE REPORT FIXTURE — NOT A DON REPORT`; the market on Sepolia is a demonstration market (`demonstrationOnly = true`) until the oracle-age ruling | attacks row `FIXTURE_REPORT_IS_NOT_A_DON_REPORT`; `docs/unica-v4/PUBLIC-DEPLOYMENT-HANDOFF.md` O1–O4 |

## The same story on Sepolia (public testnet, no value)

Frames 5–12 run against the public deployment once the owner has sent the four stages
(`script/unica-v4/deploy-public.sh sepolia_testnet A | B | C | activate`, keystore password typed by the
owner, addresses recorded into `config/unica-v4/11155111.env` by the wrapper) and the ENS-side records
exist (`freshcuts.unica.eth` `addr`, terminal status texts, per-key grants, lineage on the adapter).
The evidence CLI and the POS take the Sepolia manifest (`deployments/unica-v4/11155111.json`, written by
`script/unica-v4/manifest.sh` from chain reads) and a public endpoint; the decisions are the same three
words. Local evidence and public evidence are never mixed in one record: the `environment` field says
which one a judge is looking at.

## Closing line

"Every screen a judge saw was derived from chain evidence a stranger can re-run; the one word PAID was
printed exactly once, after the receipt verified, and it stayed printed after the terminal that opened
the order was revoked."
