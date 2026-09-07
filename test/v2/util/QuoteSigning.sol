// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IQuoteSettlement} from "../../../src/v2/interfaces/IQuoteSettlement.sol";
import {QuoteSettlementExecutor} from "../../../src/v2/QuoteSettlementExecutor.sol";

/// @title The merchant's and the payer's digests, derived once for every suite that needs them
/// @notice Written from the EIP-712 specification and Permit2's documented type strings, NOT from
///         the contracts they are compared against. That is the whole point: a test that asks the
///         contract for the digest and then signs whatever comes back cannot discover that both
///         are wrong, and a wrong digest is rejected in a payer's wallet rather than here.
///
/// @dev Every function takes the addresses it needs rather than reading fields, so the local
///      fixture and the fork fixture share one description of the encoding instead of two that can
///      drift. Two hand-maintained copies of one type string is a mismatch waiting to happen.
abstract contract QuoteSigning is Test {
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

    // ---- the merchant's half -------------------------------------------------------------

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

    function _domainFor(address executor_) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("UNICA"),
                keccak256("2"),
                block.chainid,
                executor_
            )
        );
    }

    function _quoteDigestFor(address executor_, IQuoteSettlement.Quote memory q) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _domainFor(executor_), _localHashQuote(q)));
    }

    function _signQuoteFor(address executor_, IQuoteSettlement.Quote memory q, uint256 key_)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key_, _quoteDigestFor(executor_, q));
        return abi.encodePacked(r, s, v);
    }

    // ---- the payer's half ----------------------------------------------------------------

    /// @dev `destination` is the PoolManager, and it is inside the witness even though Permit2 does
    ///      not enforce a destination — which is exactly why it is here. Gate 0 measured Permit2
    ///      accepting a transfer to an attacker without the payer's signature objecting.
    function _witnessFor(address manager_, address executor_, IQuoteSettlement.Quote memory q)
        internal
        pure
        returns (bytes32)
    {
        return
            keccak256(abi.encode(LOCAL_PAYMENT_TYPEHASH, q.quoteId, q.payer, q.tokenIn, q.maxIn, manager_, executor_));
    }

    function _witnessTypeString() internal pure returns (string memory) {
        return string.concat(
            "Payment witness)",
            "Payment(bytes32 quoteId,address payer,address tokenIn,uint256 maxIn,address destination,address executor)",
            "TokenPermissions(address token,uint256 amount)"
        );
    }

    function _permit2DomainFor(address permit2_) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
                keccak256("Permit2"),
                block.chainid,
                permit2_
            )
        );
    }

    struct AuthContext {
        address permit2;
        address manager;
        address executor;
        uint256 nonce;
        uint256 deadline;
        uint256 signerKey;
    }

    function _authorizeFor(AuthContext memory ctx, IQuoteSettlement.Quote memory q)
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
        bytes32 structHash = keccak256(
            abi.encode(
                typeHash,
                tokenPermissions,
                ctx.executor,
                ctx.nonce,
                ctx.deadline,
                _witnessFor(ctx.manager, ctx.executor, q)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _permit2DomainFor(ctx.permit2), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ctx.signerKey, digest);
        return QuoteSettlementExecutor.PayerAuthorization({
            nonce: ctx.nonce, deadline: ctx.deadline, signature: abi.encodePacked(r, s, v)
        });
    }
}
