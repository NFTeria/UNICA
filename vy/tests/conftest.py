import pytest

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
