# pragma version 0.4.3
"""
@title sidewinder
@license MIT
@notice Exact-input-with-a-minimum against exact-output-with-a-maximum. A sidewinder travels
        along an axis it is not pointing down, and that is precisely the difference between the
        two orders: exact-output NAMES the output axis but MOVES along the input axis, so its
        residual lands on the axis the order never named. This module computes both residuals
        and says who ends up holding each.
@dev    UNICA settles nothing but exact input: SettlementExecutor's plan uses the v4 exact-input-single
        action with the order's minOut as the floor. The exact-output half of this module is
        therefore COUNTERFACTUAL -- it models the order shape UNICA does not use, in order to
        show numerically why it is not used.
        Design and analysis alone. Nothing here is deployed and nothing here ships.
"""

import bushmaster

struct ExactInOutcome:
    charged_in: uint256
    credited_out: uint256
    min_out: uint256
    clears_floor: bool
    residual_out: uint256

struct ExactOutOutcome:
    delivered_out: uint256
    charged_in: uint256
    max_in: uint256
    clears_ceiling: bool
    residual_in: uint256


@external
@pure
def exact_in(
    sqrt_current: uint256,
    sqrt_target: uint256,
    liquidity: uint256,
    amount_in: uint256,
    min_out: uint256,
    fee_pips: uint256,
) -> ExactInOutcome:
    """
    @notice Exact input with a floor on the output.
    @dev The input is fixed by the order, so the residual can appear on the OUTPUT side alone:
         `residual_out` is everything the pool credited above the floor the order named. Under
         UNICA's plan that residual belongs to the MERCHANT, because the plan takes the whole
         open output delta to the order's recipient rather than taking just the minimum and
         leaving a remainder behind in the router. A plan that took just `min_out` would leave
         `residual_out` sitting as a router balance for the next caller to sweep; the residual
         has an owner here because the plan gives it one.
    """
    step: bushmaster.SwapStep = bushmaster._step_exact_in(
        sqrt_current, sqrt_target, liquidity, amount_in, fee_pips
    )
    charged: uint256 = step.amount_in + step.fee_amount
    surplus: uint256 = 0
    if step.amount_out > min_out:
        surplus = step.amount_out - min_out
    return ExactInOutcome(
        charged_in=charged,
        credited_out=step.amount_out,
        min_out=min_out,
        clears_floor=step.amount_out >= min_out,
        residual_out=surplus,
    )


@external
@pure
def exact_out(
    sqrt_current: uint256,
    sqrt_target: uint256,
    liquidity: uint256,
    amount_out: uint256,
    max_in: uint256,
    fee_pips: uint256,
) -> ExactOutOutcome:
    """
    @notice Exact output with a ceiling on the input.
    @dev The output is fixed by the order, so the residual can appear on the INPUT side alone:
         `residual_in` is the part of the ceiling the pool did not need. It belongs to whoever
         funded the input debt, and nothing returns it unless the plan explicitly does so.
         This is the reason the counterfactual is a counterfactual: UNICA's payer forwards
         exactly the order's amountIn as native value and the plan settles the OPEN input debt,
         so under an exact-output shape `residual_in` would remain as an unclaimed native
         balance on the router -- stranded, or sweepable by the next caller -- unless the plan
         grew a third action to return it. Fixing the input instead of the output removes that
         residual by construction: there is nothing left over to own.
    """
    step: bushmaster.SwapStep = bushmaster._step_exact_out(
        sqrt_current, sqrt_target, liquidity, amount_out, fee_pips
    )
    charged: uint256 = step.amount_in + step.fee_amount
    unspent: uint256 = 0
    if max_in > charged:
        unspent = max_in - charged
    return ExactOutOutcome(
        delivered_out=step.amount_out,
        charged_in=charged,
        max_in=max_in,
        clears_ceiling=charged <= max_in,
        residual_in=unspent,
    )
