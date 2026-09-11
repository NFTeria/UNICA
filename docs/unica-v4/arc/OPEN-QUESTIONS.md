# Arc workstream — open questions and owner decisions

Compiled 2026-09-11, read-only, from the eight sibling files in this directory: `NETWORK.md`,
`TOKENS.md`, `COMPATIBILITY.md`, `NANOPAYMENTS.md`, `X402.md`, `LIQUIDITY-ORACLES.md`,
`THREAT-MODEL.md` (escalated; its own §6 already reconciles several earlier-file unknowns, and
that reconciliation is followed here rather than re-argued), and `PRODUCT-FLOWS.md`. This file adds
no new on-chain read and touches no wallet — no owner balance was read to write it, and none is
read by it. It only sorts what the eight files already found into two kinds of open item: an
external fact only Circle, Uniswap, Chainlink, Safe, or the x402 ecosystem can supply, or a
decision only the project owner can make. Every entry cites the sibling file and section it comes
from; nothing below contradicts a sibling file, and where two sibling files disagree, the
resolution follows whichever is later and more corroborated, stated explicitly.

## 0. How to read this file

Each row states the question, its current state with a citation, what would close it, and who
closes it. "External" means no UNICA action can settle it — only re-checking a named primary
source or RPC once it publishes something new. "Owner" means the gap is a decision, an
authorization, or a piece of information only the project owner holds. "Code task" appears only
where the work is gated on one of the two, so the dependency stays visible rather than hidden in a
backlog.

## 1. Arc testnet vs mainnet — the target that gates almost everything else

| Question | Current state | What settles it | Who |
|---|---|---|---|
| Which Arc network does UNICA actually build against for the beta — testnet only, or does mainnet enter scope once it is public? | Testnet (chain id `5042002`) is live, public, and independently confirmed on-chain (`NETWORK.md` §3, `TOKENS.md` §1). Mainnet is not public: `docs.arc.io/arc/references/contract-addresses.md` states plainly "Mainnet addresses are not yet available" (`NETWORK.md` §3), and Circle's own pressroom (2026-08-05) targets a public launch on 2026-09-16 — five days after every sibling file's retrieval date (`NETWORK.md` §2, `COMPATIBILITY.md` §3.1). No sibling file's mainnet gate is met today. | An explicit owner statement of target: "testnet-only for the beta" closes this outright. If mainnet is wanted: `docs.arc.io` must publish a mainnet RPC, explorer, and contract-address page, and an independent `eth_chainId` read against that RPC must return `5042` decimal, matching Circle's own `circlefin/arc-node` `BREAKING_CHANGES.md` (`THREAT-MODEL.md` E-48; `LIQUIDITY-ORACLES.md` "Network status"). | **Owner** (the target itself) then **External** (mainnet publication, for the mainnet branch only) |
| Is Arc's "private mainnet" already running, or still "Upcoming"? | Two Circle-controlled primary sources disagree, not silently resolved: `docs.arc.io`'s deployment-model page marks Private Mainnet "Upcoming" (retrieved 2026-09-11); Circle's own 2026-08-05 pressroom describes an already-running private mainnet with "more than 100 ecosystem and institutional builders" (`NETWORK.md` §2). | Either page updating to match the other, or a direct question to Circle. Does not block the testnet-only path in the row above. | **External** |
| Is Arc mainnet's chain id `5042`? | Stated by a primary Circle source — `circlefin/arc-node`'s `BREAKING_CHANGES.md`: "The CL on mainnet (chain id `5042`)" (`THREAT-MODEL.md` E-48) — and consistent with Uniswap's `sdk-core` (`ChainId.ARC = 5042`, E-05) and Safe's canonical registry key `"5042"` (E-42). **Not independently confirmed on-chain**: no public mainnet RPC exists to run `eth_chainId` against (E-02, E-04). `NETWORK.md` §3, written earlier the same day, still calls `5042` unconfirmed and warns not to treat a secondary aggregator's claim of the same number as fact — that caution stands for the *aggregator* claim; the `arc-node` repository is Circle's own and is treated as sourced-but-unread-back here, per `THREAT-MODEL.md`'s more corroborated finding. | A mainnet RPC publishing, then one `eth_chainId` read returning `0x13b2` (`5042` decimal). | **External** |

## 2. cirBTC — identity, the owner's wallet, and the mainnet gap

