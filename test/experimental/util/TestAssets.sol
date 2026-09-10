// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

/// @title Local test assets for the experimental stock-settlement rows
/// @notice TEST FIXTURES ONLY. None of these is deployed anywhere, and none is a claim about any
///         real asset. They exist so a settlement can be driven end to end with no network.
///
///         WHY THE PAYOUT TOKEN IS NOT CALLED USDC. The chain this generation targets carries FOUR
///         separate contracts using the symbol `USDC` — two of them at 18 decimals, where Circle's
///         has 6 — and six using `USDG`. Symbol is not identity there. Naming a local fixture USDC
///         would import that ambiguity into the tests and, worse, into any screenshot of them.
///         `uTUSD` is visibly ours and visibly a test asset.

/// @notice An 18-decimal stand-in for a faucet-issued stock-token contract. Conventional ERC-20
///         behaviour: returns true, no fee, no rebase, no callback.
/// @dev The symbol matches the faucet-issued contract this generation is aimed at so the decimal
///      arithmetic in the tests is the real arithmetic. It is a MOCK and is not that contract.
contract MockStockToken is MockERC20 {
    /// @dev Off by default, so the token is conventional unless a row deliberately makes it hostile.
    ///      A toggle rather than a separate contract because the executor binds ONE input currency
    ///      at construction: a second token would need a second executor, a second hook and a second
    ///      pool, and the hazard would then be tested on a topology no row otherwise uses.
    uint256 public feeBps;

    constructor() MockERC20("Mock Stock Token (test fixture)", "mTSLA", 18) {}

    function setFeeBps(uint256 bps) external {
        feeBps = bps;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (feeBps == 0) return super.transferFrom(from, to, amount);
        uint256 fee = (amount * feeBps) / 10_000;
        if (allowance[from][msg.sender] != type(uint256).max) allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        unchecked {
            balanceOf[to] += amount - fee;
            totalSupply -= fee;
        }
        emit Transfer(from, to, amount - fee);
        return true;
    }
}

/// @notice The merchant payout asset for local rows. Six decimals, so every settlement crosses the
///         18-to-6 boundary that is the actual source of precision bugs.
/// @dev NOT a stablecoin and not a claim to be one. Nothing backs it, anyone in the test may mint
///      it, and its only purpose is to be a second token with different decimals. Its local use
///      establishes nothing whatever about a payout token's suitability on any real chain.
contract UnicaTestDollar is MockERC20 {
    /// @dev A payout token that calls back on delivery, off by default. This is the ERC-777-shaped
    ///      hazard at the one place it bites: the `take` that pays the merchant happens inside the
    ///      PoolManager's lock, so a token that re-enters there is re-entering mid-settlement.
    address public reenterTarget;
    bytes public reenterCalldata;

    constructor() MockERC20("UNICA Test Dollar", "uTUSD", 6) {}

    function armReentry(address target, bytes calldata data) external {
        reenterTarget = target;
        reenterCalldata = data;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool ok = super.transfer(to, amount);
        address t = reenterTarget;
        if (t != address(0)) {
            reenterTarget = address(0); // one shot, so the callback cannot recurse forever
            (bool hit,) = t.call(reenterCalldata);
            hit; // the return is deliberately ignored: what matters is that the victim refused
        }
        return ok;
    }
}

/// @notice An input token that takes a cut of every transfer. The executor must refuse it.
contract FeeOnTransferInput is MockERC20 {
    uint256 public immutable FEE_BPS;

    constructor(uint256 feeBps) MockERC20("Fee On Transfer Input", "mFEE", 18) {
        FEE_BPS = feeBps;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 fee = (amount * FEE_BPS) / 10_000;
        balanceOf[from] -= amount;
        unchecked {
            balanceOf[to] += amount - fee;
            totalSupply -= fee;
        }
        emit Transfer(from, to, amount - fee);
        return true;
    }
}

/// @notice A token whose `transferFrom` returns false instead of reverting. Silent failure is the
///         hazard: an executor that ignores the return value would proceed having moved nothing.
contract FalseReturnInput is MockERC20 {
    constructor() MockERC20("False Return Input", "mFALSE", 18) {}

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}

/// @notice A token that returns NOTHING at all — the pre-ERC-20-standard shape. It must be accepted
///         when it succeeds, which is the opposite hazard to the one above, and is why the
///         executor's return-value handling has to distinguish empty from false.
contract NoReturnInput {
    string public name = "No Return Input";
    string public symbol = "mVOID";
    uint8 public decimals = 18;
    mapping(address holder => uint256) public balanceOf;
    mapping(address owner => mapping(address spender => uint256)) private _approved;

    function allowance(address owner, address spender) external view returns (uint256) {
        return _approved[owner][spender];
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _approved[msg.sender][spender] = amount;
        return true;
    }

    /// @dev Deliberately no return value.
    function transfer(address to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }

    /// @dev Deliberately no return value.
    function transferFrom(address from, address to, uint256 amount) external {
        uint256 permitted = _approved[from][msg.sender];
        if (permitted != type(uint256).max) {
            _approved[from][msg.sender] = permitted - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
