"""sidewinder: exact input with a floor, against exact output with a ceiling."""

from hypothesis import given, settings, strategies as st

from tests.live_pool import (
    AMOUNT_IN,
    FEE_PIPS,
    LIQUIDITY,
    NO_CROSSING_TARGET,
    OBSERVED_AMOUNT_OUT,
    SQRT_PRICE_X96,
)

MIN_OUT_LIVE = 1_500_000


def test_exact_input_puts_the_residual_on_the_output_side(sidewinder):
    """The live order, as the shape UNICA actually uses.

    The input is fixed, so the surplus can appear in the output alone: the pool credited more
    than the floor, and the plan takes the whole credit to the merchant. Nothing is left in the
    router for a later caller to sweep, because there is nothing left.
    """
    o = sidewinder.exact_in(
        SQRT_PRICE_X96, NO_CROSSING_TARGET, LIQUIDITY, AMOUNT_IN, MIN_OUT_LIVE, FEE_PIPS
    )
    charged_in, credited_out, min_out, clears, residual_out = o
    assert charged_in == AMOUNT_IN
    assert credited_out == OBSERVED_AMOUNT_OUT
    assert clears is True
    assert residual_out == OBSERVED_AMOUNT_OUT - MIN_OUT_LIVE
    assert residual_out == 503_660


def test_exact_output_puts_the_residual_on_the_input_side(sidewinder):
    """The counterfactual shape, with the same pool and the same intent.

    Asking for exactly the floor as output, with the same amount as the input ceiling, leaves
    a positive input residual. That residual is native value the payer forwarded and the pool
    did not need, and under a plan that settles the open input debt there is no action that
    returns it.
    """
    o = sidewinder.exact_out(
        SQRT_PRICE_X96, NO_CROSSING_TARGET, LIQUIDITY, MIN_OUT_LIVE, AMOUNT_IN, FEE_PIPS
    )
    delivered_out, charged_in, max_in, clears, residual_in = o
    assert delivered_out == MIN_OUT_LIVE
    assert clears is True
    assert charged_in < AMOUNT_IN
    assert residual_in == AMOUNT_IN - charged_in
    assert residual_in > 0


def test_buying_back_the_same_output_costs_less_than_exact_input_paid(sidewinder):
    """Where the exact-input surplus actually sits, in input units.

    Exact-input spends the whole order and is credited 2003660 payout units. Exact-output asked
    for those same 2003660 units costs 999999481731068 input units, so 518268932 of the order's
    input bought nothing that the order required. In the exact-input shape that difference is
    already spent and the surplus it bought comes back as output above the floor, which the plan
    hands to the merchant. In the exact-output shape it is never spent, and it is left sitting
    as an input credit with no action to return it.
    """
    o_in = sidewinder.exact_in(
        SQRT_PRICE_X96, NO_CROSSING_TARGET, LIQUIDITY, AMOUNT_IN, 1, FEE_PIPS
    )
    o_out = sidewinder.exact_out(
        SQRT_PRICE_X96, NO_CROSSING_TARGET, LIQUIDITY, o_in[1], AMOUNT_IN, FEE_PIPS
    )
    assert o_in[0] == AMOUNT_IN
    assert o_in[1] == OBSERVED_AMOUNT_OUT
    assert o_out[0] == OBSERVED_AMOUNT_OUT
    assert o_out[1] == 999_999_481_731_068
    assert o_out[4] == AMOUNT_IN - o_out[1] == 518_268_932


@given(amount_in=st.integers(min_value=10**10, max_value=10**16))
@settings(max_examples=100, deadline=None)
def test_exact_output_never_costs_more_than_exact_input_paid_for_the_same_delivery(
    sidewinder, amount_in
):
    """The general form of the same fact, and the reason the residual is not a rounding fluke.

    For any order, buying back exactly what exact-input delivered costs no more than exact-input
    charged. The gap is the input residual, and it exists for every order rather than for the
    one that happened to settle.
    """
    o_in = sidewinder.exact_in(
        SQRT_PRICE_X96, NO_CROSSING_TARGET, LIQUIDITY, amount_in, 0, FEE_PIPS
    )
    if o_in[1] == 0:
        return
    o_out = sidewinder.exact_out(
        SQRT_PRICE_X96, NO_CROSSING_TARGET, LIQUIDITY, o_in[1], amount_in, FEE_PIPS
    )
    assert o_out[0] == o_in[1]
    assert o_out[1] <= o_in[0]
    assert o_out[4] == o_in[0] - o_out[1]


@given(amount_in=st.integers(min_value=10**9, max_value=10**16))
@settings(max_examples=100, deadline=None)
def test_exact_input_charges_the_whole_order_and_never_more(sidewinder, amount_in):
    o = sidewinder.exact_in(
        SQRT_PRICE_X96, NO_CROSSING_TARGET, LIQUIDITY, amount_in, 0, FEE_PIPS
    )
    assert o[0] == amount_in


@given(
    amount_out=st.integers(min_value=1, max_value=2_000_000),
    slack=st.integers(min_value=0, max_value=10**15),
)
@settings(max_examples=100, deadline=None)
def test_the_input_residual_is_exactly_the_unused_ceiling(sidewinder, amount_out, slack):
    probe = sidewinder.exact_out(
        SQRT_PRICE_X96, NO_CROSSING_TARGET, LIQUIDITY, amount_out, 0, FEE_PIPS
    )
    cost = probe[1]
    o = sidewinder.exact_out(
        SQRT_PRICE_X96, NO_CROSSING_TARGET, LIQUIDITY, amount_out, cost + slack, FEE_PIPS
    )
    assert o[3] is True
    assert o[4] == slack
