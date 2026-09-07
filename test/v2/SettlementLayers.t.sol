// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IQuoteSettlement} from "../../src/v2/interfaces/IQuoteSettlement.sol";
import {QuoteSettlementExecutor} from "../../src/v2/QuoteSettlementExecutor.sol";
import {SettlementFixture, FloorlessInvoiceHook} from "./util/SettlementFixture.sol";

/// @title GATE 3 — the layers, tested one at a time
/// @notice UNICA says the hook and the executor are two judges, not one judge consulted twice. A
///         layered defence whose layers are only ever tested together is a single layer with two
///         names, and the V2 mutation ledger proved that literally: deleting the executor's
///         exact-output equality turned NO row red, because the hook's floor had already refused
///         every case the suite could produce.
///
///         So this file removes the first layer on purpose. The pool below carries a hook that
///         admits everything and judges nothing — no floor, no pool match, no direction, no
///         consumption — while still reporting the real executor, so the executor will swap through
///         it. What the executor refuses here, it refuses on its own.
contract SettlementLayersTest is SettlementFixture {
    uint256 internal constant MAX_IN = 100 ether;

    FloorlessInvoiceHook internal floorless;
    PoolKey internal floorlessKey;

    function setUp() public {
        _setUpSettlement();

        address addr = address(uint160(DECLARED_MASK) ^ (0x5555 << 144));
        deployCodeTo("SettlementFixture.sol:FloorlessInvoiceHook", abi.encode(address(executor)), addr);
        floorless = FloorlessInvoiceHook(addr);

        floorlessKey = PoolKey({
            currency0: Currency.wrap(address(tokenIn)),
            currency1: Currency.wrap(address(tokenOut)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(addr)
        });
        manager.initialize(floorlessKey, TickMath.getSqrtPriceAtTick(0));
        lp.add(floorlessKey, 1e15, -600, 600);
    }

    /// @dev THE CONTROL. The floorless pool works for an ordinary invoice, so the row below is
    ///      about the amount and not about the pool being broken.
    function test_Layers_Control_TheFloorlessPoolSettlesAnOrdinaryInvoice() public {
        IQuoteSettlement.Quote memory q = _floorlessQuote(bytes32("ok"), 1e9);
        vm.prank(relayer);
        (, uint256 delivered) = executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 0));
        assertEq(delivered, 1e9, "the control settlement did not deliver the invoice");
        assertEq(tokenOut.balanceOf(recipient), 1e9, "the control merchant was not paid");
    }

    /// @dev THE ROW THAT MAKES THE EXECUTOR'S EQUALITY A GUARD RATHER THAN A PASSENGER. Nothing in
    ///      this pool judges the fill. The pool short-fills exactly as Gate 0 measured, the hook
    ///      shrugs, and the executor refuses — naming the amount it required and the amount it got.
    function test_Layers_TheExecutorRefusesAShortFillWithNoHookToHelp() public {
        uint256 asked = 1e18;
        IQuoteSettlement.Quote memory q = _floorlessQuote(bytes32("short"), asked);

        vm.prank(relayer);
        try executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 1)) returns (uint256, uint256) {
            fail();
            emit log_string("a short fill settled through a hook that judges nothing");
        } catch (bytes memory err) {
            assertEq(
                bytes4(err),
                IQuoteSettlement.DeliveryIsNotTheInvoice.selector,
                "refused, but not by the executor's own exact-output equality"
            );
            (, uint256 required, uint256 delivered) = abi.decode(_body(err), (bytes32, uint256, uint256));
            assertEq(required, asked, "the executor named the wrong required amount");
            assertLt(delivered, asked, "this row needs an actual short fill to prove anything");
            emit log_named_uint("invoice required", required);
            emit log_named_uint("pool delivered  ", delivered);
        }
        assertEq(tokenOut.balanceOf(recipient), 0, "a refused settlement paid the merchant");
    }

    function _floorlessQuote(bytes32 id, uint256 amountOut) internal view returns (IQuoteSettlement.Quote memory q) {
        q = _quote(id, amountOut, MAX_IN);
        q.pool = floorlessKey;
        q.hook = address(floorless);
    }

    function _auth(IQuoteSettlement.Quote memory q, uint256 nonce)
        internal
        view
        returns (QuoteSettlementExecutor.PayerAuthorization memory)
    {
        return _authorize(q, nonce, block.timestamp + 1 hours, payerKey);
    }

    function _body(bytes memory err) internal pure returns (bytes memory out) {
        out = new bytes(err.length - 4);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = err[i + 4];
        }
    }
}
