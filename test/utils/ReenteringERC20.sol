// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

/// @notice The one function the token re-enters.
interface IPayable {
    function pay(bytes32 orderId) external payable;
}

/// @title ReenteringERC20, a payout token that pays an order from inside the transfer that pays the recipient
/// @notice Test-only. Models threat T6 at the one place a settlement hands control to foreign code:
///         the `take` that transfers output to the recipient, which for an ERC-777-style token calls
///         out. Placed at the payout address, it re-enters the executor once with a chosen order and
///         a chosen value while the PoolManager is still unlocked, records how that attempt ended
///         without letting it decide the outer transfer, and then completes the transfer. The outer
///         settlement's fate and the inner one's are therefore observed separately.
contract ReenteringERC20 is MockERC20 {
    address public immutable POOL_MANAGER;
    IPayable public target;
    bytes32 public orderToPay;
    uint256 public valueToPay;
    uint256 public reentries;
    bool public innerSucceeded;
    bytes public innerRevert;

    constructor(address poolManager) MockERC20("Reentering", "RNT", 18) {
        POOL_MANAGER = poolManager;
    }

    /// @notice Arms one reentry: the next transfer out of the PoolManager pays `orderId` with `value`.
    function arm(IPayable target_, bytes32 orderId, uint256 value) external {
        target = target_;
        orderToPay = orderId;
        valueToPay = value;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (msg.sender == POOL_MANAGER && orderToPay != bytes32(0)) {
            bytes32 id = orderToPay;
            orderToPay = bytes32(0);
            ++reentries;
            try target.pay{value: valueToPay}(id) {
                innerSucceeded = true;
            } catch (bytes memory reason) {
                innerRevert = reason;
            }
        }
        return super.transfer(to, amount);
    }

    receive() external payable {}
}
