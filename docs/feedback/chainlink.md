# Chainlink

**Touches UNICA today:** nothing in the tree. One seam was considered and set aside: an
executor-side price-feed read as a sanity check on an order's quoted price before settlement.

**Published requirement** (Best Chainlink-Powered Upgrade, ethglobal.com/events/ethonline2026/
prizes, retrieved 2026-09-05): "Integrate at least one Chainlink service directly within smart
contract logic or onchain workflows."

**What would have to be built:** a price feed read inside `SettlementExecutor` or the hook,
comparing an order's stated minimum against a live feed before allowing settlement to proceed.
Not built; no defect motivated it, it is a hardening idea, not a fix. Separately, the
Confidential Workflow track's own bar — registering a TEE handler — is not met by a plain feed
read, and the Upgrade track's own prize is marked Continuity-only in our research, which closes
it to a from-scratch entry; neither track fits this seam as designed.

**What we'd ask Chainlink to change:** no request. Nothing encountered while scoping this seam
pointed at a documentation or interface gap.

Status: no claim of qualification.

---

## 2026-09-08 — source inspection of the liquidation-protection challenge

Pin: `solangegueiros/cf-liquidation-protection-challenge@58b24604795cd4c8a32ccd30e4d11f4962e3b3ac`,
MIT. Toolchain observed: `@chainlink/cre-sdk@1.18.0`, Bun (README asks for >= 1.2.21).

**VERIFIED** — the challenge is **owner protection**, not third-party liquidation. `README.md`:
"Build a Confidential Workflow that protects a virtual ETH-collateral/vUSD-debt position." Every
participant receives an identical position via `join()`.

**VERIFIED** — there is **no Chainlink price feed** in the challenge. `vETHPrice` is set by an
admin call, `updatevETHPrice()`. Data Feeds, Automation and Functions are not required; the trigger
is a CRE cron (`CronCapability` + `handlerInTee` in `automated-liquidation-protection-workflow/main.ts`).

**VERIFIED** — no asset conversion is needed. `join()` grants 5.00 free vETH and 3000.00 free vUSD
alongside the position, and both protective actions (`deposit`, `repay`) take assets the participant
already holds. We are therefore **not** routing this through Uniswap; doing so would add a failure
point and earn nothing in the published scoring.

**OBSERVED** — the effective liquidation boundary is higher than the threshold implies.
`calcHF` floors, and `checkAllHF` liquidates at `hf <= 100`. An untouched starting position is
liquidatable at any price at or below **1812.82** (9.4% below the start), and the $1800 step of the
"safe volatility" scenario floors to exactly 100. **All five published scenarios liquidate an
untouched position.** Reproducible: `node integrations/chainlink-cre-guardian/test.mjs`.

**OBSERVED** — the example workflow computes its collateral requirement with **floor** division
(`main.ts`, `neededCollateral`), where the contract also floors when it recomputes. That can land
one unit below the intended target. Our model rounds that division up; the difference is a killed
mutation in our suite.

**OBSERVED** — the example logs `hf`, `minHfTrigger` and `targetHf` through `runtime.log`. The
published confidentiality scoring awards three points for "no private inputs appear in logs, errors
or public configuration".

**BLOCKER** — `README.md` names ChallengeLending `0x9792b3cc…`, vETH `0x5dED1a40…`, vUSD
`0x6Fe92Ead…`. `automated-liquidation-protection-workflow/config.staging.json` names
`0x63b91836…`, `0x89F0DF6D…`, `0xC96c0070…`. Both sets are carried in our
`integrations/chainlink-cre-guardian/profiles.mjs` as named profiles with no default.

**SUGGESTION** — a one-line note in the README saying which set the shipped config points at, or
updating the config, would remove the trap entirely.

**QUESTION** — the fifteen open questions are in `FEEDBACK.md`. None has been answered.


---

## Running the real CLI, 2026-09-08 — and the control that overturned my own diagnosis

`cre login` succeeded (CLI **v1.32.0**, macOS 15.6.1 arm64). What followed is worth recording in
full, including the part where I was wrong twice, because the wrongness is the finding.

### The failure

Every `cre workflow simulate` ended the same way:

