"""Per-merchant settlement policy: who is paid, in what, and in what proportion.

The contract's whole job is arithmetic somebody will later be paid by, so the rows below check
the arithmetic rather than the intent. The central property is that a split is EXACT: every unit
that goes in comes out, with the last leg absorbing the rounding that flooring leaves behind.
"""

import boa
import pytest

BPS = 10000
USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
EURC = "0x0000000000000000000000000000000000000E11"
WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"
REF = bytes.fromhex("11" * 32)
MERCHANT = 1


def _register(mp, bank_bps, holds, ref=REF, merchant=MERCHANT, operator=None):
    op = operator or boa.env.eoa
    mp.register(merchant, op, bank_bps, holds, ref)


# ---- the property the money depends on -------------------------------------------------

def test_a_split_loses_nothing(merchant_policy):
    """bank + every hold leg == the amount, exactly, at every amount tested."""
    _register(merchant_policy, 6000, [(USDC, 3000), (WETH, 1000)])
    for amount in (0, 1, 2, 3, 7, 99, 100, 101, 9999, 10000, 10001, 123456789, 10**12 + 7):
        bank, parts = merchant_policy.split(MERCHANT, amount)
        assert bank + sum(parts) == amount, f"{amount} split to {bank} + {parts}"


def test_the_last_leg_absorbs_the_rounding(merchant_policy):
    """Flooring each share would lose units. The last leg is defined as the remainder, so the
    loss lands in one declared place instead of vanishing."""
    _register(merchant_policy, 3333, [(USDC, 3333), (WETH, 3334)])
    bank, parts = merchant_policy.split(MERCHANT, 100)
    assert (bank, list(parts)) == (33, [33, 34]), (bank, parts)
    assert bank + sum(parts) == 100


def testFuzz_a_split_loses_nothing(merchant_policy):
    _register(merchant_policy, 2500, [(USDC, 2500), (EURC, 2500), (WETH, 2500)])
    for amount in (0, 1, 4, 5, 6, 7, 999, 1000, 1001, 2**40, 2**64 - 1):
        bank, parts = merchant_policy.split(MERCHANT, amount)
        assert bank + sum(parts) == amount
        assert len(parts) == 3


def test_a_bank_only_policy_sends_everything_to_the_bank(merchant_policy):
    _register(merchant_policy, BPS, [])
    for amount in (0, 1, 7, 12345):
        bank, parts = merchant_policy.split(MERCHANT, amount)
        assert (bank, list(parts)) == (amount, [])


def test_a_hold_only_policy_sends_nothing_to_the_bank(merchant_policy):
    """No bank share means no payout reference is required — the merchant keeps coins only."""
    _register(merchant_policy, 0, [(USDC, BPS)], ref=bytes(32))
    bank, parts = merchant_policy.split(MERCHANT, 500)
    assert (bank, list(parts)) == (0, [500])


# ---- what the contract refuses --------------------------------------------------------

def test_shares_that_do_not_sum_to_ten_thousand_are_refused(merchant_policy):
    for bank, holds in [
        (5000, [(USDC, 4000)]),          # 9000
        (5000, [(USDC, 6000)]),          # 11000
        (0, []),                          # 0
        (BPS, [(USDC, 1)]),               # 10001
    ]:
        with boa.reverts("shares"):
            merchant_policy.register(99, boa.env.eoa, bank, holds, REF)


def test_a_hold_leg_with_no_token_is_refused(merchant_policy):
    with boa.reverts("token"):
        merchant_policy.register(MERCHANT, boa.env.eoa, 5000, [(boa.util.abi.Address(bytes(20)), 5000)], REF)


def test_a_bank_share_without_a_payout_reference_is_refused(merchant_policy):
    """A bank leg pays out through an off-ramp instruction held off chain. Committing to that
    instruction is what makes the leg auditable, so a bank share without one is refused."""
    with boa.reverts("payout ref"):
        merchant_policy.register(MERCHANT, boa.env.eoa, 6000, [(USDC, 4000)], bytes(32))


def test_only_the_platform_may_register(merchant_policy):
    stranger = boa.env.generate_address()
    with boa.reverts("platform"):
        with boa.env.prank(stranger):
            merchant_policy.register(MERCHANT, stranger, BPS, [], REF)


def test_a_merchant_cannot_be_registered_twice(merchant_policy):
    _register(merchant_policy, BPS, [])
    with boa.reverts("exists"):
        merchant_policy.register(MERCHANT, boa.env.eoa, BPS, [], REF)


def test_only_the_operator_or_the_platform_may_change_a_policy(merchant_policy):
    operator = boa.env.generate_address()
    stranger = boa.env.generate_address()
    _register(merchant_policy, BPS, [], operator=operator)

    with boa.reverts("auth"):
        with boa.env.prank(stranger):
            merchant_policy.set_policy(MERCHANT, 5000, [(USDC, 5000)], REF)

    with boa.env.prank(operator):
        merchant_policy.set_policy(MERCHANT, 5000, [(USDC, 5000)], REF)
    assert merchant_policy.policy(MERCHANT).bank_bps == 5000

    # The platform keeps a way in, so a merchant who loses their operator key is not stranded.
    merchant_policy.set_policy(MERCHANT, 4000, [(USDC, 6000)], REF)
    assert merchant_policy.policy(MERCHANT).bank_bps == 4000


def test_an_unregistered_merchant_has_no_policy_and_no_split(merchant_policy):
    with boa.reverts("inactive"):
        merchant_policy.policy(404)
    with boa.reverts("inactive"):
        merchant_policy.split(404, 100)


def test_the_identity_is_an_id_and_the_operator_is_only_a_key(merchant_policy):
    """The merchant is a number. The operator is an address that may change without the
    merchant's identity, policy or history changing with it."""
    first = boa.env.generate_address()
    _register(merchant_policy, BPS, [], operator=first)
    assert merchant_policy.owner_of(MERCHANT) == first
    assert merchant_policy.policy(MERCHANT).active is True
