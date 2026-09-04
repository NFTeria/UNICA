// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title Chains, the per-network table the scripts read
/// @notice Only networks with a verified entry are usable, and only testnets are listed. A mainnet
///         chain id reverts here by construction; there is no flag that turns it on.
/// @dev Every address below was read from the official v4 deployments page and confirmed to hold
///      code on 2026-09-04. The PoolManager itself comes from hookmate's AddressConstants so the
///      hook and the scripts resolve it the same way.
library Chains {
    struct Config {
        uint256 id;
        string name;
        address usdc;
        address poolSwapTest;
        address poolModifyLiquidityTest;
        address stateView;
        string explorer;
    }

    error UnsupportedChain(uint256 chainId);
    error MainnetForbidden(uint256 chainId);

    uint256 internal constant ETHEREUM_SEPOLIA = 11155111;

    /// @dev Testnets this repository may touch. Everything else is refused.
    function requireTestnet(uint256 chainId) internal pure {
        if (chainId == ETHEREUM_SEPOLIA) return;
        // Base Sepolia, Arbitrum Sepolia, Unichain Sepolia, Robinhood testnet: added when each is
        // verified and live-fired, never before.
        revert UnsupportedChain(chainId);
    }

    function get(uint256 chainId) internal pure returns (Config memory c) {
        requireTestnet(chainId);
        if (chainId == ETHEREUM_SEPOLIA) {
            return Config({
                id: ETHEREUM_SEPOLIA,
                name: "Ethereum Sepolia",
                usdc: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238,
                poolSwapTest: 0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe,
                poolModifyLiquidityTest: 0x0C478023803a644c94c4CE1C1e7b9A087e411B0A,
                stateView: 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C,
                explorer: "https://sepolia.etherscan.io"
            });
        }
        revert UnsupportedChain(chainId);
    }
}
