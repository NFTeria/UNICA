// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IQuoteSettlement} from "../../src/v2/interfaces/IQuoteSettlement.sol";
import {MerchantConfig} from "../../src/v2/MerchantConfig.sol";
import {QuoteSettlementExecutor} from "../../src/v2/QuoteSettlementExecutor.sol";
import {QuoteSigning} from "./util/QuoteSigning.sol";

/// @title The client tool and the contracts agree, on one vector, field by field
/// @notice `tools/unica-sign/` builds and hashes everything a merchant or a payer signs, written
///         from the EIP-712 specification in JavaScript. This file re-derives the same values in
///         Solidity. Neither was written from the other, and a disagreement here is a signature a
///         real wallet would produce and the chain would reject.
///
///         The vector is not invented: it is the quote `test/fork/V2ForkSettlement.t.sol` actually
///         settles, so `QUOTE_DIGEST` below is the digest a real settlement against the pinned
///         Sepolia fork produced. Three independent things now agree on it — this file, the
///         JavaScript tool, and a settlement that happened.
contract SigningVectorsTest is QuoteSigning {
    uint256 internal constant CHAIN_ID = 11155111;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant EXECUTOR = 0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f;
    address internal constant HOOK = 0xdD1FD0c33FEF7434443df2031f1E5e2e80dA60c0;
    address internal constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address internal constant WETH9 = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address internal constant MERCHANT = 0xd1948520eCC70CFD26c23D2528272c017dAAA256;
    address internal constant PAYER = 0x14aa1c8aEB544A744624a5B9956F3318b468dC94;
    address internal constant RECIPIENT = 0xa50802FBcAfc5aF3D0093026d301a82ec341652a;

    uint256 internal constant MAX_IN = 1e18;
    uint256 internal constant AMOUNT_OUT = 100e6;
    uint256 internal constant DEADLINE = 2_000_000_000;
    uint256 internal constant NONCE = 0;

    /// @dev PINNED from `tools/unica-sign/vectors.json`.
    bytes32 internal constant POOL_KEY_HASH = 0x47ee6fdc24658bdb15909b92c42242aebcf1272dbb4ead31ff085c1e4bfa5455;
    bytes32 internal constant QUOTE_STRUCT_HASH = 0x8f1830ce1d8e7e44506742ba719ec0429de742ac0e86c76c04d055c33cb6ceec;
    bytes32 internal constant UNICA_DOMAIN = 0x39d622e8be85aa5546ae7ac84fbd4a18be5d05fe9036f2236abaceea726fae1d;
    bytes32 internal constant QUOTE_DIGEST = 0xba644671b7e407bd6af89a092fa14debd857b2eb26ab3639dd723991de90e5dd;
    bytes32 internal constant PAYMENT_WITNESS = 0x352b8c1d3512cd0181e0ceccf26afb1023c3818b9e1d56a57b6cc402ea1669d7;
    bytes32 internal constant PERMIT2_DOMAIN = 0x94c1dec87927751697bfc9ebf6fc4ca506bed30308b518f0e9d6c5f74bbafdb8;
    bytes32 internal constant PERMIT_DIGEST = 0xb50e8ef95e170463737fd74c5ea510c605388a6ba19b9f7581a50c91ad3afe07;
    bytes32 internal constant CALLDATA_HASH = 0x9071010d4431c21d894ba00c5adcddfbb1d030a9800876550c8fd1da59d3498e;
    uint256 internal constant CALLDATA_LENGTH = 1060;

    /// @dev Filler, not signatures. Fixed length so the calldata encoding is deterministic, and no
    ///      key is involved anywhere in this repository's test material.
    bytes internal merchantFiller;
    bytes internal payerFiller;

    function setUp() public {
        vm.chainId(CHAIN_ID);
        merchantFiller = _repeat(hex"ab", 65);
        payerFiller = _repeat(hex"cd", 65);
    }

    function _quote() internal pure returns (IQuoteSettlement.Quote memory) {
        return IQuoteSettlement.Quote({
            version: 1,
            quoteId: bytes32("fork-1"),
            merchantSigner: MERCHANT,
            payer: PAYER,
            recipient: RECIPIENT,
            tokenIn: WETH9,
            maxIn: MAX_IN,
            tokenOut: USDC,
            amountOut: AMOUNT_OUT,
            pool: PoolKey({
                currency0: Currency.wrap(USDC),
                currency1: Currency.wrap(WETH9),
                fee: 3000,
                tickSpacing: 60,
                hooks: IHooks(HOOK)
            }),
            zeroForOne: false,
            deadline: DEADLINE,
            hook: HOOK,
            executor: EXECUTOR,
            merchantConfigHash: MerchantConfig.hash(_merchantConfig()),
            policyVersion: 1
        });
    }

    /// @dev The resolution the fork quote commits to, as a real preimage rather than a word with
    ///      nothing behind it. It used to be `keccak256("fork merchant config")`, which meant no
    ///      verifier could ever be handed the configuration a fork receipt had committed to —
    ///      the gap `docs/v2/COMPATIBILITY-001.md` reported and `tools/unica-verify` closes.
    function _merchantConfig() internal pure returns (MerchantConfig.Config memory) {
        return MerchantConfig.Config({
            version: 1,
            namehash: FORK_NAMEHASH,
            name: "fork-merchant.eth",
            recipient: RECIPIENT,
            payoutCurrency: USDC,
            chainId: CHAIN_ID,
            resolvedAtBlock: 11656000,
            validForBlocks: 50000
        });
    }

    /// @dev Derived offline by `web/ensv2/resolve.mjs`, pinned here, and recomputed in Solidity
    ///      below. Two derivations of one commitment, exactly as `test/v2/MerchantConfig.t.sol`
    ///      does for its own vector.
    bytes32 internal constant FORK_NAMEHASH = 0x7825d40d6800e28bd1018984ac9d649c39174be745a90021a4dd67d50d072639;

    /// @dev PINNED from `integrations/ensv2/config.mjs`, and recomputed here. Two derivations of
    ///      one commitment, written from the EIP-712 specification rather than from each other.
    bytes32 internal constant CONFIG_HASH = 0x4e05349f968fea00fd20f1ac52e7529637453bcb24cf41641abb9c694a11bc85;

    function test_Vectors_TheMerchantConfigurationCommitmentAgrees() public pure {
        assertEq(
            MerchantConfig.hash(_merchantConfig()),
            CONFIG_HASH,
            "the on-chain and offline derivations of the merchant configuration disagree"
        );
    }

    function _ctx() internal pure returns (AuthContext memory) {
        return AuthContext({
            permit2: PERMIT2,
            manager: POOL_MANAGER,
            executor: EXECUTOR,
            nonce: NONCE,
            deadline: DEADLINE,
            signerKey: 1 // never used: every row below asserts a DIGEST, not a signature
        });
    }

    // ---- the merchant's half ------------------------------------------------------------

    function test_Vectors_ThePoolKeyHashAgrees() public view {
        IQuoteSettlement.Quote memory q = _quote();
        bytes32 got = keccak256(
            abi.encode(
                LOCAL_POOL_KEY_TYPEHASH,
                Currency.unwrap(q.pool.currency0),
                Currency.unwrap(q.pool.currency1),
                q.pool.fee,
                q.pool.tickSpacing,
                address(q.pool.hooks)
            )
        );
        assertEq(got, POOL_KEY_HASH, "the client tool and Solidity disagree about the pool key hash");
    }

    function test_Vectors_TheQuoteStructHashAgrees() public view {
        assertEq(_localHashQuote(_quote()), QUOTE_STRUCT_HASH, "the quote struct hashes disagree");
    }

    function test_Vectors_TheUnicaDomainAgrees() public view {
        assertEq(_domainFor(EXECUTOR), UNICA_DOMAIN, "the UNICA domain separators disagree");
    }

    /// @dev THE ONE THAT MATTERS MOST. Three independent things agree on this value: this file, the
    ///      JavaScript tool, and a settlement that actually ran on the pinned fork.
    function test_Vectors_TheQuoteDigestAgrees() public view {
        assertEq(_quoteDigestFor(EXECUTOR, _quote()), QUOTE_DIGEST, "the quote digests disagree");
    }

    // ---- the payer's half ----------------------------------------------------------------

    function test_Vectors_ThePaymentWitnessAgrees() public view {
        assertEq(_witnessFor(POOL_MANAGER, EXECUTOR, _quote()), PAYMENT_WITNESS, "the payment witnesses disagree");
    }

    function test_Vectors_ThePermit2DomainAgrees() public view {
        assertEq(_permit2DomainFor(PERMIT2), PERMIT2_DOMAIN, "the Permit2 domain separators disagree");
    }

    function test_Vectors_ThePermit2DigestAgrees() public view {
        assertEq(_permitDigestFor(_ctx(), _quote()), PERMIT_DIGEST, "the Permit2 signing digests disagree");
    }

    /// @dev The two domains must not be the same shape. Permit2's has no `version` member and
    ///      UNICA's does, and confusing them is the single easiest way to produce a digest that
    ///      nothing will accept.
    function test_Vectors_TheTwoDomainsAreDifferent() public view {
        assertTrue(_domainFor(PERMIT2) != _permit2DomainFor(PERMIT2), "the two domain constructions collide");
    }

    // ---- the transaction -------------------------------------------------------------------

    function test_Vectors_TheSettleSelectorAgrees() public pure {
        assertEq(QuoteSettlementExecutor.settle.selector, bytes4(0x7b65b825), "the settle selector moved");
    }

    /// @dev The client tool's own ABI encoder, checked against Solidity's. `abi.encodeCall` is the
    ///      reference; a hand-written encoder that agrees with it byte for byte is one a wallet can
    ///      use to build a transaction nobody has to trust it about.
    function test_Vectors_TheSettleCalldataAgrees() public view {
        QuoteSettlementExecutor.PayerAuthorization memory auth =
            QuoteSettlementExecutor.PayerAuthorization({nonce: NONCE, deadline: DEADLINE, signature: payerFiller});
        bytes memory encoded = abi.encodeCall(QuoteSettlementExecutor.settle, (_quote(), merchantFiller, auth));

        assertEq(encoded.length, CALLDATA_LENGTH, "the calldata lengths disagree");
        assertEq(keccak256(encoded), CALLDATA_HASH, "the client tool builds different calldata than Solidity");
        assertEq(bytes4(encoded), QuoteSettlementExecutor.settle.selector, "the calldata does not begin with settle");
    }

    function _repeat(bytes1 b, uint256 n) internal pure returns (bytes memory out) {
        out = new bytes(n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = b;
        }
    }
}
