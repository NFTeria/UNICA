// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IQuoteSettlement} from "../../src/v2/interfaces/IQuoteSettlement.sol";
import {V2Fixture} from "./util/V2Fixture.sol";

/// @title GATE 1 — the fill judgement, which is the reason this is a hook and not a library
/// @notice Gate 0 measured the defect this file's central row exists to refuse: a v4 pool served
///         2,995,354,955,910 against a request for 1e18 and nothing objected, because under exact
///         output `V4Router._swapExactOutputSingle` checks the INPUT ceiling and never compares
///         delivered output with the request. See `test/v2/ShortFill.t.sol` for that measurement.
///         Exact-output full-fill enforcement therefore lives in a hook or it lives nowhere.
///
///         The central row was written first and SEEN RED against scaffolding that judged nothing —
///         "invoice requested 1000000000000000000, pool delivered 2995354955910, swap reverted NO" —
///         before the refusal existed.
contract InvoiceFillTest is V2Fixture {
    /// @dev Fillable against the fixture's liquidity.
    uint256 internal constant FILLABLE = 1e11;
    /// @dev Far past what the fixture's range can serve: the amount Gate 0 measured the short fill on.
    uint256 internal constant UNFILLABLE = 1e18;

    bytes32 internal constant DIGEST = keccak256("an invoice");

    function setUp() public {
        _setUpFixture();
    }

    /// @dev THE CONTROL. If this row is red the harness is wrong and nothing below can be believed.
    function test_Fill_Control_AnInvoiceWithinLiquidityIsFilledExactly() public {
        executor.set(DIGEST, FILLABLE, _id(key), true);
        executor.swapExactOut(key, true, FILLABLE);

        assertFalse(executor.lastReverted(), "the control invoice was refused; the harness is wrong");
        assertEq(executor.lastDelivered(), FILLABLE, "the control invoice was not filled exactly");
        assertTrue(hook.consumed(DIGEST), "a discharged invoice was not marked consumed");
    }

    /// @dev THE ROW THE HOOK EXISTS FOR.
    function test_Fill_AShortFilledInvoiceIsRefused() public {
        executor.set(DIGEST, UNFILLABLE, _id(key), true);
        executor.swapExactOut(key, true, UNFILLABLE);

        emit log_named_uint("invoice requested", UNFILLABLE);
        emit log_named_uint("pool delivered   ", executor.lastDelivered());
        emit log_named_string("swap reverted    ", executor.lastReverted() ? "YES" : "NO");

        assertTrue(executor.lastReverted(), "the pool short-filled the invoice and the hook admitted it");
        assertHookRefusal(
            executor.lastRevertData(),
            HOOK_ADDR,
            IHooks.afterSwap.selector,
            IQuoteSettlement.InvoiceNotFilled.selector,
            "a request the pool could not serve"
        );
        assertEq(executor.lastDelivered(), 0, "a refused settlement must deliver nothing");
        assertFalse(hook.consumed(DIGEST), "a refused settlement must not consume the invoice");
    }

    /// @dev THE HONEST BOUNDARY OF WHAT THE HOOK PROVES. The fill check is a FLOOR. A swap that
    ///      delivers MORE than the invoice requires is admitted here, and it must be, because the
    ///      hook is not the party that pays the merchant: the delivery of exactly `amountOut` to
    ///      exactly the recipient happens in a `take` after this frame has returned, and is the
    ///      executor's obligation. This row is written so no document can later claim the hook
    ///      enforces the exact amount — the suite would contradict it.
    function test_Fill_TheHookIsAFloorNotAnEquality() public {
        executor.set(DIGEST, FILLABLE, _id(key), true);
        executor.swapExactOut(key, true, FILLABLE * 2);

        assertFalse(executor.lastReverted(), "the hook refused a swap that over-delivered the invoice");
        assertEq(executor.lastDelivered(), FILLABLE * 2, "the pool did not serve the larger request");
        emit log_string("hook: authenticates the invoice swap and enforces the floor");
        emit log_string("executor: delivers exactly amountOut to the recipient, and verifies it");
    }

    /// @dev An invoice names its output, so the swap that discharges it must name its output too.
    ///      Under exact input the POOL chooses how much comes out; such a swap can clear the floor
    ///      by luck, and a payment venue whose admission turns on luck is not one.
    function test_Fill_AnExactInputSwapIsRefused() public {
        executor.set(DIGEST, 1, _id(key), true);
        executor.swapExactIn(key, true, 1e12);

        assertTrue(executor.lastReverted(), "an exact-input swap was admitted to an invoice pool");
        assertHookRefusal(
            executor.lastRevertData(),
            HOOK_ADDR,
            IHooks.beforeSwap.selector,
            IQuoteSettlement.ExactOutputRequired.selector,
            "negative amountSpecified is exact input"
        );
    }

    /// @dev Ten thousand runs of the same claim across the fillable range. Fuzzing a v4 swap on
    ///      this stack is close to free, which is why the count is high and why this is a range
    ///      rather than the three amounts somebody happened to pick.
    function testFuzz_Fill_EveryFillableInvoiceIsServedExactly(uint96 raw) public {
        uint256 amountOut = uint256(raw) % (2e11) + 1;
        bytes32 digest = keccak256(abi.encode("fuzz", amountOut));

        executor.set(digest, amountOut, _id(key), true);
        executor.swapExactOut(key, true, amountOut);

        assertFalse(executor.lastReverted(), "a fillable invoice was refused");
        assertEq(executor.lastDelivered(), amountOut, "a fillable invoice was not served exactly");
        assertTrue(hook.consumed(digest), "a discharged invoice was not marked consumed");
    }
}