```
Failed to create engine: failed to execute subscribe: error while executing at wasm backtrace:
    0:  0x9a097 - <unknown>!<wasm function 313>
    1:  0xdb47f - <unknown>!<wasm function 1231>
Caused by: wasm trap: wasm `unreachable` instruction executed
```

Nothing in that names a capability, a field, a line, or a dependency.

### What I concluded, and why both conclusions were wrong

I bisected our own workflow and published two findings. **Both were artifacts, and both are
retracted here rather than quietly edited out of the file above.**

1. *"Javy refuses exported functions that take parameters."* I hit
   `Error: Exported functions with parameters are not supported` and restructured our module
   around it. **Wrong as a general rule** — Chainlink's own `hello-world-ts` template exports
   `onCronTrigger(runtime)` and `initWorkflow(config)` directly from its entry module and
   compiles without complaint. The error was an artifact of the environment below, not a
   constraint on workflow authors.

2. *"CLI v1.32.0 against SDK 1.18.0 may be mismatched version lines."* **Wrong** — the control
   below fails identically on SDK **1.20.0**.

One of the three original findings survives and is real: our `tsconfig.json` had
`"include": ["*.ts"]`, which swept the test file into the workflow build. The official template
uses `"include": ["main.ts"]` — scoped to the entry alone. That one was ours and is fixed.

### The control, which is what actually found it

Rather than keep bisecting our own code, I scaffolded Chainlink's own template unmodified —
`cre init --template hello-world-ts` — and simulated it. It failed at **byte-identical WASM
offsets**: `0x9a097` and `0xdb47f`. Same trap, official code, newer SDK, nothing of ours in it.

That inverted the question from *what is wrong with our workflow* to *what is wrong with this
machine*, and the answer was one line in the SDK's own `package.json`:

```json
"engines": { "bun": ">=1.2.21" }
```

The installed bun was **1.2.5**. Dropping bun **1.4.2** onto PATH — changing nothing else, in
neither project — made the official template AND our workflow simulate successfully on the first
attempt.

### What we would ask for

**Check `bun --version` against the SDK's `engines` field at startup and fail with that
sentence.** The requirement is already declared in the package the CLI installs; nothing reads it,
and the resulting failure names everything except the cause. One line would have saved a
multi-hour detour, and it would have saved it for every developer on an older bun rather than just
for us.

Secondary, and smaller: a `wasm unreachable` trap with a raw backtrace is not an error message a
workflow author can act on. Even "the workflow module failed during trigger registration" would
narrow it from *the entire toolchain* to *one phase*.

### What ran, once bun was current

```
│ Handler requested TEE Execution                                                   │
│ The simulator is not a real TEE, and is meant to debug.                           │
│ During real execution, user logs for this trigger will not leave the TEE.         │

[USER LOG] unica-guardian-secrets-loaded
[USER LOG] unica-guardian-decision:RESTORE_MINIMUM_RESERVE

✓ actionClass RESTORE_MINIMUM_RESERVE · reason RESERVE_SHORTFALL
  policyCommitment 0x130c183e3896db39 · evidenceGrade CRE_CONFIDENTIAL_SIMULATION
```

The five private policy values loaded from CRE secrets inside the handler; the published result
carries a commitment, an action class and a reason category and **no threshold** — the boundary
this workflow was built around, holding under the real engine rather than only under our own
suite.

**One honest note about that specific run.** It returned `bounded: true`, meaning the action was
clamped — and by the limitation this repository already documents and tests for, a clamped amount
IS the per-action cap exactly. So that execution published a secret-derived value. It is the known
leak, appearing in a real run rather than only in the leak suite. Recorded because a green
simulation should not be allowed to imply the boundary is airtight.

### Account state

`cre whoami` reports **Deploy Access: Not enabled**; `cre account access` has been submitted and is
awaiting review. Also observed and transient: `api.cre.chain.link` returned a **Cloudflare 520**
during credential validation, self-described as retryable. It cleared on the next attempt.

Status: `SIMULATED_IN_CRE` — the workflow runs in Chainlink's own simulator, which the CLI states
plainly is **not a real TEE**. Nothing here has executed in an enclave, and the evidence grade the
workflow stamps on its own output still says `CRE_CONFIDENTIAL_SIMULATION`, never `TEE_ATTESTED`.

