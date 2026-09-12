# UNICA v4 — enforcement-layer matrix

Machine-readable twin: [`enforcement-matrix.json`](enforcement-matrix.json). Every material rule of the local
vertical slice, classified by **where it is actually enforced**. A backend or operator rule is never described
as an on-chain invariant; where a rule spans layers, each layer's share is named.

| Layer | Means |
|---|---|
| `UNICA_ONCHAIN` | the UNICA v4 registry, factory, hook or executor, on every call |
| `UNISWAP_V4_ONCHAIN` | Uniswap v4's PoolManager or the hook callback path |
| `ENSV2_ONCHAIN` | ENSv2 registry / permissioned-resolver access control (locally: the EAC-compatible fixture) |
| `CHAINLINK_ORACLE` | the pinned price adapter reading its feed (locally: the real adapter over fixture feeds) |
| `CRE_REPORT_VERIFICATION` | the policy receiver on a delivered report (locally: a fixture report — **NOT A DON REPORT**) |
| `BACKEND_POLICY` | an off-chain or wrapper component before an order exists; never a settlement invariant |
| `GRAPH_EVIDENCE` | the evidence projection or subgraph; authenticates, never authorizes |
| `CLIENT_VERIFICATION` | a display or approval rule of the POS / wallet |
| `OPERATOR_RULE` | a deployment-script, manifest or runbook refusal |
| `LOCAL_FIXTURE_ONLY` | true of the local Anvil fixture only |

| Rule | Layer(s) | On-chain invariant? | Mechanism |
|---|---|---|---|
| Merchant identity (name → payout) | ENSV2_ONCHAIN + BACKEND_POLICY | no | `addr` record under the merchant's control, resolved once at admission, frozen into the order |
| Merchant payout binding | UNICA_ONCHAIN | **yes** | `Order.recipient` written once; `take()` pays it only; `ReservedRecipient` |
| Payer binding | UNICA_ONCHAIN | **yes** | `msg.sender == order.payer` else `WrongPayer` |
| Terminal creation | ENSV2_ONCHAIN | yes (of the name registry) | `SET_SUBREGISTRY` at the parent; operators hold only `SET_TEXT` at one per-key resource |
| Terminal revocation | ENSV2_ONCHAIN | yes (of the name registry) | `authorizeTextRoles(..., false)`; status text `revoked` |
| New-order admission | BACKEND_POLICY + ENSV2_ONCHAIN | no | `TerminalAdmission` checks the per-key role and status text, then calls `createOrder` as the allowlisted creator |
| Existing order after revocation | UNICA_ONCHAIN | **yes** | orders reference no ENS state; revocation changes nothing in executor storage |
| Market registration | UNICA_ONCHAIN | **yes** | `marketId` recomputed over `(chainid, registry, asset, payout, version, adapter, feedId)`; pinned hook code; bits `0x20C0`; write-once reverse maps |
| Market pause | UNICA_ONCHAIN | **yes** | `pause` by ADMIN or PAUSER; `createOrder`/`pay` require ACTIVE |
| Market retirement | UNICA_ONCHAIN | **yes** | `retire` by ADMIN; terminal; relist = new version |
| Feed binding | UNICA_ONCHAIN + CHAINLINK_ORACLE | **yes** | `feedIdFor(asset, payout) == policy.feedId` at `register` and every `afterSwap` |
| Price freshness | UNICA_ONCHAIN + CHAINLINK_ORACLE | **yes** | source `updatedAt`; `> now`, `== now`, age `> maxAge` (≤ 300 s) refused |
| Slippage | UNICA_ONCHAIN | **yes** | `OutputBelowMinimum`, `RecipientShort`, `DeliveryNotExact`, oracle band |
| Transaction cap | UNICA_ONCHAIN | **yes** | `OrderAboveCap` at creation, `PaymentAboveCap` on measured delivery |
| Daily cap | UNICA_ONCHAIN + OPERATOR_RULE | yes, per market version | `DailyCapExceeded` over `timestamp / 86400`; same-day retire-and-relist restarts the counter (V4), so tooling refuses deliberate evasion |
| Aggregate seed cap ($100) | OPERATOR_RULE | **no** | deployment enumerates every market's `maxSeedPayout` and refuses above the cap (V3, S5) |
| Liquidity reseeding restriction | OPERATOR_RULE | **no** | no tool adds liquidity at or after SEEDED (V2) |
| Settlement completion | UNICA_ONCHAIN + UNISWAP_V4_ONCHAIN | **yes** | one transaction, every check, `Settled` last, or nothing |
| Receipt verification | GRAPH_EVIDENCE + CLIENT_VERIFICATION | no | registry → market → hook emitter → executor emitter → pool → paired events → finality; UNKNOWN fails closed |
| NFT provenance | CLIENT_VERIFICATION + ENSV2_ONCHAIN | no | manifest's identity contract only; mint needs namespace control and `namehash(name) == node` |
| Confidential-policy approval | CRE_REPORT_VERIFICATION + BACKEND_POLICY | no | receiver records an exact admission; wrapper requires literal equality; forwarder success is not delivery |
| PAID display state | CLIENT_VERIFICATION | no | only on a VERIFIED evidence decision for the expected order id |
| Test-only / no-value designation | LOCAL_FIXTURE_ONLY + CLIENT_VERIFICATION | no | `LOCAL_ANVIL_NO_VALUE`; FIXTURE feeds; the SVG's testnet mark; the client's persistent label |

**Two lines that must never blur.** ENSv2 never redirects an existing payment, never proves payment and never
implicitly invalidates an existing order. Chainlink never selects contracts, payout addresses or typed prices,
and a successful forwarder write is not delivery until the receiver's own record exists.
