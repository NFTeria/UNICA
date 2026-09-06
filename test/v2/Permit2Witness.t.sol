// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {Permit2Deployer} from "hookmate/artifacts/Permit2.sol";

/// @notice The three functions this gate calls, declared here from their documented signatures.
///         Permit2's own source pins `pragma solidity 0.8.17` while this tree pins 0.8.30, so it
///         cannot be compiled here at all; the runtime is deployed from an artifact instead and
///         reached through this interface. Nothing is copied — these are signatures, and a
///         signature written differently does not compile.
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
}

/// @title GATE 0 — can the payer's token reach the PoolManager without the executor holding it?
/// @notice PATH B1 rests on a Permit2 property that is easy to state and worth measuring: the
///         payer signs WHAT may move and HOW MUCH, while the DESTINATION is chosen by the caller
///         at spend time. If that is true, an executor can direct a bounded pull straight to the
///         PoolManager. If it is false, B1 is dead.
///
///         The same property is the danger. A destination the payer does not sign is a
///         destination a relayer would love to choose, which is exactly why the executor must fix
///         it in code rather than accept it from calldata. This file measures both halves.
contract Permit2WitnessGateTest is Test {
    /// @dev Permit2's canonical address, identical on every chain it is deployed to.
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    /// @dev Stands in for the PoolManager: what matters is that it is not the executor.
    address internal constant POOL_MANAGER = address(0xBEEF);

    IPermit2Witness internal permit2;
    MockERC20 internal token;

    uint256 internal payerKey = 0xA11CE;
    address internal payer;
    address internal executor = address(0xE7EC);
    address internal relayer = address(0x5EEDBAD);

    /// @dev The payer's half of a V2 invoice: which quote, and the ceiling they accept. Written
    ///      for this design; the type string below must describe it exactly or the digest differs.
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

    /// @dev Permit2 concatenates its stub with this string, so the witness type must come first
    ///      and `TokenPermissions` must follow, in that order, or the typehash is a different one.
    ///      DERIVED from PAYMENT_TYPE rather than written out a second time: an earlier version
    ///      hard-coded both, and a sabotage that renamed a field in one of them left every row
    ///      green, because the signer and the call were reading the same corrupted copy. Two
    ///      hand-maintained descriptions of one struct is a mismatch waiting to happen, and the
    ///      mismatch surfaces in a payer's wallet, not here.
    ///      A constant cannot call string.concat, so it is a function instead — the point is that
    ///      the struct type appears exactly once in this file.
    function witnessTypeString() internal pure returns (string memory) {
        return string.concat("Payment witness)", PAYMENT_TYPE, "TokenPermissions(address token,uint256 amount)");
    }

    bytes32 internal constant TOKEN_PERMISSIONS_TYPEHASH = keccak256("TokenPermissions(address token,uint256 amount)");

    function setUp() public {
        payer = vm.addr(payerKey);
        vm.etch(PERMIT2, "");
        address deployed = Permit2Deployer.deploy();
        vm.etch(PERMIT2, deployed.code);
        permit2 = IPermit2Witness(PERMIT2);

        token = new MockERC20("In", "IN", 18);
        token.mint(payer, 1_000 ether);
        vm.prank(payer);
        token.approve(PERMIT2, type(uint256).max);
    }

    // ---- the rows ------------------------------------------------------------------------

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

    function test_Gate0_Permit2_TheExecutorCanPullLESSThanTheCeiling() public {
        uint256 ceiling = 5 ether;
        uint256 realised = 3 ether;
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
        vm.expectRevert(); // the nonce is spent; the remaining 4 ether of ceiling is unreachable
        permit2.permitWitnessTransferFrom(
            p,
            IPermit2Witness.SignatureTransferDetails({to: POOL_MANAGER, requestedAmount: 1 ether}),
            payer,
            w,
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
        vm.expectRevert();
        permit2.permitWitnessTransferFrom(
            _permit(amount, 3, block.timestamp + 1 days),
            IPermit2Witness.SignatureTransferDetails({to: POOL_MANAGER, requestedAmount: amount}),
            payer,
            _witness(_payment(bytes32("q4"), amount)),
            witnessTypeString(),
            sig
        );
    }

    /// @dev THE ONE THAT DECIDES A DESIGN RULE. The destination is not signed, so a caller may
    ///      send the payer's token anywhere. Permit2 permits it; the payer's signature does not
    ///      object. This is why the V2 executor must FIX the destination in code and never accept
    ///      it from calldata — and the witness carries the intended destination so a verifier can
    ///      see afterwards where it was meant to go.
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
        // it opens with the witness field declaration, closing the stub's open parenthesis
        assertEq(string(_slice(w, 0, 16)), "Payment witness)", "the stub is not closed by a Payment witness field");
        // the struct definition follows, verbatim
        assertEq(string(_slice(w, 16, t.length)), PAYMENT_TYPE, "the witness type string does not carry PAYMENT_TYPE");
        // and TokenPermissions comes last, as Permit2 requires
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

    /// @dev Rebuilds Permit2's digest exactly: the stub concatenated with our type string, the
    ///      token permissions hash, the SPENDER (which Permit2 takes as msg.sender at spend time),
    ///      the nonce, the deadline, and the witness.
    function _sign(Payment memory p, uint256 nonce, uint256 deadline, uint256 amount)
        internal
        view
        returns (bytes memory)
    {
        bytes32 typeHash = keccak256(
            abi.encodePacked(
                "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,",
                witnessTypeString()
            )
        );
        bytes32 tokenPermissions = keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, address(token), amount));
        bytes32 structHash = keccak256(abi.encode(typeHash, tokenPermissions, p.executor, nonce, deadline, _witness(p)));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", permit2.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
