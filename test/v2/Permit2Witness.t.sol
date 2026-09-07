// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {Permit2Deployer} from "hookmate/artifacts/Permit2.sol";

/// @notice What this gate calls, declared from documented signatures. Permit2's own source pins
///         `pragma solidity 0.8.17` while this tree pins 0.8.30, so it cannot be compiled here at
///         all; the runtime is brought in from an artifact and reached through this interface.
///         Nothing is copied — these are signatures, and a signature written differently does not
///         compile.
interface IPermit2Witness {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    function permitWitnessTransferFrom(
        PermitTransferFrom memory permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes32 witness,
        string calldata witnessTypeString,
        bytes calldata signature
    ) external;

    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function nonceBitmap(address owner, uint256 word) external view returns (uint256);
}

/// @notice Permit2's own refusals, declared so a row can assert WHICH one fired. `vm.expectRevert()`
///         with no argument would let "expired" pass a row written for "over the ceiling".
interface IPermit2Errors {
    error InvalidAmount(uint256 maxAmount);
    error InvalidNonce();
    error InvalidSigner();
    error SignatureExpired(uint256 signatureDeadline);
}

/// @dev Calls Permit2 and then reverts, so a row can ask whether a spent nonce survives a failed
///      outer transaction. It must not: the executor's settlement can fail after the pull, and a
///      nonce burned by a transaction that achieved nothing would strand the payer's authorisation.
contract PullThenRevert {
    error Deliberate();

    function pullAndFail(
        address permit2,
        IPermit2Witness.PermitTransferFrom memory permit,
        IPermit2Witness.SignatureTransferDetails calldata details,
        address owner,
        bytes32 witness,
        string calldata witnessTypeString,
        bytes calldata signature
    ) external {
        IPermit2Witness(permit2)
            .permitWitnessTransferFrom(permit, details, owner, witness, witnessTypeString, signature);
        revert Deliberate();
    }
}

