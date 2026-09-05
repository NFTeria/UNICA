"""bushmaster: does the model reproduce the pool's own arithmetic, and its own 512-bit division?"""

from hypothesis import given, settings, strategies as st

from tests.live_pool import (
    AMOUNT_IN,
    FEE_PIPS,
    LIQUIDITY,
    NO_CROSSING_TARGET,
    OBSERVED_AMOUNT_OUT,
    Q96,
    SQRT_PRICE_X96,
    mul_div,
    mul_div_up,
    reference_exact_in,
)

MAX_U256 = 2**256 - 1


def test_the_live_settlement_is_reproduced(bushmaster):
    """The one number the whole model is answerable to.

    Nothing here is fitted: the step is the published arithmetic, the inputs are the pool's
    published state, and the output is compared to the amount the receipt recorded.
    """
    step = bushmaster.step_exact_in(
        SQRT_PRICE_X96, NO_CROSSING_TARGET, LIQUIDITY, AMOUNT_IN, FEE_PIPS
    )
    sqrt_next, less_fee, amount_out = step[0], step[1], step[2]
    assert less_fee == mul_div(AMOUNT_IN, 1_000_000 - FEE_PIPS, 1_000_000)
    assert sqrt_next > NO_CROSSING_TARGET, "the step must exhaust the input, not stop at a tick"
    assert amount_out == OBSERVED_AMOUNT_OUT


def test_the_python_oracle_agrees_with_the_vyper(bushmaster):
    """Two independent expressions of the same step, over the live inputs."""
    py_sqrt_next, py_less_fee, py_out = reference_exact_in(
        SQRT_PRICE_X96, LIQUIDITY, AMOUNT_IN, FEE_PIPS
    )
    step = bushmaster.step_exact_in(
        SQRT_PRICE_X96, NO_CROSSING_TARGET, LIQUIDITY, AMOUNT_IN, FEE_PIPS
    )
    assert (step[0], step[1], step[2]) == (py_sqrt_next, py_less_fee, py_out)
    assert py_out == OBSERVED_AMOUNT_OUT


def test_the_whole_input_is_charged_on_a_full_fill(bushmaster):
    """amount_in + fee is exactly what the order asked for, so nothing is left unspent."""
    step = bushmaster.step_exact_in(
        SQRT_PRICE_X96, NO_CROSSING_TARGET, LIQUIDITY, AMOUNT_IN, FEE_PIPS
    )
    assert step[1] + step[3] == AMOUNT_IN


@given(
    a=st.integers(min_value=0, max_value=MAX_U256),
    b=st.integers(min_value=0, max_value=MAX_U256),
    d=st.integers(min_value=1, max_value=MAX_U256),
)
@settings(max_examples=200, deadline=None)
def test_mul_div_is_exact_or_refuses(bushmaster, a, b, d):
    """The 512-bit division either equals Python's exact integer answer or reverts.

    It is never allowed to return a wrong number. Values whose quotient does not fit in 256
    bits must revert rather than wrap.
    """
    expected = (a * b) // d
    if expected > MAX_U256:
        try:
            bushmaster.mul_div(a, b, d)
        except Exception:
            return
        raise AssertionError("mul_div returned a value for a quotient that cannot fit")
    assert bushmaster.mul_div(a, b, d) == expected


@given(
    a=st.integers(min_value=0, max_value=2**200),
    b=st.integers(min_value=0, max_value=2**200),
    d=st.integers(min_value=1, max_value=2**200),
)
@settings(max_examples=100, deadline=None)
def test_mul_div_up_is_the_ceiling(bushmaster, a, b, d):
    expected = mul_div_up(a, b, d)
    if expected > MAX_U256:
        return
    assert bushmaster.mul_div_up(a, b, d) == expected


@given(delta=st.integers(min_value=1, max_value=2**90))
@settings(max_examples=100, deadline=None)
def test_amount1_out_rounds_down_and_keeps_the_shortfall_under_one_unit(bushmaster, delta):
    """The output the pool credits is the floor of the exact value, never above it."""
    sqrt_next = SQRT_PRICE_X96 - min(delta, SQRT_PRICE_X96 - 1)
    got = bushmaster.amount1_out(sqrt_next, SQRT_PRICE_X96, LIQUIDITY)
    exact_numerator = LIQUIDITY * (SQRT_PRICE_X96 - sqrt_next)
    assert got == exact_numerator // Q96
    assert exact_numerator - got * Q96 < Q96