---

### 2026-09-11 — Robinhood Chain testnet (46630) has Data Streams and CRE infrastructure but no Data Feeds, so its own Robinhood test tokens cannot be priced

**Trying to:** price the Robinhood testnet Robinhood test TSLA/NFLX tokens on chain 46630 with a Chainlink
Data Feed, as a sanity check before settlement.

**Blocked by:** no Data Feed exists for chain 46630. `reference-data-directory.vercel.app/feeds-robinhood-testnet.json`
returns HTTP 404 (verified live, 79 bytes), and `chains.ts` lists exactly one Robinhood network,
`"Robinhood Chain Mainnet"` — no testnet entry exists: `smartcontractkit/documentation`,
`src/features/data/chains.ts`, lines 624-637,
https://raw.githubusercontent.com/smartcontractkit/documentation/main/src/features/data/chains.ts.
The same chain id nonetheless hosts a live Data Streams `VerifierProxy` (proxy address
`0x72790f9eB82db492a7DDb6d2af22A270Dcc3Db64`; codesize 7009; `typeAndVersion()` =
`"VerifierProxy 2.0.0"`) and a live CRE `KeystoneForwarder` (forwarder address
`0x8E6E6A1f2B2D4dF503bfd67951CF28F27BF3AF19`; codesize 8591; `typeAndVersion()` =
`"KeystoneForwarder 1.0.0"`), both read live against chain 46630 on 2026-09-11. The Robinhood test
TSLA token (token address `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E`; `symbol()` =
`"TSLA"`) reverts on `latestRoundData()` — it is a plain ERC-20, not a price source.

**Cost:** not recorded as a duration — a survey finding, not a debugging session.

**Would have prevented it:** one line on the Data Feeds addresses page, or in `chains.ts` itself,
stating that Robinhood Chain Testnet carries no Data Feed today, next to the Data Streams and CRE
entries the same page family already documents for the same chain id — so confirming the gap does
not require three separate live contract reads plus two documentation fetches.

### 2026-09-11 — the reference-data-directory lists TSLA and NFLX v8 and v11 Data Streams, but the public Discovery API returns neither NFLX nor any v8-schema stream

**Trying to:** confirm through Chainlink's own Discovery API that the TSLA/NFLX Data Streams feed
ids published in the reference-data-directory are actually queryable, before designing an adapter
around them.

**Blocked by:** `feeds-ethereum-testnet-sepolia-arbitrum-1.json` lists v8- and v11-schema rows for
both tickers, e.g. NFLX/USD v8
(feed id `0x0008a024a686a2558a0214497367764f6dddf41076c08ea98234e76a8be18f6e`), and three v11 NFLX
rows — https://reference-data-directory.vercel.app/feeds-ethereum-testnet-sepolia-arbitrum-1.json.
That v8 row and the three v11 rows carry no `docs.hidden` flag. The unauthenticated public
endpoint `https://api.testnet-dataengine.chain.link/api/v1/discovery` (HTTP 200, no credentials
sent, fetched 2026-09-11 20:10 UTC) returns 470 feed entries. `TSLA` is the base asset of 7 of them:
6 with `schemaVersion: "V11"` and one with `"V0"`, an entry with an empty name created that day.
`NFLX` appears 0 times. Across all 470 entries, `schemaVersion` takes only the values V0, V2, V3,
V4, V7, V9 and V11 — `"V8"` occurs zero times, for any asset (five entries whose feed ids begin
`0x0008`, EUR, ABT and EWJ, are labelled `"V4"`). The endpoint's own page says an
unauthenticated call returns "the streams Chainlink lists publicly" —
https://docs.chain.link/data-streams/reference/data-streams-api/discovery-endpoint.

**Cost:** not recorded as a duration — an API-reachability check, not a debugging session.

**Would have prevented it:** a note on the Data Streams supported-assets or Discovery API page
stating that v8-schema streams and NFLX specifically are not exposed through the public Discovery
endpoint, so a builder does not conclude from the reference-data-directory alone that a listed
stream is reachable there.

Status: no claim of qualification.
