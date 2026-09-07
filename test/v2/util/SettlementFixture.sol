// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {AddressConstants} from "hookmate/constants/AddressConstants.sol";
import {V4PoolManagerDeployer} from "hookmate/artifacts/V4PoolManager.sol";
import {Permit2Deployer} from "hookmate/artifacts/Permit2.sol";
import {QuoteSettlementHook} from "../../../src/v2/QuoteSettlementHook.sol";
import {QuoteSettlementExecutor} from "../../../src/v2/QuoteSettlementExecutor.sol";
import {IPermit2Transfer} from "../../../src/v2/interfaces/IPermit2Transfer.sol";
import {IQuoteSettlement} from "../../../src/v2/interfaces/IQuoteSettlement.sol";
import {HookRevertAsserts} from "./HookRevertAsserts.sol";

/// @notice Adds the pool's liquidity. Not the executor: the executor holds no tokens and must never
///         learn how to, and `beforeAddLiquidity` is not one of this hook's permissions, so any
///         address may be the liquidity provider. Keeping them separate is what lets the custody
///         assertions mean something.
contract LiquidityProvider is IUnlockCallback {
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
            MockERC20(Currency.unwrap(c)).transfer(address(MANAGER), uint256(uint128(-amount)));
            MANAGER.settle();
        } else if (amount > 0) {
            MANAGER.take(c, address(this), uint256(uint128(amount)));
        }
    }
}

