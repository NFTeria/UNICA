# DEMO-SHOTLIST — the day-7 recording, shot by shot

**Status of this file: a plan for a recording scheduled 2026-09-10.** Today is 2026-09-05. Every
sentence below about "the surface is published" or "the pool holds N liquidity" describes the
state as measured on 2026-09-05 (cited by file:line); re-check each cited number against the tree
on recording day before saying it on camera. Nothing below is a claim about 2026-09-10 — it is an
instruction for what to check and say *then*, sourced from what is true *now*.

Governing documents, read in full before recording: `docs/DEMO.md` (the sequence and the claims
policy — this file does not restate it, it operationalizes it), `docs/proof/README.md` (evidence
index), `docs/RECEIPT-SCHEMA.md`, and ETHOnline's own video rules, quoted in full in §0 below.

---

## 0. The rules this recording must satisfy (quoted, sourced)

From ETHGlobal's own published event-info pages for this event (researched 2026-08-21; re-check
before recording in case wording changed), the demo-video requirements:

- Duration: **"Videos under 2 minutes or over 4 minutes will be automatically rejected during
  upload."** Target for this shot list: **~3:35**, leaving margin on both ends.
- Resolution: **"Upload will fail if the video is less than 720p."** Record and export at 1080p.
- Voice: **"DO NOT use a text to speech synthesizer / AI Voiceover." Live human voice only.**
  This bars a TTS narration track entirely — every sentence below is spoken live on camera by
  the owner, not generated audio.
- Banned: music-plus-on-screen-text instead of talking; speeding the video up to fit the time
  limit; recording on a mobile phone. Editing out dead time (cuts) is explicitly allowed.

This shot list assumes: owner's own voice, screen recording software (not a phone), cuts between
shots allowed, no sped-up footage, no AI voiceover of any kind.

---

## 1. The shot list (12 shots, ~3:35 total)

Each row: duration, exact screen content, the sentence(s) spoken on camera, and the evidence the
sentence rests on. On-camera sentences are written to be said in the owner's own voice — adjust
phrasing for delivery, but do not add a claim beyond what its evidence line supports (§4 lists
sentences that must never be said).

| # | Time | On screen | Say (verbatim or close paraphrase) | Evidence |
|---|---|---|---|---|
| 1 | 0:00–0:15 (15s) | Terminal: `ls specs/`, then open `specs/README.md` | "UNICA lets a payer pay in one currency and a recipient receive another, atomically, through Uniswap v4. The specification and threat model were written before the event; every line of code was written during it." | Second sentence is the mandated disclosure, verbatim (`README.md:12-13`, `docs/DEMO.md:40-41`; word count: `wc -w` on the quoted sentence prints 18). First sentence paraphrases `README.md:3-4` |
| 2 | 0:15–0:35 (20s) | Terminal or editor: the architecture block, `README.md:57-69` | "One thin executor plus a policy hook on Uniswap's official Universal Router. The executor composes the router's plan so the output lands at the registered recipient, and the hook admits a swap only when it arrives from that exact router with that exact executor as the caller." | `README.md:58-68` (ASCII sequence); the I1 gate at `src/V4SettlementHook.sol:167,173,175` |
| 3 | 0:35–0:55 (20s) | The surface, loaded: the readback panel showing pinned values agreeing (hook/executor bytecode length, pool id, etc.) | "This is the surface — one page, one action. Before it enables anything it reads the chain back against every value it pins: the hook, the executor, the pool. Nothing is enabled until all of it agrees." | `web/README.md` "What it reads before it enables anything" table; the DOM capture "7 pinned values checked, 7 agree, 0 disagree" (`web/README.md`, "Later the same day, against live Sepolia" table) |
| 4 | 0:55–1:20 (25s) | The surface's disabled state: attempt to register/pay a fresh 0.001 ETH order; the button stays disabled with its one-sentence reason on screen | "The live pool is thin and one-directional — every settlement lowers its price, and only new liquidity refills it. A fresh 0.001 ETH quote today pays under the order's 1.5 USDC minimum, so the hook would refuse it. That refusal is the invariant working. It is part of this demo, not a failure of it." | `docs/DEPLOYMENT.md` "Protecting the live pool" table: price 1,615 USDC/ETH, output 1.347 USDC, under the 1.5 minimum; `web/README.md` "When it disables everything" — the exact disabled-state sentence |
| 5 | 1:20–1:40 (20s) | Explorer tab: the settlement transaction `0x1120af18…cb83`, status Success, block 11640026 | "The paid path is already proven on chain. Order `0x72b25a9b…b8e9`, 0.001 ETH in, settled through Uniswap's Universal Router, for 2.003660 USDC to the recipient — recorded, not staged." | `README.md` row "The settlement through the hook"; https://sepolia.etherscan.io/tx/0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83 |
| 6 | 1:40–1:58 (18s) | Explorer Logs tab (or Blockscout, whichever renders on the recording machine): the PoolManager `Swap` event, sender field | "The swap's sender is Uniswap's own Universal Router — not a router of ours. The hook admits no other sender; that's invariant I1." | `docs/DEMO.md` row "Official Uniswap v4 execution infrastructure"; `docs/proof/README.md` row L1 |
| 7 | 1:58–2:18 (20s) | The hook's `SettlementReceipt` log, decoded fields | "The hook's own receipt names the order, the pool, the recipient, both currencies, both amounts — a versioned, canonical event, beside OpenZeppelin's standard HookFee." | `docs/RECEIPT-SCHEMA.md` field table; `docs/proof/README.md` row L2 |
| 8 | 2:18–2:33 (15s) | Terminal: the two `verify-live.sh` lines that check this directly — "the order the receipt names is Settled and cannot be paid again (status 3)" and "a replay of pay(orderId) is refused (eth_call reverts)", both printing pass | "The order is consumed exactly once. Its status is Settled, and a replay of pay reverts on chain." | `docs/DEMO.md` sequence row "Order consumed exactly once"; `docs/proof/verify-live.sh:102-104` (the exact check text and the eth_call-revert mechanism) |
| 9 | 2:33–2:53 (20s) | Terminal: `bash docs/proof/verify-live.sh` running to completion, final line on screen | "Every fact in this video is re-provable, read-only, straight from the chain: thirty-one checks, all passing, right now." | `README.md` row "Re-verification script": "checks run: 31, passed: 31, failed: 0" (`docs/proof/verify-live.sh:112`) |
| 10 | 2:53–3:13 (20s) | Terminal or browser: the local subgraph's GraphQL query result, one `Settlement` entity | "The receipt is indexable — a subgraph reconstructs this exact settlement from its log alone, locally, with no credentials and nothing broadcast." | `README.md` "The receipt, indexed" section; measured `amountOut` 2003660 matching the on-chain receipt |
| 11 | 3:13–3:28 (15s) | Terminal: `forge test` tail, showing the passing count | "Fifty-four tests, fuzzed at ten thousand runs, against Uniswap's own PoolManager and Universal Router bytecode — including every refusal path this demo just showed." | Count independently verified this session: `find test -name "*.t.sol" -exec grep -hE '^\s*function (test|testFuzz)' {} \; \| wc -l` → 54; `README.md` "Setup, test, fuzz" |
| 12 | 3:28–3:35 (7s) | Static card or terminal: repo URL + license | "UNICA demonstrates a live, verified USDC settlement flow on Uniswap v4 Sepolia, with order-bound full-fill enforcement and an indexable receipt. MIT-licensed, at github.com/NFTeria/UNICA." | The exact permitted public-claims sentence (word count: `wc -w` prints 20); `README.md` license section |

