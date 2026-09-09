# UNICA — demo video timeline, shot by shot

Companion to [`script.md`](script.md). Seven shots, 3:00 total. Every terminal command below was
**run on this machine on 2026-09-08** and the output pasted is what it actually printed — not a
mock-up and not a memory. Where a command needs the network, a fallback that does not is given, and
the fallback was run too.

> **The rule this file exists to enforce.** A demo script containing a command that fails on camera
> is the defect this whole package exists to prevent. Two commands in this repository's own README
> were already broken when tested for this timeline — see §*Two commands that did not work* at the
> bottom. Run every command in this file yourself, in order, the morning of the recording.

## Conventions

- `$RPC` is `https://ethereum-sepolia-rpc.publicnode.com`. Export it once before recording:
  ```sh
  export RPC=https://ethereum-sepolia-rpc.publicnode.com
  ```
- Every command is run from the repository root unless the command itself `cd`s.
- Every command in this file is **read-only**. Nothing signs, broadcasts, funds or deploys.
- Prompt should read `unica $` and nothing else — see [`redaction-checklist.md`](redaction-checklist.md).

---

## Shot 1 — PROBLEM · 00:00 → 00:17

| | |
|---|---|
| **On screen** | `title-card.svg`, full-frame, static |
| **Clicks** | none |
| **Command** | none |
| **Narration** | `script.md` beat 1 |

Open the SVG directly in a browser at 1920×1080 and press F11 for full screen. It is hand-written,
has no script, no external image, no web font, so it renders offline with no network at all.

**Fallback:** if the browser chrome will not hide, open `title-card.svg` in Preview
(`open docs/submission-media/video/title-card.svg`) and full-screen that instead. Third fallback:
talk over a plain terminal showing `ls specs/` — the beat is narration-led and needs no visual.

---

## Shot 2 — LIVE SETTLEMENT ON SEPOLIA · 00:17 → 00:55

| | |
|---|---|
| **On screen** | browser on the settlement transaction, then cut to terminal |
| **Narration** | `script.md` beat 2 |

### 2a. The explorer (browser, ~12 s)

Open exactly this URL — do not search for it on camera, do not type it, paste it:

```
https://sepolia.etherscan.io/tx/0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83
```

**Expect:** Status `Success`, Block `11640026`, chain Sepolia. Scroll once to the Logs tab and let
the `SettlementReceipt` and `Swap` entries land on screen. Do not narrate the log fields — beat 2
does not claim them individually.

**Fallback if Etherscan is slow, rate-limits, or shows an interstitial:** cut straight to 2b. The
terminal proves every sentence in beat 2 on its own, which is why 2b is not optional.

### 2b. The chain, asked directly (terminal, ~14 s)

```sh
cast receipt 0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83 status --rpc-url $RPC
cast receipt 0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83 blockNumber --rpc-url $RPC
cast call 0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0 'receiptCount()(uint256)' --rpc-url $RPC
cast call 0x044bc8a8773EC7b9B8de2467766636dFFCaC6210 'orderCount()(uint256)' --rpc-url $RPC
```

**Real output, 2026-09-08:**

```
1 (success)
11640026
1
1
```

Three seconds each. `0x11202071…` is the hook, `0x044bc8a8…` is the executor; both are public
deployment addresses and are safe on camera.

### 2c. The whole proof (terminal, PRE-RECORD THIS)

`verify-live.sh` takes **84 seconds** wall-clock against the public endpoint. That is longer than
the whole beat, so **record it before the session** and cut to its final frame.

```sh
bash docs/proof/verify-live.sh
```

**Real tail, 2026-09-08:**

```
PASS  the settle transaction's swap was sent by the Universal Router (PoolManager Swap event sender)
PASS  the receipt names an order
PASS  the order the receipt names is Settled and cannot be paid again (status 3)
PASS  a replay of pay(orderId) is refused (eth_call reverts)
PASS  the recipient's USDC transfer in the settle transaction equals the receipted amountOut
PASS  the receipted amountOut is at least the 1.5 USDC minimum the order asked for
PASS  no residual native balance on the executor
PASS  no residual USDC on the executor
PASS  no residual USDC on the router
PASS  Sourcify: hook source verified
PASS  Sourcify: executor source verified
checks run: 31, passed: 31, failed: 0
note: 5 chain read(s) needed a retry — the endpoint was flaky, the chain was not
```

**That last line will not always say five.** The script retries flaky reads on purpose
(`docs/proof/retry.sh` records it scoring 28/31, 24/31, 28/31 in one minute against a chain that had
not changed). The number of retries varies run to run; **31, 31, 0** does not.

