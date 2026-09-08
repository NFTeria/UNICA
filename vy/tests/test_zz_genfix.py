"""Not a test of the contract — a capture. It writes the real ABI output of merchant_policy.vy
into a fixture the JavaScript decoder is checked against, so that decoder is tested against
Vyper's actual encoding rather than against our idea of it."""
import json, boa
from eth_utils import keccak

def _selector(sig: str) -> bytes:
    return keccak(text=sig)[:4]


def _returndata(contract, sig: str, *words: int) -> str:
    """The RAW ABI bytes the contract returns, not boa's decoded Python.

    This is the whole point of the capture and it was missing: the fixture recorded only decoded
    values, so `integrations/ensv2/identity-test.mjs` — which reads `returnVectors` — crashed on
    its first policy row and had never run past a third of its suite. The JavaScript decoder is
    supposed to be checked against Vyper's actual encoding; without these bytes there was nothing
    to check it against.
    """
    data = _selector(sig) + b"".join(w.to_bytes(32, "big") for w in words)
    out = boa.env.execute_code(to_address=contract.address, data=data, is_modifying=False)
    raw = out.output if hasattr(out, "output") else bytes(out)
    return "0x" + bytes(raw).hex()


MID = 6511655738567133482006334726504628285574907722792578490823400241156396867359
USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"
REF = bytes.fromhex("11" * 32)

# Derived from a phrase, not generated. `boa.env.generate_address()` depends on how many addresses
# the run happened to make before this one, so regenerating the fixture after a `-k` filter moved
# the operator and produced a diff that meant nothing. A capture that changes when nothing changed
# teaches its readers to ignore it.
OPERATOR = "0x" + keccak(text="unica merchant-policy fixture operator")[-20:].hex()


def test_capture_policy_abi_fixture(merchant_policy):
    op = OPERATOR
    merchant_policy.register(MID, op, 6000, [(USDC, 3000), (WETH, 1000)], REF)
    p = merchant_policy.policy(MID)
    bank, parts = merchant_policy.split(MID, 1_000_000)

    out = {
        "note": ("Captured from the real merchant_policy.vy running in Moccasin's in-process EVM. "
                 "The JavaScript policy reader is checked against these values so its decoding is "
                 "tested against Vyper's actual output rather than against an assumption."),
        "contract": "vy/src/unica/merchant_policy.vy",
        "compiler": "0.4.3",
        "capturedBy": "vy/tests/test_zz_genfix.py",
        "merchantId": str(MID),
        "operator": str(op),
        "platform": str(merchant_policy.platform()),
        "policy": {
            "bank_bps": int(p[0]),
            "holds": [[str(h[0]), int(h[1])] for h in p[1]],
            "payoutRefHash": "0x" + p[2].hex(),
            "active": bool(p[3]),
        },
        "split": {"amount": 1_000_000, "bank": int(bank), "parts": [int(x) for x in parts]},
        "returnVectors": {
            "note": ("Raw ABI return data from the Vyper contract above, so the JavaScript decoder "
                     "is checked against bytes Vyper produced rather than bytes we encoded."),
            "policyReturnVector": _returndata(merchant_policy, "policy(uint256)", MID),
            "ownerOfReturnVector": _returndata(merchant_policy, "owner_of(uint256)", MID),
        },
    }
    with open("../integrations/ensv2/fixtures/merchant-policy.json", "w") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")
    assert out["policy"]["active"] is True
    assert out["policy"]["bank_bps"] == 6000
    assert bank + sum(parts) == 1_000_000
    # The capture is worthless if the bytes are empty, and an empty string would sail through the
    # JSON dump and fail three files away.
    for name, vec in out["returnVectors"].items():
        if name == "note":
            continue
        assert vec.startswith("0x") and len(vec) > 2, f"{name} captured nothing"
    assert out["returnVectors"]["ownerOfReturnVector"][-40:].lower() == str(op)[2:].lower()