**Total: 3:35**, inside the 2:00–4:00 window with margin both directions.

---

## 2. The disclosure sentence (say it exactly, once, early)

> "The specification and threat model were written before the event; every line of code was
> written during it."

Placed in shot 1, spoken in full, unmodified. Source: `docs/DEMO.md:40-41` and `README.md:12-13`,
both carrying the identical sentence. Do not paraphrase this one — it is quoted policy, not prose.

---

## 3. Contingency plan

### 3.1 The pool is thin and one-directional — this is scripted, not improvised

`docs/DEPLOYMENT.md` ("Protecting the live pool", measured 2026-09-05): a fresh 0.001 ETH
settlement against the pool as it stands pays **1.347 USDC**, under the order's 1.5 USDC minimum.
So:

- **Do not attempt a live fresh settlement on camera as if it would succeed.** It is expected to
  be refused, and that refusal is shot 4 — scripted, not a mishap to route around.
- **Do not claim a successful swap while the pool is thin** (`docs/DEMO.md` claims policy, "Never"
  row). If, by recording day, an owner-approved top-up (`make topup-live`, `docs/DEPLOYMENT.md`
  "The bounded top-up") has landed and the pool can pay 1.5 USDC again, shot 4 may show a fresh
  successful settlement instead of the refusal — check `docs/DEPLOYMENT.md`'s live figures again
  before the recording, do not assume either state.
- **The recorded settlement is the proof of the paid path regardless.** Shots 5–9 rest on the
  transaction already mined in block 11640026, which is settled fact independent of the pool's
  state on recording day.

### 3.2 The surface's disabled state is part of the demo

