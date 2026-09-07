// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {QuoteSettlementHook} from "../../../src/v2/QuoteSettlementHook.sol";
import {QuoteSettlementExecutor} from "../../../src/v2/QuoteSettlementExecutor.sol";
import {IPermit2Transfer} from "../../../src/v2/interfaces/IPermit2Transfer.sol";
import {IQuoteSettlement} from "../../../src/v2/interfaces/IQuoteSettlement.sol";
import {HookRevertAsserts} from "../../v2/util/HookRevertAsserts.sol";
import {QuoteSigning} from "../../v2/util/QuoteSigning.sol";
import {ForkPin} from "../ForkPin.sol";

/// @notice Provides the fork-local pool's liquidity with real Sepolia tokens. Not the executor:
///         the executor holds nothing and must never learn how to.
contract ForkLiquidityProvider is IUnlockCallback {
    IPoolManager public immutable MANAGER;

    constructor(IPoolManager manager_) {
        MANAGER = manager_;
    }

    function add(PoolKey calldata key, int256 liquidityDelta, int24 lower, int24 upper) external {
        MANAGER.unlock(abi.encode(key, liquidityDelta, lower, upper));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(MANAGER), "only the manager");
        (PoolKey memory key, int256 liq, int24 lower, int24 upper) = abi.decode(data, (PoolKey, int256, int24, int24));
        (BalanceDelta d,) = MANAGER.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: liq, salt: bytes32(0)}), ""
        );
        _pay(key.currency0, d.amount0());
        _pay(key.currency1, d.amount1());
        return "";
    }

    function _pay(Currency c, int128 amount) internal {
        if (amount < 0) {
            MANAGER.sync(c);
            IERC20(Currency.unwrap(c)).transfer(address(MANAGER), uint256(uint128(-amount)));
            MANAGER.settle();
        } else if (amount > 0) {
            MANAGER.take(c, address(this), uint256(uint128(amount)));
        }
    }
}