| Question | Current state | What settles it | Who |
|---|---|---|---|
| What is cirBTC's contract address on Arc Testnet? | **Resolved, not by a wallet read.** Circle's own developer docs publish it: `developers.circle.com/assets/cirbtc-contract-addresses.md`, linked from `faucet.circle.com` — "Arc Testnet `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF`" (`THREAT-MODEL.md` E-17). Independently read on-chain the same day: `name()` "Circle Wrapped Bitcoin", `symbol()` "cirBTC", `decimals()` 8, EIP-3009 typehash present, domain bound to chain `5042002` (E-18, E-18b). This corrects `TOKENS.md` §5 and `LIQUIDITY-ORACLES.md`'s earlier "UNKNOWN, not published" finding, written before this address was found; `THREAT-MODEL.md` §6 records the correction itself. | Already settled for testnet, from a primary source plus an on-chain read — no further action needed on the address question alone. | Closed (**External** source, already found) |
| Does the address the owner's own wallet has interacted with (if any) match Circle's published one? | **Not checked, and not checkable from public sources.** The hard rule for every file in this directory forbids reading any balance of an owner address; none was read, here or in any sibling file. Separately, the public explorer surfaces 50 tokens self-labeled "cirBTC" or "Circle Wrapped Bitcoin," of which only `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` is Circle's — 23 share the exact symbol, 4 share the exact name and decimals, and the explorer's own "verified"/"certified" flags are false on **all 50, Circle's included** (`THREAT-MODEL.md` E-20). Anyone can deploy a look-alike on a permissionless testnet (`TOKENS.md` §5). | The owner checks their own wallet's held-token contract address against `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` directly — a comparison the owner can make themselves, without anyone else reading their wallet. If it differs, treat the held token as an unconfirmed impostor and do not use it, per `TOKENS.md` §5's own ruling. | **Owner** (a self-check, not a request for anyone else to read the wallet) |
| Is cirBTC live on Arc at all, or only "coming soon"? | Two Circle-owned pages disagree, fetched the same day: `circle.com/cirbtc` lists Arc under "Coming Soon"; `developers.circle.com/assets/what-is-cirbtc.md` lists "Arc (testnet)" as already live (`LIQUIDITY-ORACLES.md` "Pair 3"; `PRODUCT-FLOWS.md` §5). `THREAT-MODEL.md`'s on-chain read (E-18) shows the testnet contract *exists and answers calls today*, which weighs toward "live," but does not itself resolve which Circle page is the more current statement of Circle's own product status. | Circle updating one page to match the other, or a direct clarification from Circle support. | **External** |
| Does cirBTC exist on Arc Mainnet? | **No.** Only an Ethereum mainnet address is published (`0x72DFB2E44f59C5AD2bAFE84314E5b99a7cd5075E`, `THREAT-MODEL.md` E-19); no Arc mainnet cirBTC address exists anywhere in material retrieved, and Arc's own contract-addresses page does not list cirBTC at all, testnet or mainnet (`TOKENS.md` §5). | Circle publishing an Arc mainnet cirBTC address — gated on Arc mainnet itself existing first (§1). | **External** |
| Who is cirBTC's legal issuer? | Inconsistent between two Circle pages: `circle.com/cirbtc` names "Circle International Bermuda Limited, a Class F Digital Asset Business" under the Bermuda Monetary Authority; `developers.circle.com/assets/what-is-cirbtc` describes issuance without naming that entity (`LIQUIDITY-ORACLES.md` "Pair 3"). The Bermuda-entity framing is treated as authoritative in that file, not resolved by either page updating. | Circle publishing one consistent issuer statement across both pages. | **External** |
| Should a BTC market be enabled on Arc at all right now? | **No, by standing project policy, independent of the address question above.** The testnet token is explicitly "not backed by real Bitcoin" (E-17); no Arc mainnet contract exists (row above); and no authenticated price feed for it has a confirmed Arc address (§5 below). `THREAT-MODEL.md`'s own conclusion: "the BTC market stays off." | Requires all three to close together — a confirmed mainnet address, a confirmed oracle, and adequate pool depth — plus the owner's own written confirmation that a BTC-denominated leg is in scope at all, since the standing rule is "no unsupported BTC token" (`TOKENS.md` §5, item 3). | **Owner** (scope decision) + **External** (the three technical gates) |

## 3. Public addresses the owner authorises for balance readback

**No address is authorized today; this is a standing gap, not a technical unknown.** Every
on-chain read across all eight sibling files was of public contract state only — `decimals()`,
`symbol()`, proxy implementation/admin slots, `paused()`, `isBlacklisted()`, CCTP domain ids, Safe
codehashes, and similar — never a balance, and never of an address the owner controls
(`THREAT-MODEL.md`'s evidence ledger states this explicitly for every row; `COMPATIBILITY.md` §0
repeats it: "no live USDC balance of the owner's read here"). Nothing in the research to date needs
this authorization to exist; it becomes relevant only once a future tool or agent is asked to
monitor a specific address's funds (a deployer EOA's gas balance, a Safe's treasury, a merchant
payout address).

