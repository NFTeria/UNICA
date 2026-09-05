"""constrictor: the full-fill rule, as numbers."""

from hypothesis import given, settings, strategies as st

from tests.live_pool import AMOUNT_IN

# A currency0 delta is an int128, so the largest consumption the hook can ever read is 2**127.
# An order's amountIn is a uint128, so a request may be larger than any delta can answer.
MAX_CONSUMED = 2**127
MAX_REQUESTED = 2**128 - 1


def test_the_live_settlement_was_a_full_fill(constrictor):
    v = constrictor.verdict(AMOUNT_IN, -AMOUNT_IN)
    admitted, reason, requested, consumed, slack = v
    assert admitted is True
    assert reason == 0
    assert (requested, consumed, slack) == (AMOUNT_IN, AMOUNT_IN, 0)


def test_one_wei_short_is_a_partial_fill(constrictor):
    """The smallest possible partial fill, stated as numbers so it is not an abstraction."""
    v = constrictor.verdict(AMOUNT_IN, -(AMOUNT_IN - 1))
    admitted, reason, requested, consumed, slack = v
    assert admitted is False
    assert reason == 1
    assert consumed == AMOUNT_IN - 1
    assert slack == 1


def test_a_half_fill_is_a_partial_fill(constrictor):
    v = constrictor.verdict(AMOUNT_IN, -(AMOUNT_IN // 2))
    assert v[0] is False and v[1] == 1
    assert v[4] == AMOUNT_IN - AMOUNT_IN // 2


def test_a_positive_currency0_delta_is_refused_outright(constrictor):
    """An input swap never credits the swapper in currency0; the model will not pretend it can."""
    try:
        constrictor.consumed_from_delta(1)
    except Exception:
        return
    raise AssertionError("a positive currency0 delta was accepted as consumption")


@given(
    requested=st.integers(min_value=1, max_value=MAX_REQUESTED),
    consumed=st.integers(min_value=0, max_value=MAX_CONSUMED),
)
@settings(max_examples=200, deadline=None)
def test_admission_is_exact_equality_and_nothing_else(constrictor, requested, consumed):
    v = constrictor.verdict(requested, -consumed)
    assert v[0] == (consumed == requested)
    if consumed < requested:
        assert v[1] == 1 and v[4] == requested - consumed
    elif consumed > requested:
        assert v[1] == 2 and v[4] == consumed - requested
    else:
        assert v[1] == 0 and v[4] == 0
