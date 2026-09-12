// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// TEST ONLY — never deployed by any script, never imported by anything under `src/`.
//
// Six ERC-20s that misbehave in exactly one way each, so the executor's money-path guards can be
// reached by the attack they were written for rather than by a mock. Every one of them extends the
// same `MockERC20` the fixtures use, so its STORAGE LAYOUT is that mock's (name, symbol,
// totalSupply, balanceOf, allowance, nonces, then this file's own fields) and it can be etched over
// a live market's token in place with `vm.etch` without disturbing a single balance.
//
// EVERY HOSTILE BEHAVIOUR IS OFF BY DEFAULT. A row etches the code, runs its control on the very
// same market, then arms the one behaviour it is about. That is what makes the control a control:
// the only difference between the passing run and the refused one is the switch.
//
// A NOTE ON WHAT A LOW-LEVEL CALL HIDES. The executor moves tokens with `address.call`, so ANY
// revert raised inside a token's `transfer`/`transferFrom` reaches it as `TransferFailed(token)` and
// the inner reason is lost. Two of these tokens therefore CATCH the refusal they provoke and record
// it (`lastError`), so the row can assert the refusal by name instead of asserting the envelope that
// swallowed it. That is a property of the executor's defensive call, not a softening of the attack.

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

/// @dev The one call a re-entrant token makes back into the executor. Declared here rather than
///      imported so this fixture does not take a compile-time dependency on a contract that is
///      being edited while these rows are written.
interface IUnicaPayable {
    function pay(bytes32 orderId) external;
}

/// @title SyncingAsset — the input token that makes the PoolManager's credit the wrong credit
/// @notice Rows X9a and X16, which reach the SAME guard by two different routes.
///
///         X9a (`armForeignSync`). The executor's callback does `sync(asset)`, then hands the pool
///         the input, then `settle()` and requires the credit to equal `amountIn`. This token, on
///         its way to the PoolManager, calls `sync(foreignCurrency)` first. The PoolManager now
///         measures the settle against the FOREIGN currency's reserves, which nothing moved, so the
///         credit is zero and the executor refuses with `SettlementDidNotClose(amountIn, 0)`. The
///         attack is A6: an issuer-controlled transfer running while the manager is unlocked.
///
///         X16 (`armSkim`). The same token charging a fee ONLY on transfers to the PoolManager. The
///         pull into the executor is exact, so `InputNotExact` never fires; the pool is then handed
///         less than it is owed and the credit falls short of `amountIn`, which is the other way to
///         `SettlementDidNotClose`.
contract SyncingAsset is MockERC20 {
    IPoolManager public poolManager;
    Currency public foreignCurrency;
    bool public syncForeign;
    uint256 public skimBps;

    constructor(string memory n, string memory s, uint8 d) MockERC20(n, s, d) {}

    /// @notice Both halves of the attack need the same two facts: who the PoolManager is, and which
    ///         currency is the wrong one to have synced.
    function setTarget(IPoolManager poolManager_, Currency foreignCurrency_) external {
        poolManager = poolManager_;
        foreignCurrency = foreignCurrency_;
    }

    function armForeignSync(bool on) external {
        syncForeign = on;
    }

    function armSkim(uint256 bps) external {
        skimBps = bps;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (to != address(poolManager) || address(poolManager) == address(0)) {
            return super.transfer(to, amount);
        }
        if (syncForeign) poolManager.sync(foreignCurrency);

        uint256 fee = (amount * skimBps) / 10_000;
        balanceOf[msg.sender] -= amount;
        unchecked {
            balanceOf[to] += amount - fee;
            balanceOf[address(0xdead)] += fee;
        }
        return true;
    }
}

/// @title ReenteringAsset — the input token that pays a second order from inside the first
/// @notice Row X17. The executor pulls the input with `transferFrom` AFTER it has taken its
///         transient latch, so a token that calls `pay` again from inside that pull is the exact
///         shape the latch exists for. The second order names THIS TOKEN as its payer, funded and
///         approved, so nothing but the latch refuses it — a re-entry that `WrongPayer` would have
///         caught anyway proves nothing about the latch.
///
///         The refusal is caught and recorded rather than bubbled, because the executor's
///         `_pullExact` uses a low-level call and would have relabelled it `TransferFailed`.
contract ReenteringAsset is MockERC20 {
    address public executor;
    bytes32 public secondOrderId;
    bool public armed;
    bool public entered;
    /// @notice The raw revert data of the re-entrant `pay`, empty when it did not revert at all.
    bytes public lastError;
    bool public reentrantCallSucceeded;

    constructor(string memory n, string memory s, uint8 d) MockERC20(n, s, d) {}

    function arm(address executor_, bytes32 secondOrderId_) external {
        executor = executor_;
        secondOrderId = secondOrderId_;
        armed = true;
        entered = false;
        delete lastError;
        reentrantCallSucceeded = false;
    }

    function disarm() external {
        armed = false;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        unchecked {
            balanceOf[to] += amount;
        }

        if (armed && !entered) {
            entered = true;
            try IUnicaPayable(executor).pay(secondOrderId) {
                reentrantCallSucceeded = true;
            } catch (bytes memory err) {
                lastError = err;
            }
        }
        return true;
    }
}

