// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// LOCAL ENSv2-COMPATIBLE FIXTURE for Anvil integration tests. Not the isolated ENSv2 Sepolia
// deployment; mirrors its measured Enhanced Access Control shape (per-key text resources, role
// bitmaps, admin bits at +128) so the order-admission path can be tested end to end without a
// network. Pinned Sepolia configuration lives in integrations/ensv2/profile.mjs.

import {IIdentityAuthority} from "./interfaces/IIdentityAuthority.sol";
import {IUnicaMarketRegistry} from "../unica-v4/interfaces/IUnicaMarketRegistry.sol";
import {IUnicaMarketExecutor} from "../unica-v4/interfaces/IUnicaMarketExecutor.sol";
import {IUnicaPolicyReceiver} from "../unica-v4/policy/IUnicaPolicyReceiver.sol";

/// @title TerminalAdmission
/// @notice The registry-allowlisted order creator that gates NEW orders by terminal authority.
///         Written from `docs/unica-v5/ens/POS-TERMINALS.md` §3-6 and
///         `docs/unica-v5/ens/ACCESS-CONTROL.md` §5, §8-9.
///
/// @dev WHAT THIS CONTRACT DOES AND DOES NOT DO — stated plainly because it is the property every
///      negative test here exists to defend:
///
///      ENS gates ADMISSION of a new order only. `requestOrder` checks a terminal's identity and
///      status BEFORE calling `IUnicaMarketExecutor.createOrder`, and once that call returns, this
///      contract's job is finished. It never alters an existing order's merchant, payer, asset,
///      amount, market, chain, nonce, expiry, hook, executor or payout — none of those fields are
///      writable from here, before or after admission. Revoking a terminal's authority, or editing
///      the merchant's ENS records, changes what a FUTURE call to `requestOrder` will accept; it
///      does not and cannot invalidate an order that already exists, because this contract holds
///      no reference back into an admitted order once `createOrder` returns. This contract is
///      outside v4 settlement: it never touches a pool, a hook, or a token balance directly, and
///      `pay`/settlement proceed entirely inside the executor named at admission time.
contract TerminalAdmission {
    /// @dev Mirrors `IIdentityAuthority`/`LocalEnsV2Fixture`'s `ROLE_SET_TEXT` bit
    ///      (`docs/unica-v5/ens/ACCESS-CONTROL.md` §5.2). Not imported from the fixture: this
    ///      contract depends only on the `IIdentityAuthority` interface, and the bit's meaning is
    ///      part of that shared convention, not a fixture implementation detail.
    uint256 private constant ROLE_SET_TEXT = 1 << 4;

    struct AdmissionRecord {
        bytes32 merchantNode;
        bytes32 terminalNode;
        address operator;
        address recipientAtAdmission;
        uint64 admittedAt;
        bytes32 orderNonce;
    }

    /// @dev One request's working state, carried as a single memory pointer between the internal
    ///      steps below instead of as nine-plus separate parameters. `via_ir = false` is pinned in
    ///      `foundry.toml`, and `requestOrder`'s own parameter count plus this contract's chain of
    ///      external reads (identity, executor, policy) does not fit the legacy pipeline's stack
    ///      budget as plain scalars — this is the standard, documented way around that without
    ///      asking for the optimizer pipeline to change.
    struct Request {
        bytes32 merchantNode;
        bytes32 terminalNode;
        address executor;
        address payer;
        uint128 amountIn;
        uint128 minOut;
        uint64 deadline;
        bytes32 salt;
        address expectedRecipient;
        address recipient;
        bytes32 marketId;
        address assetToken;
        address payoutToken;
    }

    IIdentityAuthority public immutable IDENTITY;
    /// @notice A configuration pin, compared against the caller's claim so a client built for one
    ///         ENS deployment cannot admit through a gate configured for another. It is a typo
    ///         guard between two configurations, never on-chain provenance: nothing here proves that
    ///         `IDENTITY` belongs to this deployment id. That binding is the deployment manifest's,
    ///         checked off-chain (rulings N6, H11).
    bytes32 public immutable ENS_DEPLOYMENT_ID;
    /// @notice The official UNICA v4 registry. An order is admitted only on an executor this
    ///         registry knows (`marketIdOfExecutor != 0`), so an admission record and its event are
    ///         evidence about an official market and never about a stub that echoes one.
    IUnicaMarketRegistry public immutable REGISTRY;
    /// @notice Zero means no policy gate: every ENS-admitted terminal is admitted outright.
    IUnicaPolicyReceiver public immutable POLICY;
    /// @notice The ENS text key a terminal must publish `"active"` under to admit orders
    ///         (`docs/unica-v5/ens/RECORDS.md` §6.9). Not declared `immutable`: Solidity's
    ///         `immutable` keyword accepts only value types, and `string` is a reference type — so
    ///         this is a plain state variable, written exactly once, in the constructor, and never
    ///         again.
    string public TERMINAL_STATUS_KEY;

    mapping(bytes32 => AdmissionRecord) private _admissions;

    /// @notice The direct settlers this gate will admit an order on, alongside the markets the
    ///         official registry knows. A UNICA v5 direct settler moves one asset from the customer
    ///         to the business without a pool, so it has no market id and the registry has never
    ///         heard of it; without this list every same asset sale would be refused as an
    ///         unregistered executor. The list is deliberately small and explicit: an address is on
    ///         it only because the registry's own admin put it there.
    ///
    ///         AND THAT IS THE SAME AUTHORITY THAT DECIDES WHO MAY RAISE AN ORDER, which is a fact
    ///         about the code and not a hope about the deployment. `setDirectSettler` refuses any
    ///         settler that does not name THIS registry as the one it answers to, and a settler
    ///         resolves its own creator authority by reading that registry's `admin()` live. So one
    ///         handover of the registry admin moves both surfaces at once, and there is no second
    ///         key on the direct path for this gate's revocation to miss.
    mapping(address => bool) private _directSettlers;

    event OrderAdmitted(
        bytes32 indexed orderId,
        bytes32 indexed merchantNode,
        bytes32 indexed terminalNode,
        address operator,
        address recipient,
        address payer,
        bytes32 orderNonce
    );

    event DirectSettlerSet(address indexed settler, bool allowed);

    error WrongEnsDeployment(bytes32 expected, bytes32 got);
    error TerminalNotUnderMerchant(bytes32 terminalNode, bytes32 merchantNode);
    error TerminalNotAuthorized(bytes32 terminalNode, address caller);
    error TerminalNotActive(bytes32 terminalNode, string statusText);
    error MerchantHasNoPayoutAddress(bytes32 merchantNode);
    /// @notice The payout address the terminal quoted is not the one the merchant's record resolves
    ///         to now. A record changed between quote and admission refuses the order instead of
    ///         silently paying the new address (security review, finding 3).
    error RecipientMismatch(address expected, address resolved);
    /// @notice The executor is not one the official registry knows, and not an allowlisted direct
    ///         settler either (security review, finding 2).
    error ExecutorNotRegistered(address executor);
    /// @notice Only the official registry's admin may change the direct settler allowlist.
    error NotRegistryAdmin(address caller);
    /// @notice The settler does not answer to this gate's registry, so listing it would put a second
    ///         admin key on the direct path: one deciding who may raise a sale there, another
    ///         deciding whether the gate accepts it. Refused rather than listed.
    error SettlerRegistryMismatch(address settler, address settlerRegistry, address expected);
    /// @notice The settler does not answer the one question this gate has to ask it. An address that
    ///         cannot say which registry governs it cannot be shown to share this one.
    error SettlerRegistryUnreadable(address settler);
    error PolicyNotAuthorized(bytes32 salt);
    error ZeroAddress();

    constructor(
        address identity,
        address registry,
        bytes32 ensDeploymentId,
        address policyReceiver,
        string memory terminalStatusKey
    ) {
        if (identity == address(0) || registry == address(0)) revert ZeroAddress();
        IDENTITY = IIdentityAuthority(identity);
        REGISTRY = IUnicaMarketRegistry(registry);
        ENS_DEPLOYMENT_ID = ensDeploymentId;
        POLICY = IUnicaPolicyReceiver(policyReceiver);
        TERMINAL_STATUS_KEY = terminalStatusKey;
    }

    /// @notice Admits one new order after checking that `msg.sender` is the operator key currently
    ///         authorized, by the merchant, to publish `TERMINAL_STATUS_KEY` on `terminalNode`,
    ///         that the terminal is under `merchantNode` at exactly `<label>.terminals.<merchant>`,
    ///         that its published status is `"active"`, that the merchant still has a payout
    ///         address, and — when a policy gate is configured — that the policy receiver admits
    ///         this exact set of terms.
    /// @param expectedRecipient the payout address the terminal quoted to the customer; admission
    ///        refuses if the merchant's record now resolves elsewhere, so a mutable ENS record can
    ///        neither redirect an existing order (it is frozen) nor a quoted one (it is compared).
    function requestOrder(
        bytes32 merchantNode,
        bytes32 terminalNode,
        bytes32 ensDeploymentId,
        address executor,
        address expectedRecipient,
        address payer,
        uint128 amountIn,
        uint128 minOut,
        uint64 deadline,
        bytes32 salt
    ) external returns (bytes32 orderId) {
        if (ensDeploymentId != ENS_DEPLOYMENT_ID) {
            revert WrongEnsDeployment(ENS_DEPLOYMENT_ID, ensDeploymentId);
        }
        if (REGISTRY.marketIdOfExecutor(executor) == bytes32(0) && !_directSettlers[executor]) {
            revert ExecutorNotRegistered(executor);
        }

        Request memory req;
        req.merchantNode = merchantNode;
        req.terminalNode = terminalNode;
        req.executor = executor;
        req.expectedRecipient = expectedRecipient;
        req.payer = payer;
        req.amountIn = amountIn;
        req.minOut = minOut;
        req.deadline = deadline;
        req.salt = salt;

        _checkTerminalAndRecipient(req);
        if (address(POLICY) != address(0)) _checkPolicy(req);
        orderId = _admitOrder(req);
    }

    function admissionOf(bytes32 orderId) external view returns (AdmissionRecord memory) {
        return _admissions[orderId];
    }

    /// @notice Whether `settler` is an allowlisted UNICA v5 direct settler for this gate.
    function isDirectSettler(address settler) external view returns (bool) {
        return _directSettlers[settler];
    }

    /// @notice Adds or removes a direct settler. The caller must be the official registry's admin,
    ///         read live rather than copied at construction, so this gate cannot outlive a handover
    ///         of that role. This is the only writable configuration on this contract, and it
    ///         changes what a FUTURE call to `requestOrder` will accept: an order already admitted
    ///         is untouched, because nothing here reaches back into one.
    /// @dev Listing also requires the settler to name this exact registry, so that the account which
    ///      may raise a sale on that settler and the account which may list it here are the same
    ///      account by construction. Without that check the two are unrelated keys, and revoking the
    ///      settler from this gate would leave a creator the settler's own admin had listed still
    ///      able to raise sales on it. Removal (`allowed == false`) skips the check on purpose: a
    ///      settler that has stopped answering must still be revocable.
    function setDirectSettler(address settler, bool allowed) external {
        if (msg.sender != REGISTRY.admin()) revert NotRegistryAdmin(msg.sender);
        if (settler == address(0)) revert ZeroAddress();
        if (allowed) _requireSameRegistry(settler);
        _directSettlers[settler] = allowed;
        emit DirectSettlerSet(settler, allowed);
    }

    /// @dev Asks the settler which registry governs it. A settler that reverts, or that answers
    ///      something undecodable, is refused by name rather than read as agreement.
    function _requireSameRegistry(address settler) private view {
        (bool ok, bytes memory ret) = settler.staticcall(abi.encodeWithSignature("REGISTRY()"));
        if (!ok || ret.length != 32) revert SettlerRegistryUnreadable(settler);
        // Decoded as a raw word and range checked by hand, so a settler that answers with a dirty
        // upper half is named as unreadable instead of being silently truncated into a match, and
        // instead of failing as a bare panic out of `abi.decode(ret, (address))`.
        bytes32 word = abi.decode(ret, (bytes32));
        if (uint256(word) >> 160 != 0) revert SettlerRegistryUnreadable(settler);
        address settlerRegistry = address(uint160(uint256(word)));
        if (settlerRegistry != address(REGISTRY)) {
            revert SettlerRegistryMismatch(settler, settlerRegistry, address(REGISTRY));
        }
    }

    /// @dev Checks (b)-(e): the terminal lives under the claimed merchant, `msg.sender` currently
    ///      holds `SET_TEXT` at the terminal's own status-key resource, the published status text
    ///      is exactly `"active"`, and the merchant still has a payout address. Writes
    ///      `req.recipient` in place rather than returning it, so the caller never holds it as a
    ///      separate scalar (see `Request`'s own comment on why).
    function _checkTerminalAndRecipient(Request memory req) internal view {
        if (IDENTITY.parentOf(IDENTITY.parentOf(req.terminalNode)) != req.merchantNode) {
            revert TerminalNotUnderMerchant(req.terminalNode, req.merchantNode);
        }

        uint256 statusResource = IDENTITY.textResource(req.terminalNode, TERMINAL_STATUS_KEY);
        if (!IDENTITY.hasRoles(statusResource, ROLE_SET_TEXT, msg.sender)) {
            revert TerminalNotAuthorized(req.terminalNode, msg.sender);
        }

        string memory statusText = IDENTITY.text(req.terminalNode, TERMINAL_STATUS_KEY);
        if (keccak256(bytes(statusText)) != keccak256(bytes("active"))) {
            revert TerminalNotActive(req.terminalNode, statusText);
        }

        req.recipient = IDENTITY.addr(req.merchantNode);
        if (req.recipient == address(0)) revert MerchantHasNoPayoutAddress(req.merchantNode);
        if (req.recipient != req.expectedRecipient) revert RecipientMismatch(req.expectedRecipient, req.recipient);
    }

    /// @dev Check (f): the optional confidential-policy gate. Only ever called when `POLICY` is
    ///      non-zero. Every argument `isAdmitted` needs is read from `req` one field at a time —
    ///      `req.marketId`/`assetToken`/`payoutToken` are filled here from the executor first, so
    ///      the final call's argument list is nine plain memory reads and never a nested external
    ///      call evaluated inline.
    function _checkPolicy(Request memory req) internal view {
        IUnicaMarketExecutor mkt = IUnicaMarketExecutor(req.executor);
        req.marketId = mkt.MARKET_ID();
        req.assetToken = mkt.ASSET_TOKEN();
        req.payoutToken = mkt.PAYOUT_TOKEN();

        bool admitted = POLICY.isAdmitted(
            req.salt,
            req.marketId,
            req.recipient,
            req.payer,
            req.assetToken,
            req.payoutToken,
            req.amountIn,
            req.minOut,
            req.terminalNode
        );
        if (!admitted) revert PolicyNotAuthorized(req.salt);
    }

    /// @dev Check/effect (g): the executor call plus the bookkeeping and event that follow it.
    function _admitOrder(Request memory req) internal returns (bytes32 orderId) {
        orderId = IUnicaMarketExecutor(req.executor)
            .createOrder(
                req.recipient,
                req.payer,
                req.amountIn,
                req.minOut,
                req.deadline,
                keccak256(abi.encode(req.terminalNode, req.salt))
            );

        _admissions[orderId] = AdmissionRecord({
            merchantNode: req.merchantNode,
            terminalNode: req.terminalNode,
            operator: msg.sender,
            recipientAtAdmission: req.recipient,
            admittedAt: uint64(block.timestamp),
            orderNonce: req.salt
        });

        emit OrderAdmitted(orderId, req.merchantNode, req.terminalNode, msg.sender, req.recipient, req.payer, req.salt);
    }
}
