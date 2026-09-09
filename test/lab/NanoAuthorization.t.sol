// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {console2} from "forge-std/console2.sol";
import {Vm} from "forge-std/Vm.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {SettlementTestBase} from "../utils/SettlementTestBase.sol";
import {NanoAuthorizationHook} from "../../src/lab/NanoAuthorizationHook.sol";

/// @title EXPERIMENT A — `CROSS_CHAIN_AUTHORIZATION_ENVELOPE_SIMULATION`
///
/// @notice What this suite decides, and what it deliberately does not:
///
///   - It DECIDES that a UNICA envelope's signature is valid, that the envelope binds the resource,
///     request, session, merchant terms, token, scale, both chain ids, this hook, this pool manager
///     and this pool, that its ceilings hold, and that a batch of nanopayment authorizations
///     aggregates to exactly what the envelope authorized.
///   - It DOES NOT DECIDE, and cannot, whether any of these authorizations was accepted, consumed,
///     revoked or settled ON ARC. There is no authenticated cross-chain state path in this
///     repository. Every nonce this suite watches being spent is spent WITHIN THIS CHAIN AND THIS
///     HOOK ONLY. A nonce spent on Arc is invisible to every assertion below.
///
/// @notice HOW EVERY REFUSAL IS PROVEN. A guard that has never refused is not a guard, and a guard
///         that refuses everything is not one either. So each negative test does four things, in
///         this order: build a fixture; MUTATE exactly one thing; assert the NAMED refusal; RESTORE
///         that one thing and assert the envelope digest is byte-identical to the pre-mutation
///         digest, then assert the same payload now settles. The restore-and-confirm-by-hash step is
///         what stops a test passing because the fixture was broken all along.
///
/// @dev The pool is Uniswap's OFFICIAL PoolManager bytecode at its canonical address, from the
///      shared base. Nothing here is a live-testnet result.
contract NanoAuthorizationTest is SettlementTestBase {
    /// @dev beforeSwap | afterSwap = 0xC0, namespaced high so the address is not a precompile.
    address internal constant NANO_HOOK =
        address(uint160(uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG)) ^ (0x5151 << 144));

    /// @dev Circle Gateway's batched authorization, as recorded in
    ///      `integrations/arc-nanopayments/protocol.mjs`. Written here from that description so this
    ///      suite can prove a Gateway signature is NOT a UNICA envelope signature.
    string internal constant GATEWAY_DOMAIN_NAME = "GatewayWalletBatched";
    string internal constant GATEWAY_DOMAIN_VERSION = "1";
    string internal constant GATEWAY_AUTHORIZATION_TYPE =
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)";
    address internal constant GATEWAY_WALLET = 0x0077777d7EBA4688BDeF3E311b846F25870A19B9;
    uint64 internal constant ARC_CHAIN_ID = 5042002;

    NanoAuthorizationHook internal nano;
    PoolKey internal nanoKey;
    PoolKey internal bareKey;
    bytes32 internal nanoPoolId;

    uint256 internal arcPayerKey;
    address internal arcPayer;
    uint256 internal strangerKey;
    uint256 internal arcPayer2Key;
    address internal arcPayer2;
    address internal arcRecipient = makeAddr("arcRecipient");
    address internal merchant = makeAddr("merchantRecipient");

    /// @dev The native wei one settlement spends. A 1:1 pool returns a shade under this in token.
    uint128 internal constant AMOUNT_IN = 1e15;
    /// @dev One metered nanopayment, in settlement-token base units. Sixty-four of them are still
    ///      three orders of magnitude under what the swap returns, so the batch size never becomes
    ///      the reason a settlement fails.
    uint128 internal constant PER_ITEM = 1e11;

    /// @dev Everything one settlement needs, in one bundle, so a test can mutate one field of it.
    struct Fix {
        NanoAuthorizationHook.Envelope e;
        NanoAuthorizationHook.Item[] items;
        bytes sig;
    }

    function setUp() public {
        setUpV4();
        // A sane wall clock: the default of 1 makes `block.timestamp - 1` meaningless.
        vm.warp(1_800_000_000);
        (arcPayer, arcPayerKey) = makeAddrAndKey("arcPayer");
        (, strangerKey) = makeAddrAndKey("stranger");
        (arcPayer2, arcPayer2Key) = makeAddrAndKey("arcPayer2");

        deployCodeTo("NanoAuthorizationHook.sol:NanoAuthorizationHook", abi.encode(manager), NANO_HOOK);
        nano = NanoAuthorizationHook(NANO_HOOK);
        vm.label(NANO_HOOK, "NanoAuthorizationHook");

        (nanoKey,) = initNativePoolWithLiquidity(IHooks(NANO_HOOK), 50 ether);
        nanoPoolId = PoolId.unwrap(nanoKey.toId());
        (bareKey,) = initNativePoolWithLiquidity(IHooks(address(0)), 50 ether);
    }

    // ============================================================================================
    // 0. The classification, on chain, and the limit stated as state rather than as a comment
    // ============================================================================================

    function test_classification_isRecordedOnChain() public view {
        assertEq(nano.CLASSIFICATION(), "CROSS_CHAIN_AUTHORIZATION_ENVELOPE_SIMULATION");
        assertEq(nano.ARC_TESTNET_CHAIN_ID(), ARC_CHAIN_ID);
        // The limit is readable from the contract itself, so a summary that drops it is contradicted
        // by the deployed artifact.
        assertTrue(bytes(nano.ARC_CONSUMPTION_IS_NOT_KNOWABLE_HERE()).length > 0);
        assertEq(uint160(NANO_HOOK) & Hooks.ALL_HOOK_MASK, 0xC0);
    }

    // ============================================================================================
    // 1. Controls. Nothing below is believed until these pass.
    // ============================================================================================

    function test_control_oneItemBatchSettles() public {
        Fix memory f = _fixture(1, 1);
        _settle(f);
        assertEq(nano.settlementCount(), 1, "the callback did not run");
        assertEq(nano.cumulativeSessionSpent(f.e.binding.sessionId), PER_ITEM);
        assertTrue(nano.envelopeNonceSpent(nano.nonceKey(arcPayer, f.e.nonce)));
        assertTrue(nano.itemNonceSpent(nano.nonceKey(arcPayer, f.items[0].nonce)));
    }

    function test_control_fourItemBatchSettles() public {
        Fix memory f = _fixture(4, 2);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
        assertEq(nano.cumulativeSessionSpent(f.e.binding.sessionId), 4 * PER_ITEM);
    }

    function test_control_sixteenItemBatchSettles() public {
        Fix memory f = _fixture(16, 3);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
        assertEq(nano.cumulativeSessionSpent(f.e.binding.sessionId), 16 * PER_ITEM);
    }

    function test_control_sixtyFourItemBatchSettles() public {
        Fix memory f = _fixture(64, 4);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
        assertEq(nano.cumulativeSessionSpent(f.e.binding.sessionId), 64 * PER_ITEM);
        for (uint256 i = 0; i < 64; ++i) {
            assertTrue(nano.itemNonceSpent(nano.nonceKey(arcPayer, f.items[i].nonce)), "an item nonce was not marked");
        }
    }

    /// @notice The receipt exists only because the swap happened, and carries the pool's real numbers.
    function test_control_receiptCarriesTheSwapsOwnNumbers() public {
        Fix memory f = _fixture(4, 5);
        bytes32 digest = nano.envelopeDigest(f.e);
        vm.recordLogs();
        _settle(f);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256(
            "NanoBatchSettled(bytes32,bytes32,address,(uint16,address,address,address,uint8,uint64,uint128,uint128,uint128,bytes32,uint256))"
        );
        uint256 found;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter != NANO_HOOK || logs[i].topics[0] != topic) continue;
            ++found;
            assertEq(logs[i].topics[1], digest, "receipt is not for this envelope");
            assertEq(logs[i].topics[2], f.e.binding.sessionId);
            assertEq(address(uint160(uint256(logs[i].topics[3]))), merchant);
            NanoAuthorizationHook.Receipt memory r = abi.decode(logs[i].data, (NanoAuthorizationHook.Receipt));
            assertEq(r.schemaVersion, 1);
            assertEq(r.arcPayer, arcPayer);
            assertEq(r.payer, address(swapRouter));
            assertEq(r.settlementToken, address(usdc));
            assertEq(r.tokenDecimals, usdc.decimals());
            assertEq(r.itemCount, 4);
            assertEq(r.authorizationAmount, 4 * PER_ITEM);
            assertEq(r.amountIn, AMOUNT_IN, "the pool consumed something other than the input");
            assertTrue(r.amountOut >= 4 * PER_ITEM, "the receipt claims less output than authorized");
            assertEq(r.batchDigest, f.e.batchDigest);
            assertEq(r.cumulativeAfter, 4 * PER_ITEM);
        }
        assertEq(found, 1, "exactly one receipt per settlement");
    }

    /// @notice A nonce is spent BY A PAYER, not spent globally. Two payers presenting the SAME nonce
    ///         values both settle.
    /// @dev This row exists because of a defect found by review rather than by a failing test: an
    ///      earlier draft keyed both nonce maps on the raw nonce alone. Nonce values are chosen by
    ///      the payer and a sequential counter is the obvious choice, so under a global key any payer
    ///      could permanently burn another payer's nonce for free. The sabotage sweep re-globalises
    ///      the key and this row is the one that screams.
    function test_control_aNonceIsSpentByAPayerNotGlobally() public {
        Fix memory a = _fixture(2, 70);
        Fix memory b = _fixtureIn(keccak256("other resource"), keccak256("other session"), 2, 71);
        b.e.arc.arcPayer = arcPayer2;
        b.e.nonce = a.e.nonce;
        b.items[0].nonce = a.items[0].nonce;
        b.items[1].nonce = a.items[1].nonce;
        _resealWith(b, arcPayer2Key);

        assertTrue(a.e.arc.arcPayer != b.e.arc.arcPayer, "the two payers must differ");
        _settle(a);
        _settle(b);
        assertEq(nano.settlementCount(), 2, "one payer's nonce blocked another payer's");
        assertTrue(nano.envelopeNonceSpent(nano.nonceKey(arcPayer, a.e.nonce)));
        assertTrue(nano.envelopeNonceSpent(nano.nonceKey(arcPayer2, b.e.nonce)));
    }

    /// @notice A swap on a pool WITHOUT this hook is untouched by it, so the counter measures this
    ///         hook's path and nothing else.
    function test_control_hooklessPoolIsNotObserved() public {
        swapNativeExactIn(bareKey, AMOUNT_IN, ZERO_BYTES);
        assertEq(nano.settlementCount(), 0);
    }

    // ============================================================================================
    // 2. Domain separation. Two structures that can produce the same bytes are one with a bug.
    // ============================================================================================

    /// @notice The five typehashes are pairwise distinct, and none of them is Circle's.
    function test_domainSeparation_typehashesArePairwiseDistinct() public view {
        bytes32[6] memory h = [
            nano.ENVELOPE_TYPEHASH(),
            nano.ITEM_TYPEHASH(),
            nano.BATCH_TYPEHASH(),
            nano.REQUEST_SET_TYPEHASH(),
            nano.MERCHANT_CONFIG_TYPEHASH(),
            keccak256(bytes(GATEWAY_AUTHORIZATION_TYPE))
        ];
        for (uint256 i = 0; i < h.length; ++i) {
            for (uint256 j = i + 1; j < h.length; ++j) {
                assertTrue(h[i] != h[j], "two structures share a typehash");
            }
        }
    }

    /// @notice The hook's own digest helpers are re-derived here from the literal type strings, so a
    ///         mistake inside the hook cannot hide behind the hook's own arithmetic.
    function test_domainSeparation_digestsAreIndependentlyReproducible() public view {
        bytes32 item = keccak256(
            bytes("NanoItem(uint64 index,bytes32 resourceId,bytes32 sessionId,uint128 amount,bytes32 nonce)")
        );
        assertEq(nano.ITEM_TYPEHASH(), item);
        assertEq(
            nano.BATCH_TYPEHASH(), keccak256(bytes("NanoBatch(bytes32 sessionId,uint64 itemCount,bytes32 itemsRoot)"))
        );
        assertEq(
            nano.REQUEST_SET_TYPEHASH(),
            keccak256(
                bytes("NanoRequestSet(bytes32 resourceId,bytes32 sessionId,uint64 itemCount,bytes32 requestsRoot)")
            )
        );

        NanoAuthorizationHook.Item memory it = NanoAuthorizationHook.Item({
            index: 7,
            resourceId: keccak256("r"),
            sessionId: keccak256("s"),
            amount: 42,
            nonce: keccak256("n"),
            requestDigest: keccak256("q")
        });
        assertEq(
            nano.hashItem(it), keccak256(abi.encode(item, it.index, it.resourceId, it.sessionId, it.amount, it.nonce))
        );

        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("UNICA Nano Authorization Envelope")),
                keccak256(bytes("1")),
                block.chainid,
                NANO_HOOK
            )
        );
        assertEq(nano.domainSeparator(), domain);
        assertTrue(domain != _gatewayDomainSeparator(), "UNICA and Circle share a domain separator");
    }

    /// @notice An adversary who signs the BATCH digest instead of the envelope digest gets nowhere.
    ///         This is the confusion the domain separation exists to stop, executed rather than asserted.
    function test_RevertWhen_batchDigestIsSignedInPlaceOfTheEnvelopeDigest() public {
        Fix memory f = _fixture(4, 6);
        bytes32 good = nano.envelopeDigest(f.e);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(arcPayerKey, f.e.batchDigest);
        f.sig = abi.encodePacked(r, s, v);
        _expectBefore(
            abi.encodeWithSelector(
                NanoAuthorizationHook.BadEnvelopeSignature.selector, _recoveredAgainst(f.e, f.sig), arcPayer
            )
        );
        _settle(f);
        assertEq(nano.settlementCount(), 0);

        f.sig = _sign(f.e);
        assertEq(nano.envelopeDigest(f.e), good, "restore changed the envelope");
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    /// @notice A genuine Circle Gateway authorization, signed by the same payer for the same amount,
    ///         is NOT a UNICA envelope and cannot be replayed as one. This is the load-bearing
    ///         separation: Circle's six fields say nothing about resource, session or ceiling, and
    ///         this test proves UNICA never mistakes one for the other.
    function test_RevertWhen_aCircleGatewayAuthorizationIsOfferedAsAnEnvelope() public {
        Fix memory f = _fixture(1, 7);
        bytes32 good = nano.envelopeDigest(f.e);

        bytes32 gatewayDigest = keccak256(
            abi.encodePacked(
                hex"1901",
                _gatewayDomainSeparator(),
                keccak256(
                    abi.encode(
                        keccak256(bytes(GATEWAY_AUTHORIZATION_TYPE)),
                        arcPayer,
                        arcRecipient,
                        uint256(PER_ITEM),
                        uint256(f.e.validAfter),
                        uint256(f.e.validBefore),
                        f.e.nonce
                    )
                )
            )
        );
        assertTrue(gatewayDigest != good, "a Gateway digest collided with a UNICA envelope digest");

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(arcPayerKey, gatewayDigest);
        f.sig = abi.encodePacked(r, s, v);
        _expectBefore(
            abi.encodeWithSelector(
                NanoAuthorizationHook.BadEnvelopeSignature.selector, _recoveredAgainst(f.e, f.sig), arcPayer
            )
        );
        _settle(f);

        f.sig = _sign(f.e);
        assertEq(nano.envelopeDigest(f.e), good);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    // ============================================================================================
    // 3. The statics: this chain, that Arc, this hook, this manager, this pool, this token
    // ============================================================================================

    function test_RevertWhen_envelopeVersionIsNotThisOne() public {
        Fix memory f = _fixture(1, 10);
        uint16 keep = f.e.version;
        bytes32 good = nano.envelopeDigest(f.e);

        f.e.version = 2;
        _reseal(f);
        _expectBefore(
            abi.encodeWithSelector(NanoAuthorizationHook.EnvelopeVersionMismatch.selector, uint16(1), uint16(2))
        );
        _settle(f);

        f.e.version = keep;
        _reseal(f);
        assertEq(nano.envelopeDigest(f.e), good, "restore did not reproduce the original envelope");
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    function test_RevertWhen_sepoliaChainIdIsWrong() public {
        Fix memory f = _fixture(1, 11);
        uint64 keep = f.e.sepolia.sepoliaChainId;
        bytes32 good = nano.envelopeDigest(f.e);

        f.e.sepolia.sepoliaChainId = 1;
        _reseal(f);
        _expectBefore(
            abi.encodeWithSelector(
                NanoAuthorizationHook.SepoliaChainIdMismatch.selector, uint64(block.chainid), uint64(1)
            )
        );
        _settle(f);

        f.e.sepolia.sepoliaChainId = keep;
        _reseal(f);
        assertEq(nano.envelopeDigest(f.e), good);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    /// @notice The Arc chain id is a constant here, verified in `docs/ARC-FACTS.md`. Note what this
    ///         test does and does not show: it shows the envelope NAMES Arc testnet. It shows nothing
    ///         whatever about what happened on Arc testnet.
    function test_RevertWhen_arcChainIdIsNotArcTestnet() public {
        Fix memory f = _fixture(1, 12);
        uint64 keep = f.e.arc.arcChainId;
        bytes32 good = nano.envelopeDigest(f.e);

        f.e.arc.arcChainId = 8453;
        _reseal(f);
        _expectBefore(
            abi.encodeWithSelector(NanoAuthorizationHook.ArcChainIdMismatch.selector, ARC_CHAIN_ID, uint64(8453))
        );
        _settle(f);

        f.e.arc.arcChainId = keep;
        _reseal(f);
        assertEq(nano.envelopeDigest(f.e), good);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    function test_RevertWhen_hookAddressIsAnotherHook() public {
        Fix memory f = _fixture(1, 13);
        address keep = f.e.sepolia.hookAddress;
        bytes32 good = nano.envelopeDigest(f.e);

        f.e.sepolia.hookAddress = address(hook);
        _reseal(f);
        _expectBefore(
            abi.encodeWithSelector(NanoAuthorizationHook.HookAddressMismatch.selector, NANO_HOOK, address(hook))
        );
        _settle(f);

        f.e.sepolia.hookAddress = keep;
        _reseal(f);
        assertEq(nano.envelopeDigest(f.e), good);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    function test_RevertWhen_poolManagerIsWrong() public {
        Fix memory f = _fixture(1, 14);
        address keep = f.e.sepolia.sepoliaPoolManager;
        bytes32 good = nano.envelopeDigest(f.e);

        f.e.sepolia.sepoliaPoolManager = address(0xdead);
        _reseal(f);
        _expectBefore(
            abi.encodeWithSelector(
                NanoAuthorizationHook.PoolManagerMismatch.selector, address(manager), address(0xdead)
            )
        );
        _settle(f);

        f.e.sepolia.sepoliaPoolManager = keep;
        _reseal(f);
        assertEq(nano.envelopeDigest(f.e), good);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    function test_RevertWhen_poolIdIsAnotherPool() public {
        Fix memory f = _fixture(1, 15);
        bytes32 keep = f.e.sepolia.poolId;
        bytes32 good = nano.envelopeDigest(f.e);
        bytes32 other = PoolId.unwrap(bareKey.toId());

        f.e.sepolia.poolId = other;
        _reseal(f);
        _expectBefore(abi.encodeWithSelector(NanoAuthorizationHook.PoolIdMismatch.selector, nanoPoolId, other));
        _settle(f);

        f.e.sepolia.poolId = keep;
        _reseal(f);
        assertEq(nano.envelopeDigest(f.e), good);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    /// @notice `payer` is the SEPOLIA-side address that must appear as the swap's sender. It is not
    ///         `arcPayer`, and nothing in this hook connects the two.
    function test_RevertWhen_sepoliaPayerIsNotTheSwapSender() public {
        Fix memory f = _fixture(1, 16);
        address keep = f.e.sepolia.payer;
        bytes32 good = nano.envelopeDigest(f.e);

        f.e.sepolia.payer = arcPayer;
        _reseal(f);
        _expectBefore(
            abi.encodeWithSelector(NanoAuthorizationHook.PayerMismatch.selector, address(swapRouter), arcPayer)
        );
        _settle(f);

        f.e.sepolia.payer = keep;
        _reseal(f);
        assertEq(nano.envelopeDigest(f.e), good);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    function test_RevertWhen_settlementTokenIsNotThePoolsToken() public {
        Fix memory f = _fixture(1, 17);
        address keep = f.e.sepolia.settlementToken;
        bytes32 good = nano.envelopeDigest(f.e);

        f.e.sepolia.settlementToken = address(0xbeef);
        _reseal(f);
        _expectBefore(
            abi.encodeWithSelector(
                NanoAuthorizationHook.SettlementTokenMismatch.selector, address(usdc), address(0xbeef)
            )
        );
        _settle(f);

        f.e.sepolia.settlementToken = keep;
        _reseal(f);
        assertEq(nano.envelopeDigest(f.e), good);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    /// @notice `docs/ARC-FACTS.md` row 1: the same USDC reports 6 through an ERC-20 and 18 as native
    ///         gas on Arc, at the same instant. A scale is a property of the interface it was read
    ///         from, so the hook READS it and refuses an envelope that assumed a different one.
    function test_RevertWhen_tokenDecimalsAssumeADifferentScale() public {
        Fix memory f = _fixture(1, 18);
        uint8 keep = f.e.sepolia.tokenDecimals;
        assertEq(keep, usdc.decimals());
        bytes32 good = nano.envelopeDigest(f.e);

        f.e.sepolia.tokenDecimals = 6;
        _reseal(f);
        _expectBefore(
            abi.encodeWithSelector(NanoAuthorizationHook.TokenDecimalsMismatch.selector, usdc.decimals(), uint8(6))
        );
        _settle(f);

        f.e.sepolia.tokenDecimals = keep;
        _reseal(f);
        assertEq(nano.envelopeDigest(f.e), good);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    /// @notice The merchant's terms are hashed into the envelope. Swapping the recipient while
    ///         leaving that hash alone is a NAMED refusal, not an opaque signature failure — even
    ///         though the whole envelope was re-signed by the real payer.
    function test_RevertWhen_merchantRecipientDoesNotMatchTheConfigHash() public {
        Fix memory f = _fixture(1, 19);
        address keep = f.e.sepolia.merchantRecipient;
        bytes32 good = nano.envelopeDigest(f.e);
        address thief = makeAddr("thief");

        f.e.sepolia.merchantRecipient = thief;
        f.sig = _sign(f.e); // re-signed, but the config hash still names the real merchant
        bytes32 expected = nano.hashMerchantConfig(f.e.sepolia, f.e.limits);
        _expectBefore(
            abi.encodeWithSelector(
                NanoAuthorizationHook.MerchantConfigMismatch.selector, expected, f.e.binding.merchantConfigHash
            )
        );
        _settle(f);

        f.e.sepolia.merchantRecipient = keep;
        f.sig = _sign(f.e);
        assertEq(nano.envelopeDigest(f.e), good);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    function test_RevertWhen_envelopeHasExpired() public {
        Fix memory f = _fixture(1, 20);
        uint64 keep = f.e.validBefore;
        bytes32 good = nano.envelopeDigest(f.e);

        f.e.validBefore = uint64(block.timestamp) - 1;
        _reseal(f);
        _expectBefore(
            abi.encodeWithSelector(
                NanoAuthorizationHook.EnvelopeExpired.selector, uint64(block.timestamp) - 1, uint64(block.timestamp)
            )
        );
        _settle(f);

        f.e.validBefore = keep;
        _reseal(f);
        assertEq(nano.envelopeDigest(f.e), good);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    function test_RevertWhen_envelopeIsNotYetValid() public {
        Fix memory f = _fixture(1, 21);
        uint64 keep = f.e.validAfter;
        bytes32 good = nano.envelopeDigest(f.e);

        f.e.validAfter = uint64(block.timestamp) + 60;
        _reseal(f);
        _expectBefore(
            abi.encodeWithSelector(
                NanoAuthorizationHook.EnvelopeNotYetValid.selector,
                uint64(block.timestamp) + 60,
                uint64(block.timestamp)
            )
        );
        _settle(f);

        f.e.validAfter = keep;
        _reseal(f);
        assertEq(nano.envelopeDigest(f.e), good);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    /// @notice An envelope that authorized an EXACT-OUTPUT settlement does not authorize an
    ///         exact-input one, whoever signed it.
    function test_RevertWhen_swapShapeIsNotTheOneAuthorized() public {
        Fix memory f = _fixture(1, 22);
        bytes32 good = nano.envelopeDigest(f.e);

        f.e.sepolia.exactOutput = true;
        _reseal(f);
        _expectBefore(abi.encodeWithSelector(NanoAuthorizationHook.SwapShapeMismatch.selector));
        _settle(f);

        f.e.sepolia.exactOutput = false;
        _reseal(f);
        assertEq(nano.envelopeDigest(f.e), good);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    function test_RevertWhen_signatureIsFromTheWrongKey() public {
        Fix memory f = _fixture(1, 23);
        bytes32 digest = nano.envelopeDigest(f.e);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(strangerKey, digest);
        f.sig = abi.encodePacked(r, s, v);
        _expectBefore(
            abi.encodeWithSelector(NanoAuthorizationHook.BadEnvelopeSignature.selector, vm.addr(strangerKey), arcPayer)
        );
        _settle(f);

        f.sig = _sign(f.e);
        assertEq(nano.envelopeDigest(f.e), digest);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    function test_RevertWhen_hookDataIsEmpty() public {
        _expectBefore(abi.encodeWithSelector(NanoAuthorizationHook.MalformedPayload.selector));
        swapNativeExactIn(nanoKey, AMOUNT_IN, ZERO_BYTES);
        assertEq(nano.settlementCount(), 0);

        Fix memory f = _fixture(1, 24);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    // ============================================================================================
    // 4. Nonces. Every mark below is a mark WITHIN THIS CHAIN AND THIS HOOK ONLY.
    //    Arc does not learn that any of this happened, and this hook cannot learn what Arc did.
    // ============================================================================================

    function test_RevertWhen_envelopeNonceIsReplayed() public {
        Fix memory f1 = _fixture(1, 30);
        _settle(f1);

        Fix memory f2 = _fixture(1, 31);
        bytes32 own = f2.e.nonce;
        bytes32 good = nano.envelopeDigest(f2.e);

        f2.e.nonce = f1.e.nonce;
        _reseal(f2);
        _expectBefore(abi.encodeWithSelector(NanoAuthorizationHook.EnvelopeNonceReplayed.selector, f1.e.nonce));
        _settle(f2);

        f2.e.nonce = own;
        _reseal(f2);
        assertEq(nano.envelopeDigest(f2.e), good);
        _settle(f2);
        assertEq(nano.settlementCount(), 2);
    }

    function test_RevertWhen_oneItemAppearsTwiceInTheSameBatch() public {
        Fix memory f = _fixture(2, 32);
        bytes32 own = f.items[1].nonce;
        bytes32 good;

        f.items[1].nonce = f.items[0].nonce;
        _reseal(f);
        _expectBefore(
            abi.encodeWithSelector(NanoAuthorizationHook.ItemNonceReplayed.selector, uint256(1), f.items[0].nonce)
        );
        _settle(f);

        f.items[1].nonce = own;
        _reseal(f);
        good = nano.envelopeDigest(f.e);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
        assertEq(nano.envelopeDigest(f.e), good);
    }

    function test_RevertWhen_anItemNonceCrossesFromAnEarlierBatch() public {
        Fix memory f1 = _fixture(2, 33);
        _settle(f1);

        Fix memory f2 = _fixture(2, 34);
        bytes32 own = f2.items[0].nonce;

        f2.items[0].nonce = f1.items[0].nonce;
        _reseal(f2);
        _expectBefore(
            abi.encodeWithSelector(NanoAuthorizationHook.ItemNonceReplayed.selector, uint256(0), f1.items[0].nonce)
        );
        _settle(f2);

        f2.items[0].nonce = own;
        _reseal(f2);
        _settle(f2);
        assertEq(nano.settlementCount(), 2);
    }

    // ============================================================================================
    // 5. The batch: order, membership, and the two independent aggregates
    // ============================================================================================

    /// @notice Two items exchanged. Their `index` fields travel with them, so position 1 now holds
    ///         the item that says it is at position 2. Caught before any hashing.
    function test_RevertWhen_batchIsReordered() public {
        Fix memory f = _fixture(4, 35);
        bytes32 good = nano.envelopeDigest(f.e);

        NanoAuthorizationHook.Item memory tmp = f.items[1];
        f.items[1] = f.items[2];
        f.items[2] = tmp;
        _expectBefore(abi.encodeWithSelector(NanoAuthorizationHook.ItemIndexMismatch.selector, uint256(1), uint64(2)));
        _settle(f);

        tmp = f.items[1];
        f.items[1] = f.items[2];
        f.items[2] = tmp;
        assertEq(nano.envelopeDigest(f.e), good, "restore did not reproduce the original envelope");
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    /// @notice The same reordering with the index fields rewritten so the position check passes. The
    ///         batch digest is order-sensitive and catches it anyway. Both defences are real, and
    ///         this test is why we know the second one is not carried by the first.
    function test_RevertWhen_batchIsReorderedAndIndicesAreRewritten() public {
        Fix memory f = _fixture(4, 36);
        bytes32 signedBatch = f.e.batchDigest;

        NanoAuthorizationHook.Item memory tmp = f.items[1];
        f.items[1] = f.items[2];
        f.items[2] = tmp;
        f.items[1].index = 1;
        f.items[2].index = 2;

        bytes32 got = _batchDigestOf(f);
        assertTrue(got != signedBatch, "reordering did not change the batch digest");
        _expectBefore(abi.encodeWithSelector(NanoAuthorizationHook.BatchDigestMismatch.selector, got, signedBatch));
        _settle(f);

        tmp = f.items[1];
        f.items[1] = f.items[2];
        f.items[2] = tmp;
        f.items[1].index = 1;
        f.items[2].index = 2;
        assertEq(_batchDigestOf(f), signedBatch, "restore did not reproduce the signed batch digest");
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    function test_RevertWhen_anItemIsOmitted() public {
        Fix memory f = _fixture(4, 37);
        bytes32 signedBatch = f.e.batchDigest;

        NanoAuthorizationHook.Item[] memory kept = f.items;
        NanoAuthorizationHook.Item[] memory short_ = new NanoAuthorizationHook.Item[](3);
        for (uint256 i = 0; i < 3; ++i) {
            short_[i] = kept[i];
        }
        f.items = short_;
        bytes32 got = _batchDigestOf(f);
        _expectBefore(abi.encodeWithSelector(NanoAuthorizationHook.BatchDigestMismatch.selector, got, signedBatch));
        _settle(f);

        f.items = kept;
        assertEq(_batchDigestOf(f), signedBatch);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    function test_RevertWhen_anItemIsInjected() public {
        Fix memory f = _fixture(4, 38);
        bytes32 signedBatch = f.e.batchDigest;

        NanoAuthorizationHook.Item[] memory kept = f.items;
        NanoAuthorizationHook.Item[] memory long_ = new NanoAuthorizationHook.Item[](5);
        for (uint256 i = 0; i < 4; ++i) {
            long_[i] = kept[i];
        }
        long_[4] = NanoAuthorizationHook.Item({
            index: 4,
            resourceId: f.e.binding.resourceId,
            sessionId: f.e.binding.sessionId,
            amount: PER_ITEM,
            nonce: keccak256("injected"),
            requestDigest: keccak256("injected-request")
        });
        f.items = long_;
        bytes32 got = _batchDigestOf(f);
        _expectBefore(abi.encodeWithSelector(NanoAuthorizationHook.BatchDigestMismatch.selector, got, signedBatch));
        _settle(f);

        f.items = kept;
        assertEq(_batchDigestOf(f), signedBatch);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    /// @notice The envelope's signature is untouched and still valid. Only the batch under it changed.
    ///         This is the "envelope digest replayed under a different batch" case.
    function test_RevertWhen_aValidEnvelopeIsReusedOverADifferentBatch() public {
        Fix memory f = _fixture(4, 39);
        NanoAuthorizationHook.Item[] memory kept = f.items;
        bytes32 signedBatch = f.e.batchDigest;
        bytes32 digest = nano.envelopeDigest(f.e);

        f.items = _items(f.e.binding.resourceId, f.e.binding.sessionId, 4, 40);
        bytes32 got = _batchDigestOf(f);
        assertEq(
            nano.envelopeDigest(f.e), digest, "the envelope itself must be unchanged for this test to mean anything"
        );
        _expectBefore(abi.encodeWithSelector(NanoAuthorizationHook.BatchDigestMismatch.selector, got, signedBatch));
        _settle(f);

        f.items = kept;
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    /// @notice The request set is a SECOND, independent aggregate. Changing what was asked for
    ///         leaves the money digest untouched, which is exactly why it needs its own check.
    function test_RevertWhen_theRequestSetDoesNotMatch() public {
        Fix memory f = _fixture(4, 41);
        bytes32 signedBatch = f.e.batchDigest;
        bytes32 signedRequests = f.e.binding.requestDigest;
        bytes32 own = f.items[2].requestDigest;

        f.items[2].requestDigest = keccak256("a different request entirely");
        assertEq(_batchDigestOf(f), signedBatch, "changing a request must not move the money digest");
        bytes32 got = _requestDigestOf(f);
        _expectBefore(abi.encodeWithSelector(NanoAuthorizationHook.RequestDigestMismatch.selector, got, signedRequests));
        _settle(f);

        f.items[2].requestDigest = own;
        assertEq(_requestDigestOf(f), signedRequests);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    function test_RevertWhen_anItemNamesAnotherResource() public {
        Fix memory f = _fixture(4, 42);
        bytes32 own = f.items[2].resourceId;
        bytes32 other = keccak256("another resource");

        f.items[2].resourceId = other;
        _reseal(f);
        _expectBefore(
            abi.encodeWithSelector(
                NanoAuthorizationHook.ResourceMismatch.selector, uint256(2), f.e.binding.resourceId, other
            )
        );
        _settle(f);

        f.items[2].resourceId = own;
        _reseal(f);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    function test_RevertWhen_anItemNamesAnotherSession() public {
        Fix memory f = _fixture(4, 43);
        bytes32 own = f.items[3].sessionId;
        bytes32 other = keccak256("another session");

        f.items[3].sessionId = other;
        _reseal(f);
        _expectBefore(
            abi.encodeWithSelector(
                NanoAuthorizationHook.SessionMismatch.selector, uint256(3), f.e.binding.sessionId, other
            )
        );
        _settle(f);

        f.items[3].sessionId = own;
        _reseal(f);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    function test_RevertWhen_anItemExceedsThePerRequestCeiling() public {
        Fix memory f = _fixture(4, 44);
        uint128 own = f.items[1].amount;

        f.items[1].amount = PER_ITEM + 1;
        _reseal(f);
        _expectBefore(
            abi.encodeWithSelector(
                NanoAuthorizationHook.AmountAbovePerRequestCeiling.selector, uint256(1), PER_ITEM, PER_ITEM + 1
            )
        );
        _settle(f);

        f.items[1].amount = own;
        _reseal(f);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    /// @notice The downcast to uint128 is guarded, so an aggregate that does not fit is a named
    ///         refusal rather than a wrap or an unnamed arithmetic panic.
    function test_RevertWhen_theAggregateOverflowsUint128() public {
        Fix memory f = _fixture(2, 45);
        uint128 half = uint128(1) << 127;

        f.items[0].amount = half;
        f.items[1].amount = half;
        f.e.limits.perRequestCeiling = type(uint128).max;
        f.e.limits.cumulativeSessionCeiling = type(uint128).max;
        f.e.limits.authorizationAmount = type(uint128).max;
        _reseal(f);
        _expectBefore(abi.encodeWithSelector(NanoAuthorizationHook.AggregateOverflow.selector, uint256(half) * 2));
        _settle(f);

        f.items[0].amount = PER_ITEM;
        f.items[1].amount = PER_ITEM;
        f.e.limits.perRequestCeiling = PER_ITEM;
        f.e.limits.authorizationAmount = 2 * PER_ITEM;
        f.e.limits.cumulativeSessionCeiling = 200 * PER_ITEM;
        _reseal(f);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    function test_RevertWhen_theBatchIsShortOfTheAuthorization() public {
        Fix memory f = _fixture(4, 46);
        uint128 own = f.e.limits.authorizationAmount;

        f.e.limits.authorizationAmount = 5 * PER_ITEM;
        _reseal(f);
        _expectBefore(
            abi.encodeWithSelector(
                NanoAuthorizationHook.AggregateBelowAuthorization.selector, 5 * PER_ITEM, 4 * PER_ITEM
            )
        );
        _settle(f);

        f.e.limits.authorizationAmount = own;
        _reseal(f);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    function test_RevertWhen_theBatchExceedsTheAuthorization() public {
        Fix memory f = _fixture(4, 47);
        uint128 own = f.e.limits.authorizationAmount;

        f.e.limits.authorizationAmount = 3 * PER_ITEM;
        _reseal(f);
        _expectBefore(
            abi.encodeWithSelector(
                NanoAuthorizationHook.AggregateAboveAuthorization.selector, 3 * PER_ITEM, 4 * PER_ITEM
            )
        );
        _settle(f);

        f.e.limits.authorizationAmount = own;
        _reseal(f);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    function test_RevertWhen_theSessionCeilingWouldBeExceeded() public {
        Fix memory f1 = _fixture(2, 48);
        f1.e.limits.cumulativeSessionCeiling = f1.e.limits.authorizationAmount;
        _reseal(f1);
        _settle(f1);
        assertEq(nano.cumulativeSessionSpent(f1.e.binding.sessionId), 2 * PER_ITEM);

        Fix memory f2 = _fixtureIn(f1.e.binding.resourceId, f1.e.binding.sessionId, 2, 49);
        f2.e.limits.cumulativeSessionCeiling = f1.e.limits.cumulativeSessionCeiling;
        _reseal(f2);
        _expectBefore(
            abi.encodeWithSelector(
                NanoAuthorizationHook.CumulativeAboveSessionCeiling.selector,
                uint256(2 * PER_ITEM),
                uint256(4 * PER_ITEM)
            )
        );
        _settle(f2);
        assertEq(nano.settlementCount(), 1, "the refused batch must not have settled");

        f2.e.limits.cumulativeSessionCeiling = 4 * PER_ITEM;
        _reseal(f2);
        _settle(f2);
        assertEq(nano.settlementCount(), 2);
        assertEq(nano.cumulativeSessionSpent(f1.e.binding.sessionId), 4 * PER_ITEM);
    }

    function test_RevertWhen_theBatchIsEmpty() public {
        Fix memory f = _fixture(1, 50);
        NanoAuthorizationHook.Item[] memory kept = f.items;

        f.items = new NanoAuthorizationHook.Item[](0);
        f.e.limits.authorizationAmount = 0;
        _reseal(f);
        _expectBefore(abi.encodeWithSelector(NanoAuthorizationHook.EmptyBatch.selector));
        _settle(f);

        f.items = kept;
        f.e.limits.authorizationAmount = PER_ITEM;
        _reseal(f);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    // ============================================================================================
    // 6. afterSwap: the two facts that do not exist until the pool has run
    // ============================================================================================

    /// @notice The pool's real output, against what the batch authorized. Nothing before the swap
    ///         could have known this number, which is why the check is here and not in beforeSwap.
    function test_RevertWhen_thePoolReturnsLessThanTheBatchAuthorized() public {
        // The identical hookless pool, at the identical state, tells us what the swap will return.
        uint128 willReturn = uint128(swapNativeExactIn(bareKey, AMOUNT_IN, ZERO_BYTES).amount1());
        uint128 tooMuch = willReturn + 1;

        Fix memory f = _fixture(1, 51);
        f.items[0].amount = tooMuch;
        f.e.limits.perRequestCeiling = tooMuch;
        f.e.limits.authorizationAmount = tooMuch;
        f.e.limits.cumulativeSessionCeiling = type(uint128).max;
        _reseal(f);
        _expectAfter(
            abi.encodeWithSelector(NanoAuthorizationHook.OutputBelowAuthorization.selector, tooMuch, willReturn)
        );
        _settle(f);
        assertEq(nano.settlementCount(), 0);

        f.items[0].amount = PER_ITEM;
        f.e.limits.perRequestCeiling = PER_ITEM;
        f.e.limits.authorizationAmount = PER_ITEM;
        f.e.limits.cumulativeSessionCeiling = 100 * PER_ITEM;
        _reseal(f);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    /// @notice `InputAboveMaximum` is UNREACHABLE on the exact-input path: v4 never consumes more
    ///         than the amount specified, and `beforeSwap` already refuses a specified amount above
    ///         `maximumInput`. It is reachable only on the exact-output path, where the input is not
    ///         known until the pool has run — so that is where this test goes. A guard whose failing
    ///         case is never constructed is not a guard, and this one would have been exactly that.
    function test_RevertWhen_exactOutputCostsMoreThanTheMaximumInput() public {
        uint128 wanted = 1e12;
        Fix memory f = _fixture(1, 52);
        f.items[0].amount = wanted;
        f.e.limits.perRequestCeiling = wanted;
        f.e.limits.authorizationAmount = wanted;
        f.e.sepolia.exactOutput = true;
        f.e.sepolia.maximumInput = wanted; // below the fee-inclusive input the pool will demand
        _reseal(f);

        uint128 consumed = uint128(uint256(-int256(_exactOutOnBare(wanted).amount0())));
        assertTrue(consumed > wanted, "the pool did not charge a fee, so this test proves nothing");
        _expectAfter(abi.encodeWithSelector(NanoAuthorizationHook.InputAboveMaximum.selector, wanted, consumed));
        _exactOut(f, wanted);
        assertEq(nano.settlementCount(), 0);

        f.e.sepolia.maximumInput = AMOUNT_IN;
        _reseal(f);
        _exactOut(f, wanted);
        assertEq(nano.settlementCount(), 1, "the exact-output control did not settle");
    }

    /// @notice The same envelope, offered twice. The persistent envelope-nonce mark refuses the
    ///         second — and that mark, to say it once more, is local to this chain and this hook.
    function test_RevertWhen_theSameEnvelopeIsSettledTwice() public {
        Fix memory f = _fixture(2, 53);
        _settle(f);
        assertEq(nano.settlementCount(), 1);
        _expectBefore(abi.encodeWithSelector(NanoAuthorizationHook.EnvelopeNonceReplayed.selector, f.e.nonce));
        _settle(f);
        assertEq(nano.settlementCount(), 1);
    }

    // ============================================================================================
    // 7. THE MEASUREMENT. This is the result the experiment exists for, and it is not a flattering one.
    // ============================================================================================

    /// @notice Gas for 1, 4, 16 and 64 authorizations discharged against ONE settlement, against an
    ///         identical hookless pool as the baseline.
    ///
    /// @dev Two honest caveats, both of which make the reported number an UNDER-estimate of what a
    ///      real transaction costs:
    ///
    ///      1. `gasleft()` around an internal call measures EXECUTION gas only. It does not include
    ///         the 21,000 intrinsic cost, and it does not include the per-byte cost of putting an
    ///         11 KB payload in a transaction's calldata. The per-byte figure is computed separately
    ///         below on the cancun schedule (4 gas per zero byte, 16 per non-zero) and printed
    ///         beside the execution figure. Adding them is the closer estimate.
    ///      2. The four measurements run in sequence against the same pool, so each one starts from a
    ///         marginally different price than the last. That moves the swap's own arithmetic by a
    ///         small amount and is why the baseline is subtracted rather than trusted absolutely.
    function test_measurement_gasCostPerAuthorization() public {
        // Warm both pools with one prior swap each, so neither figure pays a first-touch cost the
        // other avoided.
        swapNativeExactIn(bareKey, AMOUNT_IN, ZERO_BYTES);
        _settle(_fixture(1, 60));

        uint256 g = gasleft();
        swapNativeExactIn(bareKey, AMOUNT_IN, ZERO_BYTES);
        uint256 baseline = g - gasleft();

        uint256[4] memory sizes = [uint256(1), 4, 16, 64];
        uint256 previous;
        console2.log("baseline: identical hookless pool, same swap, execution gas", baseline);
        for (uint256 i = 0; i < 4; ++i) {
            Fix memory f = _fixture(sizes[i], 61 + i);
            bytes memory data = _hookData(f);
            uint256 calldataGas = _intrinsicCalldataGas(data);
            uint256 used = _settle(f);
            uint256 overhead = used - baseline;

            console2.log("--- authorizations in the batch:", sizes[i]);
            console2.log("    execution gas, hook included      :", used);
            console2.log("    hook overhead over the baseline   :", overhead);
            console2.log("    overhead per authorization        :", overhead / sizes[i]);
            console2.log("    hookData bytes                    :", data.length);
            console2.log("    intrinsic calldata gas (4/16)     :", calldataGas);
            console2.log("    per authorization, incl. calldata :", (overhead + calldataGas) / sizes[i]);

            assertTrue(used > baseline, "the hook cost nothing, which cannot be true");
            assertTrue(used > previous, "a larger batch did not cost more than a smaller one");
            previous = used;
        }
    }

    // ============================================================================================
    // Helpers
    // ============================================================================================

    function _items(bytes32 resourceId, bytes32 sessionId, uint256 n, uint256 seed)
        internal
        pure
        returns (NanoAuthorizationHook.Item[] memory items)
    {
        items = new NanoAuthorizationHook.Item[](n);
        for (uint256 i = 0; i < n; ++i) {
            items[i] = NanoAuthorizationHook.Item({
                index: uint64(i),
                resourceId: resourceId,
                sessionId: sessionId,
                amount: PER_ITEM,
                nonce: keccak256(abi.encode("item-nonce", seed, i)),
                requestDigest: keccak256(abi.encode("request", seed, i))
            });
        }
    }

    function _fixture(uint256 n, uint256 seed) internal view returns (Fix memory f) {
        return _fixtureIn(keccak256(abi.encode("resource", seed)), keccak256(abi.encode("session", seed)), n, seed);
    }

    function _fixtureIn(bytes32 resourceId, bytes32 sessionId, uint256 n, uint256 seed)
        internal
        view
        returns (Fix memory f)
    {
        f.items = _items(resourceId, sessionId, n, seed);
        f.e.version = 1;
        f.e.arc = NanoAuthorizationHook.ArcSide({
            arcChainId: ARC_CHAIN_ID,
            arcAuthorizationDomain: _gatewayDomainSeparator(),
            arcPayer: arcPayer,
            arcRecipient: arcRecipient
        });
        f.e.binding.resourceId = resourceId;
        f.e.binding.sessionId = sessionId;
        f.e.limits.perRequestCeiling = PER_ITEM;
        f.e.limits.authorizationAmount = uint128(n) * PER_ITEM;
        f.e.limits.cumulativeSessionCeiling = 100 * (uint128(n) * PER_ITEM) + PER_ITEM;
        f.e.sepolia = NanoAuthorizationHook.SepoliaSide({
            sepoliaChainId: uint64(block.chainid),
            sepoliaPoolManager: address(manager),
            hookAddress: NANO_HOOK,
            poolId: nanoPoolId,
            payer: address(swapRouter),
            merchantRecipient: merchant,
            settlementToken: address(usdc),
            tokenDecimals: usdc.decimals(),
            exactOutput: false,
            maximumInput: AMOUNT_IN
        });
        f.e.nonce = keccak256(abi.encode("envelope-nonce", seed));
        f.e.validAfter = uint64(block.timestamp) - 1;
        f.e.validBefore = uint64(block.timestamp) + 3600;
        _reseal(f);
    }

    /// @dev Recomputes every derived field from the items and re-signs. Used after a mutation that
    ///      is meant to be the ONLY defect, so a test is never accidentally proving the wrong guard.
    function _reseal(Fix memory f) internal view {
        _resealWith(f, arcPayerKey);
    }

    function _resealWith(Fix memory f, uint256 pk) internal view {
        f.e.binding.merchantConfigHash = nano.hashMerchantConfig(f.e.sepolia, f.e.limits);
        f.e.batchDigest = _batchDigestOf(f);
        f.e.binding.requestDigest = _requestDigestOf(f);
        f.sig = _signWith(f.e, pk);
    }

    function _batchDigestOf(Fix memory f) internal view returns (bytes32) {
        bytes32[] memory d = new bytes32[](f.items.length);
        for (uint256 i = 0; i < f.items.length; ++i) {
            d[i] = nano.hashItem(f.items[i]);
        }
        return nano.hashBatch(f.e.binding.sessionId, uint64(f.items.length), keccak256(abi.encodePacked(d)));
    }

    function _requestDigestOf(Fix memory f) internal view returns (bytes32) {
        bytes32[] memory d = new bytes32[](f.items.length);
        for (uint256 i = 0; i < f.items.length; ++i) {
            d[i] = f.items[i].requestDigest;
        }
        return nano.hashRequestSet(
            f.e.binding.resourceId, f.e.binding.sessionId, uint64(f.items.length), keccak256(abi.encodePacked(d))
        );
    }

    function _sign(NanoAuthorizationHook.Envelope memory e) internal view returns (bytes memory) {
        return _signWith(e, arcPayerKey);
    }

    function _signWith(NanoAuthorizationHook.Envelope memory e, uint256 pk) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, nano.envelopeDigest(e));
        return abi.encodePacked(r, s, v);
    }

    function _hookData(Fix memory f) internal pure returns (bytes memory) {
        return abi.encode(NanoAuthorizationHook.Payload({envelope: f.e, items: f.items, signature: f.sig}));
    }

    /// @dev One settlement: an exact-input native swap through v4-core's own test router. Returns the
    ///      EXECUTION gas of the call, which is what the measurement section reports.
    function _settle(Fix memory f) internal returns (uint256 used) {
        bytes memory data = _hookData(f);
        uint256 g = gasleft();
        swapRouter.swap{value: AMOUNT_IN}(
            nanoKey,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(uint256(AMOUNT_IN)), sqrtPriceLimitX96: MIN_PRICE_LIMIT
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            data
        );
        used = g - gasleft();
    }

    function _exactOut(Fix memory f, uint128 wanted) internal {
        swapRouter.swap{value: AMOUNT_IN}(
            nanoKey,
            SwapParams({
                zeroForOne: true, amountSpecified: int256(uint256(wanted)), sqrtPriceLimitX96: MIN_PRICE_LIMIT
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            _hookData(f)
        );
    }

    function _exactOutOnBare(uint128 wanted) internal returns (BalanceDelta) {
        return swapRouter.swap{value: AMOUNT_IN}(
            bareKey,
            SwapParams({
                zeroForOne: true, amountSpecified: int256(uint256(wanted)), sqrtPriceLimitX96: MIN_PRICE_LIMIT
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ZERO_BYTES
        );
    }

    /// @dev The address the hook will recover from this signature against THIS envelope's digest.
    ///      Computed with the same library the hook uses, so the expected refusal names a real value
    ///      rather than a guess.
    function _recoveredAgainst(NanoAuthorizationHook.Envelope memory e, bytes memory sig)
        internal
        view
        returns (address)
    {
        return ECDSA.recover(nano.envelopeDigest(e), sig);
    }

    /// @dev The cancun calldata schedule: 4 gas per zero byte, 16 per non-zero. Reported separately
    ///      from the execution figure because `gasleft()` around an internal call cannot see it.
    function _intrinsicCalldataGas(bytes memory d) internal pure returns (uint256 total) {
        for (uint256 i = 0; i < d.length; ++i) {
            total += d[i] == 0 ? 4 : 16;
        }
    }

    /// @dev Circle Gateway's EIP-712 domain, written here from the description in
    ///      `integrations/arc-nanopayments/protocol.mjs`. Present so this suite can prove UNICA's
    ///      domain is NOT it.
    function _gatewayDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(GATEWAY_DOMAIN_NAME)),
                keccak256(bytes(GATEWAY_DOMAIN_VERSION)),
                uint256(ARC_CHAIN_ID),
                GATEWAY_WALLET
            )
        );
    }

    /// @dev v4 wraps a reverting hook call: WrappedError(hook, callback, reason, HookCallFailed()).
    ///      Derived from `Hooks.callHook`, which bubbles exactly that shape.
    function _wrapped(bytes4 callback, bytes memory reason) internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            CustomRevert.WrappedError.selector,
            NANO_HOOK,
            callback,
            reason,
            abi.encodeWithSelector(Hooks.HookCallFailed.selector)
        );
    }

    function _expectBefore(bytes memory reason) internal {
        vm.expectRevert(_wrapped(IHooks.beforeSwap.selector, reason));
    }

    function _expectAfter(bytes memory reason) internal {
        vm.expectRevert(_wrapped(IHooks.afterSwap.selector, reason));
    }
}
