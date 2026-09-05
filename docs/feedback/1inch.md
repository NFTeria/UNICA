# 1inch

> Requirement quotes on this page were read from the published prize page on 2026-09-05; that day's saved copy is kept privately with its hash. Where an older fetch is carried forward, the file says so.


**Touches UNICA today:** nothing in the tree. One idea was considered and set aside: a
mainnet-fork read of an Aqua pool. It scores nothing against the track's own bar of onchain
token-transfer execution in the demo, and licensing rules out most shapes that would count for
an MIT-licensed repository, so it was not pursued.

**Published requirement** (Build an Aqua App, ethglobal.com/events/ethonline2026/prizes,
retrieved 2026-09-05): "Official Aqua/SwapVM contracts must be used. Onchain execution of token
transfers should be presented."

**What would have to be built:** a full Aqua/SwapVM deployment with an onchain token transfer
executed and shown in the demo. Not attempted. The official template's repository reports
`license=NOASSERTION` at the GitHub level despite carrying LICENSE, LICENSES, and
THIRD_PARTY_NOTICES files (fetched 2026-09-04, not re-verified since) — under this project's
own rule against copying code of unclear or incompatible licence into an MIT repository, that
alone would block vendoring anything from it.

**What we'd ask 1inch to change, with evidence:** the template's only documented testnet path
(`yarn deploy sepolia`) redeploys the entire Aqua protocol and strategy from scratch, while the
track's own qualification line parenthetically allows "redeployments of a modified SwapVM
contract" — a narrower thing. We'd ask for one clarifying sentence on whether a from-scratch
redeploy via the official template satisfies the requirement, or for a canonical testnet
deployment so builders need not redeploy the protocol to demo onchain.

Status: no claim of qualification.
