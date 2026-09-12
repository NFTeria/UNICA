// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// LOCAL ENSv2-COMPATIBLE FIXTURE for Anvil integration tests. Not the isolated ENSv2 Sepolia
// deployment; mirrors its measured Enhanced Access Control shape (per-key text resources, role
// bitmaps, admin bits at +128) so the order-admission path can be tested end to end without a
// network. Pinned Sepolia configuration lives in integrations/ensv2/profile.mjs.

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnicaMarketExecutor} from "../../../src/unica-v4/interfaces/IUnicaMarketExecutor.sol";
import {UnicaMarketTypes} from "../../../src/unica-v4/UnicaMarketTypes.sol";

/// @title ExecutorDouble
/// @notice A test double for `IUnicaMarketExecutor`: records every `createOrder` call and computes
///         the same `orderId` the real interface's own documentation specifies
///         (`keccak256(abi.encode(block.chainid, address(this), msg.sender, salt))`), so a test can
///         assert `TerminalAdmission`'s returned id independently. `pay` marks the order Settled.
///         Nothing here enforces the real executor's own creator-allowlist or market-lifecycle
///         rules; this double exists only to observe what `TerminalAdmission` sends it.
contract ExecutorDouble is IUnicaMarketExecutor {
    address public immutable HOOK;
    address public immutable REGISTRY;
    bytes32 public immutable MARKET_ID;
    address public immutable ASSET_TOKEN;
    address public immutable PAYOUT_TOKEN;

    mapping(bytes32 => UnicaMarketTypes.Order) private _orders;
    uint256 public orderCount;

    /// @notice Every `createOrder` call this double has ever received, in order, for tests that
    ///         want to assert on the call itself rather than only on the stored order.
    struct RecordedCall {
        address recipient;
        address payer;
        uint128 amountIn;
        uint128 minOut;
        uint64 deadline;
        bytes32 salt;
        address caller;
    }

    RecordedCall[] public calls;

    error WrongPayer();

    constructor(address hook, address registry, bytes32 marketId, address assetToken, address payoutToken) {
        HOOK = hook;
        REGISTRY = registry;
        MARKET_ID = marketId;
        ASSET_TOKEN = assetToken;
        PAYOUT_TOKEN = payoutToken;
    }

    function createOrder(
        address recipient,
        address payer,
        uint128 amountIn,
        uint128 minOut,
        uint64 deadline,
        bytes32 salt
    ) external returns (bytes32 orderId) {
        orderId = keccak256(abi.encode(block.chainid, address(this), msg.sender, salt));

        _orders[orderId] = UnicaMarketTypes.Order({
            recipient: recipient,
            creator: msg.sender,
            payer: payer,
            amountIn: amountIn,
            minOut: minOut,
            deadline: deadline,
            status: UnicaMarketTypes.OrderStatus.Open
        });
        orderCount += 1;
        calls.push(
            RecordedCall({
                recipient: recipient,
                payer: payer,
                amountIn: amountIn,
                minOut: minOut,
                deadline: deadline,
                salt: salt,
                caller: msg.sender
            })
        );

        emit OrderCreated(orderId, recipient, msg.sender, payer, amountIn, minOut, deadline);
    }

    function pay(bytes32 orderId) external {
        UnicaMarketTypes.Order storage order = _orders[orderId];
        if (msg.sender != order.payer) revert WrongPayer();
        order.status = UnicaMarketTypes.OrderStatus.Settled;
        emit Settled(orderId, order.payer, order.recipient, ASSET_TOKEN, PAYOUT_TOKEN, order.amountIn, order.amountIn);
    }

    function orders(bytes32 orderId) external view returns (UnicaMarketTypes.Order memory) {
        return _orders[orderId];
    }

    function callCount() external view returns (uint256) {
        return calls.length;
    }

    function poolKey() external pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(0)),
            fee: 0,
            tickSpacing: 0,
            hooks: IHooks(address(0))
        });
    }

    function payoutUsedOnDay(uint256) external pure returns (uint256) {
        return 0;
    }

    function remainingToday() external pure returns (uint256 perDayLeft, uint128 perTx) {
        return (type(uint256).max, type(uint128).max);
    }
}
