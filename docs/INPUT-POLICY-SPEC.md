# INPUT POLICY — the specification for an ERC-20 payer input

Specification. Not implemented. The live release accepts native input and pays USDC on Ethereum Sepolia.

Written 2026-09-05 against `main` at commit `72cabd2`; the live release is tag `live-green`
(commit `5e1d843`). Every claim about current behaviour cites a file and line at that commit.
Where this document proposes something, the word "proposed" is beside it. Nothing here is a
promise about a token, a chain, or a sponsor; it is what a reviewer would need to implement a
token-denominated payer leg without weakening what the live release proves.

The live release, stated once: UNICA demonstrates a live, verified USDC settlement flow on Uniswap v4 Sepolia, with order-bound full-fill enforcement and an indexable receipt.
The control transaction for everything below is the live settlement
`0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83`: status 1, block
11640026, `SettlementReceipt` at log index 107 from the hook, order
hash `0x72b25a9b4e6f89138766bb0251a1fc41f8da15efb0d87f058390da1737aab8e9`, `currencyIn`
`address(0)`, `currencyOut` USDC, `amountIn` 1000000000000000, `amountOut` 2003660 (read with
`cast receipt … --json` on 2026-09-05T17:03:08Z and decoded by the receipt's topic), and no
Permit2 call in the transaction (`docs/EXECUTION-PATH.md:100`: "Permit2 spender | none: the
input is native ETH sent with the call").

This is the generic ERC-20 payer-input policy. UNI on Ethereum Sepolia is the first concrete
example (section 5) and only an example. The payout side is a separate specification,
`docs/PAYOUT-POLICY-SPEC.md` (section 6 says how the two fit).

Reads used in this document, all read-only, all against the public RPC
`https://ethereum-sepolia-rpc.publicnode.com`, chain id 11155111 (`cast chain-id`), at the
times shown. The commands are reproduced so every number can be recomputed:

```sh
RPC=https://ethereum-sepolia-rpc.publicnode.com
UNI=0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984
USDC=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
EXEC=0x044bc8a8773EC7b9B8de2467766636dFFCaC6210
DEP=0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73
UR=0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b
P2=0x000000000022D473030F116dDEE9F6B43aC78BA3
# 2026-09-05T16:45:33Z
cast code $UNI --rpc-url $RPC | wc -c | awk '{print ($1-3)/2}'      # 12567
cast call $UNI 'symbol()(string)'   --rpc-url $RPC                   # "UNI"
cast call $UNI 'decimals()(uint8)'  --rpc-url $RPC                   # 18
cast call $UNI 'name()(string)'     --rpc-url $RPC                   # "Uniswap"
cast call $UNI 'balanceOf(address)(uint256)' $DEP --rpc-url $RPC     # 0
cast call $USDC 'decimals()(uint8)' --rpc-url $RPC                   # 6
python3 -c "print(int('$USDC',16) < int('$UNI',16))"                 # True
cast code $P2 --rpc-url $RPC | wc -c | awk '{print ($1-3)/2}'       # 9152
# 2026-09-05T16:49:30Z
cast call $UR 'poolManager()(address)' --rpc-url $RPC                # 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543
cast call $UR 'msgSender()(address)'   --rpc-url $RPC                # 0x0000000000000000000000000000000000000000 (no call in flight)
cast call $UNI 'PERMIT_TYPEHASH()(bytes32)' --rpc-url $RPC           # 0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9
cast call $UNI 'minter()(address)'  --rpc-url $RPC                   # 0x41653c7d61609D856f29355E404F310Ec4142Cfb
cast code $UNI --rpc-url $RPC | cast keccak                          # 0xdeba17f16fdba566b45d8019575e068625403cc6986fa17ceadd6edf08aa0868
cast call $UNI  'balanceOf(address)(uint256)' $EXEC --rpc-url $RPC   # 0
cast call $USDC 'balanceOf(address)(uint256)' $EXEC --rpc-url $RPC   # 0
cast balance $EXEC --rpc-url $RPC                                    # 0
cast code 0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0 --rpc-url $RPC | wc -c | awk '{print ($1-3)/2}'  # 10634 (hook)
cast code $EXEC --rpc-url $RPC | wc -c | awk '{print ($1-3)/2}'                                       # 11289 (executor)
```

Three probes of the router (`PERMIT2()`, `permit2()`, `WETH9()`) reverted at 16:49:30Z: the
deployed router exposes no getter for its Permit2 immutable. The Universal Router's own source
is not vendored in this tree; where its behaviour matters it is cited through the v4-periphery
code it inherits (which is vendored) and through `docs/EXECUTION-PATH.md`, whose rows were
read from the router repository on 2026-09-04. The Permit2 source is vendored at
`lib/uniswap-hooks/lib/v4-periphery/lib/permit2/src/` and is cited by file and line.

---

## 1. Why and what changes

### 1.1 The rule as it exists

The input leg is native ETH, in five places, each of which this policy touches:

- **Registration.** `src/SettlementExecutor.sol:155` — `if (!key.currency0.isAddressZero())
  revert NativeInputOnly();` (error declared at line 110). The NatSpec at lines 127-128 says
  "Native ETH is the only input currency today (the live pool's shape)". The payout side is
  checked one line earlier, at 150-151, on `key.currency1`.
- **The pool shape.** `src/V4SettlementHook.sol:156-158` — `_beforeInitialize` refuses any pool
  whose `currency0` is not `address(0)` or whose `currency1` is not `PAYOUT_CURRENCY`, with
  `NotTheSettlementShape(currency0, currency1)` (declared at line 82). No pool carrying this
  hook with a token on the input side can exist.
- **The payment.** `src/SettlementExecutor.sol:181` — `pay(bytes32)` is `payable`; line 186
  refuses `msg.value != order.amountIn` with `WrongValue`; line 196 forwards exactly that value
  to the router: `execute{value: order.amountIn}`. There is no token transfer anywhere in the
  executor, and `IERC20Minimal` is imported (line 7) for `balanceOf` only (lines 193, 203).
- **The plan.** `src/SettlementExecutor.sol:226` — `zeroForOne: true`, a constant; line 233
  settles `order.key.currency0` from the router's own balance (`payerIsUser = false`); line 235
  takes `order.key.currency1` to the recipient. Input is currency0 and payout is currency1 by
  construction.
- **The hook's swap checks.** `src/V4SettlementHook.sol:180` — `if (!params.zeroForOne || …)
  revert ParamsDoNotMatchOrder`; lines 187-189 document the sign convention the hook assumes:
  "`delta` is the swapper's: negative input in currency0, positive output in currency1"; line
  197 reads the consumed input from `delta.amount0()`, line 199 the output from
  `delta.amount1()`; the receipt at lines 243-244 names `key.currency0` as `currencyIn` and
  `key.currency1` as `currencyOut`.

And one design property that this policy must weaken and then re-prove:

- **The executor never holds a balance.** `src/SettlementExecutor.sol:35-37`: "The contract
  never holds a balance: native value arrives only through `pay` and leaves in the same call
  through the router", and lines 36-37 add that there is no `receive`, so a stray transfer
  reverts. `test/SettlementExecutor.t.sol:357-361` proves the missing `receive`;
  `test/I7NativeSettle.t.sol:143` (`test_I7_NothingHeldBeforeOrAfter`) and every positive test
  assert zero native and zero payout token on the executor and the router after a settlement
  (`test/SettlementExecutor.t.sol:60-64`). `SECURITY.md:78-80` states it as "No custody, ever
  … the executor holds a balance only within a single call". The specification's scope line is
  stricter still: "No custody. The hook never holds tokens." (`specs/HOOK-SPEC.md:202`); that
  sentence is about the hook and stays true under this policy.

`README.md:114` records the intent this document specifies: Permit2 on Sepolia,
`0x000000000022D473030F116dDEE9F6B43aC78BA3`, "not yet; the ERC-20 payer path".
`README.md:288` says an order's "input is native ETH by construction"; under this policy that
sentence becomes false and must be rewritten in the same commit that lands the code.

### 1.2 Both orderings and both directions

v4 orders a pool key: `currency0 < currency1`, or initialisation reverts
`CurrenciesOutOfOrderOrEqual` before any hook is consulted
(`lib/uniswap-hooks/lib/v4-core/src/PoolManager.sol:121-125`). Native ETH is `address(0)`,
below every token, so the live pool is the one ordering there is: input as currency0, payout as
currency1. A token input has no such privilege. Its side is decided by address arithmetic
against the payout token, and both cases occur:

| Case | Key | Direction the payer swaps | Consumed input in the delta | Output in the delta | `currencyIn` / `currencyOut` in the receipt |
|---|---|---|---|---|---|
| Input address below payout address (native today; any token whose address is below USDC's) | `{input, payout}` | `zeroForOne = true` (the live case, `src/SettlementExecutor.sol:226`) | `-delta.amount0()` (`src/V4SettlementHook.sol:197`) | `delta.amount1()` (`:199`) | `currency0` / `currency1` (`:243-244`) |
| Input address above payout address (UNI: `0x1f98…` > USDC `0x1c7D…`, computed above) | `{payout, input}` | `zeroForOne = false` | `-delta.amount1()` | `delta.amount0()` | `currency1` / `currency0` |

The router's own arithmetic already follows the direction:
`lib/uniswap-hooks/lib/v4-periphery/src/V4Router.sol:170` returns `delta.amount1()` for a
zero-for-one exact input and `delta.amount0()` otherwise, and lines 82-91 settle the input on
`params.zeroForOne ? currency0 : currency1`. The hook and the executor do not: every site in
section 1.1 hard-codes the first row. Under this policy each of them derives the direction from
the key, once, through one pure function, and the second row becomes reachable. Nothing about
the payout side changes: the recipient is still paid in the payout currency, whichever side of
the key it sits on.

### 1.3 Custody: what `payerIsUser` means when the executor is the caller

The router settles an ERC-20 debt by pulling tokens from a payer it chooses from one boolean.
`V4Router.sol:65-68`: `SETTLE` decodes `(currency, amount, payerIsUser)` and calls
`_settle(currency, _mapPayer(payerIsUser), _mapSettleAmount(amount, currency))`.
`lib/uniswap-hooks/lib/v4-periphery/src/base/BaseActionsRouter.sol:72-74`:
`_mapPayer` returns `payerIsUser ? msgSender() : address(this)`, and `msgSender()` (line 58)
is "the address that calls the initial entry point" (lines 55-57). For a native currency the
payer is irrelevant, the router pays from its own balance
(`lib/uniswap-hooks/lib/v4-periphery/src/base/DeltaResolver.sol:42-43`); for a token it calls
`_pay(currency, payer, amount)` (line 45), an abstract function (line 55) whose reference
implementation in the same repository is
`permit2.transferFrom(payer, address(poolManager), uint160(amount), Currency.unwrap(currency))`
(`lib/uniswap-hooks/lib/v4-periphery/src/PositionManager.sol:515-521`). The Universal Router's
implementation is the same shape: `docs/EXECUTION-PATH.md:37` names it `payOrPermit2Transfer`
and records that "the payer's Permit2 approval names the Universal Router".

On this path the router's caller is the executor, and only the executor:
`src/V4SettlementHook.sol:173-175` refuses any swap whose router-reported `msgSender()` is not
`SETTLEMENT_EXECUTOR`, and `docs/EXECUTION-PATH.md:30` (row 3) records that the hook observes
the router as `sender` and the executor as `msgSender()`. Therefore, on this path:

**`payerIsUser = true` means "pull the input from the executor through Permit2".** It cannot
mean the human payer. A payer who approves the Universal Router on Permit2, the ordinary
Universal Router flow, has authorised nothing usable here: the router would ask Permit2 for the
executor's tokens, not the payer's. A payer who instead calls the router directly is refused by
the hook as a stranger (`test/V4SettlementHook.t.sol:125-140`). The router's own Permit2
commands (they exist: `FEEDBACK.md:83-84` names them) are no help either if, as
`docs/EXECUTION-PATH.md:37` records for the router's payment path, they act for the router's
caller: that caller is again the executor. The router's source is not in this tree, so that
last point is stated from the day-4 reading and must be re-read against the router repository
before anything is built on it.

Three designs follow from this, and the policy chooses the first:

1. **Executor transient custody (chosen).** The payer authorises the *executor*, per order, by
   signature. The executor pulls exactly `amountIn` of the input token into itself, grants the
   router a Permit2 allowance of exactly `amountIn` that dies with the block, and composes
   `SETTLE(input, OPEN_DELTA, payerIsUser = true)`. The router pulls the whole debt from the
   executor straight into the PoolManager; the router never holds the token. The executor holds
   the token between its own two external calls, inside one `pay`, and ends with what it began.
   Section 2 specifies every step and every check.
2. **Tokens parked on the router, `payerIsUser = false` (rejected).** The executor would move
   the payer's tokens to the router and settle from the router's balance. The router's balance
   is sweepable by whoever calls it next (`src/SettlementExecutor.sol:91-95`, the reason
   `ReservedRecipient` exists; the v4 action is `Actions.SWEEP`,
   `lib/uniswap-hooks/lib/v4-periphery/src/libraries/Actions.sol:40`), and an input token that
   calls out during its transfer would hand control to a stranger while the router holds the
   tokens. Refused for the same reason output may never be taken to the router.
3. **The payer calls the router (rejected).** Structurally excluded by invariant I1: the
   settlement checks live in the executor and the hook admits only the executor
   (`docs/INVARIANTS.md`, row I1). Re-admitting the payer would remove the order binding this
   repository exists to provide (`docs/EXECUTION-PATH.md:122-127`).

The consequence for the property in section 1.1: "never holds a balance" becomes "holds the
input token only between the Permit2 pull and the router's pull, inside one call, and holds
nothing it did not hold before". `SECURITY.md:78-80` already says "holds a balance only within
a single call"; under this policy that sentence is literal for the token path, and section 2
items P8 to P10 make it a tested rule rather than a description.

---

## 2. The policy

Fourteen items, P1 to P14. "Today" cites the line that does the current thing; "proposed" is
what this document adds. Each item names the errors it expects, existing by declaration line or
marked proposed. Wrapped means v4's `WrappedError(hook, callbackSelector, reason, HookCallFailed)`
(`lib/uniswap-hooks/lib/v4-core/src/libraries/CustomRevert.sol:11`, raised by
`lib/uniswap-hooks/lib/v4-core/src/libraries/Hooks.sol:131-137`), the shape the suite asserts
with `_wrapped` (`test/SettlementExecutor.t.sol:545-553`).

### P1. An immutable, chain-specific input set, resolved in code, disjoint from the payout set

Today: there is no input set; the input is `address(0)` by the check at
`src/SettlementExecutor.sol:155` and the shape at `src/V4SettlementHook.sol:156`.

Proposed: `src/libraries/UniswapDeployments.sol` gains
`isInputCurrency(uint256 chainId, address currency) internal pure returns (bool)`, a compiled
table with the same construction as `payoutCurrency` (lines 24-27): no owner, no setter, no
proxy, reverting `UnsupportedChainId(chainId)` (line 10) on a chain with no entry, returning
`false` for a non-member on a supported chain. Native (`address(0)`) is a member on every
supported chain. The table for 11155111 is `{address(0)}` until section 5's conditions are met;
UNI is the first proposed token entry and is not added by this document.

Two constraints, both asserted by a test (proposed):

- **Disjointness.** No address is in both the input set and the payout set of a chain. The
  direction of a swap is then a function of the key alone (P2), never a guess.
- **Address change.** Adding an entry changes the hook's creation code, therefore its CREATE2
  address, therefore the executor's derived address (`src/V4SettlementHook.sol:117-123`), and
  is a new deployment with a new source verification (the reasoning at
  `src/libraries/UniswapDeployments.sol:23`, which `docs/PAYOUT-POLICY-SPEC.md` section 2.1 applies
  to the payout table). The live release is not touched by this policy's existence.

The executor calls a member's `approve` (P5). Calling a contract the code did not sanction is
what `src/V4SettlementHook.sol:166` forbids for the hook ("no unknown contract is ever called");
the compiled set is what makes that rule hold for the executor's one token call.

### P2. The pool shape: exactly one payout side, exactly one input side, either ordering

Today: `src/V4SettlementHook.sol:156-158`, native as currency0 and the payout as currency1.

Proposed: `_beforeInitialize` computes `payout0 = isPayoutCurrency(currency0)`,
`payout1 = isPayoutCurrency(currency1)` and refuses unless exactly one is true; then requires
the other side to satisfy `isInputCurrency`. Every refusal keeps the existing
`NotTheSettlementShape(currency0, currency1)` (line 82). Anyone may still initialise a sanctioned
shape at any fee tier: the check is on the currencies, not the caller (lines 149-151;
`test/attack/HostilePool.t.sol:109-115`).

Derivation, one pure function used by the hook and the executor (proposed, in `src/libraries/`):

```solidity
/// The settlement shape of a key that _beforeInitialize admitted. Reverts on any other key.
function shape(PoolKey memory key) internal pure
    returns (Currency input, Currency payout, bool zeroForOne);
// zeroForOne == true  when input is currency0 (native today; any token below the payout address)
// zeroForOne == false when input is currency1 (UNI against USDC)
```

### P3. Registration derives the input side and refuses non-members

Today: `src/SettlementExecutor.sol:150-151` (payout on currency1) and `:155`
(`NativeInputOnly`).

Proposed order of checks in `createOrder`, all before any storage write, keeping every existing
check in its place: recipient (`ZeroRecipient` :90, `ReservedRecipient` :96), hook
(`PoolNotGuarded` :98), then the shape: exactly one side a payout member or
`PayoutCurrencyNotAllowed` (:101) naming the side that should have been the payout, keeping
today's behaviour for a key with none; both sides payout members or both sides input members
refused with `AmbiguousSettlementShape(currency0, currency1)` (proposed); the other side an
input member or `InputCurrencyNotAllowed(address)` (proposed, retiring `NativeInputOnly`
at :110 and :155, whose only test is `test/SettlementExecutor.t.sol:252-255`); then the
existing amount, minimum and deadline checks (:152-154). `Order` (:53-62) gains no field for
the input: it is derived from `key` through `shape` wherever it is needed, so it cannot
disagree with the key. Where `docs/PAYOUT-POLICY-SPEC.md` section 2.3 adds `payoutCurrency` to the
order, this policy's shape check sits after that specification's step 4 and before its step 5.

### P4. Payer authorisation: one signature per order, to the executor, exact amount, no standing allowance

The payer's authorisation is a Permit2 **SignatureTransfer**, never an AllowanceTransfer:

- Function: `permitWitnessTransferFrom(PermitTransferFrom permit, SignatureTransferDetails
  details, address owner, bytes32 witness, string witnessTypeString, bytes signature)`
  (`lib/uniswap-hooks/lib/v4-periphery/lib/permit2/src/interfaces/ISignatureTransfer.sol:90-97`;
  implementation `…/permit2/src/SignatureTransfer.sol:32-43`, `:51-68`).
- Spender: the executor. Permit2 hashes `msg.sender` as the spender and the payer signs over
  it (`ISignatureTransfer.sol:49-50`: "it is required that it is msg.sender … a user still
  signs over a spender address"). The executor is the only contract that may present the
  signature.
- `permit.permitted.token`: the input side of the order's key (P2). `permit.permitted.amount`:
  exactly `order.amountIn`. `details.requestedAmount`: exactly `order.amountIn`.
  `details.to`: the executor. Permit2 itself allows `requestedAmount <= permitted.amount`
  (`SignatureTransfer.sol:61`, `InvalidAmount` otherwise); the executor requires equality on
  both, refusing `PermitAmountMismatch(orderId, amountIn, permitted)` (proposed), so a payer can
  never sign for more than the order and a caller can never pull less than it.
- `permit.nonce`: the payer's unordered nonce, marked used before the signature is checked
  (`SignatureTransfer.sol:63`, `:150-157`, `InvalidNonce` at `…/permit2/src/PermitErrors.sol:11`).
- `permit.deadline`: the payer's; `SignatureExpired(deadline)` (`PermitErrors.sol:8`,
  `SignatureTransfer.sol:60`). It is checked by Permit2 and is independent of the order's
  deadline, which the executor and the hook check as today (P12).
- `owner`: `msg.sender` of the executor's entry point. The payer is the account that signed and
  whose tokens move, and it is the account that submits (proposed; a relayed submission with
  `owner != msg.sender` is a later, separate decision, whose one consequence is that the
  receipt's `payer` field would name the signer, not the submitter). The signature is verified
  by `SignatureVerification.verify` (`…/permit2/src/libraries/SignatureVerification.sol:21`),
  whose errors are `InvalidSignatureLength`, `InvalidSignature`, `InvalidSigner`,
  `InvalidContractSignature` (lines 8-17).
- `witness` and `witnessTypeString` (proposed): the hash of a struct the executor recomputes
  from its own storage at pay time, never from calldata, so the payer signs exactly what the
  executor enforces and a wallet can render the fields:

  ```
  Settlement(bytes32 orderId,bytes32 poolId,address recipient,address tokenIn,uint128 amountIn,
             address tokenOut,uint128 minOut,uint64 deadline)
  witnessTypeString =
    "Settlement witness)Settlement(bytes32 orderId,bytes32 poolId,address recipient,address tokenIn,"
    "uint128 amountIn,address tokenOut,uint128 minOut,uint64 deadline)"
    "TokenPermissions(address token,uint256 amount)"
  ```

  Permit2 prepends its stub
  `PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,`
  (`…/permit2/src/libraries/PermitHash.sol:31-32`, hashed at `:85-92`), so the referenced types
  must follow EIP-712 ordering: `Settlement` before `TokenPermissions`. The type string is a
  compile-time constant of the executor; a test asserts the hash Permit2 derives from it equals
  the hash a reference signer computes (the signing pattern of
  `lib/uniswap-hooks/lib/v4-periphery/test/shared/Permit2SignatureHelpers.sol:25-50`, which
  signs AllowanceTransfer permits and is extended, not copied, for the witness form).

What the payer does **not** grant: any Permit2 `approve` or `permit` naming the executor or the
router (`IAllowanceTransfer.sol:123`, `:130`), any ERC-20 `approve` naming the executor or the
router. The one standing approval Permit2 requires is the payer's ERC-20 approval of Permit2
itself (`ISignatureTransfer.sol:8`: "Requires user's token approval on the Permit2 contract"),
which is the payer's decision about Permit2, made once, outside this system; this policy does
not ask for it, widen it, or depend on its size beyond `amountIn`. This is the design law of
`design/README.md:22-23`: for a token payer "the exact spender, the exact amount, the expiry.
Never 'Approve'."

### P5. The official transfer path from the executor to the PoolManager

The plan is the live plan with the direction derived (proposed):

```
actions = SWAP_EXACT_IN_SINGLE (0x06) · SETTLE (0x0b) · TAKE (0x0e)       // Actions.sol:18, :29, :33
params[0] = ExactInputSingleParams{ poolKey: order.key, zeroForOne: shape.zeroForOne,
                                    amountIn: order.amountIn, amountOutMinimum: order.minOut,
                                    hookData: abi.encode(orderId) }        // unchanged but for the direction
params[1] = (shape.input,  OPEN_DELTA, payerIsUser = shape.input is a token)  // native: false as today (:233)
params[2] = (shape.payout, order.recipient, OPEN_DELTA)                      // unchanged (:235)
```

For a token input the router resolves `SETTLE` as `_settle(input, msgSender() = executor,
fullDebt)` (`V4Router.sol:65-68`; `DeltaResolver.sol:79-87` maps `OPEN_DELTA` to
`_getFullDebt`), syncs the PoolManager (`DeltaResolver.sol:41`) and calls its `_pay`, which
pulls from the executor to the PoolManager through Permit2 (section 1.3). Nothing lands on the
router. For that pull to succeed the executor must, before `execute` and after the P4 pull:

1. `IERC20Minimal(input).approve(PERMIT2, amountIn)` — a plain ERC-20 approval of Permit2 for
   exactly the order's amount, through a helper that treats a `false` return as failure and an
   empty return as success when the target has code (`ApproveFailed(token)`, proposed). This is
   the executor's only call into a token other than `balanceOf`; P1 bounds the callee.
2. `IAllowanceTransfer(PERMIT2).approve(input, UNIVERSAL_ROUTER, uint160(amountIn), 0)`
   (`IAllowanceTransfer.sol:123`). Expiration `0` stores `block.timestamp`
   (`…/permit2/src/libraries/Allowance.sol:39-41`), so the allowance is valid only in this block;
   Permit2's `_transfer` (`AllowanceTransfer.sol:76-93`) refuses `block.timestamp > expiration`
   with `AllowanceExpired` (line 79) and decrements the amount on use (lines 82-88).

`PERMIT2` is resolved from hookmate's constant, "Same on all chains"
(`lib/hookmate/src/constants/AddressConstants.sol:138-140`), the way the PoolManager already is
(`src/SettlementExecutor.sol:123`); it is 9,152 bytes of code on Sepolia (read above).

After `execute` returns, and before `Settled`, the executor reads both allowances (`allowance(executor, PERMIT2)` on the token; `permit2.allowance(executor, input, UNIVERSAL_ROUTER)`) and refuses `AllowanceNotConsumed(token, spender, remaining)` (proposed) if either is nonzero; it then zeroes both (`approve(PERMIT2, 0)`; `permit2.approve(input, UNIVERSAL_ROUTER, 0, 0)`).
nonzero. The router pulls exactly the full debt, which the hook has just proven equal to `amountIn` (`PartialFill`, P12), so on a standard token both read zero and the zeroing is a no-op kept for a token that lies about its allowance.

### P6. What is bound, and where

| Fact | Bound by | Checked at |
|---|---|---|
| Payer | the signature's `owner`, equal to `msg.sender` (P4); recorded as `order.payer` before any external call (today `:190`) | Permit2 (`InvalidSigner`), the executor, the hook reads it from the order for the receipt (`src/V4SettlementHook.sol:241`) |
| Token in | `permitted.token` must equal `shape.input` of the order's key; also a witness field | executor (`PermitTokenMismatch(orderId, expected, got)`, proposed) before Permit2 is called; the witness makes a forged token fail signature verification too |
| Amount in | `permitted.amount == requestedAmount == order.amountIn` (P4); consumed input `== order.amountIn` (hook, `PartialFill` :100, :198) | executor, then hook |
| Nonce | Permit2 unordered nonce, single use, payer-chosen | Permit2 (`InvalidNonce`) |
| Deadline | `permit.deadline` (Permit2, `SignatureExpired`); `order.deadline` (executor `OrderExpired` :115/:185; hook `OrderExpired` :92/:179) | both, independently |
| Recipient, token out, minimum output, pool key | the order in storage, reached through `orderId` in hook data (spec C1, `src/V4SettlementHook.sol:256-265`); repeated in the witness so the payer signs them | executor (`TAKE` to `order.recipient` :235; `RecipientShort` :106/:205), hook (`PoolDoesNotMatchOrder` :96/:183, `OutputBelowMinimum` :102/:201) |
| Chain and executor | `orderId = keccak256(chainid, executor, creator, salt)` (`:157`; threat T10, `docs/THREAT-MODEL.md:20`); Permit2's EIP-712 domain includes `block.chainid` and Permit2's address (`…/permit2/src/EIP712.sol:34`, recomputed if the chain id changes, `:26-29`); the spender field is the executor | Permit2, the executor's storage |

### P7. Both orderings and both swap directions are admitted, and each is checked

Today: `zeroForOne` is `true` at `src/SettlementExecutor.sol:226` and required `true` at
`src/V4SettlementHook.sol:180`.

Proposed: the executor composes `shape.zeroForOne`; the hook computes the same from the key it
is handed (it knows the payout set already: `PAYOUT_CURRENCY`, `:46`) and refuses
`params.zeroForOne != expected` with the existing `ParamsDoNotMatchOrder` (:94). In
`_afterSwap` the consumed and credited legs are selected by the same boolean (section 1.2's
table), and `_receipt` names `currencyIn`/`currencyOut` by it (today `:243-244`). The receipt
schema does not change: `docs/RECEIPT-SCHEMA.md:23` already defines `currencyIn` as "the input
currency; `address(0)` is native ETH", a field that admits a token.

### P8. Transient custody

The executor's balance of the input token may be nonzero only between the Permit2 pull (P4)
and the router's pull (P5), both inside one call of the token entry point. No function of the
executor moves a token except through that plan; there is still no `receive`
(`src/SettlementExecutor.sol:36-37`; `test/SettlementExecutor.t.sol:357-361`), no sweep, no
rescue, no owner (`SECURITY.md:81-82`). The native entry point `pay` is unchanged in this
respect: it forwards its value (:196) and holds nothing.

### P9. Executor balance before and after success

Rule (proposed): for the input token, `balanceOf(executor)` after `pay` equals `balanceOf(executor)`
before; for the payout token, the same (today asserted as zero at
`test/SettlementExecutor.t.sol:60`); the executor's native balance is zero (`:63`); the
router's balances of both are zero (`:61`, `:64`). Measured immediately after the P4 pull, the
executor's input balance equals `before + amountIn` or the payment is refused with
`InputNotReceived(token, expected, got)` (proposed), which catches a fee on the payer-to-executor
leg with exact numbers. Refused after the router returns with `ExecutorBalanceChanged(token,
before, after)` (proposed) if anything remains or is missing.

Why "unchanged" and not "zero": anyone can transfer a token to any address. A rule of "zero
before" would let one wei of the input token, sent to the executor by a stranger, make every
order in that token unpayable for ever. Under this policy a stray balance is stranded (no code
path moves it, P8), unspendable by any order (the allowances are exact, P5), and harmless to
settlement. The observable stays: on the live deployment the executor holds 0 UNI, 0 USDC and
0 wei (reads above, 16:49:30Z), and every test starts and ends at zero except the one that
plants a stray on purpose (section 3, row 21).

### P10. Executor balance after every refusal or revert

Every refusal in this policy is a revert of the whole payment, as today (invariant I6,
`docs/INVARIANTS.md` row I6; T8, `docs/THREAT-MODEL.md:18`). The Permit2 pull, the two
approvals, the router call and the post-checks are all inside one call frame with no `try`;
the executor never catches. So after any refusal the executor's balances, the payer's balance,
the nonce bitmap, both allowances, the order's status and the receipt counter are what they
were, by EVM semantics, and the tests assert it anyway so that a future `pay` that caught a
failure would be caught by the suite (`test/SettlementExecutor.t.sol:528-543`). Two checks
remain after the router returns and are refusals in their own right: `NoReceipt` (:103, :198)
and `RecipientShort` (:106, :205).

### P11. Token behaviour

The compiled set (P1) is the first defence: a token with any of the behaviours below is not
made a member (section 5 states the bar for UNI). The residual, as for the payout token
(`docs/THREAT-MODEL.md:17`, T7), is a member's runtime changing after it was sanctioned. For
that residual each behaviour has a refusal and a test at the member's address:

| Behaviour | Where it bites | Refusal |
|---|---|---|
| Fee on transfer, payer→executor leg | the executor receives less than `amountIn` | `InputNotReceived` (P9, proposed), before any approval or router call |
| Fee on transfer, executor→PoolManager leg | the PoolManager credits `balanceOf` growth, `paid = reservesNow - reservesBefore` (`PoolManager.sol:349-364`); the router's debt is not closed | `CurrencyNotSettled` at the end of the unlock (`PoolManager.sol:112`) |
| Rebasing up between the pull and the settle | the executor ends with more than it began | `ExecutorBalanceChanged` (P9, proposed) |
| Rebasing down | the router's pull exceeds the executor's balance | the token's own revert, or solmate's `TRANSFER_FROM_FAILED` (`lib/uniswap-hooks/lib/v4-periphery/lib/permit2/lib/solmate/src/utils/SafeTransferLib.sol:62`) raised inside Permit2 (`AllowanceTransfer.sol:93`) |
| Callback on transfer (ERC-777 style) during the P4 pull, before the router's lock exists | a re-entry into either entry point | `Reentered()` (proposed): a transient-storage guard on both entry points. The T6 tests (`test/SettlementExecutor.t.sol:431-491`) cover re-entry inside the unlock, where the router's `ContractLocked` and the order's state refuse; the P4 pull happens before the router is entered, so a guard of our own is needed there |
| Callback on transfer during the router's pull (inside the unlock) | as today | the order's state (`OrderNotOpen(id, Paying)`, `:114`) and the router's lock (`test/SettlementExecutor.t.sol:453-459`), plus the new guard |
| Returns `false` | Permit2's `safeTransferFrom` reverts `TRANSFER_FROM_FAILED` (solmate, as above); the executor's `approve` helper refuses | `ApproveFailed` (P5, proposed) for the approve; the bubbled revert for the pull |
| Returns nothing (no return data) | solmate accepts empty return data when the call succeeded; the executor's helper must too | none: this token settles, and its row in section 3 is a control |
| Reverts in `transferFrom` toward the PoolManager | inside the router's pull | the bubbled revert; nothing moves |
| Arbitrary code | excluded by P1; the residual is an upgraded member | the deploy-time and fork assertions `docs/PAYOUT-POLICY-SPEC.md` section 3 row 14 proposes for payout entries (`code.length`, `decimals()`, `symbol()`) apply to every input entry; UNI's runtime hash is recorded in section 5 for that purpose |

### P12. Partial fills, replay, wrong token, wrong payer, wrong pool, wrong recipient, signature substitution

| Case | Refusal, in the order the code reaches it |
|---|---|
| Partial fill | wrapped `PartialFill(id, requested, consumed)` (`src/V4SettlementHook.sol:100`, `:197-198`), consumed read from the input leg selected by direction (P7) |
| Replay: the same signature for the same order | `OrderNotOpen(id, Settled)` at the executor (`:114`, `:184`), before Permit2 is called; Permit2's `InvalidNonce` would be the second line |
| Replay: the same nonce for another order, fresh signature | `InvalidNonce()` from Permit2 (`SignatureTransfer.sol:155`) |
| Wrong token: `permitted.token` is not the order's input side | `PermitTokenMismatch` (P6, proposed), before Permit2; a signature over the wrong token would in any case fail against the witness (`InvalidSigner`) |
| Wrong payer: a signature by A submitted by B | `InvalidSigner()` from Permit2 (`SignatureVerification.sol:14`), because `owner = msg.sender = B` and the signature is A's; no transfer has happened |
| Wrong pool: a plan swapping in a key other than the order's | wrapped `PoolDoesNotMatchOrder(id)` (`:96`, `:183`) |
| Wrong recipient | structural, unchanged: `TAKE` is composed from `order.recipient` (`:235`); a recipient on the path is refused at creation (`ReservedRecipient`, `:96`, `:142-148`); a stranger driving the router is refused (`NotSettlementExecutor`, `:86`, `:175`); short delivery is refused (`RecipientShort`) |
| Signature substitution: a valid signature for order X presented to pay order Y | the witness the executor recomputes for Y differs from the one signed for X, so `InvalidSigner()`; if X and Y differ only in `salt`, `orderId` differs and the witness still differs |
| Native value sent with a token order | the token entry point is not `payable`, so the call reverts before any code runs; `pay` on a token order is refused with `InputIsNotNative(orderId, token)` (proposed), and the token entry point on a native order with `InputIsNative(orderId)` (proposed) |

### P13. Allowance lifetime and revocation

- **Payer.** No allowance to anything of ours, ever. The signature is single-use by nonce and
  time-bound by `permit.deadline`. Before it is used the payer revokes it with
  `invalidateUnorderedNonces(wordPos, mask)` (`ISignatureTransfer.sol:133`;
  `SignatureTransfer.sol:130`). The payer's standing ERC-20 approval of Permit2 is revoked at
  the token, as for any Permit2 user.
- **Executor.** Two allowances exist for one transaction: the ERC-20 allowance to Permit2 and
  the Permit2 allowance to the router, each exactly `amountIn`, the second expiring at
Both are read back, then zeroed, before `Settled`.
  allowance from the executor to anyone, so `lockdown` (`IAllowanceTransfer.sol:157`) is never
  needed and a test asserts both read zero at rest.

### P14. Exact receipt agreement

Unchanged in form (`docs/RECEIPT-SCHEMA.md`, version 1) and extended in reach:

- `amountIn` (field 9) equals `order.amountIn` (`src/V4SettlementHook.sol:245`), which the hook
  has proven equal to the consumed input leg (`PartialFill`), which equals the Permit2
  `requestedAmount` and `permitted.amount` (P4), which equals the payer's balance decrease and
  the PoolManager's balance increase in the input token (P11: any leakage on either leg
  reverts).
- `amountOut` (field 10) equals the credited output leg (`:246`), and the recipient's balance
  in the payout token grew by at least `minOut` (`RecipientShort`), as today; for a standard
  token the two are equal (`test/ReceiptSchema.t.sol:72`).
- `currencyIn` (field 7) and `currencyOut` (field 8) are the input and payout sides of the key
  by direction (P7). An indexer that assumed `currencyIn == address(0)` was reading a fact of the
  live deployment, not of the schema (`docs/RECEIPT-SCHEMA.md:23`); the field becomes
  load-bearing, as `currencyOut` does under the payout policy.
- `payer` (field 5) is the signature owner (P4), read from the order the executor wrote before
  calling the router (`:241`), as today.
- The two events of I2 (`SettlementReceipt`, `HookFee`) are emitted once (`:236-250`), inside
  the swap, and survive only if `NoReceipt` and `RecipientShort` and the new P9 checks pass.

---

## 3. The red-test matrix

Twenty-four rows. Each states its precondition, the call, the intended selector with its
reason (existing errors by declaration line; "proposed" otherwise), the assertion set, and the
control that must pass first. The six assertions are those of `docs/PAYOUT-POLICY-SPEC.md` section 3
(A1 no order consumption, A2 no receipt, A3 no balance leakage, A4 no stranded PoolManager
delta, A5 unchanged state except revert-neutral effects, A6 the control row passes first), with
these extensions for a token input:

- **A3** covers the input token at the payer, the executor, the router and the PoolManager, and
  the payout token at the recipient, the executor and the router.
- **A4** covers Permit2 state: the payer's nonce bit unchanged on a refusal; the executor's
  Permit2 allowance to the router and ERC-20 allowance to Permit2 both zero after every row,
  refused or settled.
- **A5** covers the transient reentrancy mark (gone with the transaction) and, for registration
  refusals, `orderCount` and `orders(id).status == None`.

"Registration refusal set" means A1-A5 for a `createOrder` that reverts (no storage write, no
external call). "Payment refusal set" means A1-A5 for a payment that reverts (order still
`Open`, `payer` zero, everything else unchanged). The test topology is
`test/utils/SettlementTestBase.sol`: the official PoolManager and Universal Router bytecode at
their addresses (`:78-94`, `:116-123`). Two additions are needed for these rows (proposed): the
Permit2 runtime at its canonical address, from hookmate's artifact
(`lib/hookmate/src/artifacts/Permit2.sol:6-13`, `Permit2Deployer.initcode()`) or etched from
the chain (9,152 bytes, read above) — Permit2's own source pins `solidity 0.8.17`
(`…/permit2/src/PermitErrors.sol:2`) and cannot be compiled by this tree's one compiler
(`foundry.toml`, `solc_version = "0.8.30"`), the same reason the PoolManager is deployed as
bytecode (`SettlementTestBase.sol:34-35`); and a mock input token placed at the member's
address the way the payout mock is placed at USDC's (`SettlementTestBase.sol:101-105`), with a
signing key for the payer (`vm.sign`) so the signature rows are real signatures.

### Row 1 — non-member token as the input side

- Precondition: `MockERC20("Worthless", "WORTH", 18)`, not in the input set; key
  `{min(WORTH, USDC), max(WORTH, USDC), fee, ts, hook}`.
- Calls: (a) `manager.initialize(key, price)`; (b) `createOrder(recipient, key, …)`.
- Selectors: (a) wrapped `NotTheSettlementShape(c0, c1)` in `beforeInitialize` — existing
  (`src/V4SettlementHook.sol:82`), under P2; (b) `InputCurrencyNotAllowed(WORTH)` — proposed
  (P3). Reason: the executor will call this token's `approve` (P5) and the receipt will name it
  as `currencyIn`; neither may happen for a token nobody sanctioned.
- A1-A5: no pool (`sqrtPriceX96` zero), registration refusal set.
- A6 control: the member shape initialises and settles (row 24).

### Row 2 — ambiguous shape: two payout members, or two input members

- Precondition: keys `{USDC, EURC}` (both payout members once `docs/PAYOUT-POLICY-SPEC.md` section
  2.1 has two entries) and `{address(0), UNI}` (both input members once UNI is an entry).
- Calls: (a) initialise each; (b) `createOrder` against each.
- Selectors: (a) wrapped `NotTheSettlementShape` — existing (`:82`), under P2's "exactly one
  payout side"; (b) `AmbiguousSettlementShape(c0, c1)` — proposed (P3). Reason: with two payout
  sides there is no input to pull; with two input sides there is no recipient currency; a
  direction guessed from such a key would be wrong half the time.
- A1-A5: no pool, registration refusal set.
- A6 control: row 24, and the disjointness test of P1 (a positive over the two tables).

### Row 3 — wrong direction on the reversed ordering

- Precondition: member pool `{USDC, UNI}` with liquidity; an order for `amountIn` UNI; the
  executor harness at the executor's address (`test/utils/SettlementTestBase.sol:139-144`)
  composes the order's id into a swap with `zeroForOne = true` (which would pay USDC to receive
  UNI).
- Call: `harness.payWithPlan(id, commands, inputs)` after the harness has pulled and approved
  the input (the harness gains the P4/P5 steps or a test-only setter for them).
- Selector: wrapped `ParamsDoNotMatchOrder(id)` in `beforeSwap` — existing (`:94`), by P7.
  Reason: the mirror of `test/V4SettlementHook.t.sol:233-245`, which proved that removing the
  direction check left the suite green; on the reversed ordering the check must refuse `true`.
- A1-A5: payment refusal set.
- A6 control: the same plan with `zeroForOne = false` settles once (row 24).

### Row 4 — native value sent to the token entry point; token order paid through `pay`

- Precondition: a UNI order.
- Calls: (a) the token entry point with `{value: 1}`; (b) `pay{value: amountIn}(id)`.
- Selectors: (a) the ABI's non-payable revert (no selector; the test asserts the call fails and
  the payer's balance is unchanged); (b) `InputIsNotNative(id, UNI)` — proposed (P12). Reason:
  the two entry points are distinguished by the order's shape, not by the caller's choice; a
  native payment against a token order would forward value to a plan that settles a token.
- A1-A5: payment refusal set.
- A6 control: `test_SettlementDeliversToTheRegisteredRecipient`
  (`test/SettlementExecutor.t.sol:45-69`) for `pay`; row 24 for the token entry point.

### Row 5 — native order presented to the token entry point

- Precondition: the live shape, an ETH order.
- Call: the token entry point with a valid-looking permit.
- Selector: `InputIsNative(id)` — proposed (P12), before Permit2 is called. Reason: there is
  no token to pull; the check must precede any external call so no nonce is spent.
- A1-A5: payment refusal set; the payer's nonce bit unchanged.
- A6 control: `test_SettlementDeliversToTheRegisteredRecipient`.

### Row 6 — permit amount differs from the order (both directions)

- Precondition: a UNI order for `amountIn`; a signature over `permitted.amount = amountIn + 1`,
  then one over `amountIn - 1`.
- Call: the token entry point, twice.
- Selector: `PermitAmountMismatch(id, amountIn, permitted)` — proposed (P4), before Permit2.
  Reason: Permit2 would accept `requestedAmount <= permitted.amount`
  (`SignatureTransfer.sol:61`); a payer must never sign for more than the order, and a caller
  must never pull less than it.
- A1-A5: payment refusal set; nonce bit unchanged.
- A6 control: row 24 (equal amounts).

### Row 7 — permit token differs from the order's input side

- Precondition: a UNI order; a signature whose `permitted.token` is USDC (the payout) or a
  third member.
- Call: the token entry point.
- Selector: `PermitTokenMismatch(id, UNI, got)` — proposed (P6), before Permit2. Reason: the
  pull must be in the currency the plan settles; had it passed, Permit2's `InvalidSigner` would
  have caught the witness disagreement, but only after spending gas on a wrong path and with a
  less useful reason.
- A1-A5: payment refusal set.
- A6 control: row 24.

### Row 8 — wrong payer

- Precondition: a UNI order; a valid signature by A; B submits.
- Call: the token entry point from B.
- Selector: `InvalidSigner()` — existing in Permit2
  (`…/permit2/src/libraries/SignatureVerification.sol:14`, raised by `verify` at `:21`), reached
  through `SignatureTransfer.sol:65`. Reason: `owner = msg.sender = B` (P4) and the signature is
  A's; the nonce bit for B was flipped inside Permit2 at `:63` before `verify`, and the whole
  call reverts, so it is unflipped.
- A1-A5: payment refusal set; A's and B's balances unchanged; both nonce bitmaps unchanged.
- A6 control: A submits A's signature and settles (row 24).

### Row 9 — signature substitution

- Precondition: two UNI orders X and Y with identical terms but different salts; a valid
  signature for X.
- Call: the token entry point for Y with X's signature.
- Selector: `InvalidSigner()` — existing in Permit2. Reason: the executor recomputes the witness
  for Y (`orderId`, `poolId`, recipient, tokens, amounts, deadline) and Y's `orderId` differs
  from X's, so the typed-data hash differs and the recovered signer is not the owner.
- A1-A5: payment refusal set; Y stays `Open`; X stays `Open`.
- A6 control: X's signature pays X (row 24).

### Row 10 — replay of a settled order, and reuse of a nonce

- Precondition: X settled with signature S and nonce n.
- Calls: (a) the token entry point for X with S again; (b) the token entry point for a fresh
  order Z with a fresh signature that reuses nonce n.
- Selectors: (a) `OrderNotOpen(X, Settled)` — existing (`src/SettlementExecutor.sol:114`,
  `:184`), before Permit2 is called; (b) `InvalidNonce()` — existing in Permit2
  (`…/permit2/src/PermitErrors.sol:11`, raised at `SignatureTransfer.sol:155`). Reason: I5 is
  enforced by the order before the nonce is consulted; the nonce is the second, independent
  line, and (b) shows it is real.
- A1-A5: X stays `Settled` with `receiptCount` unchanged; Z stays `Open`.
- A6 control: `test_RevertWhen_OrderPaidTwice` (`test/SettlementExecutor.t.sol:151-160`) for the
  native shape; row 24 for the token shape.

### Row 11 — expired permit with a live order; expired order with a live permit

- Precondition: (a) `permit.deadline < block.timestamp <= order.deadline`; (b) the reverse.
- Call: the token entry point.
- Selectors: (a) `SignatureExpired(deadline)` — existing in Permit2 (`PermitErrors.sol:8`,
  `SignatureTransfer.sol:60`); (b) `OrderExpired(id, deadline)` at the executor — existing
  (`:115`, `:185`), and wrapped at the hook (`src/V4SettlementHook.sol:92`, `:179`) when the
  executor's check is bypassed by the harness. Reason: two deadlines, two owners (payer,
  creator), each checked where it belongs (P6).
- A1-A5: payment refusal set.
- A6 control: `test_RevertWhen_OrderExpired` (`test/SettlementExecutor.t.sol:163-170`) and
  `test_RevertWhen_ExpiredOrderReachesTheHook` (`test/V4SettlementHook.t.sol:201-214`) as the
  native precedents; row 24 with both deadlines live.

### Row 12 — wrong pool

- Precondition: an order in key A (`{USDC, UNI}`, fee 3000, spacing 60); a second member pool B
  (`{USDC, UNI}`, fee 500, spacing 10, initialised by anyone); the harness composes A's id into
  a swap in B.
- Call: `harness.payWithPlan(idA, …)` with `poolKey = B`.
- Selector: wrapped `PoolDoesNotMatchOrder(idA)` — existing (`:96`, `:183`). Reason: the pool id
  covers both currencies, fee, spacing and hook; the order binds one.
- A1-A5: payment refusal set.
- A6 control: `test_RevertWhen_PoolDisagreesWithTheOrder` (`test/V4SettlementHook.t.sol:249-264`)
  for the native shape; `harness.planFor(idA)` in A settles for the token shape.

### Row 13 — wrong recipient

- Precondition and calls: as `docs/PAYOUT-POLICY-SPEC.md` section 3 row 9, in the token shape: a
  stranger drives the router with a `TAKE` to themselves; a recipient on the path is registered;
  a token delivers elsewhere.
- Selectors: wrapped `NotSettlementExecutor(stranger)` (`:86`, `:173-175`);
  `ReservedRecipient(recipient)` (`src/SettlementExecutor.sol:96`, `:142-148`);
  `RecipientShort(id, minOut, received)` (`:106`, `:203-205`). All existing. Reason: I1 is
  structural and the token input does not touch it; the row exists so that the token shape is
  proven to inherit it, not assumed to. The note about the harness in that row applies: a
  harness plan with a foreign `TAKE` is a property of the harness, not a hole.
- A1-A5: as that row.
- A6 control: row 24, which asserts the recipient and nobody else received.

### Row 14 — partial fill on the reversed ordering

- Precondition: a UNI order larger than the band can fill (the analogue of
  `test/SettlementExecutor.t.sol:217-233`, whose number was found by the fuzzer).
- Call: the token entry point.
- Selector: wrapped `PartialFill(id, requested, consumed)` — existing (`:100`, `:197-198`),
  with `consumed` read from `-delta.amount1()` under P7. Reason: on `{USDC, UNI}` the consumed
  leg is `amount1`; a hook that kept reading `amount0` would compare the *output* to `amountIn`
  and refuse every settlement, or, worse, accept a partial fill whose output happened to equal
  the input. The sabotage control: with the leg selection reverted to `amount0`, row 24 must go
  red.
- A1-A5: payment refusal set.
- A6 control: row 24; `test_RevertWhen_PoolCannotFillTheOrder_NothingMoves` for the native shape.

### Row 15 — fee on transfer, payer-to-executor leg

- Precondition: a fee-on-transfer runtime placed at the member's address with `vm.etch`
  (the technique of `test/SettlementExecutor.t.sol:286-288`), taking a fee on `transferFrom`
  when the recipient is the executor.
- Call: the token entry point.
- Selector: `InputNotReceived(UNI, amountIn, amountIn - fee)` — proposed (P9), before any
  approval or router call. Reason: the executor must not approve or settle an amount it does
  not hold; the exact numbers in the error are the point (compare `RecipientShort`).
- A1-A5: payment refusal set; the payer's balance unchanged (the pull was reverted).
- A6 control: the same order at a `FeeOnTakeERC20`-style token that takes no fee on this leg
  settles (row 24).

### Row 16 — fee on transfer, executor-to-PoolManager leg

- Precondition: a runtime that delivers whole to the executor and takes a fee when the recipient
  is the PoolManager.
- Call: the token entry point.
- Selector: `CurrencyNotSettled()` — existing in v4
  (`lib/uniswap-hooks/lib/v4-core/src/PoolManager.sol:112`), raised when the unlock ends with a
  nonzero delta count, because `_settle` credited `reservesNow - reservesBefore`
  (`PoolManager.sol:349-364`), which is less than the debt. Reason: the pool's accounting
  refuses a short input; nothing this repository writes is needed, and the row proves that the
  dependency behaves as relied upon.
- A1-A5: payment refusal set; the executor's balance back to `before`; both allowances zero.
- A6 control: row 24.

### Row 17 — rebasing input

- Precondition: a runtime whose `balanceOf(executor)` grows by one unit between the P4 pull and
  the router's pull (triggered from inside `approve`, the executor's one call into the token).
- Call: the token entry point.
- Selector: `ExecutorBalanceChanged(UNI, before, after)` — proposed (P9). Reason: the executor
  must end with what it began; a positive rebase would otherwise accumulate on it, unspendable
  and unaccounted. A negative rebase is the "rebasing down" line of P11 and reverts inside
  Permit2 with `TRANSFER_FROM_FAILED` (`…/solmate/src/utils/SafeTransferLib.sol:62`).
- A1-A5: payment refusal set.
- A6 control: row 24.

### Row 18 — callback token re-enters before the router's lock

- Precondition: a runtime that, on `transferFrom` to the executor, calls the token entry point
  for another open order W with a valid signature (the `ReenteringERC20` pattern,
  `test/utils/ReenteringERC20.sol:38-50`, moved from the payout leg to the input leg).
- Call: the token entry point for order V.
- Selector: `Reentered()` — proposed (P11), recorded by the token as the inner revert (the
  pattern at `test/SettlementExecutor.t.sol:439-444`). Reason: the T6 tests prove the router's
  lock and the order's state refuse a re-entry *inside the unlock*; the P4 pull runs *before*
  the router is entered, so neither defence exists there yet, and W could otherwise be paid
  nested inside V with V's tokens sitting on the executor. The outer payment V then settles (the
  token swallows the inner revert), with one receipt, and W stays `Open` and payable.
- A1-A5: for W, the payment refusal set (asserted after V completes); for V, the positive set.
- A6 control: `test_ReentrantPaymentOfAnotherOrderIsRefusedByTheRouterLock_AndStaysPayable`
  (`test/SettlementExecutor.t.sol:460-491`) as the precedent; row 24.

### Row 19 — false-return token

- Precondition: a runtime whose `approve` returns `false`, then one whose `transferFrom` returns
  `false`.
- Call: the token entry point.
- Selectors: `ApproveFailed(UNI)` — proposed (P5); solmate's `TRANSFER_FROM_FAILED` bubbled from
  Permit2 (`AllowanceTransfer.sol:93` or `SignatureTransfer.sol:67`). Reason: a `false` return
  is a failure; a helper that ignored the return value would proceed to a settle that the
  PoolManager refuses later with a less useful reason.
- A1-A5: payment refusal set.
- A6 control: row 20.

### Row 20 — no-return token (a control)

- Precondition: a runtime whose `approve` and `transferFrom` return no data (the USDT shape).
- Call: the token entry point.
- Expected: settles once. Reason: solmate accepts empty return data when the callee has code and
  the call succeeded; the executor's `approve` helper must accept the same, or a whole class of
  tokens is unpayable for a reason no reviewer would accept. This row is a positive and is the
  control for row 19.
- A6: this row *is* a control; its own control is row 24.

### Row 21 — stray balance on the executor

- Precondition: a stranger transfers 1 unit of UNI to the executor before any order.
- Call: the token entry point for a valid order.
- Expected: settles once; `balanceOf(executor)` is 1 before and 1 after; the stray is not
  pulled (the Permit2 allowance to the router is exactly `amountIn`; `InsufficientAllowance`,
  `AllowanceTransfer.sol:82-84`, would refuse more). Reason: P9's "unchanged, not zero"; a rule
  of "zero before" would let this stranger brick the token for ever.
- A1-A5: positive set plus the stray unchanged.
- A6 control: row 24 with no stray.

### Row 22 — the ordinary Universal Router flow, presented here

- Precondition: a payer who has done what the router's own flow asks: `permit2.approve(UNI,
  UNIVERSAL_ROUTER, amount, expiration)`; no signature to the executor.
- Calls: (a) the token entry point with an empty signature; (b) the payer calls
  `UniversalRouter.execute` directly with the executor's plan and the order's id in hook data.
- Selectors: (a) `InvalidSignatureLength()` — existing in Permit2
  (`SignatureVerification.sol:8`); (b) wrapped `NotSettlementExecutor(payer)` — existing
  (`src/V4SettlementHook.sol:86`, `:175`). Reason: section 1.3's consequence, as a test: an
  allowance to the router authorises nothing on this path, and the path cannot be entered
  without the executor.
- A1-A5: payment refusal set; the payer's Permit2 allowance to the router untouched.
- A6 control: `test_RevertWhen_OfficialRouterIsDrivenByAStranger` (`test/V4SettlementHook.t.sol:125-140`)
  as the precedent; row 24.

### Row 23 — allowance not consumed (sabotage control) and leftover allowance at rest

- Precondition: (a) the executor mutated to approve `2 * amountIn` on either allowance; (b) at
  rest, after a settlement.
- Call: (a) the token entry point; (b) `permit2.allowance(executor, UNI, router)` and
  `UNI.allowance(executor, PERMIT2)`.
the post-call read-back must go red under the mutation, or it proves nothing; the zeroing that follows it is not what the row tests.
- A1-A5: (a) payment refusal set.
- A6 control: row 24 unmutated.

### Row 24 — the token settlement (the control for every row above)

- Precondition: member pool `{USDC, UNI}` at a chosen price with liquidity; an order for
  `amountIn` UNI with `minOut` in USDC units; the payer holds UNI, has approved Permit2 on UNI
  once, and signs the P4 message over the executor's recomputed witness.
- Call: the token entry point, once.
- Expected: exactly one `SettlementReceipt` and one `HookFee`; `currencyIn = UNI`,
  `currencyOut = USDC`, `amountIn` equal to the payer's UNI decrease and the PoolManager's UNI
  increase, `amountOut` equal to the recipient's USDC increase; the executor's UNI and USDC
  balances unchanged and its native balance zero; the router holding nothing; both allowances
  zero; the order `Settled` with `payer` the signer; the nonce bit set. Every line of
  `test_SettlementDeliversToTheRegisteredRecipient` (`test/SettlementExecutor.t.sol:45-69`)
  and `_assertReceiptData` (`:106-128`, with `:122` changed from `address(0)` to the input
  member), plus the receipt-order rule of `test/ReceiptSchema.t.sol:103`.
- A6: the live transaction in the header is the control for the native shape; nothing live
  exists for the token shape, and this document claims nothing live for it.

---

## 4. Coverage today

"Covered" means a named test asserts the row's selector and its control passes in the same
suite. "Partial" means a neighbouring test exercises the code path without pinning the reason
or the shape. "Gap" means expressible against the current code but absent. "Cannot be
expressed" means the row needs a token input pool, a token order, a Permit2 call or a reversed
direction, none of which the current code admits: `src/V4SettlementHook.sol:156` refuses the
pool at birth, `src/SettlementExecutor.sol:155` refuses the order, and no code path calls
Permit2 (`grep -rn -i permit2 src/` returns nothing at `72cabd2`).

| Row | Existing test | Status |
|---|---|---|
| 1 non-member input | `test_RevertWhen_ThePoolShapeIsNotTheSettlementShape` (`test/attack/HostilePool.t.sol:64-77`) initialises an ERC-20 input with a bare `vm.expectRevert()` (`:76`); `test_RevertWhen_CreateOrderRejectsBadInputs` (`test/SettlementExecutor.t.sol:252-255`) asserts `NativeInputOnly` for an ERC-20 in `currency0` | **partial**: the initialisation reason is not pinned; the registration error is the one this policy retires |
| 2 ambiguous shape | none | **cannot be expressed** (needs two members on one side) |
| 3 wrong direction, reversed ordering | `test_RevertWhen_SwapDirectionDisagreesWithTheOrder` (`test/V4SettlementHook.t.sol:233-245`) proves the check on the live ordering | **covered** for the live ordering; the reversed half **cannot be expressed** |
| 4 value to the token entry; `pay` on a token order | `test_RevertWhen_ValueDiffersFromTheOrder` (`test/SettlementExecutor.t.sol:173-181`) is the nearest | **cannot be expressed** (no token entry point, no token order) |
| 5 native order to the token entry | none | **cannot be expressed** |
| 6 permit amount mismatch | none | **cannot be expressed** |
| 7 permit token mismatch | none | **cannot be expressed** |
| 8 wrong payer | none | **cannot be expressed** |
| 9 signature substitution | none | **cannot be expressed** |
| 10 replay, nonce reuse | `test_RevertWhen_OrderPaidTwice` (`:151-160`), `test_RevertWhen_OrderIsNotInFlight` (`test/V4SettlementHook.t.sol:180-197`), `test_Schema_DuplicateOrderIdCannotProduceTwoReceipts` (`test/ReceiptSchema.t.sol:154`) | **covered** for (a) in the native shape; (b) **cannot be expressed** |
| 11 two deadlines | `test_RevertWhen_OrderExpired` (`:163-170`), `test_RevertWhen_ExpiredOrderReachesTheHook` (`test/V4SettlementHook.t.sol:201-214`) | **covered** for the order's deadline; the permit's **cannot be expressed** |
| 12 wrong pool | `test_RevertWhen_PoolDisagreesWithTheOrder` (`test/V4SettlementHook.t.sol:249-264`) | **covered** in the native shape; token shape cannot be expressed |
| 13 wrong recipient | `test_RevertWhen_OfficialRouterIsDrivenByAStranger` (`:125-140`), `test_RevertWhen_RecipientIsAContractOnThePath` (`test/SettlementExecutor.t.sol:338-347`), `test_RevertWhen_RecipientReceivesLessThanTheMinimum_FeeOnTransfer` (`:281-332`), control `test_SettlementDeliversToTheRegisteredRecipient` (`:45-69`) | **covered** in the native shape; the token shape inherits it and must be shown to |
| 14 partial fill, reversed | `test_RevertWhen_PoolCannotFillTheOrder_NothingMoves` (`:217-233`) | **covered** on `amount0`; the `amount1` leg **cannot be expressed** |
| 15 fee on the first leg | `FeeOnTakeERC20` (`test/utils/FeeOnTakeERC20.sol:19-26`) models a fee on the payout leg only | **cannot be expressed** (no input pull exists) |
| 16 fee on the second leg | none | **cannot be expressed** |
| 17 rebasing input | none | **cannot be expressed** |
| 18 callback before the lock | `test_ReentrantPaymentOfTheSameOrderIsRefusedByItsState` (`:431-451`), `test_ReentrantPaymentOfAnotherOrderIsRefusedByTheRouterLock_AndStaysPayable` (`:460-491`) cover re-entry inside the unlock | **cannot be expressed** for the pre-lock window; the in-lock half is covered |
| 19 false return | none (the payout leg's failed transfer is `docs/PAYOUT-POLICY-SPEC.md` row 12(c), also a gap) | **cannot be expressed** for the input leg |
| 20 no return | none | **cannot be expressed** |
| 21 stray balance | `test_RevertWhen_NativeSentDirectly` (`:357-361`) proves a stray *native* transfer reverts; a stray token transfer cannot be refused by any contract | **gap**, expressible today for the payout token: assert that a stray USDC on the executor neither moves nor blocks a native settlement |
| 22 the ordinary router flow | `test_RevertWhen_OfficialRouterIsDrivenByAStranger` (`:125-140`) covers (b) | (b) **covered**; (a) cannot be expressed |
| 23 allowance not consumed | none; the executor holds no allowance today | **cannot be expressed** |
| 24 token settlement | `test_SettlementDeliversToTheRegisteredRecipient`, `test_ReceiptCarriesTheOrderAndTheStandardEvent` (`:76-104`), `testFuzz_EveryPaymentIsDeliveredOnce` (`:133-146`), `test_I7_NothingHeldBeforeOrAfter` (`test/I7NativeSettle.t.sol:143`) | the native twin is **covered** and live-fired; the token row cannot be expressed |

Counted at commit `72cabd2` with `grep -c 'function test' test/*.t.sol test/attack/*.t.sol`:
`test/I7NativeSettle.t.sol` 6, `test/V4SettlementHook.t.sol` 18, `test/ReceiptSchema.t.sol` 5,
`test/SettlementExecutor.t.sol` 21, `test/attack/HostilePool.t.sol` 4; 54 in all, the number
the day's record also states. Of the twenty-four rows: 1 partial, 1 gap expressible today (row
21's payout-token variant), 8 covered for the native shape with a token half that cannot be
expressed (rows 3, 10, 11, 12, 13, 14, 18, 22), and 14 that cannot be expressed at all until
the policy exists (rows 2, 4-9, 15-17, 19, 20, 23, 24). One further precondition is a gap in
the test topology itself: Permit2 is not deployed in `SettlementTestBase` (the router's
immutable points at an address that holds no code in the tests), so no Permit2 row can run
until the artifact or the etched runtime is added (section 3, preamble).

What cannot be expressed today, in one sentence each:

- A pool with a token on the input side and this hook: refused at initialisation
  (`src/V4SettlementHook.sol:156-158`).
- An order with a token input: refused at registration (`src/SettlementExecutor.sol:155`).
- A Permit2 call from the executor: no code path, no import, no address.
- A one-for-zero settlement: refused at `src/V4SettlementHook.sol:180`, and the executor never
  composes one (`:226`).
- A receipt whose `currencyIn` is not `address(0)`: `_assertReceiptData` pins it to zero
  (`test/SettlementExecutor.t.sol:122`), correctly for the live shape.
- The executor holding a token inside `pay`: nothing in `pay` moves a token.

---

## 5. UNI as the first example

None of the following is claimed to hold as a feature. Each fact is dated and has its command in
the header; each condition has the check that would prove it.

### 5.1 The token

| Fact | Value | Read |
|---|---|---|
| Address | `0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984` | the same address as the mainnet token; code present on 11155111 |
| Runtime size | 12,567 bytes | `cast code … \| wc -c`, 2026-09-05T16:45:33Z |
| Runtime keccak | `0xdeba17f16fdba566b45d8019575e068625403cc6986fa17ceadd6edf08aa0868` | `cast code … \| cast keccak`, 16:49:30Z — the value the row-14 deploy assertion (P11, last line) would compare against |
| `symbol()`, `name()`, `decimals()` | "UNI", "Uniswap", 18 | 16:45:33Z |
| `totalSupply()` | 1e27 (one billion tokens at 18 decimals) | 16:49:30Z |
| `minter()` | `0x41653c7d61609D856f29355E404F310Ec4142Cfb` | 16:49:30Z; the governance token's own runtime, not a proxy |
| `PERMIT_TYPEHASH()` | `0x6e71edae…126c9` | 16:49:30Z; UNI has its own EIP-2612 `permit`, which this policy does not use (P4 chooses Permit2 SignatureTransfer for every member; a per-token permit would be a second path to maintain) |
| Deployer's balance | 0 | 16:45:33Z |
| Executor's balance | 0 | 16:49:30Z |

### 5.2 The pool key, ordering, direction, decimals

- Ordering: `int(USDC) < int(UNI)` is `True` (header), so the key is `{currency0 = USDC,
  currency1 = UNI}`: the payout is currency0 and the input is currency1, the reverse of the live
  shape.
- Direction: the payer swaps UNI for USDC, `zeroForOne = false`. Consumed input is
  `-delta.amount1()`, credited output is `delta.amount0()`; the receipt's `currencyIn` is
  `currency1` and `currencyOut` is `currency0` (section 1.2, second row). This is the case every
  hard-coded site in section 1.1 gets wrong today, which is why UNI is a useful first example
  and not only a convenient one.
- Decimals: `amountIn` is in 1e-18 UNI, `minOut` in 1e-6 USDC (`docs/RECEIPT-SCHEMA.md:42`:
  amounts are in the currency's smallest unit). The two units differ by 10^12, which the price
  must absorb.
- Price: v4's `sqrtPriceX96` encodes `sqrt(currency1 raw per currency0 raw) * 2^96`. For this
  key that is UNI-raw per USDC-raw. The arithmetic, with an **illustrative** rate that is not a
  market fact and is not proposed as the seed price:

  ```sh
  python3 - <<'EOF'
  from decimal import Decimal, getcontext; getcontext().prec = 60
  # illustrative only: 1 UNI = 5 USDC  ->  1 USDC raw (1e-6) = 0.2e-6 UNI = 2e11 UNI raw
  price_raw = Decimal(10**18) / Decimal(5 * 10**6)              # 200000000000
  print(int((price_raw.sqrt() * Decimal(2**96)).to_integral_value()))
  EOF
  # 35431911422859142059220343232145201
  ```

  For comparison the live pool's `sqrtPriceX96` `3961408125713216879677197` (README, the
  initialisation row) decodes by the same formula to 2.5e-9 USDC-raw per wei, that is 2,500
  USDC per ETH. The seed price for a UNI pool must come from a quoted source at seeding time,
  be recorded, and be the only price the deploy accepts (the T2b rule, `docs/THREAT-MODEL.md:11`).
- Fee tier and spacing: not decided here; the shape check is indifferent to them
  (`test/attack/HostilePool.t.sol:109-115`).

### 5.3 Liquidity feasibility

A `{USDC, UNI}` pool carrying the hook cannot exist until UNI is a compiled input member (row
1), which is a new hook address and a new deployment (P1). When it can exist it needs a seed on
both sides. The deployer holds 0 UNI (read above). No faucet for UNI on Ethereum Sepolia is
named by any source this document used, and none is claimed to exist; the USDC side has the
same floor the live seed had (`script/go-live.sh`, per `docs/PAYOUT-POLICY-SPEC.md` section 5.4).
Stated as the negative it is: at the time of writing there is no UNI to seed with, no named
source for it, and no quoted price to seed at.

**Condition I-A.** UNI is exactly `0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984`, its runtime
keccak equals the value in section 5.1 at deploy time, `decimals()` is 18, and it is added as an
input member for 11155111 and no other chain.

**Condition I-B.** Rows 15-20 run at UNI's address on a fork and pass (the token's `transferFrom`
delivers whole in both legs; `approve` returns `true`; no callback), before UNI is called an
input member anywhere in prose.

**Condition I-C.** The deployer holds UNI from a named source, the pool is seeded at a quoted and
recorded price, the deploy refuses any other price, and one settlement is live-fired through the
`{USDC, UNI}` pool with status 1 and its receipt read back with `currencyIn` equal to UNI's
address.

**Condition I-D.** The test topology carries Permit2 (section 3, preamble) and a signing payer,
and rows 1-24 are green with each negative seen red first (`docs/INVARIANTS.md:8-9`).

### 5.4 The sentence

No UNI input support, no Permit2 support and no ERC-20 input support is claimed. The live
release accepts native input and pays USDC on Ethereum Sepolia. UNI appears in this document as
the first worked example of the generic policy because its address ordering exercises the
reversed direction; it is not a roadmap item, a partner claim, or a deployment.

---

## 6. Relationship to the payout policy

`docs/PAYOUT-POLICY-SPEC.md` (written the same day against the same commit) specifies the other side
of the key. The two are one design read from two ends, and neither repeats the other:

| This document | That document | Relationship |
|---|---|---|
| P1 input set, disjoint from the payout set | section 2.1 payout set (`isPayoutCurrency`, `payoutDecimals`) | same construction (compiled, chain-specific, address-changing); disjointness is new here and constrains both tables |
| P2 pool shape: one payout side, one input side, either ordering | section 2.2 pool shape: "native is always `currency0` and the payout asset always `currency1`", and "The executor keeps refusing any other input (`NativeInputOnly`)" | **supersedes** that section's ordering sentences once both policies land; until then that section is exact. The reviewer implementing both replaces those two sentences with P2's rule |
| P3 registration order of checks | section 2.3 steps 1-6 | this policy's shape check sits after that section's step 4 (`PayoutCurrencyMismatch`) and before its step 5 (decimals); `NativeInputOnly` at step 6 is retired by P3 |
| P7 direction; P14 receipt | sections 2.4 and 2.5 | unchanged there; here `currencyIn` becomes load-bearing the way `currencyOut` does there |
| P9, P10 balances | section 2.6 I6 and I7 rows | that document says I7 is "unchanged; the input leg is still native"; under this policy the native leg is unchanged and the token leg has its own custody rule (P8-P10) and its own sync path (`DeltaResolver.sol:41`, the same sync before every settle, native or not: `DeltaResolver.sol:11`) |
| Rows 12, 13, 14 (wrong pool, wrong recipient, partial fill) | rows 3, 9, 12 | the same refusals in the token shape; not re-specified, referenced |
| Row 10 (replay) | row 10 | that row's currency-independence argument holds for the input too; the nonce sub-row is new |
| P11 last line (upgraded member) | row 14 (no-code or noncanonical address) | the deploy-time and fork assertions there apply to every input member; UNI's runtime keccak is recorded here for them |
| Row 19 (false return, input leg) | row 12(c) (failed transfer, payout leg) | two legs of one hazard; both gaps today |
| Section 5 conditions I-A to I-D | section 5 conditions C-A to C-E | the same shape of gate; sponsor relevance (C-E) is not repeated: no track named in that section concerns a token input, and this document makes no such claim |
| Section 3 assertions A1-A6 | section 3 assertions A1-A6 | reused by reference, extended for the input token and Permit2 state (section 3 preamble) |
| "What this specification does not decide", first bullet, there: "The input currency: native ETH only … A token input is a different specification." | | this is that specification |

What this specification does not decide:

- Which token, if any, becomes the first input member. Section 5 states the conditions for
  UNI; meeting them is a decision recorded elsewhere, with its own live-fire.
- Relayed submission (`owner != msg.sender`, P4). Named, with its one consequence, and left.
- A fee or a `policyId`: both reserved and zero (`src/V4SettlementHook.sol:62-64`).
- Any chain other than 11155111.
- The gas ceiling for the token path: the native ceiling of 300,000
  (`test/SettlementExecutor.t.sol:31`, measured 236,726 at `:497`) will not hold with a Permit2
  pull and two approvals in the same call; a new ceiling is set from a measurement, not chosen
  (`docs/THREAT-MODEL.md:22`, the way the first one was).
