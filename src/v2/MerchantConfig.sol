// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title The merchant's resolved configuration, and the commitment a quote carries to it
/// @notice A payer types a name. Somewhere between that name and a settlement, a resolution
///         happens — and a resolution is a reading of mutable state at a moment in time. This is
///         the record of that reading, hashed into one word that the merchant signs.
///
///         WHAT THIS BUYS. Without it, `recipient` in a quote is an address a payer was shown and
///         has to trust. With it, the name, the namehash, the address it resolved to, the currency
///         the merchant is paid in, the chain, and the block the reading was taken at are all
///         inside the merchant's signature. Change any of them and the quote digest moves, so the
///         merchant's signature no longer fits — which is exactly what should happen when the
///         thing the payer was shown is no longer the thing being settled.
///
/// @dev THE HOOK NEVER RESOLVES A NAME, and neither does the executor. Resolution happens off
///      chain, before an invoice exists; this contract only records what was resolved. That is
///      deliberate: an on-chain name lookup inside a settlement would be a new trust assumption, a
///      new failure mode, and a call that a hostile resolver could make expensive or revert.
///      `test/v2/MerchantConfig.t.sol` proves it by etching a contract that reverts on every call
///      at the ENSv2 resolver's address and settling anyway.
///
/// @dev RESOLUTION IS NOT IDENTITY. A name resolving proves who controls the name and nothing
///      whatever about the merchant behind it. Nothing in this file should be read as verification
///      of a business, and nothing in UNICA claims it.
library MerchantConfig {
    /// @notice What was read, and when.
    /// @dev `resolvedAtBlock` and `validForBlocks` are the expiry policy. They are inside the hash,
    ///      so a fresh resolution produces a DIFFERENT commitment and therefore a different quote
    ///      digest — which is the mechanism by which a stale checkout cannot be reused. There is no
    ///      on-chain expiry check because the settlement never sees this struct, only its hash; the
    ///      window is enforced by whoever holds the preimage, and the quote's own `deadline` is the
    ///      on-chain bound.
    struct Config {
        uint8 version;
        bytes32 namehash;
        string name;
        address recipient;
        address payoutCurrency;
        uint256 chainId;
        uint64 resolvedAtBlock;
        uint32 validForBlocks;
    }

    /// @dev EIP-712 shaped so a wallet can render it rather than showing a payer an opaque word.
    ///      The `string` member is hashed, as EIP-712 requires.
    string internal constant CONFIG_TYPE = "MerchantConfig(uint8 version,bytes32 namehash,string name,"
        "address recipient,address payoutCurrency,uint256 chainId,uint64 resolvedAtBlock,uint32 validForBlocks)";

    bytes32 internal constant CONFIG_TYPEHASH = keccak256(bytes(CONFIG_TYPE));

    function hash(Config memory c) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CONFIG_TYPEHASH,
                c.version,
                c.namehash,
                keccak256(bytes(c.name)),
                c.recipient,
                c.payoutCurrency,
                c.chainId,
                c.resolvedAtBlock,
                c.validForBlocks
            )
        );
    }

    /// @notice Whether a reading may still be relied on at a given block.
    /// @dev Off-chain policy, exposed here so the checkout surface and any verifier compute it the
    ///      same way. It is NOT consulted during settlement — see the note on the struct.
    function isFresh(Config memory c, uint256 atBlock) internal pure returns (bool) {
        return atBlock >= c.resolvedAtBlock && atBlock <= uint256(c.resolvedAtBlock) + c.validForBlocks;
    }
}
