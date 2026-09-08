"""A CAPTURE, not a test of the contract — and the on-chain half of a two-derivation check.

`merchant_policy.split()` is the settled arithmetic for dividing a merchant's takings between the
bank leg and the coins they chose to hold. It is Vyper, it is what would run on chain, and it is
therefore the TRUTH. `integrations/arc-treasury/split.mjs` derives the same division in JavaScript
so an Arc treasury console can show a merchant where their money is about to go without a node.

Two descriptions of one arithmetic is a mismatch waiting to happen, so this file writes what Vyper
actually computed across a table of amounts and policy shapes, and the JavaScript is checked
against those numbers rather than against our idea of them. That is the same discipline the Permit2
digest and the ENS policy decoder already use in this repository.

The amounts are chosen to sit ON the rounding edges rather than near them, because the two places
this arithmetic can disagree are both rounding:

  * `bank = amount * bank_bps // BPS` truncates, and so does every leg but the last;
  * the LAST hold leg is `amount - acc`, which absorbs whatever the truncations lost, so the
    parts sum exactly. A JavaScript port that computes every leg the same way is off by the
    remainder and nothing says so, because each individual leg looks right.

A policy with NO hold legs is its own branch: `bank` is overwritten with the whole amount. It is
in the table because a branch nobody captures is a branch nobody checks.

The shares must sum to exactly 10000, so "no holds and no bank" is not a policy this contract will
accept. That refusal is captured too, at the bottom: a constraint the JavaScript must also enforce
is worth recording as a fact about the contract rather than as a comment about it.
"""
import json, boa
from eth_utils import keccak

USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"
DAI  = "0x68194a729C2450ad26072b3D33ADaCbcef39D574"
REF  = bytes.fromhex("22" * 32)

# Derived from a phrase for the reason test_zz_genfix.py records: an address that moves when
# nothing changed produces a diff that teaches its readers to ignore diffs.
OPERATOR = "0x" + keccak(text="unica arc split parity operator")[-20:].hex()

# (label, bank_bps, holds) — every shape the contract can hold, including the empty one.
POLICIES = [
    ("no holds, all bank",        10000, []),
    ("one hold",                   6000, [(USDC, 4000)]),
    ("two holds",                  6000, [(USDC, 3000), (WETH, 1000)]),
    ("three holds, thirds",        1000, [(USDC, 3000), (WETH, 3000), (DAI, 3000)]),
    ("all to one hold",               0, [(USDC, 10000)]),
    ("one bp to bank",                1, [(USDC, 9999)]),
]

# Amounts on the rounding edges: below one bp, exactly one bp, one above, primes, and a value
# whose thirds do not divide.
AMOUNTS = [0, 1, 3, 7, 9999, 10000, 10001, 33333, 999999, 1000000, 1000001, 123456789, 999999999999]


def test_capture_split_parity_vectors(merchant_policy):
    vectors = []
    for i, (label, bank_bps, holds) in enumerate(POLICIES):
        mid = int.from_bytes(keccak(text=f"unica arc split policy {i}"), "big")
        merchant_policy.register(mid, OPERATOR, bank_bps, holds, REF)
        for amount in AMOUNTS:
            bank, parts = merchant_policy.split(mid, amount)
            bank, parts = int(bank), [int(x) for x in parts]
            # The invariant the contract's own comment claims: the parts sum EXACTLY.
            assert bank + sum(parts) == amount, f"{label} @ {amount} did not sum to the amount"
            vectors.append({
                "policy": label,
                "bankBps": bank_bps,
                "holdBps": [h[1] for h in holds],
                "amount": str(amount),
                "bank": str(bank),
                "parts": [str(x) for x in parts],
            })

    out = {
        "note": ("Captured from the real merchant_policy.vy running in Moccasin's in-process EVM. "
                 "integrations/arc-treasury/split.mjs is a SECOND derivation of the same "
                 "arithmetic and is checked against these numbers, so a JavaScript rounding "
                 "difference is caught here rather than in front of a merchant."),
        "contract": "vy/src/unica/merchant_policy.vy",
        "function": "split(uint256,uint256)",
        "compiler": "0.4.3",
        "capturedBy": "vy/tests/test_arc_split_parity.py",
        "bps": 10000,
        "maxHold": 4,
        "vectors": vectors,
    }
    with open("../integrations/arc-treasury/fixtures/split-vectors.json", "w") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")

    # The capture is worthless if it captured nothing, and an empty list would sail through the
    # JSON dump and fail two directories away.
    assert len(vectors) == len(POLICIES) * len(AMOUNTS)
    # The empty-holds branch really is the whole amount in the bank leg, not zero.
    empties = [v for v in vectors if v["holdBps"] == [] and v["amount"] == "1000001"]
    assert len(empties) == 1 and all(v["bank"] == "1000001" and v["parts"] == [] for v in empties)
    # And the rounding really is absorbed by the LAST leg: thirds of 10001 cannot divide evenly.
    thirds = next(v for v in vectors if v["policy"] == "three holds, thirds" and v["amount"] == "10001")
    assert int(thirds["parts"][-1]) != int(thirds["parts"][0]), "the last leg should absorb the remainder"

    # The constraint, captured by exercising it rather than by asserting it in prose: a policy
    # whose shares do not total 10000 is REFUSED. The JavaScript derivation must refuse it too,
    # and split-vectors.json carries this row so its test has something to check against.
    refused = None
    try:
        merchant_policy.register(int.from_bytes(keccak(text="unica arc split invalid"), "big"),
                                 OPERATOR, 0, [], REF)
    except Exception as e:
        refused = "shares"
    assert refused == "shares", "a policy totalling zero bps must be refused, and was not"
    out["refusals"] = [{
        "why": "shares must total exactly 10000 bps",
        "bankBps": 0, "holdBps": [], "expect": "REFUSED",
    }]
    with open("../integrations/arc-treasury/fixtures/split-vectors.json", "w") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")
