from pathlib import Path

import pytest
from eth_abi import encode
from eth_utils import keccak

from script.deploy import deploy_all

# Session scope on purpose: hypothesis refuses to drive a function-scoped fixture, and these
# contracts are pure -- there is no state for one example to carry into the next.


@pytest.fixture(scope="session")
def model():
    return deploy_all()


@pytest.fixture(scope="session")
def bushmaster(model):
    return model["bushmaster"]


@pytest.fixture(scope="session")
def constrictor(model):
    return model["constrictor"]


@pytest.fixture(scope="session")
def rattler(model):
    return model["rattler"]


@pytest.fixture(scope="session")
def egg_eater(model):
    return model["egg_eater"]


@pytest.fixture(scope="session")
def sidewinder(model):
    return model["sidewinder"]


# NameMath holds storage, unlike every model above it, so its fixture is FUNCTION scoped: a
# token registered by one example must not still be registered in the next. The session-scoped
# `model` above stays as it is, because those contracts are pure.
@pytest.fixture(scope="function")
def namemath():
    from src import namemath as _namemath

    return _namemath.deploy()


@pytest.fixture(scope="session")
def logobackground(model):
    return model["logobackground"]


# ---- UNICA identity NFT art layer (H1-H12, N1-N9): vy/src/math + vy/src/art ----
# namecheck and svgrender are pure/stateless, like namemath/logobackground above, so they
# stay in the session-scoped model.


@pytest.fixture(scope="session")
def namecheck(model):
    return model["namecheck"]


@pytest.fixture(scope="session")
def svgrender(model):
    return model["svgrender"]


# identity_token is stateful (mint() writes storage), so -- like namemath and
# merchant_policy above -- it is FUNCTION scoped: a token minted by one example must not
# still exist in the next. authority_double is its test-only IIdentityAuthority stand-in
# (vy/tests/authority_double.vy, never under vy/src/ -- a double is not a shipped contract).


@pytest.fixture(scope="function")
def authority_double():
    import boa

    return boa.load(str(Path(__file__).parent / "authority_double.vy"))


@pytest.fixture(scope="function")
def identity_token(authority_double):
    import boa

    minter = boa.env.eoa
    ens_deployment_id = keccak(
        encode(["uint256", "address"], [11155111, "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe"])
    )
    return boa.load(
        str(Path(__file__).parent.parent / "src" / "art" / "identity_token.vy"),
        minter,
        authority_double.address,
        boa.env.generate_address(),
        ens_deployment_id,
        "unica-identity-svg/1",
        "https://unica.example/id/",
    )


# The UNICA payment-rail contracts. Stateful, so FUNCTION scoped: a policy registered by one
# example must not still be registered in the next.
@pytest.fixture(scope="function")
def merchant_policy():
    from src.unica import merchant_policy as _mp

    return _mp.deploy()
