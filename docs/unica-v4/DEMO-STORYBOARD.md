# UNICA storyboard — Fresh Cuts takes a payment

Written for business owners. No blockchain words in the frames. The technical evidence for every frame
is in the appendix at the end, for the person running the demo. Two places run the same story: a
practice setup on your own computer (one command, always the same result) and the public test network
(real test money, no value). PAID appears exactly once, and only after the receipt has been checked.

## The people

| Who | In the story |
|---|---|
| Maria | Owns Fresh Cuts, a barbershop. Has a normal wallet app on her phone. Has never heard of a smart contract. |
| Fresh Cuts | Her business. Its pay name is `freshcuts.unica.eth`. Customers pay the name, not a long address. |
| Chair 1 | The register at the first chair. Active. |
| The lost tablet | A register that walked out of the shop last month. Revoked. |
| Sam | A customer. Pays from their own wallet. |
| The copycat | Someone who tries to fake a receipt. |

## Frames

| # | What Maria or Sam sees | What is happening underneath (one line) |
|---|---|---|
| 1 | Maria opens UNICA and taps **Connect**. Her wallet app opens; she approves. | Her wallet becomes her login. No password, no signup form. |
| 2 | She types **freshcuts**. The page says: your pay name will be `freshcuts.unica.eth`. Free. | The name is checked for spelling rules and availability before she pays any fee. |
| 3 | She taps **Add my business** and confirms once in her wallet. | One transaction creates the business, its first register, and its badge. Money goes to her wallet by default. |
| 4 | Her page shows: **Fresh Cuts**, pay name, **Register 1: active**, and her business badge. | The badge is drawn from her name and cannot be transferred or copied. |
| 5 | She adds **Chair 1** and later marks **the lost tablet** as revoked. | Each register has its own key. Revoking one never touches the others. |
| 6 | The lost tablet tries to start a sale. The screen says **Declined: this register is revoked**. | A revoked register cannot open a sale, on chain, not just in the app. |
| 7 | Chair 1 opens a sale for Sam: price, what Sam pays, the least Fresh Cuts will receive, and when the offer expires. | The sale is written for Sam's wallet only. Nobody else can pay it. |
| 8 | A different customer tries to pay Sam's sale. **Declined: this sale belongs to another customer.** | Wrong payer, refused before any money moves. |
| 9 | Sam taps **Pay** and confirms in their wallet. One confirmation. | Sam's money is converted on Uniswap and delivered to Fresh Cuts in the same transaction. |
| 10 | The screen shows the price check: **Fair price, checked a moment ago**. | The trade is only allowed inside the band our price source says is fair right now. |
| 11 | Fresh Cuts' balance goes up by at least the promised minimum. | The conversion and the payout are one atomic step. No pending state. |
| 12 | The register shows **Checking receipt…** then **PAID (checked)**. | An independent reader verifies the receipt against the public registry before PAID is printed. |
| 13 | Sam's phone shows the receipt: business, pay name, badge, amount, network, and **Practice mode, test money only** on non-production networks. | Everything on the receipt is derived from the chain, not from the app. |
| 14 | Maria revokes Chair 1 after closing time. Sam's receipt is unchanged. Chair 1 cannot open a new sale. | Revocation is forward-looking. History is never rewritten. |
| 15 | The copycat shows a receipt that looks right. The reader says **Declined: not from Fresh Cuts' registered checkout**. | A receipt from an unregistered contract is refused, even with the right names on it. |
| 16 | The reader's connection lags behind the chain. It says **Not confirmed yet**, never PAID. | Stale or missing evidence is UNKNOWN, never a success. |
| 17 | Someone tries to pay Sam's finished sale again. **Declined: already paid.** | A sale settles once. |
| 18 | The presenter says the honest part out loud: practice network, demonstration price setting, local policy fixture. | See the appendix and the talk track. |

## What Maria never had to do

Learn a new vocabulary. Copy an address. Trust a screenshot. Wait for a batch. Call anyone to revoke a
lost device. Explain to a customer what a hash is.

## Appendix for the person running the demo

| Frame | Command or file | Evidence |
|---|---|---|
| 1–5 | `make anvil-up && make anvil-deploy` then `make anvil-serve` (join/ route) | `MerchantOnboarding.join`, `BusinessJoined` event, badge `token_of_node` |
| 6 | attacks row `REVOKED_TERMINAL`, `LOST_TERMINAL_NEW_ORDER` | `TerminalAdmission` reverts `TerminalNotAuthorized` |
| 7 | `demo.sh` step 6 | `requestOrder` binds payer, amounts, expiry, terminal node |
| 8 | attacks row `WRONG_PAYER` | executor reverts `WrongPayer` |
| 9–11 | `demo.sh` steps 8–11 | Uniswap v4 PoolManager swap through the registered hook; merchant delta ≥ minOut; receipt log |
| 10 | `demo.sh` step 9; attacks rows `CHANGED_FEED_ID`, `STALE_ORACLE`, `WRONG_FEED_ID` | `feedIdFor` re-verified at settlement; `OracleStale`, `OracleFeedMismatch` |
| 12–13 | `node tools/unica-evidence/cli.mjs --order <id> --manifest <manifest> --rpc <rpc>`; POS CLI `--demo` | decision VERIFIED, exit 0; PAID rule in `tools/unica-pos-cli/render.mjs` |
| 14 | `demo.sh` step 15; attacks row `REVOKED_TERMINAL_AFTER_SETTLEMENT` | receipt identical, order unchanged |
| 15 | attacks row `LOOKALIKE_HOOK`, `COUNTERFEIT_IDENTITY_NFT` | `UNREGISTERED_EMITTER`, `HOOK_PROVENANCE_MISMATCH` |
| 16 | attacks rows `STALE_EVIDENCE`, `UNFINALIZED_EVIDENCE`, `EVIDENCE_ENDPOINT_UNAVAILABLE` | decision UNKNOWN |
| 17 | attacks row `REPLAYED_ORDER` | `OrderNotOpen` |
| 18 | `docs/unica-v4/PUBLIC-DEPLOYMENT-HANDOFF.md` (oracle-age ruling O1–O4), attacks rows `FIXTURE_REPORT_IS_NOT_A_DON_REPORT`, `FORWARDER_SUCCESS_RECEIVER_REJECTED` | demonstration market flag in receipts; fixture label asserted |

One command runs the whole story from an empty chain: `make business-demo` (the technical replay is `make anvil-test`). The public test network runs
frames 7 to 13 against the Sepolia deployment once the owner has sent the four stages in the handoff and
the business's records exist on ENS. Local evidence and public evidence never share a record; the
environment label on every screen says which one you are looking at.
