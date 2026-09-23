# pragma version 0.4.3
# Composer. Holds immutable addresses of the deployed math modules and
# assembles end-to-end quotes. No state, no authority, no writes.
# Every quote fails closed: a missing credit level or a stale/deviant price
# returns ok=False and zeros instead of a number.

WAD: constant(uint256) = 10**18
BPS: constant(uint256) = 10000

# ---- interfaces (only the functions used) ----

struct CreditInputs:
    on_time_payments: uint256
    late_payments: uint256
    severe_delinquencies: uint256
    balance_total: uint256
    limit_total: uint256
    oldest_account_days: uint256
    history_days: uint256
    account_count: uint256
    inquiries_90d: uint256

struct CreditResult:
    version: uint256
    level: uint8
    score: uint256
    pd_bps: uint256
    payment_component: uint256
    util_component: uint256
    age_component: uint256
    mix_component: uint256
    inquiry_component: uint256
    reasons: DynArray[uint8, 8]

struct Greeks:
    call: uint256
    put: uint256
    delta_call: int256
    delta_put: int256
    d1: int256
    d2: int256

struct RefundTier:
    min_lead_secs: uint256
    refund_bps: uint256

interface ICredit:
    def evaluate(i: CreditInputs) -> CreditResult: pure
    def risk_adjusted_rate(base_apr: uint256, pd_bps_: uint256, lgd: uint256) -> uint256: pure

interface ILoan:
    def periodic_rate(apr: uint256, periods_per_year: uint256) -> uint256: pure
    def annuity_payment(principal: uint256, r: uint256, n: uint256) -> uint256: pure
    def total_interest(principal: uint256, r: uint256, n: uint256) -> uint256: pure
    def apr_to_apy(apr: uint256, periods_per_year: uint256) -> uint256: pure

interface IFintech:
    def merchant_net(gross: uint256, fee_bps: uint256, fixed_fee: uint256, reserve_bps: uint256) -> (uint256, uint256, uint256): pure

interface ITax:
    def extract_tax(gross: uint256, rate: uint256) -> (uint256, uint256): pure

interface IBooking:
    def demand_price(base: uint256, util: uint256, floor_mult: uint256, ceil_mult: uint256) -> uint256: pure
    def deposit(total: uint256, deposit_bps: uint256, min_deposit: uint256) -> uint256: pure
    def refund(paid: uint256, lead_secs: uint256, tiers: DynArray[RefundTier, 8]) -> uint256: pure

interface IVol:
    def log_returns(prices: DynArray[uint256, 128]) -> DynArray[int256, 128]: pure
    def realized_variance(rets: DynArray[int256, 128], demean: bool) -> uint256: pure
    def annualize_vol(var_per_period: uint256, periods_per_year: uint256) -> uint256: pure

interface IOption:
    def price(spot: uint256, strike: uint256, vol: uint256, rate: uint256, tau: uint256) -> Greeks: pure
    def writer_collateral_put(strike: uint256, qty: uint256) -> uint256: pure

interface IOracle:
    def is_fresh(updated_at: uint256, now_: uint256, max_age: uint256) -> bool: pure
    def deviation_bps(a: uint256, b: uint256) -> uint256: pure

interface IUniV4:
    def sqrt_price_x96(tick: int256) -> uint256: pure
    def liquidity_for_amounts(sp: uint256, sqrt_a: uint256, sqrt_b: uint256, amount0: uint256, amount1: uint256) -> uint256: pure
    def position_amounts(sp: uint256, sqrt_a: uint256, sqrt_b: uint256, liq: uint256) -> (uint256, uint256): pure
    def impermanent_loss(price_ratio: uint256) -> uint256: pure
    def dynamic_fee_pips(base_pips: uint256, vol_wad: uint256, k_pips_per_wad: uint256, min_pips: uint256, max_pips: uint256) -> uint256: pure

CREDIT: public(immutable(ICredit))
LOAN: public(immutable(ILoan))
FINTECH: public(immutable(IFintech))
TAX: public(immutable(ITax))
BOOKING: public(immutable(IBooking))
VOL: public(immutable(IVol))
OPTION: public(immutable(IOption))
ORACLE: public(immutable(IOracle))
UNIV4: public(immutable(IUniV4))

# ---- quote structs ----

struct LoanQuote:
    ok: bool
    level: uint8
    score: uint256
    pd_bps: uint256
    apr: uint256
    apy: uint256
    periodic_rate: uint256
    payment: uint256
    total_interest: uint256
    reasons: DynArray[uint8, 8]

struct BookingQuote:
    price: uint256
    net: uint256
    tax: uint256
    deposit: uint256
    merchant_net: uint256
    platform_fee: uint256
    reserve: uint256

struct OptionQuote:
    ok: bool
    vol: uint256
    put: uint256
    call: uint256
    delta_put: int256
    writer_collateral: uint256

struct LPQuote:
    liquidity: uint256
    amount0: uint256
    amount1: uint256
    il_up: uint256
    il_down: uint256
    fee_pips: uint256


