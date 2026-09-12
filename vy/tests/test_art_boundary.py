"""Dependency-boundary test (H3, ENS-ART-LAYER.md Sec.5): the math/art layer and the
settlement layer never import each other.

Two directions, both checked by scanning source TEXT (not by attempting a compile, so a
boundary break is caught even if it would otherwise still compile):

1. Nothing under vy/src/art/ or vy/src/math/ imports namemath.vy, logobackground.vy,
   merchant_policy.vy, payany_router.vy, or anything under vy/src/unica/ (H10: the new
   layer never imports the legacy modules or the settlement contracts).
2. Nothing under vy/src/ OUTSIDE vy/src/art/ and vy/src/math/ (i.e. every settlement
   contract, including the legacy namemath.vy/logobackground.vy copies), and no script or
   test outside this art layer's own test files, imports a module path under vy/src/art/
   or vy/src/math/.

A boundary test that only exists after the boundary could already be crossed proves
nothing -- this one scans the actual committed files, so it is a real gate every time
`mox test` runs, not a one-time check.
"""

import re
from pathlib import Path

VY_ROOT = Path(__file__).parent.parent
SRC = VY_ROOT / "src"
TESTS = VY_ROOT / "tests"
SCRIPT = VY_ROOT / "script"

FORBIDDEN_FOR_ART = {"namemath", "logobackground", "merchant_policy", "payany_router"}

ART_MATH_DIRS = {SRC / "art", SRC / "math"}

# import lines look like:  import a.b.c as x   /   from a.b import c
IMPORT_RE = re.compile(r"^\s*(?:import|from)\s+([\w.]+)", re.MULTILINE)


def _all_vy_files(root: Path):
    return sorted(root.rglob("*.vy"))


def _imported_paths(text: str):
    return IMPORT_RE.findall(text)


def test_art_and_math_never_import_the_legacy_or_settlement_modules():
    """Checks actual `import`/`from` statements only -- these files' own docstrings
    legitimately NAME the legacy modules in prose ("never importing namemath.vy...",
    citing prior art per CLAUDE.md's "Never copy" section), which is expected and must
    not itself trip this test."""
    checked = 0
    for path in _all_vy_files(SRC / "art") + _all_vy_files(SRC / "math"):
        text = path.read_text()
        checked += 1
        for imp in _imported_paths(text):
            parts = imp.split(".")
            for name in FORBIDDEN_FOR_ART:
                assert name not in parts, (
                    f"{path} imports {imp!r}, reaching forbidden legacy/settlement module {name!r}"
                )
            assert "unica" not in parts, (
                f"{path} imports {imp!r}, which reaches vy/src/unica/ (settlement)"
            )
    assert checked >= 3, "expected to check at least namecheck.vy, svgrender.vy, identity_token.vy"


def test_no_settlement_or_legacy_source_imports_the_art_or_math_layer():
    settlement_files = [
        p for p in _all_vy_files(SRC)
        if SRC / "art" not in p.parents and SRC / "math" not in p.parents
    ]
    assert settlement_files, "expected to find at least the legacy/settlement .vy files"
    checked = 0
    for path in settlement_files:
        text = path.read_text()
        checked += 1
        for imp in _imported_paths(text):
            parts = imp.split(".")
            assert "art" not in parts and "math" not in parts, (
                f"{path} (settlement/legacy) imports {imp!r}, crossing into the art/math layer"
            )
    # every settlement .vy file this repo ships today, by name, so a newly added settlement
    # file silently skipping this check would still be caught by the glob above.
    names = {p.name for p in settlement_files}
    for expected in ("namemath.vy", "logobackground.vy", "merchant_policy.vy", "payany_router.vy"):
        assert expected in names, f"expected {expected} to exist and be checked"
    assert checked == len(settlement_files)


def test_no_settlement_script_or_test_imports_the_art_or_math_layer():
    """Scripts/tests that deploy or call settlement contracts must not import the art/math
    layer either. The art layer's OWN scripts/tests (this file, test_namecheck.py,
    test_svgrender.py, test_identity_token.py, conftest.py's fixtures, deploy.py's
    deploy_all which legitimately deploys everything) are exactly the exceptions named
    below -- everything else in script/ and tests/ is settlement-side."""
    exempt = {
        "test_art_boundary.py",
        "test_namecheck.py",
        "test_svgrender.py",
        "test_identity_token.py",
        "authority_double.vy",
        "conftest.py",       # legitimately wires fixtures for every module, art included
        "deploy.py",         # legitimately deploys every module, art included
    }
    py_files = [p for p in list(SCRIPT.glob("*.py")) + list(TESTS.glob("*.py"))
                if p.name not in exempt]
    assert py_files, "expected to find settlement-side scripts/tests to check"
    checked = 0
    for path in py_files:
        text = path.read_text()
        checked += 1
        for imp in _imported_paths(text):
            parts = imp.split(".")
            assert not ("art" in parts or "math" in parts), (
                f"{path} imports {imp!r}, crossing into the art/math layer from a "
                f"settlement-side script/test"
            )
    assert checked >= 5


def test_namecheck_and_svgrender_and_identity_token_have_no_import_statements_at_all():
    """The strongest form of the boundary for these three files specifically: not merely
    "imports nothing forbidden" but "imports nothing at all" -- each is fully
    self-contained, per H1/H10 and each module's own header comment."""
    files = [
        SRC / "math" / "namecheck.vy",
        SRC / "art" / "svgrender.vy",
        SRC / "art" / "identity_token.vy",
    ]
    for path in files:
        text = path.read_text()
        assert not IMPORT_RE.search(text), f"{path} contains an import statement"