**Fallback:** the day-1 half is faster and independent —

```sh
bash docs/proof/verify-day1.sh
```

**Real tail, 2026-09-08** (19 s):

```
PASS  committed broadcast record: 5 receipts, all status 0x1
PASS  broadcast record carries no secret-shaped field
checks run: 14, passed: 14, failed: 0, unreachable: 0
```

Both halves together are `make proof` — **14/14 + 31/31**.

---

## Shot 3 — VERIFICATION · 00:55 → 01:21

| | |
|---|---|
| **On screen** | terminal, one command, output scrolling to its verdict |
| **Narration** | `script.md` beat 3 |

```sh
node tools/unica-verify/cli.mjs --input tools/unica-verify/fixtures/fork-settlement.json
```

**Real output, 2026-09-08 — the tail, which is the frame to hold on:**

```
  PASS  the quote digest recomputes from the quote's own fields
        0x094d6ded1d6470ab5b7a92c2ebfc46779aff1f2fb4b79e11a38abbfc8b9d6f09
  PASS  the recomputed digest is the digest the receipt records
  PASS  the merchant signature satisfies the V2 EOA policy
  PASS  the recovered signer is the merchant the quote names
  ...
  PASS  the merchant was delivered exactly the invoice
        invoice 100000000, delivered 100000000
  PASS  the payer's signed ceiling was not exceeded
        ceiling 1000000000000000000, actually spent 41792042795051823
  PASS  the PoolId recomputes from the complete pool key
        0x3808af73802a48d62b646371de0268429c4f6eb39b80e9a51fbcaf47a49c7121
  PASS  the recomputed PoolId is the pool the receipt records

VERIFIED
  37 of 37 checks passed, 0 mandatory failures, 0 notes
```

Runtime under one second. No network. It reads a committed fixture.

**Say the boundary out loud if you linger on this frame:** the fixture is a real settlement captured
off a **local fork** of Sepolia. V2 is not deployed to any public chain. The narration does not
claim it is, and neither should an ad-lib.

**Fallback:** none needed — this command is offline and deterministic. If node is missing, the whole
recording is blocked before shot 3; check it in `recording-checklist.md` §pre-flight.

---

## Shot 4 — TREASURY, BEING BUILT · 01:21 → 01:48

| | |
|---|---|
| **On screen** | terminal, the live Arc read, held on its closing block |
| **Narration** | `script.md` beat 4 |

```sh
node integrations/arc-treasury/live-check.mjs
```

**Real output, 2026-09-08 — the tail:**

```
— one account, one pot of money, two representations —
  account 0x0000000000000000000000000000000000000000
    native     865034306417121744253729820  = 865034306.417121744253729820  (18dp)
    token                  865034306417121  = 865034306.417121  (6dp, as read)
    native / 10^12 = 865034306417121
  PASS  the ERC-20 balance is exactly the native balance scaled down by 10^12
    read WRONGLY at 18dp the token balance would display as 0.000865034306417121 USDC
  PASS  …and reading the token at 18dp understates the holding by a factor of 10^12
  PASS  the two live balances refuse to be added, though they describe the same money

— what this repository does NOT claim about Arc —
  PASS  no UNICA contract address is asserted on Arc by this module (13 files scanned)
        Nothing in integrations/arc-treasury/ deploys, and no UNICA contract exists on Arc.
        Uniswap is not deployed on Arc, so this integration builds no swap path and models no DEX.
        Arc is testnet-only; there is no Arc mainnet to claim anything about.

checks run: 20, passed: 20, failed: 0
```

**Hold the "does NOT claim" block on screen while the narration says "no UNICA contract exists on
Arc".** The sentence and the frame agreeing is the whole point of the beat.

**Fallback — offline, no network, and it is the number the narration quotes:**

```sh
node integrations/arc-treasury/test.mjs
```

**Real tail, 2026-09-08:**

```
— coverage of the closed vocabularies —
  PASS  every ACTION member was produced by a row (5/5)
  PASS  REASON members exercised (18/19)
        every REASON is produced by a row except DECIMALS_NEVER_READ, which is defensive and unreachable through decide()

checks run: 177, passed: 177, failed: 0
```

**Second fallback**, if Arc's public RPC is down and you want the live-chain feel from Sepolia
instead — the ENS identity chain, which ends with its own honest disclaimer block:

```sh
node integrations/ensv2/demo.mjs
```

**Real tail, 2026-09-08:**

