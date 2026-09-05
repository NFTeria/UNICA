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
