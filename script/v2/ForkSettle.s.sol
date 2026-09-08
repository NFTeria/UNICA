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
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {QuoteSettlementHook} from "../../src/v2/QuoteSettlementHook.sol";
import {QuoteSettlementExecutor} from "../../src/v2/QuoteSettlementExecutor.sol";
import {IPermit2Transfer} from "../../src/v2/interfaces/IPermit2Transfer.sol";
import {IQuoteSettlement} from "../../src/v2/interfaces/IQuoteSettlement.sol";
import {MerchantConfig} from "../../src/v2/MerchantConfig.sol";
import {console} from "forge-std/console.sol";
import {QuoteSigning} from "../../test/v2/util/QuoteSigning.sol";

interface IWeth9 {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Provides the fork-local pool's liquidity. Not the executor: the executor holds nothing
///         and must never learn how to.
contract ForkSettleLiquidity is IUnlockCallback {
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

/// @title A V2 settlement that leaves a real transaction receipt on a LOCAL fork node
/// @notice ONLINE MODE'S EVIDENCE, and nothing else. `forge test` proves the settlement's
///         semantics against pinned live dependencies, but a `forge test` run leaves no
///         transaction, no block and no log a JSON-RPC client can fetch — so it cannot exercise
///         `tools/unica-verify`'s online path at all. This script broadcasts to a LOCAL ANVIL FORK
///         of Sepolia so that `eth_getTransactionReceipt` has something real to return.
///
/// @dev NOTHING HERE IS EVER BROADCAST TO A PUBLIC CHAIN. `script/v2/fork-settle.sh` refuses any
///      RPC that is not a local node, and refuses a node whose chain id it did not itself fork.
///      The contracts it deploys exist only inside that node's memory; what is real is everything
///      they talk to — the official PoolManager, the official Permit2, Circle's USDC and canonical
///      WETH9, at their live code.
///
/// @dev THE KEYS ARE THE FORK SUITE'S KEYS, derived from the same two phrases, so the script and
///      `test/fork/` describe one merchant and one payer rather than two. They are test
///      identities for a throwaway node and hold nothing anywhere else.
contract ForkSettleScript is QuoteSigning {
    using PoolIdLibrary for PoolKey;

    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant DETERMINISTIC_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address internal constant WETH9 = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant POOL_TICK_SPACING = 60;
    uint160 internal constant POOL_SQRT_PRICE = 1584563250285286751870879006720000;

    uint160 internal constant DECLARED_FLAGS =
        uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);

    /// @dev The fork suite's constants, restated so the two agree by construction.
    uint256 internal constant QUOTE_DEADLINE = 2_000_000_000;
    bytes32 internal constant FORK_NAMEHASH = 0x7825d40d6800e28bd1018984ac9d649c39174be745a90021a4dd67d50d072639;
    address internal constant RECIPIENT = 0xa50802FBcAfc5aF3D0093026d301a82ec341652a;

    uint256 internal merchantKey = uint256(keccak256("unica.v2.fork.merchant"));
    uint256 internal payerKey = uint256(keccak256("unica.v2.fork.payer"));

    /// @dev Gathered rather than kept as locals. With the optimiser's IR pipeline deliberately
    ///      off — turning it on would change the bytecode of every contract in this tree, the V1
    ///      hook whose deployed address was mined against these settings included — a run() that
    ///      held all of this at once does not fit the EVM's stack.
    struct Deployment {
        QuoteSettlementExecutor executor;
        address hook;
        bytes32 salt;
        PoolKey key;
    }

    function run() external {
        require(vm.addr(payerKey).code.length == 0, "the payer address has code on this fork");
        require(vm.addr(merchantKey).code.length == 0, "the merchant address has code on this fork");

        Deployment memory d = _deploy();
        _seed(d);
        _fundThePayer();
        _settle(d);
    }

    function _deploy() internal returns (Deployment memory d) {
        IPoolManager manager = IPoolManager(POOL_MANAGER);
        vm.startBroadcast();
        d.executor = new QuoteSettlementExecutor(manager, IPermit2Transfer(PERMIT2));
        (d.hook, d.salt) = HookMiner.find(
            DETERMINISTIC_DEPLOYER,
            DECLARED_FLAGS,
            type(QuoteSettlementHook).creationCode,
            abi.encode(manager, address(d.executor))
        );
        (bool ok,) = DETERMINISTIC_DEPLOYER.call(
            abi.encodePacked(
                d.salt,
                abi.encodePacked(type(QuoteSettlementHook).creationCode, abi.encode(manager, address(d.executor)))
            )
        );
        require(ok, "the CREATE2 deployer refused the hook");
        require(d.hook.code.length > 0, "the hook did not land at the mined address");

        d.key = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH9),
            fee: POOL_FEE,
            tickSpacing: POOL_TICK_SPACING,
            hooks: IHooks(d.hook)
        });
        vm.stopBroadcast();
    }

    function _seed(Deployment memory d) internal {
        vm.startBroadcast();
        int24 tick = IPoolManager(POOL_MANAGER).initialize(d.key, POOL_SQRT_PRICE);
        ForkSettleLiquidity lp = new ForkSettleLiquidity(IPoolManager(POOL_MANAGER));
        // The USDC was placed on this account by `fork-settle.sh` before the script ran; the WETH
        // is minted from the node's own ether by the canonical contract's own `deposit`.
        IERC20(USDC).transfer(address(lp), 4_000_000e6);
        IWeth9(WETH9).deposit{value: 800 ether}();
        IWeth9(WETH9).transfer(address(lp), 800 ether);
        lp.add(d.key, 5e13, _align(tick - 12000), _align(tick + 12000));
        vm.stopBroadcast();
    }

    /// @dev The payer funds and authorises from their OWN address, exactly as a real payer would,
    ///      so the Permit2 approval on chain belongs to the account that signed the permit.
    function _fundThePayer() internal {
        vm.startBroadcast(payerKey);
        IWeth9(WETH9).deposit{value: 5 ether}();
        IERC20(WETH9).approve(PERMIT2, type(uint256).max);
        vm.stopBroadcast();
    }

    function _settle(Deployment memory d) internal {
        IQuoteSettlement.Quote memory q = _quote(d);
        bytes memory merchantSignature = _signQuoteFor(address(d.executor), q, merchantKey);

        // THE TRANSACTION THE VERIFIER IS POINTED AT. Submitted by a third party who signed
        // nothing, which is the whole point of the design.
        vm.startBroadcast();
        (uint256 actualIn, uint256 deliveredOut) = d.executor
            .settle(
                q,
                merchantSignature,
                _authorizeFor(
                    AuthContext({
                        permit2: PERMIT2,
                        manager: POOL_MANAGER,
                        executor: address(d.executor),
                        // Read from the node rather than assumed. A second run against a node that
                        // already holds one settlement finds nonce 0 spent, and Permit2 answers with
                        // `InvalidNonce()` four frames deep — measured, the first time this script was
                        // run twice.
                        nonce: vm.envOr("UNICA_PERMIT_NONCE", uint256(0)),
                        deadline: QUOTE_DEADLINE,
                        signerKey: payerKey
                    }),
                    q
                )
            );
        vm.stopBroadcast();

        console.log("UNICA_V2_EXECUTOR=%s", vm.toString(address(d.executor)));
        console.log("UNICA_V2_HOOK=%s", vm.toString(d.hook));
        console.log("UNICA_V2_SALT=%s", vm.toString(d.salt));
        console.log("UNICA_V2_POOL_ID=%s", vm.toString(PoolId.unwrap(d.key.toId())));
        console.log("UNICA_V2_QUOTE_DIGEST=%s", vm.toString(_quoteDigestFor(address(d.executor), q)));
        console.log("UNICA_V2_MERCHANT_SIGNATURE=%s", vm.toString(merchantSignature));
        console.log("UNICA_V2_MERCHANT_SIGNER=%s", vm.toString(q.merchantSigner));
        console.log("UNICA_V2_PAYER=%s", vm.toString(q.payer));
        console.log("UNICA_V2_RECIPIENT=%s", vm.toString(q.recipient));
        console.log("UNICA_V2_CONFIG_HASH=%s", vm.toString(q.merchantConfigHash));
        console.log("UNICA_V2_ACTUAL_IN=%s", vm.toString(actualIn));
        console.log("UNICA_V2_DELIVERED_OUT=%s", vm.toString(deliveredOut));
    }

    function _quote(Deployment memory d) internal view returns (IQuoteSettlement.Quote memory) {
        return IQuoteSettlement.Quote({
            version: 1,
            quoteId: bytes32("fork-1"),
            merchantSigner: vm.addr(merchantKey),
            payer: vm.addr(payerKey),
            recipient: RECIPIENT,
            tokenIn: WETH9,
            maxIn: 1e18,
            tokenOut: USDC,
            amountOut: 100e6,
            pool: d.key,
            zeroForOne: false,
            deadline: QUOTE_DEADLINE,
            hook: d.hook,
            executor: address(d.executor),
            merchantConfigHash: MerchantConfig.hash(_config()),
            policyVersion: 1
        });
    }

    function _config() internal view returns (MerchantConfig.Config memory) {
        return MerchantConfig.Config({
            version: 1,
            namehash: FORK_NAMEHASH,
            name: "fork-merchant.eth",
            recipient: RECIPIENT,
            payoutCurrency: USDC,
            chainId: 11155111,
            resolvedAtBlock: 11656000,
            validForBlocks: 50000
        });
    }

    function _align(int24 tick) internal pure returns (int24) {
        return (tick / POOL_TICK_SPACING) * POOL_TICK_SPACING;
    }
}
