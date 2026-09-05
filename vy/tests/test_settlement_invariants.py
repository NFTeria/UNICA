"""The arithmetic invariants of settlement, composed across modules.

These are the properties that belong to the numbers rather than to the protocol: monotonicity,
the representability of the case the rules exist to refuse, and the floor at the recipient.
"""

from hypothesis import given, settings, strategies as st

from tests.live_pool import (
    AMOUNT_IN,
    FEE_PIPS,
    LIQUIDITY,
    NO_CROSSING_TARGET,
    OBSERVED_AMOUNT_OUT,
    SQRT_PRICE_X96,
)


def _settles(constrictor, rattler, requested, consumed, min_out, credit, before, after):
    """The two rules in the order the settlement path runs them: the full-fill gate inside the
    swap, then both minimum gates. A settlement stands when every one of them stands, and not otherwise."""
    fill = constrictor.verdict(requested, -consumed)
    gates = rattler.verdict(min_out, credit, before, after)
    return bool(fill[0] and gates[0]), fill, gates


@given(
    a=st.integers(min_value=1, max_value=10**16),
    b=st.integers(min_value=1, max_value=10**16),
)
@settings(max_examples=150, deadline=None)
def test_output_is_monotone_in_input(bushmaster, a, b):
    """More input never buys less output from the same pool.

    Monotonicity is what makes a minimum-out floor meaningful at all: if it could fail, a payer
    could be punished for paying more, and a floor set from a quote would say nothing about a
    slightly larger order.
    """
    lo, hi = min(a, b), max(a, b)
    out_lo = bushmaster.step_exact_in(
        SQRT_PRICE_X96, NO_CROSSING_TARGET, LIQUIDITY, lo, FEE_PIPS
    )[2]
    out_hi = bushmaster.step_exact_in(
        SQRT_PRICE_X96, NO_CROSSING_TARGET, LIQUIDITY, hi, FEE_PIPS
    )[2]
    assert out_hi >= out_lo


def test_full_fill_but_short_output_is_representable_and_refused(constrictor, rattler):
    """The case both rules exist for, written as numbers rather than as a worry.

    The pool consumed exactly the order's input -- a perfect full fill, which the fill gate
    admits on its own -- and credited less than the order's floor. The composition refuses.
    If either rule were dropped, this state would settle.
    """
    short_credit = 1_400_000
    min_out = 1_500_000
    settles, fill, gates = _settles(
        constrictor, rattler, AMOUNT_IN, AMOUNT_IN, min_out, short_credit, 0, short_credit
    )
    assert fill[0] is True, "the fill gate alone admits this state"
    assert gates[0] is False
    assert gates[1] == 1  # POOL_CREDIT_SHORT
    assert settles is False


def test_short_fill_with_a_generous_output_is_also_refused(constrictor, rattler):
    """The mirror case: the minimum is cleared, but the pool did not take the whole order.

    A partial fill that still clears the floor is the state a minimum-alone rule would settle,
    and it would leave the payer's unspent input to be accounted for by something else.
    """
    settles, fill, gates = _settles(
        constrictor,
        rattler,
        AMOUNT_IN,
        AMOUNT_IN - 1,
        1_500_000,
        OBSERVED_AMOUNT_OUT,
        0,
        OBSERVED_AMOUNT_OUT,
    )
    assert gates[0] is True, "both minimum gates alone admit this state"
    assert fill[0] is False
    assert fill[1] == 1  # PARTIAL_FILL
    assert settles is False


@given(
    requested=st.integers(min_value=1, max_value=10**18),
    consumed=st.integers(min_value=0, max_value=10**18),
    min_out=st.integers(min_value=1, max_value=10**12),
    credit=st.integers(min_value=0, max_value=10**12),
    withheld=st.integers(min_value=0, max_value=10**12),
    before=st.integers(min_value=0, max_value=10**24),
)
@settings(max_examples=400, deadline=None)
def test_a_settlement_that_stands_paid_the_recipient_in_full(
    constrictor, rattler, requested, consumed, min_out, credit, withheld, before
):
    """No rounding path, no clamp and no ordering lets the recipient receive less than the
    order's minimum while the composition still says the settlement stands."""
    delivered = credit - min(withheld, credit)
    after = before + delivered
    settles, fill, gates = _settles(
        constrictor, rattler, requested, consumed, min_out, credit, before, after
    )
    if settles:
        assert consumed == requested
        assert after - before >= min_out
        assert gates[4] >= min_out
    else:
        assert consumed != requested or credit < min_out or delivered < min_out


@given(amount_in=st.integers(min_value=10**6, max_value=10**16))
@settings(max_examples=100, deadline=None)
def test_a_full_fill_is_exactly_the_input_the_order_named(bushmaster, constrictor, amount_in):
    """The bridge between the two halves of the model: when the pool exhausts the input rather
    than stopping at a tick, the amount it consumed is the whole order, so the fill gate admits
    it -- and when it stops at a tick, it does not."""
    step = bushmaster.step_exact_in(
        SQRT_PRICE_X96, NO_CROSSING_TARGET, LIQUIDITY, amount_in, FEE_PIPS
    )
    consumed = step[1] + step[3]
    assert constrictor.verdict(amount_in, -consumed)[0] is True
