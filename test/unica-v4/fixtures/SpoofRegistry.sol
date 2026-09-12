// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// LOCAL FIXTURE — AN ATTACKER'S REGISTRY — NOTHING IT SAYS IS TRUE
//
// This is not a UnicaMarketRegistry and it is not a weakened one. It is the shape of a registry with
// none of the checks: it answers every question the way an attacker would want it answered, for any
// id, at any time. It exists because the real registry cannot be turned into an adversary — its
// `register` recomputes `marketId` over its OWN address and refuses the official id — so an
// adversary who wants a hook that reports an official marketId must supply their own registry CODE.
// That is the real threat, and row S1 has to face it rather than a softer one.
//
// What the row then proves is the only thing that was ever load-bearing: a hook built from the real
// source, pointed at this, settles and emits a receipt carrying the official marketId — and the
// OFFICIAL registry's three reverse lookups return zero for every address involved, so emitter
// authentication (SC §3, C6) refuses the receipt. Tests only. Nothing under `src/`, `script/` or
// `deployments/` may reference it.

import {UnicaMarketTypes} from "../../../src/unica-v4/UnicaMarketTypes.sol";
import {IUnicaMarketRegistry} from "../../../src/unica-v4/interfaces/IUnicaMarketRegistry.sol";

contract SpoofRegistry is IUnicaMarketRegistry {
    address public immutable FACTORY_ADDRESS;

    mapping(bytes32 => bool) public spoofed;
    mapping(bytes32 => UnicaMarketTypes.Caps) private _caps;
    mapping(bytes32 => UnicaMarketTypes.OraclePolicy) private _policy;
    mapping(bytes32 => UnicaMarketTypes.Market) private _markets;

    error SpoofRegistryHasNoLifecycle();

    constructor(address lookalikeFactory) {
        FACTORY_ADDRESS = lookalikeFactory;
    }

    /// @notice Declares an id ACTIVE with whatever terms the attacker wants.
    function spoof(bytes32 marketId, UnicaMarketTypes.Caps memory caps, UnicaMarketTypes.OraclePolicy memory policy)
        external
    {
        spoofed[marketId] = true;
        _caps[marketId] = caps;
        _policy[marketId] = policy;
        _markets[marketId].status = UnicaMarketTypes.MarketStatus.ACTIVE;
    }

    /// @notice The record the lookalike's hook and executor will read back for that id.
    function setRecord(bytes32 marketId, UnicaMarketTypes.Market memory record) external {
        _markets[marketId] = record;
        _markets[marketId].status = UnicaMarketTypes.MarketStatus.ACTIVE;
    }

    // ---- the reads the hook and executor make ----------------------------------------------------

    function FACTORY() external view returns (address) {
        return FACTORY_ADDRESS;
    }

    function REQUIRE_ORACLE() external pure returns (bool) {
        return false;
    }

    function admin() external view returns (address) {
        return FACTORY_ADDRESS;
    }

    function pauser() external pure returns (address) {
        return address(0);
    }

    function getMarket(bytes32 marketId) external view returns (UnicaMarketTypes.Market memory) {
        return _markets[marketId];
    }

    function statusOf(bytes32 marketId) external view returns (uint8) {
        return spoofed[marketId] ? uint8(UnicaMarketTypes.MarketStatus.ACTIVE) : 0;
    }

    function oraclePolicyOf(bytes32 marketId) external view returns (UnicaMarketTypes.OraclePolicy memory) {
        return _policy[marketId];
    }

    function capsOf(bytes32 marketId) external view returns (UnicaMarketTypes.Caps memory) {
        return _caps[marketId];
    }

    function executionTermsOf(bytes32 marketId)
        external
        view
        returns (uint8 status, uint128 maxPerTxPayout, uint128 maxPerDayPayout)
    {
        UnicaMarketTypes.Caps memory c = _caps[marketId];
        return
            (spoofed[marketId] ? uint8(UnicaMarketTypes.MarketStatus.ACTIVE) : 0, c.maxPerTxPayout, c.maxPerDayPayout);
    }

    function marketCount() external pure returns (uint256) {
        return 0;
    }

    function marketIdAt(uint256) external pure returns (bytes32) {
        return bytes32(0);
    }

    function marketIdFor(address, address, uint32) external pure returns (bytes32) {
        return bytes32(0);
    }

    function liveMarketOf(address, address) external pure returns (bytes32) {
        return bytes32(0);
    }

    function latestVersion(address, address) external pure returns (uint32) {
        return 0;
    }

    /// @dev The lie that matters: this registry vouches for the lookalike's own addresses. The
    ///      OFFICIAL registry does not, which is the whole of row S1.
    function marketIdOfHook(address hook) external view returns (bytes32) {
        return _reverse(hook);
    }

    function marketIdOfExecutor(address executor) external view returns (bytes32) {
        return _reverse(executor);
    }

    function marketIdOfPool(bytes32 poolId) external view returns (bytes32) {
        bytes32 id = _lastSpoofed;
        return (id != bytes32(0) && _markets[id].poolId == poolId) ? id : bytes32(0);
    }

    function canCreateOrders(address) external pure returns (bool) {
        return true;
    }

    function isOrderCreator(address) external pure returns (bool) {
        return true;
    }

    // ---- every write is a dead end ------------------------------------------------------------------

    function register(
        bytes32,
        UnicaMarketTypes.Market calldata,
        UnicaMarketTypes.OraclePolicy calldata,
        UnicaMarketTypes.Caps calldata
    ) external pure {
        revert SpoofRegistryHasNoLifecycle();
    }

    function recordInitialized(bytes32) external pure {
        revert SpoofRegistryHasNoLifecycle();
    }

    function recordSeeded(bytes32, uint128) external pure {
        revert SpoofRegistryHasNoLifecycle();
    }

    function activate(bytes32) external pure {
        revert SpoofRegistryHasNoLifecycle();
    }

    function pause(bytes32) external pure {
        revert SpoofRegistryHasNoLifecycle();
    }

    function unpause(bytes32) external pure {
        revert SpoofRegistryHasNoLifecycle();
    }

    function retire(bytes32) external pure {
        revert SpoofRegistryHasNoLifecycle();
    }

    function tightenOraclePolicy(bytes32, uint48, uint16) external pure {
        revert SpoofRegistryHasNoLifecycle();
    }

    function tightenCaps(bytes32, uint128, uint128) external pure {
        revert SpoofRegistryHasNoLifecycle();
    }

    function setOrderCreator(address, bool) external pure {
        revert SpoofRegistryHasNoLifecycle();
    }

    function setPauser(address) external pure {
        revert SpoofRegistryHasNoLifecycle();
    }

    function transferAdmin(address) external pure {
        revert SpoofRegistryHasNoLifecycle();
    }

    function acceptAdmin() external pure {
        revert SpoofRegistryHasNoLifecycle();
    }

    // ---- internals ------------------------------------------------------------------------------------

    bytes32 private _lastSpoofed;

    function _reverse(address who) private view returns (bytes32) {
        bytes32 id = _lastSpoofed;
        if (id == bytes32(0)) return bytes32(0);
        UnicaMarketTypes.Market storage m = _markets[id];
        return (who == m.hook || who == m.executor) ? id : bytes32(0);
    }

    /// @notice Records which id the reverse lookups should vouch for. Called by `spoof`'s caller
    ///         when it also wants the reverse maps to answer.
    function vouchFor(bytes32 marketId) external {
        _lastSpoofed = marketId;
    }
}
