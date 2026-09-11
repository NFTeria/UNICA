// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {TestPayoutToken} from "../../src/experimental/robinhood-testnet/TestPayoutToken.sol";

/// @title The testnet payout token: exactly what it says, and nothing a stranger can change
/// @notice Local only. Every row is a property the settlement relies on or a reader would assume.
contract TestPayoutTokenTest is Test {
    TestPayoutToken internal token;
    address internal minter = makeAddr("minter");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        token = new TestPayoutToken(minter);
    }

    function test_P1_identity_is_visibly_a_no_value_test_asset() public view {
        assertEq(token.symbol(), "uTUSD", "symbol");
        assertEq(token.name(), "UNICA Test Dollar (testnet, no value)", "name must say testnet and no value");
        assertEq(token.decimals(), 6, "six decimals, so every settlement crosses the 18-to-6 boundary");
        assertEq(token.totalSupply(), 0, "nothing exists until the minter mints it");
    }

    function test_P2_only_the_minter_mints() public {
        vm.prank(minter);
        token.mint(stranger, 5e6);
        assertEq(token.balanceOf(stranger), 5e6, "minted amount");
        assertEq(token.totalSupply(), 5e6, "supply is exactly what was minted");

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TestPayoutToken.NotMinter.selector, stranger));
        token.mint(stranger, 1);
    }

    function test_P3_the_minter_is_fixed_and_never_zero() public {
        assertEq(token.MINTER(), minter, "minter");
        vm.expectRevert(TestPayoutToken.ZeroMinter.selector);
        new TestPayoutToken(address(0));
    }

    /// @dev The executor's token calls accept `true` or an empty return. This token must give the
    ///      conventional answer on both paths and move exactly the amount named — no fee, no callback.
    function test_P4_transfers_are_conventional_and_exact() public {
        vm.prank(minter);
        token.mint(minter, 10e6);

        vm.prank(minter);
        assertTrue(token.transfer(stranger, 3e6), "transfer returns true");
        assertEq(token.balanceOf(stranger), 3e6, "transfer moves exactly the amount");

        vm.prank(stranger);
        token.approve(address(this), 2e6);
        assertTrue(token.transferFrom(stranger, minter, 2e6), "transferFrom returns true");
        assertEq(token.balanceOf(stranger), 1e6, "transferFrom moves exactly the amount");
        assertEq(token.totalSupply(), 10e6, "no fee is taken anywhere");
    }

    /// @dev No admin surface exists to be abused. Asserted against the deployed DISPATCHER, not by
    ///      calling: a call to a missing function and a call to a present one with bad arguments both
    ///      revert, so a call-based check cannot tell absent from present. Solidity's dispatcher
    ///      compares each selector with a PUSH4 (0x63) — so a selector the contract serves appears in
    ///      its runtime as 0x63 followed by those four bytes.
    ///
    ///      CONTROL FIRST: `mint` must be FOUND, which proves the scan can see a selector at all. A
    ///      scan that finds nothing would otherwise report every admin function as absent.
    function test_P5_no_admin_surface_beyond_mint() public view {
        bytes memory code = address(token).code;
        assertTrue(_serves(code, TestPayoutToken.mint.selector), "control: the scan cannot see mint");
        assertTrue(_serves(code, token.transfer.selector), "control: the scan cannot see transfer");

        bytes4[6] memory absent = [
            bytes4(keccak256("setMinter(address)")),
            bytes4(keccak256("pause()")),
            bytes4(keccak256("blacklist(address)")),
            bytes4(keccak256("burnFrom(address,uint256)")),
            bytes4(keccak256("transferOwnership(address)")),
            bytes4(keccak256("upgradeTo(address)"))
        ];
        for (uint256 i = 0; i < absent.length; i++) {
            assertFalse(_serves(code, absent[i]), "an admin entry point exists that should not");
        }
    }

    function _serves(bytes memory code, bytes4 sel) internal pure returns (bool) {
        for (uint256 i = 0; i + 4 < code.length; i++) {
            if (
                code[i] == 0x63 && code[i + 1] == sel[0] && code[i + 2] == sel[1] && code[i + 3] == sel[2]
                    && code[i + 4] == sel[3]
            ) return true;
        }
        return false;
    }
}