@deploy
def __init__(credit: address, loan: address, fintech: address, tax: address, booking: address, vol: address, option: address, oracle: address, univ4: address):
    CREDIT = ICredit(credit)
    LOAN = ILoan(loan)
    FINTECH = IFintech(fintech)
    TAX = ITax(tax)
    BOOKING = IBooking(booking)
    VOL = IVol(vol)
    OPTION = IOption(option)
    ORACLE = IOracle(oracle)
    UNIV4 = IUniV4(univ4)


@external
@view
def loan_quote(ci: CreditInputs, principal: uint256, base_apr: uint256, lgd: uint256, periods_per_year: uint256, n_periods: uint256) -> LoanQuote:
    cr: CreditResult = staticcall CREDIT.evaluate(ci)
    q: LoanQuote = LoanQuote(
        ok=False, level=cr.level, score=cr.score, pd_bps=cr.pd_bps,
        apr=0, apy=0, periodic_rate=0, payment=0, total_interest=0, reasons=cr.reasons,
    )
    if cr.level == 0:
        return q                                   # not enough evidence: no number
    apr: uint256 = staticcall CREDIT.risk_adjusted_rate(base_apr, cr.pd_bps, lgd)
    r: uint256 = staticcall LOAN.periodic_rate(apr, periods_per_year)
    q.apr = apr
    q.apy = staticcall LOAN.apr_to_apy(apr, periods_per_year)
    q.periodic_rate = r
    q.payment = staticcall LOAN.annuity_payment(principal, r, n_periods)
    q.total_interest = staticcall LOAN.total_interest(principal, r, n_periods)
    q.ok = True
    return q


@external
@view
def booking_quote(base_price: uint256, util: uint256, floor_mult: uint256, ceil_mult: uint256, tax_rate: uint256, deposit_bps: uint256, min_deposit: uint256, platform_bps: uint256, fixed_fee: uint256, reserve_bps: uint256) -> BookingQuote:
    price: uint256 = staticcall BOOKING.demand_price(base_price, util, floor_mult, ceil_mult)
    net: uint256 = 0
    tax: uint256 = 0
    net, tax = staticcall TAX.extract_tax(price, tax_rate)
    dep: uint256 = staticcall BOOKING.deposit(price, deposit_bps, min_deposit)
    m: uint256 = 0
    f: uint256 = 0
    rsv: uint256 = 0
    m, f, rsv = staticcall FINTECH.merchant_net(net, platform_bps, fixed_fee, reserve_bps)
    return BookingQuote(price=price, net=net, tax=tax, deposit=dep, merchant_net=m, platform_fee=f, reserve=rsv)


@external
@view
def cancellation(paid: uint256, lead_secs: uint256, tiers: DynArray[RefundTier, 8]) -> uint256:
    return staticcall BOOKING.refund(paid, lead_secs, tiers)


@external
@view
def option_quote(prices: DynArray[uint256, 128], periods_per_year: uint256, spot: uint256, spot_updated_at: uint256, now_: uint256, max_age: uint256, strike: uint256, rate: uint256, tau: uint256, qty: uint256) -> OptionQuote:
    q: OptionQuote = OptionQuote(ok=False, vol=0, put=0, call=0, delta_put=0, writer_collateral=0)
    if not staticcall ORACLE.is_fresh(spot_updated_at, now_, max_age):
        return q
    rets: DynArray[int256, 128] = staticcall VOL.log_returns(prices)
    if len(rets) < 2:
        return q
    var: uint256 = staticcall VOL.realized_variance(rets, True)
    vol: uint256 = staticcall VOL.annualize_vol(var, periods_per_year)
    if vol == 0:
        return q
    g: Greeks = staticcall OPTION.price(spot, strike, vol, rate, tau)
    q.vol = vol
    q.put = g.put
    q.call = g.call
    q.delta_put = g.delta_put
    q.writer_collateral = staticcall OPTION.writer_collateral_put(strike, qty)
    q.ok = True
    return q


@external
@view
def lp_quote(sp: uint256, tick_lower: int256, tick_upper: int256, amount0: uint256, amount1: uint256, vol: uint256, base_fee_pips: uint256, k_pips: uint256, min_fee: uint256, max_fee: uint256) -> LPQuote:
    sa: uint256 = staticcall UNIV4.sqrt_price_x96(tick_lower)
    sb: uint256 = staticcall UNIV4.sqrt_price_x96(tick_upper)
    liq: uint256 = staticcall UNIV4.liquidity_for_amounts(sp, sa, sb, amount0, amount1)
    a0: uint256 = 0
    a1: uint256 = 0
    a0, a1 = staticcall UNIV4.position_amounts(sp, sa, sb, liq)
    return LPQuote(
        liquidity=liq, amount0=a0, amount1=a1,
        il_up=staticcall UNIV4.impermanent_loss(2 * WAD),
        il_down=staticcall UNIV4.impermanent_loss(WAD // 2),
        fee_pips=staticcall UNIV4.dynamic_fee_pips(base_fee_pips, vol, k_pips, min_fee, max_fee),
    )


@external
@view
def price_gate(oracle_price: uint256, pool_price: uint256, updated_at: uint256, now_: uint256, max_age: uint256, max_dev_bps: uint256) -> bool:
    if not staticcall ORACLE.is_fresh(updated_at, now_, max_age):
        return False
    if oracle_price == 0 or pool_price == 0:
        return False
    return staticcall ORACLE.deviation_bps(oracle_price, pool_price) <= max_dev_bps