| What is needed | Why it matters | What settles it |
|---|---|---|
| A named list of address(es), if any, the owner authorizes for read-only balance checks | Without this, no future session should call `eth_getBalance`/`balanceOf` against any address tied to the owner, per the standing hard rule against reading owner wallet balances without authorization | The owner states, in writing, one or more of: (a) no address is authorized yet — the default today; (b) a specific address (e.g., a fresh deployer EOA funded only for gas, once one exists), scoped to which network(s) it applies to |
| The exact read method(s) permitted, if any address is named | "Balance readback" could mean a live `eth_getBalance`/`balanceOf` check, a historical scan, or an alert on a threshold crossing — these carry different exposure | The owner's authorization names the method (e.g., "current balance only, no history") alongside the address |
| A review point | An authorization granted once should not silently persist forever, especially once a deploy moves from testnet to any chain holding real value | The owner sets, or this doc is revisited at, the next mainnet-scope decision (§1) |

This section exists to be filled in by the owner, not by future research reading anything.

## 4. x402 — what could not be confirmed, and what already was

| Question | Current state | What settles it | Who |
|---|---|---|---|
| Does EURC implement EIP-3009 `transferWithAuthorization` the same way USDC does? | **Resolved, correcting an earlier unknown.** `X402.md` §10 and §14 flagged this as "reported by secondary sources only, not confirmed" at the time of that file's own earlier draft. `THREAT-MODEL.md`'s later on-chain read closes it: EURC's `TRANSFER_WITH_AUTHORIZATION_TYPEHASH()` returns the same value as USDC's, matching the EIP-3009 type string exactly, and both implementations carry the same four EIP-3009 selectors (E-14); both domains bind chain `5042002` (E-15). | Already settled by an on-chain read — no further action needed. | Closed (**External** source, already read) |
| Is x402's canonical Permit2 spender (`x402ExactPermit2Proxy`, `0x402085c248EeA27D92E8b30b2C58ed07f9E20001`) usable on Arc today? | **No — confirmed absent.** `eth_getCode` against that address on Arc Testnet returns zero bytes (`THREAT-MODEL.md` E-22), correcting `X402.md`'s earlier framing of it as "the usable Permit2 spender for x402" (`THREAT-MODEL.md` §6). Only the `eip3009` route is live for x402-shaped flows on Arc; canonical Permit2 itself (not the x402 proxy) is present and its domain binds `5042002` (E-21). | Coinbase/x402-foundation deploying the proxy to the same canonical address on Arc, then an `eth_getCode` read confirming non-empty bytecode. | **External** |
| Will Arc appear on the x402 protocol's canonical network list, or the CDP Facilitator's supported-network list, before or at Arc mainnet launch? | **Genuinely open — no forward commitment found.** Arc is absent from `docs.x402.org/core-concepts/network-and-token-support`, from `specs/x402-specification-v2.md` §11.1's worked examples, and from the CDP Facilitator's own supported-chain list (`X402.md` §9, §14). Only Circle's own Gateway/Nanopayments product and its `circlefin/arc-nanopayments` sample repo support Arc today, testnet-only, Circle-operated — not the open x402 ecosystem. | Either registry adding an Arc entry. Nothing UNICA does changes this timeline. | **External** |
| What is the CDP Facilitator's exact enumerated list of ERC-20s it accepts, per network, beyond USDC? | **Unknown.** Its own docs say "all ERC-20 tokens on its EVM networks" without an enumerated list (`X402.md` §14). Irrelevant to Arc today since CDP does not list Arc at all (row above), but would matter the moment it did. | CDP publishing an explicit per-network asset list. | **External** |
| Should UNICA build a quote-digest-binding x402 extension, so a relayer cannot substitute a different order under a payer's x402 authorization? | **A live owner-decision-shaped gap, not yet designed.** `X402.md` §11 names this directly: x402's `exact` authorization carries six flat fields (`from, to, value, validAfter, validBefore, nonce`) with no quote digest at all (E-24) — narrower than UNICA's own V2 Permit2 witness, which Advisory 001 already found insufficient for the same reason (§4.2 below). No such extension exists in any x402 spec version fetched, and no UNICA design work has begun on one. | The owner deciding whether this extension is worth building before any x402-fronted UNICA order goes live, and if so, commissioning the design — which would need the same adversarial re-derivation Advisory 001 used before it is trusted (`THREAT-MODEL.md` §4.2). | **Owner** |
| Should a public, unbound x402 payment link be offered as its own UNICA order mode? | **Designed-for, not designed.** `DECISIONS.md` item 111/128 (lead, cited in `X402.md` §11 and `THREAT-MODEL.md` §4.2) defers a public payment-link mode to a later release, "behind a separate signed-intent security review that starts with Advisory 001." | An owner decision to prioritize this mode, followed by the named security review. | **Owner** |