```
WHAT THIS IS NOT
  - every stage above is a LOCAL FIXTURE or a local computation; none is a live chain read
  - V2 is not deployed to any public chain, so no settlement can follow this quote
  - the merchant policy was read from committed bytes, not from a deployed registry
  - no key is used, nothing is signed, and nothing is sent
```

---

## Shot 5 — CONFIDENTIAL STRATEGY · 01:48 → 02:24

| | |
|---|---|
| **On screen** | terminal, the CRE CLI simulating the confidential workflow |
| **Narration** | `script.md` beat 5 |

### The three preconditions, and why this shot is the fragile one

This is the only shot with a dependency that is **not currently satisfied by default on this
machine**. Check all three before you press record.

| # | Precondition | Check | State on 2026-09-08 |
|---|---|---|---|
| 1 | **bun ≥ 1.2.21** on `PATH` | `bun --version` | ⚠️ **`1.2.5` — TOO OLD. This shot fails.** |
| 2 | The five policy env vars exported | they live in `integrations/chainlink-cre-guardian/workflow/.env` (gitignored) | present |
| 3 | A logged-in CRE account | `cre whoami` | logged in; **Deploy Access: Not enabled** |

**On precondition 1.** The `@chainlink/cre-sdk` declares `"engines": { "bun": ">=1.2.21" }` and
nothing checks it. An older bun fails with a bare `wasm unreachable` trap that names neither bun nor
the workflow — Chainlink's own unmodified `hello-world-ts` template fails at byte-identical WASM
offsets. That is documented as a finding in `docs/feedback/chainlink.md`, and it is the reason this
row is a ⚠️ and not a footnote. **`bun test` passes on any bun; `cre workflow simulate` does not**,
so a green test row is *not* evidence this shot will run.

Install a current bun before recording:

```sh
curl -fsSL https://bun.sh/install | bash && exec $SHELL -l && bun --version
```

Expect `1.4.2` or later. **Do not** rely on a bun living under `/private/tmp/` — a temporary copy
was used to verify this timeline and a scratch directory is not a recording dependency.

### The command

```sh
cd ~/Desktop/unica/integrations/chainlink-cre-guardian && set -a && . ./workflow/.env && set +a && cre workflow simulate workflow --target staging-settings --non-interactive --trigger-index 0
```

`set -a; . ./workflow/.env; set +a` exports the five values **without printing any of them**. Do not
`cat` that file on camera. `--broadcast` is deliberately absent: the run reads Sepolia and returns a
decision, and sends nothing.

**Real output, 2026-09-08, exit 0:**

```
Initializing...
Loading settings...
Checking RPC connectivity...
Compiling workflow...
✓ Workflow compiled
✓ Simulation limits enabled
  Binary hash: 0e5079e0f565884859efe1ed2914c1cbaf5f2c4caaf3cbe86a304db567ab657d
  Config hash: bece38e7321bab5f104f7db19277b54b216940b97ce842960e0c65a85681769d

2026-09-08T21:42:41Z [SIMULATION] Running trigger trigger=cron-trigger@1.0.0
╭────────────────────────────────────────────────────────────────────────────────╮
│ Handler requested TEE Execution                                                │
│ The simulator is not a real TEE, and is meant to debug.                        │
│ Do not use it for sensitive information.                                       │
│ During real execution, user logs for this trigger will not be visible, and     │
│ will not leave the TEE.                                                        │
╰────────────────────────────────────────────────────────────────────────────────╯

2026-09-08T21:42:41Z [USER LOG] unica-guardian-secrets-loaded
2026-09-08T21:42:41Z [USER LOG] unica-guardian-decision:RESTORE_MINIMUM_RESERVE

✓ Workflow Simulation Result:
{"workflowVersion":"unica-treasury-guardian/1.0.0","policyVersion":1,
 "policyCommitment":"0x130c183e3896db39","actionClass":"RESTORE_MINIMUM_RESERVE",
 "reason":"RESERVE_SHORTFALL","amount":"<REDACTED — see below>","bounded":true,
 "permittedSelector":"0xa9059cbb","evidenceGrade":"CRE_CONFIDENTIAL_SIMULATION"}
```

**Why one field is redacted in this document, and not on camera.** That run returned
`bounded: true`, meaning the action was clamped — and by the limitation this repository documents
and tests, **a clamped amount IS the per-action cap exactly**. Writing the number into a file in a
public repository would publish the demo policy's cap permanently, which is the one thing the
workflow is built not to do. The CLI prints it; this document does not repeat it. On camera the
frame is fine: it is a demo policy value, it is already on screen for two seconds, and it is not
committed to a public history by being filmed. **Do not paste that number into the submission text.**

