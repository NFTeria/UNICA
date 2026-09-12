// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {UnicaMarketTypes} from "./UnicaMarketTypes.sol";
import {IUnicaMarketRegistry} from "./interfaces/IUnicaMarketRegistry.sol";
import {IUnicaOracleRoute} from "./interfaces/IUnicaPriceOracle.sol";

/// @title UnicaMarketRegistry, the discovery root and the on-chain answer to "is this official"
/// @notice Written from `docs/unica-v4/SPEC-CONTRACTS.md` §5, §6 and §13, with the event shapes from
///         `docs/unica-v4/EVENT-SCHEMA.md` §4. It holds no tokens and calls no token code. Every
///         identity field of a market is written exactly once, by the factory, inside
///         `createMarket`; nothing here can ever re-point a market at another hook, pool or route.
///
///         WHY THE ROUTE IS RE-DERIVED HERE AND NOT TRUSTED. `register` recomputes `marketId` from
///         the policy it is handed and refuses a mismatch, and then asks the adapter itself what
///         feed it serves for the pair. The id therefore commits to the route, the hook's CREATE2
///         arguments carry the id, and the hook's address commits to both (SC §3, ruling S8). A
///         caller who wants a different oracle cannot get one without a different address.
contract UnicaMarketRegistry is IUnicaMarketRegistry {
    using UnicaMarketTypes for UnicaMarketTypes.Market;

    // ---- immutables ------------------------------------------------------------------------------

    /// @notice The one address allowed to register, initialise and seed. Set from `msg.sender`, so
    ///         it is the factory whose constructor created this registry and nothing else.
    address public immutable FACTORY;
    /// @notice True for every mainnet deployment; false only for the 46630 rehearsal (SC §6).
    bool public immutable REQUIRE_ORACLE;

    // ---- product-safety bounds (SC §6, ruling S4) ------------------------------------------------

    /// @notice The on-chain ceiling on any market's `maxAge`, in seconds. A market may be stricter.
    uint48 public constant MAX_ORACLE_AGE = 300;
    /// @notice The on-chain ceiling on any market's oracle band, in basis points.
    uint16 public constant MAX_DEVIATION_BPS = 300;
    /// @notice The largest page `getMarkets` will ever return (SC §13).
    uint256 internal constant PAGE_LIMIT = 100;

    // ---- roles -----------------------------------------------------------------------------------

    address public admin;
    address public pendingAdmin;
    address public pauser;
    mapping(address => bool) public isOrderCreator;

    // ---- records ---------------------------------------------------------------------------------

    mapping(bytes32 => UnicaMarketTypes.Market) private _markets;
    mapping(bytes32 => UnicaMarketTypes.OraclePolicy) private _policy;
    mapping(bytes32 => UnicaMarketTypes.Caps) private _caps;
    bytes32[] private _ids;

    mapping(address => mapping(address => uint32)) public latestVersion;
    mapping(address => mapping(address => bytes32)) public liveMarketOf;
    mapping(address => mapping(address => mapping(uint32 => bytes32))) private _marketIdFor;

    mapping(address => bytes32) public marketIdOfHook;
    mapping(address => bytes32) public marketIdOfExecutor;
    mapping(bytes32 => bytes32) public marketIdOfPool;

    // ---- events (EVENT-SCHEMA §4; topics pinned by row R10) --------------------------------------

    event MarketProposed(
        bytes32 indexed marketId,
        address indexed asset,
        address indexed payout,
        uint32 version,
        address hook,
        address executor,
        bytes32 poolId,
        uint24 fee,
        int24 tickSpacing,
        uint256 rateE18,
        uint160 initSqrtPriceX96,
        int24 initTick,
        bool demonstrationOnly
    );
    event MarketStatusChanged(bytes32 indexed marketId, uint8 indexed from, uint8 indexed to);
    event MarketSeeded(bytes32 indexed marketId, uint128 depthAtOpeningTick);
    event OraclePolicySet(
        bytes32 indexed marketId, address adapter, bytes32 feedId, uint48 maxAge, uint16 maxDeviationBps, bool enabled
    );
    event CapsSet(bytes32 indexed marketId, uint128 maxPerTx, uint128 maxPerDay, uint128 maxSeed);
    event OrderCreatorSet(address indexed creator, bool allowed);
    event PauserSet(address indexed previousPauser, address indexed newPauser);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    // ---- errors (SC §6) --------------------------------------------------------------------------

    error NotFactory(address caller);
    error NotAdmin(address caller);
    error NotPauser(address caller);
    error NotPendingAdmin(address caller);
    error ZeroAddress();
    error MarketExists(bytes32 marketId);
    error LiveMarketExists(bytes32 live);
    error WrongVersion(uint32 expected, uint32 got);
    error UnknownMarket(bytes32 marketId);
    error WrongMarketStatus(bytes32 marketId, uint8 actual);
    error OraclePolicyRequired(bytes32 marketId);
    error OraclePolicyMalformed(bytes32 marketId);
    error OracleAdapterNoCode(bytes32 marketId, address adapter);
    error OracleFeedMismatch(bytes32 marketId, bytes32 expected, bytes32 actual);
    error OracleMaxAgeOutOfRange(bytes32 marketId, uint48 maxAge);
    error OracleDeviationOutOfRange(bytes32 marketId, uint16 maxDeviationBps);
    error OraclePolicyDisabled(bytes32 marketId);
    error OraclePolicyNotTighter(bytes32 marketId);
    error CapsNotTighter(bytes32 marketId);
    error CapsInvalid(bytes32 marketId);
    /// @notice The recomputed id did not equal the one the factory passed (S8). SC §6 requires the
    ///         equality but names no error for it; a distinct selector is what lets row R7 prove the
    ///         refusal is this check and not one of the several others `register` runs.
    error MarketIdMismatch(bytes32 expected, bytes32 got);
    /// @notice A hook, executor or pool id already belongs to another market. SC §6 requires the
    ///         reverse maps to be write-once (row R9) and names no error for the second write.
    error ReverseMapTaken(bytes32 existing);

    // ---- construction ----------------------------------------------------------------------------

    /// @dev Runs inside the factory's constructor, so `FACTORY` is that factory and the registry
    ///      lands at `CREATE(factory, 1)` (SC §12).
    constructor(address admin_, bool requireOracle_) {
        if (admin_ == address(0)) revert ZeroAddress();
        FACTORY = msg.sender;
        REQUIRE_ORACLE = requireOracle_;
        admin = admin_;
        emit AdminTransferred(address(0), admin_);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin(msg.sender);
        _;
    }

    // ---- factory-only writes ---------------------------------------------------------------------

    /// @inheritdoc IUnicaMarketRegistry
    function register(
        bytes32 marketId,
        UnicaMarketTypes.Market calldata market,
        UnicaMarketTypes.OraclePolicy calldata policy,
        UnicaMarketTypes.Caps calldata caps
    ) external {
        if (msg.sender != FACTORY) revert NotFactory(msg.sender);
        if (_markets[marketId].status != UnicaMarketTypes.MarketStatus.None) revert MarketExists(marketId);
        if (market.hook == address(0) || market.executor == address(0)) revert ZeroAddress();

        bytes32 expected = keccak256(
            abi.encode(
                block.chainid, address(this), market.asset, market.payout, market.version, policy.adapter, policy.feedId
            )
        );
        if (expected != marketId) revert MarketIdMismatch(expected, marketId);

        bytes32 live = liveMarketOf[market.asset][market.payout];
        if (live != bytes32(0)) revert LiveMarketExists(live);

        uint32 wanted = latestVersion[market.asset][market.payout] + 1;
        if (market.version != wanted) revert WrongVersion(wanted, market.version);

        bool demonstrationOnly = _checkPolicy(marketId, market.asset, market.payout, policy);

        if (
            caps.maxPerTxPayout == 0 || caps.maxPerDayPayout == 0 || caps.maxSeedPayout == 0
                || caps.maxPerTxPayout > caps.maxPerDayPayout
        ) revert CapsInvalid(marketId);

        _claimReverse(marketId, market.hook, market.executor, market.poolId);

        // Field by field, and deliberately NOT `_markets[id] = market`: the whole-struct copy
        // measured 1,531 bytes larger with the optimizer off, and it would also carry whatever the
        // factory left in `status`, `seedDepth` and the timestamps. Those five fields are the
        // registry's to decide, never the caller's, so they are the only ones not copied.
        UnicaMarketTypes.Market storage m = _markets[marketId];
        m.asset = market.asset;
        m.payout = market.payout;
        m.version = market.version;
        m.hook = market.hook;
        m.executor = market.executor;
        m.poolId = market.poolId;
        m.rateE18 = market.rateE18;
        m.initSqrtPriceX96 = market.initSqrtPriceX96;
        m.initTick = market.initTick;
        m.fee = market.fee;
        m.tickSpacing = market.tickSpacing;
        m.assetDecimals = market.assetDecimals;
        m.payoutDecimals = market.payoutDecimals;
        m.assetIsCurrency0 = market.assetIsCurrency0;
        m.demonstrationOnly = demonstrationOnly;
        m.proposedAt = uint64(block.timestamp);
        m.status = UnicaMarketTypes.MarketStatus.PROPOSED;
        m.updatedAt = uint64(block.timestamp);

        _policy[marketId] = policy;
        _caps[marketId] = caps;
        _ids.push(marketId);
        latestVersion[market.asset][market.payout] = market.version;
        liveMarketOf[market.asset][market.payout] = marketId;
        _marketIdFor[market.asset][market.payout][market.version] = marketId;

        _emitProposed(marketId, market, demonstrationOnly);
        emit OraclePolicySet(
            marketId, policy.adapter, policy.feedId, policy.maxAge, policy.maxDeviationBps, policy.enabled
        );
        emit CapsSet(marketId, caps.maxPerTxPayout, caps.maxPerDayPayout, caps.maxSeedPayout);
        emit MarketStatusChanged(
            marketId, uint8(UnicaMarketTypes.MarketStatus.None), uint8(UnicaMarketTypes.MarketStatus.PROPOSED)
        );
    }

    /// @inheritdoc IUnicaMarketRegistry
    function recordInitialized(bytes32 marketId) external {
        if (msg.sender != FACTORY) revert NotFactory(msg.sender);
        _move(marketId, UnicaMarketTypes.MarketStatus.PROPOSED, UnicaMarketTypes.MarketStatus.INITIALIZED);
    }

    /// @inheritdoc IUnicaMarketRegistry
    function recordSeeded(bytes32 marketId, uint128 depth) external {
        if (msg.sender != FACTORY) revert NotFactory(msg.sender);
        _move(marketId, UnicaMarketTypes.MarketStatus.INITIALIZED, UnicaMarketTypes.MarketStatus.SEEDED);
        _markets[marketId].seedDepth = depth;
        emit MarketSeeded(marketId, depth);
    }

    // ---- lifecycle -------------------------------------------------------------------------------

    /// @inheritdoc IUnicaMarketRegistry
    function activate(bytes32 marketId) external onlyAdmin {
        _move(marketId, UnicaMarketTypes.MarketStatus.SEEDED, UnicaMarketTypes.MarketStatus.ACTIVE);
    }

    /// @inheritdoc IUnicaMarketRegistry
    /// @dev ADMIN as well as PAUSER (ruling S2). A second pause reverts, so a watcher that acted on
    ///      ACTIVE knows its pause is the one that landed.
    function pause(bytes32 marketId) external {
        if (msg.sender != admin && msg.sender != pauser) revert NotPauser(msg.sender);
        _move(marketId, UnicaMarketTypes.MarketStatus.ACTIVE, UnicaMarketTypes.MarketStatus.PAUSED);
    }

    /// @inheritdoc IUnicaMarketRegistry
    function unpause(bytes32 marketId) external onlyAdmin {
        _move(marketId, UnicaMarketTypes.MarketStatus.PAUSED, UnicaMarketTypes.MarketStatus.ACTIVE);
    }

    /// @inheritdoc IUnicaMarketRegistry
    /// @dev The one many-to-one edge: anything but None and RETIRED may retire. Terminal (Q112).
    function retire(bytes32 marketId) external onlyAdmin {
        UnicaMarketTypes.Market storage m = _markets[marketId];
        UnicaMarketTypes.MarketStatus current = m.status;
        if (current == UnicaMarketTypes.MarketStatus.None) revert UnknownMarket(marketId);
        if (current == UnicaMarketTypes.MarketStatus.RETIRED) revert WrongMarketStatus(marketId, uint8(current));
        m.status = UnicaMarketTypes.MarketStatus.RETIRED;
        m.updatedAt = uint64(block.timestamp);
        delete liveMarketOf[m.asset][m.payout];
        emit MarketStatusChanged(marketId, uint8(current), uint8(UnicaMarketTypes.MarketStatus.RETIRED));
    }

    // ---- tighten-only policy and caps -------------------------------------------------------------

    /// @inheritdoc IUnicaMarketRegistry
    function tightenOraclePolicy(bytes32 marketId, uint48 maxAge, uint16 maxDeviationBps) external onlyAdmin {
        _requireLive(marketId);
        UnicaMarketTypes.OraclePolicy storage p = _policy[marketId];
        if (!p.enabled) revert OraclePolicyDisabled(marketId);
        if (maxAge == 0 || maxAge > p.maxAge) revert OraclePolicyNotTighter(marketId);
        if (maxDeviationBps == 0 || maxDeviationBps > p.maxDeviationBps) revert OraclePolicyNotTighter(marketId);
        if (maxAge == p.maxAge && maxDeviationBps == p.maxDeviationBps) revert OraclePolicyNotTighter(marketId);
        p.maxAge = maxAge;
        p.maxDeviationBps = maxDeviationBps;
        emit OraclePolicySet(marketId, p.adapter, p.feedId, maxAge, maxDeviationBps, true);
    }

    /// @inheritdoc IUnicaMarketRegistry
    function tightenCaps(bytes32 marketId, uint128 maxPerTx, uint128 maxPerDay) external onlyAdmin {
        _requireLive(marketId);
        UnicaMarketTypes.Caps storage c = _caps[marketId];
        if (maxPerTx == 0 || maxPerDay == 0 || maxPerTx > maxPerDay) revert CapsInvalid(marketId);
        if (maxPerTx > c.maxPerTxPayout || maxPerDay > c.maxPerDayPayout) revert CapsNotTighter(marketId);
        if (maxPerTx == c.maxPerTxPayout && maxPerDay == c.maxPerDayPayout) revert CapsNotTighter(marketId);
        c.maxPerTxPayout = maxPerTx;
        c.maxPerDayPayout = maxPerDay;
        emit CapsSet(marketId, maxPerTx, maxPerDay, c.maxSeedPayout);
    }

    // ---- roles -------------------------------------------------------------------------------------

    /// @inheritdoc IUnicaMarketRegistry
    function setOrderCreator(address account, bool allowed) external onlyAdmin {
        if (account == address(0)) revert ZeroAddress();
        isOrderCreator[account] = allowed;
        emit OrderCreatorSet(account, allowed);
    }

    /// @inheritdoc IUnicaMarketRegistry
    function setPauser(address account) external onlyAdmin {
        emit PauserSet(pauser, account);
        pauser = account;
    }

    /// @inheritdoc IUnicaMarketRegistry
    function transferAdmin(address next) external onlyAdmin {
        if (next == address(0)) revert ZeroAddress();
        pendingAdmin = next;
        emit AdminTransferStarted(msg.sender, next);
    }

    /// @inheritdoc IUnicaMarketRegistry
    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NotPendingAdmin(msg.sender);
        address previous = admin;
        admin = msg.sender;
        pendingAdmin = address(0);
        emit AdminTransferred(previous, msg.sender);
    }

    // ---- views (SC §13) ----------------------------------------------------------------------------

    /// @inheritdoc IUnicaMarketRegistry
    function getMarket(bytes32 marketId) external view returns (UnicaMarketTypes.Market memory) {
        return _markets[marketId];
    }

    /// @inheritdoc IUnicaMarketRegistry
    function statusOf(bytes32 marketId) external view returns (uint8) {
        return uint8(_markets[marketId].status);
    }

    /// @inheritdoc IUnicaMarketRegistry
    function oraclePolicyOf(bytes32 marketId) external view returns (UnicaMarketTypes.OraclePolicy memory) {
        return _policy[marketId];
    }

    /// @inheritdoc IUnicaMarketRegistry
    function capsOf(bytes32 marketId) external view returns (UnicaMarketTypes.Caps memory) {
        return _caps[marketId];
    }

    /// @inheritdoc IUnicaMarketRegistry
    function executionTermsOf(bytes32 marketId)
        external
        view
        returns (uint8 status, uint128 maxPerTxPayout, uint128 maxPerDayPayout)
    {
        UnicaMarketTypes.Caps storage c = _caps[marketId];
        return (uint8(_markets[marketId].status), c.maxPerTxPayout, c.maxPerDayPayout);
    }

    /// @inheritdoc IUnicaMarketRegistry
    function marketCount() external view returns (uint256) {
        return _ids.length;
    }

    /// @inheritdoc IUnicaMarketRegistry
    function marketIdAt(uint256 index) external view returns (bytes32) {
        return _ids[index];
    }

    /// @inheritdoc IUnicaMarketRegistry
    function marketIdFor(address asset, address payout, uint32 version) external view returns (bytes32) {
        return _marketIdFor[asset][payout][version];
    }

    /// @notice Registration order, retired markets included; `limit` capped at `PAGE_LIMIT` and
    ///         clamped to the list; an offset at or past the end returns an empty array (SC §13).
    /// @dev IDS ONLY, not the sixteen-field records SC §13 describes. This is the first of the cuts
    ///      SC §12 names for a registry over the 90 % warning, applied because the measured runtime
    ///      with records was 23,955 bytes against a 22,118 warning line, and it is the cut that
    ///      touches no check: a caller pages ids here and reads each with `getMarket`. Nothing that
    ///      validates a market was removed to make room.
    function getMarkets(uint256 offset, uint256 limit) external view returns (bytes32[] memory ids) {
        uint256 total = _ids.length;
        if (limit > PAGE_LIMIT) limit = PAGE_LIMIT;
        uint256 end = offset >= total ? offset : offset + limit;
        if (end > total) end = total;
        uint256 size = end > offset ? end - offset : 0;
        ids = new bytes32[](size);
        for (uint256 i; i < size; ++i) {
            ids[i] = _ids[offset + i];
        }
    }

    /// @inheritdoc IUnicaMarketRegistry
    /// @dev ADMIN is implicitly a creator and never appears in an `OrderCreatorSet` log for it.
    function canCreateOrders(address account) external view returns (bool) {
        return account == admin || isOrderCreator[account];
    }

    // ---- internals ----------------------------------------------------------------------------------

    /// @dev A separate frame purely so `register` compiles under the frozen profile: thirteen event
    ///      fields plus `register`'s own locals overflow the stack with the optimizer off, and the
    ///      profile is not the thing that gets changed to make a contract fit.
    function _emitProposed(bytes32 marketId, UnicaMarketTypes.Market calldata market, bool demonstrationOnly) private {
        emit MarketProposed(
            marketId,
            market.asset,
            market.payout,
            market.version,
            market.hook,
            market.executor,
            market.poolId,
            market.fee,
            market.tickSpacing,
            market.rateE18,
            market.initSqrtPriceX96,
            market.initTick,
            demonstrationOnly
        );
    }

    function _move(bytes32 marketId, UnicaMarketTypes.MarketStatus from, UnicaMarketTypes.MarketStatus to) private {
        UnicaMarketTypes.Market storage m = _markets[marketId];
        UnicaMarketTypes.MarketStatus current = m.status;
        if (current == UnicaMarketTypes.MarketStatus.None) revert UnknownMarket(marketId);
        if (current != from) revert WrongMarketStatus(marketId, uint8(current));
        m.status = to;
        m.updatedAt = uint64(block.timestamp);
        emit MarketStatusChanged(marketId, uint8(from), uint8(to));
    }

    function _requireLive(bytes32 marketId) private view {
        UnicaMarketTypes.MarketStatus current = _markets[marketId].status;
        if (current == UnicaMarketTypes.MarketStatus.None) revert UnknownMarket(marketId);
        if (current == UnicaMarketTypes.MarketStatus.RETIRED) revert WrongMarketStatus(marketId, uint8(current));
    }

    function _claimReverse(bytes32 marketId, address hook, address executor, bytes32 poolId) private {
        bytes32 taken = marketIdOfHook[hook];
        if (taken != bytes32(0)) revert ReverseMapTaken(taken);
        taken = marketIdOfExecutor[executor];
        if (taken != bytes32(0)) revert ReverseMapTaken(taken);
        taken = marketIdOfPool[poolId];
        if (taken != bytes32(0)) revert ReverseMapTaken(taken);
        marketIdOfHook[hook] = marketId;
        marketIdOfExecutor[executor] = marketId;
        marketIdOfPool[poolId] = marketId;
    }

    /// @dev SC §6's validity table, in its order. Returns whether the market is demonstration-only.
    function _checkPolicy(
        bytes32 marketId,
        address asset,
        address payout,
        UnicaMarketTypes.OraclePolicy calldata policy
    ) private view returns (bool) {
        if (!policy.enabled) {
            if (REQUIRE_ORACLE) revert OraclePolicyRequired(marketId);
            if (
                policy.adapter != address(0) || policy.feedId != bytes32(0) || policy.maxAge != 0
                    || policy.maxDeviationBps != 0
            ) revert OraclePolicyMalformed(marketId);
            return true;
        }
        if (policy.adapter.code.length == 0) revert OracleAdapterNoCode(marketId, policy.adapter);
        if (policy.maxAge == 0 || policy.maxAge > MAX_ORACLE_AGE) {
            revert OracleMaxAgeOutOfRange(marketId, policy.maxAge);
        }
        if (policy.maxDeviationBps == 0 || policy.maxDeviationBps > MAX_DEVIATION_BPS) {
            revert OracleDeviationOutOfRange(marketId, policy.maxDeviationBps);
        }
        bytes32 actual = IUnicaOracleRoute(policy.adapter).feedIdFor(asset, payout);
        if (actual != policy.feedId) revert OracleFeedMismatch(marketId, policy.feedId, actual);
        return false;
    }
}