/// @title The integrated V2 fixture: official PoolManager, official Permit2, hook, executor, pool
/// @notice Everything here is the real thing except the two tokens. The PoolManager is the official
///         runtime, constructed at its canonical Sepolia address. Permit2 is the official runtime,
///         constructed AT its canonical address rather than deployed elsewhere and copied — a
///         distinction that cost this repository a day, because immutables live in runtime code and
///         a copied Permit2 carries a domain separator for the wrong verifyingContract.
abstract contract SettlementFixture is HookRevertAsserts {
    using PoolIdLibrary for PoolKey;

    uint160 internal constant DECLARED_MASK =
        uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
    address internal constant HOOK_ADDR = address(uint160(DECLARED_MASK) ^ (0x3333 << 144));
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 internal constant CHAIN_ID = 11155111;

    IPoolManager internal manager;
    QuoteSettlementHook internal hook;
    QuoteSettlementExecutor internal executor;
    LiquidityProvider internal lp;

    MockERC20 internal tokenIn;
    MockERC20 internal tokenOut;
    PoolKey internal key;

    uint256 internal merchantKey = 0x3ADE;
    uint256 internal payerKey = 0xA11CE;
    address internal merchantSigner;
    address internal payer;
    address internal recipient = address(0x9E11);
    address internal relayer = address(0x5E1AB);

    /// @dev What the merchant's own signer computes. Written out here rather than read from the
    ///      contract, so the test derives the digest a second time and a one-sided change to either
    ///      description is a failure rather than an agreement.
    bytes32 internal constant LOCAL_QUOTE_TYPEHASH = keccak256(
        "Quote(uint8 version,bytes32 quoteId,address merchantSigner,address payer,address recipient,"
        "address tokenIn,uint256 maxIn,address tokenOut,uint256 amountOut,PoolKey pool,bool zeroForOne,"
        "uint256 deadline,address hook,address executor,bytes32 merchantConfigHash,uint32 policyVersion)"
        "PoolKey(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"
    );
    bytes32 internal constant LOCAL_POOL_KEY_TYPEHASH =
        keccak256("PoolKey(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)");
    bytes32 internal constant LOCAL_PAYMENT_TYPEHASH = keccak256(
        "Payment(bytes32 quoteId,address payer,address tokenIn,uint256 maxIn,address destination,address executor)"
    );
    bytes32 internal constant LOCAL_TOKEN_PERMISSIONS_TYPEHASH =
        keccak256("TokenPermissions(address token,uint256 amount)");

    function _setUpSettlement() internal {
        vm.chainId(CHAIN_ID);
        merchantSigner = vm.addr(merchantKey);
        payer = vm.addr(payerKey);

        address canonical = AddressConstants.getPoolManagerAddress(block.chainid);
        vm.etch(canonical, abi.encodePacked(V4PoolManagerDeployer.initcode(), abi.encode(address(this))));
        (bool ok, bytes memory runtime) = canonical.call("");
        require(ok, "official PoolManager init code reverted");
        vm.etch(canonical, runtime);
        manager = IPoolManager(canonical);

        vm.etch(PERMIT2, Permit2Deployer.initcode());
        (ok, runtime) = PERMIT2.call("");
        require(ok, "permit2 init code reverted");
        vm.etch(PERMIT2, runtime);

        executor = new QuoteSettlementExecutor(manager, IPermit2Transfer(PERMIT2));
        deployCodeTo("QuoteSettlementHook.sol:QuoteSettlementHook", abi.encode(manager, address(executor)), HOOK_ADDR);
        hook = QuoteSettlementHook(HOOK_ADDR);

        MockERC20 a = new MockERC20("In", "IN", 18);
        MockERC20 b = new MockERC20("Out", "OUT", 6);
        (tokenIn, tokenOut) = address(a) < address(b) ? (a, b) : (b, a);

        key = PoolKey({
            currency0: Currency.wrap(address(tokenIn)),
            currency1: Currency.wrap(address(tokenOut)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(HOOK_ADDR)
        });
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));

        lp = new LiquidityProvider(manager);
        tokenIn.mint(address(lp), 1_000_000 ether);
        tokenOut.mint(address(lp), 1_000_000 ether);
        lp.add(key, 1e15, -600, 600);

        tokenIn.mint(payer, 1_000 ether);
        vm.prank(payer);
        tokenIn.approve(PERMIT2, type(uint256).max);
    }

    function _poolId(IQuoteSettlement.Quote memory q) internal pure returns (bytes32) {
        return PoolId.unwrap(PoolIdLibrary.toId(q.pool));
    }

    // ---- building and signing --------------------------------------------------------------

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
            tokenIn: address(tokenIn),
            maxIn: maxIn,
            tokenOut: address(tokenOut),
            amountOut: amountOut,
            pool: key,
            zeroForOne: true,
            deadline: block.timestamp + 1 hours,
            hook: HOOK_ADDR,
            executor: address(executor),
            merchantConfigHash: keccak256("merchant config"),
            policyVersion: 1
        });
    }

    /// @dev The quote's EIP-712 struct hash, derived here from the type strings rather than by
    ///      calling the executor. Two descriptions that must agree, not one description consulted
    ///      twice.
    function _localHashQuote(IQuoteSettlement.Quote memory q) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(
                    LOCAL_QUOTE_TYPEHASH,
                    q.version,
                    q.quoteId,
                    q.merchantSigner,
                    q.payer,
                    q.recipient,
                    q.tokenIn,
                    q.maxIn
                ),
                abi.encode(
                    q.tokenOut,
                    q.amountOut,
                    keccak256(
                        abi.encode(
                            LOCAL_POOL_KEY_TYPEHASH,
                            Currency.unwrap(q.pool.currency0),
                            Currency.unwrap(q.pool.currency1),
                            q.pool.fee,
                            q.pool.tickSpacing,
                            address(q.pool.hooks)
                        )
                    ),
                    q.zeroForOne,
                    q.deadline,
                    q.hook,
                    q.executor,
                    q.merchantConfigHash,
                    q.policyVersion
                )
            )
        );
    }

    function _localDomain() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("UNICA"),
                keccak256("2"),
                block.chainid,
                address(executor)
            )
        );
    }

    function _quoteDigest(IQuoteSettlement.Quote memory q) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _localDomain(), _localHashQuote(q)));
    }

    function _signQuoteWithDigest(bytes32 digest, uint256 key_) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key_, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signQuoteAs(IQuoteSettlement.Quote memory q, uint256 key_) internal view returns (bytes memory) {
        return _signQuoteWithDigest(_quoteDigest(q), key_);
    }

    // ---- the payer's Permit2 authorisation ---------------------------------------------------

    function _witness(IQuoteSettlement.Quote memory q) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                LOCAL_PAYMENT_TYPEHASH, q.quoteId, q.payer, q.tokenIn, q.maxIn, address(manager), address(executor)
            )
        );
    }

    function _witnessTypeString() internal pure returns (string memory) {
        return string.concat(
            "Payment witness)",
            "Payment(bytes32 quoteId,address payer,address tokenIn,uint256 maxIn,address destination,address executor)",
            "TokenPermissions(address token,uint256 amount)"
        );
    }

    function _permit2Domain() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
                keccak256("Permit2"),
                block.chainid,
                PERMIT2
            )
        );
    }

    function _authorize(IQuoteSettlement.Quote memory q, uint256 nonce, uint256 deadline, uint256 key_)
        internal
        view
        returns (QuoteSettlementExecutor.PayerAuthorization memory)
    {
        bytes32 typeHash = keccak256(
            abi.encodePacked(
                "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,",
                _witnessTypeString()
            )
        );
        bytes32 tokenPermissions = keccak256(abi.encode(LOCAL_TOKEN_PERMISSIONS_TYPEHASH, q.tokenIn, q.maxIn));
        bytes32 structHash =
            keccak256(abi.encode(typeHash, tokenPermissions, address(executor), nonce, deadline, _witness(q)));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _permit2Domain(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key_, digest);
        return QuoteSettlementExecutor.PayerAuthorization({
            nonce: nonce, deadline: deadline, signature: abi.encodePacked(r, s, v)
        });
    }
}
