// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {MerchantConfig} from "../../src/v2/MerchantConfig.sol";
import {SettlementFixture} from "./util/SettlementFixture.sol";

/// @title The half of the release-candidate freeze that only a running contract can answer
/// @notice `script/verify-freeze.mjs` pins every selector and topic from the compiled artifacts.
///         What it cannot check is what the contracts SAY at run time: the type strings a wallet
///         will render, the permission bits burned into the hook's address, and the version numbers
///         an indexer keys on. Those are here, compared against the same frozen literals.
///
///         Changing any of them is a compatibility event, not a refactor. `docs/v2/RELEASE-CANDIDATE-FREEZE.md`
///         lists what else has to move with it.
contract InterfaceFreezeTest is SettlementFixture {
    function setUp() public {
        _setUpSettlement();
    }

    function test_Freeze_TheQuoteTypeStringIsWhatAWalletWillRender() public view {
        assertEq(
            executor.QUOTE_TYPE(),
            "Quote(uint8 version,bytes32 quoteId,address merchantSigner,address payer,address recipient,"
            "address tokenIn,uint256 maxIn,address tokenOut,uint256 amountOut,PoolKey pool,bool zeroForOne,"
            "uint256 deadline,address hook,address executor,bytes32 merchantConfigHash,uint32 policyVersion)"
            "PoolKey(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
            "the merchant's type string moved; every existing signature is now invalid"
        );
    }

    function test_Freeze_ThePaymentTypeStringsAreWhatPermit2WillHash() public view {
        assertEq(
            executor.PAYMENT_TYPE(),
            "Payment(bytes32 quoteId,address payer,address tokenIn,uint256 maxIn,address destination,"
            "address executor)",
            "the payer's witness type moved"
        );
        assertEq(
            executor.paymentWitnessTypeString(),
            "Payment witness)Payment(bytes32 quoteId,address payer,address tokenIn,uint256 maxIn,"
            "address destination,address executor)TokenPermissions(address token,uint256 amount)",
            "the string Permit2 concatenates onto its stub moved"
        );
    }

    function test_Freeze_TheMerchantConfigTypeStringIsUnchanged() public pure {
        assertEq(
            MerchantConfig.CONFIG_TYPE,
            "MerchantConfig(uint8 version,bytes32 namehash,string name,address recipient,"
            "address payoutCurrency,uint256 chainId,uint64 resolvedAtBlock,uint32 validForBlocks)",
            "the merchant configuration commitment's type moved"
        );
    }

    /// @dev The permission bits are part of the hook's ADDRESS, so this is the one part of a hook
    ///      that cannot be changed after deployment. Freezing them is freezing the address space
    ///      the deployment will be mined in.
    function test_Freeze_TheHookPermissionFlagsAre0x20C0() public view {
        uint160 declared = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
        assertEq(uint256(declared), 0x20C0, "the declared flag mask moved");
        assertEq(uint256(uint160(address(hook)) & Hooks.ALL_HOOK_MASK), 0x20C0, "the hook's address carries other bits");

        Hooks.Permissions memory p = hook.getHookPermissions();
        assertTrue(p.beforeInitialize && p.beforeSwap && p.afterSwap, "a declared permission is missing");
        assertFalse(
            p.afterInitialize || p.beforeAddLiquidity || p.afterAddLiquidity, "an undeclared permission crept in"
        );
        assertFalse(p.beforeRemoveLiquidity || p.afterRemoveLiquidity, "an undeclared permission crept in");
        assertFalse(p.beforeDonate || p.afterDonate, "an undeclared permission crept in");
        assertFalse(
            p.beforeSwapReturnDelta || p.afterSwapReturnDelta,
            "a returned-delta permission appeared; that is the NoOp attack surface"
        );
        assertFalse(
            p.afterAddLiquidityReturnDelta || p.afterRemoveLiquidityReturnDelta, "a returned-delta permission appeared"
        );
    }

    function test_Freeze_TheVersionNumbersAnIndexerKeysOn() public view {
        assertEq(executor.QUOTE_VERSION(), 1, "the quote version moved");
        assertEq(executor.RECEIPT_SCHEMA_VERSION(), 1, "the receipt schema version moved");
    }

    /// @dev The active-context shape the hook reads. Frozen because the hook and the executor are
    ///      deployed separately and a mismatch here is a settlement that cannot happen at all.
    function test_Freeze_TheActiveContextShape() public view {
        (bytes32 digest, uint256 requiredOut, bytes32 poolId, bool zeroForOne) = executor.activeQuote();
        assertEq(digest, bytes32(0), "a context is live outside a settlement");
        assertEq(requiredOut, 0, "a required amount is live outside a settlement");
        assertEq(poolId, bytes32(0), "a pool id is live outside a settlement");
        assertFalse(zeroForOne, "a direction is live outside a settlement");
        assertEq(executor.activePayer(), address(0), "a payer is live outside a settlement");
    }

    /// @dev V2 uses NO hookData. Frozen as a fact rather than an omission, because "we ignore it"
    ///      is a claim, and the fork suite carries the row that proves fabricated hookData buys
    ///      nothing.
    function test_Freeze_TheHookReadsNothingFromCalldata() public view {
        assertEq(
            hook.whatThisHookProves(),
            "the swap discharged an admitted invoice in full; not that the merchant was paid",
            "the hook's own statement of what it proves has changed"
        );
    }
}