**The frame to hold** is the box that says *"The simulator is not a real TEE"* next to the result
line that says `CRE_CONFIDENTIAL_SIMULATION`. Those two on screen together are the honest claim.
The result JSON is line-wrapped above for this document; the CLI prints it on one long line.

**One honest note if a viewer asks.** That run returned `bounded: true`, meaning the action was
clamped — and by the limitation this repository documents and tests, a clamped amount **is** the
per-action cap exactly. So that execution published a secret-derived value. It is the known leak,
appearing in a real run. Do not volunteer it in the 36 seconds of narration; do not deny it if
asked.

**Fallback 1 — the workflow's own suite, offline, runs on any bun:**

```sh
cd ~/Desktop/unica/integrations/chainlink-cre-guardian/workflow && bun test
```

**Real tail, 2026-09-08:**

```
(pass) SECRET LEAKAGE — ... > no threshold, target, risk band or cooldown is the value of any published field
(pass) SECRET LEAKAGE — ... > CONTROL: the field-wise test does catch a real leak when one is planted
(pass) SECRET LEAKAGE — ... > KNOWN LIMITATION: the per-action cap IS inferable from a clamped amount
(pass) evidence grading stays honest > a simulation is graded as a simulation
(pass) evidence grading stays honest > TEE_ATTESTED exists but is not what this workflow returns

 30 pass
 0 fail
 860 expect() calls
Ran 30 tests across 1 files. [389.00ms]
```

If you use this fallback, the narration line *"That run just happened: exit zero, Handler requested
TEE Execution"* **must be re-recorded** as *"the workflow's own suite proves the boundary; the CRE
simulation is documented in the repository."* **Do not narrate a simulation the video does not
show.**

**Fallback 2 — a still.** Screenshot the successful run before the session, and cut to the image.
Label it in the submission as a captured run, not a live one.

**Never say, over any of these frames:** DON deployment · TEE attestation · attested · "it runs in a
TEE" · "confidential today".

---

## Shot 6 — STATUS · 02:24 → 02:49

| | |
|---|---|
| **On screen** | three fast terminal commands, then the ⛔ banner |
| **Narration** | `script.md` beat 6 |

### 6a. ENSv2, live (~5 s of screen time; the command takes ~40 s — PRE-RECORD)

```sh
node integrations/ensv2/permissioned-live.mjs
```

**Real tail, 2026-09-08:**

```
— controls —
PASS  namehash of the queried name is stable
PASS  two merchant labels give two different subnames
PASS  the ERC-1967 slot is the derived one, not a literal
PASS  no two selectors in the table collide
PASS  every ledger row carries a word from the observation vocabulary

checks run: 78, passed: 78, failed: 0
rpc calls: 49, all read-only
```

**Say it with the caveat the narration carries: UNICA owns no ENS name.** These rows read a name
somebody else registered. Never imply the name is ours.

**Fallback (offline, instant):** `node integrations/ensv2/permissioned-test.mjs` →
`checks run: 278, passed: 278, failed: 0`. Real, run 2026-09-08.

### 6b. The Graph, fail-closed (~4 s)

```sh
node integrations/graph-v2/live-proof.mjs; echo "exit $?"
```

**Real output, 2026-09-08:**

```
UNICA V2 — live subgraph proof
network      sepolia (chain 11155111)
endpoint     (unset)

  SKIP  live subgraph proof
        UNICA_SUBGRAPH_URL is not set. Set UNICA_SUBGRAPH_URL and run again (this is a SKIP, not a pass)
        a SKIP is not a pass, so this command exits non-zero: an unconfigured run and
        a successful one must never produce the same exit status.

checks run: 0, passed: 0, failed: 0, skipped: 1
exit 1
```

This shot is showing a **red** thing on purpose, and that is the point: the subgraph is not
deployed, no live read has ever been observed, and the tool refuses to let an unconfigured run look
like a passing one. Do not skip it because it looks like a failure. It *is* the honesty.

### 6c. V2, frozen and blocked (~6 s)

```sh
head -9 docs/v2/RELEASE-CANDIDATE-FREEZE.md
```

**Real output, 2026-09-08:**

```
# UNICA V2 — release-candidate interface freeze (`v2.0.0-rc1`)

> ## ⛔ THIS CANDIDATE MUST NOT BE DEPLOYED
>
> An internal security review on 2026-09-08 found and reproduced a **Critical** defect in
> `QuoteSettlementExecutor`: the payer's Permit2 witness does not bind the merchant's half of the
> quote, so a relayer or any mempool observer can redirect a settlement to themselves in full.
> See [`SECURITY-ADVISORY-001.md`](SECURITY-ADVISORY-001.md) and the
> [internal security review](INTERNAL-SECURITY-REVIEW.md).
```