/// @title DebitingPayout — the payout token that will not leave the delivery alone
/// @notice Rows X14b and the `DeliveryNotExact` row. The PoolManager's `take` sends the output
///         straight to the merchant with `transfer`, so this token gets one call in which the
///         delivery is already made and can still be spoiled:
///
///         `Mode.DebitRecipient` takes `units` back off the merchant inside that same call, so the
///         balance change the executor measures is smaller than the `out` the pool reported.
///         `Mode.CreditExecutor` mints `units` to the executor instead, so the executor ends the
///         payment holding payout tokens it did not start with.
contract DebitingPayout is MockERC20 {
    enum Mode {
        Off,
        DebitRecipient,
        CreditExecutor
    }

    address public recipient;
    address public executor;
    Mode public mode;
    uint256 public units = 1;

    constructor(string memory n, string memory s, uint8 d) MockERC20(n, s, d) {}

    function setTarget(address recipient_, address executor_) external {
        recipient = recipient_;
        executor = executor_;
    }

    function arm(Mode mode_, uint256 units_) external {
        mode = mode_;
        units = units_;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool ok = super.transfer(to, amount);
        if (mode == Mode.Off || to != recipient || recipient == address(0)) return ok;

        if (mode == Mode.DebitRecipient) {
            balanceOf[recipient] -= units;
            unchecked {
                balanceOf[address(0xdead)] += units;
            }
        } else {
            totalSupply += units;
            unchecked {
                balanceOf[executor] += units;
            }
        }
        return ok;
    }
}

/// @title CreditingAsset — the input token that quietly leaves the executor holding something
/// @notice Row X14a. Two arming points, because only one of them reaches the guard the row names
///         and saying which is the whole point:
///
///         `When.OnPull` mints to the executor during `transferFrom`. That is caught EARLIER, by
///         `InputNotExact`, because the executor measures the pull against its own snapshot — a
///         useful negative result, asserted by its own row rather than assumed.
///         `When.OnSettleTransfer` mints during the transfer to the PoolManager instead, after the
///         pull has been measured and while the pool still receives exactly what it is owed. Now
///         nothing else disagrees and only `ExecutorResidualInput` is left to catch it.
contract CreditingAsset is MockERC20 {
    enum When {
        Off,
        OnPull,
        OnSettleTransfer
    }

    address public executor;
    address public poolManager;
    When public when;
    uint256 public units = 1;

    constructor(string memory n, string memory s, uint8 d) MockERC20(n, s, d) {}

    function setTarget(address executor_, address poolManager_) external {
        executor = executor_;
        poolManager = poolManager_;
    }

    function arm(When when_, uint256 units_) external {
        when = when_;
        units = units_;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        bool ok = super.transferFrom(from, to, amount);
        if (when == When.OnPull) _credit();
        return ok;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool ok = super.transfer(to, amount);
        if (when == When.OnSettleTransfer && to == poolManager && poolManager != address(0)) _credit();
        return ok;
    }

    function _credit() private {
        totalSupply += units;
        unchecked {
            balanceOf[executor] += units;
        }
    }
}

/// @title SwapDuringUnlockAsset — the input token that reaches back into the unlocked PoolManager
/// @notice Rows X9b, X9c and X9d. All three share one moment: the executor has taken the lock,
///         synced the asset and is transferring the input to the PoolManager. This token uses that
///         call to do one further thing to the manager, selected per row.
///
///         `Action.SettleFor` (X9b) steals the settle: it lets the transfer land, then calls
///         `settleFor(executor)` so the PoolManager credits the input to the executor and RESETS
///         the synced currency. The executor's own `settle()` then measures nothing.
///         `Action.Swap` (X9c) tries a swap on the market's own key. The hook sees a `sender` that
///         is not its executor.
///         `Action.ModifyLiquidity` (X9d) tries to touch liquidity in the middle of the payment.
///
///         The action's own revert is caught into `lastError` for the two rows whose refusal would
///         otherwise be relabelled `TransferFailed` by the executor's low-level call, and the
///         honest transfer always completes, so a row can assert the delivery and the receipt are
///         exactly what they were without the attack.
contract SwapDuringUnlockAsset is MockERC20 {
    enum Action {
        Off,
        SettleFor,
        Swap,
        ModifyLiquidity
    }

    IPoolManager public poolManager;
    PoolKey internal _key;
    address public executor;
    Action public action;
    int24 public tickLower;
    int24 public tickUpper;
    bool public acted;
    /// @notice The raw revert data of the intrusion, empty when it did not revert.
    bytes public lastError;

    constructor(string memory n, string memory s, uint8 d) MockERC20(n, s, d) {}

    function setTarget(IPoolManager poolManager_, PoolKey memory key_, address executor_) external {
        poolManager = poolManager_;
        _key = key_;
        executor = executor_;
    }

    function arm(Action action_, int24 tickLower_, int24 tickUpper_) external {
        action = action_;
        tickLower = tickLower_;
        tickUpper = tickUpper_;
        acted = false;
        delete lastError;
    }

    function key() external view returns (PoolKey memory) {
        return _key;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool ok = super.transfer(to, amount);
        if (action == Action.Off || to != address(poolManager) || address(poolManager) == address(0) || acted) {
            return ok;
        }
        acted = true;

        if (action == Action.SettleFor) {
            try poolManager.settleFor(executor) returns (uint256) {}
            catch (bytes memory err) {
                lastError = err;
            }
        } else if (action == Action.Swap) {
            bool zeroForOne = Currency.unwrap(_key.currency0) == address(this);
            try poolManager.swap(
                _key,
                SwapParams({
                    zeroForOne: zeroForOne,
                    amountSpecified: -int256(1e12),
                    sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                }),
                ""
            ) returns (
                BalanceDelta
            ) {}
            catch (bytes memory err) {
                lastError = err;
            }
        } else {
            try poolManager.modifyLiquidity(
                _key,
                ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: 0, salt: 0}),
                ""
            ) returns (
                BalanceDelta, BalanceDelta
            ) {}
            catch (bytes memory err) {
                lastError = err;
            }
        }
        return ok;
    }
}