Whether the surface shows a live URL or a locally opened `web/index.html` (`web/README.md`:
"Deployed URL: not yet published" as of this file's writing — check again before recording,
since this may have changed and is not asserted here as a day-10 fact), its refusal message
("the pool has moved below this order's minimum; the hook would refuse the payment and you would
keep your ETH…", `web/README.md` "When it disables everything") is itself evidence the invariant
holds. Show it, say the sentence in shot 4, move on. It is not something to explain away.

### 3.3 If the wallet, the RPC, or the explorer fails on camera

Pre-record the terminal proof before the live session, as a fallback clip to cut to:

```sh
bash docs/proof/verify-live.sh
```

This is read-only (no wallet, no broadcast, no signing) and reproduces every on-chain fact this
video states, printing "checks run: 31, passed: 31, failed: 0" (`README.md` row "Re-verification
script"). If a wallet extension hangs, an RPC call times out, or an explorer page fails to render
live:

1. Cut to the pre-recorded `make proof` / `verify-live.sh` terminal clip in place of the live
   browser shot.
2. Say the same sentence the live shot would have carried — the terminal output supports it
   identically, since the script re-derives the same facts from the chain.
3. Never narrate the failure as if it were part of the demo ("normally this would show…") — cut
   past it silently in editing per the rules' explicit allowance ("The video can be edited to
   remove any unnecessary waiting").

Do this for shots 3, 4, 5, 6, 7, 9, and 10 specifically — every shot that depends on a live
browser, wallet, or RPC call rendering correctly on the first take.

---

## 4. The six ordered screenshots the manifest will need

`docs/proof/README.md` already runs 01–07 and 09 (no 08, explained there: the settlement's Logs
tab does not render under headless capture). These are day-7's own numbers, continuing that
sequence, one per shot that needs a still image for `docs/proof/`:

| # | Filename | Captures | Feeds shot |
|---|---|---|---|
| 10 | `10-surface-readback-panel.png` | The surface's pinned-values panel, all agreeing | 3 |
| 11 | `11-surface-refusal-state.png` | The surface with the pay/register control disabled and its one-sentence reason visible | 4 |
| 12 | `12-settlement-logs-full.png` | The settlement tx's Logs tab, captured by hand in a real (non-headless) browser — the capture day-1's headless run could not take | 6, 7 |
| 13 | `13-subgraph-query-result.png` | The local subgraph's GraphQL query result: one `Settlement` entity, `amountOut` 2003660 | 10 |
| 14 | `14-forge-test-summary.png` | `forge test` tail showing 54 tests passed | 11 |
| 15 | `15-verify-live-output.png` | `verify-live.sh`'s final line: 31 of 31 | 9 |

File a row for each into `docs/proof/README.md`'s "What is not here yet" section once captured —
that section already names both the surface and the video as pending additions.

---

## 5. Sentences that must NOT be said on camera

From `docs/DEMO.md`'s claims policy, verbatim rule: **"Never: 'first', 'only', 'audited',
'endorsed by Uniswap', or a successful swap while the pool is thin."** Concretely, never say:

- "the first" / "the only" settlement hook of this kind
- "audited" (there is no audit; `README.md` "Security limitations, stated" says so plainly)
- "endorsed by Uniswap" or "in partnership with Uniswap" (UNICA is "a project, not affiliated
  with or endorsed by Uniswap", `README.md:9-10`)
- claiming a fresh settlement succeeded while the pool cannot actually pay the order's minimum
  (§3.1 above)
- anything implying World, ENS, or Privy is implemented or demonstrated — `docs/DEMO.md`:
  **"not claimed... none is implemented or demonstrated, and the card says so if asked"**
- anything implying The Graph's hosted Subgraph Studio is live for this project — the only
  permitted phrasing is **"indexable receipt, indexed by a local run"** (`docs/DEMO.md`)

From this session's own hard constraints (do not cross these regardless of what the repo docs
say elsewhere):

- ERC-20 or UNI token input support
- EURC support
- multi-chain support (this is Ethereum Sepolia only)
- Robinhood support
- Arc readiness
- World Chain integration
- hosted subgraph availability (only the local run is proven)
- public website availability (do not assert the surface is publicly reachable unless it is
  verified true on recording day — §3.2)
- sponsor qualification or prize eligibility of any kind
- any prize amount, slot strategy, private file name, or the war-room path
- any AI tool name, model name, or "generated"/"AI-assisted" language on camera — `AI_USAGE.md`
  is the written disclosure channel; the video is not where that disclosure lives

The only permitted summary claim, verbatim, is the one this file's shot 12 already uses:

> "UNICA demonstrates a live, verified USDC settlement flow on Uniswap v4 Sepolia, with
> order-bound full-fill enforcement and an indexable receipt."

---

## 6. Pre-recording checklist

Run these the day of recording, before rolling camera, and update this file's evidence lines if
any number has moved:

```sh
bash docs/proof/verify-live.sh          # expect 31 of 31 — if not, the demo's facts have moved
DEPLOYER=0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73 bash integrations/graph/local-e2e.sh
                                         # rebuilds the fork, deploys the subgraph, queries it;
                                         # expect one Settlement entity, amountOut 2003660
forge test                              # expect 54 passed, 0 failed
```

And re-read `docs/DEPLOYMENT.md`'s "Protecting the live pool" table for the pool's *current*
price and whether a fresh 0.001 ETH settlement would land above or below 1.5 USDC — that single
number decides whether shot 4 is a refusal or a fresh success, and this file does not assume
either for 2026-09-10.
