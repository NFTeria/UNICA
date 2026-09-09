// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @dev The one thing this hook asks of the settlement token. Read, never assumed: `docs/ARC-FACTS.md`
///      records the same USDC reporting 6 through an ERC-20 and 18 as native gas on Arc, at the same
///      instant. A scale is a property of the interface it was read from.
interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

/// @title NanoAuthorizationHook — EXPERIMENT A, `CROSS_CHAIN_AUTHORIZATION_ENVELOPE_SIMULATION`
///
/// @notice ## WHAT THIS IS, AND THE THREE PROPERTIES IT SEPARATES
///
/// This hook aggregates a batch of bounded nanopayment authorizations and discharges the whole batch
/// against ONE Uniswap v4 settlement on this chain. It is a laboratory contract. It is not deployed,
/// not part of UNICA V1, and nothing in this repository depends on it.
///
/// Three properties are routinely collapsed into one sentence, and keeping them apart is the entire
/// point of this file:
///
/// 1. **SIGNATURE VALIDITY** — did the signer authorize a typed message? This hook CAN decide that.
///    ECDSA recovery over an EIP-712 digest is chain-agnostic arithmetic; it needs no counterparty.
///
/// 2. **RESOURCE / SESSION BINDING** — is that authorization tied to a resource, a request, a
///    session, a token, a recipient, ceilings and an expiry? This hook CAN enforce that, and does,
///    but ONLY because the complete envelope is handed to it in `hookData`. It enforces the
///    envelope it was given. It cannot go and fetch the envelope it should have been given.
///
/// 3. **ARC CONSUMPTION / SETTLEMENT** — was that authorization accepted, consumed, revoked or
///    settled on Arc? This hook **CANNOT** know this. Not by signature, not by envelope, not by any
///    amount of care taken here. Knowing it needs an authenticated cross-chain state path — a proven
///    Circle mechanism, a bridge or messaging protocol, an oracle attestation, or an independently
///    verified Arc state proof. **None of those exists in this repository, and none is used here.**
///
/// Therefore: **a nonce marked spent by this contract is spent WITHIN THIS CHAIN AND THIS HOOK ONLY.**
/// A nonce spent on Arc is invisible here. A nonce spent here is invisible on Arc. Any reader who
/// takes the `envelopeNonceSpent` / `itemNonceSpent` maps for cross-chain replay protection has been
/// misled, and this paragraph exists so that they cannot be.
///
/// Circle's Gateway authorization is untouched by any of this. It signs exactly six fields —
/// `from, to, value, validAfter, validBefore, nonce` (`integrations/arc-nanopayments/protocol.mjs`) —
/// and UNICA does not modify, extend or reinterpret it. The envelope below is a SEPARATE structure
/// that stands alongside it and covers what those six fields do not.
///
/// @notice ## THE TWO PAYERS ARE TWO DIFFERENT ACCOUNTS AND NOTHING HERE LINKS THEM
///
/// `arc.arcPayer` is the account whose key signs the envelope. `sepolia.payer` is the address that
/// must appear as the swap's `sender` — that is, the contract that called `PoolManager.swap`. They
/// are two addresses on two chains. This hook checks each of them against the envelope. It has no
/// mechanism whatever for proving they are the same principal, and does not claim to.
///
/// Likewise `sepolia.merchantRecipient`: v4 hands the swap's output delta to the swapper, not to a
/// named recipient, so this hook **cannot** enforce that the merchant received the funds. The field
/// is bound into the signature and into `merchantConfigHash`, and it is emitted in the receipt. That
/// is internal consistency of the envelope, not proof of payment to that address.
///
/// @notice ## WHICH CALLBACK ENFORCES WHAT, AND WHY
///
/// `beforeSwap` enforces everything that must refuse BEFORE value moves, plus everything that is
/// knowable without the swap's result: version, both chain ids, this hook's own address, the pool
/// manager, the pool id, the settlement token and the scale read from it, merchant-config
/// consistency, the validity window, the swap's shape and direction, the payer, the envelope
/// signature, then the batch walk — per-item resource, session, index, per-request ceiling and nonce
/// — then the two aggregate digests, the aggregate amount, and the session ceiling. If any of these
/// is wrong, no value has moved and none will.
///
/// `afterSwap` enforces the two things that DO NOT EXIST until the swap has run: how much input the
/// pool actually consumed (against `maximumInput`) and how much output it actually produced (against
/// `authorizationAmount`). A ceiling on money the pool has not yet quoted cannot be checked early;
/// checking it early would be checking a wish.
///
/// The split of the two WRITES is a cost decision, not a safety one, and is documented as such:
///   - Nonces are marked spent in `beforeSwap`, because that is where the batch is already being
///     walked, and walking 64 items twice would double the dominant cost of this contract.
///   - The session's cumulative spend is committed in `afterSwap`, because it is the number that
///     should only exist once value has moved.
/// Both writes live or die with the transaction — a revert in `afterSwap` unwinds the marks made in
/// `beforeSwap` — so neither placement is safer than the other. Saying so here is cheaper than
/// letting a future reader infer a safety property that is not there.
///
/// A second swap for the same envelope inside one transaction is refused by the envelope-nonce mark
/// itself, which is already persistent by the time the second `beforeSwap` runs. The transient slots
/// exist so `afterSwap` never re-decodes an 11 KB payload, not as a replay defence.
///
/// @dev Permissions are `beforeSwap | afterSwap`, mask `0xC0`. `BaseHook`'s constructor validates
///      that the deployed address carries exactly those bits.
contract NanoAuthorizationHook is BaseHook {
    using PoolIdLibrary for PoolKey;

    /// @notice The classification of this experiment, on chain, so it cannot be dropped in a summary.
    string public constant CLASSIFICATION = "CROSS_CHAIN_AUTHORIZATION_ENVELOPE_SIMULATION";

    /// @notice What this contract can decide, and what it provably cannot, as readable state.
    string public constant ARC_CONSUMPTION_IS_NOT_KNOWABLE_HERE = "This hook verifies signature validity and envelope binding. Whether the authorization was "
        "consumed, revoked or settled on Arc is NOT knowable from this chain and is not checked. "
        "Nonce marks here prevent replay within this chain and this hook only.";

    /// @notice Arc testnet's chain id, verified in `docs/ARC-FACTS.md` by `eth_chainId` (0x4cef52)
    ///         and by Circle's own `connect-to-arc` page. An envelope naming any other Arc is refused.
    /// @dev A constant, not configuration: this hook has no owner and nothing about it is settable.
    uint64 public constant ARC_TESTNET_CHAIN_ID = 5042002;

    /// @notice The only envelope layout this hook understands. A change to any type string below is
    ///         a new version, never an edit of this one.
    uint16 public constant ENVELOPE_VERSION = 1;

    /// @notice Receipt field layout. Same rule as the version above.
    uint16 public constant RECEIPT_SCHEMA_VERSION = 1;

    // --- EIP-712 type strings -------------------------------------------------------------------
    //
    // FIVE STRUCTURES, FIVE TYPEHASHES, AND THEY ARE NOT INTERCHANGEABLE. Each digest below begins
    // with a typehash that no other structure here uses, so no encoding of one can be read as
    // another. That is asserted by test, not by this comment: two structures that can produce the
    // same bytes are one structure with a bug.
    //
    // The envelope nests four sub-structures. That is EIP-712's own composition rule (referenced
    // types appended in alphabetical order: ArcSide, Binding, Limits, SepoliaSide) and it is what
    // keeps a twenty-six-field message out of `stack too deep`.

    string internal constant ARC_SIDE_TYPE =
        "ArcSide(uint64 arcChainId,bytes32 arcAuthorizationDomain,address arcPayer,address arcRecipient)";

    string internal constant BINDING_TYPE =
        "Binding(bytes32 resourceId,bytes32 requestDigest,bytes32 sessionId,bytes32 merchantConfigHash)";

    string internal constant LIMITS_TYPE =
        "Limits(uint128 cumulativeSessionCeiling,uint128 perRequestCeiling,uint128 authorizationAmount)";

    string internal constant SEPOLIA_SIDE_TYPE = "SepoliaSide(uint64 sepoliaChainId,address sepoliaPoolManager,address hookAddress,bytes32 poolId,"
        "address payer,address merchantRecipient,address settlementToken,uint8 tokenDecimals,bool exactOutput,"
        "uint128 maximumInput)";

    string internal constant ENVELOPE_TYPE = "Envelope(uint16 version,ArcSide arc,Binding binding,Limits limits,"
        "SepoliaSide sepolia,bytes32 batchDigest,bytes32 nonce,uint64 validAfter,uint64 validBefore)";

    bytes32 public constant ARC_SIDE_TYPEHASH = keccak256(bytes(ARC_SIDE_TYPE));
    bytes32 public constant BINDING_TYPEHASH = keccak256(bytes(BINDING_TYPE));
    bytes32 public constant LIMITS_TYPEHASH = keccak256(bytes(LIMITS_TYPE));
    bytes32 public constant SEPOLIA_SIDE_TYPEHASH = keccak256(bytes(SEPOLIA_SIDE_TYPE));

    /// @dev The envelope's own typehash is over the encodeType of the whole tree: the primary type
    ///      followed by every referenced type, alphabetically.
    bytes32 public constant ENVELOPE_TYPEHASH =
        keccak256(abi.encodePacked(ENVELOPE_TYPE, ARC_SIDE_TYPE, BINDING_TYPE, LIMITS_TYPE, SEPOLIA_SIDE_TYPE));

    /// @notice The per-item digest: WHAT WAS PAID. Position, resource, session, amount, nonce.
    bytes32 public constant ITEM_TYPEHASH =
        keccak256("NanoItem(uint64 index,bytes32 resourceId,bytes32 sessionId,uint128 amount,bytes32 nonce)");

    /// @notice The batch digest over those item digests, in order.
    bytes32 public constant BATCH_TYPEHASH =
        keccak256("NanoBatch(bytes32 sessionId,uint64 itemCount,bytes32 itemsRoot)");

    /// @notice A SECOND, independent aggregate over the same items: WHAT WAS ASKED FOR. Separating
    ///         money from content means a merchant can re-derive either one without holding the
    ///         other, and it gives the two failures distinct names.
    bytes32 public constant REQUEST_SET_TYPEHASH =
        keccak256("NanoRequestSet(bytes32 resourceId,bytes32 sessionId,uint64 itemCount,bytes32 requestsRoot)");

    /// @notice The merchant's frozen terms. `merchantConfigHash` in the envelope must equal this
    ///         hash of the envelope's own merchant fields, which makes a swapped recipient or a
    ///         raised ceiling a named refusal rather than an opaque signature failure.
    bytes32 public constant MERCHANT_CONFIG_TYPEHASH = keccak256(
        "MerchantConfig(address merchantRecipient,address settlementToken,uint8 tokenDecimals,"
        "uint128 cumulativeSessionCeiling,uint128 perRequestCeiling)"
    );

    /// @dev UNICA's own EIP-712 domain. Deliberately NOT Circle's `GatewayWalletBatched` domain: an
    ///      envelope digest and a Gateway authorization digest must never be confusable, and the
    ///      domain separator is the first thing that makes them not.
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    string public constant DOMAIN_NAME = "UNICA Nano Authorization Envelope";
    string public constant DOMAIN_VERSION = "1";

    // --- The envelope ---------------------------------------------------------------------------

    /// @notice The Arc half. Recorded and signed; NOT verified against Arc, because it cannot be.
    /// @param arcChainId          must equal `ARC_TESTNET_CHAIN_ID`.
    /// @param arcAuthorizationDomain the Circle Gateway domain separator this envelope stands beside.
    ///        Carried so a reader can tell which Gateway domain was in play. This hook does NOT
    ///        verify a Gateway authorization and does not attempt to.
    /// @param arcPayer            the signer of this envelope.
    /// @param arcRecipient        the Arc-side recipient. Never checked against anything on this chain.
    struct ArcSide {
        uint64 arcChainId;
        bytes32 arcAuthorizationDomain;
        address arcPayer;
        address arcRecipient;
    }

    /// @notice What the authorization is FOR.
    struct Binding {
        bytes32 resourceId;
        bytes32 requestDigest;
        bytes32 sessionId;
        bytes32 merchantConfigHash;
    }

    /// @notice The ceilings, in `settlementToken` base units at `tokenDecimals`.
    struct Limits {
        uint128 cumulativeSessionCeiling;
        uint128 perRequestCeiling;
        uint128 authorizationAmount;
    }

    /// @notice The half this chain can actually check.
    struct SepoliaSide {
        uint64 sepoliaChainId;
        address sepoliaPoolManager;
        address hookAddress;
        bytes32 poolId;
        address payer;
        address merchantRecipient;
        address settlementToken;
        uint8 tokenDecimals;
        bool exactOutput;
        uint128 maximumInput;
    }

    /// @notice Twenty-six fields, domain-separated, signed as one message by `arc.arcPayer`.
    struct Envelope {
        uint16 version;
        ArcSide arc;
        Binding binding;
        Limits limits;
        SepoliaSide sepolia;
        bytes32 batchDigest;
        bytes32 nonce;
        uint64 validAfter;
        uint64 validBefore;
    }

    /// @notice One metered nanopayment. `index` is its position; a batch whose items have moved has
    ///         items whose index no longer matches their position.
    struct Item {
        uint64 index;
        bytes32 resourceId;
        bytes32 sessionId;
        uint128 amount;
        bytes32 nonce;
        bytes32 requestDigest;
    }

    /// @notice What `hookData` carries. Decoded once, in `beforeSwap`.
    struct Payload {
        Envelope envelope;
        Item[] items;
        bytes signature;
    }

    // --- State ----------------------------------------------------------------------------------

    /// @notice Envelope nonces this hook has accepted, keyed by `nonceKey(arcPayer, nonce)`.
    ///         **SPENT WITHIN THIS CHAIN AND THIS HOOK ONLY.**
    mapping(bytes32 => bool) public envelopeNonceSpent;

    /// @notice Item nonces this hook has accepted, keyed by `nonceKey(arcPayer, nonce)`.
    ///         **SPENT WITHIN THIS CHAIN AND THIS HOOK ONLY.**
    mapping(bytes32 => bool) public itemNonceSpent;

    /// @notice Cumulative amount discharged per session, in settlement-token base units.
    mapping(bytes32 => uint256) public cumulativeSessionSpent;

    /// @notice Batches this hook has settled. Exists so a test can prove the callback actually ran:
    ///         a permission-bit mismatch fails silently and would leave this at zero.
    uint256 public settlementCount;

    /// @notice The receipt body. A struct rather than fourteen loose event parameters because the
    ///         legacy code generator runs out of stack at fourteen, and because a tuple is what an
    ///         indexer decodes anyway. `amountIn`/`amountOut` are the pool's actual numbers, not the
    ///         request's. `arcPayer` and `payer` are TWO DIFFERENT ACCOUNTS ON TWO DIFFERENT CHAINS
    ///         and this receipt does not assert they are the same principal.
    struct Receipt {
        uint16 schemaVersion;
        address arcPayer;
        address payer;
        address settlementToken;
        uint8 tokenDecimals;
        uint64 itemCount;
        uint128 authorizationAmount;
        uint128 amountIn;
        uint128 amountOut;
        bytes32 batchDigest;
        uint256 cumulativeAfter;
    }

    /// @notice Emitted from inside the swap that discharged the batch, so it exists only if the
    ///         swap happened. It records that a signed envelope was discharged HERE. It says nothing
    ///         about Arc, because nothing here can.
    event NanoBatchSettled(
        bytes32 indexed envelopeDigest, bytes32 indexed sessionId, address indexed merchantRecipient, Receipt receipt
    );

    // --- Refusals. Every one of them named, every one of them proven by a test with a control. ----

    error MalformedPayload();
    error EnvelopeVersionMismatch(uint16 expected, uint16 got);
    error SepoliaChainIdMismatch(uint64 expected, uint64 got);
    error ArcChainIdMismatch(uint64 expected, uint64 got);
    error HookAddressMismatch(address expected, address got);
    error PoolManagerMismatch(address expected, address got);
    error PoolIdMismatch(bytes32 expected, bytes32 got);
    error NativeInputRequired(address currency0);
    error SettlementTokenMismatch(address expected, address got);
    error TokenDecimalsMismatch(uint8 expected, uint8 got);
    error MerchantConfigMismatch(bytes32 expected, bytes32 got);
    error EnvelopeNotYetValid(uint64 validAfter, uint64 nowTs);
    error EnvelopeExpired(uint64 validBefore, uint64 nowTs);
    error SwapShapeMismatch();
    error PayerMismatch(address expected, address got);
    error BadEnvelopeSignature(address recovered, address arcPayer);
    error EnvelopeNonceReplayed(bytes32 nonce);
    error EmptyBatch();
    error ItemIndexMismatch(uint256 position, uint64 got);
    error ResourceMismatch(uint256 position, bytes32 expected, bytes32 got);
    error SessionMismatch(uint256 position, bytes32 expected, bytes32 got);
    error AmountAbovePerRequestCeiling(uint256 position, uint128 ceiling, uint128 amount);
    error ItemNonceReplayed(uint256 position, bytes32 nonce);
    error AggregateOverflow(uint256 total);
    error BatchDigestMismatch(bytes32 expected, bytes32 got);
    error RequestDigestMismatch(bytes32 expected, bytes32 got);
    error AggregateBelowAuthorization(uint128 authorized, uint128 aggregate);
    error AggregateAboveAuthorization(uint128 authorized, uint128 aggregate);
    error CumulativeAboveSessionCeiling(uint256 ceiling, uint256 wouldBe);
    error InputAboveMaximum(uint128 maximumInput, uint128 consumed);
    error OutputBelowAuthorization(uint128 authorized, uint128 amountOut);
    error NotArmed();

    constructor(IPoolManager manager) BaseHook(manager) {}

    /// @inheritdoc BaseHook
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @notice The EIP-712 domain separator, bound to this chain and this contract.
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(DOMAIN_NAME)),
                keccak256(bytes(DOMAIN_VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    // --- Digests. Public and pure so the tests re-derive them independently of the swap path. -----

    function hashArcSide(ArcSide memory a) public pure returns (bytes32) {
        return
            keccak256(abi.encode(ARC_SIDE_TYPEHASH, a.arcChainId, a.arcAuthorizationDomain, a.arcPayer, a.arcRecipient));
    }

    function hashBinding(Binding memory b) public pure returns (bytes32) {
        return keccak256(abi.encode(BINDING_TYPEHASH, b.resourceId, b.requestDigest, b.sessionId, b.merchantConfigHash));
    }

    function hashLimits(Limits memory l) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(LIMITS_TYPEHASH, l.cumulativeSessionCeiling, l.perRequestCeiling, l.authorizationAmount)
            );
    }

    function hashSepoliaSide(SepoliaSide memory s) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SEPOLIA_SIDE_TYPEHASH,
                s.sepoliaChainId,
                s.sepoliaPoolManager,
                s.hookAddress,
                s.poolId,
                s.payer,
                s.merchantRecipient,
                s.settlementToken,
                s.tokenDecimals,
                s.exactOutput,
                s.maximumInput
            )
        );
    }

    function hashEnvelope(Envelope memory e) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ENVELOPE_TYPEHASH,
                e.version,
                hashArcSide(e.arc),
                hashBinding(e.binding),
                hashLimits(e.limits),
                hashSepoliaSide(e.sepolia),
                e.batchDigest,
                e.nonce,
                e.validAfter,
                e.validBefore
            )
        );
    }

    /// @notice The digest `arc.arcPayer` signs.
    function envelopeDigest(Envelope memory e) public view returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(domainSeparator(), hashEnvelope(e));
    }

    /// @notice A nonce is spent BY A PAYER, not spent globally.
    /// @dev Found by review, not by a failing test, and worth recording: an earlier draft keyed both
    ///      nonce maps on the raw nonce alone. Nonce values are chosen by the payer, and a sequential
    ///      counter is the obvious choice — so under a global key, payer B settling with nonce 1
    ///      would permanently burn payer A's nonce 1, for free, forever. Namespacing by `arcPayer`
    ///      removes it. The cost is one keccak per nonce, which the gas table shows is noise next to
    ///      the 20,000-gas storage write it protects.
    function nonceKey(address payer, bytes32 nonce) public pure returns (bytes32) {
        return keccak256(abi.encode(payer, nonce));
    }

    function hashItem(Item memory it) public pure returns (bytes32) {
        return keccak256(abi.encode(ITEM_TYPEHASH, it.index, it.resourceId, it.sessionId, it.amount, it.nonce));
    }

    function hashBatch(bytes32 sessionId, uint64 itemCount, bytes32 itemsRoot) public pure returns (bytes32) {
        return keccak256(abi.encode(BATCH_TYPEHASH, sessionId, itemCount, itemsRoot));
    }

    function hashRequestSet(bytes32 resourceId, bytes32 sessionId, uint64 itemCount, bytes32 requestsRoot)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(REQUEST_SET_TYPEHASH, resourceId, sessionId, itemCount, requestsRoot));
    }

    function hashMerchantConfig(SepoliaSide memory s, Limits memory l) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                MERCHANT_CONFIG_TYPEHASH,
                s.merchantRecipient,
                s.settlementToken,
                s.tokenDecimals,
                l.cumulativeSessionCeiling,
                l.perRequestCeiling
            )
        );
    }

    // --- The callbacks ----------------------------------------------------------------------------

    /// @dev Everything that must refuse before value moves. Reached only through `BaseHook.beforeSwap`,
    ///      which is `onlyPoolManager`.
    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (hookData.length == 0) revert MalformedPayload();
        Payload memory p = abi.decode(hookData, (Payload));

        _checkStatics(sender, key, p.envelope);
        _checkWindowAndShape(params, p.envelope);
        bytes32 digest = _checkSignature(p.envelope, p.signature);

        uint64 itemCount = uint64(p.items.length);
        (uint128 aggregate, bytes32 itemsRoot, bytes32 requestsRoot) = _walkBatch(p.envelope, p.items);
        _checkAggregate(p.envelope, itemCount, aggregate, itemsRoot, requestsRoot);

        _arm(p.envelope, digest, itemCount);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev The two facts that do not exist until the pool has run. Reached only through
    ///      `BaseHook.afterSwap`, which is `onlyPoolManager`, for the swap `_beforeSwap` admitted.
    ///      `delta` is the swapper's: negative input in currency0, positive output in currency1.
    ///      This callback never re-decodes `hookData` — it reads the six values `_beforeSwap` left in
    ///      transient storage, because decoding a sixty-four-item payload twice is the single most
    ///      expensive thing this contract could choose to do.
    function _afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        Armed memory a = _disarm();
        if (a.digest == bytes32(0)) revert NotArmed();

        uint128 consumed = uint128(uint256(-int256(delta.amount0())));
        if (consumed > a.maximumInput) revert InputAboveMaximum(a.maximumInput, consumed);

        int128 out = delta.amount1();
        uint128 amountOut = out > 0 ? uint128(out) : 0;
        if (amountOut < a.authorizationAmount) revert OutputBelowAuthorization(a.authorizationAmount, amountOut);

        uint256 cumulativeAfter = cumulativeSessionSpent[a.sessionId] + a.authorizationAmount;
        cumulativeSessionSpent[a.sessionId] = cumulativeAfter;
        unchecked {
            ++settlementCount;
        }

        _emitReceipt(a, consumed, amountOut, cumulativeAfter);
        return (IHooks.afterSwap.selector, 0);
    }

    /// @dev The receipt, in its own frame so the callback's stack is not carrying eleven fields.
    function _emitReceipt(Armed memory a, uint128 consumed, uint128 amountOut, uint256 cumulativeAfter) internal {
        Receipt memory r;
        r.schemaVersion = RECEIPT_SCHEMA_VERSION;
        r.arcPayer = a.arcPayer;
        r.payer = a.payer;
        r.settlementToken = a.settlementToken;
        r.tokenDecimals = a.tokenDecimals;
        r.itemCount = a.itemCount;
        r.authorizationAmount = a.authorizationAmount;
        r.amountIn = consumed;
        r.amountOut = amountOut;
        r.batchDigest = a.batchDigest;
        r.cumulativeAfter = cumulativeAfter;
        emit NanoBatchSettled(a.digest, a.sessionId, a.merchantRecipient, r);
    }

    // --- beforeSwap, in parts. Split so no frame runs out of stack, and so each part is readable. --

    /// @dev Everything the swap's context fixes: this chain, that Arc, this hook, this manager, this
    ///      pool, this token, and the scale read from that token's own interface.
    function _checkStatics(address sender, PoolKey calldata key, Envelope memory e) internal view {
        if (e.version != ENVELOPE_VERSION) revert EnvelopeVersionMismatch(ENVELOPE_VERSION, e.version);
        if (e.sepolia.sepoliaChainId != uint64(block.chainid)) {
            revert SepoliaChainIdMismatch(uint64(block.chainid), e.sepolia.sepoliaChainId);
        }
        if (e.arc.arcChainId != ARC_TESTNET_CHAIN_ID) {
            revert ArcChainIdMismatch(ARC_TESTNET_CHAIN_ID, e.arc.arcChainId);
        }
        if (e.sepolia.hookAddress != address(this)) revert HookAddressMismatch(address(this), e.sepolia.hookAddress);
        if (e.sepolia.sepoliaPoolManager != address(poolManager)) {
            revert PoolManagerMismatch(address(poolManager), e.sepolia.sepoliaPoolManager);
        }
        bytes32 id = PoolId.unwrap(key.toId());
        if (e.sepolia.poolId != id) revert PoolIdMismatch(id, e.sepolia.poolId);
        if (e.sepolia.payer != sender) revert PayerMismatch(sender, e.sepolia.payer);

        address currency0 = Currency.unwrap(key.currency0);
        if (currency0 != address(0)) revert NativeInputRequired(currency0);
        address currency1 = Currency.unwrap(key.currency1);
        if (e.sepolia.settlementToken != currency1) {
            revert SettlementTokenMismatch(currency1, e.sepolia.settlementToken);
        }

        // Read, never assumed. See IERC20Decimals above and docs/ARC-FACTS.md row 1.
        uint8 onChainDecimals = IERC20Decimals(currency1).decimals();
        if (e.sepolia.tokenDecimals != onChainDecimals) {
            revert TokenDecimalsMismatch(onChainDecimals, e.sepolia.tokenDecimals);
        }

        bytes32 config = hashMerchantConfig(e.sepolia, e.limits);
        if (e.binding.merchantConfigHash != config) {
            revert MerchantConfigMismatch(config, e.binding.merchantConfigHash);
        }
    }

    /// @dev The validity window, and the shape of the swap this envelope authorized.
    function _checkWindowAndShape(SwapParams calldata params, Envelope memory e) internal view {
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs < e.validAfter) revert EnvelopeNotYetValid(e.validAfter, nowTs);
        if (nowTs > e.validBefore) revert EnvelopeExpired(e.validBefore, nowTs);

        // The settlement direction is fixed: native in (currency0), settlement token out (currency1).
        if (!params.zeroForOne) revert SwapShapeMismatch();
        if (e.sepolia.exactOutput) {
            // Exact output: the pool is asked for exactly the amount the batch authorized.
            if (params.amountSpecified <= 0) revert SwapShapeMismatch();
            if (uint256(params.amountSpecified) != uint256(e.limits.authorizationAmount)) revert SwapShapeMismatch();
        } else {
            // Exact input: the payer spends at most `maximumInput`, and `afterSwap` checks the output.
            if (params.amountSpecified >= 0) revert SwapShapeMismatch();
            if (uint256(-params.amountSpecified) > uint256(e.sepolia.maximumInput)) revert SwapShapeMismatch();
        }
    }

    /// @dev Property 1: the signer authorized this typed message. Chain-agnostic arithmetic, and the
    ///      ONLY one of the three properties this hook decides for itself rather than being handed
    ///      the answer. Verified BEFORE the batch is walked, so no nonce is ever marked against an
    ///      envelope nobody signed. Also the point at which the envelope nonce is spent — spent
    ///      WITHIN THIS CHAIN AND THIS HOOK ONLY; Arc has no idea this happened.
    function _checkSignature(Envelope memory e, bytes memory signature) internal returns (bytes32 digest) {
        digest = envelopeDigest(e);
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || recovered != e.arc.arcPayer) {
            revert BadEnvelopeSignature(recovered, e.arc.arcPayer);
        }
        bytes32 key = nonceKey(e.arc.arcPayer, e.nonce);
        if (envelopeNonceSpent[key]) revert EnvelopeNonceReplayed(e.nonce);
        envelopeNonceSpent[key] = true;
    }

    /// @dev Property 2's per-item half, in ONE pass over the batch: position, resource, session,
    ///      per-request ceiling, nonce, the running aggregate, and the two independent roots.
    ///      One pass because the pass is the expensive thing — see the gas table in
    ///      `docs/lab/EXPERIMENT-A-NANO-AUTHORIZATION.md`.
    function _walkBatch(Envelope memory e, Item[] memory items)
        internal
        returns (uint128 aggregate, bytes32 itemsRoot, bytes32 requestsRoot)
    {
        uint256 n = items.length;
        if (n == 0) revert EmptyBatch();

        bytes32[] memory itemDigests = new bytes32[](n);
        bytes32[] memory requestDigests = new bytes32[](n);
        uint256 total;

        for (uint256 i = 0; i < n; ++i) {
            Item memory it = items[i];
            if (it.index != uint64(i)) revert ItemIndexMismatch(i, it.index);
            if (it.resourceId != e.binding.resourceId) {
                revert ResourceMismatch(i, e.binding.resourceId, it.resourceId);
            }
            if (it.sessionId != e.binding.sessionId) {
                revert SessionMismatch(i, e.binding.sessionId, it.sessionId);
            }
            if (it.amount > e.limits.perRequestCeiling) {
                revert AmountAbovePerRequestCeiling(i, e.limits.perRequestCeiling, it.amount);
            }
            bytes32 key = nonceKey(e.arc.arcPayer, it.nonce);
            if (itemNonceSpent[key]) revert ItemNonceReplayed(i, it.nonce);
            itemNonceSpent[key] = true;

            total += it.amount;
            itemDigests[i] = hashItem(it);
            requestDigests[i] = it.requestDigest;
        }

        // The downcast is guarded, not assumed: 2^128 - 1 is the largest aggregate this envelope can
        // express, and an aggregate that does not fit is a refusal with its own name rather than a
        // silent wrap or an unnamed arithmetic panic.
        if (total > type(uint128).max) revert AggregateOverflow(total);
        aggregate = uint128(total);

        // Order-sensitive on purpose. `abi.encodePacked` of a bytes32 array is the concatenation of
        // its elements, so moving two items changes this hash even when the set is unchanged.
        itemsRoot = keccak256(abi.encodePacked(itemDigests));
        requestsRoot = keccak256(abi.encodePacked(requestDigests));
    }

    /// @dev Property 2's aggregate half. Digests first, then money: a batch that is not the batch the
    ///      payer signed is refused as the wrong batch, not as the wrong amount.
    function _checkAggregate(
        Envelope memory e,
        uint64 itemCount,
        uint128 aggregate,
        bytes32 itemsRoot,
        bytes32 requestsRoot
    ) internal view {
        bytes32 batch = hashBatch(e.binding.sessionId, itemCount, itemsRoot);
        if (e.batchDigest != batch) revert BatchDigestMismatch(batch, e.batchDigest);

        bytes32 requestSet = hashRequestSet(e.binding.resourceId, e.binding.sessionId, itemCount, requestsRoot);
        if (e.binding.requestDigest != requestSet) revert RequestDigestMismatch(requestSet, e.binding.requestDigest);

        // The batch must discharge the authorization exactly. Short is not "safely under": it means
        // the envelope authorized value the batch does not account for.
        if (aggregate < e.limits.authorizationAmount) {
            revert AggregateBelowAuthorization(e.limits.authorizationAmount, aggregate);
        }
        if (aggregate > e.limits.authorizationAmount) {
            revert AggregateAboveAuthorization(e.limits.authorizationAmount, aggregate);
        }

        uint256 wouldBe = cumulativeSessionSpent[e.binding.sessionId] + uint256(e.limits.authorizationAmount);
        if (wouldBe > uint256(e.limits.cumulativeSessionCeiling)) {
            revert CumulativeAboveSessionCeiling(e.limits.cumulativeSessionCeiling, wouldBe);
        }
    }

    // --- The transient handoff from beforeSwap to afterSwap ----------------------------------------
    //
    // EIP-1153. Eight slots, namespaced so they cannot collide with anything else, cleared on the way
    // out and gone at the end of the transaction regardless. This is a CARRIER, not a defence: the
    // replay defence is the persistent envelope-nonce mark written in `_checkSignature`.

    /// @dev The values `afterSwap` needs, so it never re-decodes the payload.
    struct Armed {
        bytes32 digest;
        bytes32 sessionId;
        bytes32 batchDigest;
        uint128 authorizationAmount;
        uint128 maximumInput;
        address merchantRecipient;
        address arcPayer;
        address payer;
        address settlementToken;
        uint8 tokenDecimals;
        uint64 itemCount;
    }

    bytes32 private constant ARMED_BASE = keccak256("NanoAuthorizationHook.armed.v1");

    function _slot(uint256 i) private pure returns (bytes32 s) {
        unchecked {
            s = bytes32(uint256(ARMED_BASE) + i);
        }
    }

    function _tstore(uint256 i, bytes32 v) private {
        bytes32 s = _slot(i);
        assembly ("memory-safe") {
            tstore(s, v)
        }
    }

    function _tload(uint256 i) private view returns (bytes32 v) {
        bytes32 s = _slot(i);
        assembly ("memory-safe") {
            v := tload(s)
        }
    }

    function _arm(Envelope memory e, bytes32 digest, uint64 itemCount) internal {
        _tstore(0, digest);
        _tstore(1, e.binding.sessionId);
        _tstore(2, e.batchDigest);
        _tstore(3, bytes32((uint256(e.limits.authorizationAmount) << 128) | uint256(e.sepolia.maximumInput)));
        _tstore(4, bytes32(uint256(uint160(e.sepolia.merchantRecipient))));
        _tstore(5, bytes32(uint256(uint160(e.arc.arcPayer))));
        _tstore(6, bytes32(uint256(uint160(e.sepolia.payer))));
        _tstore(
            7,
            bytes32(
                uint256(uint160(e.sepolia.settlementToken)) | (uint256(e.sepolia.tokenDecimals) << 160)
                    | (uint256(itemCount) << 168)
            )
        );
    }

    function _disarm() internal returns (Armed memory a) {
        a.digest = _tload(0);
        if (a.digest == bytes32(0)) return a;
        a.sessionId = _tload(1);
        a.batchDigest = _tload(2);
        uint256 amounts = uint256(_tload(3));
        a.authorizationAmount = uint128(amounts >> 128);
        a.maximumInput = uint128(amounts);
        a.merchantRecipient = address(uint160(uint256(_tload(4))));
        a.arcPayer = address(uint160(uint256(_tload(5))));
        a.payer = address(uint160(uint256(_tload(6))));
        uint256 packed = uint256(_tload(7));
        a.settlementToken = address(uint160(packed));
        a.tokenDecimals = uint8(packed >> 160);
        a.itemCount = uint64(packed >> 168);
        for (uint256 i = 0; i < 8; ++i) {
            _tstore(i, bytes32(0));
        }
    }
}