## 5. Chainlink and other oracles — what could not be confirmed

| Question | Current state | What settles it | Who |
|---|---|---|---|
| Does any Chainlink Data Feed exist on Arc **Testnet**? | **No — confirmed absent.** Chainlink's own canonical address list (`docs.chain.link/data-feeds/price-feeds/addresses`, fetched in full, 16.9 MB) has zero Arc Testnet entries (`LIQUIDITY-ORACLES.md` "What could not be confirmed"; `THREAT-MODEL.md` E-34). | Chainlink publishing a testnet feed. Nothing UNICA can do to accelerate this. | **External** |
| Does a Chainlink Data Feed exist on Arc **Mainnet**? | **Listed, but unreadable.** The same directory carries an "Arc Mainnet" network with 30 feeds, including EURC/USD (proxy address `0x361b95c10b76Ca3f35C686d423e43A951755Bf23`), USDC/USD (proxy address `0x84EA90AC252Dc437031461836DB5164219147905`), and a cirBTC Proof-of-Reserve feed (proxy address `0xEB0884a871ea1f6483B5FC10fd3D7dC5806411fc`) — each with a 24-hour heartbeat and a 0.5% deviation threshold (`THREAT-MODEL.md` E-33). This corrects `LIQUIDITY-ORACLES.md`'s earlier finding of "no Arc entry at all" (`THREAT-MODEL.md` §6) — the entry exists, it is simply for mainnet, which has no public RPC to read it from (E-04). | A public Arc mainnet RPC (§1), then one `eth_call` per proxy confirming `answer > 0` and `updatedAt` within the feed's own 24-hour heartbeat. | **External** |
| Does Chainlink CRE (Runtime Environment) have any Arc-specific workflow, DON name, or write-target contract? | **None found.** `docs.chain.link/cre` is generic, chain-agnostic product documentation; Arc's own oracle page (`docs.arc.io/arc/tools/oracles.md`) has no CRE section at all (`LIQUIDITY-ORACLES.md` "What could not be confirmed"; `THREAT-MODEL.md` §7). | Chainlink or Arc publishing an Arc-specific CRE workflow id or DON name. | **External** |
| Does any Chainlink Data Streams feed or verifier apply to Arc specifically? | **Not confirmed.** A general BTC/USD stream id exists in Chainlink's pull-based model, but it is chain-agnostic by design; nothing ties it, or any other stream id, to Arc, and no Data Streams verifier contract on Arc was found (`LIQUIDITY-ORACLES.md`). | A Chainlink Data Streams page naming an Arc-specific stream id or verifier address. | **External** |
| Is Circle's claimed "Chainlink Proof of Reserve" for cirBTC backed by a specific feed address? | **Not matched.** `circle.com/cirbtc` claims "real-time onchain verification through Chainlink," but no specific PoR feed address (Ethereum or Arc) was found to correspond to that claim in material retrieved, beyond the unread Arc-mainnet PoR proxy address noted two rows up (`LIQUIDITY-ORACLES.md` "Pair 3"; `THREAT-MODEL.md` §7). | A confirmed Arc mainnet RPC, then an on-chain read of the E-33 PoR proxy address, cross-checked against Circle's stated reserve figures. | **External** |
| Is any oracle other than Chainlink readier for Arc? | Arc's own oracle page names Chronicle, Pyth, RedStone, and Stork alongside Chainlink; of these, **Stork is the only one with a published Arc-specific address page linked directly from Arc's docs** (`docs.stork.network/resources/contract-addresses/evm#arc`), an asymmetry `LIQUIDITY-ORACLES.md` records but does not evaluate further, since that file's (and this file's) scope is Chainlink. | An owner decision to evaluate Stork (or another named provider) as a nearer-term alternative, if EURC/BTC pricing is needed before a Chainlink Arc address exists. Noted here for awareness, not evaluated. | **Owner** (whether to open this workstream) |

## 6. Uniswap v4 PoolManager provenance on Arc — conflicting sources, no independent confirmation

