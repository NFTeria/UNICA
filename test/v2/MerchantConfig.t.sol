// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IQuoteSettlement} from "../../src/v2/interfaces/IQuoteSettlement.sol";
import {MerchantConfig} from "../../src/v2/MerchantConfig.sol";
import {QuoteSettlementExecutor} from "../../src/v2/QuoteSettlementExecutor.sol";
import {SettlementFixture} from "./util/SettlementFixture.sol";

/// @dev Reverts on every call, including a staticcall with no data. Etched at the ENSv2 resolver's
///      address so a settlement that touched it would die loudly.
contract AlwaysReverts {
    fallback() external payable {
        revert("this address must never be called during a settlement");
    }
}

/// @title GATE 4 — the resolved merchant is part of what the merchant signed
/// @notice Without this, `recipient` in a quote is an address a payer was shown and has to trust.
///         With it, the name, its namehash, the address it resolved to, the payout currency, the
///         chain and the block the reading was taken at are all inside the merchant's signature.
///         Change any of them and the signature no longer fits — which is what should happen when
///         the thing the payer was shown is no longer the thing being settled.
///
///         The commitment is derived twice: once in `src/v2/MerchantConfig.sol` and once offline in
///         `integrations/ensv2/config.mjs`, written from the EIP-712 specification rather than from
///         each other. A digest a wallet computes differently from the contract is rejected in the
///         wallet, not here.
contract MerchantConfigTest is SettlementFixture {
    uint256 internal constant AMOUNT_OUT = 1e9;
    uint256 internal constant MAX_IN = 10 ether;

    /// @dev The ENSv2 Universal Resolver on Sepolia. Named here only so a row can prove nothing
    ///      calls it.
    address internal constant ENSV2_RESOLVER = 0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe;

    /// @dev PINNED from `integrations/ensv2/config.mjs` for the vector built below. Solidity
    ///      recomputes it and the two must agree.
    bytes32 internal constant OFFLINE_NAMEHASH = 0x4899a704a642409872099476ec1fb6ea80e9bcab30bf25152e9741136c413653;
    bytes32 internal constant OFFLINE_CONFIG_HASH = 0x95b1d38dea10da6126bc066c3ecfb41ba3c151800b94404bf0f4f800143d8f73;

    address internal constant VECTOR_RECIPIENT = 0x9E11000000000000000000000000000000000001;
    address internal constant VECTOR_PAYOUT = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function setUp() public {
        _setUpSettlement();
    }

    function _config() internal pure returns (MerchantConfig.Config memory) {
        return MerchantConfig.Config({
            version: 1,
            namehash: OFFLINE_NAMEHASH,
            name: "merchant.eth",
            recipient: VECTOR_RECIPIENT,
            payoutCurrency: VECTOR_PAYOUT,
            chainId: 11155111,
            resolvedAtBlock: 11640026,
            validForBlocks: 300
        });
    }

    // ---- two derivations of one commitment -----------------------------------------------

    function test_Config_TheOfflineAndOnchainDerivationsAgree() public view {
        assertEq(MerchantConfig.hash(_config()), OFFLINE_CONFIG_HASH, "the commitments disagree");
        assertEq(executor.hashMerchantConfig(_config()), OFFLINE_CONFIG_HASH, "the executor disagrees with both");
    }

    /// @dev THE FIELD WIDTHS, at both ends of every one of them. The vector above exercises one
    ///      plausible configuration; these exercise the ENCODING. A `uint64` written as a `uint256`
    ///      or an address padded on the wrong side agrees with the offline encoder on ordinary
    ///      values and disagrees here, which is the only place it would ever be caught.
    ///
    ///      Both are computed by `integrations/ensv2/config.mjs` and pinned. The all-zero vector
    ///      is not decoration: it is the row that goes red if a field is DROPPED, because
    ///      `abi.encode` loses a word and the hash moves even though every value is zero.
    bytes32 internal constant AT_THE_LIMITS = 0x6a8f77b04ab9535939df8f18fa0468d9d890d30b6e550695bed109e15799e2b3;
    bytes32 internal constant ALL_ZERO = 0xc5ae8f73ad7c28222f697ad64095eb9863057ed9bd155bbd2658a31e9d97c621;

    function test_Config_EveryFieldAtItsMaximumAgreesWithTheOfflineEncoder() public view {
        MerchantConfig.Config memory c = MerchantConfig.Config({
            version: type(uint8).max,
            namehash: bytes32(type(uint256).max),
            name: "",
            recipient: address(type(uint160).max),
            payoutCurrency: address(0),
            chainId: type(uint256).max,
            resolvedAtBlock: type(uint64).max,
            validForBlocks: type(uint32).max
        });
        assertEq(MerchantConfig.hash(c), AT_THE_LIMITS, "the encoders disagree at the field widths");
        assertEq(executor.hashMerchantConfig(c), AT_THE_LIMITS, "the executor disagrees with both");
    }

    function test_Config_EveryFieldAtZeroAgreesWithTheOfflineEncoder() public view {
        MerchantConfig.Config memory c = MerchantConfig.Config({
            version: 0,
            namehash: bytes32(0),
            name: "",
            recipient: address(0),
            payoutCurrency: address(0),
            chainId: 0,
            resolvedAtBlock: 0,
            validForBlocks: 0
        });
        assertEq(MerchantConfig.hash(c), ALL_ZERO, "the encoders disagree on an empty configuration");
        assertTrue(ALL_ZERO != AT_THE_LIMITS, "the two boundary vectors collided");
    }

    /// @dev The type string, compared with the one the offline encoder is written against. A hash
    ///      that agrees on one vector does not establish that two implementations share a SCHEMA;
    ///      two type strings differing in a field name can agree by coincidence of what was tested.
    ///      `integrations/ensv2/test.mjs` reads this same literal out of the source and compares it
    ///      the other way round, so neither side is trusted to describe itself.
    function test_Config_TheTypeStringIsTheOneTheOfflineEncoderUses() public pure {
        assertEq(
            MerchantConfig.CONFIG_TYPE,
            "MerchantConfig(uint8 version,bytes32 namehash,string name,address recipient,"
            "address payoutCurrency,uint256 chainId,uint64 resolvedAtBlock,uint32 validForBlocks)",
            "the canonical type string moved"
        );
        assertEq(
            MerchantConfig.CONFIG_TYPEHASH,
            keccak256(bytes(MerchantConfig.CONFIG_TYPE)),
            "the typehash is not the hash of the type string"
        );
    }

    // ---- every component is inside the commitment ------------------------------------------

    /// @dev One row per field. A component outside the hash is a component somebody can change
    ///      between the screen a payer read and the invoice a merchant signed.
    function test_Config_EveryComponentMovesTheCommitment() public pure {
        bytes32 base = MerchantConfig.hash(_config());

        MerchantConfig.Config memory c = _config();
        c.version = 2;
        assertTrue(MerchantConfig.hash(c) != base, "the configuration version is not in the commitment");

        c = _config();
        c.namehash = keccak256("another.eth");
        assertTrue(MerchantConfig.hash(c) != base, "the namehash is not in the commitment");

        c = _config();
        c.name = "merchant2.eth";
        assertTrue(MerchantConfig.hash(c) != base, "the normalised name is not in the commitment");

        c = _config();
        c.recipient = address(0xBAD1);
        assertTrue(MerchantConfig.hash(c) != base, "THE RESOLVED RECIPIENT is not in the commitment");

        c = _config();
        c.payoutCurrency = address(0xBAD2);
        assertTrue(MerchantConfig.hash(c) != base, "the payout currency is not in the commitment");

        c = _config();
        c.chainId = 1;
        assertTrue(MerchantConfig.hash(c) != base, "the chain is not in the commitment");

        c = _config();
        c.resolvedAtBlock = 11640027;
        assertTrue(MerchantConfig.hash(c) != base, "the resolution block is not in the commitment");

        c = _config();
        c.validForBlocks = 301;
        assertTrue(MerchantConfig.hash(c) != base, "the expiry policy is not in the commitment");
    }

    /// @dev And the commitment is inside what the merchant signs, so all of the above reaches the
    ///      signature rather than stopping at a struct nobody checks.
    function test_Config_TheCommitmentIsInsideTheQuoteDigest() public view {
        IQuoteSettlement.Quote memory q = _quote(bytes32("bound"), AMOUNT_OUT, MAX_IN);
        q.merchantConfigHash = MerchantConfig.hash(_config());
        bytes32 withOriginal = _quoteDigest(q);

        MerchantConfig.Config memory moved = _config();
        moved.recipient = address(0xBAD1);
        q.merchantConfigHash = MerchantConfig.hash(moved);

        assertTrue(_quoteDigest(q) != withOriginal, "an altered ENS recipient does not move the quote digest");
    }

    /// @dev A quote signed against one resolution cannot be settled after the commitment changed.
    ///      This is the whole mechanism, end to end: the merchant signs a reading, the reading
    ///      changes, and the signature stops fitting.
    function test_Config_AQuoteSignedAgainstOneResolutionDoesNotSettleAnother() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("resolved"), AMOUNT_OUT, MAX_IN);
        q.merchantConfigHash = MerchantConfig.hash(_config());
        bytes memory signedForTheOldReading = _signQuoteAs(q, merchantKey);

        // the ENS record changed, so the checkout resolves again and commits to the new reading
        MerchantConfig.Config memory fresh = _config();
        fresh.recipient = address(0xBAD1);
        fresh.resolvedAtBlock = 11640400;
        q.merchantConfigHash = MerchantConfig.hash(fresh);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(IQuoteSettlement.WrongMerchantSignature.selector, q.quoteId));
        executor.settle(q, signedForTheOldReading, _auth(q, 0));
    }

    /// @dev The expiry policy, which is off-chain by construction and says so. A settlement never
    ///      sees this struct, only its hash, so nothing on chain can check the window; what
    ///      protects a payer is that a fresh reading is a different commitment.
    function test_Config_TheFreshnessWindowIsInclusiveAndClosed() public pure {
        MerchantConfig.Config memory c = _config();
        assertTrue(MerchantConfig.isFresh(c, 11640026), "a reading is not fresh at the block it was taken");
        assertTrue(MerchantConfig.isFresh(c, 11640326), "the last block of the window is not fresh");
        assertFalse(MerchantConfig.isFresh(c, 11640327), "a reading past its window is still fresh");
        assertFalse(MerchantConfig.isFresh(c, 11640025), "a reading is fresh before it was taken");
    }

    // ---- nothing in the settlement path resolves a name ------------------------------------

    /// @dev Proven, not asserted in prose. A contract that reverts on EVERY call — including a
    ///      staticcall with no data — is etched at the ENSv2 Universal Resolver's address, and a
    ///      full settlement runs anyway. An on-chain lookup inside a settlement would be a new
    ///      trust assumption, a new failure mode, and a call a hostile resolver could make
    ///      expensive or simply revert.
    function test_Config_NothingInASettlementCallsTheResolver() public {
        vm.etch(ENSV2_RESOLVER, address(new AlwaysReverts()).code);

        // the control: the trap works
        (bool ok,) = ENSV2_RESOLVER.call("");
        assertFalse(ok, "the trap does not revert, so this row proves nothing");

        IQuoteSettlement.Quote memory q = _quote(bytes32("noens"), AMOUNT_OUT, MAX_IN);
        q.merchantConfigHash = MerchantConfig.hash(_config());

        vm.prank(relayer);
        (, uint256 delivered) = executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 1));

        assertEq(delivered, AMOUNT_OUT, "the settlement did not complete with the resolver trapped");
        assertEq(tokenOut.balanceOf(recipient), AMOUNT_OUT, "the merchant was not paid");
    }

    function _auth(IQuoteSettlement.Quote memory q, uint256 nonce)
        internal
        view
        returns (QuoteSettlementExecutor.PayerAuthorization memory)
    {
        return _authorize(q, nonce, block.timestamp + 1 hours, payerKey);
    }
}
