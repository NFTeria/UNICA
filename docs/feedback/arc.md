# Arc

> Requirement quotes on this page were read from the published prize page on 2026-09-05; that day's saved copy is kept privately with its hash. Where an older fetch is carried forward, the file says so.


**Touches UNICA today:** nothing in the tree. A seam was considered and set aside: moving
already-settled USDC off a Sepolia swap over the CCTP leg. It is a demonstration of a transfer,
not an integration — it routes nothing through a v4 pool on Arc, and Arc mainnet is not live
(the published testnet, chain id 5042002, is Live; mainnet is listed Upcoming).

**Published requirement** (Best DeFi/Onchain Finance Application,
ethglobal.com/events/ethonline2026/prizes, retrieved 2026-09-05): "Build stablecoin-native DeFi
on Arc." The published sentence after it, separate from that one, is "Build lending, borrowing,
swaps, liquidity, FX, yield, payments, treasury or fintech infrastructure using Arc and USDC."
Re-fetched 2026-09-05; this file previously ran the two together inside one pair of quotation
marks.

**What would have to be built:** an actual Arc-deployed contract with a working frontend and
backend and an architecture diagram, per the track's own bar. Nothing toward this exists.
Robinhood testnet is under compatibility investigation, and that finding is unrelated to Arc —
noted here only so the two are not confused.

**What we'd ask Arc to change, with evidence (fetched 2026-09-04, not re-verified since):** the
published contract-addresses page lists stablecoins, CCTP contracts, and common Ethereum
contracts, with no AMM of any kind, while App Kit advertises a Swap capability without naming
what it routes through — we'd ask for either an address or a plain statement that none is
deployed yet. Separately, the page's 6-versus-18-decimal USDC warning has no accompanying
conversion example; we'd ask for one worked helper that reads `decimals()` rather than assuming
either constant.

Status: no claim of qualification, and no claim of Arc readiness.