/// @title The fork-local V2 installation
/// @notice FORK-LOCAL TEST SETUP. NOTHING WAS BROADCAST TO SEPOLIA. The hook and executor below are
///         created inside a local fork of the chain; they do not exist on Sepolia, the pool does
///         not exist on Sepolia, and its liquidity is test liquidity dealt into existence. What IS
///         real here is everything they talk to: the official PoolManager, the official Permit2,
///         Circle's USDC proxy and canonical WETH9, all at their pinned code hashes.
///
/// @dev The hook's address is MINED and deployed through the canonical CREATE2 deployer, exactly as
///      a real deployment would be, rather than etched. A hook whose permission bits were etched
///      into place proves nothing about whether a real address for those bits can be found.
abstract contract V2ForkFixture is ForkPin, HookRevertAsserts, QuoteSigning {
    using PoolIdLibrary for PoolKey;

    uint160 internal constant DECLARED_FLAGS =
        uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);

    IPoolManager internal manager;
    QuoteSettlementExecutor internal executor;
    QuoteSettlementHook internal hook;
    ForkLiquidityProvider internal lp;

    PoolKey internal key;
    bytes32 internal minedSalt;
    int24 internal initialTick;
    int24 internal rangeLower;
    int24 internal rangeUpper;
    uint256 internal seededUsdc;
    uint256 internal seededWeth;

    /// @dev NOT the tidy little keys the local suites use, and the reason is a fork finding worth
    ///      the paragraph. `vm.addr(0xA11CE)` — a famous test key — resolves to
    ///      `0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7`, and on Sepolia at the pinned block that
    ///      address holds 23 bytes of code beginning `0xef0100`: an EIP-7702 delegation designator.
    ///      Somebody delegated the well-known key.
    ///
    ///      That is not cosmetic. Permit2 branches on `claimedSigner.code.length`, so a payer with
    ///      ANY code — including a 7702-delegated EOA — is sent down the EIP-1271 path, where a
    ///      plain ECDSA signature is not what is being asked for. The first run of this suite failed
    ///      exactly there, in `isValidSignature`, after the swap had already succeeded.
    ///
    ///      So the fork actors are derived from phrases, and `_setUpForkV2` asserts each has no
    ///      code. An assumption that holds in a fresh EVM and not on a real chain is precisely what
    ///      a fork test is for.
    uint256 internal merchantKey = uint256(keccak256("unica.v2.fork.merchant"));
    uint256 internal payerKey = uint256(keccak256("unica.v2.fork.payer"));
    address internal merchantSigner;
    address internal payer;
    address internal recipient = 0xa50802FBcAfc5aF3D0093026d301a82ec341652a;
    address internal relayer = 0x4D528013D3f89884aB482cb2Fc34eb8a601cD1C7;

    /// @dev The address the local suites use as their payer, kept so a row can state the finding
    ///      out loud rather than leaving it in a comment.
    address internal constant DELEGATED_TEST_EOA = 0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7;

    function _setUpForkV2() internal {
        _selectPinnedFork();
        merchantSigner = vm.addr(merchantKey);
        payer = vm.addr(payerKey);
        // The assumption the first fork run broke. Stated as a precondition so a future key that
        // acquires code fails here, with a reason, rather than three frames deep inside Permit2.
        require(payer.code.length == 0, "fork payer has code; pick a key that does not");
        require(merchantSigner.code.length == 0, "fork merchant has code; pick a key that does not");
        require(recipient.code.length == 0, "fork recipient has code");
        manager = IPoolManager(POOL_MANAGER);

        executor = new QuoteSettlementExecutor(manager, IPermit2Transfer(PERMIT2));

        (address deployed, bytes32 salt) = _mineHook(address(executor));
        minedSalt = salt;
        hook = QuoteSettlementHook(deployed);

        // USDC sorts below WETH, so the merchant's payout currency is currency0 and the swap runs
        // one-for-zero — the opposite direction to every local suite.
        key = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH9),
            fee: POOL_FEE,
            tickSpacing: POOL_TICK_SPACING,
            hooks: IHooks(deployed)
        });
        initialTick = manager.initialize(key, POOL_SQRT_PRICE);

        rangeLower = _align(initialTick - 12000);
        rangeUpper = _align(initialTick + 12000);

        lp = new ForkLiquidityProvider(manager);
        deal(USDC, address(lp), 5_000_000e6);
        deal(WETH9, address(lp), 5_000e18);
        uint256 usdcBefore = IERC20(USDC).balanceOf(address(lp));
        uint256 wethBefore = IERC20(WETH9).balanceOf(address(lp));
        lp.add(key, 5e13, rangeLower, rangeUpper);
        seededUsdc = usdcBefore - IERC20(USDC).balanceOf(address(lp));
        seededWeth = wethBefore - IERC20(WETH9).balanceOf(address(lp));

        // The payer holds only WETH and has authorised only Permit2.
        deal(WETH9, payer, 10e18);
        vm.prank(payer);
        IERC20(WETH9).approve(PERMIT2, type(uint256).max);
    }

    /// @dev Mines a real address carrying the declared permission bits and deploys through the
    ///      canonical CREATE2 deployer, exactly as a real deployment would. Etching a hook into
    ///      place proves nothing about whether an address for those bits can be found at all.
    function _mineHook(address executor_) internal returns (address deployed, bytes32 salt) {
        address mined;
        (mined, salt) = HookMiner.find(
            DETERMINISTIC_DEPLOYER,
            DECLARED_FLAGS,
            type(QuoteSettlementHook).creationCode,
            abi.encode(manager, executor_)
        );
        bytes memory initcode = abi.encodePacked(type(QuoteSettlementHook).creationCode, abi.encode(manager, executor_));
        (bool ok, bytes memory ret) = DETERMINISTIC_DEPLOYER.call(abi.encodePacked(salt, initcode));
        require(ok, "the CREATE2 deployer refused the hook");
        deployed = address(uint160(bytes20(ret)));
        require(deployed == mined, "the deployed hook is not the mined address");
        require(deployed.code.length > 0, "the mined hook has no code");
        require(uint160(deployed) & Hooks.ALL_HOOK_MASK == DECLARED_FLAGS, "the mined address carries wrong flags");
    }

    function _align(int24 tick) internal pure returns (int24) {
        int24 spacing = POOL_TICK_SPACING;
        int24 aligned = (tick / spacing) * spacing;
        if (aligned < TickMath.MIN_TICK) aligned += spacing;
        if (aligned > TickMath.MAX_TICK) aligned -= spacing;
        return aligned;
    }

    /// @dev The merchant is paid in USDC, which is currency0, so the swap is one-for-zero.
    function _quote(bytes32 quoteId, uint256 amountOut, uint256 maxIn)
        internal
        view
        returns (IQuoteSettlement.Quote memory)
    {
        return IQuoteSettlement.Quote({
            version: 1,
            quoteId: quoteId,
            merchantSigner: merchantSigner,
            payer: payer,
            recipient: recipient,
            tokenIn: WETH9,
            maxIn: maxIn,
            tokenOut: USDC,
            amountOut: amountOut,
            pool: key,
            zeroForOne: false,
            deadline: block.timestamp + 1 hours,
            hook: address(hook),
            executor: address(executor),
            merchantConfigHash: keccak256("fork merchant config"),
            policyVersion: 1
        });
    }

    function _poolId(IQuoteSettlement.Quote memory q) internal pure returns (bytes32) {
        return PoolId.unwrap(PoolIdLibrary.toId(q.pool));
    }

    function _quoteDigest(IQuoteSettlement.Quote memory q) internal view returns (bytes32) {
        return _quoteDigestFor(address(executor), q);
    }

    function _signQuoteAs(IQuoteSettlement.Quote memory q, uint256 key_) internal view returns (bytes memory) {
        return _signQuoteFor(address(executor), q, key_);
    }

    function _auth(IQuoteSettlement.Quote memory q, uint256 nonce)
        internal
        view
        returns (QuoteSettlementExecutor.PayerAuthorization memory)
    {
        return _authFull(q, nonce, block.timestamp + 1 hours, payerKey);
    }

    function _authFull(IQuoteSettlement.Quote memory q, uint256 nonce, uint256 deadline, uint256 key_)
        internal
        view
        returns (QuoteSettlementExecutor.PayerAuthorization memory)
    {
        return _authorizeFor(
            AuthContext({
                permit2: PERMIT2,
                manager: address(manager),
                executor: address(executor),
                nonce: nonce,
                deadline: deadline,
                signerKey: key_
            }),
            q
        );
    }
}

