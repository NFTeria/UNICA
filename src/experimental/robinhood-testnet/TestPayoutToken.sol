// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solmate/src/tokens/ERC20.sol";

/// @title TestPayoutToken — the payout asset for the stock-settlement experiment on a testnet
/// @notice EXPERIMENTAL, TESTNET ONLY. A clearly-named test token with no value and no backing. It is
///         not a stablecoin, it is not USDC or any Circle asset, and it tracks nothing. It exists
///         because the target testnet has no payout token whose issuer and mint authority can be
///         stated: every `USDC`-symbol contract there is of unknown origin, and symbol is not
///         identity. This one's origin can be stated in one line — the deployer made it, and only the
///         deployer can mint it.
///
///         WHY IT IS NOT THE LOCAL FIXTURE. `UnicaTestDollar` in the test tree lets anyone mint, and
///         carries a re-entry switch and a delivery-fee switch anyone can flip. Those are what make
///         it a useful HOSTILE fixture and exactly what makes it unfit for a public chain, where a
///         stranger could arm them. This contract has neither: a conventional ERC-20 that returns
///         true, takes no fee, never rebases and calls back into nobody.
///
///         WHY MINTING IS RESTRICTED. The payout side of the settlement pool is seeded from this
///         token. If anyone could mint it, anyone could mint an unbounded amount and drain the pool's
///         input side by selling into it — the rate the pool offers would mean nothing. One named
///         minter makes the supply a single, checkable fact. The minter is fixed at construction and
///         cannot be changed or renounced, so there is no admin path to reason about.
contract TestPayoutToken is ERC20 {
    /// @notice The only address that can mint. Fixed at construction; there is no setter.
    address public immutable MINTER;

    error NotMinter(address caller);
    error ZeroMinter();

    constructor(address minter_) ERC20("UNICA Test Dollar (testnet, no value)", "uTUSD", 6) {
        if (minter_ == address(0)) revert ZeroMinter();
        MINTER = minter_;
    }

    /// @notice Creates `amount` raw units (6 decimals) for `to`. Minter only.
    function mint(address to, uint256 amount) external {
        if (msg.sender != MINTER) revert NotMinter(msg.sender);
        _mint(to, amount);
    }
}