**Fallback for the whole of shot 6:** a single static frame listing the five statuses, cut from
`docs/SPONSOR-ELIGIBILITY.md`. The narration carries the beat unaided; the commands are
corroboration, not the argument.

---

## Shot 7 — CLOSE · 02:49 → 03:00

| | |
|---|---|
| **On screen** | `end-card.svg`, full-frame, static, held to the last word |
| **Clicks** | none |
| **Command** | none |
| **Narration** | `script.md` beat 7 |

Hold two full seconds of silence after the last word before cutting. Do not fade to black on the
repository URL — leave it legible.

**Fallback:** `title-card.svg` again, if the end card will not render.

---

## The whole-run rehearsal, before you record anything

One block. Copy, paste, watch it all pass. It is entirely read-only.

```sh
cd ~/Desktop/unica && export RPC=https://ethereum-sepolia-rpc.publicnode.com && \
cast receipt 0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83 status --rpc-url $RPC && \
node tools/unica-verify/cli.mjs --input tools/unica-verify/fixtures/fork-settlement.json | grep -E 'checks passed' && \
node integrations/arc-treasury/test.mjs | tail -1 && \
node integrations/ensv2/permissioned-test.mjs | tail -1 && \
(node integrations/graph-v2/live-proof.mjs; echo "graph live-proof exit $? (1 is correct)") && \
head -3 docs/v2/RELEASE-CANDIDATE-FREEZE.md && \
bash docs/proof/verify-day1.sh | tail -1 && \
bash docs/proof/verify-live.sh | tail -2
```

**Run end to end on 2026-09-08. Its actual output, in full:**

```
1 (success)
  37 of 37 checks passed, 0 mandatory failures, 0 notes
checks run: 177, passed: 177, failed: 0
checks run: 278, passed: 278, failed: 0
UNICA V2 — live subgraph proof
network      sepolia (chain 11155111)
endpoint     (unset)

  SKIP  live subgraph proof
        UNICA_SUBGRAPH_URL is not set. Set UNICA_SUBGRAPH_URL and run again (this is a SKIP, not a pass)
        ...
checks run: 0, passed: 0, failed: 0, skipped: 1
graph live-proof exit 1 (1 is correct)
# UNICA V2 — release-candidate interface freeze (`v2.0.0-rc1`)

> ## ⛔ THIS CANDIDATE MUST NOT BE DEPLOYED
checks run: 14, passed: 14, failed: 0, unreachable: 0
checks run: 31, passed: 31, failed: 0
note: 5 chain read(s) needed a retry — the endpoint was flaky, the chain was not
```

The block takes about **two minutes**, almost all of it in `verify-live.sh`. The retry note is the
only line whose number may differ.

---

## Two commands that did not work

Recorded here because a timeline that only lists what passed is not evidence that anything was
tested.

### 1. `cast receipt … --field status` — **BROKEN on this machine**

`README.md` line 306 and `docs/DEMO.md` both give the settlement proof as:

```sh
cast receipt 0x1120af18…cb83 --rpc-url $RPC --field status
```

On the `cast` installed here that **fails**:

```
error: unexpected argument '--field' found
  tip: to pass '--field' as a value, use '-- --field'
Usage: cast receipt --rpc-url <URL> <TX_HASH> [FIELD]
```

The field is **positional**, not a flag. The working form — used throughout this timeline — is:

```sh
cast receipt 0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83 status --rpc-url $RPC
```

which prints `1 (success)`.

**Why it differs:** `cast --version` here reports `1.3.5-foundry-zksync-v0.1.9` — a **foundry-zksync**
build, not upstream Foundry, which CI pins at `v1.5.1`. Do not type the README's form on camera.
This is a repository defect worth fixing separately; it is out of scope for this package, which may
only write under `docs/submission-media/`.

### 2. `cre workflow simulate` without the env exported — **fails with a clear error**

First attempt, before sourcing `workflow/.env`:

```
✗ failed to replace secret names with environment variables: environment variable UNICA_MIN_RESERVE
  for secret value not found, please export it to your environment
```

Exit 1. The `set -a && . ./workflow/.env && set +a` prefix in shot 5 is not decoration — without it
the shot fails on camera at the last second, after the compile step has already succeeded and
everything looks fine.