| Claim | Source | Independent check performed | Verdict |
|---|---|---|---|
| PoolManager (v4) at `0x8366a39cc670b4001a1121b8f6a443a643e40951` exists on Arc mainnet, chain `5042` | `Uniswap/sdks`, `sdk-core/src/chains.ts` (`ChainId.ARC = 5042`) and `addresses.ts` (`THREAT-MODEL.md` E-05); a Uniswap-owned playbook doc, `Uniswap/UniswapX`'s `playbook/chains/arc.md`, repeats the same address and dates it 2026-06-12, "24KB code verified live" (`COMPATIBILITY.md` §3.3) | No mainnet RPC exists to `eth_getCode` this address (E-02, E-04) | **UNCONFIRMED** — real enough to plan around, not real enough to hard-code |
| Uniswap's canonical v4 deployments page lists Arc | `developers.uniswap.org/docs/protocols/v4/deployments` fetched directly | Zero case-insensitive matches for "arc" among 19 mainnet and 6 testnet chains listed (`COMPATIBILITY.md` §3.2; `THREAT-MODEL.md` E-06) | **Contradicts the row above** — Uniswap's own user-facing source of truth says none |
| The claimed mainnet address has code on Arc **Testnet** | `LIQUIDITY-ORACLES.md`, direct `eth_getCode` against `0x8366a39cc670b4001a1121b8f6a443a643e40951` on chain `5042002` | Returned `0x` — no code | Confirms nothing about mainnet (different chain id); rules out that address as live on testnet |
| The playbook's own claim self-caveats | Same `playbook/chains/arc.md` file | — | "Explorer verification and SDK/service integration remain pending" (`LIQUIDITY-ORACLES.md`, `COMPATIBILITY.md` §3.3) |
| The Uniswap `sdk-core` build published to npm agrees with the GitHub `main` branch | `raw.githubusercontent.com/Uniswap/sdk-core/main/src/chains.ts` and `addresses.ts` | Fetched directly: **zero** occurrences of "arc" anywhere in either file; the enum tops out at `BLAST = 81457`, missing chains unquestionably live elsewhere | Suggests the published package and its `main` branch source have diverged — a separate discrepancy, not evidence either way about Arc (`COMPATIBILITY.md` §3.3) |
| An independent, non-Uniswap tracker's read | `builtonarc.app/project/uniswap` (self-described independent directory, not affiliated with Circle or Arc), as of 2026-09-02 | — | "Named in Circle's Arc mainnet press release; announcement only, nothing observed on chain"; "No Arc addresses on file" (`LIQUIDITY-ORACLES.md`) |

**Owner decision needed:** whether to (a) wait for `developers.uniswap.org`'s canonical deployments
page to list Arc before writing any config with a live PoolManager address, or (b) proceed only
with a local fork rehearsal against official v4-core PoolManager *bytecode*, never a guessed live
address — the path `COMPATIBILITY.md` §19/§22 already recommends and the only one endorsed today. **What settles the underlying fact:** `developers.uniswap.org/docs/protocols/v4/deployments`
listing Arc directly, plus an `eth_getCode` read against a public RPC (testnet or mainnet)
confirming non-empty code at the listed address. **Who:** Owner (path choice, now) + External
(the fact, whenever Uniswap publishes it).

## 7. Safe, pauser, and keys — owner-gated, not research-gated

| Question | Current state | What settles it | Who |
|---|---|---|---|
| Is a Safe deployable on Arc today? | **Yes, on testnet, confirmed.** `safe-global/safe-deployments`' canonical registry lists both Arc chain ids for Safe v1.4.1 and v1.5.0; on Arc Testnet, the Safe singleton and `SafeProxyFactory` codehashes were independently read on-chain and matched the registry exactly (`COMPATIBILITY.md` §12; `THREAT-MODEL.md` E-42). Mainnet is listed as canonical in the same registry but **not independently verified on-chain** — no mainnet RPC exists yet (§1). | Already settled for testnet. Mainnet settles once a mainnet RPC exists and one `eth_getCode`+codehash check is run. | Closed for testnet; **External** for mainnet |
| Who administers a future Arc deployment, and who holds the pauser role? | **Not yet named — a standing gate, not a technical unknown.** `THREAT-MODEL.md` T26 and `DECISIONS.md` items 64/70/71 (leads) require a Safe the owner controls, with a threshold of at least 2 over hardware-held keys, and a pauser role holder that is a *separate* address from the Safe (item 65, lead) — the pauser may pause but never unpause; only the Safe unpauses. `COMPATIBILITY.md` §12 and §20's deployment-manifest template both leave these fields blank by design. | The owner names: (1) the Safe's signer set and threshold, (2) a distinct pauser address, (3) confirmation the legal review referenced in `DECISIONS.md` items 64/70/71 has actually happened — none of which is a research task. | **Owner** |
| Can a Safe be used as the buyer/payer identity under Circle Nanopayments? | **No.** Nanopayments requires EOA signatures and explicitly does not support ERC-1271 (`THREAT-MODEL.md` E-28) — a Safe cannot sign the way Nanopayments needs. Safe-held funds must move by EIP-3009, Permit2, or a direct transfer instead. | Circle adding ERC-1271 support to Nanopayments — not something UNICA or the owner can accelerate. | **External** (and a design constraint to plan around meanwhile) |
| Who holds the deployer EOA key for any Arc deployment? | Standing decision, carried over from every prior UNICA deployment: a fresh EOA, funded only for gas, never the owner's Safe or a reused key (`COMPATIBILITY.md` §20; `THREAT-MODEL.md` T25). | The owner generates and funds this key when a deployment is actually authorized — not before. | **Owner**, at deploy time |

