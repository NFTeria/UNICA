// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {UnicaMarketTypes} from "../UnicaMarketTypes.sol";

/// @notice The reads every other UNICA v4 contract makes against the registry (SC §6, §13). The
///         registry is the on-chain answer to "is this an official UNICA v4 market": consumers
///         resolve pools, hooks and executors only through it, never by token pair.
interface IUnicaMarketRegistry {
    // ---- identity -------------------------------------------------------------------------------
    function FACTORY() external view returns (address);
    function REQUIRE_ORACLE() external view returns (bool);
    function admin() external view returns (address);
    function pauser() external view returns (address);

    // ---- records --------------------------------------------------------------------------------
    function getMarket(bytes32 marketId) external view returns (UnicaMarketTypes.Market memory);
    function statusOf(bytes32 marketId) external view returns (uint8);
    function oraclePolicyOf(bytes32 marketId) external view returns (UnicaMarketTypes.OraclePolicy memory);
    function capsOf(bytes32 marketId) external view returns (UnicaMarketTypes.Caps memory);
    /// @notice What the executor needs on the hot path, in one read.
    function executionTermsOf(bytes32 marketId)
        external
        view
        returns (uint8 status, uint128 maxPerTxPayout, uint128 maxPerDayPayout);
    function marketCount() external view returns (uint256);
    function marketIdAt(uint256 index) external view returns (bytes32);
    function marketIdFor(address asset, address payout, uint32 version) external view returns (bytes32);
    function liveMarketOf(address asset, address payout) external view returns (bytes32);
    function latestVersion(address asset, address payout) external view returns (uint32);

    // ---- emitter and pool authentication (SC §3, C6, C7) -----------------------------------------
    function marketIdOfHook(address hook) external view returns (bytes32);
    function marketIdOfExecutor(address executor) external view returns (bytes32);
    function marketIdOfPool(bytes32 poolId) external view returns (bytes32);

    // ---- roles ----------------------------------------------------------------------------------
    function canCreateOrders(address account) external view returns (bool);
    function isOrderCreator(address account) external view returns (bool);

    // ---- factory-only writes (SC §6) -------------------------------------------------------------
    function register(
        bytes32 marketId,
        UnicaMarketTypes.Market calldata market,
        UnicaMarketTypes.OraclePolicy calldata policy,
        UnicaMarketTypes.Caps calldata caps
    ) external;
    function recordInitialized(bytes32 marketId) external;
    function recordSeeded(bytes32 marketId, uint128 depth) external;

    // ---- admin and pauser writes (SC §5, §6) -----------------------------------------------------
    function activate(bytes32 marketId) external;
    function pause(bytes32 marketId) external;
    function unpause(bytes32 marketId) external;
    function retire(bytes32 marketId) external;
    function tightenOraclePolicy(bytes32 marketId, uint48 maxAge, uint16 maxDeviationBps) external;
    function tightenCaps(bytes32 marketId, uint128 maxPerTx, uint128 maxPerDay) external;
    function setOrderCreator(address account, bool allowed) external;
    function setPauser(address account) external;
    function transferAdmin(address next) external;
    function acceptAdmin() external;
}
