// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {UnicaStockSettlementTypes} from "../UnicaStockSettlementTypes.sol";

/// @notice The one thing the hook reads from the executor. Kept to a single view function so the
///         hook depends on an interface rather than on the executor's whole implementation, and so
///         the direction of trust is visible: the hook reads authenticated storage, never
///         caller-supplied data.
interface IUnicaStockOrders {
    function orders(bytes32 orderId) external view returns (UnicaStockSettlementTypes.Order memory);
}
