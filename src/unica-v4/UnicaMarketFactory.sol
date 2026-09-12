// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SafeCast} from "@uniswap/v4-core/src/libraries/SafeCast.sol";

import {UnicaMarketTypes} from "./UnicaMarketTypes.sol";
import {UnicaMarketMath} from "./UnicaMarketMath.sol";
import {UnicaMarketRegistry} from "./UnicaMarketRegistry.sol";
import {IUnicaMarketHook} from "./interfaces/IUnicaMarketHook.sol";

/// @title UnicaMarketFactory, the only way a UNICA v4 market comes to exist
/// @notice Written from `docs/unica-v4/SPEC-CONTRACTS.md` §7 and §12. It holds no storage, no token
///         code and no owner of its own: ADMIN is read from the registry at call time, so an admin
///         transfer takes effect here the moment it is accepted.
///
///         WHY THE HOOK'S CODE ARRIVES AS CALLDATA. A factory that embedded the hook's creation code
///         would also embed the executor's, because the hook's constructor creates it, and the pair
///         measured over the runtime limit (SC §12). So the bytes travel in the call and are
///         accepted only when they hash to `HOOK_CREATION_CODE_HASH`, an immutable of this build.
///         One hash pins both sources. Nothing about that is a shortcut: the code that is deployed
///         is byte-identical to the code the hash was taken of, or the call reverts before anything
///         exists.
///
///         WHY THE FLAG CHECK COMES BEFORE THE DEPLOY. `HookFlagsWrong` is raised on the PREDICTED
///         address, not on a deployed one. BaseHook's constructor re-validates the bits and would
///         catch it too, but only after a contract has been created and the transaction has paid for
///         it; refusing on the prediction means a mis-mined salt costs nothing and leaves nothing
///         behind (SC §7, check (c)).
contract UnicaMarketFactory {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using SafeCast for uint256;

    /// @notice The pool manager every market of this factory lives in.
    IPoolManager public immutable POOL_MANAGER;
    /// @notice Created in this constructor, so `REGISTRY == CREATE(factory, 1)` (SC §12).
    UnicaMarketRegistry public immutable REGISTRY;
    /// @notice `keccak256(type(UnicaMarketHook).creationCode)` of the pinned build (B10).
    bytes32 public immutable HOOK_CREATION_CODE_HASH;

    /// @notice `beforeInitialize | beforeSwap | afterSwap`, the only hook shape this factory deploys.
    uint160 internal constant HOOK_FLAGS = 0x20C0;
    /// @notice The fourteen permission bits of a v4 hook address.
    uint160 internal constant HOOK_FLAG_MASK = 0x3FFF;
    /// @notice The exact size of `abi.encode` over the hook's nine constructor arguments (ruling S7).
    uint256 internal constant HOOK_ARGS_BYTES = 288;

    error NotAdmin(address caller);
    error ZeroAddress();
    error ZeroHash();
    error WrongHookCode(bytes32 got);
    error SameToken(address token);
    error NoCode(address token);
    error DecimalsUnreadable(address token);
    error FeeTierUnsupported(uint24 fee, int24 tickSpacing);
    error RateOutOfRange(uint256 rateE18);
    error HookFlagsWrong(address predicted);
    error HookDeployFailed();
    error OpeningTickMismatch(int24 expected, int24 got);
    error WrongMarketStatus(bytes32 marketId, uint8 actual);
    error ZeroMinDepth();
    error SeedTooShallow(bytes32 marketId, uint128 depth, uint128 minDepth);
    error SeedAboveCap(bytes32 marketId, uint256 payoutEquivalent, uint128 maxSeedPayout);

    constructor(address admin_, IPoolManager poolManager_, bytes32 hookCreationCodeHash_, bool requireOracle_) {
        if (admin_ == address(0) || address(poolManager_) == address(0)) revert ZeroAddress();
        if (hookCreationCodeHash_ == bytes32(0)) revert ZeroHash();
        POOL_MANAGER = poolManager_;
        HOOK_CREATION_CODE_HASH = hookCreationCodeHash_;
        REGISTRY = new UnicaMarketRegistry(admin_, requireOracle_);
    }

    modifier onlyAdmin() {
        if (msg.sender != REGISTRY.admin()) revert NotAdmin(msg.sender);
        _;
    }

    // ---- lifecycle step 1: PROPOSED ----------------------------------------------------------------

    /// @notice SC §5 row 1. The checks run in SC §7's order and the first one that fails leaves the
    ///         chain exactly as it was.
    function createMarket(UnicaMarketTypes.MarketConfig calldata config, bytes32 salt, bytes calldata hookCreationCode)
        external
        onlyAdmin
        returns (bytes32 marketId, address hook, address executor)
    {
        if (keccak256(hookCreationCode) != HOOK_CREATION_CODE_HASH) revert WrongHookCode(keccak256(hookCreationCode));

        UnicaMarketTypes.Market memory market;
        {
            bytes memory hookArgs;
            (marketId,, hookArgs, market) = previewMarket(config);
            hook = _deployHook(hookCreationCode, hookArgs, salt);
        }

        executor = IUnicaMarketHook(hook).EXECUTOR();
        market.hook = hook;
        market.executor = executor;
        market.poolId =
            PoolId.unwrap(_poolKey(market.asset, market.payout, market.fee, market.tickSpacing, hook).toId());

        REGISTRY.register(marketId, market, config.policy, config.caps);
    }

    /// @dev Check (c) then check (d) of SC §7, in that order and in their own frame. The prediction
    ///      is refused before `create2` runs, so a bad salt never leaves a contract behind.
    function _deployHook(bytes calldata hookCreationCode, bytes memory hookArgs, bytes32 salt)
        private
        returns (address hook)
    {
        bytes memory initcode = bytes.concat(hookCreationCode, hookArgs);
        address predicted = _create2Address(salt, keccak256(initcode));
        if (uint160(predicted) & HOOK_FLAG_MASK != HOOK_FLAGS) revert HookFlagsWrong(predicted);

        assembly ("memory-safe") {
            hook := create2(0, add(initcode, 0x20), mload(initcode), salt)
        }
        if (hook != predicted || hook == address(0)) revert HookDeployFailed();
    }

    // ---- lifecycle step 2: INITIALIZED ---------------------------------------------------------------

    /// @notice SC §5 row 2. The hook admits only this factory as the initialiser, so this call is the
    ///         only way the pool is ever born; a stranger naming the same key gets `NotMarketFactory`
    ///         and the same key before the hook exists gets `InvalidHookResponse` (A5, row F18).
    function initializeMarket(bytes32 marketId) external onlyAdmin returns (int24 tick) {
        UnicaMarketTypes.Market memory m = REGISTRY.getMarket(marketId);
        if (m.status != UnicaMarketTypes.MarketStatus.PROPOSED) revert WrongMarketStatus(marketId, uint8(m.status));

        tick = POOL_MANAGER.initialize(poolKeyOf(marketId), m.initSqrtPriceX96);
        if (tick != m.initTick) revert OpeningTickMismatch(m.initTick, tick);

        REGISTRY.recordInitialized(marketId);
    }

    // ---- lifecycle step 3: SEEDED --------------------------------------------------------------------

    /// @notice SC §5 row 3. Depth is read from PoolManager state, never from a position, so a seed
    ///         that was minted somewhere other than the designed range simply is not there to count.
    /// @dev Point-in-time by construction: this proves the pool held `depth` at the opening tick in
    ///      THIS block and nothing more. A seed withdrawn afterwards makes settlement fail safe; it
    ///      does not un-record this.
    function markSeeded(bytes32 marketId, uint128 minDepth) external onlyAdmin returns (uint128 depth) {
        UnicaMarketTypes.Market memory m = REGISTRY.getMarket(marketId);
        if (m.status != UnicaMarketTypes.MarketStatus.INITIALIZED) revert WrongMarketStatus(marketId, uint8(m.status));
        if (minDepth == 0) revert ZeroMinDepth();

        depth = _depthAtOpeningTick(m);
        if (depth < minDepth) revert SeedTooShallow(marketId, depth, minDepth);

        uint256 payoutEquivalent = _seedPayoutEquivalent(marketId, m, depth);
        uint128 maxSeedPayout = REGISTRY.capsOf(marketId).maxSeedPayout;
        if (payoutEquivalent > maxSeedPayout) revert SeedAboveCap(marketId, payoutEquivalent, maxSeedPayout);

        REGISTRY.recordSeeded(marketId, depth);
    }

    // ---- views ----------------------------------------------------------------------------------------

    /// @notice Everything `createMarket` would record, computed with no state written, so a salt can
    ///         be mined off-chain against exactly the bytes the factory will deploy.
    /// @return marketId the id `register` will recompute and require.
    /// @return version `latestVersion + 1` for the pair, read live.
    /// @return hookArgs the 288 bytes appended to the creation code; `abi.encode` of the hook's nine
    ///         constructor arguments, in the hook's own order.
    /// @return market the record, with `hook`, `executor` and `poolId` still zero: all three derive
    ///         from the salt, which this function is not given, and `createMarket` fills them in.
    function previewMarket(UnicaMarketTypes.MarketConfig calldata config)
        public
        view
        returns (bytes32 marketId, uint32 version, bytes memory hookArgs, UnicaMarketTypes.Market memory market)
    {
        market = _validateAndPrice(config);
        version = REGISTRY.latestVersion(config.asset, config.payout) + 1;
        market.version = version;
        marketId = keccak256(
            abi.encode(
                block.chainid,
                address(REGISTRY),
                config.asset,
                config.payout,
                version,
                config.policy.adapter,
                config.policy.feedId
            )
        );
        hookArgs = _encodeHookArgs(marketId, config, market.assetDecimals, market.payoutDecimals);
    }

    /// @notice The one pool key of a registered market.
    function poolKeyOf(bytes32 marketId) public view returns (PoolKey memory) {
        UnicaMarketTypes.Market memory m = REGISTRY.getMarket(marketId);
        return _poolKey(m.asset, m.payout, m.fee, m.tickSpacing, m.hook);
    }

    // ---- internals ---------------------------------------------------------------------------------------

    function _poolKey(address asset, address payout, uint24 fee, int24 tickSpacing, address hook)
        private
        pure
        returns (PoolKey memory)
    {
        (address currency0, address currency1) = asset < payout ? (asset, payout) : (payout, asset);
        return PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(hook)
        });
    }

    /// @dev SC §7's `previewMarket` refusals, in order, and then the opening price. Split out of
    ///      `previewMarket` for the same stack reason as `_encodeHookArgs`: the record has sixteen
    ///      fields and the profile is frozen.
    function _validateAndPrice(UnicaMarketTypes.MarketConfig calldata config)
        private
        view
        returns (UnicaMarketTypes.Market memory market)
    {
        if (config.asset == config.payout) revert SameToken(config.asset);
        if (config.asset.code.length == 0) revert NoCode(config.asset);
        if (config.payout.code.length == 0) revert NoCode(config.payout);
        if (!_feeTierAllowed(config.fee, config.tickSpacing)) {
            revert FeeTierUnsupported(config.fee, config.tickSpacing);
        }

        market.asset = config.asset;
        market.payout = config.payout;
        market.rateE18 = config.rateE18;
        market.fee = config.fee;
        market.tickSpacing = config.tickSpacing;
        market.assetDecimals = _readDecimals(config.asset);
        market.payoutDecimals = _readDecimals(config.payout);
        market.assetIsCurrency0 = config.asset < config.payout;

        (market.initSqrtPriceX96, market.initTick) = UnicaMarketMath.openingPrice(
            config.rateE18, market.assetDecimals, market.payoutDecimals, market.assetIsCurrency0, config.tickSpacing
        );
    }

    /// @dev The hook's nine constructor arguments, in the hook's own order, and 288 bytes of them
    ///      (ruling S7). A separate frame because nine encode arguments plus `previewMarket`'s own
    ///      locals overflow the stack with the optimizer off, and the profile is frozen.
    function _encodeHookArgs(
        bytes32 marketId,
        UnicaMarketTypes.MarketConfig calldata config,
        uint8 assetDecimals,
        uint8 payoutDecimals
    ) private view returns (bytes memory) {
        return abi.encode(
            POOL_MANAGER,
            REGISTRY,
            marketId,
            config.asset,
            config.payout,
            config.fee,
            config.tickSpacing,
            assetDecimals,
            payoutDecimals
        );
    }

    function _create2Address(bytes32 salt, bytes32 initcodeHash) private view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initcodeHash)))));
    }

    /// @dev The allowlist answers A12 and A13: a fee near 100 % would list a market that turns input
    ///      into fees, and spacing 1 makes an oversized order walk thousands of bitmap words.
    function _feeTierAllowed(uint24 fee, int24 tickSpacing) private pure returns (bool) {
        if (fee == 500) return tickSpacing == 10;
        if (fee == 3000) return tickSpacing == 60;
        if (fee == 10000) return tickSpacing == 200;
        return false;
    }

    /// @dev A STATICCALL, not an interface call, because the point is to survive every shape of
    ///      wrong answer: a revert, no return data, a short return, a long one, and a value a
    ///      `uint8` would silently truncate. Anything but exactly 32 bytes decoding to 18 or less is
    ///      `DecimalsUnreadable`. Configuration decimals are never trusted instead of this (S7).
    function _readDecimals(address token) private view returns (uint8) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || data.length != 32) revert DecimalsUnreadable(token);
        uint256 value = abi.decode(data, (uint256));
        if (value > 18) revert DecimalsUnreadable(token);
        return uint8(value);
    }

    /// @dev SC §7. Asset as currency0 puts the payout side BELOW the opening tick, and a position
    ///      whose upper tick is the opening tick is not counted in the pool's active liquidity
    ///      there, so its `liquidityNet` (negative at an upper tick) is subtracted back in. Asset as
    ///      currency1 puts the payout side above, where the position's lower tick is the opening
    ///      tick and it is already active.
    function _depthAtOpeningTick(UnicaMarketTypes.Market memory m) private view returns (uint128) {
        PoolId poolId = PoolId.wrap(m.poolId);
        uint128 active = POOL_MANAGER.getLiquidity(poolId);
        if (!m.assetIsCurrency0) return active;

        (, int128 liquidityNet) = POOL_MANAGER.getTickLiquidity(poolId, m.initTick);
        int256 below = int256(uint256(active)) - int256(liquidityNet);
        if (below <= 0) return 0;
        // SafeCast, never a truncating cast (A10): an implausible depth reverts loudly here rather
        // than wrapping into a small number that would sail past `minDepth`.
        return uint256(below).toUint128();
    }

    /// @dev What `depth` would hold in payout tokens across the DESIGNED range, which is where the
    ///      deployment script mints. A seed spread wider than the design holds more than this counts
    ///      — SC §7 says so in as many words — so this bounds a mis-sized seed inside the range, not
    ///      everything at risk.
    function _seedPayoutEquivalent(bytes32 marketId, UnicaMarketTypes.Market memory m, uint128 depth)
        private
        view
        returns (uint256)
    {
        UnicaMarketTypes.OraclePolicy memory policy = REGISTRY.oraclePolicyOf(marketId);
        int24 width = UnicaMarketMath.seedWidth(m.tickSpacing, policy.enabled, policy.maxDeviationBps);
        (int24 lower, int24 upper) = UnicaMarketMath.seedRange(m.initTick, width, m.assetIsCurrency0);

        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(lower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(upper);

        // Rounded UP, against the market: a cap is only meaningful if the number it compares is
        // never smaller than what is really there.
        return m.assetIsCurrency0
            ? SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtUpper, depth, true)
            : SqrtPriceMath.getAmount0Delta(sqrtLower, sqrtUpper, depth, true);
    }
}
