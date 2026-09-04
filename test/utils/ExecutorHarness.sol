// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SettlementExecutor, IUniversalRouter} from "../../src/SettlementExecutor.sol";

/// @title ExecutorHarness, the executor with its plan made arbitrary
/// @notice Test-only. Placed at the executor's derived address so the hook admits it. It marks an
///         order Paying and drives the official router with ANY plan, which the real executor never
///         does: this is how a test reaches the hook's own checks (malformed hook data, an order not
///         in flight, parameters or a pool that disagree with the order, a foreign settle leg before
///         the native one) with inputs the real executor would never compose.
contract ExecutorHarness is SettlementExecutor {
    function payWithPlan(bytes32 orderId, bytes calldata commands, bytes[] calldata inputs) external payable {
        Order storage order = _orders[orderId];
        order.payer = msg.sender;
        order.status = Status.Paying;
        IUniversalRouter(UNIVERSAL_ROUTER).execute{value: msg.value}(commands, inputs, block.timestamp + 1);
        order.status = Status.Settled;
    }

    /// @notice The plan the real executor composes for an order, so a test can alter one field of it.
    function planFor(bytes32 orderId) external view returns (bytes memory commands, bytes[] memory inputs) {
        return _plan(orderId, _orders[orderId]);
    }
}
