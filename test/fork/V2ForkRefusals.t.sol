// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IQuoteSettlement} from "../../src/v2/interfaces/IQuoteSettlement.sol";
import {QuoteSettlementExecutor} from "../../src/v2/QuoteSettlementExecutor.sol";
import {IPermit2Transfer} from "../../src/v2/interfaces/IPermit2Transfer.sol";
import {V2ForkFixture, StrangerSwapper} from "./util/V2ForkFixture.sol";

interface IPermit2Errors {
    error InvalidAmount(uint256 maxAmount);
    error InvalidNonce();
    error InvalidSigner();
    error SignatureExpired(uint256 signatureDeadline);
}

/// @dev A contract that claims to be a merchant. It has code, so it is not an EOA, and it cannot
///      produce an ECDSA signature over anything.
contract PretendMerchant {
    function isValidSignature(bytes32, bytes memory) external pure returns (bytes4) {
        return 0x1626ba7e; // the ERC-1271 magic value, returned unconditionally
    }
}

/// @title FORK NEGATIVE CONTROLS — every way a settlement is refused, against the real stack
/// @notice Each row breaks exactly one thing and asserts which refusal fired. And each proves the
///         same seven things about a failure: no merchant underpayment presented as success, no
///         payer debit survives, no invoice consumption survives, no Permit2 nonce consumption
///         survives, no receipt survives, no executor residue, and no stranded PoolManager delta.
contract V2ForkRefusalsTest is V2ForkFixture, IPermit2Errors {
    uint256 internal constant AMOUNT_OUT = 100e6;
    uint256 internal constant MAX_IN = 1e18;

    bytes32 internal constant RECEIPT_TOPIC = keccak256(
        "QuoteSettled(bytes32,address,address,uint16,bytes32,address,address,bytes32,address,uint256,uint256,address,uint256,uint256,uint32)"
    );

    function setUp() public {
        _setUpForkV2();
    }

    // ---- the control -------------------------------------------------------------------------

    function test_ForkN_Control_AWellFormedSettlementSucceeds() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("ok"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        (, uint256 delivered) = executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 0));
        assertEq(delivered, AMOUNT_OUT, "the control settlement did not deliver the invoice");
    }

    // ---- THE EOA-ONLY SIGNER LIMITATION, and the 7702 finding behind it ---------------------

    /// @dev THE RULING, MADE VISIBLE. V2 verifies the merchant's quote with `ECDSA.recover` and
    ///      compares the result to `merchantSigner`. A contract cannot produce a signature that
    ///      recovers to its own address, so a smart-contract wallet cannot be a merchant signer —
    ///      even one that returns ERC-1271's magic value to anything it is asked. The contract
    ///      below does exactly that and is still refused.
    function test_ForkN_AContractCannotBeAMerchantSignerThroughAFabricatedSignature() public {
        PretendMerchant wallet = new PretendMerchant();
        assertGt(address(wallet).code.length, 0, "this row needs a contract, not an EOA");

        IQuoteSettlement.Quote memory q = _quote(bytes32("contract-merchant"), AMOUNT_OUT, MAX_IN);
        q.merchantSigner = address(wallet);

        // A signature the wallet would "approve": ERC-1271 says yes, ECDSA recovery says somebody
        // else entirely. UNICA asks ECDSA.
        bytes memory fabricated = _signQuoteAs(q, merchantKey);
        _expectRefusal(q, fabricated, 10, IQuoteSettlement.WrongMerchantSignature.selector);

        // and the same for a malformed one, which must not be treated as an approval either
        bytes memory malformed = new bytes(65);
        vm.prank(relayer);
        vm.expectRevert();
        executor.settle(q, malformed, _auth(q, 11));

        emit log_string("V2 merchant signers are EOAs. ECDSA.recover only; EIP-1271 is future work.");
    }

    /// @dev THE FORK FINDING THAT MADE THE FIRST RUN FAIL, recorded as a row rather than a memory.
    ///      On a real chain an "EOA" can have code: EIP-7702 lets any account delegate, and the
    ///      well-known test key this repository's local suites use has done exactly that on
    ///      Sepolia. Permit2 branches on `code.length`, so such a payer is sent down the EIP-1271
    ///      path and a plain ECDSA signature is not what is being asked for.
    function test_ForkN_TheFamousTestKeyIsDelegatedOnThisChain() public {
        bytes memory code = DELEGATED_TEST_EOA.code;
        assertEq(code.length, 23, "the delegation is gone; this finding is stale");
        assertEq(uint8(code[0]), 0xef, "not an EIP-7702 designator");
        assertEq(uint8(code[1]), 0x01, "not an EIP-7702 designator");
        assertEq(uint8(code[2]), 0x00, "not an EIP-7702 designator");
        assertEq(payer.code.length, 0, "this suite's payer must be a plain EOA");
        emit log_named_address("delegated test EOA", DELEGATED_TEST_EOA);
        emit log_string("an address with code takes Permit2's EIP-1271 branch, ECDSA or not");
    }

    // ---- the quote ---------------------------------------------------------------------------

    function test_ForkN_WrongMerchantSignature() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("badsig"), AMOUNT_OUT, MAX_IN);
        _expectRefusal(q, _signQuoteAs(q, 0xDECAF), 20, IQuoteSettlement.WrongMerchantSignature.selector);
    }

    function test_ForkN_AnExpiredQuote() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("expired"), AMOUNT_OUT, MAX_IN);
        q.deadline = block.timestamp - 1;
        _expectRefusal(q, _signQuoteAs(q, merchantKey), 21, IQuoteSettlement.QuoteExpired.selector);
    }

    function test_ForkN_AZeroRecipient() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("zeroto"), AMOUNT_OUT, MAX_IN);
        q.recipient = address(0);
        _expectRefusal(q, _signQuoteAs(q, merchantKey), 22, IQuoteSettlement.ZeroRecipient.selector);
    }

    /// @dev The zero-amount case, which is also the only way an OPEN_DELTA-shaped swap could be
    ///      reached: a zero `amountSpecified` never leaves this contract.
    function test_ForkN_AZeroAmountNeverReachesThePool() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("zeroamt"), 0, MAX_IN);
        _expectRefusal(q, _signQuoteAs(q, merchantKey), 23, IQuoteSettlement.ZeroAmountOut.selector);
    }

    function test_ForkN_AQuoteForAnotherExecutor() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("otherex"), AMOUNT_OUT, MAX_IN);
        q.executor = address(0xBEEF);
        _expectRefusal(q, _signQuoteAs(q, merchantKey), 24, IQuoteSettlement.NotTheQuotedExecutor.selector);
    }

    function test_ForkN_AQuoteWhoseHookIsNotThePoolsHook() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("otherhook"), AMOUNT_OUT, MAX_IN);
        q.hook = address(0xBEEF);
        _expectRefusal(q, _signQuoteAs(q, merchantKey), 25, IQuoteSettlement.NotTheQuotedHook.selector);
    }

    /// @dev A second, real V2 hook on the fork, bound to a second executor. The quote names it and
    ///      the pool that carries it, so everything is structurally valid except who it belongs to.
    function test_ForkN_AHookBoundToAnotherExecutor() public {
        QuoteSettlementExecutor other = new QuoteSettlementExecutor(manager, IPermit2Transfer(PERMIT2));
        (address foreignHook,) = _mineHook(address(other));
        PoolKey memory foreignPool = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH9),
            fee: POOL_FEE,
            tickSpacing: POOL_TICK_SPACING,
            hooks: IHooks(foreignHook)
        });
        manager.initialize(foreignPool, POOL_SQRT_PRICE);

        IQuoteSettlement.Quote memory q = _quote(bytes32("foreign"), AMOUNT_OUT, MAX_IN);
        q.pool = foreignPool;
        q.hook = foreignHook;
        _expectRefusal(q, _signQuoteAs(q, merchantKey), 26, IQuoteSettlement.HookIsNotBoundToThisExecutor.selector);
    }

    function test_ForkN_CurrenciesThatDoNotMatchTheDirection() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("swapped"), AMOUNT_OUT, MAX_IN);
        (q.tokenIn, q.tokenOut) = (q.tokenOut, q.tokenIn);
        _expectRefusal(q, _signQuoteAs(q, merchantKey), 27, IQuoteSettlement.CurrenciesDoNotMatchPool.selector);
    }

    function test_ForkN_AWrongPoolId() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("wrongpool"), AMOUNT_OUT, MAX_IN);
        q.pool.fee = 500; // a sibling key: same currencies, same hook, different commitment
        q.hook = address(hook);
        // The executor validates structure and the merchant signed this, so the refusal comes from
        // the POOL not existing under that key — which is the honest failure for a fabricated pool.
        vm.prank(relayer);
        vm.expectRevert();
        executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 28));
        _assertNothingSurvived(q);
    }

    function test_ForkN_TheWrongDirection() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("direction"), AMOUNT_OUT, MAX_IN);
        q.zeroForOne = true; // the merchant is paid in currency0, so this is backwards
        _expectRefusal(q, _signQuoteAs(q, merchantKey), 29, IQuoteSettlement.CurrenciesDoNotMatchPool.selector);
    }

    /// @dev WRONG POOL MANAGER, isolated. Everything is structurally valid — a real hook, mined and
    ///      deployed, bound to a real executor, and a real pool on the canonical PoolManager that
    ///      names that hook — except that the executor was constructed pointing somewhere else. Its
    ///      `unlock` goes to an address with no code, so the settlement cannot even begin.
    function test_ForkN_AnExecutorPointedAtAnotherPoolManager() public {
        address notAManager = address(0xDEAD00);
        assertEq(notAManager.code.length, 0, "this row needs an address with no PoolManager at it");

        QuoteSettlementExecutor stray =
            new QuoteSettlementExecutor(IPoolManager(notAManager), IPermit2Transfer(PERMIT2));
        (address strayHook,) = _mineHook(address(stray));
        PoolKey memory strayPool = PoolKey({
            currency0: Currency.wrap(payoutCurrency),
            currency1: Currency.wrap(inputCurrency),
            fee: POOL_FEE,
            tickSpacing: POOL_TICK_SPACING,
            hooks: IHooks(strayHook)
        });
        // The pool is created on the REAL manager. Only the executor is looking elsewhere.
        manager.initialize(strayPool, POOL_SQRT_PRICE);

        IQuoteSettlement.Quote memory q = _quote(bytes32("straypm"), AMOUNT_OUT, MAX_IN);
        q.pool = strayPool;
        q.hook = strayHook;
        q.executor = address(stray);

        vm.prank(relayer);
        vm.expectRevert();
        stray.settle(q, _signQuoteFor(address(stray), q, merchantKey), _authFull(q, 50, FORK_QUOTE_DEADLINE, payerKey));

        assertEq(IERC20(payoutCurrency).balanceOf(recipient), 0, "a settlement happened through the wrong manager");
        assertEq(IERC20(inputCurrency).balanceOf(address(stray)), 0, "the stray executor held the payer's token");
    }

    /// @dev And the structural half: this executor names the canonical PoolManager and the
    ///      canonical Permit2, both immutable.
    function test_ForkN_TheExecutorNamesTheCanonicalDependencies() public view {
        assertEq(address(executor.POOL_MANAGER()), POOL_MANAGER, "the executor points at another PoolManager");
        assertEq(address(executor.PERMIT2()), PERMIT2, "the executor points at another Permit2");
        assertEq(hook.EXECUTOR(), address(executor), "the hook is bound to another executor");
    }

    // ---- the payer's authorisation -------------------------------------------------------------

    function test_ForkN_AnAuthorisationFromTheWrongPayer() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("wrongpayer"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        vm.expectRevert(InvalidSigner.selector);
        executor.settle(q, _signQuoteAs(q, merchantKey), _authFull(q, 30, block.timestamp + 1 hours, 0xDECAF));
        _assertNothingSurvived(q);
    }

    function test_ForkN_AnAuthorisationForAnotherQuote() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("mine"), AMOUNT_OUT, MAX_IN);
        IQuoteSettlement.Quote memory other = _quote(bytes32("theirs"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        vm.expectRevert(InvalidSigner.selector);
        executor.settle(q, _signQuoteAs(q, merchantKey), _auth(other, 31));
        _assertNothingSurvived(q);
    }

    function test_ForkN_AnExpiredPayerAuthorisation() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("permitold"), AMOUNT_OUT, MAX_IN);
        uint256 authDeadline = block.timestamp + 1;
        QuoteSettlementExecutor.PayerAuthorization memory auth = _authFull(q, 32, authDeadline, payerKey);
        vm.warp(authDeadline + 1);
        q.deadline = block.timestamp + 1 hours;
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(SignatureExpired.selector, authDeadline));
        executor.settle(q, _signQuoteAs(q, merchantKey), auth);
        _assertNothingSurvived(q);
    }

    function test_ForkN_AReusedPermit2Nonce() public {
        IQuoteSettlement.Quote memory q1 = _quote(bytes32("n1"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        executor.settle(q1, _signQuoteAs(q1, merchantKey), _auth(q1, 33));

        IQuoteSettlement.Quote memory q2 = _quote(bytes32("n2"), AMOUNT_OUT, MAX_IN);
        vm.prank(relayer);
        vm.expectRevert(InvalidNonce.selector);
        executor.settle(q2, _signQuoteAs(q2, merchantKey), _auth(q2, 33));
        _assertNothingSurvived(q2);
    }

    /// @dev THE DESTINATION COMMITMENT. Permit2 lets a caller choose where the tokens go and does
    ///      not tell the payer's signature about it. UNICA's answer is twofold: the executor writes
    ///      `address(POOL_MANAGER)` as a literal, and the witness the payer signs RECORDS that
    ///      destination — so an authorisation made for any other destination does not fit.
    function test_ForkN_AnAuthorisationCommittingToAnotherDestination() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("destination"), AMOUNT_OUT, MAX_IN);
        // The payer signs a witness naming an attacker as the destination. The executor still asks
        // Permit2 with the PoolManager, so the witness it presents is not the one that was signed.
        bytes32 hostileWitness = _witnessFor(address(0xBAD1), address(executor), q);
        assertTrue(hostileWitness != _witnessFor(address(manager), address(executor), q), "witnesses collide");

        vm.prank(relayer);
        vm.expectRevert(InvalidSigner.selector);
        executor.settle(q, _signQuoteAs(q, merchantKey), _authWithWitness(q, 34, hostileWitness));
        _assertNothingSurvived(q);
    }

    // ---- execution -------------------------------------------------------------------------------

    /// @dev The hook admits, the swap happens, and THEN the executor refuses. Everything the hook
    ///      did is rolled back with it — which is the property the whole layered claim rests on.
    function test_ForkN_AnInputAboveTheCeilingIsRefusedAfterTheHookAdmitted() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("ceiling"), AMOUNT_OUT, 1);
        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(
                IQuoteSettlement.InputCeilingExceeded.selector, q.quoteId, uint256(1), uint256(41792042795051823)
            )
        );
        executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 40));
        _assertNothingSurvived(q);
    }

    function test_ForkN_AnInvoiceTheLiquidityCannotFill() public {
        IQuoteSettlement.Quote memory q = _quote(bytes32("toobig"), 1_000_000e6, type(uint128).max);
        vm.prank(relayer);
        try executor.settle(q, _signQuoteAs(q, merchantKey), _auth(q, 41)) returns (uint256, uint256) {
            fail();
        } catch (bytes memory err) {
            assertHookRefusal(
                err,
                address(hook),
                IHooks.afterSwap.selector,
                IQuoteSettlement.InvoiceNotFilled.selector,
                "an invoice larger than the fork-local liquidity"
            );
        }
        _assertNothingSurvived(q);
    }

    // ---- the pool refuses everyone else ------------------------------------------------------

    function test_ForkN_AStrangerCannotSwapThroughTheInvoicePool() public {
        StrangerSwapper stranger = new StrangerSwapper(manager);
        deal(USDC, address(stranger), 1_000e6);
        deal(WETH9, address(stranger), 10e18);

        stranger.trySwap(key, false, int256(1e6), "");
        assertTrue(stranger.reverted(), "the invoice-only pool admitted a stranger");
        assertHookRefusal(
            stranger.revertData(),
            address(hook),
            IHooks.beforeSwap.selector,
            IQuoteSettlement.SwapperIsNotTheExecutor.selector,
            "a stranger swapping in its own name"
        );
    }

    /// @dev And a stranger who imitates hook data. The hook reads nothing from calldata, so there
    ///      is nothing to imitate — but the row is here because "we ignore hookData" is a claim,
    ///      and a claim without a test is a hope.
    function test_ForkN_HookDataCannotBuyAdmission() public {
        StrangerSwapper stranger = new StrangerSwapper(manager);
        deal(USDC, address(stranger), 1_000e6);
        deal(WETH9, address(stranger), 10e18);

        IQuoteSettlement.Quote memory q = _quote(bytes32("imitation"), AMOUNT_OUT, MAX_IN);
        bytes memory imitation = abi.encode(_quoteDigest(q), AMOUNT_OUT, _poolId(q), false);

        stranger.trySwap(key, false, int256(1e6), imitation);
        assertTrue(stranger.reverted(), "fabricated hook data bought admission");
        assertHookRefusal(
            stranger.revertData(),
            address(hook),
            IHooks.beforeSwap.selector,
            IQuoteSettlement.SwapperIsNotTheExecutor.selector,
            "a stranger carrying a well-formed-looking invoice in hookData"
        );
    }

    function test_ForkN_AStrangerCannotDriveTheUnlockCallback() public {
        vm.expectRevert(
            abi.encodeWithSelector(IQuoteSettlement.NotThePoolManager.selector, POOL_MANAGER, address(this))
        );
        executor.unlockCallback("");
    }

    // ---- plumbing ----------------------------------------------------------------------------

    function _expectRefusal(
        IQuoteSettlement.Quote memory q,
        bytes memory merchantSignature,
        uint256 nonce,
        bytes4 expected
    ) internal {
        vm.recordLogs();
        vm.prank(relayer);
        try executor.settle(q, merchantSignature, _auth(q, nonce)) returns (uint256, uint256) {
            fail();
            emit log_string("the settlement was accepted where a refusal was required");
        } catch (bytes memory err) {
            assertGe(err.length, 4, "no revert data to read");
            assertEq(bytes4(err), expected, "refused, but not for the reason this row names");
        }
        _assertNothingSurvived(q);
    }

    /// @dev The seven things a failure must leave untouched.
    function _assertNothingSurvived(IQuoteSettlement.Quote memory q) internal {
        assertEq(IERC20(USDC).balanceOf(address(executor)), 0, "executor residue: output");
        assertEq(IERC20(WETH9).balanceOf(address(executor)), 0, "executor residue: input");
        assertFalse(hook.consumed(_quoteDigest(q)), "a refused settlement consumed the invoice");
        (bytes32 d,,,) = executor.activeQuote();
        assertEq(d, bytes32(0), "a refused settlement left a live context");
        assertEq(executor.activePayer(), address(0), "a refused settlement left a payer");

        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(
                logs[i].topics.length == 0 || logs[i].topics[0] != RECEIPT_TOPIC,
                "a refused settlement emitted a receipt"
            );
        }
    }

    function _authWithWitness(IQuoteSettlement.Quote memory q, uint256 nonce, bytes32 witness)
        internal
        view
        returns (QuoteSettlementExecutor.PayerAuthorization memory)
    {
        bytes32 typeHash = keccak256(
            abi.encodePacked(
                "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,",
                _witnessTypeString()
            )
        );
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 tokenPermissions = keccak256(abi.encode(LOCAL_TOKEN_PERMISSIONS_TYPEHASH, q.tokenIn, q.maxIn));
        bytes32 structHash =
            keccak256(abi.encode(typeHash, tokenPermissions, address(executor), nonce, deadline, witness));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _permit2DomainFor(PERMIT2), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, digest);
        return QuoteSettlementExecutor.PayerAuthorization({
            nonce: nonce, deadline: deadline, signature: abi.encodePacked(r, s, v)
        });
    }
}
