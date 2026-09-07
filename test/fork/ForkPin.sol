// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";

/// @title The pinned Sepolia fork every V2 fork test runs against
/// @notice A fork test against `latest` is a test whose result nobody can reproduce and whose
///         failure nobody can distinguish from someone else's transaction. Everything below is
///         fixed, recorded, and asserted at run time — the block, its hash, its timestamp, and the
///         runtime code hash of every dependency the settlement touches.
///
///         READ-ONLY. Nothing here broadcasts. The V2 contracts these tests deploy are deployed
///         INTO THE FORK, which is a local sandbox; they do not exist on Sepolia and no row claims
///         they do.
///
/// @dev The endpoint is read from `SEPOLIA_RPC_URL` and falls back to a public node that needs no
///      key, so nothing secret is committed and nothing secret is printed. If neither works the
///      fork cannot be created and forge says so plainly — which is the correct failure, because a
///      fork test that quietly ran against nothing would be worse than no fork test.
abstract contract ForkPin is Test {
    uint256 internal constant PINNED_CHAIN_ID = 11155111;
    uint256 internal constant DEFAULT_BLOCK = 11656955;
    /// @dev Block hash of the pinned block, read with `cast block` on 2026-09-07.
    ///
    ///      RE-PINNED TWICE, and the second time settled the design. Block 11656449 stopped
    ///      resolving within the hour and 11656701 within minutes: the public node answers
    ///      `historical state ... is not available` for any storage slot no earlier run had warmed.
    ///      Suites with warm caches keep passing, which is the dangerous shape — the pin looks
    ///      reproducible right up until a new row touches an uncached slot.
    ///
    ///      Chasing the head with a new constant every time is not engineering, so the block is
    ///      OVERRIDABLE. `UNICA_FORK_BLOCK` moves it; the default below is a block that worked when
    ///      it was written. On a pruning endpoint an operator sets the variable; on an archive
    ///      endpoint the default resolves forever.
    ///
    ///      What that costs is honest and small: the block-hash and timestamp rows only assert when
    ///      running at the DEFAULT block, and say so out loud when they do not. Every dependency's
    ///      CODE HASH is asserted either way, and those are unchanged across all three pins — which
    ///      is the substantive claim. The pin moved; the dependencies did not.
    bytes32 internal constant DEFAULT_BLOCK_HASH = 0xd92c7168e4ba7017d3081fada61d3c20dc807187fc3767f3fc83325ce8cd1da5;
    uint256 internal constant DEFAULT_TIMESTAMP = 1788818688;

    /// @dev A public endpoint with no API key. Recorded rather than hidden, precisely because it
    ///      carries no secret; a private endpoint may be supplied through the environment instead.
    string internal constant PUBLIC_SEPOLIA = "https://ethereum-sepolia-rpc.publicnode.com";

    // ---- the dependencies, and the exact code that must be at each address -------------------

    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    bytes32 internal constant PM_CODEHASH = 0x09930125a49f5b95caf8052991cc14d1240dca8b43f42b899115b86867e4bce1;
    uint256 internal constant POOL_MANAGER_CODE_SIZE = 24009;

    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    bytes32 internal constant PERMIT2_CODEHASH = 0x96d9f5c3f0fb0423426b7f970186235b7347027f4e5c19c40c412b7d97fc3751;
    uint256 internal constant PERMIT2_CODE_SIZE = 9152;

    /// @dev forge-std's `Base` already declares `CREATE2_FACTORY`, so this one is named for what
    ///      it is used for here rather than shadowing a name the harness owns.
    address internal constant DETERMINISTIC_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 internal constant DEPLOYER_CODEHASH = 0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989;

    /// @dev Circle's Sepolia USDC. A PROXY: 1,798 bytes of forwarder in front of a 23,464-byte
    ///      implementation at `0xda317c1d3e835dd5f1be459006471acaa1289068`, found at the
    ///      `org.zeppelinos.proxy.implementation` slot rather than EIP-1967's — which is itself
    ///      worth recording, because a reader checking the EIP-1967 slot finds zero and could
    ///      conclude the token is not upgradeable. It is.
    address internal constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    bytes32 internal constant USDC_CODEHASH = 0xcd3f29e2ea9c61dadd48bfeaf8b2884b6de9dfee7bf45329452c4c33d0868ceb;
    address internal constant USDC_IMPLEMENTATION = 0xDa317C1d3E835dD5F1BE459006471aCAA1289068;
    bytes32 internal constant USDC_IMPL_SLOT = 0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3;
    uint8 internal constant USDC_DECIMALS = 6;

    /// @dev Canonical Sepolia WETH9. Not a proxy.
    address internal constant WETH9 = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    bytes32 internal constant WETH9_CODEHASH = 0xc864e10689f2da18833652a3b075d43106e87f0f90d95ee64f6f0b33bc026083;
    uint8 internal constant WETH9_DECIMALS = 18;

    // ---- V1, live, so a fork row can re-prove it without trusting the README -----------------

    address internal constant V1_HOOK = 0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0;
    address internal constant V1_EXECUTOR = 0x044bc8a8773EC7b9B8de2467766636dFFCaC6210;
    bytes32 internal constant V1_HOOK_CODEHASH = 0x64a9ec1dfcad68b525bed8705cb40e2f71e8887dd90f68fba1321d87b61e96d4;

    // ---- the selected V2 pool ------------------------------------------------------------------

    /// @dev USDC sorts below WETH, so currency0 is USDC. The merchant is paid in USDC, which makes
    ///      the output currency0 and the swap one-for-zero — the opposite direction to every local
    ///      suite, which is itself worth having: the direction logic is exercised both ways.
    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant POOL_TICK_SPACING = 60;
    /// @dev 20000 << 96 — about 2,500 USDC per WETH once the 6/18 decimal difference is applied.
    uint160 internal constant POOL_SQRT_PRICE = 1584563250285286751870879006720000;

    function _forkUrl() internal view returns (string memory) {
        return vm.envOr("SEPOLIA_RPC_URL", PUBLIC_SEPOLIA);
    }

    /// @notice The block this run pins to: the default, or whatever `UNICA_FORK_BLOCK` names.
    function _forkBlock() internal view returns (uint256) {
        return vm.envOr("UNICA_FORK_BLOCK", DEFAULT_BLOCK);
    }

    /// @notice True when this run is at the recorded default, and the block hash and timestamp
    ///         below can therefore be asserted rather than skipped.
    function _atDefaultPin() internal view returns (bool) {
        return _forkBlock() == DEFAULT_BLOCK;
    }

    function _selectPinnedFork() internal {
        vm.createSelectFork(_forkUrl(), _forkBlock());
        require(block.chainid == PINNED_CHAIN_ID, "fork: wrong chain");
        require(block.number == _forkBlock(), "fork: wrong block");
        if (_atDefaultPin()) {
            require(block.timestamp == DEFAULT_TIMESTAMP, "fork: wrong timestamp for the default pin");
        }
    }
}
