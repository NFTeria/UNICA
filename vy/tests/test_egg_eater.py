"""egg_eater: 18 decimals in, 6 decimals out, and where the precision goes."""

from hypothesis import given, settings, strategies as st

from tests.live_pool import (
    AMOUNT_IN,
    FEE_PIPS,
    INPUT_DECIMALS,
    LIQUIDITY,
    NO_CROSSING_TARGET,
    OBSERVED_AMOUNT_OUT,
    PAYOUT_DECIMALS,
    Q96,
    SQRT_PRICE_X96,
    reference_exact_in,
)


def test_the_live_settlement_shed_a_measurable_shell(bushmaster, egg_eater):
    """The exact fraction of a payout unit the live settlement did not pay."""
    sqrt_next, _less_fee, out = reference_exact_in(
        SQRT_PRICE_X96, LIQUIDITY, AMOUNT_IN, FEE_PIPS
    )
    assert out == OBSERVED_AMOUNT_OUT

    absorbed, shell_num, shell_den = egg_eater.shed(LIQUIDITY, sqrt_next, SQRT_PRICE_X96)
    assert absorbed == OBSERVED_AMOUNT_OUT
    assert shell_den == Q96
    assert 0 <= shell_num < Q96
    # Nothing is invented and nothing vanishes: the whole exact product is accounted for.
    assert absorbed * Q96 + shell_num == LIQUIDITY * (SQRT_PRICE_X96 - sqrt_next)


def test_the_quantisation_floor_at_the_live_price(egg_eater):
    """One payout unit is worth this many input units, so this is the smallest input that can
    move the payout at all."""
    wei_per_unit = egg_eater.input_units_per_payout_unit(SQRT_PRICE_X96)
    # A pool initialised at 2,500 payout units per whole input unit puts one micro-unit at
    # 1e18 / (2500 * 1e6) input units.
    assert wei_per_unit == 10**INPUT_DECIMALS // (2500 * 10**PAYOUT_DECIMALS)
    assert wei_per_unit == 400_000_000
    # The live order was three million times that floor, which is why it is not near it.
    assert AMOUNT_IN // wei_per_unit == 2_500_000


def test_an_input_below_the_floor_pays_nothing(bushmaster, egg_eater):
    """The 12-decimal gap, made concrete: a payer can spend and receive zero."""
    floor = egg_eater.input_units_per_payout_unit(SQRT_PRICE_X96)
    step = bushmaster.step_exact_in(
        SQRT_PRICE_X96, NO_CROSSING_TARGET, LIQUIDITY, floor // 2, FEE_PIPS
    )
    assert step[2] == 0
    assert step[1] > 0, "the input was still consumed"


def test_the_settlement_path_never_rescales_between_the_two_grids(egg_eater):
    """The negative that keeps the two grids apart.

    Every comparison on the settlement path is currency-local. This shows what a rescale would
    cost if one were ever introduced: moving a payout amount up to 18 decimals and back is
    lossless, but moving an input amount down to 6 decimals and back is not, and the live
    amountIn is one of the values it would destroy.
    """
    assert egg_eater.rescale(egg_eater.rescale(OBSERVED_AMOUNT_OUT, 6, 18), 18, 6) == (
        OBSERVED_AMOUNT_OUT
    )
    down = egg_eater.rescale(AMOUNT_IN, 18, 6)
    assert down == 1000
    assert egg_eater.rescale(down, 6, 18) == AMOUNT_IN
    # One wei more is indistinguishable after the round trip.
    assert egg_eater.rescale(AMOUNT_IN + 1, 18, 6) == down


@given(delta=st.integers(min_value=0, max_value=2**80))
@settings(max_examples=150, deadline=None)
def test_the_shell_is_always_under_one_payout_unit(egg_eater, delta):
    sqrt_next = SQRT_PRICE_X96 - min(delta, SQRT_PRICE_X96 - 1)
    absorbed, shell_num, shell_den = egg_eater.shed(LIQUIDITY, sqrt_next, SQRT_PRICE_X96)
    assert shell_den == Q96
    assert shell_num < shell_den
    assert absorbed * shell_den + shell_num == LIQUIDITY * (SQRT_PRICE_X96 - sqrt_next)