/// @notice Swaps in its own name, which is the thing an invoice-only pool must refuse. Used on the
///         fork so the refusal is measured against the official PoolManager rather than a double.
contract StrangerSwapper is IUnlockCallback {
    IPoolManager public immutable MANAGER;
    bool public reverted;
    bytes public revertData;

    constructor(IPoolManager manager_) {
        MANAGER = manager_;
    }

    function trySwap(PoolKey calldata key, bool zeroForOne, int256 amountSpecified, bytes calldata hookData) external {
        reverted = false;
        revertData = "";
        MANAGER.unlock(abi.encode(key, zeroForOne, amountSpecified, hookData));
    }

    /// @dev The far edge of the price range in whichever direction the swap runs, which is to say
    ///      no limit at all. A stranger's swap must be allowed to attempt whatever the pool would
    ///      do, so that what refuses it is the hook and not a tick.
    function _noPriceLimit(bool zeroForOne) internal pure returns (uint160) {
        if (zeroForOne) {
            return TickMath.MIN_SQRT_PRICE + 1;
        }
        return TickMath.MAX_SQRT_PRICE - 1;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(MANAGER), "only the manager");
        (PoolKey memory key, bool zeroForOne, int256 amountSpecified, bytes memory hookData) =
            abi.decode(data, (PoolKey, bool, int256, bytes));
        try MANAGER.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne, amountSpecified: amountSpecified, sqrtPriceLimitX96: _noPriceLimit(zeroForOne)
            }),
            hookData
        ) returns (
            BalanceDelta
        ) {
            revert("the invoice-only pool admitted a stranger");
        } catch (bytes memory err) {
            reverted = true;
            revertData = err;
        }
        return "";
    }
}