## 8. Nano/micropayment economic model — Model A, B, or C

| Question | Current state | What settles it | Who |
|---|---|---|---|
| Which settlement model covers payments below the on-chain break-even point? | `NANOPAYMENTS.md` §13 computes the break-even directly: at Arc testnet's measured gas price (22 Gwei) and an ESTIMATE 90,000-gas EIP-3009 settlement, one on-chain payment is economically sensible only above roughly **$0.04** (a 5%-of-payment bar, chosen and labeled as a threshold in that file, not an official one). Below that, Model A (one settlement per payment) loses money on every payment; Model B (batched, signed off-chain authorizations, periodic on-chain settlement — Circle's own Nanopayments mechanism) and Model C (prepaid/escrowed balance) both work economically but carry different risk shapes (§5, §6, §7 of that file). | The owner choosing which model(s) UNICA supports for payments under ~$0.04, and for how small a payment (Circle's own materials claim support "as small as $0.000001," `NANOPAYMENTS.md` §10). | **Owner** |
| If Model C (prepaid/escrow) is chosen, does it trigger money-transmitter or e-money licensing? | **Explicitly out of scope here and unresolved.** `NANOPAYMENTS.md` §6: "Whether UNICA's specific beta usage would trigger such a requirement is UNKNOWN... a compliance question for the project's own counsel, not a technical one this file can settle" — but the fact pattern (a third party pools many users' funds before individual authorization of each use) is exactly what such regimes target. | A legal opinion from the project's own counsel, per jurisdiction of operation, before Model C is used for real value. | **Owner** (commissioning the legal review) |
| What premium does a relayer or paymaster charge on Arc specifically, if gas sponsorship is used? | **Unknown — no official source publishes an Arc-specific rate.** (`NANOPAYMENTS.md` §3, §Open UNKNOWNs) | A specific provider's published Arc pricing, once one exists (`NETWORK.md` §9 lists third-party ERC-4337 providers active on Arc generally, without Arc-specific gas-sponsorship pricing). | **External** |
| What does a real x402 facilitator charge per settled payment on Arc? | **Unknown — the spec is silent by design.** No official Arc-specific facilitator rate exists because no production facilitator serves Arc at all yet (§4 above). One third-party example implementation hardcodes a 1% fee as a configuration default, which is evidence a facilitator *can* charge a percentage, not an official rate (`NANOPAYMENTS.md` §3). | A facilitator actually serving Arc publishing its fee schedule — gated on the x402-on-Arc unknown in §4. | **External** |

## 9. EURC/USDC conversion — no callable route today

| Question | Current state | What settles it | Who |
|---|---|---|---|
| Does Circle's Gateway support EURC cross-chain movement the same way it supports USDC? | **No — confirmed, not merely unreported.** A direct on-chain read of GatewayWallet on Arc Testnet (`0x0077777d7EBA4688BDeF3E311b846F25870A19B9`) shows `isTokenSupported(USDC)` returns true and `isTokenSupported(EURC)` returns **false** (`THREAT-MODEL.md` E-30). This resolves what `TOKENS.md` §7 and `NANOPAYMENTS.md` §9 had earlier left open ("UNKNOWN... worth a direct question to Circle/Arc support") — the answer is now a negative, read directly from the contract Gateway itself runs on Arc. | Already settled by an on-chain read. Would only change if Circle later adds EURC support and the same call is re-run. | Closed (**External** source, already read) |
| Is there any UNICA-callable path to convert EURC to USDC on Arc? | **No public integration surface confirmed.** Circle's own StableFX (RFQ/PvP desk) explicitly supports USDC↔EURC on Arc and is, per Circle's own materials, the economically sound path in principle — but it is gated to onboarded institutional makers/takers, with no public API or contract UNICA could call found anywhere (`LIQUIDITY-ORACLES.md` "Pair 2"; `PRODUCT-FLOWS.md` §4). An AMM+oracle alternative is separately blocked (no confirmed Arc Chainlink feed, §5; no confirmed live PoolManager, §6). | Circle publishing a callable StableFX API or contract for non-institutional integrators, or the AMM+oracle path's two blockers (§5, §6) closing together with adequate seeded depth. | **External** |

## 10. Contract and config work gated on the sections above

These are code tasks, not research gaps — named here only because each is blocked on a decision or
an external fact from a section above, and building any of them before that gate closes would mean
compiling against a guess.

| Task | Gated on | Named in |
|---|---|---|
| Add `5042002` (and, once confirmed, `5042`) branches to `UniswapDeployments.sol` and to `hookmate`'s pinned `AddressConstants.sol` | §1 (network target) and §6 (a confirmed PoolManager address) | `COMPATIBILITY.md` §17 items 1–2 |
| Rewrite `V4SettlementHook`'s native-asset settlement-shape check (`currency0 == address(0)`) for a chain with no native ETH | §1 (whether Arc is targeted at all) | `COMPATIBILITY.md` §6.1, §17 item 3 |
| Write `config/chains/5042.json` (Arc mainnet) | §1 (mainnet publication) and §6 (a confirmed PoolManager address) — deliberately **not** written yet, to avoid "a committed file with real-looking addresses" | `COMPATIBILITY.md` §18, §23 |
| Re-run hook-address mining for chain `5042002` | §1 and the two rows above (mining depends on `initCodeHash`, which depends on the chain-keyed constants above resolving first) | `COMPATIBILITY.md` §2, §17 item 4 |
| Add a Blockscout-flavoured branch to `script/verify.sh`/`script/verify-v3.sh` | Nothing external — Arc's explorer (`testnet.arcscan.app`) is already known; this is ready to build independent of every other row here | `COMPATIBILITY.md` §17 item 5, §13 |

## 11. Smaller confirmed-vs-open items, not covered above

| Item | State | What settles it |
|---|---|---|
| Unit of `GatewayWallet.withdrawalDelay()` = `1209600` | Read on-chain but its unit (seconds vs. blocks) was not established by any doc page fetched (`THREAT-MODEL.md` E-30, §7) | Circle's Gateway contract documentation, or its verified source on the explorer |
| Does a blocklist revert leave a transaction receipt? | Arc's own pages disagree: `evm-differences.md` implies the transaction is included and consumes gas; `docs.arc.io/llms.txt` says a blocklist revert consumes gas "without a receipt" (`THREAT-MODEL.md` E-38 vs. E-39, T06, T20) | A PROPOSED `arc-anvil` run against the docs' own seeded blocklisted test address, `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| Does PUSH0 (EIP-3855) or transient storage (EIP-1153) actually work on Arc? | **Inferred, not confirmed.** Arc's "Osaka baseline" framing implies both, and neither is listed as a documented difference, but no direct opcode probe was run (`NETWORK.md` §10; `COMPATIBILITY.md` §1 treats `TLOAD`/`TSTORE` as present on this same inference) | Deploying and calling a minimal `TSTORE`/`PUSH0` contract against `rpc.testnet.arc.io` — a five-minute check, not yet performed because it was out of scope for this read-only research |
| USDC's ERC-20 proxy admin address on testnet | `NETWORK.md` §4 originally left this unread ("the admin slot itself was not read"). `TOKENS.md` §2 and `THREAT-MODEL.md` E-12, written the same day, **did** read it: `admin()` returns `0x49f78af090F1f98e7184B7f61f1F1a8a8064b40d`, matching the raw storage slot exactly. This file follows the later, corroborated reads; `NETWORK.md`'s note is superseded, not contradicted — it simply predates the fuller read | Already settled — no action needed |
| Does contract-size ceiling EIP-7907 (Osaka) apply on Arc? | Unknown; not stated in the `docs.arc.io/llms.txt` excerpt fetched. Moot today since UNICA's contracts sit well under the legacy 24576-byte limit (`COMPATIBILITY.md` §1) | Re-check only if a future Arc-specific contract approaches the legacy ceiling |
| Does The Graph index Arc Testnet, or only Arc Mainnet? | `thegraph.com/docs/en/supported-networks/arc/` lists only "Arc Mainnet" (`eip155:5042`); no testnet-specific listing or "coming soon" caveat found (`COMPATIBILITY.md` §15) | A direct Subgraph Studio deploy attempt against chain `5042002` — a write action to a third-party service, out of scope for read-only research, and not performed |
| Does UniswapX's Arc playbook's SDK/App-Kit call graph actually route through the CCTP V2 contracts `TOKENS.md` §6 found on-chain? | Circle's own product description says so; not independently traced through App Kit's SDK source (`TOKENS.md` §9 item 4) | Reading App Kit's SDK source directly, or a traced test transaction once App Kit is exercised |

## 12. Owner decisions — the consolidated list

Every row below needs the owner's input specifically; none is closed by more research.

1. **Target network for the beta** — testnet-only, or mainnet once public (§1).
2. **cirBTC self-check** — compare any wallet-held cirBTC-labeled token against `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` before trusting it (§2).
3. **Whether a BTC-denominated leg is in scope at all** — the standing rule is "no unsupported BTC token" (§2).
4. **Public addresses authorized for balance readback** — none today; name any, and the read methods permitted, before a future tool checks one (§3).
5. **Whether to build a quote-digest-binding x402 extension** before any x402-fronted UNICA order goes live (§4).
6. **Whether to prioritize a public, unbound x402/payment-link order mode**, and commission the Advisory-001-rooted security review it requires (§4).
7. **Whether to evaluate Stork (or another non-Chainlink provider) as a nearer-term Arc oracle**, given the Chainlink-vs-Stork asymmetry (§5).
8. **Wait for Uniswap's canonical page, or proceed only via fork rehearsal against official bytecode** for the PoolManager question (§6).
9. **Name the Safe signer set/threshold and a separate pauser address**, and confirm the legal review referenced in `DECISIONS.md` items 64/70/71 has happened (§7).
10. **Choose a nano/micropayment model** (A/B/C) for payments under the ~$0.04 break-even, and if Model C, commission the money-transmitter/e-money legal review (§8).

## 13. External unknowns — nothing to do but re-check a named source later

Every item below is blocked on Circle, Uniswap, Chainlink, Safe, or the x402 ecosystem publishing
something that does not exist yet. No UNICA or owner action accelerates any of them; each names the
exact re-check that would close it.

| Unknown | Re-check when ready |
|---|---|
| Arc mainnet RPC, explorer, and contract addresses | `docs.arc.io/arc/references/contract-addresses.md` and `rpc-endpoints.md`, post-2026-09-16 |
| Whether Arc private mainnet is already running | Either `docs.arc.io`'s deployment-model page or Circle's pressroom updating to match the other |
| Arc mainnet chain id independently confirmed on-chain | One `eth_chainId` read once a mainnet RPC publishes |
| cirBTC's Arc mainnet address | `developers.circle.com/assets/cirbtc-contract-addresses.md`, once Arc mainnet exists |
| cirBTC's live-vs-coming-soon status on Arc | `circle.com/cirbtc` and `developers.circle.com/assets/what-is-cirbtc.md` agreeing |
| x402 protocol/CDP Facilitator adding Arc | `docs.x402.org/core-concepts/network-and-token-support`, `docs.cdp.coinbase.com/x402/network-support` |
| `x402ExactPermit2Proxy` deployed to Arc | `eth_getCode` at `0x402085c248EeA27D92E8b30b2C58ed07f9E20001` on whichever Arc chain is targeted |
| Chainlink Data Feeds/Streams/CRE on Arc Testnet | `docs.chain.link/data-feeds/price-feeds/addresses`, searched for an Arc Testnet entry |
| Chainlink Data Feeds on Arc Mainnet readable on-chain | The three E-33 proxy addresses, once a mainnet RPC exists |
| Uniswap v4 PoolManager on Arc, any chain, canonically confirmed | `developers.uniswap.org/docs/protocols/v4/deployments` listing Arc |
| Safe on Arc mainnet, independently on-chain confirmed | `eth_getCode` + codehash match against `safe-global/safe-deployments`, once a mainnet RPC exists |
| Circle Gateway adding EURC support | `isTokenSupported(EURC)` on GatewayWallet, re-read periodically |
| Circle StableFX exposing a public, non-institutional integration surface | `circle.com/stablefx` and its developer documentation |
| The Graph indexing Arc Testnet | A Subgraph Studio deploy attempt against chain `5042002` (a write action, not performed here) |

## Sources

Every fact above is carried by citation from this directory's own sibling files, each already
retrieved and, where applicable, on-chain-verified on 2026-09-11: `NETWORK.md`, `TOKENS.md`,
`COMPATIBILITY.md`, `NANOPAYMENTS.md`, `X402.md`, `LIQUIDITY-ORACLES.md`, `THREAT-MODEL.md`,
`PRODUCT-FLOWS.md`. No new web fetch or on-chain read was performed to write this file, and no
wallet balance was read, requested, or referenced beyond noting that none has ever been read for
this workstream.
