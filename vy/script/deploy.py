"""Deploy every module of the settlement model into the in-process EVM.

Nothing in vy/ targets a live network. The sole network this model ever runs on is Moccasin's
in-process pyevm, and moccasin.toml is trimmed to that one network so it cannot be pointed
elsewhere by accident.
"""

from src import bushmaster, constrictor, egg_eater, rattler, sidewinder
from moccasin.boa_tools import VyperContract


def deploy_all() -> dict[str, VyperContract]:
    return {
        "bushmaster": bushmaster.deploy(),
        "constrictor": constrictor.deploy(),
        "rattler": rattler.deploy(),
        "egg_eater": egg_eater.deploy(),
        "sidewinder": sidewinder.deploy(),
    }


def moccasin_main() -> dict[str, VyperContract]:
    contracts = deploy_all()
    for name, c in contracts.items():
        print(f"{name}: {c.address}")
    return contracts
