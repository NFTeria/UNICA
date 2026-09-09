# ENS

> Requirement quotes on this page were read from the published prize page on 2026-09-05; that day's saved copy is kept privately with its hash. Where an older fetch is carried forward, the file says so.


**Touches UNICA today:** yes, and centrally. `integrations/ensv2/` resolves a merchant name on
live ENSv2 Sepolia, classifies thirteen failure shapes, commits the reading into the signed quote
so the address a payer was shown is part of what was agreed — and, as of 2026-09-08, reads the
**Permissioned Resolver and its Enhanced Access Control**: who may edit a name, discovered from the
chain, with an authorised edit and an unauthorised one both simulated by `eth_call`. 278 offline
rows, 78 live. Nothing on the path is hard-coded; the name is a command-line argument.

**Published requirement** (Best Use of ENSv2, ethglobal.com/events/ethonline2026/prizes,
retrieved 2026-09-05): "Project must be built on ENSv2 (Sepolia). ENSv2 features should be central to the product,
not a cosmetic add-on. Your demo must be functional and not just include hard-coded values."
(This file previously quoted only the middle sentence, which dropped both the chain constraint
and the no-hard-coded-values clause.)

**What was built:** exactly that, plus the authorization half. See `integrations/ensv2/README.md`
and `ENS-OWNER-ACTION.md`. What remains is a wallet signature on a name the owner controls, which
is step 1 of that file.

**What we'd ask ENS to change, with evidence (observed 2026-09-08 against the Sepolia beta).**
Three documentation gaps, all found by probing the deployed Permissioned Resolver implementation at
`0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e` rather than by reading about it. Each is a place where
a careful integrator would write code that is wrong and be told nothing.

1. **`getAssigneeCount(uint256,uint256)` returns more than it is documented to return.** The docs
   describe one `uint256`. The deployed contract returned **two words** — `0x02` and `0x0f` for
   ROOT_RESOURCE with ROLE_SET_ADDR. We print the second and deliberately do not interpret it,
   because guessing at an undocumented return value is how a wrong number reaches a user. We would
   ask for the second word to be named.

2. **The resource derivation the docs imply is not the one the deployment uses.** Reading the
   access-control documentation leads an integrator to expect a finer resource for a per-text-key
   or per-coin-type permission. Every refusal we actually observed — including `setText` and
   `setAddr(bytes32,uint256,bytes)`, where the finer resource is exactly what you would expect —
   named the **name-level** resource, `keccak256(node || bytes32(0))`. Only that one derivation is
   confirmed by the chain. We would ask the docs to state which resource each profile method
   checks against, in this deployment.

3. **`roleCount` returns a packed word with no documented layout.** At ROOT_RESOURCE it came back
   `0x2222…22`. A four-bits-per-role reading fits the role spacing, but that is inference; we read
   only the low nibble and say so in the code. We would ask for the packing to be written down.

Separately, and not an ENS defect: `eth_getLogs` over the public load-balanced Sepolia endpoint is
**not deterministic** across identical calls — three consecutive runs over one block range returned
1 matching `EACRolesChanged` log, then 0, then 1. Our live check mitigates it by only ever ADDING
names and by printing the contract's own `roleCount` beside the number it could name, whether or
not the two agree. Worth knowing for anyone building role discovery from logs.

ENSv2's own docs carry "The contracts and interfaces described here are not yet final and may
change prior to mainnet deployment." Everything above is pinned to the Sepolia beta as of
2026-09-08 and is offered in that spirit.

Status: `LIVE READ`. The integration is complete: it resolves live ENSv2 Sepolia names, reads the
Permissioned Resolver's authorization from the chain, and simulates an authorized and an
unauthorized edit. UNICA owns no ENS name and does not need one — it resolves the name a merchant
owns. No claim of qualification is made here; the track decision is the owner's.
