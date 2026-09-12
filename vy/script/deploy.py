"""Deploy every module of the settlement model into the in-process EVM.

Nothing in vy/ targets a live network. The sole network this model ever runs on is Moccasin's
in-process pyevm, and moccasin.toml is trimmed to that one network so it cannot be pointed
elsewhere by accident.
"""

from src import (
    bushmaster,
    constrictor,
    egg_eater,
    logobackground,
    namemath,
    rattler,
    sidewinder,
)
from src.art import svgrender
from src.math import namecheck
from moccasin.boa_tools import VyperContract


def deploy_all() -> dict[str, VyperContract]:
    return {
        "bushmaster": bushmaster.deploy(),
        "constrictor": constrictor.deploy(),
        "rattler": rattler.deploy(),
        "egg_eater": egg_eater.deploy(),
        "sidewinder": sidewinder.deploy(),
        # NameMath is the art side of this workspace rather than the settlement model. It
        # shares the EVM and nothing else.
        "namemath": namemath.deploy(),
        "logobackground": logobackground.deploy(),
        # UNICA identity NFT art layer (H1-H12, N1-N9): a separate layer beside settlement,
        # under vy/src/math and vy/src/art, importing nothing from vy/src/unica or the
        # legacy namemath.vy/logobackground.vy above (H3, H10).
        "namecheck": namecheck.deploy(),
        "svgrender": svgrender.deploy(),
    }


def moccasin_main() -> dict[str, VyperContract]:
    contracts = deploy_all()
    for name, c in contracts.items():
        print(f"{name}: {c.address}")
    return contracts
