// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title The one Permit2 call UNICA V2 makes, declared rather than imported
/// @notice Permit2's source pins `pragma solidity 0.8.17` and this tree pins 0.8.30, so it cannot be
///         compiled here at all. It is reached at its canonical address through this declaration.
///         Nothing is copied: these are signatures, and a signature written differently does not
///         compile against the deployed contract.
/// @dev The canonical address is the same on every chain Permit2 is deployed to:
///      0x000000000022D473030F116dDEE9F6B43aC78BA3. It is passed in at construction rather than
///      hard-coded, so a test can place a runtime somewhere else without the executor pretending it
///      is somewhere it is not.
interface IPermit2Transfer {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    /// @dev `to` is chosen by the CALLER at spend time and is NOT covered by the payer's signature.
    ///      Measured in `test/v2/Permit2Witness.t.sol`, where a transfer to an attacker was accepted
    ///      and the payer's signature did not object. This is why the V2 executor writes
    ///      `to = address(POOL_MANAGER)` as a literal and never reads it from calldata.
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
}

/// @notice What the executor asks of the hook it is about to swap through.
/// @dev The binding is mutual and neither constructor depends on the other: the hook is built with
///      the executor's address, and the executor asks any hook named in a quote whether it is bound
///      to THIS executor. A circular constructor would make both addresses unmineable.
interface IInvoiceHook {
    function EXECUTOR() external view returns (address);
    function consumed(bytes32 quoteDigest) external view returns (bool);
}
