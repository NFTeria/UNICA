# Ledger

> Requirement quotes on this page were read from the published prize page on 2026-09-05; that day's saved copy is kept privately with its hash. Where an older fetch is carried forward, the file says so.


**Touches UNICA today:** nothing in the tree. No Ledger Agent Stack or Key Ring CLI integration
was attempted.

**Published requirement** (AI Agents x Ledger, ethglobal.com/events/ethonline2026/prizes,
retrieved 2026-09-05): "Both must be built on the Ledger Agent Stack, and in particular on the
Ledger Key Ring CLI (wallet-cli ring)." Re-fetched from the prize page on 2026-09-05; this file
previously carried a paraphrase inside quotation marks.

**What would have to be built:** an agent driving the Key Ring CLI as its signer — an entire
integration surface absent from this project. Not attempted.

**What we'd ask Ledger to change, with evidence:** this does not satisfy either Ledger track,
and is recorded as engineering value rather than sponsor credit. The community clear-signing
registry (`ethereum/clear-signing-erc7730-registry`, `registry/uniswap/`, fetched 2026-09-04)
covers Uniswap V3 Router02, Permit2, and UniswapX EIP-712 payloads, and nothing for v4: no
PoolManager, no Universal Router v4 path, no hook descriptor. A user signing a v4 swap or a
hook call on a hardware wallet sees raw calldata. We'd ask for a v4 descriptor to be accepted,
with the caution that v4's generic `unlock(bytes)` plus callback shape may not map cleanly onto
the registry's per-function field model.

Status: no claim of qualification.
