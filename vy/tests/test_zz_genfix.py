"""Not a test of the contract — a capture. It writes the real ABI output of merchant_policy.vy
into a fixture the JavaScript decoder is checked against, so that decoder is tested against
Vyper's actual encoding rather than against our idea of it."""
import json, boa

MID = 6511655738567133482006334726504628285574907722792578490823400241156396867359
USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"
REF = bytes.fromhex("11" * 32)


def test_capture_policy_abi_fixture(merchant_policy):
    op = boa.env.generate_address()
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
    }
    with open("../integrations/ensv2/fixtures/merchant-policy.json", "w") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")
    assert out["policy"]["active"] is True
    assert out["policy"]["bank_bps"] == 6000
    assert bank + sum(parts) == 1_000_000
