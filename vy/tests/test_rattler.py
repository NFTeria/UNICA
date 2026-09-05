"""rattler: two minimum-out gates, and the gap a token can open between them."""

from hypothesis import given, settings, strategies as st

from tests.live_pool import OBSERVED_AMOUNT_OUT

BOTH_PASS, POOL_CREDIT_SHORT, RECIPIENT_SHORT = 0, 1, 2
MIN_OUT_LIVE = 1_500_000  # the live order's 1.5 USDC floor, in payout units
U120 = 2**120


def test_the_live_settlement_cleared_both_gates(rattler):
    """A plain ERC-20 delivers what the pool credited, so both gates see the same number."""
    v = rattler.verdict(
        MIN_OUT_LIVE, OBSERVED_AMOUNT_OUT, 0, OBSERVED_AMOUNT_OUT
    )
    settles, reason, min_out, credit, realised, withheld = v
    assert settles is True
    assert reason == BOTH_PASS
    assert credit == realised == OBSERVED_AMOUNT_OUT
    assert withheld == 0


def test_a_fee_on_transfer_token_can_pass_the_first_gate_and_fail_the_second(rattler):
    """The case the second gate exists for, with real numbers.

    The pool credits 2003660 payout units, which clears a floor of 2000000. A token that keeps
    1% delivers 1983624 to the recipient, which does not. The in-swap gate sees nothing but the
    credit and is satisfied; the gate measured at the recipient is not.
    """
    credit = OBSERVED_AMOUNT_OUT
    min_out = 2_000_000
    delivered = rattler.fee_on_transfer_delivery(credit, 100)
    assert delivered == 1_983_624
    assert credit >= min_out and delivered < min_out

    v = rattler.verdict(min_out, credit, 0, delivered)
    settles, reason, _m, got_credit, got_realised, withheld = v
    assert settles is False
    assert reason == RECIPIENT_SHORT
    assert (got_credit, got_realised, withheld) == (credit, delivered, credit - delivered)


def test_a_short_pool_credit_fails_the_first_gate(rattler):
    v = rattler.verdict(3_000_000, OBSERVED_AMOUNT_OUT, 0, OBSERVED_AMOUNT_OUT)
    assert v[0] is False and v[1] == POOL_CREDIT_SHORT


def test_a_recipient_balance_that_fell_counts_as_nothing_received(rattler):
    """No underflow, and no accidental pass: a fall reads as zero, and zero fails any floor."""
    assert rattler.realised(1_000_000, 900_000) == 0
    v = rattler.verdict(1, OBSERVED_AMOUNT_OUT, 1_000_000, 900_000)
    assert v[0] is False and v[1] == RECIPIENT_SHORT and v[4] == 0


@given(
    min_out=st.integers(min_value=1, max_value=U120),
    credit=st.integers(min_value=0, max_value=U120),
    before=st.integers(min_value=0, max_value=U120),
    after=st.integers(min_value=0, max_value=U120),
)
@settings(max_examples=300, deadline=None)
def test_no_path_settles_below_the_minimum(rattler, min_out, credit, before, after):
    """The invariant the whole two-gate design is for.

    Whatever the pool credited and whatever the token did, a settlement that the model calls
    settled has a recipient whose balance grew by at least the order's minimum. There is no
    rounding path, no clamp and no ordering that lets a short delivery through.
    """
    v = rattler.verdict(min_out, credit, before, after)
    settles, reason, _m, got_credit, got_realised, _w = v
    if settles:
        assert got_realised >= min_out
        assert got_credit >= min_out
        assert reason == BOTH_PASS
    else:
        assert got_realised < min_out or got_credit < min_out


@given(
    credit=st.integers(min_value=0, max_value=U120),
    fee_bps=st.integers(min_value=0, max_value=10_000),
)
@settings(max_examples=150, deadline=None)
def test_a_withholding_token_never_delivers_more_than_the_credit(rattler, credit, fee_bps):
    delivered = rattler.fee_on_transfer_delivery(credit, fee_bps)
    assert delivered <= credit
    v = rattler.verdict(1, credit, 0, delivered)
    assert v[5] == credit - delivered
