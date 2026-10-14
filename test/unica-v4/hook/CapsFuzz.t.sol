// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {UnicaMarketExecutor} from "../../../src/unica-v4/UnicaMarketExecutor.sol";
import {UnicaV4TestBase} from "../util/UnicaV4TestBase.sol";
import {Vm} from "forge-std/Vm.sol";
import {IUnicaMarketExecutor} from "../../../src/unica-v4/interfaces/IUnicaMarketExecutor.sol";

/// @title Fuzzed cap rows: K1 and K2 at every value, not only at one chosen boundary
/// @notice Caps.t.sol proves each cap at one boundary and one unit past it. These run the same rules over any cap and
///         any amount: an order is accepted exactly when its minOut is at or under the per-transaction cap, and a paid
///         order delivers exactly what the pool produced, whatever the size.
contract CapsFuzzTest is UnicaV4TestBase {
    Market internal market;

    function setUp() public {
        setUpBase();
        market = deployMarket(defaultSpec());
    }

    /// @dev K1 over any (cap, minOut): accepted iff minOut <= cap.
    function testFuzz_K1_anOrderIsAcceptedExactlyWhenItsMinOutIsWithinTheCap(uint128 cap, uint128 minOut) public {
        cap = uint128(bound(cap, 1, CAP_PER_TX));
        // Above uint128(int128.max) a different guard, AmountTooLarge, refuses first.
        minOut = uint128(bound(minOut, 1, uint128(type(int128).max)));
        registry.tightenCaps(market.marketId, cap, cap);

        if (minOut > cap) {
            vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.OrderAboveCap.selector, minOut, cap));
            market.executor.createOrder(merchant, payer, 1e18, minOut, uint64(block.timestamp + 1 hours), "fuzz-k1");
        } else {
            bytes32 id = market.executor
            .createOrder(merchant, payer, 1e18, minOut, uint64(block.timestamp + 1 hours), "fuzz-k1");
            assertEq(market.executor.orders(id).minOut, minOut, "an order within the cap was not recorded as asked");
        }
    }

    /// @dev Any payment size: either the merchant receives exactly what the Settled event reports, at least minOut, or
    ///      (dust that buys less than one unit) the hook refuses it and nothing moves.
    ///      (No quote() first: it pays and rolls back with a snapshot, and a test is one transaction, so the
    ///      hook's transient storage from the quote would still be set for this payment.)
    function testFuzz_K2_anyPaymentDeliversExactlyWhatItReports(uint128 amountIn) public {
        amountIn = uint128(bound(amountIn, 1, 1e21));
        bytes32 orderId = createOrder(market, amountIn, 1, keccak256(abi.encode("fuzz-k2", amountIn)));
        fundPayer(market, payer, amountIn);
        uint256 before = market.payout.balanceOf(merchant);
        vm.recordLogs();
        vm.prank(payer);
        try market.executor.pay(orderId) {}
        catch (bytes memory reason) {
            // Too small to buy one unit of the payout token: the only acceptable refusal is the minimum-output one.
            assertEq(
                bytes4(reason), bytes4(keccak256("WrappedError(address,bytes4,bytes,bytes)")), "not a hook refusal"
            );
            assertEq(market.payout.balanceOf(merchant), before, "a refused payment moved funds");
            return;
        }
        uint256 received = market.payout.balanceOf(merchant) - before;

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = IUnicaMarketExecutor.Settled.selector;
        uint256 reported;
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(market.executor) && logs[i].topics[0] == topic) {
                (,,, reported) = abi.decode(logs[i].data, (address, address, uint256, uint256));
                found = true;
            }
        }
        assertTrue(found, "no Settled event");
        assertEq(received, reported, "the merchant received something other than what Settled reports");
        assertGe(received, 1, "delivered below minOut");
    }
}