/// @title GATE 0 — the payer's authorisation, against the official deployed runtime
/// @notice PATH B1 rests on one Permit2 property: the payer signs WHAT may move and HOW MUCH, while
///         the DESTINATION is chosen by the caller at spend time. If that is true an executor can
///         direct a bounded pull straight to the PoolManager and never hold the payer's token. If it
///         is false, B1 is dead. The same property is the danger, and both halves are measured here.
///
///         The digest is derived twice, in two languages, from the specification rather than from
///         each other — see `integrations/permit2/digest.mjs`. A Solidity test that builds a digest
///         the same way the code under test builds it cannot discover that both are wrong, and a
///         digest that is wrong is rejected in a real payer's wallet, not here.
contract Permit2WitnessGateTest is Test, IPermit2Errors {
    /// @dev Permit2's canonical address, identical on every chain it is deployed to.
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    /// @dev The official v4 PoolManager on Sepolia. Used as the pull destination because that is
    ///      where B1 sends the payer's token, and because a fixed value makes the vector below
    ///      reproducible by anyone.
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    uint256 internal constant CHAIN_ID = 11155111;

    // ---- the vector, fixed so the two derivations can be compared at all ----------------------
    address internal constant VECTOR_TOKEN = 0x7000000000000000000000000000000000000001;
    address internal constant VECTOR_EXECUTOR = 0xE7eC000000000000000000000000000000000001;
    uint256 internal constant VECTOR_MAX_IN = 5 ether;
    uint256 internal constant VECTOR_NONCE = 0;
    uint256 internal constant VECTOR_DEADLINE = 1_800_000_000;

    /// @dev PINNED FROM `integrations/permit2/digest.mjs`, which derives them offline in JavaScript
    ///      with an independent keccak. These literals are the OTHER derivation: this file
    ///      recomputes each one in Solidity and asserts equality, so an error would have to be made
    ///      twice, identically, in two languages, by code written from the same specification but
    ///      not from each other.
    bytes32 internal constant OFFLINE_DOMAIN = 0x94c1dec87927751697bfc9ebf6fc4ca506bed30308b518f0e9d6c5f74bbafdb8;
    bytes32 internal constant OFFLINE_QUOTE_ID = 0x72663bffbbd613d1f081e43d7f654b75f1ee32528bf207889f1161313248f63c;
    bytes32 internal constant OFFLINE_WITNESS = 0x06529508d5f41365e7a88f31508e353f8802b22a74109598386b59c84859166a;
    bytes32 internal constant OFFLINE_DIGEST = 0x68840f3503a85188f7fc526fbdbd889d592ef3cb54bbc50af4a79eee20a8f1f2;

    IPermit2Witness internal permit2;
    MockERC20 internal token;
    PullThenRevert internal pullThenRevert;

    uint256 internal payerKey = 0xA11CE;
    address internal payer;
    address internal executor = VECTOR_EXECUTOR;
    address internal relayer = address(0x5EEDBAD);

    /// @dev The payer's half of a V2 invoice: which quote, and the ceiling they accept.
    struct Payment {
        bytes32 quoteId;
        address payer;
        address tokenIn;
        uint256 maxIn;
        address destination;
        address executor;
    }

    string internal constant PAYMENT_TYPE =
        "Payment(bytes32 quoteId,address payer,address tokenIn,uint256 maxIn,address destination,address executor)";

    /// @dev Permit2 concatenates its stub with this string, so the witness field declaration must
    ///      come first and `TokenPermissions` last. DERIVED from PAYMENT_TYPE rather than written
    ///      out a second time: an earlier version hard-coded both, and a sabotage that renamed a
    ///      field in one of them left every row green, because the signer and the call were reading
    ///      the same corrupted copy. Two hand-maintained descriptions of one struct is a mismatch
    ///      waiting to happen, and the mismatch surfaces in a payer's wallet, not here.
    function witnessTypeString() internal pure returns (string memory) {
        return string.concat("Payment witness)", PAYMENT_TYPE, "TokenPermissions(address token,uint256 amount)");
    }

    bytes32 internal constant TOKEN_PERMISSIONS_TYPEHASH = keccak256("TokenPermissions(address token,uint256 amount)");

    function setUp() public {
        // Set the chain FIRST. Permit2 caches its domain separator against the chain id and the
        // address it was constructed at, and the whole point of the rows below is that this
        // instance's domain is the canonical Sepolia one.
        vm.chainId(CHAIN_ID);
        payer = vm.addr(payerKey);

        // Constructed AT the canonical address, not deployed elsewhere and copied. See
        // `test_Gate0_Permit2_CopyingTheCodeDoesNotCopyTheDomain` for why that distinction is not
        // cosmetic.
        vm.etch(PERMIT2, Permit2Deployer.initcode());
        (bool ok, bytes memory runtime) = PERMIT2.call("");
        require(ok, "permit2 init code reverted");
        vm.etch(PERMIT2, runtime);
        permit2 = IPermit2Witness(PERMIT2);

        deployCodeTo("MockERC20.sol:MockERC20", abi.encode("In", "IN", uint8(18)), VECTOR_TOKEN);
        token = MockERC20(VECTOR_TOKEN);
        token.mint(payer, 1_000 ether);
        vm.prank(payer);
        token.approve(PERMIT2, type(uint256).max);

        pullThenRevert = new PullThenRevert();
    }

    // ---- the harness itself, before anything is measured through it --------------------------

    /// @dev A FINDING ABOUT THE HARNESS, kept as a row because it invalidated an earlier version of
    ///      this file. Permit2 caches its domain separator as an immutable, and immutables live in
    ///      the RUNTIME code — so deploying Permit2 somewhere convenient and `vm.etch`-ing its code
    ///      to the canonical address carries a domain separator computed for the WRONG
    ///      verifyingContract. Every row still passed, because the test signed with whatever
    ///      `DOMAIN_SEPARATOR()` returned; the signatures it proved valid were signatures no real
    ///      wallet would ever produce. Constructing in place fixes it, and this row is what would
    ///      catch a regression.
    function test_Gate0_Permit2_CopyingTheCodeDoesNotCopyTheDomain() public {
        assertEq(permit2.DOMAIN_SEPARATOR(), OFFLINE_DOMAIN, "the in-place instance is not canonical");

        address elsewhere = Permit2Deployer.deploy();
        address decoy = address(0xD3C0);
        vm.etch(decoy, elsewhere.code);
        bytes32 copied = IPermit2Witness(decoy).DOMAIN_SEPARATOR();

        emit log_named_bytes32("canonical (constructed in place)", permit2.DOMAIN_SEPARATOR());
        emit log_named_bytes32("copied code, etched elsewhere   ", copied);
        assertTrue(
            copied != permit2.DOMAIN_SEPARATOR(), "copying the code copied the domain, so this row proves nothing"
        );
    }

    // ---- two derivations of one digest -------------------------------------------------------

    /// @dev The domain, the witness and the signing digest, each recomputed here and compared with
    ///      the value derived offline in JavaScript. Permit2's domain carries NO `version` field,
    ///      which is the detail a generic EIP-712 helper gets wrong.
    function test_Gate0_Permit2_TheOfflineAndOnchainDerivationsAgree() public view {
        assertEq(
            keccak256(bytes("unica.v2.permit2.vector.1")), OFFLINE_QUOTE_ID, "the two sides are not hashing one vector"
        );

        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
                keccak256("Permit2"),
                CHAIN_ID,
                PERMIT2
            )
        );
        assertEq(domain, OFFLINE_DOMAIN, "the domain separators disagree");
        assertEq(permit2.DOMAIN_SEPARATOR(), domain, "the deployed runtime disagrees with both derivations");

        Payment memory p = Payment({
            quoteId: OFFLINE_QUOTE_ID,
            payer: payer,
            tokenIn: VECTOR_TOKEN,
            maxIn: VECTOR_MAX_IN,
            destination: POOL_MANAGER,
            executor: VECTOR_EXECUTOR
        });
        assertEq(_witness(p), OFFLINE_WITNESS, "the witness hashes disagree");
        assertEq(
            _digest(p, VECTOR_NONCE, VECTOR_DEADLINE, VECTOR_MAX_IN), OFFLINE_DIGEST, "the signing digests disagree"
        );
    }

    /// @dev And the third witness, which is the one that matters: the deployed Permit2 runtime
    ///      accepts a signature made over the digest derived OFFLINE. Two implementations agreeing
    ///      is evidence; the contract that will actually check the signature agreeing is proof.
    function test_Gate0_Permit2_TheDeployedRuntimeAcceptsTheOfflineDigest() public {
        vm.warp(VECTOR_DEADLINE - 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, OFFLINE_DIGEST);

        vm.prank(VECTOR_EXECUTOR);
        permit2.permitWitnessTransferFrom(
            _permit(VECTOR_MAX_IN, VECTOR_NONCE, VECTOR_DEADLINE),
            IPermit2Witness.SignatureTransferDetails({to: POOL_MANAGER, requestedAmount: VECTOR_MAX_IN}),
            payer,
            OFFLINE_WITNESS,
            witnessTypeString(),
            abi.encodePacked(r, s, v)
        );

        assertEq(token.balanceOf(POOL_MANAGER), VECTOR_MAX_IN, "the offline digest was not the digest Permit2 checks");
    }

    // ---- what the executor's funding path depends on ------------------------------------------

    function test_Gate0_Permit2_PullsThePayersTokenStraightToThePoolManager() public {
        uint256 amount = 5 ether;
        bytes memory sig = _sign(_payment(bytes32("q1"), amount), 0, block.timestamp + 1 days, amount);

        uint256 pmBefore = token.balanceOf(POOL_MANAGER);
        uint256 exBefore = token.balanceOf(executor);

        vm.prank(executor);
        permit2.permitWitnessTransferFrom(
            _permit(amount, 0, block.timestamp + 1 days),
            IPermit2Witness.SignatureTransferDetails({to: POOL_MANAGER, requestedAmount: amount}),
            payer,
            _witness(_payment(bytes32("q1"), amount)),
            witnessTypeString(),
            sig
        );

        assertEq(token.balanceOf(POOL_MANAGER) - pmBefore, amount, "the PoolManager did not receive the input");
        assertEq(token.balanceOf(executor), exBefore, "the executor touched the payer's token");
    }

    /// @dev The payer is debited by what the swap actually cost, never by the ceiling they signed.
    function test_Gate0_Permit2_ThePayerIsDebitedTheREALISEDAmountNotTheCeiling() public {
        uint256 ceiling = 5 ether;
        uint256 realised = 3 ether;
        uint256 payerBefore = token.balanceOf(payer);
        bytes memory sig = _sign(_payment(bytes32("q2"), ceiling), 1, block.timestamp + 1 days, ceiling);

        vm.prank(executor);
        permit2.permitWitnessTransferFrom(
            _permit(ceiling, 1, block.timestamp + 1 days),
            IPermit2Witness.SignatureTransferDetails({to: POOL_MANAGER, requestedAmount: realised}),
            payer,
            _witness(_payment(bytes32("q2"), ceiling)),
            witnessTypeString(),
            sig
        );
        assertEq(token.balanceOf(POOL_MANAGER), realised, "only the realised input should move");
        assertEq(payerBefore - token.balanceOf(payer), realised, "the payer was debited more than the swap cost");
    }

    function test_Gate0_Permit2_TheUNUSEDCeilingCannotBeReplayed() public {
        uint256 ceiling = 5 ether;
        bytes memory sig = _sign(_payment(bytes32("q3"), ceiling), 2, block.timestamp + 1 days, ceiling);
        IPermit2Witness.PermitTransferFrom memory p = _permit(ceiling, 2, block.timestamp + 1 days);
        bytes32 w = _witness(_payment(bytes32("q3"), ceiling));

        vm.prank(executor);
        permit2.permitWitnessTransferFrom(
            p,
            IPermit2Witness.SignatureTransferDetails({to: POOL_MANAGER, requestedAmount: 1 ether}),
            payer,
            w,
            witnessTypeString(),
            sig
        );

        vm.prank(executor);
        vm.expectRevert(InvalidNonce.selector); // the nonce is spent; the remaining 4 ether is unreachable
        permit2.permitWitnessTransferFrom(
            p,
            IPermit2Witness.SignatureTransferDetails({to: POOL_MANAGER, requestedAmount: 1 ether}),
            payer,
            w,
            witnessTypeString(),
            sig
        );
    }

    // ---- the refusals, each asserting WHICH refusal ------------------------------------------

    function test_Gate0_Permit2_MoreThanTheSignedCeilingIsRefused() public {
        uint256 ceiling = 2 ether;
        bytes memory sig = _sign(_payment(bytes32("q6"), ceiling), 6, block.timestamp + 1 days, ceiling);

        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(InvalidAmount.selector, ceiling));
        permit2.permitWitnessTransferFrom(
            _permit(ceiling, 6, block.timestamp + 1 days),
            IPermit2Witness.SignatureTransferDetails({to: POOL_MANAGER, requestedAmount: ceiling + 1}),
            payer,
            _witness(_payment(bytes32("q6"), ceiling)),
            witnessTypeString(),
            sig
        );
    }

    /// @dev The witness is the invoice. Presenting a signature for one quote against another is the
    ///      attack this field exists to stop, and Permit2 catches it as a signer mismatch because
    ///      the witness is inside the digest.
    function test_Gate0_Permit2_AWitnessForAnotherQuoteIsRefused() public {
        uint256 amount = 2 ether;
        bytes memory sig = _sign(_payment(bytes32("q7"), amount), 7, block.timestamp + 1 days, amount);

        vm.prank(executor);
        vm.expectRevert(InvalidSigner.selector);
        permit2.permitWitnessTransferFrom(
            _permit(amount, 7, block.timestamp + 1 days),
            IPermit2Witness.SignatureTransferDetails({to: POOL_MANAGER, requestedAmount: amount}),
            payer,
            _witness(_payment(bytes32("A DIFFERENT QUOTE"), amount)),
            witnessTypeString(),
            sig
        );
    }

    /// @dev The token is inside `TokenPermissions`, so a signature for one asset cannot move another.
    function test_Gate0_Permit2_ADifferentTokenIsRefused() public {
        uint256 amount = 2 ether;
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        other.mint(payer, 100 ether);
        vm.prank(payer);
        other.approve(PERMIT2, type(uint256).max);

        bytes memory sig = _sign(_payment(bytes32("q8"), amount), 8, block.timestamp + 1 days, amount);

        IPermit2Witness.PermitTransferFrom memory p = IPermit2Witness.PermitTransferFrom({
            permitted: IPermit2Witness.TokenPermissions({token: address(other), amount: amount}),
            nonce: 8,
            deadline: block.timestamp + 1 days
        });

        vm.prank(executor);
        vm.expectRevert(InvalidSigner.selector);
        permit2.permitWitnessTransferFrom(
            p,
            IPermit2Witness.SignatureTransferDetails({to: POOL_MANAGER, requestedAmount: amount}),
            payer,
            _witness(_payment(bytes32("q8"), amount)),
            witnessTypeString(),
            sig
        );
    }

    function test_Gate0_Permit2_AnExpiredAuthorisationIsRefused() public {
        uint256 amount = 2 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(_payment(bytes32("q9"), amount), 9, deadline, amount);

        vm.warp(deadline + 1);
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(SignatureExpired.selector, deadline));
        permit2.permitWitnessTransferFrom(
            _permit(amount, 9, deadline),
            IPermit2Witness.SignatureTransferDetails({to: POOL_MANAGER, requestedAmount: amount}),
            payer,
            _witness(_payment(bytes32("q9"), amount)),
            witnessTypeString(),
            sig
        );
    }

    function test_Gate0_Permit2_TheSpenderIsBoundToMsgSenderStructurally() public {
        uint256 amount = 2 ether;
        bytes memory sig = _sign(_payment(bytes32("q4"), amount), 3, block.timestamp + 1 days, amount);

        // The payer signed while the executor was the spender. A relayer calling in its own name
        // produces a different digest and cannot spend, without the payer naming anyone.
        vm.prank(relayer);
        vm.expectRevert(InvalidSigner.selector);
        permit2.permitWitnessTransferFrom(
            _permit(amount, 3, block.timestamp + 1 days),
            IPermit2Witness.SignatureTransferDetails({to: POOL_MANAGER, requestedAmount: amount}),
            payer,
            _witness(_payment(bytes32("q4"), amount)),
            witnessTypeString(),
            sig
        );
    }

    /// @dev A pull inside a transaction that later fails must leave the payer exactly as it found
    ///      them — token AND nonce. The executor's settlement can fail after the pull, and an
    ///      authorisation burned by a transaction that achieved nothing would be a denial of
    ///      service the payer cannot undo without signing again.
    function test_Gate0_Permit2_AFailedOuterTransactionReturnsTheNonce() public {
        uint256 amount = 2 ether;
        uint256 nonce = 10;
        uint256 deadline = block.timestamp + 1 days;
        Payment memory p = _payment(bytes32("q10"), amount);
        // The spender is the intermediate contract, because Permit2 binds the signature to whoever
        // calls it. Signing for the executor and calling from another address is a different test.
        bytes memory sig = _signFor(p, address(pullThenRevert), nonce, deadline, amount);

        assertEq(permit2.nonceBitmap(payer, 0), 0, "the vector's nonce word should start clean");

        vm.expectRevert(PullThenRevert.Deliberate.selector);
        pullThenRevert.pullAndFail(
            PERMIT2,
            _permit(amount, nonce, deadline),
            IPermit2Witness.SignatureTransferDetails({to: POOL_MANAGER, requestedAmount: amount}),
            payer,
            _witness(p),
            witnessTypeString(),
            sig
        );

        assertEq(token.balanceOf(POOL_MANAGER), 0, "a failed transaction moved the payer's token");
        assertEq(permit2.nonceBitmap(payer, 0), 0, "a failed transaction burned the payer's nonce");

        // and the very same authorisation still works afterwards
        vm.prank(address(pullThenRevert));
        permit2.permitWitnessTransferFrom(
            _permit(amount, nonce, deadline),
            IPermit2Witness.SignatureTransferDetails({to: POOL_MANAGER, requestedAmount: amount}),
            payer,
            _witness(p),
            witnessTypeString(),
            sig
        );
        assertEq(token.balanceOf(POOL_MANAGER), amount, "the recovered authorisation did not work");
    }

    /// @dev THE ONE THAT DECIDES A DESIGN RULE. The destination is not signed, so a caller may send
    ///      the payer's token anywhere. Permit2 permits it; the payer's signature does not object.
    ///      This is why the V2 executor must FIX the destination in code and never accept it from
    ///      calldata — the row that proves the executor does so lives in the executor's own suite,
    ///      because it is a property of that contract and not of this one.
    function test_Gate0_Permit2_TheDESTINATIONIsNotSigned_SoTheExecutorMustFixIt() public {
        uint256 amount = 2 ether;
        address attacker = address(0xBAD1);
        bytes memory sig = _sign(_payment(bytes32("q5"), amount), 4, block.timestamp + 1 days, amount);

        vm.prank(executor); // the signed spender, but sending it somewhere else entirely
        permit2.permitWitnessTransferFrom(
            _permit(amount, 4, block.timestamp + 1 days),
            IPermit2Witness.SignatureTransferDetails({to: attacker, requestedAmount: amount}),
            payer,
            _witness(_payment(bytes32("q5"), amount)),
            witnessTypeString(),
            sig
        );

        assertEq(token.balanceOf(attacker), amount, "GATE 0 finding: the destination is caller-chosen");
        emit log_string("Permit2 accepted a destination the payer never signed.");
        emit log_string("V2 rule: the executor hard-codes to = PoolManager; it is never calldata.");
    }

    /// @dev Pins the composition Permit2 requires, so a change to either constant is caught here
    ///      rather than by a wallet that computes a different digest.
    function test_Gate0_Permit2_TheWitnessTypeStringDescribesTheStructWeActuallyHash() public pure {
        bytes memory w = bytes(witnessTypeString());
        bytes memory t = bytes(PAYMENT_TYPE);
        assertEq(string(_slice(w, 0, 16)), "Payment witness)", "the stub is not closed by a Payment witness field");
        assertEq(string(_slice(w, 16, t.length)), PAYMENT_TYPE, "the witness type string does not carry PAYMENT_TYPE");
        assertEq(
            string(_slice(w, 16 + t.length, w.length - 16 - t.length)),
            "TokenPermissions(address token,uint256 amount)",
            "TokenPermissions must close the type string"
        );
    }

    function _slice(bytes memory b, uint256 start, uint256 len) internal pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            out[i] = b[start + i];
        }
    }

    // ---- digest construction -------------------------------------------------------------

    function _payment(bytes32 quoteId, uint256 maxIn) internal view returns (Payment memory) {
        return Payment({
            quoteId: quoteId,
            payer: payer,
            tokenIn: address(token),
            maxIn: maxIn,
            destination: POOL_MANAGER,
            executor: executor
        });
    }

    function _witness(Payment memory p) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(bytes(PAYMENT_TYPE)), p.quoteId, p.payer, p.tokenIn, p.maxIn, p.destination, p.executor
            )
        );
    }

    function _permit(uint256 amount, uint256 nonce, uint256 deadline)
        internal
        view
        returns (IPermit2Witness.PermitTransferFrom memory)
    {
        return IPermit2Witness.PermitTransferFrom({
            permitted: IPermit2Witness.TokenPermissions({token: address(token), amount: amount}),
            nonce: nonce,
            deadline: deadline
        });
    }

    /// @dev Rebuilds Permit2's digest: the stub concatenated with our type string, the token
    ///      permissions hash, the SPENDER (which Permit2 takes as msg.sender at spend time), the
    ///      nonce, the deadline, and the witness.
    function _digestFor(Payment memory p, address spender, uint256 nonce, uint256 deadline, uint256 amount)
        internal
        view
        returns (bytes32)
    {
        bytes32 typeHash = keccak256(
            abi.encodePacked(
                "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,",
                witnessTypeString()
            )
        );
        bytes32 tokenPermissions = keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, p.tokenIn, amount));
        bytes32 structHash = keccak256(abi.encode(typeHash, tokenPermissions, spender, nonce, deadline, _witness(p)));
        return keccak256(abi.encodePacked("\x19\x01", permit2.DOMAIN_SEPARATOR(), structHash));
    }

    function _digest(Payment memory p, uint256 nonce, uint256 deadline, uint256 amount)
        internal
        view
        returns (bytes32)
    {
        return _digestFor(p, p.executor, nonce, deadline, amount);
    }

    function _sign(Payment memory p, uint256 nonce, uint256 deadline, uint256 amount)
        internal
        view
        returns (bytes memory)
    {
        return _signFor(p, p.executor, nonce, deadline, amount);
    }

    function _signFor(Payment memory p, address spender, uint256 nonce, uint256 deadline, uint256 amount)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, _digestFor(p, spender, nonce, deadline, amount));
        return abi.encodePacked(r, s, v);
    }
}
