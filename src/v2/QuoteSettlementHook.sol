// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {IQuoteSettlement} from "./interfaces/IQuoteSettlement.sol";

/// @notice The one thing this hook asks the executor: what invoice is live in this transaction?
/// @dev A view call, answered from transient storage the executor sets before it swaps and clears
///      before it returns. The hook trusts the executor for the invoice's TERMS — as V1's hook
///      already trusts its executor's storage — but trusts nothing about whether the pool then
///      delivered them, which is the part it can see for itself.
interface IActiveQuote {
    /// @return digest the invoice live in this transaction, or zero when none is
    /// @return requiredOut the exact output the merchant must receive
    /// @return poolId the pool the invoice names
    /// @return zeroForOne the direction the invoice names
    function activeQuote() external view returns (bytes32 digest, uint256 requiredOut, bytes32 poolId, bool zeroForOne);
}

/// @title QuoteSettlementHook — a pool that can only be used to pay an invoice
/// @notice V2's claim, and the reason it is a hook rather than a library: a pool guarded by this
///         contract cannot be traded through. Every swap crossing it discharges a merchant-signed
///         invoice, or it reverts. An executor alone cannot promise that, because anyone may call
///         `PoolManager.swap` directly; only the hook sees every swap.
///
///         The second reason is narrower and was measured before this file existed. Under
///         exact-output semantics the official periphery checks the INPUT ceiling and never
///         compares delivered output against the requested amount
///         (`V4Router._swapExactOutputSingle`, which raises only `V4TooMuchRequested`). A pool
///         asked for 1e18 served 2,995,354,955,910 and reverted nowhere — see
///         `test/v2/ShortFill.t.sol`. Exact-output full-fill enforcement therefore exists in a
///         hook or it exists nowhere, and that refusal is this contract's core function.
///
/// @dev IMPLEMENTED AND LOCALLY TESTED, NOT DEPLOYED. Every guard below was written after the
///      control that constrains it was seen to fail, and each is validated by sabotage: deleted,
///      watched to turn a named row red, restored. The rows live in `test/v2/HookAdmission.t.sol`
///      and `test/v2/InvoiceFill.t.sol`.
contract QuoteSettlementHook is BaseHook, IQuoteSettlement {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using LPFeeLibrary for uint24;

    /// @notice The settlement path this hook admits. Set once, at construction, so no key and no
    ///         owner can widen it afterwards.
    address public immutable EXECUTOR;

    /// @notice One authority for consumption, in the hook, because the hook is the only party
    ///         present at every swap. A later failure reverts the whole transaction and rolls
    ///         this back with it — which is the EVM's property, not a guarantee this code makes.
    mapping(bytes32 quoteDigest => bool) public consumed;

    /// @dev The permission bits are part of the address, so they are the one part of a hook that
    ///      cannot be changed after deployment. `beforeInitialize` refuses a pool this hook could
    ///      not police; `beforeSwap` admits; `afterSwap` is where the fill is judged, because the
    ///      delta does not exist until the swap has happened.
    constructor(IPoolManager manager_, address executor_) BaseHook(manager_) {
        EXECUTOR = executor_;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            // Never. A returned delta is the NoOp attack surface, and a payment venue has no
            // business claiming it handled a swap it did not.
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @dev Refuses at creation any pool this contract could not honestly police, so that a pool
    ///      carrying this hook is the settlement shape or does not exist. Both refusals narrow the
    ///      venue rather than patch a symptom: what cannot be initialised never needs a runtime
    ///      guard, and the address is immutable so the narrowing cannot be widened later.
    function _beforeInitialize(address, PoolKey calldata key, uint160) internal pure override returns (bytes4) {
        if (key.currency0.isAddressZero() || key.currency1.isAddressZero()) revert NativeCurrencyNotSettleable();
        if (key.fee.isDynamicFee()) revert DynamicFeeNotSettleable();
        return IHooks.beforeInitialize.selector;
    }

    /// @dev Admits a swap only while the executor has an invoice live, and only for the pool and
    ///      direction that invoice names. A direct `PoolManager.swap` caller finds no live invoice
    ///      and is refused here — which is what makes "every swap through this pool discharges an
    ///      invoice" a property of the pool rather than a habit of one caller.
    ///
    ///      The swapper check is here and NOT repeated in `_afterSwap` on purpose. Both callbacks
    ///      are handed `msg.sender` of the same `PoolManager.swap` call, so a second copy would be
    ///      a branch no test could ever reach — and an unreachable guard is indistinguishable from
    ///      an absent one the day someone deletes it.
    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (sender != EXECUTOR) revert SwapperIsNotTheExecutor(EXECUTOR, sender);
        (bytes32 digest,, bytes32 poolId, bool zeroForOne) = IActiveQuote(EXECUTOR).activeQuote();
        if (digest == bytes32(0)) revert NotAnInvoiceDischarge();
        if (consumed[digest]) revert QuoteAlreadySettled(digest);
        if (PoolId.unwrap(key.toId()) != poolId) revert PoolDoesNotMatchQuote();
        if (params.zeroForOne != zeroForOne) revert DirectionDoesNotMatchQuote();
        // In v4 a positive `amountSpecified` is exact output. An invoice names the output, so the
        // swap that discharges it must name the output too.
        if (params.amountSpecified <= 0) revert ExactOutputRequired();
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev THE REFUSAL THIS HOOK EXISTS FOR. Reads the delivered output from the passed delta
    ///      and refuses anything short of the invoice.
    ///
    ///      Measured before this line was written: a pool asked for 1e18 served 2,995,354,955,910
    ///      and no layer objected, because `V4Router._swapExactOutputSingle` checks the input
    ///      ceiling and never compares delivered output with the request. So a merchant asking to
    ///      be paid an exact amount is, without this, paid whatever the pool happened to have.
    ///
    ///      The `delta` argument is the only authoritative evidence available here. A hook must
    ///      not ask the PoolManager for `currencyDelta` of the swap it is inside: both callbacks
    ///      run BEFORE the swapper's delta is booked — `afterSwap` at PoolManager.sol:221, the
    ///      swapper's accounting at :226 — so that read describes a state that has not happened.
    function _afterSwap(address, PoolKey calldata, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        // No re-check that an invoice is live: `_beforeSwap` already refused if one was not, both
        // callbacks read the same executor inside the same swap frame, and nothing between them can
        // call out to change it. A branch no test can reach is indistinguishable from a missing one
        // the day somebody deletes it, so it is not written.
        (bytes32 digest, uint256 requiredOut,,) = IActiveQuote(EXECUTOR).activeQuote();

        // The output side is the currency the swapper did NOT specify. The sign test is the
        // precondition of the cast below rather than a guard of its own: a negative int128 cast to
        // uint128 becomes an enormous number that would sail past the comparison.
        int128 delivered = params.zeroForOne ? delta.amount1() : delta.amount0();
        if (delivered < 0 || uint256(uint128(delivered)) < requiredOut) {
            revert InvoiceNotFilled(digest, requiredOut, delivered < 0 ? 0 : uint256(uint128(delivered)));
        }

        // One authority for consumption, marked only on the path that actually delivered. A later
        // failure reverts the transaction and takes this with it: that is the EVM's property, not
        // a promise this contract makes, and it is why the executor still checks delivery itself.
        consumed[digest] = true;
        return (IHooks.afterSwap.selector, 0);
    }

    /// @notice What the hook can prove, kept honest in one place.
    /// @dev The hook authenticates a SWAP; it never witnesses a PAYMENT. The merchant is paid by
    ///      a `take` after the swap frame has returned, so a `balanceOf(recipient)` read inside
    ///      `afterSwap` would return the pre-delivery balance and look like a check while proving
    ///      nothing. Delivery is the executor's obligation and is asserted there.
    function whatThisHookProves() external pure returns (string memory) {
        return "the swap discharged an admitted invoice in full; not that the merchant was paid";
    }
}
